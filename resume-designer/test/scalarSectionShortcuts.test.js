import { afterEach, beforeEach, expect, it, vi } from 'vitest';

let store, editor, field;

beforeEach(async () => {
  vi.resetModules();
  localStorage.clear();
  document.body.innerHTML = '<div id="resume"><p data-editable="sections[0].content" data-multiline="true"></p></div>';
  ({ store } = await import('../src/store.js'));
  editor = await import('../src/inlineEditor.js');
  store.setData({ name: 'Alex', sections: [{ title: 'About', content: 'First\nSecond', extra: 'keep' }] }, true);
  field = document.querySelector('[data-editable]');
  Object.defineProperty(field, 'isContentEditable', { get: () => field.contentEditable === 'true' });
  editor.initInlineEditor();
  field.click();
});

afterEach(() => {
  store.saveNow();
  vi.restoreAllMocks();
});

function select(startNode, start, endNode = startNode, end = start) {
  const range = document.createRange();
  range.setStart(startNode, start);
  range.setEnd(endNode, end);
  const selection = window.getSelection();
  selection.removeAllRanges();
  selection.addRange(range);
}

function shortcut(key) {
  field.dispatchEvent(new KeyboardEvent('keydown', { key, metaKey: true, bubbles: true, cancelable: true }));
  editor.commitActiveInlineEdit();
  return store.get('sections[0].content');
}

it.each([['b', '**'], ['i', '_'], ['u', '++']])('keeps browser-created newlines through Cmd+%s', (key, marker) => {
  field.innerHTML = 'First<div>Second</div>';
  select(field, 0, field, field.childNodes.length);
  expect(shortcut(key)).toBe(`${marker}First\nSecond${marker}`);
  expect(store.get('sections[0].extra')).toBe('keep');
});

it('formats only the selected text after a block newline', () => {
  field.innerHTML = 'First<div>Second</div>';
  const second = field.querySelector('div').firstChild;
  select(second, 0, second, 6);
  expect(shortcut('b')).toBe('First\n**Second**');
});

it('keeps the caret after line breaks and blank lines', () => {
  field.innerHTML = '<div>First</div><div><br></div><div>Second</div>';
  const second = field.lastChild.firstChild;
  select(second, 3);
  expect(shortcut('b')).toBe('First\n\nSec****ond');
});

it('keeps BR line breaks and existing native emphasis outside the selection', () => {
  field.innerHTML = '<b>First</b><br>Second';
  const second = field.lastChild;
  select(second, 0, second, 6);
  expect(shortcut('i')).toBe('**First**\n_Second_');
});

it('maps a selection inside existing native emphasis to its serialized markers', () => {
  field.innerHTML = 'First<div><b>Second</b></div>';
  const second = field.querySelector('b').firstChild;
  select(second, 0, second, 6);
  expect(shortcut('i')).toBe('First\n**_Second_**');
});
