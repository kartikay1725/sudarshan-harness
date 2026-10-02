import { resolve } from "node:path";
import type {
  Capability,
  CheckSpec,
  ModelAdapter,
  Policy,
  RunRecord,
  ToolContext,
  UndoOutcome,
} from "./types.js";
import { EventBus } from "./events/bus.js";
import { AuditTrail } from "./audit/trail.js";
import { CapabilityRegistry } from "./capability/registry.js";
import { ApprovalQueue, type ApprovalResolution } from "./approval/queue.js";
import { defaultPolicy, mergePolicy } from "./policy/policy.js";
import { AuthorizationGate } from "./gate/authorize.js";
import { ActionExecutor } from "./executor/executor.js";
import { VerificationEngine } from "./verification/engine.js";
import { StateStore } from "./state/store.js";
import { AgentSre } from "./sre/watchdog.js";
import { BudgetTracker } from "./sre/budget.js";
import { BlindVerifier } from "./verifier/blind.js";
import { RunOrchestrator, type RunOptions } from "./run/orchestrator.js";
import { buildSystemPrompt, buildToolSpecs } from "./prompt/builder.js";
import { nowIso } from "./util/index.js";

export interface HarnessOptions {
  /** Everything the agent may touch lives under this root unless policy says otherwise. */
  workspaceRoot: string;
  adapter: ModelAdapter;
  /** Optional second model used only by the blind verifier. */
  verifierAdapter?: ModelAdapter;
  verifierModel?: string;
  policy?: Partial<Policy> | Policy;
  registry?: CapabilityRegistry;
  capabilities?: Capability[];
  capabilityConfig?: Record<string, Record<string, unknown>>;
  /** Persist the hash-chained audit trail to this JSONL file. */
  auditPath?: string;
  bus?: EventBus;
  approvals?: ApprovalQueue;
  env?: Record<string, string | undefined>;
}

export interface DoctorReport {
  ok: boolean;
  checkedAt: string;
  workspaceRoot: string;
  adapter: { id: string; label: string; available: boolean; supportsTools: boolean };
  verifier?: { id: string; available: boolean };
  capabilities: Array<{ id: string; version: string; enabled: boolean; tools: number; health: { ok: boolean; detail?: string } }>;
  policy: {
    denyByDefault: boolean;
    permissions: string[];
    rules: number;
    fsRoots: string[];
    protectedPaths: number;
    budgets: Policy["budgets"];
    approval: Policy["approval"];
  };
  audit: { entries: number; head: string; chainOk: boolean };
  problems: string[];
}

/**
 * The Harness.
 *
 * This is the object a user (or the IDE, or the CLI) holds. It owns the policy,
 * the capability registry, the audit trail and the verification engine — none
 * of which the agent can reach. The agent gets a `run()` and a set of tools;
 * everything else is enforcement.
 *
 * Per-run state (budgets, watchdog, gate) is constructed fresh for each run so
 * runs cannot contaminate each other's loop detection or spend each other's
 * budget.
 */
export class Harness {
  readonly bus: EventBus;
  readonly audit: AuditTrail;
  readonly registry: CapabilityRegistry;
  readonly approvals: ApprovalQueue;
  readonly verification: VerificationEngine;
  readonly state: StateStore;
  readonly blindVerifier: BlindVerifier;
  readonly policy: Policy;
  readonly workspaceRoot: string;

  private adapter: ModelAdapter;
  private verifierAdapter?: ModelAdapter;
  private verifierModel?: string;
  private capabilityConfig: Record<string, Record<string, unknown>>;
  private env: Record<string, string | undefined>;
  private runs = new Map<string, RunRecord>();
  private active = new Map<string, AbortController>();

  constructor(private opts: HarnessOptions) {
    this.workspaceRoot = resolve(opts.workspaceRoot);
    this.adapter = opts.adapter;
    this.verifierAdapter = opts.verifierAdapter;
    this.verifierModel = opts.verifierModel;
    this.capabilityConfig = opts.capabilityConfig ?? {};
    this.env = opts.env ?? (process.env as Record<string, string | undefined>);

    this.bus = opts.bus ?? new EventBus();
    this.audit = new AuditTrail({ persistPath: opts.auditPath });
    this.registry = opts.registry ?? new CapabilityRegistry(this.bus);
    this.approvals = opts.approvals ?? new ApprovalQueue();
    this.policy = opts.policy
      ? mergePolicy(defaultPolicy(this.workspaceRoot), opts.policy as Partial<Policy>)
      : defaultPolicy(this.workspaceRoot);

    if (opts.capabilities?.length) this.registry.installAll(opts.capabilities, { source: "builtin" });

    this.verification = new VerificationEngine({
      workspaceRoot: this.workspaceRoot,
      policy: this.policy,
      bus: this.bus,
      audit: this.audit,
      env: this.env,
    });
    this.state = new StateStore({
      workspaceRoot: this.workspaceRoot,
      policy: this.policy,
      registry: this.registry,
      bus: this.bus,
      audit: this.audit,
    });
    this.blindVerifier = new BlindVerifier({
      adapter: this.verifierAdapter,
      model: this.verifierModel,
      policy: this.policy,
      bus: this.bus,
      audit: this.audit,
    });

    this.bus.on((event) => {
      if (event.type === "capability.changed") this.state.syncUndoHandlers();
    });
  }

