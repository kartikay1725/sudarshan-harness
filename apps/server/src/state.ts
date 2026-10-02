import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { Harness, type ApprovalRequest, type HarnessEvent, type RunRecord } from "@sudarshan/core";
import { ADAPTER_CATALOG, createAdapter, probeAdapters, type AdapterSpec } from "@sudarshan/adapters";
import { CAPABILITY_CATALOG, PRESETS, builtinCapability } from "@sudarshan/capabilities";
import { parseAgentSpec, renderSpecTemplate } from "@sudarshan/spec";
import { buildHarness, describeCapabilities, loadConfigFile, type BuiltHarness, type HarnessBuildConfig } from "@sudarshan/runtime";

/**
 * Daemon-side session state.
 *
 * One Harness instance is the "current session": it owns the workspace, the
 * policy, the installed capabilities and the run history. Runs execute one at a
 * time so loop detection and budgets stay meaningful; the queue is visible in
 * the IDE rather than hidden.
 */
export class Session {
  built?: BuiltHarness;
  runs = new Map<string, RunRecord>();
  events: HarnessEvent[] = [];
  listeners = new Set<(event: HarnessEvent) => void>();
  queue: Array<{ id: string; task: string; enqueuedAt: string }> = [];
  private running = false;
  private waiters: Array<() => void> = [];
  config: HarnessBuildConfig = {};

  get harness(): Harness | undefined {
    return this.built?.harness;
  }

  requireHarness(): Harness {
    if (!this.built) throw new HttpError(409, "no session configured — POST /api/session first");
    return this.built.harness;
  }

  async configure(config: HarnessBuildConfig): Promise<BuiltHarness> {
    const workspaceRoot = resolve(config.workspaceRoot ?? process.cwd());
    const fileConfig = (await loadConfigFile(workspaceRoot).catch(() => undefined)) ?? {};
    const merged: HarnessBuildConfig = {
      ...fileConfig,
      ...config,
      workspaceRoot,
      capabilities: { ...(fileConfig.capabilities ?? {}), ...(config.capabilities ?? {}) },
      budgets: { ...(fileConfig.budgets ?? {}), ...(config.budgets ?? {}) },
      policy: config.policy ?? fileConfig.policy,
    };
    const built = await buildHarness(merged);
    this.built = built;
    this.config = merged;
    this.wire(built.harness);
    return built;
  }

  private wire(harness: Harness): void {
    harness.bus.on((event) => this.emit(event));
  }

