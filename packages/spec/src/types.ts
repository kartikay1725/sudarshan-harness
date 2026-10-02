import type { CheckSpec, Policy, RiskLevel } from "@sudarshan/core";

/**
 * An `agent.md` specification.
 *
 * The point of the markdown spec is that a person should be able to describe an
 * agent without writing TypeScript: who it is, what it may touch, what it must
 * never do, and — most importantly — what "done" means in terms the Harness can
 * check against the real system.
 */
export interface AgentSpec {
  name?: string;
  description?: string;
  /** Markdown body under `# Persona` (or the whole document if no section). */
  persona?: string;
  /** Bullets under `## Rules`. */
  rules: string[];
  /** Bullets under `## Workflow` — advisory ordering, never enforced steps. */
  workflow: string[];
  /** Capability ids to install/enable. */
  capabilities: string[];
  /** Capabilities explicitly removed. */
  removeCapabilities: string[];
  /** Extra permissions to grant. */
  permissions: string[];
  approval: { risk: RiskLevel[]; tools: string[] };
  scopes: { fsRoots?: string[]; fsDeny?: string[]; allowCommands?: string[]; denyCommands?: string[]; allowHosts?: string[]; denyHosts?: string[] };
  budgets: Partial<Policy["budgets"]>;
  model?: { adapter?: string; model?: string; temperature?: number; maxTokens?: number };
  /** Task-level acceptance criteria parsed from `## Verify`. */
  verification: CheckSpec[];
  /** Raw text, for the IDE's spec view. */
  raw: string;
  path?: string;
  /** Anything the parser could not honour. Surfaced, never silently dropped. */
  warnings: string[];
}

export const EMPTY_SPEC: AgentSpec = {
  rules: [],
  workflow: [],
  capabilities: [],
  removeCapabilities: [],
  permissions: [],
  approval: { risk: [], tools: [] },
  scopes: {},
  budgets: {},
  verification: [],
  raw: "",
  warnings: [],
};
