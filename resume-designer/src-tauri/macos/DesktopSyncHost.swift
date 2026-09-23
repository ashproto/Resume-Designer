// The desktop half of the sync host. The transport is ../ios/OPSync.swift,
// compiled alongside this file into one static library (see build.rs) — one
// transport, two hosts.
//
// This host never touches a webview. Every `OPSyncHost` method marshals its
// argument to JSON, parks a continuation under a fresh id, and hands the pair
// to Rust through a callback Rust registered at startup. Rust evaluates a call
// into the page; the page answers through a Tauri command carrying the id;
// Rust calls `op_sync_resume`, and the continuation resumes. Only JSON strings
// cross the ABI — the Swift side decodes into the same `SyncUnit` /
// `SyncConflict` types iOS uses, so `test/swiftContract.test.js` keeps guarding
// the field contract unchanged.
//
// NOTHING here calls back into the engine from inside a host method. That is
// the reentrancy rule the iOS host learned from a CloudKit trap (bb0dedd), and
// this host keeps it by construction: a method hands off to Rust and awaits.

import Foundation
import CloudKit
import AppKit

public typealias OPSyncRustCallback = @convention(c) (UInt64, UnsafePointer<CChar>) -> Void

enum OPDesktopSyncError: Error {
  case host(String)
  case refused(String)
}

final class DesktopSyncHost {
  private var callback: OPSyncRustCallback?
  private var pending: [UInt64: CheckedContinuation<Any, Error>] = [:]
  private var nextId: UInt64 = 1
  private let lock = NSLock()
  /// Every request has a deadline; one that outlives it resumes with a failure,
  /// which the transport treats as "this device cannot answer right now" and
  /// never as data. Long enough for a landing that waits on the disk.
  private let deadline: TimeInterval = 30

  /// NOT created in init. `OPSyncEngine` constructs its `CKContainer` as a
  /// stored property, and outside a signed, entitled bundle that throws — so
  /// the engine exists only once the page has reported a profile, which no
  /// test ever does.
  private var engine: OPSyncEngine?

  // ── THE TWO LEDGERS ─────────────────────────────────────────────────────
  // Ported from the iOS host (OPShell.swift), and DUPLICATED there on purpose:
  // hoisting them into OPSync.swift would edit shipped iOS code for a desktop
  // feature. Same keys — the transport defines them — same carrier
  // (UserDefaults, under the app's bundle domain), same behaviour. Native
  // suspension is authoritative on both platforms; the desktop page mirrors
  // it for its model and Settings UI and reconciles it at every page startup.
  //
  // Why they exist: CKSyncEngine treats a fetched record as delivered once the
  // delegate returns. A unit the page refused (mid-edit) or a conflict it did
  // not resolve would never come back on its own; the deferred ledger re-offers
  // it at the next start. And a workspace the mesh has never seen owes a FULL
  // upload of everything this device holds for it — the flag that makes a Mac
  // with existing data upload it at all.
  private static let sharedDeferredKey = OPSyncEngine.deferredKey("_\(opSharedScope)")
  private static func fullUploadKey(_ profileId: String) -> String { "op-sync-full-upload-owed-\(profileId)" }
  private var syncProfileId: String?
  private var knownProfileIds: [String] = []
  private var syncDraining = false
  private var syncDrainAgain = false
  /// The key being drained, while one is. `addSyncDeferred` consults it: an id
  /// re-owed DURING a drain must not be settled by that drain's success.
  private var syncDeferredDrainKey: String?
  private var syncDeferredReowed: Set<String> = []
  /// Bumped on every owe. A full upload settles only if this did not move
  /// during its send — otherwise the debt was re-owed mid-flight and stays.
  private var syncFullUploadOwe: [String: Int] = [:]
  /// Foreground refresh, installed once per process before the account check.
  /// See `installForegroundRefresh`.
  private var foregroundRefreshInstalled = false
  /// An explicit stop disables timer work until another start enables it.
  private var foregroundRefreshEnabled = false
  /// Includes the time spent waiting behind earlier lifecycle work.
  private var foregroundTimerPending = false
  /// A send that met an engine event in flight is re-drained shortly after,
  /// once per episode; see `scheduleDrainRetry`.
  private var drainRetries = 0
  /// The purge marker, set SYNCHRONOUSLY when the engine reports the purge and
  /// cleared only by `resumeSyncing` — the same key and the same rule as OPShell.
  private static let syncSuspendedKey = "resume-designer-sync-suspended"
  private let suspensionDefaults: UserDefaults
  private var syncSuspended: Bool
  /// Process-local ordering lets the page reject an older startup answer that
  /// arrives after a purge or resume notice. A page reload reads a new snapshot.
  private var suspensionRevision = 0
  /// See `enqueueLifecycle`.
  private var lifecycleTail: Task<Void, Never>?
  private var tombstonedProfileIds: [String] = []
  /// One recovery send per scope per session, as OPShell keeps it.
  private var syncRecovered: Set<OPSyncScope> = []
  private var drainRetryTask: Task<Void, Never>?
  /// Answers to the page's own questions (account profiles and suspension), keyed by
  /// the id Rust issued — a second callback because the first is Swift asking.
  private var answerCallback: OPSyncRustCallback?
  /// Guards every read-modify-write of the durable ledgers and the drain's
  /// bookkeeping: they run from main-actor callers AND nonisolated async ones.
  private let ledger = NSLock()

  init(suspensionDefaults: UserDefaults = .standard) {
    self.suspensionDefaults = suspensionDefaults
    self.syncSuspended = suspensionDefaults.bool(forKey: Self.syncSuspendedKey)
  }
  /// Synchronous on purpose: the lock is taken and released inside one
  /// non-async frame, never across an await, which is also what keeps the
  /// compiler's async-context lock diagnostic quiet.
  private func withLedger<T>(_ body: () -> T) -> T {
    ledger.lock(); defer { ledger.unlock() }
    return body()
  }

  func register(_ cb: @escaping OPSyncRustCallback) { callback = cb }

  // MARK: The crossing

