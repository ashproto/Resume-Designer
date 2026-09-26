import { describe, expect, it, vi } from 'vitest';

import {
  fetchChromeStoreStatus,
  readPackagedManifestVersion,
  submitChromeExtensionUpdate,
} from '../scripts/cws-publish.mjs';
import {
  compareChromeVersions,
  parseChromeVersion,
} from '../scripts/chrome-version.mjs';
import { createDeterministicZip } from '../scripts/store-package.mjs';

const ACCESS_TOKEN = 'test-access-token-never-log';
const EXTENSION_ID = 'abcdefghijklmnopabcdefghijklmnop';
const PUBLISHER_ID = 'publisher-123';

function response(body, status = 200) {
  return new Response(JSON.stringify(body), {
    headers: { 'content-type': 'application/json' },
    status,
  });
}

function fetchSequence(...items) {
  return vi.fn(async () => {
    const item = items.shift();
    if (item instanceof Error) throw item;
    if (typeof item === 'function') return item();
    if (!item) throw new Error('Unexpected fetch call');
    return response(item.body ?? item, item.status ?? 200);
  });
}

function revision(state, version) {
  return {
    distributionChannels: version ? [{ crxVersion: version, deployPercentage: 100 }] : [],
    state,
  };
}

function publishedStatus(version = '0.9.0', overrides = {}) {
  return {
    itemId: EXTENSION_ID,
    name: `publishers/${PUBLISHER_ID}/items/${EXTENSION_ID}`,
    publishedItemRevisionStatus: revision('PUBLISHED', version),
    takenDown: false,
    warned: false,
    ...overrides,
  };
}

function submissionOptions(overrides = {}) {
  return {
    accessToken: ACCESS_TOKEN,
    extensionId: EXTENSION_ID,
    fetchImpl: fetchSequence(),
    packageBytes: packageForVersion('1.0.0'),
    publisherId: PUBLISHER_ID,
    version: '1.0.0',
    ...overrides,
  };
}

function packageForVersion(version) {
  return createDeterministicZip([
    {
      path: 'manifest.json',
      data: Buffer.from(JSON.stringify({ manifest_version: 3, version })),
    },
  ]);
}

function zipCentralEntries(zip) {
  const endOffset = zip.byteLength - 22;
  const count = zip.readUInt16LE(endOffset + 10);
  let offset = zip.readUInt32LE(endOffset + 16);
  const entries = [];
  for (let index = 0; index < count; index += 1) {
    const nameBytes = zip.readUInt16LE(offset + 28);
    const extraBytes = zip.readUInt16LE(offset + 30);
    const commentBytes = zip.readUInt16LE(offset + 32);
    entries.push({
      centralOffset: offset,
      localOffset: zip.readUInt32LE(offset + 42),
      path: zip.toString('utf8', offset + 46, offset + 46 + nameBytes),
    });
    offset += 46 + nameBytes + extraBytes + commentBytes;
  }
  return entries;
}

describe('Chrome extension versions', () => {
  it('validates Chrome numeric versions and compares missing components as zero', () => {
    expect(parseChromeVersion('1.2')).toEqual([1, 2, 0, 0]);
    expect(compareChromeVersions('1.2', '1.1.9999')).toBeGreaterThan(0);
    expect(compareChromeVersions('1.2', '1.2.0.0')).toBe(0);
    expect(compareChromeVersions('0.1.0.0', '0.0.65535.65535')).toBeGreaterThan(0);

    for (const invalid of ['', '0', '0.0.0.0', '01.2', '1.2.3.4.5', '1.65536', '1.beta']) {
      expect(() => parseChromeVersion(invalid)).toThrow(/version/i);
    }
  });
});

describe('fetchChromeStoreStatus', () => {
  it('uses the read endpoint without exposing the access token in its result', async () => {
    const fetchImpl = fetchSequence(publishedStatus());
    const result = await fetchChromeStoreStatus({
      accessToken: ACCESS_TOKEN,
      extensionId: EXTENSION_ID,
      fetchImpl,
      publisherId: PUBLISHER_ID,
    });

    expect(result).toMatchObject({ itemId: EXTENSION_ID, warned: false });
    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
    expect(fetchImpl).toHaveBeenCalledWith(
      `https://chromewebstore.googleapis.com/v2/publishers/${PUBLISHER_ID}/items/${EXTENSION_ID}:fetchStatus`,
      expect.objectContaining({
        headers: expect.objectContaining({ Authorization: `Bearer ${ACCESS_TOKEN}` }),
        method: 'GET',
      }),
    );
  });
});

