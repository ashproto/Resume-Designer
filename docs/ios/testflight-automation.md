# iOS CI and TestFlight delivery

The iOS lane builds the complete Swift/Rust/web app. Public pull requests run
without release credentials on GitHub-hosted runners. Reviewed commits on
protected `next` and `main` can be archived and signed by Xcode Cloud, then sent
to the configured internal TestFlight group. App Store submission is separate.

## Current activation state

As of **2026-11-06**, the protected-branch release lane is operational and
`IOS_TESTFLIGHT_AUTOMATION_ENABLED=true`. Verified GitHub run
[42160990194](https://github.com/ashproto/Resume-Designer/actions/runs/42160990194)
delivered source `dd1ca63c1a3992ec50a8846c509b1551fa450415` as internal TestFlight
build **6**. That evidence is for the existing main/next lane, not the new PR
preview workflow below. The PR preview implementation has passed local tests and independent review.
The preview bootstrap reached default main through reviewed regular merge commits in [PR #158](https://github.com/ashproto/Resume-Designer/pull/158), [PR #160](https://github.com/ashproto/Resume-Designer/pull/160) and [PR #159](https://github.com/ashproto/Resume-Designer/pull/159). The controlled pilot uses [UI PR #161](https://github.com/ashproto/Resume-Designer/pull/161); general activation awaits verified delivery and physical Duo confirmation. Check the live repository variables and the original request run for current mode/outcome.

The PR Cloud workflow is saved with clean builds, restricted editing, manual
`ios-testflight/pr/` tags, an internal-only archive and **On Paper Dev** as its
sole TestFlight post-action group. That internal group has automatic all-build
distribution disabled and one owner-authorized existing tester. The existing
production workflow and recipients are unchanged. Both workflow IDs are saved
in the main-only GitHub environment. The shared product counter was verified
as **7**; it was not reset. These are account configuration checks, not proof
of signed preview delivery or physical-device installation.

### Historical account setup checkpoint

The following September checkpoint is retained as history. Its pending-pilot,
counter, toolchain and activation statements are not current account evidence.

As of 2026-09-23, account setup is configured. PR #133 is merged with
`skip-build`; promotion PR #134 is pending review fixes. Promotion to `main`
and the first live pilot remain outstanding. Automatic dispatch is **off**
unless the repository variable `IOS_TESTFLIGHT_AUTOMATION_ENABLED` is exactly
`true`. A successful local archive is not evidence of Cloud signing, upload,
processing, or TestFlight installation. Complete the pilot below before enabling
automatic dispatch.

On 2026-09-22, the GitHub `ios-testflight` environment was created with a
**main-only** deployment branch policy, automatic dispatch was explicitly set to
`false`, and an active tag ruleset was added to prevent updates/deletions of
`ios-testflight/main/*` and `ios-testflight/next/*` (no bypass actors). Existing
branch rulesets were retained, with the passing `ios-native` check added as a
requirement on both `main` and `next`. App Store Connect credentials and the
verified app/group/workflow IDs are now stored in that environment. The existing Apple/CSC
secrets are for desktop releases; this lane does not use them.

The empty Xcode Cloud product was recreated on 2026-09-23 after a fresh
configuration backup and checks confirming zero Cloud runs and uploaded builds.
Apple's API now reports its name as **On Paper**. The app, bundle ID and internal
tester group are unchanged:

| Registration | Verified value |
| --- | --- |
| App Store Connect app | **OnPaper - Career Workspace**, `6815088694` |
| Bundle ID | `com.onpaper.app` |
| Cloud product | **On Paper**, `2987ffd0-f926-472f-b666-a076fdf88fb2` |
| Cloud workflow | **On Paper – TestFlight**, `F77BFDD6-479B-44D2-B772-FFDB25F9D40D` |
| Internal group | **On Paper Internal**, `7d1c1c5e-f6fd-40a1-9339-51b6c255f362` (one tester) |

The replacement workflow restores the previous settings: enabled, restricted
editing, clean builds, the committed project and shared scheme, Xcode
**27 (27A266a)** and macOS **27 (26A428)**. Its only start condition is manual
tags beginning with `ios-testflight/`; no automatic Cloud triggers are enabled.
Its sole action is an App Store eligible iOS archive. The saved TestFlight
post-action selects **only On Paper Internal**, verified in Xcode and a
screenshot. The GitHub environment's `XCODE_CLOUD_WORKFLOW_ID` points to the new
workflow, and repository automatic dispatch remains `false`.

The owner deployed the current `SyncUnit` schema to the production
**`iCloud.com.onpaper.app`** container. The Cloud manifest now contains only the
new **On Paper** product association, retaining its Xcode-generated top-level ID.
No Cloud runs or uploaded builds exist at this checkpoint, and no TestFlight
delivery has completed. Signing, upload, processing, installation and production
device sync still await the pilot; configuration checks do not establish them.

### Historical validation (2026-09-22)

These results cover the release-readiness and automation candidate based on
`next` at `75536fcd`; they are not a validation report for the latest promotion
review fixes or the replacement Cloud registration:

| Gate | Evidence |
| --- | --- |
| App regression suite | 113 files, 1,831 tests passed after review fixes. |
| Release controller/gate/build-helper regressions | 62 tests passed. Includes superseded-commit rejection before dispatch, original-SHA recovery after branch advancement, mistaken-resume isolation, fork/PR rejection, delayed merge metadata, immutable refs, ambiguous dispatch/retry, TestFlight processing/group membership, Cloud tag guards, isolated compiler invocation and SwiftPM compatibility. |
| Static checks | ESLint has zero errors and two existing warnings; shellcheck and `git diff --check` pass. See the documented concurrency queue and actionlint compatibility note below. |
| Native simulator | Full unsigned Debug build passed with Node 24, Rust 1.92.0, Xcode 27/iOS 27 SDK. |
| Native device | Full unsigned Release archive passed with the same toolchain. Bundle verified as `com.onpaper.app`, minimum iOS 26.0, version 1.0.0; bundled privacy manifest present and static library absent from app resources. |
| Hosted CI / Xcode 26.6 | [All three jobs passed](https://github.com/ashproto/Resume-Designer/actions/runs/35797641144) for PR #133 at `fc1b06f8`; subsequent review commits are checked separately on the PR. |
| Cloud signing / upload / TestFlight installation | Not run; account configuration and read-only API preflight passed, and the live pilot remains outstanding. |

Local native outputs and bundle verification are retained under
`/private/tmp/onpaper-ios-ci-validation`; full build log is
`/private/tmp/onpaper-ios-ci-native.log`. The local unsigned build number is
still `1.0.0`; the Cloud pre-build hook applies `CI_BUILD_NUMBER` during the pilot.

## What runs

| Event | Checks and delivery |
| --- | --- |
| Pull request to `next` or `main` | Existing lint, tests, audit and Rust checks; release-tool tests; actual Swift decoder tests; unsigned simulator compilation and device archive. No Apple credentials. |
| Push to `next` or `main` | The same CI checks. A successful run can trigger the separate iOS delivery workflow after automatic dispatch is enabled. |
| Manual `iOS TestFlight` dispatch from `main` | Select `next` or `main`. A new pilot uses its current head and requires successful push CI, including `ios-native`. To resume an existing run, supply both its run ID and original full SHA; that SHA needs passing CI and must still belong to the selected protected branch. |
| App Store submission | A separate, explicit release decision in App Store Connect. The archive is App Store eligible, but this workflow never submits it for review. |

`skip-build` on the exact merged PR suppresses automatic iOS delivery, matching
the desktop convention. Manual dispatch intentionally overrides that label,
while retaining all CI and protected-branch requirements. iOS release tags use
`ios-testflight/<main-or-next>/<full-commit-SHA>`; the desktop `next` tag and
`v*` release tags are not modified.

The dispatcher executes trusted `main` code without installing dependencies or
restoring candidate artifacts/caches. It refreshes the CI run through GitHub's
API, verifies the workflow identity, upstream repository, push event, required
successful jobs, protected branch, and commit ancestry. A passing fork or PR
workflow cannot authorize delivery.

## Release ordering

Delivery holds one app-wide concurrency slot, shared by main, next and PR
previews, from dispatch through Cloud completion and TestFlight monitoring.
Automatic CI events for an older branch
revision are skipped as superseded, even if that revision is still an ancestor.
The controller rechecks the protected branch head immediately before every new
Cloud build request, including after a job waits for its slot or Cloud discovers
its tag. A queued manual pilot also must still target the current head to start
a new build. Already-started builds remain monitorable by their exact tag/run ID.

The concurrency group uses `queue: max`, so a late older job cannot cancel a
newer job that is waiting. GitHub queues by arrival at the concurrency group,
which can differ from commit order; the head checks remain necessary. See
[GitHub concurrency](https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency).
The locally installed actionlint 1.7.12 predates the documented `queue` property.
Validate the remaining workflow with only that specific unsupported-key diagnostic
excluded; do not suppress other concurrency, expression, or shell errors:

```sh
actionlint -ignore '^unexpected key "queue" for "concurrency" section\.' \
  .github/workflows/ci.yml .github/workflows/ios-testflight.yml \
  .github/workflows/ios-testflight-pr.yml
```

## One-time account setup

1. Publish the reviewed implementation through the normal `next` → `main`
   process. GitHub only discovers the `workflow_run` and manual release workflow
   once it exists on the default branch. Keep automatic dispatch off.
2. Once the new `ios-native` check has reported on a PR, add it to the required
   checks on **both** existing branch rulesets. Keep `checks`, `rust-check`, and
   the `main` promotion guard. Do not require a check before its workflow exists.
3. Confirm the GitHub environment **`ios-testflight`**, with a deployment branch
   allowlist containing **only `main`**. This restriction refers to the branch
   executing the dispatcher, not the `next` source being archived. An optional
   environment reviewer can gate each delivery; it is not required for the
   automatic post-merge model.
4. Confirm the App Store Connect app record uses **`com.onpaper.app`**, team
   **`847VH25R7U`**, and the **`iCloud.com.onpaper.app`** container. Connect this
   GitHub repository to Xcode Cloud with access limited to this repository.
5. Create an Xcode Cloud workflow for the committed project
   `resume-designer/src-tauri/gen/apple/resume-designer.xcodeproj`, scheme
   **`resume-designer_iOS`**, **`release`** configuration. Choose an Xcode 26.6
   or newer shipping toolchain and an iOS **Archive** action with
   **App Store eligible** distribution. Let Xcode Cloud manage signing.
6. Turn **off all automatic Cloud start conditions**, including PR, branch, tag,
   and scheduled triggers. GitHub owns the gating and explicitly starts each
   authorized immutable tag. Cloud tag triggers would duplicate builds and
   bypass the GitHub decision. Enable **manual tag** builds restricted to the
   `ios-testflight/` prefix. The dispatcher checks these workflow settings.
7. Create/select an **internal** TestFlight tester group for this app and add it
   as the workflow's TestFlight post-action. Use existing intended testers;
   configuring this pipeline does not authorize inviting new people. Check that
   **only the intended internal group** is selected and no external group is
   configured. Apple's workflow API does not expose these post-action recipients:
   the dispatcher proves the intended group receives the build, but cannot prove
   that no additional group was configured. Recheck recipients during the pilot.
8. Configure the variables and secrets below. Use a dedicated App Store Connect
   API key with the permissions needed to read/start Xcode Cloud builds and read
   app/build/internal-group state. Keep the private key solely in the protected
   GitHub environment. No signing certificate or API key is committed or passed
   into candidate build scripts.

| Location | Name | Value |
| --- | --- | --- |
| Environment secret | `APP_STORE_CONNECT_ISSUER_ID` | Issuer ID for the API key |
| Environment secret | `APP_STORE_CONNECT_KEY_ID` | API key ID |
| Environment secret | `APP_STORE_CONNECT_PRIVATE_KEY` | Complete `.p8` PEM contents |
| Environment variable | `APP_STORE_CONNECT_APP_ID` | Numeric App Store Connect app ID |
| Environment variable | `XCODE_CLOUD_WORKFLOW_ID` | Cloud workflow UUID |
| Environment variable | `APP_STORE_CONNECT_INTERNAL_GROUP_ID` | Internal tester group UUID |
| Repository variable | `IOS_TESTFLIGHT_AUTOMATION_ENABLED` | `false` until the pilot succeeds; then `true` |

Protect the `ios-testflight/**` tag namespace against updates and deletions,
while allowing creation by the release workflow. The dispatcher never updates
or deletes a tag and refuses to use one that resolves to another commit. Tags
are also durable dispatch reservations; retain them after builds finish.

## Build mechanics

The committed Xcode project remains source-controlled. `project.yml` is the
source of truth; regenerate the project when changing its build phase, rather
than editing the `.pbxproj` directly. See
[project ownership](xcode-project-ownership.md).

The regular local Tauri build still uses `tauri ios xcode-script`. That command
expects its parent CLI's options server, which does not exist when Xcode Cloud
invokes Xcode independently. The CI path builds the locked Rust static library
directly with the iOS configuration and embedded frontend, then links it with
the committed Swift/Objective-C target. This path must be checked again when
upgrading Tauri, especially plugin build metadata and Cargo features.

Cloud hooks live beside the Xcode project in `gen/apple/ci_scripts`, where Apple
looks for them. They bootstrap Node/Rust, install locked npm dependencies, build
the frontend, validate the release tag against `CI_COMMIT`, and prepare the
native build. GitHub performs unsigned validation; only Cloud signs and uploads.

Cloud currently pins Node `24.13.0` with verified archive checksums and Rust
`1.92.0`. GitHub selects Node 24, Rust `1.92.0`, and Xcode `26.6` on `macos-26`.
For the locked `swift-rs` dependency, a wrapper scoped to Cargo's child process
selects SwiftPM's native build engine. This also supports local Xcode 27, whose
default engine otherwise appends a conflicting macOS target to the iOS build.
It does not replace the installed Swift tool.

The iOS marketing version starts at `1.0.0`; it is independent of desktop's
computed versions. Cloud's build number must be unique and greater than previous
uploads for this app/version. Configure its starting number accordingly before
the pilot; do not reset it when recreating a workflow.

## Pilot and activation

1. Run CI on a reviewed push to `next`. Confirm all three jobs (`checks`,
   `rust-check`, `ios-native`) pass.
2. From `main`, manually run **iOS TestFlight**, target **`next`**. Keep the
   automation variable `false`.
3. Retain the GitHub run URL, immutable tag/SHA, Cloud run ID, build number,
   and App Store build ID. The job must reach **`testflight_available`**. Merely
   receiving a Cloud build ID is not success.
4. Verify the build is in the configured internal group and install it on a
   physical device. Confirm the bundle ID, privacy manifest, production APNs/
   CloudKit signing, keyless onboarding, persistence, PDF sharing and sync.
5. Only after this pilot succeeds, set the repository variable to `true`.
   Subsequent successful push CI runs on `next` and `main` will request delivery.

The release workflow can run for up to five and a half hours. A Cloud or Apple processing
timeout fails the GitHub job and retains the last known run/build details. It
does not imply Apple stopped the build.

Tag discovery has both a 120-check ceiling and a 15-minute monotonic elapsed-time
budget, including source reauthorization and Apple reference reads. Sleeps are
clipped to the remaining budget. An in-flight read may finish after the deadline;
a reference read completed at or after the deadline is refused. The controller
awaits that read rather than leaving background dispatch work running.

The original creator waits for a reference only within this window. Once the
reference is found, all remaining ordering and final source checks still apply. The controller
reports discovery counts without logging API payloads,
rechecks source eligibility while waiting, and exits if superseded. The exact tag,
commit, workflow and undeleted-reference checks still apply before any Cloud
start. A discovery timeout retains the immutable tag and records a no-start
receipt only when that controller owns the unused reservation and has neither
possibly sent a start request nor observed an existing Cloud run.

## Recovery

- A tag-discovery timeout means no Cloud start was attempted by that run. Leave
  its immutable reservation in place. A retry still cannot assume the reservation
  is unused: an earlier process could have sent a start request before losing
  its response. Follow the reconciliation steps below rather than deleting the
  tag or permitting another POST merely because no run is currently visible.
- For a monitoring failure, use **Re-run failed jobs** on the original GitHub
  run, retaining the successful authorization job's original commit outputs. The deterministic
  tag causes the dispatcher to locate and monitor an existing matching run
  rather than issue another build request. A known run ID can also be supplied
  to manual dispatch together with **`resume_sha`**, the original full lowercase
  40-character commit SHA. Both fields are required together. The gate validates
  successful push CI for that SHA and verifies it remains reachable from the
  selected protected branch; the controller verifies the run's workflow and exact
  reserved tag. Branch advancement does not change the selected recovery commit.
  Supplying a run ID only reads an existing tag and never creates a reservation,
  so a mistaken resume cannot block a later normal release.
- A failed/timed-out POST can still have started a build. Do not delete the tag
  or repeatedly dispatch. Check Cloud's build list first. If no matching run is
  visible, the dispatcher stops for operator reconciliation rather than risk
  two signed builds. Only after proving no run exists and confirming the tagged
  commit is still the protected branch head, manually start the **same immutable
  tag** in the configured Cloud workflow, then resume monitoring it. If the branch
  has advanced, release the newer head instead. Keep the tag; never delete or move
  it to retry.
- If the branch has advanced, rerunning failed release jobs retains the original
  authorized commit and can monitor an existing Cloud run. It cannot start a new
  build for that superseded commit. If the head advances during tag discovery,
  the unused reservation is retained and the job reports `superseded`; leave that
  tag in place and let the newer head's successful CI authorize its own release.
  Re-running **all** jobs on a manually dispatched pilot without recovery inputs
  resolves the branch's current head again. Supply both recovery fields in a new
  manual dispatch to monitor an older run. Automatic `workflow_run` events retain
  their original CI run identity, and manual recovery inputs retain their named
  SHA. A new manual pilot without those inputs resolves the current head.
- Set `IOS_TESTFLIGHT_AUTOMATION_ENABLED=false` to stop new automatic dispatches.
  Existing Cloud runs continue and must be managed separately in App Store
  Connect. This does not affect desktop releases.

## Owner-requested PR previews

The implementation is `.github/workflows/ios-testflight-pr.yml` and the trusted
`tools/ios-pr-*.mjs` controllers. The default mode is **off** until the bootstrap,
account configuration and pilot are completed. This is an additional preview
lane; the existing protected-branch release gate still requires successful push
CI and protected ancestry.

### Command and authorization

Create a new PR comment whose whole trimmed body is exactly `/testflight-dev`.
Only owner **ashproto**, numeric user ID **35086581**, with current repository
admin access can request or rerun a preview. Public comments and other
collaborators cannot enter the delivery queue or Apple environment. Edited
comments and arguments do not authorize anything.

The PR must be open (drafts are allowed), originate in repository ID
**1163653093**, and target protected `next` or `main`. Fork PRs are refused even
for an owner command. Successful upstream `CI` for that exact PR head must have
completed `checks`, `rust-check` and `ios-native` jobs. Existing PR CI tests the
synthetic merge; Cloud archives the pinned PR head, not that synthetic merge.
After pending/failing CI, create a fresh command once CI passes.

The authorization job runs trusted event-main code, verifies live GitHub
identities and inspects candidate Git objects as data. It freezes native,
dependency, build and CI configuration against that main revision. Changes to
these inputs require a separate reviewed infrastructure bootstrap. Normal
Swift/JS/CSS application changes remain previewable. This is defense in depth:
the owner must trust the exact source, which Cloud compiles in its build/signing
pipeline. It is not an untrusted-code sandbox.

### Required bootstrap and account settings

1. Land the infrastructure through feature → `next` → `main` using reviewed,
   history-preserving merges. The comment workflow must exist on default main.
   Keep preview mode off. Do not fold the unmerged UI feature into this bootstrap
   just to activate previews.
2. In the existing On Paper Cloud product/app, create **On Paper – PR TestFlight**
   with the committed project/shared scheme and release configuration. Select
   Xcode **27.1 or newer**, preferably **27.2**, managed signing, an iOS archive
   with **internal-only** audience, and manual tags restricted to
   `ios-testflight/pr/`. Disable every automatic start condition. Do not create
   another app or reset the shared Cloud build-number counter.
3. Create/select **On Paper Dev** as an internal tester group, using already
   intended testers. Verify the Cloud TestFlight post-action selects only this
   group, no external recipients. Disable automatic all-build access on every
   app beta group; preflight refuses it because it could distribute previews to
   unintended recipients. Make those account changes deliberately, rather than
   silently modifying existing groups. Native recipient settings require UI
   verification: Apple's workflow API does not expose them.
4. Keep existing ASC secrets in main-only environment **ios-testflight**. Add
   environment variables `XCODE_CLOUD_PR_WORKFLOW_ID` and
   `APP_STORE_CONNECT_DEV_GROUP_ID`. Existing `XCODE_CLOUD_WORKFLOW_ID`, app ID
   and production internal-group ID remain production configuration. No new PAT,
   signing certificate export or private key in candidate build scripts is used.
5. Extend the active update/delete tag ruleset, without bypass actors, to both
   `refs/tags/ios-testflight/pr/**` and `refs/tags/ios-testflight/request/**`.
   Preserve the main/next patterns. Allow creation only as required by the
   trusted controller; never enable automatic Cloud builds for these tags.
6. Merge the updated main into the feature branch, preserving history. The PR's
   immutable commit must contain the new tag hook and match main's protected
   build inputs. Never overlay main files onto the candidate during Cloud build.
7. Reconcile existing Cloud history/reservations before activation. Unknown or
   deleted source references and ambiguous prior starts must be resolved; an
   Actions timeout is not proof that Cloud stopped. Confirm both workflows use
   the same product's next `CI_BUILD_NUMBER`, above previous uploads.
8. Set repository `IOS_PR_TESTFLIGHT_MODE=pilot`,
   `IOS_PR_TESTFLIGHT_PILOT_PR=<number>` and
   `IOS_PR_TESTFLIGHT_PILOT_SHA=<full lowercase SHA>` for one reviewed candidate.
   Comment as the owner, verify the exact SHA/build reaches On Paper Dev, then
   install and test on the physical Duo. Only after this succeeds set mode to
   `enabled`. Unset/`off` prevents new preview starts while allowing recovery.

Do not enable preview mode until **both** deployed release controllers include
app-wide ordering. The production controller refuses active preview mode without
the configured preview workflow ID. Once that ID is configured it coordinates
even while preview mode is off, because an older preview could still be running.

### Immutable requests, ordering and recovery

Each owner comment has a permanent lightweight binding
`ios-testflight/request/pr-<number>/comment-<id>`. Its original SHA survives full
workflow reruns. Cloud uses a separate dispatch reservation
`ios-testflight/pr/<number>/<comment-id>/<full-sha>`. A pushed commit makes an
unstarted request stale; another comment is required. A new comment may
deliberately rebuild the same SHA; rerunning the original comment cannot.
If the original workflow failed before creating a binding, rerunning it cannot
approve a later head; create a fresh command instead.

Only an unambiguous fresh reservation creator may send one Cloud start POST.
Existing reservations can only be reconciled/monitored. Both workflows share
`ios-testflight-com-onpaper-app` concurrency through Apple processing. Before
new starts, the controller additionally checks earlier Cloud runs and uploads;
a departed Actions monitor cannot free an unfinished Cloud upload.

Reservation outcome commit statuses are discovery pointers, not proof. Clearing
an unused reservation requires the final matching structured outcome in the
authenticated logs of a completed trusted-main release job. The controller uses
the hosted runner's `gh` CLI with an isolated empty config and only its GitHub
token to read those job logs; Apple credentials are excluded from that child
environment. Missing logs/provenance, uncertain POST acceptance or unknown upload
states keep ordering blocked. No timeout or general force-clear grants a retry.

One pre-journal reservation is reconciled by `tools/ios-cloud-legacy.mjs`:
`ios-testflight/next/52e1b799c03be084736a10c3ff7aa81d41b22a2c`. Its
[original trusted-main run](https://github.com/ashproto/Resume-Designer/actions/runs/42157371938)
completed tag discovery as `superseded` before the pinned controller could
reach its only Cloud POST. The receipt pins the exact run, attempt, job, source
files and authenticated raw-log digest. It applies only with no structured
journal for that reservation, after all live Cloud/upload checks; missing or
changed evidence remains blocked. It grants no start/retry authority, changes
no status or tag, and cannot close any other reservation.

GitHub GETs use bounded, per-process conditional requests. Every read still
contacts GitHub with the current token; only an authenticated matching `304`
reuses isolated JSON for the exact URL. Token changes and mutation attempts
invalidate those validators. Errors never fall back to cached authorization,
and Apple requests remain uncached. CI lookup is scoped to the source branch
while retaining exact repository/PR/head checks and synthetic-merge support.
This follows [GitHub conditional-request guidance](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests)
so unchanged polling reads do not consume the primary request budget.

For recovery, run **iOS PR TestFlight** from **main**, supplying its original
`request_tag` and an optional known `resume_run_id`. Omitting the run ID scans for
the exact reservation; it still cannot start a build or create another tag. The
owner, original unchanged command and binding are verified again. Monitoring may
continue after PR advancement/closure or after mode is off. A deleted/edited
original command fails authorization and requires account-side operator
reconciliation rather than authorizing another start.

If no run is visible after an ambiguous POST, retain all refs and seek
authoritative Apple reconciliation. A definitively recorded pre-POST failure or
Apple rejection can close an unused reservation for ordering; absence from an
API list alone cannot. Do not delete tags, restart ambiguous reservations or
request another build to work around the block.

Feedback failures emit a `preview_diagnostic` record with a fixed initialization
or feedback phase, fixed API operation name, and HTTP status or `transport`.
Numeric rate-limit remaining/reset/retry-after fields are included when supplied
by GitHub so quota failures can be distinguished from access failures.
Raw API bodies, exception messages, paths and credentials are excluded. A failed
status comment does not establish the delivery outcome: inspect the original
Actions/Cloud run and its reservation before any recovery or new command.

For feedback diagnostics or repair without Cloud monitoring, manually run
**iOS PR TestFlight Feedback Repair** from **main** with only the original `request_tag`.
The dedicated five-minute job revalidates the owner/admin, unchanged owner
command and immutable binding, then runs the trusted feedback CLI with a fixed
unconfirmed outcome. It has no Apple credentials, release environment, build
queue, candidate execution, ref/status writes or delivery dependency. Callers
cannot supply a success state or build identity. Repair creates a missing notice
only; it never updates an existing authentic request notice, so a concurrent
availability update cannot be replaced by diagnostics. A simultaneous creation
can still produce duplicate notices; duplicates fail closed and require operator
reconciliation. This is not an atomic or exactly-once comment operation.
This path exercises the actual Actions feedback token and safe diagnostics;
it does not start or recover a Cloud build, or prove TestFlight availability.

An isolated feedback job updates one bot comment per owner request with the
source SHA, Actions URL, Cloud run/build identity and verified state. Feedback
cannot authorize delivery. `testflight_available` requires correct app, source,
internal-only audience, processing, number and Dev group membership; a submitted
run or local archive is not availability. A tested Cloud prebuild helper also
writes PR/source/build metadata to `TestFlight/WhatToTest.en-US.txt` beside the
Xcode project. Actual TestFlight note ingestion is part of the live pilot.

The Dev build uses **com.onpaper.app** and **iCloud.com.onpaper.app**, with
distribution CloudKit/APNs. It replaces the same app and accesses its existing
data. A tester group does not provide a separate data sandbox or side-by-side app.

### Local implementation evidence

Local mocked policy/dispatch/recovery tests, tree-object tests and workflow lint
are separate from hosted GitHub/Apple delivery evidence. The actual PR-tag Cloud
hook has been exercised in an isolated copy, and unsigned simulator compilation
and device Release archive pass with Node 24.13.0, Rust 1.92.0 and Xcode 27.2.
Hosted bootstrap CI and the account configuration above are tracked separately
from these local results. Signed preview upload, actual TestFlight note ingestion
and physical-device installation remain pending the controlled pilot. See the
implementation handoff for final local test counts and retained logs.

## References

- [Apple: custom build scripts](https://developer.apple.com/documentation/xcode/writing-custom-build-scripts)
- [Apple: Cloud environment variables](https://developer.apple.com/documentation/xcode/environment-variable-reference)
- [Apple: Cloud TestFlight distribution](https://developer.apple.com/documentation/xcode/distributing-your-xcode-cloud-builds-through-testflight)
- [GitHub: workflow events and default-branch execution](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [GitHub: privileged PR workflow risks](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)
