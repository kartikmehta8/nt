/**
 * @file Commitlint config: enforce Conventional Commits
 * (feat:, fix:, docs:, chore:, refactor:, test:, ci:, build:, perf:, revert:).
 * Wired to the commit-msg git hook via husky.
 */
export default {
  extends: ["@commitlint/config-conventional"],
  rules: {
    "scope-enum": [
      1,
      "always",
      ["engine", "cli", "vscode", "repo", "ci", "deps", "docs", "release"],
    ],
  },
};
