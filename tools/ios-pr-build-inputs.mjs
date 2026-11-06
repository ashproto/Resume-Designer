import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const fullSha = /^[0-9a-f]{40}$/;
const validModes = new Map([
  ['040000', 'tree'], ['100644', 'blob'], ['100755', 'blob'],
  ['120000', 'blob'], ['160000', 'commit'],
]);

const configNames = new Set([
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json',
  'yarn.lock', 'pnpm-lock.yaml', 'pnpm-workspace.yaml', 'bun.lock', 'bun.lockb',
  '.npmrc', '.yarnrc', '.yarnrc.yml', '.pnp.cjs', '.pnp.loader.mjs',
  '.pnp.data.json', '.pnpmfile.cjs', 'pnpmfile.cjs', 'yarn.config.cjs', 'bunfig.toml',
  '.browserslistrc', 'browserslist',
  'lerna.json', 'rush.json', 'nx.json', 'turbo.json',
  '.nvmrc', '.node-version', '.tool-versions', 'mise.toml', '.mise.toml',
  'cargo.toml', 'cargo.lock', 'build.rs', 'rust-toolchain', 'rust-toolchain.toml',
  'package.swift', 'package.resolved', 'podfile', 'podfile.lock', 'cartfile', 'cartfile.resolved',
  'gemfile', 'gemfile.lock', 'cmakelists.txt', 'makefile', 'gnumakefile',
  '.gitmodules', '.gitattributes', '.gitconfig', '.gitignore',
]);
const protectedDirectories = new Set([
  '.github', 'scripts', '.cargo', '.swiftpm', '.husky', '.config',
]);
// None of these may be supplied by a candidate checkout, even if trusted main
// accidentally contains them. Bootstrap must install tools/dependencies and
// generate output from scratch, rather than finding a candidate's executables.
const bootstrapDirectories = new Set([
  'node_modules', 'dist', 'target', 'build', 'deriveddata', '.build',
  '.bin', '.tools', '.rustup', '.yarn', '.pnpm-store', '.npm', '.cache', '.vite',
]);

function reject(reason, path) {
  // Quote paths: Git names can contain newlines or terminal control characters.
  throw new Error(`Unsafe preview build input: ${reason}${path === undefined ? '' : ` ${JSON.stringify(path)}`}`);
}

function indexEntries(entries) {
  if (!Array.isArray(entries)) reject('expected a complete Git tree');
  const indexed = new Map();
  const filesystemNames = new Set();
  for (const value of entries) {
    if (!value || typeof value.path !== 'string' || !value.path ||
        value.path.includes('\0') || value.path.includes('\\') ||
        value.path.split('/').some(part => !part || part === '.' || part === '..') ||
        typeof value.object !== 'string' || !fullSha.test(value.object) ||
        !validModes.has(value.mode) || validModes.get(value.mode) !== value.type) {
      reject('invalid Git tree entry');
    }
    const filesystemName = value.path.normalize('NFC').toLowerCase();
    if (filesystemNames.has(filesystemName)) reject('ambiguous Git paths', value.path);
    filesystemNames.add(filesystemName);
    indexed.set(value.path, value);
  }
  return indexed;
}

function isBootstrapPath(path) {
  const parts = path.toLowerCase().split('/');
  return parts.some(part => bootstrapDirectories.has(part) || part === '.git') ||
    /(?:^|\/)\.cargo\/(?:bin|registry|git)(?:\/|$)/.test(path.toLowerCase()) ||
    /(?:^|\/)src-tauri\/tools(?:\/|$)/.test(path.toLowerCase()) ||
    /^resume-designer\/src-tauri\/gen\/apple\/(?:externals|assets)(?:\/|$)/.test(path.toLowerCase());
}

