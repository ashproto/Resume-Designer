import { createHash } from 'node:crypto';
import {
  mkdir,
  readFile,
  readdir,
  writeFile,
} from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inflateSync } from 'node:zlib';

import { JSDOM } from 'jsdom';

import { parseChromeVersion } from './chrome-version.mjs';

const EXPECTED_PERMISSIONS = Object.freeze([
  'activeTab',
  'scripting',
  'sidePanel',
  'storage',
]);
const EXPECTED_HOST_PERMISSIONS = Object.freeze([
  'http://127.0.0.1:17872/*',
]);
const EXPECTED_ACTION_TITLE = 'Open Resume Designer Companion';
const EXPECTED_EXTENSION_CSP = "default-src 'self'; connect-src http://127.0.0.1:17872; img-src 'self' data:; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'";
const EXPECTED_MANIFEST_KEYS = Object.freeze([
  'action',
  'background',
  'content_security_policy',
  'description',
  'host_permissions',
  'icons',
  'manifest_version',
  'minimum_chrome_version',
  'name',
  'permissions',
  'side_panel',
  'version',
]);
const MAX_FILE_BYTES = 1024 * 1024;
const MAX_TOTAL_BYTES = 2 * 1024 * 1024;
const MAX_ZIP_BYTES = 1024 * 1024;
const REQUIRED_ICON_SIZES = Object.freeze([16, 32, 48, 128]);
const ZIP_VERSION = 20;
const ZIP_UTF8_FLAG = 0x0800;
const DOS_TIME = 0;
const DOS_DATE = (1 << 5) | 1;
const HTML_URL_ATTRIBUTES = Object.freeze([
  'action',
  'background',
  'cite',
  'data',
  'formaction',
  'href',
  'longdesc',
  'manifest',
  'poster',
  'src',
  'usemap',
  'xlink:href',
]);
const FORBIDDEN_HTML_ATTRIBUTES = Object.freeze([
  'imagesrcset',
  'ping',
  'srcdoc',
  'srcset',
  'style',
]);

const CRC32_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return crc >>> 0;
});

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function assertSafePath(path) {
  assert(typeof path === 'string' && path.length > 0, 'Store package contains an empty path');
  assert(!path.startsWith('/') && !path.includes('\\'), `Unsafe Store package path: ${path}`);
  assert(!path.split('/').includes('..'), `Unsafe Store package path: ${path}`);
  assert(!path.split('/').some((part) => part.startsWith('.')), `Hidden file is not allowed: ${path}`);
}

function sameStrings(actual, expected) {
  return Array.isArray(actual)
    && actual.length === new Set(actual).size
    && actual.toSorted().join('\0') === expected.toSorted().join('\0');
}

function iconPaths(value) {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object' || Array.isArray(value)) return [];
  return Object.values(value).filter((path) => typeof path === 'string');
}

