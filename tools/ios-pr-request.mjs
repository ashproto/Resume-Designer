// Trusted PR preview policy. GitHub data is inspected as data; this module has
// no CLI, subprocess, candidate execution, Apple access, or dependency install.
const REPOSITORY = 'ashproto/Resume-Designer';
const REPOSITORY_ID = 1163653093;
const OWNER = 'ashproto';
const OWNER_ID = 35086581;
const ROOT = `/repos/${REPOSITORY}`;
const WORKFLOW_PATH = '.github/workflows/ci.yml';
const SHA = /^[a-f0-9]{40}$/;
const REQUEST = /^ios-testflight\/request\/pr-([1-9][0-9]*)\/comment-([1-9][0-9]*)$/;
const REQUIRED_JOBS = ['checks', 'rust-check', 'ios-native'];

function requireCondition(condition, reason) {
  if (!condition) throw new Error(reason);
}

function number(value, label) {
  requireCondition((typeof value === 'number' || typeof value === 'string') && /^[1-9][0-9]*$/.test(String(value)), `Invalid ${label}.`);
  const parsed = Number(value);
  requireCondition(Number.isSafeInteger(parsed), `Invalid ${label}.`);
  return parsed;
}

function sha(value) {
  requireCondition(typeof value === 'string' && SHA.test(value), 'A full lowercase source SHA is required.');
  return value;
}

const ownerIdentity = user => user?.id === OWNER_ID && user.login === OWNER && user.type === 'User';
const repoIdentity = repo => repo?.id === REPOSITORY_ID && repo.full_name === REPOSITORY;
const command = body => typeof body === 'string' && body.trim() === '/testflight-dev';
const requestTag = (prNumber, commentId) => `ios-testflight/request/pr-${prNumber}/comment-${commentId}`;
const dispatchTag = (prNumber, commentId, source) => `ios-testflight/pr/${prNumber}/${commentId}/${source}`;

function requestIdentity(input) {
  const prNumber = number(input.prNumber, 'PR number');
  const commentId = number(input.commentId, 'comment ID');
  const source = sha(input.sha);
  const tag = requestTag(prNumber, commentId);
  requireCondition(input.requestTag === undefined || input.requestTag === tag, 'Request tag does not match the original identity.');
  const dispatch = dispatchTag(prNumber, commentId, source);
  requireCondition(input.tag === undefined || input.tag === dispatch, 'Dispatch tag does not match the original identity.');
  return { ...input, prNumber, commentId, sha: source, requestTag: tag, tag: dispatch };
}

async function read(gh, path) {
  try { return await gh.request(path); }
  catch { throw new Error('GitHub verification failed; preview is not authorized.'); }
}

async function binding(gh, tag, required = false) {
  let ref;
  try { ref = await gh.request(`${ROOT}/git/ref/tags/${tag}`); }
  catch (error) {
    if (error?.status === 404 && !required) return undefined;
    throw new Error('Request binding could not be verified; no new binding or start is authorized.');
  }
  requireCondition(ref?.ref === `refs/tags/${tag}` && ref.object?.type === 'commit', 'Request binding must be the exact lightweight commit ref.');
  return sha(ref.object.sha);
}

