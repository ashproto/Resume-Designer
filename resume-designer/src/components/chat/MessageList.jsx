import { useRef, useEffect } from 'react';
import { cn } from '@/lib/utils';
import { Markdown } from './Markdown.jsx';

const REASONING_MAX = 300;

function ThinkingBlock({ thinking }) {
  const done = thinking.phase === 'done';
  return (
    <div className="chat-thinking-process">
      <div className="thinking-header">
        <div className={cn('thinking-indicator', done && 'complete')}>
          {done ? (
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="20 6 9 17 4 12" />
            </svg>
          ) : (
            <div className="thinking-spinner" />
          )}
          <span>{done ? 'Complete' : 'Processing...'}</span>
        </div>
      </div>
      <div className="thinking-steps">
        {thinking.steps.map((s, i) => (
          <div
            key={i}
            className={cn('thinking-step', s.complete ? 'complete' : (i === thinking.steps.length - 1 ? 'active' : ''))}
          >
            <div className="thinking-step-bullet">
              {s.complete ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
              ) : (
                <div className="thinking-step-dot" />
              )}
            </div>
            <span>{s.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function MessageBubble({ msg, onReviewChanges, onApply }) {
  if (msg.role === 'error') {
    return (
      <div className="chat-error">
        <strong>Error:</strong> {msg.content}
      </div>
    );
  }

  const isUser = msg.role === 'user';
  const reasoning = !isUser && msg.reasoning
    ? (msg.reasoning.length > REASONING_MAX ? `${msg.reasoning.slice(0, REASONING_MAX)}...` : msg.reasoning)
    : null;
  const hasActions = msg.applyData || msg.pendingChanges;

  return (
    <div className={cn('chat-message', isUser ? 'chat-message-user' : 'chat-message-assistant')}>
      <div className="chat-bubble">
        {reasoning && (
          <div className="chat-reasoning-summary">
            <div className="chat-reasoning-summary-header">
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="12" cy="12" r="10" />
                <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                <line x1="12" y1="17" x2="12.01" y2="17" />
              </svg>
              Reasoning
            </div>
            <div className="chat-reasoning-summary-content">{reasoning}</div>
          </div>
        )}

        <Markdown content={msg.content} />

        {hasActions && (
          <div className="chat-action-buttons">
            {msg.applyData && (
              <button
                className="chat-apply-btn"
                type="button"
                onClick={() => onApply(msg.applyData.action, msg.applyData.value)}
              >
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Apply to Resume
              </button>
            )}
            {msg.pendingChanges && (
              <button className="chat-review-changes-btn" type="button" onClick={() => onReviewChanges(msg.id)}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                  <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                </svg>
                Review Changes
              </button>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

function ApiKeyPrompt({ onConfigure }) {
  return (
    <div className="chat-api-prompt">
      <div className="chat-api-prompt-icon">
        <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0 1 10 0v4" />
        </svg>
      </div>
      <h3>Setup Required</h3>
      <p>To use the AI Assistant, add your OpenRouter API key.</p>
      <div className="chat-api-prompt-providers">
        <div className="provider-option">
          <strong>OpenRouter</strong>
          <span>One key for Claude, GPT, Gemini &amp; 300+ models</span>
        </div>
      </div>
      <button className="btn btn-primary chat-api-prompt-btn" type="button" onClick={onConfigure}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <circle cx="12" cy="12" r="3" />
          <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z" />
        </svg>
        Configure API Keys
      </button>
    </div>
  );
}

function Welcome() {
  return (
    <div className="chat-welcome">
      <div className="chat-welcome-icon">
        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
        </svg>
      </div>
      <h3>Welcome to AI Assistant</h3>
      <p>I can help you improve your resume. Try asking me to:</p>
      <ul>
        <li>Rewrite a bullet point to be more impactful</li>
        <li>Suggest improvements for your summary</li>
        <li>Generate new experience bullets</li>
        <li>Review your resume for feedback</li>
      </ul>
      <p className="chat-welcome-hint">Configure your API keys in settings to get started.</p>
    </div>
  );
}

/**
 * The scrolling message stream: API-key prompt when unconfigured, the welcome
 * card when empty, otherwise the message bubbles plus the live "thinking" block
 * while a request is in flight. Auto-scrolls to the bottom on any change.
 */
export function MessageList({ messages, thinking, configured, onReviewChanges, onApply, onConfigure }) {
  const scrollerRef = useRef(null);

  useEffect(() => {
    const el = scrollerRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, thinking]);

  return (
    <div className="chat-messages" id="chat-messages" ref={scrollerRef}>
      {!configured ? (
        <ApiKeyPrompt onConfigure={onConfigure} />
      ) : messages.length === 0 && !thinking ? (
        <Welcome />
      ) : (
        <>
          {messages.map((msg) => (
            <MessageBubble key={msg.id} msg={msg} onReviewChanges={onReviewChanges} onApply={onApply} />
          ))}
          {thinking && <ThinkingBlock thinking={thinking} />}
        </>
      )}
    </div>
  );
}
