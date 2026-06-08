import { useRef, useState } from 'react';
import { cn } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { ModelSelector } from './ModelSelector.jsx';

const SLASH_COMMANDS = [
  { command: '/feedback', description: 'Get detailed resume feedback', icon: 'message-circle' },
  { command: '/improve', description: 'Improve a section (e.g., /improve summary)', icon: 'edit' },
  { command: '/generate', description: 'Generate bullet points from context', icon: 'zap' },
  { command: '/profile', description: 'Start AI interview to fill your profile', icon: 'user' },
  { command: '/done', description: 'Finish profile interview and save', icon: 'check' },
  { command: '/debug', description: 'Show current profile status', icon: 'help-circle' },
  { command: '/clear', description: 'Clear chat history', icon: 'trash' },
  { command: '/help', description: 'Show available commands', icon: 'help-circle' },
];

const COMMANDS_NEEDING_ARGS = ['/improve', '/generate'];

const REASONING_OPTIONS = [
  { level: 'none', label: 'Off', desc: 'Fastest responses' },
  { level: 'low', label: 'Low', desc: 'Quick thinking' },
  { level: 'medium', label: 'Medium', desc: 'Balanced' },
  { level: 'high', label: 'High', desc: 'Deep analysis' },
];

const reasoningLabel = (v) => ({ none: 'Off', low: 'Low', medium: 'Medium', high: 'High' }[v] || 'Medium');

function CommandIcon({ name }) {
  switch (name) {
    case 'message-circle':
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" /></svg>;
    case 'edit':
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" /><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" /></svg>;
    case 'zap':
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" /></svg>;
    case 'user':
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" /><circle cx="12" cy="7" r="4" /></svg>;
    case 'check':
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="20 6 9 17 4 12" /></svg>;
    case 'trash':
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="3 6 5 6 21 6" /><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" /></svg>;
    default:
      return <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><circle cx="12" cy="12" r="10" /><path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" /><line x1="12" y1="17" x2="12.01" y2="17" /></svg>;
  }
}

function ChipIcon({ type }) {
  switch (type) {
    case 'section':
      return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="2" /><line x1="3" y1="9" x2="21" y2="9" /></svg>;
    case 'experience':
      return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="7" width="20" height="14" rx="2" /><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16" /></svg>;
    case 'bullet':
      return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><line x1="8" y1="6" x2="21" y2="6" /><line x1="8" y1="12" x2="21" y2="12" /><line x1="8" y1="18" x2="21" y2="18" /><circle cx="4" cy="6" r="1" fill="currentColor" /><circle cx="4" cy="12" r="1" fill="currentColor" /><circle cx="4" cy="18" r="1" fill="currentColor" /></svg>;
    default:
      return <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /></svg>;
  }
}

/**
 * The composer: context chips, quick-action shortcuts, slash-command
 * autocomplete, the auto-growing textarea, and the controls bar (model picker,
 * web-search toggle, reasoning-effort menu). The textarea is uncontrolled (a
 * ref) so typing never round-trips through React state — fast and caret-safe.
 */
