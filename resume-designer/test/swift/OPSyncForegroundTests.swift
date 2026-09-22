// Appended to OPSync.swift by the native test runner. No CKContainer is created.
private struct ForegroundTestFailure: Error {
  let message: String
}

@main
private struct ForegroundTests {
  @MainActor
  static func check(_ condition: Bool, _ message: String) throws {
    if !condition { throw ForegroundTestFailure(message: message) }
  }

  @MainActor
  static func record(_ name: String) -> CKRecord {
    CKRecord(recordType: "SyncUnit", recordID: CKRecord.ID(
      recordName: name, zoneID: CKRecordZone.ID(zoneName: "foreground-test")
    ))
  }

  @MainActor
  static func main() async throws {
    let metadata = record("first")
    let full = record("first")
    full["payload"] = "downloaded" as CKRecordValue

    // 1. Already-accounted metadata does not download the payload again.
    var fetches = 0
    let skipped = try await opReadForegroundRecords(
      metadata: [metadata], shouldDownload: { _ in false },
      fetch: { _ in fetches += 1; return full }, isCurrent: { true },
      ingest: { records in try! check(records.isEmpty, "metadata must never be ingested"); return true }
    )
    try check(skipped && fetches == 0, "known metadata should need no download")

    // 2. Only full downloaded records reach the durable ingestion boundary.
    var ingested: [CKRecord] = []
    let applied = try await opReadForegroundRecords(
      metadata: [metadata], shouldDownload: { _ in true },
      fetch: { id in try check(id == metadata.recordID, "wrong record route"); return full },
      isCurrent: { true }, ingest: { ingested = $0; return true }
    )
    try check(applied && ingested.count == 1 && ingested.first === full,
              "the downloaded record must travel with its payload and tag")

    // 3. A later download failure cannot commit a partly downloaded page.
    var partialIngests = 0
    do {
      _ = try await opReadForegroundRecords(
        metadata: [metadata, record("second")], shouldDownload: { _ in true },
        fetch: { id in
          if id.recordName == "second" { throw CKError(.networkFailure) }
          return full
        },
        isCurrent: { true }, ingest: { _ in partialIngests += 1; return true }
      )
      throw ForegroundTestFailure(message: "download failure was swallowed")
    } catch let error as CKError {
      try check(error.code == .networkFailure, "download error changed")
    }
    try check(partialIngests == 0, "partial page must not be committed")

    // 4. A model refusal keeps the page unaccounted, for retry from its old token.
    let refused = try await opReadForegroundRecords(
      metadata: [metadata], shouldDownload: { _ in true }, fetch: { _ in full },
      isCurrent: { true }, ingest: { _ in false }
    )
    try check(!refused, "refused page must retain its cursor")

    // 5. Stop/account replacement during download discards the result.
    var current = true
    var staleIngests = 0
    let replaced = try await opReadForegroundRecords(
      metadata: [metadata], shouldDownload: { _ in true },
      fetch: { _ in current = false; return full }, isCurrent: { current },
      ingest: { _ in staleIngests += 1; return true }
    )
    try check(!replaced && staleIngests == 0, "old session result reached ingestion")

    // 6. Replacement while awaiting the model also prevents a cursor commit.
    current = true
    let replacedAtAck = try await opReadForegroundRecords(
      metadata: [metadata], shouldDownload: { _ in true }, fetch: { _ in full },
      isCurrent: { current }, ingest: { _ in current = false; return true }
    )
    try check(!replacedAtAck, "old session acknowledgement committed a cursor")

    // 7. A physical deletion between metadata and download is not a local delete.
    var deletedIngests: [CKRecord] = []
    let deleted = try await opReadForegroundRecords(
      metadata: [metadata], shouldDownload: { _ in true },
      fetch: { _ in throw CKError(.unknownItem) }, isCurrent: { true },
      ingest: { deletedIngests = $0; return true }
    )
    try check(deleted && deletedIngests.isEmpty, "physical deletion became local content")

    // 8. Downloaded asset bytes survive cleanup during a later download.
    let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
    try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
    defer { try? FileManager.default.removeItem(at: directory) }
    let assetURL = directory.appendingPathComponent("payload.json")
    let assetPayload = "{\"snapshot\":\"first download\"}"
    try Data(assetPayload.utf8).write(to: assetURL)
    let assetRecord = record("asset")
    assetRecord["asset"] = CKAsset(fileURL: assetURL)
    var capturedAssetPayload: String?
    let assetAccounted = try await opReadForegroundRecords(
      metadata: [record("asset"), record("later")], shouldDownload: { _ in true },
      fetch: { id in
        if id.recordName == "asset" { return assetRecord }
        try FileManager.default.removeItem(at: assetURL)
        return record("later")
      },
      isCurrent: { true },
      ingest: { records in capturedAssetPayload = records.first?["payload"] as? String; return true }
    )
    try check(assetAccounted && capturedAssetPayload == assetPayload,
              "asset bytes were lost across a later download")

    // 9. Event/application work waits in FIFO order, including across suspension.
    let gate = OPSyncIngressGate()
    await gate.acquire()
    var readyOne = false
    var readyTwo = false
    var order: [Int] = []
    let first = Task { @MainActor in
      readyOne = true
      await gate.acquire()
      defer { gate.release() }
      order.append(1)
      await Task.yield()
      order.append(2)
    }
    while !readyOne { await Task.yield() }
    let second = Task { @MainActor in
      readyTwo = true
      await gate.acquire()
      defer { gate.release() }
      order.append(3)
    }
    while !readyTwo { await Task.yield() }
    try check(order.isEmpty, "waiter entered before the owner released")
    gate.release()
    await first.value
    await second.value
    try check(order == [1, 2, 3], "ingestion overlapped or reordered")

    // 10. A cancelled waiter still releases ownership so later work can proceed.
    await gate.acquire()
    var queued = false
    var sawCancellation = false
    let cancelled = Task { @MainActor in
      queued = true
      await gate.acquire()
      defer { gate.release() }
      sawCancellation = Task.isCancelled
    }
    while !queued { await Task.yield() }
    cancelled.cancel()
    gate.release()
    await cancelled.value
    await gate.acquire()
    gate.release()
    try check(sawCancellation, "cancelled waiter lost cancellation state")
    print("PASS: all 10 foreground scenarios")
  }
}
