// Six reviewed pre-journal deliveries, not a general legacy override. Their
// original trusted controllers verified exact source/tag/workflow and uploaded
// app/build/group identity before printing testflight_available. Live App Store
// build validation remains the caller's responsibility; no start is authorized.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const REPOSITORY = 'ashproto/Resume-Designer';
const ROOT = `/repos/${REPOSITORY}`;
const WORKFLOW_ID = 365585990;
const WORKFLOW_PATH = '.github/workflows/ios-testflight.yml';
const APP_ID = '6815088694';
const CLOUD_WORKFLOW_ID = 'F77BFDD6-479B-44D2-B772-FFDB25F9D40D';
const SOURCES_V1 = Object.freeze([
  Object.freeze({ path: 'tools/ios-cloud-release.mjs', blob: '0b6c255819eef0002e25b5bb355dc983cbfae157', size: 21005,
    digest: '9e3a1efcd616312b969d91df87e0ef066983f4d505ad861420885c40e2655f88' }),
  Object.freeze({ path: WORKFLOW_PATH, blob: '432472babfddd9f37dfce0a0ce3a2908643d0727', size: 6162,
    digest: 'd305ada619a575b8ffa3534fed420ce31be57c0ec6502f6540f49f7705aadde5' }),
]);
const SOURCES_V2 = Object.freeze([
  Object.freeze({ path: 'tools/ios-cloud-release.mjs', blob: '7b46d62021bbb31a2a29afb6f7c68d8099c605ab', size: 22200,
    digest: 'cfd5bf77746c3e2540976551927db3a52a0fdb3ec2c8b7743f0e3c0d89208a0d' }),
  Object.freeze({ path: WORKFLOW_PATH, blob: 'd73f9b84d69cbea10f515135805f78cff8605ed4', size: 6321,
    digest: 'e56ec4259b3880c1dc3f3773fa8845057857cc23301e2ea131616abe3600e050' }),
]);
const RECEIPTS = Object.freeze([
  Object.freeze({ sha: '1c0ba3cb8e760993bd8c8da111ade912ad93bd23', head: '2059a3bf3be5d081975f21a502374edc765d59b5',
    branch: 'next', event: 'workflow_dispatch', sources: SOURCES_V1, runId: 37385750802, authorizeId: 112018484243, releaseId: 112018566461,
    created: '2026-10-05T22:58:16Z', updated: '2026-10-05T23:05:33Z',
    logSize: 20983, logDigest: '5ee070b64d1190e57b31feb5659a30656a064070775d22e8527e0367fcd160ae',
    cloudRunId: 'f55858db-6a38-48e1-98cc-fd6239dfcba4', buildId: 'dc0f758b-0555-48c0-bc69-cd75791e5b74', buildNumber: 2 }),
  Object.freeze({ sha: 'a955735f2c838ffe562a396947f5453c9c3f3bb0', head: 'e64dc7fde7bc160c2e39dd8652b56331ade26e8c',
    branch: 'next', event: 'workflow_dispatch', sources: SOURCES_V1, runId: 35931900952, authorizeId: 107420152203, releaseId: 107420196564,
    created: '2026-09-23T23:06:33Z', updated: '2026-09-23T23:16:21Z',
    logSize: 20983, logDigest: 'd2d4ba26ecf5847464569ac299bdd31340a7bd0a32cb0e03cdb06c9bfff38f8d',
    cloudRunId: '7e46f78f-d674-407d-bf41-af0df864715c', buildId: 'a8b8af70-b487-4f09-8b29-b78fa4391d11', buildNumber: 1 }),
  Object.freeze({ sha: '7d8cf012f0868c82ba0ae9667c214d5946582655', head: '2059a3bf3be5d081975f21a502374edc765d59b5',
    branch: 'next', event: 'workflow_dispatch', sources: SOURCES_V1, runId: 42119769773, authorizeId: 127568769430, releaseId: 127568860737,
    created: '2026-11-05T22:14:23Z', updated: '2026-11-05T22:23:03Z', logSize: 21054,
    logDigest: '12f8c97037de48e5b638fcaf383815482e03d5112853432d78d4d9c07e74280b',
    cloudRunId: 'a1705f01-fd92-462b-b8cd-55d67544cf13', buildId: 'f988ddbd-464f-4f22-a9e9-73523300e425', buildNumber: 3 }),
  Object.freeze({ sha: '2440b8910616134b00e0cc40a37c6a76f04e5e06', head: 'bc7d81e66386c155f05ad8ddb7ccb6939ef7a4e0',
    branch: 'next', event: 'workflow_run', sources: SOURCES_V2, runId: 42132963754, authorizeId: 127613917372, releaseId: 127614009106,
    created: '2026-11-05T23:55:02Z', updated: '2026-11-06T00:14:41Z', logSize: 21205,
    logDigest: 'b1922fb77cf106d296d9bedcb603b947c9a24112f4d3ea27db0afad1e266fdd6',
    cloudRunId: '7acf706c-a2e0-48df-b187-b63e31da1306', buildId: '02cdf79b-a228-4824-b7b9-0fee96ed1d84', buildNumber: 4 }),
  Object.freeze({ sha: '1909eee5e72aa78b40dcf48068d01710464c31bc', head: 'bc7d81e66386c155f05ad8ddb7ccb6939ef7a4e0',
    branch: 'next', event: 'workflow_run', sources: SOURCES_V2, runId: 42158719963, authorizeId: 127698976497, releaseId: 127699043547,
    created: '2026-11-06T03:48:17Z', updated: '2026-11-06T04:00:22Z', logSize: 21213,
    logDigest: 'a5887e098acc7463b963f9622b5dead537a5f0ac2bfa05b491228b47ccc0422a',
    cloudRunId: 'abd53d24-f8fe-4304-9061-6ed9f5a896e2', buildId: '509023a3-da0a-44e9-a189-0ccb2f58305b', buildNumber: 5 }),
  Object.freeze({ sha: 'dd1ca63c1a3992ec50a8846c509b1551fa450415', head: 'dd1ca63c1a3992ec50a8846c509b1551fa450415',
    branch: 'main', event: 'workflow_run', sources: SOURCES_V2, runId: 42160990194, authorizeId: 127706336454, releaseId: 127706397107,
    created: '2026-11-06T04:11:14Z', updated: '2026-11-06T04:23:00Z', logSize: 21194,
    logDigest: 'd36700fdec6ad1d10b2c8a015adfb39782e108be858a0af36a164139c8ed483c',
    cloudRunId: '2f6f5ef4-1a1c-40f1-b048-f07c0af64eea', buildId: '49d33278-eef7-4a04-a62e-84e8ed58af87', buildNumber: 6 }),
]);
const tagFor = pin => `ios-testflight/${pin.branch}/${pin.sha}`;
const findPin = expected => expected?.repository === REPOSITORY
  ? RECEIPTS.find(pin => expected.sha === pin.sha && expected.tag === tagFor(pin)) : undefined;
