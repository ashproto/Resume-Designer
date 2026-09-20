/**
 * The desktop half of the sync bridge.
 *
 * NOT `window.__opShell` — that is the iOS bridge, and it stays dormant on
 * desktop. Same shared routes (syncHostRoutes.js), different carrier: Rust
 * evaluates `window.__opDesktopSync.request(id, json)` on this window when the
 * Swift transport asks the page something, and the page answers through
 * `invoke('desktop_sync_reply', { id, json })`, keyed by that id. Id 0 is the
 * fire-and-forget id: Swift is telling the page something and nothing is
 * parked, so nothing is replied.
 *
 * `invoke` is reached by dynamic import for the same reason appStorage.js does
 * it: the browser build must not carry a hard Tauri import.
 */

import { makeSyncHostRoutes } from './sync/syncHostRoutes.js';

// ONE import, shared by every call. Two concurrent first imports of the same
// module — the start report and the first request racing — is exactly the
// shape that handed the second caller a different module instance under
// vitest's mock registry, and one shared promise is the fix in production as
// well as in the test: the module is resolved once, and every caller awaits
// the same resolution.
let corePromise = null;
const core = () => (corePromise ??= import('@tauri-apps/api/core'));
const tauriInvoke = async (cmd, args) => (await core()).invoke(cmd, args);

/**
 * @param {object} deps
 * @param {Function} deps.collectUnit
 * @param {Function} deps.collectUnits   every unit this device would push for a profile
 * @param {Function} deps.unitScopes
 * @param {Function} deps.applyUnits
 * @param {Function} deps.resolveConflicts
 * @param {() => string} deps.getActiveProfileId
 * @param {() => string[]} deps.listProfileIds  the registry's live ids — the page owns the registry
 * @param {() => string[]} [deps.listTombstonedProfileIds]  the registry's durably deleted ids
 * @param {() => boolean} deps.isSyncSuspended   a purge stopped this device; only a person restarts it
 * @param {(v: boolean) => void} [deps.setSyncSuspended]
 * @param {(notify: Function) => void} [deps.setSyncDirtyNotifier]  the model's one notifier slot
 * @param {(message: string) => void} [deps.note]  a line onto the process's stderr; the
 *   webview console is invisible when the app is run by path, and "sync did not
 *   start" is exactly the failure that needs a trace
 * @returns {Promise<void>} resolves once the transport has been told to start
 *   (or once it has decided not to) — `invoke` is reached asynchronously.
 */
export function initDesktopSync(deps) {
  // The desktop host has no native sheets to re-project, so `publish` is a
  // no-op — a constant one, so the thunk the iOS host needs is not needed here.
  const routes = {
    ...makeSyncHostRoutes(deps, { publish: () => {} }),
    // A profile's FULL upload — every unit this device would push for it —
    // asked when the transport owes one (a workspace's first gated start, an
    // account change). Desktop-only: over the WebKit bridge iOS asks this
    // fire-and-forget and the page posts `syncUnits` back; over this bridge
    // it is a request with an answer, so it does not belong in the shared
    // table. Echoes the profile id, because the transport may owe more than
    // one and the answer has to say which it is.
    syncCollect: ({ profileId }) => {
      const forProfile = String(profileId ?? '');
      return { profileId: forProfile, units: deps.collectUnits(forProfile) };
    },
  };

  // Things Swift TELLS the page (id 0). Each is a fact about the transport,
  // and the page decides what to do with it; none of them destroys anything.
  const notices = {
    // A purge is the account's owner deleting this app's iCloud data. This
    // device stops, exactly as iOS does, and deletes nothing locally.
    syncPurged: () => deps.setSyncSuspended?.(true),
    // Refused or unresolved units, which iOS re-offers from a durable ledger.
    // Desktop does not keep that ledger yet (plan, Task 3b); this is where it
    // will be recorded. Logged so the gap is visible in the meantime.
    syncRefused: ({ profileId, unitIds }) =>
      console.warn(`[desktopSync] ${(unitIds ?? []).length} unit(s) refused in ${profileId || 'the shared zone'}; not yet re-offered on desktop`),
    syncFailed: ({ failures }) => console.warn('[desktopSync] sync failures', failures),
    syncLanded: () => {},
    syncParked: () => {},
    syncAccountChanged: () => {},
    syncState: () => {},
  };

  // What the page TELLS Swift: units whose bytes reached disk, each with the
  // workspace they belong to ('' is the open one). iOS posts `syncDirty` over
  // its WebKit handler; here it is a command. The notifier slot holds one
  // function and initIOSShell fills it first with one that is a no-op off iOS —
  // this runs after it and takes the slot. Without this, the Mac never sent an
  // edit: its only uploads were the one-time full ones.
  // The open workspace is named HERE, once, for this document: a switch on
  // desktop reloads the page, so the active pointer can already name the next
  // workspace while this page still holds the old document's writes. An empty
  // id resolved later, on the other side of the bridge, would route them wrong.
  const openProfileId = deps.getActiveProfileId() || '';
  deps.setSyncDirtyNotifier?.((units) => {
    const routed = units.map((u) => (u.profileId ? u : { ...u, profileId: openProfileId }));
    tauriInvoke('desktop_sync_dirty', { units: routed }).catch((e) => {
      console.warn('[desktopSync] dirty units not handed to the transport', e);
    });
  });

  window.__opDesktopSync = {
    async request(id, json) {
      let parsed;
      try { parsed = JSON.parse(json); } catch { parsed = {}; }
      const { kind, ...args } = parsed ?? {};

      if (id === 0) {
        try { notices[kind]?.(args); } catch (e) { console.warn('[desktopSync] notice failed', kind, e); }
        return;
      }

      let reply;
      try {
        const route = routes[kind];
        if (!route) throw new Error(`no route for ${kind}`);
        reply = { ok: true, value: await route(args) };
      } catch (e) {
        // A refusal, not silence: Swift is waiting on this id, and a missing
        // reply only becomes a failure when its deadline runs out.
        reply = { ok: false, error: String(e?.message ?? e) };
      }
      await tauriInvoke('desktop_sync_reply', { id, json: JSON.stringify(reply) });
    },
  };

  // The transport starts against the active profile's zone, and is told every
  // profile the registry names — the page owns the registry. Not while
  // suspended: a purge stopped this device on purpose.
  const note = deps.note ?? (() => {});
  if (deps.isSyncSuspended()) { note('not starting: sync is suspended on this device'); return Promise.resolve(); }
  const profileId = deps.getActiveProfileId();
  if (!profileId) { note('not starting: no active profile yet'); return Promise.resolve(); }
  const knownProfileIds = deps.listProfileIds();
  // Durably tombstoned workspaces, read from the registry on disk: the transport
  // settles their debt (a dead workspace has no zone to send into, and its
  // deferred queue used to fail at every start, forever).
  const tombstonedProfileIds = deps.listTombstonedProfileIds?.() ?? [];
  note(`starting: profile ${profileId}, ${knownProfileIds.length} known, ${tombstonedProfileIds.length} tombstoned`);
  return tauriInvoke('desktop_sync_report_profile', { profileId, knownProfileIds, tombstonedProfileIds });
}
