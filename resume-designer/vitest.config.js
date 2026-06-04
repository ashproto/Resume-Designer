import { defineConfig } from 'vitest/config';

// Unit tests for pure renderer logic. jsdom gives us `window`/`document`
// (DOMPurify needs a DOM) and a `localStorage` implementation (the backup
// import functions read/write it). Tests live in test/ and import the real
// modules from src/.
export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['test/**/*.test.js'],
    clearMocks: true,
  },
});
