# iOS Edit Resume and adaptive chrome audit

Read-only source/UX audit for the supplied iPhone Duo screenshots. Product source was not edited, Git was not mutated, and no build/runtime test was run by this audit agent. Line references below describe the current local UI tree at `c9df2c37`; the subsequently merged `main` synchronization changes release automation, not these UI components.

## Findings from the current screen

### 1. Writing and section administration compete inside the same row

`resume-designer/src-tauri/ios/OPShell.swift:5631-5643` constructs each section as a DisclosureGroup containing, in order:

1. An editable heading.
2. Move up/down, Area and Parent group controls.
3. A Typography DisclosureGroup.
4. Every content field and nested role/item.
5. A destructive Delete/Remove action.

The outer DisclosureGroup label already displays the same heading (`5645-5651`). This directly explains the repeated Summary/Experience titles and the large block of blue administrative controls preceding the text in Photo 1. These are not isolated spacing defects: the composition makes secondary structure work more prominent than the user's writing.

The section label includes a bespoke drag glyph with 8 points of padding (`5649-5651`) while movement is also exposed as two full text buttons (`5678-5681`). Three parallel affordances describe one relatively infrequent operation.

### 2. Every section starts expanded, with no focused editing destination

`collapsedCards` begins as an empty set (`OPShell.swift:5816`). Expansion is the inverse of membership (`5939`), so every main, sidebar and child section is initially open. `StructureSheet` renders all of them in one Form (`5914-6027`). Header layout controls and all contact values appear before the main writing sections (`5924-5930`), and Add/Restore/Group actions are far below them (`5958-6025`). This requires substantial scrolling before and during routine editing.

Parent/child hierarchy is represented by only 12 points of additional indentation (`5954`). Parent and leaf headers use the same label font/icon treatment (`5646-5647`). The user has little visual help distinguishing the outline from the content it owns.

The whole screen forces `editMode` active (`6038`), so row-reorder/delete administration is permanently part of the writing surface. This repeats the same hierarchy problem at the item level.

### 3. Long text is an eight-line field inside an already deep Form row

`fieldRow` repeats a caption label and renders multiline text using `TextField(axis: .vertical).lineLimit(2...8)` (`6224-6236`). Summary is projected as an ordinary multiline string (`resume-designer/src/iosShell.js:510-512`). This explains the smaller Summary caption and large raw prose field under another Summary heading in Photo 1.

Canonical strings can contain Markdown. A native TextField shows the literal `**` in the screenshot; it does not provide the rendered reading treatment that the resume canvas does. Do not silently strip or rewrite stored Markdown to make the editor look cleaner. A concise outline preview can reuse the existing display-only `stripMarkdownForPreview` helper (`OPShell.swift:6510-6526`), while the focused editor preserves the canonical text. A full rich-text editing conversion is a separate, larger data/selection problem and should not be smuggled into visual polish.

### 4. The canvas deliberately ignores every safe area, while CSS only reserves vertical chrome

`ShellView` applies `.ignoresSafeArea(edges: .all)` to CanvasHost (`OPShell.swift:3830-3854`). Its comments explicitly target both vertical chrome underlap and landscape horizontal gutters. It is important not to replace this blindly with a blanket safe-area inset: earlier code comments document a double keyboard-avoidance regression and broken viewport sizing.

However, the current horizontal assumptions contradict one another:

- `resume-designer/styles/native-shell.css:32-36` says SwiftUI already horizontally insets the webview and explicitly removes both `env(safe-area-inset-left/right)` paddings.
- The actual CanvasHost ignores all edges.
- The resume scroller reserves a fixed 16px horizontally and only `env(top/bottom) + 52px` vertically (`native-shell.css:113-116`).

That is a concrete geometry risk for a window with an asymmetric system exclusion region. It is consistent with the preview occupying the region behind the right-side system cluster in Photo 2, but the screenshot alone cannot prove which native/WebKit inset values Duo reports. Before changing offsets, measure the hosting view/window safe-area insets, its safe-area layout frame, the WKWebView frame, CSS `env()` values, and viewport dimensions on the actual device or matching simulator. Do not encode a Duo model-name check or a guessed right gutter.

The existing fit algorithm already subtracts real computed scroller padding (`resume-designer/src/zoomControls.js:301-309`) and refits only a previously fitted view during resize/orientation changes (`166-183`). Correctly supplying actual available geometry can reuse this behavior rather than invent a second zoom model. User-chosen manual zoom must remain untouched during adaptation.

### 5. Custom bottom chrome bypasses native toolbar adaptation

The five-tool capsule and zoom capsule are ordinary overlay content, not toolbar items: `ShellView.overlay(alignment: .bottom)` at `4044-4045`; fixed HStack at `4578-4643`. The system navigation bar uses native ToolbarItems at `3766-3799`, but the bottom bar does not.

