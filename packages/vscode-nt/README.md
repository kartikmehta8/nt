# NT language support for VS Code

Syntax highlighting **and** IntelliSense for `.nt` files.

## Features

**Highlighting** — `import` statements, declaration keywords (`agent`,
`subagent`, `sandbox`, `tool`, `skill`, `workflow`, `provider`, `config`),
entity names, field keys, `env(...)`, block scalars, strings, and numbers.

**IntelliSense** (works within a file and across imported files):

- **Go to Definition** — F12 or Ctrl/Cmd-click a tool, subagent, sandbox,
  skill, workflow, or agent name to jump to where it is declared, in the same
  file or another. Works on `import ./path.nt` paths too (opens the file).
- **Hover** — hover a name to see its kind, description, and defining location.
  Built-in tools (`fs_read`, `fs_write`, `fs_list`, `bash`) show a description.
- **Completion** — inside `tools:` / `subagents:` / `skills:` lists and after
  `sandbox:`, suggests the matching declared names (plus built-in tools). At the
  start of a line, suggests declaration keywords.
- **Outline & breadcrumbs** — every declaration appears in the Outline view and
  the "Go to Symbol" (Ctrl/Cmd-Shift-O) picker.
- **Find All References** — right-click a name → Find All References.

The index refreshes automatically as you edit, save, create, or delete `.nt`
files, so definitions stay current across the whole workspace.

## Install (offline, no marketplace)

VS Code loads extensions from `~/.vscode/extensions`. Link this folder there:

```bash
ln -s "$PWD/packages/vscode-nt" ~/.vscode/extensions/vscode-nt
```

Then run **Developer: Reload Window** (Command Palette). The status bar should
read **NT** on any `.nt` file, and F12 on a name should jump to its declaration.

This repo's `.vscode/settings.json` already associates `*.nt` with the `nt`
language. To uninstall: `rm ~/.vscode/extensions/vscode-nt` and reload.

## Layout

```
packages/vscode-nt/
  package.json                 language + grammar + extension entry
  language-configuration.json  comments, brackets, indentation
  syntaxes/nt.tmLanguage.json   TextMate grammar (highlighting)
  ntIndex.js                   scans .nt files into a declaration index
  providers.js                 definition, hover, symbol, completion, references
  extension.js                 activation + provider registration
```
