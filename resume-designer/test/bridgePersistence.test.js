// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBridgeRouter } from '../src/bridgeRoutes.js';
import { appStorage, initAppStorage, __resetAppStorageForTests, setProfileMapping } from '../src/appStorage.js';
import { addApplication, getAllApplications, initApplications, setApplicationStatus, updateApplication } from '../src/applications.js';
import { saveLearnedAnswer, getAllLearnedAnswers, initLearnedAnswers } from '../src/learnedAnswers.js';

const AUTH = 'Bearer test-token';
const ENDPOINTS = [
  {
    path: '/applications',
    key: 'resume-designer-applications',
    payload: { variantId: 'v-1', title: 'Engineer', company: 'Example' },
    responseKey: 'application',
    read: getAllApplications,
  },
  {
    path: '/profile/answers',
    key: 'resume-designer-learned-answers',
    payload: { question: 'Notice period?', answer: 'Two weeks' },
    responseKey: 'answer',
    read: getAllLearnedAnswers,
  },
];

function router(overrides = {}) {
  return createBridgeRouter({
    getToken: () => 'test-token',
    profileContextId: 'context-1',
    getVariants: () => ({ 'v-1': { id: 'v-1', name: 'Resume' } }),
    addApplication,
    saveLearnedAnswer,
    flush: () => appStorage.flush(),
    ...overrides,
  });
}

function request(endpoint) {
  return {
    method: 'POST', path: endpoint.path, authorization: AUTH,
    body: JSON.stringify({ profileContextId: 'context-1', ...endpoint.payload }),
  };
}

function backend(write = async (files, key, value) => files.set(key, value)) {
  const files = new Map();
  return {
    files,
    loadAll: async () => Object.fromEntries(files),
    write: (key, value) => write(files, key, value),
    delete: async (key) => files.delete(key),
    clear: async () => files.clear(),
  };
}

beforeEach(() => {
  __resetAppStorageForTests();
  localStorage.clear();
  initApplications();
  initLearnedAnswers();
});