describe('readPackagedManifestVersion', () => {
  it('reads a structurally complete deterministic stored ZIP', () => {
    expect(readPackagedManifestVersion(packageForVersion('1.2.3'))).toBe('1.2.3');
  });

  it('rejects truncation, invalid central-directory boundaries, and CRC corruption', () => {
    const complete = packageForVersion('1.2.3');
    expect(() => readPackagedManifestVersion(complete.subarray(0, -1))).toThrow(/end|truncated/i);

    const badBoundary = Buffer.from(complete);
    const endOffset = badBoundary.byteLength - 22;
    badBoundary.writeUInt32LE(badBoundary.readUInt32LE(endOffset + 12) + 1, endOffset + 12);
    expect(() => readPackagedManifestVersion(badBoundary)).toThrow(/central directory boundary/i);

    const badCrc = Buffer.from(complete);
    const localNameBytes = badCrc.readUInt16LE(26);
    badCrc[30 + localNameBytes] ^= 1;
    expect(() => readPackagedManifestVersion(badCrc)).toThrow(/crc/i);
  });

  it('requires local and central records to agree and rejects duplicate entries', () => {
    const disagreement = packageForVersion('1.2.3');
    const [{ centralOffset }] = zipCentralEntries(disagreement);
    disagreement.writeUInt32LE(
      (disagreement.readUInt32LE(centralOffset + 16) ^ 1) >>> 0,
      centralOffset + 16,
    );
    expect(() => readPackagedManifestVersion(disagreement)).toThrow(/disagree/i);

    const duplicate = createDeterministicZip([
      { path: 'aaaaaaaaaaaaa', data: Buffer.from('not the manifest') },
      {
        path: 'manifest.json',
        data: Buffer.from(JSON.stringify({ manifest_version: 3, version: '1.2.3' })),
      },
    ]);
    const duplicateEntry = zipCentralEntries(duplicate).find((entry) => entry.path === 'aaaaaaaaaaaaa');
    const manifestPath = Buffer.from('manifest.json');
    manifestPath.copy(duplicate, duplicateEntry.localOffset + 30);
    manifestPath.copy(duplicate, duplicateEntry.centralOffset + 46);
    expect(() => readPackagedManifestVersion(duplicate)).toThrow(/duplicate entry/i);
  });
});

