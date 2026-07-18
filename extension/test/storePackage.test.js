import { readFileSync } from 'node:fs';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';

import { afterEach, describe, expect, it } from 'vitest';

import {
  createDeterministicZip,
  createStorePackage,
  validateStoreBuild,
} from '../scripts/store-package.mjs';

const temporaryDirectories = [];

const CRC32_TABLE = Array.from({ length: 256 }, (_, value) => {
  let crc = value;
  for (let bit = 0; bit < 8; bit += 1) {
    crc = (crc & 1) === 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
  }
  return crc >>> 0;
});

function crc32(data) {
  let crc = 0xffffffff;
  for (const byte of data) crc = CRC32_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(type, payload) {
  const typeBytes = Buffer.from(type, 'ascii');
  const chunk = Buffer.alloc(12 + payload.byteLength);
  chunk.writeUInt32BE(payload.byteLength, 0);
  typeBytes.copy(chunk, 4);
  payload.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(Buffer.concat([typeBytes, payload])), 8 + payload.byteLength);
  return chunk;
}

function pngWithExcessDecodedData(size) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const expectedDecodedBytes = size * ((size * 4) + 1);
  return Buffer.concat([
    Buffer.from('89504e470d0a1a0a', 'hex'),
    pngChunk('IHDR', header),
    pngChunk('IDAT', deflateSync(Buffer.alloc(expectedDecodedBytes + 1))),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function icon(size) {
  return readFileSync(new URL(`../icons/${size}.png`, import.meta.url));
}

function validManifest(overrides = {}) {
  return {
    manifest_version: 3,
    name: 'Resume Designer Companion',
    version: '0.1.0',
    minimum_chrome_version: '116',
    description: 'Review and fill job applications with the local Resume Designer app.',
    content_security_policy: {
      extension_pages: "default-src 'self'; connect-src http://127.0.0.1:17872; img-src 'self' data:; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
    },
    action: {
      default_title: 'Open Resume Designer Companion',
      default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' },
    },
    background: { service_worker: 'background.js' },
    side_panel: { default_path: 'sidepanel.html' },
    permissions: ['sidePanel', 'storage', 'activeTab', 'scripting'],
    host_permissions: ['http://127.0.0.1:17872/*'],
    icons: {
      16: 'icons/16.png',
      32: 'icons/32.png',
      48: 'icons/48.png',
      128: 'icons/128.png',
    },
    ...overrides,
  };
}

function validFiles() {
  return new Map([
    ['manifest.json', Buffer.from(JSON.stringify(validManifest()))],
    ['background.js', Buffer.from('(() => {})();')],
    ['content.js', Buffer.from('(() => {})();')],
    ['sidepanel.html', Buffer.from('<script src="assets/panel.js"></script>')],
    ['assets/panel.js', Buffer.from('console.log("panel")')],
    ['icons/16.png', icon(16)],
    ['icons/32.png', icon(32)],
    ['icons/48.png', icon(48)],
    ['icons/128.png', icon(128)],
  ]);
}

afterEach(async () => {
  await Promise.all(temporaryDirectories.splice(0).map((path) => rm(path, {
    force: true,
    recursive: true,
  })));
});

describe('validateStoreBuild', () => {
  it('accepts the exact least-privilege production artifact', () => {
    const result = validateStoreBuild({
      files: validFiles(),
      manifest: validManifest(),
      lockVersion: '0.1.0',
      packageVersion: '0.1.0',
    });

    expect(result).toMatchObject({ fileCount: 9, version: '0.1.0' });
  });

  it('rejects version drift, undeclared permissions, and development artifacts', () => {
    expect(() => validateStoreBuild({
      files: validFiles(),
      manifest: validManifest(),
      lockVersion: '0.1.0',
      packageVersion: '0.2.0',
    })).toThrow(/version/i);

    expect(() => validateStoreBuild({
      files: validFiles(),
      manifest: validManifest({
        permissions: ['sidePanel', 'storage', 'activeTab', 'scripting', 'tabs'],
      }),
      lockVersion: '0.1.0',
      packageVersion: '0.1.0',
    })).toThrow(/permission/i);

    const files = validFiles();
    files.set('assets/panel.js.map', Buffer.from('{}'));
    expect(() => validateStoreBuild({
      files,
      manifest: validManifest(),
      lockVersion: '0.1.0',
      packageVersion: '0.1.0',
    })).toThrow(/development|unexpected/i);

    for (const version of ['0.0.0', '01.0.0', '1.65536.0', '1.2.3.4.5']) {
      const invalidManifest = validManifest({ version });
      const invalidFiles = validFiles();
      invalidFiles.set('manifest.json', Buffer.from(JSON.stringify(invalidManifest)));
      expect(() => validateStoreBuild({
        files: invalidFiles,
        manifest: invalidManifest,
        lockVersion: version,
        packageVersion: version,
      })).toThrow(/version/i);
    }
  });

  it('requires every manifest and side-panel asset to be present', () => {
    const files = validFiles();
    files.delete('icons/128.png');

    expect(() => validateStoreBuild({
      files,
      manifest: validManifest(),
      lockVersion: '0.1.0',
      packageVersion: '0.1.0',
    })).toThrow(/icons\/128\.png/);
  });

  it('rejects lockfile version drift and incorrectly sized icons', () => {
    expect(() => validateStoreBuild({
      files: validFiles(),
      manifest: validManifest(),
      lockVersion: '0.2.0',
      packageVersion: '0.1.0',
    })).toThrow(/lockfile.*version/i);

    const files = validFiles();
    files.set('icons/128.png', icon(48));
    expect(() => validateStoreBuild({
      files,
      manifest: validManifest(),
      lockVersion: '0.1.0',
      packageVersion: '0.1.0',
    })).toThrow(/128.*dimensions|dimensions.*128/i);

    const truncatedFiles = validFiles();
    truncatedFiles.set('icons/128.png', icon(128).subarray(0, 24));
    expect(() => validateStoreBuild({
      files: truncatedFiles,
      manifest: validManifest(),
      lockVersion: '0.1.0',
      packageVersion: '0.1.0',
    })).toThrow(/png|truncated|iend|idat/i);

    const oversizedDecodedFiles = validFiles();
    oversizedDecodedFiles.set('icons/128.png', pngWithExcessDecodedData(128));
    expect(() => validateStoreBuild({
      files: oversizedDecodedFiles,
      manifest: validManifest(),
      lockVersion: '0.1.0',
      packageVersion: '0.1.0',
    })).toThrow(/exceeds.*decoded size/i);
  });

  it('rejects nested archives and credential-like artifacts', () => {
    for (const path of ['assets/old-build.zip', 'assets/signing.pem']) {
      const files = validFiles();
      files.set(path, Buffer.from('not allowed'));
      expect(() => validateStoreBuild({
        files,
        manifest: validManifest(),
        lockVersion: '0.1.0',
        packageVersion: '0.1.0',
      })).toThrow(/unexpected|prohibited|development/i);
    }
  });

  it('rejects unreferenced assets, remote HTML code, and capability expansion', () => {
    const extraFiles = validFiles();
    extraFiles.set('assets/unreferenced-debug.js', Buffer.from('const apiKey = "secret";'));
    expect(() => validateStoreBuild({
      files: extraFiles,
      manifest: validManifest(),
      lockVersion: '0.1.0',
      packageVersion: '0.1.0',
    })).toThrow(/unreferenced|unexpected/i);

    for (const source of [
      '<script src = "https://evil.example/code.js"></script>',
      '<script src="data:text/javascript,alert(1)"></script>',
      '<img srcset="https://evil.example/tracker.png 1x">',
      '<meta http-equiv="refresh" content="0; url=https://evil.example/">',
      '<form action="https://evil.example/submit"></form>',
      '<div style="background: url(https://evil.example/pixel.png)"></div>',
    ]) {
      const remoteFiles = validFiles();
      remoteFiles.set('sidepanel.html', Buffer.from(source));
      expect(() => validateStoreBuild({
        files: remoteFiles,
        manifest: validManifest(),
        lockVersion: '0.1.0',
        packageVersion: '0.1.0',
      })).toThrow(/remote|data|local|asset|redirect|attribute/i);
    }

    const expandedManifest = validManifest({
      externally_connectable: { matches: ['https://example.com/*'] },
    });
    const expandedFiles = validFiles();
    expandedFiles.set('manifest.json', Buffer.from(JSON.stringify(expandedManifest)));
    expect(() => validateStoreBuild({
      files: expandedFiles,
      manifest: expandedManifest,
      lockVersion: '0.1.0',
      packageVersion: '0.1.0',
    })).toThrow(/manifest.*key|capability|allowlist/i);
  });

  it('requires action icon paths to match their declared sizes', () => {
    const manifest = validManifest({
      action: {
        default_title: 'Open Resume Designer Companion',
        default_icon: { 16: 'icons/32.png', 32: 'icons/16.png' },
      },
    });
    const files = validFiles();
    files.set('manifest.json', Buffer.from(JSON.stringify(manifest)));

    expect(() => validateStoreBuild({
      files,
      manifest,
      lockVersion: '0.1.0',
      packageVersion: '0.1.0',
    })).toThrow(/action icon|icons\/16|icons\/32/i);
  });

  it('requires the exact runtime entrypoints, action title, and extension CSP', () => {
    const invalidManifests = [
      validManifest({ background: { service_worker: 'content.js' } }),
      validManifest({ side_panel: { default_path: 'background.js' } }),
      validManifest({
        action: {
          default_title: 'Open something else',
          default_icon: { 16: 'icons/16.png', 32: 'icons/32.png' },
        },
      }),
      validManifest({
        content_security_policy: {
          extension_pages: "script-src 'self'; object-src 'self'",
        },
      }),
      validManifest({
        content_security_policy: {
          extension_pages: "default-src 'self'; connect-src http://127.0.0.1:17872; img-src 'self' data:; style-src 'self'; object-src 'none'; base-uri 'none'; form-action 'none'",
          sandbox: "script-src 'self'",
        },
      }),
    ];

    for (const manifest of invalidManifests) {
      const files = validFiles();
      files.set('manifest.json', Buffer.from(JSON.stringify(manifest)));
      expect(() => validateStoreBuild({
        files,
        manifest,
        lockVersion: '0.1.0',
        packageVersion: '0.1.0',
      })).toThrow(/background|side-panel|action title|content security policy|content-security-policy/i);
    }
  });

  it('rejects indirect dynamic code and CSS URL/import bypasses', () => {
    for (const source of [
      'Function("return 1")()',
      '(0, eval)("1")',
      'import("./lazy.js")',
    ]) {
      const files = validFiles();
      files.set('assets/panel.js', Buffer.from(source));
      expect(() => validateStoreBuild({
        files,
        manifest: validManifest(),
        lockVersion: '0.1.0',
        packageVersion: '0.1.0',
      })).toThrow(/dynamic|eval|function|import/i);
    }

    for (const source of [
      String.raw`body { background: url(h\74tps://evil.example/pixel.png); }`,
      '@import "https://evil.example/theme.css";',
    ]) {
      const files = validFiles();
      files.set(
        'sidepanel.html',
        Buffer.from('<script src="assets/panel.js"></script><link rel="stylesheet" href="assets/panel.css">'),
      );
      files.set('assets/panel.css', Buffer.from(source));
      expect(() => validateStoreBuild({
        files,
        manifest: validManifest(),
        lockVersion: '0.1.0',
        packageVersion: '0.1.0',
      })).toThrow(/css|url|import/i);
    }
  });
});

describe('createDeterministicZip', () => {
  it('produces identical bytes regardless of input ordering', () => {
    const entries = [
      { path: 'manifest.json', data: Buffer.from('{"version":"0.1.0"}') },
      { path: 'background.js', data: Buffer.from('(() => {})();') },
    ];

    expect(createDeterministicZip(entries))
      .toEqual(createDeterministicZip(entries.toReversed()));
  });
});

describe('createStorePackage', () => {
  it('writes a versioned ZIP with the manifest at its root', async () => {
    const root = await mkdtemp(join(tmpdir(), 'resume-designer-store-package-'));
    temporaryDirectories.push(root);
    const distDir = join(root, 'dist');
    const outputDir = join(root, 'artifacts');
    await mkdir(join(distDir, 'assets'), { recursive: true });
    await mkdir(join(distDir, 'icons'), { recursive: true });

    for (const [path, data] of validFiles()) {
      const absolutePath = join(distDir, path);
      await mkdir(join(absolutePath, '..'), { recursive: true });
      await writeFile(absolutePath, data);
    }

    const result = await createStorePackage({
      distDir,
      lockVersion: '0.1.0',
      outputDir,
      packageVersion: '0.1.0',
    });

    expect(result).toMatchObject({
      fileCount: 9,
      version: '0.1.0',
    });
    expect(result.artifactPath).toBe(join(
      outputDir,
      'resume-designer-companion-0.1.0.zip',
    ));
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect((await readFile(result.artifactPath)).readUInt32LE(0)).toBe(0x04034b50);
  });
});
