import { CONTACT_FIELDS } from './contactFields.js';

// Read the real header after template layout, font sizing and natural wrapping.
// Intersect vertical bounds rather than comparing exact tops: mixed font sizes
// can share a baseline while their bounding boxes begin at different positions.
export function readRenderedContactRows(container) {
  if (!container && typeof document !== 'undefined') container = document.getElementById('resume');
  const header = container?.matches?.('.resume-header') ? container : container?.querySelector?.('.resume-header');
  if (!header) return null;
  const seen = new Set();
  const rows = [];
  let band = null;
  for (const item of header.querySelectorAll('[data-editable^="contact."]')) {
    const field = item.getAttribute('data-editable').slice('contact.'.length);
    if (!Object.hasOwn(CONTACT_FIELDS, field) || seen.has(field)) continue;
    const rect = item.getBoundingClientRect();
    if (!(rect.width > 0 && rect.height > 0) || !Number.isFinite(rect.top) || !Number.isFinite(rect.bottom)) continue;
    seen.add(field);
    if (!band || rect.top >= band.bottom - 0.5 || rect.bottom <= band.top + 0.5) {
      rows.push([]);
      band = { top: rect.top, bottom: rect.bottom };
    } else {
      band.top = Math.max(band.top, rect.top);
      band.bottom = Math.min(band.bottom, rect.bottom);
    }
    rows.at(-1).push(field);
  }
  return rows.length ? rows : null;
}
