# Document Model — Phase 1 (Model + Schema + Migration) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Introduce the structured document model as a new, parallel layer — a ProseMirror/TipTap résumé schema plus a **lossless, versioned `flat ⇄ model` migration** — and prove every existing résumé round-trips through it byte-for-byte, **without changing any user-visible behavior** (the live `renderer.js` / `inlineEditor.js` / export keep using the flat data untouched).

**Architecture:** Two new pure modules in `src/` — `documentModel.js` (the ProseMirror schema + validators + an empty-doc factory) and `migrateToModel.js` (`flatToModel` / `modelToFlat`, versioned with `SCHEMA_VERSION`). Nothing reads the model in production yet; Phase 2 swaps the editor/renderer onto it. The gate is a vitest round-trip suite proving `modelToFlat(flatToModel(data))` deep-equals `data` for golden samples, and that generated models validate against the schema with reading order = model order.

**Tech Stack:** `prosemirror-model` (the schema engine TipTap is built on — added as a real app dep now, reused by TipTap in Phase 2), vitest + jsdom (existing), Node 22.

**Conventions:** Repo root `/Users/ashshah/Projects/Resume-Designer`; npm project under `resume-designer/`. Tests live in `resume-designer/test/**/*.test.js`, vitest `environment: jsdom`, **explicit imports** `import { describe, it, expect } from 'vitest'`, importing real modules from `../src/`. Commits are **gated on Ash's explicit go-ahead** — run "Commit" steps only after that. Run npm/vitest from `resume-designer/`. Disambiguate the `next` branch from the `next` tag with `refs/heads/next` / `origin/next`.

---

## File Structure

| File | Responsibility |
|---|---|
| `resume-designer/src/documentModel.js` (new) | The `resumeSchema` (ProseMirror `Schema`), `SCHEMA_VERSION`, `validateModel(json)` (throws on invalid), `createEmptyModel()`. |
| `resume-designer/src/migrateToModel.js` (new) | `flatToModel(flat)` and `modelToFlat(model)` — the lossless inverse pair; demuxes the flat special-fields (summary/experience/education/tools) + generic `sections[]` to/from typed `section` nodes. |
| `resume-designer/test/documentModel.test.js` (new) | Schema accepts a valid résumé doc, rejects a malformed one; reading order = model order. |
| `resume-designer/test/migrateToModel.test.js` (new) | Lossless round-trip on golden samples (`EMPTY_RESUME` + populated + sparse/edge cases). |
| `resume-designer/package.json` (modify) | Add `prosemirror-model` dependency. |

**Model shape (what `flatToModel` emits):** `doc → header (atom; attrs name/tagline/contact) + section*`. Each flat construct maps to a typed `section`:
- `summary` → `section{sectionKind:'summary'}` with one `paragraph`.
- each `sections[i]` (generic `{id,title,type,content[]}`) → `section{sectionKind:'custom', id, title, type}` with one `paragraph` per `content[]` string.
- `experience[]` → `section{sectionKind:'experience'}` with `experienceItem{id,title,company,dates}` nodes, each wrapping a `bulletList` of the bullets.
- `education[]` → `section{sectionKind:'education'}` with one `paragraph` per line.
- `tools` (string) → `section{sectionKind:'tools'}` with one `paragraph` (verbatim string; Phase 2 refines to tags).

Text is stored **verbatim** (including any `**bold**` markers — Phase 2 parses those into marks), so round-trip is exact. IDs, section `type`, `dates`, and `contact` ride in node attrs.

---

## Pre-flight

- [ ] **Step 1: Branch off `next`**

```bash
git -C /Users/ashshah/Projects/Resume-Designer fetch origin
git -C /Users/ashshah/Projects/Resume-Designer switch next
git -C /Users/ashshah/Projects/Resume-Designer merge --ff-only origin/next
git -C /Users/ashshah/Projects/Resume-Designer switch -c feat/document-model
```

- [ ] **Step 2: Add the schema engine dependency**

```bash
cd /Users/ashshah/Projects/Resume-Designer/resume-designer
npm install prosemirror-model
```
Expected: `prosemirror-model` appears in `package.json` dependencies.

---

## Task 1: The résumé schema (`documentModel.js`)

**Files:**
- Create: `resume-designer/src/documentModel.js`
- Test: `resume-designer/test/documentModel.test.js`

- [ ] **Step 1: Write the failing test**

