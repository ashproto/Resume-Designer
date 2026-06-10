import { ChevronDown, Check, Pencil, Trash2 } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

// Job-description card — a genuine shadcn Card (rounded-lg border bg-card),
// ported from renderJobDescriptionCard in jobDescriptionPanel.js. Pure leaf
// component: every mutation routes through the callback props from JobsDialog.
// The active job gets a tinted primary border + an "Active" Badge; inactive jobs
// expose a quiet ghost "Activate" text button. A chevron toggles the collapsed
// state (preview + Added-date show only when expanded).

function formatDate(dateString) {
  const date = new Date(dateString);
  const now = new Date();
  const diff = now - date;
  if (diff < 86400000) return 'today';
  if (diff < 172800000) return 'yesterday';
  return date.toLocaleDateString();
}

export function JobCard({ jd, collapsed, onToggleCollapse, onToggleActive, onEdit, onDelete }) {
  const preview =
    jd.description.length > 150 ? jd.description.substring(0, 150) + '...' : jd.description;

  return (
    <div
      data-id={jd.id}
      className={cn(
        'rounded-[10px] border bg-card transition-colors',
        jd.isActive && 'border-primary/50 bg-primary/[0.025]',
      )}
    >
      <div className="flex items-center gap-2.5 px-3 py-2.5">
        <button
          type="button"
          aria-label={collapsed ? 'Expand' : 'Collapse'}
          title={collapsed ? 'Expand' : 'Collapse'}
          onClick={onToggleCollapse}
          className="rounded-sm text-muted-foreground transition-colors hover:text-foreground focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-2"
        >
          <ChevronDown className={cn('h-4 w-4 transition-transform', collapsed && '-rotate-90')} />
        </button>

        <div className="min-w-0 flex-1">
          <h4 className="truncate text-[13.5px] font-semibold leading-tight">{jd.title}</h4>
          <span className="truncate text-xs text-muted-foreground">{jd.company}</span>
        </div>

        <div className="flex shrink-0 items-center gap-1">
          {jd.isActive ? (
            <button type="button" title="Deactivate" aria-label="Deactivate" onClick={onToggleActive}>
              <Badge className="gap-1 bg-success-bg text-success transition-opacity hover:opacity-80">
                <Check className="h-3 w-3" /> Active
              </Badge>
            </button>
          ) : (
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-xs text-muted-foreground"
              title="Activate"
              onClick={onToggleActive}
            >
              Activate
            </Button>
          )}
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground"
            title="Edit"
            aria-label="Edit"
            onClick={onEdit}
          >
            <Pencil className="h-4 w-4" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 text-muted-foreground hover:text-destructive"
            title="Delete"
            aria-label="Delete"
            onClick={onDelete}
          >
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {!collapsed && (
        <div className="space-y-2 pb-2.5 pl-[35px] pr-3">
          <p className="text-[12.5px] leading-relaxed text-muted-foreground">{preview}</p>
          <span className="text-[11.5px] text-muted-foreground/80">Added {formatDate(jd.dateAdded)}</span>
        </div>
      )}
    </div>
  );
}
