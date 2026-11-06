import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import ContactLayoutEditor from '../src/components/structure/ContactLayoutEditor.jsx';

const fixture = () => ({ name: 'Alex', contact: { email: 'alex@example.com', phone: '123', location: 'Paris' } });
beforeEach(() => {
  document.body.innerHTML = '<div id="resume"><header class="resume-header"></header></div>';
  for (const [field, top] of [['email', 10], ['phone', 10], ['location', 30]]) {
    const el = document.createElement('span'); el.dataset.editable = `contact.${field}`;
    el.getBoundingClientRect = () => ({ top, bottom: top + 15, height: 15, width: 100 });
    document.querySelector('.resume-header').append(el);
  }
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

it('starts customization from the actual visible template rows', () => {
  const change = vi.fn();
  render(<ContactLayoutEditor data={fixture()} layout="classic" onChange={change} />);
  expect(screen.getByRole('button', { name: 'Automatic' }).getAttribute('aria-pressed')).toBe('true');
  expect(screen.getByRole('group', { name: 'Line 1 contacts' }).textContent).toContain('alex@example.com');
  fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
  expect(change.mock.calls[0][0].contactLayouts.classic).toEqual({ mode: 'custom', rows: [['email', 'phone'], ['location']] });
});

it('joins and splits rows and resets only the selected layout', () => {
  const change = vi.fn();
  const data = { ...fixture(), contactLayouts: { classic: { mode: 'custom', rows: [['email', 'phone'], ['location']] }, sidebar: { mode: 'custom', rows: [['email'], ['phone'], ['location']] } } };
  const view = render(<ContactLayoutEditor data={data} layout="classic" onChange={change} />);
  fireEvent.click(screen.getByRole('button', { name: 'Join line 2 with previous line' }));
  expect(change.mock.calls.at(-1)[0].contactLayouts.classic.rows).toEqual([['email', 'phone', 'location']]);
  view.rerender(<ContactLayoutEditor data={change.mock.calls.at(-1)[0]} layout="classic" onChange={change} />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Arrange Location' }), { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('menuitem', { name: 'New line before Location' }));
  expect(change.mock.calls.at(-1)[0].contactLayouts.classic.rows).toEqual([['email', 'phone'], ['location']]);
  fireEvent.click(screen.getByRole('button', { name: 'Automatic' }));
  expect(change.mock.calls.at(-1)[0].contactLayouts.classic).toEqual({ mode: 'auto' });
  expect(change.mock.calls.at(-1)[0].contactLayouts.sidebar).toEqual(data.contactLayouts.sidebar);
});

it('moves items within and between rows without changing contact values', () => {
  const change = vi.fn();
  const data = { ...fixture(), contactLayouts: { classic: { mode: 'custom', rows: [['email', 'phone'], ['location']] } } };
  const view = render(<ContactLayoutEditor data={data} layout="classic" onChange={change} />);
  fireEvent.click(screen.getByRole('button', { name: 'Move Phone left' }));
  expect(change.mock.calls.at(-1)[0].contactLayouts.classic.rows[0]).toEqual(['phone', 'email']);
  view.rerender(<ContactLayoutEditor data={change.mock.calls.at(-1)[0]} layout="classic" onChange={change} />);
  fireEvent.keyDown(screen.getByRole('button', { name: 'Arrange Location' }), { key: 'ArrowDown' });
  fireEvent.click(screen.getByRole('menuitem', { name: 'Move Location to line 1' }));
  expect(change.mock.calls.at(-1)[0].contactLayouts.classic.rows).toEqual([['phone', 'email', 'location']]);
  expect(change.mock.calls.at(-1)[0].contact).toEqual(data.contact);
});

it('waits for actual layout before customizing and updates its preview after wrapping changes', async () => {
  document.getElementById('resume').innerHTML = '';
  const change = vi.fn();
  render(<ContactLayoutEditor data={fixture()} layout="sidebar" onChange={change} />);
  expect(screen.getByRole('button', { name: 'Customize' }).disabled).toBe(true);
  const header = document.createElement('header'); header.className = 'resume-header';
  const el = document.createElement('span'); el.dataset.editable = 'contact.email';
  el.getBoundingClientRect = () => ({ top: 1, bottom: 16, height: 15, width: 100 });
  header.append(el);
  await act(async () => { document.getElementById('resume').append(header); });
  expect((await screen.findByRole('group', { name: 'Line 1 contacts' })).textContent).toContain('alex@example.com');
  expect(screen.getByRole('button', { name: 'Customize' }).disabled).toBe(false);
});

it('uses the latest contact values while the surrounding uncontrolled form stays mounted', async () => {
  let current = fixture();
  const change = vi.fn();
  render(<ContactLayoutEditor data={fixture()} readData={() => current} layout="classic" onChange={change} />);
  current = { ...current, contact: { ...current.contact, email: 'updated@example.com' } };
  await act(async () => { document.querySelector('[data-editable="contact.email"]').textContent = 'updated@example.com'; });
  expect(screen.getByTitle('updated@example.com').textContent).toBe('updated@example.com');
  fireEvent.click(screen.getByRole('button', { name: 'Customize' }));
  expect(change.mock.calls.at(-1)[0].contact.email).toBe('updated@example.com');
});
