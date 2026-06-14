# Document Model Phase 2 · PR 2.1 — Schema Evolution + Migration — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Grow the résumé ProseMirror schema so every visible field is an editable node, and retarget the `flat ⇄ model` migration to it — losslessly, with zero production behavior change.

**Architecture:** Two dormant modules change in lockstep: `src/documentModel.js` (the schema) and `src/migrateToModel.js` (`flatToModel`/`modelToFlat`). The six existing golden round-trip samples (`modelToFlat(flatToModel(x)) === x`) are the safety net; each task changes one structural area (header, experience, section headings, education, tags+underline) end-to-end so the suite stays green at every commit. Nothing in `src/` imports these modules, so the app is byte-for-byte unchanged (verified by grep in the final task).

**Tech Stack:** `prosemirror-model` ^1.25.8 (`Schema`, `nodeFromJSON`, `DOMSerializer`), Vitest ^4 (`vitest run`), jsdom ^29. All npm commands run from `resume-designer/`.

**Source spec:** `docs/superpowers/specs/2026-06-14-document-model-phase-2-design.md` (§5 schema, §11 PR 2.1).

---

## Background the implementer needs

**What the model is.** A résumé is represented as a ProseMirror document (plain JSON). Reading order = depth-first node order. Today (`documentModel.js`) the `header` is an **atom** that hides `name`/`tagline`/`contact` in *attributes* — so those can't be edited as text. PR 2.1 makes every field a real node so the future TipTap editor can edit each in place.

**The losslessness contract.** `src/migrateToModel.js` converts the flat résumé shape (`store.js` `EMPTY_RESUME`: `name`, `tagline`, `contact{}`, `summary`, `sections[]`, `experience[]`, `education[]`, `tools`, optional `toolsDisplay`) to/from the model. `test/migrateToModel.test.js` asserts `modelToFlat(flatToModel(sample))` deep-equals `sample` for six samples (POPULATED, SPARSE, EMPTY_RESUME, EMPHASIS, EMPTY_FIELDS, REAL_VARIANT). **These must stay green** — they are how we know no résumé data is lost.

**Two JSON paths, both must hold:**
- *Round-trip path* operates on **raw JSON** (no schema instantiation), so `flatToModel` must write **every attr** `modelToFlat` reads — defaults are NOT auto-filled here.
- *Validity path* (`validateModel` → `nodeFromJSON` → `doc.check()`) DOES fill defaults and checks the content model.

**Scope guards (do NOT do these in PR 2.1):**
- Do **not** bump `SCHEMA_VERSION` (stays `1`). No model has ever been persisted (Phase 1/2.1 are dormant), so there is nothing to migrate between versions.
- Do **not** convert `**bold**`/`_italic_` markers in text into marks. Emphasis stays **verbatim** in text nodes (EMPHASIS sample proves this). The `underline` mark is *added to the schema* but the migration does not emit it.
- Do **not** convert skills/tools into `tagGroup`/`tag` in the migration yet. Those nodes are added to the schema (ready for Phase 2.3) but the migration keeps representing custom sections as paragraphs and tools as a paragraph.
- Do **not** add a `sectionKind`-specific validator. `validateModel` stays structural (`doc.check()`); the permissive `heading block*` section content is intentional for this PR.
- Do **not** import these modules from any other `src/` file. PR 2.1 is non-behavioral.

**Commit conventions (commitlint runs in CI):** subject starts lowercase, scope `model`, body lines ≤100 chars. Footer on every commit:
```
Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>
```

**Reference — the target end-state of `src/migrateToModel.js`** (built up across Tasks 1–4; shown whole here so you can see where each task lands):

