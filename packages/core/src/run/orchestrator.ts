import type {
  ActionRecord,
  BlindVerification,
  ChatMessage,
  CheckSpec,
  ModelAdapter,
  Policy,
  RunConfig,
  RunRecord,
  RunStatus,
  RunSummary,
  StepRecord,
  ToolCall,
  Usage,
  VerificationReport,
} from "../types.js";
import type { CapabilityRegistry } from "../capability/registry.js";
import type { EventBus } from "../events/bus.js";
import type { AuditTrail } from "../audit/trail.js";
import type { ApprovalQueue, ApprovalResolution } from "../approval/queue.js";
import type { AuthorizationGate } from "../gate/authorize.js";
import type { ActionExecutor } from "../executor/executor.js";
import { BLOCKED_PREAMBLE, FAILED_VERIFICATION_PREAMBLE, formatVerification } from "../executor/executor.js";
import type { VerificationEngine } from "../verification/engine.js";
import type { StateStore } from "../state/store.js";
import type { AgentSre } from "../sre/watchdog.js";
import type { BudgetTracker } from "../sre/budget.js";
import type { BlindVerifier } from "../verifier/blind.js";
import { buildInterventionMessage, buildSystemPrompt, buildTaskMessage, buildToolSpecs } from "../prompt/builder.js";
import { newId, nowIso, redactDeep, truncate } from "../util/index.js";

export interface OrchestratorDeps {
  registry: CapabilityRegistry;
  policy: Policy;
  bus: EventBus;
  audit: AuditTrail;
  approvals: ApprovalQueue;
  gate: AuthorizationGate;
  executor: ActionExecutor;
  verification: VerificationEngine;
  state: StateStore;
  sre: AgentSre;
  budgets: BudgetTracker;
  blindVerifier: BlindVerifier;
  adapter: ModelAdapter;
  workspaceRoot: string;
}

export interface RunOptions {
  /** Model name; defaults to the adapter's own default. */
  model?: string;
  temperature?: number;
  maxTokens?: number;
  /** Task-level acceptance criteria. Checked against real state at the end. */
  expectations?: CheckSpec[];
  persona?: string;
  rules?: string[];
  specPath?: string;
  signal?: AbortSignal;
  /** 0 = wait indefinitely for a human. */
  approvalTimeoutMs?: number;
  metadata?: Record<string, unknown>;
  onModelCall?: (attempt: number, messages: ChatMessage[]) => void;
  modelRetries?: number;
}

type Termination =
  | { reason: "agent_complete" }
  | { reason: "budget"; message: string }
  | { reason: "sre_stop"; message: string }
  | { reason: "cancelled" }
  | { reason: "error"; message: string }
  | { reason: "max_steps" };

const EMPTY_USAGE: Usage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

/**
 * The run loop.
 *
 *   agent thinks -> requests action -> GATE -> execute -> VERIFY -> next
 *
 * What is deliberately absent: any instruction about *how* to solve the task.
 * The model plans; the Harness only decides what is permitted and what is true.
 */
export class RunOrchestrator {
  constructor(private deps: OrchestratorDeps) {}

