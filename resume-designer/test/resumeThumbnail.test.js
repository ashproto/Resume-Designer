import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
const mocks = vi.hoisted(() => ({ getDocument: vi.fn() }));
vi.mock('pdfjs-dist/legacy/build/pdf.mjs', () => ({ GlobalWorkerOptions: {}, getDocument: mocks.getDocument }));
vi.mock('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url', () => ({ default: '/worker.js' }));
import { renderResumeThumbnail } from '../src/resumeThumbnail.js';

let page;
let pdf;
let loading;
let canvas;
beforeEach(() => {
  page = {
    getViewport: vi.fn(({ scale }) => ({ width: 612 * scale, height: 792 * scale })),
    render: vi.fn(() => ({ promise: Promise.resolve(), cancel: vi.fn() })),
    cleanup: vi.fn(),
  };
  pdf = { numPages: 3, getPage: vi.fn(async () => page) };
  loading = { promise: Promise.resolve(pdf), destroy: vi.fn(async () => {}) };
  mocks.getDocument.mockReturnValue(loading);
  canvas = { width: 0, height: 0, toDataURL: vi.fn(() => 'data:image/png;base64,aW1hZ2U=') };
  vi.spyOn(document, 'createElement').mockReturnValue(canvas);
});
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers(); });

describe('saved PDF first-page thumbnail', () => {
  it('rasterizes only page one within fixed pixel bounds and destroys the document', async () => {
    expect(await renderResumeThumbnail('cGRm')).toEqual({ imageBase64: 'aW1hZ2U=', mimeType: 'image/png', width: 480, height: 622, pageCount: 3 });
    expect(pdf.getPage).toHaveBeenCalledExactlyOnceWith(1);
    expect(canvas.toDataURL).toHaveBeenCalledWith('image/png');
    expect(page.render).toHaveBeenCalledWith(expect.objectContaining({ canvas, background: '#ffffff' }));
    expect(loading.destroy).toHaveBeenCalledOnce();
    expect(page.cleanup).toHaveBeenCalledOnce();
  });
  it('limits tall PDFs by height rather than allocating an unbounded canvas', async () => {
    page.getViewport.mockImplementation(({ scale }) => ({ width: 612 * scale, height: 5000 * scale }));
    const result = await renderResumeThumbnail('cGRm');
    expect(result.height).toBeLessThanOrEqual(720);
    expect(result.width).toBeLessThanOrEqual(480);
  });
  it('clamps fractional viewport rounding to the advertised bridge bounds', async () => {
    page.getViewport.mockImplementation(({ scale }) => ({ width: 595.2756 * scale, height: 841.8898 * scale }));
    const result = await renderResumeThumbnail('cGRm');
    expect(result.width).toBe(480);
    expect(result.height).toBeLessThanOrEqual(720);
  });
  it('destroys the PDF on render failures', async () => {
    page.render.mockReturnValue({ promise: Promise.reject(new Error('render failed')), cancel: vi.fn() });
    await expect(renderResumeThumbnail('cGRm')).rejects.toThrow('render failed');
    expect(loading.destroy).toHaveBeenCalledOnce();
  });
  it('cancels a stalled render and releases worker resources', async () => {
    vi.useFakeTimers();
    const task = { promise: new Promise(() => {}), cancel: vi.fn() };
    page.render.mockReturnValue(task);
    const pending = renderResumeThumbnail('cGRm');
    const failed = expect(pending).rejects.toThrow('The resume preview took too long to render.');
    await vi.advanceTimersByTimeAsync(10_001);
    await failed;
    expect(task.cancel).toHaveBeenCalledOnce();
    expect(loading.destroy).toHaveBeenCalledOnce();
  });
  it('destroys a worker whose PDF never loads', async () => {
    vi.useFakeTimers();
    loading.promise = new Promise(() => {});
    const pending = renderResumeThumbnail('cGRm');
    const failed = expect(pending).rejects.toThrow('The PDF preview engine did not start in time.');
    await vi.advanceTimersByTimeAsync(15_001);
    await failed;
    expect(loading.destroy).toHaveBeenCalledOnce();
  });
  it('refuses images too large for the bounded bridge response', async () => {
    canvas.toDataURL.mockReturnValue(`data:image/png;base64,${'A'.repeat(900_001)}`);
    await expect(renderResumeThumbnail('cGRm')).rejects.toThrow('The resume preview is too large.');
    expect(loading.destroy).toHaveBeenCalledOnce();
  });
});
