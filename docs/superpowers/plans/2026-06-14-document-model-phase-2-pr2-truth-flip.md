# Document Model Phase 2 · PR 2.2 — Truth-Flip — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the document model the store's single in-memory + persisted source of truth, with the app looking and behaving **identically** (the legacy flat-path editors/renderer keep working through a `modelToFlat`/`flatToModel` bridge).

**Architecture:** `store.js` holds the **model** (ProseMirror doc JSON). `getData()`/`get()` return `modelToFlat(model)`; the legacy flat-path writers (`update`/`addToArray`/`removeFromArray`/`moveInArray`) mutate a transient flat and re-derive the model via `flatToModel` — reusing the existing `setByPath`/array logic verbatim. Undo/redo snapshots become model JSON (`getHistoryEntryData()` bridges back to flat so the diff view is untouched; pre-2.2 on-disk flat snapshots are migrated on load). Three non-modeled fields move out of the document: `_expanded` + `experienceSortMode` → a new per-variant **UI-state** store; `relevanceRank` → an `experienceItem` model attr. Persistence is unchanged except that the store now hands the model to the save callback (so `variant.data` becomes model JSON) and a new UI-state key joins the backup envelope.

**Tech Stack:** `prosemirror-model` (via the existing `migrateToModel`), Vitest ^4 (`vitest run`), jsdom ^29. All npm commands run from `resume-designer/`.

**Source spec:** `docs/superpowers/specs/2026-06-14-document-model-phase-2-design.md` (§6, §11 PR 2.2). PR 2.1 (schema + lossless `flat⇄model` migration) is DONE on `feat/document-model`.

---

## Background the implementer needs

**The flip in one breath.** Today `store.js` holds a flat object and every consumer reads/writes it by flat path. After this PR the store holds the *model*; reads go through `modelToFlat(model)` and flat-path writes round-trip through flat (`modelToFlat` → mutate → `flatToModel`). Because PR 2.1's migration is **lossless**, this is transparent: `getData()` returns the same flat shape consumers already expect, so the renderer, inline editor, AI apply, and StructurePanel keep working **unchanged**.

**Why the app stays identical.** No editor or renderer changes in this PR. The only user-visible code that changes is StructurePanel's accordion/sort wiring (Task 3), and that's a like-for-like swap from `store.updateSilent(...)` to a UI-state API — same behavior.

**The audit (already done) found exactly three fields that live in flat résumé data but NOT in the model** — they would be silently dropped by the flip, so each is handled:
- `experience[N]._expanded` (accordion open/closed) and `experienceSortMode` (sort choice) — transient view state, today kept out of undo via `store.updateSilent`. → **Move to a per-variant UI-state store** (Task 2 builds it, Task 3 adopts it). `_expanded` is re-keyed by experience **id** (stable across reorder) instead of array index.
- `experience[N]._relevanceRank` (AI ordering, set once at onboarding, read by sort-by-relevance) — → **becomes an `experienceItem` model attr** carried by the migration (Task 1); the flat side stays `_relevanceRank`, so StructurePanel/onboarding don't change.

**Ordering matters (keeps every task green):** Task 1 (relevanceRank attr) and Task 2 (UI-state, dormant) are non-behavioral. Task 3 moves StructurePanel onto UI-state **while the store is still flat** — so after it, *nothing* calls `store.updateSilent`. Only then does Task 4 rewrite the store (and delete `updateSilent`). Task 5 verifies.

**Scope guards — do NOT:** mount TipTap, touch `renderer.js`/`inlineEditor.js`, change any layout, or alter the AI schemas (all are PR 2.3+). The gate is "identical behavior, model-backed."

**Commit conventions (commitlint in CI):** subject starts lowercase; scope `model` (schema/migration), `store`, or `ui`; body lines ≤100 chars; footer on every commit:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

**Plan line numbers are indicative** (PR 2.1 shifted some). Locate targets by identifier.

---

## Task 1: `relevanceRank` becomes an `experienceItem` model attr

**Files:**
- Modify: `resume-designer/src/documentModel.js` (`experienceItem` gains a `relevanceRank` attr)
- Modify: `resume-designer/src/migrateToModel.js` (`experienceItemNode` writes it; `modelToFlat` reads it back)
- Test: `resume-designer/test/migrateToModel.test.js`

