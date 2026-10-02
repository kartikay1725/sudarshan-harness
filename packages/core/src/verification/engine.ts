import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { readFile, readdir, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import type { CheckOutcome, CheckResult, CheckSpec, Policy, ToolResult, VerificationContext, VerificationReport } from "../types.js";
import type { EventBus } from "../events/bus.js";
import type { AuditTrail } from "../audit/trail.js";
import { validateArgs } from "../util/schema.js";
import { canonicalJson, globMatch, nowIso, truncate } from "../util/index.js";

export interface VerificationEngineOptions {
  workspaceRoot: string;
  policy: Policy;
  bus?: EventBus;
  audit?: AuditTrail;
  env?: Record<string, string | undefined>;
  /** Hard cap for a single deterministic probe. */
  probeTimeoutMs?: number;
}

/**
 * The verification engine answers one question with facts:
 *
 *      did the real system actually change the way the action claimed?
 *
 * Hierarchy of trust, highest first:
 *
 *      REAL STATE  ->  DETERMINISTIC CHECK  ->  (blind verifier)  ->  MODEL CLAIM
 *
 * Nothing in here consults a model. If a check cannot be decided from the real
 * system it returns `indeterminate` — never a silent pass.
 */
export class VerificationEngine {
  private workspaceRoot: string;
  private policy: Policy;
  private probeTimeoutMs: number;

  constructor(private opts: VerificationEngineOptions) {
    this.workspaceRoot = resolve(opts.workspaceRoot);
    this.policy = opts.policy;
    this.probeTimeoutMs = opts.probeTimeoutMs ?? 30_000;
  }

  async verify(
    checks: CheckSpec[],
    ctx: { runId?: string; stepId?: string; actionId?: string; source?: VerificationReport["source"]; label?: string; result?: ToolResult } = {},
  ): Promise<VerificationReport> {
    const source = ctx.source ?? "deterministic_check";
    if (!checks || checks.length === 0) {
      return {
        status: "skipped",
        checks: [],
        summary: "No deterministic checks were declared for this action.",
        createdAt: nowIso(),
        source,
      };
    }

    const vctx: VerificationContext = {
      workspaceRoot: this.workspaceRoot,
      runId: ctx.runId ?? "n/a",
      result: ctx.result,
      env: this.opts.env ?? (process.env as Record<string, string | undefined>),
      log: (message, level = "debug") => this.opts.bus?.emit("log", { level, message, where: "verification" }, { runId: ctx.runId }),
    };

    const results: CheckResult[] = [];
    for (const spec of checks) {
      const started = Date.now();
      let outcome: CheckOutcome;
      try {
        outcome = await this.runCheck(spec, vctx);
      } catch (err) {
        outcome = {
          status: "indeterminate",
          evidence: `check threw: ${err instanceof Error ? err.message : String(err)}`,
        };
      }
      results.push({
        spec,
        label: labelFor(spec),
        durationMs: Date.now() - started,
        ...outcome,
      });
    }

    const failed = results.filter((r) => r.status === "failed");
    const indeterminate = results.filter((r) => r.status === "indeterminate");
    const status: VerificationReport["status"] =
      failed.length > 0 ? "failed" : indeterminate.length > 0 ? "indeterminate" : "passed";

    const report: VerificationReport = {
      status,
      checks: results,
      summary: summarise(results),
      createdAt: nowIso(),
      source,
    };

    this.opts.bus?.emit(
      "verification.completed",
      { status: report.status, summary: report.summary, checks: results.map((r) => ({ label: r.label, status: r.status, evidence: r.evidence })) },
      { runId: ctx.runId, stepId: ctx.stepId, actionId: ctx.actionId },
    );
    this.opts.audit?.append(
      "verification.report",
      { label: ctx.label, status, summary: report.summary, checks: results.map((r) => ({ label: r.label, status: r.status, evidence: truncate(r.evidence, 2000) })) },
      ctx.runId,
    );
    return report;
  }

  private async runCheck(spec: CheckSpec, ctx: VerificationContext): Promise<CheckOutcome> {
    switch (spec.kind) {
      case "file_exists":
        return this.fileCheck(spec.path, true);
      case "file_absent":
        return this.fileCheck(spec.path, false);
      case "dir_exists":
        return this.dirCheck(spec.path);
      case "file_contains":
        return this.fileContains(spec.path, spec.text, spec.regex, true);
      case "file_not_contains":
        return this.fileContains(spec.path, spec.text, spec.regex, false);
      case "file_hash":
        return this.fileHash(spec.path, spec.sha256);
      case "file_size":
        return this.fileSize(spec.path, spec.min, spec.max);
      case "glob_count":
        return this.globCount(spec.pattern, spec.min, spec.max);
      case "command":
        return this.commandCheck(spec, ctx);
      case "http":
        return this.httpCheck(spec);
      case "json_schema": {
        const issues = validateArgs(spec.schema as Record<string, unknown>, (spec.value ?? {}) as Record<string, unknown>);
        return issues.length === 0
          ? { status: "passed", evidence: "value satisfies schema" }
          : { status: "failed", evidence: issues.map((i) => `${i.path}: ${i.message}`).join("; "), expected: "schema-valid", actual: `${issues.length} issue(s)` };
      }
      case "value_equals": {
        const equal = canonicalJson(spec.actual) === canonicalJson(spec.expected);
        return equal
          ? { status: "passed", evidence: "values are equal" }
          : { status: "failed", evidence: "values differ", expected: truncate(canonicalJson(spec.expected), 400), actual: truncate(canonicalJson(spec.actual), 400) };
      }
      case "result":
        return this.resultCheck(spec, ctx);
      case "custom":
        return spec.run(ctx);
      default:
        return { status: "indeterminate", evidence: `unknown check kind: ${JSON.stringify(spec)}` };
    }
  }

  /**
   * Assert against a fact observed during execution (e.g. a child process exit
   * code). The value comes from the Harness's own instrumentation, so it is
   * real state — but it is a fact about the action, not about the wider system.
   */
  private resultCheck(spec: Extract<CheckSpec, { kind: "result" }>, ctx: VerificationContext): CheckOutcome {
    if (!ctx.result) return { status: "indeterminate", evidence: `no action result available to check ${spec.path}` };
    const value = readPath(ctx.result as unknown as Record<string, unknown>, spec.path);
    if (spec.exists !== undefined) {
      const exists = value !== undefined && value !== null;
      return exists === spec.exists
        ? { status: "passed", evidence: `${spec.path} ${exists ? "is present" : "is absent"}` }
        : { status: "failed", evidence: `${spec.path} presence mismatch`, expected: String(spec.exists), actual: String(exists) };
    }
    if (spec.equals !== undefined) {
      const equal = canonicalJson(value) === canonicalJson(spec.equals);
      return equal
        ? { status: "passed", evidence: `${spec.path} === ${canonicalJson(spec.equals)}` }
        : { status: "failed", evidence: `${spec.path} is ${canonicalJson(value)}`, expected: canonicalJson(spec.equals), actual: canonicalJson(value) };
    }
    if (spec.regex !== undefined) {
      const text = typeof value === "string" ? value : canonicalJson(value ?? "");
      const pattern = spec.regex.startsWith("/") && spec.regex.endsWith("/") ? spec.regex.slice(1, -1) : escapeRegExp(spec.regex);
      const matched = new RegExp(pattern, "m").test(text);
      return matched
        ? { status: "passed", evidence: `${spec.path} matches /${pattern}/` }
        : { status: "failed", evidence: `${spec.path} does not match /${pattern}/: ${truncate(text, 200)}`, expected: `/${pattern}/`, actual: truncate(text, 200) };
    }
    return { status: "indeterminate", evidence: `result check ${spec.path} has no assertion` };
  }

  /* ---------------- individual probes ---------------- */

  private scopePath(path: string): { ok: boolean; resolved: string; reason?: string } {
    const resolved = isAbsolute(path) ? resolve(path) : resolve(this.workspaceRoot, path);
    const roots = this.policy.scopes.fsRoots.length ? this.policy.scopes.fsRoots : [this.workspaceRoot];
    const inside = roots.some((r) => {
      const abs = isAbsolute(r) ? resolve(r) : resolve(this.workspaceRoot, r);
      return resolved === abs || resolved.startsWith(abs + sep);
    });
    if (!inside) return { ok: false, resolved, reason: `probe target outside verification scope: ${resolved}` };
    return { ok: true, resolved };
  }

  private fileCheck(path: string, shouldExist: boolean): CheckOutcome {
    const scoped = this.scopePath(path);
    if (!scoped.ok) return { status: "indeterminate", evidence: scoped.reason! };
    const exists = existsSync(scoped.resolved);
    const rel = relative(this.workspaceRoot, scoped.resolved) || scoped.resolved;
    if (exists === shouldExist) {
      return { status: "passed", evidence: `${rel} ${shouldExist ? "exists" : "does not exist"} (verified by fs.stat)` };
    }
    return {
      status: "failed",
      evidence: `${rel} ${exists ? "exists" : "does not exist"}`,
      expected: shouldExist ? "file present" : "file absent",
      actual: exists ? "file present" : "file absent",
    };
  }

  private async dirCheck(path: string): Promise<CheckOutcome> {
    const scoped = this.scopePath(path);
    if (!scoped.ok) return { status: "indeterminate", evidence: scoped.reason! };
    try {
      const s = await stat(scoped.resolved);
      return s.isDirectory()
        ? { status: "passed", evidence: `${relative(this.workspaceRoot, scoped.resolved)} is a directory` }
        : { status: "failed", evidence: "path exists but is not a directory", expected: "directory", actual: "file" };
    } catch {
      return { status: "failed", evidence: "directory does not exist", expected: "directory present", actual: "missing" };
    }
  }

  private async fileContains(path: string, text: string | undefined, regex: string | undefined, want: boolean): Promise<CheckOutcome> {
    const scoped = this.scopePath(path);
    if (!scoped.ok) return { status: "indeterminate", evidence: scoped.reason! };
    let content: string;
    try {
      content = await readFile(scoped.resolved, "utf8");
    } catch (err) {
      return { status: "failed", evidence: `cannot read file: ${(err as Error).message}` };
    }
    if (text === undefined && regex === undefined) {
      return { status: "indeterminate", evidence: "file_contains needs either text or regex" };
    }
    const matched = regex ? new RegExp(regex, "m").test(content) : content.includes(text!);
    const rel = relative(this.workspaceRoot, scoped.resolved);
    if (matched === want) {
      return { status: "passed", evidence: `${rel} ${want ? "contains" : "does not contain"} ${regex ? `/${regex}/` : JSON.stringify(truncate(text!, 80))}` };
    }
    return {
      status: "failed",
      evidence: `${rel} ${matched ? "contains" : "does not contain"} the expected ${regex ? "pattern" : "text"}`,
      expected: want ? "present" : "absent",
      actual: matched ? "present" : "absent",
    };
  }

  private async fileHash(path: string, expected: string): Promise<CheckOutcome> {
    const scoped = this.scopePath(path);
    if (!scoped.ok) return { status: "indeterminate", evidence: scoped.reason! };
    try {
      const buf = await readFile(scoped.resolved);
      const actual = createHash("sha256").update(buf).digest("hex");
      return actual === expected.toLowerCase()
        ? { status: "passed", evidence: `sha256 matches (${actual.slice(0, 12)}…)` }
        : { status: "failed", evidence: "sha256 mismatch", expected: expected.slice(0, 16), actual: actual.slice(0, 16) };
    } catch (err) {
      return { status: "failed", evidence: `cannot hash file: ${(err as Error).message}` };
    }
  }

  private async fileSize(path: string, min?: number, max?: number): Promise<CheckOutcome> {
    const scoped = this.scopePath(path);
    if (!scoped.ok) return { status: "indeterminate", evidence: scoped.reason! };
    try {
      const s = await stat(scoped.resolved);
      const okMin = min === undefined || s.size >= min;
      const okMax = max === undefined || s.size <= max;
      return okMin && okMax
        ? { status: "passed", evidence: `size ${s.size} bytes within bounds` }
        : { status: "failed", evidence: `size ${s.size} bytes`, expected: `min=${min ?? 0} max=${max ?? "∞"}`, actual: String(s.size) };
    } catch (err) {
      return { status: "failed", evidence: `cannot stat file: ${(err as Error).message}` };
    }
  }

  private async globCount(pattern: string, min: number, max?: number): Promise<CheckOutcome> {
    const matches = await this.walkAndMatch(pattern);
    const ok = matches.length >= min && (max === undefined || matches.length <= max);
    return {
      status: ok ? "passed" : "failed",
      evidence: `${matches.length} match(es) for "${pattern}"${matches.length ? `: ${matches.slice(0, 5).join(", ")}${matches.length > 5 ? ", …" : ""}` : ""}`,
      expected: `count >= ${min}${max !== undefined ? ` and <= ${max}` : ""}`,
      actual: String(matches.length),
    };
  }

  private async walkAndMatch(pattern: string, limit = 5000): Promise<string[]> {
    const out: string[] = [];
    const roots = this.policy.scopes.fsRoots.length ? this.policy.scopes.fsRoots : [this.workspaceRoot];
    const skipDirs = new Set(["node_modules", ".git", "dist", ".next", "build", "coverage", ".venv", "__pycache__"]);
    async function* walk(dir: string): AsyncGenerator<string> {
      let entries;
      try {
        entries = await readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = join(dir, entry.name);
        if (entry.isDirectory()) {
          if (skipDirs.has(entry.name)) continue;
          yield* walk(full);
        } else {
          yield full;
        }
      }
    }
    for (const root of roots) {
      const abs = isAbsolute(root) ? resolve(root) : resolve(this.workspaceRoot, root);
      for await (const file of walk(abs)) {
        const rel = relative(this.workspaceRoot, file);
        if (globMatch(pattern, rel) || globMatch(pattern, file)) out.push(rel);
        if (out.length >= limit) return out;
      }
    }
    return out;
  }

  private async commandCheck(spec: Extract<CheckSpec, { kind: "command" }>, ctx: VerificationContext): Promise<CheckOutcome> {
    const cwd = spec.cwd ? this.scopePath(spec.cwd) : { ok: true, resolved: this.workspaceRoot };
    if (!cwd.ok) return { status: "indeterminate", evidence: cwd.reason! };
    const maxBytes = this.policy.scopes.shell.maxOutputBytes;
    const timeout = Math.min(this.probeTimeoutMs, this.policy.scopes.shell.timeoutMs);

    return new Promise<CheckOutcome>((resolvePromise) => {
      const child = spawn(spec.command, spec.args ?? [], {
        cwd: cwd.resolved,
        env: { ...ctx.env },
        shell: false,
        timeout,
      });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const finish = (outcome: CheckOutcome) => {
        if (settled) return;
        settled = true;
        resolvePromise(outcome);
      };
      child.stdout?.on("data", (d) => {
        if (stdout.length < maxBytes) stdout += d.toString();
      });
      child.stderr?.on("data", (d) => {
        if (stderr.length < maxBytes) stderr += d.toString();
      });
      child.on("error", (err) => finish({ status: "indeterminate", evidence: `could not spawn "${spec.command}": ${err.message}` }));
      child.on("close", (code) => {
        const expectExit = spec.expectExit ?? 0;
        const exitOk = code === expectExit;
        const stdoutOk = !spec.expectStdout || matches(spec.expectStdout, stdout);
        const stderrOk = !spec.expectStderr || matches(spec.expectStderr, stderr);
        if (exitOk && stdoutOk && stderrOk) {
          finish({
            status: "passed",
            evidence: `exit=${code}; stdout: ${truncate(stdout.trim() || "(empty)", 300)}`,
          });
        } else {
          finish({
            status: "failed",
            evidence: `exit=${code} (expected ${expectExit}); stdout: ${truncate(stdout.trim() || "(empty)", 200)}; stderr: ${truncate(stderr.trim() || "(empty)", 200)}`,
            expected: `exit=${expectExit}${spec.expectStdout ? ` stdout~${spec.expectStdout}` : ""}`,
            actual: `exit=${code}`,
          });
        }
      });
    });
  }

  private async httpCheck(spec: Extract<CheckSpec, { kind: "http" }>): Promise<CheckOutcome> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.min(this.probeTimeoutMs, this.policy.scopes.net.timeoutMs));
    try {
      const res = await fetch(spec.url, { signal: controller.signal });
      const body = await res.text();
      const statusOk = spec.expectStatus === undefined || res.status === spec.expectStatus;
      const bodyOk = !spec.expectBodyContains || body.includes(spec.expectBodyContains);
      if (statusOk && bodyOk) {
        return { status: "passed", evidence: `${spec.url} -> ${res.status}; body ${body.length} bytes` };
      }
      return {
        status: "failed",
        evidence: `${spec.url} -> ${res.status}${spec.expectBodyContains && !bodyOk ? "; expected body text missing" : ""}`,
        expected: `${spec.expectStatus ?? "any"}${spec.expectBodyContains ? ` + body contains ${JSON.stringify(spec.expectBodyContains)}` : ""}`,
        actual: String(res.status),
      };
    } catch (err) {
      return { status: "indeterminate", evidence: `request failed: ${(err as Error).message}` };
    } finally {
      clearTimeout(timer);
    }
  }
}

