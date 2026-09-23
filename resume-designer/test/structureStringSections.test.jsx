import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import StructurePanel from '../src/components/structure/StructurePanel.jsx';
import { store } from '../src/store.js';

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '<button id="toggle-structure-panel">Open structure</button><aside id="structure-panel"><div id="structure-panel-content"></div></aside>';
});

afterEach(() => {
  cleanup();
  store.saveNow();
  vi.restoreAllMocks();
});

it.each([undefined, 'text', 'list'])('edits %s string-backed section prose without eager normalization', (type) => {
  const section = { id: 'legacy', title: 'About', area: 'sidebar', content: 'First paragraph.\nSecond paragraph.', extra: { keep: true } };
  if (type !== undefined) section.type = type;
  store.setData({ name: 'Alex', sections: [section] }, true);
  render(<StructurePanel />);
  fireEvent.click(screen.getByText('Open structure'));
  fireEvent.click(screen.getByTitle('Sidebar'));
  const field = document.querySelector('[data-field="sections[0].content"]');
  expect(field?.tagName).toBe('TEXTAREA');
  expect(field.value).toBe(section.content);
  expect(store.get('sections[0]')).toEqual(section);
  fireEvent.change(field, { target: { value: 'Updated first.\nUpdated second.' } });
  expect(store.get('sections[0]')).toEqual({ ...section, content: 'Updated first.\nUpdated second.' });

  // Only the explicit display change converts the whole prose to one list item.
  fireEvent.click(screen.getByText('Bulleted'));
  expect(store.get('sections[0]')).toEqual({ ...section, type: 'list', content: ['Updated first.\nUpdated second.'] });
  expect(document.querySelector('[data-field="sections[0].content[0]"]').value).toBe('Updated first.\nUpdated second.');
  act(() => { store.undo(); });
  expect(store.get('sections[0].content')).toBe('Updated first.\nUpdated second.');
  expect(document.querySelector('[data-field="sections[0].content"]')?.tagName).toBe('TEXTAREA');
});
