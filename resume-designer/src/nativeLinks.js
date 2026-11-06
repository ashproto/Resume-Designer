/** Keep external navigation outside the native webview. */
export function handleNativeLinkClick(event, openExternal) {
  const anchor = event.target.closest?.('a[href]');
  if (!anchor) return;
  if (anchor.closest('#resume [data-editable]')) {
    // Resume links remain hyperlinks in exports, but a tap in the editor edits
    // their text. Cancel navigation and let the event reach the inline editor.
    event.preventDefault();
    return;
  }
  const href = anchor.getAttribute('href');
  if (!href) return;
  if (href.startsWith('#') || href.startsWith('/') || href.startsWith('?')) return;
  if (anchor.target === '_blank' || /^https?:\/\//i.test(href)) {
    event.preventDefault();
    openExternal(href).catch((err) => console.warn('[Link] open failed:', err));
  }
}
