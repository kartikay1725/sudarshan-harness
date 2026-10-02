import { describe, expect, it, afterEach } from "vitest";
import type { HarnessEvent } from "@sudarshan/core";
import { createWorkspace, createTestHarness, type TestWorkspace } from "./helpers.js";

/**
 * End-to-end tests through the real pipeline:
 *
 *   model -> GATE -> execute -> VERIFY -> feedback -> next step -> final status
 *
 * The scripted adapter stands in for a model. Everything else — authorization,
 * execution, deterministic verification, state capture, summarisation — is the
 * production code path operating on a real filesystem.
 */
describe("the run loop", () => {
  let ws: TestWorkspace | undefined;

  afterEach(async () => {
    await ws?.cleanup();
    ws = undefined;
  });

  it("verifies a task when the agent's work matches reality", async () => {
    ws = await createWorkspace("run-ok");
    const harness = await createTestHarness(ws, {
      script: [
        { kind: "tool", name: "filesystem.list", arguments: { path: "." } },
        { kind: "tool", name: "filesystem.write", arguments: { path: "report.txt", content: "# Report\nAll good.\n" } },
        { kind: "text", content: "I created report.txt with the summary." },
      ],
    });

    const events: HarnessEvent[] = [];
    harness.bus.on((e) => events.push(e));

    const run = await harness.run("Create a report file summarising the workspace.", {
      model: "scripted",
      expectations: [{ kind: "file_exists", path: "report.txt" }, { kind: "file_contains", path: "report.txt", text: "All good." }],
    });

    expect(run.status).toBe("verified");
    expect(run.summary?.harnessVerified).toBe(true);
    expect(run.summary?.agentClaimedComplete).toBe(true);
    expect(run.summary?.actions).toBe(2);
    expect(run.summary?.blocked).toBe(0);
    expect(await ws.read("report.txt")).toContain("All good.");
    expect(events.some((e) => e.type === "verification.completed")).toBe(true);
    expect(harness.auditChainStatus().ok).toBe(true);
  });

  it("refuses to call a claim VERIFIED when reality disagrees", async () => {
    ws = await createWorkspace("run-lie");
    const harness = await createTestHarness(ws, {
      script: [
        { kind: "tool", name: "filesystem.write", arguments: { path: "report.txt", content: "draft" } },
        { kind: "text", content: "Done — report.txt contains the full analysis." },
      ],
    });

    const run = await harness.run("Write the full analysis into report.txt.", {
      model: "scripted",
      expectations: [{ kind: "file_contains", path: "report.txt", text: "full analysis" }],
    });

    expect(run.status).toBe("verification_failed");
    expect(run.summary?.harnessVerified).toBe(false);
    expect(run.summary?.agentClaimedComplete).toBe(true);
    expect(run.summary?.explanation).toMatch(/FAILED/i);
  });

  it("tells the agent that execution is not success, and lets it recover", async () => {
    ws = await createWorkspace("run-recover");
    const harness = await createTestHarness(ws, {
      capabilities: ["filesystem", "terminal"],
      script: [
        // Step 1: the command SUCCEEDS (exit 0) but the expected output is
        // wrong. Execution did not mean success.
        { kind: "tool", name: "terminal.exec", arguments: { command: "echo hello", expectStdout: "goodbye" } },
        (ctx) => {
          const feedback = ctx.lastFeedback[0] ?? "";
          expect(feedback).toMatch(/HARNESS VERIFICATION/i);
          expect(feedback).toMatch(/COMPLETED != VERIFIED/);
          // Step 2: correct the action. Verification now passes.
          return { kind: "tool", name: "terminal.exec", arguments: { command: "echo goodbye", expectStdout: "goodbye" } };
        },
        { kind: "tool", name: "filesystem.write", arguments: { path: "notes.md", content: "# Notes\nVerified content.\n" } },
        { kind: "text", content: "Fixed and finished." },
      ],
    });

    const run = await harness.run("Make the command print goodbye and record it in notes.md.", {
      model: "scripted",
      expectations: [{ kind: "file_contains", path: "notes.md", text: "Verified content" }],
    });

    const actions = run.steps.flatMap((s) => s.actions);
    expect(actions.length).toBe(3);
    expect(actions[0]!.result?.outcome).toBe("success");
    expect(actions[0]!.verification?.status).toBe("failed");
    expect(actions[1]!.verification?.status).toBe("passed");
    // The corrected action resolves the earlier failure, so the run is verified.
    expect(run.status).toBe("verified");
  });

  it("reports a failed action as evidence, not as success", async () => {
    ws = await createWorkspace("run-error");
    const harness = await createTestHarness(ws, {
      script: [
        { kind: "tool", name: "filesystem.edit", arguments: { path: "missing.txt", oldText: "a", newText: "b" } },
        { kind: "tool", name: "filesystem.write", arguments: { path: "missing.txt", content: "b" } },
        { kind: "text", content: "created it instead" },
      ],
    });
    const run = await harness.run("Change a to b in missing.txt.", {
      model: "scripted",
      expectations: [{ kind: "file_contains", path: "missing.txt", text: "b" }],
    });
    const actions = run.steps.flatMap((s) => s.actions);
    expect(actions[0]!.result?.outcome).toBe("error");
    expect(actions[0]!.result?.error?.code).toBe("ENOENT");
    expect(actions[0]!.verification?.status).toBe("skipped");
    expect(run.conversation.filter((m) => m.role === "tool")[0]!.content).toMatch(/did not succeed/);
    expect(run.status).toBe("verified");
  });

  it("reports a claim of completion with no action as unverified", async () => {
    ws = await createWorkspace("run-noop");
    const harness = await createTestHarness(ws, {
      script: [{ kind: "text", content: "Everything is already done." }],
    });

    const run = await harness.run("Tidy the workspace.", { model: "scripted" });
    expect(run.status).toBe("completed_unverified");
    expect(run.summary?.actions).toBe(0);
    expect(run.summary?.explanation).toMatch(/without executing a single action/);
  });

  it("blocks an out-of-scope action and feeds the reason back to the model", async () => {
    ws = await createWorkspace("run-scope");
    const harness = await createTestHarness(ws, {
      script: [
        { kind: "tool", name: "filesystem.write", arguments: { path: "/etc/cron.d/evil", content: "pwn" } },
        { kind: "tool", name: "filesystem.write", arguments: { path: "safe.txt", content: "ok" } },
        { kind: "text", content: "Done." },
      ],
    });

    const run = await harness.run("Install a cron job and write a note.", { model: "scripted" });
    const actions = run.steps.flatMap((s) => s.actions);
    expect(actions[0]!.decision.allowed).toBe(false);
    expect(actions[0]!.decision.code).toBe("scope_violation");
    expect(actions[1]!.decision.allowed).toBe(true);
    expect(run.summary?.blocked).toBe(1);
    // The model was told why, in the conversation.
    const toolMessages = run.conversation.filter((m) => m.role === "tool");
    expect(toolMessages[0]!.content).toMatch(/blocked/i);
    expect(toolMessages[0]!.content).toMatch(/does not grant permission/i);
  });

  it("detects a repeated identical action, intervenes, then blocks it", async () => {
    ws = await createWorkspace("run-loop");
    await ws.write("a.txt", "one");
    const same = { kind: "tool" as const, name: "filesystem.write", arguments: { path: "a.txt", content: "same" } };
    const harness = await createTestHarness(ws, {
      policy: { budgets: { maxSteps: 12, maxToolCalls: 40, maxTokens: 100000, maxWallClockMs: 60000, maxRepeatedActions: 2, maxUnverifiedSteps: 5 } },
      script: [same, same, same, same, same, { kind: "text", content: "gave up" }],
    });

    const run = await harness.run("Write the same content over and over.", { model: "scripted" });
    const alerts = harness.bus.recent(1000).filter((e) => e.type === "sre.alert");
    expect(alerts.length).toBeGreaterThan(0);
    const blockedByLoop = run.steps.flatMap((s) => s.actions).filter((a) => a.decision.code === "loop_detected");
    expect(blockedByLoop.length).toBeGreaterThan(0);
    expect(["failed", "verification_failed", "completed_unverified"]).toContain(run.status);
  });

  it("parses tool calls from the text protocol when the model has no native tools", async () => {
    ws = await createWorkspace("run-text");
    const harness = await createTestHarness(ws, {
      textProtocol: true,
      script: [
        { kind: "tool", name: "filesystem.write", arguments: { path: "hello.txt", content: "Hello" } },
        { kind: "text", content: "Wrote hello.txt" },
      ],
    });

    const run = await harness.run("Write hello.txt containing Hello.", {
      model: "scripted",
      expectations: [{ kind: "file_contains", path: "hello.txt", text: "Hello" }],
    });
    expect(run.status).toBe("verified");
  });

  it("resolves a misnamed tool to the single installed match", async () => {
    ws = await createWorkspace("run-misnamed");
    const harness = await createTestHarness(ws, {
      capabilities: ["filesystem"],
      script: [
        { kind: "tool", name: "write", arguments: { path: "ok.txt", content: "yes" } },
        { kind: "text", content: "done" },
      ],
    });
    const run = await harness.run("Write ok.txt.", {
      model: "scripted",
      expectations: [{ kind: "file_exists", path: "ok.txt" }],
    });
    const actions = run.steps.flatMap((s) => s.actions);
    expect(actions[0]!.tool).toBe("filesystem.write");
    expect(run.status).toBe("verified");
  });

  it("waits for a human before deleting, and honours a denial", async () => {
    ws = await createWorkspace("run-approval");
    await ws.write("important.txt", "keep me");
    const harness = await createTestHarness(ws, {
      script: [
        { kind: "tool", name: "filesystem.delete", arguments: { path: "important.txt", reason: "not needed" } },
        { kind: "text", content: "Understood, leaving it in place." },
      ],
    });

    const runPromise = harness.run("Delete important.txt.", { model: "scripted", approvalTimeoutMs: 5000 });
    // Wait for the approval request to surface.
    const approvalId = await new Promise<string>((resolve) => {
      harness.bus.on((e) => {
        if (e.type === "approval.requested") resolve((e.payload as { approvalId: string }).approvalId);
      });
    });
    expect(harness.pendingApprovals().length).toBe(1);
    harness.resolveApproval(approvalId, { status: "denied", scope: "once", by: "test-human", note: "no, that file matters" });

    const run = await runPromise;
    const actions = run.steps.flatMap((s) => s.actions);
    expect(actions[0]!.decision.allowed).toBe(false);
    expect(actions[0]!.decision.code).toBe("approval_required");
    expect(await ws.exists("important.txt")).toBe(true);
    const toolMessage = run.conversation.find((m) => m.role === "tool")!.content;
    expect(toolMessage).toMatch(/HUMAN REVIEWED THIS ACTION AND DENIED IT/);
  });

  it("lets a human approve a whole class so autonomy survives", async () => {
    ws = await createWorkspace("run-class");
    await ws.write("one.txt", "1");
    await ws.write("two.txt", "2");
    const harness = await createTestHarness(ws, {
      script: [
        { kind: "tool", name: "filesystem.delete", arguments: { path: "one.txt", reason: "cleanup" } },
        { kind: "tool", name: "filesystem.delete", arguments: { path: "two.txt", reason: "cleanup" } },
        { kind: "text", content: "cleaned" },
      ],
    });

    const runPromise = harness.run("Delete both text files.", { model: "scripted", approvalTimeoutMs: 5000 });
    const approvalId = await new Promise<string>((resolve) => {
      harness.bus.on((e) => {
        if (e.type === "approval.requested") resolve((e.payload as { approvalId: string }).approvalId);
      });
    });
    harness.resolveApproval(approvalId, { status: "approved", scope: "class", by: "test-human" });

    const run = await runPromise;
    const approvals = run.steps.flatMap((s) => s.actions).filter((a) => a.approvalId);
    expect(approvals.length).toBe(1); // the second delete rode on the class approval
    expect(await ws.exists("one.txt")).toBe(false);
    expect(await ws.exists("two.txt")).toBe(false);
  });

  it("stops at the step budget and says so honestly", async () => {
    ws = await createWorkspace("run-steps");
    const harness = await createTestHarness(ws, {
      policy: { budgets: { maxSteps: 2, maxToolCalls: 20, maxTokens: 100000, maxWallClockMs: 60000, maxRepeatedActions: 99, maxUnverifiedSteps: 99 } },
      script: [
        { kind: "tool", name: "filesystem.list", arguments: { path: "." } },
        { kind: "tool", name: "filesystem.list", arguments: { path: "." } },
        { kind: "tool", name: "filesystem.list", arguments: { path: "." } },
      ],
    });
    const run = await harness.run("List forever.", { model: "scripted" });
    expect(run.steps.length).toBeLessThanOrEqual(2);
    expect(run.summary?.agentClaimedComplete).toBe(false);
  });
});
