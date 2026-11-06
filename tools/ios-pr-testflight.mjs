#!/usr/bin/env node
// Executed only from trusted main. Candidate Git objects are data, never a
// checkout/dependency install/artifact executable in this credential boundary.
import { execFileSync } from 'node:child_process';
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { authorizePreview, authorizePreviewFeedback, bindPreviewRequest, recheckPreview } from './ios-pr-request.mjs';
import { assertPreviewBuildInputs } from './ios-pr-build-inputs.mjs';
import { createApi, createAscJwt, release } from './ios-cloud-release.mjs';
import { assertCloudOrdering, recordReservationState, parseControllerRunUrl } from './ios-cloud-order.mjs';
import { attachReservationEvidence } from './ios-cloud-evidence.mjs';

const REPOSITORY = 'ashproto/Resume-Designer';
const SHA = /^[a-f0-9]{40}$/;
const positive = value => Number.isSafeInteger(Number(value)) && /^[1-9]\d*$/.test(String(value));
const safeText = value => String(value ?? '').slice(0, 500).replace(/[\x00-\x1f\x7f]/g, ' ')
  .replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('@', '@\u200b')
  .replace(/[\\`*_\[\]{}()!#|]/g, '\\$&');

function identity(input) {
  if (!positive(input.prNumber) || !positive(input.commentId) || (input.sha !== undefined && !SHA.test(input.sha))) {
    throw new Error('Invalid preview request identity');
  }
  return { ...input, prNumber: Number(input.prNumber), commentId: Number(input.commentId) };
}

export function formatFeedback({ request: supplied, values = {}, error, runUrl }) {
  const request = identity(supplied);
  parseControllerRunUrl(REPOSITORY, runUrl);
  const state = values.release_state;
  const available = state === 'testflight_available' && !error && positive(values.build_number);
  const message = available ? `Build **${values.build_number}** is available to **On Paper Dev** in TestFlight.`
    : state === 'superseded' ? 'This request is stale. Create a new `/testflight-dev` comment for the current PR revision.'
      : error ? 'TestFlight availability is **unconfirmed**. Check the Actions run before requesting another build.'
        : state === 'queued' ? 'The approved revision is queued for an internal TestFlight build.'
          : state === 'submitted' || state === 'cloud_succeeded' ? 'The build was submitted. TestFlight availability is **unconfirmed** while Apple finishes processing.'
            : 'The request could not start. Check the Actions run for the authorization or configuration result.';
  return [`<!-- on-paper-testflight-request:${request.commentId} -->`, '### On Paper PR TestFlight', '', message,
    `PR: [#${request.prNumber}](https://github.com/${REPOSITORY}/pull/${request.prNumber}).`,
    request.sha ? `Source: \`${request.sha}\`.` : 'No source revision was authorized.',
    `[View the Actions run](${runUrl}).`,
    values.build_run_id && /^[A-Za-z0-9-]+$/.test(values.build_run_id) ? `Cloud run: \`${values.build_run_id}\`.` : '',
    error ? `Details: ${safeText(error)}` : '',
    '', 'The Dev build uses the existing On Paper app and CloudKit data.'].filter(Boolean).join('\n\n');
}

export async function upsertFeedback({ gh, request: supplied, body }) {
  const request = identity(supplied), marker = `<!-- on-paper-testflight-request:${request.commentId} -->`;
  if (typeof body !== 'string' || !body.startsWith(marker) || body.length > 10_000) throw new Error('Invalid preview feedback body');
  const comments = [];
  for (let page = 1; page <= 100; page++) {
    const batch = await gh.request(`/repos/${REPOSITORY}/issues/${request.prNumber}/comments?per_page=100&page=${page}`);
    if (!Array.isArray(batch)) throw new Error('Malformed feedback comment collection');
    comments.push(...batch);
    if (batch.length < 100) break;
    if (page === 100) throw new Error('Excessive feedback pagination');
  }
  const matches = comments.filter(comment => comment.user?.id === 41898282 && comment.user.login === 'github-actions[bot]'
    && comment.user.type === 'Bot' && comment.body?.startsWith(marker));
  if (matches.length > 1) throw new Error('Ambiguous bot feedback identity');
  const path = matches.length ? `/repos/${REPOSITORY}/issues/comments/${matches[0].id}` : `/repos/${REPOSITORY}/issues/${request.prNumber}/comments`;
  if (matches.length && !positive(matches[0].id)) throw new Error('Invalid existing feedback ID');
  await gh.request(path, { method: matches.length ? 'PATCH' : 'POST', body: { body } });
}

export async function verifyPreviewRecipients({ asc, appId, groupId }) {
  if (![appId, groupId].every(value => typeof value === 'string' && /^[A-Za-z0-9-]+$/.test(value))) throw new Error('Invalid preview group configuration');
  const groups = await asc.collection(`/v1/apps/${appId}/betaGroups?limit=200`);
  const matches = groups.filter(group => group.id === groupId);
  if (matches.length !== 1 || matches[0].attributes?.isInternalGroup !== true) throw new Error('Preview requires one configured internal group');
  if (groups.some(group => typeof group.attributes?.hasAccessToAllBuilds !== 'boolean' || group.attributes.hasAccessToAllBuilds)) {
    throw new Error('Automatic all-build access must be disabled for every app group before preview delivery');
  }
}

export async function inspectCandidate({ candidateSha, trustedSha, cwd = process.cwd(), exec = execFileSync, assertInputs = assertPreviewBuildInputs }) {
  if (!SHA.test(candidateSha || '') || !SHA.test(trustedSha || '')) throw new Error('Full candidate and trusted source SHAs are required');
  // Fixed origin URL and object ID; no branch/ref/user text, recursive checkout,
  // local hooks, smudge filters or credentials persisted in the Git config.
  exec('git', ['-c', 'core.hooksPath=/dev/null', 'fetch', '--no-tags', '--no-recurse-submodules',
    `https://github.com/${REPOSITORY}.git`, candidateSha], { cwd, stdio: 'pipe', timeout: 60_000, maxBuffer: 1024 * 1024,
    env: { PATH: process.env.PATH, GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_NO_REPLACE_OBJECTS: '1', GIT_TERMINAL_PROMPT: '0' } });
  await assertInputs({ candidateSha, trustedSha, cwd });
}

export async function runPreviewCommand(command, options) {
  const { env, eventName, event, gh, asc, output = () => {}, log = console.log,
    authorize = authorizePreview, bind = bindPreviewRequest, recheck = recheckPreview,
    guard = inspectCandidate, deliver = release, recipients = verifyPreviewRecipients,
    ordering = assertCloudOrdering, journal = recordReservationState,
  } = options;
  if (env.GITHUB_REPOSITORY !== REPOSITORY || env.GITHUB_REF !== 'refs/heads/main' || !SHA.test(env.GITHUB_SHA || '')) {
    throw new Error('Only the trusted main preview controller may run');
  }
  const runUrl = `https://github.com/${REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  parseControllerRunUrl(REPOSITORY, runUrl);
  const context = { eventName, event, ref: env.GITHUB_REF, triggeringActor: env.GITHUB_TRIGGERING_ACTOR,
    runAttempt: env.GITHUB_RUN_ATTEMPT || '1',
    mode: env.IOS_PR_TESTFLIGHT_MODE || 'off', pilotPr: env.IOS_PR_TESTFLIGHT_PILOT_PR,
    pilotSha: env.IOS_PR_TESTFLIGHT_PILOT_SHA, gh };
  const checkInputs = request => guard({ candidateSha: request.sha, trustedSha: env.GITHUB_SHA });
  if (command === 'authorize' || command === 'bind') {
    const request = await authorize({ ...context, expectedSha: command === 'bind' ? env.PREVIEW_SHA : undefined,
      recovery: eventName === 'workflow_dispatch' });
    if (request.skip) { output(request); return request; }
    if (!request.monitorOnly) await checkInputs(request);
    const bound = command === 'bind' && !request.monitorOnly ? await bind(request, { gh }) : request;
    output(bound);
    return bound;
  }
  if (!['release', 'recover'].includes(command)) throw new Error('Unknown preview command');
  const recoveryOnly = command === 'recover';
  const request = recoveryOnly ? await authorize({ ...context, recovery: true })
    : identity({ skip: false, prNumber: env.PR_NUMBER, commentId: env.COMMENT_ID, sha: env.PREVIEW_SHA });
  if (request.skip) throw new Error('Recovery request was not authorized');
  const input = { ...request, kind: 'preview', repository: REPOSITORY, recoveryOnly,
    workflowId: env.XCODE_CLOUD_PR_WORKFLOW_ID, appId: env.APP_STORE_CONNECT_APP_ID, groupId: env.APP_STORE_CONNECT_DEV_GROUP_ID,
    resumeRunId: recoveryOnly ? event.inputs?.resume_run_id || undefined : undefined };
  const authorizeSource = async purpose => {
    await recheck(request, { ...context, purpose: 'monitor' });
    if (recoveryOnly) return false;
    if (purpose !== 'monitor') await checkInputs(request);
    try { await recheck(request, { ...context, purpose: 'start' }); }
    catch (error) { if (purpose === 'start') log('The original preview request is no longer eligible for a new start.'); return false; }
    return true;
  };
  return deliver(input, { gh, asc, output, log, authorizeSource,
    beforeStart: async () => {
      await recipients({ asc, appId: input.appId, groupId: input.groupId });
      await ordering({ gh, asc, repository: REPOSITORY, appId: input.appId,
        workflowIds: [env.XCODE_CLOUD_WORKFLOW_ID, env.XCODE_CLOUD_PR_WORKFLOW_ID], forStart: true,
        currentTag: request.tag ?? `ios-testflight/pr/${request.prNumber}/${request.commentId}/${request.sha}` });
    },
    recordState: async state => {
      const evidence = await journal({ gh, repository: REPOSITORY, sha: input.sha,
        tag: `ios-testflight/pr/${request.prNumber}/${request.commentId}/${request.sha}`, state, runUrl });
      log(`OP_IOS_RESERVATION_STATE=${JSON.stringify(evidence)}`);
    },
  });
}

function writeOutputs(values) {
  const names = { sha: 'sha', skip: 'skip', prNumber: 'pr_number', commentId: 'comment_id', requestTag: 'request_tag',
    tag: 'tag', ciRunId: 'ci_run_id', monitorOnly: 'monitor_only', reason: 'reason',
    release_state: 'release_state', release_tag: 'release_tag', build_run_id: 'build_run_id',
    cloud_build_number: 'cloud_build_number', asc_build_id: 'asc_build_id', build_number: 'build_number' };
  for (const [key, value] of Object.entries(values)) {
    if (!names[key]) continue;
    const text = String(value);
    if (/[\r\n\x00]/.test(text)) throw new Error('Unsafe preview workflow output');
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `${names[key]}=${text}\n`);
    console.log(`${names[key]}=${text}`);
  }
}

// Diagnostics use only these fixed operation names, never API paths, response
// bodies, exception messages, credentials or environment values.
function feedbackOperation(path, method = 'GET') {
  const root = `/repos/${REPOSITORY}`;
  const pathname = typeof path === 'string' ? path.split('?')[0] : '';
  if (method === 'GET' && pathname === root) return 'read_repository';
  if (method === 'GET' && /^\/users\/[A-Za-z0-9-]+$/.test(pathname)) return 'read_user';
  if (!pathname.startsWith(`${root}/`)) return 'unknown';
  const suffix = pathname.slice(root.length);
  if (method === 'GET' && /^\/collaborators\/[A-Za-z0-9-]+\/permission$/.test(suffix)) return 'read_permission';
  if (method === 'GET' && /^\/git\/ref\/tags\/ios-testflight\/request\/pr-[1-9]\d*\/comment-[1-9]\d*$/.test(suffix)) return 'read_binding';
  if (method === 'GET' && /^\/issues\/comments\/[1-9]\d*$/.test(suffix)) return 'read_command';
  if (method === 'GET' && /^\/pulls\/[1-9]\d*$/.test(suffix)) return 'read_pr';
  if (method === 'GET' && /^\/issues\/[1-9]\d*\/comments$/.test(suffix)) return 'list_comments';
  if (method === 'POST' && /^\/issues\/[1-9]\d*\/comments$/.test(suffix)) return 'create_comment';
  if (method === 'PATCH' && /^\/issues\/comments\/[1-9]\d*$/.test(suffix)) return 'update_comment';
  return 'unknown';
}

function feedbackApi(gh, diagnostic) {
  return { request: async (path, options) => {
    const operation = feedbackOperation(path, options?.method);
    diagnostic.api = undefined;
    if (operation === 'list_comments') diagnostic.phase = 'feedback_list';
    if (operation === 'create_comment' || operation === 'update_comment') diagnostic.phase = 'feedback_write';
    try { return await gh.request(path, options); }
    catch (error) {
      // Capture before policy helpers replace the exception. Emit only if the
      // command fails: a handled optional binding 404 is not a feedback failure.
      diagnostic.api = { operation, status: Number.isInteger(error?.status) && error.status >= 100 && error.status <= 599
        ? error.status : 'transport' };
      for (const [source, target] of [['rateLimitRemaining', 'remaining'], ['rateLimitReset', 'reset'], ['retryAfter', 'retry_after']]) {
        if (Number.isSafeInteger(error?.[source]) && error[source] >= 0) diagnostic.api[target] = error[source];
      }
      throw error;
    }
  } };
}

async function main(diagnostic) {
  const command = process.argv[2];
  if (!['authorize', 'bind', 'release', 'recover', 'feedback'].includes(command) || process.argv.length !== 3) throw new Error('Expected one trusted preview command');
  const env = process.env;
  diagnostic.phase = 'init_event';
  const event = JSON.parse(readFileSync(env.GITHUB_EVENT_PATH, 'utf8'));
  diagnostic.phase = 'init_token';
  if (!env.GITHUB_TOKEN) throw new Error('GitHub token is required');
  diagnostic.phase = 'init_api';
  const gh = attachReservationEvidence(createApi({ origin: 'https://api.github.com', token: () => env.GITHUB_TOKEN }), { token: env.GITHUB_TOKEN });
  if (command === 'feedback') {
    diagnostic.phase = 'feedback_authorize';
    const feedbackGh = feedbackApi(gh, diagnostic);
    const request = await authorizePreviewFeedback({ eventName: env.GITHUB_EVENT_NAME, event, ref: env.GITHUB_REF,
      triggeringActor: env.GITHUB_TRIGGERING_ACTOR, gh: feedbackGh, recovery: env.GITHUB_EVENT_NAME === 'workflow_dispatch' });
    if (request.skip) return;
    diagnostic.phase = 'feedback_format';
    diagnostic.api = undefined;
    const values = { release_state: env.PREVIEW_STATE, build_number: env.PREVIEW_BUILD_NUMBER, build_run_id: env.PREVIEW_CLOUD_RUN_ID };
    const body = formatFeedback({ request, values, error: env.PREVIEW_ERROR,
      runUrl: `https://github.com/${REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}` });
    diagnostic.phase = 'feedback_upsert';
    await upsertFeedback({ gh: feedbackGh, request, body });
    return;
  }
  let asc;
  if (command === 'release' || command === 'recover') {
    diagnostic.phase = 'init_apple_api';
    const credentials = { issuerId: env.APP_STORE_CONNECT_ISSUER_ID, keyId: env.APP_STORE_CONNECT_KEY_ID, privateKey: env.APP_STORE_CONNECT_PRIVATE_KEY };
    asc = createApi({ origin: 'https://api.appstoreconnect.apple.com', token: () => createAscJwt(credentials) });
  }
  try {
    await runPreviewCommand(command, { env, eventName: env.GITHUB_EVENT_NAME, event, gh, asc, output: writeOutputs });
  } catch (error) {
    // Details are bounded policy/controller messages, never API response bodies.
    writeOutputs({ release_state: 'unconfirmed' });
    console.error(String(error.message).replace(/[\r\n\x00-\x1f]/g, ' ').slice(0, 500));
    process.exitCode = 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const diagnostic = { phase: 'init_arguments' };
  main(diagnostic).catch(() => {
    const api = diagnostic.api ? ` operation=${diagnostic.api.operation} status=${diagnostic.api.status}`
      + ['remaining', 'reset', 'retry_after'].filter(key => diagnostic.api[key] !== undefined).map(key => ` ${key}=${diagnostic.api[key]}`).join('') : '';
    console.error(`preview_diagnostic phase=${diagnostic.phase}${api}`);
    process.exitCode = 1;
  });
}