afterEach(() => {
  __resetAppStorageForTests();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe.each(ENDPOINTS)('$path durable acknowledgement', (endpoint) => {
  it('reports a synchronous quota error and retries without preserving a phantom record', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const quota = vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
      throw new DOMException('Storage is full', 'QuotaExceededError');
    });
    const handle = router();
    const failed = await handle(request(endpoint));
    expect(failed).toMatchObject({ status: 507, body: { code: 'storage_full' } });
    expect(failed.body[endpoint.responseKey]).toBeUndefined();
    expect(endpoint.read()).toEqual([]);

    quota.mockRestore();
    const saved = await handle(request(endpoint));
    expect(saved.status).toBe(201);
    expect(JSON.parse(localStorage.getItem(endpoint.key))).toHaveLength(1);
    expect(JSON.parse(localStorage.getItem(endpoint.key))[0].id).toBe(saved.body[endpoint.responseKey].id);
  });

  it('keeps the response pending until the queued disk write lands', async () => {
    let release;
    const pendingWrite = new Promise((resolve) => { release = resolve; });
    const disk = backend(async (files, key, value) => {
      await pendingWrite;
      files.set(key, value);
    });
    await initAppStorage({ backend: disk });
    let settled = false;
    const operation = router()(request(endpoint)).then((response) => {
      settled = true;
      return response;
    });
    try {
      await Promise.resolve();
      expect(settled).toBe(false);
      expect(disk.files.has(endpoint.key)).toBe(false);
      release();
      const saved = await operation;
      expect(saved.status).toBe(201);
      expect(JSON.parse(disk.files.get(endpoint.key))).toEqual([saved.body[endpoint.responseKey]]);
    } finally {
      release();
      await operation;
      await appStorage.flush();
    }
  });

  it('reports a queued disk rejection rather than returning the in-memory record', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const disk = backend(async () => { throw new Error('Disk is full'); });
    await initAppStorage({ backend: disk });
    const failed = await router()(request(endpoint));
    expect(failed).toMatchObject({ status: 507, body: { code: 'storage_full' } });
    expect(failed.body[endpoint.responseKey]).toBeUndefined();
    expect(disk.files.has(endpoint.key)).toBe(false);
  });

  it('rolls back a failed queued save so a retry persists exactly one record', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    let rejectWrites = true;
    const disk = backend(async (files, key, value) => {
      if (rejectWrites) throw new Error('Disk is full');
      files.set(key, value);
    });
    await initAppStorage({ backend: disk });
    const handle = router();
    expect((await handle(request(endpoint))).status).toBe(507);
    expect(endpoint.read()).toEqual([]);
    expect(JSON.parse(appStorage.getItem(endpoint.key))).toEqual([]);
    rejectWrites = false;
    const saved = await handle(request(endpoint));
    expect(saved.status).toBe(201);
    expect(JSON.parse(disk.files.get(endpoint.key))).toEqual([saved.body[endpoint.responseKey]]);
  });

  it('does not acknowledge an unavailable durability check', async () => {
    const failed = await router({ flush: undefined })(request(endpoint));
    expect(failed.status).not.toBe(201);
  });

  it('surfaces a rejected durability check', async () => {
    const failed = await router({ flush: async () => { throw new Error('Storage unavailable'); } })(request(endpoint));
    expect(failed).toMatchObject({ status: 507, body: { code: 'storage_full' } });
  });

  it('rejects success if an import starts while waiting for the disk', async () => {
    let suspended = false;
    let release;
    const pendingWrite = new Promise((resolve) => { release = resolve; });
    const disk = backend(async (files, key, value) => {
      await pendingWrite;
      files.set(key, value);
    });
    await initAppStorage({ backend: disk });
    const operation = router({ writesSuspended: () => suspended })(request(endpoint));
    suspended = true;
    release();
    expect(await operation).toMatchObject({ status: 503, body: { code: 'profile_changed' } });
    await appStorage.flush();
  });

  it.each(['token change', 'revocation', 'failed revocation'])(
    'withholds the saved record after %s while its disk write is pending',
    async (change) => {
      let token = 'test-token';
      let release;
      const pendingWrite = new Promise((resolve) => { release = resolve; });
      const disk = backend(async (files, key, value) => {
        await pendingWrite;
        files.set(key, value);
      });
      await initAppStorage({ backend: disk });
      const handle = router({
        getToken: () => token,
        revokePairing: async () => {
          if (change === 'failed revocation') throw new Error('Token rotation failed');
          token = 'new-token';
        },
      });
      const operation = handle(request(endpoint));
      try {
        if (change === 'token change') token = 'new-token';
        else await handle({ method: 'POST', path: '/pairing/revoke', authorization: AUTH, body: '{}' });
        release();
        const response = await operation;
        expect(response).toMatchObject({ status: 401, body: { code: 'unauthorized' } });
        expect(response.body[endpoint.responseKey]).toBeUndefined();
        // Revocation withholds the response; it does not undo a write that
        // was authorized and queued before the pairing changed.
        expect(JSON.parse(disk.files.get(endpoint.key))).toHaveLength(1);
      } finally {
        release();
        await operation;
        await appStorage.flush();
      }
    },
  );

  it.each(['token change', 'revocation', 'failed revocation', 'pending failed revocation', 'import', 'profile change'])(
    'rechecks a queued save after %s without mutating storage',
    async (change) => {
      let token = 'test-token';
      let suspended = false;
      let release;
      const pendingWrite = new Promise((resolve) => { release = resolve; });
      let firstStarted;
      const started = new Promise((resolve) => { firstStarted = resolve; });
      let finishRevocation;
      const pendingRevocation = new Promise((resolve) => { finishRevocation = resolve; });
      const disk = backend(async (files, key, value) => {
        firstStarted();
        await pendingWrite;
        files.set(key, value);
      });
      await initAppStorage({ backend: disk });
      const deps = {
        getToken: () => token,
        profileContextId: 'context-1',
        getVariants: () => ({ 'v-1': { id: 'v-1', name: 'Resume' } }),
        addApplication: vi.fn(addApplication),
        saveLearnedAnswer: vi.fn(saveLearnedAnswer),
        flush: () => appStorage.flush(),
        writesSuspended: () => suspended,
        revokePairing: async () => {
          if (change === 'pending failed revocation') await pendingRevocation;
          if (change.includes('failed revocation')) throw new Error('Token rotation failed');
          token = 'new-token';
        },
      };
      const handle = createBridgeRouter(deps);
      const first = handle(request(ENDPOINTS[0]));
      await started;
      // Reads and revocation must remain available while a save holds the queue.
      expect((await handle({ method: 'GET', path: '/resumes', authorization: AUTH })).status).toBe(200);
      const revoke = () => handle({ method: 'POST', path: '/pairing/revoke', authorization: AUTH, body: '{}' });
      const revoking = change === 'pending failed revocation' ? revoke() : null;
      const queued = handle(request(endpoint));
      try {
        if (change === 'token change') token = 'new-token';
        else if (change === 'import') suspended = true;
        else if (change === 'profile change') deps.profileContextId = 'context-2';
        else if (revoking) {
          finishRevocation();
          expect((await revoking).status).toBe(500);
        } else {
          expect((await revoke()).status).toBe(change === 'failed revocation' ? 500 : 200);
        }
        release();
        await first;
        const expectedStatus = change === 'import' ? 503 : change === 'profile change' ? 409 : 401;
        expect((await queued).status).toBe(expectedStatus);
        expect(deps.addApplication).toHaveBeenCalledTimes(1);
        expect(deps.saveLearnedAnswer).not.toHaveBeenCalled();
        expect(JSON.parse(disk.files.get(ENDPOINTS[0].key))).toHaveLength(1);
        expect(disk.files.has(ENDPOINTS[1].key)).toBe(false);
      } finally {
        release();
        finishRevocation();
        await Promise.all([first, queued, revoking]);
        await appStorage.flush();
      }
    },
  );
});

