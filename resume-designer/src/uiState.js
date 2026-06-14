/**
 * Per-variant UI / view state that is NOT part of the document model:
 * the experience accordion's open/closed flags (keyed by experience id) and
 * the experience "Sort by" mode. Persisted separately so it survives reload
 * and variant-switch without polluting the document or undo history.
 */
import { appStorage } from './appStorage.js';
import { store } from './store.js';

export const UI_STATE_PREFIX = 'resume-designer-ui-state-';

const keyFor = (vid) => UI_STATE_PREFIX + vid;

function read(vid) {
  if (!vid) return {};
  try {
    return JSON.parse(appStorage.getItem(keyFor(vid)) || '{}') || {};
  } catch {
    return {};
  }
}
function write(vid, state) {
  if (!vid) return;
  try {
    appStorage.setItem(keyFor(vid), JSON.stringify(state));
  } catch (e) {
    console.warn('Failed to save UI state:', e);
  }
}

// --- sort mode ('date' | 'relevance' | 'custom') ---
export function getSortMode() {
  return read(store.getVariantId()).sortMode || 'date';
}
export function setSortMode(mode) {
  const vid = store.getVariantId();
  const s = read(vid);
  s.sortMode = mode;
  write(vid, s);
}

// --- experience accordion (keyed by experience id; defaults to expanded) ---
export function isExpanded(expId) {
  const expanded = read(store.getVariantId()).expanded || {};
  return expId in expanded ? expanded[expId] !== false : true;
}
export function setExpanded(expId, value) {
  const vid = store.getVariantId();
  const s = read(vid);
  s.expanded = s.expanded || {};
  s.expanded[expId] = value;
  write(vid, s);
}

// Test/maintenance helper: drop a variant's UI state.
export function clearForVariant(vid) {
  if (vid) appStorage.removeItem(keyFor(vid));
}
