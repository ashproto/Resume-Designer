import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import StructurePanel from '../src/components/structure/StructurePanel.jsx';
import { renderResumeForLayout } from '../src/renderer.js';
import { store } from '../src/store.js';
import { getContactRows } from '../src/contactFields.js';
import { assertResumeData } from '../src/resumeValidation.js';

const layouts = ['sidebar', 'stacked', 'stacked-vertical', 'right-sidebar', 'compact', 'executive', 'classic', 'classic-featured', 'modern', 'timeline', 'creative'];
const data = () => ({
  name: 'Alex', sections: [],
  contact: { email: 'alex@example.com', phone: '123', location: 'Paris', portfolio: 'https://alex.example' },
  contactOrder: ['email', 'phone', 'location', 'portfolio'],
  contactBreakBefore: ['location'],
});

beforeEach(() => { localStorage.clear(); document.body.innerHTML = '<button id="toggle-structure-panel">Open structure</button><aside id="structure-panel"><div id="structure-panel-content"></div></aside><div id="resume"></div>'; });
afterEach(() => { cleanup(); store.saveNow(); vi.restoreAllMocks(); });

it.each(layouts)('renders chosen contact lines in %s with links and editable paths intact', layout => {
  document.getElementById('resume').innerHTML = renderResumeForLayout(data(), layout);
  const lines = [...document.querySelectorAll('.contact-line')];
  expect(lines).toHaveLength(2);
  expect([...lines[0].querySelectorAll('[data-editable]')].map(el => el.dataset.editable)).toEqual(['contact.email', 'contact.phone']);
  expect([...lines[1].querySelectorAll('[data-editable]')].map(el => el.dataset.editable)).toEqual(['contact.location', 'contact.portfolio']);
  expect(lines[0].querySelector('[data-editable="contact.email"]').getAttribute('href')).toBe('mailto:alex@example.com');
  expect(lines[1].querySelector('[data-editable="contact.portfolio"]').getAttribute('href')).toBe('https://alex.example/');
  for (const line of lines) {
    expect(line.firstElementChild.classList.contains('contact-sep')).toBe(false);
    expect(line.lastElementChild.classList.contains('contact-sep')).toBe(false);
  }
});

it('ignores breaks at empty contacts and the first visible item without creating blank rows', () => {
  expect(getContactRows({ email: 'alex@example.com', location: '', phone: '123' }, ['email', 'location', 'phone'], ['email', 'location', 'phone', 'bad', 'phone']))
    .toEqual([['email'], ['phone']]);
  expect(getContactRows({}, [], ['email'])).toEqual([]);
});

it('keeps legacy rendering when no line breaks have been chosen', () => {
  const legacy = data(); delete legacy.contactBreakBefore;
  for (const layout of layouts) {
    expect(renderResumeForLayout({ ...legacy, contactBreakBefore: [] }, layout)).toBe(renderResumeForLayout(legacy, layout));
  }
});

it('saves template-aware contact arrangements per resume and supports undo', () => {
  const initial = data(); delete initial.contactBreakBefore;
  store.setData(initial, true);
  document.getElementById('resume').innerHTML = renderResumeForLayout(initial, 'sidebar');
  document.querySelectorAll('.resume-header [data-editable^="contact."]').forEach((el, i) => {
    el.getBoundingClientRect = () => ({ top: i * 20, bottom: i * 20 + 15, height: 15, width: 100 });
  });
  render(<StructurePanel />);
  fireEvent.click(screen.getByText('Open structure'));
  fireEvent.click(screen.getByTitle('Header'));
  fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
  fireEvent.click(screen.getByRole('button', { name: 'Join line 2 with previous line' }));
  expect(store.get('contactLayouts.sidebar.rows')[0]).toEqual(['email', 'phone']);
  fireEvent.change(document.querySelector('[data-field="contact.location"]'), { target: { value: 'London' } });
  expect(store.get('contact.location')).toBe('London');
  act(() => { store.undo(); store.undo(); store.undo(); });
  expect(store.get('contactLayouts')).toBeUndefined();
  expect(screen.getByRole('button', { name: 'Automatic' }).getAttribute('aria-pressed')).toBe('true');
});

it('validates contact break metadata while accepting legacy resumes', () => {
  expect(() => assertResumeData(data())).not.toThrow();
  expect(() => assertResumeData({ name: 'Alex' })).not.toThrow();
  expect(() => assertResumeData({ ...data(), contactBreakBefore: 'location' })).toThrow(/contactBreakBefore/);
});
