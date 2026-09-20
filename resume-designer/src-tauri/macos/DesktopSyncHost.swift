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
  // (UserDefaults, under the app's bundle domain), same behaviour. Suspension
  // is the one deliberate difference: iOS keeps it in UserDefaults, desktop in
  // the page's SYNC_SUSPENDED_KEY; each platform is self-consistent.
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
    Set(UserDefaults.standard.stringArray(forKey: key) ?? [])
  }
  private func setSyncDeferred(_ unitIds: Set<String>, key: String) {
    UserDefaults.standard.set(Array(unitIds).sorted(), forKey: key)
  }
  func addSyncDeferred(_ unitIds: Set<String>, key: String) {
    guard !unitIds.isEmpty else { return }
    var deferred = syncDeferred(key: key)
    deferred.formUnion(unitIds)
    setSyncDeferred(deferred, key: key)
    if syncDeferredDrainKey != nil {
      syncDeferredReowed.formUnion(unitIds)
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
  /// Shared-zone ids that landed in a profile's queue (they were deferred before
  /// their zone was known) move to the shared key, so the shared drain sends
  /// them once rather than every profile's drain sending them again.
  func hoistSharedSyncDeferred() async {
    let prefix = OPSyncEngine.deferredKey("")
    var profileQueues: [String: Set<String>] = [:]
    var offered: Set<String> = []
    for key in UserDefaults.standard.dictionaryRepresentation().keys
    where key.hasPrefix(prefix) && key != Self.sharedDeferredKey {
      let deferred = syncDeferred(key: key)
      guard !deferred.isEmpty else { continue }
      profileQueues[key] = deferred
      offered.formUnion(deferred)
    }
    guard !offered.isEmpty,
          let scopes = await scopes(forUnitIds: Array(offered).sorted()) else { return }
    let shared = Set(offered.filter { scopes[$0] == opSharedScope })
    guard !shared.isEmpty else { return }
    addSyncDeferred(shared, key: Self.sharedDeferredKey)
    for key in profileQueues.keys {
      var deferred = syncDeferred(key: key)
      deferred.subtract(shared)
      setSyncDeferred(deferred, key: key)
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
  /// Settle only what a SUCCESSFUL send covered, minus anything re-owed while
  /// it was in flight. A failed send leaves the debt exactly where it was —
  /// `sendSync` has already re-deferred it.
  @MainActor private func drainSyncDeferred(key: String, inProfile profileId: String? = nil) async {
    let offered = syncDeferred(key: key)
    guard !offered.isEmpty else { return }
    syncDeferredDrainKey = key
    syncDeferredReowed.removeAll()
    let sent = await sendSync(unitIds: Array(offered), inProfile: profileId)
    let reowed = syncDeferredReowed
    syncDeferredDrainKey = nil
    syncDeferredReowed.removeAll()
    guard sent else { return }
    var deferred = syncDeferred(key: key)
    deferred.subtract(offered.subtracting(reowed))
    setSyncDeferred(deferred, key: key)
  }
  /// `true` only when the engine accepted the send. Suspended is `false`; a
  /// throw defers the ids durably and is `false`.
  @MainActor private func sendSync(unitIds: [String], inProfile profileId: String? = nil) async -> Bool {
    guard !unitIds.isEmpty else { return true }
    guard let engine else { return false }
    let owning = profileId ?? syncProfileId
    do {
      try await engine.send(unitIds: unitIds, inProfile: owning)
      return true
    } catch {
      await deferSync(unitIds, inProfile: owning)
      NSLog("[OPDesktopSync] sync send postponed; \(unitIds.count) unit(s) held durably")
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
  func start(profileId: String, knownProfileIds: [String]) {
    Task { @MainActor in
      self.syncProfileId = profileId
      self.knownProfileIds = knownProfileIds
      // A workspace this device has never started sync for owes the mesh a
      // full upload of everything held for it. Decided BEFORE start, from the
      // page's list — the page owns the registry.
      for known in knownProfileIds where !syncFullUploadConsidered(profileId: known) {
        NSLog("[OPDesktopSync] first gated start seen for \(known) — a full upload is owed")
        setSyncFullUploadOwed(true, profileId: known)
      }
      let engine = self.engine ?? OPSyncEngine(host: self)
      self.engine = engine
      let state = await engine.start(profileId: profileId, knownProfileIds: knownProfileIds)
      guard state == .available else {
        // Signed out, restricted, or iCloud not reachable. All normal, none an
        // error, and NOTHING local changes because of them.
        NSLog("[OPDesktopSync] sync is not running: \(state)")
        notify("syncState", ["state": "\(state)"])
        return
      }
      notify("syncState", ["state": "available"])
      // THE SAME ORDER AS iOS, and each step is why. The shared zone first: it
      // holds the registry, which is how a Mac that has just joined learns the
      // account's workspaces. Then the debt — anything this device still owes
      // a send of goes up BEFORE the pull, so a unit changed on both sides
      // meets the conflict path rather than being overwritten. Then the full
      // uploads owed. Then the general fetch.
      try? await engine.fetchShared()
      await drainSyncDeferred()
      for owing in knownProfileIds where syncFullUploadOwed(profileId: owing) {
        await performFullUpload(profileId: owing)
      }
      try? await engine.fetch()
    }
  }

  func stop() { Task { @MainActor in await engine?.stop() } }
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
      return []
    }
    guard let value = try? await request("syncApply", ["units": json]),
          let entries = (value as? [String: Any])?["accounted"] as? [[String: Any]] else {
      NSLog("[OPDesktopSync] no usable answer for \(units.count) fetched unit(s)")
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
      return .unresolved
    }
    guard let value = try? await request("syncResolveConflicts", ["conflicts": json]),
          let object = value as? [String: Any],
          let entries = object["resolved"] as? [[String: Any]],
          let parked = object["parked"] as? Int else {
      NSLog("[OPDesktopSync] no usable answer for \(conflicts.count) conflict(s)")
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
    for f in failures {
      NSLog("[OPDesktopSync] sync failure (unit \(f.unitId ?? "—") in "
            + "\(f.profileId.isEmpty ? "the open workspace" : f.profileId), willRetry \(f.willRetry)): \(f.reason)")
    }
    notify("syncFailed", ["failures": failures.map {
      ["unitId": $0.unitId ?? "", "profileId": $0.profileId, "willRetry": $0.willRetry, "reason": $0.reason]
    }])
  }

  func syncDidLand(_ scopes: [OPSyncScope]) {
    notify("syncLanded", ["scopes": scopes.map { ["profileId": $0.profileId, "unitId": $0.unitId ?? ""] }])
  }

  func syncDidSwitchAccounts() {
    NSLog("[OPDesktopSync] the iCloud account changed — re-offering every profile's full upload")
    oweFullUploadForEveryConsideredProfile()
    notify("syncAccountChanged")
  }

  func syncDidPurgeFromICloud() {
    // Stop; delete nothing locally. The page sets SYNC_SUSPENDED_KEY, exactly as
    // the iOS host does, and a person turns sync back on deliberately.
    NSLog("[OPDesktopSync] iCloud data purged — stopping; nothing local is deleted")
    notify("syncPurged")
    Task { @MainActor in await engine?.stop() }
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
public func op_sync_start(_ profileId: UnsafePointer<CChar>, _ knownProfileIdsJson: UnsafePointer<CChar>) {
  let known = (try? JSONSerialization.jsonObject(with: Data(String(cString: knownProfileIdsJson).utf8))) as? [String] ?? []
  host.start(profileId: String(cString: profileId), knownProfileIds: known)
}

@_cdecl("op_sync_stop")
public func op_sync_stop() { host.stop() }

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

@_cdecl("op_sync_link_check")
public func op_sync_link_check() -> UnsafeMutablePointer<CChar> {
  _ = CKRecord.SystemFieldKey.recordID
  return strdup("op-desktop-sync:linked")
}

@_cdecl("op_sync_free")
public func op_sync_free(_ p: UnsafeMutablePointer<CChar>?) { free(p) }
