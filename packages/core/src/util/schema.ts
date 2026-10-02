import type { JsonSchema } from "../types.js";

export interface SchemaIssue {
  path: string;
  message: string;
}

/**
 * A deliberately small JSON-Schema subset validator.
 *
 * The gate validates arguments *before* execution so a malformed request is
 * blocked at the boundary instead of blowing up inside a capability (where the
 * failure could be partially applied and hard to verify).
 */
export function validateArgs(schema: JsonSchema, args: Record<string, unknown>): SchemaIssue[] {
  const issues: SchemaIssue[] = [];
  walk(schema, args, "", issues);
  return issues;
}

function walk(schema: any, value: unknown, path: string, issues: SchemaIssue[]): void {
  if (!schema || typeof schema !== "object") return;

  if (schema.type) {
    if (!typeMatches(schema.type, value)) {
      issues.push({ path: path || "(root)", message: `expected ${String(schema.type)}, got ${describe(value)}` });
      return;
    }
  }

  if (Array.isArray(schema.enum) && !schema.enum.includes(value as never)) {
    issues.push({ path: path || "(root)", message: `must be one of ${schema.enum.join(" | ")}` });
  }

  if (schema.type === "object" || schema.properties) {
    const obj = (value ?? {}) as Record<string, unknown>;
    const required: string[] = Array.isArray(schema.required) ? schema.required : [];
    for (const key of required) {
      if (obj[key] === undefined || obj[key] === null || obj[key] === "") {
        issues.push({ path: join(path, key), message: "required property is missing" });
      }
    }
    const properties = (schema.properties ?? {}) as Record<string, any>;
    for (const [key, sub] of Object.entries(properties)) {
      if (obj[key] === undefined) continue;
      walk(sub, obj[key], join(path, key), issues);
    }
    if (schema.additionalProperties === false) {
      for (const key of Object.keys(obj)) {
        if (!(key in properties)) {
          issues.push({ path: join(path, key), message: "unexpected property" });
        }
      }
    }
  }

  if ((schema.type === "array" || schema.items) && Array.isArray(value)) {
    const items = schema.items;
    if (items && !Array.isArray(items)) {
      value.forEach((entry, i) => walk(items, entry, `${path || "(root)"}[${i}]`, issues));
    }
    if (typeof schema.minItems === "number" && value.length < schema.minItems) {
      issues.push({ path: path || "(root)", message: `needs at least ${schema.minItems} items` });
    }
  }

  if (typeof value === "string") {
    if (typeof schema.minLength === "number" && value.length < schema.minLength) {
      issues.push({ path: path || "(root)", message: `must be at least ${schema.minLength} characters` });
    }
    if (typeof schema.maxLength === "number" && value.length > schema.maxLength) {
      issues.push({ path: path || "(root)", message: `must be at most ${schema.maxLength} characters` });
    }
    if (typeof schema.pattern === "string" && !new RegExp(schema.pattern).test(value)) {
      issues.push({ path: path || "(root)", message: `must match /${schema.pattern}/` });
    }
  }

  if (typeof value === "number") {
    if (typeof schema.minimum === "number" && value < schema.minimum) {
      issues.push({ path: path || "(root)", message: `must be >= ${schema.minimum}` });
    }
    if (typeof schema.maximum === "number" && value > schema.maximum) {
      issues.push({ path: path || "(root)", message: `must be <= ${schema.maximum}` });
    }
  }
}

function join(path: string, key: string): string {
  return path ? `${path}.${key}` : key;
}

function typeMatches(type: string | string[], value: unknown): boolean {
  const types = Array.isArray(type) ? type : [type];
  return types.some((t) => {
    switch (t) {
      case "string":
        return typeof value === "string";
      case "number":
      case "integer":
        return typeof value === "number" && (t === "number" || Number.isInteger(value));
      case "boolean":
        return typeof value === "boolean";
      case "array":
        return Array.isArray(value);
      case "object":
        return !!value && typeof value === "object" && !Array.isArray(value);
      case "null":
        return value === null;
      default:
        return true;
    }
  });
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