  /// Ask the page something and wait for its answer. The page replies with
  /// `{ ok, value }` or `{ ok: false, error }`; the value is unwrapped here.
  func request(_ kind: String, _ payload: [String: Any] = [:]) async throws -> Any {
    var body = payload
    body["kind"] = kind
    guard JSONSerialization.isValidJSONObject(body),
          let data = try? JSONSerialization.data(withJSONObject: body),
          let json = String(data: data, encoding: .utf8) else {
      throw OPDesktopSyncError.host("could not encode a \(kind) request")
    }
    let raw: Any = try await withCheckedThrowingContinuation { cont in
      lock.lock()
      let id = nextId
      nextId += 1
      pending[id] = cont
      lock.unlock()
      json.withCString { callback?(id, $0) }
      DispatchQueue.global().asyncAfter(deadline: .now() + deadline) { [weak self] in
        self?.settle(id, .failure(OPDesktopSyncError.host("\(kind) did not answer within \(Int(self?.deadline ?? 0))s")))
      }
    }
    guard let reply = raw as? [String: Any] else {
      throw OPDesktopSyncError.host("\(kind) reply was not an object")
    }
    if reply["ok"] as? Bool == true { return reply["value"] ?? NSNull() }
    throw OPDesktopSyncError.refused(reply["error"] as? String ?? "\(kind) was refused")
  }

  /// Tell the page something and do not wait. Id 0 is the fire-and-forget id;
  /// the page never replies to it.
  func notify(_ kind: String, _ payload: [String: Any] = [:]) {
    var body = payload
    body["kind"] = kind
    guard JSONSerialization.isValidJSONObject(body),
          let data = try? JSONSerialization.data(withJSONObject: body),
          let json = String(data: data, encoding: .utf8) else { return }
    json.withCString { callback?(0, $0) }
  }

  /// Which zone each unit belongs in. Nonisolated on purpose: the hoist calls
  /// it from a plain Task, and `cargo test` pumps no main loop — a hop to the
  /// `@MainActor` witness would hang there. The witness calls this too.
  func scopes(forUnitIds ids: [String]) async -> [String: String]? {
    guard let idsData = try? JSONSerialization.data(withJSONObject: ids),
          let idsJson = String(data: idsData, encoding: .utf8),
          let value = try? await request("syncScopes", ["unitIds": idsJson]),
          let scopes = value as? [String: String] else {
      return nil
    }
    return scopes
  }

  // MARK: Deferred-send ledger (UserDefaults, transport-defined keys)

  func syncDeferred(key: String) -> Set<String> {
    withLedger { readDeferred(key) }
  }
  /// Callers hold `ledger`. `UserDefaults` makes each call atomic; the lock is
  /// what makes a read-union-write atomic, which two deferrals racing from a
  /// main-actor drain and a nonisolated refusal used to lose.
  private func readDeferred(_ key: String) -> Set<String> {
    Set(UserDefaults.standard.stringArray(forKey: key) ?? [])
  }
  private func writeDeferred(_ unitIds: Set<String>, key: String) {
    UserDefaults.standard.set(Array(unitIds).sorted(), forKey: key)
  }
  func addSyncDeferred(_ unitIds: Set<String>, key: String) {
    guard !unitIds.isEmpty else { return }
    withLedger {
      writeDeferred(readDeferred(key).union(unitIds), key: key)
      // An id re-owed DURING a drain must not be settled by that drain's success.
      if syncDeferredDrainKey != nil { syncDeferredReowed.formUnion(unitIds) }
    }
  }
  private func deferSync(_ unitIds: [String], inProfile requested: String? = nil) async {
    guard let profileId = requested ?? syncProfileId else {
      NSLog("[OPDesktopSync] no active profile for \(unitIds.count) deferred sync unit(s)")
      return
    }
    let ids = Array(Set(unitIds)).sorted()
    guard !ids.isEmpty else { return }
    addSyncDeferred(Set(ids), key: OPSyncEngine.deferredKey(profileId))
    guard let scopes = await scopes(forUnitIds: ids) else { return }
    let shared = Set(ids.filter { scopes[$0] == opSharedScope })
    addSyncDeferred(shared, key: Self.sharedDeferredKey)
  }
  /// Move shared-scoped ids out of every profile queue into the shared one; the
  /// scope answer is a bridge round trip, so the ledger is read under the lock,
  /// released for the ask, and taken again for the move.
  func hoistSharedSyncDeferred() async {
    let prefix = OPSyncEngine.deferredKey("")
    let (queueKeys, offered): ([String], Set<String>) = withLedger {
      let keys = UserDefaults.standard.dictionaryRepresentation().keys
        .filter { $0.hasPrefix(prefix) && $0 != Self.sharedDeferredKey }
      var all: Set<String> = []
      for key in keys { all.formUnion(readDeferred(key)) }
      return (Array(keys), all)
    }
    guard !offered.isEmpty,
          let scopes = await scopes(forUnitIds: Array(offered).sorted()) else { return }
    let shared = Set(offered.filter { scopes[$0] == opSharedScope })
    guard !shared.isEmpty else { return }
    withLedger {
      writeDeferred(readDeferred(Self.sharedDeferredKey).union(shared), key: Self.sharedDeferredKey)
      if syncDeferredDrainKey != nil { syncDeferredReowed.formUnion(shared) }
      for key in queueKeys {
        let queue = readDeferred(key)
        let remaining = queue.subtracting(shared)
        if remaining != queue { writeDeferred(remaining, key: key) }
      }
    }
  }
  func deferredProfileQueueIds() -> [String] { deferredProfileQueues().map(\.0) }
  private func deferredProfileQueues() -> [(String, String)] {
    let prefix = OPSyncEngine.deferredKey("")
    return UserDefaults.standard.dictionaryRepresentation().keys
      .filter { $0.hasPrefix(prefix) && $0 != Self.sharedDeferredKey }
      .sorted()
      .map { (String($0.dropFirst(prefix.count)), $0) }
  }
  /// Re-entrant by request, not by recursion: a drain asked for while one runs
  /// sets a flag, and the running drain takes one more pass. Overlapping drains
  /// would settle each other's offers.
  @MainActor private func drainSyncDeferred() async {
    guard !syncDraining else { syncDrainAgain = true; return }
    syncDraining = true
    var passes = 0
    repeat {
      syncDrainAgain = false
      await hoistSharedSyncDeferred()
      await drainSyncDeferred(key: Self.sharedDeferredKey)
      for (queueProfileId, key) in deferredProfileQueues() {
        await drainSyncDeferred(key: key, inProfile: queueProfileId)
      }
      passes += 1
    } while syncDrainAgain && passes < 2
    syncDraining = false
  }
  /// Settle-on-success with the re-owed set: an id re-owed DURING the send
  /// (a landing refused mid-edit, a conflict) stays, everything else offered
  /// is cleared. The bookkeeping lives under `ledger` because `addSyncDeferred`
  /// writes the re-owed set from nonisolated callers while this runs.
  @MainActor private func drainSyncDeferred(key: String, inProfile profileId: String? = nil) async {
    let offered = syncDeferred(key: key)
    guard !offered.isEmpty else { return }
    withLedger {
      syncDeferredDrainKey = key
      syncDeferredReowed.removeAll()
    }
    let sent = await sendSync(unitIds: Array(offered), inProfile: profileId)
    withLedger {
      let reowed = syncDeferredReowed
      syncDeferredDrainKey = nil
      syncDeferredReowed.removeAll()
      guard sent else { return }
      writeDeferred(readDeferred(key).subtracting(offered.subtracting(reowed)), key: key)
    }
  }
  /// `true` only when the engine accepted the send. Suspended is `false` and
  /// holds nothing — the resume re-owes every full upload, which covers it; a
  /// throw defers the ids durably and is `false`.
  @MainActor private func sendSync(unitIds: [String], inProfile profileId: String? = nil) async -> Bool {
    guard !unitIds.isEmpty else { return true }
    guard !syncSuspended else {
      NSLog("[OPDesktopSync] iCloud sync is suspended; \(unitIds.count) unit(s) not sent")
      return false
    }
    let owning = profileId ?? syncProfileId
    // No engine — not started yet, stopped, or the account unavailable — is not
    // a reason to lose the ids: held durably, the next start's drain sends them.
    guard let engine else {
      await deferSync(unitIds, inProfile: owning)
      NSLog("[OPDesktopSync] sync send held; no engine (\(unitIds.count) unit(s))")
      return false
    }
    do {
      try await engine.send(unitIds: unitIds, inProfile: owning)
      drainRetries = 0
      return true
    } catch OPSyncError.eventInFlight {
      // The bytes are already queued in the engine (`send` queues before it
      // throws); the ledger keeps the debt, and a short retry settles it once
      // the event is over — the one error a retry can do anything about.
      await deferSync(unitIds, inProfile: owning)
      NSLog("[OPDesktopSync] sync send postponed; \(unitIds.count) unit(s) held durably")
      scheduleDrainRetry()
      return false
    } catch {
      await deferSync(unitIds, inProfile: owning)
      NSLog("[OPDesktopSync] sync send failed (\(error)); \(unitIds.count) unit(s) held durably")
      return false
    }
  }

