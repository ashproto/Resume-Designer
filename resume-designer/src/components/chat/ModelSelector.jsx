import { useState } from 'react';
import { cn } from '@/lib/utils';
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover';
import { AI_MODELS, getModelLabel } from './useChat.js';

function CheckIcon() {
  return (
    <svg className="check-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <polyline points="20 6 9 17 4 12" />
    </svg>
  );
}

/**
 * Model picker — curated groups + the user's cached custom slugs (removable) +
 * a free-type custom-slug field. A shadcn Popover (controlled) replaces the old
 * bespoke .custom-dropdown + menuPortal: Radix portals the content to <body>, so
 * the glass blur escapes the frosted panel for free. The content is wrapped in
 * `.chat-model-selector` so the panel-scoped option styles still apply.
 */
export function ModelSelector({
  currentModel, configured, customModels,
  onSelect, onApplyCustomSlug, onRemoveCustom, onConfigure,
}) {
  const [open, setOpen] = useState(false);
  const [slug, setSlug] = useState('');
  const [invalid, setInvalid] = useState(false);

  const pick = (value) => { onSelect(value); setOpen(false); };

  const applySlug = () => {
    if (onApplyCustomSlug(slug)) {
      setSlug('');
      setInvalid(false);
      setOpen(false);
    } else {
      setInvalid(true);
    }
  };

  return (
    <div className="chat-model-selector">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <button className="custom-dropdown-trigger" type="button">
            <span className="dropdown-label">{getModelLabel(currentModel)}</span>
            <svg className="dropdown-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="6 9 12 15 18 9" />
            </svg>
          </button>
        </PopoverTrigger>
        <PopoverContent align="start" sideOffset={6} className="w-[280px] max-h-[340px] overflow-y-auto p-0">
          <div className="chat-model-selector">
            {configured ? (
              <>
                {AI_MODELS.map((group) => (
                  <div key={group.group}>
                    <div className="custom-dropdown-group-label">{group.group}</div>
                    {group.options.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        className={cn('custom-dropdown-option', opt.value === currentModel && 'selected')}
                        onClick={() => pick(opt.value)}
                      >
                        <CheckIcon />
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ))}

                {customModels.length > 0 && (
                  <div>
                    <div className="custom-dropdown-group-label">Custom</div>
                    {customModels.map((s) => (
                      <button
                        key={s}
                        type="button"
                        className={cn('custom-dropdown-option custom-model-option', s === currentModel && 'selected')}
                        onClick={() => pick(s)}
                      >
                        <CheckIcon />
                        <span className="custom-model-label">{getModelLabel(s)}</span>
                        <span
                          className="custom-model-remove"
                          role="button"
                          aria-label="Remove"
                          title="Remove from list"
                          onClick={(e) => { e.stopPropagation(); onRemoveCustom(s); }}
                        >
                          ×
                        </span>
                      </button>
                    ))}
                  </div>
                )}

                <div className="custom-dropdown-divider" />
                <div className="custom-dropdown-custom">
                  <input
                    type="text"
                    className={cn('custom-model-input', invalid && 'invalid')}
                    placeholder="Custom slug, e.g. anthropic/claude-opus-4.8"
                    title={invalid ? 'Enter a valid OpenRouter slug, e.g. anthropic/claude-opus-4.8' : undefined}
                    value={slug}
                    onChange={(e) => { setSlug(e.target.value); setInvalid(false); }}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); applySlug(); } }}
                  />
                  <button type="button" className="custom-model-apply" onClick={applySlug}>Use</button>
                </div>
              </>
            ) : (
              <div className="custom-dropdown-notice">
                <span className="notice-text">OpenRouter API key not configured</span>
                <button
                  type="button"
                  className="notice-configure-btn"
                  onClick={() => { setOpen(false); onConfigure(); }}
                >
                  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <circle cx="12" cy="12" r="3" />
                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
                  </svg>
                  Configure
                </button>
              </div>
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