it('does not resurrect a rejected application during an unrelated later flush', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let rejectWrites = false;
  const disk = backend(async (files, key, value) => {
    if (rejectWrites) throw new Error('Disk is full');
    files.set(key, value);
  });
  await initAppStorage({ backend: disk });
  const existing = addApplication({ variantId: 'existing', notes: 'Keep this application' });
  await appStorage.flush();
  rejectWrites = true;
  expect((await router()(request(ENDPOINTS[0]))).status).toBe(507);
  rejectWrites = false;
  appStorage.setItem('resume-zoom', '1.5');
  expect(await appStorage.flush()).toBe(true);
  expect(getAllApplications()).toEqual([existing]);
  expect(JSON.parse(disk.files.get(ENDPOINTS[0].key))).toEqual([existing]);
  expect(disk.files.get('resume-zoom')).toBe('1.5');
});

it('preserves an overlapping accepted application when another application is rejected', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let release;
  const pendingWrite = new Promise((resolve) => { release = resolve; });
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  const disk = backend(async (files, key, value) => {
    const entries = JSON.parse(value);
    if (entries.some((entry) => entry.jobSnapshot.title === 'Rejected')) throw new Error('Write rejected');
    firstStarted();
    await pendingWrite;
    files.set(key, value);
  });
  await initAppStorage({ backend: disk });
  const handle = router();
  const endpoint = ENDPOINTS[0];
  const accepted = handle(request(endpoint));
  await started;
  const rejected = handle(request({ ...endpoint, payload: { ...endpoint.payload, title: 'Rejected' } }));
  release();
  expect((await rejected).status).toBe(507);
  const saved = await accepted;
  expect(saved.status).toBe(201);
  await appStorage.flush();
  expect(getAllApplications()).toEqual([saved.body.application]);
  expect(JSON.parse(disk.files.get(endpoint.key))).toEqual([saved.body.application]);
});

it('restores the previous answer after a rejected queued upsert', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  const disk = backend(async (files, key, value) => {
    if (JSON.parse(value).some((entry) => entry.answer === 'Two weeks')) throw new Error('Write rejected');
    files.set(key, value);
  });
  await initAppStorage({ backend: disk });
  const original = saveLearnedAnswer('Notice period?', 'Four weeks');
  await appStorage.flush();
  expect((await router()(request(ENDPOINTS[1]))).status).toBe(507);
  await appStorage.flush();
  expect(getAllLearnedAnswers()).toEqual([original]);
  expect(JSON.parse(disk.files.get(ENDPOINTS[1].key))).toEqual([original]);
});

