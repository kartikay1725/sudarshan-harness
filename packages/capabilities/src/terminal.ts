import { spawn } from "node:child_process";
import { relative, resolve } from "node:path";
import { defineCapability, truncate, type Capability, type CheckSpec, type Policy, type RiskLevel, type ToolDefinition } from "@sudarshan/core";

/**
 * Command patterns that escalate risk. This is not a sandbox — the real
 * boundary is policy (allowlists, denylists, approval). These heuristics only
 * decide how loudly the Harness should object before running something.
 */
const DANGEROUS_PATTERNS: Array<{ rx: RegExp; risk: RiskLevel; why: string }> = [
  { rx: /\brm\s+(-[a-z]*\s+)*-[a-z]*[rf]/i, risk: "critical", why: "recursive/forced delete" },
  { rx: /\b(git\s+push\b.*(--force|-f)|git\s+reset\s+--hard|git\s+clean\s+-[a-z]*f)/i, risk: "critical", why: "rewrites or destroys git history/work" },
  { rx: /\b(curl|wget)\b[^|]*\|\s*(ba)?sh\b/i, risk: "critical", why: "piping a remote script into a shell" },
  { rx: /\b(sudo|su)\b/i, risk: "critical", why: "privilege escalation" },
  { rx: /\b(mkfs|dd\s+if=|fdisk|shutdown|reboot|halt)\b/i, risk: "critical", why: "destructive system command" },
  { rx: /\b(npm|pnpm|yarn)\s+(publish|unpublish|deprecate)\b/i, risk: "critical", why: "publishes to a public registry" },
  { rx: /\b(gh|git)\b.*\b(delete|remove)\b/i, risk: "high", why: "deletes a remote resource" },
  { rx: /\bchmod\b|\bchown\b/i, risk: "high", why: "changes permissions/ownership" },
  { rx: /\b(export\s+[A-Z_]*(KEY|TOKEN|SECRET|PASSWORD)|cat\s+[^|]*\.(env|pem|key)|\.ssh\/|\.aws\/)/i, risk: "high", why: "touches credentials" },
  { rx: /\b(npm|pnpm|yarn)\s+(install|i|add)\b/i, risk: "medium", why: "installs packages from the network" },
  { rx: /\b(git\s+(commit|merge|rebase|checkout|switch|stash))\b/i, risk: "medium", why: "mutates the working tree or history" },
  { rx: /\b(docker|kubectl|helm|terraform|aws|gcloud|az)\b/i, risk: "high", why: "controls infrastructure outside this machine" },
];

const READ_ONLY_PATTERNS: RegExp[] = [
  /^\s*(ls|ll|la|pwd|cat|head|tail|less|more|wc|file|stat|find|tree|du|df|which|whereis|echo|printf|date|env|printenv|uname|whoami|id|hostname)\b/i,
  /^\s*(grep|egrep|fgrep|rg|ag|ack|sed|awk|cut|sort|uniq|diff|jq|yq)\b/i,
  /^\s*git\s+(status|log|diff|show|branch|remote|tag|rev-parse|ls-files|blame|describe|shortlog|config\s+--get)\b/i,
  /^\s*(node|python3?|ruby|go|cargo|npm|pnpm|yarn|npx|make|tsc|vitest|jest|pytest)\s+.*\b(--version|-v|version)\b/i,
];

function classifyCommand(command: string): { risk: RiskLevel; why: string } {
  for (const { rx, risk, why } of DANGEROUS_PATTERNS) {
    if (rx.test(command)) return { risk, why };
  }
  for (const rx of READ_ONLY_PATTERNS) {
    if (rx.test(command)) return { risk: "low", why: "read-only command" };
  }
  return { risk: "medium", why: "command has side effects" };
}

