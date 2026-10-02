import type { Capability, CapabilityHealth, ToolContext, ToolDefinition } from "../types.js";
import { EventBus } from "../events/bus.js";

export interface InstalledCapability {
  capability: Capability;
  enabled: boolean;
  installedAt: string;
  source: "builtin" | "workspace" | "marketplace" | "generated";
  health?: CapabilityHealth;
}

/**
 * The capability registry is the LEGO box.
 *
 * Rules encoded here:
 *  - The Harness core never decides which tools exist; capabilities are
 *    installed and removed by the user (or by agent.md).
 *  - Removing a capability removes its tools from the model's view *and* from
 *    the authorization gate. A tool that is not installed cannot be called,
 *    even if the model hallucinates its name.
 *  - Whatever the origin (builtin, workspace, marketplace, generated from a
 *    .md spec), an installed capability runs under the same gate.
 */
export class CapabilityRegistry {
  private installed = new Map<string, InstalledCapability>();

  constructor(private bus?: EventBus) {}

  install(capability: Capability, opts: { source?: InstalledCapability["source"]; enabled?: boolean } = {}): void {
    validateCapability(capability);
    const existing = this.installed.get(capability.id);
    this.installed.set(capability.id, {
      capability,
      enabled: opts.enabled ?? existing?.enabled ?? true,
      installedAt: new Date().toISOString(),
      source: opts.source ?? existing?.source ?? "builtin",
      health: existing?.health,
    });
    this.bus?.emit("capability.changed", { action: existing ? "updated" : "installed", capabilityId: capability.id });
  }

  installAll(capabilities: Capability[], opts: { source?: InstalledCapability["source"] } = {}): void {
    for (const c of capabilities) this.install(c, opts);
  }

  remove(id: string): boolean {
    const existed = this.installed.delete(id);
    if (existed) this.bus?.emit("capability.changed", { action: "removed", capabilityId: id });
    return existed;
  }

  setEnabled(id: string, enabled: boolean): boolean {
    const entry = this.installed.get(id);
    if (!entry) return false;
    entry.enabled = enabled;
    this.bus?.emit("capability.changed", { action: enabled ? "enabled" : "disabled", capabilityId: id });
    return true;
  }

  has(id: string): boolean {
    return this.installed.has(id);
  }

  isEnabled(id: string): boolean {
    return this.installed.get(id)?.enabled === true;
  }

  get(id: string): InstalledCapability | undefined {
    return this.installed.get(id);
  }

  list(): InstalledCapability[] {
    return [...this.installed.values()].sort((a, b) => a.capability.id.localeCompare(b.capability.id));
  }

  /** Only enabled capabilities contribute tools. */
  tools(): ToolDefinition[] {
    const out: ToolDefinition[] = [];
    for (const entry of this.list()) {
      if (!entry.enabled) continue;
      out.push(...entry.capability.tools);
    }
    return out;
  }

  findTool(name: string): { tool: ToolDefinition; capability: InstalledCapability } | undefined {
    for (const entry of this.list()) {
      const tool = entry.capability.tools.find((t) => t.name === name);
      if (tool) return { tool, capability: entry };
    }
    return undefined;
  }

  /** Permission -> capability ids that provide it. Used by the IDE's security view. */
  permissionIndex(): Record<string, string[]> {
    const index: Record<string, string[]> = {};
    for (const entry of this.list()) {
      for (const p of entry.capability.permissions) {
        index[p] = [...(index[p] ?? []), entry.capability.id];
      }
    }
    return index;
  }

  async healthCheck(ctxFactory: (capabilityId: string) => ToolContext): Promise<Record<string, CapabilityHealth>> {
    const out: Record<string, CapabilityHealth> = {};
    for (const entry of this.list()) {
      if (!entry.capability.healthCheck) {
        out[entry.capability.id] = { ok: true, detail: "no health check declared" };
        continue;
      }
      try {
        const health = await entry.capability.healthCheck(ctxFactory(entry.capability.id));
        entry.health = health;
        out[entry.capability.id] = health;
      } catch (err) {
        const health = { ok: false, detail: err instanceof Error ? err.message : String(err) };
        entry.health = health;
        out[entry.capability.id] = health;
      }
    }
    return out;
  }
}

export function validateCapability(capability: Capability): void {
  if (!capability.id || !/^[a-z0-9][a-z0-9-_]*$/i.test(capability.id)) {
    throw new Error(`Invalid capability id: ${capability.id}`);
  }
  if (!capability.tools?.length) {
    throw new Error(`Capability ${capability.id} declares no tools`);
  }
  const seen = new Set<string>();
  for (const tool of capability.tools) {
    if (!tool.name.startsWith(`${capability.id}.`)) {
      throw new Error(`Tool ${tool.name} must be namespaced under capability id "${capability.id}."`);
    }
    if (seen.has(tool.name)) throw new Error(`Duplicate tool name in capability ${capability.id}: ${tool.name}`);
    seen.add(tool.name);
    if (!tool.permission) throw new Error(`Tool ${tool.name} must declare a required permission`);
    if (typeof tool.execute !== "function") throw new Error(`Tool ${tool.name} must implement execute()`);
    if (!tool.parameters || typeof tool.parameters !== "object") {
      throw new Error(`Tool ${tool.name} must declare a JSON schema for parameters`);
    }
  }
}

/** Helper for capability authors. */
export function defineCapability(capability: Capability): Capability {
  validateCapability(capability);
  return capability;
}
