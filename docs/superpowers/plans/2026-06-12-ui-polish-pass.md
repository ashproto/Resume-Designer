# UI Polish Pass — Implementation Plan

> **For agentic workers:** executed inline (not subagent-driven) — the five items
> share token files (`main.css`/`glass.css`/`shadcn.css`) and a coherent visual
> result, so splitting across cold subagents would conflict and fragment. Steps
> use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land five chrome-polish items in one PR into `next`: bottom-bar icon
legibility, background update polling, header reorganization, interactable-field
contrast/hover, and resume hover context-button fixes.

**Architecture:** React 19 + shadcn/Radix chrome (migration already landed). Two
items are pure token/CSS work (`main.css` + `glass.css` + `shadcn.css`), one is a
React `Header.jsx` refactor, one extends the updater seam (`native.js` +
`updateFlow.js`), one rewrites the inline-editor button lifecycle
(`inlineEditor.js` + `editor.css`).

**Branch:** `polish/ui-pass` off `next`. One PR → `next`. Commit/push only on
explicit go-ahead.

**Decisions locked (user, 2026-06-12):** Actions group = single dropdown; Tools =
icon+label collapsing to icon-only; update poll = every 30 min, notify-only,
deduped per version; field contrast = Medium. **Flagged for approval:** make the
glass zoom pill theme-aware (reconciles item 1 with the literal directive).

---

## File map

| File | Item(s) | Change |
|---|---|---|
| `styles/main.css` | 1, 4 | Add `--color-icon` + field tokens (3 theme blocks); point `.zoom-btn`/`.zoom-level` at `--color-icon` |
| `styles/glass.css` | 1, 4 | Theme-aware pill bg; translucent field tokens + reduced-transparency wiring |
| `styles/shadcn.css` | 4 | Repoint `--input` → border token; refresh stale glass comment |
| `src/components/ui/{input,textarea,select}.jsx` | 4 | `bg-transparent` → field fill + hover |
| `src/components/Header.jsx` | 3 | Actions dropdown; Tools→buttons; remove Import/Export from right zone |
| `src/native.js` | 2 | `checkForUpdates(source, { notifyOnly })` early-return branch |
| `src/updateFlow.js` | 2 | 30-min poll interval; actionable+deduped background "available" toast |
| `src/inlineEditor.js` | 5 | scroll-hide, button hover-tracking, Escape, viewport bounds, menu-close fix |
| `styles/editor.css` | 5 | Lower AI button/menu z-index beneath the chrome |

---

## Task 1 — Bottom-bar icon legibility

**Files:** `styles/main.css` (token blocks 36–75 / 81–119 / 122–162; `.zoom-btn` 742; `.zoom-level` 765), `styles/glass.css` (`.zoom-controls` 122).

- [ ] **1.1 Add `--color-icon` to all three theme blocks.** Idle icon color, tuned for contrast against a theme-tracking pill:
  - light (`:root,[data-theme="light"]`): `--color-icon: #4a463f;` (darker than muted `#6b6560`)
  - dark (`[data-theme="dark"]` + `@media prefers-color-scheme:dark`): `--color-icon: #c2bdb6;` (brighter than muted `#9a9590`, ≈9:1)
- [ ] **1.2 Point the pill controls at it.** `.zoom-btn { color: var(--color-text-muted) }` → `var(--color-icon)`; same for `.zoom-level`. Hover (`--color-text`) and disabled (opacity .4) unchanged.
- [ ] **1.3 (Flagged) Make the glass pill theme-aware.** Replace `glass.css:123` `background: rgba(45, 42, 38, 0.5);` with `background: color-mix(in srgb, var(--color-panel-bg) 80%, transparent);` so the pill is light-translucent in light mode / dark in dark mode, consistent with `.header-bar`/panels. (Keeps `backdrop-filter`.) This is what makes "darker in light / brighter in dark" correct.

**Verify:** preview light + dark, `?translucent`; icons clearly legible idle in both.

---

## Task 2 — Background update polling (every 30 min, notify-only)

**Files:** `src/native.js` (`checkForUpdates` 229–426), `src/updateFlow.js` (whole).

