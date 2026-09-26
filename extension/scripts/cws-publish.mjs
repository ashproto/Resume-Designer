import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { compareChromeVersions, parseChromeVersion } from './chrome-version.mjs';

const API_ORIGIN = 'https://chromewebstore.googleapis.com';
const ACTIVE_SUBMISSION_STATES = new Set(['PENDING_REVIEW', 'STAGED']);
const FINISHED_SUBMISSION_STATES = new Set(['CANCELLED', 'REJECTED']);
const PUBLISHED_STATES = new Set(['PUBLISHED', 'PUBLISHED_TO_TESTERS']);
const SUCCESSFUL_PUBLISH_STATES = new Set([
  'PENDING_REVIEW',
  'PUBLISHED',
  'PUBLISHED_TO_TESTERS',
  'STAGED',
]);
const PUBLISH_TYPES = new Set(['DEFAULT_PUBLISH', 'STAGED_PUBLISH']);
const ZIP_CENTRAL_SIGNATURE = 0x02014b50;
const ZIP_END_SIGNATURE = 0x06054b50;
const ZIP_LOCAL_SIGNATURE = 0x04034b50;
const ZIP_STORED_METHOD = 0;
const ZIP_UTF8_FLAG = 0x0800;

const CRC32_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return crc >>> 0;
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function validateIdentity({ accessToken, extensionId, fetchImpl, publisherId }) {
  assert(typeof accessToken === 'string' && accessToken.length > 0, 'Chrome Web Store access token is required');
  assert(/^[a-p]{32}$/u.test(extensionId ?? ''), 'Chrome Web Store extension ID is invalid');
  assert(typeof publisherId === 'string' && /^[A-Za-z0-9._-]+$/u.test(publisherId), 'Chrome Web Store publisher ID is invalid');
  assert(typeof fetchImpl === 'function', 'A fetch implementation is required');
}

function itemName(publisherId, extensionId) {
  return `publishers/${encodeURIComponent(publisherId)}/items/${encodeURIComponent(extensionId)}`;
}

function redact(value, accessToken) {
  const text = String(value ?? '').replaceAll(accessToken, '[REDACTED]');
  return text.replace(/\s+/gu, ' ').trim().slice(0, 500);
}

async function requestJson({ accessToken, fetchImpl, label, options, url }) {
  let response;
  try {
    response = await fetchImpl(url, options);
  } catch (error) {
    const safeMessage = redact(error instanceof Error ? error.message : error, accessToken);
    throw new Error(`${label} request failed: ${safeMessage}`, {
      cause: error,
    });
  }

  const responseText = await response.text();
  let body = {};
  if (responseText) {
    try {
      body = JSON.parse(responseText);
    } catch {
      body = {};
    }
  }

  if (!response.ok) {
    const detail = body?.error?.message || responseText || response.statusText || 'Unknown API error';
    throw new Error(`${label} failed (${response.status}): ${redact(detail, accessToken)}`);
  }
  return body;
}

function authorizationHeaders(accessToken, additional = {}) {
  return {
    ...additional,
    Authorization: `Bearer ${accessToken}`,
  };
}

function revisionVersions(revision) {
  return (revision?.distributionChannels ?? [])
    .map((channel) => channel?.crxVersion)
    .filter((version) => typeof version === 'string' && version.length > 0);
}

function checkedRevisionVersions(revision, label) {
  if (!revision) return [];
  const channels = revision.distributionChannels;
  assert(Array.isArray(channels) && channels.length > 0, `${label} has no verifiable Store version`);
  const versions = channels.map((channel) => channel?.crxVersion);
  assert(
    versions.every((version) => typeof version === 'string' && version.length > 0),
    `${label} contains an invalid Store version`,
  );
  for (const version of versions) parseChromeVersion(version);
  return versions;
}

function assertPolicySafe(status) {
  if (status?.takenDown) {
    throw new Error('Chrome Web Store item was taken down for a policy violation; resolve it in the Developer Dashboard');
  }
  if (status?.warned) {
    throw new Error('Chrome Web Store item is warned for a policy violation; resolve it in the Developer Dashboard');
  }
}

function sameChromeVersion(left, right) {
  return compareChromeVersions(left, right) === 0;
}

