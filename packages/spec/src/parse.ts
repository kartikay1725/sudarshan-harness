import type { CheckSpec, Policy, RiskLevel } from "@sudarshan/core";
import { mergePolicy } from "@sudarshan/core";
import type { AgentSpec } from "./types.js";
import { EMPTY_SPEC } from "./types.js";
import { parseVerifyBlock, tokenize } from "./verifyDsl.js";

export interface ParsedSpec {
  spec: AgentSpec;
  warnings: string[];
}

const HEADING_ALIASES: Record<string, string[]> = {
  persona: ["persona", "who you are", "identity", "role"],
  rules: ["rules", "constraints", "guardrails", "must", "never"],
  workflow: ["workflow", "process", "steps", "how to work"],
  capabilities: ["capabilities", "tools", "install", "lego", "blocks"],
  permissions: ["permissions", "grants"],
  approval: ["approval", "approvals", "human", "human-in-the-loop"],
  scopes: ["scope", "scopes", "boundary", "boundaries"],
  budgets: ["budget", "budgets", "limits"],
  model: ["model", "provider", "intelligence"],
  verify: ["verify", "verification", "acceptance", "acceptance criteria", "definition of done", "done means"],
};

/**
 * Parse an `agent.md`.
 *
 * Deliberate limitation: a spec can *add* verification checks, *narrow* scopes
 * and *request* capabilities — but it can never widen a scope beyond policy,
 * never grant a permission the operator's policy denies, and never disable
 * verification. If it tries, the attempt lands in `warnings` and is shown in
 * the IDE instead of being honoured.
 */
