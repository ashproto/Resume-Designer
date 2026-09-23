import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const prose = 'First line.\nA second line with • a literal separator.';
const healthy = () => ({ name: 'Ada', contact: {}, sections: [], education: [] });
const legacy = (type = 'text', content = prose) => ({
  ...healthy(), customMetadata: { retained: true },
  sections: [{ id: 'about', title: 'About', area: 'sidebar', type, content, custom: 'kept' }],
});
const file = (data) => new File([JSON.stringify(data)], 'legacy.json', { type: 'application/json' });
let persistence, variants, store, sync;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  vi.stubGlobal('alert', vi.fn());
  persistence = await import('../src/persistence.js');
  variants = await import('../src/variantManager.js');
  ({ store } = await import('../src/store.js'));
  sync = await import('../src/sync/syncModel.js');
});

afterEach(() => {
  store.saveNow();
  vi.unstubAllGlobals();
});

describe('legacy scalar section content at document boundaries', () => {
  it.each([42, false, { text: prose }, [null], [{}], [[prose]]])('still rejects malformed section content %j before import', async (content) => {
    const original = variants.createVariant('Original', healthy());
    const before = localStorage.getItem('resume-designer-data');
    expect(await variants.importVariant(file(legacy('text', content)))).toBe(false);
    expect(variants.getCurrentId()).toBe(original);
    expect(localStorage.getItem('resume-designer-data')).toBe(before);
  });

  it.each(['text', 'paragraph', 'list', 'skills', 'custom', null, undefined])('imports scalar content without rewriting the optional %s type or metadata', async (type) => {
    const document = JSON.parse(JSON.stringify(legacy(type)));
    if (type === undefined) delete document.sections[0].type;
    expect(await persistence.importFromJSON(file(document))).toEqual(document);
    expect(await variants.importVariant(file(document))).toBe(true);
    expect(store.getData()).toEqual(document);
    expect(persistence.getVariants()[variants.getCurrentId()].data).toEqual(document);
  });

  it('preserves empty scalar content as an editable string', async () => {
    const document = legacy('text', '');
    expect(await variants.importVariant(file(document))).toBe(true);
    store.update('sections[0].content', 'Written after importing an empty section');
    store.saveNow();
    expect(persistence.getVariants()[variants.getCurrentId()].data.sections[0].content)
      .toBe('Written after importing an empty section');
  });

  it('reopens a saved scalar section without rewriting its saved bytes', () => {
    const document = legacy();
    persistence.saveVariant('legacy', 'Legacy', document);
    persistence.setCurrentVariantId('legacy');
    const before = localStorage.getItem('resume-designer-data');
    expect(variants.initVariants(() => {})).toBe('legacy');
    expect(store.getData()).toEqual(document);
    expect(localStorage.getItem('resume-designer-data')).toBe(before);
  });

  it('allows undo, redo and explicit restore while preserving scalar history', () => {
    const document = legacy();
    persistence.saveVariant('open', 'Open', healthy());
    persistence.setCurrentVariantId('open');
    const history = [document, healthy()].map((data, i) => ({
      data, timestamp: `2020-01-0${i + 1}T00:00:00.000Z`, changeType: 'edit', description: 'Edit',
    }));
    localStorage.setItem('resume-designer-history-open', JSON.stringify({ history, historyIndex: 1 }));
    store.setData(healthy(), true, 'open');
    persistence.initPersistence('open');
    expect(store.undo()).toBe(true);
    expect(store.getData()).toEqual(document);
    expect(store.redo()).toBe(true);
    expect(store.getData()).toEqual(healthy());
    expect(store.restoreToEntry(0)).toBe(true);
    expect(store.saveNow()).toBe(true);
    expect(persistence.getVariants().open.data).toEqual(document);
    expect(store.getHistoryEntryData(0)).toEqual(document);
  });

  it('applies a synced scalar document and preserves its scalar editing path', async () => {
    persistence.saveVariant('open', 'Open', healthy());
    persistence.setCurrentVariantId('open');
    store.setData(healthy(), true, 'open');
    persistence.initPersistence('open');
    const document = legacy();
    const modifiedAt = '2099-01-01T00:00:00.000Z';
    expect(await sync.applyUnits([{
      id: 'resume:open', kind: 'resume', modifiedAt,
      payload: JSON.stringify({ id: 'open', name: 'Open', data: document, updatedAt: modifiedAt }),
    }])).toEqual({ applied: 1, accounted: [{ id: 'resume:open', profileId: '' }] });
    expect(persistence.getVariants().open.data).toEqual(document);
    expect(store.getData()).toEqual(document);
    store.update('sections[0].content', 'Updated on this device');
    expect(store.saveNow()).toBe(true);
    expect(persistence.getVariants().open.data.sections[0]).toEqual({
      ...document.sections[0], content: 'Updated on this device',
    });
  });
});
