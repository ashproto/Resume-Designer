import { AlertTriangle } from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { cn } from '@/lib/utils';

// Severity → badge treatment, matching the status-tinted Badge idiom used by
// AnalysisResults.jsx for keyword gaps.
const SEVERITY_STYLES = {
  high: 'bg-destructive/10 text-destructive',
  medium: 'bg-warning-bg text-warning',
  low: 'bg-muted text-muted-foreground',
};

/**
 * What the target job asks for that the profile does not support. Shown after
 * generation so a thin resume reads as an actionable gap rather than a
 * disappointment — the assistant is no longer allowed to close these by
 * inventing experience.
 */
export function GapReport({ gaps }) {
  if (!gaps || gaps.length === 0) return null;

  return (
    <div className="space-y-2.5 rounded-[12px] border bg-muted/30 p-[14px]">
      <div className="flex items-center gap-2">
        <AlertTriangle className="size-4 shrink-0 text-warning" />
        <h4 className="text-[13px] font-semibold">Details to clarify</h4>
      </div>
      <p className="text-[12px] text-muted-foreground">
        These job requirements weren’t supported by the source material used for this draft.
        Correct an assumption or add missing context if they apply to you.
      </p>
      <ul className="space-y-2">
        {gaps.map((gap, i) => (
          <li key={i} className="flex items-start gap-2">
            <Badge className={cn('shrink-0 capitalize', SEVERITY_STYLES[gap.severity] || SEVERITY_STYLES.low)}>
              {gap.severity || 'low'}
            </Badge>
            <span className="min-w-0 text-[12.5px]">
              <span className="font-medium">{gap.requirement}</span>
              {gap.note && <span className="text-muted-foreground"> — {gap.note}</span>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
