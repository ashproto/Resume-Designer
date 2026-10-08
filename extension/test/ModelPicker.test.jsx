/* @vitest-environment jsdom */

import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import ModelPicker from '../src/sidepanel/ModelPicker.jsx';

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const models = [
  { id: 'openai/gpt-5', name: 'GPT-5' },
  { id: 'anthropic/claude-sonnet', name: 'Claude Sonnet' },
  { id: 'google/gemini', name: 'Gemini' },
];

let container;
let root;
let onChange;

function input() {
  return container.querySelector('[role="combobox"]');
}

function options() {
  return [...container.querySelectorAll('[role="treeitem"][aria-selected]')];
}

function provider(name) {
  return [...container.querySelectorAll('[role="treeitem"][aria-expanded]')]
    .find((item) => item.getAttribute('aria-label') === name);
}

async function toggleProvider(name) {
  await click(provider(name).querySelector('.model-picker__group-heading'));
}

async function render(props = {}) {
  await act(async () => root.render(
    <ModelPicker models={models} value="openai/gpt-5" onChange={onChange} {...props} />,
  ));
}

async function click(element) {
  await act(async () => element.click());
}

async function type(value) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input(), value);
    input().dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function key(value) {
  await act(async () => input().dispatchEvent(new KeyboardEvent('keydown', { key: value, bubbles: true })));
}

