// HTML-escaping helpers shared across the renderer. Pure string functions
// (no DOM, no dependencies) — safe to unit-test and to import anywhere.

// Escape text for safe insertion into HTML element content.
export function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// Escape text for safe insertion into a quoted HTML attribute.
export function escapeAttr(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

// True only for http(s) URLs — used to gate rendered links from model output
// (e.g. web-search citations) so a non-http(s) scheme is never turned into a link.
export function isLikelySafeUrl(url) {
  if (typeof url !== 'string') return false;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:';
  } catch {
    return false;
  }
}
