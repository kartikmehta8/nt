# @age.nt/nt

**NT is a small declarative language for building AI agents.** You describe your
models, agents, subagents, sandboxes, tools, skills and workflows in one clean
`.nt` file, and one command brings the whole ecosystem up against a real
language model — no glue code.

`@age.nt/nt` is the `nt` command-line interface.

- **Docs:** https://agent-lang.xyz
- **Source:** https://github.com/kartikmehta8/nt

## Install

```bash
npm install -g @age.nt/nt
```

Requires **Node ≥ 22.18** (NT runs its TypeScript engine directly via native type
stripping — there is no build step). To actually run an agent, set a provider
key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...
```

## Quick start

Let `nt` write a working project for you:

```bash
mkdir my-agent && cd my-agent
nt setup                 # writes age.nt + config.nt, then checks them
nt setup --template full # or: a sandbox, tool, skill, subagent and workflow too
```

Existing files are never overwritten — they are reported and left alone unless
you pass `--force`.

Or start by hand. Create a file called `age.nt`:

```yaml
agent age
  description: Guesses a person's age from clues.
  model: anthropic/claude-sonnet-5
  instructions: |
    Guess the person's most likely age from the clues you are given.
  input:
    clues: string
  output:
    age: number
    reason: string
```

Check it, then run it. Every command defaults to `./age.nt` in the current
folder, so you rarely type a file name:

```bash
nt validate
nt run age -i '{"clues":"bought the first iPhone at 22"}'
# { "age": 39, "reason": "The first iPhone came out in 2007." }
```

Prefer a conversation that remembers earlier turns?

```bash
nt chat age
```

## Commands

| Command          | What it does                                             |
| ---------------- | -------------------------------------------------------- |
| `nt setup [dir]` | Write a starter project into a folder (created if new).  |
| `nt validate`    | Parse and type-check every `.nt` file.                   |
| `nt list`        | List everything declared in your project.                |
| `nt graph`       | Show how agents wire to their tools, skills and helpers. |
| `nt up`          | Bring the ecosystem up, then run the default entry.      |
| `nt run <name>`  | Run one agent, subagent, or workflow.                    |
| `nt chat <name>` | Chat with an agent, back and forth.                      |
| `nt audit`       | Show where tool calls are logged, and the recent ones.   |

`setup`, `validate`, `list`, `graph`, and `audit` work offline; `up`, `run`, and
`chat` call the model and need a provider key.

While `up`, `run`, and `chat` wait on the model, an animated thinking line
(`✻ Pondering… (3s)`) shows in the terminal. It clears the moment the reply
arrives, and it is skipped entirely when output is piped or redirected. Add
`--show-tool-calls` and the line names each step as it happens — for example
`✻ Running tool fs_read… (4s)` or `✻ Delegating to researcher… (6s)`. Even an
instant tool call stays on screen for a moment so it is readable, and while a
subagent works the line keeps naming it.

## Options

| Option               | What it does                                                          |
| -------------------- | --------------------------------------------------------------------- |
| `-f, --file FILE`    | Entry `.nt` file to load; its imports are followed. Default `age.nt`. |
| `-d, --dir FOLDER`   | Load every `.nt` file in a folder instead.                            |
| `-i, --input JSON`   | Input to pass, as JSON (validated against the agent's `input`).       |
| `-m, --message TEXT` | Send a quick plain-text message instead of JSON.                      |
| `--run NAME`         | With `up`, run this agent or workflow after bring-up.                 |
| `-n, --tail N`       | With `audit`, how many recent tool calls to show (default 20).        |
| `--json`             | With `audit`, print the raw JSONL entries only.                       |
| `-t, --template`     | With `setup`, the starter to write: `minimal` (default) or `full`.    |
| `--force`            | With `setup`, replace files that already exist.                       |
| `--show-tool-calls`  | With `up`/`run`/`chat`, name each tool call and delegation live.      |
| `-v, --verbose`      | Print the agent / tool / delegation trace.                            |
| `-h, --help`         | Show help.                                                            |

## What you can declare

An `.nt` file is made of small, readable blocks:

- **`agent` / `subagent`** — a model with instructions, tools, skills, a sandbox
  and typed input/output. Agents delegate work to subagents.
- **`tool`** — a custom power: a `shell` command or an `http` call, with
  `{placeholders}` filled from model input. Built-ins: `fs_read`, `fs_write`,
  `fs_list`, `bash`.
- **`skill`** — reusable instructions loaded into an agent's prompt.
- **`sandbox`** — a safe `virtual` (in-memory) workspace, or a guarded `local`
  one for real host access.
- **`workflow`** — an ordered pipeline of steps that pass results forward.
- **`provider`** — the model backend (`anthropic` or any OpenAI-compatible API).
- **`config`** — project defaults, the entry to run, and where tool calls are
  audited (`audit: <folder>` or `audit: off`).
- **`import`** — split a project across files and pull them together.

See the full language and API reference at **https://agent-lang.xyz/docs**.

## Editor support

Install the **NT** extension for syntax highlighting and IntelliSense (go to
definition, hover, completion, outline):

- [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=KartikMehta.nt-agent-lang)
- [Open VSX](https://open-vsx.org/extension/KartikMehta/nt-agent-lang) — for Cursor, Windsurf,
  and VSCodium