Reuse the existing seam: `checkForUpdates` already guards (`isTauri`, DEV,
`isCheckingForUpdates`), emits `checking`/`up-to-date`/`available`, and the
updateFlow handler stays silent for non-manual sources except `available`. The
only new behavior: a notify-only mode that detects + toasts but skips the
download dialog, plus a 30-min interval.

- [ ] **2.1 `native.js`: add `{ notifyOnly }` and early-return.** Signature → `checkForUpdates(source = 'manual', { notifyOnly = false } = {})`. In the `available` branch, attach `notifyOnly` to the emit and return before `dialog.ask`:

```js
const currentVersion = await getAppInfo().then((i) => i.version).catch(() => null);
emitStatus({
  status: 'available', source, version: update.version, currentVersion,
  notifyOnly,
  message: `Version ${update.version} is available.`,
});
if (notifyOnly) {
  // Background poll: surface the toast and stop. No download dialog — the user
  // acts via the toast's "Update" action (→ manual flow) or Settings.
  isCheckingForUpdates = false;
  return { checking: true, available: true, version: update.version };
}
// …existing dialog.ask("Download?") path unchanged for manual/startup…
```

- [ ] **2.2 `updateFlow.js`: poll interval.** Import `getAutoUpdateCheck` from `native.js`. Add module state + a start fn; call it from `initUpdateFlow()` after the subscribe:

```js
const POLL_INTERVAL_MS = 30 * 60 * 1000; // 30 minutes
let pollTimer = null;
let lastBackgroundAvailableVersion = null;

function startBackgroundPolling() {
  if (pollTimer || import.meta.env.DEV) return;
  pollTimer = setInterval(() => {
    if (!getAutoUpdateCheck()) return;          // respect the toggle live
    checkForUpdates('background', { notifyOnly: true }).catch(() => {});
  }, POLL_INTERVAL_MS);
}
```

- [ ] **2.3 `updateFlow.js`: actionable + deduped `available` toast.** Extend `showUpdateToast` to take an optional `action`, and branch the `available` case on `notifyOnly`:

```js
function showUpdateToast(message, tone = 'info', persistent = false, action = null) {
  if (!isElectron || !message) return;
  const opts = { id: UPDATE_TOAST_ID, duration: persistent ? Infinity : 4500,
    ...(action ? { action } : {}) };
  /* …switch unchanged… */
}

case 'available': {
  const notifyOnly = payload.notifyOnly === true;
  if (notifyOnly) {
    if (payload.version && payload.version === lastBackgroundAvailableVersion) {
      manualUpdateCheckActive = false; setBusy(false); break; // already told them
    }
    lastBackgroundAvailableVersion = payload.version || null;
    showUpdateToast(payload.message || `Update${version} is available.`, 'info', true,
      { label: 'Update', onClick: () => triggerManualUpdateCheck() });
  } else {
    showUpdateToast(payload.message
      || `Update${version} is available. Choose Download in the dialog to continue.`, 'info');
  }
  manualUpdateCheckActive = false; setBusy(false); break;
}
```

Clicking "Update" runs the existing manual flow (re-detect → download dialog →
progress → restart). Dedup by version means one toast per release, no nagging.

**Verify:** logic only (no headless updater). Lint/build/test. **Desktop-only
(Ash):** leave app open, confirm a real release surfaces one toast with an Update
action; confirm toggling auto-update off in Settings stops it.

---

## Task 3 — Header reorganization

**File:** `src/components/Header.jsx` (whole).

Target layout:
- **Left:** brand · `[ Resume ▾ ]` · `[ Actions ▾ ]` (New/Duplicate/Rename/Delete · Import · Export as JSON/Markdown).
- **Right:** `[👤 Profile] [📄 Jobs] [🕘 History]` (icon+label, labels hide on narrow) · `[⚙]` · `[PDF]`.
- **≤768px:** existing hamburger keeps grouping Resume/Tools/File (minimal change).

- [ ] **3.1 Replace the two left-zone variant-action blocks** (expanded icons `min-[1401px]` + kebab `769–1400px`, Header.jsx 198–228) with one Actions dropdown:

```jsx
<DropdownMenu>
  <DropdownMenuTrigger asChild>
    <Button variant="ghost" size="sm" className="h-[34px] text-[13.5px]"
      title="Resume actions" aria-label="Resume actions">
      Actions <ChevronDown className="size-3 text-muted-foreground" />
    </Button>
  </DropdownMenuTrigger>
  <DropdownMenuContent align="start">
    <VariantMenuItems actions={variantActions} />
    <DropdownMenuSeparator />
    <DropdownMenuItem onSelect={pickImport}><Upload className="size-4" /> Import…</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => exportCurrentVariant('json')}><Download className="size-4" /> Export as JSON</DropdownMenuItem>
    <DropdownMenuItem onSelect={() => exportCurrentVariant('md')}><Download className="size-4" /> Export as Markdown</DropdownMenuItem>
  </DropdownMenuContent>
</DropdownMenu>
```

- [ ] **3.2 Replace the right-zone Tools dropdown + Import button + Export dropdown** (Header.jsx 237–275) with three ghost buttons mapped from `toolItems`, label collapsing on narrow:

```jsx
{toolItems.map(({ key, label, Icon, run }) => (
  <Button key={key} variant="ghost" size="sm" className="h-[34px] text-[13.5px]"
    title={label} aria-label={label} onClick={run}>
    <Icon className="size-4" />
    <span className="max-[1280px]:hidden">{label}</span>
  </Button>
))}
```

- [ ] **3.3 Cleanup.** Drop now-unused imports (`MoreHorizontal`, `Wrench`); keep `Plus/Copy/Pencil/Trash2` (Actions dropdown) and `Upload/Download` (Actions items + hamburger). Hamburger (304–335) unchanged — still has Resume/Tools/File. Hidden file input + rename dialog unchanged.

**Verify:** preview at wide / ~1100px / ~800px / ≤768px; window-drag region + macOS traffic-light padding intact (`data-no-drag` wrappers preserved).

---

## Task 4 — Interactable-field contrast + hover (Medium)

**Files:** `styles/main.css` (token blocks), `styles/glass.css` (translucent overrides + reduced-transparency block), `styles/shadcn.css` (120, 167–169), `src/components/ui/{input,textarea,select}.jsx`.

Root cause: shadcn fields are `bg-transparent` + `border-input`, and `--input`
= `--color-input-bg` = white in light mode → invisible border. Fix = visible
border token + a subtle field fill + hover, across plain and glass layers.

- [ ] **4.1 New tokens in all three `main.css` theme blocks:**
  - light: `--color-field-bg: #f1ede7; --color-field-bg-hover: #e9e4dc; --color-field-border: #cbc4b9;`
  - dark: `--color-field-bg: #2d2a26; --color-field-bg-hover: #35322d; --color-field-border: #4a463f;`
- [ ] **4.2 `shadcn.css`: repoint the border token.** `--input: var(--color-input-bg);` → `--input: var(--color-field-border);` Update the stale glass comment (167–169) to note `--input` is now an opaque hairline border (legibility), no longer the translucent input fill.
- [ ] **4.3 Field components: fill + hover.** In `input.jsx`, `textarea.jsx`, `select.jsx`, change `bg-transparent` → `bg-[var(--color-field-bg)] hover:bg-[var(--color-field-bg-hover)]`. Ensure `transition-colors` is present (Input/Select have transitions; add `transition-colors` to Textarea).
- [ ] **4.4 Glass layer.** In `glass.css` `:root[data-tauri="true"]` add `--glass-field-pct: 32%;` (dark variant + system-dark: `36%`) and `--color-field-bg: color-mix(in srgb, var(--color-bg-light) var(--glass-field-pct), transparent);` `--color-field-bg-hover: color-mix(in srgb, var(--color-bg-light) calc(var(--glass-field-pct) + 8%), transparent);` Read the `prefers-reduced-transparency` block (tail of glass.css) and add `--glass-field-pct: 100%;` there so reduced mode restores opaque fields (matches the existing token-flip pattern).
- [ ] **4.5 Legacy parity (verify-then-touch).** Grep for live `class(Name)="form-input|form-textarea|custom-dropdown-trigger"` in `src/**`. If still rendered, point their idle `background` at `var(--color-field-bg)` + add `:hover`. If dead, leave untouched (out of scope).

