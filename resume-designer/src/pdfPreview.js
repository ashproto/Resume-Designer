/**
 * PDF preview rendering via pdf.js → <canvas>.
 *
 * Why canvas instead of `<iframe src="blob:…">`:
 *  - The app's CSP is `default-src 'self'` with no `frame-src`/`child-src`, so a
 *    blob: (or asset:) iframe is refused outright and renders blank.
 *  - Even with the CSP loosened, macOS WKWebView's native PDF viewer is
 *    unreliable for blob PDFs inside a subframe.
 *  - pdf.js rasterizes to a canvas in pure JS — no CSP change, and it renders
 *    identically across WKWebView, WebView2, and the browser.
 *
 * The worker is loaded via Vite's `?url` — the same setup resumeParser.js uses
 * and which already ships in the packaged app.
 */
import * as pdfjsLib from 'pdfjs-dist';
import pdfjsWorker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

// Standard-base64 string → bytes. Mirror of the Rust `STANDARD.encode` in
// `read_pdf_preview` (no URL-safe alphabet, no line breaks).
function base64ToBytes(base64) {
  const bin = atob(base64);
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

// Reject if `promise` doesn't settle within `ms`, so a worker that never starts
// surfaces a clear error instead of leaving the dialog spinning forever.
function withTimeout(promise, ms, message) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(message)), ms);
    promise.then(
      (v) => { clearTimeout(timer); resolve(v); },
      (e) => { clearTimeout(timer); reject(e); },
    );
  });
}

/**
 * Render every page of a base64 PDF into `container` as stacked <canvas> sheets,
 * each fit to the container's content width. Returns the pdf.js document so the
 * caller can `.destroy()` it; `shouldCancel()` is polled between pages so a
 * closed dialog stops work mid-render.
 *
 * @param {string} base64 - the PDF bytes, standard-base64 encoded
 * @param {HTMLElement} container - host element; its children are replaced
 * @param {() => boolean} [shouldCancel] - return true to abort
 * @returns {Promise<import('pdfjs-dist').PDFDocumentProxy | null>}
 */
export async function renderPdfPreview(base64, container, shouldCancel) {
  const loadingTask = pdfjsLib.getDocument({ data: base64ToBytes(base64) });
  const pdf = await withTimeout(
    loadingTask.promise,
    15000,
    'The PDF preview engine did not start in time.',
  );
  if (shouldCancel?.()) {
    pdf.destroy();
    return null;
  }

  container.replaceChildren();
  const dpr = window.devicePixelRatio || 1;
  // Fit each sheet to the container's width; fall back to a letter-ish width
  // (612pt) if the container hasn't been laid out yet.
  const targetWidth = container.clientWidth || 612;

  for (let n = 1; n <= pdf.numPages; n += 1) {
    if (shouldCancel?.()) break;
    // eslint-disable-next-line no-await-in-loop
    const page = await pdf.getPage(n);
    const base = page.getViewport({ scale: 1 });
    const cssScale = targetWidth / base.width;
    const viewport = page.getViewport({ scale: cssScale * dpr });

    const canvas = document.createElement('canvas');
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.style.width = `${Math.floor(base.width * cssScale)}px`;
    canvas.style.height = `${Math.floor(base.height * cssScale)}px`;
    canvas.style.backgroundColor = '#ffffff';
    canvas.style.boxShadow = '0 1px 6px rgba(0, 0, 0, 0.18)';
    canvas.style.borderRadius = '2px';

    // eslint-disable-next-line no-await-in-loop
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    if (shouldCancel?.()) break;
    container.appendChild(canvas);
  }
  return pdf;
}
