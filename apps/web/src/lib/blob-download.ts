/**
 * Trigger a browser download from an in-memory Blob.
 *
 * Extracted from the inline `<a download>` snippets that were duplicated in
 * InvoicesView/ExpensesView so the DPDP export flow can reuse the exact same
 * pattern. Server-side nothing is stored — the file is built once, downloaded
 * once, then the object URL is revoked.
 */
export function triggerBlobDownload(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  // Give the browser a tick to start the download before revoking the URL.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