export function parseAgentSpec(raw: string, path?: string): ParsedSpec {
  const warnings: string[] = [];
  const { frontmatter, body } = splitFrontmatter(raw);

  const spec: AgentSpec = {
    ...structuredClone(EMPTY_SPEC),
    raw,
    path,
    verification: [] as CheckSpec[],
    warnings,
  };

  /* -------- frontmatter -------- */
  if (frontmatter.name) spec.name = String(frontmatter.name);
  if (frontmatter.description) spec.description = String(frontmatter.description);
  if (frontmatter.persona) spec.persona = String(frontmatter.persona);
  spec.capabilities = listOf(frontmatter.capabilities ?? frontmatter.install);
  spec.removeCapabilities = listOf(frontmatter.remove ?? frontmatter.removeCapabilities);
  spec.permissions = listOf(frontmatter.permissions);
  spec.rules.push(...listOf(frontmatter.rules));
  if (frontmatter.approval) {
    const approval = frontmatter.approval;
    if (Array.isArray(approval) || typeof approval === "string") {
      spec.approval.risk = listOf(approval).filter(isRisk) as RiskLevel[];
    } else if (typeof approval === "object") {
      // approval:
      //   risk: [high, critical]
      //   tools: [git.commit]
      const record = approval as Record<string, unknown>;
      spec.approval.risk = listOf(record.risk).filter(isRisk) as RiskLevel[];
      spec.approval.tools = listOf(record.tools ?? record.tool)
        .map((t) => t.replace(/^`|`$/g, "").trim())
        .filter((t) => t.includes("."));
    }
  }
  if (frontmatter.model) {
    const model = typeof frontmatter.model === "string" ? { model: frontmatter.model } : (frontmatter.model as Record<string, unknown>);
    spec.model = {
      adapter: model.adapter ? String(model.adapter) : undefined,
      model: model.model ? String(model.model) : undefined,
      temperature: model.temperature !== undefined ? Number(model.temperature) : undefined,
      maxTokens: model.maxTokens !== undefined ? Number(model.maxTokens) : undefined,
    };
  }
  if (frontmatter.budgets && typeof frontmatter.budgets === "object") {
    spec.budgets = numericPick(frontmatter.budgets as Record<string, unknown>, [
      "maxSteps",
      "maxToolCalls",
      "maxTokens",
      "maxWallClockMs",
      "maxRepeatedActions",
      "maxUnverifiedSteps",
    ]);
  }

  if (frontmatter.scopes && typeof frontmatter.scopes === "object") {
    const sc = frontmatter.scopes as Record<string, unknown>;
    spec.scopes = {
      fsRoots: listOf(sc.fsRoots ?? sc.roots),
      fsDeny: listOf(sc.fsDeny ?? sc.deny),
      allowCommands: listOf(sc.allowCommands),
      denyCommands: listOf(sc.denyCommands),
      allowHosts: listOf(sc.allowHosts),
      denyHosts: listOf(sc.denyHosts),
    };
  }

  /* -------- markdown sections -------- */
  const sections = splitSections(body);
  for (const { heading, lines } of sections) {
    const key = resolveHeading(heading);
    if (!key) continue;
    switch (key) {
      case "persona":
        spec.persona = [spec.persona, lines.join("\n").trim()].filter(Boolean).join("\n\n") || undefined;
        break;
      case "rules":
        spec.rules.push(...bullets(lines));
        break;
      case "workflow":
        spec.workflow.push(...bullets(lines));
        break;
      case "capabilities": {
        const { add, remove } = capabilityLines(lines);
        spec.capabilities.push(...add);
        spec.removeCapabilities.push(...remove);
        break;
      }
      case "permissions":
        spec.permissions.push(...bullets(lines).map((b) => b.replace(/^`|`$/g, "").trim()).filter(Boolean));
        break;
      case "approval":
        for (const bullet of bullets(lines)) {
          const lower = bullet.toLowerCase();
          const risk = (["low", "medium", "high", "critical"] as const).find((r) => lower.includes(r));
          if (risk) {
            if (!spec.approval.risk.includes(risk)) spec.approval.risk.push(risk);
            continue;
          }
          const tool = bullet.match(/`([^`]+)`/)?.[1] ?? bullet.split(/\s+/)[0];
          if (tool && tool.includes(".")) spec.approval.tools.push(tool);
        }
        break;
      case "scopes":
        applyScopeLines(lines, spec, warnings);
        break;
      case "budgets":
        for (const bullet of bullets(lines)) {
          const [k, v] = bullet.split(/[:=]/).map((s) => s.trim());
          const key2 = camel(k ?? "");
          const value = Number(String(v ?? "").replace(/[^\d.]/g, ""));
          if (key2 && Number.isFinite(value)) (spec.budgets as Record<string, number>)[key2] = value;
          else warnings.push(`could not parse budget line: "${bullet}"`);
        }
        break;
      case "model":
        for (const bullet of bullets(lines)) {
          const [k, v] = bullet.split(/[:=]/).map((s) => s.trim());
          const key2 = camel(k ?? "").toLowerCase();
          spec.model = spec.model ?? {};
          if (key2 === "adapter") spec.model.adapter = v;
          else if (key2 === "model" || key2 === "name") spec.model.model = v;
          else if (key2 === "temperature") spec.model.temperature = Number(v);
          else if (key2 === "maxtokens") spec.model.maxTokens = Number(v);
          else warnings.push(`unknown model field: "${bullet}"`);
        }
        break;
      case "verify": {
        const parsed = parseVerifyBlock(lines);
        spec.verification.push(...parsed.checks);
        warnings.push(...parsed.warnings);
        break;
      }
    }
  }

  spec.capabilities = unique(spec.capabilities);
  spec.removeCapabilities = unique(spec.removeCapabilities).filter((c) => !spec.capabilities.includes(c));
  spec.permissions = unique(spec.permissions);
  spec.rules = unique(spec.rules);

  if (spec.removeCapabilities.length && spec.capabilities.length === 0) {
    // nothing to warn about; removal-only specs are valid
  }
  return { spec, warnings };
}

/** Turn a spec into a policy patch. Additive checks, narrowing scopes only. */
export function specToPolicyPatch(spec: AgentSpec, base: Policy): Partial<Policy> {
  const patch: Partial<Policy> = {};

  if (spec.permissions.length > 0) {
    patch.permissions = unique([...base.permissions, ...spec.permissions]);
  }
  if (spec.approval.risk.length > 0 || spec.approval.tools.length > 0) {
    patch.approval = {
      ...base.approval,
      requireForRisk: spec.approval.risk.length > 0 ? spec.approval.risk : base.approval.requireForRisk,
      requireForTools: unique([...base.approval.requireForTools, ...spec.approval.tools]),
    };
  }

  const scopes: Partial<Policy["scopes"]> = {};
  if (spec.scopes.fsRoots?.length) scopes.fsRoots = spec.scopes.fsRoots;
  if (spec.scopes.fsDeny?.length) scopes.fsDeny = unique([...base.scopes.fsDeny, ...spec.scopes.fsDeny]);
  if (spec.scopes.allowCommands?.length || spec.scopes.denyCommands?.length) {
    scopes.shell = {
      ...base.scopes.shell,
      ...(spec.scopes.allowCommands?.length ? { allowCommands: spec.scopes.allowCommands } : {}),
      ...(spec.scopes.denyCommands?.length ? { denyCommands: unique([...(base.scopes.shell.denyCommands ?? []), ...spec.scopes.denyCommands]) } : {}),
    };
  }
  if (spec.scopes.allowHosts?.length || spec.scopes.denyHosts?.length) {
    scopes.net = {
      ...base.scopes.net,
      ...(spec.scopes.allowHosts?.length ? { allowHosts: spec.scopes.allowHosts } : {}),
      ...(spec.scopes.denyHosts?.length ? { denyHosts: unique([...(base.scopes.net.denyHosts ?? []), ...spec.scopes.denyHosts]) } : {}),
    };
  }
  if (Object.keys(scopes).length > 0) patch.scopes = { ...base.scopes, ...scopes } as Policy["scopes"];

  if (Object.keys(spec.budgets).length > 0) patch.budgets = { ...base.budgets, ...spec.budgets };
  if (spec.verification.length > 0) {
    patch.verification = { ...base.verification, expectations: [...base.verification.expectations, ...spec.verification] };
  }
  return patch;
}

export function applySpecToPolicy(spec: AgentSpec, base: Policy): Policy {
  return mergePolicy(base, specToPolicyPatch(spec, base));
}

/* ---------------- helpers ---------------- */

function splitFrontmatter(raw: string): { frontmatter: Record<string, unknown>; body: string } {
  const match = raw.match(/^\uFEFF?---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { frontmatter: {}, body: raw };
  return { frontmatter: parseSimpleYaml(match[1]!), body: raw.slice(match[0].length) };
}

/**
 * A very small YAML subset, parsed by indentation, to arbitrary depth:
 *
 *   - scalars (`key: value`, with bool/number coercion)
 *   - inline lists (`key: [a, b]`)
 *   - block lists (`- item`, including `- key: value` map items)
 *   - nested mappings at any depth (`scopes: > fsRoots: > - .`)
 *
 * That last point matters more than it looks: `scopes` and `approval` are the
 * security-relevant parts of a spec, and a parser that silently flattened them
 * would quietly drop an operator's deny list. Anything this parser cannot
 * represent is a *warning*, never a silent widening.
 */
export function parseSimpleYaml(text: string): Record<string, unknown> {
  interface Line {
    indent: number;
    text: string;
  }
  const lines: Line[] = [];
  for (const rawLine of text.split(/\r?\n/)) {
    const trimmed = rawLine.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    lines.push({ indent: rawLine.match(/^\s*/)?.[0].length ?? 0, text: trimmed });
  }

  let index = 0;
  const peek = (): Line | undefined => lines[index];

  function parseScalarOrInline(value: string): unknown {
    if (value.startsWith("[") && value.endsWith("]")) {
      return value
        .slice(1, -1)
        .split(",")
        .map((v) => coerceScalar(stripQuotes(v.trim())))
        .filter((v) => v !== "");
    }
    return coerceScalar(stripQuotes(value));
  }

  function parseBlock(indent: number): unknown {
    const line = peek();
    if (!line) return [];
    if (line.text.startsWith("- ")) return parseList(line.indent);
    if (line.indent >= indent) return parseMap(line.indent);
    return [];
  }

  function parseList(indent: number): unknown[] {
    const items: unknown[] = [];
    while (index < lines.length) {
      const line = lines[index]!;
      if (line.indent < indent || !line.text.startsWith("- ")) break;
      if (line.indent > indent) {
        index++;
        continue;
      }
      const rest = line.text.slice(2).trim();
      index++;
      if (rest === "") {
        const child = peek();
        items.push(child && child.indent > indent ? parseBlock(child.indent) : null);
        continue;
      }
      const colon = rest.indexOf(":");
      const looksLikeMapItem = colon > 0 && !rest.startsWith("[") && !rest.startsWith('"') && !rest.startsWith("'") && !/\s/.test(rest.slice(0, colon));
      if (looksLikeMapItem) {
        const map: Record<string, unknown> = {};
        const key = camel(rest.slice(0, colon).trim());
        const value = rest.slice(colon + 1).trim();
        if (value === "") {
          const child = peek();
          map[key] = child && child.indent > indent ? parseBlock(child.indent) : [];
        } else {
          map[key] = parseScalarOrInline(value);
        }
        const child = peek();
        if (child && child.indent > indent && !child.text.startsWith("- ")) {
          Object.assign(map, parseMap(child.indent) as Record<string, unknown>);
        }
        items.push(map);
        continue;
      }
      items.push(parseScalarOrInline(rest));
    }
    return items;
  }

  function parseMap(indent: number): Record<string, unknown> {
    const map: Record<string, unknown> = {};
    while (index < lines.length) {
      const line = lines[index]!;
      if (line.indent < indent || line.text.startsWith("- ")) break;
      if (line.indent > indent) {
        // A stray over-indented line: not representable, skip rather than guess.
        index++;
        continue;
      }
      const colon = line.text.indexOf(":");
      if (colon <= 0) {
        index++;
        continue;
      }
      const key = camel(line.text.slice(0, colon).trim());
      const value = line.text.slice(colon + 1).trim();
      index++;
      if (value === "") {
        const child = peek();
        map[key] = child && child.indent > indent ? parseBlock(child.indent) : [];
      } else {
        map[key] = parseScalarOrInline(value);
      }
    }
    return map;
  }

  const root = lines.length ? parseBlock(lines[0]!.indent) : {};
  return (Array.isArray(root) ? {} : root) as Record<string, unknown>;
}

function coerceScalar(value: string): unknown {
  if (value === "true") return true;
  if (value === "false") return false;
  if (value !== "" && !Number.isNaN(Number(value)) && /^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function stripQuotes(value: string): string {
  return value.replace(/^["']|["']$/g, "");
}

interface Section {
  heading: string;
  level: number;
  lines: string[];
}

function splitSections(body: string): Section[] {
  const lines = body.split(/\r?\n/);
  const sections: Section[] = [];
  let current: Section | null = null;
  let inFence = false;

  for (const line of lines) {
    if (/^\s*```/.test(line)) inFence = !inFence;
    const heading = !inFence ? line.match(/^(#{1,6})\s+(.*)$/) : null;
    if (heading) {
      current = { heading: heading[2]!.trim(), level: heading[1]!.length, lines: [] };
      sections.push(current);
      continue;
    }
    if (current) current.lines.push(line);
  }
  return sections;
}

function resolveHeading(heading: string): string | undefined {
  const lower = heading.toLowerCase().replace(/[^a-z0-9\s-]/g, "").trim();
  for (const [key, aliases] of Object.entries(HEADING_ALIASES)) {
    if (aliases.some((alias) => lower === alias || lower.startsWith(`${alias} `) || lower.startsWith(`${alias}:`))) return key;
  }
  return undefined;
}

function bullets(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    const bullet = line.match(/^\s*(?:[-*+]|\d+[.)])\s+(.*)$/);
    if (bullet) {
      const text = bullet[1]!.trim();
      if (text) out.push(text);
      continue;
    }
    if (line.trim() && !line.startsWith(" ")) out.push(line.trim());
  }
  return out;
}

