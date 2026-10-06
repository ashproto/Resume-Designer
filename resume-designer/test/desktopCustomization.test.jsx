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
  expect(contacts[0].getAttribute('href')).toBe('tel:123');
  expect(contacts[1].getAttribute('href')).toBe('https://linkedin.com/in/alex');
  expect(contacts[2].getAttribute('href')).toBe('mailto:alex@example.com');
  expect(contacts[3].tagName).toBe('SPAN');
});

it('keeps reordered and additional website links editable', () => {
  const data = { name: 'Alex', contact: { portfolio: 'https://alex.example', github: 'https://github.com/alex' }, contactOrder: ['portfolio'], sections: [] };
  store.setData(data, true);
  const resume = document.querySelector('.resume');
  resume.id = 'resume';
  resume.innerHTML = renderResumeForLayout(data, 'sidebar');
  initInlineEditor();
  for (const field of ['portfolio', 'github']) {
    const contact = resume.querySelector(`[data-editable="contact.${field}"]`);
    expect(contact.tagName).toBe('A');
    expect(fireEvent.click(contact)).toBe(false);
    expect(contact.contentEditable).toBe('true');
    commitActiveInlineEdit();
  }
});

it('links website addresses safely while preserving contact text', () => {
  document.querySelector('.resume').innerHTML = renderResumeForLayout({ name: 'Alex', sections: [], contactOrder: [], contact: {
    portfolio: 'alex.example/work?view=all&sort=new', github: 'javascript:alert(1)',
    linkedin: 'https://linkedin.com/in/alex', twitter: '@alex.design', location: 'https://example.com',
    email: 'alex@example.com" onclick="alert(1)',
  } }, 'compact');
  const field = name => document.querySelector(`[data-editable="contact.${name}"]`);
  expect(field('portfolio').getAttribute('href')).toBe('https://alex.example/work?view=all&sort=new');
  expect(field('portfolio').textContent).toBe('alex.example/work?view=all&sort=new');
  expect(field('linkedin').getAttribute('href')).toBe('https://linkedin.com/in/alex');
  for (const name of ['github', 'twitter', 'location']) expect(field(name).tagName).toBe('SPAN');
  expect(field('email').getAttribute('href')).toBe('mailto:alex@example.com" onclick="alert(1)');
  expect(field('email').hasAttribute('onclick')).toBe(false);
});

it.each(layouts)('shows newly populated social contact fields in %s without requiring a reorder first', layout => {
  document.querySelector('.resume').innerHTML = renderResumeForLayout({ name: 'Alex', sections: [], contact: {
    linkedin: 'https://linkedin.com/in/alex', github: 'https://github.com/alex', twitter: '@alex', instagram: '@alex.design',
  } }, layout);
  const text = document.querySelector('.resume-header').textContent;
  for (const value of ['linkedin.com/in/alex', 'github.com/alex', '@alex', '@alex.design']) expect(text).toContain(value);
  expect(document.querySelector('[data-editable="contact.github"]').getAttribute('href')).toBe('https://github.com/alex');
  expect(document.querySelector('[data-editable="contact.instagram"]').closest('a[href]')).toBeNull();
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
