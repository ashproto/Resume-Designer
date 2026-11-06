# Owner-only PR TestFlight Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Implement and locally verify owner-requested Xcode Cloud PR previews without publishing or changing account settings.

**Architecture:** Trusted main code authorizes an owner command and durably binds it to the current PR head before entering the app-wide queue. A shared controller dispatches an immutable preview tag, reconciles earlier uploads, and verifies internal TestFlight delivery. Candidate build inputs are compared as Git data, with no candidate execution in credential-bearing GitHub jobs.

**Tech Stack:** Node 24 built-ins and node:test, GitHub Actions, Bash, existing Xcode Cloud/ASC APIs and unsigned iOS CI helpers.

**Spec:** `docs/superpowers/specs/2026-11-06-pr-testflight-design.md`

## Publishing follow-up

Local implementation and review are complete. On 2026-11-06 the owner authorized proceeding with the bootstrap PR and activation steps. The local-only constraints below record the original implementation phase; publishing follows the separately authorized rollout, preserving unrelated editor changes.

## Global Constraints

- Local implementation/testing only: no commits, branches, pushes, PRs, comments, account changes or Cloud starts.
- Preserve existing uncommitted editor source/tests/docs. Current branch remains unchanged.
- Base release edits on `origin/main` at `dd1ca63c1a3992ec50a8846c509b1551fa450415`; four release files differ from old local HEAD.
- Fixed repository `ashproto/Resume-Designer`, ID `1163653093`; owner user ID `35086581`.
- Main-only controller and environment; same-repository open PRs to protected main/next; required successful upstream PR CI.
- Existing production gates, Apple product numbering and desktop release behavior remain intact.
- No dependencies, candidate execution/caches/artifacts in credential-bearing jobs, secret exports or broad PAT.
- Use red/green tests for behavior. Retain full output in this plan's ignored workspace. Leave all changes uncommitted.

## Review Focus

- Full workflow reruns must retain the original comment binding after a new push; test authorization and binding together.
- Configuration additions, modes and non-regular Git objects must not evade the guard; use real temporary Git trees as well as unit fixtures.
- An Actions timeout can leave Cloud uploading; test unfinished cross-workflow runs and reservations with ambiguous outcomes.
- Preview mode/audience/configuration must not weaken protected-branch production release checks; retain existing regression suites.
- Public metadata and feedback failures must not become shell execution, new build authorization or a false availability claim.

---

### Task 1: Trusted request authorization and immutable binding

**Files:** Create `tools/ios-pr-request.mjs`, `tools/ios-pr-request.test.mjs`.

**Interfaces:**
- `authorizePreview({eventName,event,ref,triggeringActor,mode,pilotPr,pilotSha,gh,expectedSha,recovery})` returns `{skip,reason?,prNumber?,commentId?,sha?,ciRunId?,requestTag?,tag?}`. `gh.request(path,options)` is the existing API adapter.
- `bindPreviewRequest(input,{gh})` creates/reads the deterministic request tag and returns the original SHA binding; never mutates an existing ref.
- `recheckPreview(input,options)` repeats live owner/comment/PR/CI checks for a frozen request; for `purpose:'monitor'` allow closed/advanced PRs but require owner and binding identity. Start checks obey mode and current head.

- [x] Write tests for public/non-owner/rerun actors, exact new commands, fresh API identity, forks, base/PR state, CI provenance/jobs, off/pilot/enabled, edited/deleted commands, head changes and existing binding.
- [x] Run `node --test tools/ios-pr-request.test.mjs`; observe missing-module/behavior failures.
- [x] Implement read-only authorization, bounded pagination, strict identity/number/SHA parsing, safe reasons and request binding/rechecks. No shell/network CLI entrypoints or Apple credentials.
- [x] Run that suite green; self-review bypass/error cases and record results.

### Task 2: Candidate build-input guard

**Files:** Create `tools/ios-pr-build-inputs.mjs`, `tools/ios-pr-build-inputs.test.mjs`.

**Interfaces:**
- `compareBuildInputs(candidateEntries,trustedEntries)` takes `{path,mode,type,object}` arrays; throws on unsafe protected changes, otherwise returns normally.
- `assertPreviewBuildInputs({candidateSha,trustedSha,cwd})` reads complete Git trees using fixed execFile arguments and invokes the comparison; never checks out or executes candidate code.

- [x] Write tests for ordinary Swift/JS/CSS changes versus manifests/hooks/project/config changes, added ancestor/alternate configs, symlinks/submodules, modes and tracked tool/output trees; include real temporary Git objects.
- [x] Run `node --test tools/ios-pr-build-inputs.test.mjs` red.
- [x] Implement protected family classification and complete tree-entry comparison; allow current editor sources while documenting candidate-code trust limitations.
- [x] Run the suite green; review all recognized config families and bootstrap paths.

### Task 3: App-wide ordering and durable outcome journal

**Files:** Create `tools/ios-cloud-order.mjs`, `tools/ios-cloud-order.test.mjs`.

