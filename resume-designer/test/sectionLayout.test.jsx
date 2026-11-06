import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { renderResumeForLayout } from '../src/renderer.js';
import { assertResumeData } from '../src/resumeValidation.js';
import StructurePanel from '../src/components/structure/StructurePanel.jsx';
import { store } from '../src/store.js';
import { applySpacingSettings } from '../src/spacingService.js';
import { editableSectionData, getSectionLayout, updateSectionNodeStyle } from '../src/sectionLayout.js';
import { makeNode, flatten } from '../src/pagination.js';
import { ConfirmHost } from '../src/components/ui/confirm.jsx';
import { createChangeSet } from '../src/diffEngine.js';
import { applyChangesToStore } from '../src/changeApply.js';

const layouts = ['sidebar', 'stacked', 'stacked-vertical', 'right-sidebar', 'compact', 'executive', 'classic', 'classic-featured', 'modern', 'timeline', 'creative'];
const data = () => ({
  name: 'Alex', contact: {}, summary: 'Summary prose',
  experience: [{ id: 'e', title: 'Designer', company: 'Company', dates: '2020', bullets: ['Experience bullet'] }],
  education: ['Degree'], tools: 'Figma • Blender',
  sections: [
    { id: 'core', title: 'Core Design', area: 'sidebar', type: 'skills', content: ['Research'] },
    { id: 'awards', title: 'Awards', area: 'main', type: 'list', content: ['Award'] },
  ],
});

beforeEach(() => {
  Element.prototype.scrollIntoView = () => {};
  localStorage.clear();
  store.setData(null, true);
  document.body.innerHTML = '<button id="toggle-structure-panel">Open structure</button><aside id="structure-panel"><div id="structure-panel-content"></div></aside><div class="resume"></div>';
});
afterEach(() => { cleanup(); store.saveNow(); vi.restoreAllMocks(); });

it.each(layouts)('honors saved standard/custom order, parent headings and tools placement in %s', layout => {
  const resume = data();
  resume.sectionLayout = {
    main: [{ key: 'education' }, { key: 'section:awards' }, { key: 'summary' }, { key: 'experience' }],
    sidebar: [{ key: 'group:skills', title: 'Skills <script>x</script>', titleScale: 1.2, contentScale: 0.9, children: [{ key: 'tools', title: 'Software' }, { key: 'section:core' }] }],
  };
  const before = JSON.stringify(resume);
  const host = document.querySelector('.resume');
  host.innerHTML = renderResumeForLayout(resume, layout);
  const leaves = [...host.querySelectorAll('[data-structure-key]')].filter(el => !el.classList.contains('resume-section-group'));
  expect(leaves.map(el => el.dataset.structureKey)).toEqual(['education', 'section:awards', 'summary', 'experience', 'tools', 'section:core']);
  expect(host.querySelector('.section-group-title').textContent).toBe('Skills <script>x</script>');
  expect(host.querySelector('.section-group-title script')).toBeNull();
  expect(host.querySelector('[data-editable="sections[0].content[0]"]').textContent).toBe('Research');
  expect(host.querySelector('[data-editable="sections[1].content[0]"]').textContent).toBe('Award');
  expect(host.querySelector('[data-editable="tools"]').textContent).toBe('Figma');
  expect(host.querySelector('[data-structure-key="tools"] h2, [data-structure-key="tools"] h3').textContent).toBe('Software');
  expect(host.querySelector('.resume-section-group').style.getPropertyValue('--section-content-scale')).toBe('0.9');
  applySpacingSettings({ fontScale: 1.1, pageMargins: { top: 0.5, bottom: 0.5, left: 0.5, right: 0.5 } });
  expect(host.querySelector('[data-editable="tools"]').style.fontSize).toBe('');
  expect(JSON.stringify(resume)).toBe(before);
});

it('never drops newly added canonical content or duplicates references in incomplete layout metadata', () => {
  const resume = data();
  resume.sectionLayout = { main: [{ key: 'summary' }, { key: 'summary' }, { key: 'section:gone' }], sidebar: [] };
  const host = document.querySelector('.resume');
  host.innerHTML = renderResumeForLayout(resume, 'sidebar');
  expect(host.querySelectorAll('[data-editable="summary"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-editable="sections[0].content[0]"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-editable="sections[1].content[0]"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-editable="experience[0].title"]')).toHaveLength(1);
});

