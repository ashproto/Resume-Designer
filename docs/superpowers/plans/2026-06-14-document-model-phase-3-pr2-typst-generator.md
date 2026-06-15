# Phase 3 PR 3.2 — Typst generator foundation + stacked layout Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the pure-JS `model → .typ` generator foundation — string escaping, a shared palette module, a theme bridge, and the generator itself covering the **stacked** (single-column) layout — proving the full `model → .typ → compile → ATS-correct PDF` pipeline end-to-end. **Non-behavioral**: no app wiring yet (nothing imports the generator outside tests), so the running app stays byte-identical.

**Architecture:** JS builds `.typ` source; Rust will compile it later (PR 3.3+). The generator walks the document model depth-first (= reading order) and emits Typst markup. User text is emitted as **Typst string literals** (`#"…"`), so markup specials (`#`, `*`, `_`, `[`, `C++`, `$`) render literally and can't break compilation or inject markup — only `\` and `"` need escaping. Marks become function-form wrappers (`#strong[…]`/`#emph[…]`/`#underline[…]`). A pure `buildTheme()` resolves the global design services' shapes (fonts, the 12 palettes, spacing, accent) into absolute Typst tokens (pt/in/hex). Page size maps to `#set page(...)`.

**Scope note:** This PR delivers the foundation + the **stacked** layout only. PR 3.3 will add **sidebar** (the grid/two-column case, where the model-order ATS guarantee actually matters) and **classic**, reusing `theme.js` and the ATS harness built here. Building the harness on the simple single-column case first de-risks it.

**Tech Stack:** vitest (jsdom), prosemirror-model, the locally-installed `typst` CLI **0.14.2** (confirmed on PATH), `pdfjs-dist` ^5.4.530 (already a dependency). All npm/npx commands run from `resume-designer/`.

---

## File Structure

| File | Responsibility | Change |
|---|---|---|
| `resume-designer/src/typst/escape.js` | Typst string-literal escaping | **new** |
| `resume-designer/src/typst/palettes.js` | the 12 color palettes (shared source of truth) | **new** (extracted from `main.js`) |
| `resume-designer/src/main.js` | app entry | import `COLOR_PALETTES` from the new module (remove the inline literal) |
| `resume-designer/src/typst/theme.js` | pure theme bridge: design choices → Typst tokens | **new** |
| `resume-designer/src/typst/generate.js` | `modelToTypst(model, { theme })` — walk + helpers + stacked layout | **new** |
| `resume-designer/test/typstEscape.test.js` | escape unit tests | **new** |
| `resume-designer/test/typstPalettes.test.js` | palette extraction tests | **new** |
| `resume-designer/test/typstTheme.test.js` | theme bridge tests | **new** |
| `resume-designer/test/typstGenerate.test.js` | generator unit + snapshot tests | **new** |
| `resume-designer/test/typstAtsOrder.test.js` | ATS reading-order test (typst CLI + pdfjs) | **new** |

One commit per task. Conventional Commits (lowercase subject; body lines ≤100; `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>` footer). Explicit `git add <paths>` — never `-a`. Do **not** push; do **not** touch `next`/`main`.

---

### Task 1: Typst string escaping (`escape.js`)

**Files:** Create `src/typst/escape.js`, `test/typstEscape.test.js`.

The generator emits user text as `#"<escaped>"`. Inside a Typst string literal, ONLY `\` and `"` are special — markup chars (`#`, `*`, `_`, `[`, `]`, `$`, `@`, `<`, `>`) render literally, which is exactly what we want for résumé text. Newlines/tabs collapse to a space (Typst string literals can't contain raw newlines mid-line and we don't want them anyway).

- [ ] **Step 1: Write the failing test** (`test/typstEscape.test.js`)

```js
import { describe, it, expect } from 'vitest';
import { escapeTypstString } from '../src/typst/escape.js';

describe('escapeTypstString', () => {
  it('escapes backslash then quote (order matters)', () => {
    expect(escapeTypstString('a\\b')).toBe('a\\\\b');
    expect(escapeTypstString('say "hi"')).toBe('say \\"hi\\"');
    expect(escapeTypstString('a\\"b')).toBe('a\\\\\\"b');
  });
  it('passes Typst markup specials through literally', () => {
    expect(escapeTypstString('C++ & #func [x] *b* _i_ $x$')).toBe('C++ & #func [x] *b* _i_ $x$');
  });
  it('collapses newlines/tabs to a single space', () => {
    expect(escapeTypstString('line1\n\tline2')).toBe('line1 line2');
  });
  it('coerces nullish to empty string', () => {
    expect(escapeTypstString(null)).toBe('');
    expect(escapeTypstString(undefined)).toBe('');
  });
});
```

