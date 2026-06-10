# Full-shadcn Chrome Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild every chrome surface on pure shadcn primitives + Tailwind (Geist typography), per the approved spec, deleting ~5,800 lines of bespoke CSS while preserving every fragile contract.

**Architecture:** Second pass over already-React chrome on `feat/react-chrome`. Identity = shadcn defaults + `styles/shadcn.css` token mapping + `styles/glass.css`. Skeleton shells + portals + `rd:*` event bridges unchanged. One surface per task: rebuild → verify (light/dark/glass) → delete that surface's CSS → gated commit.

**Tech Stack:** React 18, shadcn/ui (jsx), Radix, Tailwind (preflight off), lucide-react, dnd-kit, sonner, @fontsource/geist-sans + geist-mono, Vite, Tauri 2.

**Authoritative references (read before each task):**
- Spec: `docs/superpowers/specs/2026-06-09-shadcn-chrome-redesign-design.md` — §4 design language, §5.x per-surface, §6 contracts (REDLINE), §2.3 behavior deltas.
- Approved visual targets: `resume-designer/public/shadcn-redesign.html` (Settings/History) and `resume-designer/public/shadcn-redesign-all.html` (everything else) — match these.
- The EXISTING component files are the source of truth for all handlers, hooks, events, and copy. Rebuild = new JSX structure + Tailwind classes around the SAME logic. Never re-derive logic from memory.

**Project rules (every task):**
- npm project root is `resume-designer/` (git root is its parent). Run all npm commands as `cd /Users/ashshah/Projects/Resume-Designer/resume-designer && <cmd>`.
- Commits are GATED: stage + present the diff summary, then STOP and ask Ash for explicit go-ahead. Conventional-commit messages (commitlint enforced). Never push unprompted.
- Per-task gate commands (all must pass): `npm run build`, `npx eslint .`, `npm test` (vitest), preview check via the running dev server (`rd:open-*` events; verify light, dark via `preview_resize colorScheme`, and glass via `?translucent`).
- Copy preservation: every user-visible string (alerts → toasts/inline, tooltips, hints) is carried over verbatim unless §2.3 changes it.

---

### Task 0: Foundation — fonts, tokens, primitives, confirm helper

**Files:**
- Modify: `resume-designer/package.json` (deps)
- Modify: `resume-designer/src/main.jsx` (font imports)
- Modify: `resume-designer/styles/main.css` (`--font-ui`, body font)
- Modify: `resume-designer/styles/shadcn.css` (status tokens, mono token)
- Create: `resume-designer/src/components/ui/alert-dialog.jsx`, `progress.jsx`, `slider.jsx`, `badge.jsx`, `table.jsx`, `scroll-area.jsx` (via shadcn CLI)
- Create: `resume-designer/src/components/ui/confirm.jsx`
- Modify: `resume-designer/src/App.jsx` (mount `<ConfirmHost/>`)

- [ ] **Step 0.1: Install fonts**

```bash
cd /Users/ashshah/Projects/Resume-Designer/resume-designer && npm i @fontsource/geist-sans @fontsource/geist-mono
```

- [ ] **Step 0.2: Import font weights in `src/main.jsx`** (top of file, before stylesheet imports)

```js
import '@fontsource/geist-sans/400.css';
import '@fontsource/geist-sans/500.css';
import '@fontsource/geist-sans/600.css';
import '@fontsource/geist-sans/700.css';
import '@fontsource/geist-mono/400.css';
import '@fontsource/geist-mono/500.css';
```

- [ ] **Step 0.3: Add `--font-ui` and switch chrome font in `main.css`**

In the `:root` token block add:

```css
--font-ui: 'Geist Sans', 'Inter', -apple-system, BlinkMacSystemFont, system-ui, sans-serif;
--font-mono-ui: 'Geist Mono', ui-monospace, SFMono-Regular, Menlo, monospace;
```

Change the `body` rule's `font-family: var(--font-body)` → `font-family: var(--font-ui)`. Leave `--font-display`/`--font-body` DEFINED (resume document). Grep gate: `grep -rn 'var(--font-display)\|var(--font-body)' resume-designer/styles resume-designer/src --include='*.css' --include='*.jsx'` — every remaining reference must be resume-document or print scoped; chrome references get removed as their surfaces convert (final sweep in Task 11).

