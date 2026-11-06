// App-wide ordering for trusted iOS Cloud controllers. Adapters perform I/O;
// this module never starts Cloud work or clears immutable reservation refs.
import { createHash } from 'node:crypto';

const REPOSITORY = 'ashproto/Resume-Designer';
const REPOSITORY_ID = 1163653093;
const SHA = /^[a-f0-9]{40}$/;
const ID = /^[A-Za-z0-9-]+$/;
const STATES = new Set(['reserved', 'post-attempted', 'not-started', 'rejected', 'delivered']);
const CONTROLLERS = new Map([
  ['.github/workflows/ios-testflight.yml', new Set(['workflow_run', 'workflow_dispatch'])],
  ['.github/workflows/ios-testflight-pr.yml', new Set(['issue_comment', 'workflow_dispatch'])],
]);
const relationId = (value, name) => value?.relationships?.[name]?.data?.id;

function requireRepository(repository) {
  if (repository !== REPOSITORY) throw new Error('Untrusted reservation repository');
}
function requireId(id, label) {
  if (typeof id !== 'string' || !ID.test(id)) throw new Error(`Invalid ${label}`);
  return id;
}
function reservationSha(tag) {
  const match = typeof tag === 'string' && tag.match(/^ios-testflight\/(?:(?:main|next)\/|pr\/[1-9]\d*\/[1-9]\d*\/)([a-f0-9]{40})$/);
  if (!match) throw new Error('Invalid managed reservation tag');
  return match[1];
}
function assertReservation(ref, tag, sha) {
  if (ref?.ref !== `refs/tags/${tag}` || ref.object?.type !== 'commit' || ref.object.sha !== sha) {
    throw new Error('Reservation tag does not identify the exact immutable source commit');
  }
}
export function reservationStatusContext(tag) {
  reservationSha(tag);
  return `ios-cloud-reservation/${createHash('sha256').update(tag).digest('hex')}`;
}
export function parseControllerRunUrl(repository, runUrl) {
  requireRepository(repository);
  const prefix = `https://github.com/${repository}/actions/runs/`;
  if (typeof runUrl !== 'string' || !runUrl.startsWith(prefix) || !/^[1-9]\d*$/.test(runUrl.slice(prefix.length))) {
    throw new Error('Journal requires an exact trusted Actions run URL');
  }
  return runUrl.slice(prefix.length);
}

async function trustedControllerRun(gh, repository, runUrl, { completed = false } = {}) {
  const runId = parseControllerRunUrl(repository, runUrl);
  const run = await gh.request(`/repos/${repository}/actions/runs/${runId}`);
  const sameRepository = value => value?.id === REPOSITORY_ID && value?.full_name === repository;
  if (String(run?.id) !== runId || run.html_url !== runUrl || run.head_branch !== 'main'
    || !SHA.test(run.head_sha || '') || !sameRepository(run.repository) || !sameRepository(run.head_repository)
    || !CONTROLLERS.get(run.path)?.has(run.event) || !Number.isSafeInteger(run.workflow_id)
    || (completed && run.status !== 'completed')) {
    throw new Error('Journal Actions run has untrusted repository, source, event or controller provenance');
  }
  const workflow = await gh.request(`/repos/${repository}/actions/workflows/${run.workflow_id}`);
  if (workflow?.id !== run.workflow_id || workflow.path !== run.path) throw new Error('Journal workflow identity is untrusted');
  return { runId, run };
}

// GitHub status arrays use numbered pages. ASC adapters expose collection(), which
// follows and validates every links.next URL using their same-origin policy.
async function githubCollection(gh, path) {
  const items = [];
  for (let page = 1; page <= 100; page++) {
    const values = await gh.request(`${path}?per_page=100&page=${page}`);
    if (!Array.isArray(values)) throw new Error('Expected a complete GitHub collection');
    items.push(...values);
    if (values.length < 100) return items;
  }
  throw new Error('Excessive GitHub pagination; ordering remains unresolved');
}
async function appleCollection(asc, path) {
  const values = await asc.collection(path);
  if (!Array.isArray(values)) throw new Error('Expected a complete Apple collection');
  return values;
}