```javascript
import { SCHEMA_VERSION } from './documentModel.js';

const text = (s) => (s ? [{ type: 'text', text: s }] : []);
const field = (type, s) => ({ type, content: text(s) });
const para = (s) => ({ type: 'paragraph', content: text(s) });
const heading = (title) => ({ type: 'heading', content: text(title) });

// contactList from a flat contact object: one contactItem per key, in object
// order, INCLUDING empty values — so the object round-trips exactly.
const contactList = (contact) => ({
  type: 'contactList',
  content: Object.entries(contact ?? {}).map(([kind, value]) => ({
    type: 'contactItem', attrs: { kind }, content: text(value),
  })),
});

const headerNode = (flat) => ({
  type: 'header',
  content: [field('name', flat.name ?? ''), field('tagline', flat.tagline ?? ''), contactList(flat.contact)],
});

// A section = heading + blocks. `type` is the custom-section display type,
// carried verbatim (absence preserved via the '' sentinel, omitted on output).
const section = (sectionKind, title, type, blocks, extra = {}) => ({
  type: 'section',
  attrs: { id: extra.id ?? '', type, sectionKind },
  content: [heading(title), ...blocks],
});

const experienceItemNode = (e) => ({
  type: 'experienceItem',
  attrs: { id: e.id ?? '' },
  content: [
    field('jobTitle', e.title ?? ''),
    field('company', e.company ?? ''),
    field('dates', e.dates ?? ''),
    ...(e.bullets?.length
      ? [{ type: 'bulletList', content: e.bullets.map((b) => ({ type: 'listItem', content: [para(b)] })) }]
      : []),
  ],
});

// Flat résumé (store.js EMPTY_RESUME shape) → document model. Order is fixed:
// summary, custom sections (in order), experience, education, tools.
export function flatToModel(flat) {
  const content = [headerNode(flat)];
  if (flat.summary) content.push(section('summary', 'Summary', 'text', [para(flat.summary)]));
  for (const s of flat.sections ?? []) {
    content.push(section('custom', s.title ?? '', s.type ?? '', (s.content ?? []).map(para), { id: s.id }));
  }
  if ((flat.experience ?? []).length) {
    content.push(section('experience', 'Experience', 'experience', flat.experience.map(experienceItemNode)));
  }
  if ((flat.education ?? []).length) {
    content.push(section('education', 'Education', 'list', flat.education.map((e) => field('educationItem', e))));
  }
  if (flat.tools) content.push(section('tools', 'Tools', 'text', [para(flat.tools)]));
  return {
    type: 'doc',
    attrs: { schemaVersion: SCHEMA_VERSION, docType: 'resume', toolsDisplay: flat.toolsDisplay ?? '' },
    content,
  };
}

const textOf = (node) =>
  (node?.content ?? []).filter((c) => c.type === 'text').map((c) => c.text).join('');
const childOfType = (node, type) => (node?.content ?? []).find((n) => n.type === type);
const blocksOfType = (sectionNode, type) => (sectionNode?.content ?? []).filter((n) => n.type === type);
const paragraphsText = (sectionNode) => blocksOfType(sectionNode, 'paragraph').map(textOf);
const headingTitle = (sectionNode) => textOf(childOfType(sectionNode, 'heading'));
const contactOf = (header) => {
  const list = childOfType(header, 'contactList');
  const contact = {};
  for (const item of list?.content ?? []) contact[item.attrs?.kind ?? ''] = textOf(item);
  return contact;
};

export function modelToFlat(model) {
  const header = (model.content ?? []).find((n) => n.type === 'header');
  const sections = (model.content ?? []).filter((n) => n.type === 'section');
  const flat = {
    name: textOf(childOfType(header, 'name')),
    tagline: textOf(childOfType(header, 'tagline')),
    contact: contactOf(header),
    summary: '', sections: [], experience: [], education: [], tools: '',
  };
  for (const s of sections) {
    const kind = s.attrs?.sectionKind;
    if (kind === 'summary') {
      flat.summary = paragraphsText(s)[0] ?? '';
    } else if (kind === 'experience') {
      flat.experience = blocksOfType(s, 'experienceItem').map((it) => ({
        id: it.attrs?.id ?? '',
        title: textOf(childOfType(it, 'jobTitle')),
        company: textOf(childOfType(it, 'company')),
        dates: textOf(childOfType(it, 'dates')),
        bullets: ((childOfType(it, 'bulletList')?.content) ?? [])
          .filter((li) => li.type === 'listItem')
          .map((li) => textOf((li.content ?? [])[0])),
      }));
    } else if (kind === 'education') {
      flat.education = blocksOfType(s, 'educationItem').map(textOf);
    } else if (kind === 'tools') {
      flat.tools = paragraphsText(s)[0] ?? '';
    } else { // 'custom'
      const entry = { id: s.attrs?.id ?? '', title: headingTitle(s), content: paragraphsText(s) };
      if (s.attrs?.type) entry.type = s.attrs.type; // omit when the empty sentinel
      flat.sections.push(entry);
    }
  }
  if (model.attrs?.toolsDisplay) flat.toolsDisplay = model.attrs.toolsDisplay;
  return flat;
}

const FLAT_DEFAULTS = {
  name: '', tagline: '', contact: {}, summary: '',
  sections: [], experience: [], education: [], tools: '',
};

export function getVariantModel(variant) {
  return flatToModel({ ...FLAT_DEFAULTS, ...(variant?.data ?? {}) });
}
```