beforeEach(() => {
  container = document.createElement('div');
  document.body.append(container);
  root = createRoot(container);
  onChange = vi.fn();
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

describe('ModelPicker', () => {
  it('opens only the selected provider and switches providers without changing the model', async () => {
    await render();
    await click(input());
    expect(input().getAttribute('aria-haspopup')).toBe('tree');
    expect(provider('OpenAI').getAttribute('aria-expanded')).toBe('true');
    expect(provider('Google').getAttribute('aria-expanded')).toBe('false');
    expect(options().map((item) => item.querySelector('strong').textContent)).toEqual(['Use app default', 'GPT-5']);
    await toggleProvider('Google');
    expect(provider('OpenAI').getAttribute('aria-expanded')).toBe('false');
    expect(provider('Google').getAttribute('aria-expanded')).toBe('true');
    expect(options().map((item) => item.querySelector('strong').textContent)).toEqual(['Use app default', 'Gemini']);
    expect(input().getAttribute('aria-activedescendant')).toBe(provider('Google').id);
    expect(provider('Google').hasAttribute('aria-selected')).toBe(false);
    expect(onChange).not.toHaveBeenCalled();
    await toggleProvider('Google');
    expect(options()).toHaveLength(1);
    expect(document.getElementById(input().getAttribute('aria-activedescendant'))).toBe(provider('Google'));
  });

  it('reveals search matches and restores the browsing provider on clearing search', async () => {
    await render({ models: [...models, { id: 'openai/shared', name: 'Shared model' }, { id: 'google/shared', name: 'Shared model' }] });
    await click(input());
    await toggleProvider('Google');
    await type('Shared');
    expect(provider('OpenAI').getAttribute('aria-expanded')).toBe('true');
    expect(provider('Google').getAttribute('aria-expanded')).toBe('true');
    expect(options()).toHaveLength(2);
    await toggleProvider('OpenAI');
    expect(options()).toHaveLength(1);
    await type('shared model');
    expect(options()).toHaveLength(2);
    await type('');
    expect(provider('Google').getAttribute('aria-expanded')).toBe('true');
    expect(provider('OpenAI').getAttribute('aria-expanded')).toBe('false');
    expect(options()).toHaveLength(3);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('opens the effective default provider while leaving app default selected', async () => {
    await render({ value: '', defaultModelId: 'google/gemini' });
    await click(input());
    expect(provider('Google').getAttribute('aria-expanded')).toBe('true');
    expect(provider('OpenAI').getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById(input().getAttribute('aria-activedescendant'))?.getAttribute('aria-selected')).toBe('true');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps text caret arrows available while typing and uses tree arrows after keyboard navigation', async () => {
    await render();
    await click(input());
    await type('claude');
    const event = new KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true });
    await act(async () => input().dispatchEvent(event));
    expect(event.defaultPrevented).toBe(false);
    expect(provider('Anthropic').getAttribute('aria-expanded')).toBe('true');
    await key('ArrowDown');
    await key('ArrowLeft');
    expect(input().getAttribute('aria-activedescendant')).toBe(provider('Anthropic').id);
    await key('ArrowLeft');
    expect(provider('Anthropic').getAttribute('aria-expanded')).toBe('false');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('keeps the active descendant valid when an open catalog loses the active model', async () => {
    await render();
    await click(input());
    const selectedId = input().getAttribute('aria-activedescendant');
    await render({ models: models.filter((model) => model.id !== 'openai/gpt-5') });
    expect(input().getAttribute('aria-activedescendant')).toBe(selectedId);
    expect(document.getElementById(selectedId)?.textContent).toContain('Saved selection');
    await type('Gemini');
    await render({ models: [{ id: 'anthropic/claude-sonnet', name: 'Claude Sonnet' }] });
    expect(input().hasAttribute('aria-activedescendant')).toBe(false);
    await key('Enter');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('uses one control to reveal and filter models by provider or name without changing the selection', async () => {
    await render();
    expect(input().value).toBe('GPT-5');
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelectorAll('input, select')).toHaveLength(1);
    await click(input());
    expect(input().getAttribute('aria-expanded')).toBe('true');
    await type('anthropic');
    expect(options()).toHaveLength(1);
    expect(options()[0].textContent).toContain('Claude Sonnet');
    expect(onChange).not.toHaveBeenCalled();
    await click(options()[0]);
    expect(onChange).toHaveBeenCalledWith('anthropic/claude-sonnet');
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('supports keyboard selection with a linked active descendant', async () => {
    await render();
    await key('ArrowDown');
    const firstActive = input().getAttribute('aria-activedescendant');
    expect(document.getElementById(firstActive)?.getAttribute('aria-selected')).toBe('true');
    await key('ArrowDown');
    const secondActive = input().getAttribute('aria-activedescendant');
    expect(document.getElementById(secondActive)?.getAttribute('aria-label')).toBe('Google');
    await key('ArrowRight');
    await key('ArrowRight');
    expect(document.getElementById(input().getAttribute('aria-activedescendant'))?.textContent).toContain('Gemini');
    await key('Enter');
    expect(onChange).toHaveBeenCalledWith('google/gemini');
  });

  it('groups interleaved catalog models by accessible provider headings with visible counts', async () => {
    await render({ models: [
      { id: 'openai/gpt-5', name: 'GPT-5' },
      { id: 'acme-labs/example', name: 'Example model' },
      { id: 'anthropic/claude-sonnet', name: 'Claude Sonnet' },
      { id: 'openai/gpt-mini', name: 'GPT Mini' },
      { id: 'google/gemini', name: 'Gemini' },
      { id: 'moonshotai/kimi', name: 'MoonshotAI: Kimi' },
    ] });
    await click(input());
    const groups = [...container.querySelectorAll('[role="treeitem"][aria-expanded]')];
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['Anthropic', 'OpenAI', 'Google', 'Acme Labs', 'MoonshotAI']);
    expect(groups[1].querySelector('.model-picker__group-count').textContent).toBe('2');
    expect([...groups[1].querySelectorAll('[role="treeitem"][aria-selected]')].map((option) => option.querySelector('strong').textContent))
      .toEqual(['GPT-5', 'GPT Mini']);
    expect(groups[4].getAttribute('aria-expanded')).toBe('false');
    await toggleProvider('MoonshotAI');
    expect(provider('MoonshotAI').querySelector('strong').textContent).toBe('Kimi');
    expect(options()[0].textContent).toContain('Use app default');
    expect(options()[0].closest('[role="group"]')).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it('filters by friendly provider names and keeps only the matching provider groups and counts', async () => {
    await render({ models: [
      { id: 'x-ai/grok', name: 'Grok' },
      { id: 'mistralai/medium', name: 'Medium' },
      { id: 'mistralai/small', name: 'Small' },
      { id: 'openai/gpt-5', name: 'GPT-5' },
    ] });
    await click(input());
    await type('xAI');
    expect(options()).toHaveLength(1);
    expect(options()[0].textContent).toContain('Grok');
    expect(container.querySelector('[role="group"]').getAttribute('aria-label')).toBe('xAI');
    await type('Mistral');
    expect(options()).toHaveLength(2);
    expect(container.querySelectorAll('[role="group"]')).toHaveLength(1);
    expect(container.querySelector('.model-picker__group-count').textContent).toBe('2');
    await type('Medium');
    expect(options()).toHaveLength(1);
    expect(container.querySelector('.model-picker__group-count').textContent).toBe('1');
    expect(input().getAttribute('aria-activedescendant')).toBe(options()[0].id);
    await key('Enter');
    expect(onChange).toHaveBeenCalledWith('mistralai/medium');
  });

  it('moves to and collapses the parent before opening another provider by keyboard', async () => {
    await render({ value: 'anthropic/sonnet', models: [
      { id: 'openai/gpt-5', name: 'GPT-5' },
      { id: 'anthropic/sonnet', name: 'Sonnet' },
      { id: 'anthropic/opus', name: 'Opus' },
    ] });
    await key('ArrowDown');
    await key('ArrowDown');
    expect(document.getElementById(input().getAttribute('aria-activedescendant')).textContent).toContain('Opus');
    await key('ArrowLeft');
    expect(input().getAttribute('aria-activedescendant')).toBe(provider('Anthropic').id);
    await key('ArrowLeft');
    expect(provider('Anthropic').getAttribute('aria-expanded')).toBe('false');
    expect(options()).toHaveLength(1);
    await key('ArrowDown');
    expect(input().getAttribute('aria-activedescendant')).toBe(provider('OpenAI').id);
    await key('Enter');
    expect(onChange).not.toHaveBeenCalled();
    await key('ArrowDown');
    await key('Enter');
    expect(onChange).toHaveBeenCalledWith('openai/gpt-5');
  });

  it('hides hundreds of unexpanded models while preserving a missing saved selection first', async () => {
    const largeCatalog = Array.from({ length: 300 }, (_, index) => ({
      id: `${['google', 'openai', 'anthropic'][index % 3]}/model-${index}`,
      name: `Model ${index}`,
    }));
    await render({ value: 'legacy/saved-model', models: largeCatalog });
    await click(input());
    expect(container.querySelectorAll('[role="treeitem"][aria-expanded]')).toHaveLength(3);
    expect([...container.querySelectorAll('.model-picker__group-count')].map((count) => count.textContent)).toEqual(['100', '100', '100']);
    expect(options()).toHaveLength(2);
    expect(container.querySelectorAll('[role="treeitem"]')).toHaveLength(5);
    expect(options()[0].textContent).toContain('Use app default');
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    expect(options()[1].textContent).toContain('Saved selection');
    await key('End');
    await key('Enter');
    expect(onChange).not.toHaveBeenCalled();
    expect(options()).toHaveLength(102);
    await key('End');
    await key('Enter');
    expect(onChange).toHaveBeenCalledWith('google/model-297');
  });

  it('can return to the app default and identifies its model', async () => {
    await render({ defaultModelId: 'google/gemini', defaultModelName: 'Gemini' });
    await click(input());
    expect(options()[0].textContent).toContain('Use app default');
    expect(options()[0].textContent).toContain('Gemini');
    await click(options()[0]);
    expect(onChange).toHaveBeenCalledWith('');
    await render({ value: '', defaultModelId: 'google/gemini', defaultModelName: 'Gemini' });
    expect(input().value).toBe('App default · Gemini');
  });

  it('shows a clear empty state and Escape restores the selected label without choosing a model', async () => {
    await render();
    await click(input());
    await type('not a model');
    expect(options()).toHaveLength(0);
    expect(container.textContent).toContain('No models match');
    await key('Enter');
    expect(onChange).not.toHaveBeenCalled();
    await key('Escape');
    expect(input().value).toBe('GPT-5');
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });

  it('preserves and exposes a selected model missing from the catalog', async () => {
    await render({ value: 'legacy/saved-model' });
    expect(input().value).toBe('legacy/saved-model');
    await click(input());
    expect(options().find((option) => option.getAttribute('aria-selected') === 'true')?.textContent)
      .toContain('Saved selection');
    await type('saved-model');
    expect(options()).toHaveLength(1);
    await key('Escape');
    expect(input().value).toBe('legacy/saved-model');
    expect(onChange).not.toHaveBeenCalled();
  });

  it('closes on outside pointer interaction and resets the query on reopening', async () => {
    await render();
    await click(input());
    await type('claude');
    await act(async () => document.body.dispatchEvent(new Event('pointerdown', { bubbles: true })));
    expect(input().getAttribute('aria-expanded')).toBe('false');
    expect(input().value).toBe('GPT-5');
    await click(input());
    expect(input().value).toBe('');
    expect(options()).toHaveLength(2);
  });

  it('disables interaction while loading and retains selection during catalog errors', async () => {
    await render({ loading: true });
    expect(input().disabled).toBe(true);
    expect(input().value).toBe('GPT-5');
    expect(input().getAttribute('aria-busy')).toBe('true');
    await render({ error: 'Connection lost', models: [] });
    expect(input().value).toBe('openai/gpt-5');
    await click(input());
    expect(container.textContent).toContain('Models unavailable');
    expect(options().some((option) => option.textContent.includes('Use app default'))).toBe(true);
    await render({ disabled: true });
    expect(input().disabled).toBe(true);
    expect(input().getAttribute('aria-expanded')).toBe('false');
    await render();
    expect(input().getAttribute('aria-expanded')).toBe('false');
  });
});
