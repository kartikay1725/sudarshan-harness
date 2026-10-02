/**
 * Sudarshan Harness — core type system.
 *
 * The single most important invariant in this codebase:
 *
 *      COMPLETED != VERIFIED
 *
 * An agent may *claim* completion. Only the Harness may *decide* verification,
 * and it decides using facts observed from the real system, not opinions.
 */

/* ------------------------------------------------------------------ *
 * Model layer (intelligence providers)
 * ------------------------------------------------------------------ */

export type ChatRole = "system" | "user" | "assistant" | "tool";

export interface ToolCall {
  id: string;
  /** Fully qualified tool name, e.g. `filesystem.write`. */
  name: string;
  arguments: Record<string, unknown>;
}

export interface ChatMessage {
  role: ChatRole;
  content: string;
  /** Present on assistant messages that request actions. */
  toolCalls?: ToolCall[];
  /** Present on `tool` messages: which call this answers. */
  toolCallId?: string;
  name?: string;
}

/** A plain JSON-Schema-ish object. Kept loose so capabilities can describe any shape. */
export type JsonSchema = Record<string, unknown>;

export interface ToolSpec {
  name: string;
  description: string;
  parameters: JsonSchema;
}

export interface Usage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd?: number;
}

export type StopReason = "tool_use" | "end_turn" | "length" | "error";

export interface CompletionRequest {
  model: string;
  messages: ChatMessage[];
  tools?: ToolSpec[];
  temperature?: number;
  maxTokens?: number;
  system?: string;
}

export interface CompletionResponse {
  content: string;
  toolCalls: ToolCall[];
  usage: Usage;
  stopReason: StopReason;
  /** Adapter identifier that produced this response. */
  adapterId: string;
  raw?: unknown;
}

export interface ModelAdapter {
  readonly id: string;
  readonly label: string;
  readonly supportsTools: boolean;
  /** True when the adapter is usable right now (keys present, server reachable, ...). */
  available(): boolean;
  complete(req: CompletionRequest, opts?: { signal?: AbortSignal }): Promise<CompletionResponse>;
}

/* ------------------------------------------------------------------ *
 * Risk / reversibility vocabulary
 * ------------------------------------------------------------------ */

export type RiskLevel = "low" | "medium" | "high" | "critical";

export const RISK_ORDER: Record<RiskLevel, number> = {
  low: 0,
  medium: 1,
  high: 2,
  critical: 3,
};

/**
 * REVERSIBLE      — the Harness can restore the exact prior state.
 * COMPENSATABLE   — the exact state is gone, but a counter-action restores intent.
 * IRREVERSIBLE    — no undo exists (money sent, email delivered, force-pushed).
 * UNKNOWN         — the capability did not declare it; treated as irreversible.
 */
export type Reversibility = "reversible" | "compensatable" | "irreversible" | "unknown";

/* ------------------------------------------------------------------ *
 * Capabilities (LEGO blocks)
 * ------------------------------------------------------------------ */

export type ScopeTargetKind = "path" | "command" | "url" | "resource";

export interface ScopeTarget {
  kind: ScopeTargetKind;
  value: string;
}

export interface ActionClassification {
  risk: RiskLevel;
  reversibility: Reversibility;
  /** What real-world resources this call touches — used for scope checks. */
  targets: ScopeTarget[];
  /** Human approval needed regardless of policy defaults? */
  requiresApproval?: boolean;
  /** Deterministic checks the Harness should run *after* execution. */
  checks?: CheckSpec[];
  /** Stable signature used for loop detection. */
  signature?: string;
}

export interface Evidence {
  /** What was observed, e.g. `fs.stat`, `shell.exitCode`, `http.status`. */
  source: string;
  fact: string;
  value?: unknown;
  observedAt: string;
}

export interface UndoOp {
  /** Which registered undo handler can replay this. */
  kind: string;
  description: string;
  payload: Record<string, unknown>;
}

export interface ToolResult {
  outcome: "success" | "error" | "timeout" | "blocked";
  /** Structured output for the Harness / IDE. */
  output?: unknown;
  /** Short model-facing text. The Harness may append verification results to it. */
  text?: string;
  error?: { code: string; message: string };
  evidence?: Evidence[];
  undo?: UndoOp[];
  /** Metrics used by budgets and Agent SRE. */
  metrics?: Record<string, number>;
  /** Capabilities may escalate/de-escalate risk after seeing real behaviour. */
  observedRisk?: RiskLevel;
}