function inspectStoreVersion(status, version) {
  assertPolicySafe(status);
  parseChromeVersion(version);

  const published = status?.publishedItemRevisionStatus;
  const publishedVersions = checkedRevisionVersions(published, 'Published revision');
  if (published) {
    assert(
      PUBLISHED_STATES.has(published.state),
      `Published revision has unexpected state ${published.state || 'UNKNOWN'}`,
    );
  }
  const submitted = status?.submittedItemRevisionStatus;
  const submittedVersions = checkedRevisionVersions(submitted, 'Submitted revision');

  if (submitted) {
    const state = submitted.state;
    const isTarget = submittedVersions.every((priorVersion) => sameChromeVersion(priorVersion, version));
    if (ACTIVE_SUBMISSION_STATES.has(state)) {
      if (isTarget) {
        for (const publishedVersion of publishedVersions) {
          if (compareChromeVersions(version, publishedVersion) < 0) {
            throw new Error(`Extension version ${version} is older than published Store version ${publishedVersion}`);
          }
        }
        return { reason: 'already-submitted', state };
      }
      throw new Error(
        `Chrome Web Store has a different active submission in state ${state} (${submittedVersions.join(', ')})`,
      );
    }
    if (!FINISHED_SUBMISSION_STATES.has(state)) {
      throw new Error(`Chrome Web Store has a submission in unexpected state ${state || 'UNKNOWN'}`);
    }
    if (submittedVersions.some((priorVersion) => sameChromeVersion(priorVersion, version))) {
      throw new Error(`Extension version ${version} cannot reuse a ${state.toLowerCase()} Store submission`);
    }
  }

  if (publishedVersions.length > 0
    && publishedVersions.every((priorVersion) => sameChromeVersion(priorVersion, version))) {
    assert(
      published && PUBLISHED_STATES.has(published.state),
      `Published revision has unexpected state ${published?.state || 'UNKNOWN'}`,
    );
    return { reason: 'already-published', state: published.state };
  }

  const priorVersions = [
    ...publishedVersions,
    ...submittedVersions,
  ];
  for (const priorVersion of priorVersions) {
    if (compareChromeVersions(version, priorVersion) <= 0) {
      throw new Error(`Extension version ${version} must be greater than prior Store version ${priorVersion}`);
    }
  }
  return null;
}

function normalizedUploadState(value) {
  return String(value ?? '').replace(/^UPLOAD_/u, '');
}

function safeStatusSummary(status) {
  return {
    extensionId: status?.itemId,
    lastAsyncUploadState: status?.lastAsyncUploadState,
    publishedState: status?.publishedItemRevisionStatus?.state,
    publishedVersions: revisionVersions(status?.publishedItemRevisionStatus),
    submittedState: status?.submittedItemRevisionStatus?.state,
    submittedVersions: revisionVersions(status?.submittedItemRevisionStatus),
    takenDown: Boolean(status?.takenDown),
    warned: Boolean(status?.warned),
  };
}

