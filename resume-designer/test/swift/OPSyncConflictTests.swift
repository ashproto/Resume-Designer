// Appended to OPSync.swift by opsyncConflict.test.js. No engine or CKContainer
// is constructed: only record fixtures and an injected direct fetch are used.
@main
private enum OPSyncConflictTests {
  private enum ExpectedError: Error { case fetchFailed }

  private static func record(_ id: CKRecord.ID, payload: String? = nil) -> CKRecord {
    let record = CKRecord(recordType: "SyncUnit", recordID: id)
    record["kind"] = "plain" as CKRecordValue
    record["modifiedAt"] = "2026-09-21T00:00:00Z" as CKRecordValue
    record["payload"] = payload.map { $0 as CKRecordValue }
    return record
  }

  private static func decode(_ record: CKRecord) -> SyncUnit? {
    let payload: String?
    if let inline = record["payload"] as? String {
      payload = inline
    } else if let asset = record["asset"] as? CKAsset, let url = asset.fileURL {
      payload = try? String(contentsOf: url, encoding: .utf8)
    } else {
      payload = nil
    }
    guard let payload else { return nil }
    return SyncUnit(id: record.recordID.recordName, kind: "plain", payload: payload,
                    modifiedAt: record["modifiedAt"] as? String,
                    profileId: opProfileId(forZone: record.recordID.zoneID))
  }

  @MainActor
  static func main() async throws {
    let directory = FileManager.default.temporaryDirectory
      .appendingPathComponent("op-sync-conflict-fixtures-\(UUID().uuidString)")
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let id = CKRecord.ID(recordName: "key:resume-designer-history-test",
                         zoneID: CKRecordZone.ID(zoneName: "workspace-a"))
    let local = record(id, payload: "local snapshot")
    let inlineServer = record(id, payload: "inline server")
    var fetches = 0

    // 1. Existing inline conflicts retain the exact server record and never fetch.
    let inline = try await opReadConflict(localRecord: local, serverRecord: inlineServer,
                                          decode: decode) { _ in
      fetches += 1
      throw ExpectedError.fetchFailed
    }
    precondition(fetches == 0 && inline?.serverRecord === inlineServer)
    precondition(inline?.versions.local.payload == "local snapshot")
    precondition(inline?.versions.server.payload == "inline server")

    // 2. An unavailable asset gets one full-record fetch; its returned record is
    // retained with the decoded bytes, so resolution receives that record's tag.
    let unavailable = record(id)
    unavailable["asset"] = CKAsset(fileURL: directory.appendingPathComponent("absent"))
    let assetURL = directory.appendingPathComponent("server-payload")
    try "downloaded server asset".write(to: assetURL, atomically: true, encoding: .utf8)
    let downloaded = record(id)
    downloaded["asset"] = CKAsset(fileURL: assetURL)
    let recovered = try await opReadConflict(localRecord: local, serverRecord: unavailable,
                                             decode: decode) { requested in
      precondition(requested == id)
      fetches += 1
      return downloaded
    }
    precondition(fetches == 1 && recovered?.serverRecord === downloaded)
    precondition(recovered?.versions.server.payload == "downloaded server asset")
    precondition(recovered?.versions.local.payload == "local snapshot")

    // 3. A missing server record is also fetched using the failed record's own
    // zone. Identical names in different workspaces and the shared zone stay apart.
    for zone in ["workspace-a", "workspace-b", opSharedZoneName] {
      let scopedID = CKRecord.ID(recordName: id.recordName, zoneID: CKRecordZone.ID(zoneName: zone))
      let scopedLocal = record(scopedID, payload: "local \(zone)")
      let scopedServer = record(scopedID, payload: "server \(zone)")
      var scopedFetches = 0
      let conflict = try await opReadConflict(localRecord: scopedLocal, serverRecord: nil,
                                              decode: decode) { requested in
        precondition(requested == scopedID)
        scopedFetches += 1
        return scopedServer
      }
      precondition(scopedFetches == 1 && conflict?.recordID == scopedID)
      precondition(conflict?.versions.server.profileId == (zone == opSharedZoneName ? "" : zone))
      precondition(conflict?.versions.local.route == conflict?.versions.server.route)
    }

    // 4. Without local bytes there is no pair to resolve and no fetch is useful.
    fetches = 0
    let unreadableLocal = try await opReadConflict(localRecord: record(id), serverRecord: nil,
                                                   decode: decode) { _ in
      fetches += 1
      return downloaded
    }
    precondition(unreadableLocal == nil && fetches == 0)

    // 5. A fetched record that still cannot decode terminates after one request.
    let unreadableServer = try await opReadConflict(localRecord: local, serverRecord: unavailable,
                                                    decode: decode) { _ in
      fetches += 1
      return unavailable
    }
    precondition(unreadableServer == nil && fetches == 1)

    // 6. Fetch failure propagates once so the caller can report it accurately.
    fetches = 0
    do {
      _ = try await opReadConflict(localRecord: local, serverRecord: nil, decode: decode) { _ in
        fetches += 1
        throw ExpectedError.fetchFailed
      }
      preconditionFailure("a direct fetch failure was swallowed")
    } catch ExpectedError.fetchFailed {
      precondition(fetches == 1)
    }

    // 7. Read the local asset before suspending: staging a later save can replace
    // that file while the server asset downloads, but this conflict names the old send.
    let localURL = directory.appendingPathComponent("local-payload")
    try "sent local asset".write(to: localURL, atomically: true, encoding: .utf8)
    let localAsset = record(id)
    localAsset["asset"] = CKAsset(fileURL: localURL)
    let snapshot = try await opReadConflict(localRecord: localAsset, serverRecord: nil,
                                            decode: decode) { _ in
      await Task.yield()
      try "later local edit".write(to: localURL, atomically: true, encoding: .utf8)
      return downloaded
    }
    precondition(snapshot?.versions.local.payload == "sent local asset")
    precondition(snapshot?.versions.server.payload == "downloaded server asset")
    print("PASS: all 7 conflict reader scenarios")
  }
}
