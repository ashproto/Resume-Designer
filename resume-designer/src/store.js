/**
 * Resume Store — model-native reactive state.
 *
 * The single source of truth is the document MODEL (ProseMirror doc JSON).
 * The flat résumé shape is a derived bridge: getData()/get() return
 * modelToFlat(model); the legacy flat-path writers (update/addToArray/…) mutate
 * a transient flat then re-derive the model via flatToModel (reusing setByPath /
 * the array helpers verbatim). Undo/redo snapshots are model JSON;
 * getHistoryEntryData() bridges back to flat for the diff view, and loadHistory
 * migrates pre-2.2 flat snapshots. The save callback receives the MODEL, so
 * variant.data persists as model JSON.
 */

import { appStorage } from './appStorage.js';
import { flatToModel, modelToFlat } from './migrateToModel.js';

// Cryptographically-secure random suffix (works in the Tauri custom-scheme
// webview and the browser build alike).
export function randomSuffix() {
  const a = new Uint32Array(2);
  crypto.getRandomValues(a);
  return a[0].toString(36) + a[1].toString(36);
}

export function generateId(prefix = 'item') {
  return `${prefix}-${Date.now()}-${randomSuffix()}`;
}

// Comparable sort key for an experience entry: higher = more recent. (#7, PR#13)
export function experienceSortValue(exp) {
  if (!exp) return 0;
  const raw = String(exp.dates || exp.endDate || '').trim();
  if (!raw) return 0;
  if (/\b(present|current|currently|ongoing|now|to date|till date)\b/i.test(raw)) return 9999 * 12;
  const years = raw.match(/\d{4}/g);
  if (!years || years.length === 0) return 0;
  const year = parseInt(years[years.length - 1], 10);
  const ym = raw.match(/(\d{4})-(\d{1,2})/g);
  let month = 0;
  if (ym && ym.length) {
    month = parseInt(ym[ym.length - 1].split('-')[1], 10) || 0;
  } else if (exp.endDate) {
    const em = String(exp.endDate).match(/(\d{4})-(\d{1,2})/);
    if (em && parseInt(em[1], 10) === year) month = parseInt(em[2], 10) || 0;
  }
  month = Math.min(12, Math.max(0, month));
  return year * 12 + month;
}

function deepClone(obj) {
  return JSON.parse(JSON.stringify(obj));
}

function getByPath(obj, path) {
  return path.split('.').reduce((current, key) => {
    if (current === null || current === undefined) return undefined;
    const match = key.match(/^(\w+)\[(\d+)\]$/);
    if (match) return current[match[1]]?.[parseInt(match[2])];
    return current[key];
  }, obj);
}

function setByPath(obj, path, value) {
  const keys = path.split('.');
  const lastKey = keys.pop();
  let current = obj;
  for (const key of keys) {
    const match = key.match(/^(\w+)\[(\d+)\]$/);
    if (match) {
      current = current[match[1]][parseInt(match[2])];
    } else {
      if (current[key] === undefined) current[key] = {};
      current = current[key];
    }
  }
  const lastMatch = lastKey.match(/^(\w+)\[(\d+)\]$/);
  if (lastMatch) current[lastMatch[1]][parseInt(lastMatch[2])] = value;
  else current[lastKey] = value;
}

// A model is a doc node; a flat résumé is a plain object (name/contact/…).
function isModel(x) {
  return !!x && typeof x === 'object' && x.type === 'doc';
}
// Coerce either shape to a model (adoption-migration for flat inputs).
function toModel(x) {
  return isModel(x) ? deepClone(x) : flatToModel(x || {});
}

const HISTORY_KEY_PREFIX = 'resume-designer-history-';

export const CHANGE_TYPES = {
  INITIAL: 'initial',
  EDIT: 'edit',
  AI: 'ai',
  IMPORT: 'import',
  REORDER: 'reorder',
  ADD: 'add',
  REMOVE: 'remove',
};

