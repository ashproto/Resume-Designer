#!/usr/bin/env node
// Runs from trusted main, before the environment containing Apple credentials.
// No package install, PR checkout, artifact download, or candidate code execution.
import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const REPOSITORY = 'ashproto/Resume-Designer';
const WORKFLOW_PATH = '.github/workflows/ci.yml';
const REQUIRED_JOBS = ['checks', 'rust-check', 'ios-native'];
const SHA = /^[a-f0-9]{40}$/;

function requireCondition(condition, message) {
  if (!condition) throw new Error(message);
}

export function candidateFromEvent(eventName, event, ref) {
  requireCondition(event.repository?.full_name === REPOSITORY, 'Only the upstream repository may release.');
  requireCondition(ref === 'refs/heads/main', 'The dispatcher must run trusted main workflow code.');
  if (eventName === 'workflow_run') {
    requireCondition(Number.isSafeInteger(event.workflow_run?.id), 'Missing CI run id.');
    return { runId: event.workflow_run.id };
  }
  requireCondition(eventName === 'workflow_dispatch', 'Unsupported release event.');
  const branch = event.inputs?.target;
  requireCondition(['main', 'next'].includes(branch), 'Manual target must be main or next.');
  return { branch };
}

export function validateRun(run, workflowId) {
  requireCondition(run.workflow_id === workflowId && run.path === WORKFLOW_PATH, 'Unexpected CI workflow identity.');
  requireCondition(run.event === 'push' && run.status === 'completed' && run.conclusion === 'success',
    'Release requires successful push CI, never pull-request CI.');
  requireCondition(run.head_repository?.full_name === REPOSITORY, 'CI source must be the upstream repository.');
  requireCondition(['main', 'next'].includes(run.head_branch), 'CI source must be main or next.');
  requireCondition(SHA.test(run.head_sha), 'CI must identify a full commit SHA.');
  return { branch: run.head_branch, sha: run.head_sha, runId: run.id };
}

async function collection(get, route, key) {
  const results = [];
  for (let page = 1; page <= 100; page++) {
    const response = await get(`${route}${route.includes('?') ? '&' : '?'}per_page=100&page=${page}`);
    const items = key ? response[key] : response;
    requireCondition(Array.isArray(items), 'Malformed GitHub collection.');
    results.push(...items);
    if (items.length < 100) return results;
  }
  throw new Error('GitHub collection exceeded pagination limit.');
}

async function protectedBranch(get, branch) {
  const result = await get(`/repos/${REPOSITORY}/branches/${branch}`);
  // This flag includes repository rulesets; the classic protection endpoint
  // alone incorrectly reports ruleset-protected branches as unprotected.
  requireCondition(result.protected === true && SHA.test(result.commit?.sha), `Branch ${branch} must be protected.`);
  return result.commit.sha;
}

