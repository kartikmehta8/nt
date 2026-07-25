# NT (agent-lang.xyz)

Language support for **NT** — a small declarative language (`.nt` files) for
building AI agents. This extension gives `.nt` files **syntax highlighting** and
full **IntelliSense**: go to definition, hover, completion, outline, and find
references, across imported files.

- **Docs:** https://agent-lang.xyz
- **CLI:** [`@age.nt/nt`](https://www.npmjs.com/package/@age.nt/nt)
- **Source:** https://github.com/kartikmehta8/nt

## Features

**Syntax highlighting** for `import` statements, declaration keywords (`agent`,
`subagent`, `sandbox`, `tool`, `skill`, `workflow`, `provider`, `config`), entity
names, field keys, `env(...)`, block scalars, strings, and numbers.

**IntelliSense** (works within a file and across imported files):

- **Go to Definition** — F12 or Ctrl/Cmd-click a tool, subagent, sandbox, skill,
  workflow, or agent name to jump to its declaration, in the same file or
  another. Works on `import ./path.nt` paths too.
- **Hover** — see an entity's kind, description, and defining location. Built-in
  tools (`fs_read`, `fs_write`, `fs_list`, `bash`) show a description.
- **Completion** — inside `tools:` / `subagents:` / `skills:` lists and after
  `sandbox:`, suggests the matching declared names (plus built-in tools). At the
  start of a line, suggests declaration keywords.
- **Outline & breadcrumbs** — every declaration appears in the Outline view and
  the "Go to Symbol" (Ctrl/Cmd-Shift-O) picker.
- **Find All References** — right-click a name → Find All References.

The index refreshes automatically as you edit, save, create, or delete `.nt`
files, so definitions stay current across the whole workspace.

## Install

**In VS Code:** open the Extensions view (Ctrl/Cmd-Shift-X), search for
**"NT (agent-lang.xyz)"**, and click Install. Or from a terminal:

```bash
code --install-extension KartikMehta.nt
```

**In Cursor, Windsurf, or VSCodium:** install from
[Open VSX](https://open-vsx.org/extension/KartikMehta/nt) (search
"NT (Agent Lang)" in the Extensions view).

Any file ending in `.nt` is picked up automatically.

## What is NT

NT lets you describe an AI agent — its model, tools, skills, sandbox, subagents,
and typed input/output — in one clean `.nt` file, then run it with a single
command:

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

Install the CLI with `npm install -g @age.nt/nt` and run `nt run age`. See the
full guide at **https://agent-lang.xyz**.
