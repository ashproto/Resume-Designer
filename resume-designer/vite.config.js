import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

// Tauri uses a fixed dev-server port (configured in src-tauri/tauri.conf.json
// `build.devUrl`). Keep `strictPort` on so Vite fails loudly if the port is
// already in use instead of silently picking another one and breaking Tauri.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  // React powers the app chrome (entry becomes src/main.jsx in Step 4). The
  // resume document stays vanilla. The plugin provides the JSX transform +
  // Fast Refresh.
  plugins: [react()],
  // `@` -> src/ so shadcn's generated `@/components/ui/*` and `@/lib/utils`
  // imports resolve. Mirrors jsconfig.json `paths`.
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    // Force a single React instance. The mixed vanilla + React module graph can
    // otherwise make Vite's dev optimizer load two copies of React, triggering
    // "Invalid hook call". (Rollup already dedupes for `vite build`.)
    dedupe: ['react', 'react-dom'],
  },
  root: '.',
  publicDir: 'public',
  // Expose Tauri's build-time env (TAURI_ENV_PLATFORM, etc.) to the bundle so
  // `import.meta.env.TAURI_ENV_*` is readable. The glass opt-in detects Tauri at
  // runtime (see the inline script in index.html), but exposing the build env
  // keeps a compile-time signal available as a fallback / for future use.
  envPrefix: ['VITE_', 'TAURI_ENV_'],
  // Relative paths work for both the Tauri webview and a browser `vite preview`.
  base: './',
  // Don't wipe Tauri's Rust-side logs when Vite starts.
  clearScreen: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Tauri's webview baseline supports modern JS.
    target: 'es2021',
    // Single entry: the React app shell (index.html).
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('./index.html', import.meta.url)),
      },
    },
  },
  server: {
    port: 3000,
    strictPort: true,
    host: host || false,
    hmr: host
      ? { protocol: 'ws', host, port: 3001 }
      : undefined,
    open: false,
  },
});
