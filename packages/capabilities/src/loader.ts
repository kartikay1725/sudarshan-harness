import { readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { Capability, Policy } from "@sudarshan/core";
import { validateCapability } from "@sudarshan/core";

export interface LoadedCapability {
  capability: Capability;
  source: string;
}

/**
 * Capabilities are not compiled into the Harness. They are files in a directory
 * — the workspace's `.sudarshan/capabilities/`, a user directory, or (later) a
 * marketplace download.
 *
 * A module may export:
 *   - a `Capability` object                     (default or named `capability`)
 *   - a factory `(policy: Policy) => Capability` (default or named `createCapability`)
 *
 * Whatever the origin, the loaded capability is validated against the same
 * contract and then runs behind the same gate as a builtin. Origin grants no
 * trust.
 */
export async function loadCapabilitiesFromDirectory(dir: string, policy: Policy): Promise<LoadedCapability[]> {
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const out: LoadedCapability[] = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    const ext = extname(entry.name).toLowerCase();
    if (entry.isDirectory()) {
      // A directory capability: look for index.{ts,js,mjs}
      const nested = await loadCapabilitiesFromDirectory(join(dir, entry.name), policy);
      out.push(...nested);
      continue;
    }
    if (![".ts", ".mts", ".js", ".mjs"].includes(ext)) continue;
    const full = join(dir, entry.name);
    try {
      const mod = (await import(pathToFileURL(full).href)) as Record<string, unknown>;
      const candidate = pickCandidate(mod);
      if (!candidate) continue;
      const capability = typeof candidate === "function" ? await (candidate as (p: Policy) => Capability | Promise<Capability>)(policy) : (candidate as Capability);
      validateCapability(capability);
      out.push({ capability, source: full });
    } catch (err) {
      // A broken capability must not take the Harness down. It is skipped and
      // reported; the security boundary is unaffected.
      out.push({
        capability: {
          id: `broken-${entry.name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}`,
          name: `Failed to load ${entry.name}`,
          version: "0.0.0",
          description: `Load error: ${err instanceof Error ? err.message : String(err)}`,
          permissions: [],
          tools: [
            {
              name: `broken-${entry.name.replace(/[^a-z0-9]/gi, "-").toLowerCase()}.unavailable`,
              description: "This capability failed to load and provides no tools.",
              permission: "none",
              defaultRisk: "low",
              defaultReversibility: "reversible",
              parameters: { type: "object", properties: {}, additionalProperties: false },
              async execute() {
                return { outcome: "error", error: { code: "ELOAD", message: "capability failed to load" } };
              },
            },
          ],
        },
        source: full,
      });
    }
  }
  return out;
}

function pickCandidate(mod: Record<string, unknown>): unknown {
  const named = mod.capability ?? mod.createCapability ?? mod.default;
  if (named) return named;
  const exported = Object.values(mod).find((v) => isCapabilityLike(v) || typeof v === "function");
  return exported;
}

function isCapabilityLike(value: unknown): boolean {
  return !!value && typeof value === "object" && "id" in (value as object) && "tools" in (value as object);
}
