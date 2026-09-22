# macOS CloudKit Sync Implementation Plan

**Status (2026-09-22):** implemented on `feat/macos-cloudkit-sync` through
`b9594c38`, with Development builds verified on a Mac and iPhone. This document
records the implementation and its original plan; it is not an instruction to
repeat the completed work or a claim that every release gate has passed.

**Goal:** The macOS desktop app syncs with the iOS app through the shared CloudKit container, compiling the same `OPSync.swift` source as iOS. Shared transport fixes apply to both builds; foreground direct discovery is macOS-only.

**Architecture:** `OPSync.swift` is compiled into the desktop binary as a static library. A second `OPSyncHost`, `DesktopSyncHost.swift`, crosses into Rust over a C ABI with `(request id, JSON)`; Rust evaluates a call into the page; the page answers through a Tauri command carrying the id; Rust resumes the waiting Swift continuation. Only JSON strings cross the ABI. Design: [`2026-09-19-macos-cloudkit-sync-design.md`](../specs/2026-09-19-macos-cloudkit-sync-design.md).

**Tech Stack:** Swift 5 (CloudKit, Foundation), Rust (Tauri 2, `build.rs`), plain JS, vitest, `cargo test`.

## Current outcome

- The Swift/Rust/page bridge handles incoming units and outgoing dirty units.
  Deferred units and full-upload debt survive restarts; lifecycle operations
  are serialized, and purge suspension is recorded before asynchronous cleanup.
- Both hosts detach tasks created by sync callbacks. A later main-actor turn
  alone does not clear the CloudKit delegate task-local (Tasks 11–12).
- Unreadable asset-backed save conflicts receive one direct server-record
  download, then enter the existing model conflict resolver. A still-unreadable
  result follows the terminal-failure path instead of an unbounded fetch loop.
- While the Mac remains active, a 30-second timer runs a bounded direct
  `CKDatabase` pull. Activation still asks `CKSyncEngine` to fetch; silent push
  remains the background path. The direct reader serializes ingestion with
  engine callbacks and advances its own cursors only after accounting for a page.

## Latest verification (2026-09-21, implementation `b9594c38`)

| Gate | Result |
| --- | --- |
| Full Vitest | 105 files, 1,729 tests passed, including native Swift fixtures with seven conflict-reader and ten foreground-ingestion scenarios. |
| Lint and commit messages | Full ESLint passed with two existing warnings; branch-wide commitlint and `git diff --check` passed. |
| Rust lint | `cargo clippy -- -D warnings` passed. Earlier Task 8 records the Windows cross-check and Rust bridge tests; those were not repeated for the final transport/host fix. |
| Swift and app builds | Mac transport/host and iOS transport typechecks passed; signed Mac Development build and full iPhone debug device build passed. Mac signature and embedded profile verified; both apps installed and launched. |
| Asset conflict on hardware | The Mac directly downloaded the previously stuck history record, resolved the conflict through the model, and subsequently sent successfully. No unreadable-conflict terminal failure or reentrancy trap was observed afterward in that session. |
| Focused Mac receive | An iPhone edit at 15:41:28 arrived at 15:41:53 without a Mac activation in between. The user confirmed the visible update after about 30 seconds. |
| Return direction and final state | A temporary Mac edit reached the iPhone, then was restored. Final target résumé variants matched exactly, all 100 history entries matched canonically, and the résumé content matched the state before the reversible Mac test. |

The foreground interval is an attempt cadence, not a delivery guarantee; server
throttling and network conditions can delay it. Runtime logs and résumé snapshots
were retained locally and are not part of the repository.

## Remaining checks and separate work

- The 2026-09-21 dependency-audit blocker was resolved on 2026-09-22 by updating
  only the locked `@xmldom/xmldom` version from `0.8.13` to `0.8.15`, within
  Mammoth's existing range. The production audit then reported zero
  vulnerabilities; all 1,729 tests, the frontend build, and DOCX extraction
  smoke checks passed. Mammoth and application code were unchanged.
- The real-device iCloud Settings purge test in Task 7 remains unrun. The purge
  handling is implemented; this document does not claim hardware verification.
- An independent iPhone-origin asset conflict was not forced. Both platforms
  compile the same tested conflict reader, and bidirectional convergence passed.
- Production signing/notarization and matching Production schema/environment on
  iOS and macOS remain release checks. Development verification is not that gate.
