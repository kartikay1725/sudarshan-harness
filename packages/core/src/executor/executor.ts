import type {
  ActionClassification,
  ActionRecord,
  AuthorizationDecision,
  CheckSpec,
  Evidence,
  LogLevel,
  Policy,
  ToolContext,
  ToolDefinition,
  ToolResult,
  VerificationReport,
} from "../types.js";
import type { AuditTrail } from "../audit/trail.js";
import type { EventBus } from "../events/bus.js";
import type { CapabilityRegistry } from "../capability/registry.js";
import type { VerificationEngine } from "../verification/engine.js";
import type { StateStore } from "../state/store.js";
import { nowIso, redactDeep, truncate } from "../util/index.js";

export const DEFAULT_TOOL_TIMEOUT_MS = 120_000;

export interface ExecuteRequest {
  runId: string;
  stepId: string;
  actionId: string;
  tool: ToolDefinition;
  capabilityId: string;
  args: Record<string, unknown>;
  decision: AuthorizationDecision;
  classification: ActionClassification;
  approvalId?: string;
  signal?: AbortSignal;
}

export interface ExecutorOptions {
  workspaceRoot: string;
  policy: Policy;
  registry: CapabilityRegistry;
  verification: VerificationEngine;
  state: StateStore;
  bus?: EventBus;
  audit?: AuditTrail;
  capabilityConfig?: Record<string, Record<string, unknown>>;
  env?: Record<string, string | undefined>;
}

/**
 * The only code path that touches the real world.
 *
 * Ordering matters and is not configurable:
 *
 *   capture state A  ->  execute  ->  capture state B  ->  verify against the
 *   checks that were declared BEFORE execution  ->  record the transition.
 *
 * Because the checks are declared pre-execution (by the capability's
 * `classify()` or by agent.md), neither the agent nor the result can move the
 * goalposts after seeing the outcome.
 */
export class ActionExecutor {
  constructor(private opts: ExecutorOptions) {}

  async execute(req: ExecuteRequest): Promise<ActionRecord> {
    const startedAt = nowIso();
    const started = Date.now();
    const config = this.opts.capabilityConfig?.[req.capabilityId] ?? {};

    this.opts.bus?.emit(
      "action.started",
      { tool: req.tool.name, args: redactDeep(req.args), risk: req.classification.risk, reversibility: req.classification.reversibility },
      { runId: req.runId, stepId: req.stepId, actionId: req.actionId },
    );
    this.opts.audit?.append(
      "action.started",
      { actionId: req.actionId, tool: req.tool.name, args: redactDeep(req.args), capability: req.capabilityId, risk: req.classification.risk },
      req.runId,
    );

    const evidenceSink: Evidence[] = [];
    const ctx: ToolContext = {
      workspaceRoot: this.opts.workspaceRoot,
      runId: req.runId,
      stepId: req.stepId,
      config,
      env: this.opts.env ?? (process.env as Record<string, string | undefined>),
      signal: req.signal,
      log: (message: string, level: LogLevel = "info") => {
        this.opts.bus?.emit("log", { level, message, where: req.tool.name }, { runId: req.runId, stepId: req.stepId, actionId: req.actionId });
      },
      recordEvidence: (evidence: Evidence) => {
        evidenceSink.push(evidence);
        this.opts.audit?.append("evidence.observed", { actionId: req.actionId, ...evidence }, req.runId);
      },
    };

    // A: real state before the action.
    const before = await this.opts.state.capture(req.classification.targets);

    let result: ToolResult;
    try {
      result = await withTimeout(
        req.tool.execute(req.args, ctx),
        req.tool.timeoutMs ?? DEFAULT_TOOL_TIMEOUT_MS,
        req.signal,
      );
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const timedOut = /timed out/i.test(message);
      result = {
        outcome: timedOut ? "timeout" : req.signal?.aborted ? "blocked" : "error",
        error: { code: timedOut ? "ETIMEDOUT" : "EEXEC", message },
        text: `${req.tool.name} failed: ${message}`,
        evidence: evidenceSink,
      };
    }
    if (evidenceSink.length && result.evidence) {
      result.evidence = [...evidenceSink, ...result.evidence];
    } else if (evidenceSink.length) {
      result.evidence = evidenceSink;
    }

    // B: real state after the action.
    const after = await this.opts.state.capture(req.classification.targets);
    const transition = await this.opts.state.recordTransition({
      stepId: req.stepId,
      actionId: req.actionId,
      tool: req.tool.name,
      reversibility: req.classification.reversibility,
      before,
      after,
      undoOps: result.undo ?? [],
    });

    // Verify — against checks declared before execution.
    const checks: CheckSpec[] = [...(req.classification.checks ?? [])];
    let verification: VerificationReport;
    if (result.outcome === "success") {
      verification = await this.opts.verification.verify(checks, {
        runId: req.runId,
        stepId: req.stepId,
        actionId: req.actionId,
        source: "real_state",
        label: req.tool.name,
        result,
      });
    } else {
      verification = {
        status: "skipped",
        checks: [],
        summary: `Action did not succeed (${result.outcome}); nothing to verify.`,
        createdAt: nowIso(),
        source: "real_state",
      };
    }

    const record: ActionRecord = {
      id: req.actionId,
      stepId: req.stepId,
      tool: req.tool.name,
      args: req.args,
      classification: req.classification,
      decision: req.decision,
      approvalId: req.approvalId,
      result: sanitiseResult(result),
      verification,
      transition,
      startedAt,
      finishedAt: nowIso(),
      durationMs: Date.now() - started,
    };

    this.opts.bus?.emit(
      "action.completed",
      {
        actionId: record.id,
        tool: record.tool,
        outcome: result.outcome,
        text: truncate(result.text ?? "", 4000),
        verification: { status: verification.status, summary: verification.summary },
        durationMs: record.durationMs,
        transitionId: transition.id,
        undoable: (result.undo ?? []).length > 0,
      },
      { runId: req.runId, stepId: req.stepId, actionId: req.actionId },
    );
    this.opts.audit?.append(
      "action.completed",
      {
        actionId: record.id,
        tool: record.tool,
        outcome: result.outcome,
        verification: verification.status,
        verificationSummary: verification.summary,
        transitionId: transition.id,
        durationMs: record.durationMs,
        evidence: (result.evidence ?? []).slice(0, 20),
      },
      req.runId,
    );

    return record;
  }

