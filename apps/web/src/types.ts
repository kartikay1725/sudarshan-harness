/** Shapes shared with the daemon. Deliberately loose: the IDE renders facts. */

export interface HarnessEvent<T = unknown> {
  id: string;
  type: string;
  runId?: string;
  stepId?: string;
  actionId?: string;
  at: string;
  payload: T;
}

export interface CapabilityView {
  id: string;
  enabled: boolean;
  source: string;
  tools: string[];
  permissions: string[];
  missingPermissions: string[];
  descriptor?: {
    name: string;
    description: string;
    tags: string[];
    risk: string;
    local: boolean;
    toolCount: number;
  };
}

export interface ApprovalView {
  id: string;
  runId: string;
  stepId: string;
  tool: string;
  args: Record<string, unknown>;
  risk: string;
  reversibility: string;
  targets: Array<{ kind: string; value: string }>;
  reason: string;
  requestedAt: string;
  classKey?: string;
}

export interface RunSummaryView {
  status: string;
  agentClaimedComplete: boolean;
  harnessVerified: boolean;
  steps: number;
  actions: number;
  allowed: number;
  blocked: number;
  verificationsPassed: number;
  verificationsFailed: number;
  tokens: { promptTokens: number; completionTokens: number; totalTokens: number };
  durationMs: number;
  explanation: string;
  blindVerification?: {
    verdict: { risk: string; confidence: number; findings: string[]; recommendation: string; reasoning: string };
    authoritative: false;
    adapterId?: string;
    skippedReason?: string;
  };
}

export interface RunView {
  id: string;
  task: string;
  status: string;
  startedAt: string;
  finishedAt?: string;
  steps: number;
  actions: number;
  summary?: RunSummaryView;
  config?: Record<string, unknown>;
}

export interface SessionSnapshot {
  configured: boolean;
  workspaceRoot?: string;
  adapterId?: string;
  model?: string;
  warnings: string[];
  spec?: {
    path?: string;
    name?: string;
    persona?: string;
    rules: string[];
    workflow: string[];
    capabilities: string[];
    verification: string[];
  };
  capabilities: CapabilityView[];
  policy?: {
    denyByDefault: boolean;
    permissions: string[];
    rules: Array<{ id?: string; effect: string; tool?: string; permission?: string; reason: string; requireApproval?: boolean }>;
    scopes: Record<string, unknown>;
    budgets: Record<string, number>;
    approval: Record<string, unknown>;
    verification: Record<string, unknown>;
    protectedPaths: string[];
  };
  tools: Array<{ name: string; description: string }>;
  runs: RunView[];
  pendingApprovals: ApprovalView[];
  queue: Array<{ id: string; task: string; enqueuedAt: string }>;
  running: boolean;
  audit?: { ok: boolean; entries: number; head: string; brokenAtSeq?: number };
}

export interface AuditEntryView {
  seq: number;
  at: string;
  runId?: string;
  type: string;
  payload: unknown;
  prevHash: string;
  hash: string;
}

export interface TransitionView {
  id: string;
  actionId: string;
  stepId: string;
  tool: string;
  reversibility: string;
  undoOps: Array<{ kind: string; description: string }>;
  rolledBack: boolean;
  roundTripVerified?: boolean;
  before?: unknown;
  after?: unknown;
}

export interface RunDetail {
  run: {
    id: string;
    task: string;
    status: string;
    startedAt: string;
    finishedAt?: string;
    summary?: RunSummaryView;
    config?: { adapterId?: string; model?: string; enabledCapabilities?: string[]; workspaceRoot?: string };
    error?: { message: string; code?: string };
    conversation: Array<{ role: string; content: string; toolCalls?: Array<{ id: string; name: string; arguments: Record<string, unknown> }>; toolCallId?: string }>;
    steps: Array<{
      id: string;
      index: number;
      startedAt: string;
      finishedAt?: string;
      usage: { promptTokens: number; completionTokens: number; totalTokens: number };
      agentClaim?: string;
      sreAlerts: Array<{ id: string; kind: string; severity: string; message: string; intervention?: string; action: string }>;
      actions: Array<{
        id: string;
        stepId: string;
        tool: string;
        args: Record<string, unknown>;
        decision: {
          allowed: boolean;
          code?: string;
          reason: string;
          risk: string;
          reversibility: string;
          approvalRequired: boolean;
          targets: Array<{ kind: string; value: string }>;
          ruleId?: string;
        };
        classification: { risk: string; reversibility: string; targets: Array<{ kind: string; value: string }> };
        result?: { outcome: string; text?: string; error?: { code: string; message: string }; metrics?: Record<string, number> };
        verification?: {
          status: string;
          summary: string;
          source: string;
          checks: Array<{ label: string; status: string; evidence: string; expected?: string; actual?: string; durationMs: number }>;
        };
        transition?: { id: string; reversibility: string; undoOps: unknown[]; rolledBack: boolean; roundTripVerified?: boolean; before?: unknown; after?: unknown };
        durationMs?: number;
      }>;
    }>;
  };
  events: HarnessEvent[];
  audit: AuditEntryView[];
}
