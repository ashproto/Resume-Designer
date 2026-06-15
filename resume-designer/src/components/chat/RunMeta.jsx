import { Brain, DollarSign, Globe, Cpu } from 'lucide-react';
import { formatTokenCount, formatCost } from '../../tokenTrackingService.js';
import { getModelLabel } from './useChat.js';

/**
 * Compact run-metadata line. `showCost` is true in chat, false in the JSON-flow
 * modals (per spec: token counts there, cost only in chat).
 */
export function RunMeta({ run, showCost = false, className = '' }) {
  if (!run) return null;
  return (
    <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground ${className}`}>
      <span className="inline-flex items-center gap-1"><Cpu className="size-3" />{getModelLabel(run.model)}</span>
      {run.reasoningTokens > 0 && (
        <span className="inline-flex items-center gap-1"><Brain className="size-3" />{formatTokenCount(run.reasoningTokens)} reasoning</span>
      )}
      <span>{formatTokenCount((run.promptTokens || 0) + (run.completionTokens || 0))} tokens</span>
      {showCost && run.cost > 0 && (
        <span className="inline-flex items-center gap-1"><DollarSign className="size-3" />{formatCost(run.cost)}</span>
      )}
      {run.webSearch && <span className="inline-flex items-center gap-1"><Globe className="size-3" />web</span>}
    </div>
  );
}
