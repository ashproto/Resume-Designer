// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createBridgeRouter } from '../src/bridgeRoutes.js';
import { appStorage, initAppStorage, __resetAppStorageForTests } from '../src/appStorage.js';
import { addApplication, getAllApplications, initApplications } from '../src/applications.js';
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
});

it('retries a failed answer upsert to disk even when the in-memory answer already matches', async () => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
  let rejectWrites = true;
  const disk = backend(async (files, key, value) => {
    if (rejectWrites) throw new Error('Disk is full');
    files.set(key, value);
  });
  await initAppStorage({ backend: disk });
  const endpoint = ENDPOINTS[1];
  const handle = router();
  expect((await handle(request(endpoint))).status).toBe(507);
  expect(getAllLearnedAnswers()).toHaveLength(1);
  rejectWrites = false;
  const saved = await handle(request(endpoint));
  expect(saved.status).toBe(201);
  expect(JSON.parse(disk.files.get(endpoint.key))).toEqual([saved.body.answer]);
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

it('does not acknowledge a later answer whose disk write is still pending', async () => {
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
  await started;
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
