/**
 * @file The `full` starter project written by `nt setup --template full`.
 *
 * The same `age` agent as the minimal template, wired to one of every capability
 * the language offers — a sandbox, shell and MCP tools, a skill, a subagent,
 * and a workflow — each in its own file so the layout scales. It validates
 * with no warnings and extends the repository's example with runnable MCP.
 */

import { FULL_MCP_FILES } from "#scaffold/full-mcp";
import type { ScaffoldFile } from "#types";

const AGE_NT = `# age.nt — the entry file. Every 'nt' command loads it by default.
#
# Try it:
#   nt validate   check every file, offline
#   nt graph      see how the agent wires to its tools and helpers
#   nt up         bring the ecosystem up, then run the entry agent

import ./config.nt
import ./sandboxes.nt
import ./skills.nt
import ./tools.nt
import ./mcp/local.nt
import ./subagents/researcher.nt
import ./workflows.nt

agent age
  description: Estimates a person's most likely age from the clues provided.
  thinking: high
  sandbox: workspace
  skills:
    - estimation
  tools:
    - current_year
    - fs_write
    - local_demo.echo
  subagents:
    - researcher
  instructions: |
    You estimate a person's most likely age from the clues provided.
    Use local_demo.echo to repeat the most important clue before reasoning.
    Call current_year whenever a clue implies a birth year or a relative date.
    Delegate to the researcher subagent to pin down the year of any event a
    clue references, such as a product launch or a graduation.
    Follow the estimation skill's checklist, then commit to one integer.
    Save your reasoning to notes.md with fs_write before you answer.
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
      description: A one-sentence justification.
`;

const CONFIG_NT = `# config.nt — settings every agent in this project shares.

config
  target: node
  # The agent 'nt up' runs when you do not name one.
  entry: age
  # Name each tool call and delegation in the terminal's thinking line while
  # the agent works, as if --show-tool-calls were always passed.
  show_tool_calls: true
  # Each agent uses these unless it declares its own.
  defaults:
    model: anthropic/claude-sonnet-5
    sandbox: workspace
    thinking: medium
    max_tokens: 8000
  # Every tool call is appended to a JSONL file in this folder, secrets
  # redacted. Read it back with 'nt audit', or set 'audit: off' to stop logging.
  audit: ~/.nt/audit
  providers:
    anthropic:
      api: anthropic
      # Never paste a real key here — env(NAME) reads it from your shell.
      api_key: env(ANTHROPIC_API_KEY)
`;

const SANDBOXES_NT = `# The workspace the agent reads, writes, and runs commands in.
#
# 'virtual' is an in-memory filesystem with a tiny built-in shell, so nothing
# touches your machine. Switch to 'local' only for trusted projects; it also
# needs NT_ALLOW_LOCAL=1.

sandbox workspace
  description: In-memory workspace where the agent writes notes and runs commands.
  type: virtual
  cwd: /workspace
`;

const SKILLS_NT = `# A reusable checklist the agent loads into its prompt.

skill estimation
  description: A checklist for estimating a person's age from indirect clues.
  instructions: |
    When estimating an age:
    1. Convert every clue to an approximate calendar year.
    2. Anchor each year to a typical life stage such as school or retirement.
    3. Measure the span from those anchors to the current year.
    4. Reconcile conflicting clues, then commit to a single integer estimate.
`;

const TOOLS_NT = `# A custom shell tool that runs inside the agent's sandbox.
#
# Tools can also be 'http'. Both fill {placeholders} from the model's arguments,
# escaped so a value can never inject shell syntax or URL structure.

tool current_year
  description: Return the current four-digit calendar year.
  type: shell
  command: date +%Y
  # Add 'confirm: true' and an interactive Yes/No selector asks before every
  # call; pass --yes to pre-approve. Recommended for shell tools and http POSTs.
`;

const RESEARCHER_NT = `# A specialist the age agent delegates date lookups to.

subagent researcher
  description: Pins down the calendar year of a named event or milestone.
  thinking: medium
  instructions: |
    Given a single event or milestone, respond with the calendar year it
    occurred, or a tight range, and nothing else.
`;

const WORKFLOWS_NT = `# A two-step workflow: pin down the year behind a clue, then estimate the age.
#
# Run it with:  nt run estimate_age -i '{"clues":"bought the first iPhone at 22"}'

workflow estimate_age
  description: Research the year a clue refers to, then estimate an age from it.
  agent: age
  input:
    clues: string
  output:
    estimate: object
  steps:
    - agent: researcher
      prompt: "What calendar year does this clue point to: {clues}"
      into: year
    - prompt: |
        Estimate the person's most likely age.
        Clues: {clues}
        Relevant year: {year}
      into: estimate
`;

export const FULL_FILES: ScaffoldFile[] = [
  { path: "age.nt", content: AGE_NT },
  { path: "config.nt", content: CONFIG_NT },
  { path: "sandboxes.nt", content: SANDBOXES_NT },
  { path: "skills.nt", content: SKILLS_NT },
  { path: "tools.nt", content: TOOLS_NT },
  ...FULL_MCP_FILES,
  { path: "subagents/researcher.nt", content: RESEARCHER_NT },
  { path: "workflows.nt", content: WORKFLOWS_NT },
];
