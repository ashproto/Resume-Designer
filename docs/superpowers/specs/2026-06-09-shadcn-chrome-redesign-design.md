# Full-shadcn Chrome Redesign — Design Spec

**Date:** 2026-06-09
**Branch:** `feat/react-chrome`
**Status:** Mockups approved by Ash on 2026-06-09. Spec pending review.
**Mockup pages (throwaway, in `resume-designer/public/`):** `shadcn-redesign.html` (Settings + History, approved), `shadcn-redesign-all.html` (Header / Chat / Structure / Profile / Jobs / Onboarding / Diff Review / Small Chrome, approved).

---

## 1. Goal & non-goals

**Goal.** Rebuild every app-chrome surface as **100% shadcn/ui** — canonical primitives, canonical layouts (shadcn/v0 idiom), shadcn's default typography (Geist) — with the app's identity applied as exactly two thin, values-only layers on top:

1. **Color scheme** — the existing 49 `--color-*` tokens mapped into shadcn tokens (`styles/shadcn.css`, already exists).
2. **Transparency** — the liquid-glass layer (`styles/glass.css`, already exists), gated on `data-tauri`, honoring `prefers-reduced-transparency`.

This is a *second pass over already-React code*: the chrome is fully React today, but ~19 of 21 components are "bespoke shells" — a shadcn `Dialog` wrapper around hand-written markup styled by ~5,800 lines of bespoke CSS. After this redesign every component is composed from shadcn primitives + Tailwind utilities, and the bespoke stylesheets are deleted.

**Non-goals.**
- The **resume document** (renderer.js, 11 layouts, resume.css), the **inline editor's editing mechanics**, and the **PDF/print capture pipeline** are untouched. The résumé's user-configurable fonts/colors are a product feature, not chrome.
- No data-model, store, persistence, or service changes beyond the minimal API adjustments listed in §5 (e.g. lifting a `confirm()` out of `variantManager`).
- No new features. Behavior deltas are limited to the explicit list in §2.3.

---

## 2. Locked decisions

### 2.1 Strategy
- **Pure shadcn components + Tailwind utilities; zero bespoke per-panel stylesheets.** Bespoke CSS survives only where it styles vanilla-retained modules (§5.10) — and even there it is rewritten to the system's look.
- **Layouts redesigned to the shadcn/v0 idiom** (not a 1:1 re-skin): sidebar-rail multi-section dialogs, grouped settings rows, radio-cards, segmented controls, badge-based status.
- **Identity = color tokens + glass only.** No font overrides, no component-level brand styling.

### 2.2 Typography
- Chrome font is **Geist Sans** (with **Geist Mono** for model slugs / slash commands), self-hosted via `@fontsource/geist-sans` + `@fontsource/geist-mono` so the desktop build stays offline-capable and CSP-clean. Do **not** load Geist from Google Fonts at runtime.
- A new `--font-ui` token carries the chrome stack: `'Geist Sans', 'Inter', -apple-system, system-ui, sans-serif`. `body` switches to `var(--font-ui)`.
- `--font-display` (Cormorant Garamond) and `--font-body` (DM Sans) **remain defined** for the resume document's default rendering, but no chrome rule may reference them. Verification step: confirm the renderer/fontService sets resume fonts explicitly and nothing in the document inherits `--font-ui` unintentionally.
- The serif app wordmark is retired (see Header, §5.3).