export interface ToolContext {
  workspaceRoot: string;
  runId: string;
  stepId: string;
  /** Capability-scoped configuration supplied by the user / agent.md. */
  config: Record<string, unknown>;
  env: Record<string, string | undefined>;
  log(message: string, level?: LogLevel): void;
  signal?: AbortSignal;
  /** Emit observed evidence into the audit trail. */
  recordEvidence(evidence: Evidence): void;
}

export interface ToolDefinition {
  /** Fully qualified: `<capabilityId>.<toolName>`. */
  name: string;
  description: string;
  parameters: JsonSchema;
  /** Permission string required from policy, e.g. `fs.write`. */
  permission: string;
  defaultRisk: RiskLevel;
  defaultReversibility: Reversibility;
  /** Static "always ask a human" flag (irreversible external effects). */
  requiresApproval?: boolean;
  /** Per-tool execution timeout; defaults to the Harness-wide timeout. */
  timeoutMs?: number;
  /** Pre-execution classification from concrete arguments. */
  classify?(args: Record<string, unknown>, ctx: ToolContext): ActionClassification | Promise<ActionClassification>;
  execute(args: Record<string, unknown>, ctx: ToolContext): Promise<ToolResult>;
}

export interface UndoContext {
  workspaceRoot: string;
  policy: Policy;
  log(message: string, level?: LogLevel): void;
}

export interface UndoOutcome {
  ok: boolean;
  detail: string;
  /** Did the system actually return to the captured prior state? */
  verified: boolean;
}

/** Registered by a capability so the Harness can replay a reversal. */
export interface UndoHandler {
  kind: string;
  description?: string;
  run(payload: Record<string, unknown>, ctx: UndoContext): Promise<UndoOutcome>;
}

export interface CapabilityHealth {
  ok: boolean;
  detail?: string;
}

export interface Capability {
  id: string;
  name: string;
  version: string;
  description: string;
  /** Permissions this capability needs to be granted. */
  permissions: string[];
  tools: ToolDefinition[];
  /** User-tunable knobs surfaced in the IDE. */
  configSchema?: JsonSchema;
  /** Reversal handlers for the `undo` ops this capability emits. */
  undoHandlers?: UndoHandler[];
  healthCheck?(ctx: ToolContext): Promise<CapabilityHealth>;
}

/* ------------------------------------------------------------------ *
 * Policy / authorization
 * ------------------------------------------------------------------ */

export type PolicyEffect = "allow" | "deny";

export interface PolicyRule {
  id?: string;
  effect: PolicyEffect;
  /** Match a permission prefix, e.g. `fs.*` or `shell.exec`. */
  permission?: string;
  /** Match a fully qualified tool name, e.g. `filesystem.delete`. */
  tool?: string;
  /** Match scope targets by kind + glob. */
  target?: { kind: ScopeTargetKind; match: string };
  /** Match on argument values (shallow glob on stringified value). */
  argsMatch?: Record<string, string>;
  /** Force human approval instead of a hard allow/deny. */
  requireApproval?: boolean;
  reason: string;
}

export interface ScopePolicy {
  /** Filesystem roots the agent may touch. Paths outside are denied. */
  fsRoots: string[];
  /** Never touch these, even inside a root (glob, relative or absolute). */
  fsDeny: string[];
  /** Shell working directory + command policy. */
  shell: {
    cwd: string;
    allowCommands?: string[];
    denyCommands?: string[];
    maxOutputBytes: number;
    timeoutMs: number;
  };
  net: {
    allowHosts?: string[];
    denyHosts?: string[];
    timeoutMs: number;
  };
}

export interface BudgetPolicy {
  maxSteps: number;
  maxToolCalls: number;
  maxTokens: number;
  maxWallClockMs: number;
  /** Same action signature repeated this many times => loop intervention. */
  maxRepeatedActions: number;
  /** Consecutive steps without a verified state change => stall intervention. */
  maxUnverifiedSteps: number;
}

export interface ApprovalPolicy {
  /** Risk levels that always need a human. */
  requireForRisk: RiskLevel[];
  /** Reversibility classes that always need a human. */
  requireForReversibility: Reversibility[];
  /** Tool names that always need a human. */
  requireForTools: string[];
  /**
   * When a human approves, they may approve the whole *class* of action so
   * autonomy is not destroyed by a hundred dialogs.
   */
  allowClassApproval: boolean;
}