**Interfaces:**
- `assertCloudOrdering({gh,asc,repository,appId,workflowIds,currentTag})` verifies prior dispatch reservations/runs/uploads across the two managed workflows before a new POST. Matching-ref and run/build collections are paginated. Ignore request-binding refs.
- `recordReservationState({gh,repository,sha,tag,state,runUrl})` records bounded controller states (`reserved`, `post-attempted`, `not-started`, `rejected`, `delivered`) as commit statuses with a stable SHA256-derived context, tied to the trusted Actions run URL.
- Journal reads accept only expected GitHub Actions creator plus verified main controller workflow run provenance; absence of a run/status never proves no POST.

- [x] Write tests for active prior Cloud runs, finished but processing uploads, wrong app/tag/source, unknown no-run reservations, known no-start/rejection outcomes, forged journal provenance and safe current-request recovery.
- [x] Run `node --test tools/ios-cloud-order.test.mjs` red.
- [x] Implement fail-closed ordering and journal helpers using API adapters only. Definitive prior no-start/rejection is the only unused-reservation closure; no generic force-clear.
- [x] Run green and document how no-ID recovery remains conservative.

### Task 4: Shared Cloud dispatch and preview orchestration

**Files:** Modify current `tools/ios-cloud-release.mjs`, `tools/ios-cloud-release.test.mjs`; create `tools/ios-pr-testflight.mjs`, `tools/ios-pr-testflight.test.mjs`.

**Interfaces:**
- Existing `release(input,options)` keeps production defaults, accepts `kind:'preview'`, PR/comment identity and internal-only audience, and explicit trusted `authorizeSource`/`beforeStart`/journal hooks for preview use. A preview cannot dispatch without these checks.
- `tools/ios-pr-testflight.mjs` is the trusted workflow entrypoint for `authorize`, `bind`, `release`, `recover`, and `feedback`, using event JSON/env rather than shell-interpolated metadata. Release/recovery integrate Tasks 1–3 and the build guard.
- Shared production CLI integrates ordering/journaling only when both managed workflow IDs are configured; enabling preview requires coordinated config in both lanes.

- [x] Bring the four unchanged release files forward from the verified main ref without touching Git refs or editor files; run existing release tests as baseline.
- [x] Write red tests for preview validation/audience, callback absence, advancement before POST/discovery, controller hooks/journal timing, duplicate POST prevention and production default regressions.
- [x] Implement shared dispatch hooks with exact final checks; request-binding recovery never reserves or starts a new Cloud build.
- [x] Add tested bot feedback formatting/upsert, safe workflow outputs and What to Test metadata without exposing credentials or executing candidate input.
- [x] Run `node --test tools/ios-*.test.mjs` green; review failure/recovery paths.

### Task 5: Workflow, Cloud hook and activation runbook

**Files:** Create `.github/workflows/ios-testflight-pr.yml`; modify `.github/workflows/ios-testflight.yml`, `resume-designer/scripts/ios-ci-env.sh`, `resume-designer/scripts/ios-ci.test.mjs`, `docs/ios/testflight-automation.md`; add meaningful workflow-boundary tests in `tools/ios-pr-testflight.test.mjs`.

**Interfaces:**
- New workflow separates cheap authorization, no-secret binding, protected queued release/recovery and no-Apple feedback. Checkout event main SHA, disable persisted credentials, fixed pinned Actions and no installs/caches/artifact restore.
- Mode `IOS_PR_TESTFLIGHT_MODE` is `off` by default, `pilot` restricted by configured PR/SHA, then `enabled`. New trusted IDs: `XCODE_CLOUD_PR_WORKFLOW_ID`, `APP_STORE_CONNECT_DEV_GROUP_ID`; existing release IDs remain production configuration.
- Both release jobs share literal concurrency group `ios-testflight-com-onpaper-app`, `queue:max`, no cancellation. Apple environment stays main-only.
- Cloud hook accepts strict `ios-testflight/pr/<PR>/<comment>/<sha>` only when SHA equals `CI_COMMIT`, no native PR run; existing main/next forms remain valid.

- [x] Write/observe red tests for valid/invalid preview tags, request-binding tag rejection, mismatched SHA and PR environment, and workflow privilege/command boundaries.
- [x] Implement hook/workflows and document exact setup, historical live release evidence, mode/pilot, tag protections, recipients, CloudKit scope and no-ID recovery limits.
- [x] Run automation/helper suites, actionlint (only documented old `queue` diagnostic excluded if necessary), shellcheck and whitespace checks.

### Task 6: Integrated local validation and independent review

**Files:** Plan/spec status and ignored evidence ledger; only fix implementation files when a concrete review finding requires it.

- [x] Run all `node --test tools/*.test.mjs resume-designer/scripts/ios-*.test.mjs`, app test suite/build/lint as appropriate, and native unsigned validation for the changed hook.
- [x] Independently review implemented auth, tree guards, journal/order/recovery and workflow privilege boundaries against the approved spec; fix material findings with reproducing red/green tests.
- [x] Confirm editor file hashes remain unchanged, Git branch/refs unchanged, no external writes occurred. Record commands/results and deployed/account/physical-device limitations separately.
- [x] Report completed local implementation and concrete remaining bootstrap/account/pilot actions for final publishing authorization. Do not commit or deploy.