### 2.3 Intentional behavior deltas (everything else is behavior-preserving)
1. **Structure panel tab switcher**: dropdown-as-select → always-visible 4-tab segmented control (Header / Sidebar / Main / Design).
2. **Settings + Profile dialogs**: horizontal tab strips → left sidebar rail (one shared multi-section-dialog pattern).
3. **Jobs cards**: icon-only active toggle → terracotta **Active** badge on active cards + a quiet "Activate" text button on inactive ones; active card gets a tinted border.
4. **Header PDF button** gets a real loading/disabled state (spinner + "Generating…"). Today `pdf.js` applies that state to the hidden `#download-pdf` proxy, which is invisible.
5. **PDF default filename** drops the hard-coded personal-name prefix in `pdf.js showPdfDialog()` (line ~112); default becomes the slugified active-variant name only.
6. **Native `confirm()`/`alert()` → shadcn `AlertDialog` / sonner toasts** wherever the calling surface is React (full mapping in §5.11). Exceptions that stay native: backup-restore confirm + post-import reload overlay (`backupFlow.js`, WKWebView timing safety) and the OS updater dialogs (`native.js`).
7. **Chat "Review Changes"** button: green gradient → standard outline button. **"Apply to Resume"** stays the filled primary.
8. **Brand**: 24px terracotta rounded-square mark with white "R" + "Resume Designer" wordmark in Geist 600. Serif title retired.
9. **Boot migration toast** (`main.js` `#migration-toast`) → sonner toast (same copy, including the history-skipped note).
10. **Diff review overlay** (`diffView.js`) is **converted to React** (§5.9) — it was never converted in the first migration pass.
11. **Variant delete confirmation** moves out of `variantManager.js` into a header-owned AlertDialog; `variantManager` exposes a non-prompting delete. Last-variant protection becomes a disabled state + tooltip-style hint instead of an `alert()`.

### 2.4 Sizing & shape baseline (from the approved mockups)
- Buttons: default h-9 (36px), `sm` h-8 (~31px), icon 32×32 (`sm` 28×28); radius 8px.
- Dialogs: radius 14px (`rounded-xl`), `border` + layered shadow; header = title (17–18px, 600, `tracking-tight`) + 13px muted description; custom close X (ghost icon button) — `showCloseButton={false}` everywhere for consistency.
- Inputs/Textareas/Selects: h-9, radius 8px, `border-input`, focus ring in `--ring` (terracotta).
- Section separators: 1px hairlines; group title 14px/600 + 12.5px muted subtitle.
- Status colors (chips, diff blocks, impact groups) get **token pairs with dark-mode values** in `shadcn.css`: `--success`/`--success-bg`, `--destructive`/`--destructive-bg`, `--warning`/`--warning-bg`. Mockup hexes (green `#3d7a4f`/`#e9f2ec`, red `#b3402e`/`#f7e9e6`, amber `#9a6b1f`/`#f7efdd`) are the light values; dark values to be derived during implementation and verified in both themes.

---

## 3. Identity architecture

```
shadcn defaults (components, Geist, spacing, radius)        ← the base, unbranded
  └─ styles/shadcn.css   — token mapping: --primary→--color-accent, --background→--color-bg, …
        └─ styles/glass.css — Tauri-only transparency: color-mix opacities + backdrop blur
```

- `shadcn.css` keeps its existing mapping (verified current): `--background→--color-bg`, `--foreground→--color-text`, `--card/--popover→--color-panel-bg`, `--primary→--color-accent`, `--secondary/--muted→--color-bg-dark`, `--accent→--color-hover-bg`, `--muted-foreground→--color-text-muted`, `--border→--color-border`, `--input→--color-input-bg`, `--ring→--color-accent`, `--radius: 0.5rem`. Add the status-token pairs (§2.4) and `--font-ui`.
- **Dark mode is automatic**: shadcn tokens point at `--color-*` vars that already flip under `[data-theme="dark"]` and the system-preference fallback. The only new dark-mode work is the status-token pairs.
- **Glass simplifies.** Radix portals all popovers/menus/dialogs to `<body>`, where the existing generic rules (`[data-radix-popper-content-wrapper] > *`, `[role="dialog"]`, `.glass-card`) already apply tint + blur. As bespoke classes disappear, delete their per-class glass rules (`.jd-panel`, `.profile-panel`, `.history-panel`, `.thread-selector-menu`, `.chat-reasoning-menu`, `.custom-dropdown-menu`, `.slash-commands-popup`, …). Skeleton-owned surfaces keep their hooks: `.header-bar`, `.chat-panel`, `.structure-panel`, `.zoom-controls` classes/ids stay on the static shells. The three-tier opacity model (header 8–10% / panels 10–14% / menus ~72–75% / modals ~70–72% / content cards ~62–64%) and the `prefers-reduced-transparency` single-point neutralization are preserved as-is.

---

## 4. Design language (system rules)

All from the approved mockups; these are the rules every surface follows.

