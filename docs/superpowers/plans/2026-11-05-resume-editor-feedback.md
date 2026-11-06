# Resume Editor Feedback Implementation Plan

> **For agentic workers:** Use the subagent-driven-development workflow for the independent domains below. Preserve concurrent edits and leave all work uncommitted.

**Goal:** Connect generation feedback to reliable conversational edits and provide unified section and header controls.

**Architecture:** Preserve existing resume fields. Add document-local presentation metadata and durable generation review context. Use one structured chat request for conversational replies and reviewed edits.

**Tech Stack:** React 19, JavaScript, Tauri frontend, Vitest, existing shadcn primitives.

**Spec:** `docs/superpowers/specs/2026-11-05-resume-editor-feedback-design.md`

## Global Constraints

- No Git mutations, release work, new dependencies, or native packaging changes.
- Preserve existing storage keys, resume content paths, undo, and safe editable links.
- User-facing AI changes remain reviewable before applying.

## Review Focus

- Short follow-up messages must retain user and assistant context.
- One changed array element must not create unchanged review entries.
- Cancelling or failing a revision must retain the usable draft.
- Legacy documents and scalar custom sections must keep working.
- Empty contact fields and section groups must not create spurious output.

## Tasks

- [x] Assistant: reproduce missing history and identical diffs; add request and component regressions; implement a structured conversational reply/change protocol; run focused tests.
- [x] Generation: preserve review context, support ready-screen correction, open editor directly, add verbosity independently of page count; test revision/handoff/options.
- [x] Sections: add compatible ordering/group/style helpers, unify cards and collapse controls, render presentation consistently; test legacy defaults, movement, grouping, typography and undo.
- [x] Header: add saved contact line breaks, expose controls, render rows without stray separators; test all layouts, empty fields, inline links and undo.
- [x] Integration: independently review touched code, resolve findings, and run full frontend tests, production build, and source lint.
- [x] Interactive visual and native verification: completed in the [runtime follow-up](2026-11-05-editor-refinement-ios.md#runtime-follow-up-requested-by-the-user). iOS used synthetic responses; Mac Review/Apply used one live AI request in a synthetic workspace.

## Final verification

- `npm test -- --reporter=dot`: 148 files, 2,357 tests passed.
- `npm run build`: passed; existing bundler chunk/dynamic-import warnings remain.
- `npm run lint -- --ignore-pattern 'release/**'`: zero errors, two existing warnings.
- Unrestricted `npm run lint` also scans existing generated files under `release/local-2026-11-05-compatibility-guidance/` and fails on those unrelated artifacts. Release files and lint configuration were left unchanged.
- Independent review: all accepted findings resolved, including settings-only revision, legacy section identities, immediate font selection, and typography propagation.
- No Git operations were performed.

## PR follow-up

The user subsequently authorized a new branch, commits, push, a PR targeting `next`, and a Codex review loop. That authorization supersedes the earlier no-Git constraint for this handoff. Existing user-owned Xcode project/plist edits and local release artifacts remain outside the PR.