  // MARK: Full-upload ledger

  private func syncFullUploadOwed(profileId: String) -> Bool {
    UserDefaults.standard.bool(forKey: Self.fullUploadKey(profileId))
  }
  private func syncFullUploadConsidered(profileId: String) -> Bool {
    UserDefaults.standard.object(forKey: Self.fullUploadKey(profileId)) != nil
  }
  private func setSyncFullUploadOwed(_ owed: Bool, profileId: String) {
    if owed { syncFullUploadOwe[profileId, default: 0] += 1 }
    UserDefaults.standard.set(owed, forKey: Self.fullUploadKey(profileId))
  }
  private func oweFullUploadForEveryConsideredProfile() {
    let prefix = Self.fullUploadKey("")
    var ids = Set(UserDefaults.standard.dictionaryRepresentation().keys
      .filter { $0.hasPrefix(prefix) }
      .map { String($0.dropFirst(prefix.count)) })
    ids.formUnion(knownProfileIds)
    for id in ids { setSyncFullUploadOwed(true, profileId: id) }
    NSLog("[OPDesktopSync] a full upload is owed again for \(ids.count) profile(s)")
  }
  /// Ask the page for everything it would push for the profile, offer it, and
  /// settle the debt only if nothing re-owed it mid-send.
  @MainActor private func performFullUpload(profileId: String) async {
    guard syncFullUploadOwed(profileId: profileId) else { return }
    guard let value = try? await request("syncCollect", ["profileId": profileId]),
          let object = value as? [String: Any],
          let entries = object["units"] as? [[String: Any]] else {
      NSLog("[OPDesktopSync] no usable answer for \(profileId)'s full upload")
      return
    }
    let unitIds = entries.compactMap { $0["id"] as? String }
    NSLog("[OPDesktopSync] offering \(unitIds.count) unit(s) for \(profileId)'s full upload")
    let owed = syncFullUploadOwe[profileId, default: 0]
    let sent = await sendSync(unitIds: unitIds, inProfile: profileId)
    guard sent else { return }
    guard syncFullUploadOwe[profileId, default: 0] == owed else {
      NSLog("[OPDesktopSync] \(profileId)'s full upload was re-owed mid-send; keeping the debt")
      return
    }
    setSyncFullUploadOwed(false, profileId: profileId)
  }

  func resume(_ id: UInt64, json: String) {
    guard let data = json.data(using: .utf8),
          let value = try? JSONSerialization.jsonObject(with: data) else {
      settle(id, .failure(OPDesktopSyncError.host("reply \(id) was not JSON")))
      return
    }
    settle(id, .success(value))
  }

  /// Exactly once per id: the first of a reply and its deadline wins, the
  /// other finds nothing parked and does nothing. A reply for an id that was
  /// never issued is ignored the same way — not a crash.
  private func settle(_ id: UInt64, _ result: Result<Any, Error>) {
    lock.lock()
    let cont = pending.removeValue(forKey: id)
    lock.unlock()
    cont?.resume(with: result)
  }

  // MARK: Lifecycle, driven from Rust

  /// The engine is `@MainActor` (its iOS caller is a SwiftUI model), so every
  /// engine call is made from a main-actor task. In the app the AppKit loop
  /// pumps it; no test reaches this, so no test can hang on it.
  func start(profileId: String, knownProfileIds: [String], tombstonedProfileIds: [String] = []) {
    Task { @MainActor in
      self.enqueueLifecycle {
        await self.runStart(profileId: profileId, knownProfileIds: knownProfileIds,
                            tombstonedProfileIds: tombstonedProfileIds, reason: "start")
      }
    }
  }