export function readPackagedManifestVersion(packageBytes) {
  const zip = Buffer.from(packageBytes);
  assert(zip.byteLength >= 22, 'Store ZIP is truncated before its end record');
  const endOffset = zip.byteLength - 22;
  assert(zip.readUInt32LE(endOffset) === ZIP_END_SIGNATURE, 'Store ZIP has no final end record');
  assert(
    zip.readUInt16LE(endOffset + 4) === 0 && zip.readUInt16LE(endOffset + 6) === 0,
    'Store ZIP must use a single disk',
  );
  const diskEntries = zip.readUInt16LE(endOffset + 8);
  const totalEntries = zip.readUInt16LE(endOffset + 10);
  const centralBytes = zip.readUInt32LE(endOffset + 12);
  const centralOffset = zip.readUInt32LE(endOffset + 16);
  assert(zip.readUInt16LE(endOffset + 20) === 0, 'Store ZIP comments are not supported');
  assert(totalEntries > 0 && diskEntries === totalEntries, 'Store ZIP entry count is invalid');
  assert(
    centralOffset + centralBytes === endOffset,
    'Store ZIP central directory boundary is invalid',
  );

  const entries = [];
  const paths = new Set();
  let centralCursor = centralOffset;
  for (let index = 0; index < totalEntries; index += 1) {
    assert(centralCursor + 46 <= endOffset, 'Store ZIP central directory is truncated');
    assert(
      zip.readUInt32LE(centralCursor) === ZIP_CENTRAL_SIGNATURE,
      'Store ZIP has an invalid central directory header',
    );
    const versionNeeded = zip.readUInt16LE(centralCursor + 6);
    const flags = zip.readUInt16LE(centralCursor + 8);
    const method = zip.readUInt16LE(centralCursor + 10);
    const modifiedTime = zip.readUInt16LE(centralCursor + 12);
    const modifiedDate = zip.readUInt16LE(centralCursor + 14);
    const checksum = zip.readUInt32LE(centralCursor + 16);
    const compressedBytes = zip.readUInt32LE(centralCursor + 20);
    const uncompressedBytes = zip.readUInt32LE(centralCursor + 24);
    const nameBytes = zip.readUInt16LE(centralCursor + 28);
    const extraBytes = zip.readUInt16LE(centralCursor + 30);
    const commentBytes = zip.readUInt16LE(centralCursor + 32);
    const disk = zip.readUInt16LE(centralCursor + 34);
    const localOffset = zip.readUInt32LE(centralCursor + 42);
    const entryEnd = centralCursor + 46 + nameBytes + extraBytes + commentBytes;
    assert(entryEnd <= endOffset, 'Store ZIP central directory entry is truncated');
    assert(
      flags === ZIP_UTF8_FLAG && method === ZIP_STORED_METHOD,
      'Store ZIP entries must be deterministic UTF-8 stored files',
    );
    assert(
      nameBytes > 0 && extraBytes === 0 && commentBytes === 0 && disk === 0,
      'Store ZIP central directory entry metadata is invalid',
    );
    assert(compressedBytes === uncompressedBytes, 'Store ZIP stored entry size is invalid');
    const pathBuffer = zip.subarray(centralCursor + 46, centralCursor + 46 + nameBytes);
    const path = pathBuffer.toString('utf8');
    assert(Buffer.from(path, 'utf8').equals(pathBuffer), 'Store ZIP path is not valid UTF-8');
    assert(!paths.has(path), `Store ZIP contains duplicate entry ${path}`);
    paths.add(path);
    entries.push({
      checksum,
      compressedBytes,
      flags,
      localOffset,
      method,
      modifiedDate,
      modifiedTime,
      path,
      pathBuffer,
      uncompressedBytes,
      versionNeeded,
    });
    centralCursor = entryEnd;
  }
  assert(centralCursor === endOffset, 'Store ZIP central directory size does not match its entries');

  const localRanges = [];
  let manifestData = null;
  for (const entry of entries) {
    const { localOffset } = entry;
    assert(localOffset + 30 <= centralOffset, 'Store ZIP local file header is truncated');
    assert(zip.readUInt32LE(localOffset) === ZIP_LOCAL_SIGNATURE, 'Store ZIP has an invalid local file header');
    const nameBytes = zip.readUInt16LE(localOffset + 26);
    const extraBytes = zip.readUInt16LE(localOffset + 28);
    const nameStart = localOffset + 30;
    const dataStart = nameStart + nameBytes + extraBytes;
    const dataEnd = dataStart + entry.compressedBytes;
    assert(dataStart <= centralOffset && dataEnd <= centralOffset, 'Store ZIP local entry is truncated');
    const localPath = zip.subarray(nameStart, nameStart + nameBytes);
    assert(
      zip.readUInt16LE(localOffset + 4) === entry.versionNeeded
        && zip.readUInt16LE(localOffset + 6) === entry.flags
        && zip.readUInt16LE(localOffset + 8) === entry.method
        && zip.readUInt16LE(localOffset + 10) === entry.modifiedTime
        && zip.readUInt16LE(localOffset + 12) === entry.modifiedDate
        && zip.readUInt32LE(localOffset + 14) === entry.checksum
        && zip.readUInt32LE(localOffset + 18) === entry.compressedBytes
        && zip.readUInt32LE(localOffset + 22) === entry.uncompressedBytes
        && nameBytes === entry.pathBuffer.byteLength
        && extraBytes === 0
        && localPath.equals(entry.pathBuffer),
      `Store ZIP local and central records disagree for ${entry.path}`,
    );
    const data = zip.subarray(dataStart, dataEnd);
    assert(crc32(data) === entry.checksum, `Store ZIP CRC is invalid for ${entry.path}`);
    localRanges.push({ end: dataEnd, start: localOffset });
    if (entry.path === 'manifest.json') manifestData = data;
  }

  localRanges.sort((left, right) => left.start - right.start);
  let localCursor = 0;
  for (const range of localRanges) {
    assert(range.start === localCursor, 'Store ZIP has overlapping or unindexed local data');
    localCursor = range.end;
  }
  assert(localCursor === centralOffset, 'Store ZIP has unindexed data before its central directory');

  assert(manifestData, 'Store ZIP must contain manifest.json at its root');
  let manifest;
  try {
    manifest = JSON.parse(manifestData.toString('utf8'));
  } catch (error) {
    throw new Error('Store ZIP manifest is not valid JSON', { cause: error });
  }
  parseChromeVersion(manifest?.version);
  return manifest.version;
}

