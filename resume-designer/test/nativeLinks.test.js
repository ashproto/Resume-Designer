import { afterEach, describe, expect, it, vi } from 'vitest';
import { handleNativeLinkClick } from '../src/nativeLinks.js';
import { renderResumeForLayout } from '../src/renderer.js';
import { initInlineEditor, commitActiveInlineEdit } from '../src/inlineEditor.js';
import { store } from '../src/store.js';

afterEach(() => { document.body.innerHTML = ''; });

describe('native external link interception', () => {
  it.each(['https://alex.example', 'mailto:alex@example.com', 'tel:123'])('lets editable contact clicks reach editing without navigating to %s', href => {
    document.body.innerHTML = `<div id="resume"><a data-editable="contact.portfolio" href="${href}"><span>Contact</span></a></div>`;
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const edit = vi.fn();
    const capture = event => handleNativeLinkClick(event, openExternal);
    document.addEventListener('click', capture, true);
    document.getElementById('resume').addEventListener('click', edit);
    try {
      const event = new MouseEvent('click', { bubbles: true, cancelable: true });
      document.querySelector('a span').dispatchEvent(event);
      expect(openExternal).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(true);
      expect(edit).toHaveBeenCalledOnce();
    } finally {
      document.removeEventListener('click', capture, true);
    }
  });

  it('opens ordinary external links outside the native webview', () => {
    document.body.innerHTML = '<div id="resume"><a href="https://example.com"><span>Visit</span></a></div>';
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const event = { target: document.querySelector('a span'), preventDefault: vi.fn() };
    handleNativeLinkClick(event, openExternal);
    expect(openExternal).toHaveBeenCalledExactlyOnceWith('https://example.com');
    expect(event.preventDefault).toHaveBeenCalledOnce();
  });

  it.each(['#section', '/local', '?view=resume'])('leaves local navigation %s alone', href => {
    document.body.innerHTML = `<a href="${href}">Navigate</a>`;
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const event = { target: document.querySelector('a'), preventDefault: vi.fn() };
    handleNativeLinkClick(event, openExternal);
    expect(openExternal).not.toHaveBeenCalled();
    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it('edits rendered contact hyperlinks through the native capture handler', () => {
    const data = {
      name: 'Alex', sections: [], contactOrder: ['portfolio', 'email', 'phone', 'github'],
      contact: { portfolio: 'https://alex.example', email: 'alex@example.com', phone: '123', github: 'https://github.com/alex' },
    };
    store.setData(data, true);
    document.body.innerHTML = `<div id="resume">${renderResumeForLayout(data, 'sidebar')}</div>`;
    const openExternal = vi.fn().mockResolvedValue(undefined);
    const capture = event => handleNativeLinkClick(event, openExternal);
    document.addEventListener('click', capture, true);
    try {
      initInlineEditor();
      for (const field of ['portfolio', 'email', 'phone', 'github']) {
        const contact = document.querySelector(`[data-editable="contact.${field}"]`);
        expect(contact.matches('a[href]')).toBe(true);
        // jsdom does not derive isContentEditable from contentEditable.
        Object.defineProperty(contact, 'isContentEditable', { get: () => contact.contentEditable === 'true' });
        const event = new MouseEvent('click', { bubbles: true, cancelable: true });
        contact.dispatchEvent(event);
        expect(event.defaultPrevented).toBe(true);
        expect(openExternal).not.toHaveBeenCalled();
        expect(contact.contentEditable).toBe('true');
        contact.textContent = `${data.contact[field]} updated`;
        commitActiveInlineEdit();
        expect(store.get(`contact.${field}`)).toBe(`${data.contact[field]} updated`);
      }
    } finally {
      document.removeEventListener('click', capture, true);
      commitActiveInlineEdit();
      store.saveNow();
    }
  });
});
