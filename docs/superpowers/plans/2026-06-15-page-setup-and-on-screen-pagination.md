# Page Setup & On-Screen Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Give the résumé a real page-setup model (Continuous with settable width; Letter/A4/Legal/Tabloid with orientation) and make the live editable preview paginate into true page "sheets" across all 11 layouts, coexisting with the contenteditable inline editor and the Typst PDF export.

**Architecture:** A new pure module `src/pageSetup.js` is the single source of truth for page dimensions (consumed by the store, the Typst generator, and the on-screen paginator). A new module `src/pagination.js` exposes a pure `assignBlocksToPages()` (the tested heart) plus a DOM glue `paginate()` that runs as a post-render hook in `renderCurrentResume()`: it measures the just-rendered blocks and MOVES the existing DOM nodes into page-height `.resume-page` sheets (moving preserves `data-editable` + contenteditable). The PDF side honors the same model via `pageDimsIn()` in the Typst `pageRule`.

**Tech Stack:** Vanilla JS (renderer + paginator), ProseMirror-model (document model), Typst (PDF), React 19 + shadcn (Design-tab chrome), vitest + jsdom (unit tests). Run all `npm`/`npx` from `resume-designer/`.

**Spec:** `docs/superpowers/specs/2026-06-15-page-setup-and-on-screen-pagination-design.md`

---

## Conventions (apply to EVERY task)

- **Run commands from `resume-designer/`.** Tests: `npm test` (= `vitest run --passWithNoTests`). Single file: `npx vitest run test/<file>.test.js`.
- **Commits:** lowercase subject NOT starting with an all-caps word; body lines ≤100 chars (now a warning, but keep them short); footer line:
  `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`
