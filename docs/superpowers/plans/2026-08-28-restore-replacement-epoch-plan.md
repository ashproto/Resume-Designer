# Replacement Epoch Implementation Plan

**Status (2026-09-22): planned, not implemented.** This plan is included with
the macOS sync work as supporting documentation for a future change.
[Issue #126](https://github.com/ashproto/Resume-Designer/issues/126) remains open;
committing this document does not deliver replacement-epoch behavior or close
the issue. The tasks and checks below describe proposed implementation work.

See the [replacement-epoch design](../specs/2026-08-18-restore-replacement-epoch-design.md)
for the problem and the [macOS sync design](../specs/2026-09-19-macos-cloudkit-sync-design.md)
for the transport now shared by both platforms.

**Goal:** A replacement restore removes content on every device, including résumés and workspaces the restoring device has never seen — without any device deleting a record on a guess.

**Proposed architecture:** The restore publishes an **epoch** per workspace into the shared `opShared` zone. The epoch acts as a *floor*, enforced symmetrically in two places so the mechanism is insensitive to the order in which the epoch and the units arrive. Implementing and verifying this behavior is intended to address [#126](https://github.com/ashproto/Resume-Designer/issues/126).

**Tech Stack:** Plain JS (`src/sync/`, `src/persistence.js`), vitest. **No Swift or Rust changes.**

---

## Design decisions already settled, with the evidence

Do not re-litigate these during implementation; each was checked against the code.

1. **The epoch is a synced SHARED KEY, not a new record kind.** `keyScope()` returns `'shared'` for any member of `SYNCED_SHARED_KEYS`, and the registry (`PROFILES_KEY`) already works exactly this way. It rides the existing `key:` unit machinery.

2. **No Swift changes.** `OPSyncScope` is generic over unit ids; the transport asks JS `unitScopes()` which zone each unit belongs to and never knows a unit's kind. A new shared key is JS-only.

3. **NOT a field on the registry.** `mergeRegistry` replaces entries **whole** via `outranks` (newest `updatedAt`, then tombstone-ness, then content). A rename after an epoch publish would win on stamp and silently drop the epoch field.

4. **NOT CloudKit zone deletion.** `OPSync.swift` already discriminates `.deleted` from `.purged` and leaves `.deleted` as a documented no-op, so it is technically available. Rejected because it is strictly worse on migration: with an epoch, a record stamped *before* the epoch is not adopted, so a not-yet-upgraded device re-uploading stale content is correctly ignored by upgraded devices. A recreated zone has no such rule and the stale content simply returns. It would also overload the event that means "the account owner deleted this app's data", where today's conservative behaviour is deliberate.

5. **Old builds are safe by construction.** `classifyKey()` returns `'unknown'` for a key it does not list, and every collect/land path gates on `classifyKey(...) === 'synced'`. An older build therefore ignores the epoch unit rather than failing on it. It does not get the guarantee; it is not made worse.

## The ordering problem, and why this design does not have one

The design doc flags: *"the epoch must be applied before the units it invalidates, or a device re-initialises and then re-adopts what it just discarded."*

That risk exists only for a one-shot "re-initialise" step. This plan makes the epoch a **standing floor** enforced in two symmetric halves:

- **(a) on unit landing** — refuse a unit for workspace P whose `modifiedAt` predates P's epoch
- **(b) on epoch landing** — discard local units for P stamped before the new epoch

Either arrival order converges on the same state, so no cross-zone ordering guarantee is required. This matters because the epoch lives in `opShared` while the units it governs live in per-profile zones, and nothing sequences those.

## Global Constraints

- **Every migration must work from ANY prior state, never a specific version.** State-driven, not version-driven.
- The epoch's own key must be added to `SYNCED_SHARED_KEYS` **and** to the `profileKeys.js` inventory, or the exhaustiveness tests fail. That failure is the feature.
- The credential must never cross the sync boundary. Do not touch `withoutSettingsCredential`.
- `applied` counts units that are **durably** this device's. Do not report a unit as applied because it reached the cache.
- Conventional commits, lowercase subject. commitlint runs on every commit.
- Every new behaviour gets a **mutation-verified** test: revert the line, confirm the test fails, alone.

---

## File Structure

- `src/profileKeys.js` — **Modify.** Add `RESTORE_EPOCHS_KEY` to the fixed inventory.
- `src/sync/syncKeys.js` — **Modify.** Add the key to `SYNCED_SHARED_KEYS` with its reason.
- `src/sync/syncMerge.js` — **Modify.** Add `mergeEpochs`.
- `src/sync/syncModel.js` — **Modify.** `landEpochs` + dispatch in `accumulatorFor`; the floor check in the landing path; the sweep on epoch landing; `publishReplacementEpoch`.
- `src/persistence.js` — **Modify.** The replacement restore publishes an epoch before stamping its writes.
- `src/backupFlow.js` — **Modify.** Confirmation copy becomes the one-sentence version.
- `test/syncEpoch.test.js` — **Create.** The mechanism's own suite.
- `test/syncKeys.test.js` — **Modify.** Exhaustiveness now covers the new key.

---

### Task 1: The key exists and is classified

**Files:**
- Modify: `src/profileKeys.js`, `src/sync/syncKeys.js`
- Test: `test/syncKeys.test.js`

**Interfaces:**
- Produces: `RESTORE_EPOCHS_KEY = 'resume-designer-restore-epochs'`, exported from `profileKeys.js` and re-exported through `syncKeys.js`, classified `'synced'` with scope `'shared'`.

- [ ] **Step 1: Write the failing test**

```js
import { classifyKey, keyScope } from '../src/sync/syncKeys.js';
import { RESTORE_EPOCHS_KEY } from '../src/profileKeys.js';

it('classifies the restore-epoch key as a synced shared key', () => {
  expect(classifyKey(RESTORE_EPOCHS_KEY)).toBe('synced');
  expect(keyScope(RESTORE_EPOCHS_KEY)).toBe('shared');
});
```

- [ ] **Step 2: Run it and watch it fail**

`npx vitest run test/syncKeys.test.js` — expected: fails, `RESTORE_EPOCHS_KEY` undefined.

- [ ] **Step 3: Add the key**

In `profileKeys.js`, beside the other fixed keys:

```js
// Published by a replacement restore; read by every device to refuse content
// the replacement removed. Shared, not per-profile: it names workspaces the
// reading device may not have, which is the whole point.
export const RESTORE_EPOCHS_KEY = 'resume-designer-restore-epochs';
```

Add it to `BACKUP_FIXED_KEYS`, and in `syncKeys.js` add it to `SYNCED_SHARED_KEYS` with that reason as its comment.

- [ ] **Step 4: Run the whole key suite**

`npx vitest run test/syncKeys.test.js` — expected: PASS, including the pre-existing exhaustiveness tests.

- [ ] **Step 5: Commit** — `feat(sync): name the restore-epoch key and classify it as shared`

---

### Task 2: `mergeEpochs`, deterministic and convergent

**Files:**
- Modify: `src/sync/syncMerge.js`
- Test: `test/syncEpoch.test.js` (create)

**Interfaces:**
- Consumes: `byCodeUnit`, `canonicalJSON` from this module.
- Produces: `mergeEpochs(a, b) -> { [profileId]: { epochId, at, deviceId } }`

The shape is a map, not an array, because it is keyed lookup on every landing.

- [ ] **Step 1: Write the failing tests**

```js
import { mergeEpochs } from '../src/sync/syncMerge.js';

const E = (at, epochId, deviceId = 'd1') => ({ at, epochId, deviceId });

it('keeps the later epoch per workspace', () => {
  const merged = mergeEpochs({ p1: E('2026-01-01T00:00:00Z', 'a') },
                             { p1: E('2026-02-01T00:00:00Z', 'b') });
  expect(merged.p1.epochId).toBe('b');
});

it('unions workspaces neither side has both of', () => {
  const merged = mergeEpochs({ p1: E('2026-01-01T00:00:00Z', 'a') },
                             { p2: E('2026-01-01T00:00:00Z', 'b') });
  expect(Object.keys(merged).sort()).toEqual(['p1', 'p2']);
});

it('breaks an exact tie the same way on both devices', () => {
  // Both devices compute merge(local, remote), so "keep the held one" is
  // argument-order dependence and the two would never converge.
  const x = E('2026-01-01T00:00:00Z', 'a'), y = E('2026-01-01T00:00:00Z', 'b');
  expect(mergeEpochs({ p1: x }, { p1: y })).toEqual(mergeEpochs({ p1: y }, { p1: x }));
});

it('ignores a malformed entry rather than throwing', () => {
  expect(mergeEpochs({ p1: null }, { p1: E('2026-01-01T00:00:00Z', 'a') }).p1.epochId).toBe('a');
});
```

- [ ] **Step 2: Run and watch them fail** — `npx vitest run test/syncEpoch.test.js`

- [ ] **Step 3: Implement**

```js
/**
 * Later `at` wins per workspace. An exact tie is broken on canonical content by
 * code unit — NOT by keeping the held entry, which is argument-order dependence
 * wearing a reasonable disguise: both devices call merge(local, remote), so
 * "keep held" means each keeps its own copy forever and they never converge.
 * The same reasoning `mergeRegistry` documents at length.
 */
export function mergeEpochs(a, b) {
  const out = {};
  for (const side of [a, b]) {
    if (!side || typeof side !== 'object') continue;
    for (const [profileId, entry] of Object.entries(side)) {
      if (!entry || typeof entry !== 'object') continue;
      if (typeof entry.epochId !== 'string' || typeof entry.at !== 'string') continue;
      const held = out[profileId];
      if (!held) { out[profileId] = entry; continue; }
      const byAt = byCodeUnit(String(entry.at), String(held.at));
      if (byAt > 0 || (byAt === 0 && byCodeUnit(canonicalJSON(entry), canonicalJSON(held)) > 0)) {
        out[profileId] = entry;
      }
    }
  }
  return out;
}
```

- [ ] **Step 4: Run** — expected PASS.

- [ ] **Step 5: Mutation-verify** — replace the tie-break with `return held`, confirm only the convergence test fails. Restore.

- [ ] **Step 6: Commit** — `feat(sync): merge restore epochs, later wins and ties converge`

---

### Task 3: Land the epoch, and sweep what it invalidates

**Files:**
- Modify: `src/sync/syncModel.js`
- Test: `test/syncEpoch.test.js`

**Interfaces:**
- Consumes: `mergeEpochs` (Task 2), `RESTORE_EPOCHS_KEY` (Task 1), `accumulatorFor`, `modifiedAtFor`, `appStorage`, `readJSON`.
- Produces: `landEpochs(key, unit, profileId)`, and `epochFor(profileId) -> string|null` for Task 4.

- [ ] **Step 1: Write the failing test** — landing an epoch newer than the local one discards a local résumé stamped before it, and leaves one stamped after it alone.

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement `landEpochs` and register it**

Mirror `landRegistry`: parse, merge, write, and note the consequence rather than acting on it inside the suppressed window.

```js
// In accumulatorFor, beside the registry:
if (key === RESTORE_EPOCHS_KEY) return landEpochs;
```

The sweep discards local units for that workspace whose recorded `modifiedAt` predates the new epoch's `at`. It runs **after the apply's flush**, following the division `landRegistry` already documents: the landing writes, the reaction happens where durability is known.

- [ ] **Step 4: Run** — expected PASS.

- [ ] **Step 5: Mutation-verify** — drop the sweep; the "discards a pre-epoch résumé" case must fail alone.

- [ ] **Step 6: Commit** — `feat(sync): land a replacement epoch and drop what it invalidates`

---

### Task 4: The floor on the landing path

**Files:**
- Modify: `src/sync/syncModel.js`
- Test: `test/syncEpoch.test.js`

This is half (a). Without it, a pre-epoch unit arriving *after* the epoch is adopted, and the resurrection the issue describes still happens.

- [ ] **Step 1: Write the failing test** — with an epoch held for `p1`, a `resume:` unit for `p1` stamped before it is refused; one stamped after it lands.

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement** — in the landing path beside `outranksLocalCopy`, refuse a unit whose `modifiedAt` predates `epochFor(profileId)`.

Refusal must destroy nothing and must not count toward `applied` — the same contract `interruptsLiveEditing` already has.

- [ ] **Step 4: Run** — expected PASS.

- [ ] **Step 5: Mutation-verify** — remove the check; only the refusal case fails.

- [ ] **Step 6: Commit** — `fix(sync): refuse a unit the workspace's epoch has already replaced`

---

### Task 5: The restore publishes its epoch

**Files:**
- Modify: `src/persistence.js`
- Test: `test/syncEpoch.test.js`

**Ordering requirement:** publish the epoch at time `T` **before** `stampRestoredWrites`, so every restored unit is stamped `>= T` and survives its own epoch. Getting this backwards makes a restore delete the content it just restored.

- [ ] **Step 1: Write the failing test** — a replacement restore leaves an epoch for that workspace, and every unit it stamped has `modifiedAt >= epoch.at`.

- [ ] **Step 2: Run and watch it fail.**

- [ ] **Step 3: Implement `publishReplacementEpoch(profileId)`** and call it from the replacement path only — an additive restore must not publish one.

- [ ] **Step 4: Run** — expected PASS.

- [ ] **Step 5: Mutation-verify** — publish the epoch *after* stamping; the ordering assertion must fail.

- [ ] **Step 6: Commit** — `feat(restore): publish a replacement epoch before stamping the restored writes`

---

### Task 6: Say what it now does

**Files:**
- Modify: `src/backupFlow.js`
- Test: whichever suite covers the confirmation copy.

The current copy discloses the limitation this plan removes — *"anything created elsewhere that has not synced to this device yet will not be removed"*. Replace it with the one-sentence version the design doc names: **this resets the workspace on all your devices.**

The cost must stay stated: a device holding work created before the replacement and never synced loses it. That is inherent to "replace", and it is now uniform rather than dependent on which records reached the server first.

- [ ] **Step 1–4:** update copy, update its test, run, commit — `fix(backup): say that a replacement now resets every device`

---

### Task 7: Close the loop on the issue

- [ ] Run the full gate: `npm run test`, `npm run lint`, `npx vite build`.
- [ ] Re-read `withTombstonesForDroppedVariants` (persistence.js:1086) and its three call sites (1395, 1422, 1612). It is **not deleted** by this work — it still handles what the device *can* name, and the epoch covers what it cannot. Confirm the two do not double-tombstone.
- [ ] Update `docs/superpowers/specs/2026-08-18-restore-replacement-epoch-design.md`: mark implemented, and record the four settled decisions above — particularly that "stamped before the epoch is not adopted" is load-bearing for migration, not a nicety.
- [ ] Close [#126](https://github.com/ashproto/Resume-Designer/issues/126) with the two original review threads answered.

## Platform participation

The macOS app now syncs through the same JS model and CloudKit transport as iOS.
The proposed epoch behavior belongs in shared JS and would therefore apply to
both platforms once implemented. Its restore and convergence checks must cover
both iOS and macOS; desktop participation is no longer outside this plan's scope.

## Out of scope, deliberately

- Reclaiming deleted profiles' zones and records in iCloud (needs content tombstones, still unbuilt).
