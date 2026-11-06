import { describe, expect, it } from 'vitest';
import * as contacts from '../src/contactFields.js';
import { renderResumeForLayout } from '../src/renderer.js';
import { assertResumeData } from '../src/resumeValidation.js';

const layouts = ['sidebar', 'stacked', 'stacked-vertical', 'right-sidebar', 'compact', 'executive', 'classic', 'classic-featured', 'modern', 'timeline', 'creative'];
const data = () => ({
  name: 'Alex', sections: [],
  contact: { email: 'alex@example.com', phone: '123', location: 'Paris', portfolio: 'https://alex.example' },
});
const render = (document, layout) => {
  const container = window.document.createElement('div');
  container.innerHTML = renderResumeForLayout(document, layout);
  return container;
};
const fields = element => [...element.querySelectorAll('[data-editable^="contact."]')].map(item => item.dataset.editable.replace('contact.', ''));

describe('template-aware contact layouts', () => {
  it('leaves natural contact rows to the selected template until customized', () => {
    const document = { ...data(), contactOrder: ['phone', 'email'] };
    expect(contacts.getContactLayout(document, 'stacked')).toEqual({ mode: 'auto', source: 'template', rows: [] });
    expect(contacts.getContactPresentation(document, 'stacked')).toBe(document);
  });

  it('keeps a custom row arrangement independently for each layout', () => {
    const initial = data();
    const sidebar = contacts.setContactLayoutRows(initial, 'sidebar', [['email', 'phone'], ['location', 'portfolio']]);
    const classic = contacts.setContactLayoutRows(sidebar, 'classic', [['location'], ['email', 'phone', 'portfolio']]);
    expect(initial.contactLayouts).toBeUndefined();
    expect(contacts.getContactLayout(classic, 'sidebar')).toEqual({ mode: 'custom', source: 'layout', rows: [['email', 'phone'], ['location', 'portfolio']] });
    expect(contacts.getContactLayout(classic, 'classic')).toEqual({ mode: 'custom', source: 'layout', rows: [['location'], ['email', 'phone', 'portfolio']] });
    expect(contacts.getContactLayout(classic, 'modern')).toEqual({ mode: 'auto', source: 'template', rows: [] });
    expect(fields(render(classic, 'sidebar').querySelector('.contact-line'))).toEqual(['email', 'phone']);
    expect(fields(render(classic, 'classic').querySelector('.contact-line'))).toEqual(['location']);
  });

  it('normalizes duplicate and unknown fields, retains empty assignments, and appends new values', () => {
    const document = contacts.setContactLayoutRows(data(), 'sidebar', [['email', 'unknown', 'phone', 'email'], [], ['linkedin', 'location', 'portfolio']]);
    expect(document.contactLayouts.sidebar.rows).toEqual([['email', 'phone'], ['linkedin', 'location', 'portfolio']]);
    const populated = { ...document, contact: { ...document.contact, github: 'https://github.com/alex', linkedin: 'https://linkedin.com/in/alex' } };
    expect(contacts.getContactLayout(populated, 'sidebar').rows).toEqual([['email', 'phone'], ['linkedin', 'location', 'portfolio'], ['github']]);
  });

  it('uses legacy breaks until a layout receives its own override', () => {
    const legacy = { ...data(), contactOrder: ['email', 'phone', 'location', 'portfolio'], contactBreakBefore: ['location'] };
    expect(contacts.getContactLayout(legacy, 'modern')).toEqual({ mode: 'custom', source: 'legacy', rows: [['email', 'phone'], ['location', 'portfolio']] });
    expect(contacts.getContactPresentation(legacy, 'modern')).toBe(legacy);
    const reset = contacts.resetContactLayout(legacy, 'modern');
    expect(contacts.getContactLayout(reset, 'modern')).toEqual({ mode: 'auto', source: 'layout', rows: [] });
    expect(reset.contactBreakBefore).toEqual(['location']);
    expect(contacts.getContactLayout(reset, 'classic').source).toBe('legacy');
    expect(contacts.getContactPresentation(reset, 'modern')).toMatchObject({ contactOrder: undefined, contactBreakBefore: undefined });
    expect(renderResumeForLayout(reset, 'modern')).toBe(renderResumeForLayout(data(), 'modern'));
  });

  it('reset preserves the other layouts and restores natural template presentation', () => {
    const custom = contacts.setContactLayoutRows(contacts.setContactLayoutRows(data(), 'sidebar', [['email', 'phone', 'location', 'portfolio']]), 'classic', [['email'], ['phone', 'location', 'portfolio']]);
    const reset = contacts.resetContactLayout(custom, 'sidebar');
    expect(reset.contactLayouts.sidebar).toEqual({ mode: 'auto' });
    expect(reset.contactLayouts.classic).toEqual({ mode: 'custom', rows: [['email'], ['phone', 'location', 'portfolio']] });
    expect(custom.contactLayouts.sidebar.mode).toBe('custom');
    expect(renderResumeForLayout(reset, 'sidebar')).toBe(renderResumeForLayout(data(), 'sidebar'));
  });

  it.each(['sidebar', 'stacked-vertical'])('renders one custom row as one explicit row in %s', layout => {
    const document = contacts.setContactLayoutRows(data(), layout, [['email', 'phone', 'location', 'portfolio']]);
    const container = render(document, layout);
    expect(container.querySelectorAll('.contact-line')).toHaveLength(1);
    expect(fields(container.querySelector('.contact-line'))).toEqual(['email', 'phone', 'location', 'portfolio']);
  });

  it('keeps separate visible rows when their first assigned field is empty', () => {
    const document = contacts.setContactLayoutRows(data(), 'compact', [['email', 'phone'], ['linkedin', 'location', 'portfolio']]);
    expect([...render(document, 'compact').querySelectorAll('.contact-line')].map(fields)).toEqual([['email', 'phone'], ['location', 'portfolio']]);
  });

  it('marks the first assigned field to force one explicit row when that field is empty', () => {
    const document = contacts.setContactLayoutRows(data(), 'sidebar', [['linkedin', 'email', 'phone', 'location', 'portfolio']]);
    expect(contacts.getContactPresentation(document, 'sidebar').contactBreakBefore).toEqual(['linkedin']);
    expect([...render(document, 'sidebar').querySelectorAll('.contact-line')].map(fields)).toEqual([['email', 'phone', 'location', 'portfolio']]);
  });

  it('uses the fallback layout for unknown layout names', () => {
    const document = contacts.setContactLayoutRows(data(), 'unknown', [['email'], ['phone', 'location', 'portfolio']]);
    expect(document.contactLayouts.sidebar.mode).toBe('custom');
    expect(renderResumeForLayout(document, 'unknown')).toBe(renderResumeForLayout(document, 'sidebar'));
  });
});

