import type { ActionClassification, AuthorizationDecision, RiskLevel } from "../types.js";
import { newId, nowIso } from "../util/index.js";

export type ApprovalStatus = "pending" | "approved" | "denied" | "expired";

export interface ApprovalRequest {
  id: string;
  runId: string;
  stepId: string;
  tool: string;
  args: Record<string, unknown>;
  classification: ActionClassification;
  decision: AuthorizationDecision;
  reason: string;
  status: ApprovalStatus;
  requestedAt: string;
  resolvedAt?: string;
  resolvedBy?: string;
  /** When true the approval covers the whole class of action, not one call. */
  scope: "once" | "class" | "run";
  classKey?: string;
}

export interface ApprovalResolution {
  status: "approved" | "denied";
  scope?: "once" | "class" | "run";
  by?: string;
  note?: string;
}

/**
 * Human authority > agent authority.
 *
 * The queue pauses a run (WAITING_FOR_APPROVAL) until a person decides.
 * Approving a *class* keeps autonomy usable: one decision can cover every
 * `filesystem.delete` inside scope for the rest of the run, instead of a
 * dialog per file. Approvals never widen policy — they satisfy a requirement
 * that policy already created.
 */
export class ApprovalQueue {
  private requests = new Map<string, ApprovalRequest>();
  private waiters = new Map<string, (resolution: ApprovalResolution) => void>();
  private classApprovals = new Set<string>();
  private runApprovals = new Map<string, Set<string>>();

  isClassApproved(classKey: string, runId?: string): boolean {
    if (this.classApprovals.has(classKey)) return true;
    if (runId && this.runApprovals.get(runId)?.has(classKey)) return true;
    return false;
  }

  request(input: {
    runId: string;
    stepId: string;
    tool: string;
    args: Record<string, unknown>;
    classification: ActionClassification;
    decision: AuthorizationDecision;
    reason: string;
  }): ApprovalRequest {
    const classKey = classOf(input.tool, input.classification);
    const req: ApprovalRequest = {
      id: newId("apr"),
      ...input,
      status: "pending",
      requestedAt: nowIso(),
      scope: "once",
      classKey,
    };
    this.requests.set(req.id, req);
    return req;
  }

  /** Resolves immediately if the class was already approved by a human. */
  preApproved(tool: string, classification: ActionClassification, runId: string): boolean {
    return this.isClassApproved(classOf(tool, classification), runId);
  }

  waitFor(id: string, opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<ApprovalResolution> {
    const existing = this.requests.get(id);
    if (existing && existing.status !== "pending") {
      return Promise.resolve({
        status: existing.status === "approved" ? "approved" : "denied",
        scope: existing.scope,
        by: existing.resolvedBy,
      });
    }
    return new Promise<ApprovalResolution>((resolve, reject) => {
      const timer = opts.timeoutMs
        ? setTimeout(() => {
            this.waiters.delete(id);
            const req = this.requests.get(id);
            if (req && req.status === "pending") {
              req.status = "expired";
              req.resolvedAt = nowIso();
            }
            resolve({ status: "denied", scope: "once", note: "approval timed out" });
          }, opts.timeoutMs)
        : undefined;

      this.waiters.set(id, (resolution) => {
        if (timer) clearTimeout(timer);
        opts.signal?.removeEventListener("abort", onAbort);
        resolve(resolution);
      });

      function onAbort() {
        if (timer) clearTimeout(timer);
        resolve({ status: "denied", scope: "once", note: "run cancelled" });
      }
      opts.signal?.addEventListener("abort", onAbort, { once: true });
    });
  }

  resolve(id: string, resolution: ApprovalResolution): ApprovalRequest | undefined {
    const req = this.requests.get(id);
    if (!req) return undefined;
    if (req.status !== "pending") return req;
    req.status = resolution.status;
    req.resolvedAt = nowIso();
    req.resolvedBy = resolution.by ?? "human";
    req.scope = resolution.scope ?? "once";

    if (resolution.status === "approved" && req.classKey) {
      if (req.scope === "class") this.classApprovals.add(req.classKey);
      if (req.scope === "run") {
        const set = this.runApprovals.get(req.runId) ?? new Set<string>();
        set.add(req.classKey);
        this.runApprovals.set(req.runId, set);
      }
    }

    const waiter = this.waiters.get(id);
    this.waiters.delete(id);
    waiter?.({ status: resolution.status, scope: req.scope, by: req.resolvedBy, note: resolution.note });
    return req;
  }

  /** Cancel everything outstanding for a run (used on abort). */
  cancelRun(runId: string, note = "run cancelled"): number {
    let count = 0;
    for (const req of this.requests.values()) {
      if (req.runId === runId && req.status === "pending") {
        this.resolve(req.id, { status: "denied", scope: "once", note });
        count++;
      }
    }
    return count;
  }

  pending(runId?: string): ApprovalRequest[] {
    return [...this.requests.values()].filter((r) => r.status === "pending" && (!runId || r.runId === runId));
  }

  all(): ApprovalRequest[] {
    return [...this.requests.values()].sort((a, b) => a.requestedAt.localeCompare(b.requestedAt));
  }

  clearApprovals(): void {
    this.classApprovals.clear();
    this.runApprovals.clear();
  }
}

/** A class is "same tool + same risk + same target kind", never "same arguments". */
export function classOf(tool: string, classification: ActionClassification): string {
  const kinds = [...new Set(classification.targets.map((t) => t.kind))].sort().join("+") || "none";
  const risk: RiskLevel = classification.risk;
  return `${tool}|risk=${risk}|targets=${kinds}`;
}
