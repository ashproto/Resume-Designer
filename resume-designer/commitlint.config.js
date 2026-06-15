// Enforces Conventional Commits. With a regular-merge workflow, CI lints
// every commit in a PR (base..head), so each commit subject must be e.g.
// "feat: ...", "fix: ...", "refactor: ...", "test: ...", "build: ...", "ci: ...".
//
// Dependabot's auto-generated commit bodies embed long dependency URLs and a
// YAML metadata block that blow past `body-max-line-length` (100 chars). Those
// commits are machine-generated with valid `build(deps):` subjects, so we skip
// linting them wholesale — matched via the `Signed-off-by: dependabot[bot]`
// trailer Dependabot always appends. (defaultIgnores still handles merge/revert
// commits.)
export default {
  extends: ['@commitlint/config-conventional'],
  ignores: [(message) => message.includes('dependabot[bot]')],
  // `body-max-line-length` is advisory (severity 1 = warning), not blocking:
  // AI-assisted commits often carry long prose bodies. Warnings don't fail CI,
  // so this keeps the ~100-char body guidance visible while the subject
  // conventions (type / case) that drive changelogs stay strictly enforced.
  rules: {
    'body-max-line-length': [1, 'always', 100],
  },
};
