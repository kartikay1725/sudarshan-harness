import { spawn } from "node:child_process";
import { defineCapability, truncate, type Capability, type CheckSpec, type Policy, type ToolContext, type ToolDefinition } from "@sudarshan/core";

export interface GitRunResult {
  code: number;
  stdout: string;
  stderr: string;
}

/** Git is invoked with an argument vector — never through a shell string. */
export function runGit(args: string[], ctx: ToolContext, policy: Policy, timeoutMs = 60_000): Promise<GitRunResult> {
  return new Promise((promiseResolve) => {
    const child = spawn("git", args, {
      cwd: ctx.workspaceRoot,
      env: { ...ctx.env, GIT_TERMINAL_PROMPT: "0", NO_COLOR: "1" },
      shell: false,
      timeout: Math.min(timeoutMs, policy.scopes.shell.timeoutMs),
      windowsHide: true,
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (value: GitRunResult) => {
      if (!settled) {
        settled = true;
        promiseResolve(value);
      }
    };
    child.stdout?.on("data", (d: Buffer) => (stdout += d.toString()));
    child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
    child.on("error", (err) => finish({ code: -1, stdout, stderr: `${stderr}\n${err.message}`.trim() }));
    child.on("close", (code) => finish({ code: code ?? -1, stdout: truncate(stdout, 64_000), stderr: truncate(stderr, 16_000) }));
  });
}

export async function isRepo(ctx: ToolContext): Promise<boolean> {
  const res = await runGit(["rev-parse", "--is-inside-work-tree"], ctx, { scopes: { shell: { timeoutMs: 5000 } } } as Policy);
  return res.code === 0 && res.stdout.trim() === "true";
}

export async function currentBranch(ctx: ToolContext, policy: Policy): Promise<string> {
  const res = await runGit(["rev-parse", "--abbrev-ref", "HEAD"], ctx, policy, 5000);
  return res.code === 0 ? res.stdout.trim() : "";
}

function repoGuard(target: { repoPath?: string }): CheckSpec[] {
  return target.repoPath ? [{ kind: "dir_exists", path: target.repoPath }] : [];
}

function statusTool(policy: Policy): ToolDefinition {
  return {
    name: "git.status",
    description: "Show the working tree status (porcelain) and the current branch.",
    permission: "git.read",
    defaultRisk: "low",
    defaultReversibility: "reversible",
    parameters: { type: "object", properties: {}, additionalProperties: false },
    classify: () => ({ risk: "low", reversibility: "reversible", targets: [{ kind: "path", value: "." }] }),
    async execute(_args, ctx) {
      const [status, branch] = await Promise.all([runGit(["status", "--porcelain=v1", "-b"], ctx, policy), currentBranch(ctx, policy)]);
      if (status.code !== 0) return { outcome: "error", error: { code: "EGIT", message: status.stderr || "not a git repository" } };
      const lines = status.stdout.trim();
      return {
        outcome: "success",
        output: { branch, porcelain: lines },
        text: `branch: ${branch}\n${lines === "" || lines.split("\n").length === 1 ? "working tree clean" : lines}`,
        metrics: { changedFiles: Math.max(0, lines.split("\n").length - 1) },
      };
    },
  };
}

function diffTool(policy: Policy): ToolDefinition {
  return {
    name: "git.diff",
    description: "Show uncommitted changes, or the diff of a specific commit.",
    permission: "git.read",
    defaultRisk: "low",
    defaultReversibility: "reversible",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Limit the diff to one path." },
        staged: { type: "boolean", description: "Diff the index instead of the working tree." },
        ref: { type: "string", description: "A commit/range, e.g. HEAD~1 or main..feature." },
      },
      additionalProperties: false,
    },
    classify: (args) => ({
      risk: "low",
      reversibility: "reversible",
      targets: [{ kind: "path", value: String(args.path ?? ".") }],
    }),
    async execute(args, ctx) {
      const gitArgs = ["diff"];
      if (args.staged === true) gitArgs.push("--staged");
      if (typeof args.ref === "string") gitArgs.push(args.ref);
      gitArgs.push("--no-color", "--stat", "--patch");
      if (typeof args.path === "string") gitArgs.push("--", args.path);
      const res = await runGit(gitArgs, ctx, policy);
      if (res.code !== 0) return { outcome: "error", error: { code: "EGIT", message: res.stderr || "diff failed" } };
      return {
        outcome: "success",
        output: { diff: res.stdout },
        text: res.stdout.trim() === "" ? "No differences." : truncate(res.stdout, 24000),
        metrics: { diffBytes: res.stdout.length },
      };
    },
  };
}

