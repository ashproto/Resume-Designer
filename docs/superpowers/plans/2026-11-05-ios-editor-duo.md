# Focused iOS Editor and Duo Implementation Plan

> **For agentic workers:** Use subagent-driven implementation for the independent editor and shell boundaries, then an independent integration review. The November 5 implementation phase required leaving all work uncommitted. The owner later authorized a separate feature PR and controlled TestFlight pilot after the infrastructure bootstrap.

**Goal:** Deliver focused native resume editing and usable Duo-aware app chrome.

**Architecture:** Keep the shared JS store and existing native command protocol. Refactor native screen composition into outline/detail and contextual options. Use native toolbar adaptation and an explicit measured native-to-WebKit canvas inset contract.

**Tech Stack:** SwiftUI/UIKit/WKWebView, existing Tauri bridge, JavaScript/CSS, Vitest, Xcode27.2 simulator tools.

**Spec:** `docs/superpowers/specs/2026-11-05-ios-editor-duo-design.md`

## Global Constraints

- Original local implementation constraints: no Git mutations, new dependencies, release publishing or edits to the original generated Xcode project/plist. Later publication follows the separate owner authorization above.
- Preserve existing storage keys, content paths, revision/signature guards, undo and native Review/Apply.
- Preserve existing iOS26 deployment floor and Xcode26.6 source compatibility; validate Duo builds with Xcode27.2.

## Review Focus

- Selected legacy sections receiving IDs or disappearing during editing must not redirect edits.
- Native focus/edit holders and drafts must survive ordinary snapshot/size changes and release on dismissal.
- Asymmetric safe areas must have one owner; keyboard avoidance must not be counted twice.
- Manual zoom must survive adaptation, while fitted views refit their measured usable bounds.
- Long text, large Dynamic Type, narrow widths and toolbar overflow must keep actions reachable.

## Tasks

### 1. Focused native editor

**Files:** `resume-designer/src-tauri/ios/OPShell.swift` editor block only (`NativeSectionCard` through `StructureSheet`); existing native parity/Swift tests as warranted.

**Interface:** Consume current `ShellSnapshot.DocumentOutline` and existing `ShellModel.send` commands. Produce outline/detail navigation and contextual section options without changing snapshot schema unless coordinated.

- [x] Replace expanded administration cards with succinct outline rows and stable selected-section resolution.
- [x] Render focused content and contextual placement/appearance controls; preserve Header, Add/Restore/Group and safe list operations.
- [x] Make arrangement explicit and provide gesture alternatives; retain draft/focus/workspace/revision handling.
- [x] Parse Swift, run relevant contracts, and verify actual UI after integration; add behavioral tests only for changed behavior.

### 2. Native chrome and measured canvas geometry

**Files:** `OPShell.swift` shell/CanvasHost blocks only, `src/iosShell.js`, `styles/native-shell.css`, and focused geometry tests.

**Interface:** Existing native toolbar actions remain routed through the shared model. A measured per-edge viewport/inset update feeds the active native canvas only; it never changes resume data or desktop/PDF behavior.

- [x] Reproduce asymmetric-inset/fit behavior with a failing regression at the JS geometry boundary.
- [x] Replace fixed custom action overlay with labeled native toolbar actions and contextual Zoom controls.
- [x] Supply real per-edge usable geometry and remove fixed vertical reservation/double inset assumptions.
- [x] Verify manual zoom, resize/fit, modal and keyboard behavior; run focused tests and Swift parsing.

### 3. Simulator build and validation

**Files:** Isolated build stage and local ignored QA evidence; original Xcode project files remain unchanged.

- [x] Capture baseline app UI/inset evidence on an available Duo runtime using synthetic data.
- [x] Refresh staged source/assets, compile the actual simulator app and run it on Duo and a conventional iPhone.
- [x] Exercise focused editing, options, arrangement, typography, keyboard, zoom, share and native Review; preserve model/command operations with shared tests and source review.
- [x] Record screenshots and precise validation limits; fix observed defects and repeat affected checks.
- [ ] Extended validation remains outside this local preview handoff: actual Duo Open/fold and physical-device behavior, older OS/Xcode 26.6, accessibility/appearance matrix and exhaustive native gestures for contact/undo/group operations. See the runtime report for exact coverage; these are not claimed passed.

### 4. Integration review and handoff

- [x] Independently review all changed boundaries for state/identity and geometry regressions; resolve accepted findings.
- [x] Run full shared-app tests, production build, source lint and relevant Swift contracts.
- [x] Update the research/design status with implementation and runtime evidence, and provide the local runnable build/evidence paths.

Final local source: OPShell.swift SHA-256 `366c123bd610713532eab245e060e1a3a9a0df638065eda46c5c3d919ecabf69`. The [runtime report](../../research/2026-11-05-ios-editor-duo/runtime-validation.md) and ignored local build package record core passes and explicit limits. At that November 5 checkpoint, work remained uncommitted and no release or provisioning actions had been performed. The later TestFlight pilot is reported separately.
