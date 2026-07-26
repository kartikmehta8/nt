/**
 * @file The `minimal` starter project written by `nt setup`.
 *
 * Two files: `age.nt`, the entry every `nt` command loads by default, and
 * `config.nt`, holding the provider and the defaults its agent inherits. The
 * pair validates with no warnings and runs as soon as a provider key is set.
 */

import type { ScaffoldFile } from "#types";

const AGE_NT = `# age.nt — the entry file. Every 'nt' command loads it by default.
#
# Try it:
#   nt validate                                     check the project, offline
#   nt run age -m "bought the first iPhone at 22"   ask the agent once
#   nt chat age                                     keep a conversation going

import ./config.nt

agent age
  description: Estimates a person's most likely age from the clues provided.
  thinking: medium
  instructions: |
    You estimate a person's most likely age from the clues provided.
    Turn each clue into an approximate calendar year, anchor those years to a
    typical life stage such as school or a first job, reconcile anything that
    conflicts, then commit to a single integer.
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
  # The agent 'nt up' runs when you do not name one.
  entry: age
  # Each agent uses these unless it declares its own.
  defaults:
    model: anthropic/claude-sonnet-5
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

export const MINIMAL_FILES: ScaffoldFile[] = [
  { path: "age.nt", content: AGE_NT },
  { path: "config.nt", content: CONFIG_NT },
];