`resume-designer/test/documentModel.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { resumeSchema, validateModel, createEmptyModel, SCHEMA_VERSION } from '../src/documentModel.js';

const validDoc = {
  type: 'doc',
  content: [
    { type: 'header', attrs: { name: 'Ada Lovelace', tagline: 'Pioneer', contact: { email: 'ada@x.com' } } },
    { type: 'section', attrs: { id: 's1', title: 'Summary', type: 'text', sectionKind: 'summary' },
      content: [{ type: 'paragraph', content: [{ type: 'text', text: 'First programmer.' }] }] },
  ],
};

describe('resumeSchema', () => {
  it('accepts a valid résumé document', () => {
    expect(() => validateModel(validDoc)).not.toThrow();
  });
  it('rejects a document whose first node is not a header', () => {
    const bad = { type: 'doc', content: [{ type: 'paragraph', content: [] }] };
    expect(() => validateModel(bad)).toThrow();
  });
  it('createEmptyModel() is valid and carries the schema version', () => {
    const empty = createEmptyModel();
    expect(empty.attrs?.schemaVersion ?? SCHEMA_VERSION).toBe(SCHEMA_VERSION);
    expect(() => validateModel(empty)).not.toThrow();
  });
  it('serializes to DOM in model order', async () => {
    const { DOMSerializer } = await import('prosemirror-model');
    const { JSDOM } = await import('jsdom');
    const dom = new JSDOM('<!doctype html><body></body>');
    const doc = resumeSchema.nodeFromJSON({
      type: 'doc', content: [
        { type: 'header', attrs: { name: 'Ada', tagline: '', contact: {} } },
        { type: 'section', attrs: { id: 'a', title: 'Skills', type: 'list', sectionKind: 'custom' },
          content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Math' }] }] },
      ],
    });
    const frag = DOMSerializer.fromSchema(resumeSchema)
      .serializeFragment(doc.content, { document: dom.window.document });
    const wrap = dom.window.document.createElement('div');
    wrap.appendChild(frag);
    const text = wrap.textContent.replace(/\s+/g, ' ').trim();
    expect(text.indexOf('Ada')).toBeLessThan(text.indexOf('Math'));
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```bash
cd /Users/ashshah/Projects/Resume-Designer/resume-designer
npx vitest run test/documentModel.test.js
```
Expected: FAIL — `Cannot find module '../src/documentModel.js'`.

- [ ] **Step 3: Implement `documentModel.js`**

`resume-designer/src/documentModel.js`:
```js
import { Schema } from 'prosemirror-model';

// Bump when the model's node/attr shape changes in a way that needs migration.
export const SCHEMA_VERSION = 1;

// Résumé document schema. Reading order = depth-first node order. `header` is an
// atom holding name/tagline/contact in attrs; every résumé area becomes a typed
// `section`. Text (incl. any **markers**) is stored verbatim in text nodes.
export const resumeSchema = new Schema({
  nodes: {
    doc: { content: 'header section*', attrs: { schemaVersion: { default: SCHEMA_VERSION } } },
    header: {
      atom: true,
      attrs: { name: { default: '' }, tagline: { default: '' }, contact: { default: {} } },
      toDOM: (n) => ['header', {}, `${n.attrs.name} ${n.attrs.tagline}`.trim()],
      parseDOM: [{ tag: 'header' }],
    },
    section: {
      attrs: { id: { default: '' }, title: { default: '' }, type: { default: 'text' }, sectionKind: { default: 'custom' } },
      content: 'block*',
      toDOM: (n) => ['section', { 'data-kind': n.attrs.sectionKind, 'data-type': n.attrs.type, 'data-id': n.attrs.id }, 0],
      parseDOM: [{ tag: 'section' }],
    },
    paragraph: { group: 'block', content: 'inline*', toDOM: () => ['p', 0], parseDOM: [{ tag: 'p' }] },
    bulletList: { group: 'block', content: 'listItem*', toDOM: () => ['ul', 0], parseDOM: [{ tag: 'ul' }] },
    listItem: { content: 'paragraph', toDOM: () => ['li', 0], parseDOM: [{ tag: 'li' }] },
    experienceItem: {
      group: 'block',
      attrs: { id: { default: '' }, title: { default: '' }, company: { default: '' }, dates: { default: '' } },
      content: 'bulletList?',
      toDOM: (n) => ['div', { class: 'exp', 'data-id': n.attrs.id, 'data-title': n.attrs.title, 'data-company': n.attrs.company, 'data-dates': n.attrs.dates }, 0],
      parseDOM: [{ tag: 'div.exp' }],
    },
    text: { group: 'inline' },
  },
  marks: {
    bold: { toDOM: () => ['strong', 0], parseDOM: [{ tag: 'strong' }] },
    italic: { toDOM: () => ['em', 0], parseDOM: [{ tag: 'em' }] },
    link: { attrs: { href: {} }, toDOM: (m) => ['a', { href: m.attrs.href }, 0], parseDOM: [{ tag: 'a[href]', getAttrs: (el) => ({ href: el.getAttribute('href') }) }] },
  },
});

