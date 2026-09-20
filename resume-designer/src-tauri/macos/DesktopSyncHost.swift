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
      // THE SHARED ZONE FIRST: it holds the registry, which is how a Mac that
      // has just joined learns the account's workspaces — same order as iOS.
      try? await engine.fetchShared()
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
    guard let idsData = try? JSONSerialization.data(withJSONObject: ids),
          let idsJson = String(data: idsData, encoding: .utf8),
          let value = try? await request("syncScopes", ["unitIds": idsJson]),
          let scopes = value as? [String: String] else {
      return nil
    }
    return scopes
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
    // The iOS host hands refused units to a durable ledger and re-offers them
    // at the next start. Desktop does not have that ledger yet (plan, Task 3b);
    // until it does the refusal is REPORTED to the page and logged, so the gap
    // is visible rather than silent.
    let refused = units.filter { !accounted.contains($0.route) }
    if !refused.isEmpty {
      for (profileId, group) in Dictionary(grouping: refused, by: \.profileId) {
        notify("syncRefused", ["profileId": profileId, "unitIds": group.map(\.id)])
      }
      NSLog("[OPDesktopSync] \(refused.count) of \(units.count) fetched unit(s) were refused")
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
        notify("syncRefused", ["profileId": profileId, "unitIds": group.map(\.id)])
      }
      NSLog("[OPDesktopSync] \(unresolved.count) of \(conflicts.count) conflict(s) were not resolved")
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
    NSLog("[OPDesktopSync] the iCloud account changed")
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

@_cdecl("op_sync_link_check")
public func op_sync_link_check() -> UnsafeMutablePointer<CChar> {
  _ = CKRecord.SystemFieldKey.recordID
  return strdup("op-desktop-sync:linked")
}

@_cdecl("op_sync_free")
public func op_sync_free(_ p: UnsafeMutablePointer<CChar>?) { free(p) }
