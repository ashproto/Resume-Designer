/**
 * A device that has not received a workspace yet must not claim to have written
 * what it merely filled in.
 *
 * On a fresh install a workspace's résumé-data blob is not on disk until the
 * first pull lands it, so the first incidental write to that blob — the
 * changelog's first-run `saveSettings`, made at every launch — persists the
 * DEFAULT blob `loadFromStorage` fills in. The storage interceptor read every
 * field of it as an edit: the empty `userProfile` and the default `settings`
 * were stamped "now", which outranked the account's real copies. The pull then
 * settled those instead of writing them, the full upload won its conflict (a
 * loser that is not a résumé has nowhere to park), and every other device
 * landed the defaults as the newest version. A real profile and its settings
 * were reset to factory defaults on every device that way (2026-09-29).
 *
 * The harness is syncStamping.test.js's — the REAL appStorage over a fake disk,
 * the real persistence writers and the real sync model — minus its pre-seeded
 * blob, because the missing blob IS the fresh device.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  appStorage, initAppStorage, __resetAppStorageForTests, setProfileMapping,
  setStorageWriteObserver,
} from '../src/appStorage.js';
import {
  installStorageStamping, setStorageDirtyNotifier, applyUnits, registerEditingProbe,
  collectUnit, collectUnits, resolveConflicts,
} from '../src/sync/syncModel.js';
import { saveSettings, saveUserProfile } from '../src/persistence.js';
import { loadThreads, persistThreads, makeThread } from '../src/chatThreads.js';
import { DEFAULT_STORAGE } from '../src/storageDefaults.js';
import { CHANGELOG_SEEN_FIELD } from '../src/profileKeys.js';

const DATA = 'resume-designer-data';
const STATE = 'resume-designer-sync-state';

// The write every Tauri launch makes before the first pull can land anything:
// maybeShowPostUpdateChangelog's first-run record (src/changelogService.js).
const recordVersionSeen = () => saveSettings({ [CHANGELOG_SEEN_FIELD]: '2.3.1' });

// What the account already holds — the content a fresh device must end up with.
const THEIR_PROFILE = {
  ...structuredClone(DEFAULT_STORAGE.userProfile),
  contactInfo: {
    ...DEFAULT_STORAGE.userProfile.contactInfo,
    fullName: 'Ada Lovelace',
    email: 'ada@example.com',
  },
  personalSummary: 'Mathematician.',
  workExperience: [{ company: 'Analytical Engines', title: 'Programmer' }],
};
const THEIR_SETTINGS = {
  ...structuredClone(DEFAULT_STORAGE.settings),
  colorPalette: 'ocean',
  layout: 'classic',
};

function makeBackend() {
  const files = new Map();
  return {
    files,
    loadAll: vi.fn(async () => Object.fromEntries(files)),
    write: vi.fn(async (key, value) => { files.set(key, value); }),
    delete: vi.fn(async (key) => { files.delete(key); }),
    clear: vi.fn(async () => { files.clear(); }),
  };
}

let backend;
let notify;

beforeEach(async () => {
  __resetAppStorageForTests();
  setProfileMapping(null);
  localStorage.clear();
  // EMPTY: nothing has landed on this device yet.
  backend = makeBackend();
  await initAppStorage({ backend });
  notify = vi.fn();
  installStorageStamping(setStorageWriteObserver);
  setStorageDirtyNotifier(notify);
  registerEditingProbe(null);
});

afterEach(() => {
  setStorageWriteObserver(null);
  setStorageDirtyNotifier(null);
});

/** Force the coalescing window closed the way a durability barrier does. */
const settle = () => appStorage.flush();

/** Everything the sync bookkeeping recorded, minus store.js's device id. */
function stamps() {
  const raw = appStorage.getItem(STATE);
  if (raw == null) return {};
  const { deviceId: _deviceId, ...units } = JSON.parse(raw);
  return units;
}

const allNamed = () => notify.mock.calls.flatMap((call) => call[0].map((u) => u.id));

// What reached DISK. The cache can hold bytes the drain never wrote.
const onDisk = () => JSON.parse(backend.files.get(DATA));