  @MainActor private func runStart(
    profileId: String, knownProfileIds: [String], tombstonedProfileIds: [String], reason: String
  ) async {
    let began = Date()
    guard !profileId.isEmpty else {
      NSLog("[OPDesktopSync] no active profile — sync stays down")
      notify("syncInitialProfileFetchSettled", ["status": "unavailable"])
      return
    }
    // A paused cold launch still needs the page's profile context: an explicit
    // resume can then start this workspace without depending on another reload.
    // Recording metadata does not construct an engine or change upload debt.
    let profileChanged = syncProfileId != profileId
    syncProfileId = profileId
    self.knownProfileIds = knownProfileIds
    self.tombstonedProfileIds = tombstonedProfileIds
    // THE GATE, as OPShell has it: every way the transport comes up runs
    // through here. A purge means the account's owner emptied this app's
    // iCloud data; an automatic start would recreate the zone and put this
    // device's workspaces back. Nothing clears the marker except `resumeSyncing`.
    guard !syncSuspended else {
      NSLog("[OPDesktopSync] this app's iCloud data was deleted by the account's owner — "
            + "the transport stays down and nothing is re-sent")
      notify("syncState", ["state": "suspended"])
      notify("syncInitialProfileFetchSettled", ["status": "unavailable"])
      return
    }
    if profileChanged {
      // A different profile is a different zone and a different engine session,
      // so the previous session's process-local recovery does not carry over.
      // Profile-scoped deferred ids stay under that profile's persisted key.
      syncRecovered.removeAll()
      withLedger {
        syncDeferredDrainKey = nil
        syncDeferredReowed.removeAll()
      }
    }
    settleDeadWorkspaces(tombstonedProfileIds)
    // A workspace this device has never started sync for owes the mesh a full
    // upload of everything held for it. Decided BEFORE start, from the page's
    // list — the page owns the registry.
    for known in knownProfileIds where !syncFullUploadConsidered(profileId: known) {
      NSLog("[OPDesktopSync] first gated start seen for \(known) — a full upload is owed")
      setSyncFullUploadOwed(true, profileId: known)
    }
    let engine = self.engine ?? OPSyncEngine(host: self)
    self.engine = engine
    foregroundRefreshEnabled = true
    installForegroundRefresh()
    let state = await engine.start(profileId: profileId, knownProfileIds: knownProfileIds)
    guard state == .available else {
      // Signed out, restricted, or iCloud not reachable. All normal, none an
      // error, and NOTHING local changes because of them. The next activation
      // tries again.
      NSLog("[OPDesktopSync] sync is not running: \(state)")
      notify("syncState", ["state": "\(state)"])
      notify("syncInitialProfileFetchSettled", ["status": "unavailable"])
      return
    }
    notify("syncState", ["state": "available"])
    // SILENT CloudKit pushes, the same single call OPShell makes on iOS: the
    // engine discovers or creates its own CKDatabaseSubscription and schedules a
    // fetch when a notification arrives, so there is no delegate to forward from
    // (Tauri owns the app delegate anyway). Needs com.apple.developer.aps-environment
    // in the signed entitlements. Idempotent, so every pass may call it.
    NSApplication.shared.registerForRemoteNotifications()
    if reason == "start" { NSLog("[OPDesktopSync] registered for silent CloudKit pushes") }
    // THE ORDER, and each step is why. The shared zone first: it holds the
    // registry, which is how a Mac that has just joined learns the account's
    // workspaces. Then the debt — anything this device still owes a send of
    // goes up BEFORE the pull, so a unit changed on both sides meets the
    // conflict path rather than being overwritten. Then the full uploads owed,
    // for the same reason; iOS asks for those after its pull only because there
    // the collect is a fire-and-forget page message that must not race the
    // launch splash, while here it is a request with an answer. Then the pull,
    // at user-initiated quality of service: someone is waiting on it.
    try? await engine.fetchShared()
    await drainSyncDeferred()
    for owing in knownProfileIds where syncFullUploadOwed(profileId: owing) {
      await performFullUpload(profileId: owing)
    }
    var settled = "ready"
    do {
      if reason == "foreground-timer" {
        try await engine.fetchForegroundChanges()
      } else {
        try await engine.fetchNow()
      }
    } catch {
      settled = "unavailable"
      NSLog("[OPDesktopSync] the pull did not complete: \(error)")
    }
    // The page defers first-run work until the first pull has settled or
    // become unavailable, so onboarding cannot race ahead of fetched content.
    notify("syncInitialProfileFetchSettled", ["status": settled])
    NSLog("[OPDesktopSync] \(reason) pass done in \(Int(Date().timeIntervalSince(began) * 1000)) ms")
  }

  /// Push remains the background path. While the app stays frontmost, a timer
  /// drains outgoing debt, then asks CKDatabase for incoming changes directly.
  /// On macOS, CKSyncEngine's manual fetch can return without discovering any
  /// changed zones until a push or activation invalidates its internal state.
  /// Repeating that call did not fetch edits during the focused-window test.
  /// Thirty seconds bounds the cadence of attempts, not CloudKit's latency.
  /// Installed before the account check, so a Mac that is signed out at launch
  /// and signs in later is picked up by a later foreground pass.
  @MainActor private func installForegroundRefresh() {
    guard !foregroundRefreshInstalled else { return }
    foregroundRefreshInstalled = true
    NotificationCenter.default.addObserver(
      forName: NSApplication.didBecomeActiveNotification, object: nil, queue: .main
    ) { [weak self] _ in
      Task { @MainActor in self?.activate() }
    }
    let tick: @MainActor @Sendable () -> Void = { [weak self] in self?.foregroundTimerTick() }
    Timer.scheduledTimer(withTimeInterval: 30, repeats: true) { _ in
      Task.detached { @MainActor in tick() }
    }
    NSLog("[OPDesktopSync] foreground refresh installed: activation fetch and direct discovery every 30 s while frontmost")
  }

  @MainActor private func foregroundTimerTick() {
    guard foregroundRefreshEnabled, NSApplication.shared.isActive, !syncSuspended, !foregroundTimerPending else { return }
    foregroundTimerPending = true
    enqueueLifecycle { [self] in
      defer { foregroundTimerPending = false }
      // Earlier queued work may have stopped sync, purged it, or switched the
      // profile. Use the state now, so a stale tick cannot restart the old one.
      guard foregroundRefreshEnabled, NSApplication.shared.isActive, !syncSuspended,
            let profileId = syncProfileId else { return }
      await runStart(profileId: profileId, knownProfileIds: knownProfileIds,
                     tombstonedProfileIds: tombstonedProfileIds, reason: "foreground-timer")
    }
  }

  @MainActor private func activate() {
    // No profile reported yet means no engine; the start that follows fetches
    // for itself.
    guard let profileId = syncProfileId else { return }
    enqueueLifecycle { [self] in
      await runStart(profileId: profileId, knownProfileIds: knownProfileIds,
                     tombstonedProfileIds: tombstonedProfileIds, reason: "activation")
    }
  }

  /// `syncDirty`, the desktop way. The page names units whose bytes reached
  /// disk, each with the workspace they belong to (`""` is the open one), and
  /// they are sent PER WORKSPACE — the grouping OPShell's handler does, because
  /// a unit routed to the open workspace's zone when it belongs to another is
  /// one person's résumé in another's workspace. Without this path the Mac
  /// never sent an edit: its only uploads were the one-time full ones.
  func syncDirty(_ units: [[String: Any]]) {
    let byProfile = Self.groupDirty(units)
    guard !byProfile.isEmpty else { return }
    Task { @MainActor in
      for (profileId, unitIds) in byProfile {
        let sent = await self.sendSync(unitIds: unitIds, inProfile: profileId.isEmpty ? nil : profileId)
        NSLog("[OPDesktopSync] dirty: \(unitIds.count) unit(s) for \(profileId.isEmpty ? "the open workspace" : profileId) — \(sent ? "sent" : "held")")
      }
    }
  }