describe('natural template contact measurement', () => {
  it.each(layouts)('exposes every populated contact in %s without requiring custom rows', layout => {
    const document = data();
    document.contact = { location: 'Paris', email: 'alex@example.com', phone: '123', portfolio: 'https://alex.example', instagram: '@alex', linkedin: 'https://linkedin.com/in/alex', github: 'https://github.com/alex', twitter: '@alex' };
    const container = render(document, layout);
    expect(fields(container).sort()).toEqual(['email', 'github', 'instagram', 'linkedin', 'location', 'phone', 'portfolio', 'twitter']);
    expect(container.querySelectorAll('.contact-line')).toHaveLength(0);
  });

  it.each(['compact', 'classic', 'classic-featured', 'modern', 'creative'])('escapes automatic %s contacts and refuses executable URLs', layout => {
    const document = { ...data(), contact: { email: 'alex"@example.com', phone: '123"', location: '<img src=x onerror=alert(1)>', portfolio: 'javascript:alert(1)', linkedin: 'https://linkedin.com/in/alex' } };
    const container = render(document, layout);
    expect(container.querySelector('img')).toBeNull();
    expect(container.querySelector('[data-editable="contact.location"]').textContent).toBe('<img src=x onerror=alert(1)>');
    expect(container.querySelector('[data-editable="contact.portfolio"]').getAttribute('href')).toBeNull();
    expect(container.querySelector('[data-editable="contact.linkedin"]').getAttribute('href')).toBe('https://linkedin.com/in/alex');
    expect(container.querySelector('[data-editable="contact.email"]').getAttribute('href')).toBe('mailto:alex"@example.com');
    expect(container.querySelector('[data-editable="contact.phone"]').getAttribute('href')).toBe('tel:123"');
  });
});

describe('contact layout document validation', () => {
  it('accepts automatic and custom layouts with legacy metadata intact', () => {
    expect(() => assertResumeData({ ...data(), contactBreakBefore: ['email'], contactLayouts: { sidebar: { mode: 'auto' }, compact: { mode: 'custom', rows: [['email', 'phone'], ['location']] } } })).not.toThrow();
  });

  it.each([
    { contactLayouts: [] },
    { contactLayouts: { sidebar: null } },
    { contactLayouts: { sidebar: { mode: 'other' } } },
    { contactLayouts: { sidebar: { mode: 'custom' } } },
    { contactLayouts: { sidebar: { mode: 'custom', rows: 'email' } } },
    { contactLayouts: { sidebar: { mode: 'custom', rows: ['email'] } } },
    { contactLayouts: { sidebar: { mode: 'custom', rows: [[1]] } } },
    { contactLayouts: { sidebar: { mode: 'auto', rows: [['email']] } } },
  ])('rejects malformed contact layout metadata %#', metadata => {
    expect(() => assertResumeData({ ...data(), ...metadata })).toThrow(/contactLayouts/);
  });
});