async function collection(gh, path, key) {
  const items = [];
  for (let page = 1; page <= 100; page++) {
    const response = await read(gh, `${path}${path.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const batch = response?.[key];
    requireCondition(Array.isArray(batch) && batch.length <= 100, 'Malformed GitHub collection; preview is not authorized.');
    items.push(...batch);
    if (batch.length < 100) return items;
  }
  throw new Error('GitHub pagination limit reached; preview is not authorized.');
}

async function trustedOwner({ event, ref, triggeringActor, runAttempt, gh }) {
  const attempt = number(runAttempt === undefined ? 1 : runAttempt, 'workflow run attempt');
  requireCondition(ref === 'refs/heads/main', 'The preview controller must run on trusted main.');
  requireCondition(repoIdentity(event?.repository) && ownerIdentity(event.repository.owner), 'Unexpected event repository identity.');
  requireCondition(ownerIdentity(event?.sender), 'Only the fixed owner may request or rerun a preview.');
  requireCondition(typeof triggeringActor === 'string' && /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/.test(triggeringActor), 'A valid triggering actor is required.');
  const repository = await read(gh, ROOT);
  requireCondition(repoIdentity(repository) && repository.default_branch === 'main' && ownerIdentity(repository.owner), 'Live repository identity or trusted default branch changed.');
  const user = await read(gh, `/users/${OWNER}`);
  requireCondition(ownerIdentity(user), 'Live owner identity changed.');
  const actor = triggeringActor === OWNER ? user : await read(gh, `/users/${triggeringActor}`);
  requireCondition(ownerIdentity(actor), 'Only the fixed owner may rerun a preview.');
  const permission = await read(gh, `${ROOT}/collaborators/${OWNER}/permission`);
  requireCondition(permission?.permission === 'admin' && ownerIdentity(permission.user), 'The owner must currently have repository admin permission.');
  return attempt;
}

async function liveRequest(gh, prNumber, commentId, original, monitorOnly) {
  const comment = await read(gh, `${ROOT}/issues/comments/${commentId}`);
  requireCondition(comment?.id === commentId && ownerIdentity(comment.user) && command(comment.body), 'The original owner command no longer matches.');
  requireCondition(comment.issue_url === `https://api.github.com${ROOT}/issues/${prNumber}`, 'The command belongs to a different PR.');
  requireCondition(typeof comment.created_at === 'string' && Number.isFinite(Date.parse(comment.created_at)) && comment.updated_at === comment.created_at,
    'Edited commands cannot authorize previews; create a fresh command.');
  if (original) {
    requireCondition(original.id === commentId && ownerIdentity(original.user) && original.body === comment.body
      && original.created_at === comment.created_at && original.updated_at === comment.updated_at,
    'The live command differs from the original new comment.');
  }
  const pr = await read(gh, `${ROOT}/pulls/${prNumber}`);
  requireCondition(pr?.number === prNumber, 'Unexpected PR identity.');
  if (!monitorOnly) {
    requireCondition(pr.state === 'open', 'The PR must remain open for a new preview start.');
    requireCondition(repoIdentity(pr.head?.repo) && repoIdentity(pr.base?.repo), 'Preview heads and bases must belong to the upstream repository; forks are refused.');
    requireCondition(['main', 'next'].includes(pr.base?.ref), 'The PR must target protected main or next.');
    sha(pr.head.sha);
    const base = await read(gh, `${ROOT}/branches/${pr.base.ref}`);
    requireCondition(base?.protected === true && SHA.test(base.commit?.sha || ''), 'The PR base must currently be protected.');
  }
  return pr;
}

function associatedRun(run, prNumber, source, base) {
  if (!Array.isArray(run?.pull_requests)) return false;
  const matches = run.pull_requests.filter(pr => pr?.number === prNumber);
  return matches.length === 1 && matches[0].head?.sha === source
    // Actions uses abbreviated repository objects here, unlike the live PR.
    && matches[0].head?.repo?.id === REPOSITORY_ID && matches[0].base?.repo?.id === REPOSITORY_ID
    && matches[0].base?.ref === base;
}

async function successfulCi(gh, pr, source) {
  const workflow = await read(gh, `${ROOT}/actions/workflows/ci.yml`);
  requireCondition(workflow?.path === WORKFLOW_PATH, 'Unexpected CI workflow path.');
  number(workflow.id, 'CI workflow ID');
  // Do not filter head_sha: GitHub may record the synthetic PR merge here.
  // Association metadata must still name the exact requested source head.
  const runs = await collection(gh, `${ROOT}/actions/workflows/ci.yml/runs?event=pull_request`, 'workflow_runs');
  const candidates = runs.filter(run => associatedRun(run, pr.number, source, pr.base.ref));
  requireCondition(candidates.length > 0, 'Successful associated PR CI is required; create a fresh command after it passes.');
  for (const run of candidates) number(run.id, 'CI run ID');
  const ids = new Set(candidates.map(run => run.id));
  requireCondition(ids.size === candidates.length, 'Ambiguous CI run collection; preview is not authorized.');
  const selected = candidates.reduce((latest, run) => run.id > latest.id ? run : latest);
  const run = await read(gh, `${ROOT}/actions/runs/${selected.id}`);
  requireCondition(run?.id === selected.id && run.workflow_id === workflow.id && run.path === WORKFLOW_PATH,
    'Unexpected CI workflow identity.');
  requireCondition(run.event === 'pull_request' && run.status === 'completed' && run.conclusion === 'success',
    'Successful completed PR CI is required; create a fresh command after it passes.');
  requireCondition(repoIdentity(run.head_repository) && associatedRun(run, pr.number, source, pr.base.ref),
    'CI does not belong to this repository, PR and exact source head.');
  requireCondition(run.head_sha === source || (SHA.test(pr.merge_commit_sha || '') && run.head_sha === pr.merge_commit_sha),
    'CI run source is neither the requested head nor its associated synthetic merge.');
  const jobs = await collection(gh, `${ROOT}/actions/runs/${run.id}/jobs?filter=latest`, 'jobs');
  for (const name of REQUIRED_JOBS) {
    const matches = jobs.filter(job => job?.name === name);
    requireCondition(matches.length === 1 && matches[0].status === 'completed' && matches[0].conclusion === 'success',
      `Exactly one successful completed ${name} CI job is required.`);
  }
  return run.id;
}

function startMode({ mode, pilotPr, pilotSha }, prNumber, source) {
  requireCondition(['enabled', 'pilot'].includes(mode), 'Preview mode forbids new starts.');
  if (mode === 'pilot') {
    requireCondition(number(pilotPr, 'pilot PR number') === prNumber && sha(pilotSha) === source,
      'Pilot mode permits only the configured exact PR and SHA.');
  }
}

export async function authorizePreview(context) {
  const { eventName, event, mode, gh, expectedSha, recovery = false } = context;
  const recover = eventName === 'workflow_dispatch' && recovery === true;
  if (!recover && (eventName !== 'issue_comment' || event?.action !== 'created' || !event.issue?.pull_request
    || !command(event.comment?.body))) return { skip: true, reason: 'unrelated-comment' };
  if (!ownerIdentity(event?.sender) || (!recover && !ownerIdentity(event.comment?.user))) return { skip: true, reason: 'not-owner' };
  if (!recover && !['enabled', 'pilot'].includes(mode)) return { skip: true, reason: 'preview-disabled' };
  const attempt = await trustedOwner(context);
  let prNumber, commentId;
  if (recover) {
    const match = typeof event.inputs?.request_tag === 'string' && REQUEST.exec(event.inputs.request_tag);
    requireCondition(match, 'Recovery requires an exact original request tag.');
    prNumber = number(match[1], 'recovery PR number');
    commentId = number(match[2], 'recovery comment ID');
  } else {
    prNumber = number(event.issue.number, 'PR number');
    commentId = number(event.comment.id, 'comment ID');
  }
  const tag = requestTag(prNumber, commentId);
  // An unbound first attempt may resolve today's head once. A rerun is never a
  // standing authorization to resolve another head after a failed/cancelled job.
  const bound = await binding(gh, tag, recover || context.requireBinding === true || attempt > 1);
  const pr = await liveRequest(gh, prNumber, commentId, recover ? undefined : event.comment, recover);
  const source = bound ?? sha(pr.head?.sha);
  if (expectedSha !== undefined) requireCondition(source === sha(expectedSha), 'Request binding differs from the frozen source SHA.');
  const result = { skip: false, prNumber, commentId, sha: source, requestTag: tag, tag: dispatchTag(prNumber, commentId, source) };
  if (recover) return { ...result, monitorOnly: true };
  requireCondition(pr.head.sha === source, 'The request binding is stale: the PR head advanced; create a fresh command.');
  startMode(context, prNumber, source);
  const ciRunId = await successfulCi(gh, pr, source);
  await liveRequest(gh, prNumber, commentId, event.comment, false);
  // This must be the final awaited API call before returning start eligibility.
  // Even a protection/comment check after the PR read can hide a newer push.
  const current = await read(gh, `${ROOT}/pulls/${prNumber}`);
  requireCondition(current?.number === prNumber && current.state === 'open' && current.head?.sha === source
    && repoIdentity(current.head?.repo) && current.base?.ref === pr.base.ref && repoIdentity(current.base?.repo),
  'The PR identity, open state, head or base changed while checking CI; this request is stale.');
  return { skip: false, prNumber, commentId, sha: source, ciRunId, requestTag: tag, tag: result.tag };
}

// Isolated feedback jobs have no Apple access. Refusal feedback may describe a
// stale/closed/CI-red request, but it still requires the unchanged owner command.
export async function authorizePreviewFeedback(context) {
  const { eventName, event, gh } = context;
  if (eventName === 'workflow_dispatch' && context.recovery === true) {
    const result = await authorizePreview(context);
    if (result.skip) return result;
    return { prNumber: result.prNumber, commentId: result.commentId, requestTag: result.requestTag, sha: result.sha };
  }
  if (eventName !== 'issue_comment' || event?.action !== 'created' || !event.issue?.pull_request
    || !command(event.comment?.body)) return { skip: true, reason: 'unrelated-comment' };
  if (!ownerIdentity(event?.sender) || !ownerIdentity(event.comment?.user)) return { skip: true, reason: 'not-owner' };
  await trustedOwner(context);
  const prNumber = number(event.issue.number, 'PR number');
  const commentId = number(event.comment.id, 'comment ID');
  const tag = requestTag(prNumber, commentId);
  const bound = await binding(gh, tag);
  await liveRequest(gh, prNumber, commentId, event.comment, true);
  return { prNumber, commentId, requestTag: tag, ...(bound === undefined ? {} : { sha: bound }) };
}

export async function bindPreviewRequest(input, { gh }) {
  requireCondition(input?.skip === false && input.monitorOnly !== true, 'Only a newly authorized request can create a binding.');
  const request = requestIdentity(input);
  let bound = await binding(gh, request.requestTag);
  if (bound !== undefined) {
    requireCondition(bound === request.sha, 'Existing request binding differs from the frozen source; it cannot be rebound.');
    return request;
  }
  // Never retry POST. A lost response may already have created the durable ref.
  try {
    await gh.request(`${ROOT}/git/refs`, { method: 'POST', body: { ref: `refs/tags/${request.requestTag}`, sha: request.sha } });
  } catch { /* Read back after both successful and ambiguous creates. */ }
  bound = await binding(gh, request.requestTag, true);
  requireCondition(bound === request.sha, 'Created request binding differs from the frozen source; it cannot be rebound.');
  return request;
}

export async function recheckPreview(input, options) {
  const request = requestIdentity(input);
  const monitorOnly = options.purpose === 'monitor';
  requireCondition(monitorOnly || options.purpose === 'start', 'Preview recheck purpose must be start or monitor.');
  if (monitorOnly) {
    await trustedOwner(options);
    const bound = await binding(options.gh, request.requestTag, true);
    requireCondition(bound === request.sha, 'Original request binding changed.');
    await liveRequest(options.gh, request.prNumber, request.commentId,
      options.eventName === 'issue_comment' ? options.event?.comment : undefined, true);
    return { ...request, monitorOnly: true };
  }
  requireCondition(input.monitorOnly !== true, 'Recovery can monitor an original request but cannot authorize a new start.');
  const result = await authorizePreview({ ...options, recovery: false, expectedSha: request.sha, requireBinding: true });
  requireCondition(result.skip === false && result.prNumber === request.prNumber && result.commentId === request.commentId,
    'Original preview request is no longer authorized for a start.');
  return result;
}