- [ ] **Step 0.4: Verify the resume document did not change fonts**

Open the preview, snapshot a resume heading + body line with `preview_inspect` (`font-family`). Expected: unchanged (fontService-applied families, e.g. Cormorant Garamond for the default preset). If the document inherited Geist, the renderer relies on body inheritance — STOP and fix by scoping explicit `font-family: var(--font-body)` defaults into `styles/resume.css` before continuing.

- [ ] **Step 0.5: Add status tokens to `shadcn.css`**

In the `:root` mapping block:

```css
--success: #3d7a4f;
--success-bg: #e9f2ec;
--warning: #9a6b1f;
--warning-bg: #f7efdd;
--destructive: #b3402e;          /* replaces #c0392b */
--destructive-bg: #f7e9e6;
```

Add a dark block following the file's existing dark-mode pattern (mirror however `--color-*` flips — `[data-theme="dark"]` selector plus the system-preference fallback used in `main.css`):

```css
--success: #82c79a;
--success-bg: rgba(61, 122, 79, 0.25);
--warning: #d9a84e;
--warning-bg: rgba(154, 107, 31, 0.25);
--destructive: #e07a6a;
--destructive-bg: rgba(179, 64, 46, 0.25);
```

Wire into Tailwind theme (follow how existing tokens are exposed — `tailwind.config.js` colors map): add `success`, `warning`, `destructive` (+ `-bg` variants) so `bg-success-bg text-success` utilities work. Verify dark values against the real dark palette in the preview and tune for ≥4.5:1 contrast on their bg pairs.

- [ ] **Step 0.6: Add shadcn primitives**

```bash
cd /Users/ashshah/Projects/Resume-Designer/resume-designer && npx shadcn@latest add alert-dialog progress slider badge table scroll-area
```

Expected: six new files in `src/components/ui/`. Check each generated file for `hsl(var(...))` wrappers and patch to bare `var(...)` exactly as the existing ui components do (compare `dialog.jsx`).

- [ ] **Step 0.7: Create the imperative confirm helper** — `src/components/ui/confirm.jsx`

```jsx
import { useEffect, useState } from 'react';

import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from '@/components/ui/alert-dialog';

// Imperative replacement for window.confirm() in React surfaces (spec §5.11).
// confirmDestructive(opts) resolves true/false; ConfirmHost is mounted once in App.

let resolver = null;

export function confirmDestructive({ title, description, actionLabel = 'Confirm', destructive = true }) {
  return new Promise((resolve) => {
    resolver = resolve;
    window.dispatchEvent(new CustomEvent('rd:confirm', { detail: { title, description, actionLabel, destructive } }));
  });
}

export function ConfirmHost() {
  const [opts, setOpts] = useState(null);

  useEffect(() => {
    const onOpen = (e) => setOpts(e.detail);
    window.addEventListener('rd:confirm', onOpen);
    return () => window.removeEventListener('rd:confirm', onOpen);
  }, []);

  const settle = (result) => {
    setOpts(null);
    resolver?.(result);
    resolver = null;
  };

  return (
    <AlertDialog open={!!opts} onOpenChange={(open) => !open && settle(false)}>
      <AlertDialogContent className="glass-card">
        <AlertDialogHeader>
          <AlertDialogTitle>{opts?.title}</AlertDialogTitle>
          <AlertDialogDescription>{opts?.description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => settle(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            className={opts?.destructive ? 'bg-destructive text-white hover:bg-destructive/90' : undefined}
            onClick={() => settle(true)}
          >
            {opts?.actionLabel}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
```

Mount `<ConfirmHost />` in `App.jsx` next to `<Toaster />`. Usage everywhere: `if (!(await confirmDestructive({ title: '…', description: '…', actionLabel: 'Delete' }))) return;`

- [ ] **Step 0.8: Gate** — `npm run build && npx eslint . && npm test` all green; preview loads; chrome text now renders in Geist (`preview_inspect` body font-family starts with `"Geist Sans"`).

- [ ] **Step 0.9: Stage + gated commit** — `refactor(chrome): foundation for shadcn redesign — Geist fonts, status tokens, AlertDialog/Progress/Slider/Badge/Table primitives, confirm helper`

---

### Task 1: Settings dialog rebuild (pattern-setter)

