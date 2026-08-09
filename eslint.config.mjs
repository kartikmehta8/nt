/**
 * @file ESLint flat config: recommended JS/TS rules across the workspace,
 * no-console in engine code, with the CLI exempted because terminal output is
 * its purpose. The plain-CommonJS VS Code extension receives explicit Node
 * module globals so its authored JavaScript is checked alongside TypeScript.
 * Generated build artifacts (Next's `.next`, fumadocs' `.source`, and
 * `next-env.d.ts`) are ignored so lint only sees authored source.
 */

import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "node_modules/**",
      "**/node_modules/**",
      "**/dist/**",
      "**/.next/**",
      "**/.source/**",
      "**/next-env.d.ts",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      globals: { process: "readonly", console: "readonly", Buffer: "readonly", fetch: "readonly" },
    },
    rules: {
      "no-console": ["error", { allow: ["warn", "error"] }],
      "@typescript-eslint/no-non-null-assertion": "warn",
    },
  },
  {
    files: ["packages/cli/**"],
    rules: { "no-console": "off" },
  },
  {
    files: ["packages/vscode-nt/**/*.js"],
    languageOptions: { globals: { require: "readonly", module: "readonly" } },
    rules: { "@typescript-eslint/no-require-imports": "off" },
  },
);