  /* ---------------- capability management (LEGO) ---------------- */

  install(capability: Capability, opts: { source?: "builtin" | "workspace" | "marketplace" | "generated"; enabled?: boolean } = {}): void {
    this.registry.install(capability, opts);
    this.state.syncUndoHandlers();
    this.audit.append("capability.installed", { id: capability.id, version: capability.version, source: opts.source ?? "builtin", tools: capability.tools.map((t) => t.name) });
  }

  remove(capabilityId: string): boolean {
    const removed = this.registry.remove(capabilityId);
    if (removed) {
      this.state.syncUndoHandlers();
      this.audit.append("capability.removed", { id: capabilityId });
    }
    return removed;
  }

  setEnabled(capabilityId: string, enabled: boolean): boolean {
    const ok = this.registry.setEnabled(capabilityId, enabled);
    if (ok) {
      this.state.syncUndoHandlers();
      this.audit.append(enabled ? "capability.enabled" : "capability.disabled", { id: capabilityId });
    }
    return ok;
  }

  setCapabilityConfig(capabilityId: string, config: Record<string, unknown>): void {
    this.capabilityConfig[capabilityId] = config;
  }

  tools() {
    return buildToolSpecs(this.registry.tools());
  }

  /* ---------------- running ---------------- */

  async run(task: string, opts: RunOptions & { expectations?: CheckSpec[]; policyPatch?: Partial<Policy> } = { model: "" }): Promise<RunRecord> {
    const model = opts.model || this.adapter.id;
    const controller = new AbortController();
    const signal = opts.signal
      ? anySignal([opts.signal, controller.signal])
      : controller.signal;

    // Per-run enforcement objects.
    const sre = new AgentSre(
      { maxRepeatedActions: this.policy.budgets.maxRepeatedActions, maxUnverifiedSteps: this.policy.budgets.maxUnverifiedSteps },
      this.bus,
    );
    const budgets = new BudgetTracker({
      maxSteps: this.policy.budgets.maxSteps,
      maxToolCalls: this.policy.budgets.maxToolCalls,
      maxTokens: this.policy.budgets.maxTokens,
      maxWallClockMs: this.policy.budgets.maxWallClockMs,
    });
    const gate = new AuthorizationGate({
      registry: this.registry,
      policy: this.policy,
      bus: this.bus,
      audit: this.audit,
      approvals: this.approvals,
      budgets,
      sre,
      workspaceRoot: this.workspaceRoot,
    });
    const executor = new ActionExecutor({
      workspaceRoot: this.workspaceRoot,
      policy: this.policy,
      registry: this.registry,
      verification: this.verification,
      state: this.state,
      bus: this.bus,
      audit: this.audit,
      capabilityConfig: this.capabilityConfig,
      env: this.env,
    });
    const orchestrator = new RunOrchestrator({
      registry: this.registry,
      policy: this.policy,
      bus: this.bus,
      audit: this.audit,
      approvals: this.approvals,
      gate,
      executor,
      verification: this.verification,
      state: this.state,
      sre,
      budgets,
      blindVerifier: this.blindVerifier,
      adapter: this.adapter,
      workspaceRoot: this.workspaceRoot,
    });

    const record = await orchestrator.run(task, { ...opts, model, signal });
    this.runs.set(record.id, record);
    this.active.delete(record.id);
    return record;
  }

  /** Start a run without awaiting it; returns the record as it fills in. */
  start(task: string, opts: RunOptions): { promise: Promise<RunRecord>; cancel: () => void } {
    const controller = new AbortController();
    const promise = this.run(task, { ...opts, signal: anySignal([opts.signal, controller.signal].filter(Boolean) as AbortSignal[]) });
    return { promise, cancel: () => controller.abort() };
  }

  cancel(runId: string): boolean {
    const controller = this.active.get(runId);
    if (controller) {
      controller.abort();
      return true;
    }
    // Runs are awaited synchronously by the caller; cancel pending approvals as a fallback.
    return this.approvals.cancelRun(runId, "run cancelled by operator") > 0;
  }

