# CLAUDE.md

NT — a declarative `.nt` language and runtime engine for spinning up ecosystems
of AI agents, subagents, sandboxes, tools, MCP servers, skills and workflows. GitHub:
`kartikmehta8/nt`. This is a pnpm monorepo whose development launcher runs
TypeScript directly (Node ≥ 22.18 strips types natively). Type checking and npm
packaging compile the engine and CLI to `dist/` with `tsc`.

- `packages/engine` — the language + runtime, as a library (`@age.nt/engine`)
- `packages/cli` — the `nt` command (`@age.nt/nt`, depends on the engine)
- `packages/vscode-nt` — the VS Code extension (highlighting + IntelliSense)
- `apps/docs` — the documentation site: Fumadocs + Next.js 15 · port 3000
- `example/` — the canonical wired `age` ecosystem, split by domain

The engine has three exact-pinned runtime dependencies: the official
`@modelcontextprotocol/client`, Ajv for JSON Schema validation, and Undici for
guarded network dispatch. It talks to model providers over the platform `fetch`.

## Canonical naming and branding

- Language and product: `NT`; files use the `.nt` extension.
- Engine library: `@age.nt/engine` (public API only through its `index.ts` barrel).
- CLI package: `@age.nt/nt`; the installed command is `nt`.
- Editor extension: published to the VS Code Marketplace (`KartikMehta.nt-agent-lang`) and to
  Open VSX (for Cursor, Windsurf, VSCodium, and other VS Code forks).
- Built-in model providers: `anthropic` and `openai-completions`.
- Preserve proper names for third-party dependencies: Anthropic, OpenAI, Ollama,
  Next.js, Fumadocs, Node.js, pnpm.
- The npm scope in use is `@age.nt`; keep package names consistent with it.

## Commands

```bash
pnpm install         # installs pinned dependencies and links the workspaces

pnpm nt:setup        # scaffold the full starter template into .nt-demo/ (gitignored)
pnpm nt:validate     # parse + type-check every .nt file (root scripts target example/age.nt)
pnpm nt:list         # list all declared entities
pnpm nt:graph        # show how agents wire to subagents / tools / sandboxes
pnpm nt:up           # bring the ecosystem up and run config.entry
pnpm nt:run <name>   # run one agent/subagent/workflow once (append -m "…" for input)
pnpm nt:chat         # chat with the example agent

pnpm docs:dev        # run the docs site (http://localhost:3000); docs:build / docs:start
pnpm typecheck       # tsc per package (engine + cli)
pnpm test            # node --test over packages/*/test/*.test.ts
pnpm lint            # eslint plus file-size, @file, and public-JSDoc checks
pnpm check:conventions # run the repository convention checker directly
pnpm format          # prettier --write (format:check to verify)
```

Run the CLI directly against any file with the launcher:
`node packages/cli/bin/nt.mjs <command> --file <entry.nt>`.

**Definition of done for any change:** `pnpm typecheck && pnpm lint && pnpm format:check`
all pass with zero errors AND zero warnings, and `pnpm test` is green.

## Code rules

1. **250 lines max per hand-authored code file.** If a file won't fit, split it
   by domain — see `packages/engine/src/parse/` and `schema/`. The executable
   convention check excludes generated/build output and enforces the limit.
2. **JSDoc-only comments.** Every file opens with a `/** @file … */` block; every
   exported function gets a JSDoc with `@param`/`@returns`. No types in JSDoc —
   TypeScript owns types. No `//` comments, no same-line comments. Name logic to
   be self-explanatory; comments explain _why_, not _what_.
3. **Subpath aliases within a package, package names across packages.** Inside a
   package, import via the Node subpath map in its `package.json` `imports` —
   the engine maps `#*` to `./src/*.ts`, so use `#parse/parser`, `#schema/build`,
   `#types`, `#constants`. Across packages, import by name (`@age.nt/engine`).
   Same-directory `./file` is fine. Never parent-relative `../` paths.
4. **Inline type imports:** `import { foo, type Foo } from "…"`.
5. **No `console.log` in engine code** (`console.warn`/`error` allowed) —
   enforced by eslint. The **CLI is exempt** (its output is the point). The VS
   Code extension is plain CommonJS with explicit lint globals and is checked
   by both ESLint and the repository convention gate.
6. **Prettier owns all formatting** (`printWidth: 100`, double quotes,
   semicolons, `trailingComma: all`). Never hand-align or fight it.

## Architecture invariants

### Engine (packages/engine)

- **Public surface is `src/index.ts` only** — core engine/load/chat/scaffold and
  audit APIs, `NtError` / `McpError`, and their typed project and MCP result
  shapes. Everything else stays private behind `#` subpath imports.
- **Four phases, in order:** load (discover `.nt`, parse to blocks in `parse/`)
  → build (`schema/`: coerce → declarations → build → validate into a typed
  `Project`, validating references and collecting warnings) → bring up
  (`status.ts`: instantiate sandboxes, check provider credentials, report the
  audit destination) → run (`runtime.ts` resolves the per-run context, model and
  prompt; `session.ts` drives the agentic tool-use loop plus delegation).
- **`constants.ts` is the single source of truth** for built-in tool names
  (`fs_read`, `fs_write`, `fs_list`, `bash`), thinking levels, and the
  defaults/limits (`DEFAULT_MAX_TOKENS`, `MAX_AGENT_STEPS` = 12,
  `MAX_DELEGATION_DEPTH` = 6, `HTTP_TOOL_TIMEOUT_MS`, `DEFAULT_AUDIT_DIR`, …).
  Never duplicate these.