export function ChatComposer({
  contextChips, onRemoveChip, onClearChips, onSend,
  currentModel, configured, customModels,
  onSelectModel, onApplyCustomSlug, onRemoveCustom, onConfigure,
  reasoningEffort, reasoningSupported, onSetReasoning,
  webSearchEnabled, onToggleWebSearch,
}) {
  const inputRef = useRef(null);
  const [slashItems, setSlashItems] = useState(null);
  const [slashIndex, setSlashIndex] = useState(0);
  const [reasoningOpen, setReasoningOpen] = useState(false);

  const autoResize = () => {
    const ta = inputRef.current;
    if (!ta) return;
    ta.style.height = 'auto';
    ta.style.height = `${Math.min(ta.scrollHeight, 200)}px`;
  };

  const submit = () => {
    const ta = inputRef.current;
    const text = ta?.value.trim();
    if (!text) return;
    onSend(text);
    if (ta) { ta.value = ''; ta.style.height = 'auto'; }
    setSlashItems(null);
  };

  // Fill the input with a slash command. autoSend (keyboard pick) fires it
  // immediately for argument-free commands; arg commands get a trailing space.
  const fillSlash = (command, autoSend) => {
    const ta = inputRef.current;
    const needsArgs = COMMANDS_NEEDING_ARGS.includes(command);
    if (ta) {
      ta.value = command + (needsArgs || !autoSend ? ' ' : '');
      ta.focus();
      autoResize();
    }
    setSlashItems(null);
    if (autoSend && !needsArgs) setTimeout(submit, 10);
  };

  const handleInput = () => {
    autoResize();
    const value = inputRef.current?.value || '';
    if (value.startsWith('/')) {
      const query = value.slice(1).toLowerCase();
      const filtered = SLASH_COMMANDS.filter(
        (c) => c.command.slice(1).toLowerCase().includes(query) || c.description.toLowerCase().includes(query)
      );
      if (filtered.length) { setSlashItems(filtered); setSlashIndex(0); } else { setSlashItems(null); }
    } else {
      setSlashItems(null);
    }
  };

  const handleKeyDown = (e) => {
    if (slashItems) {
      if (e.key === 'ArrowDown') { e.preventDefault(); setSlashIndex((i) => (i + 1) % slashItems.length); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setSlashIndex((i) => (i - 1 + slashItems.length) % slashItems.length); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); fillSlash(slashItems[slashIndex].command, true); return; }
      if (e.key === 'Escape') { e.preventDefault(); setSlashItems(null); return; }
    }
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); }
  };

  return (
    <div className="chat-input-area">
      {contextChips.length > 0 && (
        <div className="context-chips has-chips">
          <div className="context-chips-header">
            <span className="context-chips-label">Context:</span>
            <button className="context-chips-clear" type="button" onClick={onClearChips}>Clear all</button>
          </div>
          <div className="context-chips-list">
            {contextChips.map((chip, i) => (
              <div className="context-chip" key={i}>
                <span className="context-chip-icon"><ChipIcon type={chip.type} /></span>
                <span className="context-chip-label">{chip.label}</span>
                <button className="context-chip-remove" type="button" title="Remove" onClick={() => onRemoveChip(i)}>×</button>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="chat-shortcuts">
        <button className="chat-shortcut" type="button" onClick={() => onSend('/feedback')}>Get Feedback</button>
        <button className="chat-shortcut" type="button" onClick={() => onSend('/improve summary')}>Improve Summary</button>
      </div>

      {slashItems && (
        <div className="slash-commands-popup show">
          <div className="slash-commands-header">Commands</div>
          <div className="slash-commands-list">
            {slashItems.map((cmd, i) => (
              <button
                key={cmd.command}
                type="button"
                className={cn('slash-command-item', i === slashIndex && 'selected')}
                onMouseEnter={() => setSlashIndex(i)}
                onClick={() => fillSlash(cmd.command, false)}
              >
                <div className="slash-command-icon"><CommandIcon name={cmd.icon} /></div>
                <div className="slash-command-info">
                  <span className="slash-command-name">{cmd.command}</span>
                  <span className="slash-command-desc">{cmd.description}</span>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="chat-input-wrapper">
        <textarea
          id="chat-input"
          className="chat-input"
          placeholder="Ask anything..."
          rows="1"
          ref={inputRef}
          onInput={handleInput}
          onKeyDown={handleKeyDown}
        />
        <button className="chat-send-btn" type="button" title="Send message" onClick={submit}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <line x1="22" y1="2" x2="11" y2="13" />
            <polygon points="22 2 15 22 11 13 2 9 22 2" />
          </svg>
        </button>
      </div>

      <div className="chat-input-controls">
        <ModelSelector
          currentModel={currentModel}
          configured={configured}
          customModels={customModels}
          onSelect={onSelectModel}
          onApplyCustomSlug={onApplyCustomSlug}
          onRemoveCustom={onRemoveCustom}
          onConfigure={onConfigure}
        />

        <div className="chat-options-divider" />

        <button
          className={cn('chat-option-btn', webSearchEnabled && 'active')}
          type="button"
          title={webSearchEnabled ? 'Web search enabled' : 'Enable web search'}
          onClick={onToggleWebSearch}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10" />
            <line x1="2" y1="12" x2="22" y2="12" />
            <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
          </svg>
        </button>

        <div className="chat-reasoning-dropdown">
          <Popover open={reasoningOpen && reasoningSupported} onOpenChange={setReasoningOpen}>
            <PopoverTrigger asChild>
              <button
                className={cn('chat-option-btn reasoning-btn', !reasoningSupported && 'disabled')}
                type="button"
                disabled={!reasoningSupported}
                title={reasoningSupported ? 'Reasoning effort' : 'Reasoning not available for this model'}
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
                  <line x1="12" y1="17" x2="12.01" y2="17" />
                </svg>
                <span className="reasoning-label">{reasoningSupported ? reasoningLabel(reasoningEffort) : 'N/A'}</span>
                <svg className="reasoning-chevron" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <polyline points="6 9 12 15 18 9" />
                </svg>
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" sideOffset={8} className="w-[200px] p-1">
              <div className="chat-reasoning-header">Reasoning Effort</div>
              {REASONING_OPTIONS.map((o) => (
                <button
                  key={o.level}
                  type="button"
                  className={cn('chat-reasoning-option', o.level === reasoningEffort && 'selected')}
                  onClick={() => { onSetReasoning(o.level); setReasoningOpen(false); }}
                >
                  <span className="option-label">{o.label}</span>
                  <span className="option-desc">{o.desc}</span>
                </button>
              ))}
            </PopoverContent>
          </Popover>
        </div>
      </div>
    </div>
  );
}