- [ ] **Step 2: Run to verify FAIL**

Run: `npx vitest run test/typstEscape.test.js` — Expected: FAIL (module not found / function undefined).

- [ ] **Step 3: Implement** (`src/typst/escape.js`)

```js
// Escape a string for emission inside a Typst string literal: #"<result>".
// Only backslash and double-quote are special inside a literal — markup chars
// (#, *, _, [, ], $, @, <, >) render verbatim, which is what we want for résumé
// text. Backslash MUST be escaped before the quote (we add backslashes for "),
// or the quote-escape's backslash would itself get doubled. Newlines/tabs would
// be illegal mid-literal, so collapse runs of them to one space.
export function escapeTypstString(s) {
  return String(s ?? '')
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/[\r\n\t]+/g, ' ');
}
```

- [ ] **Step 4: Run to verify PASS** — `npx vitest run test/typstEscape.test.js` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/typst/escape.js test/typstEscape.test.js
git commit -m "feat(typst): string-literal escaping for user text" -m "Emit user text as Typst string literals (#\"...\"), so markup specials render
literally and can't break compilation; only backslash and quote need escaping.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Shared palette module (`palettes.js`)

**Files:** Create `src/typst/palettes.js`, `test/typstPalettes.test.js`. Modify `src/main.js`.

Extract the 12 `COLOR_PALETTES` literals out of `main.js` into a shared module so the renderer and the Typst theme bridge use one source of color truth (design spec §4.1). Pure data move — behavior-preserving.

- [ ] **Step 1: Write the failing test** (`test/typstPalettes.test.js`)

```js
import { describe, it, expect } from 'vitest';
import { COLOR_PALETTES } from '../src/typst/palettes.js';

describe('COLOR_PALETTES', () => {
  it('exports all 12 named palettes', () => {
    expect(Object.keys(COLOR_PALETTES)).toHaveLength(12);
    expect(Object.keys(COLOR_PALETTES)).toContain('terracotta');
    expect(Object.keys(COLOR_PALETTES)).toContain('zinc');
  });
  it('each palette has the full 5-key shape', () => {
    expect(COLOR_PALETTES.terracotta).toEqual({
      accent: '#c45c3e', accentLight: '#d97a5d',
      headerBg: '#2d2a26', headerBgEnd: '#3d3832', sidebarBg: '#f4e8e4',
    });
    expect(COLOR_PALETTES.ocean.accent).toBe('#2563eb');
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run test/typstPalettes.test.js` → FAIL (module not found).

- [ ] **Step 3: Implement**

Create `src/typst/palettes.js` containing the EXACT 12-palette object currently in `main.js` (lines ~68-153), as a named export:

```js
// The 12 résumé color palettes — single source of truth, imported by both the
// renderer (main.js) and the Typst theme bridge (typst/theme.js) so colors can't
// drift between the on-screen render and the PDF.
export const COLOR_PALETTES = {
  terracotta: { accent: '#c45c3e', accentLight: '#d97a5d', headerBg: '#2d2a26', headerBgEnd: '#3d3832', sidebarBg: '#f4e8e4' },
  rose:       { accent: '#e11d48', accentLight: '#f43f5e', headerBg: '#4a1025', headerBgEnd: '#5a2035', sidebarBg: '#fce7f3' },
  amber:      { accent: '#d97706', accentLight: '#f59e0b', headerBg: '#451a03', headerBgEnd: '#78350f', sidebarBg: '#fef3c7' },
  coral:      { accent: '#f97316', accentLight: '#fb923c', headerBg: '#431407', headerBgEnd: '#7c2d12', sidebarBg: '#ffedd5' },
  ocean:      { accent: '#2563eb', accentLight: '#3b82f6', headerBg: '#1e3a5f', headerBgEnd: '#2d4a6f', sidebarBg: '#e8f0fe' },
  teal:       { accent: '#0d9488', accentLight: '#14b8a6', headerBg: '#134e4a', headerBgEnd: '#115e59', sidebarBg: '#ccfbf1' },
  forest:     { accent: '#059669', accentLight: '#10b981', headerBg: '#1a3c34', headerBgEnd: '#2a4c44', sidebarBg: '#e6f4f0' },
  cyan:       { accent: '#0891b2', accentLight: '#06b6d4', headerBg: '#164e63', headerBgEnd: '#155e75', sidebarBg: '#cffafe' },
  plum:       { accent: '#7c3aed', accentLight: '#8b5cf6', headerBg: '#2d1f47', headerBgEnd: '#3d2f57', sidebarBg: '#f3e8ff' },
  indigo:     { accent: '#4f46e5', accentLight: '#6366f1', headerBg: '#1e1b4b', headerBgEnd: '#312e81', sidebarBg: '#e0e7ff' },
  slate:      { accent: '#64748b', accentLight: '#94a3b8', headerBg: '#1e293b', headerBgEnd: '#334155', sidebarBg: '#f1f5f9' },
  zinc:       { accent: '#52525b', accentLight: '#71717a', headerBg: '#18181b', headerBgEnd: '#27272a', sidebarBg: '#f4f4f5' },
};
```

