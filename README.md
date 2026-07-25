![banner](./assets/banner.png)

**NT** is a small declarative language (`.nt` files) and a runtime engine.
Describe your models, agents, subagents, sandboxes, tools, skills and workflows
in one clean file, and one command brings the whole ecosystem up.

## Install

```bash
npm install -g @age.nt/nt        # the nt CLI — needs Node >= 22.18
export ANTHROPIC_API_KEY=sk-ant-...
```

Editor support: install the **NT** extension from the
[VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=KartikMehta.nt-agent-lang)
or [Open VSX](https://open-vsx.org/extension/KartikMehta/nt-agent-lang) (Cursor, Windsurf,
VSCodium) for highlighting and IntelliSense.

## Example

A complete agent in one file:

```yaml
# age.nt
agent age
  description: Guesses a person's age from clues.
  model: anthropic/claude-sonnet-5
  instructions: |
    Guess the person's most likely age from the clues.
  input:
    clues: string
  output:
    age: number
    reason: string
```

Run it:

```bash
nt run age -i '{"clues":"bought the first iPhone at 22"}'
# { "age": 39, "reason": "The first iPhone came out in 2007." }
```

## Documentation

Full guides and reference live in the docs (`apps/docs`, run with
`pnpm docs:dev`):

- **Get started** — introduction, installation, your first agent
- **Guides** — agents, tools, skills, sandboxes, subagents, workflows, providers
- **Reference** — the `.nt` syntax, the full API reference, and CLI commands

## Development

A pnpm monorepo with **no build step** — Node runs the TypeScript directly.

```
packages/engine     @age.nt/engine — the language + runtime
packages/cli        @age.nt/nt — the nt command
packages/vscode-nt  the VS Code extension
apps/docs           the documentation site
example/            the wired age example
```

```bash
pnpm install         # link @age.nt/engine into the nt CLI
pnpm nt:validate     # validate the example ecosystem
pnpm test            # engine + CLI tests
pnpm typecheck
pnpm lint
pnpm format
```

Coding conventions live in [CLAUDE.md](./CLAUDE.md). Contributions follow
Conventional Commits.