**Files:**
- Rewrite: `resume-designer/src/components/SettingsDialog.jsx`
- Reference: spec §5.1; mockup page 1 ("Redesign" toggle)

- [ ] **Step 1.1:** Rebuild `SettingsDialog.jsx` per spec §5.1: `DialogContent` `showCloseButton={false} className="flex max-h-[85vh] w-[90vw] max-w-[720px] flex-col gap-0 overflow-hidden p-0 glass-card"`; header block (title 17px/600 + muted description + ghost-X); body = `grid grid-cols-[180px_1fr] border-t min-h-0 flex-1` with rail nav (`bg-[#fcfbf9] dark:bg-transparent border-r` — use a token-safe tint: `bg-muted/40`) and scrollable content pane. Rail items: `flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-sm font-medium text-muted-foreground hover:bg-accent hover:text-foreground data-[active=true]:bg-primary/10 data-[active=true]:text-primary`. KEEP: the `TABS` array (icons included), every handler, `rd:open-settings` + `{tab}` deep-link, `isTauri` gating of Updates, `useUpdateBusy`, theme sync. Tab content per spec: radio-cards (theme), settings rows + `Switch`, segmented channel control (Tabs-style), shadcn `Input` + eye toggle for the key, `Table` for usage, AlertDialogs via `confirmDestructive` for Clear All Keys / Clear usage (copy verbatim).
- [ ] **Step 1.2:** Preview-verify: dispatch `rd:open-settings` (each tab incl. `{detail:{tab:'api-keys'}}`); check light + dark (`preview_resize colorScheme`) + glass (`?translucent` URL); screenshot against mockup.
- [ ] **Step 1.3:** Delete from `main.css`: `.settings-*` (≈945–1099 + 1490–1545), `.theme-option` block, `.api-key-*` block, `.usage-*` block, and `.modal-*` ONLY after confirming remaining users (PDF dialog + backup modal still use `.modal-*` until Task 10 — if so, defer `.modal-*` deletion to Task 10). Grep gate: `grep -rn 'settings-tab\|theme-option\|usage-table\|api-key-input' resume-designer/src` → 0 hits.
- [ ] **Step 1.4:** Gate commands + stage + gated commit — `refactor(settings): rebuild on pure shadcn (rail dialog) + drop bespoke settings CSS`

---

### Task 2: History dialog rebuild

**Files:** Rewrite `resume-designer/src/components/HistoryDialog.jsx`; delete `resume-designer/styles/history.css`; remove its `<link>`/import.

- [ ] **Step 2.1:** Rebuild per spec §5.2: 30px icon markers (`TYPE_ICONS` map: initial→FileText, edit→Pencil, ai→Sparkles, import→Upload, reorder→ArrowUpDown, add→Plus, remove→Minus) on rail (`w-px bg-border` line), Badge type chips, outline-sm Restore/Compare, current pill. KEEP: `formatTime`, store subscribe/bump, `handleRestore` (now `await confirmDestructive({ title: 'Restore to this version?', description: 'Your current changes will be saved in history.', actionLabel: 'Restore', destructive: false })`), `handleCompare` (no-difference alert → `toast.info('No differences found between these versions.')`), empty state.
- [ ] **Step 2.2:** Preview-verify (`rd:open-history`) light/dark/glass; confirm restore + compare flows still work end-to-end (compare opens diff overlay).
- [ ] **Step 2.3:** Delete `styles/history.css` + its reference. Grep gate: `history-entry\|history-panel\|history-marker` → 0 hits in src + index.html.
- [ ] **Step 2.4:** Gate + gated commit — `refactor(history): rebuild timeline on shadcn primitives, delete history.css`

---

### Task 3: Header rebuild (drag-region risk — verify early)

**Files:**
- Rewrite: `resume-designer/src/components/Header.jsx`
- Modify: `resume-designer/src/pdf.js` (busy event + filename prefix fix)
- Modify: `resume-designer/src/variantManager.js` (lift confirm/alert out of delete)
- Reference: spec §5.3, §2.3 items 4/5/8/11; mockup "Header" view