it('rejects invalid known layout metadata before import while leaving unknown metadata allowed', () => {
  expect(() => assertResumeData({ ...data(), sectionLayout: { main: 'oops', sidebar: [] } })).toThrow(/sectionLayout.main/);
  expect(() => assertResumeData({ ...data(), sectionLayout: { main: [{ key: 'summary', titleScale: Infinity }], sidebar: [] } })).toThrow(/titleScale/);
  expect(() => assertResumeData({ ...data(), sectionLayout: { main: [{ key: 'group:g', children: [{ key: 'group:n', children: [] }] }], sidebar: [] } })).toThrow(/children/);
  expect(() => assertResumeData({ ...data(), futureMetadata: { keep: true } })).not.toThrow();
});

function open(tab = 'Sidebar') {
  store.setData(data(), true);
  render(<><StructurePanel /><ConfirmHost /></>);
  fireEvent.click(screen.getByText('Open structure'));
  fireEvent.click(screen.getByTitle(tab));
}

it('collapses individual section cards without losing edits and retains collapse after an array change', () => {
  open();
  fireEvent.change(document.querySelector('[data-field="sections[0].content[0]"]'), { target: { value: 'User research' } });
  fireEvent.click(screen.getByRole('button', { name: 'Collapse Core Design' }));
  expect(document.querySelector('[data-field="sections[0].content[0]"]')).toBeNull();
  act(() => store.addToArray('education', 'Another degree'));
  expect(screen.getByRole('button', { name: 'Expand Core Design' })).toBeTruthy();
  fireEvent.click(screen.getByRole('button', { name: 'Expand Core Design' }));
  expect(document.querySelector('[data-field="sections[0].content[0]"]').value).toBe('User research');
});

it('moves standard main sections alongside custom sections, persists order and supports undo', () => {
  open('Main content');
  fireEvent.click(screen.getByRole('button', { name: 'Move Awards up' }));
  expect(store.get('sectionLayout.main').map(node => node.key)).toEqual(['summary', 'experience', 'section:awards', 'education']);
  const host = document.querySelector('.resume');
  host.innerHTML = renderResumeForLayout(store.getData(), 'sidebar');
  expect([...host.querySelectorAll('.resume-main > [data-structure-key]')].map(el => el.dataset.structureKey)).toEqual(['summary', 'experience', 'section:awards', 'education']);
  act(() => store.undo());
  expect(store.get('sectionLayout')).toBeUndefined();
});

