import { useCallback, useEffect, useRef, useState } from 'react';
import jsQR from 'jsqr';
import { Modal } from '@/components/Modal';
import { L, useEcourtsT } from '@/hooks/useEcourtsLabels';
import { cnrFromQrText } from '@/lib/cnr-extract';

// The eCourts app's "Scan QR Code" on the CNR screen. eCourts prints a QR
// code carrying the CNR on case papers, orders and cause lists. Decoding
// runs entirely in the browser (jsQR on camera frames or a picked image) -
// no image leaves the device. The QR text may be the bare CNR or a URL /
// sentence containing it, so the CNR is pulled out by its shape.

function decodeImageData(data: ImageData): string | null {
  const hit = jsQR(data.data, data.width, data.height, { inversionAttempts: 'attemptBoth' });
  return hit?.data ?? null;
}

function QrGlyph() {
  return (
    <svg width={16} height={16} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} aria-hidden>
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v.01M14 20h.01M17 17h4v4h-4" />
    </svg>
  );
}

export function QrScanButton({ onCnr }: { onCnr: (cnr: string) => void }) {
  const { t } = useEcourtsT();
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" className="btn btn-ghost btn-lg" onClick={() => setOpen(true)}>
        <QrGlyph /> {t(L.scanQr, 'Scan QR Code')}
      </button>
      {open ? (
        <QrScanModal
          onClose={() => setOpen(false)}
          onCnr={(cnr) => { setOpen(false); onCnr(cnr); }}
        />
      ) : null}
    </>
  );
}

function QrScanModal({ onClose, onCnr }: { onClose: () => void; onCnr: (cnr: string) => void }) {
  const { t } = useEcourtsT();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [camera, setCamera] = useState<'starting' | 'on' | 'unavailable'>('starting');
  const [message, setMessage] = useState<string | null>(null);
  const doneRef = useRef(false);
  // A ref so a new onCnr from the parent doesn't restart the camera.
  const onCnrRef = useRef(onCnr);
  onCnrRef.current = onCnr;

  const accept = useCallback((text: string | null): boolean => {
    if (doneRef.current || !text) return false;
    const cnr = cnrFromQrText(text);
    if (!cnr) {
      setMessage(`This QR code has no CNR number in it ("${text.slice(0, 60)}").`);
      return false;
    }
    doneRef.current = true;
    onCnrRef.current(cnr);
    return true;
  }, []);

  // Camera: rear camera preferred; frames decoded ~6x a second.
  useEffect(() => {
    let stream: MediaStream | null = null;
    let timer: number | undefined;
    let cancelled = false;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamera('unavailable');
      return;
    }
    navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false })
      .then((s) => {
        if (cancelled) { s.getTracks().forEach((tr) => tr.stop()); return; }
        stream = s;
        const video = videoRef.current;
        if (!video) return;
        video.srcObject = s;
        void video.play().catch(() => undefined);
        setCamera('on');
        timer = window.setInterval(() => {
          const v = videoRef.current;
          const c = canvasRef.current;
          if (!v || !c || v.readyState < 2 || !v.videoWidth) return;
          // Downscale large frames - jsQR is fast enough at ~640px.
          const scale = Math.min(1, 640 / v.videoWidth);
          c.width = Math.round(v.videoWidth * scale);
          c.height = Math.round(v.videoHeight * scale);
          const ctx = c.getContext('2d', { willReadFrequently: true });
          if (!ctx) return;
          ctx.drawImage(v, 0, 0, c.width, c.height);
          const text = decodeImageData(ctx.getImageData(0, 0, c.width, c.height));
          if (text && accept(text) && timer) window.clearInterval(timer);
        }, 160);
      })
      .catch(() => { if (!cancelled) setCamera('unavailable'); });
    return () => {
      cancelled = true;
      if (timer) window.clearInterval(timer);
      stream?.getTracks().forEach((tr) => tr.stop());
    };
  }, [accept]);

  const onFile = (file: File | undefined) => {
    if (!file) return;
    setMessage(null);
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const c = document.createElement('canvas');
      const scale = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
      c.width = Math.round(img.naturalWidth * scale);
      c.height = Math.round(img.naturalHeight * scale);
      const ctx = c.getContext('2d');
      URL.revokeObjectURL(url);
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, c.width, c.height);
      const text = decodeImageData(ctx.getImageData(0, 0, c.width, c.height));
      if (!text) setMessage(t(L.notQr, 'Not a QR code') + ' - no QR code found in this image.');
      else accept(text);
    };
    img.onerror = () => { URL.revokeObjectURL(url); setMessage('That file is not an image.'); };
    img.src = url;
  };

  return (
    <Modal
      open
      onClose={onClose}
      title={t(L.scanQr, 'Scan QR Code')}
      description="Point the camera at the QR code on the case papers or order, or pick a photo of it."
      width={520}
      footer={
        <>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={() => fileRef.current?.click()}>Choose image</button>
        </>
      }
    >
      <div className="col" style={{ gap: 12 }}>
        {camera !== 'unavailable' ? (
          <div style={{ position: 'relative', borderRadius: 10, overflow: 'hidden', background: 'var(--surface-sunken, #000)', aspectRatio: '4 / 3' }}>
            <video ref={videoRef} muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            {camera === 'starting' ? (
              <div className="body-sm muted" style={{ position: 'absolute', inset: 0, display: 'grid', placeItems: 'center' }}>Starting camera…</div>
            ) : (
              <div aria-hidden style={{ position: 'absolute', inset: '18%', border: '2px solid rgba(255,255,255,0.85)', borderRadius: 12 }} />
            )}
          </div>
        ) : (
          <p className="body-sm muted">
            No camera is available here (or permission was refused). Choose a photo or screenshot of the QR code instead.
          </p>
        )}
        <canvas ref={canvasRef} style={{ display: 'none' }} />
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          style={{ display: 'none' }}
          onChange={(e) => { onFile(e.target.files?.[0]); e.target.value = ''; }}
        />
        {message ? <p className="body-sm" style={{ color: 'var(--danger)' }}>{message}</p> : null}
      </div>
    </Modal>
  );
}