- [ ] **Step 3.1: pdf.js busy event.** Where pdf.js toggles the hidden `#download-pdf` spinner/disabled state (generate start/end/error paths), add `window.dispatchEvent(new CustomEvent('rd:pdf-busy', { detail: { busy } }))`. Every exit path (success, cancel, error) must emit `busy:false`.
- [ ] **Step 3.2: pdf.js filename fix.** In `showPdfDialog()` (~line 112) remove the hard-coded name prefix; default filename = slugified active-variant name only.
- [ ] **Step 3.3: variantManager delete refactor.** Read `deleteCurrentVariant`; remove its `window.confirm`/`window.alert`; have it return a result (`{ ok: true }` / `{ ok: false, reason: 'last-variant' }`). All confirmation moves to Header.
- [ ] **Step 3.4: Rebuild Header.jsx** per spec §5.3: brand (`<span class="flex size-6 items-center justify-center rounded-md bg-primary text-[13px] font-bold text-white">R</span>` + `text-[14.5px] font-semibold tracking-tight`), outline variant trigger, ghost icon actions (Trash uses `hover:bg-destructive-bg hover:text-destructive`), Tools/Import/Export ghost buttons, gear, filled PDF button subscribing to `rd:pdf-busy` (busy: `disabled` + `Loader2` spin + "Generating…"). Delete flow: `confirmDestructive({ title: 'Delete this resume?', description: '"<name>" will be permanently deleted. This cannot be undone.', actionLabel: 'Delete' })`; when only one variant exists the Delete controls render `disabled` with `title="Can't delete the last resume"`. KEEP every contract in spec §5.3 "Keeps" (portal target, real `<button>`s, traffic-light padding, body-portaled menus, hidden file input + reset, Rename dialog, `useVariants`, window globals, responsive collapse stages — implement the stages with the same breakpoints via Tailwind responsive classes or a small CSS block in `shadcn.css` if arbitrary breakpoints are needed: 1400/1200/1050/900/768/500).
- [ ] **Step 3.5: Preview-verify** light/dark/glass + responsive (preview_resize 1440/1100/800/500): collapse stages correct; menus open; rename works; PDF busy state animates (trigger an export).
- [ ] **Step 3.6: MANUAL GATE (Ash):** `npm run tauri:dev` — confirm window drag from empty bar areas, double-click zoom, traffic-light clearance, and that every header control clicks without starting a drag. Do not proceed until confirmed.
- [ ] **Step 3.7:** Delete live `.header-*`/`.custom-dropdown*` CSS + dead vanilla header blocks from `main.css`. Grep gate on removed class names → 0 hits in src.
- [ ] **Step 3.8:** Gate + gated commit — `refactor(header): rebuild on shadcn, visible PDF busy state, AlertDialog delete, drop header CSS`

---

### Task 4: Profile dialog rebuild

**Files:** Rewrite `resume-designer/src/components/profile/ProfileDialog.jsx` + `ProfileTabs.jsx`; delete `resume-designer/styles/userProfile.css`.

- [ ] **Step 4.0 (reuse):** Settings (Task 1) defined in-file `GroupTitle` + `SettingRow` helpers for the rail-dialog pattern. Extract those two into a shared module (e.g. `src/components/ui/setting-row.jsx` or `src/components/settings-primitives.jsx`) and have BOTH SettingsDialog and ProfileDialog import them — the second consumer is the right moment to hoist (per Task 1 code review). Keep `StatCard`/`UsageTable` local to Settings.
- [ ] **Step 4.1:** Rebuild per spec §5.6 (rail dialog like Settings, 740px): header actions (Saved badge `bg-success-bg text-success`, outline-sm Import/Export, primary-sm AI Interview w/ Sparkles, ghost X), rail of 7 sections, content per tab (2-col Input grids; labeled Textareas; entry cards `rounded-lg border p-3.5` with title-weight Input + ghost-destructive trash; compact skill rows with shadcn `Select` for proficiency; dashed add buttons `border-dashed`; empty states). REDLINES (spec §6.3/6.6): always-mounted; `rd:open-profile`/`rd:profile-flush`; uncontrolled `defaultValue` inputs writing `profileRef`; 500ms debounce + flush-on-close; `${tab}-${version}` remount keys; import file-input reset; AI-interview 200ms handoff. Import errors → `toast.error(...)` same message.
- [ ] **Step 4.2:** Preview-verify all 7 tabs light/dark/glass; type-fast-then-close → reopen shows saved text (flush works); import/export round-trip with a scratch markdown file.
- [ ] **Step 4.3:** Delete `styles/userProfile.css` + reference. Grep gate: `profile-panel\|profile-item\|profile-skill` → 0 hits.
- [ ] **Step 4.4:** Gate + gated commit — `refactor(profile): rebuild on shadcn rail dialog, delete userProfile.css`