- Replacement epochs are a separate, unimplemented feature in
  [issue #126](https://github.com/ashproto/Resume-Designer/issues/126) and the
  [tracked epoch design](../specs/2026-08-18-restore-replacement-epoch-design.md).

## Historical implementation sequence

The original task instructions, example code and checkboxes below record how the
feature was built. They are not a current API reference. An unchecked original
test step is not evidence that it ran; use the verified outcomes above and the
dated findings below. Task 12 records the final shared-transport and foreground
changes that supersede earlier timer experiments.

---

## Findings the plan is built on — verified, not assumed

1. **The static link works, both directions.** Spike in the scratchpad: a Swift static lib with CloudKit linked, called from Rust via `@_cdecl`, calling back into Rust via a registered `@convention(c)` pointer. Exit 0. The exact `build.rs` in Task 1 is the spike's, verbatim.
2. **`swiftrt.o` is not needed and does not exist** in this Xcode (SDK MacOSX27.0). Do not add it; the link fails on a missing file. dyld registers Swift metadata itself.
3. **`CKContainer(identifier:)` traps outside a signed, entitled bundle.** The spike's first run SIGTRAPped before `main`'s first line for this reason alone. **Consequence for every task below:** `cargo test` and any CLI harness may exercise the bridge, but must never construct a container. CloudKit behaviour is verified only in the signed `.app`.
4. **`OPSync.swift` imports only `CloudKit` and `Foundation`**; its only app dependency is the nine-method `OPSyncHost` protocol; its only references to the iOS shell are four comments. It compiles for macOS as-is.
5. **Two provisioning profiles exist and are decode-verified.** Developer ID → `Production` (releases, CI secret `APPLE_PROVISIONING_PROFILE_B64`). macOS App Development → `[Production, Development]` (local, `~/Library/MobileDevice/Provisioning Profiles/On_Paper_Desktop__Development.provisionprofile`). Ash's data is in **Development**.
6. **The window label is `"main"`** (`lib.rs:144`, `ios_shell.rs:53`). Commands register in `lib.rs:97` via `generate_handler!`.

## Global Constraints

- **Windows and Linux builds must not change.** Every native Rust piece is `#[cfg(target_os = "macos")]`; **`build.rs` is the exception** — there `#[cfg]` tests the host, so it gates on `CARGO_CFG_TARGET_OS` at run time. `cargo check --target x86_64-pc-windows-gnu` is a gate on every task that touches Rust.
- **`OPSync.swift` is read from `src-tauri/ios/`, never copied.** One transport, two hosts.
- **Only JSON strings cross the ABI.** No struct crosses; Swift decodes into the same `SyncUnit`/`SyncConflict` iOS uses, so `test/swiftContract.test.js` keeps guarding the field contract unchanged.
- **The credential never crosses the sync boundary** — unchanged, and not touched.
- **`applied` counts durable units only.** The desktop route must return `applyUnits`'s answer, not a count of what reached the cache.
- **The iOS bridge (`window.__opShell`) stays dormant on desktop.** Desktop gets its own global, `window.__opDesktopSync`.
- **Host callbacks must not await reentrant engine operations in CloudKit's delegate task.** Callback-spawned recovery and lifecycle work detaches before later engine calls; the main actor alone does not clear the delegate task-local.
- **Every migration works from any prior state.** A Mac with pre-existing profiles joins the mesh with nothing tombstoned.
- Conventional commits, lowercase subjects. Mutation-verify every test.

---

## File Structure

- `src-tauri/build.rs` — **Modify.** macOS-only Swift compile + link.
- `src-tauri/macos/DesktopSyncHost.swift` — **Create.** The second `OPSyncHost`; owns the continuation table and the C surface.
- `src-tauri/src/desktop_sync.rs` — **Create.** `extern "C"` declarations, the Rust callback, the pending-reply map, the two commands, `start`/`stop`.
- `src-tauri/src/lib.rs` — **Modify.** Register the module (cfg-gated) and its commands.
- `src-tauri/Entitlements.plist` — **Modify.** iCloud + CloudKit + container + environment.
- `src/sync/syncHostRoutes.js` — **Create.** The dispatch table both hosts share; extracted from `iosShell.js`.
- `src/iosShell.js` — **Modify.** Consume the shared table instead of inlining it.
- `src/desktopSync.js` — **Create.** `window.__opDesktopSync`, activation, profile reporting.
- `src/main.js` — **Modify.** Wire `desktopSync.js` under Tauri on macOS.
- `.github/workflows/release.yml` + `scripts/ci/embed-profile.sh` — **Modify / Create.** Embed the profile before signing; environment as a build input.
- `test/syncHostRoutes.test.js`, `test/desktopSync.test.js` — **Create.**
- `src-tauri/src/desktop_sync.rs` `#[cfg(test)]` — bridge tests, **no container**.

---

### Task 1: Compile and link the Swift transport into the desktop binary

**Files:**
- Modify: `src-tauri/build.rs`
- Create: `src-tauri/macos/DesktopSyncHost.swift` (a stub with one `@_cdecl` this task; the real host is Task 3)

**Interfaces:**
- Produces: `libOPDesktopSync.a` linked on macOS, exporting `op_sync_link_check() -> UnsafeMutablePointer<CChar>` for the smoke test.

- [ ] **Step 1: Write the failing test** — in `src-tauri/src/desktop_sync.rs`:

```rust
#[cfg(all(test, target_os = "macos"))]
mod link_tests {
    use std::ffi::{c_char, CStr};
    extern "C" {
        fn op_sync_link_check() -> *mut c_char;
        fn op_sync_free(p: *mut c_char);
    }
    #[test]
    fn the_swift_library_is_linked_and_callable() {
        // Never a CKContainer here: outside a signed bundle it traps. This only
        // proves the static link and the C surface.
        let p = unsafe { op_sync_link_check() };
        let s = unsafe { CStr::from_ptr(p) }.to_str().unwrap().to_owned();
        unsafe { op_sync_free(p) };
        assert_eq!(s, "op-desktop-sync:linked");
    }
}
```

- [ ] **Step 2: Run it and watch it fail** — `cd src-tauri && cargo test desktop_sync` → link error, `op_sync_link_check` undefined.

- [ ] **Step 3: The stub host**

```swift
// src-tauri/macos/DesktopSyncHost.swift
import Foundation
import CloudKit

@_cdecl("op_sync_link_check")
public func op_sync_link_check() -> UnsafeMutablePointer<CChar> {
  // CloudKit is LINKED — the symbol below forces it — but no container is
  // constructed: outside a signed, entitled bundle CKContainer(identifier:)
  // throws, and this function is reached from `cargo test`.
  _ = CKRecord.SystemFieldKey.recordID
  return strdup("op-desktop-sync:linked")
}

@_cdecl("op_sync_free")
public func op_sync_free(_ p: UnsafeMutablePointer<CChar>?) { free(p) }
```

- [ ] **Step 4: `build.rs`** — verbatim from the working spike, plus `OPSync.swift`:

```rust
use std::{env, path::PathBuf, process::Command};

fn main() {
    tauri_build::build();
    // Gated on the TARGET, read at run time. `#[cfg(target_os)]` in a build
    // script is evaluated against the HOST the script is compiled for, so a cfg
    // gate still ran this for a Windows cross-build on a Mac and emitted
    // `framework=` lines cargo rejects for that target. The Windows cross-check
    // caught it during Task 1.
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        link_swift_sync();
    }
}

// macOS ONLY. Every `cargo:` line is emitted only inside this function, which
// is only called for a macOS target. `cargo check --target x86_64-pc-windows-gnu`
// proves it.
fn link_swift_sync() {
    let out = PathBuf::from(env::var("OUT_DIR").unwrap());
    let arch = env::var("CARGO_CFG_TARGET_ARCH").unwrap();
    let target = format!("{}-apple-macos14.4", if arch == "aarch64" { "arm64" } else { "x86_64" });

    // OPSync.swift is READ from ios/, never copied: one transport, two hosts.
    let sources = ["ios/OPSync.swift", "macos/DesktopSyncHost.swift"];
    let status = Command::new("swiftc")
        .args(["-emit-library", "-static", "-parse-as-library", "-O",
               "-target", &target, "-module-name", "OPDesktopSync", "-o"])
        .arg(out.join("libOPDesktopSync.a"))
        .args(sources)
        .status()
        .expect("swiftc not found — Xcode command line tools are required for the macOS build");
    assert!(status.success(), "swiftc failed compiling the sync transport");

    println!("cargo:rustc-link-search=native={}", out.display());
    println!("cargo:rustc-link-lib=static=OPDesktopSync");

    // The Swift runtime ships with macOS 14+, so nothing is embedded — but the
    // LINK still needs the toolchain's and the SDK's search paths, and the
    // binary needs the rpath to find the OS copies at load.
    let sdk = cmd("xcrun", &["--sdk", "macosx", "--show-sdk-path"]);
    let swiftc = PathBuf::from(cmd("xcrun", &["--find", "swiftc"]));
    let toolchain_lib = swiftc.parent().unwrap().parent().unwrap().join("lib/swift/macosx");
    println!("cargo:rustc-link-search=native={}", toolchain_lib.display());
    println!("cargo:rustc-link-search=native={}/usr/lib/swift", sdk);
    println!("cargo:rustc-link-arg=-Wl,-rpath,/usr/lib/swift");
    // NOT swiftrt.o: it does not exist in this Xcode and dyld registers Swift
    // metadata itself. Adding it fails the link on a missing file.
    for f in ["CloudKit", "Foundation"] {
        println!("cargo:rustc-link-lib=framework={f}");
    }
    for s in sources {
        println!("cargo:rerun-if-changed={s}");
    }
}

fn cmd(bin: &str, args: &[&str]) -> String {
    let out = Command::new(bin).args(args).output().expect(bin);
    String::from_utf8(out.stdout).unwrap().trim().to_owned()
}
```

- [ ] **Step 5: Run** — `cargo test desktop_sync` → PASS. Then `cargo check --target x86_64-pc-windows-gnu` → clean, proving Windows never reaches `swiftc`.

- [x] **Step 6: Commit** — `b10594e4`, `build(macos): compile the cloudkit transport into the desktop binary`

---

### Task 2: The shared dispatch table

**Files:**
- Create: `src/sync/syncHostRoutes.js`
- Modify: `src/iosShell.js`
- Test: `test/syncHostRoutes.test.js`

The four pure routes from `iosShell.js` (`syncUnit`, `syncScopes`, `syncApply`, `syncResolveConflicts`) move to one module both hosts consume, so a new `OPSyncHost` method is added once and a contract test asserts every request kind is routed.

**Interfaces:**
- Produces: `makeSyncHostRoutes(deps, { publish }) -> { [kind]: (args) => result|Promise }` and `SYNC_HOST_KINDS = ['syncUnit','syncScopes','syncApply','syncResolveConflicts']`.

- [ ] **Step 1: Write the failing tests**

```js
import { makeSyncHostRoutes, SYNC_HOST_KINDS } from '../src/sync/syncHostRoutes.js';

it('routes every host request kind', () => {
  const routes = makeSyncHostRoutes({ collectUnit(){}, unitScopes(){}, applyUnits(){}, resolveConflicts(){} }, { publish(){} });
  for (const k of SYNC_HOST_KINDS) expect(typeof routes[k]).toBe('function');
});

