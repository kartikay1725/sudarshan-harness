import { describe, expect, it } from "vitest";
import { AuditTrail, canonicalJson, redact, redactDeep, sha256 } from "@sudarshan/core";

describe("the hash-chained audit trail", () => {
  it("chains every entry to the previous hash", () => {
    const audit = new AuditTrail();
    const first = audit.append("run.started", { task: "do the thing" }, "run1");
    const second = audit.append("authorization.allow", { tool: "filesystem.write" }, "run1");
    expect(first.prevHash).toBe("0".repeat(64));
    expect(second.prevHash).toBe(first.hash);
    expect(audit.verifyChain().ok).toBe(true);
    expect(audit.head()).toBe(second.hash);
  });

  it("detects a tampered payload", () => {
    const audit = new AuditTrail();
    audit.append("run.started", { task: "honest task" }, "run1");
    audit.append("authorization.allow", { tool: "filesystem.write" }, "run1");
    audit.append("run.completed", { status: "verified" }, "run1");
    expect(audit.verifyChain().ok).toBe(true);

    // Someone rewrites history: the payload no longer matches its own hash.
    const entries = audit.all();
    (entries[1] as unknown as { payload: unknown }).payload = { tool: "filesystem.delete" };

    const result = audit.verifyChain();
    expect(result.ok).toBe(false);
    expect(result.brokenAtSeq).toBe(2);
  });

  it("detects a truncated chain", () => {
    const audit = new AuditTrail();
    audit.append("a", {}, "run1");
    audit.append("b", {}, "run1");
    audit.append("c", {}, "run1");
    const entries = audit.all();
    entries.splice(1, 1);
    // The remaining entries still carry the original prev-hash links, so the
    // gap shows up as a broken link when the chain is re-verified.
    const status = AuditTrail.verifyEntries(entries);
    expect(status.ok).toBe(false);
    expect(status.brokenAtSeq).toBe(3);
  });

  it("filters by run", () => {
    const audit = new AuditTrail();
    audit.append("a", {}, "run1");
    audit.append("b", {}, "run2");
    audit.append("c", {}, "run1");
    expect(audit.forRun("run1").length).toBe(2);
    expect(audit.forRun("run2").length).toBe(1);
  });

  it("persists to JSONL when asked", async () => {
    const { mkdtemp, readFile, rm } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    const dir = await mkdtemp(join(tmpdir(), "audit-"));
    const path = join(dir, "audit.jsonl");
    const audit = new AuditTrail({ persistPath: path });
    audit.append("run.started", { task: "persist me" }, "run1");
    audit.append("run.completed", { status: "verified" }, "run1");
    await audit.flush();
    const lines = (await readFile(path, "utf8")).trim().split("\n");
    expect(lines.length).toBe(2);
    expect(JSON.parse(lines[0]!).type).toBe("run.started");
    await rm(dir, { recursive: true, force: true });
  });
});

describe("redaction — provenance must not leak secrets", () => {
  it("redacts API keys and private keys", () => {
    expect(redact("token is sk-abcdefghij1234567890 here")).toContain("[REDACTED_API_KEY]");
    expect(redact("-----BEGIN RSA PRIVATE KEY-----\nabc\n-----END RSA PRIVATE KEY-----")).toContain("[REDACTED_PRIVATE_KEY]");
  });

  it("redacts key=value style secrets but keeps the key name", () => {
    const out = redact('config: api_key="supersecretvalue"');
    expect(out).toContain("api_key=");
    expect(out).not.toContain("supersecretvalue");
  });

  it("redacts deeply by field name", () => {
    const out = redactDeep({ user: "me", password: "hunter2", nested: { apiKey: "abc123" } }) as Record<string, unknown>;
    expect(out.password).toBe("[REDACTED]");
    expect((out.nested as Record<string, unknown>).apiKey).toBe("[REDACTED]");
    expect(out.user).toBe("me");
  });
});
