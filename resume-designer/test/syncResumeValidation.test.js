import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

let persistence;
let store;
let sync;
let renderResumeForLayout;
const healthy = () => ({ name: 'Ada', contact: {}, education: ['University'] });
const unit = (data, modifiedAt = '2099-01-01T00:00:00.000Z') => ({
  id: 'resume:open', kind: 'resume', modifiedAt,
  payload: JSON.stringify({ id: 'open', name: 'My résumé', data, updatedAt: modifiedAt }),
});

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  persistence = await import('../src/persistence.js');
  ({ store } = await import('../src/store.js'));
  sync = await import('../src/sync/syncModel.js');
  ({ renderResumeForLayout } = await import('../src/renderer.js'));
  persistence.saveVariant('open', 'My résumé', healthy());
  persistence.setCurrentVariantId('open');
  store.setData(healthy(), true, 'open');
  persistence.initPersistence('open');
});

afterEach(() => { store.saveNow(); });

describe('synced résumé validation before persistence and adoption', () => {
  it.each([
    ['document array', []],
    ['education string', { ...healthy(), education: 'University' }],
    ['null section', { ...healthy(), sections: [null] }],
    ['nested bullet object', { ...healthy(), experience: [{ bullets: [{}] }] }],
    ['contact object value', { ...healthy(), contact: { email: {} } }],
  ])('accounts for a malformed %s without overwriting the healthy loaded résumé', async (_name, malformed) => {
    const before = localStorage.getItem('resume-designer-data');

    expect(await sync.applyUnits([unit(malformed)]))
      .toEqual({ applied: 0, accounted: [{ id: 'resume:open', profileId: '' }] });

    expect(localStorage.getItem('resume-designer-data')).toBe(before);
    expect(store.getData()).toEqual(healthy());
    expect(renderResumeForLayout(store.getData(), 'sidebar')).toContain('Ada');
    store.update('name', 'Edited safely after sync');
    expect(store.saveNow()).toBe(true);
    expect(persistence.getVariants().open.data.name).toBe('Edited safely after sync');
  });

  it('continues to apply and adopt sparse legacy documents without stripping metadata', async () => {
    const legacy = { name: 'Remote Ada', customMetadata: { source: 'older app' } };
    expect(await sync.applyUnits([unit(legacy)]))
      .toEqual({ applied: 1, accounted: [{ id: 'resume:open', profileId: '' }] });
    expect(persistence.getVariants().open.data).toEqual(legacy);
    expect(store.getData()).toEqual(legacy);
  });

  it('continues to apply a tombstone that intentionally carries no document', async () => {
    const deletedAt = '2099-01-01T00:00:00.000Z';
    const tombstone = { id: 'open', name: 'My résumé', deletedAt, updatedAt: deletedAt };
    expect(await sync.applyUnits([{ ...unit(null), payload: JSON.stringify(tombstone) }]))
      .toEqual({ applied: 1, accounted: [{ id: 'resume:open', profileId: '' }] });
    expect(persistence.getVariants()).toEqual({});
    expect(persistence.loadFromStorage().variants.open).toEqual(tombstone);
  });

  it('refuses a newer malformed conflict winner without replacing or parking the healthy document', async () => {
    const before = localStorage.getItem('resume-designer-data');
    expect(await sync.resolveConflicts([{
      local: unit(healthy(), '2098-01-01T00:00:00.000Z'),
      server: unit({ ...healthy(), education: 'University' }),
    }])).toEqual({ resolved: [], parked: 0 });
    expect(localStorage.getItem('resume-designer-data')).toBe(before);
    expect(store.getData()).toEqual(healthy());
  });

  it('retains a malformed losing conflict copy in recovery history without adopting it', async () => {
    const damaged = { ...healthy(), education: 'University' };
    expect(await sync.resolveConflicts([{
      local: unit(healthy()), server: unit(damaged, '2098-01-01T00:00:00.000Z'),
    }])).toEqual({ resolved: [{ id: 'resume:open', profileId: '', retry: true }], parked: 1 });
    expect(store.getData()).toEqual(healthy());
    store.update('name', 'Edited after preserving the damaged copy');
    store.saveNow();
    const savedHistory = JSON.parse(localStorage.getItem('resume-designer-history-open'));
    expect(savedHistory.history.find((entry) => entry.changeType === 'sync-conflict').data).toEqual(damaged);
    expect(store.undo()).toBe(true);
    expect(store.getData()).toEqual(healthy());
  });
});
