import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { getThreadDisplayName } from '../../chatThreads.js';

/**
 * Chat-thread switcher. A controlled shadcn Popover (not DropdownMenu) so that
 * deleting a thread re-renders the list in place without the menu auto-closing,
 * matching the old behavior. Content is wrapped in `.thread-selector` so the
 * existing menu styles apply after Radix portals it to <body>.
 */
export function ThreadSelector({ threads, currentThreadId, onSwitch, onNew, onDelete }) {
  const [open, setOpen] = useState(false);
  const current = threads.find((t) => t.id === currentThreadId);

  // Single-thread deletion asks for confirmation (you can't be left with none
  // unintentionally); with multiple threads it's a one-click delete.
  const handleDelete = (id) => {
    if (threads.length > 1 || window.confirm('Delete this chat thread?')) onDelete(id);
  };

  return (
    <div className="thread-selector">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="thread-selector-trigger" type="button">
            <span className="thread-name">{getThreadDisplayName(current)}</span>
            <svg className="thread-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-[260px] max-h-[320px] overflow-hidden p-0 flex flex-col">
          <div className="thread-selector flex flex-col min-h-0">
            <div className="thread-menu-header">
              <span>Chat Threads</span>
              <button
                className="thread-new-btn"
                type="button"
                title="Start new chat"
                onClick={() => { onNew(); setOpen(false); }}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <line x1="12" y1="5" x2="12" y2="19" />
                  <line x1="5" y1="12" x2="19" y2="12" />
                </svg>
              </button>
            </div>
            <div className="thread-list">
              {threads.map((t) => (
                <div
                  key={t.id}
                  className={cn('thread-item', t.id === currentThreadId && 'active')}
                  onClick={() => { onSwitch(t.id); setOpen(false); }}
                >
                  <span className="thread-item-name">{getThreadDisplayName(t)}</span>
                  <button
                    className="thread-delete-btn"
                    type="button"
                    title="Delete thread"
                    onClick={(e) => { e.stopPropagation(); handleDelete(t.id); }}
                  >
                    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <line x1="18" y1="6" x2="6" y2="18" />
                      <line x1="6" y1="6" x2="18" y2="18" />
                    </svg>
                  </button>
                </div>
              ))}
            </div>
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