it.each(['notes', 'status'])('preserves a newer native application %s edit when the bridge save is rejected', async (field) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let release;
  const pendingWrite = new Promise((resolve) => { release = resolve; });
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  let attempts = 0;
  const disk = backend(async (files, key, value) => {
    attempts += 1;
    if (attempts <= 2) {
      firstStarted();
      await pendingWrite;
      throw new Error('Write rejected');
    }
    files.set(key, value);
  });
  await initAppStorage({ backend: disk });
  const rejected = router()(request(ENDPOINTS[0]));
  await started;
  const application = getAllApplications()[0];
  const newer = field === 'notes'
    ? updateApplication(application.id, { notes: 'Updated in On Paper' })
    : setApplicationStatus(application.id, 'interview');
  release();
  expect((await rejected).status).toBe(507);
  await appStorage.flush();
  expect(getAllApplications()).toEqual([newer]);
  expect(JSON.parse(disk.files.get(ENDPOINTS[0].key))).toEqual([newer]);
});

it.each(['Six weeks', 'Two weeks'])('preserves the newer answer %s when an older queued upsert is rejected', async (answer) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.useFakeTimers({ toFake: ['Date'] });
  let release;
  const pendingWrite = new Promise((resolve) => { release = resolve; });
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  let attempts = 0;
  const disk = backend(async (files, key, value) => {
    attempts += 1;
    if (attempts <= 2) {
      firstStarted();
      await pendingWrite;
      throw new Error('Write rejected');
    }
    files.set(key, value);
  });
  await initAppStorage({ backend: disk });
  const rejected = router()(request(ENDPOINTS[1]));
  await started;
  const newer = saveLearnedAnswer('Notice period?', answer);
  release();
  expect((await rejected).status).toBe(507);
  await appStorage.flush();
  expect(getAllLearnedAnswers()).toEqual([newer]);
  expect(JSON.parse(disk.files.get(ENDPOINTS[1].key))).toEqual([newer]);
});

it.each([undefined, 'Four weeks'])('does not restore an earlier rejected answer after two failures (prior: %s)', async (prior) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let release;
  const pendingWrite = new Promise((resolve) => { release = resolve; });
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  let rejectWrites = false;
  const disk = backend(async (files, key, value) => {
    if (rejectWrites) {
      firstStarted();
      await pendingWrite;
      throw new Error('Write rejected');
    }
    files.set(key, value);
  });
  await initAppStorage({ backend: disk });
  const original = prior ? saveLearnedAnswer('Notice period?', prior) : null;
  await appStorage.flush();
  rejectWrites = true;
  const handle = router();
  const endpoint = ENDPOINTS[1];
  const first = handle(request(endpoint));
  await started;
  const second = handle(request({ ...endpoint, payload: { ...endpoint.payload, answer: 'Six weeks' } }));
  release();
  expect((await first).status).toBe(507);
  expect((await second).status).toBe(507);
  expect(getAllLearnedAnswers()).toEqual(original ? [original] : []);
  rejectWrites = false;
  await appStorage.flush();
  expect(JSON.parse(disk.files.get(endpoint.key))).toEqual(original ? [original] : []);
});

it('waits for an earlier rollback before accepting the next queued answer', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let rejectWrites = true;
  const disk = backend(async (files, key, value) => {
    if (rejectWrites) throw new Error('Write rejected');
    files.set(key, value);
  });
  await initAppStorage({ backend: disk });
  let failureObserved;
  const failed = new Promise((resolve) => { failureObserved = resolve; });
  let reportFailure;
  const pendingFailure = new Promise((resolve) => { reportFailure = resolve; });
  let calls = 0;
  const handle = router({ flush: async () => {
    calls += 1;
    const first = calls === 1;
    const durable = await appStorage.flush();
    if (first) {
      failureObserved();
      await pendingFailure;
    }
    return durable;
  } });
  const endpoint = ENDPOINTS[1];
  const rejected = handle(request(endpoint));
  await failed;
  rejectWrites = false;
  const next = handle(request({ ...endpoint, payload: { ...endpoint.payload, answer: 'Six weeks' } }));
  try {
    expect(getAllLearnedAnswers()[0].answer).toBe('Two weeks');
  } finally {
    reportFailure();
  }
  expect((await rejected).status).toBe(507);
  const accepted = await next;
  expect(accepted.status).toBe(201);
  expect(getAllLearnedAnswers()).toEqual([accepted.body.answer]);
  expect(JSON.parse(disk.files.get(endpoint.key))).toEqual([accepted.body.answer]);
});

