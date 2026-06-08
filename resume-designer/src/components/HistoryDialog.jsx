import { useEffect, useReducer, useState } from 'react';
import { Sparkles, Upload, Plus, Minus, ArrowUpDown, FileText, Pencil, RotateCcw, Columns2, Check } from 'lucide-react';

import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { store, CHANGE_TYPES } from '../store.js';
import { diffResumeData } from '../diffEngine.js';
import { showDiffView } from '../diffView.js';

// Version-history panel, converted from historyPanel.js (Step 7 of the React
// migration). The old module body-appended an overlay and toggled a .show class;
// this is a shadcn Dialog that opens on the `rd:open-history` window event
// (dispatched by main.js's window.openHistoryPanel shim, which the header's
// Tools -> Version History menu calls). Restore/compare still go through the
// store + diffView exactly as before.

// Change-type -> { icon, label, color } (ported from getChangeType* helpers).
const TYPE_META = {
  [CHANGE_TYPES.AI]: { Icon: Sparkles, label: 'AI Change', color: 'text-violet-500' },
  [CHANGE_TYPES.IMPORT]: { Icon: Upload, label: 'Import', color: 'text-blue-500' },
  [CHANGE_TYPES.ADD]: { Icon: Plus, label: 'Added', color: 'text-green-500' },
  [CHANGE_TYPES.REMOVE]: { Icon: Minus, label: 'Removed', color: 'text-red-500' },
  [CHANGE_TYPES.REORDER]: { Icon: ArrowUpDown, label: 'Reordered', color: 'text-indigo-500' },
  [CHANGE_TYPES.INITIAL]: { Icon: FileText, label: 'Created', color: 'text-muted-foreground' },
};
const EDIT_META = { Icon: Pencil, label: 'Edit', color: 'text-amber-500' };
const metaFor = (type) => TYPE_META[type] || EDIT_META;

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

  const handleRestore = (index) => {
    if (confirm('Restore to this version? Your current changes will be saved in history.')) {
      store.restoreToEntry(index); // fires historyChanged -> bump() re-renders
    }
  };

  const handleCompare = (index) => {
    const selectedData = store.getHistoryEntryData(index);
    const currentData = store.getData();
    if (!selectedData || !currentData) return;

    const changes = diffResumeData(selectedData, currentData);
    if (changes.length === 0) {
      alert('No differences found between these versions.');
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
      <DialogContent className="max-w-lg glass-card">
        <DialogHeader>
          <DialogTitle>Version History</DialogTitle>
          <DialogDescription className="sr-only">Resume change history with restore and compare</DialogDescription>
        </DialogHeader>

        {rows.length === 0 ? (
          <div className="flex flex-col items-center gap-2 py-10 text-center text-muted-foreground">
            <FileText className="size-10 opacity-40" />
            <p className="text-sm font-medium">No history yet</p>
            <span className="text-xs">Changes will appear here as you edit</span>
          </div>
        ) : (
          <div className="-mr-2 max-h-[60vh] overflow-y-auto pr-2">
            {rows.map(({ entry, originalIndex }, rowIdx) => {
              const isCurrent = originalIndex === currentIndex;
              const isLatest = rowIdx === 0;
              const { Icon, label, color } = metaFor(entry.changeType);
              return (
                <div key={originalIndex} className="flex gap-3">
                  <div className="flex flex-col items-center">
                    <span
                      className={cn(
                        'flex size-7 shrink-0 items-center justify-center rounded-full border bg-background',
                        isCurrent ? 'border-primary' : 'border-border'
                      )}
                    >
                      <Icon className={cn('size-3.5', color)} />
                    </span>
                    {!isLatest && <span className="my-1 w-px flex-1 bg-border" />}
                  </div>
                  <div className="flex-1 pb-4">
                    <div className="flex items-center justify-between gap-2">
                      <span className={cn('text-xs font-medium', color)}>{label}</span>
                      <span className="text-xs text-muted-foreground">{formatTime(entry.timestamp)}</span>
                    </div>
                    <p className="text-sm">{entry.description}</p>
                    <div className="mt-1.5 flex items-center gap-2">
                      {isCurrent ? (
                        <span className="flex items-center gap-1 text-xs font-medium text-primary">
                          <Check className="size-3.5" /> Current version
                        </span>
                      ) : (
                        <>
                          <Button size="sm" variant="secondary" onClick={() => handleRestore(originalIndex)}>
                            <RotateCcw className="size-3.5" /> Restore
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => handleCompare(originalIndex)}>
                            <Columns2 className="size-3.5" /> Compare
                          </Button>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
