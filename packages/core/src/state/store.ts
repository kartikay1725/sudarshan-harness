import { mkdir, readFile, rm, stat, writeFile, rename, utimes } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { createHash } from "node:crypto";
import type { AuditTrail } from "../audit/trail.js";
import type { EventBus } from "../events/bus.js";
import type { CapabilityRegistry } from "../capability/registry.js";
import type { Policy, Reversibility, ScopeTarget, StateTransition, UndoContext, UndoHandler, UndoOp, UndoOutcome } from "../types.js";
import { resolveScopedPath } from "../policy/scope.js";
import { newId, nowIso } from "../util/index.js";

export interface PathSnapshot {
  path: string;
  /** Absolute, scope-checked path. */
  resolved: string;
  exists: boolean;
  isDir?: boolean;
  sha256?: string;
  size?: number;
  /** Captured only for small text files, so reversal can be exact. */
  content?: string;
  mtimeMs?: number;
}

export interface Snapshot {
  id: string;
  takenAt: string;
  paths: PathSnapshot[];
  truncated: boolean;
}

const MAX_SNAPSHOT_FILES = 64;
const MAX_CAPTURED_BYTES = 512 * 1024;

/**
 * State store: the "STATE A -> STATE B" machinery.
 *
 * Before an action runs, the Harness captures the real state of the resources
 * the action declared it would touch. After it runs, it captures again. The
 * pair is the evidence for the transition, and the `before` snapshot is what a
 * rollback is checked against:
 *
 *      A --action--> B --rollback--> A'   and we verify A' == A.
 *
 * A rollback that cannot be *verified* is reported as unverified, never as a
 * success.
 */
export class StateStore {
  private transitions: StateTransition[] = [];
  private undoHandlers = new Map<string, UndoHandler>();
  /** Full snapshots (including hashes) kept so a rollback can be verified against state A. */
  private snapshots = new Map<string, { before?: Snapshot; after?: Snapshot }>();

  constructor(
    private deps: {
      workspaceRoot: string;
      policy: Policy;
      registry: CapabilityRegistry;
      bus?: EventBus;
      audit?: AuditTrail;
    },
  ) {
    this.syncUndoHandlers();
  }

  /** Capabilities can be installed/removed mid-flight; keep handlers in sync. */
  syncUndoHandlers(): void {
    this.undoHandlers.clear();
    for (const entry of this.deps.registry.list()) {
      for (const handler of entry.capability.undoHandlers ?? []) {
        this.undoHandlers.set(handler.kind, handler);
      }
    }
    // Core-level handlers always available.
    this.undoHandlers.set("fs.restore_file", { kind: "fs.restore_file", description: "Restore a file's exact previous content", run: restoreFile });
    this.undoHandlers.set("fs.remove_created", { kind: "fs.remove_created", description: "Delete a file/directory that did not exist before", run: removeCreated });
    this.undoHandlers.set("fs.rename_back", { kind: "fs.rename_back", description: "Move a path back to its original location", run: renameBack });
    this.undoHandlers.set("fs.recreate_dir", { kind: "fs.recreate_dir", description: "Recreate a directory that was removed", run: recreateDir });
  }

  async capture(targets: ScopeTarget[], opts: { includeContent?: boolean } = {}): Promise<Snapshot> {
    const paths: PathSnapshot[] = [];
    let truncated = false;
    const seen = new Set<string>();

    for (const target of targets) {
      if (target.kind !== "path") continue;
      if (paths.length >= MAX_SNAPSHOT_FILES) {
        truncated = true;
        break;
      }
      const check = resolveScopedPath(target.value, this.deps.workspaceRoot, this.deps.policy);
      if (!check.ok) continue;
      if (seen.has(check.resolved)) continue;
      seen.add(check.resolved);
      paths.push(await this.snapshotPath(check.resolved, opts.includeContent ?? true));
    }

    return { id: newId("snap"), takenAt: nowIso(), paths, truncated };
  }

  private async snapshotPath(resolved: string, includeContent: boolean): Promise<PathSnapshot> {
    const rel = isAbsolute(resolved) ? resolved : resolve(this.deps.workspaceRoot, resolved);
    try {
      const s = await stat(rel);
      const base: PathSnapshot = {
        path: rel,
        resolved: rel,
        exists: true,
        isDir: s.isDirectory(),
        size: s.size,
        mtimeMs: s.mtimeMs,
      };
      if (!s.isDirectory()) {
        const buf = await readFile(rel);
        base.sha256 = createHash("sha256").update(buf).digest("hex");
        if (includeContent && buf.byteLength <= MAX_CAPTURED_BYTES && isProbablyText(buf)) {
          base.content = buf.toString("utf8");
        }
      }
      return base;
    } catch {
      return { path: rel, resolved: rel, exists: false };
    }
  }