it.each(['commit', 'abort'])('keeps rejected-write rollback behind an import guard until %s', async (outcome) => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let release;
  const pendingWrite = new Promise((resolve) => { release = resolve; });
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  let attempts = 0;
  const disk = backend(async (files, key, value) => {
    attempts += 1;
    if (attempts <= 2) {
      firstStarted();
      await pendingWrite;
      throw new Error('Write rejected');
    }
    files.set(key, value);
  });
  await initAppStorage({ backend: disk });
  const endpoint = ENDPOINTS[0];
  const rejected = router()(request(endpoint));
  await started;
  const beforeImport = appStorage.getItem(endpoint.key);
  const imported = [{ id: 'imported-app', variantId: 'imported-resume' }];
  appStorage.setItem(endpoint.key, JSON.stringify(imported));
  appStorage.beginRestoreGuard(new Map([[endpoint.key, beforeImport]]), [endpoint.key]);
  release();
  expect((await rejected).status).toBe(507);
  appStorage.clearPreRestoreSnapshot();
  expect(JSON.parse(appStorage.getItem(endpoint.key))).toEqual(imported);
  appStorage.endRestoreGuard();
  if (outcome === 'commit') appStorage.discardDeferredWrites();
  else {
    appStorage.setItem(endpoint.key, beforeImport);
    appStorage.flushDeferredWrites();
  }
  await appStorage.flush();
  expect(JSON.parse(disk.files.get(endpoint.key))).toEqual(outcome === 'commit' ? imported : []);
});

it('rolls back the original profile without replacing the newly active profile', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let release;
  const pendingWrite = new Promise((resolve) => { release = resolve; });
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  let attempts = 0;
  const disk = backend(async (files, key, value) => {
    attempts += 1;
    if (attempts <= 2) {
      firstStarted();
      await pendingWrite;
      throw new Error('Write rejected');
    }
    files.set(key, value);
  });
  await initAppStorage({ backend: disk });
  setProfileMapping('profile1');
  const rejected = router()(request(ENDPOINTS[0]));
  await started;
  setProfileMapping('profile2');
  initApplications();
  const other = addApplication({ variantId: 'other-profile' });
  release();
  expect((await rejected).status).toBe(507);
  await appStorage.flush();
  expect(getAllApplications()).toEqual([other]);
  expect(JSON.parse(disk.files.get('resume-p--profile2--resume-designer-applications'))).toEqual([other]);
  expect(JSON.parse(disk.files.get('resume-p--profile1--resume-designer-applications'))).toEqual([]);
});

it('preserves the previous answer when a strict upsert hits the localStorage quota', async () => {
  const original = saveLearnedAnswer('Notice period?', 'Four weeks');
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => {
    throw new DOMException('Storage is full', 'QuotaExceededError');
  });
  expect((await router()(request(ENDPOINTS[1]))).status).toBe(507);
  expect(getAllLearnedAnswers()).toEqual([original]);
  expect(getAllLearnedAnswers()[0].answer).toBe('Four weeks');
});

it.each(['same turn', 'after first starts'])('persists each overlapping answer before acknowledging it (%s)', async (timing) => {
  let firstStarted;
  const started = new Promise((resolve) => { firstStarted = resolve; });
  let releaseFirst;
  const firstWrite = new Promise((resolve) => { releaseFirst = resolve; });
  let releaseSecond;
  const secondWrite = new Promise((resolve) => { releaseSecond = resolve; });
  let writeCount = 0;
  const disk = backend(async (files, key, value) => {
    writeCount += 1;
    if (writeCount === 1) {
      firstStarted();
      await firstWrite;
    } else {
      await secondWrite;
    }
    files.set(key, value);
  });
  await initAppStorage({ backend: disk });
  const handle = router();
  const endpoint = ENDPOINTS[1];
  const first = handle(request(endpoint));
  if (timing === 'after first starts') await started;
  const second = handle(request({ ...endpoint, payload: { ...endpoint.payload, answer: 'Four weeks' } }));
  try {
    releaseFirst();
    const firstResponse = await first;
    expect(firstResponse.status).toBe(201);
    expect(firstResponse.body.answer.answer).toBe('Two weeks');
    expect(JSON.parse(disk.files.get(endpoint.key))[0].answer).toBe('Two weeks');
  } finally {
    releaseFirst();
    releaseSecond();
    await Promise.all([first, second]);
  }
  expect((await second).body.answer.answer).toBe('Four weeks');
  expect(JSON.parse(disk.files.get(endpoint.key))[0].answer).toBe('Four weeks');
});