it('groups sidebar sections under an editable parent and applies separate title/content controls', () => {
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Add sidebar group' }));
  const title = screen.getByLabelText('Group title');
  fireEvent.change(title, { target: { value: 'Skills' } });
  fireEvent.click(screen.getByRole('button', { name: 'Add group', exact: true }));
  let section = document.querySelector('[data-editor-key="section:core"]');
  fireEvent.keyDown(within(section).getByRole('combobox', { name: 'Parent group' }), { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('option', { name: 'Skills', exact: true }));
  section = document.querySelector('[data-editor-key="section:core"]');
  fireEvent.change(within(section).getByLabelText('Title size'), { target: { value: '120' } });
  fireEvent.blur(within(section).getByLabelText('Title size'));
  fireEvent.change(within(section).getByLabelText('Content size'), { target: { value: '90' } });
  fireEvent.blur(within(section).getByLabelText('Content size'));
  const group = store.get('sectionLayout.sidebar').find(node => node.children);
  expect(group).toMatchObject({ title: 'Skills', children: [{ key: 'section:core', titleScale: 1.2, contentScale: 0.9 }] });
  expect(store.get('sections[0].content')).toEqual(['Research']);
});

it('reorders a legacy section on its first structure edit and keeps duplicate-id content exactly once', () => {
  store.setData({ ...data(), sections: [{ title: 'Legacy first', area: 'sidebar', content: ['One'] }, { title: 'Legacy second', area: 'sidebar', content: ['Two'] }] }, true);
  render(<StructurePanel />);
  fireEvent.click(screen.getByText('Open structure'));
  fireEvent.click(screen.getByTitle('Sidebar'));
  fireEvent.click(screen.getByRole('button', { name: 'Move Legacy second up' }));
  expect(store.get('sectionLayout.sidebar').map(node => sectionForTitle(store.getData(), node.key))).toEqual(['Legacy second', 'Legacy first', 'Tools']);
  const duplicate = { ...data(), sections: [{ id: 'same', title: 'First', content: ['One'] }, { id: 'same', title: 'Second', content: ['Two'] }], sectionLayout: { main: [], sidebar: [{ key: 'section:same', titleScale: 1.2 }] } };
  let id = 0;
  const edited = editableSectionData(duplicate, () => `new-${++id}`);
  const host = document.querySelector('.resume');
  host.innerHTML = renderResumeForLayout(edited, 'sidebar');
  expect(host.querySelectorAll('[data-editable="sections[0].content[0]"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-editable="sections[1].content[0]"]')).toHaveLength(1);
  expect(getSectionLayout(edited).sidebar[0]).toMatchObject({ key: 'section:same', titleScale: 1.2 });
});

function sectionForTitle(resume, key) {
  return key === 'tools' ? 'Tools' : resume.sections.find(section => `section:${section.id}` === key)?.title;
}

it('moves tools and custom section references between areas without duplication', () => {
  open();
  fireEvent.click(within(document.querySelector('[data-editor-key="tools"]')).getByRole('tab', { name: 'Main', exact: true }));
  fireEvent.click(within(document.querySelector('[data-editor-key="section:core"]')).getByRole('tab', { name: 'Main', exact: true }));
  const host = document.querySelector('.resume');
  host.innerHTML = renderResumeForLayout(store.getData(), 'sidebar');
  expect(host.querySelector('.resume-main [data-structure-key="tools"]')).toBeTruthy();
  expect(host.querySelector('.resume-main [data-structure-key="section:core"]')).toBeTruthy();
  expect(host.querySelectorAll('[data-structure-key="tools"]')).toHaveLength(1);
  expect(host.querySelectorAll('[data-structure-key="section:core"]')).toHaveLength(1);
  expect(store.get('sections[0].area')).toBe('main');
});

it('suppresses empty parent headers and keeps populated groups splittable through experience bullets', () => {
  const resume = data();
  resume.sectionLayout = { main: [{ key: 'group:empty', title: 'Empty', children: [] }, { key: 'group:work', title: 'Work', children: [{ key: 'experience' }] }], sidebar: [] };
  const host = document.querySelector('.resume');
  host.innerHTML = renderResumeForLayout(resume, 'sidebar');
  expect(host.querySelector('[data-structure-key="group:empty"]')).toBeNull();
  const group = makeNode(host.querySelector('[data-structure-key="group:work"]'));
  const units = [];
  flatten(group, [], units);
  expect(units.map(unit => unit.leaf.textContent)).toEqual(['Experience bullet']);
  expect(units[0].chain.map(node => node.el.dataset.structureKey).filter(Boolean)).toEqual(['group:work', 'experience']);
});

it('keeps a legacy size input mounted through repeated typing and styles the second duplicate independently', () => {
  store.setData({ name: 'Alex', sections: [{ id: 'same', title: 'First', content: ['One'] }, { id: 'same', title: 'Second', content: ['Two'] }, { title: 'No ID', content: ['Three'] }] }, true);
  render(<StructurePanel />);
  fireEvent.click(screen.getByText('Open structure'));
  fireEvent.click(screen.getByTitle('Sidebar'));
  const noId = document.querySelector('[data-editor-key="section:@2"]');
  const size = within(noId).getByLabelText('Title size');
  for (const value of ['1', '12', '120']) fireEvent.change(size, { target: { value } });
  expect(within(document.querySelector('[data-editor-key="section:@2"]')).getByLabelText('Title size')).toBe(size);
  expect(store.get('sections[2].id')).toBeUndefined();
  fireEvent.blur(size);
  const noIdKey = `section:${store.get('sections[2].id')}`;
  expect(store.get('sections[2].id')).toBeTruthy();
  expect(store.get('sectionLayout.sidebar').find(node => node.key === noIdKey).titleScale).toBe(1.2);
  expect(within(document.querySelector(`[data-editor-key="${noIdKey}"]`)).getByLabelText('Title size')).toBe(size);
  const secondKey = `section:${store.get('sections[1].id')}`;
  const second = document.querySelector(`[data-editor-key="${secondKey}"]`);
  fireEvent.change(within(second).getByLabelText('Content size'), { target: { value: '90' } });
  fireEvent.blur(within(second).getByLabelText('Content size'));
  expect(store.get('sectionLayout.sidebar').find(node => node.key === secondKey).contentScale).toBe(0.9);
  expect(store.get('sectionLayout.sidebar').find(node => node.key === 'section:same').contentScale).toBeUndefined();
});

it.each(['remove', 'reorder'])('keeps committed legacy typography attached to its section after a canonical %s', operation => {
  store.setData({ name: 'Alex', sections: [
    { title: 'Legacy first', content: ['One'] },
    { title: 'Legacy second', content: ['Two'] },
  ] }, true);
  render(<StructurePanel />);
  fireEvent.click(screen.getByText('Open structure'));
  fireEvent.click(screen.getByTitle('Sidebar'));
  const first = document.querySelector('[data-editor-key="section:@0"]');
  const details = first.querySelector('details');
  fireEvent.click(details.querySelector('summary'));
  const italic = within(first).getByRole('button', { name: 'Title italic', exact: true });
  act(() => italic.focus());
  fireEvent.click(italic);
  expect(first.isConnected).toBe(true);
  expect(first.querySelector('details')).toBe(details);
  expect(details.open).toBe(true);
  expect(document.activeElement).toBe(italic);
  // Commit another control from the same still-open card after its identity
  // has been saved, as users do when formatting several attributes in a row.
  fireEvent.click(within(first).getByRole('button', { name: 'Title underline', exact: true }));
  act(() => {
    if (operation === 'remove') {
      const changeSet = createChangeSet(store.getData(), { sections: [store.get('sections[1]')] });
      applyChangesToStore(changeSet.changes);
    } else store.moveInArray('sections', 0, 1);
  });
  const host = document.querySelector('.resume');
  host.innerHTML = renderResumeForLayout(store.getData(), 'sidebar');
  const sections = [...host.querySelectorAll('[data-structure-key^="section:"]')];
  const survivor = sections.find(section => section.querySelector('h2').textContent === 'Legacy second');
  expect(survivor.style.getPropertyValue('--section-title-style')).toBe('normal');
  expect(survivor.style.getPropertyValue('--section-title-decoration')).toBe('none');
  if (operation === 'reorder') {
    const styled = sections.find(section => section.querySelector('h2').textContent === 'Legacy first');
    expect(styled.style.getPropertyValue('--section-title-style')).toBe('italic');
    expect(styled.style.getPropertyValue('--section-title-decoration')).toBe('underline');
  }
});

it('immediately displays a selected typography font', () => {
  open();
  const section = document.querySelector('[data-editor-key="section:core"]');
  fireEvent.keyDown(within(section).getByRole('combobox', { name: 'Title font' }), { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('option', { name: 'Body font', exact: true }));
  expect(within(document.querySelector('[data-editor-key="section:core"]')).getByRole('combobox', { name: 'Title font' }).textContent).toBe('Body font');
  expect(store.get('sectionLayout.sidebar').find(node => node.key === 'section:core').titleFont).toBe('body');
});

it('keeps typography controls open while applying consecutive formatting changes', () => {
  open();
  const card = document.querySelector('[data-editor-key="section:core"]');
  const details = card.querySelector('details');
  fireEvent.click(details.querySelector('summary'));
  expect(details.open).toBe(true);
  fireEvent.click(within(card).getByRole('button', { name: 'Title italic', exact: true }));
  const sameCard = document.querySelector('[data-editor-key="section:core"]');
  expect(sameCard.querySelector('details')).toBe(details);
  expect(details.open).toBe(true);
  fireEvent.click(within(sameCard).getByRole('button', { name: 'Title underline', exact: true }));
  expect(store.get('sectionLayout.sidebar').find(node => node.key === 'section:core')).toMatchObject({ titleItalic: true, titleUnderline: true });
  expect(within(sameCard).getByRole('button', { name: 'Title italic', exact: true }).getAttribute('aria-pressed')).toBe('true');
});

it('deletes standard section content in one undo step and can restore its editor card', async () => {
  open('Main content');
  fireEvent.click(screen.getByRole('button', { name: 'Delete Summary section' }));
  await act(async () => fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete', exact: true })));
  expect(store.get('summary')).toBe('');
  expect(screen.queryByRole('button', { name: 'Delete Summary section' })).toBeNull();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Add main section' }), { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Summary', exact: true }));
  expect(document.querySelector('[data-field="summary"]')).toBeTruthy();
  act(() => { store.undo(); store.undo(); });
  expect(store.get('summary')).toBe('Summary prose');
  expect(store.get('sectionLayout')).toBeUndefined();
});