The flat side stays `experience[N]._relevanceRank` (so StructurePanel's sort and onboarding are untouched); the model carries it as `relevanceRank` (default `null`), emitted back to flat only when present (so the six golden round-trips — none of which have it — stay byte-for-byte).

- [ ] **Step 1: Add the failing tests**

In `test/migrateToModel.test.js`, add:

```javascript
describe('experience relevanceRank', () => {
  it('carries _relevanceRank into the experienceItem attr and back', () => {
    const flat = { ...SPARSE, experience: [{ id: 'e1', title: 'Dev', company: 'Co', dates: '2020', bullets: [], _relevanceRank: 2 }] };
    const exp = flatToModel(flat).content.find((n) => n.attrs?.sectionKind === 'experience')
      .content.find((n) => n.type === 'experienceItem');
    expect(exp.attrs.relevanceRank).toBe(2);
    expect(modelToFlat(flatToModel(flat)).experience[0]._relevanceRank).toBe(2);
  });
  it('omits _relevanceRank when absent (round-trip unchanged)', () => {
    const back = modelToFlat(flatToModel(POPULATED)); // POPULATED has no _relevanceRank
    expect('_relevanceRank' in back.experience[0]).toBe(false);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test`
Expected: FAIL — `experienceItem` has no `relevanceRank` attr; `flatToModel` ignores `_relevanceRank`.

- [ ] **Step 3: Add the attr in `src/documentModel.js`**

In the `experienceItem` node, extend its attrs (keep `content`/`toDOM`/`parseDOM` as they are):

```javascript
    experienceItem: {
      group: 'block',
      attrs: { id: { default: '' }, relevanceRank: { default: null } },
      content: 'jobTitle company dates bulletList?',
      toDOM: (n) => ['div', { class: 'exp', 'data-id': n.attrs.id }, 0],
      parseDOM: [{ tag: 'div.exp', getAttrs: (el) => ({ id: el.getAttribute('data-id') || '' }) }],
    },
```

- [ ] **Step 4: Carry it in `src/migrateToModel.js`**

In `experienceItemNode`, set the attr from the flat field:

```javascript
const experienceItemNode = (e) => ({
  type: 'experienceItem',
  attrs: { id: e.id ?? '', relevanceRank: Number.isFinite(e._relevanceRank) ? e._relevanceRank : null },
  content: [
    field('jobTitle', e.title ?? ''),
    field('company', e.company ?? ''),
    field('dates', e.dates ?? ''),
    ...(e.bullets?.length
      ? [{ type: 'bulletList', content: e.bullets.map((b) => ({ type: 'listItem', content: [para(b)] })) }]
      : []),
  ],
});
```

In `modelToFlat`, in the `kind === 'experience'` mapper, conditionally re-emit `_relevanceRank` (so absent stays absent):

```javascript
      flat.experience = blocksOfType(s, 'experienceItem').map((it) => {
        const e = {
          id: it.attrs?.id ?? '',
          title: textOf(childOfType(it, 'jobTitle')),
          company: textOf(childOfType(it, 'company')),
          dates: textOf(childOfType(it, 'dates')),
          bullets: ((childOfType(it, 'bulletList')?.content) ?? [])
            .filter((li) => li.type === 'listItem')
            .map((li) => textOf((li.content ?? [])[0])),
        };
        if (Number.isFinite(it.attrs?.relevanceRank)) e._relevanceRank = it.attrs.relevanceRank;
        return e;
      });
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run test`
Expected: PASS — the two new tests green; all six golden round-trips still green.

- [ ] **Step 6: Commit**

```bash
git add resume-designer/src/documentModel.js resume-designer/src/migrateToModel.js \
        resume-designer/test/migrateToModel.test.js
git commit -m "feat(model): carry experience relevanceRank as an experienceItem attr" \
  -m "AI ordering (flat experience[N]._relevanceRank) becomes a model attr so it survives the truth-flip; emitted back to flat only when present, so golden round-trips are unchanged." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Per-variant UI-state store (dormant) + `store.getVariantId()` + backup key

**Files:**
- Create: `resume-designer/src/uiState.js`
- Modify: `resume-designer/src/store.js` (add `getVariantId()` accessor — the current flat store)
- Modify: `resume-designer/src/persistence.js` (own the UI-state key in the backup envelope)
- Test: `resume-designer/test/uiState.test.js`

UI-state holds the two view-state fields outside the document, persisted per-variant at `resume-designer-ui-state-<variantId>`, keyed by experience **id** for `expanded`. It's dormant until Task 3 adopts it.

- [ ] **Step 1: Add `getVariantId()` to the store**

In `resume-designer/src/store.js`, next to `getDataRef()`, add an accessor for the tracked variant id (the closure var `currentVariantId` already exists):

```javascript
    // Current variant id (used by the per-variant UI-state store).
    getVariantId() {
      return currentVariantId;
    },
```

- [ ] **Step 2: Write the failing UI-state test**

Create `resume-designer/test/uiState.test.js`:

```javascript
import { describe, it, expect, beforeEach } from 'vitest';
import { store, EMPTY_RESUME } from '../src/store.js';
import * as ui from '../src/uiState.js';

beforeEach(() => {
  // Point the store (hence uiState) at a clean test variant.
  store.clearHistory();
  store.setData(JSON.parse(JSON.stringify(EMPTY_RESUME)), true, 'vtest');
  // Wipe this variant's UI-state between tests.
  ui.clearForVariant('vtest');
});

describe('uiState', () => {
  it('defaults sort mode to "date" and round-trips a set', () => {
    expect(ui.getSortMode()).toBe('date');
    ui.setSortMode('relevance');
    expect(ui.getSortMode()).toBe('relevance');
  });
  it('defaults an experience to expanded and round-trips a collapse', () => {
    expect(ui.isExpanded('e1')).toBe(true);
    ui.setExpanded('e1', false);
    expect(ui.isExpanded('e1')).toBe(false);
    expect(ui.isExpanded('e2')).toBe(true); // unrelated id still defaults
  });
  it('scopes state per variant', () => {
    ui.setSortMode('custom');
    store.setData(JSON.parse(JSON.stringify(EMPTY_RESUME)), true, 'vother');
    expect(ui.getSortMode()).toBe('date'); // different variant
    store.setData(JSON.parse(JSON.stringify(EMPTY_RESUME)), true, 'vtest');
    expect(ui.getSortMode()).toBe('custom');
  });
});
```

- [ ] **Step 3: Run to verify failure**

Run: `npm run test`
Expected: FAIL — `../src/uiState.js` does not exist.

- [ ] **Step 4: Create `resume-designer/src/uiState.js`**

```javascript
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
```

- [ ] **Step 5: Own the UI-state key in the backup envelope**

In `resume-designer/src/persistence.js`, add a prefix constant next to `BACKUP_HISTORY_PREFIX` and include it in `isOwnedKey` so backups round-trip UI state:

```javascript
// Per-variant UI/view state (accordion, sort mode), one key per variant.
const BACKUP_UISTATE_PREFIX = 'resume-designer-ui-state-';
```

Then update `isOwnedKey`:

```javascript
export function isOwnedKey(key) {
  return BACKUP_FIXED_KEYS.includes(key)
    || key.startsWith(BACKUP_HISTORY_PREFIX)
    || key.startsWith(BACKUP_UISTATE_PREFIX);
}
```

- [ ] **Step 6: Run to verify pass**

Run: `npm run test`
Expected: PASS — uiState tests green; everything else green.

- [ ] **Step 7: Commit**

```bash
git add resume-designer/src/uiState.js resume-designer/src/store.js \
        resume-designer/src/persistence.js resume-designer/test/uiState.test.js
git commit -m "feat(ui): per-variant ui-state store for accordion + sort mode" \
  -m "New uiState module persists view-state outside the document (keyed by variant; expanded keyed by experience id). Adds store.getVariantId() and owns the ui-state key in backups. Dormant until StructurePanel adopts it." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: StructurePanel reads accordion + sort from UI-state (while the store is still flat)

**Files:**
- Modify: `resume-designer/src/components/structure/StructurePanel.jsx`

After this task **nothing calls `store.updateSilent`** and StructurePanel writes only modeled fields into résumé data. Behavior is identical (accordion + sort work the same), now via `uiState`. This is a React UI change — verify with the preview, not a unit test.

- [ ] **Step 1: Import uiState**

At the top of `StructurePanel.jsx`, add to the imports (next to the `store` import):

```javascript
import * as uiState from '../../uiState.js';
```

- [ ] **Step 2: Accordion → uiState in `ExperienceItem`**

Replace the `_expanded` state seed and the `toggle` handler:

```javascript
function ExperienceItem({ exp, index }) {
  const expId = exp.id || `exp-${index}`;
  const [expanded, setExpanded] = useState(() => uiState.isExpanded(expId));
  const toggle = () => {
    const next = !expanded;
    setExpanded(next);
    uiState.setExpanded(expId, next); // view state — outside the document/history
  };
```

(Leave the rest of `ExperienceItem` unchanged.)

- [ ] **Step 3: Drop `_expanded` from the new-experience payload**

In the "Add experience" button's `onClick` (the `store.addToArray('experience', {...})` call), remove the `_expanded: true` property — the UI-state default is expanded:

```javascript
                onClick={() => store.addToArray('experience', { id: generateId('exp'), title: 'New Position', company: 'Company Name', dates: 'Start – End', bullets: ['Describe your accomplishments'] })}
```

- [ ] **Step 4: Sort mode → uiState**

Replace the four `experienceSortMode` touchpoints. The `useState` seed:

```javascript
  const [sortMode, setSortMode] = useState(() => uiState.getSortMode());
```

In the panel-open / store-subscription effect, replace both `store.getData()?.experienceSortMode || 'date'` reads with `uiState.getSortMode()`:

```javascript
  useEffect(() => {
    if (!open) return undefined;
    setSortMode(uiState.getSortMode());
    return store.subscribe((event) => {
      if (event === 'change' || event === 'dataLoaded') {
        if (localEdit) return;
        setSortMode(uiState.getSortMode());
        bump();
      }
    });
  }, [open]);
```

In `applySort`, replace the persist line:

```javascript
  const applySort = (mode) => {
    setSortMode(mode);
    uiState.setSortMode(mode); // view state — no history/remount
    if (mode === 'custom') return;
    const experience = store.get('experience');
    if (!Array.isArray(experience) || experience.length < 2) return;
    const sorted = [...experience];
    if (mode === 'relevance') {
      const rank = (e) => (Number.isFinite(e?._relevanceRank) ? e._relevanceRank : Number.MAX_SAFE_INTEGER);
      sorted.sort((a, b) => rank(a) - rank(b));
    } else {
      sorted.sort((a, b) => experienceSortValue(b) - experienceSortValue(a));
    }
    store.update('experience', sorted);
  };
```

In `reorderExperience`, replace the persist line:

```javascript
  const reorderExperience = (from, to) => {
    setSortMode('custom');
    uiState.setSortMode('custom');
    store.moveInArray('experience', from, to);
  };
```

- [ ] **Step 5: Confirm no `updateSilent` / `_expanded` data reads remain**

Run (from `resume-designer/`):

```bash
grep -rn "updateSilent\|experienceSortMode\|_expanded" src
```

Expected: NO matches in `StructurePanel.jsx` (the only remaining `_relevanceRank` reference is the `rank` helper in `applySort`, which is fine — it reads the flat field). If `updateSilent` still appears anywhere in `src`, report it (the store task removes the method).

- [ ] **Step 6: Lint + build + verify in the preview**

Run: `npm run lint && npm run build` — expect clean.

Then verify behavior (preview tools, fabricated data only — never the real OpenRouter key or real résumé content; restore `localStorage` after): open the Structure panel → Main tab; collapse an experience item, collapse another, switch tabs and back → collapse state persists; reload the app → collapse state persists; change "Sort by" to Relevance then Custom → order updates and the choice persists across reload; switch variants → each variant remembers its own sort + collapse state.

- [ ] **Step 7: Commit**

```bash
git add resume-designer/src/components/structure/StructurePanel.jsx
git commit -m "feat(ui): drive experience accordion + sort from ui-state, not résumé data" \
  -m "StructurePanel reads/writes _expanded (now keyed by experience id) and the sort mode via the uiState store instead of store.updateSilent on résumé data — so the truth-flip can't drop them. Behavior unchanged." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Rewrite `store.js` to be model-native (the flip)

**Files:**
- Modify (wholesale): `resume-designer/src/store.js`
- Test: `resume-designer/test/store.test.js`

The store's truth becomes the model. `getData()`/`get()` bridge via `modelToFlat`; the flat-path writers round-trip through flat; history snapshots are model JSON with a `modelToFlat` read bridge and a flat→model load migration; `updateSilent` is removed (no callers after Task 3); the save callback receives the **model** (so `variant.data` persists as model JSON). The app behaves identically.

- [ ] **Step 1: Write the failing store test suite**

Create `resume-designer/test/store.test.js`:

```javascript
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
    expect(store.getModel().type).toBe('doc'); // setData(FLAT) already adopted
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
    expect(entry.summary).toBe('Hello'); // flat shape
    expect(entry.type).toBeUndefined();  // NOT a model
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

  it('hands the MODEL to the save callback', () => {
    let saved = null;
    store.onSave((d) => { saved = d; });
    store.update('name', 'Z');
    store.saveNow();
    expect(saved.type).toBe('doc');
  });

  it('migrates a pre-2.2 FLAT history snapshot on load', () => {
    const vid = 'vmigrate';
    appStorage.setItem(
      'resume-designer-history-' + vid,
      JSON.stringify({ history: [{ data: FLAT(), timestamp: 't', description: 'old', changeType: 'edit' }], historyIndex: 0 }),
    );
    store.setData(FLAT(), true, vid);
    // The loaded snapshot is now a model internally; the diff bridge still returns flat.
    expect(store.getHistoryEntryData(0).name).toBe(EMPTY_RESUME.name);
    expect(() => store.restoreToEntry(0)).not.toThrow();
    expect(store.getModel().type).toBe('doc');
    appStorage.removeItem('resume-designer-history-' + vid);
  });

  it('updateSilent is gone', () => {
    expect(store.updateSilent).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test`
Expected: FAIL — `getModel`/`getVariantId` may exist (Task 2 added getVariantId), but `getModel` does not, history is flat, `updateSilent` still defined, save callback gets flat.

- [ ] **Step 3: Replace `resume-designer/src/store.js` wholesale**

```javascript
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
      return model ? modelToFlat(model) : null; // modelToFlat returns a fresh object
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
            // Migrate any pre-2.2 FLAT snapshots to model JSON.
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
          saveCallback(model); // persist the MODEL as variant.data
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
```

- [ ] **Step 4: Run to verify pass**

Run: `npm run test`
Expected: PASS — the new store suite green; documentModel/migrateToModel/uiState suites green.

- [ ] **Step 5: Lint + build**

Run: `npm run lint && npm run build`
Expected: clean. (If lint flags an unused `updateSilent` import or a stray caller anywhere, that's a real find — fix the caller; per the Task 3 grep there should be none.)

- [ ] **Step 6: Commit**

```bash
git add resume-designer/src/store.js resume-designer/test/store.test.js
git commit -m "feat(store): make the document model the store's source of truth" \
  -m "Store holds the model; getData()/get() bridge via modelToFlat; flat-path writers round-trip through flat then flatToModel. History snapshots are model JSON (getHistoryEntryData returns flat; loadHistory migrates pre-2.2 flat snapshots). Save callback receives the model. updateSilent removed. App behaves identically." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Fragile-flow verification sweep

**Files:** none (verification only — no commit unless a check fails and is fixed).

The store flip touches persistence, AI apply, undo/redo, and backup — verify each end to end. Use the preview tools with **fabricated data only** (never the real OpenRouter key or real résumé content) and **restore `localStorage` afterward**.

- [ ] **Step 1: Automated gates**

Run (from `resume-designer/`): `npm run test && npm run lint && npm run build`
Expected: all green.

- [ ] **Step 2: Persistence + adoption round-trip**

In the preview: create/edit a résumé, reload → content identical (variant.data is now model JSON — confirm via the persisted store key being a `{"type":"doc",…}` shape). Then seed an OLD flat variant (a `resume-designer-data` whose `variants[id].data` is the flat shape), load it → it renders identically and, after one edit + reload, its on-disk `data` has become model JSON (adoption).

- [ ] **Step 3: Inline edit + StructurePanel + renderer parity**

Edit fields inline on the résumé and via the Structure panel (name, summary, a bullet, a section item, tools, education); confirm the rendered résumé updates correctly across a couple of layouts. Confirm tools display toggle (`toolsDisplay`) and section type toggle still work.

- [ ] **Step 4: Undo/redo + History dialog + diff + restore**

Make several edits; undo/redo repeatedly → state matches. Open the History dialog → entries are labeled; select an older entry → the diff view renders (this exercises `getHistoryEntryData` → `diffResumeData`); restore an entry → résumé reverts. Reload → history persists (and any pre-2.2 flat history loads without error).

- [ ] **Step 5: AI apply (fabricated)**

With a fabricated key configured in a throwaway way (or by stubbing), exercise a single-field chat apply and a changeset apply (DiffDialog) → changes land on the résumé. (If live AI isn't feasible in the preview, assert the apply path manually by calling `store.update(path, value)` for a representative changeset and confirming the render.)

- [ ] **Step 6: Backup export/import**

Export a full backup; confirm it includes the `resume-designer-ui-state-*` and `resume-designer-history-*` keys. Import it into a clean state → variants, history, and UI-state (accordion/sort) all restore.

- [ ] **Step 7: View-state per-variant**

Collapse experiences + set sort mode; switch variants → each variant keeps its own; reload → both persist.

- [ ] **Step 8: Report**

Summarize: all automated gates green; persistence/adoption, inline+panel editing, undo/redo+History+diff+restore, AI apply, backup, and per-variant view-state all verified. PR 2.2 complete → the model is the store's truth; ready for the final whole-PR review and PR 2.3 (TipTap editor).

---

## Self-review (run by the plan author)

**Spec coverage (§6, §11 PR 2.2):** model as store truth → Task 4 ✓ · `getData()=modelToFlat` bridge → Task 4 ✓ · flat-path writers via flat-round-trip → Task 4 ✓ · `getModel`/`setModel` → Task 4 ✓ · persistence stores model (`variant.data`) → Task 4 (save callback gets model; persistence.js unchanged) ✓ · adoption-migration on load → Task 4 (`toModel` in `setData`) ✓ · export/import/Markdown via flat → unchanged (fed by `getData()`/`setData()`) ✓ · model-snapshot history + `getHistoryEntryData` bridge + flat-history migration → Task 4 ✓ · non-modeled fields handled (`_expanded`/`experienceSortMode` → UI-state; `relevanceRank` → model attr) → Tasks 1–3 ✓ · app identical / fragile-flow verification → Task 5 ✓.

**Placeholder scan:** none — full `store.js` and `uiState.js` are given verbatim; deltas show complete replacement blocks; commands have expected output. Task 5 is verification (manual preview steps are explicit, as the changes are runtime/persistence behavior not unit-coverable).

**Type/name consistency:** `uiState` API (`getSortMode`/`setSortMode`/`isExpanded`/`setExpanded`/`clearForVariant`/`UI_STATE_PREFIX`) is identical across Task 2 (def), Task 2 test, and Task 3 (use). `store.getVariantId()` defined in Task 2, used by `uiState`. `isModel`/`toModel`/`flatToModel`/`modelToFlat` consistent in Task 4. `relevanceRank` attr (Task 1) ↔ flat `_relevanceRank` (Tasks 1, 3) consistent. `BACKUP_UISTATE_PREFIX` (Task 2) matches `UI_STATE_PREFIX` value.

**Green-at-every-task ordering:** Task 1 (relevanceRank attr) + Task 2 (UI-state dormant, `getVariantId` on the flat store) are non-behavioral. Task 3 moves StructurePanel onto UI-state **before** the store rewrite, so by Task 4 `updateSilent` has no callers and is safely removed. `relevanceRank` carried by the migration (Task 1) before the flip (Task 4) means it survives adoption. ✓
