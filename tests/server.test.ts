import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, type RunningServer } from "@sudarshan/server";
import type { ReplayFile } from "@sudarshan/runtime";

/**
 * Integration tests for the daemon: the exact HTTP surface the IDE, the CLI's
 * `ide` command and the desktop shell all share.
 */

const REPLAY: ReplayFile = {
  version: 1,
  task: "Write a greeting file and prove it exists.",
  capabilities: ["filesystem"],
  adapter: { kind: "scripted" },
  model: "replay",
  expectations: [
    { kind: "file_exists", path: "hello.txt" },
    { kind: "file_contains", path: "hello.txt", text: "hello harness" },
  ],
  script: [
    {
      kind: "tool",
      name: "filesystem.write",
      arguments: { path: "hello.txt", content: "hello harness\n" },
      content: "Writing the file the task asked for.",
    },
    { kind: "text", content: "Done. hello.txt exists and contains the greeting." },
  ],
};

describe("daemon (apps/server)", () => {
  let server: RunningServer;
  let dir: string;

  beforeAll(async () => {
    dir = await mkdtemp(join(tmpdir(), "sudarshan-server-test-"));
    server = await startServer({ port: 0, host: "127.0.0.1", workspaceRoot: dir });
    // Start from an explicit, minimal LEGO set rather than whatever the
    // defaults happen to be.
    await fetch(`${server.url}/api/capabilities`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ enabled: ["filesystem"] }),
    });
  });

  afterAll(async () => {
    await server.close();
    await rm(dir, { recursive: true, force: true });
  });

  const get = async <T>(path: string): Promise<T> => {
    const res = await fetch(`${server.url}${path}`);
    expect(res.ok, `${path} -> ${res.status}`).toBe(true);
    return (await res.json()) as T;
  };

  const post = async <T>(path: string, body: unknown): Promise<{ status: number; body: T }> => {
    const res = await fetch(`${server.url}${path}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    return { status: res.status, body: (await res.json()) as T };
  };

  it("serves health and a configured session", async () => {
    const health = await get<{ ok: boolean; service: string }>("/api/health");
    expect(health.ok).toBe(true);

    const session = await get<{ configured: boolean; workspaceRoot: string; capabilities: Array<{ id: string; enabled: boolean }> }>("/api/session");
    expect(session.configured).toBe(true);
    expect(session.workspaceRoot).toBe(dir);
    expect(session.capabilities.map((c) => c.id)).toContain("filesystem");
    expect(session.capabilities.find((c) => c.id === "filesystem")?.enabled).toBe(true);
    // Everything not explicitly enabled is off: installing is not granting.
    for (const capability of session.capabilities) {
      if (capability.id !== "filesystem") expect(capability.enabled).toBe(false);
    }
  });

  it("installs and removes capabilities over HTTP", async () => {
    const before = await get<{ capabilities: Array<{ id: string; enabled: boolean }> }>("/api/session");
    expect(before.capabilities.find((c) => c.id === "git")?.enabled ?? false).toBe(false);

    const enabled = await post<{ capabilities: Array<{ id: string; enabled: boolean }> }>(`/api/capabilities/git`, { enabled: true });
    expect(enabled.status).toBe(200);
    expect(enabled.body.capabilities.find((c) => c.id === "git")?.enabled).toBe(true);

    const removed = await post<{ capabilities: Array<{ id: string; enabled: boolean }> }>(`/api/capabilities/git`, { enabled: false });
    expect(removed.body.capabilities.find((c) => c.id === "git")?.enabled).toBe(false);

    const unknown = await post<{ error?: string }>(`/api/capabilities/nonsense`, { enabled: true });
    expect(unknown.status).toBe(404);
  });

  it("rejects malformed bodies instead of guessing", async () => {
    const res = await fetch(`${server.url}/api/runs`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: '{"task":',
    });
    expect(res.status).toBe(400);
  });

  it("runs a recorded replay through the real gate and verifier", async () => {
    const started = await post<{ run: { id: string; status: string }; workspaceRoot: string }>("/api/replay", { replay: REPLAY });
    expect(started.status).toBe(200);
    expect(started.body.run.status).toBe("verified");
    // The replay must not have touched the session workspace.
    expect(started.body.workspaceRoot).not.toBe(dir);

    const runId = started.body.run.id;
    const detail = await get<{ run: { summary?: { harnessVerified: boolean; explanation: string } }; audit: Array<{ type: string }> }>(`/api/runs/${runId}`);
    expect(detail.run.summary?.harnessVerified).toBe(true);
    expect(detail.run.summary?.explanation).toContain("2/2");
    // The replay is mirrored into the session audit trail with its provenance.
    expect(detail.audit.map((e) => e.type)).toContain("run.replayed");

    const list = await get<{ runs: Array<{ id: string; status: string }> }>("/api/runs");
    expect(list.runs.map((r) => r.id)).toContain(runId);
    expect(list.runs.find((r) => r.id === runId)?.status).toBe("verified");
  });

  it("keeps the audit hash chain intact across the session", async () => {
    const audit = await get<{ chain: { ok: boolean; entries: number } }>("/api/audit?limit=100");
    expect(audit.chain.entries).toBeGreaterThan(0);
    expect(audit.chain.ok).toBe(true);
  });

  it("lists recorded examples shipped with the repository", async () => {
    const examples = await get<{ examples: Array<{ name: string; steps: number }> }>("/api/examples");
    expect(examples.examples.map((e) => e.name)).toContain("tidy-inbox");
  });
});