function logTool(policy: Policy): ToolDefinition {
  return {
    name: "git.log",
    description: "Show recent commits.",
    permission: "git.read",
    defaultRisk: "low",
    defaultReversibility: "reversible",
    parameters: {
      type: "object",
      properties: { limit: { type: "number", description: "How many commits to show (default 10)." }, path: { type: "string" } },
      additionalProperties: false,
    },
    classify: () => ({ risk: "low", reversibility: "reversible", targets: [{ kind: "path", value: "." }] }),
    async execute(args, ctx) {
      const limit = Math.min(Number(args.limit ?? 10) || 10, 200);
      const gitArgs = ["log", `--max-count=${limit}`, "--pretty=format:%h %ad %an %s", "--date=short"];
      if (typeof args.path === "string") gitArgs.push("--", args.path);
      const res = await runGit(gitArgs, ctx, policy);
      if (res.code !== 0) return { outcome: "error", error: { code: "EGIT", message: res.stderr || "log failed" } };
      return { outcome: "success", output: { commits: res.stdout.split("\n").filter(Boolean) }, text: res.stdout || "No commits." };
    },
  };
}

function addTool(policy: Policy): ToolDefinition {
  return {
    name: "git.add",
    description: "Stage paths for the next commit.",
    permission: "git.write",
    defaultRisk: "medium",
    defaultReversibility: "compensatable",
    parameters: {
      type: "object",
      properties: { paths: { type: "array", items: { type: "string" }, description: "Paths to stage. Use ['.'] for everything." } },
      required: ["paths"],
      additionalProperties: false,
    },
    classify: (args) => {
      const paths = Array.isArray(args.paths) ? args.paths.map(String) : ["."];
      const checks: CheckSpec[] = [
        { kind: "command", command: "git", args: ["diff", "--cached", "--name-only"], expectExit: 0 },
      ];
      return {
        risk: "medium",
        reversibility: "compensatable",
        targets: paths.map((p) => ({ kind: "path" as const, value: p })),
        checks,
      };
    },
    async execute(args, ctx) {
      const paths = Array.isArray(args.paths) ? args.paths.map(String) : ["."];
      if (paths.length === 0) return { outcome: "error", error: { code: "EARGS", message: "no paths given" } };
      const before = await runGit(["rev-parse", "HEAD"], ctx, policy, 5000);
      const res = await runGit(["add", "--", ...paths], ctx, policy);
      if (res.code !== 0) return { outcome: "error", error: { code: "EGIT", message: res.stderr || "add failed" } };
      const staged = await runGit(["diff", "--cached", "--name-only"], ctx, policy);
      return {
        outcome: "success",
        output: { staged: staged.stdout.split("\n").filter(Boolean) },
        text: `Staged ${staged.stdout.split("\n").filter(Boolean).length} path(s): ${staged.stdout.split("\n").filter(Boolean).join(", ") || "(none)"}`,
        undo: [{ kind: "git.reset_index", description: "unstage everything that was staged", payload: { head: before.stdout.trim() } }],
        evidence: [{ source: "git.diff --cached", fact: `${staged.stdout.split("\n").filter(Boolean).length} path(s) staged`, observedAt: new Date().toISOString() }],
      };
    },
  };
}