- **Multi-section dialog** (Settings, Profile): header (title + desc + action cluster + ghost X) over a 2-column body — left rail (~170–190px, `#fcfbf9`-tinted, 1px right border) of icon+label items (active = `rgba(accent,.10)` bg + accent text); right content pane with group title/subtitle, hairline-separated groups, and **settings rows** (label + hint left, control right).
- **Simple dialog** (History, Jobs, sub-dialogs, Rename, PDF, AlertDialog): same shell minus the rail; content scrolls; footer right-aligned `Cancel` (outline) + primary.
- **Docked drawers** (Chat, Structure): React portals into the existing skeleton `<aside>`s; panel header = 15px/600 title + ghost icon actions; content on `#fcfbf9` where it aids reading (chat stream), white for forms.
- **Menus/popovers**: Radix portal to body; 10px radius card, 5px padding, 7px-radius items, muted group labels, check-mark selection with invisible-check alignment, destructive items in `--destructive`.
- **Radio-cards** for exclusive visual choices (theme, onboarding paths, layout/shape pickers): bordered card, hover `--accent`, selected = accent border + 1px ring + 4% accent tint.
- **Segmented control** (`TabsList`-style muted pill) for 2–4-way switches: Recent/All, Date/Relevance, Inline/Side-by-side, Paste/Upload, spacing presets, structure tabs.
- **Badges** for status: terracotta-tinted (Active, AI-Powered), green/red/amber tinted (keywords, diff stats, impact), square-corner variant for counts.
- **Switch** (shadcn) for booleans; **Checkbox** only inside multi-select lists (job picker).
- **Sliders** (shadcn Slider look): 5px track, 16px white thumb with accent border, label left + tabular-nums value right.
- **Dashed add-buttons** for append actions (`+ Add bullet`, `Add Experience Entry`): full-width, 1.5px dashed, accent on hover.
- **Drag handles**: `GripVertical` lucide glyph, `#b6afa5`, handle-only listeners.
- **Empty states**: centered muted icon (40–48px) + 1-line title + 1-line hint; dashed-border card variant inside forms.
- **Destructive policy**: AlertDialog with specific copy ("Delete this resume?" + consequence line), outline Cancel + filled `--destructive` confirm.
- **Toasts**: sonner, position unchanged; icon + bold title + muted line + optional action button.
- **Icons**: lucide-react only. The hand-drawn SVGs in the structure panel (tab glyphs, 11 layout wireframes) are kept as local components but normalized to 1.5–2px stroke.

---

## 5. Surface specifications

Each entry: what it becomes, and the engineering contracts it must keep (full fragile-contract list in §6).

### 5.1 Settings dialog (`SettingsDialog.jsx`) — re-do of the interim fix
Per the approved first mockup page: multi-section dialog (~720px) with rail **General / AI / Updates (Tauri-only) / Data / Usage**; General = Appearance group (radio-card Light/Dark/System) + Updates row (Switch) + Onboarding row (outline Replay) + About row (version Badge); AI = key input (shadcn Input + eye toggle) + auto-fallback Switch + Clear All Keys (AlertDialog) / Save; Updates = channel segmented (Stable/Beta) + auto-update Switch + Check for Updates (busy state via `useUpdateBusy`); Data = backup Export/Import rows; Usage = 4 stat cards + 2 tables (shadcn table styling) + Export/Refresh/Clear (AlertDialog).
**Keeps:** `rd:open-settings` (+ `{tab}` deep-link, incl. `api-keys` target used by chat), `settingsModal.js` bridge, all service calls, theme sync via `themechange`. **Deletes:** `.settings-*`, `.modal-*` (settings usage), `.usage-*`, `.theme-option`, `.api-key-*` blocks in `main.css`.

### 5.2 History dialog (`HistoryDialog.jsx`)
Per approved mockup: simple dialog (~480px) + description line; timeline = 30px circular icon markers on a 1.5px rail (current = accent border/tint), type Badge + muted relative time, 13.5px description, outline sm Restore/Compare, "Current version" accent pill; lucide icons per `changeType` (initial→FileText, edit→Pencil, ai→Sparkles, import→Upload, reorder→ArrowUpDown, add→Plus, remove→Minus).
**Keeps:** `rd:open-history`, store subscribe/bump, restore → AlertDialog (was `confirm()`), compare no-difference alert → toast, `showDiffView` handoff. **Deletes:** `history.css` (372 lines).