  /// An answer that never came — encode failure, deadline, a reload mid-request
  /// — is not silence: every unit it covered is held durably and re-offered at
  /// the next drain, the way OPShell's outer wrappers do for every unsuccessful
  /// answer. Without this, a fetched record whose change tag was forfeited
  /// and a conflict the page never saw had no recovery driver at all.
  private func holdUnaccounted(_ units: [SyncUnit]) async {
    for (profileId, group) in Dictionary(grouping: units, by: \.profileId) {
      await deferSync(group.map(\.id), inProfile: profileId.isEmpty ? nil : profileId)
    }
  }

  /// A workspace the registry has durably tombstoned has no zone to send into:
  /// its deferred queue would be re-offered at every start and fail with
  /// `notStarted` forever (nine units of the first deleted workspace did exactly
  /// that), and a full upload owed for it can never be paid. Both are settled.
  /// Only ids the PAGE names, read from the registry on disk at init — an
  /// unknown-but-live workspace, whose registry entry has not landed yet, keeps
  /// its debt.
  func settleDeadWorkspaces(_ profileIds: [String]) {
    for profileId in profileIds where !profileId.isEmpty {
      let key = OPSyncEngine.deferredKey(profileId)
      let held: Set<String> = withLedger {
        let held = readDeferred(key)
        UserDefaults.standard.removeObject(forKey: key)
        return held
      }
      if !held.isEmpty {
        NSLog("[OPDesktopSync] settled \(held.count) unit(s) owed to the deleted workspace \(profileId)")
      }
      UserDefaults.standard.removeObject(forKey: Self.fullUploadKey(profileId))
    }
  }

  static func groupDirty(_ units: [[String: Any]]) -> [String: [String]] {
    var byProfile: [String: [String]] = [:]
    for unit in units {
      guard let id = unit["id"] as? String, !id.isEmpty else { continue }
      byProfile[(unit["profileId"] as? String) ?? "", default: []].append(id)
    }
    return byProfile
  }

  /// A send that meets a delegate event in flight is held durably and its
  /// bytes are queued in the engine — which sends them on its own schedule,
  /// and on macOS that schedule is a discretionary system task that can wait
  /// minutes. So the drain is retried shortly after, once per episode, up to
  /// a minute; the ledger settles on the first success. Every start used to
  /// log "postponed" for the same reason and never settle.
  @MainActor private func scheduleDrainRetry() {
    guard drainRetryTask == nil, drainRetries < 12 else { return }
    drainRetries += 1
    // Detached: a callback-created task would pass its CloudKit mark on to this
    // one, and the drain awaits `engine.send`. See `syncDidFail`.
    drainRetryTask = Task.detached { @MainActor [weak self] in
      try? await Task.sleep(nanoseconds: 5_000_000_000)
      guard let self, !Task.isCancelled else { return }
      self.drainRetryTask = nil
      await self.drainSyncDeferred()
    }
  }

  // MARK: Lifecycle

  /// Every way the transport comes up or goes down runs through here, in order:
  /// a start, an activation, an account switch, a purge, a resume, the stop at
  /// exit. Serialized rather than coalesced, as OPShell does it: `engine.start`
  /// suspends while it checks the account, and a second caller landing in that
  /// window would pass the same "already up?" check and build a second
  /// `CKSyncEngine` over the first — the one object everything here is keyed to.
  ///
  /// DETACHED, because two of its callers (`syncDidSwitchAccounts`,
  /// `syncDidPurgeFromICloud`) are the engine's own delegate callbacks. CloudKit
  /// marks the task that runs a callback, and a plain `Task {}` inherits the
  /// mark: `engine.start`/`stop` from such a task traps inside CloudKit even
  /// after the event is over. See `syncDidFail` for the crash that taught this.
  @MainActor private func enqueueLifecycle(_ work: @escaping @MainActor () async -> Void) {
    let previous = lifecycleTail
    lifecycleTail = Task.detached { @MainActor in
      await previous?.value
      await work()
    }
  }

  @MainActor private func stopEngine(forgettingServer: Bool) async {
    foregroundRefreshEnabled = false
    drainRetryTask?.cancel()
    drainRetryTask = nil
    await engine?.stop()
    if forgettingServer { OPSyncEngine.forgetEverythingAboutTheServer() }
    withLedger {
      syncDeferredDrainKey = nil
      syncDeferredReowed.removeAll()
    }
    syncRecovered.removeAll()
  }

  /// The stop at exit. Nothing about the server is forgotten: the next launch
  /// carries on from the same tokens.
  func stop() {
    Task { @MainActor in self.enqueueLifecycle { await self.stopEngine(forgettingServer: false) } }
  }

  @MainActor private func setSyncSuspended(_ suspended: Bool) {
    if suspended {
      suspensionDefaults.set(true, forKey: Self.syncSuspendedKey)
    } else {
      suspensionDefaults.removeObject(forKey: Self.syncSuspendedKey)
    }
    syncSuspended = suspended
    suspensionRevision += 1
  }

  @MainActor private func suspensionSnapshot() -> [String: Any] {
    ["suspended": syncSuspended, "revision": suspensionRevision]
  }

  /// A startup read, independent of account availability and engine startup.
  /// It shares the main actor with transitions so the flag and revision agree.
  func answerSuspension(id: UInt64) {
    Task { @MainActor in
      let snapshot = self.suspensionSnapshot()
      let data = try! JSONSerialization.data(withJSONObject: snapshot)
      String(decoding: data, as: UTF8.self).withCString { self.answerCallback?(id, $0) }
    }
  }

  /// The only path that clears suspension, in OPShell's order: re-owe every
  /// full upload and finish the purge cleanup BEFORE clearing, so a process
  /// death at any later line cannot leave automatic sync running without the
  /// uploads this explicit action requested.
  @MainActor private func resumeSyncing() async {
    guard syncSuspended else {
      notify("syncResumed", suspensionSnapshot())
      return
    }
    oweFullUploadForEveryConsideredProfile()
    if let syncProfileId { setSyncFullUploadOwed(true, profileId: syncProfileId) }
    await stopEngine(forgettingServer: true)
    setSyncSuspended(false)
    NSLog("[OPDesktopSync] iCloud sync resumed after a purge; full uploads are owed")
    notify("syncResumed", suspensionSnapshot())
    guard let syncProfileId else { return }
    await runStart(profileId: syncProfileId, knownProfileIds: knownProfileIds,
                   tombstonedProfileIds: tombstonedProfileIds, reason: "resume")
  }
  func resumeAfterPurge() {
    Task { @MainActor in self.enqueueLifecycle { await self.resumeSyncing() } }
  }