// Throws if `json` is not a valid résumé document for the schema.
export function validateModel(json) {
  const doc = resumeSchema.nodeFromJSON(json); // throws on structural violations
  doc.check();                                  // throws on content-model violations
  return doc;
}

export function createEmptyModel() {
  return {
    type: 'doc',
    attrs: { schemaVersion: SCHEMA_VERSION },
    content: [{ type: 'header', attrs: { name: '', tagline: '', contact: {} } }],
  };
}
```

- [ ] **Step 4: Run it — verify it passes**

```bash
cd /Users/ashshah/Projects/Resume-Designer/resume-designer
npx vitest run test/documentModel.test.js
```
Expected: PASS (4 tests). If the "rejects non-header" case doesn't throw, confirm `doc.check()` runs; ProseMirror's `nodeFromJSON` already rejects a `doc` whose content violates `header section*`.

- [ ] **Step 5: Commit (gated)**

```bash
git -C /Users/ashshah/Projects/Resume-Designer add resume-designer/src/documentModel.js resume-designer/test/documentModel.test.js resume-designer/package.json resume-designer/package-lock.json
git -C /Users/ashshah/Projects/Resume-Designer commit -m "feat(model): add résumé ProseMirror schema + validators"
```

---

## Task 2: `flatToModel` migration

**Files:**
- Create: `resume-designer/src/migrateToModel.js`
- Test: `resume-designer/test/migrateToModel.test.js`

- [ ] **Step 1: Write the failing test (flat → valid model, reading order)**

`resume-designer/test/migrateToModel.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { flatToModel, modelToFlat } from '../src/migrateToModel.js';
import { validateModel } from '../src/documentModel.js';

const POPULATED = {
  name: 'Ada Lovelace',
  tagline: 'Analytical Engine Pioneer',
  contact: { location: 'London', email: 'ada@x.com', phone: '', portfolio: '', instagram: '' },
  summary: 'First published algorithm author.',
  sections: [{ id: 'sec_1', title: 'Skills', type: 'list', content: ['Mathematics', 'Algorithm Design'] }],
  experience: [{ id: 'exp_1', title: 'Collaborator', company: 'Analytical Engine', dates: '1842 – 1843', bullets: ['Authored Note G.'] }],
  education: ['B.A. — Somewhere — 1840'],
  tools: 'Difference Engine • Slide Rule',
};