function commitTool(policy: Policy): ToolDefinition {
  return {
    name: "git.commit",
    description: "Commit the staged changes with a message.",
    permission: "git.write",
    defaultRisk: "medium",
    defaultReversibility: "compensatable",
    parameters: {
      type: "object",
      properties: {
        message: { type: "string", description: "Commit message." },
        addAll: { type: "boolean", description: "Stage tracked modifications first (git commit -a)." },
      },
      required: ["message"],
      additionalProperties: false,
    },
    classify: async (args, ctx) => {
      const message = String(args.message ?? "");
      const firstLine = message.split("\n")[0] ?? "";
      const checks: CheckSpec[] = [
        // A real probe after the fact: the newest commit's subject must be ours.
        { kind: "command", command: "git", args: ["log", "-1", "--pretty=%s"], expectExit: 0, expectStdout: truncate(firstLine, 200) },
        { kind: "command", command: "git", args: ["rev-parse", "--verify", "HEAD"], expectExit: 0 },
      ];
      return {
        risk: "medium",
        reversibility: "compensatable",
        targets: [{ kind: "path", value: "." }],
        checks,
        signature: `commit|${firstLine}`,
      };
    },
    async execute(args, ctx) {
      const message = String(args.message ?? "");
      if (!message.trim()) return { outcome: "error", error: { code: "EARGS", message: "commit message is empty" } };
      const before = (await runGit(["rev-parse", "HEAD"], ctx, policy, 5000)).stdout.trim();
      const gitArgs = ["commit", "-m", message];
      if (args.addAll === true) gitArgs.push("-a");
      const res = await runGit(gitArgs, ctx, policy);
      const after = (await runGit(["rev-parse", "HEAD"], ctx, policy, 5000)).stdout.trim();
      if (res.code !== 0) {
        return { outcome: "error", error: { code: "EGIT", message: res.stderr || res.stdout || "commit failed" } };
      }
      const stat = await runGit(["show", "--stat", "--oneline", "--no-patch", after], ctx, policy);
      return {
        outcome: "success",
        output: { before, after, changed: before !== after, stat: stat.stdout },
        text: `Committed ${after.slice(0, 10)} (was ${before ? before.slice(0, 10) : "no previous commit"})\n${stat.stdout}`,
        undo: before
          ? [{ kind: "git.soft_reset", description: `undo the commit, keeping changes staged (reset to ${before.slice(0, 10)})`, payload: { to: before } }]
          : [],
        evidence: [{ source: "git.rev-parse", fact: `HEAD moved ${before.slice(0, 8) || "(none)"} -> ${after.slice(0, 8)}`, observedAt: new Date().toISOString() }],
        metrics: { headChanged: before !== after ? 1 : 0 },
      };
    },
  };
}

function pushTool(policy: Policy): ToolDefinition {
  return {
    name: "git.push",
    description: "Push commits to a remote. Irreversible once published; always needs human approval.",
    permission: "git.push",
    defaultRisk: "high",
    defaultReversibility: "irreversible",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        remote: { type: "string", description: "Remote name (default origin)." },
        branch: { type: "string", description: "Branch to push (default: current branch)." },
        force: { type: "boolean", description: "Force push. Denied by default policy." },
        setUpstream: { type: "boolean" },
      },
      additionalProperties: false,
    },
    classify: async (args, ctx) => {
      const remote = String(args.remote ?? "origin");
      const branch = String(args.branch ?? (await currentBranch(ctx, policy)));
      const force = args.force === true;
      const checks: CheckSpec[] = branch
        ? [{ kind: "command", command: "git", args: ["rev-list", "--count", `${remote}/${branch}..HEAD`], expectExit: 0, expectStdout: "/^\\s*0\\s*$/" }]
        : [];
      return {
        risk: force ? "critical" : "high",
        reversibility: "irreversible",
        targets: [{ kind: "resource", value: `${remote}/${branch}` }],
        checks,
        requiresApproval: true,
        signature: `push|${remote}|${branch}|${force ? "force" : "fast"}`,
      };
    },
    async execute(args, ctx) {
      const remote = String(args.remote ?? "origin");
      const branch = String(args.branch ?? (await currentBranch(ctx, policy)));
      if (!branch) return { outcome: "error", error: { code: "EGIT", message: "cannot determine the current branch" } };
      const gitArgs = ["push"];
      if (args.setUpstream === true) gitArgs.push("-u");
      if (args.force === true) gitArgs.push("--force-with-lease");
      gitArgs.push(remote, branch);
      const res = await runGit(gitArgs, ctx, policy, 120_000);
      if (res.code !== 0) return { outcome: "error", error: { code: "EGIT", message: res.stderr || res.stdout || "push failed" } };
      ctx.recordEvidence({ source: "git.push", fact: `pushed ${branch} to ${remote}`, observedAt: new Date().toISOString() });
      return {
        outcome: "success",
        output: { remote, branch, detail: res.stderr || res.stdout },
        text: `Pushed ${branch} to ${remote}.\n${truncate((res.stderr || res.stdout).trim(), 2000)}`,
        // Publishing to a shared remote cannot be undone by the Harness.
        undo: [],
        evidence: [{ source: "git.push", fact: `${remote}/${branch} updated`, observedAt: new Date().toISOString() }],
      };
    },
  };
}