---

### Task 5: Jobs suite rebuild

**Files:** Rewrite `resume-designer/src/components/jobs/JobsDialog.jsx`, `JobCard.jsx`, `AnalysisResults.jsx`, `JobSelectionDialog.jsx`, `JobEditDialog.jsx` (+ `AnalysisLoadingOverlay` restyle); delete `resume-designer/styles/jobDescriptions.css`.

- [ ] **Step 5.1:** Rebuild per spec §5.7 and the mockup "Jobs" view. Cards: `data-active` styling (`border-primary/50 bg-primary/[0.025]` + Active Badge w/ Check) vs ghost "Activate" text button; chevron collapse; ghost pencil/trash (AlertDialog: 'Delete this job description?'). Score ring: `style={{ background: 'conic-gradient(var(--primary) calc(var(--v)*1%), var(--muted) 0)' }}` wrapper with inner `bg-background` circle, `--v` = matchScore. Keywords: Badge `bg-success-bg text-success` / `bg-destructive-bg text-destructive`. Recommendations: impact-colored `border-l-[3px]`, impact Badge + section Badge, Apply→Applied flow, current/suggested tinted blocks. Add-form validation → inline destructive hint under the textarea (was alert). Selection dialog: shadcn `Select` for Model/Reasoning; checkbox label-card rows; `Analyze (N)` disabled at 0. KEEP everything in spec §5.7 "Keeps" incl. the model-seed fix (validated default from `aiService`, replacing the stale 4.5 fallback) and z-2200 body-portal overlay.
- [ ] **Step 5.2:** Preview-verify: add/edit/delete/activate jobs; Recent/All; selection dialog; (analysis itself requires a key — verify gating states render: unconfigured warning, disabled buttons).
- [ ] **Step 5.3:** Delete `styles/jobDescriptions.css` + reference. Grep gate: `jd-panel\|jd-card\|jd-analysis\|jd-edit\|jd-select` → 0 hits.
- [ ] **Step 5.4:** Gate + gated commit — `refactor(jobs): rebuild suite on shadcn (cards, score ring, selects), delete jobDescriptions.css`

---

### Task 6: Structure panel rebuild

**Files:** Rewrite `resume-designer/src/components/structure/StructurePanel.jsx`, `PanelSection.jsx`, `DesignTab.jsx`; modify `resume-designer/styles/main.css` + `resume-designer/styles/editor.css` (deletions).
Split into three sub-passes; the panel must stay functional after each.

- [ ] **Step 6.1: Shell + content tabs.** Segmented 4-tab switcher (spec §2.3-1) replacing the dropdown; Bold toolbar (outline icon `B` + hint) — KEEP `onMouseDown preventDefault` + `document.activeElement` matching `.form-input, .form-textarea`: apply those exact class names to the shadcn `Input`/`Textarea` instances inside this panel (`className="form-input …"`). Collapsible section cards; sortable lists w/ `GripVertical` handles; experience accordion; Date/Relevance segmented; dashed add buttons; deletes via `confirmDestructive` ('Delete this section?' / experience). REDLINES: uncontrolled inputs + `data-field` + `localEdit` gate + `dataVersion` remount + scroll restore; per-list `DndContext`; `_expanded` via `updateSilent`; tools ' • ' serialization + bump.
- [ ] **Step 6.2: Design tab.** All 7 groups restyled per spec §5.5 (palette/header-style/typography/layout/spacing/accents/photo) using radio-cards, segmented sub-tabs, shadcn `Slider` (wire `onValueChange` to the existing apply+save calls), `Select` for image fit, `Switch` for decorative toggles, dropzones unchanged mechanically. KEEP stable `design` key (no remounts) + `rd:design-change` dispatch set (palette/layout/customColor only).
- [ ] **Step 6.3: Caret + drag verification (manual-assisted).** In preview: type continuously in a bullet input while another window event fires (dispatch `rd:design-change` mid-typing) → caret must not jump; drag a bullet within its list and across lists (must NOT cross); collapse states survive add/delete; scroll position survives a remount (add an experience while scrolled down).
- [ ] **Step 6.4:** Delete `.structure-panel-*` interior + `.panel-section-*` from `main.css` (keep the aside shell/positioning rules used by the skeleton + glass) and `editor.css` design-option blocks (~645–1700; keep inline-editor rules). Grep gate: `panel-section-\|design-palette\|design-layout\|header-style-\|font-pairing\|spacing-\|accent-option\|photo-option` → 0 hits in src.
- [ ] **Step 6.5:** Gate + gated commit — `refactor(structure): rebuild editor panel on shadcn (segmented tabs, sliders, radio-cards), trim editor.css`

