// Commit status URLs are only discovery pointers. Read the immutable logs of
// the verified trusted controller job before accepting a no-start journal.
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { assertCloudOrdering, recordReservationState, parseControllerRunUrl } from './ios-cloud-order.mjs';

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
    if (record?.tag === expected.tag && record.sha === expected.sha) last = record;
  }
  return last?.version === 1 && last.repository === REPOSITORY && expected.repository === REPOSITORY
    && last.state === expected.state && ['not-started', 'rejected'].includes(last.state);
}

export function attachReservationEvidence(gh, { token, exec = execFileSync } = {}) {
  gh.verifyReservationEvidence = async expected => {
    let config;
    try {
      if (expected.repository !== REPOSITORY || !/^[1-9]\d*$/.test(expected.runId)
        || expected.runUrl !== `https://github.com/${REPOSITORY}/actions/runs/${expected.runId}` || !token) return false;
      const jobs = [];
      for (let page = 1; page <= 100; page++) {
        const batch = (await gh.request(`/repos/${REPOSITORY}/actions/runs/${expected.runId}/jobs?filter=all&per_page=100&page=${page}`)).jobs;
        if (!Array.isArray(batch)) return false;
        jobs.push(...batch);
        if (batch.length < 100) break;
        if (page === 100) return false;
      }
      const eligible = jobs.filter(job => JOBS.has(job.name) && job.status === 'completed'
        && Number.isSafeInteger(job.id) && job.id > 0
        && job.run_url === `https://api.github.com/repos/${REPOSITORY}/actions/runs/${expected.runId}`);
      if (!eligible.length) return false;
      config = mkdtempSync(join(tmpdir(), 'on-paper-gh-evidence-'));
      const logs = eligible.sort((a, b) => a.id - b.id).map(job => exec('gh', ['api', `repos/${REPOSITORY}/actions/jobs/${job.id}/logs`], {
        encoding: 'utf8', timeout: 60_000, maxBuffer: 10 * 1024 * 1024,
        // Never pass Apple credentials or the caller's gh aliases/config.
        env: { PATH: process.env.PATH, GH_TOKEN: token, GH_HOST: 'github.com', GH_CONFIG_DIR: config, GH_PROMPT_DISABLED: '1' },
      })).join('\n');
      return verifyReservationLog(logs, expected);
    } catch { return false; }
    finally { if (config) rmSync(config, { recursive: true, force: true }); }
  };
  return gh;
}
