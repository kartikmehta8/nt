# Contributing to NT

Thanks for your interest in contributing! This is a pnpm monorepo with three
packages:

| Package              | npm name         | What it is                                       |
| -------------------- | ---------------- | ------------------------------------------------ |
| `packages/engine`    | `@age.nt/engine` | The NT language, parser, schema, and runtime     |
| `packages/cli`       | `@age.nt/nt`     | The `nt` command-line interface (binary is `nt`) |
| `packages/vscode-nt` | `vscode-nt`      | VS Code syntax + IntelliSense for `.nt` files    |

NT runs TypeScript directly via Node's native type-stripping — **there is no
build step**. This is why Node **>= 22.18.0** is required.

## Getting started

```bash
corepack enable          # or install pnpm 10 yourself
pnpm install             # also installs git hooks via husky
```

## Everyday commands

```bash
pnpm typecheck           # tsc --noEmit across packages
pnpm lint                # eslint
pnpm lint:fix            # eslint --fix
pnpm format              # prettier --write
pnpm format:check        # prettier --check
pnpm test                # node --test on engine + cli
```

Try the CLI against the example project:

```bash
pnpm nt:validate
pnpm nt:list
pnpm nt:graph
```

## Git hooks

Installed automatically on `pnpm install`:

- **pre-commit** — Prettier + ESLint `--fix` on staged files (via lint-staged)
- **commit-msg** — enforces [Conventional Commits](https://www.conventionalcommits.org/)
- **pre-push** — runs `pnpm typecheck && pnpm test`

## Commit messages

Use Conventional Commits, e.g.:

```
feat(cli): add --json output to `nt list`
fix(engine): handle empty tool arrays in parser
docs(repo): clarify Node version requirement
```

Allowed scopes: `engine`, `cli`, `vscode`, `repo`, `ci`, `deps`, `docs`, `release`.

## Releasing

Releases are triggered by pushing a tag (CI publishes automatically):

| Tag pattern     | Publishes                            |
| --------------- | ------------------------------------ |
| `engine-vX.Y.Z` | `@age.nt/engine` to npm              |
| `cli-vX.Y.Z`    | `@age.nt/nt` to npm                  |
| `vscode-vX.Y.Z` | extension to the VS Code Marketplace |

Bump the version in the relevant `package.json` first. **Publish `@age.nt/engine`
before `nt`** — the CLI's `workspace:*` dependency is rewritten to the engine's
published version at pack time, so that version must already exist on npm.

Required repository secrets:

- `NPM_TOKEN` — npm automation token with publish access
- `VSCE_PAT` — VS Code Marketplace personal access token
- `OVSX_PAT` — (optional) Open VSX token