---

## Task 1: Header becomes contentful (editable name / tagline / contact nodes)

**Files:**
- Modify: `resume-designer/src/documentModel.js` (header → contentful; add `name`/`tagline`/`contactList`/`contactItem` nodes; add `docType` doc attr; update `createEmptyModel`; refresh the schema comment)
- Modify: `resume-designer/src/migrateToModel.js` (header construction + reading)
- Test: `resume-designer/test/documentModel.test.js`, `resume-designer/test/migrateToModel.test.js`

- [ ] **Step 1: Update fixtures + add the failing structural tests**

In `test/documentModel.test.js`, replace the `validDoc` constant (lines 4–11) with the new header shape and a heading in the section:

```javascript
const validDoc = {
  type: 'doc',
  content: [
    { type: 'header', content: [
      { type: 'name', content: [{ type: 'text', text: 'Ada Lovelace' }] },
      { type: 'tagline', content: [{ type: 'text', text: 'Pioneer' }] },
      { type: 'contactList', content: [
        { type: 'contactItem', attrs: { kind: 'email' }, content: [{ type: 'text', text: 'ada@x.com' }] },
      ] },
    ] },
    { type: 'section', attrs: { id: 's1', type: 'text', sectionKind: 'summary' },
      content: [
        { type: 'heading', content: [{ type: 'text', text: 'Summary' }] },
        { type: 'paragraph', content: [{ type: 'text', text: 'First programmer.' }] },
      ] },
  ],
};
```

In the same file, inside `describe('resumeSchema', …)`, replace the header in the `'serializes to DOM in model order'` test's inline doc (lines 30–36) and add a contentful-header test:

```javascript
  it('header is contentful — name/tagline/contactList are editable child nodes', () => {
    const header = validDoc.content[0];
    expect(header.type).toBe('header');
    expect(header.content.map((n) => n.type)).toEqual(['name', 'tagline', 'contactList']);
  });
```

For the serialize test, change its `nodeFromJSON({...})` header to:

```javascript
        { type: 'header', content: [
          { type: 'name', content: [{ type: 'text', text: 'Ada' }] },
          { type: 'tagline', content: [] },
          { type: 'contactList', content: [] },
        ] },
        { type: 'section', attrs: { id: 'a', type: 'list', sectionKind: 'custom' },
          content: [
            { type: 'heading', content: [{ type: 'text', text: 'Skills' }] },
            { type: 'paragraph', content: [{ type: 'text', text: 'Math' }] },
          ] },
```

In `test/migrateToModel.test.js`, add to `describe('flatToModel', …)`:

```javascript
  it('emits a contentful header (name/tagline/contactList nodes)', () => {
    const header = flatToModel(POPULATED).content[0];
    expect(header.content.map((n) => n.type)).toEqual(['name', 'tagline', 'contactList']);
    expect(header.content[0].content[0].text).toBe('Ada Lovelace');
  });
  it('round-trips contact including empty values', () => {
    const back = modelToFlat(flatToModel(POPULATED));
    expect(back.contact).toEqual(POPULATED.contact); // phone/portfolio/instagram '' preserved
  });
```

- [ ] **Step 2: Run the tests to verify they fail**

Run (from `resume-designer/`): `npm run test`
Expected: FAIL — `documentModel.test.js` rejects the new header shape (old schema has `header` as an atom with attrs), and the new `flatToModel` header assertions fail (still emits attrs).

