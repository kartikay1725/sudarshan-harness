import { describe, expect, it } from "vitest";
import { AgentSre, BudgetTracker, DEFAULT_SRE_LIMITS } from "@sudarshan/core";

describe("Agent SRE — the watchdog", () => {
  it("warns, then blocks, an identical repeated action", () => {
    const sre = new AgentSre({ maxRepeatedActions: 3 });
    const args = { path: "a.txt", content: "same" };
    const verdicts: Array<string | undefined> = [];

    // Six identical attempts: warn at the 3rd, hard stop at the 6th.
    for (let attempt = 1; attempt <= 6; attempt++) {
      const alert = sre.evaluateAction("filesystem.write", args);
      verdicts.push(alert?.action);
      sre.observe("filesystem.write", args, { succeeded: true, verified: true });
    }

    expect(verdicts[0]).toBeUndefined();
    expect(verdicts[1]).toBeUndefined();
    expect(verdicts[2]).toBe("advise");
    expect(verdicts[5]).toBe("stop");

    const alert = sre.all().find((a) => a.action === "stop")!;
    expect(alert.kind).toBe("loop");
    expect(alert.intervention).toMatch(/BLOCKED/);
    expect(alert.intervention).toMatch(/will not succeed/i);
  });

  it("does not treat different arguments as a loop", () => {
    const sre = new AgentSre({ maxRepeatedActions: 2 });
    for (let i = 0; i < 6; i++) {
      const args = { path: `file-${i}.txt`, content: `${i}` };
      expect(sre.evaluateAction("filesystem.write", args)?.kind).not.toBe("loop");
      sre.observe("filesystem.write", args, { succeeded: true, verified: true });
    }
  });

  it("detects oscillation between two contradictory actions", () => {
    const sre = new AgentSre();
    const a = { path: "x.txt", content: "A" };
    const b = { path: "x.txt", content: "B" };
    sre.observe("filesystem.write", a, { succeeded: true, verified: true });
    sre.observe("filesystem.write", b, { succeeded: true, verified: true });
    sre.observe("filesystem.write", a, { succeeded: true, verified: true });
    sre.observe("filesystem.write", b, { succeeded: true, verified: true });
    const alert = sre.evaluateAction("filesystem.write", a);
    expect(alert?.kind).toBe("oscillation");
    expect(alert?.intervention).toMatch(/oscillating/i);
  });

  it("flags a tool that keeps failing with the same arguments", () => {
    const sre = new AgentSre({ maxRepeatedActions: 99 });
    const args = { command: "npm test" };
    for (let i = 0; i < 3; i++) {
      sre.observe("terminal.exec", args, { succeeded: false, verified: false });
    }
    const alert = sre.evaluateAction("terminal.exec", args);
    expect(alert?.kind).toBe("repeated_failure");
  });

  it("detects a stall: steps passing with nothing verified", () => {
    const sre = new AgentSre({ maxUnverifiedSteps: 2 });
    sre.beginStep();
    expect(sre.endStep(false).length).toBe(0);
    sre.beginStep();
    const alerts = sre.endStep(false);
    expect(alerts[0]?.kind).toBe("stall");
    expect(alerts[0]?.intervention).toMatch(/no verified change/i);
  });

  it("resets the stall counter when something verified changes", () => {
    const sre = new AgentSre({ maxUnverifiedSteps: 2 });
    sre.beginStep();
    sre.endStep(false);
    sre.beginStep();
    expect(sre.endStep(true).length).toBe(0);
    sre.beginStep();
    expect(sre.endStep(false).length).toBe(0);
  });

  it("stops a runaway step", () => {
    const sre = new AgentSre({ maxCallsPerStep: 3, maxRepeatedActions: 99 });
    sre.beginStep();
    expect(sre.evaluateAction("filesystem.read", { path: "1" })).toBeUndefined();
    expect(sre.evaluateAction("filesystem.read", { path: "2" })).toBeUndefined();
    expect(sre.evaluateAction("filesystem.read", { path: "3" })).toBeUndefined();
    const alert = sre.evaluateAction("filesystem.read", { path: "4" });
    expect(alert?.kind).toBe("runaway");
    expect(alert?.action).toBe("stop");
  });

  it("an intervention never widens authority — it only carries a message", () => {
    const sre = new AgentSre({ maxRepeatedActions: 1 });
    const args = { path: "a.txt" };
    sre.observe("filesystem.write", args, { succeeded: true, verified: true });
    sre.evaluateAction("filesystem.write", args);
    const interventions = sre.takeInterventions();
    expect(interventions.length).toBeGreaterThan(0);
    // The watchdog exposes no policy, no registry and no executor.
    expect(Object.keys(sre).filter((k) => /policy|registry|executor|gate/i.test(k))).toEqual([]);
    expect(sre.takeInterventions()).toEqual([]);
  });
});

describe("budgets", () => {
  it("reports the first exhausted limit", () => {
    const budgets = new BudgetTracker({ maxSteps: 2, maxToolCalls: 10, maxTokens: 1000, maxWallClockMs: 60000 });
    budgets.addStep();
    expect(budgets.violation()).toBeUndefined();
    budgets.addStep();
    expect(budgets.violation()?.limit).toBe("maxSteps");
  });

  it("counts tokens across calls", () => {
    const budgets = new BudgetTracker({ maxSteps: 10, maxToolCalls: 10, maxTokens: 100, maxWallClockMs: 60000 });
    budgets.addTokens(40, 20);
    expect(budgets.usage.tokens).toBe(60);
    budgets.addTokens(40, 20);
    expect(budgets.violation()?.limit).toBe("maxTokens");
  });

  it("surfaces advisory pressure before the hard limit", () => {
    const budgets = new BudgetTracker({ maxSteps: 100, maxToolCalls: 100, maxTokens: 100000, maxWallClockMs: 600000 });
    budgets.noteRepeatedAction(DEFAULT_SRE_LIMITS.maxRepeatedActions);
    budgets.noteVerification(false);
    budgets.noteVerification(false);
    const advisories = budgets.advisories(DEFAULT_SRE_LIMITS.maxRepeatedActions, 2);
    expect(advisories.map((a) => a.limit)).toContain("repeated");
    expect(advisories.map((a) => a.limit)).toContain("unverified");
  });
});
