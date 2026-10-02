import { defineCapability, truncate, type Capability, type CheckSpec, type Policy, type RiskLevel, type ToolDefinition } from "@sudarshan/core";

const IDEMPOTENT = new Set(["GET", "HEAD", "OPTIONS"]);

function classifyRisk(method: string): RiskLevel {
  if (IDEMPOTENT.has(method)) return "medium";
  return "high";
}

function getTool(policy: Policy): ToolDefinition {
  return {
    name: "http.get",
    description: "Fetch a URL with GET and return status, headers and body (truncated).",
    permission: "net.request",
    defaultRisk: "medium",
    defaultReversibility: "reversible",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "Absolute URL." },
        headers: { type: "object", description: "Optional request headers.", additionalProperties: { type: "string" } },
        expectStatus: { type: "number", description: "Status you expect (default 200). The Harness re-probes the URL to confirm." },
      },
      required: ["url"],
      additionalProperties: false,
    },
    classify: (args) => {
      const url = String(args.url ?? "");
      const expectStatus = typeof args.expectStatus === "number" ? args.expectStatus : 200;
      const checks: CheckSpec[] = [{ kind: "http", url, expectStatus }];
      return {
        risk: "medium",
        reversibility: "reversible",
        targets: [{ kind: "url", value: url }],
        checks,
        signature: `get|${url}`,
      };
    },
    async execute(args, ctx) {
      const url = String(args.url ?? "");
      const headers = (args.headers ?? {}) as Record<string, string>;
      const timeout = Math.min(policy.scopes.net.timeoutMs, 60_000);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(url, { method: "GET", headers, signal: ctx.signal ?? controller.signal, redirect: "follow" });
        const body = await res.text();
        ctx.recordEvidence({ source: "http.status", fact: `${url} -> ${res.status}`, value: res.status, observedAt: new Date().toISOString() });
        return {
          outcome: res.ok ? "success" : "error",
          output: { url, status: res.status, headers: Object.fromEntries(res.headers.entries()), body: truncate(body, 32_000), bytes: body.length },
          text: `GET ${url} -> ${res.status} ${res.statusText}\n${truncate(body, 16_000)}`,
          error: res.ok ? undefined : { code: `HTTP_${res.status}`, message: `request failed with status ${res.status}` },
          evidence: [{ source: "http.status", fact: `status ${res.status}, ${body.length} bytes`, value: res.status, observedAt: new Date().toISOString() }],
          metrics: { status: res.status, bytes: body.length },
        };
      } catch (err) {
        return { outcome: "error", error: { code: "EHTTP", message: (err as Error).message } };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

function requestTool(policy: Policy): ToolDefinition {
  return {
    name: "http.request",
    description:
      "Send an HTTP request with any method and body. Non-idempotent methods (POST/PUT/PATCH/DELETE) affect external systems and are treated as irreversible.",
    permission: "net.request",
    defaultRisk: "high",
    defaultReversibility: "irreversible",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD", "OPTIONS"] },
        headers: { type: "object", additionalProperties: { type: "string" } },
        body: { type: "string", description: "Request body (JSON string or text)." },
        expectStatus: { type: "number" },
      },
      required: ["url", "method"],
      additionalProperties: false,
    },
    classify: (args) => {
      const url = String(args.url ?? "");
      const method = String(args.method ?? "GET").toUpperCase();
      const idempotent = IDEMPOTENT.has(method);
      // A non-idempotent request must never be re-sent as a "verification
      // probe" — that would execute the side effect twice. Verify against the
      // status the Harness observed on the single real request instead.
      const checks: CheckSpec[] = idempotent
        ? [{ kind: "http", url, expectStatus: typeof args.expectStatus === "number" ? args.expectStatus : 200 }]
        : [{ kind: "result", path: "metrics.status", equals: typeof args.expectStatus === "number" ? args.expectStatus : undefined, exists: typeof args.expectStatus === "number" ? undefined : true }];
      return {
        risk: classifyRisk(method),
        reversibility: idempotent ? "reversible" : "irreversible",
        targets: [{ kind: "url", value: url }],
        checks,
        requiresApproval: !idempotent,
        signature: `${method}|${url}|${String(args.body ?? "").length}`,
      };
    },
    async execute(args, ctx) {
      const url = String(args.url ?? "");
      const method = String(args.method ?? "GET").toUpperCase();
      const headers = (args.headers ?? {}) as Record<string, string>;
      const body = typeof args.body === "string" ? args.body : undefined;
      const timeout = Math.min(policy.scopes.net.timeoutMs, 60_000);
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeout);
      try {
        const res = await fetch(url, { method, headers, body, signal: ctx.signal ?? controller.signal });
        const text = await res.text();
        ctx.recordEvidence({ source: "http.status", fact: `${method} ${url} -> ${res.status}`, value: res.status, observedAt: new Date().toISOString() });
        const expectStatus = typeof args.expectStatus === "number" ? args.expectStatus : undefined;
        const ok = expectStatus !== undefined ? res.status === expectStatus : res.ok;
        return {
          outcome: ok ? "success" : "error",
          output: { url, method, status: res.status, body: truncate(text, 32_000) },
          text: `${method} ${url} -> ${res.status} ${res.statusText}\n${truncate(text, 8000)}`,
          error: ok ? undefined : { code: `HTTP_${res.status}`, message: `unexpected status ${res.status}` },
          metrics: { status: res.status, bytes: text.length },
        };
      } catch (err) {
        return { outcome: "error", error: { code: "EHTTP", message: (err as Error).message } };
      } finally {
        clearTimeout(timer);
      }
    },
  };
}

/**
 * HTTP — a LEGO block for research/automation agents.
 *
 * Network calls leave the machine, so by default policy every `net.request`
 * needs human approval and cloud-metadata endpoints are denied by host policy.
 * Non-idempotent requests are never re-sent as a verification probe: executing
 * a side effect twice to "check" it would be worse than not checking.
 */
export function httpCapability(policy: Policy): Capability {
  return defineCapability({
    id: "http",
    name: "HTTP",
    version: "0.1.0",
    description: "Make outbound HTTP requests, subject to host allow/deny policy and human approval.",
    permissions: ["net.request"],
    tools: [getTool(policy), requestTool(policy)],
    async healthCheck() {
      return { ok: typeof fetch === "function", detail: typeof fetch === "function" ? "fetch available" : "no fetch implementation" };
    },
  });
}