export interface VerificationPolicy {
  /** Verify every action, not just the final result. */
  perAction: boolean;
  /** Run the secondary blind verifier before declaring success. */
  blindVerifier: boolean;
  /** Treat indeterminate verification as failure (strict) or as a warning. */
  strict: boolean;
  /** Task-level expectations that must all pass for the run to be VERIFIED. */
  expectations: CheckSpec[];
}

export interface Policy {
  /** Deny unless explicitly allowed. Recommended true. */
  denyByDefault: boolean;
  /** Permissions granted to the agent. `*` grants everything not denied. */
  permissions: string[];
  rules: PolicyRule[];
  scopes: ScopePolicy;
  budgets: BudgetPolicy;
  approval: ApprovalPolicy;
  verification: VerificationPolicy;
  /** Protected paths — governance pillar. Always denied regardless of grants. */
  protectedPaths: string[];
}

export type DenialCode =
  | "capability_not_installed"
  | "capability_disabled"
  | "permission_not_granted"
  | "scope_violation"
  | "protected_path"
  | "policy_deny"
  | "budget_exhausted"
  | "approval_required"
  | "loop_detected"
  | "invalid_arguments"
  | "unknown_tool";

export interface AuthorizationDecision {
  allowed: boolean;
  tool: string;
  permission: string;
  risk: RiskLevel;
  reversibility: Reversibility;
  targets: ScopeTarget[];
  code?: DenialCode;
  reason: string;
  /** Rule that produced the decision, if any. */
  ruleId?: string;
  /** Set when the action is allowed but must pause for a human. */
  approvalRequired: boolean;
  decidedAt: string;
}

/* ------------------------------------------------------------------ *
 * Verification
 * ------------------------------------------------------------------ */

export type CheckSpec =
  | { kind: "file_exists"; path: string }
  | { kind: "file_absent"; path: string }
  | { kind: "file_contains"; path: string; text?: string; regex?: string }
  | { kind: "file_not_contains"; path: string; text?: string; regex?: string }
  | { kind: "file_hash"; path: string; sha256: string }
  | { kind: "file_size"; path: string; min?: number; max?: number }
  | { kind: "dir_exists"; path: string }
  | { kind: "glob_count"; pattern: string; min: number; max?: number }
  | { kind: "command"; command: string; args?: string[]; expectExit?: number; expectStdout?: string; expectStderr?: string; cwd?: string }
  | { kind: "http"; url: string; expectStatus?: number; expectBodyContains?: string }
  | { kind: "json_schema"; value: unknown; schema: JsonSchema }
  | { kind: "value_equals"; actual: unknown; expected: unknown }
  /**
   * Assert against a fact the Harness itself observed while executing the
   * action (child-process exit code, HTTP status, bytes written). This is real
   * state, not the agent's description of it.
   */
  | { kind: "result"; path: string; equals?: unknown; regex?: string; exists?: boolean }
  | { kind: "custom"; id: string; run: (ctx: VerificationContext) => Promise<CheckOutcome> };

export type CheckStatus = "passed" | "failed" | "indeterminate";

export interface CheckOutcome {
  status: CheckStatus;
  evidence: string;
  expected?: string;
  actual?: string;
}

export interface CheckResult extends CheckOutcome {
  spec: CheckSpec;
  label: string;
  durationMs: number;
}

export type VerificationStatus = "passed" | "failed" | "indeterminate" | "skipped";

export interface VerificationReport {
  status: VerificationStatus;
  checks: CheckResult[];
  summary: string;
  createdAt: string;
  /** Where the facts came from — 'real_state' beats 'model_claim'. */
  source: "real_state" | "deterministic_check" | "model_claim" | "blind_verifier";
}

export interface VerificationContext {
  workspaceRoot: string;
  runId: string;
  env: Record<string, string | undefined>;
  /** The executed action's result, when verifying an action. */
  result?: ToolResult;
  log(message: string, level?: LogLevel): void;
}

/**
 * The trust hierarchy, encoded as a type so it cannot be silently inverted:
 * real state > deterministic check > model claim.
 */
export type TrustSource = "real_state" | "deterministic_check" | "blind_verifier" | "model_claim";

export const TRUST_RANK: Record<TrustSource, number> = {
  real_state: 3,
  deterministic_check: 2,
  blind_verifier: 1,
  model_claim: 0,
};