it('refuses a pending section deletion after the document is replaced', async () => {
  open();
  fireEvent.click(screen.getByRole('button', { name: 'Delete Tools section' }));
  act(() => store.setData({ ...data(), name: 'Another resume', tools: 'Keep this tool' }, true));
  await act(async () => fireEvent.click(within(screen.getByRole('alertdialog')).getByRole('button', { name: 'Delete', exact: true })));
  expect(store.get('tools')).toBe('Keep this tool');
});

it('removes a parent header while keeping its child sections and their content', () => {
  const resume = data();
  resume.sectionLayout = { main: [], sidebar: [{ key: 'group:skills', title: 'Skills', children: [{ key: 'section:core' }, { key: 'tools' }] }] };
  store.setData(resume, true);
  render(<StructurePanel />);
  fireEvent.click(screen.getByText('Open structure'));
  fireEvent.click(screen.getByTitle('Sidebar'));
  fireEvent.click(screen.getByRole('button', { name: 'Remove Skills group' }));
  expect(store.get('sectionLayout.sidebar').map(node => node.key)).toEqual(['section:core', 'tools']);
  expect(store.get('sections[0].content')).toEqual(['Research']);
  expect(store.get('tools')).toBe('Figma • Blender');
});

it('keeps section and group percentage drafts until blur or Enter, then clamps the committed value', () => {
  const resume = data();
  resume.sectionLayout = { main: [], sidebar: [{ key: 'group:skills', title: 'Skills', children: [{ key: 'section:core' }] }] };
  store.setData(resume, true);
  render(<StructurePanel />);
  fireEvent.click(screen.getByText('Open structure'));
  fireEvent.click(screen.getByTitle('Sidebar'));
  for (const key of ['group:skills', 'section:core']) {
    const card = document.querySelector(`[data-editor-key="${key}"]`);
    const size = within(card).getAllByLabelText('Title size')[0];
    expect(size.value).toBe('100');
    fireEvent.focus(size);
    for (const value of ['', '1', '12', '120']) {
      fireEvent.change(size, { target: { value } });
      expect(size.value).toBe(value);
    }
    const node = key === 'group:skills' ? store.get('sectionLayout.sidebar[0]') : store.get('sectionLayout.sidebar[0].children[0]');
    expect(node.titleScale).toBeUndefined();
    fireEvent.blur(size);
    const updated = key === 'group:skills' ? store.get('sectionLayout.sidebar[0]') : store.get('sectionLayout.sidebar[0].children[0]');
    expect(updated.titleScale).toBe(1.2);
    fireEvent.change(size, { target: { value: '3' } });
    fireEvent.keyDown(size, { key: 'Enter' });
    expect(size.value).toBe('50');
    fireEvent.change(size, { target: { value: '' } });
    fireEvent.blur(size);
    expect(size.value).toBe('100');
  }
});