  /**
   * Publish an event to the ring buffer and every SSE listener.
   *
   * Used for runs that did not originate from the session harness — a replay
   * executes in its own scratch Harness, so the IDE would otherwise never see
   * it. The events are a *mirror* of what happened; enforcement still lives in
   * the harness that ran the action.
   */
  emit(event: HarnessEvent): void {
    this.events.push(event);
    if (this.events.length > 20_000) this.events.splice(0, this.events.length - 20_000);
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        /* a dead SSE client must not affect enforcement */
      }
    }
  }

  subscribe(listener: (event: HarnessEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** Enqueue a run; runs execute serially. */
  async startRun(task: string, opts: RunRequestOptions): Promise<{ runId: string; promise: Promise<RunRecord> }> {
    const harness = this.requireHarness();
    const id = `pending_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    this.queue.push({ id, task, enqueuedAt: new Date().toISOString() });

    const promise = (async () => {
      await this.waitForTurn();
      this.queue = this.queue.filter((q) => q.id !== id);
      try {
        const run = await harness.run(task, opts.runOptions);
        this.runs.set(run.id, run);
        return run;
      } finally {
        this.release();
      }
    })();

    // Keep an unhandled rejection from crashing the daemon; the caller awaits it.
    promise.catch(() => undefined);
    return { runId: id, promise };
  }

  private async waitForTurn(): Promise<void> {
    while (this.running) {
      await new Promise<void>((r) => this.waiters.push(r));
    }
    this.running = true;
  }

  release(): void {
    this.running = false;
    const next = this.waiters.shift();
    next?.();
  }

  snapshot(): SessionSnapshot {
    const built = this.built;
    return {
      configured: !!built,
      workspaceRoot: built?.config.workspaceRoot,
      adapterId: built?.adapterId,
      model: built?.model,
      warnings: built?.warnings ?? [],
      spec: built?.spec
        ? {
            path: built.spec.path,
            name: built.spec.name,
            persona: built.spec.persona,
            rules: built.spec.rules,
            workflow: built.spec.workflow,
            capabilities: built.spec.capabilities,
            verification: built.spec.verification.map((c) => (c.kind === "custom" ? "custom" : JSON.stringify(c))),
          }
        : undefined,
      capabilities: built
        ? describeCapabilities(built.harness, built.policy).map((c) => ({
            ...c,
            descriptor: CAPABILITY_CATALOG.find((d) => d.id === c.id),
          }))
        : [],
      policy: built
        ? {
            denyByDefault: built.policy.denyByDefault,
            permissions: built.policy.permissions,
            rules: built.policy.rules,
            scopes: built.policy.scopes,
            budgets: built.policy.budgets,
            approval: built.policy.approval,
            verification: { ...built.policy.verification, expectations: built.policy.verification.expectations.length },
            protectedPaths: built.policy.protectedPaths,
          }
        : undefined,
      tools: built?.harness.tools() ?? [],
      runs: [...this.runs.values()].map(summariseRun).reverse(),
      pendingApprovals: built?.harness.pendingApprovals().map(publicApproval) ?? [],
      queue: this.queue,
      running: this.running,
      audit: built ? { ...built.harness.auditChainStatus() } : undefined,
    };
  }

  auditEntries(limit = 500, runId?: string) {
    const harness = this.requireHarness();
    const entries = runId ? harness.audit.forRun(runId) : harness.audit.all();
    return entries.slice(-limit);
  }

  transitions() {
    const harness = this.requireHarness();
    return harness.state.list(200).map((t) => ({
      id: t.id,
      actionId: t.actionId,
      stepId: t.stepId,
      tool: t.tool,
      reversibility: t.reversibility,
      undoOps: t.undoOps.map((u) => ({ kind: u.kind, description: u.description })),
      rolledBack: t.rolledBack,
      roundTripVerified: t.roundTripVerified,
      before: t.before,
      after: t.after,
    }));
  }
}

export interface RunRequestOptions {
  runOptions: {
    model?: string;
    temperature?: number;
    maxTokens?: number;
    expectations?: import("@sudarshan/core").CheckSpec[];
    approvalTimeoutMs?: number;
    persona?: string;
    rules?: string[];
  };
  approvalMode?: "manual" | "auto" | "deny";
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
  capabilities: Array<{
    id: string;
    enabled: boolean;
    source: string;
    tools: string[];
    permissions: string[];
    missingPermissions: string[];
    descriptor?: (typeof CAPABILITY_CATALOG)[number];
  }>;
  policy?: Record<string, unknown>;
  tools: Array<{ name: string; description: string }>;
  runs: Array<Record<string, unknown>>;
  pendingApprovals: Array<Record<string, unknown>>;
  queue: Array<{ id: string; task: string; enqueuedAt: string }>;
  running: boolean;
  audit?: { ok: boolean; entries: number; head: string };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function publicApproval(request: ApprovalRequest): Record<string, unknown> {
  return {
    id: request.id,
    runId: request.runId,
    stepId: request.stepId,
    tool: request.tool,
    args: request.args,
    risk: request.classification.risk,
    reversibility: request.classification.reversibility,
    targets: request.classification.targets,
    reason: request.reason,
    requestedAt: request.requestedAt,
    classKey: request.classKey,
  };
}

export function summariseRun(run: RunRecord): Record<string, unknown> {
  return {
    id: run.id,
    task: run.task,
    status: run.status,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
    summary: run.summary,
    steps: run.steps.length,
    actions: run.steps.flatMap((s) => s.actions).length,
    config: run.config,
  };
}

export { ADAPTER_CATALOG, PRESETS, builtinCapability, createAdapter, probeAdapters, parseAgentSpec, renderSpecTemplate, existsSync };
export type { AdapterSpec };
