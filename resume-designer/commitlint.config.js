// Enforces Conventional Commits. With a regular-merge workflow, CI lints
// every commit in a PR (base..head), so each commit subject must be e.g.
// "feat: ...", "fix: ...", "refactor: ...", "test: ...", "build: ...", "ci: ...".
export default {
  extends: ['@commitlint/config-conventional'],
};
