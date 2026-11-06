#!/usr/bin/env node
// Trusted release controller; never run this from a PR checkout with credentials.
// API schemas checked against Apple's documentation on 2026-09-22:
// https://developer.apple.com/documentation/appstoreconnectapi/post-v1-cibuildruns
// https://developer.apple.com/documentation/appstoreconnectapi/cibuildrun/attributes-data.dictionary
// https://developer.apple.com/documentation/appstoreconnectapi/internalbetastate
// The tag is a durable reservation. An existing reservation never authorizes a
// second POST, including after a lost response or runner crash. Cloud must have
// no automatic start conditions, and repository rules must forbid moving or
// deleting ios-testflight/** tags. Workflow concurrency serializes this app.
import { createPrivateKey, sign } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { attachReservationEvidence, coordinatedReleaseOptions } from './ios-cloud-evidence.mjs';

const REPOSITORY = 'ashproto/Resume-Designer';
const BUNDLE_ID = 'com.onpaper.app';
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9-]+$/;
const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const relationId = (resource, name) => resource?.relationships?.[name]?.data?.id;
const requireId = (value, label) => {
  if (typeof value !== 'string' || !ID.test(value)) throw new Error(`Invalid ${label}`);
  return value;
};

export function validateInput(input) {
  if (input.repository !== REPOSITORY) throw new Error(`Only ${REPOSITORY} may dispatch this release`);
  const kind = input.kind ?? 'release';
  if (!['release', 'preview'].includes(kind)) throw new Error('Unknown iOS delivery kind');
  if (kind === 'release' && !['main', 'next'].includes(input.branch)) throw new Error('Release branch must be main or next');
  if (kind === 'preview' && ![input.prNumber, input.commentId].every(value => Number.isSafeInteger(value) && value > 0)) {
    throw new Error('Preview requires positive PR and comment identities');
  }
  if (!SHA.test(input.sha || '')) throw new Error('A full lowercase 40-character commit SHA is required');
  for (const key of ['workflowId', 'appId', 'groupId']) requireId(input[key], key);
  if (input.resumeRunId) requireId(input.resumeRunId, 'resume run id');
  const audience = kind === 'preview' ? 'INTERNAL_ONLY' : 'APP_STORE_ELIGIBLE';
  if (input.audience !== undefined && input.audience !== audience) throw new Error('Archive audience cannot override the delivery policy');
  const tag = kind === 'preview' ? `ios-testflight/pr/${input.prNumber}/${input.commentId}/${input.sha}` : `ios-testflight/${input.branch}/${input.sha}`;
  return { ...input, kind, audience, tag };
}

export function createAscJwt({ issuerId, keyId, privateKey }, now = Math.floor(Date.now() / 1000)) {
  if (!issuerId || !keyId || !privateKey) throw new Error('ASC issuer, key id and private key are required');
  const key = createPrivateKey(privateKey.replaceAll('\\n', '\n'));
  if (key.asymmetricKeyType !== 'ec' || key.asymmetricKeyDetails?.namedCurve !== 'prime256v1') {
    throw new Error('ASC key must be an EC P-256 private key');
  }
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64url');
  const payload = `${encode({ alg: 'ES256', kid: keyId, typ: 'JWT' })}.${encode({ iss: issuerId, iat: now, exp: now + 600, aud: 'appstoreconnect-v1' })}`;
  return `${payload}.${sign('sha256', Buffer.from(payload), { key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}`;
}

export function safeApiUrl(origin, path) {
  if (!['https://api.github.com', 'https://api.appstoreconnect.apple.com'].includes(origin)) throw new Error('Untrusted API origin');
  const url = new URL(path, origin);
  if (url.origin !== origin || url.username || url.password || url.hash) throw new Error('Unsafe API URL');
  return url.href;
}