- **`scaffold/` holds the starter projects `nt setup` writes**: `templates.ts`
  registers them (`minimal`, `full`) and rejects unknown names, `minimal.ts` and
  `full.ts` hold the core `.nt` source as data, `full-mcp.ts` holds the full
  starter's MCP declaration and runnable local server, and `write.ts` creates
  the folder and writes each file exclusively — an existing file is reported
  as skipped, never clobbered, unless `force` is set. Templates must load with
  zero warnings; the scaffold test also invokes the generated MCP tool.
- **`audit/` writes the tool-call log**: `config.ts` resolves `config.audit`
  (`off` or a folder) into `AuditConfig`, `redact.ts` strips credentials, and
  `log.ts` appends one JSONL line per tool call plus the reader `nt audit` uses.
- **`mcp/` is the tools-only MCP client host**: declarations remain offline,
  `manager.ts` owns lazy shared connections, and `Engine.close()` owns cleanup.
  The session loop records every dispatch; a failing write degrades to one
  warning and never breaks a run.
- **Errors are `NtError(message, loc)`** with a source `Location` attached by the
  parser/loader. Schema parsers are split by domain when needed to stay focused;
  unknown fields are reported via `warnUnknown`, never silently accepted.

### Security (the trust rules)

- **`local` sandboxes run model-chosen commands on the host** and are disabled
  unless `NT_ALLOW_LOCAL=1`. The default `virtual` sandbox is in-memory. Trusted
  inputs only.
- **Provider `base_url` must be `https`** (localhost/loopback exempt) so API keys
  are never sent in cleartext.
- **`api_key` must be `env(NAME)`.** A literal key — or an `env()` fallback
  literal — is flagged by `nt validate`; keys must never land in a file.
- **`http` tools cannot reach private/localhost addresses** unless the tool sets
  `allow_internal: true`.
- **Tools with `confirm: true` never run unapproved.** The session loop calls the
  engine's `confirm` callback before dispatch (the CLI's interactive Yes/No
  selector; `--yes` pre-approves); with no callback or a non-interactive
  terminal the call is refused, never silently run.
- **Every tool call is appended to `~/.nt/audit`** as JSONL with credentials
  redacted, unless `config.audit` names another folder or is set to `off`. The
  folder is created owner-only (0700) and files 0600; lines are only appended.
- **Imports must resolve inside the project directory** unless
  `--allow-outside-imports` is passed. Loading also enforces file-size, file-count,
  and parse-depth limits from `constants.ts` for untrusted input.

### CLI (packages/cli)

- Thin layer over `@age.nt/engine`: `args.ts` (flags + help), `inspect.ts`
  (offline validate/list/graph), `commands.ts` (up/run/chat), `mcp/` (live MCP
  operations), `audit.ts`, `setup.ts`, lifecycle/output helpers, and `main.ts`;
  `bin/nt.mjs` is the launcher.
- **Defaults to `./age.nt` in the current directory**; `--file` / `--dir`
  override. `up` / `run` / `chat` call the model (need `ANTHROPIC_API_KEY`);
  `setup` / `validate` / `list` / `graph` / `audit` are offline.
- **`setup [dir]` scaffolds a project** through the engine, then loads the result
  so a fresh project is proven valid before the next steps are printed.

### VS Code extension (packages/vscode-nt)

- Plain CommonJS with editor globals; **excluded from the root eslint config**.
  Provides highlighting and IntelliSense (go-to-definition, hover, completion,
  outline, find-references) across imported `.nt` files.

### Docs (apps/docs)

- Fumadocs + Next.js 15 (App Router). **Light theme only** (dark mode and the
  theme toggle are disabled in `lib/layout.shared.tsx`). Content is MDX under
  `content/docs`, ordered by `meta.json` files; the marketing landing page lives
  in `app/(home)`.
- Brand logos and icons live in `components/logos.tsx`, reused by the home page
  and by MDX via `@/components/logos`.
- **Keep reference docs accurate to the engine.** The API reference mirrors
  `packages/engine/src/{types.ts,constants.ts,schema/}`; update docs when the
  schema changes.
- `lib/source.ts` normalizes the MDX source `files` to an array to bridge a
  `fumadocs-mdx` / `fumadocs-core` contract mismatch — don't remove that shim
  without re-checking the loader contract.

### Example (example/)

- The reference ecosystem: an `age` agent wired to a `researcher` subagent, a
  `current_year` tool, an `estimation` skill, a `workspace` sandbox, and an
  `estimate_age` workflow — each in its own file, imported by `age.nt`. The root
  `nt:*` scripts target it; keep it working as the living smoke test.

## Testing

- `pnpm test` runs `node --test` over `packages/engine/test/*.test.ts` and
  `packages/cli/test/*.test.ts`.
- Tests must not use the public network. The engine reaches models over `fetch`,
  so keep real provider calls out of the suite; isolated loopback servers are
  permitted for transport integration tests and must be closed deterministically.

## Git

- Conventional Commits enforced by commitlint (`feat:`, `fix:`, `docs:`,
  `chore:`, `refactor:`, `test:`, `ci:`, `build:`, `perf:`, `revert:`) via the
  husky `commit-msg` hook; `lint-staged` runs Prettier and ESLint on staged
  files.
- Never commit, push, or re-init the repo unless explicitly asked. If asked while
  on `main`, branch first.