export async function recordReservationState({ gh, repository, sha, tag, state, runUrl }) {
  requireRepository(repository);
  if (reservationSha(tag) !== sha || !STATES.has(state)) throw new Error('Invalid reservation source or journal state');
  await trustedControllerRun(gh, repository, runUrl);
  assertReservation(await gh.request(`/repos/${repository}/git/ref/tags/${tag}`), tag, sha);
  await gh.request(`/repos/${repository}/statuses/${sha}`, { method: 'POST', body: {
    context: reservationStatusContext(tag), description: `ios-cloud:${state}`,
    state: ['reserved', 'post-attempted'].includes(state) ? 'pending' : 'success', target_url: runUrl,
  } });
  // The caller prints this only from its fixed trusted controller job. Commit
  // status URLs are discovery pointers; authenticated run logs prove origin.
  return { version: 1, repository, tag, sha, state };
}

async function unusedReservationEvidence(gh, repository, tag, sha) {
  const statuses = await githubCollection(gh, `/repos/${repository}/commits/${sha}/statuses`);
  // GitHub returns newest first. Never fall back to an older closed outcome
  // after a newer pending/unknown record for the same reservation context.
  const status = statuses.find(value => value?.context === reservationStatusContext(tag));
  // The one reviewed pre-journal receipt is checked only when this reservation
  // has no structured journal at all. Never override a newer or invalid record.
  if (!status) return typeof gh.verifyLegacyReservationEvidence === 'function'
    && await gh.verifyLegacyReservationEvidence({ repository, tag, sha }) === true;
  const state = status.description?.match(/^ios-cloud:(not-started|rejected)$/)?.[1];
  if (!['not-started', 'rejected'].includes(state)) return false;
  if (status.creator?.id !== 41898282 || status.creator.login !== 'github-actions[bot]'
    || status.creator.type !== 'Bot' || status.state !== 'success') throw new Error('Untrusted reservation journal creator or state');
  const { runId, run } = await trustedControllerRun(gh, repository, status.target_url, { completed: true });
  const created = Date.parse(status.created_at), start = Date.parse(run.created_at), end = Date.parse(run.updated_at);
  if (![created, start, end].every(Number.isFinite) || created < start || created > end) {
    throw new Error('Journal timestamp is outside the trusted controller run');
  }
  if (typeof gh.verifyReservationEvidence !== 'function'
    || await gh.verifyReservationEvidence({ repository, tag, sha, state, runId, runUrl: status.target_url }) !== true) {
    throw new Error('Unresolved reservation lacks authenticated controller log evidence');
  }
  return true;
}

async function cloudInventory(asc, repository, appId, workflowIds) {
  let productId, repositoryId;
  const runs = [];
  for (const workflowId of workflowIds) {
    requireId(workflowId, 'Cloud workflow id');
    const workflow = (await asc.request(`/v1/ciWorkflows/${workflowId}?include=repository,product`))?.data;
    const product = requireId(relationId(workflow, 'product'), 'Cloud product id');
    const repo = requireId(relationId(workflow, 'repository'), 'Cloud repository id');
    if (workflow?.id !== workflowId || (productId && productId !== product) || (repositoryId && repositoryId !== repo)) {
      throw new Error('Managed Cloud workflows must share the configured app product and repository');
    }
    productId = product; repositoryId = repo;
    const app = (await asc.request(`/v1/ciProducts/${product}/app`))?.data;
    if (app?.id !== appId || app.attributes?.bundleId !== 'com.onpaper.app') throw new Error('Managed Cloud workflow belongs to a different app');
    const values = await appleCollection(asc, `/v1/ciWorkflows/${workflowId}/buildRuns?include=sourceBranchOrTag,workflow&limit=200&sort=-number`);
    for (const value of values) {
      if (relationId(value, 'workflow') !== workflowId) throw new Error('Cloud run belongs to the wrong workflow');
      runs.push(value);
    }
  }
  const cloudRepo = (await asc.request(`/v1/scmRepositories/${repositoryId}`))?.data;
  if (cloudRepo?.id !== repositoryId || `${cloudRepo.attributes?.ownerName}/${cloudRepo.attributes?.repositoryName}` !== repository
    || ![`https://github.com/${repository}`, `https://github.com/${repository}.git`].includes(cloudRepo.attributes?.httpCloneUrl)) {
    throw new Error('Managed Cloud repository differs from the trusted source');
  }
  const refs = await appleCollection(asc, `/v1/scmRepositories/${repositoryId}/gitReferences?limit=200`);
  return { runs, refs };
}