describe('filling in the defaults is not an edit', () => {
  it('does not stamp or announce the empty profile the first-launch write fills in', async () => {
    recordVersionSeen();
    await settle();

    // The precondition is real: the default profile IS on disk now.
    expect(onDisk().userProfile).toEqual(DEFAULT_STORAGE.userProfile);
    expect(stamps()['data:userProfile']).toBeUndefined();
    expect(allNamed()).not.toContain('data:userProfile');
  });

  it('does not stamp or announce the default settings it fills in either', async () => {
    recordVersionSeen();
    await settle();

    expect(onDisk().settings[CHANGELOG_SEEN_FIELD]).toBe('2.3.1');
    expect(stamps()['data:settings']).toBeUndefined();
    expect(allNamed()).not.toContain('data:settings');
  });

  it('still stamps a profile someone actually typed', async () => {
    saveUserProfile({
      contactInfo: { ...DEFAULT_STORAGE.userProfile.contactInfo, fullName: 'Grace Hopper' },
    });
    await settle();

    expect(stamps()['data:userProfile']).toBeDefined();
    expect(allNamed()).toContain('data:userProfile');
  });

  it('still stamps a setting someone actually changed', async () => {
    saveSettings({ colorPalette: 'ocean' });
    await settle();

    expect(stamps()['data:settings']).toBeDefined();
    expect(allNamed()).toContain('data:settings');
  });
});

describe("the account's copies land on a fresh device", () => {
  // The reported symptom: the workspaces and their résumés arrived, and the
  // profiles inside them were empty.
  it.each([
    ['never stamped it, having written it before sync existed', null],
    ['stamped it before this device was installed', '2026-09-20T12:00:00.000Z'],
  ])('lands the profile of a device that %s', async (_label, modifiedAt) => {
    recordVersionSeen();
    await settle();

    const { applied } = await applyUnits([
      { id: 'data:userProfile', kind: 'plain', payload: JSON.stringify(THEIR_PROFILE), modifiedAt },
    ]);

    expect(applied).toBe(1);
    expect(onDisk().userProfile).toEqual(THEIR_PROFILE);
  });

  it("lands the settings, keeping this device's own release-notes record", async () => {
    recordVersionSeen();
    await settle();

    const { applied } = await applyUnits([{
      id: 'data:settings',
      kind: 'plain',
      // A build from before this fix still sends ITS record inside the unit.
      payload: JSON.stringify({ ...THEIR_SETTINGS, [CHANGELOG_SEEN_FIELD]: '2.2.0' }),
      modifiedAt: '2026-09-20T12:00:00.000Z',
    }]);

    expect(applied).toBe(1);
    const { settings } = onDisk();
    expect(settings.colorPalette).toBe('ocean');
    expect(settings.layout).toBe('classic');
    expect(settings[CHANGELOG_SEEN_FIELD]).toBe('2.3.1');
  });
});

describe("the fresh device's full upload does not overwrite the account", () => {
  // The propagation half. A fresh install owes a full upload of every workspace
  // (OPShell's runStartSync), which sends whatever `collectUnits` offers.
  it('does not offer the defaults it filled in', async () => {
    recordVersionSeen();
    await settle();

    // Offered, an unstamped default still CREATES the server record wherever the
    // owner's own upload has not arrived yet — and a tie between two unstamped
    // copies goes to the server, so the owner then lands the default over the
    // real profile it had never stamped.
    const offered = collectUnits().map((unit) => unit.id);
    expect(offered).not.toContain('data:userProfile');
    expect(offered).not.toContain('data:settings');
    expect(collectUnit('data:userProfile')).toBeNull();
  });

  it('still offers a profile someone typed, stamped', async () => {
    saveUserProfile({
      contactInfo: { ...DEFAULT_STORAGE.userProfile.contactInfo, fullName: 'Grace Hopper' },
    });
    await settle();

    const unit = collectUnit('data:userProfile');
    expect(JSON.parse(unit.payload).contactInfo.fullName).toBe('Grace Hopper');
    expect(unit.modifiedAt).toEqual(expect.any(String));
  });

  it('lets the server copy of the profile win a conflict with an unstamped default', async () => {
    recordVersionSeen();
    await settle();

    // What a build from before this fix still sends: the filled-in default, now
    // unstamped. A filled-in default must lose: winning is what put the empty
    // profile on the server as the newest version, and on every device from there.
    const local = {
      id: 'data:userProfile', kind: 'plain', payload: JSON.stringify(DEFAULT_STORAGE.userProfile), modifiedAt: null,
    };
    const server = {
      id: 'data:userProfile', kind: 'plain', payload: JSON.stringify(THEIR_PROFILE), modifiedAt: null,
    };
    const { resolved } = await resolveConflicts([{ local, server }]);

    expect(resolved).toEqual([{ id: 'data:userProfile', profileId: '', retry: false }]);
    expect(onDisk().userProfile).toEqual(THEIR_PROFILE);
  });
});

