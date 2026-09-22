// Appended to the real host source so private behavior needs no test-only ABI.
// No scenario starts CloudKit or writes to the application's defaults domain.
private var suspensionAnswers: [(UInt64, [String: Any])] = []
private func recordSuspension(_ id: UInt64, _ json: UnsafePointer<CChar>) {
  let body = try! JSONSerialization.jsonObject(with: Data(String(cString: json).utf8)) as! [String: Any]
  suspensionAnswers.append((id, body))
}

extension DesktopSyncHost {
  @MainActor static func runSuspensionTests() async {
    let suite = "op-suspension-test-\(UUID().uuidString)"
    let defaults = UserDefaults(suiteName: suite)!
    defer { defaults.removePersistentDomain(forName: suite) }
    let marker = "resume-designer-sync-suspended"
    defaults.set(true, forKey: marker)
    let native = DesktopSyncHost(suspensionDefaults: defaults)
    let initial = native.suspensionSnapshot()
    precondition(initial["suspended"] as? Bool == true, "a reload must recover the native marker")
    precondition(initial["revision"] as? Int == 0)
    native.registerAnswers(recordSuspension)
    native.answerSuspension(id: 42)
    for _ in 0..<100 where suspensionAnswers.isEmpty { await Task.yield() }
    precondition(suspensionAnswers.count == 1 && suspensionAnswers[0].0 == 42)
    precondition(suspensionAnswers[0].1["suspended"] as? Bool == true)
    precondition(suspensionAnswers[0].1["revision"] as? Int == 0)
    print("PASS: persisted native marker is available on the answer channel")

    native.setSyncSuspended(false)
    let resumed = native.suspensionSnapshot()
    precondition(resumed["suspended"] as? Bool == false)
    precondition(resumed["revision"] as? Int == 1)
    precondition(defaults.object(forKey: marker) == nil)
    native.setSyncSuspended(true)
    precondition(native.suspensionSnapshot()["revision"] as? Int == 2)
    precondition(defaults.bool(forKey: marker))
    precondition(initial["suspended"] as? Bool == true && initial["revision"] as? Int == 0,
                 "an in-flight answer must remain a snapshot of its original revision")
    print("PASS: each transition persists first and advances its snapshot")

    native.register(recordSuspension)
    suspensionAnswers.removeAll()
    await native.runStart(profileId: "paused-profile", knownProfileIds: ["paused-profile", "other"],
                          tombstonedProfileIds: ["gone"], reason: "start")
    precondition(native.syncProfileId == "paused-profile")
    precondition(native.knownProfileIds == ["paused-profile", "other"])
    precondition(native.tombstonedProfileIds == ["gone"])
    precondition(native.engine == nil && !native.foregroundRefreshEnabled,
                 "recording paused profile context must not construct or enable the engine")
    precondition(suspensionAnswers.contains { $0.1["kind"] as? String == "syncInitialProfileFetchSettled" })
    print("PASS: paused startup retains resume context without starting CloudKit")

    native.setSyncSuspended(false)
    suspensionAnswers.removeAll()
    await native.resumeSyncing()
    precondition(suspensionAnswers.count == 1)
    let notice = suspensionAnswers[0].1
    precondition(notice["kind"] as? String == "syncResumed")
    precondition(notice["suspended"] as? Bool == false && notice["revision"] as? Int == 3)
    precondition(native.engine == nil, "idempotent resume only repairs the page mirror")
    print("PASS: repeating resume reannounces the authoritative snapshot")
    print("PASS: all 4 suspension scenarios")
  }
}

@main private struct DesktopSyncSuspensionTests {
  static func main() async { await DesktopSyncHost.runSuspensionTests() }
}
