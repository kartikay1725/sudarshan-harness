/**
 * @sudarshan/core — the Sudarshan Harness kernel.
 *
 *   Let the AI decide how to do the work.
 *   Let Sudarshan decide what it is allowed to do, and whether it actually did it.
 */

export * from "./types.js";
export { Harness, anySignal } from "./harness.js";
export type { HarnessOptions, DoctorReport } from "./harness.js";

export { EventBus } from "./events/bus.js";
export { AuditTrail } from "./audit/trail.js";
export { CapabilityRegistry, defineCapability, validateCapability } from "./capability/registry.js";
export type { InstalledCapability } from "./capability/registry.js";
export { ApprovalQueue, classOf } from "./approval/queue.js";
export type { ApprovalRequest, ApprovalResolution, ApprovalStatus } from "./approval/queue.js";
export { defaultPolicy, mergePolicy, matchRules, permissionGranted, maxRisk, DEFAULT_BUDGETS } from "./policy/policy.js";
export { resolveScopedPath, checkCommand, checkHost, checkTargets } from "./policy/scope.js";
export { AuthorizationGate } from "./gate/authorize.js";
export type { GateRequest, GateOutcome } from "./gate/authorize.js";
export { ActionExecutor, formatVerification, BLOCKED_PREAMBLE, FAILED_VERIFICATION_PREAMBLE, DEFAULT_TOOL_TIMEOUT_MS } from "./executor/executor.js";
export { VerificationEngine, labelFor } from "./verification/engine.js";
export { StateStore } from "./state/store.js";
export type { Snapshot, PathSnapshot } from "./state/store.js";
export { AgentSre, DEFAULT_SRE_LIMITS } from "./sre/watchdog.js";
export { BudgetTracker } from "./sre/budget.js";
export { BlindVerifier, parseVerdict } from "./verifier/blind.js";
export { RunOrchestrator, parseTextProtocol, resolveToolName } from "./run/orchestrator.js";
export type { OrchestratorDeps, RunOptions } from "./run/orchestrator.js";
export { buildSystemPrompt, buildToolSpecs, buildTaskMessage, buildInterventionMessage } from "./prompt/builder.js";
export { validateArgs } from "./util/schema.js";
export type { SchemaIssue } from "./util/schema.js";
export { canonicalJson, sha256, shortHash, newId, nowIso, globMatch, globToRegExp, redact, redactDeep, truncate, sleep, clamp } from "./util/index.js";
