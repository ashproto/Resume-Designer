# iOS CI and TestFlight delivery

The iOS lane builds the complete Swift/Rust/web app. Public pull requests run
without release credentials on GitHub-hosted runners. Reviewed commits on
protected `next` and `main` can be archived and signed by Xcode Cloud, then sent
to the configured internal TestFlight group. App Store submission is separate.

## Current activation state

The implementation is ready for review and awaits merge/account setup.
Automatic dispatch is **off**
unless the repository variable `IOS_TESTFLIGHT_AUTOMATION_ENABLED` is exactly
`true`. A successful local archive is not evidence of Cloud signing, upload,
processing, or TestFlight installation. Complete the pilot below before enabling
automatic dispatch.

On 2026-09-22, the GitHub `ios-testflight` environment was created with a
**main-only** deployment branch policy, automatic dispatch was explicitly set to
`false`, and an active tag ruleset was added to prevent updates/deletions of
`ios-testflight/main/*` and `ios-testflight/next/*` (no bypass actors). Existing
branch rulesets were retained. App Store Connect credentials, app/group/workflow
IDs, Cloud configuration and the live pilot remain outstanding. The existing
Apple/CSC secrets are for desktop releases; this lane does not use them.

Local verification on 2026-09-22 covers the release-readiness and automation
candidate based on `next` at `75536fcd`:

| Gate | Evidence |
| --- | --- |
| App regression suite | 113 files, 1,816 tests passed. |
| Release controller/gate/build-helper regressions | 49 tests passed. Includes fork/PR rejection, delayed merge metadata, immutable refs, ambiguous dispatch/retry, TestFlight processing/group membership, Cloud tag guards, isolated compiler invocation and SwiftPM compatibility. |
| Static checks | ESLint has zero errors and two existing warnings; actionlint, shellcheck and `git diff --check` pass. |
| Native simulator | Full unsigned Debug build passed with Node 24, Rust 1.92.0, Xcode 27/iOS 27 SDK. |
| Native device | Full unsigned Release archive passed with the same toolchain. Bundle verified as `com.onpaper.app`, minimum iOS 26.0, version 1.0.0; bundled privacy manifest present and static library absent from app resources. |
| Hosted CI / Xcode 26.6 | Not run; requires publication. |
| Cloud signing / upload / TestFlight installation | Not run; App Store Connect setup and credentials are still needed. |

Local native outputs and bundle verification are retained under
`/private/tmp/onpaper-ios-ci-validation`; full build log is
`/private/tmp/onpaper-ios-ci-native.log`. The local unsigned build number is
still `1.0.0`; the Cloud pre-build hook applies `CI_BUILD_NUMBER` during the pilot.

## What runs

| Event | Checks and delivery |
| --- | --- |
| Pull request to `next` or `main` | Existing lint, tests, audit and Rust checks; release-tool tests; actual Swift decoder tests; unsigned simulator compilation and device archive. No Apple credentials. |
| Push to `next` or `main` | The same CI checks. A successful run can trigger the separate iOS delivery workflow after automatic dispatch is enabled. |
| Manual `iOS TestFlight` dispatch from `main` | Select `next` or `main`. Its current head must already have successful push CI, including `ios-native`. This is also the pilot path. |
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

The release workflow can run for up to three and a half hours. A Cloud or Apple processing
timeout fails the GitHub job and retains the last known run/build details. It
does not imply Apple stopped the build.

## Recovery

- For a monitoring failure, use **Re-run failed jobs** on the original GitHub
  run, retaining the successful authorization job's original commit outputs. The deterministic
  tag causes the dispatcher to locate and monitor an existing matching run
  rather than issue another build request. A known run ID can also be supplied
  to manual dispatch; it must match the selected source commit and workflow.
- A failed/timed-out POST can still have started a build. Do not delete the tag
  or repeatedly dispatch. Check Cloud's build list first. If no matching run is
  visible, the dispatcher stops for operator reconciliation rather than risk
  two signed builds. Only after proving no run exists, manually start the
  **same immutable tag** in the configured Cloud workflow, then resume monitoring
  it. Keep the tag; never delete or move it to retry.
- If the branch has advanced, rerunning failed release jobs retains the original
  authorized commit. Re-running **all** jobs on a manually dispatched pilot
  resolves the branch's current head again; avoid that when recovering an older
  pilot. Automatic `workflow_run` events retain their original CI run identity.
  A new manual dispatch also resolves the branch's current head.
- Set `IOS_TESTFLIGHT_AUTOMATION_ENABLED=false` to stop new automatic dispatches.
  Existing Cloud runs continue and must be managed separately in App Store
  Connect. This does not affect desktop releases.

## References

- [Apple: custom build scripts](https://developer.apple.com/documentation/xcode/writing-custom-build-scripts)
- [Apple: Cloud environment variables](https://developer.apple.com/documentation/xcode/environment-variable-reference)
- [Apple: Cloud TestFlight distribution](https://developer.apple.com/documentation/xcode/distributing-your-xcode-cloud-builds-through-testflight)
- [GitHub: workflow events and default-branch execution](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows)
- [GitHub: privileged PR workflow risks](https://docs.github.com/en/actions/reference/security/securely-using-pull_request_target)
