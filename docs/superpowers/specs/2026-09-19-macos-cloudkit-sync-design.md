# macOS CloudKit sync: the Mac joins the iPhone's sync system

**Status:** implemented on `feat/macos-cloudkit-sync`, including the recovery and
foreground-refresh fixes in `b9594c38`. Development builds were verified on a
Mac and iPhone on 2026-09-21. This document was reconciled with that implementation
on 2026-09-22; Production release verification remains separate.

## Scope and identity

The macOS desktop app syncs résumés, profiles and the existing synced inventory
with iOS through `iCloud.com.onpaper.app`. The App IDs remain
`com.resumedesigner.app` on macOS and `com.onpaper.app` on iOS. Both are entitled
to the same container; no bundle ID or `resume-designer-*` storage key was renamed.

The sync model in `src/sync/` supplies the units, scopes, merge rules and durable
acknowledgements for both platforms. The desktop bridge now activates that model
and sends its dirty notifications. `src-tauri/ios/OPSync.swift` is compiled from
one source file into both apps, with separate `OPSyncHost` implementations in
`OPShell.swift` and `macos/DesktopSyncHost.swift`. The shared transport includes
the asset-conflict fix; its supplementary foreground reader and ingestion gate
are conditional on macOS. It is shared source, not an unchanged copy of the
original iOS transport.

The Rust module and commands are gated on macOS. `build.rs` checks
`CARGO_CFG_TARGET_OS` at build-script runtime so a Windows cross-build on a Mac
does not accidentally compile or link CloudKit. The browser and Windows paths
do not initialize the desktop sync bridge.

