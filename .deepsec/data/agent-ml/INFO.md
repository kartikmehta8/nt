# agent-ml (NT)

## What this codebase does

NT is a declarative `.nt` language plus a runtime engine for spinning up
ecosystems of AI agents, subagents, sandboxes, tools, skills and workflows.
pnpm monorepo, no build step (Node ≥ 22.18 strips TypeScript directly):
`packages/engine` (`@age.nt/engine`, zero runtime deps, talks to models over
`fetch`), `packages/cli` (the `nt` command), `packages/vscode-nt` (extension),
`apps/docs` (Fumadocs/Next.js 15), `example/` (reference ecosystem). There is no
server, no database, and no user accounts — it is a local developer CLI that
executes model-chosen actions on the operator's machine. The security boundary
is **the model is untrusted; the `.nt` file author is trusted**.

## Auth shape

No authn/authz in the usual sense. The trust primitives are:

- `NT_ALLOW_LOCAL=1` — the only gate on `LocalSandbox`, which runs
  model-chosen shell commands on the host. Absent it, the constructor throws.
- `LocalSandbox.resolve()` + `realpathDeep()` — jails every file op under
  `root` (the realpath'd cwd), resolving symlinks on partially-existing paths.
  Any host fs/exec path that bypasses `resolve()` is a jail escape.
- `LocalSandbox.execEnv()` — rebuilds a minimal env from `SAFE_ENV_KEYS` so
  host credentials never reach model-chosen commands. Spreading
  `process.env` into a child process is a leak.
- `loadProject` / `isInside(root, target)` — imports must resolve inside the
  entry file's directory unless `allowOutsideImports`.
- `createRedactor()` / `collectSecrets(project)` — everything written to the
  audit log passes through these.

## Threat model

A malicious or prompt-injected model response is the primary attacker; a
hostile `.nt` file is secondary. Ranked by impact: (1) host command execution
or file access outside the sandbox root; (2) exfiltrating provider API keys or
host env vars — through a model-steered URL, a shell command, or the audit
log; (3) SSRF from `http` tools into cloud metadata / loopback services; (4)
resource exhaustion from unbounded parse depth, file size, response bodies, or
agent/delegation recursion.

## Project-specific patterns to flag

- **Model-supplied values reaching a command or URL unescaped.** `shell` tools
  must interpolate via `interpolateShell` (single-quoting) and `http` tools via
  `interpolateUrl` (percent-encoding). Plain `interpolate` is for prompts only
  — using it in `def.command` or `def.url` is command/URL injection.
- **`http` tool egress rules loosening.** `runHttpTool` must keep all of:
  `vetEgressHost` deny — literal IPs, localhost names, and DNS-resolved
  addresses checked against `isPrivateAddress` (unless `def.allowInternal`) —
  http(s)-only scheme check, `redirect: "manual"`, and the `originPinned`
  check that withholds declared headers when the model controls the URL's
  origin. Dropping `originPinned` sends provider secrets to an attacker host.
- **Tool dispatch bypassing the per-agent allowlist.** The session loop only
  dispatches `tool_use` names in `AgentRuntime.allowedTools`; a dispatch path
  that looks tools up globally by name reintroduces confused-deputy delegation.
- **Secrets in source, or non-https provider endpoints.** `declarations.ts`
  requires `api_key` be `env(NAME)` (and warns on an `env()` fallback literal),
  and `checkBaseUrl` requires https except for loopback. Weakening either, or
  putting a real key in a `.nt` file / template / doc example, is a finding.
- **Audit-log integrity.** `AuditLog.append` must stay append-only with
  `AUDIT_DIR_MODE` 0700 / `AUDIT_FILE_MODE` 0600, degrade to one `console.warn`
  on failure, and never log a value that skipped the redactor. Also flag new
  credential shapes not covered by `SECRET_KEY_RE` / `SECRET_VALUE_PATTERNS`.
- **Limits bypassed or duplicated.** `constants.ts` is the single source of
  truth for `MAX_AGENT_STEPS`, `MAX_DELEGATION_DEPTH`, `MAX_NT_FILE_BYTES`,
  `MAX_IMPORTED_FILES`, `MAX_PARSE_DEPTH`, `HTTP_TOOL_*`. A loop or reader that
  hardcodes its own bound, or drops the depth guard in `driveConversation`, is
  a DoS / runaway-cost path.
- **Scaffold writes clobbering files.** `scaffold/write.ts` must open with the
  `wx` flag unless `force`; a plain `w` silently destroys user files.

## Known false-positives

- `VirtualSandbox` (`packages/engine/src/sandbox.ts`) — its `exec` is a tiny
  in-memory shell (`cat`, `ls`, `echo >`, `rm`, `env`). It has no host access,
  so its lack of path jailing, its `rm`, and its `env` dump are not findings.
- `packages/engine/src/scaffold/{minimal,full}.ts` — `.nt` source stored as
  string data for `nt setup`, not executed code. Placeholder keys and example
  URLs there are intentional.
- `example/**` and `apps/docs/content/**` — the reference ecosystem and MDX
  docs. Illustrative `.nt` snippets, `env(...)` examples, and `bash`-tool
  declarations are documentation, not live config.
- `packages/*/test/**` — fixtures deliberately construct hostile input
  (path-escape attempts, oversized files, literal fake keys) to assert the
  guards fire. Tests never hit the network.
- `packages/cli/**` — `console.log` is the CLI's purpose and eslint exempts it;
  not an info-leak finding. `packages/vscode-nt` is plain CommonJS with editor
  globals and is excluded from the root eslint config.
- `LocalSandbox.exec` using `execSync` with a model-chosen string is the
  documented, opt-in-gated design (`NT_ALLOW_LOCAL=1`, trusted inputs only) —
  flag regressions in the gate or the jail, not the feature itself.
