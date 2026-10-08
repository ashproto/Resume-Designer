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
  return [...container.querySelectorAll('[role="option"]')];
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
    expect(document.getElementById(secondActive)?.textContent).toContain('Gemini');
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
    const groups = [...container.querySelectorAll('[role="group"]')];
    expect(groups.map((group) => group.getAttribute('aria-label'))).toEqual(['Anthropic', 'OpenAI', 'Google', 'Acme Labs', 'MoonshotAI']);
    expect(groups[1].querySelector('.model-picker__group-count').textContent).toBe('2');
    expect([...groups[1].querySelectorAll('[role="option"]')].map((option) => option.querySelector('strong').textContent))
      .toEqual(['GPT-5', 'GPT Mini']);
    expect(groups[4].querySelector('strong').textContent).toBe('Kimi');
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

  it('navigates across provider boundaries without making group headings selectable', async () => {
    await render({ value: 'anthropic/sonnet', models: [
      { id: 'openai/gpt-5', name: 'GPT-5' },
      { id: 'anthropic/sonnet', name: 'Sonnet' },
      { id: 'anthropic/opus', name: 'Opus' },
    ] });
    await key('ArrowDown');
    await key('ArrowDown');
    expect(document.getElementById(input().getAttribute('aria-activedescendant')).textContent).toContain('Opus');
    await key('ArrowDown');
    const active = document.getElementById(input().getAttribute('aria-activedescendant'));
    expect(active.textContent).toContain('GPT-5');
    expect(active.closest('[role="group"]').getAttribute('aria-label')).toBe('OpenAI');
    await key('ArrowUp');
    await key('Enter');
    expect(onChange).toHaveBeenCalledWith('anthropic/opus');
  });

  it('keeps hundreds of models in provider groups while preserving a missing saved selection first', async () => {
    const largeCatalog = Array.from({ length: 300 }, (_, index) => ({
      id: `${['google', 'openai', 'anthropic'][index % 3]}/model-${index}`,
      name: `Model ${index}`,
    }));
    await render({ value: 'legacy/saved-model', models: largeCatalog });
    await click(input());
    expect(container.querySelectorAll('[role="group"]')).toHaveLength(3);
    expect([...container.querySelectorAll('.model-picker__group-count')].map((count) => count.textContent)).toEqual(['100', '100', '100']);
    expect(options()).toHaveLength(302);
    expect(options()[0].textContent).toContain('Use app default');
    expect(options()[1].getAttribute('aria-selected')).toBe('true');
    expect(options()[1].textContent).toContain('Saved selection');
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
    expect(options()).toHaveLength(4);
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
