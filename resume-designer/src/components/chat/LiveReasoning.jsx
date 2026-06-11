import { useState } from 'react';
import { Brain, ChevronRight, Loader2, Check } from 'lucide-react';
import { cn } from '@/lib/utils';
import { formatTokenCount } from '../../tokenTrackingService.js';

/**
 * Reasoning panel used by chat AND the JSON-flow modals. While `streaming`, shows
 * a spinner + the live reasoning text. When done, collapses to a "Reasoning"
 * disclosure (full text, no 300-char clip). Encrypted/empty reasoning degrades to
 * a token-count line with no body.
 */
export function LiveReasoning({ reasoning, reasoningTokens = 0, streaming = false, defaultOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  const hasText = typeof reasoning === 'string' && reasoning.trim().length > 0;

  if (streaming) {
    return (
      <div className="rounded-lg border bg-accent/40 px-3 py-2">
        <div className="flex items-center gap-2 text-[12px] font-semibold">
          <Loader2 className="size-3.5 animate-spin text-primary" />
          <span>Thinking{reasoningTokens > 0 ? ` · ${formatTokenCount(reasoningTokens)} tokens` : '…'}</span>
        </div>
        {hasText && (
          <div className="mt-1.5 max-h-40 overflow-y-auto whitespace-pre-wrap text-[11.5px] leading-relaxed text-muted-foreground">
            {reasoning}
          </div>
        )}
      </div>
    );
  }

  if (!hasText) {
    if (reasoningTokens <= 0) return null;
    return (
      <div className="mb-2 inline-flex items-center gap-1.5 rounded-md bg-accent px-2 py-1 text-[11px] text-muted-foreground">
        <Brain className="size-3" /> Reasoning hidden by provider · {formatTokenCount(reasoningTokens)} tokens
      </div>
    );
  }

  return (
    <div className="mb-2 overflow-hidden rounded-md border-l-[3px] border-primary bg-accent">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-1.5 px-2 py-1.5 text-left text-[11px] font-semibold text-foreground"
      >
        <ChevronRight className={cn('size-3 transition-transform', open && 'rotate-90')} />
        <Brain className="size-3" /> Reasoning
        {reasoningTokens > 0 && <span className="font-normal text-muted-foreground">· {formatTokenCount(reasoningTokens)} tokens</span>}
        {!open && <Check className="ml-auto size-3 text-success" />}
      </button>
      {open && (
        <div className="max-h-72 overflow-y-auto whitespace-pre-wrap px-2 pb-2 text-[11.5px] leading-relaxed text-muted-foreground">
          {reasoning}
        </div>
      )}
    </div>
  );
}
