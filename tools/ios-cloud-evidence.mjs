// Commit status URLs are only discovery pointers. Read the immutable logs of
// the verified trusted controller job before accepting a terminal journal.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertCloudOrdering, recordReservationState, parseControllerRunUrl } from './ios-cloud-order.mjs';
import { attachLegacyReservationEvidence } from './ios-cloud-legacy.mjs';
import { attachLegacyDeliveredEvidence } from './ios-cloud-legacy-delivered.mjs';

const REPOSITORY = 'ashproto/Resume-Designer';
const MARKER = 'OP_IOS_RESERVATION_STATE=';
const JOBS = new Set(['Release iOS TestFlight', 'Release iOS preview']);

export function coordinatedReleaseOptions({ env, gh, asc, input, log = console.log }) {
  const mode = env.IOS_PR_TESTFLIGHT_MODE || 'off';
  if (!['off', 'pilot', 'enabled'].includes(mode)) throw new Error('Invalid preview mode; release coordination is unconfirmed');
  if (!env.XCODE_CLOUD_PR_WORKFLOW_ID) {
    if (mode !== 'off') throw new Error('Preview workflow configuration is required before previews can be enabled');
    return {};
  }
  const workflowIds = [env.XCODE_CLOUD_WORKFLOW_ID, env.XCODE_CLOUD_PR_WORKFLOW_ID];
  if (!workflowIds.every(value => typeof value === 'string' && /^[A-Za-z0-9-]+$/.test(value)) || new Set(workflowIds).size !== 2) {
    throw new Error('Two distinct managed Cloud workflow IDs are required');
  }
  const runUrl = `https://github.com/${REPOSITORY}/actions/runs/${env.GITHUB_RUN_ID}`;
  parseControllerRunUrl(REPOSITORY, runUrl);
  return {
    beforeStart: () => assertCloudOrdering({ gh, asc, repository: REPOSITORY, appId: input.appId, workflowIds, currentTag: input.tag, forStart: true }),
    recordState: async state => {
      const evidence = await recordReservationState({ gh, repository: REPOSITORY, sha: input.sha, tag: input.tag, state, runUrl });
      log(`OP_IOS_RESERVATION_STATE=${JSON.stringify(evidence)}`);
    },
  };
}

export function verifyReservationLog(text, expected) {
  if (typeof text !== 'string' || Buffer.byteLength(text) > 10 * 1024 * 1024) return false;
  let last;
  for (const line of text.split(/\r?\n/)) {
    const index = line.indexOf(MARKER);
    if (index < 0) continue;
    let record;
    try { record = JSON.parse(line.slice(index + MARKER.length)); } catch { return false; }
    if (record?.tag === expected.tag) last = record;
  }
  return last?.version === 1 && last.repository === REPOSITORY && expected.repository === REPOSITORY
    && last.sha === expected.sha && last.state === expected.state && ['not-started', 'rejected', 'delivered'].includes(last.state);
}

const runSnapshot = run => JSON.stringify({ id: run?.id, html_url: run?.html_url, head_branch: run?.head_branch, head_sha: run?.head_sha,
  repository: { id: run?.repository?.id, full_name: run?.repository?.full_name },
  head_repository: { id: run?.head_repository?.id, full_name: run?.head_repository?.full_name },
  event: run?.event, path: run?.path, workflow_id: run?.workflow_id, run_attempt: run?.run_attempt,
  status: run?.status, conclusion: run?.conclusion, created_at: run?.created_at, updated_at: run?.updated_at });
const jobsSnapshot = jobs => JSON.stringify(jobs.filter(job => JOBS.has(job.name)).map(job => ({ id: job.id, name: job.name,
  run_url: job.run_url, run_id: job.run_id, head_sha: job.head_sha, status: job.status,
  conclusion: job.conclusion, run_attempt: job.run_attempt })).sort((a, b) => a.id - b.id));

