import { describe, it, expect, beforeEach } from 'vitest';
import { store, EMPTY_RESUME } from '../src/store.js';
import * as ui from '../src/uiState.js';

beforeEach(() => {
  store.clearHistory();
  store.setData(JSON.parse(JSON.stringify(EMPTY_RESUME)), true, 'vtest');
  ui.clearForVariant('vtest');
});

describe('uiState', () => {
  it('defaults sort mode to "date" and round-trips a set', () => {
    expect(ui.getSortMode()).toBe('date');
    ui.setSortMode('relevance');
    expect(ui.getSortMode()).toBe('relevance');
  });
  it('defaults an experience to expanded and round-trips a collapse', () => {
    expect(ui.isExpanded('e1')).toBe(true);
    ui.setExpanded('e1', false);
    expect(ui.isExpanded('e1')).toBe(false);
    expect(ui.isExpanded('e2')).toBe(true);
  });
  it('scopes state per variant', () => {
    ui.setSortMode('custom');
    store.setData(JSON.parse(JSON.stringify(EMPTY_RESUME)), true, 'vother');
    expect(ui.getSortMode()).toBe('date');
    store.setData(JSON.parse(JSON.stringify(EMPTY_RESUME)), true, 'vtest');
    expect(ui.getSortMode()).toBe('custom');
  });
});