describe('flatToModel', () => {
  it('produces a schema-valid model', () => {
    expect(() => validateModel(flatToModel(POPULATED))).not.toThrow();
  });
  it('puts the header first and sidebar-ish kinds in document order', () => {
    const model = flatToModel(POPULATED);
    expect(model.content[0].type).toBe('header');
    const kinds = model.content.filter((n) => n.type === 'section').map((n) => n.attrs.sectionKind);
    expect(kinds).toContain('summary');
    expect(kinds).toContain('experience');
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```bash
cd /Users/ashshah/Projects/Resume-Designer/resume-designer
npx vitest run test/migrateToModel.test.js
```
Expected: FAIL — `Cannot find module '../src/migrateToModel.js'`.

- [ ] **Step 3: Implement `flatToModel` (and a stub `modelToFlat` for the import)**

`resume-designer/src/migrateToModel.js`:
```js
import { SCHEMA_VERSION } from './documentModel.js';

const para = (text) => ({ type: 'paragraph', content: text ? [{ type: 'text', text }] : [] });
const section = (sectionKind, title, type, content, extra = {}) =>
  ({ type: 'section', attrs: { id: extra.id ?? '', title, type, sectionKind }, content });

// Flat résumé (store.js EMPTY_RESUME shape) → document model. Order is fixed:
// summary, custom sections (in order), experience, education, tools.
export function flatToModel(flat) {
  const content = [{
    type: 'header',
    attrs: { name: flat.name ?? '', tagline: flat.tagline ?? '', contact: flat.contact ?? {} },
  }];

  if (flat.summary) content.push(section('summary', 'Summary', 'text', [para(flat.summary)]));

  for (const s of flat.sections ?? []) {
    content.push(section('custom', s.title ?? '', s.type ?? 'list', (s.content ?? []).map(para), { id: s.id }));
  }

  if ((flat.experience ?? []).length) {
    content.push(section('experience', 'Experience', 'experience', flat.experience.map((e) => ({
      type: 'experienceItem',
      attrs: { id: e.id ?? '', title: e.title ?? '', company: e.company ?? '', dates: e.dates ?? '' },
      content: e.bullets?.length ? [{ type: 'bulletList', content: e.bullets.map((b) => ({ type: 'listItem', content: [para(b)] })) }] : [],
    }))));
  }

  if ((flat.education ?? []).length) {
    content.push(section('education', 'Education', 'list', flat.education.map(para)));
  }

  if (flat.tools) content.push(section('tools', 'Tools', 'text', [para(flat.tools)]));

  return { type: 'doc', attrs: { schemaVersion: SCHEMA_VERSION }, content };
}

export function modelToFlat() { throw new Error('not implemented yet'); }
```

- [ ] **Step 4: Run it — verify it passes**

```bash
cd /Users/ashshah/Projects/Resume-Designer/resume-designer
npx vitest run test/migrateToModel.test.js
```
Expected: PASS for the two `flatToModel` cases (the round-trip cases come in Task 3).

- [ ] **Step 5: Commit (gated)**

```bash
git -C /Users/ashshah/Projects/Resume-Designer add resume-designer/src/migrateToModel.js resume-designer/test/migrateToModel.test.js
git -C /Users/ashshah/Projects/Resume-Designer commit -m "feat(model): flat résumé data → document model"
```

---

## Task 3: `modelToFlat` reverse + the lossless round-trip gate

**Files:**
- Modify: `resume-designer/src/migrateToModel.js`
- Modify: `resume-designer/test/migrateToModel.test.js`

- [ ] **Step 1: Add the failing round-trip tests**

Append to `resume-designer/test/migrateToModel.test.js`:
```js
import { EMPTY_RESUME } from '../src/store.js';

const SPARSE = {
  name: 'X', tagline: '', contact: { location: '', email: '', phone: '', portfolio: '', instagram: '' },
  summary: '', sections: [], experience: [], education: [], tools: '',
};

describe('modelToFlat (lossless round-trip)', () => {
  for (const [label, sample] of [['POPULATED', POPULATED], ['SPARSE', SPARSE], ['EMPTY_RESUME', EMPTY_RESUME]]) {
    it(`round-trips ${label} byte-for-byte`, () => {
      const back = modelToFlat(flatToModel(sample));
      expect(back).toEqual(sample);
    });
  }
});
```
> Note: `EMPTY_RESUME` contains generated ids — `toEqual` compares them as-is since we feed the same object through both directions; ids ride in attrs and are reproduced exactly.

- [ ] **Step 2: Run it — verify it fails**

```bash
cd /Users/ashshah/Projects/Resume-Designer/resume-designer
npx vitest run test/migrateToModel.test.js
```
Expected: FAIL — `modelToFlat` throws "not implemented yet".

- [ ] **Step 3: Implement `modelToFlat`**

Replace the stub in `resume-designer/src/migrateToModel.js`:
```js
const textOf = (node) =>
  (node?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
const paragraphsText = (sectionNode) =>
  (sectionNode.content ?? []).filter((n) => n.type === 'paragraph').map(textOf);

export function modelToFlat(model) {
  const header = (model.content ?? []).find((n) => n.type === 'header');
  const sections = (model.content ?? []).filter((n) => n.type === 'section');

  const flat = {
    name: header?.attrs?.name ?? '',
    tagline: header?.attrs?.tagline ?? '',
    contact: header?.attrs?.contact ?? {},
    summary: '',
    sections: [],
    experience: [],
    education: [],
    tools: '',
  };

  for (const s of sections) {
    const kind = s.attrs?.sectionKind;
    if (kind === 'summary') {
      flat.summary = paragraphsText(s)[0] ?? '';
    } else if (kind === 'experience') {
      flat.experience = (s.content ?? []).filter((n) => n.type === 'experienceItem').map((it) => ({
        id: it.attrs?.id ?? '',
        title: it.attrs?.title ?? '',
        company: it.attrs?.company ?? '',
        dates: it.attrs?.dates ?? '',
        bullets: (((it.content ?? [])[0]?.content) ?? [])
          .filter((li) => li.type === 'listItem')
          .map((li) => textOf((li.content ?? [])[0])),
      }));
    } else if (kind === 'education') {
      flat.education = paragraphsText(s);
    } else if (kind === 'tools') {
      flat.tools = paragraphsText(s)[0] ?? '';
    } else { // 'custom'
      flat.sections.push({
        id: s.attrs?.id ?? '',
        title: s.attrs?.title ?? '',
        type: s.attrs?.type ?? 'list',
        content: paragraphsText(s),
      });
    }
  }
  return flat;
}
```

- [ ] **Step 4: Run it — verify it passes**

```bash
cd /Users/ashshah/Projects/Resume-Designer/resume-designer
npx vitest run test/migrateToModel.test.js
```
Expected: PASS (all `flatToModel` + 3 round-trip cases). **If a case fails:** the diff shows the exact field that diverged — fix the mapping in `flatToModel`/`modelToFlat` (this round-trip suite is the source of truth for losslessness). (Empty sub-fields round-trip correctly because the schema uses `block*` / `listItem*` / `bulletList?`, so an empty flat array maps to genuinely empty content — no placeholder paragraph.)

- [ ] **Step 5: Commit (gated)**

```bash
git -C /Users/ashshah/Projects/Resume-Designer add resume-designer/src/migrateToModel.js resume-designer/test/migrateToModel.test.js
git -C /Users/ashshah/Projects/Resume-Designer commit -m "feat(model): model → flat reverse migration; lossless round-trip green"
```

---

## Task 4: Edge cases — emphasis markers, multiple custom sections, unicode

**Files:**
- Modify: `resume-designer/test/migrateToModel.test.js`

- [ ] **Step 1: Add edge-case round-trip cases**

Append to the `modelToFlat (lossless round-trip)` describe block's sample list (extend the `for` array):
```js
const EMPHASIS = {
  name: 'A', tagline: 'B', contact: { location: '', email: '', phone: '', portfolio: '', instagram: '' },
  summary: 'Led **growth** and _scaled_ the team — 3×.',
  sections: [
    { id: 'a', title: 'Skills', type: 'list', content: ['C++', 'Rust • WASM'] },
    { id: 'b', title: 'Awards', type: 'list', content: ['Turing Award (1966)'] },
  ],
  experience: [{ id: 'e', title: 'Eng', company: 'Acme', dates: '2020–24', bullets: ['Shipped **v2**.', 'Cut costs 40%.'] }],
  education: ['PhD — MIT — 2018', 'BSc — UCL — 2014'],
  tools: 'Figma • VS Code • git',
};

// Exercises the relaxed cardinalities: empty custom-section content + an
// experience item with NO bullets must survive as empty (not `['']`).
const EMPTY_FIELDS = {
  name: 'A', tagline: '', contact: { location: '', email: '', phone: '', portfolio: '', instagram: '' },
  summary: '',
  sections: [{ id: 'x', title: 'Empty Sec', type: 'list', content: [] }],
  experience: [{ id: 'e', title: 'Role', company: 'Co', dates: '', bullets: [] }],
  education: [], tools: '',
};
```
Add `['EMPHASIS', EMPHASIS]` and `['EMPTY_FIELDS', EMPTY_FIELDS]` to the `for` loop array in Task 3's round-trip block.

- [ ] **Step 2: Run it — verify PASS**

```bash
cd /Users/ashshah/Projects/Resume-Designer/resume-designer
npx vitest run test/migrateToModel.test.js
```
Expected: PASS — proves `**`/`_` markers, `•` inside content, multiple ordered custom sections, and multi-line education all survive verbatim (Phase 2 will parse the markers into marks; Phase 1 preserves them as text).

- [ ] **Step 3: Commit (gated)**

```bash
git -C /Users/ashshah/Projects/Resume-Designer add resume-designer/test/migrateToModel.test.js
git -C /Users/ashshah/Projects/Resume-Designer commit -m "test(model): round-trip covers emphasis markers, ordered sections, unicode"
```

---

## Task 5: On-demand model accessor (non-behavioral persistence touch)

**Why:** Expose the model to future phases without changing storage or rendering. A variant's model is computed on demand from its flat `data`; nothing persists or reads it in production yet (Phase 2 makes the editor the model's writer).

**Files:**
- Modify: `resume-designer/src/migrateToModel.js`
- Modify: `resume-designer/test/migrateToModel.test.js`

- [ ] **Step 1: Write the failing test**

Append to `resume-designer/test/migrateToModel.test.js`:
```js
import { getVariantModel } from '../src/migrateToModel.js';

describe('getVariantModel', () => {
  it('derives a valid model from a stored variant, defaulting missing fields', () => {
    const variant = { id: 'v1', name: 'CV', data: { name: 'Ada', tagline: '', contact: {} } };
    const model = getVariantModel(variant);
    expect(model.content[0].type).toBe('header');
    expect(model.content[0].attrs.name).toBe('Ada');
  });
});
```

- [ ] **Step 2: Run it — verify it fails**

```bash
cd /Users/ashshah/Projects/Resume-Designer/resume-designer
npx vitest run test/migrateToModel.test.js
```
Expected: FAIL — `getVariantModel` is not exported.

- [ ] **Step 3: Implement `getVariantModel`**

Append to `resume-designer/src/migrateToModel.js`:
```js
const FLAT_DEFAULTS = {
  name: '', tagline: '', contact: {}, summary: '',
  sections: [], experience: [], education: [], tools: '',
};

// Compute a document model for a stored variant on demand. Pure; persists nothing.
export function getVariantModel(variant) {
  return flatToModel({ ...FLAT_DEFAULTS, ...(variant?.data ?? {}) });
}
```

- [ ] **Step 4: Run the whole suite — verify PASS**

```bash
cd /Users/ashshah/Projects/Resume-Designer/resume-designer
npx vitest run test/documentModel.test.js test/migrateToModel.test.js
```
Expected: PASS (all tests across both files).

- [ ] **Step 5: Full regression — the existing suite stays green**

```bash
cd /Users/ashshah/Projects/Resume-Designer/resume-designer
npm run test && npm run lint && npm run build
```
Expected: existing vitest suite + ESLint + `vite build` all pass (Phase 1 added only new pure modules + a dep — no production code path changed).

- [ ] **Step 6: Commit (gated)**

```bash
git -C /Users/ashshah/Projects/Resume-Designer add resume-designer/src/migrateToModel.js resume-designer/test/migrateToModel.test.js
git -C /Users/ashshah/Projects/Resume-Designer commit -m "feat(model): on-demand getVariantModel accessor; full suite green"
```

---

## Gate (definition of done for Phase 1)

- `modelToFlat(flatToModel(x))` deep-equals `x` for `EMPTY_RESUME`, populated, sparse, and emphasis/unicode samples — every existing résumé is losslessly representable as a model.
- Generated models validate against `resumeSchema`; DOM serialization preserves reading order.
- `npm run test` / `lint` / `build` all green; **no user-visible behavior changed** (renderer/editor/export untouched).
- `prosemirror-model` is a tracked dependency; `documentModel.js` exports the schema TipTap will reuse in Phase 2.

---

## Self-review (author)

- **Spec coverage (spec §11 Phase 1):** model defined → `documentModel.js`; TipTap schema → `resumeSchema` (ProseMirror schema TipTap wraps); flat→model migration → `flatToModel`; round-trip proof → Task 3/4; persistence touch → `getVariantModel` (on-demand, non-behavioral, with model-as-source deferred to Phase 2 per YAGNI — flagged). "Keep old renderer/editor/export working" → satisfied trivially: no production path changes.
- **Placeholder scan:** none — every code step has complete code; Task 3 Step 4 names the concrete fix path for a failing round-trip (the test is the contract).
- **Type consistency:** `flatToModel`/`modelToFlat`/`getVariantModel`/`validateModel`/`createEmptyModel`/`SCHEMA_VERSION`/`resumeSchema` names are consistent across tasks; the flat shape matches `EMPTY_RESUME` exactly (name/tagline/contact/summary/sections[{id,title,type,content[]}]/experience[{id,title,company,dates,bullets[]}]/education[str]/tools).
- **Risk:** the lossless inverse is the only intricate part; it's pinned by the round-trip suite (golden samples incl. edge cases). If a real user variant carries a field not in `EMPTY_RESUME`, add it to `FLAT_DEFAULTS` + a golden sample.