  /// The registry changed on the page — a workspace created on another device
  /// landed through the shared zone — and this is the ONLY moment Swift is told.
  /// Metadata only, no fetch and no send: the running engine takes on the new
  /// zone (`adoptProfileZones` reconciles the set) and pulls it on its next
  /// push or activation. The dead-workspace settle is synchronous and
  /// lock-protected so it can be exercised without a main loop.
  func reportProfiles(known: [String], tombstoned: [String]) {
    settleDeadWorkspaces(tombstoned)
    Task { @MainActor in
      self.knownProfileIds = known
      self.tombstonedProfileIds = tombstoned
      guard let engine = self.engine, let open = self.syncProfileId else { return }
      let added = engine.adoptProfileZones(known + [open])
      if !added.isEmpty {
        NSLog("[OPDesktopSync] adopted \(added.count) workspace zone(s) the registry named: \(added)")
      }
    }
  }

  // MARK: The page's own question: what does the account's registry hold?

  func registerAnswers(_ cb: @escaping OPSyncRustCallback) { answerCallback = cb }

  /// Answered on the id Rust issued, through the second callback. Bounded: a
  /// fresh Mac's first launch waits on this before it decides whether to adopt
  /// the account's workspaces or mint a starter one, and the page waits at
  /// most as long again.
  func answerAccountProfiles(id: UInt64) {
    Task {
      let answer = await Self.fetchAccountProfiles(ceiling: 8)
      answer.json.withCString { self.answerCallback?(id, $0) }
    }
  }

  private enum AccountProfilesAnswer: Sendable {
    case known(payload: String)
    case empty
    case unavailable
    var json: String {
      let object: [String: Any]
      switch self {
      case .known(let payload):
        guard let data = payload.data(using: .utf8),
              let profiles = try? JSONSerialization.jsonObject(with: data) as? [[String: Any]] else {
          return #"{"status":"unavailable"}"#
        }
        object = ["status": "known", "profiles": profiles]
      case .empty: object = ["status": "empty"]
      case .unavailable: object = ["status": "unavailable"]
      }
      guard JSONSerialization.isValidJSONObject(object),
            let data = try? JSONSerialization.data(withJSONObject: object) else {
        return #"{"status":"unavailable"}"#
      }
      return String(decoding: data, as: UTF8.self)
    }
  }

  private static func fetchAccountProfiles(ceiling: TimeInterval) async -> AccountProfilesAnswer {
    await withTaskGroup(of: AccountProfilesAnswer.self) { group in
      group.addTask { await Self.lookupAccountProfiles() }
      group.addTask {
        try? await Task.sleep(nanoseconds: UInt64(ceiling * 1_000_000_000))
        return .unavailable
      }
      let first = await group.next() ?? .unavailable
      group.cancelAll()
      return first
    }
  }

  /// OPShell's `fetchAccountProfiles`, verbatim in intent: read only the shared
  /// registry record. Absence is a known-empty account; account, network,
  /// decode and permission failures are unavailable.
  private static func lookupAccountProfiles() async -> AccountProfilesAnswer {
    let container = CKContainer(identifier: "iCloud.com.onpaper.app")
    do {
      guard try await container.accountStatus() == .available else { return .unavailable }
      let zoneID = CKRecordZone.ID(zoneName: opSharedZoneName, ownerName: CKCurrentUserDefaultName)
      let recordID = CKRecord.ID(recordName: "key:resume-designer-profiles", zoneID: zoneID)
      let record = try await container.privateCloudDatabase.record(for: recordID)
      guard record.recordType == "SyncUnit" else { return .unavailable }
      let payload: String?
      if let inline = record["payload"] as? String {
        payload = inline
      } else if let asset = record["asset"] as? CKAsset, let url = asset.fileURL,
                let data = try? Data(contentsOf: url) {
        payload = String(data: data, encoding: .utf8)
      } else {
        payload = nil
      }
      guard let payload, let data = payload.data(using: .utf8),
            let profiles = try JSONSerialization.jsonObject(with: data) as? [[String: Any]],
            profiles.allSatisfy({ $0["id"] is String && $0["name"] is String }) else {
        return .unavailable
      }
      return profiles.isEmpty ? .empty : .known(payload: payload)
    } catch let error as CKError where error.code == .unknownItem || error.code == .zoneNotFound {
      return .empty
    } catch {
      NSLog("[OPDesktopSync] account profile lookup unavailable: \(error)")
      return .unavailable
    }
  }

}

// The conformance lives in an EXTENSION on purpose. `OPSyncHost` is a
// `@MainActor` protocol (its iOS host is a SwiftUI model), and a class that
// conforms in its primary declaration inherits that isolation onto EVERY
// member — including `init` and the synchronous C entry points below, which
// then cannot be called from a nonisolated context at all. Worse for the
// tests: `cargo test` pumps no main run loop, so a main-actor hop there never
// runs. Conforming here keeps the class nonisolated; only these nine witnesses
// take the protocol's isolation, and the engine — which calls them — already
// hops to it, exactly as it does for the iOS host.
extension DesktopSyncHost: OPSyncHost {
  // Each mirrors the iOS host's decoding exactly.

  func syncUnit(withId id: String, inProfile profileId: String) async -> SyncUnit? {
    guard let value = try? await request("syncUnit", ["unitId": id, "profileId": profileId]),
          let object = value as? [String: Any],
          JSONSerialization.isValidJSONObject(object),
          let data = try? JSONSerialization.data(withJSONObject: object),
          let unit = try? JSONDecoder().decode(SyncUnit.self, from: data) else {
      return nil
    }
    return unit
  }

  func syncScopes(forUnitIds ids: [String]) async -> [String: String]? {
    await scopes(forUnitIds: ids)
  }

  func syncDidFetch(_ units: [SyncUnit]) async -> Set<String> {
    guard let data = try? JSONEncoder().encode(units),
          let json = String(data: data, encoding: .utf8) else {
      NSLog("[OPDesktopSync] could not encode \(units.count) fetched unit(s)")
      await holdUnaccounted(units)
      return []
    }
    guard let value = try? await request("syncApply", ["units": json]),
          let entries = (value as? [String: Any])?["accounted"] as? [[String: Any]] else {
      NSLog("[OPDesktopSync] no usable answer for \(units.count) fetched unit(s)")
      await holdUnaccounted(units)
      return []
    }
    var accounted: Set<String> = []
    for entry in entries {
      guard let id = entry["id"] as? String else { continue }
      let profileId = entry["profileId"] as? String ?? ""
      accounted.insert(SyncUnit(id: id, kind: "", payload: "", modifiedAt: nil, profileId: profileId).route)
    }
    // Refused units go to the durable ledger and are offered again at the
    // next start, exactly as on iOS. The page is told as well, for its log.
    let refused = units.filter { !accounted.contains($0.route) }
    if !refused.isEmpty {
      for (profileId, group) in Dictionary(grouping: refused, by: \.profileId) {
        await deferSync(group.map(\.id), inProfile: profileId.isEmpty ? nil : profileId)
        notify("syncRefused", ["profileId": profileId, "unitIds": group.map(\.id)])
      }
      NSLog("[OPDesktopSync] \(refused.count) of \(units.count) fetched unit(s) were refused; offered again at the next start")
    }
    return accounted
  }