describe('a conversation list the chat panel made up', () => {
  // The same failure on a different unit. `loadThreads` manufactures a 'New
  // Chat' thread for a key that is absent, and useChat persists what it loaded
  // on mount and again on every résumé load — both before a fresh device's
  // first pull can land the account's conversations. Stamped, that empty list
  // outranked them, went up in the full upload, and every other device adopted
  // it: a workspace's whole chat history erased everywhere.
  const THREADS = 'resume-designer-chat-threads';
  const THREADS_UNIT = `key:${THREADS}`;
  const THEIR_THREADS = [
    { ...makeThread('Tailoring for Acme'), messages: [{ role: 'user', content: 'Tighten my summary.' }] },
  ];

  // What useChat's mount effect writes on a device with no conversations yet.
  const mountPanel = () => persistThreads(loadThreads().threads);

  it('does not stamp or announce the list the panel persists on mount', async () => {
    mountPanel();
    await settle();

    expect(appStorage.getItem(THREADS)).not.toBeNull();
    expect(stamps()[THREADS_UNIT]).toBeUndefined();
    expect(allNamed()).not.toContain(THREADS_UNIT);
  });

  it('does not stamp the rewrite a résumé load makes, still with nothing in it', async () => {
    mountPanel();
    await settle();
    // useChat's `dataLoaded` handler: reload, bump the outgoing thread, and
    // add a thread homed to the résumé just opened — all still empty.
    const reloaded = loadThreads().threads
      .map((t) => ({ ...t, updatedAt: new Date(Date.now() + 1000).toISOString() }));
    persistThreads([makeThread('New Chat', [], 'v-1'), ...reloaded]);
    await settle();

    expect(stamps()[THREADS_UNIT]).toBeUndefined();
    expect(allNamed()).not.toContain(THREADS_UNIT);
  });

  it("lands the account's conversations after the panel mounted", async () => {
    mountPanel();
    await settle();

    const { applied } = await applyUnits([{
      id: THREADS_UNIT, kind: 'plain', payload: JSON.stringify(THEIR_THREADS), modifiedAt: null,
    }]);

    expect(applied).toBe(1);
    expect(JSON.parse(backend.files.get(THREADS))).toEqual(THEIR_THREADS);
  });

  it('does not offer the made-up list for upload', async () => {
    mountPanel();
    await settle();

    expect(collectUnits().map((unit) => unit.id)).not.toContain(THREADS_UNIT);
  });

  it('still stamps a conversation someone had', async () => {
    mountPanel();
    await settle();
    persistThreads(THEIR_THREADS);
    await settle();

    expect(stamps()[THREADS_UNIT]).toBeDefined();
    expect(allNamed()).toContain(THREADS_UNIT);
  });
});

describe('a settings object with no preferences in it', () => {
  // What the old saveSettings wrote over a blob with no settings: ONE key, this
  // install's release-notes record, and nothing a person chose. It went up as
  // the whole of `data:settings`. Found on a real Mac, 2026-09-29.
  const DAMAGED = { [CHANGELOG_SEEN_FIELD]: '2.3.0' };

  beforeEach(async () => {
    // Re-open storage over a disk that already holds that shape, unstamped.
    __resetAppStorageForTests();
    backend = makeBackend();
    backend.files.set(DATA, JSON.stringify({ variants: {}, currentVariantId: null, settings: DAMAGED }));
    await initAppStorage({ backend });
    installStorageStamping(setStorageWriteObserver);
  });

  it('does not land over the preferences this device has', async () => {
    saveSettings({ colorPalette: 'ocean' });
    await settle();

    const { applied } = await applyUnits([{
      id: 'data:settings', kind: 'plain', payload: JSON.stringify(DAMAGED),
      // Newer than anything here: the refusal must not rest on the stamps.
      modifiedAt: new Date(Date.now() + 60_000).toISOString(),
    }]);

    expect(applied).toBe(0);
    expect(onDisk().settings.colorPalette).toBe('ocean');
  });

  it('does not stamp recording the version seen over it', async () => {
    recordVersionSeen();
    await settle();

    expect(stamps()['data:settings']).toBeUndefined();
    expect(allNamed()).not.toContain('data:settings');
  });

  it('does not stamp a rewrite of the blob that leaves it as it was', async () => {
    // Every launch rewrites the blob byte for byte (setCurrentVariantId), and
    // so does every résumé save. Comparing a held no-preference object against
    // the full default made each of those a settings "edit".
    appStorage.setItem(DATA, appStorage.getItem(DATA));
    await settle();

    expect(stamps()['data:settings']).toBeUndefined();
  });

  describe('carrying a stamp an older build gave it', () => {
    // The old interceptor stamped that one key when it appeared, so the damaged
    // devices hold it STAMPED — at the time of the damage, newer than the
    // account's real settings.
    const DAMAGED_AT = '2026-09-29T19:25:33.723Z';

    beforeEach(async () => {
      appStorage.setItem(STATE, JSON.stringify({ 'data:settings': { modifiedAt: DAMAGED_AT } }));
      await settle();
      notify.mockClear();
    });

    it('is never offered for upload', async () => {
      // A build from before this fix lands `{}` from the server, which resets
      // every preference on the device that takes it.
      expect(collectUnits().map((unit) => unit.id)).not.toContain('data:settings');
      expect(collectUnit('data:settings')).toBeNull();
    });

    it("does not keep the account's preferences out", async () => {
      const { applied } = await applyUnits([{
        id: 'data:settings', kind: 'plain', payload: JSON.stringify(THEIR_SETTINGS),
        // OLDER than the damage stamp: nothing chosen here can outrank it.
        modifiedAt: '2026-09-20T12:00:00.000Z',
      }]);

      expect(applied).toBe(1);
      const { settings } = onDisk();
      expect(settings.colorPalette).toBe('ocean');
      expect(settings[CHANGELOG_SEEN_FIELD]).toBe('2.3.0');
    });

    it('does not hand the damage stamp to settings that arrive unstamped', async () => {
      // Written before sync existed, the account's copy carries no time. Left
      // holding the damage stamp, it would be re-offered claiming the moment of
      // the damage, and outrank every real copy stamped before it.
      await applyUnits([{
        id: 'data:settings', kind: 'plain', payload: JSON.stringify(THEIR_SETTINGS), modifiedAt: null,
      }]);

      expect(onDisk().settings.colorPalette).toBe('ocean');
      expect(collectUnit('data:settings').modifiedAt).toBeNull();
    });
  });
});

