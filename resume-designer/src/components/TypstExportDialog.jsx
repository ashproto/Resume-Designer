import { useCallback, useEffect, useRef, useState } from 'react';
import { Download, Loader2 } from 'lucide-react';
import * as pdfjsLib from 'pdfjs-dist';
import worker from 'pdfjs-dist/build/pdf.worker.min.mjs?url';

import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { ScrollArea } from '@/components/ui/scroll-area';
import { Segmented, SegmentedItem } from '@/components/ui/segmented';

import { store } from '../store.js';
import * as typstExport from '../typstExport.js';
import { isTauri } from '../native.js';

// Configure PDF.js worker once at module init (mirrors resumeParser.js pattern).
pdfjsLib.GlobalWorkerOptions.workerSrc = worker;

const PAGE_SIZE_OPTIONS = [
  { value: 'continuous', label: 'Continuous' },
  { value: 'letter', label: 'Letter' },
  { value: 'a4', label: 'A4' },
  { value: 'legal', label: 'Legal' },
  { value: 'tabloid', label: 'Tabloid' },
];

// Preview state machine: 'idle' | 'loading' | 'ready' | 'error' | 'unavailable'

export default function TypstExportDialog() {
  const [open, setOpen] = useState(false);
  const [filename, setFilename] = useState('Resume');
  const [pageSize, setPageSize] = useState('continuous');
  // preview state
  const [previewState, setPreviewState] = useState('idle'); // 'idle'|'loading'|'ready'|'error'|'unavailable'
  const [previewError, setPreviewError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState('');
  const inputRef = useRef(null);
  const canvasContainerRef = useRef(null);
  const debounceRef = useRef(null);

  // --- Preview rendering ---
  const renderPreview = useCallback(async () => {
    if (!open) return;
    setPreviewState('loading');
    setPreviewError('');
    setSaveError('');

    try {
      const buf = await typstExport.renderPreview(); // ArrayBuffer
      const pdfDoc = await pdfjsLib.getDocument({ data: new Uint8Array(buf) }).promise;

      const container = canvasContainerRef.current;
      if (!container) return;
      // Clear previous canvases
      container.replaceChildren();

      const SCALE = 1.5;
      for (let i = 1; i <= pdfDoc.numPages; i++) {
        const page = await pdfDoc.getPage(i);
        const viewport = page.getViewport({ scale: SCALE });

        const canvas = document.createElement('canvas');
        canvas.width = viewport.width;
        canvas.height = viewport.height;
        canvas.style.width = '100%';
        canvas.style.display = 'block';
        canvas.style.marginBottom = i < pdfDoc.numPages ? '12px' : '0';
        container.appendChild(canvas);

        const canvasContext = canvas.getContext('2d');
        await page.render({ canvasContext, viewport }).promise;
      }

      setPreviewState('ready');
    } catch (err) {
      const msg = err?.message ?? String(err);
      if (!isTauri || msg.toLowerCase().includes('desktop app')) {
        setPreviewState('unavailable');
      } else {
        setPreviewState('error');
        setPreviewError(msg);
      }
    }
  }, [open]);

  // Debounced re-render triggered by page size change
  const schedulePreview = useCallback(() => {
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      renderPreview();
    }, 250);
  }, [renderPreview]);

  // --- Event bridge: rd:open-typst-export ---
  useEffect(() => {
    const onOpen = (e) => {
      const { defaultFilename } = e.detail || {};
      setFilename(defaultFilename || 'Resume');
      setPageSize(store.getPageSize());
      setSaveError('');
      setPreviewState('idle');
      setOpen(true);
    };
    window.addEventListener('rd:open-typst-export', onOpen);
    return () => window.removeEventListener('rd:open-typst-export', onOpen);
  }, []);

  // Focus + select filename when dialog opens
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 80);
    return () => clearTimeout(t);
  }, [open]);

  // Kick off preview render when dialog opens
  useEffect(() => {
    if (!open) return;
    renderPreview();
  }, [open, renderPreview]);

  // Cleanup debounce on unmount
  useEffect(() => () => clearTimeout(debounceRef.current), []);

  // --- Page size change ---
  const handlePageSizeChange = (value) => {
    store.setPageSize(value);
    setPageSize(value);
    schedulePreview();
  };

  // --- Save ---
  const handleSave = async () => {
    setSaveError('');
    setSaving(true);
    try {
      const r = await typstExport.exportToPath(filename);
      if (r?.success) {
        setOpen(false);
      } else if (r?.canceled) {
        // user dismissed the save dialog — stay open, no error
      } else if (r?.error) {
        setSaveError(r.error);
      }
    } catch (err) {
      setSaveError(err?.message ?? String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-3xl glass-card">
        <DialogHeader>
          <DialogTitle>Export PDF</DialogTitle>
          <DialogDescription className="sr-only">
            Configure and export your résumé as a PDF using Typst
          </DialogDescription>
        </DialogHeader>

        {/* Filename + page-size controls */}
        <div className="flex flex-wrap items-end gap-4">
          <div className="flex-1 min-w-0 space-y-2">
            <Label htmlFor="typst-filename">Filename</Label>
            <div className="flex items-center gap-2">
              <Input
                id="typst-filename"
                ref={inputRef}
                value={filename}
                onChange={(e) => setFilename(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') { e.preventDefault(); handleSave(); }
                }}
                placeholder="Resume"
              />
              <span className="shrink-0 text-sm text-muted-foreground">.pdf</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Page size</Label>
            <Segmented>
              {PAGE_SIZE_OPTIONS.map(({ value, label }) => (
                <SegmentedItem
                  key={value}
                  active={pageSize === value}
                  onClick={() => handlePageSizeChange(value)}
                >
                  {label}
                </SegmentedItem>
              ))}
            </Segmented>
          </div>
        </div>

        {/* Preview pane */}
        <ScrollArea className="h-[420px] w-full rounded-md border bg-muted/30">
          <div className="p-4">
            {previewState === 'loading' && (
              <div className="flex flex-col items-center justify-center gap-2 py-16 text-muted-foreground">
                <Loader2 className="size-6 animate-spin" />
                <span className="text-sm">Rendering…</span>
              </div>
            )}
            {previewState === 'unavailable' && (
              <div className="flex items-center justify-center py-16">
                <p className="text-sm text-muted-foreground">
                  Live preview is available in the desktop app.
                </p>
              </div>
            )}
            {previewState === 'error' && (
              <div className="flex items-center justify-center py-16 px-4">
                <p className="text-sm text-destructive break-all">{previewError}</p>
              </div>
            )}
            {/* Dedicated node for the imperatively-rendered PDF canvases. Kept SEPARATE
                from the conditional messages above (which React owns) so the manual
                replaceChildren/appendChild calls never clash with React reconciliation.
                React adds no children here, so it never touches the canvases. */}
            <div ref={canvasContainerRef} className={previewState === 'ready' ? '' : 'hidden'} />
          </div>
        </ScrollArea>

        {saveError && (
          <p className="text-sm text-destructive">{saveError}</p>
        )}

        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <Download className="size-4" />
            )}
            Save
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