- **Stage explicitly:** `git add <paths>` — never `git add -A`/`-a`.
- **Branch:** all work lands on `feat/document-model` (PR #46). Never touch `next`/`main`.
- **On-screen unit:** 1in = 96px (CSS px). `pageDimsIn()` returns inches; the paginator multiplies by 96.
- **The pure functions are the tested heart.** The DOM measure/reflow glue is NOT unit-testable under jsdom (no layout engine → zero heights); it is verified in the desktop app / browser preview. This split is deliberate.

---

## File Structure

**Create:**
- `src/pageSetup.js` — page-setup constants + pure `pageDimsIn()` / `normalizePageSize()`. Source of truth for dimensions.
- `src/pagination.js` — pure `assignBlocksToPages()` + DOM `paginate()` + layout adapters.
- `test/pageSetup.test.js` — unit tests for `pageSetup.js`.
- `test/pagination.test.js` — unit tests for `assignBlocksToPages()`.

**Modify:**
- `src/documentModel.js` — add `orientation` + `pageWidthIn` doc attrs; `pageSize` default `'auto'` → `'continuous'`.
- `src/migrateToModel.js` — round-trip the new attrs (conditional-emit); migrate legacy `'auto'`.
- `src/store.js` — `getPageSize` default → `'continuous'`; add `getOrientation/setOrientation/getPageWidthIn/setPageWidthIn`.
- `src/typst/generate.js` — `pageRule` honors tabloid/orientation/continuous via `pageDimsIn`.
- `src/main.js` — call `paginate(...)` in `renderCurrentResume()` after render, before `refreshInlineEditor()`.
- `styles/main.css` — `.resume-pages` / `.resume-page` sheet styling + paginated-state neutralization.
- `src/components/structure/DesignTab.jsx` — replace the Page Size segmented control with a Page Setup group.
- `src/components/TypstExportDialog.jsx` — align the export dialog's size options with the new model.
- `test/migrateToModel.test.js` — update the `pageSize` describe block; add migration/orientation/width tests.
- `test/typstGenerate.test.js` — update the `pageSize` assertions; add tabloid/orientation/continuous-width tests.

---

## Task 1: Page-setup module (`src/pageSetup.js`)

The pure source of truth for page dimensions. Fully unit-tested; no DOM.

**Files:**
- Create: `src/pageSetup.js`
- Test: `test/pageSetup.test.js`

- [ ] **Step 1: Write the failing test**

Create `test/pageSetup.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import {
  PAGE_SIZES, ORIENTATIONS, DEFAULT_PAGE_WIDTH_IN, PAGE_DIMS_IN,
  normalizePageSize, pageDimsIn,
} from '../src/pageSetup.js';

describe('normalizePageSize', () => {
  it('maps legacy "auto", undefined, and unknown values to "continuous"', () => {
    expect(normalizePageSize('auto')).toBe('continuous');
    expect(normalizePageSize(undefined)).toBe('continuous');
    expect(normalizePageSize('nonsense')).toBe('continuous');
  });
  it('passes through every known size unchanged', () => {
    for (const s of PAGE_SIZES) expect(normalizePageSize(s)).toBe(s);
  });
});

describe('pageDimsIn', () => {
  it('returns null height for continuous and uses the given width', () => {
    expect(pageDimsIn({ pageSize: 'continuous', pageWidthIn: 7 })).toEqual({ widthIn: 7, heightIn: null });
  });
  it('defaults the continuous width to 8.5in', () => {
    expect(pageDimsIn({ pageSize: 'continuous' })).toEqual({ widthIn: DEFAULT_PAGE_WIDTH_IN, heightIn: null });
  });
  it('returns portrait dims for fixed sizes', () => {
    expect(pageDimsIn({ pageSize: 'letter' })).toEqual({ widthIn: 8.5, heightIn: 11 });
    expect(pageDimsIn({ pageSize: 'tabloid' })).toEqual({ widthIn: 11, heightIn: 17 });
  });
  it('swaps width/height for landscape', () => {
    expect(pageDimsIn({ pageSize: 'letter', orientation: 'landscape' })).toEqual({ widthIn: 11, heightIn: 8.5 });
  });
  it('ignores orientation for continuous', () => {
    expect(pageDimsIn({ pageSize: 'continuous', orientation: 'landscape', pageWidthIn: 9 }))
      .toEqual({ widthIn: 9, heightIn: null });
  });
  it('treats legacy "auto" as continuous', () => {
    expect(pageDimsIn({ pageSize: 'auto' })).toEqual({ widthIn: DEFAULT_PAGE_WIDTH_IN, heightIn: null });
  });
  it('exposes a dims table that matches standard paper sizes', () => {
    expect(PAGE_DIMS_IN.a4).toEqual({ widthIn: 8.27, heightIn: 11.69 });
    expect(PAGE_DIMS_IN.legal).toEqual({ widthIn: 8.5, heightIn: 14 });
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/pageSetup.test.js`
Expected: FAIL — cannot resolve `../src/pageSetup.js`.

- [ ] **Step 3: Write the implementation**

Create `src/pageSetup.js`:

```javascript
/**
 * Page-setup model: the single source of truth for page dimensions, shared by
 * the store (model attrs), the Typst generator (pageRule), and the on-screen
 * paginator (sheet sizes). Pure; no DOM.
 *
 * The inch dimensions below are the standard paper sizes; the on-screen sheets
 * (1in = 96px) and the Typst PDF page rule both derive from them so screen and
 * PDF agree on size.
 */

export const PAGE_SIZES = ['continuous', 'letter', 'a4', 'legal', 'tabloid'];
export const ORIENTATIONS = ['portrait', 'landscape'];
export const DEFAULT_PAGE_WIDTH_IN = 8.5;

// Portrait dimensions (inches). Landscape swaps width/height.
export const PAGE_DIMS_IN = {
  letter:  { widthIn: 8.5,  heightIn: 11 },
  a4:      { widthIn: 8.27, heightIn: 11.69 },
  legal:   { widthIn: 8.5,  heightIn: 14 },
  tabloid: { widthIn: 11,   heightIn: 17 },
};

// Legacy 'auto' (and undefined/unknown) → 'continuous'.
export function normalizePageSize(size) {
  return PAGE_SIZES.includes(size) ? size : 'continuous';
}

/**
 * Resolve a page-setup selection to concrete dimensions.
 * @returns {{ widthIn: number, heightIn: number|null }} — heightIn null = continuous (open height).
 */
export function pageDimsIn({ pageSize, orientation = 'portrait', pageWidthIn = DEFAULT_PAGE_WIDTH_IN } = {}) {
  const size = normalizePageSize(pageSize);
  if (size === 'continuous') {
    return { widthIn: Number.isFinite(pageWidthIn) ? pageWidthIn : DEFAULT_PAGE_WIDTH_IN, heightIn: null };
  }
  const { widthIn, heightIn } = PAGE_DIMS_IN[size];
  return orientation === 'landscape'
    ? { widthIn: heightIn, heightIn: widthIn }
    : { widthIn, heightIn };
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/pageSetup.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Commit**

```bash
git add src/pageSetup.js test/pageSetup.test.js
git commit -m "feat(pagesetup): page-dimension source of truth

Add src/pageSetup.js: page-size/orientation enums, the inch dims table,
normalizePageSize (legacy 'auto' -> 'continuous'), and the pure
pageDimsIn() helper shared by the store, Typst generator, and paginator.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Model + migration + store

Add `orientation` + `pageWidthIn` doc attrs, flip the `pageSize` default to `'continuous'`, migrate legacy `'auto'`, and add the store accessors. All six golden round-trips must stay byte-stable.

**Files:**
- Modify: `src/documentModel.js:13-21` (doc attrs), `:96-109` (createEmptyModel)
- Modify: `src/migrateToModel.js:71-80` (flatToModel attrs), `:147-149` (modelToFlat emits), `:152-155` (FLAT_DEFAULTS)
- Modify: `src/store.js:136-142` (page accessors)
- Test: `test/migrateToModel.test.js:184-198` (rewrite the pageSize block; add tests)

- [ ] **Step 1: Update the migration tests (write the failing tests first)**

In `test/migrateToModel.test.js`, REPLACE the entire `describe('pageSize in the migration', …)` block (lines 184-198) with:

```javascript
describe('pageSize / orientation / pageWidthIn in the migration', () => {
  it('defaults pageSize to continuous when absent', () => {
    expect(flatToModel(POPULATED).attrs.pageSize).toBe('continuous');
  });
  it('migrates a legacy pageSize of "auto" to "continuous"', () => {
    expect(flatToModel({ ...POPULATED, pageSize: 'auto' }).attrs.pageSize).toBe('continuous');
  });
  it('carries an explicit pageSize into the doc attr', () => {
    expect(flatToModel({ ...POPULATED, pageSize: 'tabloid' }).attrs.pageSize).toBe('tabloid');
  });
  it('defaults orientation to portrait and pageWidthIn to 8.5', () => {
    const attrs = flatToModel(POPULATED).attrs;
    expect(attrs.orientation).toBe('portrait');
    expect(attrs.pageWidthIn).toBe(8.5);
  });
  it('round-trips a non-default page setup losslessly', () => {
    const sample = { ...POPULATED, pageSize: 'a4', orientation: 'landscape', pageWidthIn: 7.5 };
    expect(modelToFlat(flatToModel(sample))).toEqual(sample);
  });
  it('omits page-setup fields from flat output at their defaults (keeps golden samples clean)', () => {
    const back = modelToFlat(flatToModel(POPULATED));
    expect('pageSize' in back).toBe(false);
    expect('orientation' in back).toBe(false);
    expect('pageWidthIn' in back).toBe(false);
  });
  it('emits only the non-default page-setup fields', () => {
    const back = modelToFlat(flatToModel({ ...POPULATED, pageWidthIn: 7 }));
    expect(back).toMatchObject({ pageWidthIn: 7 });
    expect('pageSize' in back).toBe(false);      // still continuous (default)
    expect('orientation' in back).toBe(false);   // still portrait (default)
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/migrateToModel.test.js`
Expected: FAIL — `flatToModel(POPULATED).attrs.pageSize` is still `'auto'`; `orientation`/`pageWidthIn` are `undefined`.

- [ ] **Step 3: Add the doc attrs to the schema**

In `src/documentModel.js`, change the `doc` node attrs (lines 15-20) to:

```javascript
      attrs: {
        schemaVersion: { default: SCHEMA_VERSION },
        docType: { default: 'resume' },
        toolsDisplay: { default: '' },
        pageSize: { default: 'continuous' },
        orientation: { default: 'portrait' },
        pageWidthIn: { default: 8.5 },
      },
```

And update `createEmptyModel()` (line 99) attrs to match:

```javascript
    attrs: { schemaVersion: SCHEMA_VERSION, docType: 'resume', toolsDisplay: '', pageSize: 'continuous', orientation: 'portrait', pageWidthIn: 8.5 },
```

- [ ] **Step 4: Round-trip the attrs in the migration**

In `src/migrateToModel.js`, add the import at the top (after the existing imports, lines 1-2):

```javascript
import { normalizePageSize } from './pageSetup.js';
```

In `flatToModel`, change the returned `attrs` object (lines 73-78) to:

```javascript
    attrs: {
      schemaVersion: SCHEMA_VERSION,
      docType: 'resume',
      toolsDisplay: flat.toolsDisplay ?? '',
      pageSize: normalizePageSize(flat.pageSize),
      orientation: flat.orientation ?? 'portrait',
      pageWidthIn: Number.isFinite(flat.pageWidthIn) ? flat.pageWidthIn : 8.5,
    },
```

In `modelToFlat`, REPLACE the `pageSize` emit line (line 148) with the three conditional emits:

```javascript
  if (model.attrs?.pageSize && model.attrs.pageSize !== 'continuous') flat.pageSize = model.attrs.pageSize;
  if (model.attrs?.orientation && model.attrs.orientation !== 'portrait') flat.orientation = model.attrs.orientation;
  if (Number.isFinite(model.attrs?.pageWidthIn) && model.attrs.pageWidthIn !== 8.5) flat.pageWidthIn = model.attrs.pageWidthIn;
```

Update `FLAT_DEFAULTS` (lines 152-155) so `pageSize` reads `'continuous'`:

```javascript
const FLAT_DEFAULTS = {
  name: '', tagline: '', contact: {}, summary: '',
  sections: [], experience: [], education: [], tools: '', pageSize: 'continuous',
};
```

- [ ] **Step 5: Add the store accessors**

In `src/store.js`, REPLACE the page-size accessor block (lines 136-142) with:

```javascript
    // --- page setup (per-document; thin wrappers over the round-tripping get/update) ---
    getPageSize() {
      return this.get('pageSize') ?? 'continuous';
    },
    setPageSize(value) {
      this.update('pageSize', value);
    },
    getOrientation() {
      return this.get('orientation') ?? 'portrait';
    },
    setOrientation(value) {
      this.update('orientation', value);
    },
    getPageWidthIn() {
      return this.get('pageWidthIn') ?? 8.5;
    },
    setPageWidthIn(value) {
      this.update('pageWidthIn', value);
    },
```

- [ ] **Step 6: Run the full migration test suite**

Run: `npx vitest run test/migrateToModel.test.js`
Expected: PASS — the new page-setup tests pass AND the six `modelToFlat (lossless round-trip)` cases stay byte-for-byte (`EMPTY_RESUME`, `POPULATED`, etc. carry no page-setup keys, so the defaults are omitted on the way back).

- [ ] **Step 7: Run the whole suite (catch fallout)**

Run: `npm test`
Expected: PASS. (If any snapshot mentions doc attrs, it is unchanged: defaults still serialize the same Typst — verified in Task 3.)

- [ ] **Step 8: Commit**

```bash
git add src/documentModel.js src/migrateToModel.js src/store.js test/migrateToModel.test.js
git commit -m "feat(model): orientation + pageWidthIn attrs; continuous default

Add orientation and pageWidthIn doc attrs; default pageSize to
'continuous' and migrate legacy 'auto'. Round-trip all three with the
conditional-emit pattern so golden samples stay byte-stable. Add store
getOrientation/setOrientation/getPageWidthIn/setPageWidthIn.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Typst `pageRule` — tabloid, orientation, continuous

Drive the Typst page rule from `pageDimsIn()` so the PDF honors every size/orientation and continuous width, using the same dimensions as the screen.

**Files:**
- Modify: `src/typst/generate.js:21-29` (PAPER + pageRule), `:31-38` (preamble)
- Test: `test/typstGenerate.test.js:14-19` (rewrite pageSize assertions; add cases)

- [ ] **Step 1: Update the Typst page tests (write the failing tests first)**

In `test/typstGenerate.test.js`, REPLACE the `it('maps pageSize to #set page', …)` test (lines 14-19) with:

```javascript
  it('maps fixed sizes to explicit #set page dimensions', () => {
    expect(modelToTypst(model('a4'), { theme })).toContain('#set page(width: 8.27in, height: 11.69in');
    expect(modelToTypst(model('letter'), { theme })).toContain('#set page(width: 8.5in, height: 11in');
    expect(modelToTypst(model('legal'), { theme })).toContain('#set page(width: 8.5in, height: 14in');
    expect(modelToTypst(model('tabloid'), { theme })).toContain('#set page(width: 11in, height: 17in');
  });
  it('treats legacy "auto"/continuous as open height', () => {
    expect(modelToTypst(model('auto'), { theme })).toContain('height: auto');
    expect(modelToTypst(model('continuous'), { theme })).toContain('#set page(width: 8.5in, height: auto');
  });
  it('honors landscape orientation (swapped dims) for fixed sizes', () => {
    const m = { ...model('letter'), attrs: { schemaVersion: 1, docType: 'resume', toolsDisplay: '', pageSize: 'letter', orientation: 'landscape', pageWidthIn: 8.5 } };
    expect(modelToTypst(m, { theme })).toContain('#set page(width: 11in, height: 8.5in');
  });
  it('honors a custom continuous width', () => {
    const m = { ...model('continuous'), attrs: { schemaVersion: 1, docType: 'resume', toolsDisplay: '', pageSize: 'continuous', orientation: 'portrait', pageWidthIn: 7 } };
    expect(modelToTypst(m, { theme })).toContain('#set page(width: 7in, height: auto');
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/typstGenerate.test.js`
Expected: FAIL — the current `pageRule` emits `paper: "a4"`, not explicit dims.

- [ ] **Step 3: Rewrite `pageRule` to use `pageDimsIn`**

In `src/typst/generate.js`, add the import at the very top (before line 1's existing import, or right after it):

```javascript
import { pageDimsIn } from '../pageSetup.js';
```

REPLACE the `PAPER` constant + `pageRule` function (lines 21-29) with:

```javascript
// Full-bleed: no outer page margin, so colored headers/sidebars reach the paper
// edge (matching the on-screen design). The configured margins are applied as
// INTERNAL padding via pagePad/headerPad and the sidebar grid insets below.
// Dimensions come from pageDimsIn() — the same source the on-screen sheets use.
function pageRule(attrs = {}) {
  const { widthIn, heightIn } = pageDimsIn({
    pageSize: attrs.pageSize,
    orientation: attrs.orientation,
    pageWidthIn: attrs.pageWidthIn,
  });
  const height = heightIn == null ? 'auto' : `${heightIn}in`;
  return `#set page(width: ${widthIn}in, height: ${height}, margin: 0pt)`;
}
```

In `preamble` (line 33), change the call from `pageRule(model.attrs?.pageSize ?? 'auto')` to:

```javascript
    pageRule(model.attrs ?? {}),
```

- [ ] **Step 4: Run the Typst tests (and re-record snapshots if needed)**

Run: `npx vitest run test/typstGenerate.test.js`
Expected: the new `#set page(...)` assertions PASS. The `.toMatchSnapshot()` cases should ALSO pass unchanged — every snapshot model defaults to continuous (8.5in × auto), which produces the identical `#set page(width: 8.5in, height: auto, margin: 0pt)` the old code emitted for `'auto'`.
If a snapshot legitimately changed (it should not), inspect the diff; only if it is the expected page-rule string, run `npx vitest run test/typstGenerate.test.js -u` and re-verify.

- [ ] **Step 5: Visually verify a tabloid + landscape PDF compiles (controller visual pass)**

Generate a `.typ` and compile it to confirm the new dims are valid Typst (no paper-name dependency, so this only checks the width/height syntax). From `resume-designer/`:

```bash
node --input-type=module -e "
import { flatToModel } from './src/migrateToModel.js';
import { modelToTypst } from './src/typst/generate.js';
import { buildTheme } from './src/typst/theme.js';
import { writeFileSync } from 'node:fs';
const m = flatToModel({ name: 'Ada', tagline: 'P', contact: { email: 'a@x.com' }, summary: 'S.', experience: [{ id: 'e', title: 'Eng', company: 'Acme', dates: '2020', bullets: ['v2'] }] });
m.attrs = { schemaVersion: 1, docType: 'resume', toolsDisplay: '', pageSize: 'tabloid', orientation: 'landscape', pageWidthIn: 8.5 };
writeFileSync('/tmp/ps-tabloid.typ', modelToTypst(m, { theme: buildTheme({}), layout: 'sidebar' }));
console.log('wrote /tmp/ps-tabloid.typ');
"
typst compile --font-path src-tauri/fonts /tmp/ps-tabloid.typ "/tmp/ps-tabloid.png" --ppi 96
```

Expected: compiles with no error; the PNG is a wide (17in) landscape sheet. (Controller: Read the PNG to confirm.)

- [ ] **Step 6: Commit**

```bash
git add src/typst/generate.js test/typstGenerate.test.js
git commit -m "feat(typst): page rule honors tabloid, orientation, continuous width

Drive pageRule from pageDimsIn() so the PDF uses explicit width/height
for every size, swaps dims for landscape, and uses the configured width
with open height for continuous. Same dimensions as the on-screen sheets.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Pure paginator + sheet CSS

The tested heart: `assignBlocksToPages()` (greedy block-break). Plus the sheet CSS the DOM glue will use (not unit-tested).

**Files:**
- Create: `src/pagination.js` (this task adds only the pure export + a module header)
- Create: `test/pagination.test.js`
- Modify: `styles/main.css` (append the sheet styles)

- [ ] **Step 1: Write the failing test**

Create `test/pagination.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { assignBlocksToPages } from '../src/pagination.js';

describe('assignBlocksToPages', () => {
  const budgets = { firstPageContentPx: 250, pageContentPx: 300 };

  it('returns an empty array for no blocks', () => {
    expect(assignBlocksToPages([], budgets)).toEqual([]);
  });
  it('keeps blocks on page 0 until the first-page budget is exceeded', () => {
    expect(assignBlocksToPages([100, 100, 100], budgets)).toEqual([0, 0, 1]);
  });
  it('uses the larger per-page budget on pages after the first', () => {
    // page0: 100+100=200 (<=250); next 100 -> 300 > 250 -> page1. page1: 100,100,100=300 (<=300) ok.
    expect(assignBlocksToPages([100, 100, 100, 100, 100], budgets)).toEqual([0, 0, 1, 1, 1]);
  });
  it('gives an oversize block its own page (overflow allowed, never an empty page)', () => {
    expect(assignBlocksToPages([500, 100], { firstPageContentPx: 300, pageContentPx: 300 })).toEqual([0, 1]);
  });
  it('places a single block on page 0', () => {
    expect(assignBlocksToPages([100], budgets)).toEqual([0]);
  });
  it('never starts a new page for a block that fits exactly', () => {
    expect(assignBlocksToPages([250], budgets)).toEqual([0]);
    expect(assignBlocksToPages([250, 300], budgets)).toEqual([0, 1]);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/pagination.test.js`
Expected: FAIL — cannot resolve `../src/pagination.js`.

- [ ] **Step 3: Create the module with the pure function**

Create `src/pagination.js`:

```javascript
/**
 * On-screen pagination: turn the just-rendered résumé into true page "sheets".
 *
 * The PURE core is assignBlocksToPages() — fully unit-tested. The DOM glue
 * (paginate + adapters, added in later tasks) MEASURES the rendered blocks and
 * MOVES the existing nodes into page-height sheets; it is verified in the
 * desktop app / browser preview, not under jsdom (which has no layout engine).
 */

/**
 * Greedy block-break assignment.
 * @param {number[]} blockHeightsPx - height (incl. inter-block gap) of each block, in order.
 * @param {{firstPageContentPx:number, pageContentPx:number}} budgets - usable content height per page
 *   (page 0 is smaller when a full-width header/lead sits on it).
 * @returns {number[]} page index (0-based) for each block.
 *
 * A block that overflows the current page starts a new page; a block taller than
 * a whole page gets its own page (content allowed to overflow the sheet bottom).
 * A new page is never started while the current page is still empty.
 */
export function assignBlocksToPages(blockHeightsPx, { firstPageContentPx, pageContentPx }) {
  const pages = [];
  let page = 0;
  let used = 0;
  let budget = firstPageContentPx;
  for (const h of blockHeightsPx) {
    if (used > 0 && used + h > budget) {
      page += 1;
      used = 0;
      budget = pageContentPx;
    }
    pages.push(page);
    used += h;
  }
  return pages;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/pagination.test.js`
Expected: PASS (all cases).

- [ ] **Step 5: Add the sheet CSS**

Append to `styles/main.css`:

```css
/* ===== On-screen pagination — true page "sheets" ===== */
/* When paginated, #resume and its container stop being a single white page;
   each .resume-page is the paper. The zoom transform stays on #resume-container. */
#resume.is-paginated {
  width: auto;
  min-height: 0;
  overflow: visible;
  display: block;
  background: transparent;
  padding: 0;
}
.resume-container.is-paginated {
  width: auto;
  min-width: 0;
  background: transparent;
  box-shadow: none;
  border-radius: 0;
  overflow: visible;
}
.resume-pages {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35in;
}
.resume-page {
  position: relative;
  box-sizing: border-box;
  background: #fff;
  border-radius: 4px;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.05), 0 10px 40px rgba(0, 0, 0, 0.1);
  overflow: hidden;
  display: flex;
  flex-direction: column;
  /* width + height (px) are set inline per sheet by the paginator. */
}
.resume-page.is-continuous {
  height: auto;
  min-height: 0;
}
```

- [ ] **Step 6: Commit**

```bash
git add src/pagination.js test/pagination.test.js styles/main.css
git commit -m "feat(pagination): pure block-break paginator + sheet css

Add assignBlocksToPages() (greedy, page-0 gets a smaller budget for the
header; oversize blocks get their own page) with full unit tests, plus
the .resume-pages/.resume-page sheet styling the DOM glue will use.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Single-column DOM paginator + the render hook

> **IMPLEMENTED with item-level breaks** (commits `79916ab` scaffold + `f325f6a` upgrade). Per the user's decision, the body's children are flattened into **flow units**: `experience-section`/`education-section` break between their individual items (the section heading rides with the first item and is NOT repeated on continuation pages); every other child is one whole block. Measurement uses `getBoundingClientRect()` ÷ the zoom scale (`getZoom()`), not `offsetHeight`. `buildColumn()` rebuilds each page's section slice by regrouping consecutive same-section items under a cloned section wrapper. Verified live (browser preview) across all 5 single-column layouts + Continuous: correct Letter sheets (816×1056), header on page 1, items flow across pages filling them tightly, no orphaned heading. The code below is the original section-level scaffold; the shipped version is item-level (see `src/pagination.js`).

Add the DOM glue and wire it into `renderCurrentResume()`. Cover the five single-column layouts and Continuous mode (all layouts). Browser/desktop-verified.

**Files:**
- Modify: `src/pagination.js` (add DOM helpers, the layout map, `paginate`, continuous + single-column paths)
- Modify: `src/main.js` (import + call `paginate` in `renderCurrentResume`)

- [ ] **Step 1: Add the DOM glue to `src/pagination.js`**

Add the import at the top of `src/pagination.js` (below the module header comment):

```javascript
import { pageDimsIn } from './pageSetup.js';

const PX_PER_IN = 96;

// Layout adapter map. `body` (single) = the wrapper whose direct children are
// blocks. For two-column layouts (Task 6) `grid`/`cols`/`bodyWrap`/`lead` are used.
const LAYOUTS = {
  stacked:            { family: 'single', body: '.stacked-body' },
  'stacked-vertical': { family: 'single', body: '.stacked-vertical-body' },
  classic:            { family: 'single', body: '.classic-body' },
  'classic-featured': { family: 'single', body: '.classic-featured-body' },
  creative:           { family: 'single', body: '.creative-body' },
  sidebar:        { family: 'two', grid: '.resume-body',        cols: ['.resume-sidebar', '.resume-main'] },
  'right-sidebar':{ family: 'two', grid: '.right-sidebar-body', cols: ['.resume-main', '.resume-sidebar'] },
  modern:         { family: 'two', grid: '.modern-body',        cols: ['.modern-sidebar', '.modern-main'] },
  timeline:       { family: 'two', grid: '.timeline-body',      cols: ['.timeline-main', '.timeline-sidebar'] },
  compact:        { family: 'two', bodyWrap: '.compact-body',   grid: '.compact-columns',   cols: ['.compact-main', '.compact-sidebar'] },
  executive:      { family: 'two', bodyWrap: '.executive-body', grid: '.executive-columns', cols: ['.executive-main', '.executive-side'], lead: '.executive-summary' },
};
```

Then add these helpers and the public `paginate` + single-column path to the SAME file (after `assignBlocksToPages`):

```javascript
// --- measurement (offsetTop/offsetHeight are layout px — unaffected by the zoom
// CSS transform on .resume-container, so no scale math is needed) ---

function computedV(el, prop) {
  const v = parseFloat(getComputedStyle(el)[prop]);
  return Number.isFinite(v) ? v : 0;
}
// Outer box height incl. vertical margins (for the header / lead band).
function blockOuterHeight(el) {
  return el.offsetHeight + computedV(el, 'marginTop') + computedV(el, 'marginBottom');
}
// Vertical padding of a content wrapper (column/body), applied on every sheet.
function vPadding(el) {
  return computedV(el, 'paddingTop') + computedV(el, 'paddingBottom');
}
// Per-block "slot" heights via offsetTop deltas (captures margins AND flex/grid
// gaps); the last block uses its own border-box + bottom margin. Siblings share
// an offsetParent, so the deltas are valid regardless of what it is.
function measureBlocks(blocks) {
  const n = blocks.length;
  if (!n) return [];
  const tops = blocks.map((b) => b.offsetTop);
  const out = [];
  for (let i = 0; i < n; i++) {
    out.push(i < n - 1 ? tops[i + 1] - tops[i] : blocks[i].offsetHeight + computedV(blocks[i], 'marginBottom'));
  }
  return out;
}

// --- sheet builders ---
function makePagesContainer() {
  const el = document.createElement('div');
  el.className = 'resume-pages';
  return el;
}
function makeSheet(widthPx, heightPx) {
  const page = document.createElement('div');
  page.className = 'resume-page';
  page.style.width = `${widthPx}px`;
  if (heightPx == null) page.classList.add('is-continuous');
  else page.style.height = `${heightPx}px`;
  return page;
}
function grow(el) { el.style.flex = '1 1 auto'; el.style.minHeight = '0'; return el; }

/**
 * Paginate the just-rendered résumé in place.
 * @param {HTMLElement} resumeEl - the #resume element (its children are header + body).
 * @param {{pageSize,orientation,pageWidthIn}} setup - from the store accessors.
 * @param {string} layoutId - the active layout (passed in; not read from the DOM).
 */
export function paginate(resumeEl, setup, layoutId) {
  if (!resumeEl) return;
  const cfg = LAYOUTS[layoutId] || LAYOUTS.sidebar;
  const { widthIn, heightIn } = pageDimsIn(setup);
  const widthPx = Math.round(widthIn * PX_PER_IN);
  const heightPx = heightIn == null ? null : Math.round(heightIn * PX_PER_IN);

  // Enter paginated state (idempotent; persists across re-renders on the
  // long-lived #resume / #resume-container elements).
  resumeEl.classList.add('is-paginated');
  const container = resumeEl.closest('.resume-container');
  if (container) container.classList.add('is-paginated');
  resumeEl.style.width = `${widthPx}px`;

  if (heightPx == null) { paginateContinuous(resumeEl, widthPx); return; }
  if (cfg.family === 'single') paginateSingle(resumeEl, cfg, widthPx, heightPx);
  else paginateTwo(resumeEl, cfg, widthPx, heightPx);
}

// Continuous: one open-height sheet, no splitting. Works for every layout.
function paginateContinuous(resumeEl, widthPx) {
  const kids = Array.from(resumeEl.childNodes);
  const pages = makePagesContainer();
  const page = makeSheet(widthPx, null);
  kids.forEach((k) => page.appendChild(k));
  pages.appendChild(page);
  resumeEl.replaceChildren(pages);
}

function paginateSingle(resumeEl, cfg, widthPx, heightPx) {
  const header = resumeEl.querySelector(`:scope > .resume-header`);
  const body = resumeEl.querySelector(`:scope > ${cfg.body}`);
  if (!body) { paginateContinuous(resumeEl, widthPx); return; }

  const blocks = Array.from(body.children);
  const headerH = header ? blockOuterHeight(header) : 0;
  const pad = vPadding(body);
  const pageContentPx = Math.max(1, heightPx - pad);
  const firstPageContentPx = Math.max(1, pageContentPx - headerH);
  const heights = measureBlocks(blocks);
  const assign = assignBlocksToPages(heights, { firstPageContentPx, pageContentPx });
  const numPages = Math.max(1, (assign[assign.length - 1] ?? 0) + 1);

  const pages = makePagesContainer();
  for (let p = 0; p < numPages; p++) {
    const page = makeSheet(widthPx, heightPx);
    if (p === 0 && header) page.appendChild(header);
    const bodyClone = body.cloneNode(false); // shallow: keep classes, drop children
    blocks.forEach((b, i) => { if (assign[i] === p) bodyClone.appendChild(b); });
    grow(bodyClone);
    page.appendChild(bodyClone);
    pages.appendChild(page);
  }
  resumeEl.replaceChildren(pages);
}
```

> NOTE: `paginateTwo` is added in Task 6. Until then, two-column layouts fall through `paginate` to `paginateTwo` — so add a TEMPORARY stub at the end of the file for this task so single-column work is testable in isolation:
> ```javascript
> function paginateTwo(resumeEl, _cfg, widthPx, _heightPx) { paginateContinuous(resumeEl, widthPx); }
> ```
> Task 6 replaces this stub with the real implementation.

- [ ] **Step 2: Wire the hook into `renderCurrentResume()`**

In `src/main.js`, add to the imports near the top (where other `./` modules are imported):

```javascript
import { paginate } from './pagination.js';
```

In `renderCurrentResume()`, AFTER the layout `switch` finishes assigning the rendered markup to `#resume` (the block ending at line 946) and the `data-layout` block (lines 948-952), and BEFORE `refreshInlineEditor()` (line 967), insert:

```javascript
  // Paginate the freshly-rendered DOM into page sheets (before the inline editor
  // re-attaches, so contenteditable is restored over the paginated nodes).
  paginate(container, {
    pageSize: store.getPageSize(),
    orientation: store.getOrientation(),
    pageWidthIn: store.getPageWidthIn(),
  }, currentLayout);
```

(`container` is `#resume`; `currentLayout` is already in scope in this function.)

- [ ] **Step 3: Run the unit suite (no regressions)**

Run: `npm test`
Expected: PASS. (The DOM glue isn't exercised by jsdom tests; this confirms nothing else broke.)

- [ ] **Step 4: Verify in the desktop app (controller visual pass)**

Launch the app from `resume-designer/`: `npm run tauri dev` (run in background; JS hot-reloads via Vite). With fabricated sample data, for EACH single-column layout (stacked, stacked-vertical, classic, classic-featured, creative) and Continuous mode:
- Set Page Size to Letter (temporarily via the export dialog or `store.setPageSize('letter')` in the console) and confirm the preview splits into discrete Letter sheets with a gap + drop shadow between them; the header sits on sheet 1 only; blocks break between sections (never mid-section).
- Switch to Continuous and confirm it collapses to one open-height sheet at the set width.
- Click into a field and edit it; confirm the edit saves and the caret/section is preserved after the re-render+re-paginate.
Fix any measurement/budget issues in `paginateSingle` and re-verify. (Caret stability is hardened in Task 8.)

- [ ] **Step 5: Commit**

```bash
git add src/pagination.js src/main.js
git commit -m "feat(pagination): single-column sheets + render hook

Add the DOM paginator (measure via offsetTop deltas, move nodes into
page-height .resume-page sheets) for the five single-column layouts and
Continuous mode, wired as a post-render hook in renderCurrentResume()
before the inline editor re-attaches. Two-column path stubbed for now.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Two-column DOM paginator + adapters

> **IMPLEMENTED with item-level breaks** (commit `a35e53d`). Each column is flowed INDEPENDENTLY using the same item-level flow units from Task 5 (the main column's experience splits across pages; timeline's `.timeline-item`s split via an extended `splittableInfo`). Per-page grids are built from shallow-cloned grid + column nodes so `grid-template-columns`, CSS `order`, and the sidebar `background` are preserved — verified that the sidebar background fills EVERY sheet full-height (ratio 1.0), including pages where the sidebar column is empty. The full-width header and the executive `.executive-summary` lead band sit on sheet 1 only. Verified live across all 6 two-column layouts (sidebar, right-sidebar, modern, compact, executive, timeline): correct column sides, independent splitting, sidebar fill. The code below is the original section-level draft; the shipped version is item-level (see `src/pagination.js`).

Replace the stub with the real two-column path: paginate each column independently, then build per-page grids (sidebar background fills each sheet; full-width header + lead band on sheet 1 only). Covers sidebar, right-sidebar, modern, compact, executive, timeline.

**Files:**
- Modify: `src/pagination.js` (replace the `paginateTwo` stub)

- [ ] **Step 1: Replace the `paginateTwo` stub with the real implementation**

In `src/pagination.js`, REMOVE the temporary stub from Task 5 and add:

```javascript
function paginateTwo(resumeEl, cfg, widthPx, heightPx) {
  const header = resumeEl.querySelector(`:scope > .resume-header`);
  const bodyWrap = cfg.bodyWrap ? resumeEl.querySelector(`:scope > ${cfg.bodyWrap}`) : null;
  const gridHost = bodyWrap || resumeEl;
  const grid = gridHost.querySelector(`:scope > ${cfg.grid}`);
  if (!grid) { paginateContinuous(resumeEl, widthPx); return; }

  const leadEls = cfg.lead ? Array.from(bodyWrap.querySelectorAll(`:scope > ${cfg.lead}`)) : [];
  const colEls = cfg.cols.map((sel) => grid.querySelector(`:scope > ${sel}`)).filter(Boolean);
  if (colEls.length < 2) { paginateContinuous(resumeEl, widthPx); return; }

  const headerH = header ? blockOuterHeight(header) : 0;
  const leadH = leadEls.reduce((s, el) => s + blockOuterHeight(el), 0);

  // Paginate each column independently against its own padding.
  const cols = colEls.map((col) => {
    const blocks = Array.from(col.children);
    const pad = vPadding(col);
    const pageContentPx = Math.max(1, heightPx - pad);
    const firstPageContentPx = Math.max(1, pageContentPx - headerH - leadH);
    const assign = assignBlocksToPages(measureBlocks(blocks), { firstPageContentPx, pageContentPx });
    return { col, blocks, assign };
  });

  const numPages = Math.max(1, ...cols.map(({ assign }) => (assign[assign.length - 1] ?? 0) + 1));

  const pages = makePagesContainer();
  for (let p = 0; p < numPages; p++) {
    const page = makeSheet(widthPx, heightPx);
    if (p === 0 && header) page.appendChild(header);

    // Rebuild the body-wrapper chain (if any) so its CSS + the lead band apply.
    let mount = page;
    if (bodyWrap) {
      const bw = bodyWrap.cloneNode(false);
      bw.style.display = 'flex';
      bw.style.flexDirection = 'column';
      grow(bw);
      if (p === 0) leadEls.forEach((el) => bw.appendChild(el));
      page.appendChild(bw);
      mount = bw;
    }

    const gridClone = grid.cloneNode(false); // keep grid-template + classes
    grow(gridClone);
    cols.forEach(({ col, blocks, assign }) => {
      const colClone = col.cloneNode(false); // keep column classes (sidebar bg, order)
      blocks.forEach((b, i) => { if (assign[i] === p) colClone.appendChild(b); });
      gridClone.appendChild(colClone);
    });
    mount.appendChild(gridClone);
    pages.appendChild(page);
  }
  resumeEl.replaceChildren(pages);
}
```

Key points (why this works):
- `cloneNode(false)` on the grid and each column preserves their classes, so `grid-template-columns`, the CSS `order` (right-sidebar), and `background: var(--sidebar-bg)` all still apply on every sheet.
- Columns are appended in the original DOM order (`cfg.cols`), so the grid template + `order` reproduce the correct visual sides.
- `grow()` makes the grid fill the sheet's remaining height; grid items default to `align: stretch`, so the colored sidebar background reaches the bottom of EACH sheet (the desired multi-page look).
- The full-width header and the executive `lead` summary band sit on sheet 1 only; sheet-1 column budgets subtract `headerH + leadH`.

- [ ] **Step 2: Run the unit suite (no regressions)**

Run: `npm test`
Expected: PASS (DOM glue not exercised by jsdom).

- [ ] **Step 3: Verify every two-column layout in the desktop app (controller visual pass)**

With the app running and fabricated data long enough to force ≥2 pages, for EACH two-column layout (sidebar, right-sidebar, modern, compact, executive, timeline) at Letter:
- Confirm two columns appear on each sheet, columns break independently, and the colored sidebar background fills each sheet top-to-bottom.
- Confirm column SIDES are correct (e.g. right-sidebar keeps the sidebar on the right; modern keeps it on the left).
- Executive: confirm the summary band shows on sheet 1 only, above the two columns.
- Timeline: confirm the rail dots/lines render per item across the break (acceptable if a connector ends at a page edge).
- Edit a field in each column; confirm save + re-paginate works.
Tune budgets in `paginateTwo` as needed and re-verify.

- [ ] **Step 4: Commit**

```bash
git add src/pagination.js
git commit -m "feat(pagination): two-column sheets across the six sidebar layouts

Paginate the sidebar and main columns independently into per-page grids
(cloned grid/column nodes preserve grid-template, order, and the sidebar
background, which fills each sheet); header and the executive summary band
sit on sheet 1 only. Covers sidebar, right-sidebar, modern, compact,
executive, timeline.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Design-tab Page Setup UI + export-dialog alignment

Replace the four-option Page Size segmented control with a Page Setup group: a Size dropdown, an Orientation toggle (fixed sizes only), and a Width field (Continuous only). Align the export dialog's options.

**Files:**
- Modify: `src/components/structure/DesignTab.jsx:17` (state), `:1319-1337` (the control)
- Modify: `src/components/TypstExportDialog.jsx:27-32` (size options)

- [ ] **Step 1: Add the Select import + state to DesignTab**

In `src/components/structure/DesignTab.jsx`, add the Select primitive import (next to the other `@/components/ui/*` imports, around line 24):

```javascript
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
```

Find the existing page-size state line (around line 510, `const [pageSize, setPageSizeState] = useState(() => store.getPageSize());`) and add two more, right after it:

```javascript
  const [orientation, setOrientationState] = useState(() => store.getOrientation());
  const [pageWidthIn, setPageWidthState] = useState(() => store.getPageWidthIn());
```

- [ ] **Step 2: Replace the Page Size control with a Page Setup group**

In `src/components/structure/DesignTab.jsx`, REPLACE the entire `{/* Page size */}` `ControlGroup` (lines 1319-1337) with:

```jsx
        {/* Page setup */}
        <ControlGroup label="Page Setup">
          <Select
            value={pageSize}
            onValueChange={(v) => { setPageSizeState(v); store.setPageSize(v); }}
          >
            <SelectTrigger className="h-8">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="continuous">Continuous</SelectItem>
              <SelectItem value="letter">Letter</SelectItem>
              <SelectItem value="a4">A4</SelectItem>
              <SelectItem value="legal">Legal</SelectItem>
              <SelectItem value="tabloid">Tabloid</SelectItem>
            </SelectContent>
          </Select>

          {pageSize === 'continuous' ? (
            <div className="flex items-center gap-2">
              <Label className="text-xs text-muted-foreground">Width</Label>
              <Input
                type="number"
                step="0.5"
                min="4"
                max="24"
                className="h-8 px-2"
                value={pageWidthIn}
                onChange={(e) => {
                  const v = parseFloat(e.target.value);
                  if (!Number.isFinite(v)) return;
                  setPageWidthState(v);
                  store.setPageWidthIn(v);
                }}
              />
              <span className="text-xs text-muted-foreground">in</span>
            </div>
          ) : (
            <Segmented
              stretch
              options={[
                { value: 'portrait', label: 'Portrait' },
                { value: 'landscape', label: 'Landscape' },
              ]}
              value={orientation}
              onChange={(v) => { setOrientationState(v); store.setOrientation(v); }}
            />
          )}

          <p className="text-xs text-muted-foreground">
            Continuous is one open-ended page; fixed sizes paginate into sheets.
          </p>
        </ControlGroup>
```

- [ ] **Step 3: Align the export dialog's size options**

In `src/components/TypstExportDialog.jsx`, REPLACE `PAGE_SIZE_OPTIONS` (lines 27-32) with:

```javascript
const PAGE_SIZE_OPTIONS = [
  { value: 'continuous', label: 'Continuous' },
  { value: 'letter', label: 'Letter' },
  { value: 'a4', label: 'A4' },
  { value: 'legal', label: 'Legal' },
  { value: 'tabloid', label: 'Tabloid' },
];
```

And change the dialog's initial state default (line 39) from `useState('auto')` to:

```javascript
  const [pageSize, setPageSize] = useState('continuous');
```

(The dialog already syncs from `store.getPageSize()` on open at line 107, so legacy `'auto'` resumes resolve to `'continuous'` via the store.)

- [ ] **Step 4: Verify in the desktop app (controller visual pass)**

With the app running:
- Open the Design tab → Page Setup. Confirm the Size dropdown lists Continuous/Letter/A4/Legal/Tabloid. Selecting a fixed size shows the Orientation toggle; selecting Continuous shows the Width field.
- Change Size → the preview re-paginates immediately (sheets appear/disappear). Toggle Orientation on a fixed size → sheets rotate. Change Width on Continuous → the single sheet resizes.
- Open the export dialog; confirm the size selector reflects the same value and the PDF preview matches.

- [ ] **Step 5: Commit**

```bash
git add src/components/structure/DesignTab.jsx src/components/TypstExportDialog.jsx
git commit -m "feat(ui): page setup group (size, orientation, width)

Replace the page-size segmented control with a Page Setup group: a size
dropdown (Continuous/Letter/A4/Legal/Tabloid), an orientation toggle for
fixed sizes, and a width field for continuous. Align the export dialog's
size options with the new model.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: Polish — caret stability, edge cases, final review

Harden the edit→re-render→re-paginate cycle and the edge cases, then run a final review.

**Files:**
- Modify: `src/pagination.js` and/or `src/inlineEditor.js` (only if verification surfaces issues)

- [ ] **Step 1: Verify caret stability across the edit cycle (desktop app)**

Because `paginate` MOVES nodes (it does not recreate them), each block keeps its `data-editable` attribute and listeners, and `refreshInlineEditor()` (which re-selects by `[data-editable="…"]`) runs after pagination. Confirm in the app, for both a single-column and a two-column layout at a fixed size:
- Edit a field that lives on page 2; on blur the value saves and the page-2 content stays put (no jump to page 1).
- Rapidly edit several fields in a row; no stale/duplicated nodes appear.
If the caret/selection is lost, the fix belongs in `refreshInlineEditor()` (re-focus the element matching the last-edited `data-editable` path) — keep it minimal.

- [ ] **Step 2: Verify the edge cases (desktop app)**

- Empty résumé (clear most fields) → exactly one sheet, no crash.
- A single block taller than a page (paste a very long bullet list) → it gets its own sheet and is allowed to overflow the bottom (no crash).
- Switch a fixed size → Continuous → the sheets collapse back to one open sheet; Continuous → fixed re-splits.
- Zoom in/out (zoom controls) → sheets scale together; measurement stays correct (offsetHeight is transform-independent), so page breaks don't shift when zooming.

- [ ] **Step 3: Performance sanity (desktop app)**

Edit fields rapidly and confirm no visible lag. Résumé content is tens of blocks, so measure+reflow is a few ms. Only if a real stall is observed, add a guard in `paginate` that skips re-pagination when the page setup + block count + total height are unchanged since the last call; otherwise leave it simple (do NOT add speculative caching).

- [ ] **Step 4: Run the full unit suite one more time**

Run: `npm test`
Expected: PASS (all suites, including the unchanged golden round-trips and Typst snapshots).

- [ ] **Step 5: Final review subagent**

Dispatch the final code-quality reviewer over the whole feature (the diff from the merge-base of `feat/document-model` for the files in this plan). Confirm: the pure/DOM split is clean, no dead code (e.g., the Task-5 stub is gone), commit messages are commitlint-compliant, and the spec's §1-§6 are all covered.

- [ ] **Step 6: Commit any polish fixes**

```bash
git add <only the files you changed>
git commit -m "fix(pagination): <what the verification surfaced>

<one-line why>

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

(If Steps 1-3 surfaced nothing to change, skip this commit.)

---

## Self-Review (controller, before dispatch)

- **Spec coverage:** §1 model → Task 2 (+ §1 dims → Task 1); §2 engine → Tasks 4-6; §3 adapters → the `LAYOUTS` map (Tasks 5-6); §4 Typst → Task 3; §5 UI → Task 7; §6 edge cases → Task 8; §7 testing → pure tests in Tasks 1/2/4, visual in 5/6/8. All covered.
- **Type/name consistency:** `pageDimsIn`, `normalizePageSize`, `assignBlocksToPages`, `paginate` are spelled identically across tasks; the store accessors match the names DesignTab/TypstExportDialog call.
- **No placeholders:** every code step has complete code; every command has an expected result.
- **Byte-stability:** `EMPTY_RESUME`/`POPULATED` etc. carry no page-setup keys, and `modelToFlat` omits all three at their defaults → the six golden round-trips stay green (verified in Task 2 Step 6).
- **Snapshot stability:** the Typst snapshot models default to continuous (8.5in × auto) → identical `#set page(...)` → snapshots unchanged (verified in Task 3 Step 4).

## Out of Scope

- Pixel-exact match between on-screen sheets and the Typst PDF (two engines — approximation by design; the export dialog's PDF.js preview remains the exact source of truth).
- Splitting a single block mid-content (breaks happen between blocks).
- Page numbers / headers / footers / print-bleed marks in the PDF.
- Filling the colored sidebar background to the bottom of overflow pages **in the PDF** (the on-screen paginator already does this per sheet; the PDF limitation is tracked separately).
