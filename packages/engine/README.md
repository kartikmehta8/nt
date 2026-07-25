# @age.nt/engine

The NT language and runtime engine: the `.nt` parser, the schema/validation
layer, language-model providers, sandboxes, and the agentic session loop.

Consumed by the [`nt` CLI](../cli). The public API is the package barrel
(`src/index.ts`) — `Engine`, `loadProject`, `discoverNtFiles`, `ChatSession`,
`NtError`, and the typed `Project` / definition shapes (including the types
they reference: `BuildResult`, `LoadOptions`, `Location`, `FieldType`,
`ConfigDefaults`, `WorkflowStep`, `NtValue`, `EnvRef`):

```ts
import { Engine, loadProject } from "@age.nt/engine";

const engine = Engine.load("example/age.nt");
const result = await engine.runAgent("age", { clues: "retired last year" });
```

No build step: the package's `exports` point straight at the TypeScript source,
which Node runs via type stripping. See the [root README](../../README.md) for
the language reference and full architecture.