  func syncDidConflict(_ conflicts: [SyncConflict]) async -> SyncConflictOutcome {
    guard let data = try? JSONEncoder().encode(conflicts),
          let json = String(data: data, encoding: .utf8) else {
      NSLog("[OPDesktopSync] could not encode \(conflicts.count) conflict(s)")
      await holdUnaccounted(conflicts.map(\.server))
      return .unresolved
    }
    guard let value = try? await request("syncResolveConflicts", ["conflicts": json]),
          let object = value as? [String: Any],
          let entries = object["resolved"] as? [[String: Any]],
          let parked = object["parked"] as? Int else {
      NSLog("[OPDesktopSync] no usable answer for \(conflicts.count) conflict(s)")
      await holdUnaccounted(conflicts.map(\.server))
      return .unresolved
    }
    var resolved: [SyncResolution] = []
    for entry in entries {
      guard let id = entry["id"] as? String, let retry = entry["retry"] as? Bool else {
        NSLog("[OPDesktopSync] a conflict resolution did not decode: \(entry)")
        continue
      }
      resolved.append(SyncResolution(id: id, profileId: entry["profileId"] as? String ?? "", retry: retry))
    }
    let outcome = SyncConflictOutcome(resolved: resolved, parked: parked)
    let done = Set(resolved.map(\.route))
    let unresolved = conflicts.map(\.server).filter { !done.contains($0.route) }
    if !unresolved.isEmpty {
      for (profileId, group) in Dictionary(grouping: unresolved, by: \.profileId) {
        await deferSync(group.map(\.id), inProfile: profileId.isEmpty ? nil : profileId)
        notify("syncRefused", ["profileId": profileId, "unitIds": group.map(\.id)])
      }
      NSLog("[OPDesktopSync] \(unresolved.count) of \(conflicts.count) conflict(s) were not resolved; offered again at the next start")
    }
    if parked > 0 { notify("syncParked", ["count": parked]) }
    return outcome
  }

  func syncDidFail(_ failures: [OPSyncFailure]) {
    // OPShell's shape. A retryable failure is the engine's to retry; a zone or
    // fetch failure names no unit to re-queue. A refetch that failed transiently
    // is the one retryable failure nothing holds (`needsDurableRetry`): it goes
    // into that workspace's durable queue, which the next drain sends straight
    // back into the path that refetches it. A unit's first TERMINAL failure gets
    // one recovery send per scope per session; the second is where the loop
    // would have been, so it stops there.
    var recover: [String: [String]] = [:]
    for failure in failures {
      NSLog("[OPDesktopSync] sync failure (unit \(failure.unitId ?? "—") in "
            + "\(failure.profileId.isEmpty ? "the open workspace" : failure.profileId), willRetry \(failure.willRetry)): \(failure.reason)")
      if failure.needsDurableRetry, let unitId = failure.unitId {
        let profileId = failure.profileId
        // Detached for the same reason as the recovery send below.
        Task.detached { @MainActor [weak self] in
          await self?.deferSync([unitId], inProfile: profileId.isEmpty ? nil : profileId)
        }
      }
      guard let unitId = failure.unitId, !failure.willRetry else { continue }
      guard syncRecovered.insert(failure.scope).inserted else { continue }
      recover[failure.profileId, default: []].append(unitId)
    }
    notify("syncFailed", ["failures": failures.map {
      ["unitId": $0.unitId ?? "", "profileId": $0.profileId, "willRetry": $0.willRetry, "reason": $0.reason]
    }])
    guard !recover.isEmpty else { return }
    // DETACHED, not merely deferred. This runs inside the engine's delegate
    // callback, and CloudKit marks the TASK that runs a callback, not the
    // moment: a plain `Task {}` inherits the mark, and when this one reached
    // `sendChanges()` after the event had ended — OPSync's time-based
    // `delegateEventInFlight` guard already clear — CloudKit trapped ("Cannot
    // await a call into CKSyncEngine from within a delegate callback … Try
    // performing this in a detached Task"; the Mac, 2026-09-20 20:40, after a
    // save conflict). A detached task starts with no inherited task-locals.
    Task.detached { @MainActor [weak self] in
      for (profileId, unitIds) in recover {
        await self?.sendSync(unitIds: unitIds, inProfile: profileId.isEmpty ? nil : profileId)
      }
    }
  }

  func syncDidLand(_ scopes: [OPSyncScope]) {
    notify("syncLanded", ["scopes": scopes.map { ["profileId": $0.profileId, "unitId": $0.unitId ?? ""] }])
  }

  func syncDidSwitchAccounts() {
    NSLog("[OPDesktopSync] the iCloud account changed — re-offering every profile's full upload")
    oweFullUploadForEveryConsideredProfile()
    notify("syncAccountChanged")
    // Paid NOW, on the chain, not at the next launch: the re-owed uploads are
    // exactly what the new account is missing.
    guard let profileId = syncProfileId else { return }
    enqueueLifecycle { [self] in
      await runStart(profileId: profileId, knownProfileIds: knownProfileIds,
                     tombstonedProfileIds: tombstonedProfileIds, reason: "account-switch")
    }
  }

  func syncDidPurgeFromICloud() {
    // BEFORE the hop, exactly as OPShell writes it: a kill between the engine's
    // event and the serialized turn below would otherwise leave no record of
    // the purge, and the next launch would recreate the zone and put this
    // device's workspaces back into an iCloud the account's owner emptied.
    setSyncSuspended(true)
    NSLog("[OPDesktopSync] iCloud data purged — the transport stays down, nothing local is deleted, nothing is re-sent")
    notify("syncPurged", suspensionSnapshot())
    // Stop and server-bookkeeping cleanup on the same serialized turn, so no
    // start can slip between the engine going down and its state being forgotten.
    enqueueLifecycle { [self] in await stopEngine(forgettingServer: true) }
  }


}

// MARK: - C surface

private let host = DesktopSyncHost()

@_cdecl("op_sync_register")
public func op_sync_register(_ cb: @escaping OPSyncRustCallback) { host.register(cb) }