it('offers parent heading formatting and independent title/content formatting for sections and tools', () => {
  const resume = data();
  resume.sectionLayout = { main: [], sidebar: [{ key: 'group:skills', title: 'Skills', children: [{ key: 'section:core' }] }] };
  store.setData(resume, true);
  render(<StructurePanel />);
  fireEvent.click(screen.getByText('Open structure'));
  fireEvent.click(screen.getByTitle('Sidebar'));
  const group = document.querySelector('[data-editor-key="group:skills"]');
  expect(within(group).getAllByLabelText('Content size')).toHaveLength(1);
  const child = document.querySelector('[data-editor-key="section:core"]');
  fireEvent.click(within(child).getByRole('button', { name: 'Title bold' }));
  expect(within(document.querySelector('[data-editor-key="section:core"]')).getByRole('button', { name: 'Title bold' }).getAttribute('aria-pressed')).toBe('false');
  const tools = document.querySelector('[data-editor-key="tools"]');
  fireEvent.click(within(tools).getByRole('button', { name: 'Content italic' }));
  fireEvent.click(within(document.querySelector('[data-editor-key="tools"]')).getByRole('button', { name: 'Content underline' }));
  expect(store.get('sectionLayout.sidebar[0].children[0].titleBold')).toBe(false);
  expect(store.get('sectionLayout.sidebar').find(node => node.key === 'tools')).toMatchObject({ contentItalic: true, contentUnderline: true });
  expect(store.get('sections[0].content')).toEqual(['Research']);
});