function createStore() {
  let model = null;
  let isDirty = false;
  const listeners = new Set();
  let saveCallback = null;
  let saveTimeout = null;
  const SAVE_DEBOUNCE_MS = 500;

  // Undo/redo history; each entry's `data` is MODEL JSON.
  let history = [];
  let historyIndex = -1;
  const MAX_HISTORY = 100;
  let isUndoRedoAction = false;
  let currentVariantId = null;
  let pendingChangeDescription = null;
  let pendingChangeType = CHANGE_TYPES.EDIT;

  return {
    // --- reads (flat bridge) ---
    getData() {
      return model ? modelToFlat(model) : null;
    },
    getDataRef() {
      // NOTE: derived copy, not a live reference — mutating it does not affect the store.
      return model ? modelToFlat(model) : null;
    },
    getModel() {
      return model ? deepClone(model) : null;
    },
    getVariantId() {
      return currentVariantId;
    },

    // --- whole-document set (accepts flat OR model) ---
    setData(newData, skipSave = false, variantId = null) {
      model = toModel(newData);
      isDirty = false;
      if (variantId) {
        currentVariantId = variantId;
        this.loadHistory(variantId);
      }
      if (history.length === 0) {
        history.push({
          data: deepClone(model),
          timestamp: new Date().toISOString(),
          description: 'Initial state',
          changeType: CHANGE_TYPES.INITIAL,
        });
        historyIndex = 0;
      }
      this.emit('dataLoaded', this.getData());
      this.emit('historyChanged', { canUndo: this.canUndo(), canRedo: this.canRedo() });
      if (!skipSave) this.scheduleSave();
    },

    // Set the model directly (model-native callers). Accepts flat too.
    setModel(newModel, skipSave = false) {
      model = toModel(newModel);
      isDirty = true;
      if (!isUndoRedoAction) this.pushHistory();
      this.emit('change', this.getData());
      if (!skipSave) this.scheduleSave();
    },

    // --- flat-path writes (round-trip through flat, re-derive the model) ---
    update(path, value) {
      if (!model) return;
      const flat = modelToFlat(model);
      setByPath(flat, path, value);
      model = flatToModel(flat);
      isDirty = true;
      if (!isUndoRedoAction) this.pushHistory();
      this.emit('fieldUpdated', { path, value });
      this.emit('change', this.getData());
      this.scheduleSave();
    },

    setChangeMetadata(description, changeType = CHANGE_TYPES.EDIT) {
      pendingChangeDescription = description;
      pendingChangeType = changeType;
    },

    pushHistory(description = null, changeType = null) {
      if (!model) return;
      if (historyIndex < history.length - 1) history.splice(historyIndex + 1);
      history.push({
        data: deepClone(model),
        timestamp: new Date().toISOString(),
        description: description || pendingChangeDescription || 'Edit',
        changeType: changeType || pendingChangeType || CHANGE_TYPES.EDIT,
      });
      historyIndex = history.length - 1;
      pendingChangeDescription = null;
      pendingChangeType = CHANGE_TYPES.EDIT;
      if (history.length > MAX_HISTORY) {
        history.shift();
        historyIndex--;
      }
      this.saveHistory();
      this.emit('historyChanged', { canUndo: this.canUndo(), canRedo: this.canRedo() });
    },

    saveHistory() {
      if (!currentVariantId) return;
      try {
        appStorage.setItem(HISTORY_KEY_PREFIX + currentVariantId, JSON.stringify({ history, historyIndex }));
      } catch (e) {
        console.warn('Failed to save history:', e);
      }
    },

    loadHistory(variantId) {
      try {
        const saved = appStorage.getItem(HISTORY_KEY_PREFIX + variantId);
        if (saved) {
          const data = JSON.parse(saved);
          if (data.history && Array.isArray(data.history)) {
            history = data.history.map((entry) =>
              isModel(entry?.data) ? entry : { ...entry, data: flatToModel(entry?.data || {}) });
            historyIndex = data.historyIndex ?? history.length - 1;
            return true;
          }
        }
      } catch (e) {
        console.warn('Failed to load history:', e);
      }
      history = [];
      historyIndex = -1;
      return false;
    },

    canUndo() { return historyIndex > 0; },
    canRedo() { return historyIndex < history.length - 1; },

    undo() {
      if (!this.canUndo()) return false;
      isUndoRedoAction = true;
      historyIndex--;
      model = deepClone(history[historyIndex].data);
      isDirty = true;
      this.saveHistory();
      this.emit('change', this.getData());
      this.emit('historyChanged', { canUndo: this.canUndo(), canRedo: this.canRedo() });
      this.scheduleSave();
      isUndoRedoAction = false;
      return true;
    },

    redo() {
      if (!this.canRedo()) return false;
      isUndoRedoAction = true;
      historyIndex++;
      model = deepClone(history[historyIndex].data);
      isDirty = true;
      this.saveHistory();
      this.emit('change', this.getData());
      this.emit('historyChanged', { canUndo: this.canUndo(), canRedo: this.canRedo() });
      this.scheduleSave();
      isUndoRedoAction = false;
      return true;
    },

    getHistoryEntries() {
      return history.map((entry, index) => ({
        index,
        timestamp: entry.timestamp,
        description: entry.description,
        changeType: entry.changeType,
        isCurrent: index === historyIndex,
      }));
    },

    // Returns FLAT data (bridge) so the History diff view / diffEngine are unchanged.
    getHistoryEntryData(index) {
      if (index >= 0 && index < history.length) return modelToFlat(history[index].data);
      return null;
    },

    restoreToEntry(index) {
      if (index < 0 || index >= history.length) return false;
      isUndoRedoAction = true;
      historyIndex = index;
      model = deepClone(history[historyIndex].data);
      isDirty = true;
      this.saveHistory();
      this.emit('change', this.getData());
      this.emit('historyChanged', { canUndo: this.canUndo(), canRedo: this.canRedo() });
      this.scheduleSave();
      isUndoRedoAction = false;
      return true;
    },

    getHistoryIndex() { return historyIndex; },
    getHistoryLength() { return history.length; },
    clearHistory() {
      history.length = 0;
      historyIndex = -1;
      this.emit('historyChanged', { canUndo: false, canRedo: false });
    },

    get(path) {
      if (!model) return undefined;
      return getByPath(modelToFlat(model), path);
    },

    addToArray(path, item) {
      if (!model) return;
      const flat = modelToFlat(model);
      const arr = getByPath(flat, path);
      if (Array.isArray(arr)) {
        arr.push(item);
        model = flatToModel(flat);
        isDirty = true;
        if (!isUndoRedoAction) this.pushHistory();
        this.emit('arrayItemAdded', { path, item });
        this.emit('change', this.getData());
        this.scheduleSave();
      }
    },

    removeFromArray(path, index) {
      if (!model) return;
      const flat = modelToFlat(model);
      const arr = getByPath(flat, path);
      if (Array.isArray(arr) && index >= 0 && index < arr.length) {
        const removed = arr.splice(index, 1)[0];
        model = flatToModel(flat);
        isDirty = true;
        if (!isUndoRedoAction) this.pushHistory();
        this.emit('arrayItemRemoved', { path, index, item: removed });
        this.emit('change', this.getData());
        this.scheduleSave();
      }
    },

    moveInArray(path, fromIndex, toIndex) {
      if (!model) return;
      const flat = modelToFlat(model);
      const arr = getByPath(flat, path);
      if (Array.isArray(arr) && fromIndex >= 0 && fromIndex < arr.length) {
        const [item] = arr.splice(fromIndex, 1);
        arr.splice(toIndex, 0, item);
        model = flatToModel(flat);
        isDirty = true;
        if (!isUndoRedoAction) this.pushHistory();
        this.emit('arrayItemMoved', { path, fromIndex, toIndex });
        this.emit('change', this.getData());
        this.scheduleSave();
      }
    },

    isDirty() { return isDirty; },
    markSaved() {
      isDirty = false;
      this.emit('saved');
    },

    subscribe(callback) {
      listeners.add(callback);
      return () => listeners.delete(callback);
    },
    emit(event, payload) {
      listeners.forEach((callback) => {
        try {
          callback(event, payload);
        } catch (e) {
          console.error('Store listener error:', e);
        }
      });
    },

    onSave(callback) { saveCallback = callback; },

    scheduleSave() {
      if (saveTimeout) clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        if (saveCallback && isDirty) {
          saveCallback(model);
          this.markSaved();
        }
      }, SAVE_DEBOUNCE_MS);
    },

    saveNow() {
      if (saveTimeout) clearTimeout(saveTimeout);
      if (saveCallback && model) {
        saveCallback(model);
        this.markSaved();
      }
    },
  };
}

export const store = createStore();

// Default empty resume template (flat). Still used as a content seed by callers;
// setData() adopts it into a model.
export const EMPTY_RESUME = {
  name: 'Your Name',
  tagline: 'Your Professional Title',
  contact: {
    location: 'City, State',
    email: 'email@example.com',
    phone: '000-000-0000',
    portfolio: '',
    instagram: '',
  },
  summary: 'A brief professional summary describing your experience and goals.',
  sections: [
    { id: generateId('section'), title: 'Skills', type: 'list', content: ['Skill 1', 'Skill 2', 'Skill 3'] },
  ],
  experience: [
    {
      id: generateId('exp'),
      title: 'Job Title',
      company: 'Company Name',
      dates: 'Start Date – End Date',
      bullets: ['Accomplishment or responsibility', 'Another key achievement'],
    },
  ],
  education: ['Degree — School Name — Dates'],
  tools: 'Tool 1 • Tool 2 • Tool 3',
};
