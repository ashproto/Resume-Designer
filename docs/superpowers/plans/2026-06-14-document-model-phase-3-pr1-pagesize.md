# Phase 3 PR 3.1 — `pageSize` on the model + migration Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make page size a first-class, per-document property of the structured model — added to the schema, round-tripped losslessly through the flat⇄model migration, readable/writable via the store, with a global default setting — all **non-behavioral** (no UI yet; the on-screen app is unchanged and the 6 golden round-trips stay green).

**Architecture:** `pageSize` becomes a `doc`-node attr (default `'auto'`), exactly like the existing `toolsDisplay` attr. The flat interchange shape (persisted `variant.data`) gains an optional `pageSize` field that `flatToModel`/`modelToFlat` carry — **emitted only when non-default**, so existing résumés (all `'auto'`) round-trip byte-for-byte. The store exposes thin `getPageSize`/`setPageSize` wrappers over its existing `get`/`update` (which already round-trip flat⇄model and push history). A global `defaultPageSize` setting is added to `persistence.js` for future new-document creation (the read-side wiring lands later, in PR 3.4).

**Tech Stack:** vitest (jsdom), prosemirror-model. All npm/npx commands run from `resume-designer/`.

**Valid values for `pageSize`:** `'auto'` | `'letter'` | `'a4'` | `'legal'`. The ProseMirror schema stores it as a free string (no enum at the schema layer); value validity is an app-layer concern handled when the export UI lands.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `resume-designer/src/documentModel.js` | résumé schema | Add `pageSize` to `doc` attrs + `createEmptyModel` |
| `resume-designer/src/migrateToModel.js` | flat⇄model migration | `flatToModel` sets the attr; `modelToFlat` emits it (non-default only); `FLAT_DEFAULTS` gains it |
| `resume-designer/src/store.js` | model-native store facade | `getPageSize`/`setPageSize` accessors |
| `resume-designer/src/persistence.js` | settings persistence | Global `defaultPageSize` default |
| `resume-designer/test/documentModel.test.js` | schema tests | + pageSize attr tests |
| `resume-designer/test/migrateToModel.test.js` | migration tests | + pageSize round-trip tests |
| `resume-designer/test/store.test.js` | store tests | + accessor tests |
| `resume-designer/test/persistence.test.js` | **new** settings test | defaultPageSize default + persist |

Each task is one commit. Conventional Commits (lowercase subject, body lines ≤100, `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` footer). Use explicit `git add <paths>` — never `git add -a`.

---

### Task 1: Add `pageSize` to the document schema

**Files:**
- Modify: `resume-designer/src/documentModel.js` (doc attrs ~L13-20; `createEmptyModel` ~L95-108)
- Test: `resume-designer/test/documentModel.test.js`

- [ ] **Step 1: Write the failing tests**

Add inside the existing `describe('resumeSchema', …)` block in `test/documentModel.test.js`:

```js
  it('doc carries a pageSize attr defaulting to auto', () => {
    expect(resumeSchema.nodeFromJSON(validDoc).attrs.pageSize).toBe('auto');
  });
  it('createEmptyModel carries pageSize auto', () => {
    expect(createEmptyModel().attrs.pageSize).toBe('auto');
  });
  it('preserves an explicit pageSize through the schema', () => {
    const doc = { ...validDoc, attrs: { pageSize: 'a4' } };
    expect(resumeSchema.nodeFromJSON(doc).attrs.pageSize).toBe('a4');
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/documentModel.test.js`
Expected: FAIL — the new cases report `undefined` (no `pageSize` attr yet); the pre-existing cases still pass.

- [ ] **Step 3: Add the attr to the schema and the empty model**

In `src/documentModel.js`, add `pageSize` to the `doc` node's `attrs`:

```js
    doc: {
      content: 'header section*',
      attrs: {
        schemaVersion: { default: SCHEMA_VERSION },
        docType: { default: 'resume' },
        toolsDisplay: { default: '' },
        pageSize: { default: 'auto' },
      },
    },
```

And add it to `createEmptyModel()`'s attrs:

```js
export function createEmptyModel() {
  return {
    type: 'doc',
    attrs: { schemaVersion: SCHEMA_VERSION, docType: 'resume', toolsDisplay: '', pageSize: 'auto' },
    content: [{
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/documentModel.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/documentModel.js test/documentModel.test.js
git commit -m "feat(model): add pageSize doc attr defaulting to auto" -m "Per-document page size, stored like the toolsDisplay attr (default 'auto');
backward-compatible, so no SCHEMA_VERSION bump. Non-behavioral.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Round-trip `pageSize` through the migration

**Files:**
- Modify: `resume-designer/src/migrateToModel.js` (`flatToModel` return ~L66; `modelToFlat` ~L131; `FLAT_DEFAULTS` ~L135-138)
- Test: `resume-designer/test/migrateToModel.test.js`

The key constraint: the existing 6 golden round-trips assert `modelToFlat(flatToModel(sample))` `toEqual(sample)`, and none of the samples has a `pageSize` key. So `modelToFlat` must emit `pageSize` **only when it is non-default** (`!== 'auto'`) — mirroring how `toolsDisplay` is conditionally emitted — otherwise every golden sample would gain a spurious `pageSize: 'auto'` and fail.

- [ ] **Step 1: Write the failing tests**

Append a new `describe` block to `test/migrateToModel.test.js`:

```js
describe('pageSize in the migration', () => {
  it('defaults pageSize to auto when absent', () => {
    expect(flatToModel(POPULATED).attrs.pageSize).toBe('auto');
  });
  it('carries an explicit pageSize into the doc attr', () => {
    expect(flatToModel({ ...POPULATED, pageSize: 'a4' }).attrs.pageSize).toBe('a4');
  });
  it('round-trips a non-default pageSize losslessly', () => {
    const sample = { ...POPULATED, pageSize: 'letter' };
    expect(modelToFlat(flatToModel(sample))).toEqual(sample);
  });
  it('omits pageSize from flat output when auto (keeps golden samples clean)', () => {
    expect('pageSize' in modelToFlat(flatToModel(POPULATED))).toBe(false);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/migrateToModel.test.js`
Expected: FAIL — `flatToModel(POPULATED).attrs.pageSize` is `undefined`; the explicit/round-trip cases fail. The 6 golden round-trips still PASS (proving the baseline is intact before the change).

- [ ] **Step 3: Carry `pageSize` through both directions**

In `src/migrateToModel.js`, extend the `flatToModel` return's doc attrs (the line that currently builds `{ ...toolsDisplay }`):

```js
  return {
    type: 'doc',
    attrs: {
      schemaVersion: SCHEMA_VERSION,
      docType: 'resume',
      toolsDisplay: flat.toolsDisplay ?? '',
      pageSize: flat.pageSize ?? 'auto',
    },
    content,
  };
```

In `modelToFlat`, immediately after the existing `toolsDisplay` line (`if (model.attrs?.toolsDisplay) flat.toolsDisplay = model.attrs.toolsDisplay;`), add — emit only when non-default so golden samples stay byte-identical:

```js
  if (model.attrs?.pageSize && model.attrs.pageSize !== 'auto') flat.pageSize = model.attrs.pageSize;
```

And add `pageSize` to `FLAT_DEFAULTS`:

```js
const FLAT_DEFAULTS = {
  name: '', tagline: '', contact: {}, summary: '',
  sections: [], experience: [], education: [], tools: '', pageSize: 'auto',
};
```

- [ ] **Step 4: Run the tests to verify they pass (incl. all 6 goldens)**

Run: `npx vitest run test/migrateToModel.test.js`
Expected: PASS — the new pageSize block passes AND the 6 `round-trips … byte-for-byte` cases still pass.

- [ ] **Step 5: Commit**

```bash
git add src/migrateToModel.js test/migrateToModel.test.js
git commit -m "feat(model): round-trip pageSize through the migration" -m "flatToModel sets the doc attr; modelToFlat emits pageSize only when non-default
(like toolsDisplay), so the 6 golden round-trips stay byte-for-byte.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Store `getPageSize` / `setPageSize` accessors

**Files:**
- Modify: `resume-designer/src/store.js` (add methods to the returned store object, after `getVariantId()` ~L132-134)
- Test: `resume-designer/test/store.test.js`

These are thin wrappers: `get('pageSize')` already returns `modelToFlat(model).pageSize` (which is `undefined` when the value is the omitted default `'auto'`), and `update('pageSize', v)` already round-trips flat→model and pushes a history entry. No new write path.

- [ ] **Step 1: Write the failing tests**

Add inside the `describe('store (model-native)', …)` block in `test/store.test.js`:

```js
  it('getPageSize defaults to auto; setPageSize round-trips through the model', () => {
    expect(store.getPageSize()).toBe('auto');
    store.setPageSize('a4');
    expect(store.getPageSize()).toBe('a4');
    expect(store.getModel().attrs.pageSize).toBe('a4');
  });

  it('setPageSize pushes a history entry', () => {
    const before = store.getHistoryLength();
    store.setPageSize('letter');
    expect(store.getHistoryLength()).toBe(before + 1);
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/store.test.js`
Expected: FAIL — `store.getPageSize is not a function`.

- [ ] **Step 3: Add the accessors**

In `src/store.js`, add these two methods to the returned object, right after `getVariantId()`:

```js
    getVariantId() {
      return currentVariantId;
    },

    // --- page size (per-document; thin wrappers over the round-tripping get/update) ---
    getPageSize() {
      return this.get('pageSize') ?? 'auto';
    },
    setPageSize(value) {
      this.update('pageSize', value);
    },
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/store.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/store.js test/store.test.js
git commit -m "feat(store): getPageSize and setPageSize accessors" -m "Thin wrappers over get('pageSize')/update('pageSize', v); setPageSize pushes a
history snapshot like any other edit. No UI consumer yet.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Global `defaultPageSize` setting

**Files:**
- Modify: `resume-designer/src/persistence.js` (`DEFAULT_STORAGE.settings` ~L19-36; `getSettings` guarantee-spread ~L246)
- Test: `resume-designer/test/persistence.test.js` (**new**)

The setting is *defined* here for future use; the read-side that makes a *new* document adopt it lands with the export UI (PR 3.4). `getSettings` already spreads a set of "guaranteed" keys over stored settings so pre-existing installs get new defaults — add `defaultPageSize` there too.

- [ ] **Step 1: Write the failing tests (new file)**

Create `resume-designer/test/persistence.test.js`:

```js
import { describe, it, expect, beforeEach } from 'vitest';
import { getSettings, saveSettings } from '../src/persistence.js';

describe('defaultPageSize setting', () => {
  beforeEach(() => { localStorage.clear(); });

  it('defaults to auto on a fresh install', () => {
    expect(getSettings().defaultPageSize).toBe('auto');
  });

  it('persists a changed default and reads it back', () => {
    saveSettings({ defaultPageSize: 'a4' });
    expect(getSettings().defaultPageSize).toBe('a4');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/persistence.test.js`
Expected: FAIL — `getSettings().defaultPageSize` is `undefined`.

- [ ] **Step 3: Add the setting + the read-time guarantee**

In `src/persistence.js`, add `defaultPageSize` to `DEFAULT_STORAGE.settings` (next to the other design keys):

```js
  settings: {
    colorPalette: 'terracotta',
    layout: 'sidebar',
    customColor: '#c45c3e',
    defaultPageSize: 'auto',
    openrouterKey: '',
```

And add it to the `getSettings` guarantee-spread so legacy installs backfill it:

```js
  return { openrouterKey: '', autoFallback: false, customModels: [], defaultPageSize: 'auto', ...s };
```

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/persistence.test.js`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/persistence.js test/persistence.test.js
git commit -m "feat(settings): global defaultPageSize default" -m "Adds a global defaultPageSize ('auto') for future new-document creation;
the read-side wiring lands with the export UI (PR 3.4).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after all 4 tasks)

- [ ] **Full suite green:** Run `npm test` — expect all prior tests + the new pageSize/settings cases passing (was 113; now 113 + the new cases). No failures.
- [ ] **Lint + build clean:** Run `npm run lint` and `npm run build` — expect no new errors.
- [ ] **Non-behavioral confirmation:** no production code path reads `getPageSize`/`defaultPageSize` yet (grep to confirm zero callers outside tests) — the running app is byte-identical. This is the same "schema-evolution, no behavior change" gate PR 2.1 used.

---

## Self-review notes (author)

- **Spec coverage:** implements design §5.1 (doc attr, no SCHEMA_VERSION bump), §5.2 (flat field + flatToModel/modelToFlat + FLAT_DEFAULTS, golden samples byte-identical via conditional emit), §5.3 (store accessors as get/update wrappers; global `defaultPageSize`, read-side deferred to PR 3.4). ✓
- **No placeholders:** every step has concrete code + an exact command + expected result. ✓
- **Type/name consistency:** `pageSize` (model attr + flat field + accessor) and `defaultPageSize` (global setting) are distinct and used consistently; values `'auto'|'letter'|'a4'|'legal'`. The conditional-emit guard matches the existing `toolsDisplay` pattern verbatim. ✓
