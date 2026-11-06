# Owner-requested PR TestFlight builds

Date: 2026-11-06. Status: implementation verified; bootstrap publication and rollout authorized on 2026-11-06.

## Intent and decisions

Allow Ash to comment `/testflight-dev` on an open On Paper PR and install that
PR's exact revision through internal TestFlight after required PR CI, before merging the
application change. The repository is public; another person's comment must
never authorize an Apple build or gain access to release credentials.

The user selected **Xcode Cloud with an owner-only command and same-repository
PRs**. Reuse Apple's managed signing and On Paper's existing release controller.
The policies below were approved as engineering defaults in the design.

### Approaches considered

| Approach | Tradeoff | Decision |
| --- | --- | --- |
| HyperBuild-style trusted controller and Xcode Cloud archive | Reuses managed signing and Cloud build numbering. Candidate compilation still runs in Cloud's signing/build pipeline and therefore requires trust in the exact candidate. | Selected, with tighter public-repository authorization, freshness and recovery controls. |
| Olia-style unsigned candidate archive and separate trusted signer | Better separates candidate compilation from signing/upload credentials. Requires trusted archive validation, managed distribution/provisioning access and coordination with the existing Cloud number stream. | Deferred; reconsider for fork previews or routine build-system/dependency previews. |

## Evidence and current state

Research inspected the local HyperBuild checkout at
`/Users/ashshah/HyperBuild/Projects/HyperBuild` and Olia Kitchen checkout at
`/Users/ashshah/HyperBuild/Projects/HyperBite-iOS`. Their relevant workflows match
their cached `origin/main` refs; their live account settings were not inspected.

- Both recognize a new `/testflight-dev` PR comment, query current collaborator
  permissions and reject fork PRs. Both currently allow write-capable
  collaborators; On Paper's selected policy is narrower.
- HyperBuild uses Cloud-managed signing and checks native build/signing inputs
  against trusted main. Its immutable tags do not themselves prevent repeated
  dispatches; On Paper already has stronger reservation/run recovery.
- Olia compiles without signing credentials, then executes main's signer in a
  separate protected job. It uses managed signing through an ASC API key rather
  than a stored distribution `.p12`.

Current On Paper release code is taken from `origin/main` at
`dd1ca63c1a3992ec50a8846c509b1551fa450415`, including PR157's recovery fixes.
The current worktree is based on older `c9df2c3`; do not build the implementation
from its stale release-controller files or overwrite its uncommitted UI work.

Live GitHub read-only checks confirmed:

- Public repository `ashproto/Resume-Designer`, numeric ID `1163653093`, default
  branch `main`; owner `ashproto`, numeric user ID `35086581`.
- Actions tokens default to read; Actions cannot approve PRs.
- Environment `ios-testflight` permits **only main** workflows.
- Active TestFlight tag ruleset prevents updates/deletions without bypasses, but
  currently covers only `ios-testflight/main/*` and `ios-testflight/next/*`.