---

### Task 7: Chat panel rebuild

**Files:** Rewrite `resume-designer/src/components/chat/ChatPanel.jsx`, `MessageList.jsx`, `ChatComposer.jsx`, `ModelSelector.jsx`, `ThreadSelector.jsx`; shrink `resume-designer/styles/chat.css` to skeleton-shell rules only (aside layout/width/closed-animation, floating toggle + busy dot, resize handle).

- [ ] **Step 7.1:** Rebuild per spec §5.4 and mockup "Chat" view: header + outline thread trigger; controlled thread popover (delete keeps it open; last-thread delete → AlertDialog 'Delete this chat thread?'); bubbles (user filled-primary 14/14/4/14, assistant bordered card w/ Reasoning callout + action row — Review Changes outline per §2.3-7); error card `bg-destructive-bg`; ThinkingBlock card; empty states; composer (chips, shortcut pills, rounded-xl shell, UNCONTROLLED `#chat-input`, model/globe/brain/send row); slash palette card (keyboard semantics identical incl. the 10ms auto-send timeout); model popover (groups, custom rows + remove, mono slug input + Use + invalid state, unconfigured notice). REDLINES: spec §6 items 7/9/10 + all `rd:chat-*` events + sanitized markdown path untouched (`Markdown.jsx` stays as-is).
- [ ] **Step 7.2:** Trim `chat.css`: keep ONLY `#chat-panel` shell (width var, `.closed` collapse, transition), `#toggle-chat-panel` + `#chat-toggle-indicator`, resize-handle rules — restyled values to match the system (border tokens). Everything else deleted.
- [ ] **Step 7.3:** Preview-verify: open/close/resize (240–500 clamp persists), thread create/switch/delete, slash popup keyboard cycle, model picker incl. custom slug invalid state, context chip add via `window.dispatchEvent(new CustomEvent('rd:chat-add-chip', …))` if a test hook exists (else via inline editor), light/dark/glass.
- [ ] **Step 7.4:** Gate + gated commit — `refactor(chat): rebuild panel on shadcn (popovers, bubbles, composer), shrink chat.css to shell`

---

### Task 8: Onboarding wizard rebuild

**Files:** Rewrite `resume-designer/src/components/onboarding/OnboardingWizard.jsx` + `OnboardingSteps.jsx`; delete `resume-designer/styles/onboarding.css`.

