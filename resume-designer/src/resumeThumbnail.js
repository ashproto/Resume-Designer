import './readableStreamAsyncIterator.js';
import * as pdfjsLib from 'pdfjs-dist/legacy/build/pdf.mjs';
import pdfjsWorker from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfjsWorker;

function withinTime(promise, milliseconds, message) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(message)), milliseconds);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/** Small, inert PNG of page one from the same saved PDF used by normal export. */
export async function renderResumeThumbnail(pdfBase64) {
  const bytes = Uint8Array.from(atob(pdfBase64), (character) => character.charCodeAt(0));
  const loading = pdfjsLib.getDocument({ data: bytes, isEvalSupported: false });
  let pdf;
  let page;
  let render;
  let rendered = false;
  try {
    pdf = await withinTime(loading.promise, 15_000, 'The PDF preview engine did not start in time.');
    page = await withinTime(pdf.getPage(1), 5_000, 'The resume preview page could not be loaded.');
    const base = page.getViewport({ scale: 1 });
    if (!Number.isFinite(base.width) || !Number.isFinite(base.height) || base.width <= 0 || base.height <= 0) {
      throw new Error('The resume preview has invalid page dimensions.');
    }
    const viewport = page.getViewport({ scale: Math.min(480 / base.width, 720 / base.height) });
    const canvas = document.createElement('canvas');
    canvas.width = Math.min(480, Math.ceil(viewport.width));
    canvas.height = Math.min(720, Math.ceil(viewport.height));
    render = page.render({ canvas, viewport, background: '#ffffff' });
    await withinTime(render.promise, 10_000, 'The resume preview took too long to render.');
    rendered = true;
    const dataUrl = canvas.toDataURL('image/png');
    const imageBase64 = dataUrl.split(',')[1];
    if (!dataUrl.startsWith('data:image/png;base64,') || !imageBase64 || imageBase64.length > 900_000) {
      throw new Error('The resume preview is too large.');
    }
    return { imageBase64, mimeType: 'image/png', width: canvas.width, height: canvas.height, pageCount: pdf.numPages };
  } finally {
    if (render && !rendered) render.cancel();
    page?.cleanup();
    // pdf.js 6 owns worker cleanup on PDFDocumentLoadingTask, including after
    // its promise has resolved; PDFDocumentProxy no longer exposes destroy.
    await loading.destroy();
  }
}