it('syncApply RETURNS applyUnits\'s promise rather than a cache count', async () => {
  const applyUnits = vi.fn().mockResolvedValue({ applied: 3 });
  const routes = makeSyncHostRoutes({ applyUnits }, { publish(){} });
  await expect(routes.syncApply({ units: '[]' })).resolves.toEqual({ applied: 3 });
});

it('syncScopes refuses a non-array synchronously', () => {
  const routes = makeSyncHostRoutes({ unitScopes(){} }, { publish(){} });
  expect(() => routes.syncScopes({ unitIds: '{}' })).toThrow();
});
```

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement** — move the four handlers verbatim from `iosShell.js`, parameterised on `deps` and `publish`. `iosShell.js` spreads `...makeSyncHostRoutes(deps, { publish: () => publish() })` into its command table where the four inline handlers were — **a thunk, not the value**: `initIOSShell` declares `let publish = () => {}` and rebinds it after the table is built, so capturing the value hands the routes the placeholder. Found by `iosShell.test.js` on the first run against the refactored file (Task 2). Its own `syncUnits`, `syncAccountProfiles` and `syncInitialProfileFetchSettled` stay where they are: they post to `window.webkit`, which is iOS-only.

- [ ] **Step 4: Run** `npx vitest run test/syncHostRoutes.test.js test/iosShell*.test.js` → PASS.

- [ ] **Step 5: Mutation-verify** — drop `syncApply` from the table; the routing test fails.

- [x] **Step 6: Commit** — `ab4ab202`, `refactor(sync): share the host dispatch table between the two native hosts`

---

### Task 3: `DesktopSyncHost.swift` — the host that never touches a webview

**Files:**
- Modify: `src-tauri/macos/DesktopSyncHost.swift`
- Test: `src-tauri/src/desktop_sync.rs` `#[cfg(test)]` (Task 4 supplies the Rust side)

**Interfaces:**
- Produces C surface: `op_sync_register(cb)`, `op_sync_resume(id, json)`, `op_sync_start(profileId)`, `op_sync_stop()`, `op_sync_units_changed(profileId, unitIdsJson)`.
- Consumes: `OPSyncHost`, `SyncUnit`/`SyncConflict`/`SyncConflictOutcome`, and `OPSync`'s public start/stop/send API — read them from `OPSync.swift` at implementation time; do not restate them here.

