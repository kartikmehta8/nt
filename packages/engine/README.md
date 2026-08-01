# @age.nt/engine

The **NT language and runtime engine** — the library that powers the
[`nt` CLI](https://www.npmjs.com/package/@age.nt/nt). It parses `.nt` files,
builds and validates a typed project, talks to language-model providers over
`fetch`, runs sandboxes, and drives the agentic tool-use loop (including
delegation to subagents).

Most people use the [`nt` CLI](https://www.npmjs.com/package/@age.nt/nt). Reach
for this package directly when you want to **embed NT in your own app**.

- **Docs:** https://agent-lang.xyz
- **Source:** https://github.com/kartikmehta8/nt

## Install

```bash
npm install @age.nt/engine
```

Requires **Node ≥ 22.18**. There is **no build step** — the package's `exports`
point straight at the TypeScript source, which Node runs via native type
stripping. The engine has **zero runtime dependencies** and reaches the model
over `fetch`.

## Usage

### Run an agent

```ts
import { Engine } from "@age.nt/engine";

const engine = Engine.load("age.nt");
const result = await engine.runAgent("age", { clues: "retired last year" });

console.log(result.output); // { age: 66, reason: "…" } (parsed to the output schema)
console.log(result.text); // the raw model text
console.log(result.usage); // { input, output } token counts
```

### Run a workflow

```ts
const engine = Engine.load("age.nt");
const result = await engine.runWorkflow("estimate_age", {
  clues: "bought the first iPhone at 22",
});
```

### Watch progress

Pass `onStep` to observe every model call, tool dispatch, subagent delegation,
and workflow step as it happens — this is what powers the `nt` CLI's
`--show-tool-calls` thinking line:

```ts
import { Engine, type StepEvent } from "@age.nt/engine";

const engine = Engine.load("age.nt", {
  onStep: (event: StepEvent) => {
    console.error(`[${event.kind}] ${event.agent} → ${event.detail} (depth ${event.depth})`);
  },
});
await engine.runAgent("age", { clues: "graduated college in 2010" });
```

### Gate risky tools (human in the loop)

A tool declared with `confirm: true` in `.nt` only runs after your `confirm`
callback approves it — this is what powers the `nt` CLI's interactive Yes/No
selector and its `--yes` flag. **Wire no callback and gated tools are always
refused**, never silently run:

```ts
import { Engine, type ConfirmRequest } from "@age.nt/engine";

const engine = Engine.load("age.nt", {
  confirm: async (request: ConfirmRequest) => {
    return myReviewQueue.approve(request.agent, request.tool, request.input);
  },
});
```

### Scaffold a starter project

```ts
import { scaffoldProject } from "@age.nt/engine";

const result = scaffoldProject("./my-agent", { template: "full" });
console.log(result.created); // ["age.nt", "config.nt", "sandboxes.nt", …]
console.log(result.skipped); // files that already existed and were left alone
console.log(result.entry); // absolute path to the entry age.nt
```

Nothing is overwritten unless you pass `{ force: true }`.

### Load and inspect a project (offline, no model calls)

```ts
import { loadProject } from "@age.nt/engine";

const { project, warnings } = loadProject("age.nt");
console.log([...project.agents.keys()]); // ["age"]
console.log([...project.tools.keys()]); // ["current_year", …]
warnings.forEach((w) => console.warn(w));
```

## Public API

Everything is exported from the package barrel:

| Export             | What it is                                                 |
| ------------------ | ---------------------------------------------------------- |
| `Engine`           | Load a project and run agents / workflows, or bring it up. |
| `loadProject`      | Parse + build + validate into a typed `Project` (offline). |
| `discoverNtFiles`  | Find every `.nt` file under a directory.                   |
| `ChatSession`      | Stateful, multi-turn conversation with an agent.           |
| `scaffoldProject`  | Write a starter project (`minimal` or `full`) to a folder. |
| `TEMPLATE_NAMES`   | The starter templates `scaffoldProject` accepts.           |
| `readAuditEntries` | Read recent tool-call entries out of an audit folder.      |
| `auditFiles`       | List the audit log files in a folder, oldest first.        |
| `NtError`          | Error type carrying a source `Location`.                   |

## Security defaults

- **`local` sandboxes are opt-in** — they only run when `NT_ALLOW_LOCAL=1` is
  set; the default `virtual` sandbox never touches the host.
- **Provider `base_url` must be `https`** (localhost exempt) and API keys are
  read from `env(NAME)`, never stored in files.
- **`http` tools cannot reach private/localhost addresses** unless explicitly
  allowed.
- **Every tool call is audited** — appended as JSONL to `~/.nt/audit` (owner-only
  permissions) with credentials redacted. Point `config.audit` at another folder,
  or set `audit: off` to disable it.

See the full language and API reference at **https://agent-lang.xyz/docs**.
