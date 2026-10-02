import type { BudgetPolicy, Policy, RiskLevel } from "../types.js";
import { globMatch } from "../util/index.js";

export const DEFAULT_BUDGETS: BudgetPolicy = {
  maxSteps: 24,
  maxToolCalls: 120,
  maxTokens: 400_000,
  maxWallClockMs: 30 * 60 * 1000,
  maxRepeatedActions: 3,
  maxUnverifiedSteps: 5,
};

/**
 * A deliberately conservative default: the agent may read almost anything in
 * the workspace, may write inside the workspace, may run safe shell commands,
 * and may not touch the network, credentials or git history rewrites without
 * an explicit grant or a human approval.
 */
export function defaultPolicy(workspaceRoot: string): Policy {
  return {
    denyByDefault: true,
    // Granted by default: local, in-scope work. Deliberately NOT granted:
    // `git.push` (publishes to a shared remote) and `net.request` (leaves the
    // machine). Installing a capability does not grant its permissions — that
    // is a separate, visible operator decision.
    permissions: [
      "fs.read",
      "fs.list",
      "fs.write",
      "fs.create_dir",
      "fs.move",
      "fs.delete",
      "shell.exec",
      "git.read",
      "git.write",
      "verify.run",
      "spec.read",
    ],
    rules: [
      {
        id: "deny-force-push",
        effect: "deny",
        tool: "git.push",
        argsMatch: { force: "true" },
        reason: "Force-push rewrites shared history and is irreversible.",
      },
      {
        id: "deny-rm-rf-root",
        effect: "deny",
        permission: "shell.exec",
        argsMatch: { command: "*rm -rf /*" },
        reason: "Recursive delete from the filesystem root.",
      },
      {
        id: "deny-sudo",
        effect: "deny",
        permission: "shell.exec",
        argsMatch: { command: "sudo *" },
        reason: "Privilege escalation is outside the agent's authority.",
      },
      {
        id: "approve-delete",
        effect: "allow",
        tool: "filesystem.delete",
        requireApproval: true,
        reason: "Deletion is allowed inside scope but a human confirms each class.",
      },
      {
        id: "approve-network",
        effect: "allow",
        permission: "net.request",
        requireApproval: true,
        reason: "Outbound network calls leave the machine.",
      },
    ],
    scopes: {
      fsRoots: [workspaceRoot],
      fsDeny: ["**/node_modules/**", "**/.git/objects/**", "**/.env", "**/.env.*"],
      shell: {
        cwd: workspaceRoot,
        denyCommands: ["shutdown", "reboot", "mkfs", "dd", "fdisk", "chmod777"],
        maxOutputBytes: 256 * 1024,
        timeoutMs: 120_000,
      },
      net: {
        denyHosts: ["localhost", "127.0.0.1", "169.254.169.254", "metadata.google.internal"],
        timeoutMs: 30_000,
      },
    },
    budgets: { ...DEFAULT_BUDGETS },
    approval: {
      requireForRisk: ["high", "critical"],
      requireForReversibility: ["irreversible"],
      requireForTools: [],
      allowClassApproval: true,
    },
    verification: {
      perAction: true,
      blindVerifier: false,
      strict: true,
      expectations: [],
    },
    protectedPaths: [
      "**/.git/config",
      "**/.git/objects",
      "**/.ssh/**",
      "**/.aws/**",
      "**/.config/gh/**",
      "**/.npmrc",
      "**/.netrc",
      "**/.env",
      "**/id_rsa",
      "**/id_ed25519",
    ],
  };
}

export function permissionGranted(permission: string, policy: Policy): boolean {
  if (policy.permissions.includes("*")) return true;
  return policy.permissions.some((granted) => granted === permission || globMatch(granted, permission));
}

export interface MatchedRule {
  rule: Policy["rules"][number];
  matchedOn: string;
}

export function matchRules(
  input: { tool: string; permission: string; args: Record<string, unknown>; targetValues: string[] },
  policy: Policy,
): MatchedRule[] {
  const matched: MatchedRule[] = [];
  for (const rule of policy.rules) {
    if (rule.tool && !globMatch(rule.tool, input.tool)) continue;
    if (rule.permission && !globMatch(rule.permission, input.permission)) continue;
    if (rule.target) {
      const hit = input.targetValues.some((v) => globMatch(rule.target!.match, v));
      if (!hit) continue;
    }
    if (rule.argsMatch) {
      const ok = Object.entries(rule.argsMatch).every(([key, pattern]) => {
        const value = input.args[key];
        return globMatch(pattern, typeof value === "string" ? value : String(value));
      });
      if (!ok) continue;
    }
    matched.push({ rule, matchedOn: describeRule(rule) });
  }
  return matched;
}

function describeRule(rule: Policy["rules"][number]): string {
  const parts: string[] = [];
  if (rule.tool) parts.push(`tool=${rule.tool}`);
  if (rule.permission) parts.push(`permission=${rule.permission}`);
  if (rule.target) parts.push(`target=${rule.target.kind}:${rule.target.match}`);
  if (rule.argsMatch) parts.push(`args=${JSON.stringify(rule.argsMatch)}`);
  return parts.join(" ") || "(catch-all)";
}

/** Risk escalation helper: `max(risk, observedRisk)`. */
export function maxRisk(a: RiskLevel, b: RiskLevel): RiskLevel {
  const order: RiskLevel[] = ["low", "medium", "high", "critical"];
  return order[Math.max(order.indexOf(a), order.indexOf(b))]!;
}

export function mergePolicy(base: Policy, patch: Partial<Policy>): Policy {
  return {
    ...base,
    ...patch,
    permissions: patch.permissions ?? base.permissions,
    rules: [...base.rules, ...(patch.rules ?? [])],
    protectedPaths: [...new Set([...base.protectedPaths, ...(patch.protectedPaths ?? [])])],
    scopes: {
      ...base.scopes,
      ...(patch.scopes ?? {}),
      fsRoots: patch.scopes?.fsRoots ?? base.scopes.fsRoots,
      fsDeny: [...new Set([...base.scopes.fsDeny, ...(patch.scopes?.fsDeny ?? [])])],
      shell: { ...base.scopes.shell, ...(patch.scopes?.shell ?? {}) },
      net: { ...base.scopes.net, ...(patch.scopes?.net ?? {}) },
    },
    budgets: { ...base.budgets, ...(patch.budgets ?? {}) },
    approval: { ...base.approval, ...(patch.approval ?? {}) },
    verification: { ...base.verification, ...(patch.verification ?? {}) },
  };
}
