/**
 * @file Static NT source files displayed by the homepage editor preview.
 *
 * Mirrors the canonical multi-file example closely enough to demonstrate
 * imports, providers, agents, MCP servers, sandboxes, tools, skills, and
 * delegation without loading repository files at runtime. Keeping the content
 * separate from the React shell makes drift visible and keeps the component
 * below the repository's file-size convention.
 */

export interface PreviewFile {
  id: string;
  name: string;
  folder?: string;
  content: string;
}

export const PREVIEW_FILES: PreviewFile[] = [
  {
    id: "age",
    name: "age.nt",
    content: `# age.nt — the entry file for this ecosystem.
# It imports every capability, then wires them onto one agent.

import ./config.nt
import ./sandboxes.nt
import ./skills.nt
import ./tools.nt
import ./mcp/history.nt
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
    - history.search_events
    - fs_write
  subagents:
    - researcher
  instructions: |
    You estimate a person's most likely age from the clues provided.
    Call current_year whenever a clue implies a birth year.
    Search the trusted history server when a clue names an event.
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
  show_tool_calls: true
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
  command: date +%Y
  # An interactive Yes/No selector asks before every call; --yes pre-approves.
  confirm: true`,
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
    id: "history",
    name: "history.nt",
    folder: "mcp",
    content: `# A reviewed remote MCP server with one selected tool.

mcp history
  description: Search a historical timeline for dates and events.
  transport: streamable_http
  url: https://mcp.example.com/history
  auth:
    type: bearer
    token: env(HISTORY_MCP_TOKEN)
  tools:
    search_events:
      approval: once`,
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