@_cdecl("op_sync_resume")
public func op_sync_resume(_ id: UInt64, _ json: UnsafePointer<CChar>) {
  host.resume(id, json: String(cString: json))
}

@_cdecl("op_sync_start")
public func op_sync_start(_ profileId: UnsafePointer<CChar>, _ knownProfileIdsJson: UnsafePointer<CChar>, _ tombstonedProfileIdsJson: UnsafePointer<CChar>) {
  let known = (try? JSONSerialization.jsonObject(with: Data(String(cString: knownProfileIdsJson).utf8))) as? [String] ?? []
  let dead = (try? JSONSerialization.jsonObject(with: Data(String(cString: tombstonedProfileIdsJson).utf8))) as? [String] ?? []
  host.start(profileId: String(cString: profileId), knownProfileIds: known, tombstonedProfileIds: dead)
}

// Test surface: settle a dead workspace's debt without an engine.
@_cdecl("op_sync_settle_dead")
public func op_sync_settle_dead(_ profileIdsJson: UnsafePointer<CChar>) {
  let ids = (try? JSONSerialization.jsonObject(with: Data(String(cString: profileIdsJson).utf8))) as? [String] ?? []
  host.settleDeadWorkspaces(ids)
}

@_cdecl("op_sync_stop")
public func op_sync_stop() { host.stop() }

@_cdecl("op_sync_register_answer")
public func op_sync_register_answer(_ cb: @escaping OPSyncRustCallback) { host.registerAnswers(cb) }

@_cdecl("op_sync_profiles")
public func op_sync_profiles(_ knownJson: UnsafePointer<CChar>, _ tombstonedJson: UnsafePointer<CChar>) {
  let known = (try? JSONSerialization.jsonObject(with: Data(String(cString: knownJson).utf8))) as? [String] ?? []
  let dead = (try? JSONSerialization.jsonObject(with: Data(String(cString: tombstonedJson).utf8))) as? [String] ?? []
  host.reportProfiles(known: known, tombstoned: dead)
}

@_cdecl("op_sync_resume_after_purge")
public func op_sync_resume_after_purge() { host.resumeAfterPurge() }

@_cdecl("op_sync_account_profiles")
public func op_sync_account_profiles(_ id: UInt64) { host.answerAccountProfiles(id: id) }

@_cdecl("op_sync_suspension")
public func op_sync_suspension(_ id: UInt64) { host.answerSuspension(id: id) }

@_cdecl("op_sync_dirty")
public func op_sync_dirty(_ unitsJson: UnsafePointer<CChar>) {
  let units = (try? JSONSerialization.jsonObject(with: Data(String(cString: unitsJson).utf8))) as? [[String: Any]] ?? []
  host.syncDirty(units)
}

// Test surface: the grouping `syncDirty` sends by, without an engine.
@_cdecl("op_sync_dirty_groups")
public func op_sync_dirty_groups(_ unitsJson: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar> {
  let units = (try? JSONSerialization.jsonObject(with: Data(String(cString: unitsJson).utf8))) as? [[String: Any]] ?? []
  let grouped = DesktopSyncHost.groupDirty(units).mapValues { $0.sorted() }
  let data = (try? JSONSerialization.data(withJSONObject: grouped, options: [.sortedKeys])) ?? Data("{}".utf8)
  return strdup(String(decoding: data, as: UTF8.self))
}

/// Test-only probe of the crossing, reachable without an engine and therefore
/// without a container. Sends a `ping` request through the real path and, when
/// the reply resumes it, echoes what it received back on id 0 as a `pong` — so
/// a Rust test can observe both directions.
@_cdecl("op_sync_ping")
public func op_sync_ping() {
  Task {
    do {
      let value = try await host.request("ping")
      host.notify("pong", ["echo": value])
    } catch {
      host.notify("pong", ["error": "\(error)"])
    }
  }
}

// Test-only surface for the deferred ledger. Primitives only: `op_sync_defer`
// is `addSyncDeferred` on the profile key, without the scope split, so a test
// can read the key back synchronously; the hoist is the round trip that needs
// a `syncScopes` answer, which the test supplies through `op_sync_resume`.
@_cdecl("op_sync_defer")
public func op_sync_defer(_ profileId: UnsafePointer<CChar>, _ unitIdsJson: UnsafePointer<CChar>) {
  let ids = (try? JSONSerialization.jsonObject(with: Data(String(cString: unitIdsJson).utf8))) as? [String] ?? []
  host.addSyncDeferred(Set(ids), key: OPSyncEngine.deferredKey(String(cString: profileId)))
}

@_cdecl("op_sync_deferred")
public func op_sync_deferred(_ keySuffix: UnsafePointer<CChar>) -> UnsafeMutablePointer<CChar> {
  let ids = Array(host.syncDeferred(key: OPSyncEngine.deferredKey(String(cString: keySuffix)))).sorted()
  let data = (try? JSONSerialization.data(withJSONObject: ids)) ?? Data("[]".utf8)
  return strdup(String(decoding: data, as: UTF8.self))
}

@_cdecl("op_sync_hoist_shared")
public func op_sync_hoist_shared() {
  Task { await host.hoistSharedSyncDeferred() }
}

/// Test probe: the profile queues the drain would see — the enumeration path,
/// which is a different question from whether a key reads back directly.
@_cdecl("op_sync_ledger_queues")
public func op_sync_ledger_queues() -> UnsafeMutablePointer<CChar> {
  let ids = host.deferredProfileQueueIds()
  let data = (try? JSONSerialization.data(withJSONObject: ids)) ?? Data("[]".utf8)
  return strdup(String(decoding: data, as: UTF8.self))
}

@_cdecl("op_sync_ledger_clear")
public func op_sync_ledger_clear(_ keySuffix: UnsafePointer<CChar>) {
  UserDefaults.standard.removeObject(forKey: OPSyncEngine.deferredKey(String(cString: keySuffix)))
}

/// Test probe: does NSLog from this static library reach the process's stderr?
/// The app is launched by path with stderr captured, and every host message
/// is an NSLog — if these do not reach stderr, an empty capture means nothing.
@_cdecl("op_sync_log_probe")
public func op_sync_log_probe() { NSLog("[OPDesktopSync] log probe: NSLog reaches stderr") }

@_cdecl("op_sync_link_check")
public func op_sync_link_check() -> UnsafeMutablePointer<CChar> {
  _ = CKRecord.SystemFieldKey.recordID
  return strdup("op-desktop-sync:linked")
}

@_cdecl("op_sync_free")
public func op_sync_free(_ p: UnsafeMutablePointer<CChar>?) { free(p) }