function capabilityLines(lines: string[]): { add: string[]; remove: string[] } {
  const add: string[] = [];
  const remove: string[] = [];
  for (const bullet of bullets(lines)) {
    const tokens = tokenize(bullet.toLowerCase());
    if (tokens[0] === "remove" || tokens[0] === "uninstall" || bullet.trim().startsWith("-")) {
      const name = tokens[tokens[0] === "remove" || tokens[0] === "uninstall" ? 1 : 0];
      if (name) remove.push(normaliseCapabilityName(name));
      continue;
    }
    if (tokens[0] === "install" || tokens[0] === "add") {
      if (tokens[1]) add.push(normaliseCapabilityName(tokens[1]));
      continue;
    }
    const cleaned = bullet.replace(/[`*]/g, "").trim();
    if (cleaned) add.push(normaliseCapabilityName(cleaned.split(/\s+/)[0]!));
  }
  return { add: add.filter(Boolean), remove: remove.filter(Boolean) };
}

function normaliseCapabilityName(name: string): string {
  return name.toLowerCase().replace(/[^a-z0-9-_]/g, "");
}

function applyScopeLines(lines: string[], spec: AgentSpec, warnings: string[]): void {
  for (const bullet of bullets(lines)) {
    const [rawKey, ...rest] = bullet.split(/[:=]/);
    const key = camel((rawKey ?? "").replace(/[`*]/g, "").trim()).toLowerCase();
    const value = rest.join("=").trim();
    if (!value) {
      warnings.push(`could not parse scope line: "${bullet}"`);
      continue;
    }
    const values = value
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((v) => stripQuotes(v.trim()))
      .filter(Boolean);
    switch (key) {
      case "fsroots":
      case "roots":
      case "filesystem":
        spec.scopes.fsRoots = values;
        break;
      case "fsdeny":
      case "deny":
      case "never":
        spec.scopes.fsDeny = values;
        break;
      case "allowcommands":
        spec.scopes.allowCommands = values;
        break;
      case "denycommands":
        spec.scopes.denyCommands = values;
        break;
      case "allowhosts":
        spec.scopes.allowHosts = values;
        break;
      case "denyhosts":
        spec.scopes.denyHosts = values;
        break;
      default:
        warnings.push(`unknown scope field "${rawKey}" — ignored`);
    }
  }
}

function listOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v).trim()).filter(Boolean);
  if (typeof value === "string") {
    return value
      .replace(/^\[|\]$/g, "")
      .split(",")
      .map((v) => stripQuotes(v.trim()))
      .filter(Boolean);
  }
  return [];
}

function isRisk(value: string): boolean {
  return ["low", "medium", "high", "critical"].includes(value.toLowerCase());
}

/**
 * `max steps` -> `maxSteps`, `maxSteps` -> `maxSteps`, `MaxTokens` -> `maxTokens`.
 * Already-camelCased keys keep their internal capitals.
 */
function camel(text: string): string {
  return text
    .replace(/[_-]+/g, " ")
    .trim()
    .split(/\s+/)
    .map((word, i) => {
      if (/[A-Z]/.test(word)) return i === 0 ? word.charAt(0).toLowerCase() + word.slice(1) : word;
      return i === 0 ? word.toLowerCase() : word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    })
    .join("");
}

function numericPick(source: Record<string, unknown>, keys: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const lowered: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(source)) lowered[k.toLowerCase()] = v;
  for (const key of keys) {
    const raw = source[key] ?? lowered[key.toLowerCase()];
    const value = Number(raw);
    if (raw !== undefined && Number.isFinite(value) && value > 0) out[key] = value;
  }
  return out;
}

function unique<T>(items: T[]): T[] {
  return [...new Set(items)];
}