The bottom row has fixed horizontal padding (`4523-4526`), fixed 44-point capsule height and 20-point internal horizontal padding (`7151-7155`), and minimum 40x40 button slots (`7195-7200`). There is no shell width/height size-class, GeometryReader, ViewThatFits or equivalent layout policy. At larger text sizes and narrower safe widths this row has no alternative arrangement.

The present design spends persistent space on five icon-only actions plus a percentage control; the controls' meanings are not visually labeled at rest. Their VoiceOver labels exist, but 40-point slots are below the usual 44-point control target. Increasing them without reducing/reflowing the row will make width pressure worse, so treat sizing and composition together.

The canvas's fixed 52px bottom reservation assumes this exact bar geometry. A native/system adaptive toolbar or measured-content inset should own the clearance, rather than parallel SwiftUI and CSS constants drifting apart.

The root's transparent navigation background (`3858-3861`) and broad edge-to-edge canvas can remain a deliberate background treatment, but meaningful document content and actionable chrome must use a coherent usable region.

### 6. Related geometry detail: PDF sharing anchor

The UIKit share sheet anchors an iPad-style popover at `root.view.bounds.maxX - 40` and `safeAreaInsets.top` (`OPShell.swift:3430-3437`), rather than the actual export control or full safe layout frame. This should be included in the adaptive audit if the Duo's presentation style chooses a popover. Preserve the existing exported-file cleanup and presentation-controller selection; only improve the anchor geometry where appropriate.

## UI architecture options

| Option | Interaction | Benefits | Costs/limits |
|---|---|---|---|
| Refine the existing Form | Start cards collapsed; compact header and excerpt; move placement/typography/delete into a per-section inspector; explicit Arrange mode | Smallest behavioral change, rapid improvement, existing draft lifecycle easiest to retain | A long outline still expands into nested forms; wide layouts and simultaneous preview/editing remain limited |
| Focused outline + section detail | Compact section list; tap a row to open its focused editor; content first, style/layout reached from a contextual inspector; explicit Arrange mode | Clear task hierarchy, fewer repeated controls, usable long-text editing, scales naturally from compact navigation to wide list/detail | Requires careful selection lifetime and focus ownership; existing positional role/group references must not become long-lived unsafe navigation identity |
| Dedicated wide workspace | On sufficiently usable width, section outline/inspector beside the live canvas; compact widths collapse to the same section-detail flow | Makes Duo/unfolded/iPad width useful without forcing whole-page zoomed reading as the editing mode | Should be driven by measured usable window size and content requirements; cannot just equate a regular size class or device name to enough width |

The strongest end state combines the focused outline/detail interaction with a wide presentation of the same components. This retains one content model and one edit workflow while changing their arrangement. A modest first pass can implement the first option without blocking a later wide presentation.

### Recommended content hierarchy

- Entry screen: Header & Contact, Main content, Sidebar, with short previews or counts; meaningful parent/child indentation and disclosure, no content fields open by default.
- Section editor: one title, the actual content first, appropriate fields or an item list; optional secondary Content/Style organization rather than all controls in one row.
- Section configuration: heading, area, parent, typography and destructive action in clearly separated grouped rows. Group settings expose heading typography only; child typography remains independent.
- Arrange mode: explicit drag handles, accessible Move up/down actions, cross-area/group movement through a contextual menu or placement screen; preserve the same supported underlying commands.
- Add: one contextual Add entry/action per relevant list and one Add section/group entry point; Restore standard sections remains available.
- Keyboard: visible completion/dismiss affordance for long text and numbers; keep live updates and drafts, avoid making navigation discard a focused value.
- Compact chrome: prioritize the editing task and Assistant, retain direct Undo/Redo while editing, and provide clear standard labels. In constrained space reflow/collapse secondary tools with native toolbar behavior instead of squeezing targets or hiding functionality.

## State, undo and safety constraints that must survive

