#!/usr/bin/env node
/**
 * One-shot migrator: Electron-era Chromium localStorage → JSON backup.
 *
 * Why: the Tauri rewrite uses a WKWebView/WebView2 store at a different
 * on-disk location than the old Electron build's Chromium store. Same
 * `localStorage.getItem(...)` JS calls, different physical backend, so
 * the data is "stranded" until we bridge it. This script reads the old
 * Electron LevelDB directly and emits a JSON file the Tauri app can
 * import via Settings → Import Backup.
 *
 * Usage:
 *   node scripts/migrate-from-electron.mjs            # writes resume-designer-backup.json
 *   node scripts/migrate-from-electron.mjs --dry-run  # just lists what would be exported
 *   node scripts/migrate-from-electron.mjs --in <path-to-leveldb-dir>
 *   node scripts/migrate-from-electron.mjs --out <path-to-json>
 *
 * Default search paths (per platform) follow the Electron-built app's
 * userData directory convention:
 *   macOS   ~/Library/Application Support/{resume-designer,Resume Designer}/Local Storage/leveldb
 *   Windows %APPDATA%\{resume-designer,Resume Designer}\Local Storage\leveldb
 *   Linux   ~/.config/{resume-designer,Resume Designer}/Local Storage/leveldb
 *
 * Safety: we never open the original LevelDB directly. classic-level
 * opens DBs read-write and could write recovery / log records into the
 * source files. We copy the dir to a tempdir first, open the copy, and
 * delete the tempdir on exit.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ClassicLevel } from 'classic-level';

// ---------- args ----------
const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const valOf = (name) => {
  const i = args.indexOf(name);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
};

const dryRun = flag('--dry-run');
const inputOverride = valOf('--in');
const outputPath = valOf('--out') ||
  path.join(process.cwd(), 'resume-designer-backup.json');

// ---------- locate Electron data ----------
function defaultSearchPaths() {
  const home = os.homedir();
  switch (process.platform) {
    case 'darwin':
      return [
        path.join(home, 'Library/Application Support/resume-designer/Local Storage/leveldb'),
        path.join(home, 'Library/Application Support/Resume Designer/Local Storage/leveldb'),
      ];
    case 'win32': {
      const appData = process.env.APPDATA || path.join(home, 'AppData', 'Roaming');
      return [
        path.join(appData, 'resume-designer', 'Local Storage', 'leveldb'),
        path.join(appData, 'Resume Designer', 'Local Storage', 'leveldb'),
      ];
    }
    default:
      return [
        path.join(home, '.config/resume-designer/Local Storage/leveldb'),
        path.join(home, '.config/Resume Designer/Local Storage/leveldb'),
      ];
  }
}

function findLevelDb() {
  if (inputOverride) {
    if (!fs.existsSync(inputOverride)) {
      throw new Error(`--in path does not exist: ${inputOverride}`);
    }
    return inputOverride;
  }
  for (const candidate of defaultSearchPaths()) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  throw new Error(
    'Could not find Electron Local Storage directory. Tried:\n  ' +
    defaultSearchPaths().join('\n  ') +
    '\n\nPass --in <path> to point at the leveldb directory explicitly.'
  );
}

// ---------- Chromium localStorage decoding ----------
//
// Key format for per-origin entries (Chromium "session storage 2.0" format):
//   _<origin>\x00\x01<storage_key>
//
// Other keys (VERSION, META:<origin>, ACCESSRP, etc.) are bookkeeping and
// we skip them.
//
// Value format:
//   [byte 0]    encoding tag — 0x00 = UTF-16LE, 0x01 = Latin1 / ISO-8859-1
//   [byte 1..]  the string bytes in that encoding
//
// Chromium picks whichever encoding is smaller per-value, so JSON-heavy
// values often land in Latin1 (1 byte per ASCII char) and non-Latin
// content lands in UTF-16LE.

const ORIGIN = 'file://';
const PREFIX = Buffer.concat([
  Buffer.from('_'),
  Buffer.from(ORIGIN),
  Buffer.from([0x00, 0x01]),
]);

function decodeValue(buf) {
  if (!buf || buf.length === 0) return '';
  const tag = buf[0];
  const body = buf.subarray(1);
  if (tag === 0x00) return body.toString('utf16le');
  if (tag === 0x01) return body.toString('latin1');
  // Unknown tag: bail with hex preview so we can investigate.
  throw new Error(
    `Unknown Chromium value encoding tag 0x${tag.toString(16)}; ` +
    `first 16 bytes: ${buf.subarray(0, 16).toString('hex')}`
  );
}

// Only export the keys this app actually uses. Listed explicitly (rather
// than just `resume*`) so we can't accidentally export some unrelated
// app's data that happened to share the leveldb (shouldn't happen for
// Electron's per-app userData, but defense in depth).
//
// Note: `resume-header-style` deliberately has no `-settings` suffix
// (asymmetric with the other settings keys) — that's how the app stores
// it. Pattern below uses an explicit alternation rather than a heuristic
// so we don't accidentally include or exclude new keys silently.
const APP_KEYS = new Set([
  // Core data
  'resume-designer-data',
  'resume-designer-job-descriptions',
  'resume-designer-chat-threads',
  'resume-designer-chat-history',          // legacy, kept for older backups
  'resume-designer-token-usage',
  // UI / personalization
  'resume-designer-theme',
  'resume-designer-onboarding-complete',
  'resume-edit-hint-dismissed',
  'resume-header-style',
  'resume-accent-settings',
  'resume-font-settings',
  'resume-spacing-settings',
  'resume-photo-settings',
  'resume-zoom',
]);
// History keys carry a per-variant id suffix.
const HISTORY_PREFIX = 'resume-designer-history-';

function isAppKey(k) {
  return APP_KEYS.has(k) || k.startsWith(HISTORY_PREFIX);
}

// ---------- main ----------
async function main() {
  const sourceDb = findLevelDb();
  console.log(`[migrate] Source LevelDB: ${sourceDb}`);

  // Copy to a tempdir so classic-level can't touch the originals.
  const stagingRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'rd-migration-'));
  const stagingDb = path.join(stagingRoot, 'leveldb');
  fs.cpSync(sourceDb, stagingDb, { recursive: true });
  // classic-level dislikes a leftover LOCK from a previously crashed
  // Electron run — remove it so we can open cleanly.
  const lockFile = path.join(stagingDb, 'LOCK');
  if (fs.existsSync(lockFile)) fs.unlinkSync(lockFile);
  console.log(`[migrate] Staging copy: ${stagingDb}`);

  const db = new ClassicLevel(stagingDb, {
    keyEncoding: 'buffer',
    valueEncoding: 'buffer',
  });

  const exported = {};
  let totalScanned = 0;
  let matchedOrigin = 0;
  let appKeys = 0;
  const skipped = [];

  try {
    await db.open();
    for await (const [keyBuf, valBuf] of db.iterator()) {
      totalScanned++;
      if (!keyBuf.subarray(0, PREFIX.length).equals(PREFIX)) continue;
      matchedOrigin++;

      const storageKey = keyBuf.subarray(PREFIX.length).toString('utf8');
      if (!isAppKey(storageKey)) {
        skipped.push(storageKey);
        continue;
      }
      try {
        exported[storageKey] = decodeValue(valBuf);
        appKeys++;
      } catch (e) {
        console.warn(`[migrate] decode failed for "${storageKey}": ${e.message}`);
      }
    }
  } finally {
    await db.close().catch(() => {});
    fs.rmSync(stagingRoot, { recursive: true, force: true });
  }

  console.log(`[migrate] Scanned ${totalScanned} LevelDB entries`);
  console.log(`[migrate] Matched origin (${ORIGIN}): ${matchedOrigin}`);
  console.log(`[migrate] App keys captured: ${appKeys}`);
  if (skipped.length > 0) {
    console.log(`[migrate] Skipped non-app keys (${skipped.length}):`);
    for (const k of skipped) console.log(`    - ${k}`);
  }
  console.log();

  if (appKeys === 0) {
    throw new Error(
      'Found no app keys in the LevelDB. Was the directory empty? ' +
      `Expected keys like resume-designer-data, ${HISTORY_PREFIX}*, etc.`
    );
  }

  // Build the backup envelope. We use a versioned shape so future Tauri
  // imports can detect/upgrade older backups.
  const backup = {
    backupFormat: 1,
    createdAt: new Date().toISOString(),
    source: `electron-leveldb (${sourceDb})`,
    keys: exported,
  };

  console.log('Keys to export:');
  for (const k of Object.keys(exported).sort()) {
    const size = exported[k].length;
    console.log(`  - ${k}  (${size.toLocaleString()} chars)`);
  }
  console.log();

  if (dryRun) {
    console.log('[migrate] --dry-run set; not writing output file.');
    return;
  }

  fs.writeFileSync(outputPath, JSON.stringify(backup, null, 2), 'utf8');
  console.log(`[migrate] Wrote backup to: ${outputPath}`);
  console.log(
    `[migrate] Import in the Tauri app via Settings → Import Backup.`
  );
}

main().catch((err) => {
  console.error('[migrate] Failed:', err.message);
  if (err.stack) console.error(err.stack.split('\n').slice(1).join('\n'));
  process.exit(1);
});
