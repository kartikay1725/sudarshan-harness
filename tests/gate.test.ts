import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { AuthorizationGate, BudgetTracker, EventBus, AuditTrail, ApprovalQueue, CapabilityRegistry, AgentSre, VerificationEngine, defaultPolicy } from "@sudarshan/core";
import { filesystemCapability, terminalCapability } from "@sudarshan/capabilities";
import { createWorkspace, type TestWorkspace } from "./helpers.js";

describe("the authorization gate", () => {
  let ws: TestWorkspace;
  let registry: CapabilityRegistry;
  let gate: AuthorizationGate;

  beforeEach(async () => {
    ws = await createWorkspace("gate");
    registry = new CapabilityRegistry();
    const policy = defaultPolicy(ws.root);
    const bus = new EventBus();
    const audit = new AuditTrail();
    const gateInstance = new AuthorizationGate({
      registry,
      policy,
      bus,
      audit,
      approvals: new ApprovalQueue(),
      budgets: new BudgetTracker({ maxSteps: 10, maxToolCalls: 100, maxTokens: 100000, maxWallClockMs: 60000 }),
      sre: new AgentSre({}, bus),
      workspaceRoot: ws.root,
    });
    gate = gateInstance;
    registry.install(filesystemCapability(policy));
    registry.install(terminalCapability(policy));
  });

  afterEach(async () => {
    await ws.cleanup();
  });

  it("refuses a tool that no installed capability provides", async () => {
    const outcome = await gate.authorize({ runId: "r1", stepId: "s1", tool: "browser.navigate", args: { url: "https://example.com" } });
    expect(outcome.decision.allowed).toBe(false);
    expect(outcome.decision.code).toBe("unknown_tool");
  });

  it("refuses an installed-but-disabled capability", async () => {
    registry.setEnabled("terminal", false);
    const outcome = await gate.authorize({ runId: "r1", stepId: "s1", tool: "terminal.exec", args: { command: "ls" } });
    expect(outcome.decision.allowed).toBe(false);
    expect(outcome.decision.code).toBe("capability_disabled");
  });

  it("refuses a path outside the workspace scope", async () => {
    const outcome = await gate.authorize({ runId: "r1", stepId: "s1", tool: "filesystem.write", args: { path: "/etc/passwd", content: "x" } });
    expect(outcome.decision.allowed).toBe(false);
    expect(outcome.decision.code).toBe("scope_violation");
  });

  it("refuses traversal that escapes the root", async () => {
    const outcome = await gate.authorize({ runId: "r1", stepId: "s1", tool: "filesystem.read", args: { path: "../../secrets.txt" } });
    expect(outcome.decision.allowed).toBe(false);
    expect(outcome.decision.code).toBe("scope_violation");
  });

  it("refuses protected paths even inside the root", async () => {
    const outcome = await gate.authorize({ runId: "r1", stepId: "s1", tool: "filesystem.read", args: { path: ".env" } });
    expect(outcome.decision.allowed).toBe(false);
    expect(outcome.decision.code).toBe("protected_path");
  });

  it("refuses a permission that was never granted", async () => {
    registry.remove("filesystem");
    const policy = defaultPolicy(ws.root);
    // Simulate an operator who installs the capability but withholds fs.delete.
    policy.permissions = policy.permissions.filter((p) => p !== "fs.delete");
    registry.install(filesystemCapability(policy));
    const strictGate = new AuthorizationGate({
      registry,
      policy,
      bus: new EventBus(),
      audit: new AuditTrail(),
      approvals: new ApprovalQueue(),
      budgets: new BudgetTracker({ maxSteps: 10, maxToolCalls: 10, maxTokens: 1000, maxWallClockMs: 1000 }),
      sre: new AgentSre(),
      workspaceRoot: ws.root,
    });
    const outcome = await strictGate.authorize({ runId: "r1", stepId: "s1", tool: "filesystem.delete", args: { path: "a.txt", reason: "test" } });
    expect(outcome.decision.allowed).toBe(false);
    expect(outcome.decision.code).toBe("permission_not_granted");
  });

  it("denies a policy-denied command (sudo)", async () => {
    const outcome = await gate.authorize({ runId: "r1", stepId: "s1", tool: "terminal.exec", args: { command: "sudo rm -rf /" } });
    expect(outcome.decision.allowed).toBe(false);
    expect(outcome.decision.code).toBe("policy_deny");
  });

  it("allows an in-scope write and declares its verification checks in advance", async () => {
    const outcome = await gate.authorize({ runId: "r1", stepId: "s1", tool: "filesystem.write", args: { path: "notes/hello.txt", content: "Hello" } });
    expect(outcome.decision.allowed).toBe(true);
    expect(outcome.decision.approvalRequired).toBe(false);
    expect(outcome.classification.reversibility).toBe("reversible");
    const kinds = (outcome.classification.checks ?? []).map((c) => c.kind);
    expect(kinds).toContain("file_exists");
    expect(kinds).toContain("file_hash");
  });

  it("requires human approval for deletion", async () => {
    await ws.write("doomed.txt", "important");
    const outcome = await gate.authorize({ runId: "r1", stepId: "s1", tool: "filesystem.delete", args: { path: "doomed.txt", reason: "cleanup" } });
    expect(outcome.decision.allowed).toBe(true);
    expect(outcome.decision.approvalRequired).toBe(true);
  });

  it("rejects malformed arguments before anything executes", async () => {
    const outcome = await gate.authorize({ runId: "r1", stepId: "s1", tool: "filesystem.write", args: { path: "a.txt" } });
    expect(outcome.decision.allowed).toBe(false);
    expect(outcome.decision.code).toBe("invalid_arguments");
  });

  it("blocks once the budget is exhausted", async () => {
    const budgets = new BudgetTracker({ maxSteps: 1, maxToolCalls: 1, maxTokens: 10, maxWallClockMs: 1000 });
    const tight = new AuthorizationGate({
      registry,
      policy: defaultPolicy(ws.root),
      bus: new EventBus(),
      audit: new AuditTrail(),
      approvals: new ApprovalQueue(),
      budgets,
      sre: new AgentSre(),
      workspaceRoot: ws.root,
    });
    budgets.addToolCall(true);
    const outcome = await tight.authorize({ runId: "r1", stepId: "s1", tool: "filesystem.read", args: { path: "." } });
    expect(outcome.decision.allowed).toBe(false);
    expect(outcome.decision.code).toBe("budget_exhausted");
  });

  it("writes every decision to the hash-chained audit trail", async () => {
    const audit = new AuditTrail();
    const policy = defaultPolicy(ws.root);
    const g = new AuthorizationGate({
      registry,
      policy,
      bus: new EventBus(),
      audit,
      approvals: new ApprovalQueue(),
      budgets: new BudgetTracker({ maxSteps: 5, maxToolCalls: 50, maxTokens: 10000, maxWallClockMs: 10000 }),
      sre: new AgentSre(),
      workspaceRoot: ws.root,
    });
    await g.authorize({ runId: "r1", stepId: "s1", tool: "filesystem.read", args: { path: "." } });
    await g.authorize({ runId: "r1", stepId: "s1", tool: "filesystem.read", args: { path: "/etc/shadow" } });
    expect(audit.all().length).toBe(2);
    expect(audit.verifyChain().ok).toBe(true);
  });

  it("VerificationEngine is constructible from the same policy", () => {
    const engine = new VerificationEngine({ workspaceRoot: ws.root, policy: defaultPolicy(ws.root) });
    expect(engine).toBeDefined();
  });
});