const ownerIdentity = value => value?.id === 35086581 && value.login === 'ashproto' && value.type === 'User';
const repositoryIdentity = value => value?.id === 1163653093 && value.full_name === REPOSITORY && ownerIdentity(value.owner);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');

function provenanceMatches({ ref, run, workflow, jobs, sources }, pin) {
  if (ref?.ref !== `refs/tags/${tagFor(pin)}` || ref.object?.type !== 'commit' || ref.object.sha !== pin.sha) return false;
  if (run?.id !== pin.runId || run.html_url !== `https://github.com/${REPOSITORY}/actions/runs/${pin.runId}`
    || run.workflow_id !== WORKFLOW_ID || run.name !== 'iOS TestFlight' || run.path !== WORKFLOW_PATH
    || run.event !== pin.event || run.head_branch !== 'main' || run.head_sha !== pin.head
    || run.run_attempt !== 1 || run.status !== 'completed' || run.conclusion !== 'success'
    || run.created_at !== pin.created || run.updated_at !== pin.updated
    || !repositoryIdentity(run.repository) || !repositoryIdentity(run.head_repository)
    || !ownerIdentity(run.actor) || !ownerIdentity(run.triggering_actor)) return false;
  if (workflow?.id !== WORKFLOW_ID || workflow.path !== WORKFLOW_PATH || workflow.name !== 'iOS TestFlight') return false;
  const expectedJobs = [{ id: pin.authorizeId, name: 'authorize' }, { id: pin.releaseId, name: 'release' }];
  if (!Array.isArray(jobs) || jobs.length !== expectedJobs.length || expectedJobs.some(expected => {
    const matches = jobs.filter(job => job?.id === expected.id), job = matches[0];
    return matches.length !== 1 || job.name !== expected.name || job.run_id !== pin.runId || job.run_attempt !== 1
      || job.head_sha !== pin.head || job.run_url !== `https://api.github.com${ROOT}/actions/runs/${pin.runId}`
      || job.status !== 'completed' || job.conclusion !== 'success';
  })) return false;
  return Array.isArray(sources) && sources.length === pin.sources.length && pin.sources.every(expected => {
    const matches = sources.filter(source => source?.path === expected.path), source = matches[0];
    return matches.length === 1 && ['blob', 'size', 'digest'].every(key => source[key] === expected[key]);
  });
}