function readPath(obj: Record<string, unknown>, path: string): unknown {
  let current: unknown = obj;
  for (const part of path.split(".")) {
    if (current === null || current === undefined) return undefined;
    current = (current as Record<string, unknown>)[part];
  }
  return current;
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function matches(expected: string, actual: string): boolean {
  if (expected.startsWith("/") && expected.endsWith("/") && expected.length > 2) {
    return new RegExp(expected.slice(1, -1), "m").test(actual);
  }
  return actual.includes(expected);
}

export function labelFor(spec: CheckSpec): string {
  switch (spec.kind) {
    case "file_exists":
      return `file exists: ${spec.path}`;
    case "file_absent":
      return `file absent: ${spec.path}`;
    case "dir_exists":
      return `dir exists: ${spec.path}`;
    case "file_contains":
      return `file contains: ${spec.path} ${spec.regex ? `/${spec.regex}/` : JSON.stringify(spec.text ?? "")}`;
    case "file_not_contains":
      return `file excludes: ${spec.path}`;
    case "file_hash":
      return `sha256: ${spec.path}`;
    case "file_size":
      return `size: ${spec.path}`;
    case "glob_count":
      return `glob count: ${spec.pattern}`;
    case "command":
      return `command: ${spec.command} ${(spec.args ?? []).join(" ")}`.trim();
    case "http":
      return `http: ${spec.url}`;
    case "json_schema":
      return "json schema";
    case "value_equals":
      return "value equals";
    case "result":
      return `observed ${spec.path}${spec.equals !== undefined ? ` == ${JSON.stringify(spec.equals)}` : ""}${spec.regex ? ` ~ ${spec.regex}` : ""}`;
    case "custom":
      return `custom: ${spec.id}`;
    default:
      return "unknown check";
  }
}

function summarise(results: CheckResult[]): string {
  const passed = results.filter((r) => r.status === "passed").length;
  const failed = results.filter((r) => r.status === "failed");
  const indeterminate = results.filter((r) => r.status === "indeterminate");
  const parts = [`${passed}/${results.length} check(s) passed`];
  if (failed.length) parts.push(`${failed.length} failed: ${failed.map((f) => f.label).join("; ")}`);
  if (indeterminate.length) parts.push(`${indeterminate.length} indeterminate: ${indeterminate.map((f) => f.label).join("; ")}`);
  return parts.join(" — ");
}