  getRun(id: string): RunRecord | undefined {
    return this.runs.get(id);
  }

  listRuns(): RunRecord[] {
    return [...this.runs.values()].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /* ---------------- human authority ---------------- */

  resolveApproval(approvalId: string, resolution: ApprovalResolution) {
    const req = this.approvals.resolve(approvalId, resolution);
    this.audit.append("approval.decision", { approvalId, resolution, by: resolution.by ?? "human" }, req?.runId);
    return req;
  }

  pendingApprovals(runId?: string) {
    return this.approvals.pending(runId);
  }

  /* ---------------- recovery ---------------- */

  /**
   * Roll a recorded transition back and verify against the pre-action snapshot.
   * The outcome reports `verified` only when the real system is observed to be
   * back in state A.
   */
  async rollback(transitionId: string): Promise<UndoOutcome> {
    return this.state.rollback(transitionId);
  }

  /* ---------------- introspection ---------------- */

  systemPromptPreview(task = "(task preview)", expectations: CheckSpec[] = []): string {
    return buildSystemPrompt({
      task,
      workspaceRoot: this.workspaceRoot,
      policy: this.policy,
      capabilities: this.registry.list(),
      tools: this.registry.tools(),
      expectations,
      adapterSupportsTools: this.adapter.supportsTools,
    });
  }

  auditChainStatus(): { ok: boolean; brokenAtSeq?: number; expectedHash?: string; actualHash?: string; entries: number; head: string } {
    const chain = this.audit.verifyChain();
    return { ...chain, entries: this.audit.length(), head: this.audit.head() };
  }

  async doctor(): Promise<DoctorReport> {
    const problems: string[] = [];
    const ctxFactory = (capabilityId: string): ToolContext => ({
      workspaceRoot: this.workspaceRoot,
      runId: "doctor",
      stepId: "doctor",
      config: this.capabilityConfig[capabilityId] ?? {},
      env: this.env,
      log: () => undefined,
      recordEvidence: () => undefined,
    });
    const health = await this.registry.healthCheck(ctxFactory);
    const chain = this.audit.verifyChain();

    if (!this.adapter.available()) problems.push(`model adapter "${this.adapter.id}" is not available (missing credentials or unreachable server)`);
    if (!this.adapter.supportsTools) problems.push(`model adapter "${this.adapter.id}" has no native tool calling; the text protocol fallback will be used`);
    if (this.registry.list().length === 0) problems.push("no capability is installed — the agent has no tools");
    if (this.policy.scopes.fsRoots.length === 0) problems.push("policy has no filesystem roots");
    for (const [id, h] of Object.entries(health)) {
      if (!h.ok) problems.push(`capability "${id}" health check failed: ${h.detail ?? "unknown"}`);
    }
    if (!chain.ok) problems.push(`audit chain is broken at seq ${chain.brokenAtSeq}`);

    return {
      ok: problems.length === 0,
      checkedAt: nowIso(),
      workspaceRoot: this.workspaceRoot,
      adapter: {
        id: this.adapter.id,
        label: this.adapter.label,
        available: this.adapter.available(),
        supportsTools: this.adapter.supportsTools,
      },
      verifier: this.verifierAdapter ? { id: this.verifierAdapter.id, available: this.verifierAdapter.available() } : undefined,
      capabilities: this.registry.list().map((c) => ({
        id: c.capability.id,
        version: c.capability.version,
        enabled: c.enabled,
        tools: c.capability.tools.length,
        health: health[c.capability.id] ?? { ok: true },
      })),
      policy: {
        denyByDefault: this.policy.denyByDefault,
        permissions: this.policy.permissions,
        rules: this.policy.rules.length,
        fsRoots: this.policy.scopes.fsRoots,
        protectedPaths: this.policy.protectedPaths.length,
        budgets: this.policy.budgets,
        approval: this.policy.approval,
      },
      audit: { entries: this.audit.length(), head: this.audit.head(), chainOk: chain.ok },
      problems,
    };
  }

  setAdapter(adapter: ModelAdapter): void {
    this.adapter = adapter;
    this.audit.append("adapter.changed", { id: adapter.id });
  }
}

/** Combine signals so both operator cancellation and internal abort work. */
export function anySignal(signals: Array<AbortSignal | undefined>): AbortSignal {
  const defined = signals.filter((s): s is AbortSignal => !!s);
  if (defined.length === 0) return new AbortController().signal;
  if (defined.length === 1) return defined[0]!;
  const controller = new AbortController();
  for (const s of defined) {
    if (s.aborted) {
      controller.abort(s.reason);
      break;
    }
    s.addEventListener("abort", () => controller.abort(s.reason), { once: true });
  }
  return controller.signal;
}
