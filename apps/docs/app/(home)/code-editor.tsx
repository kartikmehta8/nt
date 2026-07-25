"use client";

import { useEffect, useState } from "react";
import { NtFileIcon, FolderIcon } from "@/components/logos";

/* ---------------------------------------------------------------------------
   The example ecosystem's files, shown read-only in a VS Code-style panel.
   Content mirrors example/*.nt in the repo.
   ------------------------------------------------------------------------- */

interface NtFile {
  id: string;
  name: string;
  folder?: string;
  content: string;
}

const FILES: NtFile[] = [
  {
    id: "age",
    name: "age.nt",
    content: `# age.nt — the entry file for this ecosystem.
# It imports every capability, then wires them onto one agent.

import ./config.nt
import ./sandboxes.nt
import ./skills.nt
import ./tools.nt
import ./subagents/researcher.nt

agent age
  description: Estimates a person's most likely age from clues.
  model: anthropic/claude-sonnet-5
  thinking: high
  sandbox: workspace
  skills:
    - estimation
  tools:
    - current_year
    - fs_write
  subagents:
    - researcher
  instructions: |
    You estimate a person's most likely age from the clues provided.
    Call current_year whenever a clue implies a birth year.
    Delegate to the researcher to pin down the year of an event.
    Follow the estimation checklist, then commit to one integer.
  input:
    clues:
      type: string
      description: Any details that hint at the person's age.
  output:
    age:
      type: number
      description: The single best age estimate.
    reason:
      type: string
      description: A one-sentence justification.`,
  },
  {
    id: "config",
    name: "config.nt",
    content: `# Project defaults and the language-model providers.

config
  target: node
  entry: age
  defaults:
    model: anthropic/claude-sonnet-5
    sandbox: workspace
    thinking: medium
    max_tokens: 8000
  providers:
    anthropic:
      api: anthropic
      api_key: env(ANTHROPIC_API_KEY)
    ollama:
      api: openai-completions
      base_url: http://localhost:11434/v1
      api_key: env(OLLAMA_API_KEY, ollama)`,
  },
  {
    id: "tools",
    name: "tools.nt",
    content: `# A custom shell tool that runs in the agent's sandbox.

tool current_year
  description: Return the current four-digit calendar year.
  type: shell
  command: date +%Y`,
  },
  {
    id: "skills",
    name: "skills.nt",
    content: `# A reusable checklist the agent loads for age estimation.

skill estimation
  description: A checklist for estimating a person's age.
  instructions: |
    When estimating an age:
    1. Convert every clue to an approximate calendar year.
    2. Anchor each year to a typical life stage.
    3. Measure the span from those anchors to today.
    4. Reconcile conflicts, then commit to one integer.`,
  },
  {
    id: "sandboxes",
    name: "sandboxes.nt",
    content: `# The in-memory workspace the agent reads and writes.

sandbox workspace
  description: In-memory workspace for notes and commands.
  type: virtual
  cwd: /workspace`,
  },
  {
    id: "researcher",
    name: "researcher.nt",
    folder: "subagents",
    content: `# A specialist the age agent delegates date lookups to.

subagent researcher
  description: Pins down the calendar year of an event.
  thinking: medium
  instructions: |
    Given a single event or milestone, respond with the
    calendar year it occurred, or a tight range, and nothing else.`,
  },
];

/* ---------------------------------------------------------------------------
   Minimal .nt syntax highlighter — line-based, good enough for these files.
   ------------------------------------------------------------------------- */

type Seg = { t: string; c: string | null };

const KEYWORDS = [
  "import",
  "config",
  "provider",
  "agent",
  "subagent",
  "sandbox",
  "tool",
  "skill",
  "workflow",
];

/** Highlight the value after a `key:` (strings, numbers, env(), lists). */
function pushValue(v: string, segs: Seg[]): void {
  if (v === "") return;
  const lead = v.match(/^\s*/)?.[0] ?? "";
  if (lead) segs.push({ t: lead, c: null });
  const val = v.slice(lead.length);
  if (val === "") return;
  if (val === "|") segs.push({ t: "|", c: "p" });
  else if (/^\d+$/.test(val)) segs.push({ t: val, c: "num" });
  else if (val.startsWith("env(")) segs.push({ t: val, c: "fn" });
  else segs.push({ t: val, c: "s" });
}

/** Highlight a de-indented content fragment (keyword decl, key:value, list). */
function pushContent(content: string, segs: Seg[]): void {
  const fw = content.split(/\s/)[0];
  if (KEYWORDS.includes(fw) && (content.length === fw.length || content[fw.length] === " ")) {
    segs.push({ t: fw, c: "k" });
    const after = content.slice(fw.length);
    if (after) segs.push({ t: after, c: fw === "import" ? "s" : "n" });
    return;
  }
  const kv = content.match(/^([A-Za-z0-9_-]+)(:)(.*)$/);
  if (kv) {
    segs.push({ t: kv[1], c: "key" });
    segs.push({ t: ":", c: "p" });
    pushValue(kv[3], segs);
    return;
  }
  segs.push({ t: content, c: null });
}