  /** Model-facing text for an executed action, including the Harness verdict. */
  static describe(record: ActionRecord): string {
    const parts: string[] = [`[tool ${record.tool}] outcome=${record.result?.outcome ?? "unknown"}`];
    if (record.result?.text) parts.push(record.result.text);
    if (record.result?.error) parts.push(`error(${record.result.error.code}): ${record.result.error.message}`);
    if (record.verification && record.verification.status !== "skipped") {
      parts.push(formatVerification(record.verification));
    }
    return parts.join("\n");
  }
}

export function formatVerification(report: VerificationReport): string {
  const lines = [`--- HARNESS VERIFICATION (${report.source}) ---`, `status: ${report.status.toUpperCase()}`];
  for (const check of report.checks) {
    const mark = check.status === "passed" ? "PASS" : check.status === "failed" ? "FAIL" : "???";
    lines.push(`${mark} ${check.label} — ${check.evidence}`);
    if (check.status === "failed" && check.expected) {
      lines.push(`      expected: ${check.expected}`);
      lines.push(`      actual:   ${check.actual ?? "n/a"}`);
    }
  }
  lines.push(`summary: ${report.summary}`);
  return lines.join("\n");
}

export const BLOCKED_PREAMBLE =
  "HARNESS: this action was blocked before execution. A blocked action never reached the real world. " +
  "The reason below is evidence, not a negotiation: explaining why you were blocked does not grant permission. " +
  "Propose a different action that stays inside policy, or report the blocker to the user.";

export const FAILED_VERIFICATION_PREAMBLE =
  "HARNESS: execution succeeded but independent verification did NOT pass. " +
  "COMPLETED != VERIFIED — do not treat this step as done. " +
  "Read the evidence, decide what is actually wrong, and propose a corrective action. " +
  "A corrective action goes through a fresh authorization check; the previous approval does not carry over.";

function sanitiseResult(result: ToolResult): ToolResult {
  return {
    ...result,
    text: result.text === undefined ? undefined : truncate(result.text, 20_000),
    output: result.output === undefined ? undefined : redactDeep(result.output),
    error: result.error ? { code: result.error.code, message: truncate(result.error.message, 2000) } : undefined,
  };
}

async function withTimeout<T>(promise: Promise<T>, ms: number, signal?: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      reject(new Error(`action timed out after ${ms}ms`));
    }, ms);
    const onAbort = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(new Error("action aborted"));
    };
    signal?.addEventListener("abort", onAbort, { once: true });
    promise.then(
      (value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener("abort", onAbort);
        reject(err);
      },
    );
  });
}
