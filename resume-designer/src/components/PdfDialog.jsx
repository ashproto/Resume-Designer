import { useEffect, useRef, useState } from 'react';
import { Download } from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';

// PDF "Download" filename dialog — the React port of the vanilla modal that
// pdf.js used to build via insertAdjacentHTML. pdf.js keeps ALL the capture
// logic (hidden print window, Rust commands, html2pdf fallback, busy state); it
// just dispatches `rd:open-pdf-dialog` with { defaultFilename, onDownload } and
// this dialog collects the filename and calls onDownload(filename) — the same
// bridge shape as diffView.js → <DiffDialog />. Composed from genuine shadcn
// primitives (Dialog / Input / Button / Label); matches the approved mockup's
// PDF dialog (340px, filename + ".pdf" suffix, Cancel / Download).
export default function PdfDialog() {
  const [open, setOpen] = useState(false);
  const [filename, setFilename] = useState('Resume');
  const onDownloadRef = useRef(null);
  const inputRef = useRef(null);

  useEffect(() => {
    const onOpen = (e) => {
      const { defaultFilename, onDownload } = e.detail || {};
      onDownloadRef.current = typeof onDownload === 'function' ? onDownload : null;
      setFilename(defaultFilename || 'Resume');
      setOpen(true);
    };
    window.addEventListener('rd:open-pdf-dialog', onOpen);
    return () => window.removeEventListener('rd:open-pdf-dialog', onOpen);
  }, []);

  // Focus + select the filename when the dialog opens (matches the old setTimeout
  // focus/select so the default name is ready to overwrite).
  useEffect(() => {
    if (!open) return undefined;
    const t = setTimeout(() => {
      inputRef.current?.focus();
      inputRef.current?.select();
    }, 80);
    return () => clearTimeout(t);
  }, [open]);

  const download = () => {
    setOpen(false);
    onDownloadRef.current?.(filename);
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-sm glass-card">
        <DialogHeader>
          <DialogTitle>Download PDF</DialogTitle>
          <DialogDescription className="sr-only">Choose a filename for the exported PDF</DialogDescription>
        </DialogHeader>
        <div className="space-y-2">
          <Label htmlFor="pdf-filename">Filename</Label>
          <div className="flex items-center gap-2">
            <Input
              id="pdf-filename"
              ref={inputRef}
              value={filename}
              onChange={(e) => setFilename(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); download(); } }}
              placeholder="Resume"
            />
            <span className="shrink-0 text-sm text-muted-foreground">.pdf</span>
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>Cancel</Button>
          <Button onClick={download}>
            <Download className="size-4" /> Download
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
