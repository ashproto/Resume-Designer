/**
 * The host routes both native transports share.
 *
 * `OPSync.swift` is one transport with two hosts: the iOS shell reaches these
 * over the WebKit message handler, the macOS desktop over the Tauri bridge.
 * Each host consumes THIS table, so an `OPSyncHost` method is added once and
 * cannot drift between platforms — and `SYNC_HOST_KINDS` is the list a test
 * proves every kind is routed against.
 *
 * Only the pure request/answer routes live here. `syncCollect`,
 * `syncAccountProfiles` and `syncInitialProfileFetchSettled` stay in
 * iosShell.js: they post to `window.webkit`, which is iOS-only.
 *
 * `publish` is the host's "re-project the native sheets" hook. The desktop
 * host has no sheets and passes a no-op.
 */

export const SYNC_HOST_KINDS = ['syncUnit', 'syncScopes', 'syncApply', 'syncResolveConflicts'];

export function makeSyncHostRoutes(deps, { publish }) {
  return {
    syncUnit: ({ unitId, profileId }) =>
      deps.collectUnit(String(unitId ?? ''), String(profileId ?? '')),
    // Which zone each named unit belongs in, asked when the transport QUEUES a
    // save: a CloudKit record id carries its zone, and all Swift holds at that
    // moment is the id it was handed. Answered here rather than derived there
    // for the same reason a conflict is resolved here — what a unit id means is
    // this side's knowledge. A JSON STRING in, an object out, like the two
    // batch routes below.
    syncScopes: ({ unitIds }) => {
      const parsed = JSON.parse(String(unitIds ?? '[]'));
      if (!Array.isArray(parsed)) throw new Error('syncScopes needs an array of unit ids');
      return deps.unitScopes(parsed);
    },
    // One of the two commands whose answer is a promise — `setSyncEnabled` is
    // the other, for the same durability reason — and both are asked for
    // through `callAsyncJavaScript` (see `dispatch.async`). A malformed batch
    // still throws SYNCHRONOUSLY — this handler is not `async` on purpose — so
    // it is a refusal on either entry point rather than an answer on one.
    // Each unit now names the profile whose zone it arrived in — `''` for the
    // shared zone. Swift is reporting a fact about the record's zone, not
    // deciding what the unit is; see `syncScopes` for the same seam in reverse.
    syncApply: ({ units }) => {
      const parsed = JSON.parse(String(units ?? '[]'));
      if (!Array.isArray(parsed)) throw new Error('syncApply needs an array of units');
      // RETURNED, not discarded. `applyUnits` answers `{ applied }` — how many
      // units are DURABLY this device's — and the transport keeps the server's
      // change tag for a unit only once it knows this device took it. Swallowing
      // the count here is what let a batch the page never applied leave its
      // change tags behind, and a tag for content this device does not hold
      // makes the next save of that unit a clean update that destroys the
      // server's copy.
      //
      // `applyUnits` lands everything synchronously and only THEN awaits the
      // disk, so the cache is already current when this returns its promise —
      // which is why the republish below can stay where it is and does not wait
      // on a disk write. Nothing on screen ever waits for sync.
      const pending = deps.applyUnits(parsed);
      // Republished like every other mutating route here, and for the same
      // reason: an open sheet projects on demand and nothing else re-reads it.
      // A landing that changed the job list or the application history would
      // otherwise sit behind whatever the sheet last drew, until the user
      // happened to touch something. (The chat sheet gets there anyway —
      // ChatPanel publishes on every engine change, and adopting a thread list
      // is one — so this is the other screens catching up with it.)
      publish();
      return pending;
    },
    // BOTH versions of every unit whose save hit a conflict, resolved by the
    // model — the one side that can tell a newer-wins comparison from a union,
    // and therefore the only one that can tell whether a loser exists at all.
    // The transport used to decide this itself and hand back only the loser,
    // which is why the two append-shaped units never unioned on the save path.
    //
    // A JSON STRING for the same reason `syncApply`'s units are one: the command
    // channel is a JS string literal. The answer is a promise for the same
    // reason its answer is — a resolution is not confirmed until the bytes are
    // on disk — so this route is reached through `dispatch.async` too, and a
    // malformed batch still throws SYNCHRONOUSLY rather than resolving to a
    // refusal.
    syncResolveConflicts: ({ conflicts }) => {
      const parsed = JSON.parse(String(conflicts ?? '[]'));
      if (!Array.isArray(parsed)) {
        throw new Error('syncResolveConflicts needs an array of conflicts');
      }
      // RETURNED, not discarded, exactly as `syncApply`'s count is: the
      // transport keeps the server's change tag for a unit only once the model
      // says it merged, applied or parked the server's version, and it learns
      // whether that unit still owes the server a save from the same answer.
      const pending = deps.resolveConflicts(parsed);
      // Republished like every other mutating route here: a resolution can
      // replace the document on screen and can add a version-history entry.
      publish();
      return pending;
    },
  };
}