export async function fetchChromeStoreStatus({
  accessToken,
  extensionId,
  fetchImpl = globalThis.fetch,
  publisherId,
}) {
  validateIdentity({ accessToken, extensionId, fetchImpl, publisherId });
  const name = itemName(publisherId, extensionId);
  return requestJson({
    accessToken,
    fetchImpl,
    label: 'Chrome Web Store status',
    options: {
      headers: authorizationHeaders(accessToken),
      method: 'GET',
    },
    url: `${API_ORIGIN}/v2/${name}:fetchStatus`,
  });
}

async function waitForUpload({
  accessToken,
  extensionId,
  fetchImpl,
  pollAttempts,
  pollDelayMs,
  publisherId,
  sleep,
}) {
  for (let attempt = 0; attempt < pollAttempts; attempt += 1) {
    await sleep(pollDelayMs);
    const status = await fetchChromeStoreStatus({
      accessToken,
      extensionId,
      fetchImpl,
      publisherId,
    });
    assertPolicySafe(status);
    const uploadState = normalizedUploadState(status.lastAsyncUploadState);
    if (uploadState === 'SUCCEEDED') return;
    if (uploadState === 'FAILED' || uploadState === 'NOT_FOUND') {
      throw new Error(`Chrome Web Store asynchronous upload ${uploadState.toLowerCase().replace('_', ' ')}`);
    }
    if (uploadState !== 'IN_PROGRESS') {
      throw new Error(`Chrome Web Store returned unexpected asynchronous upload state ${uploadState || 'UNKNOWN'}`);
    }
  }

  throw new Error(`Chrome Web Store upload timed out after ${pollAttempts} status checks`);
}

