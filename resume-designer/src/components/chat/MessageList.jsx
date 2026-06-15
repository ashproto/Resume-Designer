import { useRef, useEffect } from 'react';
import { Check, KeyRound, Loader2, MessageCircle, Pencil, Settings2, Square } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { Markdown } from './Markdown.jsx';
import { LiveReasoning } from './LiveReasoning.jsx';
import { Citations } from './Citations.jsx';
import { RunMeta } from './RunMeta.jsx';

// Synthetic "thinking" block — still used by the NON-streamed flows (/feedback,
// /improve, /generate, profile interview) which show scripted steps rather than a
// token stream. The streamed flows (chat reply, change-requests) use
// <StreamingBubble> instead. Mockup `.think`: bordered card, spinner, pulsing
// primary dots, green check steps.
function ThinkingBlock({ thinking }) {
  const done = thinking.phase === 'done';
  return (
    <div className="w-[92%] self-start rounded-xl border bg-background px-3 py-2.5">
      <div className="flex items-center gap-2 text-[13px] font-semibold">
        {done ? (
          <Check className="size-3.5 text-success" />
        ) : (
          <Loader2 className="size-3.5 animate-spin text-primary" />
        )}
        <span>{done ? 'Complete' : 'Processing…'}</span>
      </div>
      {thinking.steps.length > 0 && (
        <div className="mt-2 space-y-1">
          {thinking.steps.map((s, i) => {
            const active = !s.complete && i === thinking.steps.length - 1;
            return (
              <div key={i} className="flex items-center gap-2 py-0.5 text-xs text-muted-foreground">
                <span className="flex size-3.5 shrink-0 items-center justify-center">
                  {s.complete ? (
                    <Check className="size-3 text-success" />
                  ) : (
                    <span
                      className={cn(
                        'size-1.5 rounded-full',
                        active ? 'animate-pulse bg-primary' : 'bg-muted-foreground/40'
                      )}
                    />
                  )}
                </span>
                <span>{s.text}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// Live streaming assistant turn: real reasoning streams into the LiveReasoning
// panel, the answer streams below it, and Stop aborts the run mid-stream.
function StreamingBubble({ msg, onStop }) {
  return (
    <div className="w-[92%] max-w-[92%] self-start space-y-2 rounded-[14px_14px_14px_4px] border bg-background px-3 py-2.5">
      <LiveReasoning reasoning={msg.reasoning} reasoningTokens={msg.run?.reasoningTokens || 0} streaming defaultOpen />
      {msg.content ? (
        <div className="text-[13.5px] leading-relaxed">
          <Markdown content={msg.content} />
        </div>
      ) : null}
      <Button variant="outline" size="sm" className="h-6 gap-1 text-[11px]" onClick={onStop}>
        <Square className="size-3" /> Stop
      </Button>
    </div>
  );
}

function MessageBubble({ msg, onReviewChanges, onApply }) {
  if (msg.role === 'error') {
    return (
      <div className="w-fit max-w-[85%] rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
        <span className="font-semibold">Error:</span> {msg.content}
      </div>
    );
  }

  const isUser = msg.role === 'user';
  const hasActions = msg.applyData || msg.pendingChanges;

  return (
    <div
      className={cn(
        'w-fit px-3 py-2.5 text-[13.5px] leading-relaxed',
        isUser
          ? 'ml-auto max-w-[85%] rounded-[14px_14px_4px_14px] bg-primary text-primary-foreground'
          : 'max-w-[92%] rounded-[14px_14px_14px_4px] border bg-background'
      )}
    >
      {!isUser && <LiveReasoning reasoning={msg.reasoning} reasoningTokens={msg.run?.reasoningTokens || 0} />}

      <Markdown content={msg.content} />

      {!isUser && <Citations annotations={msg.annotations} />}

      {!isUser && msg.run && <RunMeta run={msg.run} showCost className="mt-2 border-t pt-2" />}

      {hasActions && (
        <div className="mt-2.5 flex flex-wrap gap-2 border-t pt-2.5">
          {msg.applyData && (
            <Button
              size="sm"
              className="h-7 text-xs"
              onClick={() => onApply(msg.applyData.action, msg.applyData.value)}
            >
              <Check className="size-3.5" />
              Apply to Resume
            </Button>
          )}
          {msg.pendingChanges && (
            <Button
              variant="outline"
              size="sm"
              className="h-7 text-xs"
              onClick={() => onReviewChanges(msg.id)}
            >
              <Pencil className="size-3.5" />
              Review Changes
            </Button>
          )}
        </div>
      )}
    </div>
  );
}

function ApiKeyPrompt({ onConfigure }) {
  return (
    <div className="my-auto flex flex-col items-center gap-1 px-6 py-14 text-center">
      <KeyRound className="mb-3 size-10 text-muted-foreground/40" />
      <p className="text-sm font-medium">Setup Required</p>
      <p className="text-sm text-muted-foreground">
        To use the AI Assistant, add your OpenRouter API key — one key for Claude, GPT, Gemini &amp; 300+ models.
      </p>
      <Button className="mt-4" onClick={onConfigure}>
        <Settings2 className="size-4" />
        Configure API Keys
      </Button>
    </div>
  );
}

function Welcome() {
  return (
    <div className="my-auto flex flex-col items-center gap-1 px-6 py-14 text-center">
      <MessageCircle className="mb-3 size-10 text-muted-foreground/40" />
      <p className="text-sm font-medium">Welcome to AI Assistant</p>
      <p className="text-sm text-muted-foreground">I can help you improve your resume. Try asking me to:</p>
      <ul className="mt-2 space-y-1 text-sm text-muted-foreground">
        <li>Rewrite a bullet point to be more impactful</li>
        <li>Suggest improvements for your summary</li>
        <li>Generate new experience bullets</li>
        <li>Review your resume for feedback</li>
      </ul>
    </div>
  );
}

/**
 * The scrolling message stream: API-key prompt when unconfigured, the welcome
 * card when empty, otherwise the message bubbles plus — while a request is in
 * flight — either the live <StreamingBubble> (streamed flows) or the synthetic
 * <ThinkingBlock> (helper flows). Auto-scrolls to the bottom on any change.
 */
export function MessageList({
  messages, thinking, streamingMessage, configured,
  onReviewChanges, onApply, onConfigure, onStop,
}) {
  const scrollerRef = useRef(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking, streamingMessage]);

  return (
    <div id="chat-messages" ref={scrollerRef} className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto bg-muted/40 p-4">
      {!configured ? (
        <ApiKeyPrompt onConfigure={onConfigure} />
      ) : messages.length === 0 && !thinking && !streamingMessage ? (
        <Welcome />
      ) : (
        <>
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} onReviewChanges={onReviewChanges} onApply={onApply} />
          ))}
          {streamingMessage && <StreamingBubble msg={streamingMessage} onStop={onStop} />}
          {thinking && <ThinkingBlock thinking={thinking} />}
        </>
      )}
    </div>
  );
}
