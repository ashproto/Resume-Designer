import { useEffect, useReducer, useState } from 'react';
import { RotateCcw, Columns2, Check, FileText } from 'lucide-react';

import { Dialog, DialogContent, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import { store } from '../store.js';
import { diffResumeData } from '../diffEngine.js';
import { showDiffView } from '../diffView.js';

// Version-history panel, converted from historyPanel.js (Step 7 of the React
// migration) and then restyled (consistency fix) to reuse the original timeline
// design that already lives in styles/history.css. Like ProfileDialog and
// JobsDialog, it hosts bespoke `.history-panel-*` / `.history-*` markup inside a
// glass shadcn Dialog shell instead of rendering raw shadcn primitives + Tailwind
// utilities (which defaulted to the unstyled shadcn look). Opens on the
// `rd:open-history` window event (dispatched by main.js's window.openHistoryPanel
// shim, called from the header's Tools -> Version History menu). Restore/compare
// still go through the store + diffView exactly as before.

// CHANGE_TYPES value -> display label. The matching `.type-<value>` class in
// history.css colors the dot + badge; 'edit' has no rule there and falls back to
// the neutral base style.
const TYPE_LABELS = {
  initial: 'Created',
  edit: 'Edit',
  ai: 'AI Change',
  import: 'Import',
  reorder: 'Reordered',
  add: 'Added',
  remove: 'Removed',
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
      <DialogContent
        showCloseButton={false}
        className="flex max-h-[85vh] w-[90vw] max-w-[460px] flex-col gap-0 overflow-hidden p-0 glass-card"
      >
        <DialogTitle className="sr-only">Version History</DialogTitle>
        <DialogDescription className="sr-only">Resume change history with restore and compare</DialogDescription>

        <div className="history-panel-header shrink-0">
          <h2>Version History</h2>
          <button type="button" className="history-panel-close" title="Close" onClick={() => setOpen(false)}>
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        <div className="history-panel-content min-h-0">
          {rows.length === 0 ? (
            <div className="history-empty">
              <FileText size={40} />
              <p>No history yet</p>
              <span>Changes will appear here as you edit</span>
            </div>
          ) : (
            <div className="history-timeline">
              {rows.map(({ entry, originalIndex }, rowIdx) => {
                const isCurrent = originalIndex === currentIndex;
                const isLast = rowIdx === rows.length - 1;
                const typeClass = `type-${entry.changeType || 'edit'}`;
                const label = TYPE_LABELS[entry.changeType] || 'Edit';
                return (
                  <div key={originalIndex} className={cn('history-entry', isCurrent && 'current')}>
                    <div className="history-entry-marker">
                      <span className={cn('history-marker-dot', typeClass)} />
                      {!isLast && <span className="history-marker-line" />}
                    </div>
                    <div className="history-entry-content">
                      <div className="history-entry-header">
                        <span className={cn('history-entry-type', typeClass)}>{label}</span>
                        <span className="history-entry-time">{formatTime(entry.timestamp)}</span>
                      </div>
                      <p className="history-entry-description">{entry.description}</p>
                      <div className="history-entry-actions">
                        {isCurrent ? (
                          <span className="history-current-label">
                            <Check size={14} /> Current version
                          </span>
                        ) : (
                          <>
                            <button
                              type="button"
                              className="history-action-btn history-restore-btn"
                              onClick={() => handleRestore(originalIndex)}
                            >
                              <RotateCcw size={14} /> Restore
                            </button>
                            <button
                              type="button"
                              className="history-action-btn history-compare-btn"
                              onClick={() => handleCompare(originalIndex)}
                            >
                              <Columns2 size={14} /> Compare
                            </button>
                          </>
                        )}
                      </div>
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
