export interface ParsedArgs {
  command?: string;
  positionals: string[];
  flags: Record<string, string | boolean | string[]>;
}

const BOOLEAN_FLAGS = new Set([
  "help",
  "version",
  "json",
  "verbose",
  "quiet",
  "recursive",
  "keep",
  "yes",
  "all",
  "force",
  "watch",
]);

const ALIASES: Record<string, string> = {
  w: "workspace",
  m: "model",
  a: "adapter",
  c: "capabilities",
  s: "spec",
  p: "port",
  h: "help",
  v: "version",
  e: "expect",
};

/** A tiny dependency-free argument parser: `--flag value`, `--flag=value`, `-f value`. */
export function parseArgs(argv: string[]): ParsedArgs {
  const out: ParsedArgs = { positionals: [], flags: {} };
  let i = 0;
  if (argv.length > 0 && !argv[0]!.startsWith("-")) {
    out.command = argv[0];
    i = 1;
  }

  for (; i < argv.length; i++) {
    const token = argv[i]!;
    if (token === "--") {
      out.positionals.push(...argv.slice(i + 1));
      break;
    }
    if (token.startsWith("--") || (token.startsWith("-") && token.length > 1 && !/^-\d/.test(token))) {
      const body = token.replace(/^--?/, "");
      const eq = body.indexOf("=");
      const rawName = eq >= 0 ? body.slice(0, eq) : body;
      const name = ALIASES[rawName] ?? rawName;
      const inlineValue = eq >= 0 ? body.slice(eq + 1) : undefined;

      if (inlineValue !== undefined) {
        push(out.flags, name, inlineValue);
        continue;
      }
      if (BOOLEAN_FLAGS.has(name)) {
        out.flags[name] = true;
        continue;
      }
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith("-")) {
        push(out.flags, name, next);
        i++;
      } else {
        out.flags[name] = true;
      }
      continue;
    }
    out.positionals.push(token);
  }
  return out;
}

function push(flags: Record<string, string | boolean | string[]>, name: string, value: string): void {
  const existing = flags[name];
  if (existing === undefined) {
    flags[name] = value;
    return;
  }
  if (Array.isArray(existing)) {
    existing.push(value);
    return;
  }
  flags[name] = [String(existing), value];
}

export function str(flags: ParsedArgs["flags"], name: string): string | undefined {
  const value = flags[name];
  if (Array.isArray(value)) return value[0];
  if (typeof value === "string") return value;
  return undefined;
}

export function bool(flags: ParsedArgs["flags"], name: string): boolean {
  const value = flags[name];
  return value === true || value === "true" || value === "";
}

export function num(flags: ParsedArgs["flags"], name: string): number | undefined {
  const value = str(flags, name);
  if (value === undefined) return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

export function list(flags: ParsedArgs["flags"], name: string): string[] {
  const value = flags[name];
  if (typeof value !== "string" && !Array.isArray(value)) return [];
  const values = Array.isArray(value) ? value : [value];
  return values.flatMap((v) => v.split(",")).map((s) => s.trim()).filter(Boolean);
}