async function shouldSkip(get, branch, sha, sleep) {
  const commit = await get(`/repos/${REPOSITORY}/commits/${sha}`);
  const subject = commit.commit?.message?.split('\n')[0] || '';
  const number = /^Merge pull request #(\d+)\b/.exec(subject)?.[1]
    || /\(#(\d+)\)$/.exec(subject)?.[1];
  const matches = pr => pr.merged_at && pr.merge_commit_sha === sha &&
    pr.base?.ref === branch && pr.base?.repo?.full_name === REPOSITORY;
  let prs;
  if (number) {
    // The commit endpoint's PR association can lag a merge. Resolve the merge
    // number directly and verify it belongs to this exact commit and branch.
    const pr = await get(`/repos/${REPOSITORY}/pulls/${number}`);
    requireCondition(matches(pr), 'Merge PR metadata does not match the release commit. Retry after GitHub updates it.');
    prs = [pr];
  } else {
    // Rebase merges have no reliable PR number in the commit subject. These
    // branches require PRs, so missing metadata is not permission to ignore a
    // skip-build label. Wait for association, then refuse if still unresolved.
    for (let attempt = 0; attempt < 6; attempt++) {
      prs = (await collection(get, `/repos/${REPOSITORY}/commits/${sha}/pulls`)).filter(matches);
      if (prs.length) break;
      if (attempt < 5) await sleep(10_000);
    }
    requireCondition(prs.length > 0, 'Merged PR metadata is unavailable; automatic release not authorized. Retry after GitHub updates it.');
  }
  return prs.some(pr => pr.labels?.some(label => label.name === 'skip-build'));
}

export async function authorizeRelease({ eventName, event, ref, get, sleep = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  const candidate = candidateFromEvent(eventName, event, ref);
  const repo = await get(`/repos/${REPOSITORY}`);
  requireCondition(repo.default_branch === 'main', 'Expected main to be the trusted default branch.');
  const workflow = await get(`/repos/${REPOSITORY}/actions/workflows/ci.yml`);
  requireCondition(workflow.path === WORKFLOW_PATH, 'Unexpected CI workflow path.');
  let run;
  if (candidate.runId) {
    run = await get(`/repos/${REPOSITORY}/actions/runs/${candidate.runId}`);
  } else {
    const head = await protectedBranch(get, candidate.branch);
    const runs = await collection(get,
      `/repos/${REPOSITORY}/actions/workflows/ci.yml/runs?branch=${candidate.branch}&event=push&head_sha=${head}&status=success`, 'workflow_runs');
    run = runs.find(item => item.head_sha === head && item.head_branch === candidate.branch);
    requireCondition(run, 'The current branch head needs successful push CI before a manual pilot.');
    run = await get(`/repos/${REPOSITORY}/actions/runs/${run.id}`);
    requireCondition(run.head_sha === head && run.head_branch === candidate.branch, 'CI changed while resolving the manual target.');
  }
  const result = validateRun(run, workflow.id);
  const currentHead = await protectedBranch(get, result.branch);
  const comparison = await get(`/repos/${REPOSITORY}/compare/${result.sha}...${currentHead}`);
  requireCondition(['identical', 'ahead'].includes(comparison.status), 'CI commit is no longer on the protected branch.');
  const jobs = await collection(get, `/repos/${REPOSITORY}/actions/runs/${result.runId}/jobs?filter=latest`, 'jobs');
  for (const name of REQUIRED_JOBS) {
    const matching = jobs.filter(job => job.name === name);
    requireCondition(matching.length === 1 && matching[0].status === 'completed' && matching[0].conclusion === 'success',
      `Required CI job ${name} did not pass.`);
  }
  // CI may finish out of source order. An older successful run must not
  // dispatch after a newer branch revision has already reached TestFlight.
  // The controller checks again under the branch release lock before POST.
  if (eventName === 'workflow_run' && currentHead !== result.sha) {
    return { ...result, skip: true, skipReason: 'superseded' };
  }
  // Manual builds are an intentional override of the desktop-compatible label,
  // but never override the successful CI / protected-branch requirements.
  const skip = eventName === 'workflow_run' && await shouldSkip(get, result.branch, result.sha, sleep);
  return { ...result, skip };
}

export function githubGet(token) {
  requireCondition(token, 'GITHUB_TOKEN is required.');
  return async route => {
    requireCondition(route.startsWith(`/repos/${REPOSITORY}`) && !route.includes('://'), 'Unexpected GitHub API route.');
    const response = await fetch(`https://api.github.com${route}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28' },
      redirect: 'error', signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`GitHub GET failed (${response.status}); release not authorized.`);
    return response.json();
  };
}

async function main() {
  const result = await authorizeRelease({ eventName: process.env.GITHUB_EVENT_NAME,
    event: JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')), ref: process.env.GITHUB_REF,
    get: githubGet(process.env.GITHUB_TOKEN) });
  const output = `branch=${result.branch}\nsha=${result.sha}\nci_run_id=${result.runId}\nskip=${result.skip}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, output);
  console.log(`${result.skip ? `Skipped (${result.skipReason || 'skip-build'})` : 'Authorized'}: ${result.branch} ${result.sha} (CI ${result.runId})`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