  async run(task: string, opts: RunOptions): Promise<RunRecord> {
    const { bus, audit, policy, registry, gate, executor, sre, budgets, approvals } = this.deps;
    const runId = newId("run");
    const startedAt = nowIso();
    const startedMs = Date.now();

    const expectations: CheckSpec[] = [...(opts.expectations ?? []), ...policy.verification.expectations];
    const model = opts.model || (this.deps.adapter as unknown as { defaultModel?: string }).defaultModel || this.deps.adapter.id;
    const runConfig: RunConfig = {
      workspaceRoot: this.deps.workspaceRoot,
      adapterId: this.deps.adapter.id,
      model,
      temperature: opts.temperature,
      maxTokens: opts.maxTokens,
      enabledCapabilities: registry.list().filter((c) => c.enabled).map((c) => c.capability.id),
      persona: opts.persona,
      rules: opts.rules,
      specPath: opts.specPath,
      expectations,
    };

    const record: RunRecord = {
      id: runId,
      task,
      status: "running",
      startedAt,
      config: runConfig,
      steps: [],
      conversation: [],
    };

    const systemPrompt = buildSystemPrompt({
      task,
      workspaceRoot: this.deps.workspaceRoot,
      policy,
      capabilities: registry.list(),
      tools: registry.tools(),
      persona: opts.persona,
      rules: opts.rules,
      expectations,
      adapterSupportsTools: this.deps.adapter.supportsTools,
    });

    record.conversation.push({ role: "system", content: systemPrompt });
    record.conversation.push({ role: "user", content: buildTaskMessage(task) });

    bus.emit("run.created", { task, config: runConfig, expectations: expectations.map((e) => describeCheck(e)) }, { runId });
    bus.emit("run.started", { task, adapter: this.deps.adapter.id, model }, { runId });
    audit.append("run.started", { task: truncate(task, 4000), config: runConfig }, runId);
    this.setStatus(record, "running");

    const tools = registry.tools();
    if (tools.length === 0) {
      audit.append("run.no_capabilities", { detail: "no capability installed" }, runId);
      bus.emit("log", { level: "warn", message: "No capability is installed — the agent has no tools and cannot act." }, { runId });
    }

    let termination: Termination = { reason: "max_steps" };
    let agentClaim: string | undefined;
    let stepIndex = 0;

    try {
      while (stepIndex < policy.budgets.maxSteps) {
        if (opts.signal?.aborted) {
          termination = { reason: "cancelled" };
          break;
        }

        const violation = budgets.violation();
        if (violation) {
          const alert = sre.raiseBudget(violation.message);
          termination = { reason: "budget", message: violation.message };
          audit.append("run.budget_exhausted", { violation, alertId: alert.id }, runId);
          break;
        }

        stepIndex++;
        const stepId = newId("stp");
        const step: StepRecord = {
          id: stepId,
          index: stepIndex,
          startedAt: nowIso(),
          messages: [],
          actions: [],
          usage: { ...EMPTY_USAGE },
          sreAlerts: [],
        };
        record.steps.push(step);
        budgets.addStep();
        sre.beginStep();
        bus.emit("step.started", { index: stepIndex }, { runId, stepId });

        // Watchdog feedback from the previous step(s). Advisory only.
        const interventions = sre.takeInterventions();
        if (interventions.length > 0) {
          const message = buildInterventionMessage(interventions);
          record.conversation.push({ role: "user", content: message });
          step.messages.push({ role: "user", content: message });
          audit.append("sre.intervention", { interventions }, runId);
        }

        let response;
        try {
          response = await this.callModel(record.conversation, opts, model, runId, stepId);
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          bus.emit("model.error", { message }, { runId, stepId });
          audit.append("model.error", { message }, runId);
          termination = { reason: "error", message };
          record.error = { message, code: "model_error" };
          break;
        }

        budgets.addTokens(response.usage.promptTokens, response.usage.completionTokens);
        step.usage = response.usage;
        step.messages.push({ role: "assistant", content: response.content, toolCalls: response.toolCalls });

        // Normalise tool calls (name resolution + JSON argument parsing).
        const calls = this.normaliseCalls(response, tools.map((t) => t.name));
        record.conversation.push({ role: "assistant", content: response.content, toolCalls: calls });

        if (calls.length === 0) {
          agentClaim = response.content;
          step.agentClaim = response.content;
          step.finishedAt = nowIso();
          bus.emit("step.completed", { index: stepIndex, actions: 0, agentClaim: truncate(response.content, 2000) }, { runId, stepId });
          termination = { reason: "agent_complete" };
          break;
        }

        for (const call of calls) {
          if (opts.signal?.aborted) {
            termination = { reason: "cancelled" };
            break;
          }
          const action = await this.executeCall(call, { runId, stepId, step, record, opts });
          step.actions.push(action.record);
          record.conversation.push({ role: "tool", toolCallId: call.id, name: call.name, content: action.modelFeedback });
          step.messages.push({ role: "tool", toolCallId: call.id, name: call.name, content: action.modelFeedback });
          if (action.hardStop) {
            termination = { reason: action.hardStop.reason, message: action.hardStop.message };
            break;
          }
        }

        const verifiedChange = step.actions.some((a) => a.verification?.status === "passed");
        budgets.noteVerification(verifiedChange);
        const stepAlerts = sre.endStep(verifiedChange);
        step.sreAlerts.push(...stepAlerts);
        step.finishedAt = nowIso();
        bus.emit(
          "step.completed",
          {
            index: stepIndex,
            actions: step.actions.length,
            allowed: step.actions.filter((a) => a.decision.allowed).length,
            blocked: step.actions.filter((a) => !a.decision.allowed).length,
            verifiedChange,
            usage: step.usage,
          },
          { runId, stepId },
        );
        audit.append("step.completed", { index: stepIndex, actions: step.actions.length, verifiedChange, usage: step.usage }, runId);

        if (termination.reason !== "max_steps") break;
        const stopAlert = stepAlerts.find((a) => a.action === "stop");
        if (stopAlert) {
          termination = { reason: "sre_stop", message: stopAlert.message };
          break;
        }
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      termination = { reason: "error", message };
      record.error = { message, code: "harness_error" };
      audit.append("run.error", { message }, runId);
    }

    /* ---------------- final, independent verification ---------------- */

    const allActions = record.steps.flatMap((s) => s.actions);
    let taskReport: VerificationReport;
    if (expectations.length > 0) {
      taskReport = await this.deps.verification.verify(expectations, {
        runId,
        source: "deterministic_check",
        label: "task-acceptance",
      });
    } else {
      taskReport = {
        status: "skipped",
        checks: [],
        summary: "No task-level acceptance criteria were declared (agent.md `verify:` or run options). Action-level verification only.",
        createdAt: nowIso(),
        source: "deterministic_check",
      };
    }

    let blind: BlindVerification | undefined;
    if (policy.verification.blindVerifier) {
      blind = await this.deps.blindVerifier.review({ runId, task, actions: allActions, agentClaim });
      bus.emit("verification.completed", { blind: true, verdict: blind.verdict, skipped: blind.skippedReason }, { runId });
    }

    const summary = summarise({
      record,
      termination,
      agentClaim,
      taskReport,
      allActions,
      budgets,
      startedMs,
      blind,
      strict: policy.verification.strict,
    });

    record.summary = summary;
    record.finishedAt = nowIso();
    this.setStatus(record, summary.status);
    bus.emit("run.completed", { summary }, { runId });
    audit.append("run.completed", { status: summary.status, explanation: summary.explanation, summary: redactDeep(summary) }, runId);
    await audit.flush();
    return record;
  }

  private setStatus(record: RunRecord, status: RunStatus): void {
    if (record.status === status) return;
    record.status = status;
    this.deps.bus.emit("run.status_changed", { status }, { runId: record.id });
  }

  private async callModel(conversation: ChatMessage[], opts: RunOptions, model: string, runId: string, stepId: string) {
    const toolSpecs = buildToolSpecs(this.deps.registry.tools());
    const retries = opts.modelRetries ?? 1;
    let lastError: unknown;

    for (let attempt = 0; attempt <= retries; attempt++) {
      opts.onModelCall?.(attempt, conversation);
      this.deps.bus.emit(
        "model.request",
        { attempt, model: opts.model, adapter: this.deps.adapter.id, messages: conversation.length, tools: toolSpecs.length },
        { runId, stepId },
      );
      this.deps.audit.append(
        "model.request",
        { attempt, model, adapter: this.deps.adapter.id, messageCount: conversation.length },
        runId,
      );
      try {
        const started = Date.now();
        const response = await this.deps.adapter.complete(
          {
            model,
            messages: conversation,
            tools: toolSpecs.length > 0 ? toolSpecs : undefined,
            temperature: opts.temperature,
            maxTokens: opts.maxTokens,
            system: conversation.find((m) => m.role === "system")?.content,
          },
          { signal: opts.signal },
        );
        this.deps.bus.emit(
          "model.response",
          {
            adapter: response.adapterId,
            stopReason: response.stopReason,
            toolCalls: response.toolCalls.map((c) => c.name),
            usage: response.usage,
            contentPreview: truncate(response.content, 600),
            durationMs: Date.now() - started,
          },
          { runId, stepId },
        );
        this.deps.audit.append(
          "model.response",
          { adapter: response.adapterId, stopReason: response.stopReason, usage: response.usage, toolCalls: response.toolCalls.map((c) => ({ id: c.id, name: c.name, args: redactDeep(c.arguments) })) },
          runId,
        );
        return response;
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        const transient = /429|rate limit|timeout|network|ECONNRESET|ETIMEDOUT|5\d\d/i.test(message);
        if (attempt < retries && transient) {
          const backoff = 500 * 2 ** attempt;
          this.deps.bus.emit("log", { level: "warn", message: `model call failed (${message}); retrying in ${backoff}ms` }, { runId, stepId });
          await new Promise((r) => setTimeout(r, backoff));
          continue;
        }
        throw err;
      }
    }
    throw lastError instanceof Error ? lastError : new Error(String(lastError));
  }

  /**
   * Models get tool names wrong, especially small local ones. Name resolution
   * happens *before* the gate, and only ever maps to an installed tool — it can
   * never widen authority.
   */
  private normaliseCalls(response: { content: string; toolCalls: ToolCall[] }, installedNames: string[]): ToolCall[] {
    let calls = response.toolCalls.map((c) => ({ ...c }));

    if (calls.length === 0 && !this.deps.adapter.supportsTools) {
      calls = parseTextProtocol(response.content);
    }

    return calls.map((call, i) => {
      let name = call.name;
      let args = call.arguments;

      if (typeof args === "string") {
        try {
          args = JSON.parse(args) as Record<string, unknown>;
        } catch {
          args = { __unparseable: args };
        }
      }
      if (!args || typeof args !== "object") args = {};

      if (!installedNames.includes(name)) {
        const resolved = resolveToolName(name, installedNames);
        if (resolved) name = resolved;
      }
      return { id: call.id || newId("call"), name, arguments: args as Record<string, unknown>, ...({ index: i } as object) } as ToolCall;
    });
  }

  private async executeCall(
    call: ToolCall,
    ctx: { runId: string; stepId: string; step: StepRecord; record: RunRecord; opts: RunOptions },
  ): Promise<{ record: ActionRecord; modelFeedback: string; hardStop?: { reason: Termination["reason"]; message: string } }> {
    const { runId, stepId, opts } = ctx;
    const actionId = newId("act");
    const { gate, approvals, executor, sre, budgets, bus, audit } = this.deps;

    const outcome = await gate.authorize({ runId, stepId, tool: call.name, args: call.arguments });
    budgets.addToolCall(outcome.decision.allowed);

    /* -------- blocked -------- */
    if (!outcome.decision.allowed) {
      sre.observe(call.name, call.arguments, { succeeded: false, verified: false, classification: outcome.classification });
      const blockedRecord: ActionRecord = {
        id: actionId,
        stepId,
        tool: call.name,
        args: call.arguments,
        classification: outcome.classification,
        decision: outcome.decision,
        startedAt: nowIso(),
        finishedAt: nowIso(),
        durationMs: 0,
      };
      bus.emit("action.completed", { actionId, tool: call.name, outcome: "blocked", reason: outcome.decision.reason, code: outcome.decision.code }, { runId, stepId, actionId });
      audit.append("action.blocked", { actionId, tool: call.name, code: outcome.decision.code, reason: outcome.decision.reason }, runId);

      const feedback = [BLOCKED_PREAMBLE, `code: ${outcome.decision.code}`, `reason: ${outcome.decision.reason}`, `requested: ${call.name} ${truncate(JSON.stringify(redactDeep(call.arguments)), 600)}`].join("\n");

      if (outcome.decision.code === "loop_detected" || outcome.decision.code === "budget_exhausted") {
        return { record: blockedRecord, modelFeedback: feedback, hardStop: { reason: outcome.decision.code === "loop_detected" ? "sre_stop" : "budget", message: outcome.decision.reason } };
      }
      return { record: blockedRecord, modelFeedback: feedback };
    }

    /* -------- human approval -------- */
    let approvalId: string | undefined;
    if (outcome.decision.approvalRequired) {
      if (this.deps.policy.approval.allowClassApproval && approvals.preApproved(call.name, outcome.classification, runId)) {
        audit.append("approval.pre_approved", { tool: call.name }, runId);
      } else {
        const request = approvals.request({
          runId,
          stepId,
          tool: call.name,
          args: call.arguments,
          classification: outcome.classification,
          decision: outcome.decision,
          reason: outcome.decision.reason,
        });
        approvalId = request.id;
        ctx.record.status = "waiting_for_approval";
        bus.emit("run.status_changed", { status: "waiting_for_approval" }, { runId });
        bus.emit("approval.requested", { approvalId: request.id, tool: request.tool, args: redactDeep(request.args), reason: request.reason, risk: outcome.classification.risk, reversibility: outcome.classification.reversibility }, { runId, stepId, actionId });
        audit.append("approval.requested", { approvalId: request.id, tool: request.tool, risk: outcome.classification.risk, reason: request.reason }, runId);

        const resolution: ApprovalResolution = await approvals.waitFor(request.id, {
          timeoutMs: opts.approvalTimeoutMs && opts.approvalTimeoutMs > 0 ? opts.approvalTimeoutMs : undefined,
          signal: opts.signal,
        });
        bus.emit("approval.resolved", { approvalId: request.id, status: resolution.status, scope: resolution.scope, by: resolution.by, note: resolution.note }, { runId, stepId, actionId });
        audit.append("approval.resolved", { approvalId: request.id, ...resolution }, runId);
        ctx.record.status = "running";
        bus.emit("run.status_changed", { status: "running" }, { runId });

        if (resolution.status !== "approved") {
          const deniedRecord: ActionRecord = {
            id: actionId,
            stepId,
            tool: call.name,
            args: call.arguments,
            classification: outcome.classification,
            decision: { ...outcome.decision, allowed: false, code: "approval_required", reason: `human denied approval (${resolution.note ?? "no reason given"})` },
            approvalId,
            startedAt: nowIso(),
            finishedAt: nowIso(),
            durationMs: 0,
          };
          sre.observe(call.name, call.arguments, { succeeded: false, verified: false, classification: outcome.classification });
          bus.emit("action.completed", { actionId, tool: call.name, outcome: "blocked", reason: "human denied approval" }, { runId, stepId, actionId });
          return {
            record: deniedRecord,
            modelFeedback: [
              "HARNESS: A HUMAN REVIEWED THIS ACTION AND DENIED IT. It was not executed.",
              `note: ${resolution.note ?? "(none)"}`,
              "Human authority outranks yours. Do not retry this action. Either complete the task without it, or stop and report that it requires a permission the human is not willing to grant.",
            ].join("\n"),
          };
        }
      }
    }

    /* -------- execute + verify -------- */
    const actionRecord = await executor.execute({
      runId,
      stepId,
      actionId,
      tool: outcome.tool!,
      capabilityId: outcome.capabilityId!,
      args: call.arguments,
      decision: outcome.decision,
      classification: outcome.classification,
      approvalId,
      signal: opts.signal,
    });

    const succeeded = actionRecord.result?.outcome === "success";
    const verified = actionRecord.verification?.status === "passed";
    sre.observe(call.name, call.arguments, { succeeded, verified, classification: outcome.classification });

    const parts: string[] = [];
    if (succeeded) {
      parts.push(actionRecord.result?.text ? truncate(actionRecord.result.text, 8000) : `${call.name} succeeded.`);
      if (actionRecord.verification && actionRecord.verification.status !== "skipped") {
        parts.push(formatVerification(actionRecord.verification));
        if (actionRecord.verification.status === "failed") parts.push(FAILED_VERIFICATION_PREAMBLE);
        if (actionRecord.verification.status === "indeterminate") {
          parts.push("HARNESS: verification was INDETERMINATE — the real system could not confirm the outcome. Do not treat this as success; gather better evidence or use a different approach.");
        }
      } else {
        parts.push("HARNESS: this action declared no deterministic check, so its effect is UNVERIFIED. Execution does not imply success.");
      }
    } else {
      parts.push(`HARNESS: the action did not succeed (outcome=${actionRecord.result?.outcome}).`);
      if (actionRecord.result?.error) parts.push(`error(${actionRecord.result.error.code}): ${actionRecord.result.error.message}`);
      parts.push("Diagnose from this evidence before acting again. An identical retry will be detected as a loop.");
    }
    if (actionRecord.transition && actionRecord.transition.undoOps.length > 0) {
      parts.push(`harness: this change is recorded as ${actionRecord.transition.reversibility} and can be rolled back (transition ${actionRecord.transition.id}).`);
    }

    return { record: actionRecord, modelFeedback: parts.join("\n") };
  }
}

/* ------------------------------------------------------------------ *
 * Result summarisation — the COMPLETED vs VERIFIED decision
 * ------------------------------------------------------------------ */

function summarise(input: {
  record: RunRecord;
  termination: Termination;
  agentClaim?: string;
  taskReport: VerificationReport;
  allActions: ActionRecord[];
  budgets: BudgetTracker;
  startedMs: number;
  blind?: BlindVerification;
  strict: boolean;
}): RunSummary {
  const { record, termination, agentClaim, taskReport, allActions, budgets, startedMs, blind, strict } = input;
  const executed = allActions.filter((a) => a.result);
  const blocked = allActions.filter((a) => !a.decision.allowed);
  const allowed = allActions.filter((a) => a.decision.allowed);
  const verifiedPassed = allActions.filter((a) => a.verification?.status === "passed");
  const verifiedFailed = unresolvedFailures(allActions);
  const indeterminate = allActions.filter((a) => a.verification?.status === "indeterminate");

  const tokens: Usage = {
    promptTokens: budgets.usage.promptTokens,
    completionTokens: budgets.usage.completionTokens,
    totalTokens: budgets.usage.tokens,
  };

  const base = {
    agentClaimedComplete: termination.reason === "agent_complete",
    steps: record.steps.length,
    actions: allActions.length,
    allowed: allowed.length,
    blocked: blocked.length,
    verificationsPassed: verifiedPassed.length,
    verificationsFailed: verifiedFailed.length,
    tokens,
    durationMs: Date.now() - startedMs,
  };

  let status: RunStatus;
  let explanation: string;

  if (termination.reason === "cancelled") {
    status = "cancelled";
    explanation = "The run was cancelled by the operator.";
  } else if (termination.reason === "error") {
    status = "failed";
    explanation = `The run failed: ${termination.message}`;
  } else if (taskReport.status === "failed") {
    status = "verification_failed";
    explanation = `The agent ${base.agentClaimedComplete ? "claimed completion" : "stopped"}, but the declared acceptance criteria FAILED against the real system: ${taskReport.summary}`;
  } else if (verifiedFailed.length > 0 && strict) {
    status = "verification_failed";
    explanation = `${verifiedFailed.length} action(s) executed but their deterministic verification failed and was never corrected: ${verifiedFailed.map((a) => `${a.tool} (${a.verification?.summary})`).join("; ")}`;
  } else if (taskReport.status === "indeterminate" && strict) {
    status = "verification_failed";
    explanation = `Acceptance criteria could not be decided from real state: ${taskReport.summary}`;
  } else if (taskReport.status === "passed" && verifiedFailed.length === 0) {
    status = "verified";
    explanation = `Acceptance criteria verified against the real system: ${taskReport.summary}`;
  } else if (base.agentClaimedComplete && executed.length > 0 && verifiedFailed.length === 0 && verifiedPassed.length > 0) {
    status = "verified";
    explanation = `No task-level acceptance criteria were declared, but every executed action was independently verified against real state (${verifiedPassed.length} passed, 0 failed). Action-level verification only — declare \`verify:\` expectations in agent.md for task-level proof.`;
  } else if (indeterminate.length > 0 && strict) {
    status = "completed_unverified";
    explanation = `${indeterminate.length} action(s) could not be confirmed from real state (indeterminate). The Harness will not upgrade this to VERIFIED.`;
  } else if (base.agentClaimedComplete) {
    status = "completed_unverified";
    explanation =
      executed.length === 0
        ? "The agent claimed completion without executing a single action. Nothing in the real system changed, so nothing could be verified."
        : "The agent claimed completion, but no deterministic evidence confirms the task outcome. Add acceptance criteria (agent.md `verify:`) to make this VERIFIABLE.";
  } else if (termination.reason === "budget") {
    status = "failed";
    explanation = `Stopped by budget enforcement: ${termination.message}. The agent never claimed completion.`;
  } else if (termination.reason === "sre_stop") {
    status = "failed";
    explanation = `Stopped by Agent SRE: ${termination.message}`;
  } else if (blocked.length > 0 && allowed.length === 0) {
    status = "blocked";
    explanation = `Every requested action was blocked by the authorization gate. First reason: ${blocked[0]?.decision.reason}`;
  } else {
    status = "completed_unverified";
    explanation = `The run reached the step limit (${record.steps.length} steps) without the agent claiming completion.`;
  }

  if (blind) {
    explanation += ` Blind verifier (advisory, not authoritative): risk=${blind.verdict.risk}, recommendation=${blind.verdict.recommendation}${blind.skippedReason ? ` [skipped: ${blind.skippedReason}]` : ""}.`;
    if ((blind.verdict.risk === "high" || blind.verdict.risk === "critical") && blind.verdict.recommendation === "reject" && status === "verified") {
      status = "completed_unverified";
      explanation += " Downgraded from VERIFIED because the blind verifier rejected the outcome; a human should review.";
    }
  }

  return {
    status,
    harnessVerified: status === "verified",
    explanation,
    blindVerification: blind,
    ...base,
  } as RunSummary;
}

/**
 * A failed verification only counts against the run if it was never corrected.
 * Correction is detected by a later action passing a check with the same label
 * (e.g. the same file+content assertion) — facts, not the agent's word.
 */
function unresolvedFailures(actions: ActionRecord[]): ActionRecord[] {
  const passedLabels = new Set<string>();
  for (const a of actions) {
    for (const c of a.verification?.checks ?? []) {
      if (c.status === "passed") passedLabels.add(c.label);
    }
  }
  return actions.filter((a) =>
    (a.verification?.checks ?? []).some((c) => c.status === "failed" && !passedLabels.has(c.label)),
  );
}

function describeCheck(spec: CheckSpec): string {
  return JSON.stringify(redactDeep(spec.kind === "custom" ? { kind: "custom", id: spec.id } : spec));
}

/**
 * Fallback tool protocol for models/adapters without native tool calling.
 * The agent emits a fenced ```tool block; the Harness parses it and the request
 * still goes through the identical gate.
 */
export function parseTextProtocol(content: string): ToolCall[] {
  const calls: ToolCall[] = [];
  const rx = /```(?:tool|tool_call|action)\s*\n([\s\S]*?)```/g;
  let match: RegExpExecArray | null;
  while ((match = rx.exec(content)) !== null) {
    const body = match[1]!.trim();
    try {
      const parsed = JSON.parse(body) as { name?: string; tool?: string; arguments?: unknown; args?: unknown };
      const name = parsed.name ?? parsed.tool;
      if (!name) continue;
      const args = (parsed.arguments ?? parsed.args ?? {}) as Record<string, unknown>;
      calls.push({ id: newId("call"), name: String(name), arguments: typeof args === "object" && args !== null ? args : {} });
    } catch {
      /* not a tool block */
    }
  }
  // Also accept a bare JSON object with a `name` field.
  if (calls.length === 0) {
    const bare = content.match(/^\s*\{\s*"name"\s*:[\s\S]*\}\s*$/);
    if (bare) {
      try {
        const parsed = JSON.parse(bare[0]) as { name: string; arguments?: Record<string, unknown> };
        calls.push({ id: newId("call"), name: parsed.name, arguments: parsed.arguments ?? {} });
      } catch {
        /* ignore */
      }
    }
  }
  return calls;
}

/** `write` -> `filesystem.write` when exactly one installed tool matches. */
export function resolveToolName(name: string, installed: string[]): string | undefined {
  const bare = name.split(".").pop() ?? name;
  const exact = installed.find((t) => t.toLowerCase() === name.toLowerCase());
  if (exact) return exact;
  const suffixMatches = installed.filter((t) => (t.split(".").pop() ?? "").toLowerCase() === bare.toLowerCase());
  if (suffixMatches.length === 1) return suffixMatches[0];
  const fuzzy = installed.filter((t) => t.toLowerCase().includes(bare.toLowerCase()));
  if (fuzzy.length === 1) return fuzzy[0];
  return undefined;
}