The existing release lane is operational: GitHub run
[42160990194](https://github.com/ashproto/Resume-Designer/actions/runs/42160990194)
reported build 6 available to its internal TestFlight group. September setup
notes saying a first pilot is outstanding are historical. Current Cloud Xcode
version, preview recipients and new Dev workflow do require account verification.

## Scope and boundaries

Add a separate PR-comment workflow and authorization policy. Preserve the
protected main/next push-CI release gates and desktop release behavior. Coordinate
all iOS lanes for this app to avoid conflicting uploads.

Initial preview eligibility:

- New PR comments whose entire trimmed body is exactly `/testflight-dev`; no
  arguments, edited-comment triggers, labels or automatic rebuilds.
- Only the fixed owner user ID may request or rerun a build. Re-fetch the user,
  repository and current collaborator permission; require current admin access.
  Do not authorize from `author_association`, display name or event text alone.
- Open PR, including drafts, targeting protected `next` or `main` in this fixed
  repository. The head repository ID must equal the upstream repository ID.
  Fork PRs are refused even when the owner comments.
- Required CI is already successful for the captured PR revision. If CI is
  pending or fails, explain that a fresh command is needed after it passes;
  a comment is not a standing permission for a later revision.

No external tester invitations, App Store submission, separate bundle ID,
backend/data sandbox, new broad PAT, signing-key export, or fork support.
The preview uses `com.onpaper.app` and `iCloud.com.onpaper.app`, including
production CloudKit/APNs for a distribution build. A Dev tester group does not
isolate the user's stored data or create a second independently installed app.

## Trusted workflow and request identity

Use `issue_comment: types: [created]`, on default main. Explicitly check out the
event's trusted main SHA with `persist-credentials: false`; pin third-party
Actions to full SHAs. Repository/owner checks must precede privileged work.

1. A cheap, read-only authorization job ignores unrelated comments and rejects
   non-owners before the app-wide release queue or Apple environment is entered.
   Re-fetch the comment and PR, require matching repository/PR/author identity,
   reject deleted or edited commands, and freeze the current full PR head SHA.
   An initial comment means the head at this first authorized resolution; no
   claim is made that the webhook contains a historical head at comment time.
2. Bind the request durably before queueing. A deterministic lightweight tag
   `ios-testflight/request/pr-<number>/comment-<id>` points to the captured SHA.
   Creation uses a separate trusted, no-Apple-credentials job. A full workflow
   rerun must consult this original binding rather than approve today's head.
   Existing tags must be commit refs to exactly the expected SHA. Never move or
   delete them. A failed/ambiguous creation is read back and validated.
3. The secret-bearing release job reads the binding and creates a separate
   Cloud dispatch reservation tag:
   `ios-testflight/pr/<number>/<comment-id>/<full-sha>`.
   Keeping request binding separate from dispatch reservation preserves the
   current controller's one-creator-only start authorization.
4. Revalidate owner permission, rerun actor, unchanged command, open PR, base,
   same-repository head and exact source SHA after queueing and during tag
   discovery. The final awaited authorization check immediately before a new
   Cloud POST must confirm that the PR still names the captured SHA. A newer
   push makes an unstarted request stale; require a new comment. An already
   started run can still be monitored by its original SHA/run ID.

Extend the active immutable tag ruleset to both new namespaces before enabling
the feature. Manual Cloud tag filters allow dispatch tags, never request-binding
tags. Keep all Cloud automatic start conditions disabled.

The authorization job has only read permissions. Request binding and Cloud
dispatch receive `contents: write` only where tags are created; this token scope
is repository-wide, so trusted code must restrict every created ref to the
defined namespaces. A separate trusted feedback job may receive issue-comment
write permission. Do not expose Apple credentials to binding/feedback jobs.

## Candidate validation and Cloud trust

Verify CI through current GitHub API state: upstream CI workflow ID/path,
pull-request event, association with this PR, exact source head, successful
completed run and exactly one successful `checks`, `rust-check`, and `ios-native`
job. Account explicitly for GitHub's PR head versus synthetic merge SHA: validate
the run's head and PR metadata together, never borrow checks from another SHA.
The engineering default is to accept the existing PR CI, which tests GitHub's
synthetic merge with the target branch; this is not a claim that all tests ran
on the untouched head tree. Cloud must archive the pinned head itself. Do not
silently substitute the synthetic merge as the requested source or describe
its CI as an additional exact-head test run.
Paginate API collections and fail closed on ambiguous results. A named green
check alone is insufficient proof; candidate CI/build definitions must also pass
the trusted-input comparison below.

Compare complete candidate Git tree entries against the pinned trusted-main
revision used by the dispatcher. Compare path sets, modes, object types and
content, including additions/deletions, so new config files, symlinks, submodules
or prepopulated build-output/tool directories cannot bypass the guard.

Initial protected build-input families:

- `.github/**`, relevant `tools/ios-*.mjs`, and app `scripts/**`.
- npm manifests/lockfiles, npm/package-manager/workspace configuration and
  recognized install/build/transpiler configuration, including additions in
  ancestor directories. Vite/PostCSS config variants must be covered.
- Cargo manifests/locks, build scripts, toolchain/workspace/Cargo configuration,
  including ancestor configuration and additions.
- Tauri config variants, capabilities/permissions, Info plist and entitlements.
- The complete `resume-designer/src-tauri/gen/apple/**` tree, including Xcode
  projects, schemes, workspace settings, Cloud hooks, export and signing inputs.
- Reject candidate-tracked dependency/tool/output trees that could change clean
  bootstrap behavior or hide required dependency installation.

Do not freeze all `src-tauri/ios/**`: the current editor change to `OPShell.swift`
is ordinary application source and must remain previewable. The current Duo UI
diff changes application Swift/JS/CSS, tests and docs, and is compatible once its
branch incorporates the trusted bootstrap.

These comparisons are defense in depth, **not a sandbox for candidate build
code**. Cloud executes the candidate's frontend/native compilation. Even CSS
can load build-time JavaScript through Tailwind directives. Owner authorization
therefore means the owner trusts that exact candidate, including source and
dependencies, for signing/distribution. No override may bypass this policy.
Build-system/dependency changes must first use the trusted infrastructure path.
Supporting untrusted candidates requires revisiting the Olia architecture.

The Apple API key stays in the existing main-only `ios-testflight` environment.
The secret-bearing GitHub controller must never check out or execute candidate
code, install its dependencies, restore its caches, or execute its artifacts.
It can inspect Git objects as data using safe fixed arguments. This protects
GitHub-held secrets without claiming that candidate execution inside Cloud is
removed or that Apple's managed signing/SCM private keys are exposed there.

## Cloud configuration, recipients and numbering

Create an **On Paper – PR TestFlight** workflow under the existing Cloud product
and app. Use the committed project/shared scheme, release configuration, managed
signing and a shipping SDK supporting Duo (at least Xcode 27.1, preferably 27.2).
Configure manual preview tags only, an **internal-only** archive audience, and
the intended **On Paper Dev** internal group. Leave production's audience and
protected-branch gates intact. Store preview workflow/group IDs as fixed trusted
environment configuration; comments cannot choose them or a different app.

Generalize shared controller primitives so preview expects `INTERNAL_ONLY` while
the current release expects `APP_STORE_ELIGIBLE`. Verify workflow/product/app,
actual run source SHA/tag, actual uploaded app/audience, Apple processing state,
build number and intended group membership before reporting success.

Before activation, inspect Cloud recipients in its UI: only On Paper Dev for
previews, no external recipients. Check all app beta groups for automatic
all-build access; refuse preview activation if an unintended group would receive
these uploads. The public workflow API does not reveal native post-action
recipients; API membership checks after upload cannot undo an earlier delivery.
Do not invite new testers automatically or silently change existing recipients.

Retain Apple's `CI_BUILD_NUMBER` as the single numbering authority for preview,
next and main. Do not add a timestamp allocator or reset the product counter.
Verify the new workflow shares that product's counter and starts above prior
uploads during the pilot.

Use one literal app-wide GitHub concurrency group shared across both workflows,
with queueing and `cancel-in-progress: false`, covering dispatch through
processing/availability monitoring. Authorization stays outside that queue.
A lost/timed-out Actions monitor does not stop Cloud: before every new start,
reconcile pending/running or unresolved earlier Cloud runs across both managed
workflows and their upload states. Fail closed and require recovery if an older
upload might still complete out of order. The GitHub concurrency lock alone
does not protect against a Cloud run continuing after its Actions job exits.

## Idempotency, recovery and feedback

Preserve the existing immutable reservation protocol: only a controller that
unambiguously created a fresh dispatch reservation can send one start POST.
An existing reservation authorizes reconciliation/monitoring only. Retain both
tags after success, failure, staleness and timeout. Never blindly retry an
ambiguous Apple POST. Use the recorded exact tag/SHA/Cloud run to resume.

Rerunning jobs for the same comment cannot bind a new revision or allocate a
second build. A deliberate new owner comment is a new request and can rebuild
the same SHA, subject to all gates and upload ordering. Recovery may monitor a
started run after PR advancement/closure without authorizing another start.
Provide a main-only, owner-checked recovery entry for original request identity
and run ID when rerunning failed jobs is insufficient.

Recovery also accepts an original request/reservation tag **without a run ID**.
It scans the configured Cloud workflows for that exact immutable source,
recovers a matching run when it appears, and otherwise reports the unresolved
reservation without sending a POST. A list returning no match is not proof that
an ambiguous request was rejected. To close an unused reservation for app-wide
ordering, require an explicit owner reconciliation with evidence of a definitive
pre-POST failure or a definitive Apple rejection; retain an auditable record
bound to the original trusted workflow run, reservation and SHA. A confirmed
terminal/cancelled Cloud run can likewise be reconciled with its upload state.
Do not implement a general force-clear or a timeout-based release of uncertainty.
If acceptance remains genuinely unknown, the app stays blocked pending Apple's
authoritative confirmation or a discoverable run. This conservative failure mode
is intentional; leave all tags in place and never restart the ambiguous request.

For an accepted request, post/update one bot comment keyed by original comment
ID, with PR/SHA, Actions URL and state: queued, stale/refused, submitted,
processing, available or failed/unconfirmed. Include Cloud run ID and actual
build number once known. Escape untrusted metadata and never interpolate comment
text or branch names into shell code. Ordinary public comments get no bot reply
or privileged job. Report availability only after Apple/group verification;
monitor failure must clearly distinguish an unknown outcome from a failed build.
Use the same metadata for What to Test notes where supported and verified.

## Bootstrap and implementation boundaries

1. Prepare the trusted workflow/controller/hook/guard/test changes from current
   next/main release code, preserving the existing uncommitted Duo UI work.
2. Review and land the infrastructure through normal next → main flow. GitHub
   only discovers a comment workflow after it exists on default main. Do not
   merge application changes merely to activate preview infrastructure.
3. Configure the Dev workflow/group, trusted environment IDs and expanded tag
   protection. Use a repository mode variable with `off` (default), `pilot` and
   `enabled` states. `off` forbids all new preview starts while still allowing
   read/recovery of existing requests. `pilot` additionally requires a configured
   exact PR number and full head SHA; all owner/CI/guard checks still apply.
   Only `enabled` permits the normal set of eligible owner requests. Existing
   production automation remains independently controlled.
4. Incorporate updated main into the feature branch with a normal history-
   preserving merge. The feature SHA must contain the new Cloud tag hook:
   today's hook accepts only main/next release tags. Never overlay trusted main
   files onto a different candidate and claim to build the untouched PR SHA.
5. With authorized Git/account actions, set `pilot` for one reviewed PR/SHA and
   run its owner-comment pilot. Verify the exact build reaches On Paper Dev and
   install it on the physical Duo. Set mode to `enabled` only after delivery is
   confirmed; simulator/local archive success is not proof of TestFlight delivery.

The initial implementation was explicitly local-only. After its tests and independent review passed, the owner authorized proceeding with the bootstrap publication and activation steps on 2026-11-06. Preserve regular merge history, keep the unrelated editor changes separate, and keep previews off until account protections are verified. Physical Duo confirmation remains a requirement before general activation.

## Verification and handoff

Tests should exercise security behavior, not just mirror YAML structure:

- Owner versus public/write-collaborator comments, changed/deleted commands,
  fork/wrong-base/closed PRs and non-owner rerun actors.
- Exact source and CI provenance; pending/failed/mismatched/duplicate jobs and
  candidate CI/build-input edits, including added config/symlink bypasses.
- Advancement before queue entry, during discovery and immediately before POST;
  rerunning all jobs retains the original comment/SHA binding.
- Request/reservation creation ambiguity, existing reservations, duplicate
  events/comments/reruns, recovery after timeout and no duplicate Cloud POST.
- Preview versus production app/workflow/audience/group mismatches, processing
  failures, number mismatches and unfinished prior uploads across lanes.
- Existing main/next release gate/recovery regressions remain passing.

Run release-tool/helper tests, applicable workflow lint and shell checks. The
bootstrap hook change needs the existing native unsigned archive/CI validation.
Document hosted CI, account configuration, Cloud pilot, group availability and
physical installation as separate evidence. Do not claim local tests prove the
privileged workflow is deployed or TestFlight is available.

Builder may choose helper/module factoring, test fixtures, narrow file patterns
covering the defined protected families, feedback formatting and bounded polling
details. Do not weaken exact-SHA/owner-only/immutable/recovery policies to simplify
implementation. Update the existing runbook's historical activation state using
verified evidence and document command/refusal/recovery behavior.

## Primary guidance

- [GitHub issue-comment event and default-branch behavior](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows).
- [GitHub privileged workflow risks, including issue_comment](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target).
- [Apple Xcode Cloud security](https://developer.apple.com/xcode-cloud/security/).
- [Apple custom build scripts](https://developer.apple.com/documentation/xcode/writing-custom-build-scripts).
- [Apple Cloud environment variables](https://developer.apple.com/documentation/xcode/environment-variable-reference).
- [Tailwind compatibility directives that load build-time modules](https://tailwindcss.com/docs/functions-and-directives#compatibility).