export function createApi({ origin, token, fetchImpl = fetch, sleep = pause }) {
  // Every authorization read still reaches GitHub. Only its authenticated 304
  // may reuse JSON, isolated by exact URL/token and bounded for this process.
  const conditional = origin === 'https://api.github.com';
  const cache = new Map();
  let cacheToken, cacheBytes = 0, epoch = 0;
  const clearCache = () => { cache.clear(); cacheBytes = 0; epoch++; };
  const discard = url => {
    cacheBytes -= cache.get(url)?.size || 0;
    cache.delete(url);
  };
  const validEtag = value => typeof value === 'string' && value.length <= 1024 && /^(?:W\/)?"[\x21\x23-\x7e]*"$/.test(value);
  // If-None-Match compares valid opaque tags regardless of the W/ marker.
  const sameEtag = (left, right) => validEtag(left) && validEtag(right)
    && left.replace(/^W\//, '') === right.replace(/^W\//, '');
  async function request(path, { method = 'GET', body } = {}) {
    const url = safeApiUrl(origin, path);
    const attempts = method === 'GET' ? 3 : 1;
    for (let attempt = 0; attempt < attempts; attempt++) {
      try {
        const credential = token();
        if (conditional && credential !== cacheToken) { clearCache(); cacheToken = credential; }
        if (conditional && method !== 'GET') clearCache();
        const version = epoch;
        const cached = conditional && method === 'GET' && typeof credential === 'string' && credential
          ? cache.get(url) : undefined;
        const response = await fetchImpl(url, {
          method, redirect: 'error', signal: AbortSignal.timeout(30_000),
          headers: { Authorization: `Bearer ${credential}`, Accept: 'application/json', 'Content-Type': 'application/json', ...(conditional ? { 'X-GitHub-Api-Version': '2022-11-28' } : {}),
            ...(cached ? { 'If-None-Match': cached.etag } : {}) },
          ...(body === undefined ? {} : { body: JSON.stringify(body) }),
        });
        const etag = response.headers?.get('etag');
        if (response.status === 304 && cached && version === epoch && credential === cacheToken
          && cache.get(url) === cached && (etag == null || sameEtag(etag, cached.etag))) {
          return JSON.parse(cached.text);
        }
        if (!response.ok) {
          // Do not print response bodies: upstream error text can echo inputs.
          const limit = name => {
            const value = response.headers?.get(name);
            return typeof value === 'string' && /^\d{1,15}$/.test(value) ? Number(value) : undefined;
          };
          throw Object.assign(new Error(`${method} ${new URL(url).pathname} failed (${response.status})`), {
            status: response.status,
            ...(conditional ? { rateLimitRemaining: limit('x-ratelimit-remaining'),
              rateLimitReset: limit('x-ratelimit-reset'), retryAfter: limit('retry-after') } : {}),
          });
        }
        const text = await response.text();
        const value = text ? JSON.parse(text) : {};
        if (conditional && method === 'GET' && version === epoch && credential === cacheToken) {
          discard(url);
          const size = Buffer.byteLength(text);
          if (credential && response.status === 200 && validEtag(etag) && url.length <= 8192 && size <= 1024 * 1024) {
            // Store serialized JSON so callers can never mutate cached facts.
            while (cache.size >= 128 || cacheBytes + size > 4 * 1024 * 1024) discard(cache.keys().next().value);
            cache.set(url, { etag, text: text || '{}', size });
            cacheBytes += size;
          }
        }
        return value;
      } catch (error) {
        const transient = error.status === undefined || error.status === 429 || error.status >= 500;
        if (!transient || attempt + 1 === attempts) throw error;
        await sleep(1000 * 2 ** attempt);
      }
    }
  }
  async function collection(path) {
    const items = [], seen = new Set();
    let next = path;
    while (next) {
      const url = safeApiUrl(origin, next);
      if (seen.has(url) || seen.size >= 100) throw new Error('Unsafe or excessive API pagination');
      seen.add(url);
      const page = await request(url);
      if (!Array.isArray(page.data)) throw new Error('Expected an API collection');
      items.push(...page.data);
      next = page.links?.next;
    }
    return items;
  }
  return { request, collection };
}

async function protectedBranchHead(gh, input) {
  const branch = await gh.request(`/repos/${input.repository}/branches/${input.branch}`);
  if (branch.protected !== true || !SHA.test(branch.commit?.sha || '')) throw new Error('Release branch must be protected');
  return branch.commit.sha;
}

export async function ensureTrustedCommit(gh, input) {
  const head = await protectedBranchHead(gh, input);
  // Compare two SHAs, never bare "next" (there is also a next tag).
  const comparison = await gh.request(`/repos/${input.repository}/compare/${input.sha}...${head}`);
  if (!['ahead', 'identical'].includes(comparison.status) || comparison.merge_base_commit?.sha !== input.sha) {
    throw new Error('Release commit is not reachable from the protected branch');
  }
  return head;
}

function assertTag(value, { tag, sha }) {
  if (value.ref !== `refs/tags/${tag}` || value.object?.type !== 'commit' || value.object.sha !== sha) {
    throw new Error('Existing release tag does not match the exact expected commit; it will not be changed');
  }
}

export async function ensureReleaseTag(gh, input, { allowCreate = true } = {}) {
  const path = `/repos/${input.repository}/git/ref/tags/${input.tag}`;
  try {
    const value = await gh.request(path);
    assertTag(value, input);
    return { created: false };
  } catch (error) {
    if (error.status !== 404) throw error;
  }
  if (!allowCreate) return null;
  let value;
  try {
    value = await gh.request(`/repos/${input.repository}/git/refs`, { method: 'POST', body: { ref: `refs/tags/${input.tag}`, sha: input.sha } });
  } catch {
    // The POST might have succeeded, or another dispatcher may own it. A GET
    // can recover identity, but only a clear successful creation owns a start.
    const recovered = await gh.request(path);
    assertTag(recovered, input);
    return { created: false };
  }
  assertTag(value, input);
  return { created: true };
}

export function selectTag(refs, tag) {
  const matches = refs.filter(ref => ref.attributes?.kind === 'TAG' && ref.attributes.name === tag
    && ref.attributes.canonicalName === `refs/tags/${tag}` && ref.attributes.isDeleted === false);
  if (matches.length > 1) throw new Error('Apple returned multiple references for the exact release tag');
  return matches[0];
}

export function validateWorkflow(workflow, repository, app, input) {
  const attrs = workflow?.attributes;
  if (workflow?.id !== input.workflowId || attrs?.isEnabled !== true) throw new Error('Configured Cloud workflow is unavailable or disabled');
  for (const key of ['tagStartCondition', 'branchStartCondition', 'pullRequestStartCondition', 'scheduledStartCondition']) {
    if (attrs[key] != null) throw new Error(`Cloud workflow must have no automatic ${key}`);
  }
  if (!attrs.manualTagStartCondition) throw new Error('Cloud workflow must support manual tag builds');
  const archives = attrs.actions?.filter(action => action.actionType === 'ARCHIVE') || [];
  const audience = input.kind === 'preview' ? 'INTERNAL_ONLY' : 'APP_STORE_ELIGIBLE';
  if (archives.length !== 1 || archives[0].platform !== 'IOS' || archives[0].buildDistributionAudience !== audience) {
    throw new Error(`Expected one ${audience} iOS archive action; configure its internal TestFlight post-action in App Store Connect`);
  }
  const repo = repository?.attributes;
  const expectedUrl = `https://github.com/${input.repository}`;
  if (relationId(workflow, 'repository') !== repository?.id || `${repo?.ownerName}/${repo?.repositoryName}` !== input.repository
    || ![expectedUrl, `${expectedUrl}.git`].includes(repo?.httpCloneUrl)) {
    throw new Error('Cloud repository owner, name or clone URL does not match the trusted GitHub repository');
  }
  if (app?.id !== input.appId || app.attributes?.bundleId !== BUNDLE_ID) throw new Error('Cloud product does not belong to the configured On Paper iOS app');
}

export function cloudState(run, input, referenceId) {
  if (relationId(run, 'workflow') !== input.workflowId || relationId(run, 'sourceBranchOrTag') !== referenceId) {
    throw new Error('Build run workflow or tag does not match the authorized release');
  }
  const attrs = run.attributes || {};
  const builtSha = attrs.sourceCommit?.commitSha;
  if (builtSha && builtSha !== input.sha) throw new Error('Cloud build source commit differs from the authorized commit');
  if (attrs.isPullRequestBuild === true) throw new Error('A pull request build cannot satisfy a release');
  if (!['PENDING', 'RUNNING', 'COMPLETE'].includes(attrs.executionProgress)) throw new Error(`Unknown Cloud execution progress: ${attrs.executionProgress}`);
  if (attrs.executionProgress !== 'COMPLETE') return 'pending';
  if (attrs.completionStatus !== 'SUCCEEDED') throw new Error(`Cloud build ended with ${attrs.completionStatus || 'unknown completion status'}`);
  if (!builtSha) throw new Error('Completed Cloud build has no verifiable source commit');
  return 'succeeded';
}

export function betaState(build, detail) {
  const attrs = build.attributes || {};
  if (attrs.expired === true) throw new Error('TestFlight build EXPIRED');
  if (['FAILED', 'INVALID'].includes(attrs.processingState)) throw new Error(`App Store Connect processing ${attrs.processingState}`);
  if (!['PROCESSING', 'VALID'].includes(attrs.processingState)) throw new Error(`Unknown processing state: ${attrs.processingState}`);
  if (attrs.processingState === 'PROCESSING') return 'pending';
  const state = detail.internalBuildState;
  if (['PROCESSING_EXCEPTION', 'MISSING_EXPORT_COMPLIANCE', 'EXPIRED'].includes(state)) throw new Error(`Internal TestFlight requires attention: ${state}`);
  if (['PROCESSING', 'IN_EXPORT_COMPLIANCE_REVIEW'].includes(state)) return 'pending';
  if (state === 'READY_FOR_BETA_TESTING') return 'ready';
  if (state === 'IN_BETA_TESTING') return 'available';
  throw new Error(`Unknown internal beta state: ${state}`);
}

export async function release(supplied, { gh, asc, output = () => {}, log = console.log, sleep = pause, pollAttempts = 180, discoveryAttempts = 120, pollMs = 30_000,
  authorizeSource, beforeStart, recordState = async () => {}, now = () => performance.now(),
}) {
  const input = validateInput(supplied);
  const { workflowId, tag, sha, appId, groupId, audience } = input;
  let ownsReservation = false, mayHavePosted = false, cloudObserved = false;
  if (input.kind === 'preview' && (typeof authorizeSource !== 'function' || typeof beforeStart !== 'function')) {
    throw new Error('Preview requires trusted live source and app-ordering checks');
  }
  const sourceCurrent = async purpose => {
    if (input.kind === 'preview') {
      const result = await authorizeSource(purpose);
      if (typeof result !== 'boolean') throw new Error('Preview source authorization must return a boolean');
      return result;
    }
    return (purpose === 'monitor' ? await ensureTrustedCommit(gh, input) : await protectedBranchHead(gh, input)) === sha;
  };
  const superseded = async (ownsUnusedReservation = false) => {
    if (ownsUnusedReservation) await recordState('not-started');
    output({ release_state: 'superseded' });
    log(`Skipping new Cloud build for ${sha}: its source is no longer eligible. Any existing release tag is retained.`);
    return { state: 'superseded' };
  };
  async function poll(check, attempts, timeoutMessage) {
    for (let index = 0; index < attempts; index++) {
      const result = await check();
      if (result) return result;
      if (index + 1 < attempts) await sleep(pollMs);
    }
    throw new Error(timeoutMessage);
  }
  try {
    const wf = await asc.request(`/v1/ciWorkflows/${workflowId}?include=repository,product`);
    const repoId = requireId(relationId(wf.data, 'repository'), 'workflow repository id');
    const productId = requireId(relationId(wf.data, 'product'), 'workflow product id');
    const repository = wf.included?.find(item => item.type === 'scmRepositories' && item.id === repoId);
    const app = (await asc.request(`/v1/ciProducts/${productId}/app`)).data;
    validateWorkflow(wf.data, repository, app, input);
    const group = (await asc.request(`/v1/betaGroups/${groupId}?include=app`)).data;
    if (group?.id !== groupId || group.attributes?.isInternalGroup !== true || relationId(group, 'app') !== appId) {
      throw new Error('Configured TestFlight group must be an internal group belonging to this app');
    }
    const current = await sourceCurrent('monitor');
    // Older reachable commits may still have a run to monitor, but cannot make
    // a fresh reservation or start a higher-numbered build after newer code.
    // Explicit recovery must never consume a new reservation before the supplied
    // run can be checked. A wrong run ID otherwise strands the current head.
    const reservation = await ensureReleaseTag(gh, input, { allowCreate: current && !input.resumeRunId && !input.recoveryOnly });
    if (!reservation) {
      if (input.resumeRunId || input.recoveryOnly) throw new Error('Resuming a Cloud run requires an existing release tag; no new reservation was created.');
      return superseded();
    }
    ownsReservation = reservation.created;
    if (reservation.created) await recordState('reserved');
    output({ release_tag: tag });
    // Apple can take longer than ten minutes to index a newly pushed tag. Keep
    // this creator's sole start authorization alive while it becomes visible.
    output({ release_state: 'discovering_tag' });
    // Bound elapsed time, including authorization and API latency. In-flight
    // requests keep their own timeouts; no detached dispatch work is raced.
    const discoveryDeadline = now() + 15 * 60_000;
    const assertDiscoveryTime = () => {
      if (now() >= discoveryDeadline) throw new Error('Cloud has not discovered the release tag before the discovery deadline. Reservation retained; reconcile before starting a build manually.');
    };
    let reference;
    for (let index = 0; index < discoveryAttempts; index++) {
      assertDiscoveryTime();
      // Do not hold a newer release in the queue while an obsolete tag indexes.
      // Existing runs can still be monitored after their branch advances.
      if (reservation.created && index > 0) {
        const eligible = await sourceCurrent('discover');
        assertDiscoveryTime();
        if (!eligible) return superseded(true);
      }
      const references = await asc.collection(`/v1/scmRepositories/${repoId}/gitReferences?limit=200`);
      assertDiscoveryTime();
      reference = selectTag(references, tag);
      if (reference) break;
      const canonical = references.filter(item => item.attributes?.canonicalName === `refs/tags/${tag}`);
      // Counts only: do not dump upstream payloads or unrelated reference names.
      log(`Cloud tag discovery ${index + 1}/${discoveryAttempts}: scanned=${references.length}, name=${references.filter(item => item.attributes?.name === tag).length}, canonical=${canonical.length}, TAG=${canonical.filter(item => item.attributes?.kind === 'TAG').length}, undeleted=${canonical.filter(item => item.attributes?.isDeleted === false).length}.`);
      if (index + 1 < discoveryAttempts) await sleep(Math.min(pollMs, Math.max(0, discoveryDeadline - now())));
    }
    if (!reference) throw new Error('Cloud has not discovered the release tag. Reservation retained; reconcile before starting a build manually.');
    requireId(reference.id, 'Apple tag id');
    const listRuns = () => asc.collection(`/v1/ciWorkflows/${workflowId}/buildRuns?include=sourceBranchOrTag,workflow&limit=200&sort=-number`);
    const findRun = async () => {
      const matches = (await listRuns()).filter(item => relationId(item, 'sourceBranchOrTag') === reference.id);
      if (matches.length) cloudObserved = true;
      if (matches.length > 1) throw new Error('Multiple Cloud runs use this release tag; reconcile duplicates manually');
      return matches[0];
    };
    let run = input.resumeRunId
      ? (await asc.request(`/v1/ciBuildRuns/${input.resumeRunId}?include=workflow,sourceBranchOrTag`)).data
      : await findRun();
    if (!run && !reservation.created) {
      run = await poll(findRun, discoveryAttempts,
        'Existing release reservation has no visible Cloud run. Do not retry the POST; reconcile this tag in App Store Connect first.');
    }
    if (!run) {
      if (input.recoveryOnly) throw new Error('Recovery cannot start a new Cloud build; reconcile the existing reservation.');
      if (beforeStart) await beforeStart(input);
      // Recheck the immutable GitHub ref immediately before the non-idempotent POST.
      assertTag(await gh.request(`/repos/${input.repository}/git/ref/tags/${tag}`), input);
      // Persist that a request may be sent before the final authorization read.
      // A crash afterward must remain ambiguous, never authorize a second POST.
      await recordState('post-attempted');
      // Discovery and queueing can outlive another push. Keep this protected-head
      // read as the final awaited check before any new POST; existing runs above
      // remain monitorable after their branch advances.
      if (!await sourceCurrent('start')) return superseded(reservation.created);
      mayHavePosted = true;
      try {
        run = (await asc.request('/v1/ciBuildRuns', { method: 'POST', body: { data: { type: 'ciBuildRuns', relationships: {
          workflow: relation(workflowId, 'ciWorkflows'), sourceBranchOrTag: relation(reference.id, 'scmGitReferences'),
        } } } })).data;
        requireId(run?.id, 'created build run id');
      } catch (error) {
        if (error.status >= 400 && error.status < 500 && ![408, 429].includes(error.status)) {
          await recordState('rejected');
          throw new Error(`Cloud refused the build (${error.status}); reservation retained for manual reconciliation.`);
        }
        log('Cloud start response was ambiguous; checking for an accepted run without posting again.');
        run = await poll(findRun, discoveryAttempts,
          'Cloud start may have been accepted. Reservation retained; check App Store Connect and reconcile before any new start.');
      }
    }
    requireId(run?.id, 'build run id');
    const runId = run.id;
    // Emit immediately, before identity/completion polling can fail.
    output({ build_run_id: runId, cloud_build_number: run.attributes?.number ?? '', release_state: 'submitted' });
    if ((relationId(run, 'workflow') && relationId(run, 'workflow') !== workflowId)
      || (relationId(run, 'sourceBranchOrTag') && relationId(run, 'sourceBranchOrTag') !== reference.id)) {
      throw new Error('Initial build run workflow or tag does not match the authorized release');
    }
    if (run.attributes?.sourceCommit?.commitSha && run.attributes.sourceCommit.commitSha !== sha) {
      throw new Error('Initial Cloud build source commit differs from the authorized commit');
    }
    log(`Cloud build ${runId} submitted or resumed for ${sha}. Waiting for completion.`);
    const completed = await poll(async () => {
      const current = (await asc.request(`/v1/ciBuildRuns/${runId}?include=workflow,sourceBranchOrTag`)).data;
      if (current?.id !== runId) throw new Error('Cloud returned a different build run id');
      return cloudState(current, input, reference.id) === 'succeeded' && current;
    }, pollAttempts, `Cloud build ${runId} is still incomplete; resume its run id, do not start another build.`);
    output({ release_state: 'cloud_succeeded', cloud_build_number: completed.attributes.number ?? '' });
    if (input.kind === 'preview') await sourceCurrent('monitor');
    const delivered = await poll(async () => {
      const builds = await asc.collection(`/v1/ciBuildRuns/${runId}/builds?filter[app]=${appId}&filter[preReleaseVersion.platform]=IOS&limit=200`);
      if (builds.length === 0) return false;
      if (builds.length !== 1) throw new Error('Cloud run has multiple iOS builds for this app; cannot identify the release');
      const build = builds[0];
      const buildId = requireId(build.id, 'App Store Connect build id');
      output({ asc_build_id: buildId });
      const owner = (await asc.request(`/v1/builds/${buildId}/app`)).data;
      if (owner?.id !== appId) throw new Error('Uploaded build belongs to a different app');
      if (build.attributes?.buildAudienceType !== audience) throw new Error('Uploaded build audience differs from the configured archive');
      if (build.attributes?.processingState !== 'VALID') {
        betaState(build, {});
        return false;
      }
      const detail = (await asc.request(`/v1/builds/${buildId}/buildBetaDetail`)).data?.attributes || {};
      if (betaState(build, detail) !== 'available') return false;
      // Apple offers GET group/builds, not GET build/betaGroups. Follow all pages
      // so a newer build cannot hide an older resumed release from this check.
      const groupBuilds = await asc.collection(`/v1/betaGroups/${groupId}/builds?limit=200&fields[builds]=version`);
      if (!groupBuilds.some(item => item.id === buildId)) return false;
      if (!Number.isInteger(completed.attributes.number) || String(completed.attributes.number) !== build.attributes.version) {
        throw new Error('Uploaded CFBundleVersion does not match the Xcode Cloud build number');
      }
      return build;
    }, pollAttempts, `Cloud succeeded, but internal TestFlight availability for build run ${runId} is unconfirmed. Check processing, export compliance and the workflow's internal tester group.`);
    await recordState('delivered');
    output({ release_state: 'testflight_available', asc_build_id: delivered.id, build_number: delivered.attributes.version });
    log(`Build ${delivered.id} is available to the configured internal TestFlight group. App Store submission remains manual.`);
    return { state: 'testflight_available', runId, buildId: delivered.id, tag };
  } catch (error) {
    if (error.code === 'CLOUD_RUN_ALREADY_EXISTS' && error.tag === tag) cloudObserved = true;
    // The creator can prove no POST was attempted in this process. Never make
    // this claim about an existing reservation, observed run, or possibly accepted POST.
    if (ownsReservation && !mayHavePosted && !cloudObserved) await recordState('not-started');
    throw error;
  }
}

function relation(id, type) { return { data: { type, id } }; }

export function parseArgs(argv) {
  const result = {};
  const keys = { '--branch': 'branch', '--sha': 'sha', '--resume-run-id': 'resumeRunId' };
  for (let index = 0; index < argv.length; index += 2) {
    const key = keys[argv[index]], value = argv[index + 1];
    if (!key || !value || result[key] !== undefined) throw new Error('Usage: ios-cloud-release.mjs --branch main|next --sha FULL_SHA [--resume-run-id ID]');
    result[key] = value;
  }
  return result;
}

async function main() {
  const env = name => {
    if (!process.env[name]) throw new Error(`${name} is required`);
    return process.env[name];
  };
  const input = validateInput({ ...parseArgs(process.argv.slice(2)), repository: env('GITHUB_REPOSITORY'), workflowId: env('XCODE_CLOUD_WORKFLOW_ID'), appId: env('APP_STORE_CONNECT_APP_ID'), groupId: env('APP_STORE_CONNECT_INTERNAL_GROUP_ID') });
  const credentials = { issuerId: env('APP_STORE_CONNECT_ISSUER_ID'), keyId: env('APP_STORE_CONNECT_KEY_ID'), privateKey: env('APP_STORE_CONNECT_PRIVATE_KEY') };
  const githubToken = env('GITHUB_TOKEN');
  const gh = attachReservationEvidence(createApi({ origin: 'https://api.github.com', token: () => githubToken }), { token: githubToken });
  // A new short-lived JWT per request avoids expiring during long Cloud builds.
  const asc = createApi({ origin: 'https://api.appstoreconnect.apple.com', token: () => createAscJwt(credentials) });
  await release(input, { gh, asc, ...coordinatedReleaseOptions({ env: process.env, gh, asc, input }), output: values => {
    for (const [key, value] of Object.entries(values)) {
      if (/[\r\n]/.test(String(value))) throw new Error('Unsafe workflow output');
      if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${key}=${value}\n`);
      console.log(`${key}=${value}`);
    }
  } });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