1. **The JS store remains authoritative.** `setField` routes to existing `deps.updateField` (`iosShell.js:1854-1859`). `editSection` materializes stable IDs, preserves canonical fields, attaches change metadata and commits through the same sectionLayout store update/undo path (`1629-1641`). Do not add a disconnected Swift document copy or parallel undo stack.
2. **Focused drafts protect cursor position and user work.** `StructureSheet.binding` uses the local draft only while focused, checks the originating workspace, and writes each keystroke (`OPShell.swift:6353-6368`). Its focus change holds `setNativeEditing(scope: document, holder: field)` (`6050-6060`). New editor/detail views must retain or deliberately transfer this ownership and release holders on dismissal.
3. **Stable section identity is required for navigation.** Select by `Card.key`, and re-resolve the latest card from the current snapshot. Do not retain an entire old Card as the ongoing source of truth after structural commands assign IDs or reorder it. Clear/re-resolve selection on workspace or adoption changes.
4. **Role/item navigation needs extra care.** Experience groups are `experience-<index>` (`iosShell.js:529-548`), and fields contain positional canonical paths (`516-525`). Those group IDs are not durable role identities. Re-resolve by existing role identity where possible, or invalidate the selected detail when adoption/revision changes. Moving an index-backed group into a long-lived NavigationPath without this protection introduces wrong-row editing risk.
5. **Actions are bound to the document they were rendered for.** Native heading edits capture workspace/revision (`5660-5709`); percent-size drafts do the same and clamp only when committed (`5776-5800`). Movement and style commands carry the existing revision; JS `requireCurrentDocument` refuses stale adoption counters (`iosShell.js:1519-1523`).
6. **Destructive operations retain native confirmation and identity checks.** Card removal captures signature/workspace/revision and only then sends sectionRemove (`OPShell.swift:6100-6111`); JS checks the signature (`iosShell.js:1982-1993`). Role removal re-resolves stable identity or refuses ambiguous legacy title/index cases (`OPShell.swift:5879-5894`). Group removal keeps children; section deletion removes content; Undo remains shared.
7. **Drag/drop must retain origin checks.** Native source captures workspace/revision (`5942-5946`) and checks it before dispatching sectionDrop (`6126-6130`); JS relocation preserves stable keys, parent constraints and area (`iosShell.js:1929-1966`). Accessible non-drag equivalents must remain.
8. **No-op and typography behavior stay intact.** Re-selecting current area/parent is a no-op (`iosShell.js:1953-1958`). Groups reject content typography (`1974-1980`); child title/content style isolation is already tested. Percent input remains draft-based until commit and does not jump to 50% during intermediate typing.
9. **Do not replace UIKit containment with a bare webview.** CanvasHost reparents the existing tao view controller to keep native dialog presentation valid (`OPShell.swift:3550-3563`). The WKWebView, IPC handlers, loaded page, pinch arbitration and dialog ancestry must survive adaptation.
10. **Respect keyboard and zoom ownership.** The app locks WebKit's own zoom and uses a custom pinch that preserves its last two-finger focal point (`3482-3487`, `3586-3614`). Safe-area changes must not revive double keyboard avoidance, second pinch scaling, or overwrite manual zoom on rotation.
11. **Surface existing save failures.** `DocumentSaveWarning` precedes the editor when persistence fails (`5920-5922`). New outline/detail components must retain it in the active editing context.

## Scope and compiler constraints

The current project compiles all maintained Swift from `../../ios` through project.yml (`53-58`). If new Swift files are added, follow the maintained generator ownership workflow and verify source membership in the committed Xcode project; do not introduce an unreferenced file that only local regeneration happens to compile.

The view builder already has a documented Xcode 26 compiler-inference budget problem. Preserve extracted toolbar and generation-notes binding/content/callback helpers (`OPShell.swift:4096-4120`, `4331-4333`). Use small concrete subviews/helpers, not a bigger monolithic Form body or AnyView erasure to hide compiler problems.

The root research agents are checking current Duo documentation and API availability. Any Duo-specific behavior/API should be treated as that research's responsibility, not inferred from these source observations. CI currently uses Xcode 26.6; a runtime `if #available` cannot make an unknown iOS 27 SDK type compile under that compiler. Either preserve a compile-safe baseline or deliberately update the supported build toolchain with corresponding validation.

## Meaningful verification targets

- Existing `test/iosEditorParity.test.js`: grouping/order, standard/custom/tools parity, same-destination no-op, canonical rename, style isolation, signatures, undo and stale revision rejection.
- Existing `test/iosShell.test.js`: command dispatch and native projection/dirty-state behavior.
- Existing `test/swiftContract.test.js`: the actual Swift decoder for any changed projection/schema. A pure layout refactor needs runtime UI validation rather than tests asserting source strings.
- Existing `test/zoomControls.test.js` plus browser/runtime geometry checks: usable width after asymmetric insets, resize/orientation handling, fitting only previously fitted canvas, and preservation of manual zoom.
- UI acceptance: opening Edit Resume shows a compact comprehensible outline; choosing Summary shows one heading and the content; placement/type/delete are secondary; no regression in entry/list add/delete/reorder/restore/group controls; focused text/caret survives snapshot refresh; keyboard completion commits once; deletion or remote replacement of the selected section exits safely.
- Adaptive acceptance: compact portrait, landscape, Duo's actual window/usable regions, a wide/unfolded presentation if available, and large accessibility Dynamic Type. Verify actual bounds and minimum target sizes, not just screenshot resemblance. Ensure PDF export/share and AI Review/Apply still present correctly after changing shell/chrome geometry.
- Validate light/dark mode, Reduce Transparency/contrast settings, VoiceOver labels/order and accessible reorder actions.

## Audit result

The main quality problem is structural: the screen presents a desktop-like section-management form as the primary writing flow. The main adaptive risk is parallel geometry ownership: an edge-to-edge native canvas, a custom fixed bottom overlay, and CSS reservations that only account for vertical safe areas. Improving spacing alone cannot fully resolve either issue. A compact outline/focused editor plus one measured/adaptive chrome geometry policy addresses both while preserving the shared store and established safety contracts.
