import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';

import react from '@vitejs/plugin-react';
import { build as viteBuild, defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const outDir = fileURLToPath(new URL('./dist', import.meta.url));

function copyStoreFiles() {
  return {
    name: 'copy-extension-store-files',
    async generateBundle() {
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: await readFile(new URL('./manifest.json', import.meta.url), 'utf8'),
      });
      for (const size of [16, 32, 48, 128]) {
        this.emitFile({
          type: 'asset',
          fileName: `icons/${size}.png`,
          source: await readFile(new URL(`./icons/${size}.png`, import.meta.url)),
        });
      }
    },
  };
}

function buildClassicEntries() {
  const entries = [
    ['background', './src/background.js', 'background.js'],
    ['content', './src/content.js', 'content.js'],
  ];

  return {
    name: 'build-classic-extension-entries',
    apply: 'build',
    async closeBundle() {
      for (const [name, entry, fileName] of entries) {
        await viteBuild({
          configFile: false,
          root,
          publicDir: false,
          build: {
            outDir,
            emptyOutDir: false,
            copyPublicDir: false,
            target: 'chrome116',
            minify: false,
            lib: {
              entry: fileURLToPath(new URL(entry, import.meta.url)),
              name: `ResumeDesignerCompanion${name}`,
              formats: ['iife'],
              fileName: () => fileName,
            },
          },
        });
      }
    },
  };
}

export default defineConfig({
  root,
  base: './',
  publicDir: false,
  plugins: [react(), copyStoreFiles(), buildClassicEntries()],
  build: {
    outDir,
    emptyOutDir: true,
    copyPublicDir: false,
    target: 'chrome116',
    minify: false,
    rollupOptions: {
      input: fileURLToPath(new URL('./sidepanel.html', import.meta.url)),
    },
  },
});