function localHtmlAssets(html) {
  const dom = new JSDOM(html);
  const references = [];
  try {
    const document = dom.window.document;
    assert(!document.querySelector('base'), 'HTML base URLs are not allowed');
    assert(!document.querySelector('style'), 'Inline HTML styles are not allowed');
    for (const script of document.querySelectorAll('script:not([src])')) {
      assert(script.textContent.trim().length === 0, 'Inline HTML scripts are not allowed');
    }
    for (const meta of document.querySelectorAll('meta[http-equiv]')) {
      assert(meta.getAttribute('http-equiv').trim().toLowerCase() !== 'refresh', 'HTML redirects are not allowed');
    }

    for (const element of document.querySelectorAll('*')) {
      const attributeNames = element.getAttributeNames().map((attribute) => attribute.toLowerCase());
      assert(
        !attributeNames.some((attribute) => attribute.startsWith('on')),
        'Inline HTML event handlers are not allowed',
      );
      for (const attribute of FORBIDDEN_HTML_ATTRIBUTES) {
        assert(!element.hasAttribute(attribute), `HTML ${attribute} attributes are not allowed`);
      }
      for (const attribute of HTML_URL_ATTRIBUTES) {
        if (!element.hasAttribute(attribute)) continue;
        const path = element.getAttribute(attribute).trim();
        assert(path.length > 0, `Empty HTML ${attribute} asset is not allowed`);
        if (path.startsWith('#')) continue;
        assert(!/^data:/iu.test(path), `Data HTML asset is not allowed: ${path.slice(0, 40)}`);
        assert(!/^(?:[a-z][a-z\d+.-]*:|\/\/)/iu.test(path), `Remote HTML asset is not allowed: ${path}`);
        references.push(path.replace(/^\.\//u, ''));
      }
    }
  } finally {
    dom.window.close();
  }
  return references;
}

function referencedPaths(manifest, files) {
  const paths = new Set([
    manifest.background?.service_worker,
    manifest.side_panel?.default_path,
    ...iconPaths(manifest.icons),
    ...iconPaths(manifest.action?.default_icon),
  ].filter(Boolean));

  const sidePanelPath = manifest.side_panel?.default_path;
  if (sidePanelPath && files.has(sidePanelPath)) {
    for (const path of localHtmlAssets(files.get(sidePanelPath).toString('utf8'))) {
      paths.add(path);
    }
  }

  return paths;
}

function isAllowedArtifact(path) {
  if ([
    'manifest.json',
    'background.js',
    'content.js',
    'sidepanel.html',
  ].includes(path)) return true;
  if (/^assets\/[A-Za-z0-9._-]+\.(?:css|js)$/u.test(path)) return true;
  return /^icons\/(?:16|32|48|128)\.png$/u.test(path);
}

function assertPackagedCode(path, data) {
  const source = data.toString('utf8');
  if (path.endsWith('.js')) {
    assert(!/\beval\b/u.test(source), `Dynamic eval is not allowed in Store JavaScript: ${path}`);
    assert(!/\bFunction\b/u.test(source), `Dynamic Function is not allowed in Store JavaScript: ${path}`);
    assert(!/\bimport\s*\(/u.test(source), `Dynamic JavaScript import is not allowed: ${path}`);
  }
  if (path.endsWith('.css')) {
    assert(!/@import\b/iu.test(source), `CSS imports are not allowed: ${path}`);
    assert(!/\burl\s*\(/iu.test(source), `CSS URL assets are not allowed: ${path}`);
  }
}

function pngDimensions(data, path, expectedSize) {
  const signature = Buffer.from('89504e470d0a1a0a', 'hex');
  assert(data.byteLength >= 45 && data.subarray(0, 8).equals(signature), `Icon is not a complete PNG: ${path}`);
  const idatChunks = [];
  const chunkTypes = [];
  let height;
  let ihdr;
  let offset = 8;
  let sawEnd = false;
  let width;

  while (offset < data.byteLength) {
    assert(offset + 12 <= data.byteLength, `PNG chunk is truncated: ${path}`);
    const length = data.readUInt32BE(offset);
    const typeStart = offset + 4;
    const payloadStart = offset + 8;
    const payloadEnd = payloadStart + length;
    const chunkEnd = payloadEnd + 4;
    assert(chunkEnd <= data.byteLength, `PNG chunk payload is truncated: ${path}`);
    const typeBytes = data.subarray(typeStart, payloadStart);
    const type = typeBytes.toString('ascii');
    const payload = data.subarray(payloadStart, payloadEnd);
    const expectedCrc = data.readUInt32BE(payloadEnd);
    assert(
      crc32(Buffer.concat([typeBytes, payload])) === expectedCrc,
      `PNG chunk CRC is invalid for ${path}`,
    );
    chunkTypes.push(type);

    if (type === 'IHDR') {
      assert(chunkTypes.length === 1 && length === 13 && !ihdr, `PNG IHDR is invalid: ${path}`);
      ihdr = payload;
      width = payload.readUInt32BE(0);
      height = payload.readUInt32BE(4);
    } else if (type === 'IDAT') {
      idatChunks.push(payload);
    } else if (type === 'IEND') {
      assert(length === 0, `PNG IEND is invalid: ${path}`);
      sawEnd = true;
      offset = chunkEnd;
      break;
    }
    offset = chunkEnd;
  }

  assert(ihdr && width > 0 && height > 0, `PNG dimensions are invalid: ${path}`);
  assert(
    width === expectedSize && height === expectedSize,
    `Icon ${expectedSize} has invalid dimensions ${width}x${height}`,
  );
  assert(idatChunks.length > 0, `PNG has no IDAT image data: ${path}`);
  assert(sawEnd && offset === data.byteLength, `PNG has no final IEND chunk: ${path}`);

  const bitDepth = ihdr[8];
  const colorType = ihdr[9];
  const channels = new Map([[0, 1], [2, 3], [3, 1], [4, 2], [6, 4]]).get(colorType);
  const validBitDepths = new Map([
    [0, [1, 2, 4, 8, 16]],
    [2, [8, 16]],
    [3, [1, 2, 4, 8]],
    [4, [8, 16]],
    [6, [8, 16]],
  ]).get(colorType) ?? [];
  assert(channels && validBitDepths.includes(bitDepth), `PNG color format is invalid: ${path}`);
  assert(ihdr[10] === 0 && ihdr[11] === 0 && ihdr[12] === 0, `PNG encoding is unsupported: ${path}`);
  if (colorType === 3) assert(chunkTypes.includes('PLTE'), `Indexed PNG has no palette: ${path}`);

  const rowBytes = Math.ceil((width * channels * bitDepth) / 8);
  const expectedDecodedBytes = height * (rowBytes + 1);
  assert(Number.isSafeInteger(expectedDecodedBytes), `PNG image data size is invalid: ${path}`);
  let decoded;
  try {
    decoded = inflateSync(Buffer.concat(idatChunks), { maxOutputLength: expectedDecodedBytes });
  } catch (error) {
    throw new Error(`PNG image data exceeds its expected decoded size: ${path}`, { cause: error });
  }
  assert(decoded.byteLength === expectedDecodedBytes, `PNG image data length is invalid: ${path}`);
  for (let row = 0; row < height; row += 1) {
    assert(decoded[row * (rowBytes + 1)] <= 4, `PNG row filter is invalid: ${path}`);
  }
  return {
    height,
    width,
  };
}

export function validateStoreBuild({ files, lockVersion, manifest, packageVersion }) {
  assert(files instanceof Map && files.size > 0, 'Store build contains no files');
  assert(sameStrings(Object.keys(manifest ?? {}), EXPECTED_MANIFEST_KEYS), 'Manifest top-level key allowlist changed');
  assert(manifest?.manifest_version === 3, 'Store package must use Manifest V3');
  assert(manifest.name === 'Resume Designer Companion', 'Unexpected extension name');
  assert(typeof manifest.description === 'string'
    && manifest.description.length > 0
    && manifest.description.length <= 132, 'Manifest description must be 1-132 characters');
  parseChromeVersion(manifest.version);
  assert(manifest.version === packageVersion, 'Manifest and package versions must match');
  assert(packageVersion === lockVersion, 'Package and lockfile versions must match');
  assert(manifest.minimum_chrome_version === '116', 'minimum_chrome_version must remain 116');
  assert(sameStrings(manifest.permissions, EXPECTED_PERMISSIONS), 'Extension permission allowlist changed');
  assert(sameStrings(manifest.host_permissions, EXPECTED_HOST_PERMISSIONS), 'Extension host permission allowlist changed');
  assert(sameStrings(Object.keys(manifest.action ?? {}), ['default_icon', 'default_title']), 'Manifest action key allowlist changed');
  assert(sameStrings(Object.keys(manifest.background ?? {}), ['service_worker']), 'Manifest background key allowlist changed');
  assert(
    sameStrings(Object.keys(manifest.content_security_policy ?? {}), ['extension_pages']),
    'Manifest content-security-policy key allowlist changed',
  );
  assert(sameStrings(Object.keys(manifest.side_panel ?? {}), ['default_path']), 'Manifest side-panel key allowlist changed');
  assert(sameStrings(Object.keys(manifest.icons ?? {}), REQUIRED_ICON_SIZES.map(String)), 'Manifest icon size allowlist changed');
  assert(sameStrings(Object.keys(manifest.action?.default_icon ?? {}), ['16', '32']), 'Action icon size allowlist changed');
  assert(manifest.action.default_title === EXPECTED_ACTION_TITLE, 'Manifest action title changed');
  assert(manifest.background.service_worker === 'background.js', 'Manifest background worker must be background.js');
  assert(manifest.side_panel.default_path === 'sidepanel.html', 'Manifest side-panel path must be sidepanel.html');
  assert(
    manifest.content_security_policy.extension_pages === EXPECTED_EXTENSION_CSP,
    'Manifest extension content security policy changed',
  );
  for (const size of REQUIRED_ICON_SIZES) {
    assert(manifest.icons[String(size)] === `icons/${size}.png`, `Manifest must declare icons/${size}.png`);
  }
  for (const size of [16, 32]) {
    assert(
      manifest.action.default_icon[String(size)] === `icons/${size}.png`,
      `Manifest action icon ${size} must declare icons/${size}.png`,
    );
  }

  let totalBytes = 0;
  for (const [path, data] of files) {
    assertSafePath(path);
    assert(Buffer.isBuffer(data), `Store file is not binary data: ${path}`);
    assert(isAllowedArtifact(path), `Unexpected development artifact: ${path}`);
    assert(!path.endsWith('.map'), `Unexpected development source map: ${path}`);
    assert(data.byteLength > 0, `Store file is empty: ${path}`);
    assert(data.byteLength <= MAX_FILE_BYTES, `Store file exceeds 1 MiB: ${path}`);
    assertPackagedCode(path, data);
    totalBytes += data.byteLength;
  }
  assert(totalBytes <= MAX_TOTAL_BYTES, 'Store package exceeds the 2 MiB unpacked budget');

  const requiredPaths = ['manifest.json', 'background.js', 'content.js', 'sidepanel.html'];
  for (const required of requiredPaths) {
    assert(files.has(required), `Required Store file is missing: ${required}`);
  }
  const reachablePaths = new Set(requiredPaths);
  for (const referenced of referencedPaths(manifest, files)) {
    assertSafePath(referenced);
    assert(files.has(referenced), `Referenced Store asset is missing: ${referenced}`);
    reachablePaths.add(referenced);
  }
  for (const path of files.keys()) {
    assert(reachablePaths.has(path), `Unreferenced Store asset is not allowed: ${path}`);
  }

  for (const size of REQUIRED_ICON_SIZES) {
    const path = `icons/${size}.png`;
    pngDimensions(files.get(path), path, size);
  }

  const packagedManifest = JSON.parse(files.get('manifest.json').toString('utf8'));
  assert(JSON.stringify(packagedManifest) === JSON.stringify(manifest), 'Packaged manifest differs from the validated manifest');

  return {
    fileCount: files.size,
    totalBytes,
    version: manifest.version,
  };
}

async function collectFiles(directory, prefix = '') {
  const files = new Map();
  const entries = await readdir(directory, { withFileTypes: true });

  for (const entry of entries.toSorted((a, b) => a.name.localeCompare(b.name))) {
    const path = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = resolve(directory, entry.name);
    assertSafePath(path);

    if (entry.isSymbolicLink()) throw new Error(`Store package cannot contain a symlink: ${path}`);
    if (entry.isDirectory()) {
      const nested = await collectFiles(absolutePath, path);
      for (const [nestedPath, data] of nested) files.set(nestedPath, data);
      continue;
    }
    if (!entry.isFile()) throw new Error(`Unsupported Store package entry: ${path}`);
    files.set(path, await readFile(absolutePath));
  }

  return files;
}

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function localHeader(pathBytes, data, checksum) {
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(ZIP_VERSION, 4);
  header.writeUInt16LE(ZIP_UTF8_FLAG, 6);
  header.writeUInt16LE(0, 8);
  header.writeUInt16LE(DOS_TIME, 10);
  header.writeUInt16LE(DOS_DATE, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(data.byteLength, 18);
  header.writeUInt32LE(data.byteLength, 22);
  header.writeUInt16LE(pathBytes.byteLength, 26);
  header.writeUInt16LE(0, 28);
  return header;
}

function centralHeader(pathBytes, data, checksum, offset) {
  const header = Buffer.alloc(46);
  header.writeUInt32LE(0x02014b50, 0);
  header.writeUInt16LE(0x0314, 4);
  header.writeUInt16LE(ZIP_VERSION, 6);
  header.writeUInt16LE(ZIP_UTF8_FLAG, 8);
  header.writeUInt16LE(0, 10);
  header.writeUInt16LE(DOS_TIME, 12);
  header.writeUInt16LE(DOS_DATE, 14);
  header.writeUInt32LE(checksum, 16);
  header.writeUInt32LE(data.byteLength, 20);
  header.writeUInt32LE(data.byteLength, 24);
  header.writeUInt16LE(pathBytes.byteLength, 28);
  header.writeUInt16LE(0, 30);
  header.writeUInt16LE(0, 32);
  header.writeUInt16LE(0, 34);
  header.writeUInt16LE(0, 36);
  header.writeUInt32LE(0o100644 * 0x10000, 38);
  header.writeUInt32LE(offset, 42);
  return header;
}

export function createDeterministicZip(entries) {
  assert(Array.isArray(entries) && entries.length > 0, 'ZIP requires at least one file');
  assert(entries.length <= 0xffff, 'ZIP contains too many files');

  const sorted = entries.toSorted((a, b) => a.path.localeCompare(b.path));
  const paths = new Set();
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const entry of sorted) {
    assertSafePath(entry.path);
    assert(!paths.has(entry.path), `Duplicate ZIP entry: ${entry.path}`);
    paths.add(entry.path);
    const data = Buffer.from(entry.data);
    const pathBytes = Buffer.from(entry.path, 'utf8');
    const checksum = crc32(data);
    const header = localHeader(pathBytes, data, checksum);
    localParts.push(header, pathBytes, data);
    centralParts.push(centralHeader(pathBytes, data, checksum, offset), pathBytes);
    offset += header.byteLength + pathBytes.byteLength + data.byteLength;
  }

  const centralDirectory = Buffer.concat(centralParts);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(0, 4);
  end.writeUInt16LE(0, 6);
  end.writeUInt16LE(sorted.length, 8);
  end.writeUInt16LE(sorted.length, 10);
  end.writeUInt32LE(centralDirectory.byteLength, 12);
  end.writeUInt32LE(offset, 16);
  end.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralDirectory, end]);
}

export async function createStorePackage({ distDir, lockVersion, outputDir, packageVersion }) {
  const files = await collectFiles(distDir);
  const manifest = JSON.parse(files.get('manifest.json')?.toString('utf8') ?? 'null');
  const summary = validateStoreBuild({ files, lockVersion, manifest, packageVersion });
  const zip = createDeterministicZip([...files].map(([path, data]) => ({ path, data })));
  assert(zip.byteLength <= MAX_ZIP_BYTES, 'Store ZIP exceeds the 1 MiB artifact budget');
  const artifactPath = resolve(outputDir, `resume-designer-companion-${summary.version}.zip`);
  await mkdir(outputDir, { recursive: true });
  await writeFile(artifactPath, zip);

  return {
    ...summary,
    artifactBytes: zip.byteLength,
    artifactPath,
    sha256: createHash('sha256').update(zip).digest('hex'),
  };
}

const scriptPath = fileURLToPath(import.meta.url);
if (process.argv[1] && resolve(process.argv[1]) === scriptPath) {
  const extensionRoot = resolve(dirname(scriptPath), '..');
  const packageJson = JSON.parse(await readFile(resolve(extensionRoot, 'package.json'), 'utf8'));
  const packageLock = JSON.parse(await readFile(resolve(extensionRoot, 'package-lock.json'), 'utf8'));
  assert(
    packageLock.version === packageLock.packages?.['']?.version,
    'Top-level and root package-lock versions must match',
  );
  const result = await createStorePackage({
    distDir: resolve(extensionRoot, 'dist'),
    lockVersion: packageLock.version,
    outputDir: resolve(extensionRoot, 'artifacts'),
    packageVersion: packageJson.version,
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
}