describe('submitChromeExtensionUpdate', () => {
  it('uploads the exact package and submits it for automatic publication after approval', async () => {
    const fetchImpl = fetchSequence(
      publishedStatus('0.9.0'),
      { uploadState: 'SUCCEEDED', crxVersion: '1.0.0', itemId: EXTENSION_ID },
      publishedStatus('0.9.0'),
      { state: 'PENDING_REVIEW', itemId: EXTENSION_ID },
      publishedStatus('1.0.0'),
    );

    const packageBytes = packageForVersion('1.0.0');
    const result = await submitChromeExtensionUpdate(submissionOptions({
      fetchImpl,
      packageBytes,
    }));

    expect(result).toEqual({
      extensionId: EXTENSION_ID,
      publishType: 'DEFAULT_PUBLISH',
      state: 'PENDING_REVIEW',
      version: '1.0.0',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(5);
    expect(fetchImpl.mock.calls[1]).toEqual([
      `https://chromewebstore.googleapis.com/upload/v2/publishers/${PUBLISHER_ID}/items/${EXTENSION_ID}:upload`,
      expect.objectContaining({
        body: packageBytes,
        headers: expect.objectContaining({
          Authorization: `Bearer ${ACCESS_TOKEN}`,
          'Content-Type': 'application/zip',
        }),
        method: 'POST',
      }),
    ]);
    expect(JSON.parse(fetchImpl.mock.calls[3][1].body)).toEqual({
      blockOnWarnings: true,
      publishType: 'DEFAULT_PUBLISH',
    });
  });

  it('supports a staged-on-approval release without trying to skip review', async () => {
    const fetchImpl = fetchSequence(
      publishedStatus(),
      { uploadState: 'SUCCEEDED', crxVersion: '1.0.0' },
      publishedStatus(),
      { state: 'PENDING_REVIEW' },
      publishedStatus('0.9.0', {
        submittedItemRevisionStatus: revision('PENDING_REVIEW', '1.0.0'),
      }),
    );

    await submitChromeExtensionUpdate(submissionOptions({
      fetchImpl,
      publishType: 'STAGED_PUBLISH',
    }));

    expect(JSON.parse(fetchImpl.mock.calls[3][1].body)).toEqual({
      blockOnWarnings: true,
      publishType: 'STAGED_PUBLISH',
    });
  });

  it.each([
    ['a policy warning', { warned: true }, /warned|policy/i],
    ['a takedown', { takenDown: true }, /taken down|policy/i],
    [
      'a pending review',
      { submittedItemRevisionStatus: revision('PENDING_REVIEW', '0.9.1') },
      /active submission|pending review/i,
    ],
    [
      'an approved staged revision',
      { submittedItemRevisionStatus: revision('STAGED', '0.9.1') },
      /active submission|staged/i,
    ],
  ])('refuses to overwrite %s', async (_label, overrides, errorPattern) => {
    const fetchImpl = fetchSequence(publishedStatus('0.9.0', overrides));

    await expect(submitChromeExtensionUpdate(submissionOptions({ fetchImpl })))
      .rejects.toThrow(errorPattern);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each([
    ['published', publishedStatus('1.0.0'), 'PUBLISHED'],
    [
      'pending review',
      publishedStatus('0.9.0', {
        submittedItemRevisionStatus: revision('PENDING_REVIEW', '1.0.0'),
      }),
      'PENDING_REVIEW',
    ],
    [
      'staged',
      publishedStatus('0.9.0', {
        submittedItemRevisionStatus: revision('STAGED', '1.0.0'),
      }),
      'STAGED',
    ],
  ])('treats the same version already %s as a safe no-op', async (label, status, state) => {
    const fetchImpl = fetchSequence(status);

    await expect(submitChromeExtensionUpdate(submissionOptions({ fetchImpl }))).resolves.toEqual({
      extensionId: EXTENSION_ID,
      publishType: 'DEFAULT_PUBLISH',
      reason: label === 'published' ? 'already-published' : 'already-submitted',
      skipped: true,
      state,
      version: '1.0.0',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it.each(['REJECTED', 'CANCELLED'])(
    'refuses to reuse the same version after a %s submission',
    async (state) => {
      const fetchImpl = fetchSequence(publishedStatus('0.9.0', {
        submittedItemRevisionStatus: revision(state, '1.0.0'),
      }));

      await expect(submitChromeExtensionUpdate(submissionOptions({ fetchImpl })))
        .rejects.toThrow(/cannot reuse|rejected|cancelled/i);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    },
  );

  it('requires a version greater than every published or prior submitted revision', async () => {
    for (const status of [
      publishedStatus('1.1.0'),
      publishedStatus('0.9.0', {
        submittedItemRevisionStatus: revision('REJECTED', '1.1.0'),
      }),
    ]) {
      const fetchImpl = fetchSequence(status);
      await expect(submitChromeExtensionUpdate(submissionOptions({ fetchImpl })))
        .rejects.toThrow(/version.*greater|newer/i);
      expect(fetchImpl).toHaveBeenCalledTimes(1);
    }
  });

  it('binds the expected version to the manifest embedded in the uploaded ZIP', async () => {
    const fetchImpl = vi.fn();

    await expect(submitChromeExtensionUpdate(submissionOptions({
      fetchImpl,
      packageBytes: packageForVersion('0.9.9'),
    }))).rejects.toThrow(/zip.*version|version.*zip/i);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('polls a bounded number of times when an upload is processed asynchronously', async () => {
    const fetchImpl = fetchSequence(
      publishedStatus(),
      { uploadState: 'IN_PROGRESS' },
      publishedStatus('0.9.0', { lastAsyncUploadState: 'IN_PROGRESS' }),
      publishedStatus('0.9.0', { lastAsyncUploadState: 'SUCCEEDED' }),
      publishedStatus('0.9.0'),
      { state: 'PENDING_REVIEW' },
      publishedStatus('0.9.0', {
        submittedItemRevisionStatus: revision('PENDING_REVIEW', '1.0.0'),
      }),
    );
    const sleep = vi.fn(async () => {});

    await submitChromeExtensionUpdate(submissionOptions({ fetchImpl, sleep }));

    expect(sleep).toHaveBeenCalledTimes(2);
    expect(fetchImpl).toHaveBeenCalledTimes(7);
  });

  it('re-checks immediately before publish and returns a no-op if the version won the race', async () => {
    const fetchImpl = fetchSequence(
      publishedStatus('0.9.0'),
      { uploadState: 'SUCCEEDED', crxVersion: '1.0.0' },
      publishedStatus('0.9.0', {
        submittedItemRevisionStatus: revision('PENDING_REVIEW', '1.0.0'),
      }),
    );

    await expect(submitChromeExtensionUpdate(submissionOptions({ fetchImpl }))).resolves.toMatchObject({
      skipped: true,
      state: 'PENDING_REVIEW',
      version: '1.0.0',
    });
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(fetchImpl.mock.calls.some(([url]) => url.endsWith(':publish'))).toBe(false);
  });

  it('fails when a different submission appears before publish', async () => {
    const fetchImpl = fetchSequence(
      publishedStatus('0.9.0'),
      { uploadState: 'SUCCEEDED', crxVersion: '1.0.0' },
      publishedStatus('0.9.0', {
        submittedItemRevisionStatus: revision('PENDING_REVIEW', '1.1.0'),
      }),
    );

    await expect(submitChromeExtensionUpdate(submissionOptions({ fetchImpl })))
      .rejects.toThrow(/different active submission/i);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('reasserts policy safety immediately before publish', async () => {
    const fetchImpl = fetchSequence(
      publishedStatus('0.9.0'),
      { uploadState: 'SUCCEEDED', crxVersion: '1.0.0' },
      publishedStatus('0.9.0', { warned: true }),
    );

    await expect(submitChromeExtensionUpdate(submissionOptions({ fetchImpl })))
      .rejects.toThrow(/warned|policy/i);
    expect(fetchImpl).toHaveBeenCalledTimes(3);
  });

  it('verifies that publish exposed the exact submitted or published version', async () => {
    const fetchImpl = fetchSequence(
      publishedStatus('0.9.0'),
      { uploadState: 'SUCCEEDED', crxVersion: '1.0.0' },
      publishedStatus('0.9.0'),
      { state: 'PENDING_REVIEW' },
      publishedStatus('0.9.0'),
    );

    await expect(submitChromeExtensionUpdate(submissionOptions({ fetchImpl })))
      .rejects.toThrow(/did not expose.*1\.0\.0/i);
    expect(fetchImpl).toHaveBeenCalledTimes(5);
  });

  it('stops on a failed upload and times out instead of polling forever', async () => {
    const failedFetch = fetchSequence(
      publishedStatus(),
      { uploadState: 'FAILED' },
    );
    await expect(submitChromeExtensionUpdate(submissionOptions({ fetchImpl: failedFetch })))
      .rejects.toThrow(/upload.*failed/i);
    expect(failedFetch).toHaveBeenCalledTimes(2);

    const timedOutFetch = fetchSequence(
      publishedStatus(),
      { uploadState: 'IN_PROGRESS' },
      publishedStatus('0.9.0', { lastAsyncUploadState: 'IN_PROGRESS' }),
      publishedStatus('0.9.0', { lastAsyncUploadState: 'IN_PROGRESS' }),
    );
    await expect(submitChromeExtensionUpdate(submissionOptions({
      fetchImpl: timedOutFetch,
      pollAttempts: 2,
      sleep: vi.fn(async () => {}),
    }))).rejects.toThrow(/timed out/i);
    expect(timedOutFetch).toHaveBeenCalledTimes(4);
  });

  it('redacts the access token from API errors', async () => {
    const fetchImpl = fetchSequence({
      body: { error: { message: `bad credential ${ACCESS_TOKEN}` } },
      status: 401,
    });

    await expect(submitChromeExtensionUpdate(submissionOptions({ fetchImpl })))
      .rejects.not.toThrow(ACCESS_TOKEN);
  });
});