### 5.3 Header (`Header.jsx`)
56px bar, three zones. Brand mark + Geist wordmark (§2.3-8). Variant selector = outline combobox-style trigger (name + chevron, end-ellipsis, "Select Resume" fallback) opening the standard menu (check-aligned items, name + muted relative timestamp). Variant actions = ghost icon buttons >1400px (Plus/Copy/Pencil/Trash-destructive), kebab `MoreHorizontal` menu 768–1400px, hamburger ≤768px with grouped labels Resume/Tools/File. Tools/Import/Export = ghost buttons (responsive text-collapse stages preserved: ≤1200px Tools+PDF icon-only, ≤1050px Import/Export icon-only). Settings = ghost gear. PDF = the bar's only filled button, with the new visible busy state.
**Keeps:** portal into skeleton `<header id="header-bar">`; `tauriDrag.js` untouched — every interactive element remains a real `<button>`/`[role=menuitem]` (drag-exemption selectors); macOS traffic-light padding (85px/70px) driven by existing `<html>` classes; Radix menus portal to body; hidden import `<input type=file>` + value reset; Rename dialog (system shell); `useVariants()` stable snapshot; `window.showOnboardingWizard/open*Panel` globals; hidden `#download-pdf` proxy contract (visible busy state mirrors it — pdf.js exposes its busy via a small event or class observation, decided at implementation).
**Deletes:** live `.header-*`/`.custom-dropdown*` rules + the already-dead vanilla header CSS in `main.css`.