function fixedReceipt(pin) {
  return Object.freeze({ repository: REPOSITORY, tag: tagFor(pin), sha: pin.sha, appId: APP_ID,
    workflowId: CLOUD_WORKFLOW_ID, cloudRunId: pin.cloudRunId, buildId: pin.buildId, buildNumber: pin.buildNumber });
}

// Only the adapter computes source and log digests, after authenticated reads.
// This pure policy is exported for portable tamper tests, without publishing
// full historical job logs or trusting caller-supplied delivery/build claims.
export function verifyLegacyDeliveredReceiptEvidence(value) {
  const pin = findPin(value?.expected);
  if (!pin || !provenanceMatches(value, pin) || value.log?.size !== pin.logSize || value.log.digest !== pin.logDigest) return undefined;
  return fixedReceipt(pin);
}

export function attachLegacyDeliveredEvidence(gh, { token, exec = execFileSync } = {}) {
  gh.verifyLegacyDeliveredEvidence = async expected => {
    const pin = findPin(expected);
    if (!pin || typeof token !== 'string' || !token) return undefined;
    let config, result;
    try {
      const ref = await gh.request(`${ROOT}/git/ref/tags/${tagFor(pin)}`);
      const run = await gh.request(`${ROOT}/actions/runs/${pin.runId}`);
      const workflow = await gh.request(`${ROOT}/actions/workflows/${WORKFLOW_ID}`);
      const jobs = [];
      for (let page = 1; page <= 100; page++) {
        const batch = (await gh.request(`${ROOT}/actions/runs/${pin.runId}/jobs?filter=all&per_page=100&page=${page}`))?.jobs;
        if (!Array.isArray(batch) || batch.length > 100) return undefined;
        jobs.push(...batch);
        if (batch.length < 100) break;
        if (page === 100) return undefined;
      }
      const sources = [];
      for (const sourcePin of pin.sources) {
        const source = await gh.request(`${ROOT}/contents/${sourcePin.path}?ref=${pin.head}`);
        if (source?.type !== 'file' || source.path !== sourcePin.path || source.sha !== sourcePin.blob
          || source.size !== sourcePin.size || source.encoding !== 'base64' || typeof source.content !== 'string'
          || source.content.length > 64 * 1024) return undefined;
        const bytes = Buffer.from(source.content, 'base64');
        sources.push({ path: source.path, blob: source.sha, size: bytes.length, digest: digest(bytes) });
      }
      const base = { expected, ref, run, workflow, jobs, sources };
      if (!provenanceMatches(base, pin)) return undefined;
      config = mkdtempSync(join(tmpdir(), 'on-paper-legacy-delivered-'));
      const bytes = exec('gh', ['api', '--allow-escape-sequences', `repos/${REPOSITORY}/actions/jobs/${pin.releaseId}/logs`], {
        encoding: 'buffer', timeout: 60_000, maxBuffer: 1024 * 1024,
        env: { PATH: process.env.PATH, GH_TOKEN: token, GH_HOST: 'github.com', GH_CONFIG_DIR: config,
          XDG_STATE_HOME: config, XDG_CACHE_HOME: config, GH_PROMPT_DISABLED: '1' },
      });
      if (Buffer.isBuffer(bytes)) {
        // A later attempt or identity change while reading evidence invalidates
        // this receipt even if the original job's log remains downloadable.
        const finalRun = await gh.request(`${ROOT}/actions/runs/${pin.runId}`);
        result = verifyLegacyDeliveredReceiptEvidence({ ...base, run: finalRun, log: { size: bytes.length, digest: digest(bytes) } });
      }
    } catch { result = undefined; }
    finally {
      if (config) {
        try { rmSync(config, { recursive: true, force: true }); }
        catch { result = undefined; }
      }
    }
    return result;
  };
  return gh;
}