function branchTool(policy: Policy): ToolDefinition {
  return {
    name: "git.create_branch",
    description: "Create a new branch (and optionally switch to it).",
    permission: "git.write",
    defaultRisk: "medium",
    defaultReversibility: "compensatable",
    parameters: {
      type: "object",
      properties: { name: { type: "string" }, checkout: { type: "boolean", description: "Switch to the new branch (default true)." } },
      required: ["name"],
      additionalProperties: false,
    },
    classify: (args) => {
      const name = String(args.name ?? "");
      return {
        risk: "medium",
        reversibility: "compensatable",
        targets: [{ kind: "resource", value: `branch:${name}` }],
        checks: [{ kind: "command", command: "git", args: ["rev-parse", "--verify", name], expectExit: 0 }],
        signature: `branch|${name}`,
      };
    },
    async execute(args, ctx) {
      const name = String(args.name ?? "");
      if (!/^[\w./-]+$/.test(name)) return { outcome: "error", error: { code: "EARGS", message: `invalid branch name: ${name}` } };
      const checkout = args.checkout !== false;
      const previous = await currentBranch(ctx, policy);
      const res = await runGit(checkout ? ["checkout", "-b", name] : ["branch", name], ctx, policy);
      if (res.code !== 0) return { outcome: "error", error: { code: "EGIT", message: res.stderr || res.stdout || "branch creation failed" } };
      return {
        outcome: "success",
        output: { branch: name, previous, checkedOut: checkout },
        text: `Created branch ${name}${checkout ? ` and switched to it (was ${previous})` : ""}`,
        undo: checkout && previous
          ? [{ kind: "git.checkout", description: `switch back to ${previous}`, payload: { branch: previous } }, { kind: "git.delete_branch", description: `delete branch ${name}`, payload: { branch: name } }]
          : [{ kind: "git.delete_branch", description: `delete branch ${name}`, payload: { branch: name } }],
      };
    },
  };
}

/**
 * GIT — a LEGO block.
 *
 * Git is invoked with argument vectors, never a shell string, so the surface is
 * exactly the subcommands declared here. `git.push` is IRREVERSIBLE and always
 * asks a human; force-push is denied outright by default policy.
 */
export function gitCapability(policy: Policy): Capability {
  return defineCapability({
    id: "git",
    name: "Git",
    version: "0.1.0",
    description: "Inspect and change repository state: status, diff, log, add, commit, branch, push.",
    permissions: ["git.read", "git.write", "git.push"],
    tools: [statusTool(policy), diffTool(policy), logTool(policy), addTool(policy), commitTool(policy), branchTool(policy), pushTool(policy)],
    undoHandlers: [
      {
        kind: "git.reset_index",
        description: "Unstage everything",
        async run(_payload, ctx) {
          const res = await runGit(["reset"], { ...ctxFor(ctx) }, ctx.policy);
          return { ok: res.code === 0, detail: res.code === 0 ? "index reset" : res.stderr, verified: false };
        },
      },
      {
        kind: "git.soft_reset",
        description: "Undo a commit, keeping the changes staged",
        async run(payload, ctx) {
          const to = String(payload.to ?? "HEAD~1");
          const res = await runGit(["reset", "--soft", to], { ...ctxFor(ctx) }, ctx.policy);
          return { ok: res.code === 0, detail: res.code === 0 ? `soft reset to ${to}` : res.stderr, verified: false };
        },
      },
      {
        kind: "git.checkout",
        description: "Switch branches",
        async run(payload, ctx) {
          const res = await runGit(["checkout", String(payload.branch ?? "")], { ...ctxFor(ctx) }, ctx.policy);
          return { ok: res.code === 0, detail: res.code === 0 ? `checked out ${payload.branch}` : res.stderr, verified: false };
        },
      },
      {
        kind: "git.delete_branch",
        description: "Delete a branch",
        async run(payload, ctx) {
          const res = await runGit(["branch", "-D", String(payload.branch ?? "")], { ...ctxFor(ctx) }, ctx.policy);
          return { ok: res.code === 0, detail: res.code === 0 ? `deleted branch ${payload.branch}` : res.stderr, verified: false };
        },
      },
    ],
    async healthCheck(ctx) {
      const version = await runGit(["--version"], ctx, { scopes: { shell: { timeoutMs: 5000 } } } as Policy, 5000);
      if (version.code !== 0) return { ok: false, detail: `git not available: ${version.stderr}` };
      const repo = await isRepo(ctx);
      return { ok: true, detail: `${version.stdout.trim()}; ${repo ? "inside a repository" : "workspace is not a git repository"}` };
    },
  });
}

function ctxFor(ctx: { workspaceRoot: string }): ToolContext {
  return {
    workspaceRoot: ctx.workspaceRoot,
    runId: "rollback",
    stepId: "rollback",
    config: {},
    env: process.env as Record<string, string | undefined>,
    log: () => undefined,
    recordEvidence: () => undefined,
  };
}

export { repoGuard };
