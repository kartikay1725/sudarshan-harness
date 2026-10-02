/**
 * @sudarshan/spec — `agent.md`.
 *
 * Markdown in, governed agent out. A spec describes persona, rules, workflow,
 * capabilities, scope, budgets and — most importantly — acceptance criteria the
 * Harness can check against the real system.
 *
 * A spec can narrow the boundary and add verification. It can never widen the
 * boundary: capability installation, permissions, scopes and protected paths
 * remain operator-controlled, and every action still passes the same gate.
 */
export type { AgentSpec } from "./types.js";
export { EMPTY_SPEC } from "./types.js";
export { parseAgentSpec, parseSimpleYaml, specToPolicyPatch, applySpecToPolicy } from "./parse.js";
export type { ParsedSpec } from "./parse.js";
export { parseVerifyBlock, tokenize } from "./verifyDsl.js";
export type { ParseResult } from "./verifyDsl.js";
export { loadAgentSpec, findAgentSpec, resolveAgent, renderSpecTemplate, SPEC_FILENAMES } from "./load.js";
export type { ResolvedAgent } from "./load.js";
