import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

let persistence;
let variants;
let store;
let renderResumeForLayout;

const valid = () => ({
  name: 'Alex', contact: { email: 'alex@example.com' },
  education: ['University'],
  experience: [{ title: 'Engineer', company: 'Acme', bullets: ['Built things'] }],
  sections: [{ title: 'Skills', content: ['JavaScript'] }],
});
const file = (data) => new File([JSON.stringify(data)], 'resume.json', { type: 'application/json' });

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  // Only the external dialog is replaced; import, storage, selection and rendering are real.
  vi.stubGlobal('alert', vi.fn());
  persistence = await import('../src/persistence.js');
  variants = await import('../src/variantManager.js');
  ({ store } = await import('../src/store.js'));
  ({ renderResumeForLayout } = await import('../src/renderer.js'));
});

afterEach(() => {
  store?.saveNow();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('résumé JSON import validation', () => {
  it.each([
    ['education', { education: 'University' }],
    ['education[0]', { education: [{ school: 'University' }] }],
    ['sections', { sections: { title: 'Skills' } }],
    ['sections[0]', { sections: [null] }],
    ['sections[0].content', { sections: [{ title: 'Skills', content: 'JavaScript' }] }],
    ['sections[0].content[0]', { sections: [{ content: [{}] }] }],
    ['experience', { experience: 'Engineer' }],
    ['experience[0]', { experience: [null] }],
    ['experience[0].bullets', { experience: [{ bullets: 'Built things' }] }],
    ['experience[0].bullets[0]', { experience: [{ bullets: [{}] }] }],
    ['contact', { contact: [] }],
    ['contact.portfolio', { contact: { portfolio: 42 } }],
    ['contact.linkedin', { contact: { linkedin: {} } }],
    ['name', { name: {} }],
    ['tools', { tools: {} }],
    ['tools[0]', { tools: [{}] }],
  ])('rejects malformed %s before creating or selecting a résumé', async (_path, patch) => {
    const current = variants.createVariant('Original', valid());
    const before = localStorage.getItem('resume-designer-data');

    expect(await variants.importVariant(file({ ...valid(), ...patch }))).toBe(false);

    expect(localStorage.getItem('resume-designer-data')).toBe(before);
    expect(variants.getCurrentId()).toBe(current);
    expect(store.getData().name).toBe('Alex');
  });

  it('preserves older valid documents, unknown metadata and both tools representations', async () => {
    for (const tools of ['Git • Figma', ['Git', 'Figma']]) {
      const legacy = {
        ...valid(), tools, customMetadata: { source: 'old export' },
        experience: [{ title: 'Engineer', company: 'Acme', _groupId: 'tenure-1' }],
      };
      const parsed = await persistence.importFromJSON(file(legacy));
      expect(parsed).toEqual(legacy);
      for (const layout of ['sidebar', 'stacked', 'stacked-vertical', 'right-sidebar', 'compact',
        'executive', 'classic', 'classic-featured', 'modern', 'timeline', 'creative']) {
        expect(renderResumeForLayout(parsed, layout)).toContain('Alex');
      }
    }
  });

  it('does not persist invalid data supplied directly to creation', () => {
    expect(() => variants.createVariant('Broken', { ...valid(), education: 'University' })).toThrow();
    expect(persistence.getVariants()).toEqual({});
    expect(persistence.getCurrentVariantId()).toBeNull();
  });
});

describe('recovering a damaged saved résumé', () => {
  const renderSelected = () => {
    const data = store.getData();
    if (data) renderResumeForLayout(data, 'sidebar');
  };

  it('boots into a healthy résumé while retaining damaged data and its history', () => {
    persistence.saveVariant('bad', 'Damaged', { ...valid(), education: 'University' });
    persistence.saveVariant('good', 'Healthy', valid());
    persistence.setCurrentVariantId('bad');
    const history = '{"history":[],"historyIndex":-1}';
    localStorage.setItem('resume-designer-history-bad', history);
    const badBefore = persistence.getVariants().bad;

    expect(() => variants.initVariants(renderSelected)).not.toThrow();

    expect(variants.getCurrentId()).toBe('good');
    expect(persistence.getCurrentVariantId()).toBe('good');
    expect(store.getData().name).toBe('Alex');
    expect(persistence.getVariants().bad).toEqual(badBefore);
    expect(localStorage.getItem('resume-designer-history-bad')).toBe(history);
  });

  it('boots into an empty canvas if every saved résumé is damaged, retaining them for backup', () => {
    persistence.saveVariant('bad', 'Damaged', { ...valid(), sections: [null] });
    persistence.setCurrentVariantId('bad');
    const badBefore = persistence.getVariants().bad;

    expect(() => variants.initVariants(renderSelected)).not.toThrow();

    expect(variants.getCurrentId()).toBeNull();
    expect(persistence.getCurrentVariantId()).toBeNull();
    expect(store.getData()).toBeNull();
    expect(persistence.getVariants().bad).toEqual(badBefore);
    expect(variants.getVariantsSnapshot().list.map((item) => item.id)).toEqual(['bad']);
  });

  it('refuses a damaged selection without replacing the healthy document or its saved pointer', () => {
    variants.initVariants(renderSelected);
    const current = variants.createVariant('Original', valid());
    persistence.saveVariant('bad', 'Damaged', { ...valid(), experience: [null] });
    const before = localStorage.getItem('resume-designer-data');

    expect(variants.loadVariant('bad')).toBe(false);

    expect(variants.getCurrentId()).toBe(current);
    expect(localStorage.getItem('resume-designer-data')).toBe(before);
    expect(store.getData().experience[0].company).toBe('Acme');
  });

  it('continues loading sparse valid legacy data without modifying it', () => {
    persistence.saveVariant('legacy', 'Older résumé', { name: 'Alex' });
    persistence.setCurrentVariantId('legacy');
    expect(variants.initVariants(renderSelected)).toBe('legacy');
    expect(store.getData()).toEqual({ name: 'Alex' });
  });
});

describe('recovering selection after the open résumé is deleted', () => {
  function seed({ healthyReplacement = false } = {}) {
    persistence.saveVariant('bad', 'Damaged', { ...valid(), education: 'University' });
    if (healthyReplacement) persistence.saveVariant('good', 'Healthy', valid());
    persistence.saveVariant('open', 'Open résumé', { ...valid(), name: 'Before deletion' });
    persistence.setCurrentVariantId('open');
    variants.initVariants(() => {});
    return persistence.getVariants().bad;
  }

  async function deleteRemotely() {
    // Import main's actual handler wiring without booting the app or mocking
    // the sync/variant/persistence boundary being exercised.
    await import('../src/main.js');
    const { applyUnits } = await import('../src/sync/syncModel.js');
    const deletedAt = '2099-01-01T00:00:00.000Z';
    const result = await applyUnits([{
      id: 'resume:open', kind: 'resume', modifiedAt: deletedAt,
      payload: JSON.stringify({ id: 'open', name: 'Open résumé', deletedAt, updatedAt: deletedAt }),
    }]);
    expect(result.applied).toBe(1);
  }

  function expectEditableReplacement(id) {
    expect(variants.getCurrentId()).toBe(id);
    expect(persistence.getCurrentVariantId()).toBe(id);
    store.update('name', 'Edit after deletion');
    expect(store.saveNow()).toBe(true);
    expect(persistence.getVariants()[id].data.name).toBe('Edit after deletion');
    expect(persistence.loadFromStorage().variants.open.deletedAt).toBeTruthy();
  }

  it('skips a damaged local deletion replacement and saves later edits to a healthy résumé', () => {
    const damaged = seed({ healthyReplacement: true });
    expect(variants.deleteCurrentVariant()).toEqual({ ok: true });
    expectEditableReplacement('good');
    expect(persistence.getVariants().bad).toEqual(damaged);
  });

  it('clears the deleted document when local deletion leaves only damaged saved résumés', () => {
    const damaged = seed();
    store.update('summary', 'An edit awaiting autosave');
    expect(store.canUndo()).toBe(true);
    expect(variants.deleteCurrentVariant()).toEqual({ ok: true });
    expect(variants.getCurrentId()).toBeNull();
    expect(persistence.getCurrentVariantId()).toBeNull();
    expect(store.getData()).toBeNull();
    expect(store.isLoadedVariant('open')).toBe(false);
    expect(store.getHistoryLength()).toBe(0);
    expect(store.undo()).toBe(false);
    expect(store.getData()).toBeNull();
    expect(persistence.getVariants().bad).toEqual(damaged);
  });

  it('skips a damaged remote deletion replacement and saves later edits to a healthy résumé', async () => {
    const damaged = seed({ healthyReplacement: true });
    await deleteRemotely();
    expectEditableReplacement('good');
    expect(persistence.getVariants().bad).toEqual(damaged);
  });

  it('creates an editable fresh résumé after remote deletion leaves only damaged copies', async () => {
    const damaged = seed();
    await deleteRemotely();
    const replacement = variants.getCurrentId();
    expect(replacement).toBeTruthy();
    expect(replacement).not.toBe('open');
    expect(replacement).not.toBe('bad');
    expect(persistence.getVariants()[replacement].name).toBe('My Resume');
    expectEditableReplacement(replacement);
    expect(persistence.getVariants().bad).toEqual(damaged);
  });

  it('clears the deleted document before trying a fresh résumé if that save fails', async () => {
    seed();
    const originalSet = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      // The incoming tombstone and cleared pointer can land, but the larger
      // fresh résumé cannot — the same boundary as browser storage quota.
      if (key === 'resume-designer-data'
        && Object.values(JSON.parse(value).variants).some((variant) => variant.name === 'My Resume')) {
        throw new DOMException('quota exceeded', 'QuotaExceededError');
      }
      return originalSet.call(this, key, value);
    });
    await deleteRemotely();
    expect(variants.getCurrentId()).toBeNull();
    expect(persistence.getCurrentVariantId()).toBeNull();
    expect(store.getData()).toBeNull();
    expect(store.isLoadedVariant('open')).toBe(false);
    expect(Object.keys(persistence.getVariants())).toEqual(['bad']);
  });
});