- [ ] **Step 3: Evolve the schema header in `src/documentModel.js`**

Add `docType` to the `doc` node attrs and replace the `header` atom (lines 12–17) with contentful header + the four new nodes. The `doc` node becomes:

```javascript
    doc: {
      content: 'header section*',
      attrs: {
        schemaVersion: { default: SCHEMA_VERSION },
        docType: { default: 'resume' },
        toolsDisplay: { default: '' },
      },
    },
    header: {
      content: 'name tagline contactList',
      toDOM: () => ['header', 0],
      parseDOM: [{ tag: 'header' }],
    },
    name: {
      content: 'text*',
      toDOM: () => ['h1', { class: 'resume-name' }, 0],
      parseDOM: [{ tag: 'h1.resume-name' }],
    },
    tagline: {
      content: 'text*',
      toDOM: () => ['p', { class: 'resume-tagline' }, 0],
      parseDOM: [{ tag: 'p.resume-tagline' }],
    },
    contactList: {
      content: 'contactItem*',
      toDOM: () => ['ul', { class: 'contact-list' }, 0],
      parseDOM: [{ tag: 'ul.contact-list' }],
    },
    contactItem: {
      content: 'text*',
      attrs: { kind: { default: '' } },
      toDOM: (n) => ['li', { class: 'contact-item', 'data-kind': n.attrs.kind }, 0],
      parseDOM: [{ tag: 'li.contact-item', getAttrs: (el) => ({ kind: el.getAttribute('data-kind') || '' }) }],
    },
```

Replace the schema doc comment (lines 6–8) with:

```javascript
// Résumé document schema. Reading order = depth-first node order. Every visible
// field is an editable node (no data hidden in atom attrs) so the TipTap editor
// (Phase 2.3) can edit each field in place. Text (incl. any **markers**) is stored
// verbatim in text nodes; emphasis marks exist but the migration does not emit them.
```

Replace `createEmptyModel` (lines 50–56) with:

```javascript
export function createEmptyModel() {
  return {
    type: 'doc',
    attrs: { schemaVersion: SCHEMA_VERSION, docType: 'resume', toolsDisplay: '' },
    content: [{
      type: 'header',
      content: [
        { type: 'name', content: [] },
        { type: 'tagline', content: [] },
        { type: 'contactList', content: [] },
      ],
    }],
  };
}
```

- [ ] **Step 4: Evolve the header in `src/migrateToModel.js`**

At the top of the file (after the import), add the shared helpers and replace the header construction. Add these helpers above `flatToModel`:

```javascript
const text = (s) => (s ? [{ type: 'text', text: s }] : []);
const field = (type, s) => ({ type, content: text(s) });
const para = (s) => ({ type: 'paragraph', content: text(s) });

const contactList = (contact) => ({
  type: 'contactList',
  content: Object.entries(contact ?? {}).map(([kind, value]) => ({
    type: 'contactItem', attrs: { kind }, content: text(value),
  })),
});
const headerNode = (flat) => ({
  type: 'header',
  content: [field('name', flat.name ?? ''), field('tagline', flat.tagline ?? ''), contactList(flat.contact)],
});
```

Delete the old `const para = …` (line 3 — now defined above) so it is not declared twice. In `flatToModel`, replace the header object (lines 10–13) with `const content = [headerNode(flat)];` and change the `return` doc attrs to include `docType: 'resume'`.

In the model→flat direction, add the readers `childOfType` and `contactOf` next to `textOf`:

```javascript
const childOfType = (node, type) => (node?.content ?? []).find((n) => n.type === type);
const contactOf = (header) => {
  const list = childOfType(header, 'contactList');
  const contact = {};
  for (const item of list?.content ?? []) contact[item.attrs?.kind ?? ''] = textOf(item);
  return contact;
};
```

In `modelToFlat`, replace the three header reads (lines 48–50) with:

```javascript
    name: textOf(childOfType(header, 'name')),
    tagline: textOf(childOfType(header, 'tagline')),
    contact: contactOf(header),
```

- [ ] **Step 5: Run the tests to verify they pass**