async function verifyUpload(asc, build, appId, run) {
  const id = requireId(build?.id, 'upload id');
  const app = (await asc.request(`/v1/builds/${id}/app`))?.data;
  if (app?.id !== appId) throw new Error('Cloud uploaded build belongs to a different app');
  if (run && (!Number.isInteger(run.attributes?.number) || String(run.attributes.number) !== build.attributes?.version)) {
    throw new Error('Cloud upload number differs from the source run');
  }
  const attrs = build.attributes || {};
  if (attrs.processingState === 'PROCESSING') throw new Error('An unfinished upload is still processing');
  if (['FAILED', 'INVALID'].includes(attrs.processingState)) return;
  if (attrs.processingState !== 'VALID') throw new Error('Upload processing state is unresolved');
  if (attrs.expired === true) return;
  const detail = (await asc.request(`/v1/builds/${id}/buildBetaDetail`))?.data?.attributes;
  if (!['IN_BETA_TESTING', 'READY_FOR_BETA_TESTING', 'EXPIRED', 'PROCESSING_EXCEPTION'].includes(detail?.internalBuildState)) {
    throw new Error('An unfinished upload has unresolved internal processing');
  }
}

export async function assertCloudOrdering({ gh, asc, repository, appId, workflowIds, currentTag, forStart = false }) {
  requireRepository(repository); requireId(appId, 'app id');
  if (!Array.isArray(workflowIds) || workflowIds.length !== 2 || new Set(workflowIds).size !== 2) {
    throw new Error('Both distinct managed Cloud workflow IDs are required for app-wide ordering');
  }
  if (currentTag !== undefined) reservationSha(currentTag);
  const reservations = new Map();
  // Unlike commit statuses, matching-refs returns one complete array and has
  // no page/per_page parameters. Repeating the request cannot fetch more refs.
  const matchingRefs = await gh.request(`/repos/${repository}/git/matching-refs/tags/ios-testflight/`);
  if (!Array.isArray(matchingRefs)) throw new Error('Expected a complete GitHub matching references array');
  for (const ref of matchingRefs) {
    if (typeof ref?.ref !== 'string' || !ref.ref.startsWith('refs/tags/ios-testflight/')) throw new Error('Malformed managed reservation ref');
    const tag = ref.ref.slice('refs/tags/'.length);
    if (/^ios-testflight\/request\/pr-[1-9]\d*\/comment-[1-9]\d*$/.test(tag)) continue;
    const sha = reservationSha(tag);
    assertReservation(ref, tag, sha);
    if (reservations.has(tag)) throw new Error('Duplicate managed reservation ref');
    reservations.set(tag, sha);
  }
  const { runs, refs } = await cloudInventory(asc, repository, appId, workflowIds);
  const closed = new Set(), observedTags = new Set(), observedRuns = new Set(), ownUploads = new Set(), verifiedUploads = new Set();
  for (const run of runs) {
    const runId = requireId(run?.id, 'Cloud run id');
    if (observedRuns.has(runId)) throw new Error('Duplicate Cloud run identity');
    observedRuns.add(runId);
    const sourceId = relationId(run, 'sourceBranchOrTag');
    const matches = refs.filter(value => value?.id === sourceId);
    if (matches.length !== 1) throw new Error('Cloud run tag source is unresolved or ambiguous');
    const source = matches[0], attrs = run.attributes || {}, sourceAttrs = source.attributes || {};
    let tag;
    if (sourceAttrs.kind === 'BRANCH') {
      // Historical branch refs can move. Only the run's immutable sourceCommit
      // identifies what was built; this exception never closes a reservation.
      const name = sourceAttrs.name;
      if (typeof name !== 'string' || !name || name === '@' || name.startsWith('-')
        || /[\x00-\x20\x7f~^:?*\[\\]/.test(name) || name.includes('..') || name.includes('@{')
        || name.split('/').some(part => !part || part.startsWith('.') || part.endsWith('.') || part.endsWith('.lock'))
        || sourceAttrs.canonicalName !== `refs/heads/${name}` || sourceAttrs.isDeleted !== false
        || !SHA.test(attrs.sourceCommit?.commitSha || '') || attrs.isPullRequestBuild === true) {
        throw new Error('Historical Cloud branch source is unresolved or unverifiable');
      }
      if (refs.filter(value => value?.attributes?.kind === 'BRANCH' && value.attributes.canonicalName === sourceAttrs.canonicalName && value.attributes.isDeleted === false).length !== 1) {
        throw new Error('Multiple live Apple references make the Cloud branch ambiguous');
      }
    } else {
      tag = sourceAttrs.name;
      const sha = reservationSha(tag);
      if (refs.filter(value => value?.attributes?.kind === 'TAG' && value.attributes.canonicalName === `refs/tags/${tag}` && value.attributes.isDeleted === false).length !== 1) {
        throw new Error('Multiple live Apple references make the Cloud run tag ambiguous');
      }
      if (sourceAttrs.kind !== 'TAG' || sourceAttrs.canonicalName !== `refs/tags/${tag}` || sourceAttrs.isDeleted !== false
        || attrs.sourceCommit?.commitSha !== sha || attrs.isPullRequestBuild === true) {
        throw new Error('Cloud run tag or source commit differs from its immutable reservation');
      }
      if (observedTags.has(tag)) throw new Error('Multiple Cloud runs use the same reservation');
      observedTags.add(tag);
    }
    if (tag !== undefined && tag === currentTag) {
      if (forStart) throw Object.assign(new Error('A Cloud run for the current reservation is already visible; reconcile it instead of starting again'), {
        code: 'CLOUD_RUN_ALREADY_EXISTS', tag,
      });
      // Only uploads tied to this exact verified run can be excluded from the
      // app scan during recovery. An unrelated upload never inherits exemption.
      for (const build of await appleCollection(asc, `/v1/ciBuildRuns/${runId}/builds?limit=200`)) ownUploads.add(requireId(build?.id, 'own upload id'));
      continue;
    }
    if (['PENDING', 'RUNNING'].includes(attrs.executionProgress)) throw new Error('An unfinished Cloud run blocks a new app build');
    if (attrs.executionProgress !== 'COMPLETE' || !['SUCCEEDED', 'FAILED', 'CANCELED', 'CANCELLED', 'ERRORED', 'SKIPPED'].includes(attrs.completionStatus)) {
      throw new Error('Cloud run completion is unresolved');
    }
    const builds = await appleCollection(asc, `/v1/ciBuildRuns/${runId}/builds?limit=200`);
    if (attrs.completionStatus === 'SUCCEEDED' && builds.length !== 1) throw new Error('Completed Cloud run has unresolved or ambiguous uploads');
    for (const build of builds) {
      await verifyUpload(asc, build, appId, run);
      verifiedUploads.add(build.id);
    }
    if (tag !== undefined) closed.add(tag);
  }
  // An upload can outlive its monitor or temporarily be absent from run lists.
  for (const build of await appleCollection(asc, `/v1/builds?filter[app]=${appId}&filter[preReleaseVersion.platform]=IOS&limit=200`)) {
    if (!ownUploads.has(build?.id) && !verifiedUploads.has(build?.id)) await verifyUpload(asc, build, appId);
  }
  for (const [tag, sha] of reservations) {
    if (tag === currentTag || closed.has(tag)) continue;
    if (!await unusedReservationEvidence(gh, repository, tag, sha)) {
      throw new Error(`Unresolved reservation ${tag}; no visible run is not proof that no POST was accepted`);
    }
  }
}
