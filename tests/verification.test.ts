import { describe, expect, it, beforeEach, afterEach } from "vitest";
import { VerificationEngine, defaultPolicy } from "@sudarshan/core";
import { createWorkspace, type TestWorkspace } from "./helpers.js";

describe("deterministic verification against real state", () => {
  let ws: TestWorkspace;
  let engine: VerificationEngine;

  beforeEach(async () => {
    ws = await createWorkspace("verify");
    const policy = defaultPolicy(ws.root);
    engine = new VerificationEngine({ workspaceRoot: ws.root, policy, probeTimeoutMs: 15000 });
  });

  afterEach(async () => {
    await ws.cleanup();
  });

  it("passes when the file really exists", async () => {
    await ws.write("a.txt", "hello");
    const report = await engine.verify([{ kind: "file_exists", path: "a.txt" }]);
    expect(report.status).toBe("passed");
    expect(report.source).toBe("deterministic_check");
  });

  it("fails when the file does not exist", async () => {
    const report = await engine.verify([{ kind: "file_exists", path: "nope.txt" }]);
    expect(report.status).toBe("failed");
    expect(report.checks[0]!.expected).toBe("file present");
  });

  it("checks content literally and by regex", async () => {
    await ws.write("report.md", "# Title\nstatus: OK\n");
    const literal = await engine.verify([{ kind: "file_contains", path: "report.md", text: "status: OK" }]);
    expect(literal.status).toBe("passed");
    const regex = await engine.verify([{ kind: "file_contains", path: "report.md", regex: "^status:\\s+OK$" }]);
    expect(regex.status).toBe("passed");
    const missing = await engine.verify([{ kind: "file_contains", path: "report.md", text: "status: FAILED" }]);
    expect(missing.status).toBe("failed");
  });

  it("verifies a sha256 the caller fixed in advance", async () => {
    const { createHash } = await import("node:crypto");
    const content = "exact bytes";
    await ws.write("hash.txt", content);
    const digest = createHash("sha256").update(content, "utf8").digest("hex");
    const good = await engine.verify([{ kind: "file_hash", path: "hash.txt", sha256: digest }]);
    expect(good.status).toBe("passed");
    const bad = await engine.verify([{ kind: "file_hash", path: "hash.txt", sha256: "0".repeat(64) }]);
    expect(bad.status).toBe("failed");
  });

  it("counts glob matches", async () => {
    await ws.write("src/a.ts", "export const a = 1;");
    await ws.write("src/b.ts", "export const b = 2;");
    const ok = await engine.verify([{ kind: "glob_count", pattern: "src/**/*.ts", min: 2 }]);
    expect(ok.status).toBe("passed");
    const tooMany = await engine.verify([{ kind: "glob_count", pattern: "src/**/*.ts", min: 5 }]);
    expect(tooMany.status).toBe("failed");
  });

  it("runs a real command and checks its exit code and output", async () => {
    const ok = await engine.verify([{ kind: "command", command: "echo", args: ["verified"], expectExit: 0, expectStdout: "verified" }]);
    expect(ok.status).toBe("passed");
    const badExit = await engine.verify([{ kind: "command", command: "sh", args: ["-c", "exit 3"], expectExit: 0 }]);
    expect(badExit.status).toBe("failed");
    const badOutput = await engine.verify([{ kind: "command", command: "echo", args: ["actual"], expectStdout: "expected" }]);
    expect(badOutput.status).toBe("failed");
  });

  it("refuses to probe outside the verification scope", async () => {
    const report = await engine.verify([{ kind: "file_exists", path: "/etc/passwd" }]);
    expect(report.status).toBe("indeterminate");
    expect(report.checks[0]!.evidence).toMatch(/outside verification scope/);
  });

  it("checks facts observed during execution via `result`", async () => {
    const report = await engine.verify(
      [{ kind: "result", path: "metrics.exitCode", equals: 0 }],
      { result: { outcome: "success", metrics: { exitCode: 0 } } },
    );
    expect(report.status).toBe("passed");
    const failed = await engine.verify(
      [{ kind: "result", path: "metrics.exitCode", equals: 0 }],
      { result: { outcome: "error", metrics: { exitCode: 1 } } },
    );
    expect(failed.status).toBe("failed");
  });

  it("is indeterminate, never silently passing, when no result is available", async () => {
    const report = await engine.verify([{ kind: "result", path: "metrics.exitCode", equals: 0 }]);
    expect(report.status).toBe("indeterminate");
  });

  it("reports skipped when no checks were declared", async () => {
    const report = await engine.verify([]);
    expect(report.status).toBe("skipped");
  });

  it("mixes passed and failed checks into an overall FAILED verdict", async () => {
    await ws.write("ok.txt", "yes");
    const report = await engine.verify([
      { kind: "file_exists", path: "ok.txt" },
      { kind: "file_exists", path: "missing.txt" },
    ]);
    expect(report.status).toBe("failed");
    expect(report.checks.filter((c) => c.status === "passed").length).toBe(1);
    expect(report.summary).toMatch(/1 failed/);
  });

  it("supports a custom check supplied by the operator", async () => {
    const report = await engine.verify([
      {
        kind: "custom",
        id: "always-fails",
        run: async () => ({ status: "failed", evidence: "operator-defined check failed" }),
      },
    ]);
    expect(report.status).toBe("failed");
  });
});
