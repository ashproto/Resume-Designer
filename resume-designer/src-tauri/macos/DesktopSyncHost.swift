// The desktop half of the sync host. The transport is ../ios/OPSync.swift,
// compiled alongside this file into one static library (see build.rs) — one
// transport, two hosts. The real `OPSyncHost` implementation arrives with the
// bridge; this file begins as the link's smoke surface.

import Foundation
import CloudKit

@_cdecl("op_sync_link_check")
public func op_sync_link_check() -> UnsafeMutablePointer<CChar> {
  // CloudKit is LINKED — the symbol below forces it — but no container is
  // constructed: outside a signed, entitled bundle `CKContainer(identifier:)`
  // throws, and this function is reached from `cargo test`.
  _ = CKRecord.SystemFieldKey.recordID
  return strdup("op-desktop-sync:linked")
}

@_cdecl("op_sync_free")
public func op_sync_free(_ p: UnsafeMutablePointer<CChar>?) { free(p) }
