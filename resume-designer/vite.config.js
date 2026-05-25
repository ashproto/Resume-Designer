import { defineConfig } from 'vite';

// Tauri uses a fixed dev-server port (configured in src-tauri/tauri.conf.json
// `build.devUrl`). Keep `strictPort` on so Vite fails loudly if the port is
// already in use instead of silently picking another one and breaking Tauri.
const host = process.env.TAURI_DEV_HOST;

export default defineConfig({
  root: '.',
  publicDir: 'public',
  // Relative paths work for both the Tauri webview and a browser `vite preview`.
  base: './',
  // Don't wipe Tauri's Rust-side logs when Vite starts.
  clearScreen: false,
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    // Tauri's webview baseline supports modern JS.
    target: 'es2021',
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
