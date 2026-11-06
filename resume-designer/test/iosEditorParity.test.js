import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { buildChatView, buildDocumentOutline, buildOnboarding, buildSnapshot, initIOSShell } from '../src/iosShell.js';
import { store } from '../src/store.js';
import * as contactMeasurement from '../src/contactMeasurement.js';
const review = { notes: 'Emphasized research.', reasoning: 'Used the profile.', gaps: [{ requirement: 'Leadership', note: 'Add scope.' }], corrections: ['I led this team.'], score: 82, targetPages: 2, verbosity: 'detailed' };
const doc = { name: 'Alex', contact: {}, summary: 'Summary', experience: [{ id: 'role', title: 'Designer', bullets: ['Built it'] }], education: ['Degree'], tools: 'Figma', sections: [{ id: 'skills', title: 'Skills', area: 'sidebar', content: ['Research'] }], sectionLayout: { main: [{ key: 'experience' }, { key: 'summary', titleScale: 1.2 }], sidebar: [{ key: 'group:strengths', title: 'Strengths', children: [{ key: 'section:skills', contentItalic: true }, { key: 'tools' }] }, { key: 'education' }] } };
let send;
beforeEach(() => {
  localStorage.clear(); store.setData(doc, true, 'native-parity');
  globalThis.webkit = { messageHandlers: { opShell: { postMessage: vi.fn() } } };
  vi.spyOn(console, 'error').mockImplementation(() => {});
  initIOSShell({ getAppInfo: async () => ({ version: 'test' }), getTheme: () => 'system', subscribeVariants: vi.fn(), subscribeDocument: vi.fn(), getVariantsSnapshot: () => ({ currentId: 'native-parity', list: [] }), getZoom: () => 1, getSettings: () => ({ layout: 'modern' }), updateField: (path, value) => store.update(path, value), generateId: prefix => `${prefix}-new` });
  send = (type, payload = {}) => window.__opShell.command({ type, revision: String(store.documentAdoptions()), ...payload });
});
afterEach(() => { store.saveNow(); delete globalThis.webkit; vi.restoreAllMocks(); });
describe('native editor feedback parity', () => {
  it('recognizes real assistant change-set objects so the native Review action is visible', () => {
    const chat = buildChatView({ messages: [{ role: 'assistant', content: 'Review this.', pendingChanges: { changes: [{ path: 'summary', newValue: 'Better' }] } }, { role: 'assistant', content: 'Advice.', pendingChanges: { changes: [] } }] });
    expect(chat.messages.map(message => message.hasChanges)).toEqual([true, false]);
  });
  it('offers Review only for the live proposal belonging to the open resume', () => {
    const first = { changes: [{ path: 'summary' }] };
    const current = { changes: [{ path: 'tools' }] };
    const state = buildChatView({ activeChangeSet: current, currentVariantId: 'active', messages: [
      { content: 'Older proposal', pendingChanges: first, variantId: 'active' },
      { content: 'Current proposal', pendingChanges: current, variantId: 'active' },
      { content: 'Another resume', pendingChanges: current, variantId: 'other' },
    ] });
    expect(state.messages.map(message => message.reviewable)).toEqual([false, true, false]);
  });
  it('projects saved notes and independent writing detail on the generated ready screen', () => {
    const state = buildOnboarding({ mode: 'job', isNewResumeMode: true, step: 2, generationReview: review, targetJob: { targetPages: 2, verbosity: 'detailed' } });
    expect(state.generationReview).toMatchObject({ notes: review.notes, corrections: review.corrections, score: 82 });
    expect(state.generationBrief).toMatchObject({ targetPages: 2, verbosity: 'detailed' });
    expect(state.totalSteps).toBe(2);
    expect(buildSnapshot({ generationReview: review }).generationReview).toEqual(review);
  });
  it('reopens saved notes natively and continues the discussion with the saved context', async () => {
    store.update('generationReview', review);
    const opened = vi.fn();
    window.addEventListener('rd:chat-open-context', opened, { once: true });
    expect(send('generationNotesOpen').ok).toBe(true);
    await Promise.resolve();
    const messages = globalThis.webkit.messageHandlers.opShell.postMessage.mock.calls.map(([message]) => message);
    expect(messages.filter(message => message.kind === 'snapshot').at(-1).generationReview).toMatchObject({ open: true, notes: review.notes });
    expect(send('generationNotesDiscuss').ok).toBe(true);
    expect(opened.mock.calls[0][0].detail).toMatchObject({ type: 'generation-review', context: expect.stringContaining('Emphasized research.') });
  });

  it('projects built-in sections, tools and custom sections in one ordered grouped card outline', () => {
    const cards = buildDocumentOutline(doc).cards;
    expect(cards.map(card => card.key)).toEqual(['experience', 'summary', 'group:strengths', 'section:skills', 'tools', 'education']);
    expect(cards[0].groupIds).toEqual(['experience-0']);
    expect(cards[2]).toMatchObject({ isGroup: true, title: 'Strengths', area: 'sidebar', parentKey: '' });
    expect(cards[3]).toMatchObject({ parentKey: 'group:strengths', style: { contentItalic: true } });
    expect(cards[1].style.titleScale).toBe(1.2);
  });

  it('preserves array-backed tools when the native editor adds another tool', () => {
    store.setData({ ...doc, tools: ['Figma', 'Sketch'] }, true, 'native-parity');
    const outline = buildDocumentOutline(store.getData());
    const card = outline.cards.find(card => card.key === 'tools');
    const fields = [...card.fields, ...outline.groups
      .filter(group => card.groupIds.includes(group.id)).flatMap(group => group.fields)];
    const field = fields.find(field => field.path === 'tools');
    expect(field.value).toBe('Figma • Sketch');
    expect(store.get('tools')).toEqual(['Figma', 'Sketch']);

    expect(send('setField', { path: field.path, value: `${field.value} • Blender` }).ok).toBe(true);
    expect(store.get('tools')).toBe('Figma • Sketch • Blender');
    expect(buildDocumentOutline(store.getData()).groups.find(group => group.id === 'tools')
      .fields[0].value).toBe('Figma • Sketch • Blender');
    store.undo();
    expect(store.get('tools')).toEqual(['Figma', 'Sketch']);
  });

  it('edits section order, grouping, styles, deletion and restoration through shared undo history', () => {
    expect(send('sectionMove', { key: 'summary', direction: '-1' }).ok).toBe(true);
    expect(store.get('sectionLayout.main').map(node => node.key)).toEqual(['summary', 'experience']);
    expect(send('sectionRelocate', { key: 'summary', area: 'sidebar', parentKey: 'group:strengths' }).ok).toBe(true);
    expect(store.get('sectionLayout.sidebar[0].children').map(node => node.key)).toEqual(['section:skills', 'tools', 'summary']);
    expect(send('sectionStyle', { key: 'summary', field: 'contentBold', value: 'true' }).ok).toBe(true);
    expect(send('sectionStyle', { key: 'summary', field: 'titleScale', value: '1.5' }).ok).toBe(true);
    expect(store.get('sectionLayout.sidebar[0].children[2]')).toMatchObject({ contentBold: true, titleScale: 1.5 });
    expect(send('sectionStyle', { key: 'group:strengths', field: 'contentScale', value: '2' }).ok).toBe(false);
    expect(send('sectionRename', { key: 'group:strengths', title: 'Expertise' }).ok).toBe(true);
    expect(send('sectionRemove', { key: 'group:strengths' }).ok).toBe(true);
    expect(store.get('sectionLayout.sidebar').map(node => node.key)).toEqual(['section:skills', 'tools', 'summary', 'education']);
    expect(send('sectionRemove', { key: 'summary' }).ok).toBe(true);
    expect(store.get('summary')).toBe(''); store.undo(); expect(store.get('summary')).toBe('Summary');
    expect(send('sectionRemove', { key: 'tools' }).ok).toBe(true);
    expect(send('sectionRestore', { key: 'tools', area: 'main' }).ok).toBe(true);
    expect(store.get('sectionLayout.main').at(-1)).toEqual({ key: 'tools' });
  });
  it('leaves order and undo history unchanged when a section stays in its current area and parent', () => {
    const before = store.getData();
    const historyCount = store.getHistoryEntries().length;
    expect(send('sectionRelocate', { key: 'group:strengths', area: 'sidebar', parentKey: '' }).ok).toBe(true);
    expect(store.getData()).toEqual(before);
    expect(store.getHistoryEntries()).toHaveLength(historyCount);
    expect(send('sectionRelocate', { key: 'section:skills', area: 'sidebar', parentKey: 'group:strengths' }).ok).toBe(true);
    expect(store.getData()).toEqual(before);
    expect(store.getHistoryEntries()).toHaveLength(historyCount);
    // Choosing None in the separate parent control remains a real ungroup.
    expect(send('sectionRelocate', { key: 'section:skills', area: 'sidebar', parentKey: '' }).ok).toBe(true);
    expect(buildDocumentOutline(store.getData()).cards.find(card => card.key === 'section:skills').parentKey).toBe('');
  });

  it('keeps custom section names canonical so later editor and AI title edits remain visible', () => {
    expect(send('sectionRename', { key: 'section:skills', title: 'Expertise' }).ok).toBe(true);
    expect(store.get('sections[0].title')).toBe('Expertise');
    const stale = buildDocumentOutline(store.getData()).cards.find(card => card.key === 'section:skills').signature;
    store.update('sections[0].title', 'Research methods');
    expect(send('sectionRemove', { key: 'section:skills', signature: stale }).ok).toBe(false);
    expect(buildDocumentOutline(store.getData()).cards.find(card => card.key === 'section:skills').title).toBe('Research methods');
  });

  it('drags complete sections across areas and groups while keeping canonical content', () => {
    expect(send('sectionDrop', { key: 'summary', targetKey: 'group:strengths' }).ok).toBe(true);
    expect(store.get('sectionLayout.sidebar[0].children').at(-1).key).toBe('summary');
    expect(send('sectionDrop', { key: 'section:skills', targetKey: 'experience' }).ok).toBe(true);
    expect(store.get('sectionLayout.main').map(node => node.key)).toEqual(['section:skills', 'experience']);
    expect(store.get('sections[0].area')).toBe('main');
    expect(store.get('summary')).toBe('Summary');
  });
  it('customizes the current template from measured visible rows and persists only its layout', () => {
    store.update('contact', { email: 'alex@example.com', phone: '123', location: 'LA' });
    vi.spyOn(contactMeasurement, 'readRenderedContactRows').mockReturnValue([['email', 'phone'], ['location']]);
    const layout = buildDocumentOutline(store.getData(), { layout: 'modern' }).contactLayout;
    expect(layout).toMatchObject({ layout: 'modern', mode: 'auto', canCustomize: true });
    expect(layout.rows.map(row => row.map(field => field.id))).toEqual([['email', 'phone'], ['location']]);
    expect(send('contactCustomize', { layout: 'modern' }).ok).toBe(true);
    expect(store.get('contactLayouts.modern')).toEqual({ mode: 'custom', rows: [['email', 'phone'], ['location']] });
    expect(send('contactRows', { layout: 'modern', rows: JSON.stringify([['location', 'email'], ['phone']]) }).ok).toBe(true);
    expect(store.get('contactLayouts.modern.rows')).toEqual([['location', 'email'], ['phone']]);
    expect(store.get('contactLayouts.sidebar')).toBeUndefined();
    expect(send('contactRows', { layout: 'modern', rows: '[["email"]]', expectedRows: '[]' }).ok).toBe(false);
    expect(store.get('contactLayouts.modern.rows')).toEqual([['location', 'email'], ['phone']]);
    expect(send('contactReset', { layout: 'modern' }).ok).toBe(true);
    expect(store.get('contactLayouts.modern')).toEqual({ mode: 'auto' });
    store.undo();
    expect(store.get('contactLayouts.modern.mode')).toBe('custom');
  });

  it('keeps intended custom rows distinct from the current rendered wrapping', () => {
    store.update('contact', { email: 'alex@example.com', phone: '123' });
    store.update('contactLayouts', { modern: { mode: 'custom', rows: [['email', 'phone']] } });
    vi.spyOn(contactMeasurement, 'readRenderedContactRows').mockReturnValue([['email'], ['phone']]);
    const projected = buildDocumentOutline(store.getData(), { layout: 'modern' }).contactLayout;
    expect(projected.rows.map(row => row.map(field => field.id))).toEqual([['email', 'phone']]);
    expect(projected.renderedRows.map(row => row.map(field => field.id))).toEqual([['email'], ['phone']]);
  });

  it('refuses contact customization without rendered rows or after a template switch', () => {
    vi.spyOn(contactMeasurement, 'readRenderedContactRows').mockReturnValue(null);
    expect(send('contactCustomize', { layout: 'modern' }).ok).toBe(false);
    expect(send('contactRows', { layout: 'sidebar', rows: '[["email"]]' }).ok).toBe(false);
    expect(store.get('contactLayouts')).toBeUndefined();
  });
  it('refuses stale section commands and invalid group nesting without modifying the resume', () => {
    const revision = String(store.documentAdoptions());
    expect(send('sectionRelocate', { key: 'group:strengths', area: 'sidebar', parentKey: 'group:strengths' }).ok).toBe(false);
    expect(store.adoptDocument('native-parity', { ...doc, summary: 'Fetched' })).toBe(true);
    expect(send('sectionRemove', { key: 'summary', revision }).ok).toBe(false);
    expect(store.get('summary')).toBe('Fetched');
  });
});
