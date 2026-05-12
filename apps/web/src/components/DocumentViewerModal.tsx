import { useEffect, useMemo, useState } from 'react';
import type { DocumentRecord } from '@lexdraft/types';
import { Icon } from '@lexdraft/ui';
import { Modal } from './Modal';
import { useDraft } from '@/hooks/useDrafts';
import { useDocument } from '@/hooks/useDocuments';

interface DocumentViewerModalProps {
  doc: DocumentRecord | null;
  onClose: () => void;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

/** Convert a base64 string to a Blob with the given mime, then to an
 *  object URL. The URL is what an <iframe>/<img> can load. */
function base64ToBlobUrl(base64: string, mime: string): string {
  const binary = atob(base64);
  const len = binary.length;
  const bytes = new Uint8Array(len);
  for (let i = 0; i < len; i++) bytes[i] = binary.charCodeAt(i);
  const blob = new Blob([bytes], { type: mime || 'application/octet-stream' });
  return URL.createObjectURL(blob);
}

export function DocumentViewerModal({ doc, onClose }: DocumentViewerModalProps) {
  const id = doc?.id ?? null;
  const isDraft = doc?.kind === 'draft' || (!doc?.kind && !doc?.hasFile);

  // Drafts → fetch the saved-draft body. Documents → fetch the full record
  // including the uploaded file blob. Only one of these will actually fire
  // (the other has `enabled: false` thanks to its conditional id).
  const draft = useDraft(isDraft ? id : null);
  const document = useDocument(!isDraft ? id : null);

  // Hold the object URL across renders so we can revoke it on close. Building
  // it inline would leak URLs every time React re-renders the iframe.
  const fileBlobUrl = useMemo(() => {
    const data = document.data;
    if (!data?.fileBase64 || !data.fileMime) return null;
    return base64ToBlobUrl(data.fileBase64, data.fileMime);
  }, [document.data]);

  useEffect(() => {
    return () => {
      if (fileBlobUrl) URL.revokeObjectURL(fileBlobUrl);
    };
  }, [fileBlobUrl]);

  // Stop the active blob URL when the modal closes too — `useEffect` cleanup
  // alone wouldn't fire if the modal goes from open→closed without unmount.
  const [activeUrl, setActiveUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!doc) {
      if (activeUrl) {
        URL.revokeObjectURL(activeUrl);
        setActiveUrl(null);
      }
      return;
    }
    setActiveUrl(fileBlobUrl);
  }, [doc, fileBlobUrl, activeUrl]);

  const open = !!doc;
  const data = document.data;
  const draftData = draft.data;

  const isLoading = open && (isDraft ? draft.isLoading : document.isLoading);
  const isError = open && (isDraft ? draft.isError : document.isError);

  const hasFile = !!data?.fileBase64;
  const isPdf = !!data?.fileMime?.includes('pdf');
  const isImage = !!data?.fileMime?.startsWith('image/');
  const hasDraftBody = !!(draftData?.editedHtml?.trim() || draftData?.bodyText?.trim());

  const downloadFile = () => {
    if (!data?.fileBase64 || !data.fileName) return;
    const url = base64ToBlobUrl(data.fileBase64, data.fileMime ?? 'application/octet-stream');
    const a = window.document.createElement('a');
    a.href = url;
    a.download = data.fileName;
    window.document.body.appendChild(a);
    a.click();
    window.document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={doc?.name ?? ''}
      eyebrow={doc?.type?.toUpperCase()}
      description={doc?.case && doc.case !== '—' ? doc.case : undefined}
      width={920}
      footer={
        <>
          {hasFile && (
            <button type="button" className="btn" onClick={downloadFile}>
              <Icon name="download" size={14} /> Download original
            </button>
          )}
          <button type="button" className="btn" onClick={onClose}>
            Close
          </button>
        </>
      }
    >
      <div
        style={{
          background: 'var(--bg-surface-2)',
          border: '1px solid var(--border-subtle)',
          borderRadius: 'var(--radius-md)',
          padding: hasFile && (isPdf || isImage) ? 0 : '24px 16px',
          minHeight: 320,
          maxHeight: '70vh',
          overflow: 'auto',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        {isLoading && (
          <p className="body-md muted" style={{ textAlign: 'center', padding: 32 }}>
            Loading document<span className="blink" />
          </p>
        )}
        {isError && (
          <p className="body-md" style={{ color: 'var(--danger)', textAlign: 'center', padding: 32 }}>
            Couldn&apos;t load this document.
          </p>
        )}

        {/* Uploaded PDF — inline iframe preview */}
        {!isLoading && !isError && hasFile && isPdf && fileBlobUrl && (
          <iframe
            src={fileBlobUrl}
            title={doc?.name ?? 'Document'}
            style={{ width: '100%', height: '70vh', border: 0, background: '#fff', minHeight: 480 }}
          />
        )}

        {/* Uploaded image — inline preview */}
        {!isLoading && !isError && hasFile && isImage && fileBlobUrl && (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
              background: 'var(--bg-base)',
            }}
          >
            <img
              src={fileBlobUrl}
              alt={doc?.name ?? 'Document'}
              style={{ maxWidth: '100%', maxHeight: '65vh', borderRadius: 'var(--radius-sm)' }}
            />
          </div>
        )}

        {/* Uploaded but unsupported preview type — offer download */}
        {!isLoading && !isError && hasFile && !isPdf && !isImage && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 12,
              padding: 32,
              flex: 1,
            }}
          >
            <Icon name="documents" size={28} />
            <div style={{ fontSize: 14, fontWeight: 500, color: 'var(--text-primary)' }}>
              {data?.fileName}
            </div>
            <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)', letterSpacing: '0.12em' }}>
              {data?.fileSize ? formatBytes(data.fileSize) : ''}
              {data?.fileMime ? ` · ${data.fileMime}` : ''}
            </div>
            <p className="body-sm muted" style={{ textAlign: 'center', maxWidth: 360 }}>
              Inline preview isn&apos;t available for this file type. Use Download original to open it in a native viewer.
            </p>
          </div>
        )}

        {/* Draft body (text-based) — existing path */}
        {!isLoading && !isError && !hasFile && draftData && hasDraftBody && (
          <div
            className="court-prose court-prose-paper"
            {...(draftData.editedHtml?.trim()
              ? { dangerouslySetInnerHTML: { __html: draftData.editedHtml } }
              : {})}
          >
            {!draftData.editedHtml?.trim() && draftData.bodyText
              ? draftData.bodyText.split(/\n{2,}/).map((para, i) => (
                  <p key={i}>
                    {para.split('\n').map((line, j, arr) => (
                      <span key={j}>
                        {line}
                        {j < arr.length - 1 && <br />}
                      </span>
                    ))}
                  </p>
                ))
              : null}
          </div>
        )}

        {!isLoading && !isError && !hasFile && (!draftData || !hasDraftBody) && (
          <p className="body-md muted" style={{ textAlign: 'center', padding: 32 }}>
            No preview available for this entry. Drafts created in the editor and uploaded files will show their full content here.
          </p>
        )}
      </div>

      {hasFile && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)', letterSpacing: '0.08em' }}>
          {data?.fileName}
          {typeof data?.fileSize === 'number' ? ` · ${formatBytes(data.fileSize)}` : ''}
          {data?.fileMime ? ` · ${data.fileMime}` : ''}
        </div>
      )}
      {!hasFile && draftData?.updatedAt && (
        <div className="mono" style={{ fontSize: 11, color: 'var(--text-tertiary)' }}>
          Last edited · {new Date(draftData.updatedAt).toLocaleString()}
        </div>
      )}
    </Modal>
  );
}
