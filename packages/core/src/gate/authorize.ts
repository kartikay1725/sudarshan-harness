import type {
  ActionClassification,
  AuthorizationDecision,
  DenialCode,
  Policy,
  ToolDefinition,
} from "../types.js";
import type { CapabilityRegistry, InstalledCapability } from "../capability/registry.js";
import type { EventBus } from "../events/bus.js";
import type { AuditTrail } from "../audit/trail.js";
import type { ApprovalQueue } from "../approval/queue.js";
import type { BudgetTracker } from "../sre/budget.js";
import type { AgentSre } from "../sre/watchdog.js";
import { checkTargets } from "../policy/scope.js";
import { matchRules, permissionGranted } from "../policy/policy.js";
import { validateArgs, type SchemaIssue } from "../util/schema.js";
import { nowIso } from "../util/index.js";

export interface GateRequest {
  runId: string;
  stepId: string;
  tool: string;
  args: Record<string, unknown>;
}

export interface GateOutcome {
  decision: AuthorizationDecision;
  classification: ActionClassification;
  tool?: ToolDefinition;
  capabilityId?: string;
  schemaIssues?: SchemaIssue[];
}

const EMPTY_CLASSIFICATION: ActionClassification = {
  risk: "low",
  reversibility: "unknown",
  targets: [],
};

/**
 * THE GATE.
 *
 * Every meaningful action passes through exactly one function: `authorize()`.
 * There is no other path from the model to the real world — the executor is
 * private to the Harness and refuses calls that lack a decision record.
 *
 * Check order (fail-closed, cheapest first):
 *   1. Is the tool real (capability installed)?
 *   2. Is the capability enabled?
 *   3. Are the arguments valid?
 *   4. Is the permission granted?
 *   5. Does an explicit deny rule match?
 *   6. Are all scope targets inside policy?
 *   7. Is the budget left?
 *   8. Is the agent looping?
 *   9. Does a human have to approve this?
 *
 * Note what is NOT here: nothing about *how* the agent chose to do the task.
 * Autonomy lives inside the boundary; the boundary is not negotiable.
 */
export class AuthorizationGate {
  constructor(
    private deps: {
      registry: CapabilityRegistry;
      policy: Policy;
      bus: EventBus;
      audit: AuditTrail;
      approvals: ApprovalQueue;
      budgets: BudgetTracker;
      sre: AgentSre;
      workspaceRoot: string;
    },
  ) {}

  get policy(): Policy {
    return this.deps.policy;
  }

