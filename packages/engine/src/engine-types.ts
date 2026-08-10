/**
 * @file Public configuration and runnable-kind types for `Engine`.
 *
 * Keeps callback and MCP persistence options separate from the lifecycle-heavy
 * engine implementation, leaving its public methods readable within the
 * repository's file-size limit. These shapes contain no runtime behavior and
 * are re-exported through both `engine.ts` and the package barrel.
 */

import type { ConfirmRequest, StepEvent } from "#types";

export type RunnableKind = "agent" | "subagent" | "workflow";

export interface EngineOptions {
  verbose?: boolean;
  onStep?: (event: StepEvent) => void;
  confirm?: (request: ConfirmRequest) => Promise<boolean>;
  mcpTrustFile?: string;
  mcpCredentialFile?: string;
}
