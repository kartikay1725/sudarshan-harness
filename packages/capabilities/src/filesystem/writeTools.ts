import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { truncate, type CheckSpec, type Policy, type ToolDefinition, type UndoOp } from "@sudarshan/core";
import { MAX_CAPTURE_FOR_UNDO, isTextFile, safePath, sha256 } from "./util.js";

export function writeTool(policy: Policy): ToolDefinition {
  return {
    name: "filesystem.write",
    description: "Write a text file, creating parent directories as needed. Overwrites unless append is true.",
    permission: "fs.write",
    defaultRisk: "medium",
    defaultReversibility: "reversible",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Destination path relative to the workspace root." },
        content: { type: "string", description: "Full file content." },
        append: { type: "boolean", description: "Append to the existing file instead of overwriting." },
      },
      required: ["path", "content"],
      additionalProperties: false,
    },
    // Checks are fixed BEFORE execution: the file must exist and its sha256 must
    // equal the hash of exactly what was requested. Goalposts cannot move.
    classify: async (args, ctx) => {
      const path = String(args.path ?? "");
      const content = String(args.content ?? "");
      const append = args.append === true;
      const target = safePath(path, ctx, policy);
      let expectedHash = sha256(content);
      let existedBefore = false;
      let previousSize = 0;
      if (target.ok) {
        try {
          const info = await stat(target.resolved);
          existedBefore = true;
          previousSize = info.size;
          if (append) expectedHash = sha256((await readFile(target.resolved, "utf8")) + content);
        } catch {
          existedBefore = false;
        }
      }
      const checks: CheckSpec[] = target.ok
        ? [
            { kind: "file_exists", path: target.rel },
            { kind: "file_hash", path: target.rel, sha256: expectedHash },
          ]
        : [];
      return {
        risk: existedBefore && previousSize > 64 * 1024 ? "high" : "medium",
        reversibility: "reversible",
        targets: [{ kind: "path", value: path }],
        checks,
        signature: `${path}|${sha256(content).slice(0, 12)}|${append ? "append" : "write"}`,
      };
    },
    async execute(args, ctx) {
      const target = safePath(args.path, ctx, policy);
      if (!target.ok) return { outcome: "error", error: { code: "ESCOPE", message: target.reason! } };
      const content = String(args.content ?? "");
      const append = args.append === true;

      let previous: string | null = null;
      let existed = false;
      try {
        const info = await stat(target.resolved);
        existed = !info.isDirectory();
        if (existed && info.size <= MAX_CAPTURE_FOR_UNDO) previous = await readFile(target.resolved, "utf8");
      } catch {
        existed = false;
      }

      try {
        await mkdir(dirname(target.resolved), { recursive: true });
        await writeFile(target.resolved, append && existed && previous !== null ? previous + content : content, "utf8");
      } catch (err) {
        return { outcome: "error", error: { code: "EWRITE", message: (err as Error).message } };
      }

      const info = await stat(target.resolved);
      const undo: UndoOp[] = existed
        ? previous !== null
          ? [{ kind: "fs.restore_file", description: `restore previous content of ${target.rel}`, payload: { path: target.rel, content: previous } }]
          : [{ kind: "fs.restore_file", description: `previous content of ${target.rel} was not captured (too large or binary)`, payload: { path: target.rel, content: null } }]
        : [{ kind: "fs.remove_created", description: `delete newly created ${target.rel}`, payload: { path: target.rel } }];

      return {
        outcome: "success",
        output: { path: target.rel, bytes: info.size, created: !existed, appended: append && existed, sha256: sha256(content) },
        text: `${append && existed ? "Appended to" : existed ? "Overwrote" : "Created"} ${target.rel} (${info.size} bytes)`,
        undo,
        evidence: [{ source: "fs.stat", fact: `${target.rel} is now ${info.size} bytes`, value: info.size, observedAt: new Date().toISOString() }],
        metrics: { bytes: info.size },
      };
    },
  };
}

export function editTool(policy: Policy): ToolDefinition {
  return {
    name: "filesystem.edit",
    description: "Replace an exact substring in a file. Prefer this over rewriting whole files.",
    permission: "fs.write",
    defaultRisk: "medium",
    defaultReversibility: "reversible",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string" },
        oldText: { type: "string", description: "Exact text to find. Must occur exactly once unless replaceAll is true." },
        newText: { type: "string", description: "Replacement text." },
        replaceAll: { type: "boolean" },
      },
      required: ["path", "oldText", "newText"],
      additionalProperties: false,
    },
    classify: (args, ctx) => {
      const path = String(args.path ?? "");
      const oldText = String(args.oldText ?? "");
      const newText = String(args.newText ?? "");
      const target = safePath(path, ctx, policy);
      const checks: CheckSpec[] = [];
      if (target.ok) {
        checks.push({ kind: "file_exists", path: target.rel });
        if (newText) checks.push({ kind: "file_contains", path: target.rel, text: truncate(newText, 400) });
        if (oldText && !newText.includes(oldText)) checks.push({ kind: "file_not_contains", path: target.rel, text: truncate(oldText, 400) });
      }
      return {
        risk: "medium",
        reversibility: "reversible",
        targets: [{ kind: "path", value: path }],
        checks,
        signature: `${path}|edit|${sha256(oldText + "=>" + newText).slice(0, 12)}`,
      };
    },
    async execute(args, ctx) {
      const target = safePath(args.path, ctx, policy);
      if (!target.ok) return { outcome: "error", error: { code: "ESCOPE", message: target.reason! } };
      const oldText = String(args.oldText ?? "");
      const newText = String(args.newText ?? "");
      const replaceAll = args.replaceAll === true;

      let previous: string;
      try {
        previous = await readFile(target.resolved, "utf8");
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        return { outcome: "error", error: { code: e.code === "ENOENT" ? "ENOENT" : "EREAD", message: e.code === "ENOENT" ? `${target.rel} does not exist; use filesystem.write to create it` : e.message } };
      }

      const occurrences = previous.split(oldText).length - 1;
      if (occurrences === 0) {
        return { outcome: "error", error: { code: "ENOTFOUND", message: `oldText was not found in ${target.rel}. Read the file and copy the exact text, including indentation.` } };
      }
      if (occurrences > 1 && !replaceAll) {
        return { outcome: "error", error: { code: "EAMBIGUOUS", message: `oldText occurs ${occurrences} times in ${target.rel}. Add surrounding lines to make it unique, or set replaceAll=true.` } };
      }

      const updated = replaceAll ? previous.split(oldText).join(newText) : previous.replace(oldText, newText);
      try {
        await writeFile(target.resolved, updated, "utf8");
      } catch (err) {
        return { outcome: "error", error: { code: "EWRITE", message: (err as Error).message } };
      }
      const info = await stat(target.resolved);
      return {
        outcome: "success",
        output: { path: target.rel, replacements: replaceAll ? occurrences : 1, bytes: info.size },
        text: `Edited ${target.rel}: replaced ${replaceAll ? occurrences : 1} occurrence(s) (${previous.length} -> ${updated.length} chars)`,
        undo: [{ kind: "fs.restore_file", description: `restore ${target.rel} before the edit`, payload: { path: target.rel, content: previous } }],
        evidence: [{ source: "fs.stat", fact: `${target.rel} is now ${info.size} bytes`, value: info.size, observedAt: new Date().toISOString() }],
        metrics: { bytes: info.size, replacements: replaceAll ? occurrences : 1 },
      };
    },
  };
}
