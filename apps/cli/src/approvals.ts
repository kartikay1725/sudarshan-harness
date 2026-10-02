import { createInterface } from "node:readline";
import type { ApprovalRequest } from "@sudarshan/core";
import { Harness } from "@sudarshan/core";
import { c, formatArgs, riskColor } from "./render.js";

export type ApprovalMode = "interactive" | "auto" | "deny";

/**
 * Human authority, at the terminal.
 *
 * `interactive` (default) blocks the run and asks a person. `auto` and `deny`
 * exist for CI; both are recorded in the audit trail as an *operator* decision
 * taken before the run started — which is a different thing from the agent
 * approving itself, and is labelled as such.
 */
export function attachApprovals(harness: Harness, mode: ApprovalMode, opts: { timeoutMs?: number } = {}): () => void {
  if (mode === "auto") {
    return harness.bus.onType("approval.requested", (event) => {
      const payload = event.payload as { approvalId: string };
      console.log(`  ${c.magenta("⏸ auto-approving (operator pre-authorized this class):")} ${payload.approvalId}`);
      harness.resolveApproval(payload.approvalId, { status: "approved", scope: "class", by: "operator:--approval-mode=auto", note: "pre-authorized by the operator before the run" });
    });
  }

  if (mode === "deny") {
    return harness.bus.onType("approval.requested", (event) => {
      const payload = event.payload as { approvalId: string };
      harness.resolveApproval(payload.approvalId, { status: "denied", scope: "once", by: "operator:--approval-mode=deny", note: "run started with --approval-mode=deny" });
    });
  }

  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return harness.bus.onType("approval.requested", (event) => {
    const payload = event.payload as ApprovalRequest & { approvalId: string };
    const request = harness.pendingApprovals().find((r) => r.id === payload.approvalId);
    if (!request) return;
    printApprovalRequest(request);
    rl.question(`  ${c.bold("approve?")} [y]es once / [c]lass / [n]o / [s]how args > `, (answer) => {
      const choice = answer.trim().toLowerCase();
      if (choice === "y" || choice === "yes") {
        harness.resolveApproval(request.id, { status: "approved", scope: "once", by: "human:terminal" });
      } else if (choice === "c" || choice === "class") {
        harness.resolveApproval(request.id, { status: "approved", scope: "class", by: "human:terminal", note: "approved for this class of action" });
      } else if (choice === "s") {
        console.log(c.grey(JSON.stringify(request.args, null, 2)));
        harness.resolveApproval(request.id, { status: "denied", scope: "once", by: "human:terminal", note: "timed out while inspecting arguments" });
      } else {
        harness.resolveApproval(request.id, { status: "denied", scope: "once", by: "human:terminal", note: choice ? `denied (${choice})` : "denied" });
      }
    });
    if (opts.timeoutMs) {
      setTimeout(() => {
        if (harness.pendingApprovals().some((r) => r.id === request.id)) {
          console.log(c.yellow(`  approval timed out after ${opts.timeoutMs}ms — treating as denial`));
          harness.resolveApproval(request.id, { status: "denied", scope: "once", by: "timeout" });
        }
      }, opts.timeoutMs);
    }
  });
}

export function printApprovalRequest(request: ApprovalRequest): void {
  console.log("");
  console.log(c.magenta(c.bold("  ⏸ WAITING FOR HUMAN APPROVAL")));
  console.log(`  ${c.grey("action:")}        ${c.bold(request.tool)}`);
  console.log(`  ${c.grey("arguments:")}     ${formatArgs(request.args, 200)}`);
  console.log(`  ${c.grey("risk:")}          ${riskColor(request.classification.risk)}`);
  console.log(`  ${c.grey("reversibility:")} ${request.classification.reversibility}${request.classification.reversibility === "irreversible" ? c.red(" — this cannot be undone") : ""}`);
  if (request.classification.targets.length > 0) {
    console.log(`  ${c.grey("targets:")}       ${request.classification.targets.map((t) => `${t.kind}:${t.value}`).join(", ")}`);
  }
  console.log(`  ${c.grey("why:")}           ${request.reason}`);
}

export function closeApprovals(detach: () => void): void {
  detach();
}