export function terminalTool(policy: Policy): ToolDefinition {
  return {
    name: "terminal.exec",
    description:
      "Run a shell command in the workspace. Returns exit code, stdout and stderr. Use it for builds, tests, linters and inspections.",
    permission: "shell.exec",
    defaultRisk: "medium",
    defaultReversibility: "unknown",
    parameters: {
      type: "object",
      properties: {
        command: { type: "string", description: "The command line to run." },
        cwd: { type: "string", description: "Working directory relative to the workspace root." },
        timeoutMs: { type: "number", description: "Timeout in milliseconds (capped by policy)." },
        expectExit: { type: "number", description: "Exit code you expect (default 0). The Harness checks the real exit code." },
        expectStdout: { type: "string", description: "Substring or /regex/ that stdout must contain." },
      },
      required: ["command"],
      additionalProperties: false,
    },
    classify: (args, ctx) => {
      const command = String(args.command ?? "");
      const { risk, why } = classifyCommand(command);
      const cwd = String(args.cwd ?? ".");
      const expectExit = typeof args.expectExit === "number" ? args.expectExit : 0;
      const checks: CheckSpec[] = [
        { kind: "result", path: "metrics.exitCode", equals: expectExit },
      ];
      if (typeof args.expectStdout === "string" && args.expectStdout.length > 0) {
        checks.push({ kind: "result", path: "output.stdout", regex: args.expectStdout });
      }
      return {
        risk,
        // A command's real-world effect is not knowable in advance: UNKNOWN,
        // which the Harness treats as irreversible for approval purposes.
        reversibility: risk === "low" ? "reversible" : "unknown",
        targets: [
          { kind: "command", value: command },
          { kind: "path", value: cwd },
        ],
        checks,
        signature: `exec|${command.trim()}`,
      };
    },
    async execute(args, ctx) {
      const command = String(args.command ?? "");
      if (!command.trim()) return { outcome: "error", error: { code: "EEMPTY", message: "command is empty" } };

      const cwdRel = String(args.cwd ?? ".");
      const cwdAbs = resolve(ctx.workspaceRoot, cwdRel);
      if (!cwdAbs.startsWith(resolve(ctx.workspaceRoot))) {
        return { outcome: "error", error: { code: "ESCOPE", message: `cwd ${cwdRel} is outside the workspace` } };
      }

      const maxOutput = policy.scopes.shell.maxOutputBytes;
      const timeout = Math.min(Number(args.timeoutMs ?? policy.scopes.shell.timeoutMs) || policy.scopes.shell.timeoutMs, policy.scopes.shell.timeoutMs);
      const startedAt = Date.now();

      return new Promise((promiseResolve) => {
        const child = spawn(command, {
          cwd: cwdAbs,
          env: { ...ctx.env, FORCE_COLOR: "0", NO_COLOR: "1" },
          shell: true,
          timeout,
          windowsHide: true,
        });

        let stdout = "";
        let stderr = "";
        let settled = false;
        const finish = (value: Awaited<ReturnType<ToolDefinition["execute"]>>) => {
          if (settled) return;
          settled = true;
          promiseResolve(value);
        };

        child.stdout?.on("data", (d: Buffer) => {
          if (stdout.length < maxOutput) stdout += d.toString();
        });
        child.stderr?.on("data", (d: Buffer) => {
          if (stderr.length < maxOutput) stderr += d.toString();
        });
        child.on("error", (err) => finish({ outcome: "error", error: { code: "ESPAWN", message: err.message } }));
        ctx.signal?.addEventListener(
          "abort",
          () => {
            child.kill("SIGKILL");
          },
          { once: true },
        );
        child.on("close", (code, signal) => {
          const durationMs = Date.now() - startedAt;
          const exitCode = code ?? (signal ? -1 : 0);
          const timedOut = signal === "SIGTERM" && durationMs >= timeout - 50;
          const classification = classifyCommand(command);
          ctx.recordEvidence({
            source: "shell.exitCode",
            fact: `"${truncate(command, 120)}" exited with ${exitCode}${signal ? ` (signal ${signal})` : ""} in ${durationMs}ms`,
            value: exitCode,
            observedAt: new Date().toISOString(),
          });

          const body = [
            `$ ${command}`,
            `cwd: ${relative(ctx.workspaceRoot, cwdAbs) || "."}`,
            `exit: ${exitCode}${timedOut ? ` (TIMED OUT after ${timeout}ms)` : ""}`,
            stdout.trim() ? `--- stdout ---\n${truncate(stdout.trim(), 16000)}` : "--- stdout --- (empty)",
            stderr.trim() ? `--- stderr ---\n${truncate(stderr.trim(), 8000)}` : "",
          ]
            .filter(Boolean)
            .join("\n");

          finish({
            outcome: timedOut ? "timeout" : exitCode === 0 ? "success" : "error",
            output: { command, exitCode, signal: signal ?? undefined, timedOut, stdout: truncate(stdout, 32000), stderr: truncate(stderr, 16000), durationMs, cwd: relative(ctx.workspaceRoot, cwdAbs) || "." },
            text: body,
            error: exitCode === 0 && !timedOut ? undefined : { code: timedOut ? "ETIMEDOUT" : `EXIT_${exitCode}`, message: `command exited with code ${exitCode}` },
            evidence: [{ source: "shell.exitCode", fact: `exit=${exitCode}`, value: exitCode, observedAt: new Date().toISOString() }],
            metrics: { exitCode, durationMs, stdoutBytes: stdout.length, stderrBytes: stderr.length },
            observedRisk: classification.risk,
          });
        });
      });
    },
  };
}

/**
 * TERMINAL — a LEGO block for coding agents.
 *
 * The Harness cannot know what an arbitrary command will do, so it does not
 * pretend: reversibility is UNKNOWN (treated as irreversible), risk is
 * classified from the command text, and the *verification* is the exit code and
 * output the Harness itself observed from the child process — not the agent's
 * description of it.
 */
export function terminalCapability(policy: Policy): Capability {
  return defineCapability({
    id: "terminal",
    name: "Terminal",
    version: "0.1.0",
    description: "Execute shell commands inside the workspace, with policy-controlled allow/deny lists and timeouts.",
    permissions: ["shell.exec"],
    configSchema: {
      type: "object",
      properties: {
        allowCommands: { type: "array", items: { type: "string" }, description: "If set, only these command names may run." },
        denyCommands: { type: "array", items: { type: "string" }, description: "Command names that may never run." },
        timeoutMs: { type: "number" },
      },
      additionalProperties: false,
    },
    tools: [terminalTool(policy)],
    async healthCheck(ctx) {
      const shell = process.env.SHELL ?? (process.platform === "win32" ? "cmd.exe" : "/bin/sh");
      return { ok: true, detail: `shell available: ${shell}; cwd ${ctx.workspaceRoot}` };
    },
  });
}
