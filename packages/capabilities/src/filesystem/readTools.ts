import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { join, relative } from "node:path";
import { globMatch, truncate, type Policy, type ToolDefinition, type ToolResult } from "@sudarshan/core";
import { MAX_READ_BYTES, SKIP_DIRS, isTextFile, looksBinary, safePath } from "./util.js";

export function listTool(policy: Policy): ToolDefinition {
  return {
    name: "filesystem.list",
    description: "List a directory's entries with sizes. Use it to orient yourself before acting.",
    permission: "fs.list",
    defaultRisk: "low",
    defaultReversibility: "reversible",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "Directory to list, relative to the workspace root. Defaults to the root." },
        recursive: { type: "boolean", description: "Recurse into subdirectories (skips node_modules, .git, dist)." },
        pattern: { type: "string", description: "Optional glob filter on relative paths, e.g. **/*.ts" },
        limit: { type: "number", description: "Maximum entries to return (default 500, max 5000)." },
      },
      additionalProperties: false,
    },
    classify: (args) => ({
      risk: "low",
      reversibility: "reversible",
      targets: [{ kind: "path", value: String(args.path ?? ".") }],
    }),
    async execute(args, ctx): Promise<ToolResult> {
      const target = safePath(args.path ?? ".", ctx, policy);
      if (!target.ok) return { outcome: "error", error: { code: "ESCOPE", message: target.reason! } };
      const limit = Math.min(Number(args.limit ?? 500) || 500, 5000);
      const recursive = args.recursive === true;
      const pattern = typeof args.pattern === "string" ? args.pattern : undefined;
      const entries: string[] = [];

      async function walk(dir: string): Promise<void> {
        if (entries.length >= limit) return;
        let list;
        try {
          list = await readdir(dir, { withFileTypes: true });
        } catch (err) {
          throw new Error(`cannot list ${relative(ctx.workspaceRoot, dir)}: ${(err as Error).message}`);
        }
        for (const entry of list.sort((a, b) => a.name.localeCompare(b.name))) {
          if (entries.length >= limit) return;
          const full = join(dir, entry.name);
          const rel = relative(ctx.workspaceRoot, full);
          if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            if (!pattern) entries.push(`${rel}/`);
            if (recursive) await walk(full);
          } else {
            if (pattern && !globMatch(pattern, rel)) continue;
            let size = 0;
            try {
              size = (await stat(full)).size;
            } catch {
              /* ignore */
            }
            entries.push(`${rel} (${size}B)`);
          }
        }
      }

      try {
        await walk(target.resolved);
      } catch (err) {
        return { outcome: "error", error: { code: "ELIST", message: (err as Error).message } };
      }
      ctx.recordEvidence({ source: "fs.readdir", fact: `${entries.length} entries under ${target.rel}`, observedAt: new Date().toISOString() });
      return {
        outcome: "success",
        output: { path: target.rel, count: entries.length, entries },
        text: entries.length === 0 ? `${target.rel}/ is empty` : `${target.rel}/ (${entries.length} entries)\n${entries.join("\n")}`,
        metrics: { entries: entries.length },
      };
    },
  };
}

export function readTool(policy: Policy): ToolDefinition {
  return {
    name: "filesystem.read",
    description: "Read a text file's contents with line numbers. Binary files return metadata only.",
    permission: "fs.read",
    defaultRisk: "low",
    defaultReversibility: "reversible",
    parameters: {
      type: "object",
      properties: {
        path: { type: "string", description: "File path relative to the workspace root." },
        offset: { type: "number", description: "First line to return (1-based)." },
        limit: { type: "number", description: "Maximum number of lines to return (default 2000)." },
      },
      required: ["path"],
      additionalProperties: false,
    },
    classify: (args) => ({
      risk: "low",
      reversibility: "reversible",
      targets: [{ kind: "path", value: String(args.path ?? "") }],
      checks: [{ kind: "file_exists", path: String(args.path ?? "") }],
    }),
    async execute(args, ctx): Promise<ToolResult> {
      const target = safePath(args.path, ctx, policy);
      if (!target.ok) return { outcome: "error", error: { code: "ESCOPE", message: target.reason! } };
      const maxBytes = Number(ctx.config.maxReadBytes ?? MAX_READ_BYTES);
      try {
        const info = await stat(target.resolved);
        if (info.isDirectory()) {
          return { outcome: "error", error: { code: "EISDIR", message: `${target.rel} is a directory; use filesystem.list` } };
        }
        const buf = await readFile(target.resolved);
        const sha = createHash("sha256").update(buf).digest("hex");
        if (looksBinary(buf) || (!isTextFile(target.resolved) && looksBinary(buf))) {
          return {
            outcome: "success",
            output: { path: target.rel, binary: true, size: buf.byteLength, sha256: sha },
            text: `${target.rel} is binary (${buf.byteLength} bytes, sha256 ${sha.slice(0, 12)}...). Content not shown.`,
            metrics: { bytes: buf.byteLength },
          };
        }
        const lines = buf.toString("utf8").split("\n");
        const offset = Math.max(1, Number(args.offset ?? 1) || 1);
        const limit = Math.min(Number(args.limit ?? 2000) || 2000, 20000);
        const slice = lines.slice(offset - 1, offset - 1 + limit);
        const numbered = slice.map((line, i) => `${String(offset + i).padStart(5, " ")}| ${line}`).join("\n");
        return {
          outcome: "success",
          output: { path: target.rel, size: buf.byteLength, sha256: sha, lines: lines.length },
          text: `${target.rel} (${lines.length} lines, ${buf.byteLength}B, sha256 ${sha.slice(0, 12)}...)\n${truncate(numbered, maxBytes)}`,
          evidence: [{ source: "fs.readFile", fact: `${buf.byteLength} bytes, sha256=${sha.slice(0, 16)}`, observedAt: new Date().toISOString() }],
          metrics: { bytes: buf.byteLength, lines: lines.length },
        };
      } catch (err) {
        const e = err as NodeJS.ErrnoException;
        return {
          outcome: "error",
          error: { code: e.code === "ENOENT" ? "ENOENT" : "EREAD", message: e.code === "ENOENT" ? `${target.rel} does not exist` : e.message },
        };
      }
    },
  };
}