Then in `src/main.js`: remove the inline `const COLOR_PALETTES = { … };` block and add an import near the other imports at the top of the file:
```js
import { COLOR_PALETTES } from './typst/palettes.js';
```
(Verify `main.js` references `COLOR_PALETTES` the same way afterward — it's now an imported binding instead of a local const, which is a drop-in replacement.)

- [ ] **Step 4: Run to verify PASS + no regression**

Run `npx vitest run test/typstPalettes.test.js` → pass. Then run `npm run lint` and `npm run build` → both clean (confirms the `main.js` import didn't break the app). The palette values are unchanged, so on-screen colors are identical.

- [ ] **Step 5: Commit**

```bash
git add src/typst/palettes.js src/main.js test/typstPalettes.test.js
git commit -m "refactor(typst): extract color palettes to a shared module" -m "Move the 12 COLOR_PALETTES out of main.js so the renderer and the Typst theme
bridge share one source of color truth. Pure data move; on-screen colors unchanged.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Theme bridge (`theme.js`)

**Files:** Create `src/typst/theme.js`, `test/typstTheme.test.js`.

A **pure** function `buildTheme(choices)` mapping the global design services' shapes to absolute Typst tokens. It takes the user's choices as input (dependency-injected — the service-reading wiring lands in PR 3.4), so it's trivially testable. It imports `COLOR_PALETTES` (Task 2) and `FONT_PAIRINGS` (already exported from `src/fontService.js`).

**Size resolution:** `styles/resume.css` mixes `pt` (base body = `9pt`) and `rem` (name = `2.25rem`), all multiplied by `--font-scale`. `rem` is relative to the document root font-size. **Step 1 of implementation: confirm the root font-size** — grep `styles/*.css` / `index.html` for a `:root`/`html { font-size }`; if none, it's the browser default **16px = 12pt** (at 96dpi), so `1rem → 12pt`. Resolve every size to absolute pt: `pt_value = (cssPt OR remValue*12) * fontScale`.

**Input shape** (all optional; fall back to defaults):
- `pairingId` (default `'classic-elegant'`) — keys `FONT_PAIRINGS`.
- `colorPalette` (default `'terracotta'`), `customColor` (used when `colorPalette === 'custom'`).
- `spacing` — the `spacingService` shape: `{ pageMargins:{top,bottom,left,right}, sectionSpacing, sidebarWidth, fontScale, lineHeight }` (defaults: margins `0.5`in, sectionSpacing `0.8`rem, sidebarWidth `2.4`in, fontScale `1`, lineHeight `1.45`).
- `accent` — the `accentService` shape: `{ bulletStyle, underlineStyle, underlineWidth, skillTagStyle, … }` (default bulletStyle `'disc'` → char `'•'`).

**Output token contract** (consumed by `generate.js`):
```
{
  fontDisplay, fontBody,                                  // family strings
  baseSizePt, nameSizePt, taglineSizePt,                  // absolute pt (fontScale applied)
  textColor:'#2d2a26', mutedColor:'#6b6560', borderColor:'#e8e4df',
  accent, accentLight, headerBg, headerBgEnd, sidebarBg,  // hex strings
  marginTopIn, marginBottomIn, marginLeftIn, marginRightIn,
  sectionGapPt, sidebarWidthIn, lineHeight, bulletChar,
}
```
(Section-heading pt sizes are lifted per-layout from resume.css inside `generate.js`; the base/name/tagline anchors live in the theme. Additional sizes can be added to the contract as layouts need them — keep this token object the single place sizes are resolved.)

- [ ] **Step 1: Write the failing tests** (`test/typstTheme.test.js`)

```js
import { describe, it, expect } from 'vitest';
import { buildTheme } from '../src/typst/theme.js';

describe('buildTheme', () => {
  it('resolves the default pairing + palette', () => {
    const t = buildTheme({});
    expect(t.fontDisplay).toBe('Cormorant Garamond');
    expect(t.fontBody).toBe('DM Sans');
    expect(t.accent).toBe('#c45c3e');
    expect(t.textColor).toBe('#2d2a26');
    expect(t.baseSizePt).toBe(9);
    expect(t.nameSizePt).toBeCloseTo(27, 5); // 2.25rem * 12
    expect(t.bulletChar).toBe('•');
    expect(t.marginTopIn).toBe(0.5);
  });
  it('applies fontScale to sizes', () => {
    const t = buildTheme({ spacing: { fontScale: 2 } });
    expect(t.baseSizePt).toBe(18);
    expect(t.nameSizePt).toBeCloseTo(54, 5);
  });
  it('selects a named palette and an alternate pairing', () => {
    const t = buildTheme({ colorPalette: 'ocean', pairingId: 'modern-clean' });
    expect(t.accent).toBe('#2563eb');
    expect(t.fontDisplay).toBe('Inter');
  });
  it('uses customColor as accent when colorPalette is custom', () => {
    const t = buildTheme({ colorPalette: 'custom', customColor: '#123456' });
    expect(t.accent).toBe('#123456');
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run test/typstTheme.test.js` → FAIL.

- [ ] **Step 3: Implement** (`src/typst/theme.js`)

First confirm the root font-size (see "Size resolution" above) and the bullet-char map (read `BULLET_STYLES` in `src/accentService.js` — `BULLET_STYLES[bulletStyle].char`, default `'•'`). Mirror `main.js`'s `custom` palette handling for `resolvePalette` (read the `applyColorPalette`/custom branch in `main.js`; at minimum, when `colorPalette === 'custom'`, accent = `customColor`). Then:

```js
import { COLOR_PALETTES } from './palettes.js';
import { FONT_PAIRINGS } from '../fontService.js';

const REM_PT = 12;            // 1rem = 16px = 12pt at 96dpi (root font-size 16px — verify, see plan)
const DEFAULT_PAIRING = 'classic-elegant';

function resolvePalette(colorPalette = 'terracotta', customColor = '#c45c3e') {
  if (colorPalette === 'custom') {
    // Mirror main.js: custom only overrides the accent; keep terracotta's chrome.
    return { ...COLOR_PALETTES.terracotta, accent: customColor, accentLight: customColor };
  }
  return COLOR_PALETTES[colorPalette] ?? COLOR_PALETTES.terracotta;
}

// Read accentService BULLET_STYLES for the full map; '•' is the disc/default.
const BULLET_CHARS = { disc: '•', square: '▪', dash: '–', arrow: '→', check: '✓', star: '★', diamond: '◆', none: '' };

export function buildTheme({ pairingId, colorPalette, customColor, spacing = {}, accent = {} } = {}) {
  const pairing = FONT_PAIRINGS[pairingId] ?? FONT_PAIRINGS[DEFAULT_PAIRING];
  const palette = resolvePalette(colorPalette, customColor);
  const fontScale = spacing.fontScale ?? 1;
  const m = spacing.pageMargins ?? {};
  const pt = (cssPt) => cssPt * fontScale;
  const remPt = (rem) => rem * REM_PT * fontScale;
  return {
    fontDisplay: pairing.display.family,
    fontBody: pairing.body.family,
    baseSizePt: pt(9),
    nameSizePt: remPt(2.25),
    taglineSizePt: remPt(0.95),
    textColor: '#2d2a26', mutedColor: '#6b6560', borderColor: '#e8e4df',
    accent: palette.accent, accentLight: palette.accentLight,
    headerBg: palette.headerBg, headerBgEnd: palette.headerBgEnd, sidebarBg: palette.sidebarBg,
    marginTopIn: m.top ?? 0.5, marginBottomIn: m.bottom ?? 0.5,
    marginLeftIn: m.left ?? 0.5, marginRightIn: m.right ?? 0.5,
    sectionGapPt: remPt(spacing.sectionSpacing ?? 0.8),
    sidebarWidthIn: spacing.sidebarWidth ?? 2.4,
    lineHeight: spacing.lineHeight ?? 1.45,
    bulletChar: BULLET_CHARS[accent.bulletStyle] ?? '•',
  };
}
```

- [ ] **Step 4: Run to verify PASS** — `npx vitest run test/typstTheme.test.js` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/typst/theme.js test/typstTheme.test.js
git commit -m "feat(typst): theme bridge resolving design choices to typst tokens" -m "Pure buildTheme() maps font pairing, palette, spacing, and accent into absolute
Typst tokens (pt/in/hex). Service-reading wiring lands in PR 3.4.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Generator core — preamble, header, marks (`generate.js`)

**Files:** Create `src/typst/generate.js`, `test/typstGenerate.test.js`.

Start `modelToTypst(model, { theme })`: the document preamble (`#set page` from `model.attrs.pageSize`, `#set text`/`#set par` from the theme), the header, and inline-run rendering with marks. (Blocks + sections + full stacked assembly come in Task 5.)

- [ ] **Step 1: Write the failing tests** (`test/typstGenerate.test.js`)

```js
import { describe, it, expect } from 'vitest';
import { modelToTypst } from '../src/typst/generate.js';
import { buildTheme } from '../src/typst/theme.js';
import { flatToModel } from '../src/migrateToModel.js';

const theme = buildTheme({});
const model = (pageSize) => ({
  ...flatToModel({ name: 'Ada Lovelace', tagline: 'Pioneer',
    contact: { email: 'ada@x.com', location: 'London' }, summary: 'First **programmer**.' }),
  attrs: { schemaVersion: 1, docType: 'resume', toolsDisplay: '', pageSize },
});

describe('modelToTypst — preamble & header', () => {
  it('maps pageSize to #set page', () => {
    expect(modelToTypst(model('a4'), { theme })).toContain('#set page(paper: "a4"');
    expect(modelToTypst(model('letter'), { theme })).toContain('#set page(paper: "us-letter"');
    expect(modelToTypst(model('legal'), { theme })).toContain('#set page(paper: "us-legal"');
    expect(modelToTypst(model('auto'), { theme })).toContain('height: auto');
  });
  it('sets body font and base size from the theme', () => {
    const typ = modelToTypst(model('auto'), { theme });
    expect(typ).toContain('font: "DM Sans"');
    expect(typ).toContain('#"Ada Lovelace"');     // name as a string literal
  });
  it('renders bold runs as #strong and escapes nothing markup-special', () => {
    const typ = modelToTypst(model('auto'), { theme });
    expect(typ).toContain('#strong[#"programmer"]');
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run test/typstGenerate.test.js` → FAIL.

- [ ] **Step 3: Implement** the deterministic core of `src/typst/generate.js`:

```js
import { escapeTypstString } from './escape.js';

const childOfType = (node, type) => (node?.content ?? []).find((n) => n.type === type);
const childContent = (node, type) => childOfType(node, type)?.content ?? [];

// --- inline runs (marks) ---
function renderRun(node) {
  let inner = `#"${escapeTypstString(node.text ?? '')}"`;
  for (const mark of node.marks ?? []) {
    if (mark.type === 'bold') inner = `#strong[${inner}]`;
    else if (mark.type === 'italic') inner = `#emph[${inner}]`;
    else if (mark.type === 'underline') inner = `#underline[${inner}]`;
    else if (mark.type === 'link') inner = `#link("${escapeTypstString(mark.attrs?.href ?? '')}")[${inner}]`;
  }
  return inner;
}
function renderRuns(nodes = []) {
  return nodes.filter((n) => n.type === 'text').map(renderRun).join('');
}

const PAPER = { letter: 'us-letter', a4: 'a4', legal: 'us-legal' };
function pageRule(pageSize, t) {
  const margin = `(top: ${t.marginTopIn}in, bottom: ${t.marginBottomIn}in, left: ${t.marginLeftIn}in, right: ${t.marginRightIn}in)`;
  return PAPER[pageSize]
    ? `#set page(paper: "${PAPER[pageSize]}", margin: ${margin})`
    : `#set page(width: 8.5in, height: auto, margin: ${margin})`;
}

function preamble(model, t) {
  return [
    pageRule(model.attrs?.pageSize ?? 'auto', t),
    `#set text(font: "${t.fontBody}", size: ${t.baseSizePt}pt, fill: rgb("${t.textColor}"))`,
    `#set par(leading: ${(t.lineHeight - 1).toFixed(3)}em, justify: false)`,
    `#let accent = rgb("${t.accent}")`,
  ].join('\n');
}

function renderHeader(header, t) {
  const name = renderRuns(childContent(header, 'name'));
  const tagline = renderRuns(childContent(header, 'tagline'));
  const contacts = (childOfType(header, 'contactList')?.content ?? [])
    .filter((n) => n.type === 'contactItem')
    .map((ci) => renderRuns(ci.content))
    .filter(Boolean)
    .join(` #text(fill: rgb("${t.mutedColor}"))[#" • "] `);
  // Visual tuning (sizes/spacing/weight) to mirror renderResumeStacked's header —
  // see Task 5's mirroring note. Minimal valid structure for now:
  return [
    `#text(font: "${t.fontDisplay}", size: ${t.nameSizePt}pt, weight: "bold")[${name}]`,
    `#text(size: ${t.taglineSizePt}pt, fill: rgb("${t.mutedColor}"))[${tagline}]`,
    contacts ? `#text(fill: rgb("${t.mutedColor}"))[${contacts}]` : '',
    '',
  ].filter((s) => s !== '').join('\n\n');
}

export function modelToTypst(model, { theme } = {}) {
  const header = (model.content ?? []).find((n) => n.type === 'header');
  // Sections are added in Task 5; for now emit preamble + header (reading order starts here).
  return [preamble(model, theme), renderHeader(header, theme), ''].join('\n\n');
}
```

- [ ] **Step 4: Run to verify PASS** — `npx vitest run test/typstGenerate.test.js` → all pass.

- [ ] **Step 5: Commit**

```bash
git add src/typst/generate.js test/typstGenerate.test.js
git commit -m "feat(typst): generator preamble, header, and inline marks" -m "modelToTypst emits #set page from pageSize, text/par from the theme, the header,
and inline runs (bold/italic/underline/link) as Typst function-form wrappers.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Blocks, sections, and the stacked layout (`generate.js`)

**Files:** Modify `src/typst/generate.js`, `test/typstGenerate.test.js`.

Add block renderers (paragraph, bulletList, tagGroup, experienceItem, educationItem), section rendering (heading + accent rule + blocks), and assemble the full **stacked** (single-column) layout. The on-screen reference to mirror for visuals (heading size/weight, accent underline, spacing) is `renderResumeStacked` in `src/renderer.js` and the corresponding rules in `styles/resume.css` — **read those and tune the emitted sizes/spacing to match**, then verify by compiling (Step 4b).

- [ ] **Step 1: Write the failing tests** (append to `test/typstGenerate.test.js`)

```js
describe('modelToTypst — blocks, sections, stacked', () => {
  const full = buildTheme({});
  const m = flatToModel({
    name: 'Ada', tagline: 'P', contact: { email: 'a@x.com' },
    summary: 'Led _growth_.',
    sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust', 'Go'] }],
    experience: [{ id: 'e', title: 'Eng', company: 'Acme', dates: '2020', bullets: ['Shipped v2.'] }],
    tools: 'Figma • git',
  });
  it('preserves model reading order (name → Skills → Experience → Tools)', () => {
    const typ = modelToTypst(m, { theme: full });
    const iName = typ.indexOf('#"Ada"');
    const iSkills = typ.indexOf('#"Skills"');
    const iExp = typ.indexOf('#"Experience"');
    const iTools = typ.indexOf('#"Tools"');
    expect(iName).toBeGreaterThanOrEqual(0);
    expect(iName).toBeLessThan(iSkills);
    expect(iSkills).toBeLessThan(iExp);
    expect(iExp).toBeLessThan(iTools);
  });
  it('renders a bulletList as a Typst #list', () => {
    expect(modelToTypst(m, { theme: full })).toContain('#list(');
  });
  it('renders a tagGroup (skills/tools) as joined tags', () => {
    const typ = modelToTypst(m, { theme: full });
    expect(typ).toContain('#"Rust"');
    expect(typ).toContain('#"Go"');
  });
  it('matches the recorded stacked snapshot', () => {
    expect(modelToTypst(m, { theme: full })).toMatchSnapshot();
  });
});
```

- [ ] **Step 2: Run to verify FAIL** — `npx vitest run test/typstGenerate.test.js` → the new reading-order/list cases FAIL (sections not emitted yet).

- [ ] **Step 3: Implement** the block/section renderers and wire them into `modelToTypst`. Deterministic structure (tune visuals to mirror `renderResumeStacked`):

```js
const blocksOf = (node) => (node?.content ?? []);

function renderBullets(listNode, t) {
  const items = (listNode.content ?? [])
    .filter((li) => li.type === 'listItem')
    .map((li) => `[${renderRuns((li.content?.[0]?.content) ?? [])}]`);
  return items.length ? `#list(marker: [${t.bulletChar ? `#"${t.bulletChar}"` : ''}], ${items.join(', ')})` : '';
}
function renderTags(tagGroup) {
  return (tagGroup.content ?? [])
    .filter((n) => n.type === 'tag')
    .map((tg) => renderRuns(tg.content))
    .filter(Boolean)
    .join(' #h(0.6em) ');
}
function renderExperienceItem(it, t) {
  const line = (type, opts = '') => `#text(${opts})[${renderRuns(childContent(it, type))}]`;
  const parts = [
    `#text(weight: "bold")[${renderRuns(childContent(it, 'jobTitle'))}]`,
    line('company'),
    `#text(fill: rgb("${t.mutedColor}"))[${renderRuns(childContent(it, 'dates'))}]`,
  ];
  const bl = childOfType(it, 'bulletList');
  if (bl) parts.push(renderBullets(bl, t));
  return parts.join('\n');
}
function renderBlock(node, t) {
  switch (node.type) {
    case 'paragraph':   return `[${renderRuns(node.content)}]`;
    case 'bulletList':  return renderBullets(node, t);
    case 'tagGroup':    return `[${renderTags(node)}]`;
    case 'experienceItem': return renderExperienceItem(node, t);
    case 'educationItem':  return `[${renderRuns(node.content)}]`;
    default: return '';
  }
}
function renderSection(section, t) {
  const heading = renderRuns(childContent(section, 'heading'));
  const body = blocksOf(section).filter((n) => n.type !== 'heading').map((b) => renderBlock(b, t)).filter(Boolean);
  // Heading in the display font with an accent rule beneath — tune to resume.css.
  return [
    `#text(font: "${t.fontDisplay}", weight: "bold", fill: accent)[${heading}]`,
    '#line(length: 100%, stroke: 0.5pt + accent)',
    ...body,
  ].join('\n\n');
}
```
Then update `modelToTypst` to append the sections after the header, in model order:
```js
export function modelToTypst(model, { theme } = {}) {
  const nodes = model.content ?? [];
  const header = nodes.find((n) => n.type === 'header');
  const sections = nodes.filter((n) => n.type === 'section').map((s) => renderSection(s, theme));
  return [preamble(model, theme), renderHeader(header, theme), ...sections, ''].join('\n\n');
}
```

- [ ] **Step 4: Run to verify PASS** — `npx vitest run test/typstGenerate.test.js`. The reading-order/list/tag cases pass; the snapshot is recorded on first run. **Open the recorded `test/__snapshots__/typstGenerate.test.js.snap` and read it** — confirm it is plausible, well-formed Typst in model order.

- [ ] **Step 4b: Compile-check (the generator must emit VALID Typst).** From `resume-designer/`, write the generated stacked output to a temp file and compile it with the installed CLI:
```bash
node -e "import('./src/typst/generate.js').then(async (g)=>{const {buildTheme}=await import('./src/typst/theme.js');const {flatToModel}=await import('./src/migrateToModel.js');const m=flatToModel({name:'Ada',tagline:'P',contact:{email:'a@x.com'},summary:'Led _growth_.',sections:[{id:'s',title:'Skills',type:'skills',content:['Rust','Go']}],experience:[{id:'e',title:'Eng',company:'Acme',dates:'2020',bullets:['Shipped v2.']}],tools:'Figma • git'});require('fs').writeFileSync('/tmp/rd_stacked.typ', g.modelToTypst(m,{theme:buildTheme({})}));});"
typst compile /tmp/rd_stacked.typ /tmp/rd_stacked.pdf && echo "COMPILE OK" || echo "COMPILE FAILED — fix the generator"
```
Expected: `COMPILE OK` and a non-empty `/tmp/rd_stacked.pdf`. If it fails, fix the emitted Typst (the compiler error points at the line) and re-run. **Do not commit until it compiles.** (The fonts referenced — DM Sans / Cormorant Garamond — must be available to the local typst; if the CLI warns "unknown font", that's expected for now and does NOT fail compilation — Rust-side font bundling is PR 3.3. The compile must still succeed structurally.)

- [ ] **Step 5: Commit**

```bash
git add src/typst/generate.js test/typstGenerate.test.js test/__snapshots__/typstGenerate.test.js.snap
git commit -m "feat(typst): blocks, sections, and the stacked layout" -m "Adds paragraph/bulletList/tagGroup/experienceItem/educationItem renderers and
section assembly; full stacked layout emitted in model order. Compiles clean.

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: ATS reading-order test (`typstAtsOrder.test.js`)

**Files:** Create `test/typstAtsOrder.test.js`.

The keystone guarantee (design spec §11/§13): generate the stacked `.typ`, compile it with the **typst CLI (0.14.2, on PATH)**, extract the PDF text with `pdfjs-dist`, and assert the extracted token order equals the model's reading order. This is the harness PR 3.3 will reuse for the sidebar (multi-column) case where it really bites. The test self-skips if `typst` isn't on PATH (so CI without typst stays green until the CI install step lands).

- [ ] **Step 1: Write the test** (`test/typstAtsOrder.test.js`)

```js
import { describe, it, expect } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { modelToTypst } from '../src/typst/generate.js';
import { buildTheme } from '../src/typst/theme.js';
import { flatToModel } from '../src/migrateToModel.js';

function typstAvailable() {
  try { execFileSync('typst', ['--version'], { stdio: 'ignore' }); return true; } catch { return false; }
}

async function extractText(pdfPath) {
  const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
  const data = new Uint8Array(readFileSync(pdfPath));
  const doc = await pdfjs.getDocument({ data, useSystemFonts: true }).promise;
  let out = '';
  for (let p = 1; p <= doc.numPages; p++) {
    const page = await doc.getPage(p);
    const content = await page.getTextContent();
    out += content.items.map((i) => i.str).join(' ') + ' ';
  }
  return out.replace(/\s+/g, ' ');
}

describe.skipIf(!typstAvailable())('ATS reading order (stacked)', () => {
  it('PDF text stream follows model reading order', async () => {
    const model = flatToModel({
      name: 'Ada Lovelace', tagline: 'Pioneer', contact: { email: 'ada@x.com' },
      summary: 'First programmer.',
      sections: [{ id: 's', title: 'Skills', type: 'skills', content: ['Rust', 'Go'] }],
      experience: [{ id: 'e', title: 'Collaborator', company: 'Analytical Engine', dates: '1842', bullets: ['Authored Note G.'] }],
    });
    const typ = modelToTypst(model, { theme: buildTheme({}) });
    const dir = mkdtempSync(join(tmpdir(), 'rd-ats-'));
    const typPath = join(dir, 'r.typ');
    const pdfPath = join(dir, 'r.pdf');
    writeFileSync(typPath, typ);
    execFileSync('typst', ['compile', typPath, pdfPath]);

    const text = await extractText(pdfPath);
    const order = ['Ada Lovelace', 'Skills', 'Rust', 'Experience', 'Collaborator', 'Note G'];
    const positions = order.map((tok) => ({ tok, at: text.indexOf(tok) }));
    for (const { tok, at } of positions) expect(at, `"${tok}" missing from PDF text`).toBeGreaterThanOrEqual(0);
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i].at, `"${positions[i].tok}" should follow "${positions[i - 1].tok}"`)
        .toBeGreaterThan(positions[i - 1].at);
    }
  });
});
```

- [ ] **Step 2: Run** — `npx vitest run test/typstAtsOrder.test.js`. Expected: PASS (typst is installed locally). If the pdfjs import path differs in this version, adjust the import to the correct `pdfjs-dist` build entry (confirm via `ls node_modules/pdfjs-dist/legacy/build/`). If a token assertion fails, the generator's reading order or a dropped token is the bug — fix `generate.js`, not the test's expected order.

- [ ] **Step 3: Commit**

```bash
git add test/typstAtsOrder.test.js
git commit -m "test(typst): ATS reading-order check via typst CLI + pdfjs" -m "Compiles the stacked .typ and asserts the extracted PDF text stream follows
model reading order. Self-skips when typst is not on PATH (CI install: later).

Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>"
```

---

## Final verification (after all 6 tasks)

- [ ] **Full suite green:** `npm test` — all prior tests (124) + the new typst suites pass (the ATS test runs locally since typst is on PATH).
- [ ] **Lint + build clean:** `npm run lint` and `npm run build` — no new errors (the `main.js` palette import is the only production touch).
- [ ] **Non-behavioral confirmation:** grep confirms nothing outside `src/typst/**` and tests imports the generator/theme/escape; the only production change is `main.js` importing `COLOR_PALETTES` (identical values). The running app is byte-identical.
- [ ] **Compiles for real:** `/tmp/rd_stacked.pdf` was produced by the local typst CLI from generator output (Task 5 Step 4b).

---

## Self-review notes (author)

- **Spec coverage:** design spec §4.1 (escape, palettes, theme, generate modules), §4.3 (string-literal emission + marks), §4.4 (block mappings), §4.7 (pageSize → `#set page`), §11/§13 (ATS reading-order test). Sidebar + classic (§4.5) and Rust compile (§6) are explicitly deferred to PR 3.3+. ✓
- **No placeholders:** deterministic pieces (escape, palette data, theme resolution, marks, page-size, block structure, ATS harness) have exact code; the layout *visual tuning* is delegated to the implementer with a concrete reference (`renderResumeStacked` + `resume.css`) and a hard verification gate (must compile via the real typst CLI + snapshot + ATS order). This is the honest contract for generator work — correctness is enforced by compilation + extraction, not by pre-transcribing Typst. ✓
- **Type/name consistency:** `escapeTypstString`, `COLOR_PALETTES`, `buildTheme` token keys, `modelToTypst(model, { theme })` are used consistently across tasks. The theme token contract in Task 3 is exactly what `generate.js` consumes in Tasks 4–5. ✓
- **Open items flagged:** root font-size (rem→pt = 12) to confirm in Task 3; `pdfjs-dist` build entry path to confirm in Task 6; per-layout heading sizes lifted from resume.css during Task 5.
