# Contributing to NT

Thanks for your interest in contributing! This is a pnpm monorepo with three
published packages and one documentation application:

| Package              | npm name         | What it is                                       |
| -------------------- | ---------------- | ------------------------------------------------ |
| `packages/engine`    | `@age.nt/engine` | The NT language, parser, schema, and runtime     |
| `packages/cli`       | `@age.nt/nt`     | The `nt` command-line interface (binary is `nt`) |
| `packages/vscode-nt` | `nt-agent-lang`  | VS Code syntax + IntelliSense for `.nt` files    |
| `apps/docs`          | private          | Fumadocs + Next.js documentation site            |

Development commands run TypeScript directly through Node's native type
stripping, which is why Node **>= 22.18.0** is required. Published engine and
CLI packages are compiled to `dist/` with `tsc`; `pnpm typecheck` performs that
production build rather than a no-emit check.

## Getting started

```bash
corepack enable          # or install pnpm 10 yourself
pnpm install             # also installs git hooks via husky
```

## Everyday commands

```bash
pnpm typecheck           # compile the engine and CLI with tsc
pnpm lint                # eslint + repository convention checks
pnpm check:docs          # verify documentation against code and manifests
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
