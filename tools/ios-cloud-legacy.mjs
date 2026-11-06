// One reviewed pre-journal reservation, not a general reconciliation override.
// The original trusted controller returned during tag discovery (line 240),
// before its sole Cloud POST (line 272). The exact original workflow, controller
// and authenticated job-log bytes below bind that conclusion to this tag only.
// Receipt review: Actions 42157371938, controller checkout bc7d81e, 2026-11-06.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPOSITORY = 'ashproto/Resume-Designer';
const ROOT = `/repos/${REPOSITORY}`;
const SHA = '52e1b799c03be084736a10c3ff7aa81d41b22a2c';
const TAG = `ios-testflight/next/${SHA}`;
const HEAD = 'bc7d81e66386c155f05ad8ddb7ccb6939ef7a4e0';
const RUN_ID = 42157371938;
const WORKFLOW_ID = 365585990;
const WORKFLOW_PATH = '.github/workflows/ios-testflight.yml';
const RUN_URL = `https://github.com/${REPOSITORY}/actions/runs/${RUN_ID}`;
const API_RUN_URL = `https://api.github.com${ROOT}/actions/runs/${RUN_ID}`;
const JOBS = Object.freeze([
  Object.freeze({ id: 127694613500, name: 'authorize' }),
  Object.freeze({ id: 127694679435, name: 'release' }),
]);
const SOURCES = Object.freeze([
  Object.freeze({ path: 'tools/ios-cloud-release.mjs', blob: '7b46d62021bbb31a2a29afb6f7c68d8099c605ab', size: 22200,
    digest: 'cfd5bf77746c3e2540976551927db3a52a0fdb3ec2c8b7743f0e3c0d89208a0d' }),
  Object.freeze({ path: WORKFLOW_PATH, blob: 'd73f9b84d69cbea10f515135805f78cff8605ed4', size: 6321,
    digest: 'e56ec4259b3880c1dc3f3773fa8845057857cc23301e2ea131616abe3600e050' }),
]);
const LOG_SIZE = 20876;
const LOG_DIGEST = 'f43ab95b597481ddb516f3c2ba6a7c862fbb6a62e9936ffec54934f744d7d01d';
const exactRequest = value => value?.repository === REPOSITORY && value.tag === TAG && value.sha === SHA;
const repositoryIdentity = value => value?.id === 1163653093 && value.full_name === REPOSITORY;
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

// Digests are computed only after authenticated reads by the attached adapter.
// Keeping this policy pure permits portable tamper/identity regression tests
// without checking the original full Actions log into this public repository.
export function verifyLegacyReceiptEvidence(value) {
  const { expected, ref, run, workflow, jobs, sources, log } = value || {};
  if (!exactRequest(expected) || ref?.ref !== `refs/tags/${TAG}`
    || ref.object?.type !== 'commit' || ref.object.sha !== SHA) return false;
  if (run?.id !== RUN_ID || run.html_url !== RUN_URL || run.workflow_id !== WORKFLOW_ID
    || run.name !== 'iOS TestFlight' || run.path !== WORKFLOW_PATH || run.event !== 'workflow_run'
    || run.head_branch !== 'main' || run.head_sha !== HEAD || run.run_attempt !== 1
    || run.status !== 'completed' || run.conclusion !== 'success'
    || !repositoryIdentity(run.repository) || !repositoryIdentity(run.head_repository)) return false;
  if (workflow?.id !== WORKFLOW_ID || workflow.path !== WORKFLOW_PATH || workflow.name !== 'iOS TestFlight') return false;
  if (!Array.isArray(jobs) || jobs.length !== JOBS.length || JOBS.some(pin => {
    const matches = jobs.filter(job => job?.id === pin.id);
    const job = matches[0];
    return matches.length !== 1 || job.name !== pin.name || job.run_id !== RUN_ID || job.run_attempt !== 1
      || job.run_url !== API_RUN_URL || job.status !== 'completed' || job.conclusion !== 'success';
  })) return false;
  if (!Array.isArray(sources) || sources.length !== SOURCES.length || SOURCES.some(pin => {
    const matches = sources.filter(source => source?.path === pin.path);
    return matches.length !== 1 || ['blob', 'size', 'digest'].some(key => matches[0][key] !== pin[key]);
  })) return false;
  return log?.size === LOG_SIZE && log.digest === LOG_DIGEST;
}

export function attachLegacyReservationEvidence(gh, { token, exec = execFileSync } = {}) {
  gh.verifyLegacyReservationEvidence = async expected => {
    // No caller-controlled receipt, run, job, source path or digest can extend
    // this one-time migration. Unknown reservations do not even perform I/O.
    if (!exactRequest(expected) || typeof token !== 'string' || !token) return false;
    let config;
    try {
      const ref = await gh.request(`${ROOT}/git/ref/tags/${TAG}`);
      const run = await gh.request(`${ROOT}/actions/runs/${RUN_ID}`);
      const workflow = await gh.request(`${ROOT}/actions/workflows/${WORKFLOW_ID}`);
      const jobs = [];
      for (let page = 1; page <= 100; page++) {
        const batch = (await gh.request(`${ROOT}/actions/runs/${RUN_ID}/jobs?filter=all&per_page=100&page=${page}`))?.jobs;
        if (!Array.isArray(batch) || batch.length > 100) return false;
        jobs.push(...batch);
        if (batch.length < 100) break;
        if (page === 100) return false;
      }
      const sources = [];
      for (const pin of SOURCES) {
        const source = await gh.request(`${ROOT}/contents/${pin.path}?ref=${HEAD}`);
        if (source?.type !== 'file' || source.path !== pin.path || source.sha !== pin.blob
          || source.size !== pin.size || source.encoding !== 'base64' || typeof source.content !== 'string'
          || source.content.length > 64 * 1024) return false;
        const bytes = Buffer.from(source.content, 'base64');
        sources.push({ path: pin.path, blob: source.sha, size: bytes.length, digest: digest(bytes) });
      }
      // Validate provenance before launching the log-fetch child. This is not a
      // log fallback: actual raw authenticated bytes are still required below.
      const base = { expected, ref, run, workflow, jobs, sources };
      if (!verifyLegacyReceiptEvidence({ ...base, log: { size: LOG_SIZE, digest: LOG_DIGEST } })) return false;
      config = mkdtempSync(join(tmpdir(), 'on-paper-legacy-evidence-'));
      const bytes = exec('gh', ['api', '--allow-escape-sequences', `repos/${REPOSITORY}/actions/jobs/127694679435/logs`], {
        encoding: 'buffer', timeout: 60_000, maxBuffer: 1024 * 1024,
        env: { PATH: process.env.PATH, GH_TOKEN: token, GH_HOST: 'github.com', GH_CONFIG_DIR: config, XDG_STATE_HOME: config, XDG_CACHE_HOME: config, GH_PROMPT_DISABLED: '1' },
      });
      if (!Buffer.isBuffer(bytes)) return false;
      // Refuse if the original run was rerun while evidence was being read.
      const finalRun = await gh.request(`${ROOT}/actions/runs/${RUN_ID}`);
      return verifyLegacyReceiptEvidence({ ...base, run: finalRun, log: { size: bytes.length, digest: digest(bytes) } });
    } catch { return false; }
    finally { if (config) rmSync(config, { recursive: true, force: true }); }
  };
  return gh;
}