**Verify:** preview light + dark + `?translucent`; inputs/textareas/selects read as inset with a visible border at rest and a hover lift; focus ring unchanged; toggle macOS Reduce-transparency → fields stay legible (opaque).

---

## Task 5 — Resume hover context-button

**Files:** `src/inlineEditor.js` (init 26–67; `createAIButton` 71–134; `closeMenuOnClickOutside` 274–294; `handleMouseOver/Out` 532–587; `showAIButton` 589–620), `styles/editor.css` (220, 276).

Two reported bugs → five targeted fixes (keep the existing structure; don't rewrite wholesale):

- [ ] **5.1 Hide on scroll.** Cache `.resume-scroller` in init; add a passive `scroll` listener (+ window `resize`) that calls `hideAIButton()` and clears `hoveredElement`. (Primary cause of "stuck floating over the header.")
- [ ] **5.2 Track hover on the button itself.** In `createAIButton`, add `container.addEventListener('mouseenter', …)` → `clearTimeout(hideButtonTimeout)`, and `container.addEventListener('mouseleave', …)` → schedule the same delayed hide as `handleMouseOut` (guarded by `isMenuVisible`). Closes the text→button→outside gap.
- [ ] **5.3 Fix post-menu-close persistence.** In `closeMenuOnClickOutside`, replace the unreliable `hoveredElement.matches(':hover')` setTimeout block (288–293) with a direct `hideAIButton(); hoveredElement = null;` — the next mouseover re-shows it.
- [ ] **5.4 Escape to dismiss.** Add a `document` keydown listener (registered in init): on `Escape`, if the button/menu is visible, `hideAIMenu(); hideAIButton(); hoveredElement = null;`.
- [ ] **5.5 Viewport bounds + z-index (stop covering chrome).** In `showAIButton`, after computing `rect`, get the `.resume-scroller` rect; if `rect.bottom < scrollerRect.top || rect.top > scrollerRect.bottom` (anchor scrolled under the header or below the fold), return without showing. In `editor.css`, lower `.editable-ai-container` `z-index: 9999 → 240` and `.editable-ai-menu` `100000 → 245` (above resume content ~1, below header ~300 / panels 150–200 / Radix popper 3100), so it can no longer paint over the chrome. (Optional: clamp the menu's right edge to the viewport at 247.)

**Verify:** preview — hover text (button appears), move onto button (stays), move away (hides), scroll (hides immediately), Esc (hides); confirm it never paints over the header or side panels; open the menu and apply/reject still work.

---

## Verification (whole PR)

1. `npm run lint` — clean.
2. `npm run build` — both entries (index + print) emit.
3. `npm test` — existing vitest suite green (regression canary).
4. **Preview (`Claude_Preview`)**, snapshot localStorage first / restore after; never enter the real OpenRouter key or real résumé data:
   - Header reorg at 4 widths; field contrast/hover light+dark; bottom-bar icons light+dark; context-button lifecycle.
   - `?translucent` for glass: pill theme-aware, fields legible, dialogs/menus frosted.
5. **Desktop-only (Ash):** glass pill in a real Tauri build; 30-min update poll surfaces one actionable toast on a real release; macOS Reduce-transparency neutralizes the new glass tokens.

## Risks / watch-items
- **Glass pill bg change (1.3)** is the one visible aesthetic shift — flagged for approval.
- **`--input` repoint (4.2)** affects every `border-input` consumer (all form controls) — intended, but scan for an outline `<Button>` relying on the old white border.
- **Reduced-transparency wiring (4.4)** — the new `--glass-field-pct` MUST be added to the fallback block or fields stay translucent in reduced mode.
- **z-index drop (5.5)** — verify the button still sits above resume content and the menu isn't clipped by the resume paper.
- Update poll is desktop-only and can't be headless-verified — logic-reviewed + Ash confirms on desktop.