export function searchTool(policy: Policy): ToolDefinition {
  return {
    name: "filesystem.search",
    description: "Search file contents for a literal string or regex. Returns matching paths with a snippet.",
    permission: "fs.read",
    defaultRisk: "low",
    defaultReversibility: "reversible",
    parameters: {
      type: "object",
      properties: {
        pattern: { type: "string", description: "Regex (without delimiters) or literal text to find." },
        literal: { type: "boolean", description: "Treat pattern as literal text instead of a regex." },
        path: { type: "string", description: "Directory to search in. Defaults to the workspace root." },
        filePattern: { type: "string", description: "Optional glob filter on relative file paths, e.g. **/*.ts" },
        limit: { type: "number", description: "Maximum matches to return (default 50, max 500)." },
      },
      required: ["pattern"],
      additionalProperties: false,
    },
    classify: (args) => ({
      risk: "low",
      reversibility: "reversible",
      targets: [{ kind: "path", value: String(args.path ?? ".") }],
    }),
    async execute(args, ctx): Promise<ToolResult> {
      const root = safePath(args.path ?? ".", ctx, policy);
      if (!root.ok) return { outcome: "error", error: { code: "ESCOPE", message: root.reason! } };
      const literal = args.literal === true;
      let rx: RegExp;
      try {
        rx = literal ? new RegExp(escapeRegExp(String(args.pattern)), "i") : new RegExp(String(args.pattern), "im");
      } catch (err) {
        return { outcome: "error", error: { code: "EBADREGEX", message: (err as Error).message } };
      }
      const limit = Math.min(Number(args.limit ?? 50) || 50, 500);
      const filePattern = typeof args.filePattern === "string" ? args.filePattern : undefined;
      const matches: Array<{ file: string; line: number; text: string }> = [];

      async function walk(dir: string): Promise<void> {
        if (matches.length >= limit) return;
        let entries;
        try {
          entries = await readdir(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          if (matches.length >= limit) return;
          const full = join(dir, entry.name);
          const rel = relative(ctx.workspaceRoot, full);
          if (entry.isDirectory()) {
            if (SKIP_DIRS.has(entry.name)) continue;
            await walk(full);
            continue;
          }
          if (filePattern && !globMatch(filePattern, rel)) continue;
          if (!isTextFile(full)) continue;
          let content: string;
          try {
            const info = await stat(full);
            if (info.size > MAX_READ_BYTES) continue;
            content = await readFile(full, "utf8");
          } catch {
            continue;
          }
          const lines = content.split("\n");
          for (let i = 0; i < lines.length; i++) {
            if (rx.test(lines[i]!)) {
              matches.push({ file: rel, line: i + 1, text: truncate(lines[i]!.trim(), 240) });
              if (matches.length >= limit) return;
            }
            rx.lastIndex = 0;
          }
        }
      }

      await walk(root.resolved);
      return {
        outcome: "success",
        output: { count: matches.length, matches },
        text: matches.length === 0
          ? `No matches for /${args.pattern}/ under ${root.rel}`
          : `${matches.length} match(es):\n${matches.map((m) => `${m.file}:${m.line}: ${m.text}`).join("\n")}`,
        metrics: { matches: matches.length },
      };
    },
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