  async authorize(req: GateRequest): Promise<GateOutcome> {
    const started = nowIso();
    this.deps.bus.emit("authorization.requested", { tool: req.tool, args: req.args }, { runId: req.runId, stepId: req.stepId });

    const deny = (
      code: DenialCode,
      reason: string,
      partial: Partial<AuthorizationDecision> & { classification?: ActionClassification } = {},
    ): GateOutcome => {
      const decision: AuthorizationDecision = {
        allowed: false,
        tool: req.tool,
        permission: partial.permission ?? "unknown",
        risk: partial.risk ?? "low",
        reversibility: partial.reversibility ?? "unknown",
        targets: partial.targets ?? [],
        code,
        reason,
        ruleId: partial.ruleId,
        approvalRequired: false,
        decidedAt: started,
      };
      this.record(req, decision, partial);
      return { decision, classification: partial.classification ?? EMPTY_CLASSIFICATION };
    };

    // 1. Is the tool real?
    const found = this.deps.registry.findTool(req.tool);
    if (!found) {
      return deny("unknown_tool", `No installed capability provides "${req.tool}". A tool that is not installed does not exist, whatever the model believes.`);
    }
    const { tool, capability } = found as { tool: ToolDefinition; capability: InstalledCapability };

    // 2. Is the capability enabled?
    if (!capability.enabled) {
      return deny("capability_disabled", `Capability "${capability.capability.id}" is installed but disabled.`, { permission: tool.permission });
    }

    // 3. Are the arguments valid?
    const schemaIssues = validateArgs(tool.parameters as Record<string, unknown>, req.args);
    if (schemaIssues.length > 0) {
      return deny(
        "invalid_arguments",
        `Arguments rejected: ${schemaIssues.map((i) => `${i.path} ${i.message}`).join("; ")}`,
        { permission: tool.permission },
      );
    }

    // Classify from the concrete arguments (risk, reversibility, targets, checks).
    let classification: ActionClassification = {
      risk: tool.defaultRisk,
      reversibility: tool.defaultReversibility,
      targets: [],
    };
    if (tool.classify) {
      try {
        classification = await tool.classify(req.args, {
          workspaceRoot: this.deps.workspaceRoot,
          runId: req.runId,
          stepId: req.stepId,
          config: {},
          env: process.env as Record<string, string | undefined>,
          log: () => undefined,
          recordEvidence: () => undefined,
        });
      } catch (err) {
        return deny(
          "invalid_arguments",
          `Classification failed (fail-closed): ${err instanceof Error ? err.message : String(err)}`,
          { permission: tool.permission },
        );
      }
    }
    // UNKNOWN reversibility is treated as irreversible for approval purposes.
    const effectiveReversibility = classification.reversibility === "unknown" ? "irreversible" : classification.reversibility;

    // 4. Permission granted?
    if (!permissionGranted(tool.permission, this.deps.policy)) {
      return deny(
        "permission_not_granted",
        `Permission "${tool.permission}" is not granted to this agent.`,
        { permission: tool.permission, risk: classification.risk, reversibility: classification.reversibility, targets: classification.targets, classification },
      );
    }

    // 5. Explicit rules (deny wins, then approval requirements).
    const targetValues = classification.targets.map((t) => t.value);
    const matched = matchRules(
      { tool: req.tool, permission: tool.permission, args: req.args, targetValues },
      this.deps.policy,
    );
    const denied = matched.find((m) => m.rule.effect === "deny");
    if (denied) {
      return deny("policy_deny", denied.rule.reason, {
        permission: tool.permission,
        risk: classification.risk,
        reversibility: classification.reversibility,
        targets: classification.targets,
        ruleId: denied.rule.id,
        classification,
      });
    }

    // 6. Scope.
    const scopeCheck = checkTargets(classification.targets, this.deps.policy, this.deps.workspaceRoot);
    if (!scopeCheck.ok) {
      return deny(scopeCheck.code === "protected_path" ? "protected_path" : "scope_violation", scopeCheck.reason ?? "outside allowed scope", {
        permission: tool.permission,
        risk: classification.risk,
        reversibility: classification.reversibility,
        targets: classification.targets,
        classification,
      });
    }

    // 7. Budget.
    const violation = this.deps.budgets.violation();
    if (violation) {
      return deny("budget_exhausted", violation.message, {
        permission: tool.permission,
        risk: classification.risk,
        reversibility: classification.reversibility,
        targets: classification.targets,
        classification,
      });
    }

    // 8. Loops (hard stop only when the watchdog escalated to `stop`).
    const loop = this.deps.sre.evaluateAction(req.tool, req.args, classification);
    if (loop?.action === "stop") {
      return deny("loop_detected", loop.message, {
        permission: tool.permission,
        risk: classification.risk,
        reversibility: classification.reversibility,
        targets: classification.targets,
        classification,
      });
    }

    // 9. Approval.
    const approvalReason = this.approvalReason(req.tool, classification, effectiveReversibility, matched.map((m) => m.rule.requireApproval === true));
    let approvalRequired = false;
    if (approvalReason) {
      const preApproved = this.deps.approvals.preApproved(req.tool, classification, req.runId);
      approvalRequired = !preApproved;
    }

    const decision: AuthorizationDecision = {
      allowed: true,
      tool: req.tool,
      permission: tool.permission,
      risk: classification.risk,
      reversibility: classification.reversibility,
      targets: classification.targets,
      reason: approvalRequired ? `allowed, pending human approval: ${approvalReason}` : approvalReason ? `allowed (pre-approved class): ${approvalReason}` : "allowed",
      approvalRequired,
      decidedAt: started,
      ruleId: matched.find((m) => m.rule.requireApproval)?.rule.id,
    };

    this.record(req, decision, { classification, capabilityId: capability.capability.id });
    return { decision, classification, tool, capabilityId: capability.capability.id, schemaIssues };
  }

  private approvalReason(
    tool: string,
    classification: ActionClassification,
    reversibility: string,
    ruleRequires: boolean[],
  ): string | undefined {
    const reasons: string[] = [];
    if (ruleRequires.some(Boolean)) reasons.push("policy rule requires approval");
    if (this.deps.policy.approval.requireForRisk.includes(classification.risk)) {
      reasons.push(`risk level "${classification.risk}" requires approval`);
    }
    if (this.deps.policy.approval.requireForReversibility.includes(reversibility as never)) {
      reasons.push(`reversibility "${reversibility}" requires approval`);
    }
    if (this.deps.policy.approval.requireForTools.includes(tool)) {
      reasons.push(`tool "${tool}" is on the approval list`);
    }
    return reasons.length ? reasons.join("; ") : undefined;
  }

  private record(req: GateRequest, decision: AuthorizationDecision, extra: { classification?: ActionClassification; capabilityId?: string }): void {
    this.deps.bus.emit("authorization.decided", { ...decision, capabilityId: extra.capabilityId }, { runId: req.runId, stepId: req.stepId });
    this.deps.audit.append(
      decision.allowed ? "authorization.allow" : "authorization.deny",
      {
        tool: req.tool,
        args: req.args,
        permission: decision.permission,
        risk: decision.risk,
        reversibility: decision.reversibility,
        targets: decision.targets,
        code: decision.code,
        reason: decision.reason,
        ruleId: decision.ruleId,
        approvalRequired: decision.approvalRequired,
      },
      req.runId,
    );
  }
}