function isProtectedPath(path) {
  const lower = path.toLowerCase();
  const parts = lower.split('/');
  const name = parts.at(-1);
  return parts.some(part => protectedDirectories.has(part) || /\.(?:xcodeproj|xcworkspace)$/.test(part)) ||
    /^tools\/ios-[^/]+\.mjs$/.test(lower) ||
    /^resume-designer\/src-tauri\/gen\/apple(?:\/|$)/.test(lower) ||
    /(?:^|\/)src-tauri\/(?:capabilities|permissions)(?:\/|$)/.test(lower) ||
    configNames.has(name) ||
    /^(?:vite|vitest|postcss|tailwind|babel|webpack|rollup|esbuild|swc|rspack|parcel|eslint|commitlint)\.config(?:\..+)?$/.test(name) ||
    /^\.(?:postcssrc|babelrc|swcrc|parcelrc)(?:\..+)?$/.test(name) ||
    /^(?:tsconfig|jsconfig)(?:\..+)?\.json$/.test(name) ||
    /^(?:tauri(?:\.[^.]+)?\.conf\.json5?|tauri(?:\.[^.]+)?\.toml)$/.test(name) ||
    /^(?:\.env|\.xcode\.env)(?:\..+)?$/.test(name) ||
    /\.(?:plist|entitlements|xcconfig|xcscheme|xcsettings|pbxproj|modulemap|cmake)$/.test(name);
}

/**
 * This is defense in depth, not a sandbox. The owner must trust the exact
 * candidate SHA: source compilation can execute candidate code, and even CSS
 * can load build-time JavaScript through Tailwind plugins/config directives.
 * Compare raw Git data only; never import candidate files or install packages.
 */
export function compareBuildInputs(candidateEntries, trustedEntries) {
  const candidate = indexEntries(candidateEntries);
  const trusted = indexEntries(trustedEntries);
  for (const path of new Set([...candidate.keys(), ...trusted.keys()])) {
    const after = candidate.get(path);
    const before = trusted.get(path);
    if (after && isBootstrapPath(path)) reject('prepopulated dependency/tool/output path', path);
    if (isProtectedPath(path) && (!before || !after ||
        before.mode !== after.mode || before.type !== after.type || before.object !== after.object)) {
      reject('protected path differs from trusted main', path);
    }
    if (after && before && (before.mode !== after.mode || before.type !== after.type)) {
      reject('entry mode or object type changed', path);
    }
    if (after && !before && !['100644', '040000'].includes(after.mode)) {
      reject('new executable, symlink or submodule', path);
    }
    if (after && before && ['120000', '160000'].includes(after.mode) && before.object !== after.object) {
      reject('symlink or submodule changed', path);
    }
  }
}

function parseTree(buffer) {
  // -z avoids Git quoting/escaping names. Fatal UTF-8 decoding avoids collapsing
  // distinct non-UTF-8 names into the same JS replacement-character path.
  let output;
  try { output = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
  catch { reject('Git tree contains a non-UTF-8 path'); }
  if (output && !output.endsWith('\0')) reject('incomplete Git tree output');
  return output ? output.slice(0, -1).split('\0').map(record => {
    const match = /^(\d{6}) (blob|tree|commit) ([0-9a-f]{40})\t([\s\S]+)$/.exec(record);
    if (!match) reject('invalid Git tree output');
    return { mode: match[1], type: match[2], object: match[3], path: match[4] };
  }) : [];
}

async function readTree(sha, cwd) {
  // Fixed argv, no shell/revision expressions/pathspecs supplied by candidate.
  // Replacement refs must not turn an unsafe object into a trusted-looking one.
  const options = {
    cwd, encoding: 'buffer', maxBuffer: 32 * 1024 * 1024, timeout: 30_000, windowsHide: true,
    env: { ...process.env, GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' },
  };
  try {
    const { stdout: type } = await runFile('git', ['--no-replace-objects', 'cat-file', '-t', sha], options);
    if (type.toString('ascii') !== 'commit\n') reject('expected a commit object');
    const { stdout } = await runFile('git', ['--no-replace-objects', 'ls-tree', '-r', '-t', '-z', '--full-tree', sha, '--'], options);
    return parseTree(stdout);
  } catch (error) {
    // Child-process errors may include environment, stderr, or local paths.
    if (error.message?.startsWith('Unsafe preview build input:')) throw error;
    reject('cannot inspect complete commit tree');
  }
}

export async function assertPreviewBuildInputs({ candidateSha, trustedSha, cwd }) {
  if (typeof candidateSha !== 'string' || !fullSha.test(candidateSha) ||
      typeof trustedSha !== 'string' || !fullSha.test(trustedSha) || typeof cwd !== 'string' || !cwd) {
    reject('expected full commit SHAs and repository cwd');
  }
  const [candidate, trusted] = await Promise.all([readTree(candidateSha, cwd), readTree(trustedSha, cwd)]);
  compareBuildInputs(candidate, trusted);
}
