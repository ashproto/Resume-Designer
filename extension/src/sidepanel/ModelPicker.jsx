import { useEffect, useId, useRef, useState } from 'react';

import './ModelPicker.css';

// Match the featured provider names/order used by the desktop catalog. The
// bridge sends { id, name }, so the canonical slug supplies the provider.
const FEATURED_PROVIDERS = new Map([
  ['anthropic', 'Anthropic'],
  ['openai', 'OpenAI'],
  ['google', 'Google'],
  ['x-ai', 'xAI'],
  ['deepseek', 'DeepSeek'],
  ['mistralai', 'Mistral'],
]);

function groupCatalog(models) {
  const groups = new Map();
  const featuredOrder = [...FEATURED_PROVIDERS.keys()];
  for (const model of models) {
    const providerId = model.id.split('/')[0];
    const prefix = (model.name || '').split(': ')[0];
    const normalize = (text) => text.toLowerCase().replace(/[^a-z0-9]/g, '');
    const label = FEATURED_PROVIDERS.get(providerId)
      || ((model.name || '').includes(': ') && normalize(prefix) === normalize(providerId) ? prefix : '')
      || providerId.split(/[-_]/).map((word) => word.charAt(0).toUpperCase() + word.slice(1)).join(' ');
    if (!groups.has(providerId)) groups.set(providerId, { id: providerId, label, models: [] });
    const name = model.name || model.id;
    groups.get(providerId).models.push({
      id: model.id,
      name: name.startsWith(`${label}: `) ? name.slice(label.length + 2) : name,
      detail: model.id,
      providerId,
      providerLabel: label,
    });
  }
  return [...groups.values()].sort((left, right) => {
    const rank = (id) => featuredOrder.includes(id) ? featuredOrder.indexOf(id) : featuredOrder.length;
    return rank(left.id) - rank(right.id) || left.label.localeCompare(right.label);
  });
}

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
  const [activeKey, setActiveKey] = useState('model:');
  const [expandedProviderId, setExpandedProviderId] = useState('');
  const [collapsedSearchProviders, setCollapsedSearchProviders] = useState([]);
  const [keyboardBrowsing, setKeyboardBrowsing] = useState(false);
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
  const catalogGroups = groupCatalog(catalog);
  const choices = [
    { id: '', name: 'Use app default', detail: defaultName || 'Your AI settings in On Paper' },
    ...(value && !selectedModel ? [{ id: value, name: value, detail: 'Saved selection · not in current catalog' }] : []),
    ...catalogGroups.flatMap((group) => group.models),
  ];
  const normalizedQuery = query.trim().toLowerCase();
  const matches = choices.filter((model) => `${model.name} ${model.detail} ${model.providerLabel || ''}`.toLowerCase().includes(normalizedQuery));
  const matchIds = new Set(matches.map((model) => model.id));
  const visibleGroups = catalogGroups.map((group) => ({
    ...group,
    models: group.models.filter((model) => matchIds.has(model.id)),
    expanded: normalizedQuery ? !collapsedSearchProviders.includes(group.id) : expandedProviderId === group.id,
  })).filter((group) => group.models.length);
  const rows = [
    ...matches.filter((model) => !model.providerId).map((model) => ({ ...model, key: `model:${model.id}` })),
    ...visibleGroups.flatMap((group) => [
      { ...group, key: `provider:${group.id}`, isProvider: true },
      ...(group.expanded ? group.models.map((model) => ({ ...model, key: `model:${model.id}` })) : []),
    ]),
  ];
  const activeRow = rows.find((row) => row.key === activeKey) || rows[0];
  const rowId = (key) => `${listId}-${encodeURIComponent(key)}`;
  const activeId = expanded && activeRow ? rowId(activeRow.key) : undefined;

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
    const node = activeId && document.getElementById(activeId);
    // Scroll the heading, not the parent treeitem's entire expanded subtree.
    (node?.querySelector('.model-picker__group-heading') || node)?.scrollIntoView?.({ block: 'nearest' });
  }, [activeId, query, expandedProviderId, collapsedSearchProviders]);

  function reveal() {
    if (unavailable || expanded) return;
    setQuery('');
    const effectiveModelId = value || defaultModelId;
    setExpandedProviderId(catalog.find((model) => model.id === effectiveModelId)?.id.split('/')[0] || '');
    setCollapsedSearchProviders([]);
    setActiveKey(`model:${value}`);
    setKeyboardBrowsing(false);
    setOpen(true);
  }

  function toggleProvider(group) {
    if (normalizedQuery) {
      setCollapsedSearchProviders((current) => group.expanded
        ? [...current, group.id]
        : current.filter((providerId) => providerId !== group.id));
    } else {
      setExpandedProviderId(group.expanded ? '' : group.id);
    }
    setActiveKey(`provider:${group.id}`);
    setKeyboardBrowsing(true);
  }

  function choose(model) {
    if (!model || unavailable) return;
    onChange(model.id);
    setOpen(false);
    inputRef.current?.focus();
  }

  function handleKeyDown(event) {
    if (unavailable || event.nativeEvent.isComposing) return;
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
      setKeyboardBrowsing(true);
      const direction = event.key === 'ArrowDown' ? 1 : -1;
      const index = rows.indexOf(activeRow);
      setActiveKey(rows[Math.max(0, Math.min(rows.length - 1, index + direction))]?.key || '');
      return;
    }
    // Preserve browser text editing until the user navigates the result tree.
    const treeNavigation = expanded && (!normalizedQuery || keyboardBrowsing)
      && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey;
    if (treeNavigation && (event.key === 'ArrowRight' || event.key === 'ArrowLeft')) {
      event.preventDefault();
      if (activeRow?.isProvider) {
        if (event.key === 'ArrowRight') {
          if (activeRow.expanded) setActiveKey(`model:${activeRow.models[0].id}`);
          else toggleProvider(activeRow);
        } else if (activeRow.expanded) toggleProvider(activeRow);
      } else if (event.key === 'ArrowLeft' && activeRow?.providerId) {
        setActiveKey(`provider:${activeRow.providerId}`);
      }
      return;
    }
    if (treeNavigation && (event.key === 'Home' || event.key === 'End')) {
      event.preventDefault();
      setActiveKey((event.key === 'Home' ? rows[0] : rows.at(-1))?.key || '');
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (expanded) {
        if (activeRow?.isProvider) toggleProvider(activeRow);
        else choose(activeRow);
      }
      else reveal();
    }
  }

  function renderOption(model) {
    const key = `model:${model.id}`;
    return (
      <button
        type="button"
        role="treeitem"
        id={rowId(key)}
        key={model.id}
        tabIndex={-1}
        aria-selected={model.id === value}
        className={`model-picker__option${key === activeRow?.key ? ' is-active' : ''}`}
        onMouseDown={(event) => event.preventDefault()}
        onPointerMove={() => setActiveKey(key)}
        onClick={() => choose(model)}
      >
        <span className="model-picker__option-copy">
          <strong>{model.name}</strong>
          <small>{model.detail}</small>
        </span>
        {model.id === value ? <span className="model-picker__check" aria-hidden="true">✓</span> : null}
      </button>
    );
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
          aria-haspopup="tree"
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
            const text = event.target.value;
            setQuery(text);
            setCollapsedSearchProviders([]);
            setKeyboardBrowsing(false);
            const firstMatch = choices.find((model) => `${model.name} ${model.detail} ${model.providerLabel || ''}`.toLowerCase().includes(text.trim().toLowerCase()));
            setActiveKey(`model:${firstMatch?.id || ''}`);
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
          <div className="model-picker__results" role="tree" id={listId} aria-label="AI models">
            {matches.filter((model) => !model.providerId).map(renderOption)}
            {visibleGroups.map((group) => (
              <div key={group.id} role="treeitem" id={rowId(`provider:${group.id}`)} aria-label={group.label} aria-expanded={group.expanded} tabIndex={-1} className="model-picker__group">
                <div
                  className={`model-picker__group-heading${activeRow?.key === `provider:${group.id}` ? ' is-active' : ''}`}
                  onMouseDown={(event) => event.preventDefault()}
                  onPointerMove={() => setActiveKey(`provider:${group.id}`)}
                  onClick={() => toggleProvider(group)}
                >
                  <svg className={`model-picker__provider-chevron${group.expanded ? ' is-expanded' : ''}`} width="14" height="14" viewBox="0 0 16 16" aria-hidden="true">
                    <path d="m6 4 4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <span className="model-picker__provider-name">{group.label}</span>
                  <span className="model-picker__group-count">{group.models.length}</span>
                </div>
                {group.expanded ? <div role="group" aria-label={group.label}>{group.models.map(renderOption)}</div> : null}
              </div>
            ))}
          </div>
          <p className="model-picker__result-count" role="status" aria-live="polite">
            {matches.length
              ? normalizedQuery
                ? `${matches.length} matching ${matches.length === 1 ? 'choice' : 'choices'}`
                : `${catalog.length} models · ${catalogGroups.length} providers`
              : 'No models match. Try a name or provider.'}
          </p>
        </div>
      ) : null}
    </div>
  );
}
