import { useEffect, useId, useRef, useState } from 'react';

import './ModelPicker.css';

export default function ModelPicker({
  models = [],
  value = '',
  defaultModelId = '',
  defaultModelName = '',
  onChange,
  disabled = false,
  loading = false,
  error = '',
  id = 'ai-model',
}) {
  const uniqueId = useId();
  const listId = `${uniqueId}-models`;
  const statusId = `${uniqueId}-status`;
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const unavailable = disabled || loading;
  const expanded = open && !unavailable;
  const catalog = models.filter((model) => model?.id);
  const selectedModel = catalog.find((model) => model.id === value);
  const defaultName = defaultModelName
    || catalog.find((model) => model.id === defaultModelId)?.name
    || defaultModelId;
  const selectedLabel = value
    ? selectedModel?.name || value
    : defaultName ? `App default · ${defaultName}` : 'Use app default';
  const choices = [
    { id: '', name: 'Use app default', detail: defaultName || 'Your AI settings in On Paper' },
    ...(value && !selectedModel ? [{ id: value, name: value, detail: 'Saved selection · not in current catalog' }] : []),
    ...catalog.map((model) => ({ id: model.id, name: model.name || model.id, detail: model.id })),
  ];
  const normalizedQuery = query.trim().toLowerCase();
  const matches = choices.filter((model) => `${model.name} ${model.detail}`.toLowerCase().includes(normalizedQuery));
  const activeChoice = matches[activeIndex];
  const activeId = expanded && activeChoice ? `${listId}-${activeIndex}` : undefined;

  useEffect(() => {
    if (unavailable) setOpen(false);
  }, [unavailable]);

  useEffect(() => {
    if (!expanded) return undefined;
    function handleOutsidePointer(event) {
      if (!rootRef.current?.contains(event.target)) setOpen(false);
    }
    document.addEventListener('pointerdown', handleOutsidePointer);
    return () => document.removeEventListener('pointerdown', handleOutsidePointer);
  }, [expanded]);

  useEffect(() => {
    if (activeId) document.getElementById(activeId)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId]);

  function reveal() {
    if (unavailable || expanded) return;
    setQuery('');
    setActiveIndex(Math.max(0, choices.findIndex((model) => model.id === value)));
    setOpen(true);
  }

  function choose(model) {
    if (!model || unavailable) return;
    onChange(model.id);
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(event) {
    if (unavailable) return;
    if (event.key === 'Escape') {
      if (expanded) event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === 'Tab') {
      setOpen(false);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      if (!expanded) {
        reveal();
        return;
      }
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      setActiveIndex((current) => matches.length
        ? (current + direction + matches.length) % matches.length
        : 0);
      return;
    }
    if (expanded && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault();
      setActiveIndex(event.key === 'Home' ? 0 : Math.max(0, matches.length - 1));
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (expanded) choose(activeChoice);
      else reveal();
    }
  }

  return (
    <div
      className="model-picker"
      ref={rootRef}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
    >
      <div className={`model-picker__control${expanded ? ' is-open' : ''}`}>
        <input
          id={id}
          ref={inputRef}
          role="combobox"
          aria-label="AI model"
          aria-expanded={expanded}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={activeId}
          aria-busy={loading}
          aria-describedby={loading || error ? statusId : undefined}
          autoComplete="off"
          spellCheck={false}
          placeholder={expanded ? 'Search models…' : 'Use app default'}
          value={expanded ? query : selectedLabel}
          disabled={unavailable}
          onFocus={reveal}
          onClick={reveal}
          onKeyDown={handleKeyDown}
          onChange={(event) => {
            setQuery(event.target.value);
            setActiveIndex(0);
            setOpen(true);
          }}
        />
        <button
          type="button"
          className="model-picker__toggle"
          aria-label={expanded ? 'Close model choices' : 'Show model choices'}
          tabIndex={-1}
          disabled={unavailable}
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            if (expanded) setOpen(false);
            else {
              inputRef.current?.focus();
              reveal();
            }
          }}
        >
          <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden="true">
            <path d="m4 6 4 4 4-4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </div>
      {loading || error ? (
        <p className="model-picker__status" id={statusId} role="status">
          {loading ? 'Loading models…' : 'Models unavailable. Your selection is kept.'}
        </p>
      ) : null}
      {expanded ? (
        <div className="model-picker__popover">
          <div className="model-picker__results" role="listbox" id={listId} aria-label="AI models">
            {matches.map((model, index) => (
              <button
                type="button"
                role="option"
                id={`${listId}-${index}`}
                key={model.id}
                tabIndex={-1}
                aria-selected={model.id === value}
                className={`model-picker__option${index === activeIndex ? ' is-active' : ''}`}
                onMouseDown={(event) => event.preventDefault()}
                onPointerMove={() => setActiveIndex(index)}
                onClick={() => choose(model)}
              >
                <span className="model-picker__option-copy">
                  <strong>{model.name}</strong>
                  <small>{model.detail}</small>
                </span>
                {model.id === value ? <span className="model-picker__check" aria-hidden="true">✓</span> : null}
              </button>
            ))}
          </div>
          <p className="model-picker__result-count" role="status" aria-live="polite">
            {matches.length
              ? `${matches.length} ${matches.length === 1 ? 'choice' : 'choices'}`
              : 'No models match. Try a name or provider.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}