### 5.4 Chat panel (`chat/*`)
Drawer unchanged structurally (skeleton aside, `.closed` width-collapse, 240–500px resize handle persisting `--chat-panel-width`, floating toggle + busy dot). Header: "AI Assistant" + ghost gear/X; thread selector = full-width outline trigger → **controlled** popover (header "Chat Threads" + accent `+`; rows with hover-revealed delete X; delete keeps the popover open; last-thread delete → AlertDialog). Stream on `#fcfbf9`: user bubble = filled accent (14/14/4/14 radius, ≤85%); assistant = white bordered card (14/14/14/4, ≤92%) with optional Reasoning callout (accent left border, truncated 300 chars) and action row (`Apply to Resume` primary sm / `Review Changes` outline sm) behind a hairline; error = destructive-tinted full-width card; ThinkingBlock = bordered card, spinner→green check header, steps with checks + pulsing accent dot. Empty states as system empty-state cards (unconfigured = lock icon + provider card + "Configure API Keys" primary; welcome = chat icon + suggestion list). Composer: context chips (accent-tinted pills + remove, "Clear all" text button, uppercase micro-label), shortcut pills (outline, rounded-full, hidden ≤1024px), bordered rounded-xl input shell — uncontrolled auto-grow textarea (`#chat-input` id preserved), bottom row = model trigger (ghost, ellipsized) · divider · globe toggle (`.on` accent tint) · brain reasoning trigger (disabled+`N/A` when unsupported) · filled send. Slash palette = Command-style card (mono command + muted desc, icon tiles, keyboard nav semantics identical). Model popover: grouped curated list w/ accent group labels, custom rows w/ hover remove, mono slug input + `Use` (invalid = destructive ring + hint), unconfigured notice card.
**Keeps:** every `rd:chat-*` event, controlled-popover semantics, uncontrolled textarea, the sanitized-markdown render path (DOMPurify + DOM building; no raw-HTML injection props), auto-scroll behavior, 300ms focus timing, openSettings('api-keys') deep links, no-stop-button reality (unchanged scope). **Deletes:** `chat.css` (rewritten to ~0; the file's surviving rules — skeleton aside layout, toggle button, resize handle — move to a small chrome-shell stylesheet or Tailwind on the skeleton, decided at implementation).

### 5.5 Structure panel (`structure/*`)
Drawer skeleton unchanged (aside + `#structure-panel-content` portal + external toggle + `.panel-open`). Tab switcher → segmented control (§2.3-1). Bold toolbar = outline icon `B` + muted hint (mousedown-preventDefault + `.form-input/.form-textarea` activeElement contract — the system classes keep those two class names as aliases on shadcn Input/Textarea within this panel). Sections = collapsible cards (`#fcfbf9` header row, chevron, headerExtra ghost `+`). Content tabs: labeled inputs (uncontrolled + `data-field` + `localEdit` gate + `dataVersion` remount + scroll restore — all preserved verbatim); sidebar sections = sortable cards w/ title input, Bulleted/Inline-Tags segmented, nested item rows (grip + input + hover X), dashed add; tools list rows + ' • ' serialization + bump; experience = sortable accordion (grip, title/company two-line header, chevron; expanded: 3 inputs, Bullets nested sortable, dashed add, Delete → AlertDialog; `_expanded` via `updateSilent`); Date/Relevance segmented sort bar when >1. Design tab (stable `design` key, never remounts): all 7 groups restyled — palette grid (12+custom swatch radio-cards w/ selection ring), header style (2 mode radio-cards + Gradients/Patterns/Textures/Image segmented + swatch grids + dropzone/preview + opacity Slider + Fit Select + reset), typography (preview card; Presets/Google/System segmented; pairing radio-cards; search Input + category chips + H/B toggle buttons), layout grid (11 wireframe radio-cards), spacing (preset segmented + 4 Sliders + 2×2 margin number Inputs + reset), accents (preview card + underline/bullet/corner/tag option rows + 2 Switch rows), photo (dropzone/preview + placement/shape/size/border rows + 3×3 focus grid + zoom Slider).
**Keeps:** per-list `DndContext` scoping + handle-only + 4px activation; dropzone label-wrapping-hidden-input + `dragover` classList pattern; `rd:design-change` dispatches (palette/layout/customColor only); direct service apply+save for the rest; New-section dialog (already system-shaped). **Deletes:** `.structure-panel-*`/`.panel-section-*` blocks in `main.css`, design-option blocks in `editor.css` (~645–1700) — `editor.css` rules for the inline editor itself stay (§5.10).

### 5.6 Profile dialog (`profile/*`)
Multi-section dialog (~740px): header = title/desc + Saved badge (green, 1.5s) + outline sm Import/Export + primary sm AI Interview (sparkles) + ghost X; rail = Contact / Summary / Experience / Skills / Education / Projects / More. Contact = 2-col labeled Input grids ("Basic Information", "Online Presence" w/ brand-icon labels). Summary = 3 labeled Textareas with hints. Experience/Education/Projects = entry cards (title-weight Input + ghost-destructive trash in header row; body inputs/textarea) + dashed add + empty states. Skills = compact rows (name Input flex-1 + Proficiency shadcn Select + Years Input + hover X) + dashed add + Industry Knowledge textarea. More = three mini-list groups (compact rows / full cards) with small dashed adds.
**Keeps:** ALWAYS-MOUNTED + `rd:open-profile`/`rd:profile-flush`; uncontrolled inputs mutating `profileRef` + 500ms debounce + flush-on-every-close-path + `${tab}-${version}` remount keys; Import label-wrapped file input + value reset (errors → toast, was alert); AI Interview 200ms-delayed handoff. Item deletes stay unconfirmed (single-user app; unchanged). **Deletes:** `userProfile.css` (676 lines; includes the dead `.import-indicator` and old overlay rules — the `body:has(.profile-panel-overlay.show)` AI-widget suppression is dead and needs no replacement).

### 5.7 Jobs suite (`jobs/*`)
Main dialog (~700px, three sections separated by hairlines): Add form (2-col inputs + textarea + outline Paste-from-Clipboard + primary Add; empty-description validation → inline destructive hint, was alert); list section (count w/ "(5 of M)" Recent logic, ghost icon Collapse/Expand-All when >1 + Import/Export JSON, Recent/All segmented) of cards per §2.3-3 (chevron collapse, title/company, Active badge or Activate text button, ghost pencil/trash-destructive (AlertDialog), 150-char preview + Added-date when expanded; default-collapsed); analysis section (primary Analyze Resume Fit w/ "Analyzing…" busy, outline Tailor Resume, unconfigured warning line) + results: score = conic-gradient accent progress ring (~84px); matching/missing keywords = green/red badges; Strengths list; Gaps list (bold area + suggestion sub-line); Recommended Changes = header + high/med/low count badges, impact groups in order with icon+label+hint, recommendation cards (impact-colored left border, impact badge w/ title-tooltip reason, section badge, Apply sm → Applied badge; current → suggested tinted blocks; reason paragraph). Selection dialog: system shell; Model + Reasoning as shadcn Selects; selected-count + Select All/Clear text buttons; rows as checkbox label-cards w/ selected tint; footer Cancel + `Analyze (N)` (disabled at 0). Edit dialog: controlled inputs, Cancel/Save (silent no-op on empty preserved). Loading overlay: body-portal above dialogs (z-2200), dark blur, accent spinner, 3 cumulative 2s steps — restyled only.
**Keeps:** permanently mounted + `rd:open-jobs`/`rd:jobs-variant-change`; `bump()` CRUD pattern; per-variant analysis persistence + session `appliedIndexes` on `originalIndex`; `applyRecommendationToStore` failure → toast w/ manual-edit guidance (same copy); Tailor closes dialog before `showDiffView`; clipboard/import/export mechanics + every alert message (→ toasts/inline). Fix while here: seed the model select with `aiService` defaults so the stale `claude-sonnet-4.5` fallback can't select nothing (audit correction). **Deletes:** `jobDescriptions.css` (1394 lines).

### 5.8 Onboarding wizard (`onboarding/*`)
Card (~620–640px, 3-zone: progress header / scrollable step / footer; footer hidden-when-empty preserved). Header: shadcn Progress (width = displayStep/total) + "Step N of {6|5}" + X (new-resume mode only). Steps mapped: **API key** = key icon, Input w/ inline status glyph + validated/invalid tints + status banner (success green / soft-fail red noting key saved) + privacy line + single big primary w/ Validating busy + auto-advance timing preserved; **choose path** = 3 radio-cards (Import / Start Fresh / Create-for-Job featured w/ accent ring) each w/ AI-Powered badge; **import** = Paste/Upload segmented + 15-row textarea / dashed dropzone (extracting spinner state) + file-preview sub-step (scroll box + info callout + Try Again/Continue); **interview** = "Question n of 6" + dot progress, keyed-remount per question, Input/Textarea + conditional "Help me improve this with AI" (primary sm, sparkles, configured-only), Back/Previous + Next/Continue; **job input** = 2-col inputs + 10-row textarea + outline Paste-from-Clipboard + Model/Reasoning Selects (reasoning disabled + note when unsupported) + benefits callout + Generate busy state; **Profile Needed** block = amber empty state + Open My Profile primary; **JD step** = benefits callout + 3 fields + full-width primary Add This Job + added-jobs rows w/ remove X + morphing footer (Skip for Now secondary ↔ Tailor My Resume primary w/ busy); **review** = bordered preview card (accent border when tailored; Name/Title/Summary/Highlights/Skills/Experience/Education mini-sections, ✨ AI badges + tinted ai-generated blocks, Not-detected italics, +N-more caps) + amber parse-warning callout; **success** = green check icon + 3 tip rows + Start Editing.
**Keeps:** always-mounted `rd:open-onboarding`/`rd:close-onboarding` bridge; two personalities + step-number offset math; `.show` enter/exit timing (300ms) + body scroll lock; soft-fail key validation + save-before-validate; model/reasoning ref persistence; draft stash/restore on back-nav; job-mode step-3 skip; `resume-ready` event + `completeOnboarding()` + `refreshChatPanel()`; the ~9 `alert()` paths → inline errors/toasts with copy preserved. The `body:has(.onboarding-overlay.show)` AI-hover suppression must be re-implemented against the new overlay class (or a `data-` attribute) — load-bearing. **Deletes:** `onboarding.css` (1394 lines).

### 5.9 Diff review — NEW conversion (`diffView.js` → `DiffDialog.jsx`)
The last big vanilla chrome surface (entered from Chat "Review Changes", Jobs "Tailor Resume", History "Compare", inline banner "Full Review"). Becomes an always-mounted React full-screen dialog: header = title + green/red/amber stat badges + Inline/Side-by-side segmented + ghost X; change cards = type badge + section badge + Apply/Reject sm (Applied badge after), Current/Proposed tinted columns w/ word-level `del`/`ins` highlighting; footer = kbd hints (A / R / Enter / Esc) + Reject All outline + Apply All primary.
**Bridge:** keep `showDiffView(changeSet)` as the public API — it dispatches `rd:open-diff` with the changeSet; all four entry points unchanged. Keyboard shortcuts, click-outside close, scroll lock, empty state, and apply/reject semantics preserved exactly. `diff.css` deleted; `diffEngine.js` (pure logic) untouched.

### 5.10 Small chrome
- **Zoom/undo toolbar** (skeleton + `zoomControls.js` + `main.js` undo wiring): stays vanilla; CSS rewritten to the floating-pill system look (ghost icon buttons, tabular % readout, divider, disabled states). Ids preserved (`#undo-btn`, `#redo-btn`, `#text-tools`, …).
- **PDF filename dialog** (`pdf.js`): stays vanilla; markup/CSS restyled to the system dialog shell; filename Input + `.pdf` suffix + Cancel/Download; Enter/Escape/overlay-click/focus-select preserved; §2.3-5 prefix fix; native save-path dialog + failure alerts → failure toasts where safe (capture-path errors may stay native if timing requires).
- **Edit-mode hint** (`#edit-hint`): restyle to the dark pill + dismiss X; localStorage dismissal unchanged.
- **Inline AI banner + canvas highlights** (`inlineChanges.js`): stays vanilla (it decorates the vanilla-owned resume DOM); its injected banner restyles to the slim card (sparkles + title + stat badges + Apply All primary / Full Review outline / Dismiss ghost); highlight outline colors move to the status tokens.
- **Inline-editor hover chrome** (`.editable-ai-*` in `editor.css`): stays vanilla; restyled to system menu/button look.
- **Toasts**: sonner everywhere (update flow already is; migration toast migrates per §2.3-9). Backup "Import successful" DOM modal restyles to the system shell but **stays a DOM-built modal** (WKWebView dialog-race rationale); reload overlay unchanged.
- **Native-kept**: updater ask()/restart dialogs, backup-restore destructive confirm, PDF save-path picker.

### 5.11 AlertDialog adoption map
| Today (native) | Becomes |
|---|---|
| Header: delete variant `confirm()` | AlertDialog (§2.3-11); last-variant `alert()` → disabled + hint |
| Chat: last-thread delete `confirm()` | AlertDialog |
| Structure: delete section / delete experience `confirm()` | AlertDialog |
| Jobs: delete JD `confirm()` | AlertDialog |
| History: restore `confirm()` | AlertDialog |
| Settings: Clear All Keys / Clear usage `confirm()` | AlertDialog |
| Jobs/Chat/Onboarding/Profile `alert()` validations & errors | inline destructive hints (field-adjacent) or sonner toasts; every message preserved |
| backupFlow restore confirm, reload overlay; native updater dialogs; PDF save-path | unchanged (timing/OS integration) |

---

## 6. Engineering contracts (must survive — the redline list)

1. **Skeleton shells stay**: `<header id="header-bar">`, `<aside id="chat-panel">`, `<aside id="structure-panel">` (+ their toggle buttons and close buttons), `#resume*` tree, zoom toolbar, `#edit-hint` — React portals in, never replaces. `tauriDrag.js` and glass selectors depend on them.
2. **Window-drag exemptions**: every header interactive element matches the exemption selector list (real `button`/roles/`data-no-drag`).
3. **Caret safety**: Structure + Profile inputs uncontrolled (`defaultValue`), `localEdit`/debounce gates, remount-key strategies (`dataVersion`, `${tab}-${version}`), scroll-position capture/restore.
4. **`data-field` + `.form-input`/`.form-textarea`** contracts for the Bold tool.
5. **dnd-kit**: per-list contexts, handle-only, vertical + parent restriction, 4px activation.
6. **Always-mounted dialogs + window-event bridges**: profile (`rd:open-profile`/`rd:profile-flush`), jobs (`rd:open-jobs`/`rd:jobs-variant-change`), onboarding (`rd:open-onboarding`/`rd:close-onboarding`), settings (`rd:open-settings`), history (`rd:open-history`), chat (`rd:chat-*`), new diff (`rd:open-diff` behind `showDiffView`).
7. **Controlled popovers** where lists mutate in place (threads, custom models).
8. **Portal layering**: Radix → body; jobs loading overlay z-2200 above dialogs; sonner above chrome.
9. **Sanitized markdown path** in chat (DOMPurify + DOM building; no raw-HTML injection props).
10. **`#chat-input` id**, 300ms focus timing, `--chat-panel-width` clamp/persist.
11. **Glass**: `:root[data-tauri]` gating, tier percentages, `prefers-reduced-transparency` neutralization, menus portal outside frosted ancestors.
12. **Onboarding overlay AI-hover suppression** re-implemented for the new overlay.
13. **PDF proxy**: `#download-pdf` remains until the busy-state mirror is wired; print/capture pipeline untouched.
14. **CSP**: no runtime font/script origins added (fonts self-hosted); prod CSP byte-identical.

---

## 7. Deletion targets (after their surface converts — never before)

| Asset | Size | Gated on |
|---|---|---|
| `styles/userProfile.css` | 676 lines | §5.6 |
| `styles/jobDescriptions.css` | 1394 lines | §5.7 |
| `styles/history.css` | 372 lines | §5.2 |
| `styles/onboarding.css` | 1394 lines | §5.8 |
| `styles/diff.css` | (full) | §5.9 |
| `styles/chat.css` | bulk (skeleton-shell rules relocated) | §5.4 |
| `main.css`: `.modal-*`, `.settings-*`, `.usage-*`, `.theme-option`, `.api-key-*`, live+dead `.header-*`, `.custom-dropdown*`, `.structure-panel-*` interior, `.panel-section-*` | ~700+ lines | §5.1/5.3/5.5 |
| `editor.css`: design-option blocks (~645–1700) | ~1000 lines | §5.5 |
| Google Fonts `<link>` for DM Sans/Cormorant in `index.html` | — | only if confirmed resume-document-unused (else keep; chrome stops referencing) |
| Dead selectors flagged by inventories (`.chat-loading`, `#chat-file-input`, `.thread-selector-menu`, legacy onboarding/vanilla-header classes) | — | with their files |

Total bespoke chrome CSS retired: **~5,800+ lines**.

---

## 8. New dependencies & primitives

- `@fontsource/geist-sans`, `@fontsource/geist-mono` (dev-time, bundled).
- shadcn additions: `alert-dialog`, `progress`, `slider`, `badge`, `scroll-area` (chat stream + dialog bodies, optional), `table` (usage tab). Already installed and now actually used: `select`, `tooltip` (title-attr replacements where cheap). `sheet` remains unused (drawers are skeleton-hosted) — remove or keep dormant, implementer's choice.

---

## 9. Conversion order & verification (sketch — the implementation plan owns details)

Foundation (fonts + tokens + status colors + new primitives + AlertDialog/Toast helpers) → **Settings → History** (pattern-setters, small) → **Header** (drag-region risk; verify early) → **Profile → Jobs** (dialog patterns) → **Structure → Chat** (drawers, caret/dnd risk) → **Onboarding** → **Diff conversion** → **small chrome restyles** → per-surface CSS deletion sweeps → glass selector cleanup → full fragile-flow verification (PDF e2e, backup round-trip, updater toast, glass + reduced-transparency in a `tauri:build`, dark mode on every surface, drag region, undo/redo, caret behavior in both panels).

Each surface lands as: rebuild → preview-verify (light/dark/glass) → delete its CSS → commit (gated on explicit go-ahead, per standing constraint).

---

## 10. Out of scope

Resume document & renderer; inline-editor editing mechanics; PDF capture pipeline (Rust + print window); store/persistence/services logic; updater/release infrastructure; adding a chat stop-button or streaming (noted gap, separate feature); converting `inlineChanges.js`/`zoomControls.js`/`pdf.js` to React (restyle-only this pass).
