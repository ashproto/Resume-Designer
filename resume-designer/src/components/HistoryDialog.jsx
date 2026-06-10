import { useEffect, useReducer, useState } from 'react';
import {
  FileText, Pencil, Sparkles, Upload, ArrowUpDown, Plus, Minus,
  RotateCcw, Columns2, Check, X,
} from 'lucide-react';
import { toast } from 'sonner';

import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { confirmDestructive } from '@/components/ui/confirm';
import { cn } from '@/lib/utils';

import { store } from '../store.js';
import { diffResumeData } from '../diffEngine.js';
import { showDiffView } from '../diffView.js';

// Version-history dialog, rebuilt for the full-shadcn chrome redesign (spec §5.2):
// a simple ~480px Dialog (header title + muted description + ghost X, no rail)
// whose body is a pure-Tailwind timeline — 30px circular icon markers on a 1.5px
// rail, type Badge + muted relative time, 13.5px description, outline sm
// Restore/Compare, and an accent "Current version" pill on the active entry. No
// bespoke CSS (history.css is deleted). Opens on the `rd:open-history` window
// event (dispatched by main.js's window.openHistoryPanel shim, called from the
// header's Tools -> Version History menu). Restore/Compare still go through the
// store + diffView exactly as before; the only behavior deltas are the §5.11
// mechanism swaps: restore confirm() -> confirmDestructive AlertDialog, and the
// compare no-difference alert() -> sonner toast.

// CHANGE_TYPES value -> display label.
const TYPE_LABELS = {
  initial: 'Created',
  edit: 'Edit',
  ai: 'AI Change',
  import: 'Import',
  reorder: 'Reordered',
  add: 'Added',
  remove: 'Removed',
};

// CHANGE_TYPES value -> lucide marker icon (spec §5.2). 'edit' is also the
// fallback for any unknown changeType.
const TYPE_ICONS = {
  initial: FileText,
  edit: Pencil,
  ai: Sparkles,
  import: Upload,
  reorder: ArrowUpDown,
  add: Plus,
  remove: Minus,
};

function formatTime(timestamp) {
  const date = new Date(timestamp);
  const now = new Date();
  const diff = now - date;
  if (diff < 60_000) return 'Just now';
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`;
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`;
  if (diff < 604_800_000) return `${Math.floor(diff / 86_400_000)}d ago`;
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== now.getFullYear() ? 'numeric' : undefined,
  });
}

export default function HistoryDialog() {
  const [open, setOpen] = useState(false);
  // Force a re-read of the store's history list while the dialog is open.
  const [, bump] = useReducer((n) => n + 1, 0);

  useEffect(() => {
    const onOpen = () => setOpen(true);
    window.addEventListener('rd:open-history', onOpen);
    return () => window.removeEventListener('rd:open-history', onOpen);
  }, []);

  // Re-render the timeline when history changes (e.g. after a restore) — but
  // only while open, matching the old `isOpen && renderEntries()` guard.
  useEffect(() => {
    if (!open) return;
    return store.subscribe((event) => {
      if (event === 'historyChanged') bump();
    });
  }, [open]);

  const entries = open ? store.getHistoryEntries() : [];
  const currentIndex = open ? store.getHistoryIndex() : -1;

  const handleRestore = async (index) => {
    const ok = await confirmDestructive({
      title: 'Restore to this version?',
      description: 'Your current changes will be saved in history.',
      actionLabel: 'Restore',
      destructive: false,
    });
    if (!ok) return;
    store.restoreToEntry(index); // fires historyChanged -> bump() re-renders
  };

  const handleCompare = (index) => {
    const selectedData = store.getHistoryEntryData(index);
    const currentData = store.getData();
    if (!selectedData || !currentData) return;

    const changes = diffResumeData(selectedData, currentData);
    if (changes.length === 0) {
      toast.info('No differences found between these versions.');
      return;
    }
    const changeSet = {
      currentData: selectedData,
      proposedData: currentData,
      changes,
      getSummary() {
        const added = changes.filter((c) => c.type === 'add').length;
        const removed = changes.filter((c) => c.type === 'remove').length;
        const modified = changes.filter((c) => c.type === 'modify').length;
        return { added, removed, modified, total: changes.length };
      },
    };
    setOpen(false);
    showDiffView(changeSet);
  };

  // Newest first; map back to the store's original (ascending) index.
  const rows = [...entries].map((entry, i) => ({ entry, originalIndex: i })).reverse();

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85vh] w-[90vw] max-w-[480px] flex-col gap-0 overflow-hidden p-0 glass-card"
      >
        <DialogDescription className="sr-only">Resume change history with restore and compare</DialogDescription>

        {/* Header */}
        <div className="flex shrink-0 items-start justify-between border-b px-6 py-5">
          <div>
            <DialogTitle className="text-[17px] font-semibold tracking-tight">Version History</DialogTitle>
            <p className="mt-1 text-[13px] text-muted-foreground">Restore or compare earlier versions.</p>
          </div>
          <button
            type="button"
            aria-label="Close"
            onClick={() => setOpen(false)}
            className="-mr-1 -mt-0.5 flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {rows.length === 0 ? (
            <div className="flex flex-col items-center gap-1 py-14 text-center">
              <FileText className="mb-3 h-10 w-10 text-muted-foreground/40" />
              <p className="text-[15px] font-medium text-foreground">No history yet</p>
              <span className="text-[13px] text-muted-foreground">Changes will appear here as you edit</span>
            </div>
          ) : (
            <div className="flex flex-col">
              {rows.map(({ entry, originalIndex }, rowIdx) => {
                const isCurrent = originalIndex === currentIndex;
                const isLast = rowIdx === rows.length - 1;
                const label = TYPE_LABELS[entry.changeType] || 'Edit';
                const Icon = TYPE_ICONS[entry.changeType] || Pencil;
                return (
                  <div key={originalIndex} className="flex gap-3.5">
                    {/* Rail: 30px circular marker + 1.5px line */}
                    <div className="flex flex-col items-center">
                      <span
                        className={cn(
                          'inline-flex h-[30px] w-[30px] shrink-0 items-center justify-center rounded-full border bg-background',
                          isCurrent
                            ? 'border-primary bg-primary/[0.06] text-primary'
                            : 'text-muted-foreground',
                        )}
                      >
                        <Icon className="h-[15px] w-[15px]" />
                      </span>
                      {!isLast && <span className="my-1 w-[1.5px] flex-1 bg-border" />}
                    </div>

                    {/* Body */}
                    <div className={cn('flex-1', !isLast && 'pb-[18px]')}>
                      <div className="flex items-center gap-2">
                        <Badge variant="secondary" className="rounded-md px-2 py-px text-[11.5px] font-semibold">
                          {label}
                        </Badge>
                        <span className="text-xs text-muted-foreground">{formatTime(entry.timestamp)}</span>
                      </div>
                      <p className="mt-1.5 text-[13.5px] leading-snug">{entry.description}</p>
                      {isCurrent ? (
                        <span className="mt-2.5 inline-flex items-center gap-1.5 text-xs font-medium text-primary">
                          <Check className="h-3.5 w-3.5" /> Current version
                        </span>
                      ) : (
                        <div className="mt-2.5 flex gap-2">
                          <Button variant="outline" size="sm" onClick={() => handleRestore(originalIndex)}>
                            <RotateCcw className="h-3.5 w-3.5" /> Restore
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => handleCompare(originalIndex)}>
                            <Columns2 className="h-3.5 w-3.5" /> Compare
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
