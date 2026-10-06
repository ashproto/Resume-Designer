import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildDesign, buildDocumentOutline, initIOSShell, newListItem } from '../src/iosShell.js';
import { store } from '../src/store.js';
import { applyDesign, getDesignState } from '../src/designController.js';

beforeEach(() => { localStorage.clear(); store.setData({ name: 'Alex', contact: {}, sections: [] }, true, 'ios-customization'); });
afterEach(() => { store.saveNow(); delete globalThis.webkit; vi.restoreAllMocks(); });

describe('native desktop customization parity', () => {
  it('projects every contact field in the saved order as movable but not deletable rows', () => {
    const header = buildDocumentOutline({ contact: { github: 'https://github.com/alex' }, contactOrder: ['github', 'phone'] }).groups[0];
    expect(header.listPath).toBe('contactOrder');
    expect(header.listOffset).toBe(2);
    expect(header.deletableRows).toBe(false);
    expect(header.fields.slice(2, 4).map(field => field.path)).toEqual(['contact.github', 'contact.phone']);
    expect(header.fields.find(field => field.path === 'contact.instagram')).toBeDefined();
    expect(buildDocumentOutline({ contact: {} }, { layout: 'creative' }).groups[0].fields.slice(2, 5).map(field => field.path))
      .toEqual(['contact.email', 'contact.phone', 'contact.location']);
  });

  it('projects section area controls and both-area additions with shared templates', () => {
    const outline = buildDocumentOutline({ sections: [{ id: 'projects', title: 'Projects', area: 'main', content: ['Built a thing'] }] });
    expect(outline.groups.at(-1).area).toEqual({ path: 'sections[0].area', value: 'main', options: [{ id: 'main', name: 'Main content' }, { id: 'sidebar', name: 'Sidebar' }] });
    const addition = outline.additions.find(row => row.path === 'sections');
    expect(addition.areas.map(area => area.id)).toEqual(['main', 'sidebar']);
    expect(addition.templates).toContainEqual({ id: 'projects', name: 'Projects' });
    expect(newListItem('sections', () => 'p', { area: 'main', template: 'projects' })).toMatchObject({ id: 'p', area: 'main', title: 'Projects', type: 'list' });
    expect(newListItem('sections', () => 'p', { area: 'sidebar', template: 'custom' })).toMatchObject({ area: 'sidebar', title: 'New section' });
  });

  it('includes persisted header size in the native design snapshot', async () => {
    await applyDesign({ group: 'spacing', property: 'headerScale', value: .4 });
    expect(buildDesign(getDesignState()).spacing.headerScale).toBe(.4);
  });

  it('routes contact moves and main-section adds through shared undoable store updates', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    globalThis.webkit = { messageHandlers: { opShell: { postMessage: vi.fn() } } };
    initIOSShell({
      getAppInfo: async () => ({ version: 'test' }),
      getTheme: () => 'system',
      subscribeVariants: vi.fn(),
      subscribeDocument: vi.fn(),
      getVariantsSnapshot: () => ({ currentId: null, list: [] }),
      getZoom: () => 1,
      getSettings: () => ({ layout: 'sidebar' }),
      updateField: (path, value) => store.update(path, value),
      addListItem: (path, value) => store.addToArray(path, value),
      generateId: () => 'new-project',
    });
    const send = message => window.__opShell.command(message);
    const revision = String(store.documentAdoptions());
    expect(send({ type: 'moveItem', path: 'contactOrder', from: '1', to: '0', revision }).ok).toBe(true);
    expect(store.get('contactOrder').slice(0, 2)).toEqual(['email', 'location']);
    store.undo();
    expect(store.get('contactOrder')).toBeUndefined();
    expect(send({ type: 'moveItem', path: 'contactOrder', from: '0', to: '3', revision }).ok).toBe(true);
    expect(store.get('contactOrder').slice(0, 3)).toEqual(['email', 'phone', 'location']);
    expect(send({ type: 'removeItem', path: 'contactOrder', index: '0', revision }).ok).toBe(false);
    expect(store.get('contactOrder')).toHaveLength(8);
    expect(send({ type: 'addItem', path: 'sections', area: 'main', template: 'projects', revision }).ok).toBe(true);
    expect(store.get('sections[0]')).toMatchObject({ title: 'Projects', area: 'main' });
    expect(send({ type: 'setSectionArea', path: 'sections[0].area', value: 'sidebar', revision }).ok).toBe(true);
    expect(store.get('sections[0].area')).toBe('sidebar');
    expect(send({ type: 'setSectionArea', path: 'sections[0].area', value: 'footer', revision }).ok).toBe(false);
    expect(store.adoptDocument('ios-customization', { name: 'Replacement', sections: [] })).toBe(true);
    expect(send({ type: 'moveItem', path: 'contactOrder', from: '0', to: '1', revision }).ok).toBe(false);
    expect(send({ type: 'addItem', path: 'sections', area: 'main', template: 'projects', revision }).ok).toBe(false);
  });
});
