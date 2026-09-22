import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const DATA_KEY = 'resume-designer-data';
const HISTORY_KEY = 'resume-designer-history-open';
const healthy = () => ({ name: 'Ada', contact: {}, education: ['University'] });
const entry = (data, timestamp) => ({ data, timestamp, description: 'Edit', changeType: 'edit' });
let persistence;
let store;
let parkLoser;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  persistence = await import('../src/persistence.js');
  ({ store } = await import('../src/store.js'));
  ({ parkLoser } = await import('../src/sync/syncModel.js'));
  persistence.saveVariant('open', 'My résumé', healthy());
  persistence.setCurrentVariantId('open');
  store.setData(healthy(), true, 'open');
  persistence.initPersistence('open');
  vi.useFakeTimers();
});

afterEach(() => {
  store.suspendSaves();
  vi.useRealTimers();
});

function expectRejectedWithoutChanges(action) {
  const documentBefore = localStorage.getItem(DATA_KEY);
  const historyBefore = localStorage.getItem(HISTORY_KEY);
  const indexBefore = store.getHistoryIndex();
  expect(action()).toBe(false);
  expect(store.getData()).toEqual(healthy());
  expect(store.getHistoryIndex()).toBe(indexBefore);
  expect(store.isDirty()).toBe(false);
  vi.advanceTimersByTime(1000);
  expect(localStorage.getItem(DATA_KEY)).toBe(documentBefore);
  expect(localStorage.getItem(HISTORY_KEY)).toBe(historyBefore);
}

function loadLegacyHistory(history, historyIndex) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify({ history, historyIndex }));
  store.setData(healthy(), true, 'open');
}

describe('damaged recovery history cannot become the active résumé', () => {
  it('refuses an explicit restore of a malformed parked conflict copy without deleting it', () => {
    const damaged = { ...healthy(), education: 'University' };
    expect(parkLoser('resume:open', JSON.stringify({ id: 'open', data: damaged }))).toBe(true);
    const index = store.getHistoryEntries().find((item) => item.changeType === 'sync-conflict').index;
    expectRejectedWithoutChanges(() => store.restoreToEntry(index));
    expect(store.getHistoryEntryData(index)).toEqual(damaged);
  });

  it('refuses undo into malformed legacy history without changing the history position or saved bytes', () => {
    const damaged = { ...healthy(), experience: [{ bullets: 'Invalid list' }] };
    loadLegacyHistory([
      entry(damaged, '2020-01-01T00:00:00.000Z'),
      entry(healthy(), '2020-01-02T00:00:00.000Z'),
    ], 1);
    expectRejectedWithoutChanges(() => store.undo());
    expect(store.canUndo()).toBe(false);
    expect(store.getHistoryEntryData(0)).toEqual(damaged);
  });

  it('refuses redo into malformed legacy history without changing the history position or saved bytes', () => {
    const damaged = { ...healthy(), sections: [null] };
    loadLegacyHistory([
      entry(healthy(), '2020-01-01T00:00:00.000Z'),
      entry(damaged, '2020-01-02T00:00:00.000Z'),
    ], 0);
    expectRejectedWithoutChanges(() => store.redo());
    expect(store.canRedo()).toBe(false);
    expect(store.getHistoryEntryData(1)).toEqual(damaged);
  });

  it('still restores and persists a sparse valid older conflict copy', () => {
    const legacy = { name: 'Earlier Ada' };
    expect(parkLoser('resume:open', JSON.stringify({ id: 'open', data: legacy }))).toBe(true);
    const index = store.getHistoryEntries().find((item) => item.changeType === 'sync-conflict').index;
    expect(store.restoreToEntry(index)).toBe(true);
    expect(store.saveNow()).toBe(true);
    expect(persistence.getVariants().open.data).toEqual(legacy);
  });
});