it('isolates child typography from a parent heading and keeps normal/bold choices when rendered', () => {
  const resume = data();
  resume.sectionLayout = { main: [], sidebar: [{ key: 'group:skills', title: 'Skills', titleScale: 1.8, titleFont: 'body', contentScale: 1.7, contentFont: 'display', titleItalic: true, children: [{ key: 'section:core', titleBold: false, contentBold: true, contentUnderline: true }] }] };
  const host = document.querySelector('.resume');
  host.innerHTML = renderResumeForLayout(resume, 'sidebar');
  const group = host.querySelector('[data-structure-key="group:skills"]');
  const child = host.querySelector('[data-structure-key="section:core"]');
  expect(child.style.getPropertyValue('--section-title-scale')).toBe('1');
  expect(child.style.getPropertyValue('--section-content-scale')).toBe('1');
  expect(child.style.getPropertyValue('--section-title-font')).toBe('initial');
  expect(child.style.getPropertyValue('--section-content-font')).toBe('initial');
  expect(child.style.getPropertyValue('--section-title-style')).toBe('normal');
  expect(child.style.getPropertyValue('--section-title-weight')).toBe('400');
  expect(child.style.getPropertyValue('--section-content-weight')).toBe('700');
  expect(child.style.getPropertyValue('--section-content-decoration')).toBe('underline');
  expect(group.style.getPropertyValue('--section-title-weight')).toBe('800');
});

it('preserves template text defaults until a section explicitly sets a formatting choice', () => {
  const resume = data();
  resume.sectionLayout = { main: [{ key: 'experience', contentItalic: false, contentBold: false }], sidebar: [] };
  const host = document.querySelector('.resume');
  host.innerHTML = renderResumeForLayout(resume, 'creative');
  const custom = host.querySelector('[data-structure-key="section:core"]');
  const experience = host.querySelector('[data-structure-key="experience"]');
  expect(custom.style.getPropertyValue('--section-title-weight')).toBe('initial');
  expect(custom.style.getPropertyValue('--section-content-style')).toBe('initial');
  expect(experience.style.getPropertyValue('--section-content-style')).toBe('normal');
  expect(experience.style.getPropertyValue('--section-content-weight')).toBe('400');
});

it('validates and normalizes typography flags without changing content fields', () => {
  expect(() => assertResumeData({ ...data(), sectionLayout: { main: [{ key: 'summary', titleBold: 'yes' }], sidebar: [] } })).toThrow(/titleBold/);
  const node = { key: 'tools' };
  updateSectionNodeStyle(node, 'titleBold', false);
  updateSectionNodeStyle(node, 'contentScale', 12);
  updateSectionNodeStyle(node, 'contentItalic', true);
  updateSectionNodeStyle(node, 'contentUnderline', false);
  updateSectionNodeStyle(node, 'contentFont', 'body');
  updateSectionNodeStyle(node, 'key', 'summary');
  expect(node).toEqual({ key: 'tools', titleBold: false, contentScale: 2, contentItalic: true, contentUnderline: false, contentFont: 'body' });
  updateSectionNodeStyle(node, 'titleBold', undefined);
  expect(node.titleBold).toBeUndefined();
  expect(() => assertResumeData({ ...data(), sectionLayout: { main: [], sidebar: [node] } })).not.toThrow();
});