- [ ] **Step 8.1:** Rebuild per spec §5.8 and mockup: overlay (fixed inset-0 z-[3000] dark blur backdrop) + 620px card; Progress header + "Step N of {6|5}" + conditional X; the 9 step components keep their `.onboarding-content` + footer two-children contract (or refactor the slotting deliberately — keep the wizard's 3-zone flex with `:empty`-hidden footer equivalent: render footer only when children exist). All steps per spec mapping; alerts → inline destructive hints (field validation) or `toast.error` (async failures) with copy preserved. REDLINES: always-mounted bridge; personalities + step-number offset; `.show` 300ms enter/exit (re-implement with the same class or a `data-show` attribute + identical timings); body scroll lock; soft-fail key validation; refs persistence; draft stash; `resume-ready` + `completeOnboarding` + `refreshChatPanel`.
- [ ] **Step 8.2: Re-implement the AI-hover suppression.** `onboarding.css` had `body:has(.onboarding-overlay.show) .editable-ai-* { display:none }`. Recreate against the new overlay hook (e.g. `body:has([data-onboarding-open]) .editable-ai-btn, … .editable-ai-menu { display: none !important; }`) — place it in `editor.css` next to the `.editable-ai-*` rules. Verify by hovering resume text while the wizard is open: no floating AI button.
- [ ] **Step 8.3:** Preview-verify both personalities: `window.dispatchEvent(new CustomEvent('rd:open-onboarding'))` (first-run; no X) and via header New Resume (skip-key mode; X present; 5 steps); walk import-paste path and interview 2 questions; check dark/glass.
- [ ] **Step 8.4:** Delete `styles/onboarding.css` + reference. Grep gate: `onboarding-overlay\|onboarding-step\|onboarding-option` → only the new component's own names (which must NOT reuse the old class names — use Tailwind).
- [ ] **Step 8.5:** Gate + gated commit — `refactor(onboarding): rebuild wizard on shadcn (Progress, radio-cards, toasts), delete onboarding.css`

---

### Task 9: Diff review conversion (vanilla → React)

**Files:**
- Create: `resume-designer/src/components/DiffDialog.jsx`
- Rewrite: `resume-designer/src/diffView.js` (becomes a thin bridge)
- Delete: `resume-designer/styles/diff.css`
- Untouched: `resume-designer/src/diffEngine.js`

- [ ] **Step 9.1: Bridge.** Reduce `diffView.js` to:

```js
// Thin bridge: the diff UI is React (DiffDialog.jsx); this keeps the public
// API stable for chat / jobs / history / inlineChanges callers.
export function showDiffView(changeSet) {
  window.dispatchEvent(new CustomEvent('rd:open-diff', { detail: { changeSet } }));
}
```

(Port any other exports the old file had — check callers first with `grep -rn "from './diffView" resume-designer/src`.)

- [ ] **Step 9.2: DiffDialog.jsx.** Always-mounted, listens for `rd:open-diff`. Port from the OLD `diffView.js` implementation verbatim: change-card rendering (word-level del/ins via diffEngine output), inline vs side-by-side modes, Apply/Reject per change + Apply All/Reject All semantics, keyboard map (A/R/Enter/Esc), scroll lock, empty state, click-outside close. New presentation per spec §5.9/mockup: stat Badges, segmented mode toggle, tinted current/proposed columns (`bg-destructive-bg`/`bg-success-bg`), kbd hint footer.
- [ ] **Step 9.3:** Mount `<DiffDialog />` in `App.jsx`. Delete `styles/diff.css` + reference.
- [ ] **Step 9.4:** Verify all four entry points in preview: History Compare (easiest — make an edit, compare to initial), chat Review Changes if a key is configured (else code-inspect the call path), keyboard shortcuts, both modes, dark/glass.
- [ ] **Step 9.5:** Gate + gated commit — `refactor(diff): convert review overlay to React shadcn dialog, delete diff.css`

---

### Task 10: Small chrome restyles (vanilla-retained surfaces)

**Files:** `resume-designer/src/shell/appShell.html` (zoom toolbar/edit-hint markup classes), `resume-designer/styles/main.css` (zoom/edit-hint/PDF-modal rules), `resume-designer/src/pdf.js` (dialog markup), `resume-designer/src/inlineChanges.js` (injected styles), `resume-designer/styles/editor.css` (`.editable-ai-*`), `resume-designer/src/main.js` (migration toast → sonner), `resume-designer/src/backupFlow.js` (import-success modal restyle).

- [ ] **Step 10.1:** Zoom/undo toolbar: restyle CSS to the floating-pill look (ids unchanged; ghost icon buttons, tabular-nums readouts, divider, `:disabled` opacity).
- [ ] **Step 10.2:** PDF filename dialog: restyle `#pdf-dialog-overlay` markup/CSS to the system dialog shell (keep ids + Enter/Escape/overlay-click/focus-select wiring).
- [ ] **Step 10.3:** Edit hint → dark pill w/ dismiss X (localStorage key unchanged).
- [ ] **Step 10.4:** `inlineChanges.js` banner → slim card w/ stat badges + Apply All / Full Review / Dismiss; highlight outline colors → status tokens (`var(--success)` etc.).
- [ ] **Step 10.5:** `.editable-ai-*` hover chrome → system menu/button look (CSS-only).
- [ ] **Step 10.6:** Migration toast → `toast.success(...)` via sonner (copy + 8s duration + history-skipped note preserved); remove `#migration-toast` DOM/CSS. Backup import-success modal: restyle to system shell, KEEP DOM-built mechanics + Enter/Escape; reload overlay untouched.
- [ ] **Step 10.7:** Now delete the remaining `.modal-*` block from `main.css` if Steps 10.2/10.6 stopped using it (grep gate `class="modal\|modal-overlay` in src → only the rewritten markup's new classes).
- [ ] **Step 10.8:** Preview-verify each surface; gate + gated commit — `refactor(chrome): restyle vanilla-retained small chrome to the shadcn system`

---

### Task 11: CSS, glass, and dead-code sweep

**Files:** `resume-designer/styles/glass.css`, `styles/main.css`, `styles/shadcn.css`, `resume-designer/index.html`.

- [ ] **Step 11.1:** `glass.css`: delete rules for retired bespoke selectors (`.jd-panel`, `.profile-panel`, `.history-panel`, `.thread-selector-menu`, `.chat-reasoning-menu`, `.custom-dropdown-menu`, `.slash-commands-popup`, `.export-menu`, `.header-variant-actions-menu`, `.modal` where retired). Confirm every new surface frosts via the generic rules; spot-check tiers in `?translucent` (header/panels/menus/dialogs percentages unchanged).
- [ ] **Step 11.2:** `main.css`: sweep remaining dead chrome rules (search for class names no longer in src — script: for each `\.[a-z-]+` selector in main.css, grep src; list + delete the dead ones; keep resume-document/print/skeleton rules).
- [ ] **Step 11.3:** Fonts: `grep -rn 'Cormorant\|DM Sans'` in styles + src. Chrome references → removed. `index.html` Google Fonts `<link>`: KEEP only if the resume document's default preset still loads from it (it does, per README privacy note) — document the finding either way.
- [ ] **Step 11.4:** Remove `sheet.jsx` if still unused (`grep -rn "from '@/components/ui/sheet'"` → 0) — implementer's-choice item from spec §8; removing is cleaner.
- [ ] **Step 11.5:** Gate + gated commit — `chore(styles): delete dead bespoke CSS + glass selectors after shadcn conversion`

---

### Task 12: Full fragile-flow verification (release gate)

- [ ] **Step 12.1:** `npm run build && npx eslint . && npm test` — green.
- [ ] **Step 12.2:** Browser-preview sweep: every dialog/panel opened via its `rd:*` event, light + dark + `?translucent`, responsive stages (1440/1100/800/500), screenshots archived for comparison against both mockup pages.
- [ ] **Step 12.3:** `npm run tauri:dev` smoke (with Ash): window drag + traffic lights; glass on all surfaces; macOS Reduce Transparency → fully opaque; inline edit + zoom + undo/redo (toolbar) + variant switch; onboarding both personalities.
- [ ] **Step 12.4:** PDF e2e: export a known variant; compare output to a pre-redesign export (filename now un-prefixed per §2.3-5 — expected delta); confirm `print-step` console events.
- [ ] **Step 12.5:** Backup round-trip: export → import (Replace) → restyled success modal → reload overlay → data intact. Profile flush race: edit profile, immediately import a backup → imported data wins.
- [ ] **Step 12.6:** `npm run tauri:build` — strict prod CSP still satisfied (self-hosted fonts; no new origins); DMG bundles.
- [ ] **Step 12.7:** Delete the throwaway mockup pages (`public/shadcn-redesign.html`, `public/shadcn-redesign-all.html`, `public/shadcn-compare.html`) — ask Ash first.
- [ ] **Step 12.8:** Final gated commit + (on explicit ask) push; Ash merges per regular-merge workflow.

---

## Task dependency notes

- Task 0 blocks everything. Tasks 1–2 set the dialog patterns — do them before 4/5. Task 3 (header) is independent after 0 but carries the drag-region manual gate — schedule it early for risk burn-down. Tasks 6/7 (drawers) are the highest-regression-risk; they come after the dialog patterns are proven. Task 9 (diff) needs nothing from 4–8 but its entry points are easier to test after 2 (history compare). Tasks 10–12 are strictly last.
- If any task's preview-verify fails: fix forward within the task; never delete CSS until its surface passes.
- Spec-verification errata (workflow `wf_d94858ee-ff9`, may still be in flight at plan time): fold findings into the affected task before executing it.