export function attachReservationEvidence(gh, { token, exec = execFileSync } = {}) {
  attachLegacyReservationEvidence(gh, { token, exec });
  attachLegacyDeliveredEvidence(gh, { token, exec });
  gh.verifyReservationEvidence = async expected => {
    let config;
    try {
      if (expected.repository !== REPOSITORY || !/^[1-9]\d*$/.test(expected.runId)
        || expected.runUrl !== `https://github.com/${REPOSITORY}/actions/runs/${expected.runId}` || !token) return false;
      const isDelivered = expected.state === 'delivered';
      const runPath = `/repos/${REPOSITORY}/actions/runs/${expected.runId}`;
      const controller = isDelivered ? await gh.request(runPath) : undefined;
      if (isDelivered && (String(controller?.id) !== expected.runId || controller.html_url !== expected.runUrl
        || controller.status !== 'completed' || !Number.isSafeInteger(Number(expected.runId))
        || !Number.isSafeInteger(controller.run_attempt) || controller.run_attempt <= 0
        || !/^[a-f0-9]{40}$/.test(controller.head_sha || ''))) return false;
      const controllerIdentity = isDelivered ? runSnapshot(controller) : undefined;
      const readJobs = async () => {
        const values = [];
        for (let page = 1; page <= 100; page++) {
          const batch = (await gh.request(`/repos/${REPOSITORY}/actions/runs/${expected.runId}/jobs?filter=all&per_page=100&page=${page}`)).jobs;
          if (!Array.isArray(batch)) throw new Error('Incomplete controller jobs');
          values.push(...batch);
          if (batch.length < 100) return values;
        }
        throw new Error('Incomplete controller jobs');
      };
      const jobs = await readJobs();
      const named = jobs.filter(job => JOBS.has(job.name));
      if (isDelivered && named.some(job => job.run_id !== Number(expected.runId) || job.head_sha !== controller.head_sha
        || !Number.isSafeInteger(job.run_attempt) || job.run_attempt <= 0 || job.run_attempt > controller.run_attempt)) return false;
      // Historical attempts remain in the metadata snapshot, but cannot prove
      // the current attempt's outcome or supply its missing/failed job marker.
      const candidates = isDelivered ? named.filter(job => job.run_attempt === controller.run_attempt) : named;
      const eligible = candidates.filter(job => job.status === 'completed'
        && Number.isSafeInteger(job.id) && job.id > 0
        && job.run_url === `https://api.github.com/repos/${REPOSITORY}/actions/runs/${expected.runId}`);
      if (!eligible.length) return false;
      eligible.sort((a, b) => a.id - b.id);
      if (isDelivered && (eligible.length !== candidates.length
        || new Set(eligible.map(job => job.id)).size !== eligible.length || eligible.at(-1).conclusion !== 'success')) return false;
      const jobIdentity = isDelivered ? jobsSnapshot(jobs) : undefined;
      config = mkdtempSync(join(tmpdir(), 'on-paper-gh-evidence-'));
      const logs = eligible.map(job => exec('gh', ['api', '--allow-escape-sequences', `repos/${REPOSITORY}/actions/jobs/${job.id}/logs`], {
        encoding: 'utf8', timeout: 60_000, maxBuffer: 10 * 1024 * 1024,
        // Never pass Apple credentials or the caller's gh aliases/config.
        env: { PATH: process.env.PATH, GH_TOKEN: token, GH_HOST: 'github.com', GH_CONFIG_DIR: config, XDG_STATE_HOME: config, XDG_CACHE_HOME: config, GH_PROMPT_DISABLED: '1' },
      }));
      if (!verifyReservationLog(logs.join('\n'), expected)) return false;
      if (!isDelivered) return true;
      // A later failed/active rerun or a later marker must not be hidden by an
      // older successful attempt. Re-read metadata after all authenticated logs.
      if (!verifyReservationLog(logs.at(-1), expected) || jobIdentity !== jobsSnapshot(await readJobs())) return false;
      return controllerIdentity === runSnapshot(await gh.request(runPath));
    } catch { return false; }
    finally { if (config) rmSync(config, { recursive: true, force: true }); }
  };
  return gh;
}
