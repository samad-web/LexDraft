// image-upload: photos the Documents upload can take on every device.
// - iPhone / iPad: the picker leaves HEIC out, so iOS hands over a JPEG itself.
// - Mac / Windows: HEIC photos (from an iPhone) are allowed again and turned into
//   JPEG in the browser where it can read them (Safari on a Mac), so they show
//   everywhere and can be marked up. A photo too big to upload is scaled down.
import { isIosDevice } from './ios';

export const BASE_ACCEPT = '.pdf,.doc,.docx,.txt,.rtf,.png,.jpg,.jpeg,.tif,.tiff,.webp';
export const MAX_UPLOAD_BYTES = 12 * 1024 * 1024;
const MAX_SIDE = 3000; // long side after scaling: sharp enough to read a page

/** The picker's accept list: no HEIC on iOS (iOS converts), HEIC elsewhere. */
export function uploadAccept(ios = isIosDevice()): string {
  return ios ? BASE_ACCEPT : `${BASE_ACCEPT},.heic,.heif`;
}

export function isHeic(f: { name: string; type: string }): boolean {
  return /image\/hei[cf]/i.test(f.type) || /\.hei[cf]$/i.test(f.name);
}

/** Width / height that keep the shape and fit `max` on the long side. */
export function fitSize(w: number, h: number, max = MAX_SIDE): [number, number] {
  const k = Math.min(1, max / Math.max(w, h));
  return [Math.max(1, Math.round(w * k)), Math.max(1, Math.round(h * k))];
}

export const asJpgName = (name: string) => name.replace(/\.[a-z0-9]{2,5}$/i, '') + '.jpg';

async function decode(file: File): Promise<{ draw: CanvasImageSource; w: number; h: number; close: () => void }> {
  if (typeof createImageBitmap === 'function') {
    const b = await createImageBitmap(file);
    return { draw: b, w: b.width, h: b.height, close: () => b.close() };
  }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.src = url;
  await img.decode();
  return { draw: img, w: img.naturalWidth, h: img.naturalHeight, close: () => URL.revokeObjectURL(url) };
}

/** The file to upload: HEIC → JPEG, an over-size photo → a smaller JPEG; else
 *  the file itself. If the browser can't read the photo, the original is kept
 *  (and the caller's size check still applies). */
export async function toUploadable(file: File): Promise<File> {
  const image = file.type.startsWith('image/') || isHeic(file);
  if (!image || (!isHeic(file) && file.size <= MAX_UPLOAD_BYTES)) return file;
  try {
    const src = await decode(file);
    const [w, h] = fitSize(src.w, src.h);
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    canvas.getContext('2d')!.drawImage(src.draw, 0, 0, w, h);
    src.close();
    const blob = await new Promise<Blob | null>((r) => canvas.toBlob(r, 'image/jpeg', 0.88));
    return blob ? new File([blob], asJpgName(file.name), { type: 'image/jpeg' }) : file;
  } catch {
    return file;
  }
}
