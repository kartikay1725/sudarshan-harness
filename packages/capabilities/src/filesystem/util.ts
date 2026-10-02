import { createHash } from "node:crypto";
import { extname, relative } from "node:path";
import { resolveScopedPath, type Policy, type ToolContext } from "@sudarshan/core";

export const TEXT_EXTENSIONS = new Set([
  ".txt", ".md", ".markdown", ".json", ".jsonc", ".yaml", ".yml", ".toml", ".ini", ".cfg", ".conf", ".csv", ".tsv",
  ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs", ".py", ".rb", ".go", ".rs", ".java", ".kt", ".c", ".h", ".cpp", ".hpp",
  ".cs", ".php", ".sh", ".bash", ".zsh", ".fish", ".ps1", ".bat", ".html", ".htm", ".css", ".scss", ".sass", ".less",
  ".vue", ".svelte", ".astro", ".xml", ".svg", ".sql", ".graphql", ".prisma", ".env", ".log", ".rst", ".tex", ".r",
  ".swift", ".dart", ".lua", ".pl", ".ex", ".exs", "",
]);

export const MAX_CAPTURE_FOR_UNDO = 2 * 1024 * 1024;
export const MAX_READ_BYTES = 4 * 1024 * 1024;

/** Directories that are noise for an agent and expensive to walk. */
export const SKIP_DIRS = new Set([
  "node_modules", ".git", "dist", ".next", "build", "coverage", ".venv", "__pycache__", ".turbo", ".cache", "target",
]);

export interface SafePath {
  ok: boolean;
  resolved: string;
  rel: string;
  reason?: string;
}

/**
 * Defense in depth. The gate has already scope-checked the declared targets,
 * but a capability never trusts its arguments: every path is re-resolved
 * against policy here and anything outside is refused before touching disk.
 */
export function safePath(rawPath: unknown, ctx: ToolContext, policy: Policy): SafePath {
  if (typeof rawPath !== "string" || rawPath.length === 0) {
    return { ok: false, resolved: "", rel: "", reason: "path must be a non-empty string" };
  }
  const check = resolveScopedPath(rawPath, ctx.workspaceRoot, policy);
  if (!check.ok) return { ok: false, resolved: check.resolved, rel: rawPath, reason: check.reason };
  return { ok: true, resolved: check.resolved, rel: relative(ctx.workspaceRoot, check.resolved) || check.resolved };
}

export function isTextFile(path: string): boolean {
  const ext = extname(path).toLowerCase();
  if (TEXT_EXTENSIONS.has(ext)) return true;
  const base = path.split(/[\\/]/).pop() ?? "";
  return ["makefile", "dockerfile", "license", "readme", "notice", ".gitignore", ".env"].includes(base.toLowerCase());
}

export function looksBinary(buf: Buffer): boolean {
  const sample = buf.subarray(0, Math.min(buf.length, 2048));
  for (const byte of sample) if (byte === 0) return true;
  return false;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}
