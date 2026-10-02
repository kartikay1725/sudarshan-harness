import { isAbsolute, resolve, relative, sep } from "node:path";
import type { Policy, ScopeTarget } from "../types.js";
import { globMatch } from "../util/index.js";

export type ScopeFailureCode = "protected_path" | "scope_violation";

export interface PathCheck {
  ok: boolean;
  resolved: string;
  reason?: string;
  code?: ScopeFailureCode;
}

/**
 * Resolve a possibly-relative path against the workspace root and prove it
 * stays inside an allowed root. This is the single place path scope is decided —
 * capabilities must not do their own path maths.
 */
export function resolveScopedPath(rawPath: string, workspaceRoot: string, policy: Policy): PathCheck {
  const root = resolve(workspaceRoot);
  const target = isAbsolute(rawPath) ? resolve(rawPath) : resolve(root, rawPath);

  // Protected paths win over everything, including explicit allows.
  for (const pattern of policy.protectedPaths) {
    const protectedAbs = isAbsolute(pattern) ? resolve(pattern) : resolve(root, pattern);
    if (target === protectedAbs || target.startsWith(protectedAbs + sep)) {
      return { ok: false, resolved: target, reason: `protected path: ${pattern}`, code: "protected_path" };
    }
    if (globMatch(pattern, relative(root, target)) || globMatch(pattern, target)) {
      return { ok: false, resolved: target, reason: `protected path pattern: ${pattern}`, code: "protected_path" };
    }
  }

  const allowedRoots = policy.scopes.fsRoots.length > 0 ? policy.scopes.fsRoots : [root];
  let inside = false;
  for (const r of allowedRoots) {
    const abs = isAbsolute(r) ? resolve(r) : resolve(root, r);
    if (target === abs || target.startsWith(abs + sep)) {
      inside = true;
      break;
    }
  }
  if (!inside) {
    return { ok: false, resolved: target, reason: `outside allowed filesystem scope (${allowedRoots.join(", ")})` };
  }

  for (const deny of policy.scopes.fsDeny) {
    const abs = isAbsolute(deny) ? resolve(deny) : resolve(root, deny);
    if (target === abs || target.startsWith(abs + sep)) {
      return { ok: false, resolved: target, reason: `denied path: ${deny}`, code: "scope_violation" };
    }
    const rel = relative(root, target);
    if (globMatch(deny, rel) || globMatch(deny, target)) {
      return { ok: false, resolved: target, reason: `denied path pattern: ${deny}`, code: "scope_violation" };
    }
  }

  return { ok: true, resolved: target };
}

export function checkCommand(command: string, policy: Policy): { ok: boolean; reason?: string } {
  const head = command.trim().split(/\s+/)[0] ?? "";
  const base = head.split(/[\\/]/).pop() ?? head;
  const deny = policy.scopes.shell.denyCommands ?? [];
  for (const pattern of deny) {
    if (globMatch(pattern, base) || globMatch(pattern, command)) {
      return { ok: false, reason: `command denied by policy: ${pattern}` };
    }
  }
  const allow = policy.scopes.shell.allowCommands;
  if (allow && allow.length > 0) {
    const ok = allow.some((pattern) => globMatch(pattern, base) || globMatch(pattern, command));
    if (!ok) return { ok: false, reason: `command not in allowlist (${allow.join(", ")})` };
  }
  return { ok: true };
}

export function checkHost(url: string, policy: Policy): { ok: boolean; reason?: string; host?: string } {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return { ok: false, reason: `not a valid URL: ${url}` };
  }
  const host = parsed.hostname;
  const deny = policy.scopes.net.denyHosts ?? [];
  for (const pattern of deny) {
    if (globMatch(pattern, host)) return { ok: false, reason: `host denied by policy: ${pattern}`, host };
  }
  const allow = policy.scopes.net.allowHosts;
  if (allow && allow.length > 0) {
    const ok = allow.some((pattern) => globMatch(pattern, host));
    if (!ok) return { ok: false, reason: `host not in allowlist (${allow.join(", ")})`, host };
  }
  return { ok: true, host };
}

export function checkTargets(
  targets: ScopeTarget[],
  policy: Policy,
  workspaceRoot: string,
): { ok: boolean; reason?: string; code?: ScopeFailureCode } {
  for (const t of targets) {
    if (t.kind === "path") {
      const check = resolveScopedPath(t.value, workspaceRoot, policy);
      if (!check.ok) return { ok: false, reason: `${t.value}: ${check.reason}`, code: check.code ?? "scope_violation" };
    } else if (t.kind === "command") {
      const check = checkCommand(t.value, policy);
      if (!check.ok) return { ok: false, reason: check.reason };
    } else if (t.kind === "url") {
      const check = checkHost(t.value, policy);
      if (!check.ok) return { ok: false, reason: check.reason };
    }
  }
  return { ok: true };
}
