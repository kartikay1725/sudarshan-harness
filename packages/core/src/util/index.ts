import { createHash, randomUUID } from "node:crypto";

/** Deterministic, key-sorted JSON. Two equal objects always stringify identically. */
export function canonicalJson(value: unknown): string {
  return JSON.stringify(sortDeep(value));
}

function sortDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortDeep);
  if (value && typeof value === "object") {
    const src = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(src).sort()) {
      if (src[key] === undefined) continue;
      out[key] = sortDeep(src[key]);
    }
    return out;
  }
  return value;
}

export function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

export function shortHash(input: string, len = 10): string {
  return sha256(input).slice(0, len);
}

export function newId(prefix: string): string {
  return `${prefix}_${randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

export function nowIso(): string {
  return new Date().toISOString();
}

/** Glob-ish matcher supporting `*`, `**` and `?`. Used for policy + scope matching. */
export function globMatch(pattern: string, value: string): boolean {
  if (pattern === value) return true;
  if (pattern === "*") return true;
  const rx = globToRegExp(pattern);
  return rx.test(value);
}

export function globToRegExp(pattern: string): RegExp {
  let out = "^";
  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i]!;
    if (c === "*") {
      if (pattern[i + 1] === "*") {
        out += ".*";
        i++;
        if (pattern[i + 1] === "/") i++;
      } else {
        out += "[^/]*";
      }
    } else if (c === "?") {
      out += "[^/]";
    } else if (".+^${}()|[]\\".includes(c)) {
      out += "\\" + c;
    } else {
      out += c;
    }
  }
  out += "$";
  return new RegExp(out);
}

/**
 * Redact values that look like secrets before they reach logs, the audit trail
 * or a model prompt. Deliberately aggressive: provenance must not leak keys.
 */
const SECRET_PATTERNS: Array<{ rx: RegExp; label: string }> = [
  { rx: /\b(sk|pk|rk|ghp|gho|ghs|ghu|github_pat)[-_][A-Za-z0-9_-]{10,}\b/g, label: "[REDACTED_API_KEY]" },
  { rx: /\b(?:api[_-]?key|apikey|token|secret|password|passwd|pwd|authorization)\b\s*[:=]\s*["']?[^\s"',;]{6,}/gi, label: "" },
  { rx: /-----BEGIN [A-Z ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z ]*PRIVATE KEY-----/g, label: "[REDACTED_PRIVATE_KEY]" },
  { rx: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, label: "[REDACTED_EMAIL]" },
];

export function redact(text: string): string {
  let out = text;
  for (const { rx, label } of SECRET_PATTERNS) {
    out = out.replace(rx, (match) => {
      if (!label) {
        // key=value style: keep the key name, drop the value
        const idx = match.search(/[:=]\s*["']?[^\s"',;]{6,}/);
        return idx >= 0 ? `${match.slice(0, idx)}=[REDACTED]` : "[REDACTED]";
      }
      return label;
    });
  }
  return out;
}

export function redactDeep(value: unknown): unknown {
  if (typeof value === "string") return redact(value);
  if (Array.isArray(value)) return value.map(redactDeep);
  if (value && typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (/token|secret|password|api[_-]?key|authorization|cookie/i.test(k)) {
        out[k] = "[REDACTED]";
      } else {
        out[k] = redactDeep(v);
      }
    }
    return out;
  }
  return value;
}

export function clamp(n: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, n));
}

export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(new Error("aborted"));
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    function onAbort() {
      clearTimeout(t);
      reject(new Error("aborted"));
    }
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

export function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n…[truncated ${text.length - max} chars]`;
}
