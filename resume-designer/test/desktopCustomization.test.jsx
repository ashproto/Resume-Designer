import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import StructurePanel from '../src/components/structure/StructurePanel.jsx';
import { store } from '../src/store.js';
import { renderResumeForLayout } from '../src/renderer.js';
import { applyDesign, getDesignState, resetDesign } from '../src/designController.js';
import { getSpacingSettings, applySpacingSettings } from '../src/spacingService.js';
import { initInlineEditor, commitActiveInlineEdit } from '../src/inlineEditor.js';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="toggle-structure-panel">Open structure</button><aside id="structure-panel"><div id="structure-panel-content"></div></aside><div class="resume"></div>';
});
afterEach(() => { cleanup(); store.saveNow(); vi.restoreAllMocks(); });

function openPanel(data, tab = 'Header') {
  store.setData({ name: 'Alex', contact: {}, sections: [], ...data }, true);
  render(<StructurePanel />);
  fireEvent.click(screen.getByText('Open structure'));
  fireEvent.click(screen.getByTitle(tab));
}

it('offers new sections directly in Main, and keeps existing section paths when moving areas', () => {
  openPanel({ sections: [
    { id: 'skills', title: 'Skills', area: 'sidebar', content: ['Writing'] },
    { id: 'projects', title: 'Projects', area: 'main', content: ['A project'] },
  ] }, 'Main content');
  expect(document.querySelector('[data-field="sections[1].title"]').value).toBe('Projects');
  expect(document.querySelector('[data-field="sections[0].title"]')).toBeNull();
  fireEvent.pointerDown(screen.getByRole('button', { name: 'Add main section' }), { button: 0, ctrlKey: false });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Awards' }));
  expect(store.get('sections[2]')).toMatchObject({ title: 'Awards', area: 'main' });
  expect(renderResumeForLayout(store.getData(), 'sidebar')).toContain('data-editable="sections[2].title">Awards');
  act(() => { store.undo(); });
  expect(store.get('sections')).toHaveLength(2);
  fireEvent.click(screen.getByTitle('Sidebar'));
  // This is the section's Area control, as opposed to the top-level tab.
  const mainArea = screen.getAllByRole('tab', { name: 'Main', exact: true }).find(button => !button.title);
  fireEvent.click(mainArea);
  expect(store.get('sections[0].area')).toBe('main');
  fireEvent.click(screen.getByTitle('Main content'));
  expect(document.querySelector('[data-field="sections[0].title"]').value).toBe('Skills');
  expect(document.querySelector('[data-field="sections[1].title"]').value).toBe('Projects');
});

it('reorders contacts with accessible buttons, preserves field edits and supports undo', () => {
  openPanel({ contact: { location: 'Paris', email: 'alex@example.com', phone: '123' } });
  fireEvent.click(screen.getByRole('button', { name: 'Move Email up' }));
  expect(store.get('contactOrder').slice(0, 3)).toEqual(['email', 'location', 'phone']);
  fireEvent.change(document.querySelector('[data-field="contact.email"]'), { target: { value: 'new@example.com' } });
  expect(store.get('contact.email')).toBe('new@example.com');
  act(() => { store.undo(); store.undo(); });
  expect(store.get('contactOrder')).toBeUndefined();
});

const layouts = ['sidebar', 'stacked', 'stacked-vertical', 'right-sidebar', 'compact', 'executive', 'classic', 'classic-featured', 'modern', 'timeline', 'creative'];
it.each(layouts)('renders saved contact order in %s with intact inline editing paths', (layout) => {
  document.querySelector('.resume').innerHTML = renderResumeForLayout({
    name: 'Alex', contact: { location: 'Paris', email: 'alex@example.com', phone: '123', linkedin: 'https://linkedin.com/in/alex' },
    contactOrder: ['phone', 'linkedin', 'email', 'location'], sections: [],
  }, layout);
  const contacts = [...document.querySelectorAll('.resume-header [data-editable^="contact."]')];
  expect(contacts.map(el => el.getAttribute('data-editable'))).toEqual(['contact.phone', 'contact.linkedin', 'contact.email', 'contact.location']);
  expect(contacts[1].closest('a[href]')).toBeNull();
});

it('edits reordered and additional website contacts without triggering native external navigation', () => {
  const data = { name: 'Alex', contact: { portfolio: 'https://alex.example', github: 'https://github.com/alex' }, contactOrder: ['portfolio'], sections: [] };
  store.setData(data, true);
  const resume = document.querySelector('.resume');
  resume.id = 'resume';
  resume.innerHTML = renderResumeForLayout(data, 'sidebar');
  // The native host intercepts links in capture, before inline editing sees the click.
  const openExternal = vi.fn();
  const nativeClick = event => {
    if (event.target.closest('a[href]')) openExternal();
  };
  document.addEventListener('click', nativeClick, true);
  try {
    initInlineEditor();
    for (const field of ['portfolio', 'github']) {
      const contact = resume.querySelector(`[data-editable="contact.${field}"]`);
      fireEvent.click(contact);
      expect(contact.contentEditable).toBe('true');
      expect(openExternal).not.toHaveBeenCalled();
      commitActiveInlineEdit();
    }
  } finally {
    document.removeEventListener('click', nativeClick, true);
  }
});

it.each(layouts)('shows newly populated social contact fields in %s without requiring a reorder first', layout => {
  document.querySelector('.resume').innerHTML = renderResumeForLayout({ name: 'Alex', sections: [], contact: {
    linkedin: 'https://linkedin.com/in/alex', github: 'https://github.com/alex', twitter: '@alex', instagram: '@alex.design',
  } }, layout);
  const text = document.querySelector('.resume-header').textContent;
  for (const value of ['linkedin.com/in/alex', 'github.com/alex', '@alex', '@alex.design']) expect(text).toContain(value);
  expect(document.querySelector('[data-editable="contact.github"]').closest('a[href]')).toBeNull();
});

it('normalizes incomplete saved contact orders without dropping, duplicating or injecting fields', () => {
  const html = renderResumeForLayout({ name: 'Alex', contact: { email: '<b>email</b>', phone: '123', location: 'Paris' }, contactOrder: ['email', 'email', '__proto__'], sections: [] }, 'stacked');
  document.querySelector('.resume').innerHTML = html;
  expect([...document.querySelectorAll('[data-editable^="contact."]')].map(el => el.getAttribute('data-editable'))).toEqual(['contact.email', 'contact.location', 'contact.phone']);
  expect(html).toContain('&lt;b&gt;email&lt;/b&gt;');
});

it('persists header sizing, applies it to the document and resets to the existing size', async () => {
  expect(getSpacingSettings().headerScale).toBe(1);
  await applyDesign({ group: 'spacing', property: 'headerScale', value: 0.5 });
  expect(getDesignState().spacing.headerScale).toBe(0.5);
  expect(document.querySelector('.resume').style.getPropertyValue('--header-scale')).toBe('0.5');
  applySpacingSettings(getSpacingSettings());
  expect(document.querySelector('.resume').style.getPropertyValue('--header-scale')).toBe('0.5');
  await resetDesign('spacing');
  expect(getSpacingSettings().headerScale).toBe(1);
  expect(document.querySelector('.resume').style.getPropertyValue('--header-scale')).toBe('1');
});
