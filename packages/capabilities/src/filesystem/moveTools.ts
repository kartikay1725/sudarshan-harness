import { mkdir, rename, stat } from "node:fs/promises";
import { dirname } from "node:path";
import type { CheckSpec, Policy, ToolDefinition } from "@sudarshan/core";
import { safePath } from "./util.js";

export function createDirTool(policy: Policy): ToolDefinition {
  return {
    name: "filesystem.create_dir",
    description: "Create a directory (and any missing parents).",
    permission: "fs.create_dir",
    defaultRisk: "low",
    defaultReversibility: "reversible",
    parameters: {
      type: "object",
      properties: { path: { type: "string", description: "Directory path relative to the workspace root." } },
      required: ["path"],
      additionalProperties: false,
    },
    classify: (args, ctx) => {
      const target = safePath(String(args.path ?? ""), ctx, policy);
      const checks: CheckSpec[] = target.ok ? [{ kind: "dir_exists", path: target.rel }] : [];
      return { risk: "low", reversibility: "reversible", targets: [{ kind: "path", value: String(args.path ?? "") }], checks };
    },
    async execute(args, ctx) {
      const target = safePath(args.path, ctx, policy);
      if (!target.ok) return { outcome: "error", error: { code: "ESCOPE", message: target.reason! } };
      let existed = false;
      try {
        existed = (await stat(target.resolved)).isDirectory();
      } catch {
        existed = false;
      }
      try {
        await mkdir(target.resolved, { recursive: true });
      } catch (err) {
        return { outcome: "error", error: { code: "EMKDIR", message: (err as Error).message } };
      }
      return {
        outcome: "success",
        output: { path: target.rel, created: !existed },
        text: existed ? `${target.rel}/ already existed` : `Created directory ${target.rel}/`,
        undo: existed ? [] : [{ kind: "fs.remove_created", description: `remove created directory ${target.rel}`, payload: { path: target.rel } }],
        evidence: [{ source: "fs.stat", fact: `${target.rel} is a directory`, observedAt: new Date().toISOString() }],
      };
    },
  };
}

export function moveTool(policy: Policy): ToolDefinition {
  return {
    name: "filesystem.move",
    description: "Move or rename a file or directory. Creates the destination directory if needed.",
    permission: "fs.move",
    defaultRisk: "medium",
    defaultReversibility: "reversible",
    parameters: {
      type: "object",
      properties: {
        from: { type: "string", description: "Existing source path." },
        to: { type: "string", description: "Destination path." },
      },
      required: ["from", "to"],
      additionalProperties: false,
    },
    classify: (args, ctx) => {
      const from = String(args.from ?? "");
      const to = String(args.to ?? "");
      const src = safePath(from, ctx, policy);
      const dst = safePath(to, ctx, policy);
      const checks: CheckSpec[] = [];
      if (src.ok && dst.ok) {
        checks.push({ kind: "file_exists", path: dst.rel });
        checks.push({ kind: "file_absent", path: src.rel });
      }
      return {
        risk: "medium",
        reversibility: "reversible",
        targets: [
          { kind: "path", value: from },
          { kind: "path", value: to },
        ],
        checks,
      };
    },
    async execute(args, ctx) {
      const src = safePath(args.from, ctx, policy);
      const dst = safePath(args.to, ctx, policy);
      if (!src.ok) return { outcome: "error", error: { code: "ESCOPE", message: `source: ${src.reason}` } };
      if (!dst.ok) return { outcome: "error", error: { code: "ESCOPE", message: `destination: ${dst.reason}` } };
      try {
        await stat(src.resolved);
      } catch {
        return { outcome: "error", error: { code: "ENOENT", message: `${src.rel} does not exist` } };
      }
      let destinationExisted = false;
      try {
        await stat(dst.resolved);
        destinationExisted = true;
      } catch {
        destinationExisted = false;
      }
      if (destinationExisted) {
        return { outcome: "error", error: { code: "EEXISTS", message: `${dst.rel} already exists; refusing to overwrite. Choose another destination or delete it first (deletion needs approval).` } };
      }
      try {
        await mkdir(dirname(dst.resolved), { recursive: true });
        await rename(src.resolved, dst.resolved);
      } catch (err) {
        return { outcome: "error", error: { code: "EMOVE", message: (err as Error).message } };
      }
      const info = await stat(dst.resolved);
      return {
        outcome: "success",
        output: { from: src.rel, to: dst.rel, isDir: info.isDirectory() },
        text: `Moved ${src.rel} -> ${dst.rel}`,
        undo: [{ kind: "fs.rename_back", description: `move ${dst.rel} back to ${src.rel}`, payload: { from: dst.rel, to: src.rel } }],
        evidence: [{ source: "fs.stat", fact: `${dst.rel} exists and ${src.rel} no longer does`, observedAt: new Date().toISOString() }],
      };
    },
  };
}
