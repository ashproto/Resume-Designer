# Document Model Phase 2 · PR 2.3 — Rich Marks + Tags Cleanup (+ tools re-join fix) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Enrich the document model so skills/tools are structured `tagGroup`/`tag` nodes and emphasis is real `bold`/`italic`/`underline` marks (cleaner input for the Phase-3 Typst export), and fix the fragile inline tool-chip re-join bug — all without changing the flat interchange shape, the renderer, or any of the 11 layouts.

**Architecture:** The store is already model-native (PR 2.2). The renderer + inline editor keep reading/writing the **flat** bridge (`getData()` = `modelToFlat`, `store.update` flat paths), so all 11 layouts and the PDF/print path are untouched. The model is enriched purely inside the migration: `flatToModel` parses the flat strings into structure and `modelToFlat` serializes them back **losslessly** (the six golden round-trip samples must stay byte-for-byte). The one behavioral change is a targeted inline-editor fix for the tool-chip re-join bug.

**Tech Stack:** `prosemirror-model` (schema from PR 2.1 already has `tagGroup`/`tag` + `bold`/`italic`/`underline`), Vitest ^4, jsdom ^29. npm from `resume-designer/`.

**Source spec:** `docs/superpowers/specs/2026-06-14-document-model-phase-2-design.md`. This PR REPLACES the original PR 2.3 (TipTap editor cutover — dropped after a spike showed a sidebar layout can't come from a flat ProseMirror-editable DOM, and ATS reading-order is Typst's job in Phase 3).

---

## Background the implementer needs

**The flat shape is FROZEN.** `variant.data`, JSON/Markdown export, and the renderer all consume the flat shape: `tools` is a `' • '`-joined string; a skills section is a custom section with `type: 'skills'` and a `content[]` array of strings; emphasis is `**bold**` / `_italic_` / `++underline++` markdown inside strings. **Do not change any of that.** Everything here happens *inside* `flatToModel`/`modelToFlat`, guarded by the existing golden round-trip tests (`test/migrateToModel.test.js`, the `modelToFlat (lossless round-trip)` block over POPULATED, SPARSE, EMPTY_RESUME, EMPHASIS, EMPTY_FIELDS, REAL_VARIANT). **These must stay green at every step.**

