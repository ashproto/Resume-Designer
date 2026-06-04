import js from '@eslint/js';
import globals from 'globals';

export default [
  { ignores: ['dist/', 'node_modules/', 'src-tauri/'] },
  js.configs.recommended,
  {
    rules: {
      // Underscore-prefixed args/vars/caught-errors are intentional throwaways.
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // Intentional control-char range in a security slug validator (src/aiService.js).
      'no-control-regex': 'off',
      // Deferred: retrofitting `{ cause }` onto legacy throw sites and reworking
      // pre-existing assignments is out of scope for the CI-foundation PR.
      'preserve-caught-error': 'off',
      'no-useless-assignment': 'off',
    },
  },
  {
    files: ['src/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
  },
  {
    files: ['test/**/*.js', '*.config.{js,mjs}', 'scripts/**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },
];