- [ ] **Step 1: Write the failing test** (Rust, Task 4's harness): registering a callback then calling `op_sync_ping(7)` invokes the callback with id 7 and `{"kind":"ping"}`; calling `op_sync_resume(7, "{\"ok\":true}")` resolves it.

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement the crossing**

```swift
public typealias OPSyncRustCallback = @convention(c) (UInt64, UnsafePointer<CChar>) -> Void

/// The desktop `OPSyncHost`. Every method marshals to JSON, allocates an id,
/// parks a continuation under it, and hands off to Rust. It NEVER calls back
/// into `OPSync` — the reentrancy rule the iOS host learned the hard way.
final class DesktopSyncHost: OPSyncHost {
  private var callback: OPSyncRustCallback?
  private var pending: [UInt64: CheckedContinuation<String, Error>] = [:]
  private var nextId: UInt64 = 1
  private let lock = NSLock()
  /// Every request has a deadline; one that outlives it resumes with a failure,
  /// which OPSync treats as "this device cannot answer now", never as data.
  private let deadline: TimeInterval = 30

  func request(_ kind: String, _ payload: [String: Any]) async throws -> String {
    var body = payload; body["kind"] = kind
    let json = String(decoding: try JSONSerialization.data(withJSONObject: body), as: UTF8.self)
    return try await withCheckedThrowingContinuation { cont in
      lock.lock()
      let id = nextId; nextId += 1
      pending[id] = cont
      lock.unlock()
      json.withCString { callback?(id, $0) }
      DispatchQueue.global().asyncAfter(deadline: .now() + deadline) { [weak self] in
        self?.fail(id, "deadline")
      }
    }
  }

  func resume(_ id: UInt64, _ json: String) {
    lock.lock(); let c = pending.removeValue(forKey: id); lock.unlock()
    c?.resume(returning: json)
  }
  private func fail(_ id: UInt64, _ why: String) {
    lock.lock(); let c = pending.removeValue(forKey: id); lock.unlock()
    c?.resume(throwing: OPDesktopSyncError.host(why))
  }
  // The nine protocol methods each decode `request(...)`'s JSON into the iOS
  // types. Fire-and-forget ones (`syncDidFail`, `syncDidLand`,
  // `syncDidSwitchAccounts`, `syncDidPurgeFromICloud`) call `callback` with id 0
  // and park nothing.
}
```

**Two isolation findings from implementing this, both structural:**

1. **`OPSyncHost` is a `@MainActor` protocol** (its iOS host is a SwiftUI model). A class that conforms in its *primary declaration* inherits that isolation onto every member — `init`, the C entry points, everything — and `cargo test` pumps no main run loop, so a main-actor hop there hangs forever. **Conform in an extension.** The class stays nonisolated; only the nine witnesses take the protocol's isolation, and the engine that calls them already hops to it.
2. **`OPSyncEngine` is itself `@MainActor`.** Engine calls run on the main actor. The original host used ordinary main-actor tasks; Task 11 corrected callback-created work to `Task.detached { @MainActor in … }`. The Rust bridge tests do not start an engine or construct a container.

The test-only `op_sync_ping()` takes no id: the host issues ids, and the Rust test reads the one it was given from the callback rather than dictating it.

- [x] **Step 4: Run** the Rust harness → PASS (3 tests, 0.02s).

- [x] **Step 5: Mutation-verify** — `settle` ignoring the id never resumes the continuation; the round trip times out on the pong.

- [x] **Step 6: Commit** — `adac8643`, `feat(macos): a desktop sync host that crosses into rust instead of a webview`

---

### Task 3b: The deferred-send ledger on desktop

**Found while implementing Task 3.** Both iOS reply handlers do more than
decode: `syncDidFetch` and `syncDidConflict` hand every REFUSED or UNRESOLVED
unit to `deferSync`, a durable per-profile ledger that re-offers them at the
next start. That ledger exists because CKSyncEngine treats a fetched record as
delivered once the delegate returns — if the host did not land it, nothing but
the ledger brings it back. The same is true on desktop.

Task 3 does not replicate the ledger. It reports refusals to the page as a
fire-and-forget `syncRefused { profileId, unitIds }` request (id 0) and logs
them, so the gap is VISIBLE rather than silent. This task closes it:

**Where it lives — corrected after reading the iOS body.** The first draft of
this task proposed a page-side ledger. Wrong: the iOS ledger is Swift-native,
in `UserDefaults.standard` under `OPSyncEngine.deferredKey(profileId)` —
`op-sync-deferred-<profileId>`, plus a shared-zone key — and `UserDefaults`
works identically on macOS under the app's bundle domain. So this is a **port of
`deferSync` / `addSyncDeferred` / `syncDeferred(key:)` /
`hoistSharedSyncDeferred` and the drain-at-start from `OPShell.swift` into
`DesktopSyncHost.swift`**: same keys, same carrier, same behaviour on both
platforms, and the page never learns about it. The initial plan kept transport
changes minimal and duplicated the ledgers between hosts; implementation needed
the `deferredKey` isolation change below. Task 12 later changed the shared transport
for asset-conflict recovery and Mac foreground discovery.
Note the duplication in a comment on both sides.

**Scope, measured against the iOS bodies (2026-09-19):** ~220 lines of Swift.
TWO ledgers, both in `UserDefaults`: the deferred ids (`op-sync-deferred-*`,
per profile plus the shared-zone key) AND the full-upload-owed flag per
profile, which `runStartSync` sets for every known profile on its first gated
start — the mechanism behind "a Mac that already has data uploads it". A
faithful port carries both or neither. The correctness-critical parts are the
drain's re-entry guard (`syncDraining` / `syncDrainAgain`) and the keyed drain's
settle-on-success with the `syncDeferredReowed` set (settle only what a
successful send covered, minus anything re-owed DURING the send), plus the
57-line `sendSync` wrapper. Suspension differs by design: iOS keeps it in
`UserDefaults`, desktop in the page's `SYNC_SUSPENDED_KEY` — each platform is
self-consistent; say so in the port's comment.

**Findings from implementing this:**

- **`OPSyncEngine.deferredKey` needed one word.** It is a `static` on a `@MainActor` class, so a pure string function inherited actor isolation, and nonisolated ledger code could not call it. Duplicating the format would let the two hosts drift; `assumeIsolated` crashes off the main thread. The fix is `nonisolated` on that one function — the transport edit needed for this ledger task — proven safe for iOS by the iOS-SDK type-check.
- **`cargo test` runs tests in parallel, and Swift holds ONE callback slot.** Two test modules each registering their recorder race for it; the loser's request lands in the other log and its wait times out. Reproduced 3/3 at exactly the 2s deadline, fixed 3/3 by a shared `FFI_LOCK` held by every callback-registering test. Not intermittent — deterministic, which is why "run it again" would never have found it.
- **The hoist enumerates defaults; the union test reads one key.** Different questions, so the hoist test asserts the enumeration sees its queue before relying on it. (It did; the failure above was the race.)
- **`syncCollect` is a desktop-only request route.** iOS asks it fire-and-forget and the page posts `syncUnits` back; over this bridge it is a request with an answer, so it lives in `desktopSync.js`, not the shared table.
- The drain itself cannot be unit-tested without an engine and therefore a container. Its two guards are carried by fidelity to the iOS bodies — settle-on-success with the re-owed set, and the drain re-entry flag — and by Task 7 on hardware.

- [x] Failing Rust test (no engine, no container): the profile key round-trips through `UserDefaults`; a second defer unions; the shared-zone hoist moves `shared`-scoped ids to the shared key via a real `syncScopes` answer over the bridge. Mutations: replace the union → the union test fails alone; drop the hoist's subtract → "the profile key keeps only its own" fails alone.
- [x] The drain at start in the iOS order: `fetchShared` → `drainSyncDeferred` → full uploads owed → `fetch`. `syncDidFetch` / `syncDidConflict` call `deferSync`; `syncDidSwitchAccounts` re-owes every considered profile.
- [x] Commit — `feat(desktop): keep the deferred-send debt across starts` (`b3f16dcf`). **Desktop sync is no longer blocked on this.**

**This blocker was closed by `b3f16dcf`:** without the ledger, a landing refused
mid-edit (the `interruptsLiveEditing` case) could be lost until the record changed
again on the server.

---

### Task 4: `desktop_sync.rs` — the Rust bridge and the two commands

**Files:**
- Create: `src-tauri/src/desktop_sync.rs`
- Modify: `src-tauri/src/lib.rs`

**Interfaces:**
- Consumes Task 3's C surface.
- Produces commands `desktop_sync_reply(id: u64, json: String)` and `desktop_sync_report_profile(profile_id: String)`, plus `pub fn start(app: &AppHandle)` called from setup on macOS.

- [ ] **Step 1: Write the failing test** — the ping round trip from Task 3, plus: a reply for an unknown id is ignored, not a panic.

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement**

```rust
// macOS only — the gate is `#[cfg(target_os = "macos")] mod desktop_sync;` in
// lib.rs. Do NOT also put `#![cfg(...)]` here: the same cfg stated twice is a
// duplicated-attribute lint, and clippy -D warnings turns it into an error
// (found in Task 1).
use std::ffi::{c_char, CStr, CString};
use tauri::{AppHandle, Manager};

extern "C" {
    fn op_sync_register(cb: extern "C" fn(u64, *const c_char));
    fn op_sync_resume(id: u64, json: *const c_char);
    fn op_sync_start(profile_id: *const c_char);
    fn op_sync_stop();
}

static APP: std::sync::OnceLock<AppHandle> = std::sync::OnceLock::new();

/// Swift → Rust → page. Runs on OPSync's executor, so it must return quickly:
/// it evaluates one call and does not wait for the answer, which arrives on
/// its own through `desktop_sync_reply`.
extern "C" fn on_request(id: u64, json: *const c_char) {
    let json = unsafe { CStr::from_ptr(json) }.to_string_lossy().into_owned();
    let Some(app) = APP.get() else { return };
    let Some(window) = app.get_webview_window("main") else { return };
    let script = format!(
        "window.__opDesktopSync && window.__opDesktopSync.request({id}, {})",
        serde_json::to_string(&json).unwrap()
    );
    let _ = window.eval(&script);
}

#[tauri::command]
pub fn desktop_sync_reply(id: u64, json: String) {
    let c = CString::new(json).unwrap_or_default();
    unsafe { op_sync_resume(id, c.as_ptr()) }
}

#[tauri::command]
pub fn desktop_sync_report_profile(profile_id: String) {
    let c = CString::new(profile_id).unwrap_or_default();
    unsafe { op_sync_start(c.as_ptr()) }
}

pub fn install(app: &AppHandle) {
    let _ = APP.set(app.clone());
    unsafe { op_sync_register(on_request) }
}
```

In `lib.rs`: `#[cfg(target_os = "macos")] mod desktop_sync;`, add both commands to `generate_handler!` under the same cfg, and call `desktop_sync::install(app.handle())` in setup on macOS. Stop on `RunEvent::ExitRequested`.

- [ ] **Step 4: Run** `cargo test desktop_sync` → PASS; `cargo clippy --all-targets -- -D warnings`; `cargo check --target x86_64-pc-windows-gnu` → clean.

- [ ] **Step 5: Mutation-verify** — drop the `APP.get()` guard's early return; the unknown-id test still passes but the harness panics on a missing window → restore.

- [x] **Step 6: Commit** — included with the Swift host in `adac8643`.

---

### Task 5: `desktopSync.js` — the page side

**Files:**
- Create: `src/desktopSync.js`
- Modify: `src/main.js`
- Test: `test/desktopSync.test.js`

**Interfaces:**
- Consumes `makeSyncHostRoutes` (Task 2), `invoke` from `@tauri-apps/api/core`, `getActiveProfileId`, `SYNC_SUSPENDED_KEY`.
- Produces `initDesktopSync(deps)` which installs `window.__opDesktopSync = { request(id, json) }`.

- [ ] **Step 1: Write the failing tests** — `request` routes by `kind` through the shared table and replies via `invoke('desktop_sync_reply', { id, json })`; an unknown kind replies `{ ok:false }` rather than throwing; while `SYNC_SUSPENDED_KEY` is set no reply carries units; `initDesktopSync` reports the active profile via `desktop_sync_report_profile` once.

- [ ] **Step 2: Run and watch them fail.**

- [ ] **Step 3: Implement**

```js
import { invoke } from '@tauri-apps/api/core';
import { makeSyncHostRoutes } from './sync/syncHostRoutes.js';

/**
 * The desktop half of the sync bridge. NOT `window.__opShell` — that is the
 * iOS bridge and stays dormant here. Same routes, different carrier.
 */
export function initDesktopSync(deps) {
  const routes = makeSyncHostRoutes(deps, { publish: () => {} });
  window.__opDesktopSync = {
    async request(id, json) {
      let reply;
      try {
        const { kind, ...args } = JSON.parse(json);
        const route = routes[kind];
        if (!route) throw new Error(`no route: ${kind}`);
        reply = { ok: true, value: await route(args) };
      } catch (e) {
        reply = { ok: false, error: String(e?.message ?? e) };
      }
      if (id !== 0) await invoke('desktop_sync_reply', { id, json: JSON.stringify(reply) });
    },
  };
  const profileId = deps.getActiveProfileId();
  if (profileId) invoke('desktop_sync_report_profile', { profileId });
}
```

In `main.js`, beside (not inside) `initIOSShell`: `if (isTauri && platform === 'macos') initDesktopSync({...same deps...})`.

**Findings from implementing this:**

- `getPlatform()` returns **`'darwin'`** for macOS (`PLATFORM_MAP`), not `'macos'`. Gate on that.
- Suspension is one fact with two names: `isSyncEnabled()` reads `SYNC_SUSPENDED_KEY`, `setSyncEnabled(false)` writes it. `isSyncSuspended = () => !isSyncEnabled()`.
- **Import `invoke` once, memoized.** Per-call `import('@tauri-apps/api/core')` (appStorage's pattern) let the start report and the first request race two first-imports; under vitest's mock registry the second caller got the real module. The four tests that requested without awaiting init failed, the five that did not passed — a clean signature once seen. One shared promise fixes production and test alike.
- `initDesktopSync` returns the start promise; tests await it. `console.log` is silent in this project's vitest, so a probe that logs shows nothing — probe with assertions.

- [x] **Step 4: Run** `npx vitest run test/desktopSync.test.js` → PASS (9); `npx vite build` clean.

- [x] **Step 5: Mutation-verify** — reply on `id === 0` too; the fire-and-forget test fails, alone.

- [x] **Step 6: Commit** — `8843c2e1`, `feat(desktop): activate the sync model on macos through the tauri bridge`

---

### Task 6: Entitlements, profile embedding, environment as a build input

**Files:**
- Modify: `src-tauri/Entitlements.plist` (Production), `src-tauri/tauri.conf.json`, `.github/workflows/release.yml`, `.gitignore`
- Create: `src-tauri/Entitlements.development.plist`, `scripts/build-mac-dev.sh`

**Simpler than first planned, on two verified facts.** Tauri's `bundle.macOS.files` copies files into `Contents/` *before* signing, and the CLI accepts `--config` JSON overrides. So there is no generated entitlements file and no post-build step: two static plists, one `files` mapping, a decode step in CI, and a script for local builds.

- **`Entitlements.plist` → Production.** Signs releases against the Developer ID profile, which permits only Production. Sandbox stays `false`.
- **`Entitlements.development.plist` → Development.** Same file with the environment swapped; selected by the dev script via `--config '{"bundle":{"macOS":{"entitlements":"Entitlements.development.plist"}}}'`. The Development profile permits both environments, so it signs.
- **`bundle.macOS.files: { "embedded.provisionprofile": "./embedded.provisionprofile" }`.** Both CI and the dev script put *their* profile at that one source path; the config stays static. The path is gitignored.
- **CI** decodes `APPLE_PROVISIONING_PROFILE_B64` into that path before `tauri-action`, and **checks** the decoded profile permits Production and names `com.resumedesigner.app` — a wrong profile fails the build with a named error rather than shipping an app that connects to nothing. The secret joins the fail-fast list.
- **`scripts/build-mac-dev.sh`** copies the Development profile in, refuses a profile that does not permit Development, signs as `Apple Development: Aakash Shah`, builds with the dev entitlements, then prints the entitlements actually signed in and verifies the embedded profile and the signature. `OP_INSTALL=1` copies to `/Applications` and reminds about the one-binary rule.

**Two findings from the first build, both about the entitlements file:**

- **`--` is illegal inside an XML comment.** A comment in the Development plist said `--config`; the build compiled everything, embedded the profile, chose the identity, and then `codesign` failed at the very end with `AMFIUnserializeXML: syntax error near line 24`. Five minutes to learn what a parser says in one second.
- **`plutil -lint` is NOT AMFI's parser.** It passed the exact file AMFI rejected. The gate — in `build-mac-dev.sh` and in the CI embed step — is `xmllint --noout`, which fails the known-bad with the line and reason ("Double hyphen within comment") and passes the fixed files. Validated on the known-bad *before* being trusted; `plutil` stays for plist-level structure.

- **Third finding:** the dev script turns `createUpdaterArtifacts` off. That step needs the minisign private key only CI holds; without it `tauri build` exits non-zero *after* the app is signed, so the script's checks never ran on the first attempt.

- **Fourth finding (2026-09-20, the first launch that reached the transport):** `CKContainer` refused with `checkFailed("Trying to initialize a container without an application ID")`. The signed entitlements had every iCloud key and no `com.apple.application-identifier`: Xcode injects it (and `com.apple.developer.team-identifier`) from the provisioning profile, Tauri's codesign step signs exactly the file it is given. Both profiles permit exactly `847VH25R7U.com.resumedesigner.app` / `847VH25R7U`, so both entitlement files now declare them. A restricted entitlement is only launchable with a profile that permits it, which the embedded profile does.

- [x] **Verify** — `codesign -d --entitlements -` shows `iCloud.com.onpaper.app` and `Development`; `Contents/embedded.provisionprofile` is the Development profile; `codesign --verify --deep --strict` passes under the Apple Development identity; the transport's strings are in the binary. **Not launched** — see Task 7's gate.

- [x] **Commit** — `build(macos): sign with the icloud entitlements and an embedded provisioning profile`

---

### Task 7: Hardware verification and the ledger

- [x] Build locally with `scripts/build-mac-dev.sh` (Development entitlements, Development profile, dev signing identity).
- [x] **The first launch is gated on Ash's explicit go-ahead.** It shares the real data dir with the installed app, and with sync wired it starts uploading this Mac's profiles and résumés into the Development container where the phone's data is — intended, but outward-facing and hard to reverse. Before it: snapshot `storage/`, launch BY PATH (never by name), confirm exactly one binary with `pgrep -fl resume-designer`, and capture the transport's own log for the first 45s. The staged script is `first-sync-launch.sh` in the session scratchpad.
- [x] **First launches, 2026-09-19 — the build is right, the run was blocked.** Six launches by path with stderr captured. Findings, in the order they cost time: (1) `strings` cannot see Tauri's embedded frontend — it is brotli-compressed — so "is the binary current" is answered by comparing the embedded asset **path keys** to `dist/`, which the launch script now does; (2) `log show` returned nothing for the app because it only reads persisted entries — the launch script streams live to a file, and NSLog reaches stderr (probed); (3) with every start gate reporting to stderr, the page reaches Rust fine, and `init()` runs through storage, migration, profiles and the key extraction, then **never returns from the secret-store initialisation**: a dev-signed build is a different signing identity from the installed app, a keychain item's ACL is bound to the identity, and the first keychain read blocks on the "allow access" prompt, which a shell-launched process never gets answered. **Next run must be launched with Ash at the keyboard to answer that prompt once** — never by the agent.
- [x] **First sync, 2026-09-20 — done on the Mac side, two defects found on the way.** (1) Ash answered the keychain prompt (Always Allow persists for the dev identity; no prompt on later launches). (2) With init unblocked, the wiring line still never printed: the whole wiring block had been pasted INSIDE `window.resetForTesting`'s arrow function, so it ran only if someone called that debug helper. Valid JavaScript, green build, green suite. `test/desktopSyncWiring.test.js` now parses `main.js` with acorn and asserts the `wiring reached` note's nearest enclosing function is `init` — it failed on the bug (`ArrowFunctionExpression`) and passes after the move. (3) The transport then started and CloudKit refused: `checkFailed("Trying to initialize a container without an application ID")` — the Task 6 fourth finding; both entitlement files now carry `com.apple.application-identifier` and `com.apple.developer.team-identifier`. (4) Run with both fixes: account `available`, the shared registry landed from the phone (two phone-created profiles, `Ash Shah` and `Colleen Sinclair` with their own ids, ADDED beside the two desktop ones; nothing removed), 41 + 14 units offered for the two desktop profiles' first full upload, `CKModifyRecordZones` + `CKModifyRecords` in the CloudKit log, zero errors/conflicts/refusals; on disk only the registry, the active chat thread's stamp and the sync-state changed. (5) Second run: the page reported 4 known, the two phone profiles' zones were adopted and their data landed as 10 NEW files (résumé, chat threads, history, settings); the desktop profiles were NOT re-offered, so the full-upload ledger settled; still zero errors. Observations, not defects: opening the app bumps the active chat thread's `updatedAt` (the thread switch on open, `useChat.js`), so every launch re-sends that one unit; the dev build is versioned 1.0.0 so the updater offers 2.2.0 on every launch — click Later, never Download, in a dev build; both devices will now list four profiles because each side created its own pair before sync — expected by the criterion below, and a manual merge is Ash's call; a profile that appears in the registry mid-session gets its zone on the next re-report, i.e. the next profile switch (which reloads the page) or launch — `OPSyncEngine.start` reconciles the zone set when re-called.
- [x] **Deletion leg 1, 2026-09-20 (Ash deleted a phone-created profile on the iPhone):** the tombstone landed correctly — registry entry kept with `deletedAt`, the dead namespace's 7 files removed, the switcher dropped to 3, nothing else touched. It landed on the restart that Ash's profile switch caused, ~25 s after the deletion, with the page still reporting 4 known at the switch — which I first read as "nothing wakes the transport on macOS between starts". **Wrong, corrected by deletion leg 2 (same day):** Ash deleted the second phone profile and left the Mac untouched; the tombstone was on disk 45 s after the phone stamped it, with no restart, no switch, no push registration — `CKSyncEngine` schedules its own fetches. So the Mac is not launch-only; it is merely slower than push (the first case was 25 s of patience, not a gap). Push on macOS stays a speed improvement, not a correctness one. Also seen: the dead zone's 3 leftover records are re-fetched and refused at every start (the deleter never deletes the zone; shared-model follow-up); a `sync send postponed` line right after a restart is benign — `send` queues the changes into the engine BEFORE the `eventInFlight` throw, and the durable hold is a redundant re-offer; a landing normalised a legacy provider-prefixed `byModel` summary to the current unprefixed keys (values intact).
- [x] **Mac ↔ iPhone/iPad, both directions — verified on the final build (2026-09-20 17:08 Mac → cloud, acknowledged; 17:20 device → Mac by push, no activation).** The earlier "works well now" from Ash at 15:4x was on the build with the first bridge fix.
- [x] **Pre-existing data on both:** a profile created on the Mac before sync and one on the phone both end up on both devices, nothing tombstoned. **Verified 2026-09-20:** the Mac holds the phone's two profiles (run 2), and Ash confirmed on the iPhone that every desktop profile and its data arrived; four profiles on both devices, nothing tombstoned. The phone-created pair were bare test profiles, so Ash will delete them on one device as the deletion leg of the two-way test rather than merge.
- [ ] Purge from iCloud settings on one → both suspend, nothing deleted locally.
- Verification is recorded under **Latest verification** above and in Task 8; the original combined gate is not marked passed beyond that evidence.
- [x] Update the spec's status to implemented and document the Development launch workflow and Production coordination requirement (2026-09-22).

### Task 8: Silent push on macOS (added 2026-09-20)

**Why:** deletion leg 2 showed CKSyncEngine fetches on its own between starts, but on its own schedule (45 s in that run, and the schedule is discretionary). Ash: "it's very important that we have proper push on the macos app."

**Files:**
- Modify: `src-tauri/Entitlements.plist` (`com.apple.developer.aps-environment` = `production`), `src-tauri/Entitlements.development.plist` (= `development`)
- Modify: `src-tauri/macos/DesktopSyncHost.swift` (`import AppKit`; `NSApplication.shared.registerForRemoteNotifications()` right after the engine reports `available`, once per start, idempotent)
- Modify: `src-tauri/build.rs` (link `AppKit`), `scripts/build-mac-dev.sh` and `.github/workflows/release.yml` (refuse a profile without `com.apple.developer.aps-environment`)

**Mechanism, verbatim from the iOS side (`OPShell.swift`):** CKSyncEngine "attempts to discover an existing CKDatabaseSubscription … If the engine doesn't find a subscription, it automatically creates one … On receipt of a notification, the engine schedules a sync operation to fetch the related changes." The app registers; nothing else. Tauri's `tao` delegate has no remote-notification methods, so nothing to forward and nothing in the way. Silent pushes never prompt on macOS.

**Manual, Ash only (the portal):**
- [x] Identifiers → the macOS App ID `com.resumedesigner.app` → enable **Push Notifications** → Save. No APNs key or certificate: CloudKit sends its own pushes.
- [x] Profiles → *On Paper Desktop – Development* → Edit → Save (regenerate) → Download → replace `~/Library/MobileDevice/Provisioning Profiles/On_Paper_Desktop__Development.provisionprofile`.
- [x] Profiles → *On Paper Desktop – Developer ID* → Edit → Save → Download → `base64 -i <file> | pbcopy` → update the `APPLE_PROVISIONING_PROFILE_B64` secret.
- [x] Decode both and confirm `com.apple.developer.aps-environment` is in their Entitlements (the profile snapshots the App ID's capabilities at generation; an un-regenerated profile lacks it and a build signed with it is killed at launch for an unpermitted restricted entitlement).

**Verify:**
- [x] The dev script refuses the old profile (it did: "does not carry the push entitlement") and accepted the regenerated one (2026-09-20 13:03).
- [x] `codesign -d --entitlements :-` shows `com.apple.developer.aps-environment` = `development`; the app launched; stderr showed `registered for silent CloudKit pushes` 0.3 s after the engine reported available.
- [x] ~~apsd log~~ — apsd redacts app names in the unified log (0 matching lines); the timing below is the proof instead.
- [x] **Phone → Mac.** First measurement: a thread stamped 20:53:20Z landed at 13:53:28 PDT (8 s). Then three edits took minutes and appeared only when Ash refocused the window, while an iPad got them in seconds. Root cause found in the CloudKit log: **launched by executable path, the process is not a LaunchServices app, and at every start `BGSTFramework submitTaskRequest failed … Could not find specified service`** — the push DID arrive (fetches ran under a `push-sync` assertion) but the sync it triggers is a background system task, so it ran only on app activation. Launched with `open --stderr <file> <app>` (parent = launchd, BGST "Calling launch handler"), an iPad edit stamped 21:14:33Z landed at 14:15:06 PDT under `push-sync` with the Mac untouched and the document repainted. **Real users launch via Finder, so shipped builds never had this; the dev launch script now must use `open`.** The 31 s here is APNs + the iPad's upload debounce; iOS-to-iOS was ~3 s. One unexplained repaint: the phone's 21:11:48Z edit landed on disk at 14:12:48 (start fetch of the `open` launch) and Ash saw it only on a refocus ~14:14; the 14:15:06 landing repainted with no focus change. Watch for a repeat. **Push latency on the Mac is APNs, not us:** an edit stamped 21:44:24Z arrived as "received push via PushKit … sync after push notification … engine/fetch-on-push" at 14:46:06 PDT and landed at 14:46:08 — 1 m 44 s, all of it waiting for the push, while the two iOS devices saw each other in ~3 s. Observed Mac push latencies the same afternoon: 8 s, 31 s, 1 m 44 s, ~4 min. CloudKit's silent pushes are low priority and APNs batches them for a background Mac app; nothing in our code sets that. The candidate at this stage was activation fetch plus foreground polling. The engine-only timer subsequently failed the focused-window test; Task 12 records the implemented direct-database timer. Push remains the background path.
- [x] `cargo test desktop_sync` (6 passed, AppKit linked), `cargo clippy --all-targets -- -D warnings`, `cargo check --target x86_64-pc-windows-gnu`, `swiftc -typecheck` — all green.
- [x] Commit — `1f96a51b`, `feat(macos): register for silent cloudkit pushes`

### Task 9: The Mac never sent an edit (found 2026-09-20 15:30, Ash's Mac → iOS test)

**Finding.** The desktop bridge was one-way. `desktopSync.js` answered every request Swift made (`syncUnit`, `syncScopes`, `syncApply`, `syncResolveConflicts`, `syncCollect`) and reported the profile once at start — and that was ALL the page ever told Swift. iOS's host also receives `syncDirty` from the page (`OPShell.swift` `case "syncDirty"`: group by workspace, `sendSync` per group). On the desktop nothing carried that: no Tauri command, no C entry (`desktop_sync.rs` declared only `op_sync_register/resume/start/stop`), and the model's ONE notifier slot (`setStorageDirtyNotifier`) was filled by `initIOSShell` on every platform with a callback that returns early off iOS — so every dirty unit the page flushed was handed to a function that dropped it. The only uploads the Mac ever made were each profile's one-time full upload. Every fetch-side test passed because nothing on the fetch side was wrong.

**Fix (built):** `desktop_sync_dirty(units)` command → `op_sync_dirty(json)` → `DesktopSyncHost.syncDirty` groups by `profileId` (`""` = open workspace) exactly as OPShell does and `sendSync`s per group; `desktopSync.js` installs the notifier through `deps.setSyncDirtyNotifier` AFTER `initIOSShell` (last writer takes the slot); `main.js` passes `setStorageDirtyNotifier`. Tests: `test/desktopSync.test.js` (the notifier reaches the command with the units intact) and `desktop_sync.rs::dirty_units_are_grouped_per_workspace_with_the_open_one_as_empty` through a test probe `op_sync_dirty_groups`. Plus a bounded drain retry (5 s, up to 12 per episode) after a send meets an engine event in flight — the reason every start logged "sync send postponed; 9 unit(s) held durably" and never settled, and the reason a fresh Mac edit would otherwise wait on the engine's own discretionary schedule.

**Recovery of the edits dropped today:** dev-only, `defaults write com.resumedesigner.app op-sync-full-upload-owed-<profile> -bool true` for both real profiles, so the next start performs a full upload (newest stamp wins on the server; the Mac's edits are the newest).

- [x] **Verified 2026-09-20 15:40:** the log showed `dirty: 2 unit(s) for the open workspace — sent` and Ash saw the edit on the iPhone within seconds; "syncing back and forth between mac and iphone/ipad seems to work well now."
- [x] Commit — `256c857a`, `fix(desktop): send the page's dirty units, the half of the bridge that was missing`

### Task 10: Codex's read-only audit of the Mac path (gpt-6-astra, 2026-09-20 15:55) — what it confirmed and what is left

Full output: session scratchpad `codex-audit.out` (30 KB); the ranked findings are summarised here so they survive the session.

**Confirmed correct:** the `syncDirty` routing (page → `desktop_sync_dirty` → `op_sync_dirty` → grouped per workspace, `""` → `nil`), the notifier ordering (desktop replaces the iOS install), the entitlement keys and registration, `fetchNow`'s options surviving `nextFetchChangesOptions`. Codex found no public contract for a fetch throttle: the 1 ms timer fetches were internal coalescing/suppression, and a raised QoS cannot prioritise an operation that was never created.

**Done in the second batch (same day):**
- [x] E1 — a failed bridge reply (encode failure, deadline, reload mid-request) for fetched units or conflicts is now held durably (`holdUnaccounted`) instead of returning empty; iOS's outer wrappers already did this.
- [x] A — `sendSync` with no engine defers the ids instead of returning `false` and losing them; the open workspace's id is bound ON THE PAGE at init (`desktopSync.js`) so a workspace switch mid-flight cannot re-route units; `initIOSShell` no longer installs a no-op notifier off iOS (the model deletes what it hands a notifier, so a no-op dropped every unit flushed before the desktop's install).
- [x] B — the drain retry fires only on `eventInFlight`; other errors defer without retrying.
- [x] C — the original 30 s engine-fetch timer was removed; the activation fetch stayed (measured 1–2 s to a landing). Task 12 later added a timer using direct database discovery after another engine-only timer failed the focused-window hardware test.
- [x] E9 — `resolveConflicts` now awaits `reconcileRemoteDeletions` like `applyUnits` does (shared model).

**Audit follow-ups, now implemented unless explicitly noted:**
- [x] **P1 E2 — done, with a lock rather than the actor.** Every read-modify-write of the durable ledgers and the drain's re-owed bookkeeping now runs inside `withLedger` (an `NSLock` taken and released in one synchronous frame, never across an await). Chosen over `@MainActor` isolation because the synchronous C test probes — the only way the ledger logic is exercised at all — cannot hop to a main actor under `cargo test`; the lock fixes the stated defect (a non-atomic transaction) and keeps those tests. The hoist reads under the lock, releases for the bridge round trip, and takes it again for the move.
- [x] **P1 E6 — done.** `syncDidPurgeFromICloud` writes the durable marker (`resume-designer-sync-suspended`, the same key and rule as OPShell) SYNCHRONOUSLY before any hop, notifies the page, and stops the engine + forgets the server's bookkeeping on the lifecycle chain. `runStart`, `sendSync` and (through them) activation and the drain are gated on the marker. `resumeSyncing` (C entry `op_sync_resume_after_purge`, command `desktop_sync_resume`, page `window.__opDesktopSync.resumeAfterPurge()`) re-owes every full upload, stops-and-forgets, clears the marker, notifies `syncResumed`, and starts again — in that order, as OPShell. The Settings action was added under P3 below.
- [x] **P1 D — done (the serialization; the shared design weakness is noted, not changed).** `enqueueLifecycle` chains start, activation, account switch, purge, resume and the exit stop, exactly as OPShell's `syncStart` tail does. Activation now runs the FULL start pass (`runStart(reason: "activation")`) on the chain: zones reconciled, debt drained, owed uploads paid, then the pull at user-initiated QoS. The start-order comment now says what the desktop does and why it differs from iOS (the collect here is a request with an answer, not a message racing the splash).
- [x] **P1 E3 — done.** `syncDidFail` is OPShell's: a `needsDurableRetry` failure goes into that workspace's durable queue; a unit's first TERMINAL failure per scope per session gets one recovery send in a detached main-actor task (`syncRecovered`, reset on profile change and stop). Detachment was the Task 11 correction; simply delaying the send did not clear the delegate task-local.
- [x] **P1 E8 — done.** Once the retry stopped masking it, the startup drain's error was `notStarted`, not `eventInFlight`: the only deferred queue on the Mac was `op-sync-deferred-pmstrxwak1gb1nia1jtixyf`, the first workspace Ash deleted on the phone, whose nine refused units were re-offered at every start into a zone that no longer exists. The page now reports the registry's durably tombstoned ids at start (`listTombstonedProfileIds`, read from the registry on disk) and `DesktopSyncHost.settleDeadWorkspaces` clears their deferred queue and full-upload flag; an unknown-but-live workspace keeps its debt. Rust test through `op_sync_settle_dead`; JS test on the report.
- [x] **P2 E4 — done.** A `syncLanded` notice whose scopes include the shared zone makes the page re-report the registry (`desktop_sync_profiles` → `op_sync_profiles` → `reportProfiles`): metadata only — the dead-workspace settle synchronously, then `engine.adoptProfileZones(known + open)` on the main actor. JS test: a workspace landing does not report, a shared landing does.
- [x] **P2 E5 — done.** `desktop_sync_account_profiles` is an async command: Rust parks a oneshot under an issued id, Swift reads the one shared registry record (`lookupAccountProfiles`, OPShell's verbatim, 8 s ceiling in a task group) and answers on a second callback (`op_sync_register_answer`); the page (`askDesktopAccountProfiles`, its own 9 s ceiling, unavailable on any failure — never empty) feeds `ensureProfilesInitialized` on darwin. The first pull's settle is announced too (`syncInitialProfileFetchSettled` → `markInitialProfileFetchSettled`), so first-run work deferred until fetched content is released. Rust tests for the answer plumbing; JS test for the settle.
- [x] **P2 E7 — done.** The activation observer is installed before the account check, and an activation runs the full start pass, so a Mac signed out at launch is picked up by its next activation. `syncDidSwitchAccounts` re-owes and then runs the start pass on the chain, so the new account's uploads are paid now rather than at the next launch.
- [x] **P2 B — done.** The retry is a retained task, cancelled by every stop and purge; it fires only for `eventInFlight`; the counter still resets on a successful send, which is the episode boundary that matters here.
- [x] **P3 — done where cheap.** The stale `syncRefused` line is corrected; the Rust request preview shows 160 characters instead of 80 (the `kind` was being cut off). The resume-after-purge action now has its UI: `SyncSuspendedRow` in Settings → Account, shown only while the page's suspension key is set AND the desktop bridge is present (component test `test/syncSuspendedRow.test.jsx`; the bridge announces `rd:sync-suspension-changed` on purge/resume). Still open: no desktop UI shows sync status or parked losers.
- [ ] Not needed for shipped users (no shipped Mac ever had the one-way bridge): the one-time "re-owe full uploads" migration Codex proposed; Ash's Mac was recovered with the dev-only `defaults write`.

### Task 11: the delegate-callback reentrancy crash (2026-09-20 20:40) — cause, fix, guard

**What happened.** The 16:32 build died at 20:40:08, right after a Mac dirty send hit a
partial save failure: `Server Record Changed` on `key:resume-designer-history-custom-1785991497695`
(the server's copy undecodable in the error, so OPSync reported it terminal as "conflict on an
unreadable record") and an atomic `Batch Request Failed` on its résumé. `syncDidFail` ran inside
the engine's delegate callback and spawned its durable defer and the per-scope recovery send as
`Task { @MainActor in … }`. The recovery send asked the page for scopes, queued the records,
passed OPSync's `delegateEventInFlight` check (the event had ended by then) and called
`sendChanges()`:

    CloudKit/CKSyncEngine.swift:318: Fatal error: BUG IN CLIENT OF CLOUDKIT: Cannot await a call
    into CKSyncEngine from within a delegate callback if that function will end up calling back
    into the delegate. … Try performing this in a detached Task.

**Cause.** CloudKit marks the TASK that runs a delegate callback (a task-local), not the moment.
An unstructured `Task {}` copies task-locals at creation, so a task created inside a callback
stays "within the callback" for its whole life; `Task.detached` copies nothing. OPSync's guard is
time-based and cannot see this. The runtime trap and callback task creation identified the reentrancy problem.
The original release binary was stripped (`[profile.release] strip = true`),
which limited attribution of individual app frames; dev builds now retain symbols.

**Fix (committed as `275f8499`).**
- [x] `DesktopSyncHost.swift`: `syncDidFail`'s defer and recovery tasks, `enqueueLifecycle`
      (reached from the `syncDidSwitchAccounts` and `syncDidPurgeFromICloud` callbacks) and
      `scheduleDrainRetry` are `Task.detached { @MainActor [weak self] in … }`.
- [x] `test/desktopSyncHostShape.test.js`: reads the Swift source; no inheriting `Task {` inside
      the `OPSyncHost` extension, and both helpers detach. Strips `//` comments first, because the
      comments quote the forbidden form. Red on the old host, green on the fixed one.
- [x] `scripts/build-mac-dev.sh`: `CARGO_PROFILE_RELEASE_STRIP=false`, so a dev crash report
      names its frames. `-g` on swiftc was not needed: symbol names suffice.
- [x] NOT added: a host-level send-in-flight flag. CKSyncEngine serializes concurrent
      `sendChanges()` calls itself; its only fatal precondition is the delegate one, and OPSync's
      `send` already queues the records before it forces a send.
- [x] Gates: shape test 3/3, vitest 1718 / 102 files, `swiftc -typecheck`, `cargo test
      desktop_sync` 10 (recompiles the Swift library), eslint clean. Rust is unchanged, so clippy
      and the Windows cross-check do not apply.
- [x] Hardware: REPRODUCED ON LAUNCH, 2026-09-21 00:25 (pid 85960). The 20:39 conflict was still
      in the durable ledger; the start pass drained it, the same two failure lines appeared
      (00:25:22.420), `syncDidFail` ran its recovery send, the recovery re-failed on the history
      key (00:25:24.114), and the process survived: `start pass done in 8003 ms`. The same
      sequence killed the 16:32 build at 20:40:08. A fresh device-vs-Mac conflict is still a
      worthwhile check, but no longer the only way to exercise the path.
- [x] Committed on Ash's word as `275f8499`, `fix(desktop): detach the sync tasks that delegate
      callbacks create` (2026-09-21 ~00:40). Fifteen commits on the branch, nothing pushed.

**Follow-up defects, resolved by Task 12 in `b9594c38`.** The triggering conflict
remained stuck because `unit(from:)` needs an inline payload or readable asset
bytes, while the conflict error's server record could carry an asset without a
file URL. The shared transport now fetches that record directly before resolving
it. The same callback task shape was present in iOS's defer, recovery-send and
purge callbacks; all three now detach, with a source-shape test over the entire
`OPSyncHost` conformance.

### Task 12: Asset conflicts and focused-window discovery (2026-09-21)

**Shared conflict path.** `opReadConflict` materializes the attempted local unit
before suspension, uses an already-readable server record directly, and otherwise
downloads the record once using its complete record ID, including its zone. A
readable result enters the existing `Conflict` → `syncDidConflict` → model resolver
path, preserving winner selection, parked losers and change-tag accounting.
A still-unreadable result or ordinary fetch failure follows the terminal-failure
path; `userDeletedZone` suspends sync. Stale-engine and cancellation checks reject
late results. The helper calls `CKDatabase`, not a reentrant engine fetch.

**Why a new foreground reader was necessary.** A timer calling the full start
pass still failed on hardware: at 15:20:14, `CKSyncEngine` logged “no zone IDs
needing to be fetched, not fetching changes.” Activation at 15:20:35 caused
database discovery and then the fetch. This happened before the options delegate,
so preserving its fetch scope or raising operation QoS could not fix that no-op.

**Final foreground path.** `DesktopSyncHost` permits one queued/running timer
pass while active, rechecks current state on the lifecycle chain, drains outgoing
debt, then calls `fetchForegroundChanges()`. The macOS-only reader requests record
headers through `CKDatabase.recordZoneChanges`, shared zone first, with at most
two pages of 100 records per zone per pass. It downloads only records with missing
or different remembered tags and keeps independent in-memory cursors.

The complete selected page is downloaded before application, and readable asset
bytes are materialized before further awaits. `OPSyncIngressGate` serializes page
ingestion, delegate events and existing direct-record recovery. Lifecycle epochs,
engine identity and tag revalidation reject raced results; the cursor advances
only after durable accounting. Server retry-after is respected, expired cursors
restart on a later tick, and a Settings purge suspends sync. No engine operation
that can re-enter the delegate is awaited while holding the ingestion gate.

- [x] iOS callback comments and `iosSyncHostShape.test.js` enforce detachment.
- [x] Native fixtures exercise seven conflict-reader and ten foreground-reader /
      ingestion scenarios; Vitest also checks production wiring.
- [x] Both apps built, installed and verified bidirectionally. Real Mac asset
      conflict recovery and focused Mac receipt passed; see **Latest verification**.
- [x] Committed as `b9594c38`, `fix(sync): recover asset conflicts and refresh the foreground mac app`.

## Out of scope, deliberately

- The API key on the Mac (shared `keychain-access-groups`) — its own change; `secret_get` already falls back locally.
- ~~Silent push on macOS~~ — pulled in as Task 8 on 2026-09-20.
- Windows — no CloudKit; the build must not change and Task 1/4's Windows checks prove it does not.
