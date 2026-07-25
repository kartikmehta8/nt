/**
 * @file ESLint flat config: recommended JS/TS rules across the workspace,
 * no-console in engine code, with the CLI and the VS Code extension (plain
 * CommonJS with editor globals) exempted where output is their purpose.
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
      "dist/**",
      "packages/vscode-nt/**",
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
);
