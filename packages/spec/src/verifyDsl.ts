import type { CheckSpec } from "@sudarshan/core";

export interface ParseResult {
  checks: CheckSpec[];
  warnings: string[];
}

/**
 * The `## Verify` DSL.
 *
 * These lines are the *only* way a specification can add acceptance criteria.
 * Every form maps to a deterministic probe against the real system:
 *
 *   file_exists <path>
 *   file_absent <path>
 *   dir_exists <path>
 *   file_contains <path> "<text>"        or  file_contains <path> /<regex>/
 *   file_not_contains <path> "<text>"
 *   file_hash <path> <sha256>
 *   file_size <path> min=<n> max=<n>
 *   glob_count <pattern> min=<n> max=<n>
 *   command <command line> exit=<n> stdout="<text>"
 *   http <url> status=<n> contains="<text>"
 *
 * A markdown spec can therefore *describe* an agent, but it cannot describe a
 * permission it does not have, and it cannot weaken the Harness: verification
 * lines only ever add checks.
 */
export function parseVerifyBlock(lines: string[]): ParseResult {
  const checks: CheckSpec[] = [];
  const warnings: string[] = [];

  for (const rawLine of lines) {
    const line = rawLine.replace(/^[-*+]\s*/, "").replace(/^\d+[.)]\s*/, "").trim();
    if (!line || line.startsWith("#")) continue;
    // Markdown fences are how people naturally wrap a verify block; they are
    // presentation, not directives.
    if (/^(```+|~~~+)/.test(line)) continue;

    const tokens = tokenize(line);
    const kind = tokens[0]?.toLowerCase();
    if (!kind) continue;

    switch (kind) {
      case "file_exists":
        if (tokens[1]) checks.push({ kind: "file_exists", path: tokens[1] });
        else warnings.push(`file_exists needs a path: "${line}"`);
        break;
      case "file_absent":
        if (tokens[1]) checks.push({ kind: "file_absent", path: tokens[1] });
        else warnings.push(`file_absent needs a path: "${line}"`);
        break;
      case "dir_exists":
        if (tokens[1]) checks.push({ kind: "dir_exists", path: tokens[1] });
        else warnings.push(`dir_exists needs a path: "${line}"`);
        break;
      case "file_contains":
      case "file_not_contains": {
        const path = tokens[1];
        const pattern = tokens.slice(2).join(" ");
        if (!path || !pattern) {
          warnings.push(`${kind} needs <path> and a quoted text or /regex/: "${line}"`);
          break;
        }
        const regex = pattern.startsWith("/") && pattern.endsWith("/") && pattern.length > 2 ? pattern.slice(1, -1) : undefined;
        const text = regex ? undefined : pattern.replace(/^"|"$/g, "");
        checks.push({ kind, path, ...(regex ? { regex } : { text }) } as CheckSpec);
        break;
      }
      case "file_hash":
        if (tokens[1] && tokens[2]) checks.push({ kind: "file_hash", path: tokens[1], sha256: tokens[2] });
        else warnings.push(`file_hash needs <path> <sha256>: "${line}"`);
        break;
      case "file_size": {
        const path = tokens[1];
        const opts = parseKv(tokens.slice(2));
        if (!path) {
          warnings.push(`file_size needs a path: "${line}"`);
          break;
        }
        checks.push({ kind: "file_size", path, min: num(opts.min), max: num(opts.max) });
        break;
      }
      case "glob_count": {
        const pattern = tokens[1];
        const opts = parseKv(tokens.slice(2));
        if (!pattern) {
          warnings.push(`glob_count needs a pattern: "${line}"`);
          break;
        }
        checks.push({ kind: "glob_count", pattern, min: num(opts.min) ?? 1, max: num(opts.max) });
        break;
      }
      case "command": {
        const kv = parseKv(tokens.slice(1));
        const commandTokens = tokens.slice(1).filter((t) => !t.includes("="));
        const commandLine = commandTokens.join(" ");
        if (!commandLine) {
          warnings.push(`command needs a command line: "${line}"`);
          break;
        }
        const [command, ...args] = splitCommand(commandLine);
        checks.push({
          kind: "command",
          command,
          args,
          expectExit: num(kv.exit) ?? 0,
          expectStdout: kv.stdout ?? kv.contains,
          cwd: kv.cwd,
        });
        break;
      }
      case "http": {
        const url = tokens[1];
        const kv = parseKv(tokens.slice(2));
        if (!url) {
          warnings.push(`http needs a URL: "${line}"`);
          break;
        }
        checks.push({ kind: "http", url, expectStatus: num(kv.status), expectBodyContains: kv.contains ?? kv.body });
        break;
      }
      case "json_schema":
        warnings.push(`json_schema cannot be expressed in agent.md yet: "${line}"`);
        break;
      default:
        warnings.push(`unknown verification directive "${kind}" — ignored: "${line}"`);
    }
  }

  return { checks, warnings };
}

/** Split a line into tokens, keeping "quoted strings" together. */
export function tokenize(line: string): string[] {
  const out: string[] = [];
  let current = "";
  let quote: string | null = null;
  for (let i = 0; i < line.length; i++) {
    const c = line[i]!;
    if (quote) {
      if (c === quote) {
        out.push(current);
        current = "";
        quote = null;
      } else {
        current += c;
      }
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === " " || c === "\t") {
      if (current) {
        out.push(current);
        current = "";
      }
      continue;
    }
    current += c;
  }
  if (current) out.push(current);
  return out;
}

function parseKv(tokens: string[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const token of tokens) {
    const idx = token.indexOf("=");
    if (idx <= 0) continue;
    out[token.slice(0, idx).toLowerCase()] = token.slice(idx + 1).replace(/^"|"$/g, "");
  }
  return out;
}

function num(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/** `"npm test -- --run"` -> ["npm", "test", "--", "--run"] */
function splitCommand(commandLine: string): string[] {
  return tokenize(commandLine);
}