/** Tokenize one line into styled segments. */
function highlightLine(line: string): Seg[] {
  const segs: Seg[] = [];
  const indent = line.match(/^\s*/)?.[0] ?? "";
  if (indent) segs.push({ t: indent, c: null });
  let rest = line.slice(indent.length);
  if (rest === "") return segs;
  if (rest.startsWith("#")) {
    segs.push({ t: rest, c: "c" });
    return segs;
  }
  let comment: string | null = null;
  const hi = rest.search(/\s#/);
  if (hi !== -1) {
    comment = rest.slice(hi);
    rest = rest.slice(0, hi);
  }
  if (rest.startsWith("- ")) {
    segs.push({ t: "- ", c: "p" });
    pushContent(rest.slice(2), segs);
  } else {
    pushContent(rest, segs);
  }
  if (comment) segs.push({ t: comment, c: "c" });
  return segs;
}

/** Tokenize a whole file, keeping block-scalar (`|`) bodies as plain text. */
function tokenize(code: string): Seg[][] {
  const lines = code.split("\n");
  const out: Seg[][] = [];
  let blockIndent: number | null = null;
  for (const line of lines) {
    const indent = (line.match(/^\s*/)?.[0] ?? "").length;
    const trimmed = line.trim();
    if (blockIndent !== null) {
      if (trimmed === "") {
        out.push([{ t: line, c: null }]);
        continue;
      }
      if (indent > blockIndent) {
        out.push([{ t: line, c: "blk" }]);
        continue;
      }
      blockIndent = null;
    }
    out.push(highlightLine(line));
    if (/:\s*\|\s*$/.test(line)) blockIndent = indent;
  }
  return out;
}

/* ---------------------------------------------------------------------------
   Component
   ------------------------------------------------------------------------- */

export function CodeEditor() {
  const [active, setActive] = useState(0);
  const file = FILES[active];
  const lines = tokenize(file.content);

  // Auto-advance through files; any click resets the timer via `active` dep.
  useEffect(() => {
    const id = setTimeout(() => setActive((a) => (a + 1) % FILES.length), 5200);
    return () => clearTimeout(id);
  }, [active]);

  const rootFiles = FILES.filter((f) => !f.folder);
  const folderFiles = FILES.filter((f) => f.folder);

  return (
    <div className="nt-vscode nt-reveal" data-delay="2">
      {/* Title bar */}
      <div className="nt-vscode-title">
        <span className="nt-vscode-lights">
          <i />
          <i />
          <i />
        </span>
        <span className="nt-vscode-titletext">{file.name} — example</span>
      </div>

      <div className="nt-vscode-body">
        {/* Activity bar */}
        <div className="nt-vscode-activity">
          <span className="on" aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path
                fill="currentColor"
                d="M20.9 7.9 12 3 3.1 7.9 12 12.8l8.9-4.9ZM3 9.4v7.2L11 21v-7.2L3 9.4Zm10 4.4V21l8-4.4V9.4l-8 4.4Z"
              />
            </svg>
          </span>
          <span aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path
                fill="currentColor"
                d="M10 4a6 6 0 1 0 3.7 10.7l4.8 4.8 1.4-1.4-4.8-4.8A6 6 0 0 0 10 4Zm0 2a4 4 0 1 1 0 8 4 4 0 0 1 0-8Z"
              />
            </svg>
          </span>
          <span aria-hidden>
            <svg viewBox="0 0 24 24" width="20" height="20">
              <path
                fill="currentColor"
                d="M6 3a3 3 0 0 0-1 5.8V15a3 3 0 1 0 2 0V8.8A3 3 0 0 0 6 3Zm12 0a3 3 0 0 0-1 5.8V9a3 3 0 0 1-3 3h-2v-1l-3 2 3 2v-1h2a5 5 0 0 0 5-5v-.2A3 3 0 0 0 18 3Z"
              />
            </svg>
          </span>
        </div>

        {/* Explorer */}
        <div className="nt-vscode-side">
          <div className="nt-vscode-sidehead">Explorer</div>
          <div className="nt-vscode-folder">
            <span className="chev">⌄</span>
            <FolderIcon size={15} /> example
          </div>
          {rootFiles.map((f) => (
            <button
              key={f.id}
              className={`nt-vscode-file${f.id === file.id ? " on" : ""}`}
              onClick={() => setActive(FILES.indexOf(f))}
            >
              <NtFileIcon size={15} />
              {f.name}
            </button>
          ))}
          <div className="nt-vscode-folder sub">
            <span className="chev">⌄</span>
            <FolderIcon size={15} /> subagents
          </div>
          {folderFiles.map((f) => (
            <button
              key={f.id}
              className={`nt-vscode-file sub${f.id === file.id ? " on" : ""}`}
              onClick={() => setActive(FILES.indexOf(f))}
            >
              <NtFileIcon size={15} />
              {f.name}
            </button>
          ))}
        </div>

        {/* Editor */}
        <div className="nt-vscode-main">
          <div className="nt-vscode-tabs">
            <span className="nt-vscode-tab on">
              <NtFileIcon size={15} />
              {file.name}
            </span>
          </div>
          <div className="nt-vscode-code" key={file.id}>
            {lines.map((segs, i) => (
              <div
                className="nt-ed-line"
                key={i}
                style={{ animationDelay: `${Math.min(i * 16, 520)}ms` }}
              >
                <span className="nt-ed-gutter">{i + 1}</span>
                <span className="nt-ed-text">
                  {segs.map((s, j) =>
                    s.c ? (
                      <span className={`t-${s.c}`} key={j}>
                        {s.t}
                      </span>
                    ) : (
                      <span key={j}>{s.t}</span>
                    ),
                  )}
                </span>
              </div>
            ))}
          </div>
          <div className="nt-vscode-status">
            <span>NT</span>
            <span>UTF-8</span>
            <span>Spaces: 2</span>
            <span className="grow" />
            <span>Ln {lines.length}, Col 1</span>
          </div>
        </div>
      </div>
    </div>
  );
}