describe("a landed copy keeps its author's time", () => {
  // `modifiedAt` travels in the record, and a unit sent with none CLEARS it on
  // the server (OPSync's record builder). A landing recorded no time here, so a
  // fresh device's full upload re-sent everything it had just received with
  // none — and a device holding an OLDER stamp then outranked the newer copy
  // and reverted it everywhere on its next edit. The same missing time let an
  // older copy arriving after a newer one simply land over it.
  const EARLIER = '2026-09-20T12:00:00.000Z';
  const LATER = '2026-09-25T12:00:00.000Z';
  const profileAt = (fullName) => JSON.stringify({ ...THEIR_PROFILE, contactInfo: { ...THEIR_PROFILE.contactInfo, fullName } });

  it('offers it back carrying that time, not none', async () => {
    await applyUnits([{ id: 'data:userProfile', kind: 'plain', payload: profileAt('Ada'), modifiedAt: LATER }]);

    expect(collectUnit('data:userProfile').modifiedAt).toBe(LATER);
  });

  it('does the same for a key it lands', async () => {
    await applyUnits([{
      id: 'key:resume-designer-applications', kind: 'plain', payload: '[{"id":"a-9"}]', modifiedAt: LATER,
    }]);

    expect(collectUnit('key:resume-designer-applications').modifiedAt).toBe(LATER);
  });

  it('settles an older copy that arrives after it', async () => {
    await applyUnits([{ id: 'data:userProfile', kind: 'plain', payload: profileAt('Newer'), modifiedAt: LATER }]);
    const { applied } = await applyUnits([
      { id: 'data:userProfile', kind: 'plain', payload: profileAt('Older'), modifiedAt: EARLIER },
    ]);

    expect(applied).toBe(0);
    expect(onDisk().userProfile.contactInfo.fullName).toBe('Newer');
  });

  it('announces nothing, and records no time of its own', async () => {
    await applyUnits([{ id: 'data:userProfile', kind: 'plain', payload: profileAt('Ada'), modifiedAt: LATER }]);
    await settle();

    expect(notify).not.toHaveBeenCalled();
    expect(stamps()['data:userProfile']).toEqual({ modifiedAt: LATER });
  });
});

describe('a blob that has no settings yet', () => {
  // The shape a pull leaves when only résumés have landed: mergeData builds the
  // blob from nothing, so it has no `settings` field at all.
  beforeEach(async () => {
    const { applied } = await applyUnits([{
      id: 'resume:v-1',
      kind: 'resume',
      payload: JSON.stringify({ id: 'v-1', name: 'Theirs', data: { name: 'Ada' } }),
      modifiedAt: '2026-09-20T12:00:00.000Z',
    }]);
    expect(applied).toBe(1);
    expect(onDisk().settings).toBeUndefined();
    notify.mockClear();
  });

  it('gets the default settings, not a settings object with one key in it', async () => {
    recordVersionSeen();
    await settle();

    expect(onDisk().settings).toEqual({ ...DEFAULT_STORAGE.settings, [CHANGELOG_SEEN_FIELD]: '2.3.1' });
    expect(stamps()['data:settings']).toBeUndefined();
    expect(allNamed()).not.toContain('data:settings');
  });
});
