import { readFile, stat } from "node:fs/promises";
import { rm } from "node:fs/promises";
import type { CheckSpec, Policy, Reversibility, RiskLevel, ToolDefinition, UndoOp } from "@sudarshan/core";
import { MAX_CAPTURE_FOR_UNDO, isTextFile, safePath } from "./util.js";

/**
 * Deletion is the one filesystem action the Harness treats as dangerous by
 * default: `requiresApproval: true` and a dynamic reversibility verdict.
 *
 * If the target is a small text file the Harness can capture its content and
 * genuinely restore it, so the action is REVERSIBLE. If it is a directory tree
 * or a large/binary file, nothing can be restored — so it is IRREVERSIBLE and
 * the human is told exactly that in the approval dialog.
 */
export function deleteTool(policy: Policy): ToolDefinition {
  return {
    name: "filesystem.delete",
    description: "Delete a file or directory. Always requires human approval.",
    permission: "fs.delete",
    defaultRisk: "high",
    defaultReversibility: "irreversible",
    requiresApproval: true,
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Path to delete, relative to the workspace root." },
        reason: { type: "string", description: "Why this deletion is necessary. Shown to the human approving it." },
      },
      required: ["path", "reason"],
      additionalProperties: false,
    },
    classify: async (args, ctx) => {
      const path = String(args.path ?? "");
      const target = safePath(path, ctx, policy);
      const checks: CheckSpec[] = target.ok ? [{ kind: "file_absent", path: target.rel }] : [];
      let risk: RiskLevel = "high";
      let reversibility: Reversibility = "irreversible";
      let size = 0;
      let isDir = false;
      if (target.ok) {
        try {
          const info = await stat(target.resolved);
          isDir = info.isDirectory();
          size = info.size;
          if (!isDir && size <= MAX_CAPTURE_FOR_UNDO && isTextFile(target.resolved)) {
            reversibility = "reversible";
            risk = "medium";
          } else {
            reversibility = "irreversible";
            risk = isDir ? "critical" : "high";
          }
        } catch {
          risk = "low";
          reversibility = "reversible";
        }
      }
      return {
        risk,
        reversibility,
        targets: [{ kind: "path", value: path }],
        checks,
        requiresApproval: true,
      };
    },
    async execute(args, ctx) {
      const target = safePath(args.path, ctx, policy);
      if (!target.ok) return { outcome: "error", error: { code: "ESCOPE", message: target.reason! } };

      let info;
      try {
        info = await stat(target.resolved);
      } catch {
        return { outcome: "error", error: { code: "ENOENT", message: `${target.rel} does not exist (nothing to delete)` } };
      }

      const undo: UndoOp[] = [];
      if (!info.isDirectory() && info.size <= MAX_CAPTURE_FOR_UNDO && isTextFile(target.resolved)) {
        try {
          const content = await readFile(target.resolved, "utf8");
          undo.push({ kind: "fs.restore_file", description: `restore deleted ${target.rel}`, payload: { path: target.rel, content } });
        } catch {
          /* content could not be captured: deletion is genuinely irreversible */
        }
      }
      if (undo.length === 0 && info.isDirectory()) {
        undo.push({ kind: "fs.recreate_dir", description: `recreate the (now empty) directory ${target.rel} — contents cannot be restored`, payload: { path: target.rel, mtime: info.mtimeMs } });
      }

      try {
        await rm(target.resolved, { recursive: true, force: false });
      } catch (err) {
        return { outcome: "error", error: { code: "EDELETE", message: (err as Error).message } };
      }

      return {
        outcome: "success",
        output: { path: target.rel, wasDirectory: info.isDirectory(), bytes: info.size, restorable: undo.some((u) => u.kind === "fs.restore_file") },
        text: `Deleted ${target.rel}${info.isDirectory() ? " (directory)" : ` (${info.size} bytes)`}. ${undo.some((u) => u.kind === "fs.restore_file") ? "Content captured — reversible." : "Not restorable."}`,
        undo,
        evidence: [{ source: "fs.rm", fact: `${target.rel} removed`, observedAt: new Date().toISOString() }],
      };
    },
  };
}