/* ------------------------------------------------------------------ *
 * Blind verifier (secondary, advisory, read-only)
 * ------------------------------------------------------------------ */

export interface BlindVerdict {
  risk: RiskLevel;
  confidence: number;
  findings: string[];
  recommendation: "accept" | "review" | "reject";
  reasoning: string;
}

export interface BlindVerification {
  verdict: BlindVerdict;
  /** Advisory only — the Harness remains authoritative. */
  authoritative: false;
  adapterId?: string;
  skippedReason?: string;
  createdAt: string;
}

/* ------------------------------------------------------------------ *
 * Execution records
 * ------------------------------------------------------------------ */

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface StateTransition {
  id: string;
  stepId: string;
  actionId: string;
  tool: string;
  reversibility: Reversibility;
  before?: Record<string, unknown>;
  after?: Record<string, unknown>;
  undoOps: UndoOp[];
  rolledBack: boolean;
  rollbackOutcome?: UndoOutcome;
  /** A -> B -> rollback -> A actually observed? */
  roundTripVerified?: boolean;
}

export interface ActionRecord {
  id: string;
  stepId: string;
  tool: string;
  args: Record<string, unknown>;
  classification: ActionClassification;
  decision: AuthorizationDecision;
  approvalId?: string;
  result?: ToolResult;
  verification?: VerificationReport;
  transition?: StateTransition;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface SreAlert {
  id: string;
  kind: "loop" | "oscillation" | "stall" | "budget" | "runaway" | "repeated_failure";
  severity: "info" | "warn" | "critical";
  message: string;
  /** Injected back to the agent as feedback. Does NOT expand authority. */
  intervention?: string;
  action: "advise" | "pause" | "stop";
  createdAt: string;
}

export interface StepRecord {
  id: string;
  index: number;
  startedAt: string;
  finishedAt?: string;
  messages: ChatMessage[];
  actions: ActionRecord[];
  usage: Usage;
  sreAlerts: SreAlert[];
  agentClaim?: string;
}

export type RunStatus =
  | "pending"
  | "running"
  | "waiting_for_approval"
  | "verified"
  | "completed_unverified"
  | "verification_failed"
  | "blocked"
  | "failed"
  | "cancelled";

export interface RunSummary {
  status: RunStatus;
  /** The agent said it was done. */
  agentClaimedComplete: boolean;
  /** The Harness independently confirmed it. */
  harnessVerified: boolean;
  steps: number;
  actions: number;
  allowed: number;
  blocked: number;
  verificationsPassed: number;
  verificationsFailed: number;
  tokens: Usage;
  durationMs: number;
  /** Human-readable explanation of the final state. */
  explanation: string;
  blindVerification?: BlindVerification;
}

export interface RunRecord {
  id: string;
  task: string;
  status: RunStatus;
  startedAt: string;
  finishedAt?: string;
  steps: StepRecord[];
  summary?: RunSummary;
  config: RunConfig;
  conversation: ChatMessage[];
  error?: { message: string; code?: string };
}

export interface RunConfig {
  workspaceRoot: string;
  adapterId: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  enabledCapabilities: string[];
  persona?: string;
  rules?: string[];
  specPath?: string;
  /** Task-level acceptance criteria, recorded so a run can be replayed. */
  expectations?: CheckSpec[];
}

/* ------------------------------------------------------------------ *
 * Events
 * ------------------------------------------------------------------ */

export type HarnessEventType =
  | "run.created"
  | "run.started"
  | "run.status_changed"
  | "run.completed"
  | "step.started"
  | "step.completed"
  | "model.request"
  | "model.response"
  | "model.error"
  | "authorization.requested"
  | "authorization.decided"
  | "action.started"
  | "action.completed"
  | "verification.completed"
  | "sre.alert"
  | "approval.requested"
  | "approval.resolved"
  | "rollback.completed"
  | "audit.appended"
  | "capability.changed"
  | "log";

export interface HarnessEvent<T = unknown> {
  id: string;
  type: HarnessEventType;
  runId?: string;
  stepId?: string;
  actionId?: string;
  at: string;
  payload: T;
}

export type EventHandler = (event: HarnessEvent) => void;

/* ------------------------------------------------------------------ *
 * Audit
 * ------------------------------------------------------------------ */

export interface AuditEntry {
  seq: number;
  at: string;
  runId?: string;
  type: string;
  payload: unknown;
  prevHash: string;
  hash: string;
}
