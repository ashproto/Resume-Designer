/**
 * Variant Manager
 *
 * Framework-agnostic CRUD + selection state for resume variants. This module
 * owns `currentVariantId` and the `onVariantChange` callback that main.js wires
 * (it re-renders the resume + re-syncs the job panel). The React header consumes
 * this through the `useVariants()` hook (subscribe/getSnapshot below); nothing
 * here touches the DOM, so the same logic serves both the React chrome and the
 * non-React callers (onboarding, jobDescriptionPanel).
 *
 * Previously this logic lived inside headerBar.js (which also rendered the
 * header markup imperatively). Step 6 of the React migration extracted it here
 * so the header could become a real component without duplicating variant state.
 */

import { store, generateId, EMPTY_RESUME } from './store.js';
import {
  getVariants,
  getCurrentVariantId,
  setCurrentVariantId,
  saveVariant,
  deleteVariant,
  renameVariant,
  initPersistence,
  importFile,
  exportAsJSON,
  exportAsMarkdown,
  generateUniqueVariantName,
} from './persistence.js';

let currentVariantId = null;
let onVariantChangeCallback = null;

// --- React external-store bridge ---------------------------------------------
// useSyncExternalStore needs a STABLE snapshot reference between renders, so we
// cache `snapshot` and only recompute it inside notify() (on a real change).
// Returning getVariants() directly would deep-read storage every render and the
// fresh object identity would loop the store (the same trap useResumeStore hit).
const subscribers = new Set();
let snapshot = computeSnapshot();

function computeSnapshot() {
  return { currentId: currentVariantId, list: getVariantList() };
}

function notify() {
  snapshot = computeSnapshot();
  subscribers.forEach((cb) => cb());
}

export function subscribeVariants(callback) {
  subscribers.add(callback);
  return () => subscribers.delete(callback);
}

export function getVariantsSnapshot() {
  return snapshot;
}

/**
 * Variants sorted most-recently-modified first (matching the old header order).
 */
export function getVariantList() {
  const variants = getVariants();
  return Object.values(variants).sort((a, b) => {
    const dateA = a.updatedAt || a.createdAt || '';
    const dateB = b.updatedAt || b.createdAt || '';
    return dateB.localeCompare(dateA);
  });
}

// --- Initialization ----------------------------------------------------------

/**
 * Wire the variant-change callback, then load the persisted current variant.
 * Returns the active variant id (or null on a fresh install).
 */
export function initVariants(onVariantChange) {
  onVariantChangeCallback = onVariantChange;
  currentVariantId = getCurrentVariantId();

  if (currentVariantId) {
    loadVariant(currentVariantId);
  } else {
    // No persisted selection yet; still publish an initial snapshot so any
    // already-mounted subscriber renders the (possibly empty) list.
    notify();
  }

  return currentVariantId;
}

export function getCurrentId() {
  return currentVariantId;
}

// --- CRUD --------------------------------------------------------------------

/**
 * Load a variant into the store. `store.setData(.., skipSave=true, id)` avoids a
 * redundant save and tags the history with the variant id. The onVariantChange
 * callback (main.js) re-renders the resume + re-syncs the job panel; the store's
 * own `dataLoaded` event also re-renders, so a fresh variant paints either way.
 */
export function loadVariant(id) {
  const variants = getVariants();
  const variant = variants[id];
  if (!variant) return false;

  currentVariantId = id;
  setCurrentVariantId(id);
  store.setData(variant.data, true, id);
  initPersistence(id);

  if (onVariantChangeCallback) {
    onVariantChangeCallback(variant);
  }

  notify();
  return true;
}

export function createVariant(name, data = null) {
  const id = generateId('variant');
  const variantData = data || JSON.parse(JSON.stringify(EMPTY_RESUME));

  saveVariant(id, name, variantData);
  loadVariant(id); // notifies (snapshot includes the new variant + selection)

  return id;
}

export function duplicateVariant() {
  const variants = getVariants();
  const current = variants[currentVariantId];
  if (!current) return null;

  const baseName = `${current.name} (Copy)`;
  const newName = generateUniqueVariantName(baseName, variants);
  const newData = JSON.parse(JSON.stringify(current.data));
  return createVariant(newName, newData);
}

/**
 * Delete the active variant, unconditionally — confirmation now lives in the
 * caller (the React header owns a shadcn AlertDialog; spec §2.3-11). Last-variant
 * protection is preserved here as a guard so no surface can ever delete the only
 * variant: callers should disable their delete control in that case, but this is
 * the backstop.
 *
 * @returns {{ ok: true } | { ok: false, reason: 'last-variant' }}
 */
export function deleteCurrentVariant() {
  const variants = getVariants();
  if (Object.keys(variants).length <= 1) {
    return { ok: false, reason: 'last-variant' };
  }

  const newCurrentId = deleteVariant(currentVariantId);
  if (newCurrentId) {
    loadVariant(newCurrentId); // notifies
  } else {
    notify();
  }
  return { ok: true };
}

/**
 * Rename the active variant. The name now arrives from the caller (the React
 * header collects it via a shadcn Dialog), replacing the old prompt() modal.
 */
export function renameCurrentVariant(newName) {
  const variants = getVariants();
  const current = variants[currentVariantId];
  if (!current) return false;

  const trimmed = (newName || '').trim();
  if (!trimmed) return false;

  renameVariant(currentVariantId, trimmed);
  notify();
  return true;
}

export async function importVariant(file) {
  try {
    const data = await importFile(file);
    const name = file.name.replace(/\.(json|md|markdown)$/i, '');
    createVariant(name, data);
    return true;
  } catch (err) {
    alert('Import failed: ' + err.message);
    return false;
  }
}

export function exportCurrentVariant(format = 'json') {
  const variants = getVariants();
  const current = variants[currentVariantId];
  if (!current) return;

  const filename = `${current.name.replace(/[^a-z0-9]/gi, '-')}`;
  if (format === 'json') {
    exportAsJSON(current.data, `${filename}.json`);
  } else {
    exportAsMarkdown(current.data, `${filename}.md`);
  }
}
