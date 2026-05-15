import { useEffect, useMemo, useRef, useState } from 'react';
import { renderLetterheadHtml } from '@/lib/letterhead-templates';
import type {
  LetterheadFields,
  LetterheadTemplateKey,
} from '@/hooks/useLetterheads';

/**
 * Live preview of a letterhead. Renders the template at the real print
 * width (~7 inches) and scales it down with `transform: scale()` so the
 * output the user sees in Settings matches what's stamped onto generated
 * PDFs exactly.
 *
 * Transforms don't affect layout, so without a wrapper height the parent
 * collapses to zero pixels. We use a ResizeObserver to keep the wrapper's
 * height in sync with the (changing) inner content - important because the
 * inner block grows / shrinks as the user types into slot fields and as
 * the logo image loads in.
 *
 * Why not `zoom`: works in Chromium/WebKit but Firefox quirks. `transform`
 * + measured height works in every browser we support.
 */

interface LetterheadPreviewProps {
  templateKey: LetterheadTemplateKey;
  fields: LetterheadFields;
  logoUrl: string | null;
  /** Width in px the template renders at (the print column width). Default
   *  672 ≈ 7" at 96dpi. */
  width?: number;
  /** Visual width the preview shrinks into. Default 480. */
  scaleToWidth?: number;
}

export function LetterheadPreview({
  templateKey,
  fields,
  logoUrl,
  width = 672,
  scaleToWidth = 480,
}: LetterheadPreviewProps) {
  const html = useMemo(
    () => renderLetterheadHtml(templateKey, fields, logoUrl),
    [templateKey, fields, logoUrl],
  );
  const scale = scaleToWidth / width;

  const innerRef = useRef<HTMLDivElement>(null);
  const [innerHeight, setInnerHeight] = useState<number>(120);

  // Track the rendered height of the inner block. Fires on:
  //  - initial mount (so we don't flash a zero-height frame)
  //  - field/template changes (innerHTML rewrite → layout recomputed)
  //  - logo image load (the <img> resizes itself in)
  useEffect(() => {
    const el = innerRef.current;
    if (!el) return;
    const measure = () => setInnerHeight(el.offsetHeight);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    // The logo <img> may load AFTER the initial measurement. Hook onto its
    // load event explicitly so the preview reflows when the image lands.
    const imgs = Array.from(el.querySelectorAll('img'));
    const onImgLoad = () => measure();
    for (const img of imgs) img.addEventListener('load', onImgLoad);
    return () => {
      ro.disconnect();
      for (const img of imgs) img.removeEventListener('load', onImgLoad);
    };
  }, [html]);

  // Add a small bottom buffer so a borderline pixel doesn't get cropped
  // by sub-pixel rounding on the transform.
  const wrapperHeight = Math.ceil(innerHeight * scale) + 2;

  return (
    <div
      style={{
        width: scaleToWidth,
        height: wrapperHeight,
        // Hide the X-overflow (inner block is rendered at full print
        // width but scaled visually). Vertical overflow is impossible
        // because we set the height to match the measured content.
        overflow: 'hidden',
        background: '#fff',
        border: '1px solid var(--border-default)',
        borderRadius: 'var(--radius-md)',
      }}
    >
      <div
        ref={innerRef}
        style={{
          width,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          padding: 12,
          boxSizing: 'border-box',
        }}
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
}
