import { describe, it, expect, beforeEach } from 'vitest';
import { store, EMPTY_RESUME } from '../src/store.js';
import { modelToFlat } from '../src/migrateToModel.js';
import { appStorage } from '../src/appStorage.js';

const FLAT = () => JSON.parse(JSON.stringify(EMPTY_RESUME));

describe('store (model-native)', () => {
  beforeEach(() => {
    store.clearHistory();
    store.setData(FLAT(), true, null);
  });

  it('getData() returns the flat shape; getModel() returns a doc', () => {
    expect(store.getData().name).toBe(EMPTY_RESUME.name);
    expect(store.getModel().type).toBe('doc');
  });

  it('adopts a flat input into a model', () => {
    expect(store.getModel().type).toBe('doc');
  });

  it('accepts a model input directly (idempotent adoption)', () => {
    const model = store.getModel();
    store.setData(model, true, null);
    expect(store.getData().name).toBe(EMPTY_RESUME.name);
    expect(store.getModel().type).toBe('doc');
  });

  it('update(path,value) writes through the model', () => {
    store.update('name', 'Ada');
    expect(store.getData().name).toBe('Ada');
    expect(modelToFlat(store.getModel()).name).toBe('Ada');
  });

  it('history snapshots are model JSON; getHistoryEntryData returns FLAT', () => {
    store.update('summary', 'Hello');
    const idx = store.getHistoryIndex();
    const entry = store.getHistoryEntryData(idx);
    expect(entry.summary).toBe('Hello');
    expect(entry.type).toBeUndefined();
  });

  it('undo/redo restore the model', () => {
    store.update('name', 'A');
    store.update('name', 'B');
    store.undo();
    expect(store.getData().name).toBe('A');
    store.redo();
    expect(store.getData().name).toBe('B');
  });

  it('array ops bridge to the model', () => {
    store.addToArray('education', 'New Degree');
    expect(store.getData().education).toContain('New Degree');
    store.removeFromArray('education', store.getData().education.length - 1);
    expect(store.getData().education).not.toContain('New Degree');
  });

  it('hands FLAT (importable) data to the save callback — stable on-disk shape', () => {
    let saved = null;
    store.onSave((d) => { saved = d; });
    store.update('name', 'Z');
    store.saveNow();
    // variant.data must stay flat: importFromJSON validates name+contact; markdown reads data.name.
    expect(saved.type).toBeUndefined();      // NOT a model doc
    expect(saved.name).toBe('Z');
    expect(saved.contact).toBeDefined();
  });

  it('migrates a pre-2.2 FLAT history snapshot on load', () => {
    const vid = 'vmigrate';
    appStorage.setItem(
      'resume-designer-history-' + vid,
      JSON.stringify({ history: [{ data: FLAT(), timestamp: 't', description: 'old', changeType: 'edit' }], historyIndex: 0 }),
    );
    store.setData(FLAT(), true, vid);
    expect(store.getHistoryEntryData(0).name).toBe(EMPTY_RESUME.name);
    expect(() => store.restoreToEntry(0)).not.toThrow();
    expect(store.getModel().type).toBe('doc');
    appStorage.removeItem('resume-designer-history-' + vid);
  });

  it('updateSilent is gone', () => {
    expect(store.updateSilent).toBeUndefined();
  });
});