Replacement epochs remain a separate, unimplemented feature under
[#126](https://github.com/ashproto/Resume-Designer/issues/126). See the
[replacement-epoch design](2026-08-18-restore-replacement-epoch-design.md) and
[implementation plan](../plans/2026-08-28-restore-replacement-epoch-plan.md),
included here as supporting documentation for that future work.
This implementation does not make a replacement restore remove records the
restoring device has never seen.

## Architectural choice

The desktop reuses the existing Swift transport and JS model. A second host
crosses a small C ABI into Rust; Rust evaluates a request in the Tauri page, and
the page answers through a Tauri command. The model continues to own decisions
about unit meaning, conflict winners, unions and version history. The transport
owns CloudKit records, assets, change tags and engine state.

Alternatives considered:

1. **A separate transport through Rust CloudKit bindings.** This would duplicate
   the transport's delegate handling, retry rules and durability invariants.
   Reusing the Swift implementation keeps those decisions in one place.
2. **CloudKit Web Services from Rust.** This introduces a different authentication
   and transport path rather than using the Mac's native iCloud account and the
   existing `CKSyncEngine` integration.
3. **A Swift helper process.** A second bundle, signing configuration and IPC
   lifecycle add complexity without improving this in-process boundary.

## The bridge

`src-tauri/src/desktop_sync.rs` registers one Swift-to-Rust request callback at
startup. `DesktopSyncHost.request` encodes a JSON object containing `kind` and its
arguments, allocates an integer request ID, and parks a continuation under that
ID. The callback receives `(id, json)` and evaluates
`window.__opDesktopSync.request(id, json)` on the main webview. It returns without
waiting or calling back into the engine.

The page dispatches the request and replies through
`desktop_sync_reply({ id, json })`; Rust forwards that reply to `op_sync_resume`.
Swift settles the continuation exactly once. Requests have a 30-second deadline;
a late or duplicate reply is ignored. A missing page or failed reply is treated
as a refusal, not as a successful apply. Notices use ID `0`, carry no continuation,
and receive no reply. Structured payloads cross as JSON strings, with integer
IDs and UTF-8 strings at the C boundary; no Swift or Rust model objects cross it.

`src/sync/syncHostRoutes.js` shares the `syncUnit`, `syncScopes`, `syncApply` and
`syncResolveConflicts` routes between iOS and macOS. Desktop adds its
request/response `syncCollect` route for full uploads. Lifecycle notices and the
iOS-specific message carrier remain outside that shared table. Contract tests
cover the shared routes and the JS/Swift payload fields.

The page also issues commands in the other direction:

- `desktop_sync_report_profile` starts sync with the active profile and the
  registry's known and tombstoned profile IDs.
- `desktop_sync_dirty` names units whose bytes reached disk, with their owning
  profiles. Sends are grouped by profile, including changes to unopened profiles.
- `desktop_sync_profiles` updates the known-zone set and settles debt for
  workspaces the registry has durably tombstoned. A shared-zone landing triggers
  this report, so newly discovered workspaces can enter later fetches.
- `desktop_sync_resume` is the explicit recovery action after an iCloud purge.
- `desktop_sync_suspension` reads the native marker and its process-local
  revision through the same answer channel as the account-profile probe.
- `desktop_sync_account_profiles` probes the account registry during first-run
  setup. This uses a separate answer callback and request-ID table because Swift
  is answering the page's question. The Swift lookup is bounded at eight seconds
  and the page waits at most nine seconds; unavailable is distinct from empty.

`src/desktopSync.js` is initialized from `main.js` only for Tauri on macOS, after
`initIOSShell`. It uses `window.__opDesktopSync`; the iOS `window.__opShell`
carrier remains dormant on desktop.

## Concurrency and durable accounting

`OPSyncEngine`, its delegate and the host protocol are main-actor isolated.
Main-actor isolation does not remove CloudKit's delegate task-local context.
An ordinary `Task { ... }` created by a delegate callback inherits that context,
and a later call to `sendChanges()` or cancellation can still trigger CloudKit's
reentrancy assertion after the callback has returned.

Tasks spawned from the iOS and macOS host callbacks therefore use
`Task.detached { @MainActor ... }`. The desktop lifecycle chain and deferred-send
retry also detach because callbacks can reach them. Source-shape tests enforce
these boundaries. The event-in-flight guard still defers explicit sends during
an event, but is not a substitute for detaching callback-created tasks.

Start, activation, account switch, purge, resume and stop run on the desktop's
serialized lifecycle chain. This prevents overlapping account checks from
constructing two engines. The host retains durable deferred-send and full-upload
ledgers: failed or refused units remain owed, and a full upload is paid only when
nothing re-owed it during the send. A repeating foreground pass drains existing
debt; it does not create a new full-upload obligation every time.

A fetched record earns its change tag only after the model durably accounts for
its route. Refused arrivals and unresolved conflicts forfeit the tag and are held
for another attempt. The model remains responsible for comparing snapshots and
merging append-shaped data. Missing or physically deleted records do not imply
local deletion; the app's explicit tombstone units carry that intent.

On macOS, a FIFO ingestion gate serializes the supplementary reader, engine
events and existing direct-refetch ingestion. New polling downloads happen
outside the gate; model application and tag adoption happen inside it. Explicit
sends are deferred while the gate is held. Stop, purge and account changes
invalidate supplementary reads and their RAM cursors, and late results cannot
commit into a different session. Ordinary events already delivered by the engine
must still finish their accounting before a later state update persists an
advanced engine token; stopping a supplementary read does not discard those
events.

## Asset-backed conflicts

A `serverRecordChanged` error can contain a `CKAsset` without readable downloaded
bytes. Previously that made the conflict terminal before the model could compare
its two versions. The shared `opReadConflict` helper now captures the failed
local version before suspending, uses an already-readable server record immediately,
and otherwise fetches the full server record once through
`CKDatabase.record(for:)`, using the record's complete ID and zone.

A successful download carries its payload and change tag together through the
existing conflict resolver. The model chooses the snapshot winner or merges the
collection, parks a losing résumé version where applicable, and acknowledges only
a durable result. A still-unreadable record or failed direct fetch follows the
existing terminal failure path; the helper does not recurse or retry indefinitely.
A `userDeletedZone` error takes the purge path, and a result belonging to a replaced
engine is discarded. The database fetch does not await `CKSyncEngine` from its
own delegate callback.

## Lifecycle, push and foreground discovery

The page's first active-profile report starts the transport. A start pass fetches
the shared registry zone, drains deferred sends, pays owed full uploads, then
pulls incoming changes. The application registers for silent remote notifications;
`CKSyncEngine` manages its subscription and push-driven fetching. Activation
runs the start pass again. Tauri's application `Exit` event requests a stop;
there is no separate helper process continuing sync after the app exits.

Hardware testing exposed a foreground gap: manual engine fetches could return
without a database request while the Mac remained focused, and activation then
discovered the outstanding changes. Repeating the same engine call did not fix
that observed behavior. The implemented fallback attempts direct database
discovery every 30 seconds while the app is active and sync is enabled. Only one
timer pass may be queued or running, and it rechecks the current profile,
activation and suspension state when its lifecycle turn begins.

The foreground reader:

- requests zone-change metadata with no user fields, using independent in-memory
  tokens for the shared zone and known profile zones;
- compares change tags against durably remembered records, then downloads only
  payloads that need accounting; temporary asset bytes are captured before the
  next network suspension;
- processes at most two pages of up to 100 results per zone per pass;
- commits a page's cursor only after its records are accounted for, including
  unreadable records handed to the existing recovery path; a failed download or
  model refusal retains the old cursor;
- respects CloudKit retry-after delays, resets an expired token for the next
  tick, and treats `userDeletedZone` as a purge;
- emits a successful zone landing when its final page is accounted for. Shared
  registry reporting is asynchronous, so newly learned profile zones may enter
  the next timer pass.

Thirty seconds is an attempt interval, not a guaranteed delivery time. Background
fetching remains CloudKit-managed.

A purge writes the suspension marker before asynchronous cleanup, preserves the
person's local documents, and prevents automatic re-upload. Only the explicit
resume action re-owes full uploads, clears suspension and starts again. An
account change likewise preserves local content and re-owes uploads for the new
account.

Native suspension is authoritative. At each page startup, the bridge reconciles
the page's durable mirror before reporting its profile, repairing notices lost
during a reload or crash. Purge and resume notices carry the same revisioned
snapshot, so a late startup answer cannot overwrite a newer transition. A paused
start records profile metadata without starting CloudKit; an explicit resume
therefore has the context it needs even after a cold launch.

## Build, signing and environments

`build.rs` compiles `ios/OPSync.swift` and `macos/DesktopSyncHost.swift` into a
static library for the macOS target architecture, with a macOS 14.4 deployment
target. It links CloudKit, Foundation, AppKit and the Swift runtime search paths.
The source is read in place; no transport copy is maintained. The bundle's
minimum macOS version is also 14.4.

Both entitlement files name the existing desktop App ID, team and shared
container. App Sandbox remains disabled in the current configuration.
`Entitlements.plist` selects CloudKit `Production` and production pushes;
`Entitlements.development.plist` selects `Development` and development pushes.
Development and Production are separate stores: a successful connection to one
does not demonstrate that it can see devices using the other.

Profile embedding is implemented. `tauri.conf.json` maps
`src-tauri/embedded.provisionprofile` into the bundle's
`Contents/embedded.provisionprofile` before signing. The release workflow decodes
`APPLE_PROVISIONING_PROFILE_B64`, checks that it permits Production, the desktop
App ID and push notifications, then builds signed release artifacts. Profiles
and signing material are local files or CI secrets, not committed artifacts.

For Development hardware testing, run `scripts/build-mac-dev.sh` from
`resume-designer/`. The script accepts `OP_DEV_PROFILE` and
`APPLE_SIGNING_IDENTITY`, checks the local profile and entitlements, selects the
Development entitlement file, disables updater artifacts, embeds the profile,
and verifies the resulting signature. Installation into `/Applications` is
optional via `OP_INSTALL=1`; a build alone does not replace that installation.
Launch the built `.app` through Launch Services with stderr captured, for example:

```sh
open --stderr /tmp/on-paper-mac-sync.log \
  "src-tauri/target/release/bundle/macos/On Paper.app"
```

Do not launch its executable directly for CloudKit verification. Confirm that
only the intended app process is running: the development bundle and an existing
installed copy share the same local data directory. Logs can contain résumé
payloads and should remain local.

Production release readiness requires the deployed CloudKit schema, compatible
iOS Production builds, the correct Developer ID profile, signing and notarization.
Those are separate from the Development build results below. The future
replacement-epoch work is not implemented here and is not a prerequisite created
by these transport fixes.

## Verification and remaining gates

The 2026-09-21 implementation check through `b9594c38` established:

- **Automated:** 105 Vitest files and 1,729 tests passed, including seven native
  Swift asset-conflict scenarios and ten foreground-page/ingestion scenarios.
  The native fixtures run on macOS; source-shape and shared-route tests cover
  callback tasks and the bridge. Full-repository ESLint, branch-wide commitlint,
  Clippy with warnings denied, and whitespace checks passed. Existing ESLint and
  Swift warnings were recorded; they were not reported as new clean diagnostics.
- **Builds:** macOS transport/host type-checking and the signed Development app
  build passed. The iPhone debug build exported, installed and launched; the
  shared iOS transport was also type-checked.
- **Hardware:** an asset-backed history conflict on the Mac downloaded its server
  record, entered the normal resolver and subsequently sent successfully. An
  iPhone edit then reached the continuously focused Mac through the direct timer
  in about 30 seconds, with no activation between the edit and arrival. A
  reversible Mac edit reached the iPhone. Final résumé variants and all 100
  canonical history entries agreed across devices, including asset-backed
  history. Raw history-file byte equality was not claimed.

The following are not established by that run:

- an independently forced iPhone-origin asset conflict;
- destructive iCloud purge/resume and account-switch scenarios on the final
  binaries;
- repeating the first-sync scenario on these final binaries, where both devices
  begin with different, previously unsynced workspaces; that case was verified
  on 2026-09-20 and is recorded in Task 7 of the
  [implementation plan](../plans/2026-09-19-macos-cloudkit-sync-plan.md);
- Production signing/notarization, Intel and Windows release artifacts, and
  cross-platform release smoke tests.

The wrap-up production dependency audit initially reported a high-severity
`@xmldom/xmldom` issue through `mammoth`. On 2026-09-22, a targeted lockfile update
from `0.8.13` to `0.8.15` resolved that blocker without changing Mammoth or app code.
The production audit reported zero vulnerabilities; all 1,729 tests, the frontend
build, and DOCX extraction smoke checks passed after the update.
These results describe the recorded run, not a promise about subsequent builds.

API-key sharing through a common keychain access group and replacement-epoch
semantics remain outside this feature. The Mac continues to use its existing
credential behavior.