  async recordTransition(input: {
    stepId: string;
    actionId: string;
    tool: string;
    reversibility: Reversibility;
    before?: Snapshot;
    after?: Snapshot;
    undoOps: UndoOp[];
  }): Promise<StateTransition> {
    const transition: StateTransition = {
      id: newId("trn"),
      stepId: input.stepId,
      actionId: input.actionId,
      tool: input.tool,
      reversibility: input.reversibility,
      before: input.before ? { snapshotId: input.before.id, paths: input.before.paths.map(stripContent) } : undefined,
      after: input.after ? { snapshotId: input.after.id, paths: input.after.paths.map(stripContent) } : undefined,
      undoOps: input.undoOps,
      rolledBack: false,
    };
    this.transitions.push(transition);
    this.snapshots.set(transition.id, { before: input.before, after: input.after });
    this.deps.audit?.append(
      "state.transition",
      { transitionId: transition.id, tool: input.tool, reversibility: input.reversibility, undoOps: input.undoOps.length },
      undefined,
    );
    return transition;
  }

  /**
   * A -> B -> rollback -> A'
   * Returns whether the prior state was actually restored, verified by
   * re-observing the filesystem — not by trusting the undo handler.
   */
  /**
   * Reverses a recorded transition and then PROVES the reversal by comparing
   * the live filesystem against the snapshot taken before the action (state A).
   */
  async rollback(transitionId: string, beforeOverride?: Snapshot): Promise<UndoOutcome> {
    const transition = this.transitions.find((t) => t.id === transitionId);
    if (!transition) return { ok: false, detail: `unknown transition ${transitionId}`, verified: false };
    if (transition.rolledBack) return { ok: true, detail: "already rolled back", verified: transition.roundTripVerified ?? false };
    const before = beforeOverride ?? this.snapshots.get(transitionId)?.before;
    if (transition.undoOps.length === 0) {
      const detail = `no undo operations were recorded (reversibility: ${transition.reversibility})`;
      transition.rollbackOutcome = { ok: false, detail, verified: false };
      return transition.rollbackOutcome;
    }

    const ctx: UndoContext = {
      workspaceRoot: this.deps.workspaceRoot,
      policy: this.deps.policy,
      log: (message, level = "info") => this.deps.bus?.emit("log", { level, message, where: "rollback" }),
    };

    const details: string[] = [];
    let ok = true;
    // Reverse order: undo the most recent change first.
    for (const op of [...transition.undoOps].reverse()) {
      const handler = this.undoHandlers.get(op.kind);
      if (!handler) {
        ok = false;
        details.push(`no handler for undo kind "${op.kind}"`);
        continue;
      }
      try {
        const result = await handler.run(op.payload, ctx);
        ok = ok && result.ok;
        details.push(`${op.kind}: ${result.detail}`);
      } catch (err) {
        ok = false;
        details.push(`${op.kind} threw: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

    // Verify the round trip against real state (A -> B -> rollback -> A').
    let verified = false;
    if (before) {
      const now = await this.capture(before.paths.map((p) => ({ kind: "path" as const, value: p.resolved })));
      verified = snapshotsEquivalent(before, now);
    }

    transition.rolledBack = true;
    transition.roundTripVerified = verified;
    transition.rollbackOutcome = { ok, detail: details.join(" | ") || "rolled back", verified };

    this.deps.bus?.emit("rollback.completed", { transitionId: transition.id, ok, verified, detail: transition.rollbackOutcome.detail });
    this.deps.audit?.append("state.rollback", { transitionId: transition.id, ok, verified, details });
    return transition.rollbackOutcome;
  }

  /** Latest-first list, used by the IDE's Recovery panel. */
  list(limit = 200): StateTransition[] {
    return this.transitions.slice(-limit).reverse();
  }

  rollbackable(): StateTransition[] {
    return this.transitions.filter((t) => !t.rolledBack && t.undoOps.length > 0).reverse();
  }

  get(id: string): StateTransition | undefined {
    return this.transitions.find((t) => t.id === id);
  }

  snapshotFor(transitionId: string): { before?: Snapshot; after?: Snapshot } | undefined {
    return this.snapshots.get(transitionId);
  }

  clear(): void {
    this.transitions = [];
    this.snapshots.clear();
  }
}

function stripContent(p: PathSnapshot): Record<string, unknown> {
  const { content, ...rest } = p;
  return { ...rest, contentCaptured: content !== undefined, contentBytes: content ? content.length : 0 };
}

function isProbablyText(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 1024));
  if (sample.length === 0) return true;
  let suspicious = 0;
  for (const byte of sample) {
    if (byte === 0) return false;
    if (byte < 9 || (byte > 13 && byte < 32)) suspicious++;
  }
  return suspicious / sample.length < 0.1;
}

function snapshotsEquivalent(a: Snapshot, b: Snapshot): boolean {
  if (a.paths.length !== b.paths.length) return false;
  const index = new Map(b.paths.map((p) => [p.resolved, p]));
  for (const pa of a.paths) {
    const pb = index.get(pa.resolved);
    if (!pb) return false;
    if (pa.exists !== pb.exists) return false;
    if (pa.exists && pb.exists) {
      if (pa.isDir !== pb.isDir) return false;
      if (!pa.isDir && pa.sha256 && pb.sha256 && pa.sha256 !== pb.sha256) return false;
    }
  }
  return true;
}

/* ---------------- core undo handlers ---------------- */

async function restoreFile(payload: Record<string, unknown>, ctx: UndoContext): Promise<UndoOutcome> {
  const path = String(payload.path ?? "");
  const content = payload.content;
  const check = resolveScopedPath(path, ctx.workspaceRoot, ctx.policy);
  if (!check.ok) return { ok: false, detail: check.reason ?? "outside scope", verified: false };
  try {
    if (content === null || content === undefined) {
      await rm(check.resolved, { force: true });
      return { ok: true, detail: `removed ${path} (did not exist before)`, verified: false };
    }
    await mkdir(dirname(check.resolved), { recursive: true });
    await writeFile(check.resolved, String(content), "utf8");
    return { ok: true, detail: `restored previous content of ${path}`, verified: false };
  } catch (err) {
    return { ok: false, detail: (err as Error).message, verified: false };
  }
}

async function removeCreated(payload: Record<string, unknown>, ctx: UndoContext): Promise<UndoOutcome> {
  const path = String(payload.path ?? "");
  const check = resolveScopedPath(path, ctx.workspaceRoot, ctx.policy);
  if (!check.ok) return { ok: false, detail: check.reason ?? "outside scope", verified: false };
  try {
    await rm(check.resolved, { recursive: true, force: true });
    return { ok: true, detail: `removed created path ${path}`, verified: false };
  } catch (err) {
    return { ok: false, detail: (err as Error).message, verified: false };
  }
}

async function renameBack(payload: Record<string, unknown>, ctx: UndoContext): Promise<UndoOutcome> {
  const from = String(payload.from ?? "");
  const to = String(payload.to ?? "");
  const src = resolveScopedPath(from, ctx.workspaceRoot, ctx.policy);
  const dst = resolveScopedPath(to, ctx.workspaceRoot, ctx.policy);
  if (!src.ok) return { ok: false, detail: src.reason ?? "outside scope", verified: false };
  if (!dst.ok) return { ok: false, detail: dst.reason ?? "outside scope", verified: false };
  try {
    await mkdir(dirname(dst.resolved), { recursive: true });
    await rename(src.resolved, dst.resolved);
    return { ok: true, detail: `moved ${from} back to ${to}`, verified: false };
  } catch (err) {
    return { ok: false, detail: (err as Error).message, verified: false };
  }
}

async function recreateDir(payload: Record<string, unknown>, ctx: UndoContext): Promise<UndoOutcome> {
  const path = String(payload.path ?? "");
  const check = resolveScopedPath(path, ctx.workspaceRoot, ctx.policy);
  if (!check.ok) return { ok: false, detail: check.reason ?? "outside scope", verified: false };
  try {
    await mkdir(check.resolved, { recursive: true });
    if (typeof payload.mtime === "number") {
      const d = new Date(payload.mtime);
      await utimes(check.resolved, d, d).catch(() => undefined);
    }
    return { ok: true, detail: `recreated directory ${path}`, verified: false };
  } catch (err) {
    return { ok: false, detail: (err as Error).message, verified: false };
  }
}