**The markdown dialect (renderer.js `formatInlineMarkdown`, lines 33-39) — match it exactly:**
- bold: `/\*\*([^*]+)\*\*/g` → strong
- underline: `/\+\+([^+\n]+)\+\+/g` → u
- italic: boundary-aware `_x_` (won't touch `snake_case`)
- applied **in that order** on the escaped string, so **bold is outermost, italic innermost** when they nest.

**Tools split/join (renderer.js:127-129):** `split('•')`, `.map(trim)`, `.filter(Boolean)`; the app always re-joins with `' • '`. So a `' • '`-joined string round-trips through split→join exactly.

**Task order is deliberate:** Task 1 (tags) and Task 3 (marks) both touch the migration; Task 3 (marks) is the intricate one and is **last + separable** — if its lossless round-trip can't be made solid, stop after Tasks 1–2 (the valuable parts) with no rework. Task 2 (the re-join fix) is an independent inline-editor change.

**Commit conventions (commitlint):** lowercase subject; scope `model` (migration), `ui` (inline editor); body ≤100 chars/line; footer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`.

---

## Task 1: Tags in the migration (tools + skills sections → `tagGroup`/`tag`)

**Files:**
- Modify: `resume-designer/src/migrateToModel.js` (`flatToModel` builders; `modelToFlat` readers)
- Test: `resume-designer/test/migrateToModel.test.js`

`flatToModel` emits a `tagGroup` of `tag` nodes for the **tools** section and for any **custom section with `type: 'skills'`**; `modelToFlat` reads them back (`tagGroup` → `' • '`-joined string for tools; → `content[]` + `type:'skills'` for skills sections). Tag text stays **verbatim** (markdown markers untouched — Task 3 handles marks). Non-behavioral.

- [ ] **Step 1: Add the failing structural + round-trip tests**

In `test/migrateToModel.test.js`, add:

```javascript
describe('tags in the migration', () => {
  it('emits tools as a tagGroup of tags', () => {
    const tools = flatToModel(POPULATED).content.find((n) => n.attrs?.sectionKind === 'tools');
    const tg = tools.content.find((n) => n.type === 'tagGroup');
    expect(tg).toBeDefined();
    expect(tg.content.map((t) => t.content[0].text)).toEqual(['Difference Engine', 'Slide Rule']);
  });
  it('emits a type:"skills" custom section as a tagGroup', () => {
    const sk = flatToModel(REAL_VARIANT).content.find((n) => n.attrs?.id === 'sk'); // type:'skills'
    const tg = sk.content.find((n) => n.type === 'tagGroup');
    expect(tg).toBeDefined();
    expect(tg.content.map((t) => t.content[0].text)).toEqual(['Rust', 'Go']);
  });
  it('leaves a non-skills custom section as paragraphs', () => {
    const hi = flatToModel(REAL_VARIANT).content.find((n) => n.attrs?.id === 'h'); // no type
    expect(hi.content.some((n) => n.type === 'tagGroup')).toBe(false);
    expect(hi.content.some((n) => n.type === 'paragraph')).toBe(true);
  });
});
```

(The six existing `modelToFlat (lossless round-trip)` tests are the real safety net — they must stay byte-for-byte.)

- [ ] **Step 2: Run to verify failure**

Run: `npm run test`
Expected: FAIL — tools/skills are still paragraphs; no `tagGroup` nodes.

- [ ] **Step 3: Emit tagGroups in `flatToModel`**

In `src/migrateToModel.js`, add builder + splitter near the other builders (after `heading`):

```javascript
const splitTools = (s) => String(s ?? '').split('•').map((t) => t.trim()).filter(Boolean);
const tagGroup = (items) => ({ type: 'tagGroup', content: items.map((t) => ({ type: 'tag', content: text(t) })) });
```

Replace the custom-sections loop (the `for (const s of flat.sections ?? [])` block) with:

```javascript
  for (const s of flat.sections ?? []) {
    const type = s.type ?? '';
    const blocks = type === 'skills'
      ? [tagGroup(s.content ?? [])]
      : (s.content ?? []).map(para);
    content.push(section('custom', s.title ?? '', type, blocks, { id: s.id }));
  }
```

Replace the tools push (the `if (flat.tools)` line) with:

```javascript
  if (flat.tools) content.push(section('tools', 'Tools', 'text', [tagGroup(splitTools(flat.tools))]));
```

- [ ] **Step 4: Read tagGroups back in `modelToFlat`**

Add a reader near `paragraphsText`:

```javascript
const tagsOf = (node) => {
  const tg = childOfType(node, 'tagGroup');
  return tg ? (tg.content ?? []).filter((n) => n.type === 'tag').map(textOf) : null;
};
```

In `modelToFlat`, change the `kind === 'tools'` branch to:

```javascript
    } else if (kind === 'tools') {
      const tags = tagsOf(s);
      flat.tools = tags ? tags.join(' • ') : (paragraphsText(s)[0] ?? '');
```

And the `else { // 'custom' }` branch's content source:

```javascript
    } else { // 'custom'
      const tags = tagsOf(s);
      const entry = { id: s.attrs?.id ?? '', title: headingTitle(s), content: tags ?? paragraphsText(s) };
      if (s.attrs?.type) entry.type = s.attrs.type; // omit when the empty sentinel
      flat.sections.push(entry);
    }
```

- [ ] **Step 5: Run to verify pass**

Run: `npm run test`
Expected: PASS — new tag tests green; all six golden round-trips still byte-for-byte (tools `' • '`-join reproduces the input; skills sections restore `content[]` + `type:'skills'`).

- [ ] **Step 6: Commit**

```bash
git add resume-designer/src/migrateToModel.js resume-designer/test/migrateToModel.test.js
git commit -m "feat(model): tools + skills sections as tagGroup/tag nodes" \
  -m "flatToModel emits structured tagGroup/tag for tools and type:'skills' custom sections; modelToFlat serializes back losslessly (tools ' • '-joined; skills as content[]+type). Tag text stays verbatim. Non-behavioral." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 2: Fix the tool-chip re-join bug (inline editor) — behavioral

**Files:**
- Modify: `resume-designer/src/inlineEditor.js` (`extractEditedValue`, the `path === 'tools'` branch)
- Test: `resume-designer/test/inlineEditor.test.js` (new)

Today editing one tool chip re-joins **all** sibling chips from the DOM (inlineEditor.js:890-899), which drops/overwrites siblings when their DOM text is stale. Fix: replace **only the edited chip's token by its index** in the store's current tools string, leaving the others exactly as stored. Independent of Task 1 (operates on the flat `' • '` string).

- [ ] **Step 1: Write the failing regression test**

The current `extractEditedValue` is module-internal. Export a pure helper it delegates to, so it's unit-testable. Create `resume-designer/test/inlineEditor.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { replaceToolToken } from '../src/inlineEditor.js';

describe('replaceToolToken (tool re-join fix)', () => {
  it('replaces only the edited token, keeping the others', () => {
    expect(replaceToolToken('A • B • C', 1, 'B2')).toBe('A • B2 • C');
  });
  it('keeps token emphasis on untouched tokens', () => {
    expect(replaceToolToken('**A** • B • C', 2, 'C2')).toBe('**A** • B • C2');
  });
  it('drops a token edited to empty', () => {
    expect(replaceToolToken('A • B • C', 1, '')).toBe('A • C');
  });
  it('appends when the index is past the end (new chip)', () => {
    expect(replaceToolToken('A • B', 2, 'C')).toBe('A • B • C');
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test`
Expected: FAIL — `replaceToolToken` is not exported.

- [ ] **Step 3: Add the pure helper + use it in `extractEditedValue`**

In `src/inlineEditor.js`, add the exported helper (near `serializeEmphasis`):

```javascript
// Replace ONLY the token at `index` in a ' • '-joined tools string with `value`,
// leaving every other token byte-identical. Fixes the old "re-join all from the
// DOM" path that dropped/overwrote siblings whose DOM text was stale.
export function replaceToolToken(toolsString, index, value) {
  const tokens = String(toolsString ?? '').split('•').map((t) => t.trim());
  if (index >= 0) tokens[index] = value; // in-range edit, or grow-past-end append
  return tokens.filter(Boolean).join(' • ');
}
```

In `extractEditedValue`, replace the `if (path === 'tools') { … }` block with one that finds the edited chip's index among its sibling chips and replaces only that token in the **stored** string:

```javascript
  if (path === 'tools') {
    const toolScope = element.closest('.tools-bulleted') || element.closest('.tools-list')
      || element.closest('.skill-tag-row') || element.parentElement;
    const toolTags = Array.from(toolScope?.querySelectorAll(
      '.tool-token, .skill-tag[data-editable="tools"], .skill-tag-inline[data-editable="tools"], .highlight-bullet[data-editable="tools"]'
    ) ?? []);
    const index = toolTags.indexOf(element);
    if (index >= 0) {
      return replaceToolToken(store.get('tools'), index, serializeEmphasis(element));
    }
  }
```

(`store` is already imported in `inlineEditor.js`. The chip DOM order matches the stored token order — both come from the same `'•'` split — so the DOM index is the token index.)

- [ ] **Step 4: Run to verify pass**

Run: `npm run test`
Expected: PASS — the four `replaceToolToken` tests green; everything else green.

- [ ] **Step 5: Lint + build + preview check**

Run: `npm run lint && npm run build` — expect clean.

Preview (fabricated data only; never the real OpenRouter key or real résumé content; restore `localStorage` after): seed a résumé with tools `Alpha • Beta • Gamma`; inline-edit the middle chip "Beta" → "Beta2"; confirm the rendered tools become `Alpha • Beta2 • Gamma` (not `Alpha • Beta2` or `Beta2 • Gamma`). Confirm editing the first and last chips behaves the same. `preview_console_logs` → no errors.

- [ ] **Step 6: Commit**

```bash
git add resume-designer/src/inlineEditor.js resume-designer/test/inlineEditor.test.js
git commit -m "fix(ui): edit one tool chip without overwriting the others" \
  -m "Inline tool editing now replaces only the edited chip's token by its index in the stored ' • ' string (replaceToolToken), instead of re-joining all chips from the DOM. Fixes the 'edit one overwrites the next' bug." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Task 3: Marks in the migration (`**`/`_`/`++` → `bold`/`italic`/`underline`) — intricate, separable

**Files:**
- Create: `resume-designer/src/inlineMarkdown.js` (shared parse/serialize, exact-inverse of the renderer's dialect)
- Modify: `resume-designer/src/renderer.js` (import `formatInlineMarkdown` from the shared module — single source of truth)
- Modify: `resume-designer/src/migrateToModel.js` (`text()` builder parses marks; `textOf` reader emits markers)
- Test: `resume-designer/test/inlineMarkdown.test.js` (new), `resume-designer/test/migrateToModel.test.js`

**This is the high-risk / low-value piece — sequence it LAST.** The model gains real marks (a tidy input for Typst). The on-screen render and the flat export are unchanged (they go through the flat bridge, which serializes marks back to the same markdown). If the lossless round-trip can't be made byte-for-byte for the six golden samples, **stop here** — Tasks 1–2 stand on their own.

**Scope note (handled, not hidden):** this handles **non-nested** emphasis (the only kind in the golden samples and the common case). Nested emphasis (`**_x_**`) is left as literal markers inside the outer mark's text — it still round-trips byte-for-byte and still renders correctly on screen (the flat bridge feeds `formatInlineMarkdown`, which nests); only the Phase-3 Typst path would under-style a nested span, which is rare and acceptable.

- [ ] **Step 1: Write the failing parse/serialize tests**

Create `resume-designer/test/inlineMarkdown.test.js`:

```javascript
import { describe, it, expect } from 'vitest';
import { parseInlineMarks, serializeInlineMarks } from '../src/inlineMarkdown.js';

const roundtrip = (s) => serializeInlineMarks(parseInlineMarks(s));

describe('parseInlineMarks / serializeInlineMarks', () => {
  it('parses bold/italic/underline to marked text nodes', () => {
    expect(parseInlineMarks('a **b** _c_ ++d++')).toEqual([
      { type: 'text', text: 'a ' },
      { type: 'text', text: 'b', marks: [{ type: 'bold' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'c', marks: [{ type: 'italic' }] },
      { type: 'text', text: ' ' },
      { type: 'text', text: 'd', marks: [{ type: 'underline' }] },
    ]);
  });
  it('round-trips byte-for-byte', () => {
    for (const s of [
      'Led **growth** and _scaled_ the team — 3×.',
      'Shipped **v2**.',
      'Rust • WASM',
      'C++ and Go',            // ++ not closed → literal, no underline
      'plain text',
      'edge_case snake_word',  // _ not at word boundary → literal
      '',
    ]) expect(roundtrip(s)).toBe(s);
  });
  it('produces no empty marks objects on plain text', () => {
    expect(parseInlineMarks('plain')).toEqual([{ type: 'text', text: 'plain' }]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npm run test`
Expected: FAIL — `../src/inlineMarkdown.js` does not exist.

- [ ] **Step 3: Create `resume-designer/src/inlineMarkdown.js`**

This module owns the inline-markdown dialect. `escapeHtmlRaw` is needed by `formatInlineMarkdown`; copy it here from `renderer.js` (find its definition) so the shared module is self-contained.

```javascript
// Single source of truth for the inline-markdown dialect (**bold**, _italic_,
// ++underline++). Used by the renderer (markdown → HTML) and the migration
// (markdown ↔ ProseMirror marks). parse/serialize are exact inverses for
// non-nested emphasis, which is all the data uses.

export function escapeHtmlRaw(text) {
  return String(text ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// markdown string → HTML (the renderer's exact behavior).
export function formatInlineMarkdown(text) {
  return escapeHtmlRaw(text)
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/\+\+([^+\n]+)\+\+/g, '<u>$1</u>')
    .replace(/(^|[\s([{"'`])_([^_\n]+)_(?=$|[\s)\]}"'`.,!?;:])/g, '$1<em>$2</em>');
}

// The three dialect markers, in dialect order (bold, underline, italic). Each
// captures the marker's inner text; `lead` is any boundary char the italic rule
// keeps OUTSIDE the marked span.
const MATCHERS = [
  { mark: 'bold', re: /\*\*([^*]+)\*\*/g, inner: (m) => m[1], lead: () => '' },
  { mark: 'underline', re: /\+\+([^+\n]+)\+\+/g, inner: (m) => m[1], lead: () => '' },
  { mark: 'italic', re: /(^|[\s([{"'`])_([^_\n]+)_(?=$|[\s)\]}"'`.,!?;:])/g, inner: (m) => m[2], lead: (m) => m[1] },
];

// markdown string → array of {type:'text', text, marks?} (non-nested).
export function parseInlineMarks(str) {
  const s = String(str ?? '');
  const spans = [];
  for (const { mark, re, inner, lead } of MATCHERS) {
    for (const m of s.matchAll(re)) {
      const start = m.index + lead(m).length;
      const end = m.index + m[0].length;
      if (!spans.some((sp) => start < sp.end && end > sp.start)) {
        spans.push({ start, end, mark, text: inner(m) });
      }
    }
  }
  spans.sort((a, b) => a.start - b.start);
  const out = [];
  let cursor = 0;
  for (const sp of spans) {
    if (sp.start > cursor) out.push({ type: 'text', text: s.slice(cursor, sp.start) });
    out.push({ type: 'text', text: sp.text, marks: [{ type: sp.mark }] });
    cursor = sp.end;
  }
  if (cursor < s.length) out.push({ type: 'text', text: s.slice(cursor) });
  return out.length ? out : (s ? [{ type: 'text', text: s }] : []);
}

// array of text nodes → markdown string (inverse of parseInlineMarks).
const wrap = { bold: (t) => `**${t}**`, italic: (t) => `_${t}_`, underline: (t) => `++${t}++` };
export function serializeInlineMarks(nodes) {
  return (nodes ?? [])
    .map((n) => {
      let t = n.text ?? '';
      const marks = (n.marks ?? []).map((m) => m.type);
      // inner → outer to mirror the dialect's bold-outer/italic-inner nesting.
      if (marks.includes('italic')) t = wrap.italic(t);
      if (marks.includes('underline')) t = wrap.underline(t);
      if (marks.includes('bold')) t = wrap.bold(t);
      return t;
    })
    .join('');
}
```

- [ ] **Step 4: Run the parse/serialize tests**

Run: `npx vitest run test/inlineMarkdown.test.js`
Expected: PASS. If any round-trip case fails, fix the matcher boundaries before proceeding (the boundary-aware italic `lead`/lookahead is the usual culprit). Do NOT proceed to Step 5 until this is green.

- [ ] **Step 5: Make the renderer use the shared dialect**

In `src/renderer.js`, delete the local `formatInlineMarkdown` (and the local `escapeHtmlRaw` if it has no other callers — check with `grep -n "escapeHtmlRaw" src/renderer.js`) and import from the shared module at the top:

```javascript
import { formatInlineMarkdown } from './inlineMarkdown.js';
```

Run: `npm run test && npm run build` — expect green (the renderer behaves identically; it now calls the shared `formatInlineMarkdown`).

- [ ] **Step 6: Parse marks in `flatToModel`, serialize in `modelToFlat`**

In `src/migrateToModel.js`, import the helpers and make `text()` parse and `textOf` serialize:

```javascript
import { parseInlineMarks, serializeInlineMarks } from './inlineMarkdown.js';
```

Replace the `text` builder:

```javascript
const text = (s) => parseInlineMarks(s);
```

Replace `textOf`:

```javascript
const textOf = (node) => serializeInlineMarks((node?.content ?? []).filter((c) => c.type === 'text'));
```

(Every place that built text nodes via `text(s)` now gets marked runs, and every reader via `textOf` serializes them back. `field`/`para`/`heading`/`contactList`/`tag` all flow through `text`/`textOf`, so marks are carried uniformly.)

- [ ] **Step 7: Add the model-side structural test**

In `test/migrateToModel.test.js`, add:

```javascript
describe('marks in the migration', () => {
  it('parses summary emphasis into marks', () => {
    const flat = { ...SPARSE, summary: 'Led **growth** today' };
    const para = flatToModel(flat).content.find((n) => n.attrs?.sectionKind === 'summary')
      .content.find((n) => n.type === 'paragraph');
    const bold = para.content.find((c) => c.marks?.some((m) => m.type === 'bold'));
    expect(bold.text).toBe('growth');
  });
});
```

- [ ] **Step 8: Run the full suite**

Run: `npm run test`
Expected: PASS — **all six golden round-trips still byte-for-byte** (EMPHASIS exercises `**growth**`/`_scaled_`/`**v2**`; the parse↔serialize inverse must reproduce them exactly), the new marks tests green, and the renderer/inline-editor suites green.

- [ ] **Step 9: Lint + build + preview parity**

Run: `npm run lint && npm run build` — expect clean.

Preview (fabricated data; restore `localStorage`): confirm a summary/bullet with `**bold**`, `_italic_`, `++underline++` renders identically to before (bold/italic/underline), and editing it still works (the inline editor's `serializeEmphasis` still produces the same markdown, which `flatToModel` now parses to marks). `preview_console_logs` → no errors.

- [ ] **Step 10: Commit**

```bash
git add resume-designer/src/inlineMarkdown.js resume-designer/src/renderer.js \
        resume-designer/src/migrateToModel.js resume-designer/test/inlineMarkdown.test.js \
        resume-designer/test/migrateToModel.test.js
git commit -m "feat(model): parse emphasis markers into bold/italic/underline marks" \
  -m "Shared inlineMarkdown module owns the dialect (renderer + migration). flatToModel parses **/_/++ into marks; modelToFlat serializes back, exact-inverse, so the flat round-trip stays byte-for-byte and the render is unchanged. Non-nested; nested stays literal. Non-behavioral." \
  -m "Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Self-review (run by the plan author)

**Spec coverage:** 2.3a tags → Task 1 ✓ · 2.3c tool re-join fix → Task 2 ✓ · 2.3b marks → Task 3 ✓ · flat shape unchanged → all tasks operate inside the migration / replace-only-edited-token ✓ · renderer + 11 layouts + PDF untouched → no renderer behavior change (Task 3 only relocates `formatInlineMarkdown` to a shared module, byte-identical) ✓ · golden round-trips byte-for-byte → asserted in Tasks 1, 3 ✓.

**Placeholder scan:** none — complete code per step; the marks parser/serializer is given in full; commands have expected output.

**Type/name consistency:** `tagGroup`/`splitTools`/`tagsOf` (Task 1) consistent between build + read. `replaceToolToken` (Task 2) signature matches test + caller. `parseInlineMarks`/`serializeInlineMarks`/`formatInlineMarkdown`/`escapeHtmlRaw` (Task 3) consistent across `inlineMarkdown.js`, the renderer import, the migration `text`/`textOf`, and both test files. `text`/`textOf` remain the single funnel for all text nodes, so marks apply uniformly.

**Risk/ordering:** Tasks 1 and 2 are independent and high-confidence. Task 3 is isolated last and separable — if its byte-for-byte round-trip can't be achieved (Step 4/Step 8), Tasks 1–2 stand alone with no rework. Tag text is verbatim after Task 1, so Task 3's marks apply cleanly on top (tags flow through the same `text`/`textOf` funnel).