export async function submitChromeExtensionUpdate({
  accessToken,
  extensionId,
  fetchImpl = globalThis.fetch,
  packageBytes,
  pollAttempts = 12,
  pollDelayMs = 5_000,
  publisherId,
  publishType = 'DEFAULT_PUBLISH',
  sleep = (milliseconds) => new Promise((resolveSleep) => setTimeout(resolveSleep, milliseconds)),
  version,
}) {
  validateIdentity({ accessToken, extensionId, fetchImpl, publisherId });
  parseChromeVersion(version);
  assert(PUBLISH_TYPES.has(publishType), 'Chrome Web Store publish type must be DEFAULT_PUBLISH or STAGED_PUBLISH');
  assert(Number.isInteger(pollAttempts) && pollAttempts > 0 && pollAttempts <= 60, 'Upload poll attempts must be between 1 and 60');
  assert(Number.isInteger(pollDelayMs) && pollDelayMs >= 0 && pollDelayMs <= 60_000, 'Upload poll delay must be between 0 and 60000 milliseconds');
  assert(typeof sleep === 'function', 'An upload polling sleep function is required');
  assert(packageBytes instanceof Uint8Array && packageBytes.byteLength > 0, 'A non-empty validated Store ZIP is required');
  const packagedVersion = readPackagedManifestVersion(packageBytes);
  assert(
    packagedVersion === version,
    `Store ZIP manifest version ${packagedVersion} does not match expected version ${version}`,
  );

  const initialStatus = await fetchChromeStoreStatus({
    accessToken,
    extensionId,
    fetchImpl,
    publisherId,
  });
  const initialMatch = inspectStoreVersion(initialStatus, version);
  if (initialMatch) {
    return {
      extensionId,
      publishType,
      reason: initialMatch.reason,
      skipped: true,
      state: initialMatch.state,
      version,
    };
  }

  const name = itemName(publisherId, extensionId);
  const upload = await requestJson({
    accessToken,
    fetchImpl,
    label: 'Chrome Web Store upload',
    options: {
      body: Buffer.from(packageBytes),
      headers: authorizationHeaders(accessToken, { 'Content-Type': 'application/zip' }),
      method: 'POST',
    },
    url: `${API_ORIGIN}/upload/v2/${name}:upload`,
  });
  const uploadState = normalizedUploadState(upload.uploadState);

  if (uploadState === 'FAILED') throw new Error('Chrome Web Store upload failed');
  if (uploadState === 'IN_PROGRESS') {
    await waitForUpload({
      accessToken,
      extensionId,
      fetchImpl,
      pollAttempts,
      pollDelayMs,
      publisherId,
      sleep,
    });
  } else if (uploadState === 'SUCCEEDED') {
    assert(
      typeof upload.crxVersion === 'string'
        && compareChromeVersions(upload.crxVersion, version) === 0,
      `Chrome Web Store processed unexpected version ${upload.crxVersion || 'UNKNOWN'}`,
    );
  } else {
    throw new Error(`Chrome Web Store returned unexpected upload state ${uploadState || 'UNKNOWN'}`);
  }

  const prePublishStatus = await fetchChromeStoreStatus({
    accessToken,
    extensionId,
    fetchImpl,
    publisherId,
  });
  const prePublishMatch = inspectStoreVersion(prePublishStatus, version);
  if (prePublishMatch) {
    return {
      extensionId,
      publishType,
      reason: prePublishMatch.reason,
      skipped: true,
      state: prePublishMatch.state,
      version,
    };
  }

  // Chrome Web Store v2 offers no ETag or conditional publish operation that
  // atomically binds :publish to this upload. This last status check narrows the
  // draft race window; the post-publish status check below detects a conflicting
  // draft if another publisher replaces it before this request reaches Chrome.
  const published = await requestJson({
    accessToken,
    fetchImpl,
    label: 'Chrome Web Store publish',
    options: {
      body: JSON.stringify({ blockOnWarnings: true, publishType }),
      headers: authorizationHeaders(accessToken, { 'Content-Type': 'application/json' }),
      method: 'POST',
    },
    url: `${API_ORIGIN}/v2/${name}:publish`,
  });
  const warnings = published?.warningInfo?.warnings ?? [];
  assert(warnings.length === 0, 'Chrome Web Store publish returned warnings despite blockOnWarnings');
  assert(
    SUCCESSFUL_PUBLISH_STATES.has(published.state),
    `Chrome Web Store publish returned unexpected state ${published.state || 'UNKNOWN'}`,
  );

  const confirmedStatus = await fetchChromeStoreStatus({
    accessToken,
    extensionId,
    fetchImpl,
    publisherId,
  });
  const confirmedMatch = inspectStoreVersion(confirmedStatus, version);
  assert(
    confirmedMatch,
    `Chrome Web Store did not expose submitted or published version ${version} after publish`,
  );

  return {
    extensionId,
    publishType,
    state: published.state,
    version,
  };
}

function requiredEnvironment(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable ${name}`);
  return value;
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  try {
    const accessToken = requiredEnvironment('CWS_ACCESS_TOKEN');
    const extensionId = requiredEnvironment('CWS_EXTENSION_ID');
    const publisherId = requiredEnvironment('CWS_PUBLISHER_ID');
    const operation = process.env.CWS_OPERATION || 'publish';

    if (operation === 'status') {
      const status = await fetchChromeStoreStatus({ accessToken, extensionId, publisherId });
      process.stdout.write(`${JSON.stringify(safeStatusSummary(status), null, 2)}\n`);
    } else {
      assert(operation === 'publish', 'CWS_OPERATION must be status or publish');
      const packagePath = requiredEnvironment('CWS_PACKAGE');
      const manifestPath = process.env.CWS_MANIFEST || resolve('extension/manifest.json');
      const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
      const result = await submitChromeExtensionUpdate({
        accessToken,
        extensionId,
        packageBytes: await readFile(packagePath),
        publisherId,
        publishType: process.env.CWS_PUBLISH_TYPE || 'DEFAULT_PUBLISH',
        version: manifest.version,
      });
      process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    }
  } catch (error) {
    process.stderr.write(`Chrome Web Store operation failed: ${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
  }
}