Run (from `resume-designer/`): `npm run test`
Expected: PASS — all six round-trip samples green, header structural tests green, DOM-order test green.

- [ ] **Step 6: Commit**

```bash
git add resume-designer/src/documentModel.js resume-designer/src/migrateToModel.js \
        resume-designer/test/documentModel.test.js resume-designer/test/migrateToModel.test.js
git commit -m "feat(model): make header contentful (editable name/tagline/contact nodes)" \
  -m "Header was an atom hiding name/tagline/contact in attrs; now a contentful node with name/tagline/contactList children so each field is inline-editable. Contact round-trips key-for-key incl. empty values. Adds docType doc attr. Non-behavioral." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Experience fields become editable child nodes (jobTitle / company / dates)

**Files:**
- Modify: `resume-designer/src/documentModel.js` (`experienceItem` content + `jobTitle`/`company`/`dates` nodes)
- Modify: `resume-designer/src/migrateToModel.js` (experience construction + reading)
- Test: `resume-designer/test/migrateToModel.test.js`

- [ ] **Step 1: Add the failing structural tests**

In `test/migrateToModel.test.js`, add a new `describe`:

```javascript
describe('experienceItem fields', () => {
  it('exposes jobTitle/company/dates as editable child nodes', () => {
    const exp = flatToModel(POPULATED).content
      .find((n) => n.attrs?.sectionKind === 'experience').content
      .find((n) => n.type === 'experienceItem');
    expect(exp.content.map((n) => n.type)).toEqual(['jobTitle', 'company', 'dates', 'bulletList']);
    expect(exp.content[0].content[0].text).toBe('Collaborator');
  });
  it('omits the bulletList node when an experience item has no bullets', () => {
    const exp = flatToModel(EMPTY_FIELDS).content
      .find((n) => n.attrs?.sectionKind === 'experience').content
      .find((n) => n.type === 'experienceItem');
    expect(exp.content.map((n) => n.type)).toEqual(['jobTitle', 'company', 'dates']);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm run test`
Expected: FAIL — `flatToModel` still emits `experienceItem` with title/company/dates in attrs and `bulletList?` content, so `content.map(type)` is `['bulletList']` or `[]`, not the field nodes.

- [ ] **Step 3: Evolve `experienceItem` in `src/documentModel.js`**

Replace the `experienceItem` node (lines 27–33) with:

```javascript
    experienceItem: {
      group: 'block',
      attrs: { id: { default: '' } },
      content: 'jobTitle company dates bulletList?',
      toDOM: (n) => ['div', { class: 'exp', 'data-id': n.attrs.id }, 0],
      parseDOM: [{ tag: 'div.exp', getAttrs: (el) => ({ id: el.getAttribute('data-id') || '' }) }],
    },
    jobTitle: { content: 'text*', toDOM: () => ['div', { class: 'exp-title' }, 0], parseDOM: [{ tag: 'div.exp-title' }] },
    company: { content: 'text*', toDOM: () => ['div', { class: 'exp-company' }, 0], parseDOM: [{ tag: 'div.exp-company' }] },
    dates: { content: 'text*', toDOM: () => ['div', { class: 'exp-dates' }, 0], parseDOM: [{ tag: 'div.exp-dates' }] },
```

- [ ] **Step 4: Evolve experience in `src/migrateToModel.js`**

Add the `experienceItemNode` builder (above `flatToModel`, after `headerNode`):

```javascript
const experienceItemNode = (e) => ({
  type: 'experienceItem',
  attrs: { id: e.id ?? '' },
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

In `flatToModel`, replace the experience `.map((e) => ({ … }))` block (lines 22–26) with `flat.experience.map(experienceItemNode)`.

In `modelToFlat`, replace the `kind === 'experience'` branch's mapper (lines 63–71) with:

```javascript
      flat.experience = blocksOfType(s, 'experienceItem').map((it) => ({
        id: it.attrs?.id ?? '',
        title: textOf(childOfType(it, 'jobTitle')),
        company: textOf(childOfType(it, 'company')),
        dates: textOf(childOfType(it, 'dates')),
        bullets: ((childOfType(it, 'bulletList')?.content) ?? [])
          .filter((li) => li.type === 'listItem')
          .map((li) => textOf((li.content ?? [])[0])),
      }));
```

This references `blocksOfType`; add it next to `childOfType`:

```javascript
const blocksOfType = (sectionNode, type) => (sectionNode?.content ?? []).filter((n) => n.type === type);
```

(`blocksOfType` reads `experienceItem`s directly, so it works whether or not the section has a heading yet — keeping this task green before Task 3.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test`
Expected: PASS — round-trip samples green (experience now via child nodes), new field-node tests green.

- [ ] **Step 6: Commit**

```bash
git add resume-designer/src/documentModel.js resume-designer/src/migrateToModel.js \
        resume-designer/test/migrateToModel.test.js
git commit -m "feat(model): experience fields as editable jobTitle/company/dates nodes" \
  -m "experienceItem held title/company/dates in attrs; they become child text nodes so each is inline-editable. Bullet-less items omit the optional bulletList. Round-trip preserved. Non-behavioral." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Editable section headings (move the title into a heading node)

**Files:**
- Modify: `resume-designer/src/documentModel.js` (`section` content → `heading block*`; drop `title` attr; add `heading` node)
- Modify: `resume-designer/src/migrateToModel.js` (`section` builder + custom-section reading)
- Test: `resume-designer/test/migrateToModel.test.js`

- [ ] **Step 1: Add the failing structural test**

In `test/migrateToModel.test.js`, add:

```javascript
describe('section headings', () => {
  it('stores a section title in an editable heading node, not an attr', () => {
    const skills = flatToModel(POPULATED).content.find((n) => n.attrs?.id === 'sec_1');
    expect(skills.content[0]).toEqual({ type: 'heading', content: [{ type: 'text', text: 'Skills' }] });
    expect(skills.attrs.title).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test`
Expected: FAIL — the section still carries `title` in attrs and has no `heading` child.

- [ ] **Step 3: Evolve `section` in `src/documentModel.js`**

Replace the `section` node (lines 18–23) with the `title`-less, heading-led version and add the `heading` node:

```javascript
    section: {
      attrs: { id: { default: '' }, type: { default: 'text' }, sectionKind: { default: 'custom' } },
      content: 'heading block*',
      toDOM: (n) => ['section', { 'data-kind': n.attrs.sectionKind, 'data-type': n.attrs.type, 'data-id': n.attrs.id }, 0],
      parseDOM: [{ tag: 'section', getAttrs: (el) => ({
        id: el.getAttribute('data-id') || '',
        type: el.getAttribute('data-type') || 'text',
        sectionKind: el.getAttribute('data-kind') || 'custom',
      }) }],
    },
    heading: {
      content: 'text*',
      toDOM: () => ['h2', 0],
      parseDOM: [{ tag: 'h2' }],
    },
```

- [ ] **Step 4: Evolve the section builder + reader in `src/migrateToModel.js`**

Add the `heading` builder (near the other builders):

```javascript
const heading = (title) => ({ type: 'heading', content: text(title) });
```

Replace the `section` helper (current lines 4–5) with:

```javascript
const section = (sectionKind, title, type, blocks, extra = {}) => ({
  type: 'section',
  attrs: { id: extra.id ?? '', type, sectionKind },
  content: [heading(title), ...blocks],
});
```

Add the `headingTitle` reader next to `childOfType`:

```javascript
const headingTitle = (sectionNode) => textOf(childOfType(sectionNode, 'heading'));
```

In `modelToFlat`, in the `else { // 'custom' }` branch, change the title source from the attr to the heading:

```javascript
      const entry = { id: s.attrs?.id ?? '', title: headingTitle(s), content: paragraphsText(s) };
```

(`paragraphsText` already filters `type === 'paragraph'`, so it naturally skips the new `heading` child — no change needed there. The built-in sections' headings, e.g. "Experience", are emitted but not read back, exactly as the hard-coded titles were before.)

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test`
Expected: PASS — round-trip samples green (every section now leads with a heading; custom titles read from it), heading test green.

- [ ] **Step 6: Commit**

```bash
git add resume-designer/src/documentModel.js resume-designer/src/migrateToModel.js \
        resume-designer/test/migrateToModel.test.js
git commit -m "feat(model): editable section headings (move title into a heading node)" \
  -m "Section title moves from an attr to a leading heading node; section content becomes 'heading block*'. Custom-section titles round-trip via the heading. Non-behavioral." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: Education entries become educationItem nodes

**Files:**
- Modify: `resume-designer/src/documentModel.js` (add `educationItem` node)
- Modify: `resume-designer/src/migrateToModel.js` (education construction + reading)
- Test: `resume-designer/test/migrateToModel.test.js`

- [ ] **Step 1: Add the failing structural test**

In `test/migrateToModel.test.js`, add:

```javascript
describe('education entries', () => {
  it('become educationItem nodes', () => {
    const edu = flatToModel(POPULATED).content.find((n) => n.attrs?.sectionKind === 'education');
    const items = edu.content.filter((n) => n.type === 'educationItem');
    expect(items).toHaveLength(1);
    expect(items[0].content[0].text).toBe('B.A. — Somewhere — 1840');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test`
Expected: FAIL — education is still emitted as paragraphs; there are no `educationItem` nodes.

- [ ] **Step 3: Add the `educationItem` node in `src/documentModel.js`**

Add next to the other block nodes (after `listItem`):

```javascript
    educationItem: { group: 'block', content: 'text*', toDOM: () => ['div', { class: 'edu-item' }, 0], parseDOM: [{ tag: 'div.edu-item' }] },
```

- [ ] **Step 4: Evolve education in `src/migrateToModel.js`**

In `flatToModel`, change the education push (current line 30) to map to `educationItem` field nodes:

```javascript
    content.push(section('education', 'Education', 'list', flat.education.map((e) => field('educationItem', e))));
```

In `modelToFlat`, change the `kind === 'education'` branch from `paragraphsText(s)` to `educationItem` reads:

```javascript
      flat.education = blocksOfType(s, 'educationItem').map(textOf);
```

- [ ] **Step 5: Run the tests to verify they pass**

Run: `npm run test`
Expected: PASS — round-trip samples green (education via `educationItem` nodes), education test green.

- [ ] **Step 6: Commit**

```bash
git add resume-designer/src/documentModel.js resume-designer/src/migrateToModel.js \
        resume-designer/test/migrateToModel.test.js
git commit -m "feat(model): education entries as educationItem nodes" \
  -m "Education becomes one editable educationItem per entry instead of paragraphs. Round-trip preserved. Non-behavioral." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: Add tagGroup / tag nodes and the underline mark (schema-ready)

**Files:**
- Modify: `resume-designer/src/documentModel.js` (`tagGroup`/`tag` nodes; `underline` mark)
- Test: `resume-designer/test/documentModel.test.js`

These nodes/mark are added for Phase 2.3 (skills/tools as structured chips, rich text). The migration does **not** use them yet; this task only proves they are valid and constructible.

- [ ] **Step 1: Add the failing test**

In `test/documentModel.test.js`, inside `describe('resumeSchema', …)`, add:

```javascript
  it('exposes tagGroup/tag nodes and the underline mark', () => {
    expect(resumeSchema.nodes.tagGroup).toBeDefined();
    expect(resumeSchema.nodes.tag).toBeDefined();
    expect(resumeSchema.marks.underline).toBeDefined();
    const doc = {
      type: 'doc',
      content: [
        { type: 'header', content: [
          { type: 'name', content: [{ type: 'text', text: 'A', marks: [{ type: 'underline' }] }] },
          { type: 'tagline', content: [] },
          { type: 'contactList', content: [] },
        ] },
        { type: 'section', attrs: { id: 's', type: 'list', sectionKind: 'skills' }, content: [
          { type: 'heading', content: [{ type: 'text', text: 'Skills' }] },
          { type: 'tagGroup', content: [
            { type: 'tag', content: [{ type: 'text', text: 'Rust' }] },
            { type: 'tag', content: [{ type: 'text', text: 'Go' }] },
          ] },
        ] },
      ],
    };
    expect(() => validateModel(doc)).not.toThrow();
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npm run test`
Expected: FAIL — `resumeSchema.nodes.tagGroup` is undefined; `validateModel` throws on the unknown `tagGroup`/`tag`/`underline`.

- [ ] **Step 3: Add the nodes and mark in `src/documentModel.js`**

Add the block nodes near `educationItem`:

```javascript
    tagGroup: { group: 'block', content: 'tag*', toDOM: () => ['ul', { class: 'tag-group' }, 0], parseDOM: [{ tag: 'ul.tag-group' }] },
    tag: { content: 'text*', toDOM: () => ['li', { class: 'tag' }, 0], parseDOM: [{ tag: 'li.tag' }] },
```

Add the `underline` mark to the `marks` object (after `italic`):

```javascript
    underline: { toDOM: () => ['u', 0], parseDOM: [{ tag: 'u' }] },
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npm run test`
Expected: PASS — schema introspection + the tagGroup/underline doc validate.

- [ ] **Step 5: Commit**

```bash
git add resume-designer/src/documentModel.js resume-designer/test/documentModel.test.js
git commit -m "feat(model): add tagGroup/tag nodes and underline mark" \
  -m "Schema-ready for structured skills/tools chips and underline rich text in Phase 2.3. Migration does not emit them yet. Non-behavioral." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Final verification gate (no code change)

**Files:** none (verification only — no commit unless a check fails and is fixed).

- [ ] **Step 1: Full test suite**

Run (from `resume-designer/`): `npm run test`
Expected: PASS — every test green (the six round-trip samples plus all structural tests).

- [ ] **Step 2: Lint**

Run: `npm run lint`
Expected: no errors (no unused helpers, matches existing style).

- [ ] **Step 3: Build**

Run: `npm run build`
Expected: Vite build succeeds.

- [ ] **Step 4: Confirm non-behavioral (zero production imports)**

Run (from `resume-designer/`):

```bash
grep -rln "documentModel\|migrateToModel" src --include=*.js --include=*.jsx \
  | grep -vE "src/(documentModel|migrateToModel)\.js$"
```

Expected: **no output**. (`migrateToModel.js` imports `documentModel.js`; both are excluded. Any other hit would mean a production file now imports the model — a scope violation for PR 2.1.)

- [ ] **Step 5: Report**

Summarize: all tests green, lint+build clean, zero production imports. PR 2.1 is complete and non-behavioral. Hand back for the two-stage review, then PR 2.2 (truth-flip) planning.

---

## Self-review (run by the plan author)

**Spec coverage (§5, §11 PR 2.1):** editable header/name/tagline/contactList/contactItem → Task 1 ✓ · editable section heading → Task 3 ✓ · experienceItem child fields → Task 2 ✓ · educationItem → Task 4 ✓ · tagGroup/tag → Task 5 ✓ · underline mark → Task 5 ✓ · resolve header `parseDOM` carry-over → Task 1 (header is now contentful with no attrs to recover; child nodes serialize/parse structurally) ✓ · migration retargeted, lossless round-trip → Tasks 1–4, golden samples unchanged ✓ · extend golden tests → structural assertions added per task ✓ · gate (tests green, lint+build, non-behavioral) → Task 6 ✓.

**Placeholder scan:** none — every code step shows complete blocks; commands are exact with expected output.

**Type/name consistency:** helper names (`text`, `field`, `para`, `heading`, `contactList`, `headerNode`, `experienceItemNode`, `section`, `textOf`, `childOfType`, `blocksOfType`, `paragraphsText`, `headingTitle`, `contactOf`) are introduced before use and match the reference end-state. Node names (`name`, `tagline`, `contactList`, `contactItem`, `heading`, `jobTitle`, `company`, `dates`, `educationItem`, `tagGroup`, `tag`) and the `underline` mark match between schema, migration, and tests. The `section` helper signature `(sectionKind, title, type, blocks, extra)` is consistent across callers.

**Green-at-every-task ordering check:** Task 1 (header) leaves experience/section/education on their old representations — round-trip holds. Task 2 (experience) reads experienceItems via `blocksOfType`, which works with or without a section heading — holds before Task 3. Task 3 (heading) routes every section through the heading-led builder; `paragraphsText`/`blocksOfType` skip the heading — holds. Task 4 (education) is additive over the heading-led section. Task 5 is purely additive. ✓
