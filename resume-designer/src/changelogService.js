/**
 * Changelog data helpers — pure where possible (unit-tested) plus a GitHub
 * Releases fetch. Phase 1 sources history from release bodies; Phase 2 will
 * prefer a structured changelog.json asset (see the changelog plan, Task 10).
 *
 * Kept free of app imports at module load (the post-update entry point below
 * dynamic-imports persistence/native) so the unit tests import cleanly.
 */

const RELEASES_API =
  'https://api.github.com/repos/ashproto/Resume-Designer/releases?per_page=30';

// True only when we have a prior version on record AND it differs from the one
// now running — i.e. an update landed since last launch. First run (no record)
// must NOT trigger a "what's new" panel.
export function justUpdated(seenVersion, currentVersion) {
  return !!seenVersion && !!currentVersion && seenVersion !== currentVersion;
}

function stripV(tag) {
  return String(tag || '').replace(/^v/, '');
}

// A GitHub release payload → our shape. Phase 1: summary === full === body.
export function normalizeRelease(release) {
  const body = release?.body || '';
  return {
    version: stripV(release?.tag_name),
    date: release?.published_at || null,
    summary: body,
    full: body,
  };
}

// Newest-first by semver; each component compared numerically so 1.10 > 1.9.
// Missing components sort as -1 (so a shorter/unparseable version sorts last).
function bySemverDesc(a, b) {
  const pa = a.version.split('.').map(Number);
  const pb = b.version.split('.').map(Number);
  for (let i = 0; i < 3; i += 1) {
    const x = Number.isFinite(pa[i]) ? pa[i] : -1;
    const y = Number.isFinite(pb[i]) ? pb[i] : -1;
    if (x !== y) return y - x;
  }
  return 0;
}

// Merge bundled (offline base) with fetched (newer/live); fetched wins on
// conflict; dedupe by version; newest-first.
export function mergeReleases(bundled = [], fetched = []) {
  const byVersion = new Map();
  for (const r of bundled) byVersion.set(r.version, r);
  for (const r of fetched) byVersion.set(r.version, r); // fetched overrides
  return [...byVersion.values()].sort(bySemverDesc);
}

// Fetch recent releases from the public repo. Returns [] on any failure so the
// history view degrades to bundled-only rather than erroring.
export async function fetchReleaseHistory() {
  try {
    const res = await fetch(RELEASES_API, {
      headers: { Accept: 'application/vnd.github+json' },
    });
    if (!res.ok) return [];
    const list = await res.json();
    return Array.isArray(list) ? list.filter((r) => !r.draft).map(normalizeRelease) : [];
  } catch {
    return [];
  }
}

// Notes for one specific version (the after-update "what's new" source).
export async function fetchNotesForVersion(version) {
  const all = await fetchReleaseHistory();
  return all.find((r) => r.version === version) || null;
}

const SEEN_KEY = 'changelogLastSeenVersion';

// On launch: if the running version differs from the last one we recorded, an
// update landed — show its notes once, then record the new version. First run
// records silently (justUpdated() is false without a prior record). App modules
// are dynamic-imported so this file's unit tests import without pulling native /
// persistence at module load.
export async function maybeShowPostUpdateChangelog() {
  const { isTauri, getAppInfo } = await import('./native.js');
  if (!isTauri) return;
  const { getSettings, saveSettings } = await import('./persistence.js');
  const current = await getAppInfo().then((i) => i.version).catch(() => null);
  if (!current) return;
  const seen = getSettings()[SEEN_KEY];
  if (justUpdated(seen, current)) {
    const rel = await fetchNotesForVersion(current);
    if (rel) {
      const { showUpdateNotes } = await import('./components/ui/updateNotes.jsx');
      await showUpdateNotes({ version: current, notes: rel.summary, full: rel.full, mode: 'whatsnew' });
    }
  }
  saveSettings({ [SEEN_KEY]: current });
}
