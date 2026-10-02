import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import {
  Harness,
  defaultPolicy,
  mergePolicy,
  type BudgetPolicy,
  type Policy,
} from "@sudarshan/core";
import {
  ADAPTER_CATALOG,
  createAdapter,
  defaultAdapter,
  type AdapterSpec,
} from "@sudarshan/adapters";
import {
  builtinCapability,
  builtinCapabilities,
  loadCapabilitiesFromDirectory,
  PRESETS,
} from "@sudarshan/capabilities";
import { findAgentSpec, loadAgentSpec, resolveAgent, type AgentSpec } from "@sudarshan/spec";

export const CONFIG_FILENAMES = ["sudarshan.config.json", ".sudarshan/config.json", ".sudarshan/config.jsonc"];
export const DEFAULT_CAPABILITY_DIR = ".sudarshan/capabilities";
export const DEFAULT_ENABLED = ["filesystem", "terminal", "git"];

export interface CapabilityConfig {
  /** Builtin capability ids to install. `["*"]` installs everything. */
  install?: string[];
  /** Capabilities to switch on. Defaults to the coding preset. */
  enabled?: string[];
  /** Capabilities to install but leave switched off. */
  disabled?: string[];
  /** Directory scanned for user/marketplace capabilities. */
  workspaceDir?: string;
  /** Per-capability configuration surfaced to tools via ctx.config. */
  config?: Record<string, Record<string, unknown>>;
  /** A named preset from @sudarshan/capabilities. */
  preset?: keyof typeof PRESETS | string;
}

export interface HarnessBuildConfig {
  workspaceRoot?: string;
  adapter?: AdapterSpec;
  model?: string;
  capabilities?: CapabilityConfig;
  specPath?: string;
  /** Operator policy overrides. agent.md can narrow these but never widen them. */
  policy?: Partial<Policy>;
  budgets?: Partial<BudgetPolicy>;
  auditPath?: string;
  verifier?: { enabled?: boolean; adapter?: AdapterSpec; model?: string };
  env?: NodeJS.ProcessEnv;
}

export interface BuiltHarness {
  harness: Harness;
  spec?: AgentSpec;
  policy: Policy;
  config: Required<Pick<HarnessBuildConfig, "workspaceRoot">> & HarnessBuildConfig;
  adapterId: string;
  model: string;
  warnings: string[];
  capabilities: Array<{ id: string; enabled: boolean; source: string; tools: string[]; permissions: string[]; missingPermissions: string[] }>;
}

/**
 * Turn a configuration into a running Harness.
 *
 * Order of precedence, lowest to highest:
 *   built-in default policy  <  config file  <  operator overrides  <  agent.md
 *
 * agent.md sits last but can only *narrow*: it adds verification, tightens
 * scopes and requests capabilities. It cannot remove protected paths or grant
 * itself a permission the operator did not give.
 */
export async function buildHarness(config: HarnessBuildConfig = {}): Promise<BuiltHarness> {
  const env = config.env ?? process.env;
  const warnings: string[] = [];
  const workspaceRoot = resolve(config.workspaceRoot ?? process.cwd());

  /* -------- policy -------- */
  let policy = defaultPolicy(workspaceRoot);
  if (config.policy) policy = mergePolicy(policy, config.policy);
  if (config.budgets) policy = { ...policy, budgets: { ...policy.budgets, ...config.budgets } };

  /* -------- agent.md -------- */
  let spec: AgentSpec | undefined;
  if (config.specPath) {
    try {
      spec = await loadAgentSpec(resolve(workspaceRoot, config.specPath));
    } catch (err) {
      warnings.push(`could not load spec ${config.specPath}: ${(err as Error).message}`);
    }
  } else {
    spec = await findAgentSpec(workspaceRoot);
  }
  if (spec) {
    const resolved = resolveAgent(policy, spec);
    policy = resolved.policy;
    warnings.push(...spec.warnings.map((w) => `agent.md: ${w}`));
  }

  /* -------- model -------- */
  const adapterSpec: AdapterSpec | undefined = config.adapter ?? (spec?.model?.adapter ? { kind: spec.model.adapter as AdapterSpec["kind"], model: spec.model?.model } : undefined);
  const adapter = adapterSpec ? createAdapter(adapterSpec, env) : defaultAdapter(env).adapter;
  if (adapterSpec && !ADAPTER_CATALOG.some((d) => d.kind === adapterSpec.kind)) {
    warnings.push(`unknown adapter kind "${adapterSpec.kind}"`);
  }
  const model = config.model ?? spec?.model?.model ?? (adapter as unknown as { defaultModel?: string }).defaultModel ?? adapterSpec?.model ?? adapter.id;

  let verifierAdapter;
  if (config.verifier?.enabled) {
    verifierAdapter = config.verifier.adapter ? createAdapter(config.verifier.adapter, env) : adapter;
  }

  /* -------- harness -------- */
  const auditPath = config.auditPath ?? join(workspaceRoot, ".sudarshan", "audit", `audit-${new Date().toISOString().slice(0, 10)}.jsonl`);
  const harness = new Harness({
    workspaceRoot,
    adapter,
    verifierAdapter,
    verifierModel: config.verifier?.model,
    policy,
    capabilityConfig: config.capabilities?.config ?? {},
    auditPath,
    env: env as Record<string, string | undefined>,
  });

  /* -------- capabilities (LEGO) -------- */
  const preset = config.capabilities?.preset ? PRESETS[config.capabilities.preset] : undefined;
  if (config.capabilities?.preset && !preset) {
    warnings.push(`unknown preset "${config.capabilities.preset}"; known presets: ${Object.keys(PRESETS).join(", ")}`);
  }

  const requestedInstall = config.capabilities?.install ?? spec?.capabilities ?? preset?.capabilities ?? DEFAULT_ENABLED;
  const installIds = requestedInstall.includes("*") ? builtinCapabilities(policy).map((c) => c.id) : requestedInstall;

  for (const id of installIds) {
    const capability = builtinCapability(id, policy);
    if (!capability) {
      warnings.push(`capability "${id}" is not a built-in; looked for it in ${join(workspaceRoot, config.capabilities?.workspaceDir ?? DEFAULT_CAPABILITY_DIR)}`);
      continue;
    }
    harness.install(capability, { source: "builtin" });
  }

  // Anything the spec asks to remove is genuinely removed — not just disabled.
  for (const id of spec?.removeCapabilities ?? []) {
    if (harness.remove(id)) warnings.push(`agent.md removed capability "${id}"`);
  }

  const enabledIds = config.capabilities?.enabled ?? (spec?.capabilities.length ? spec.capabilities : preset?.capabilities ?? DEFAULT_ENABLED);
  for (const entry of harness.registry.list()) {
    const id = entry.capability.id;
    const shouldEnable = enabledIds.includes(id) || enabledIds.includes("*");
    const forcedOff = (config.capabilities?.disabled ?? []).includes(id);
    harness.setEnabled(id, shouldEnable && !forcedOff);
  }

  // Workspace capabilities: user-authored, marketplace-downloaded or generated.
  const capabilityDir = resolve(workspaceRoot, config.capabilities?.workspaceDir ?? DEFAULT_CAPABILITY_DIR);
  if (existsSync(capabilityDir)) {
    const loaded = await loadCapabilitiesFromDirectory(capabilityDir, policy);
    for (const { capability, source } of loaded) {
      harness.install(capability, { source: "workspace" });
      const disabled = (config.capabilities?.disabled ?? []).includes(capability.id);
      harness.setEnabled(capability.id, !disabled);
      if (capability.id.startsWith("broken-")) warnings.push(`${source}: ${capability.description}`);
    }
  }

  /* -------- honest reporting -------- */
  const capabilities = describeCapabilities(harness, policy);
  for (const c of capabilities) {
    if (c.enabled && c.missingPermissions.length > 0) {
      warnings.push(
        `capability "${c.id}" is enabled but these permissions are NOT granted: ${c.missingPermissions.join(", ")}. Its tools will be blocked at the gate until you grant them.`,
      );
    }
  }
  if (!adapter.available()) {
    warnings.push(`model adapter "${adapter.id}" is not available (missing credentials or unreachable server). Runs will fail at the first model call.`);
  }
  if (capabilities.filter((c) => c.enabled).length === 0) {
    warnings.push("no capability is enabled — the agent has no tools and cannot act.");
  }

  return {
    harness,
    spec,
    policy,
    config: { ...config, workspaceRoot },
    adapterId: adapter.id,
    model,
    warnings,
    capabilities,
  };
}

/**
 * Live view of the LEGO rack.
 *
 * This reads the registry *now*, not a copy taken at build time: installing,
 * removing or toggling a capability must be visible to the IDE, the CLI and the
 * daemon immediately, because what you see here is exactly what the gate will
 * enforce on the next action request.
 */
export function describeCapabilities(
  harness: Harness,
  policy: Policy,
): Array<{ id: string; enabled: boolean; source: string; tools: string[]; permissions: string[]; missingPermissions: string[] }> {
  return harness.registry.list().map((entry) => {
    const missingPermissions = entry.capability.permissions.filter((p) => !policy.permissions.includes(p) && !policy.permissions.includes("*"));
    return {
      id: entry.capability.id,
      enabled: entry.enabled,
      source: entry.source,
      tools: entry.capability.tools.map((t) => t.name),
      permissions: entry.capability.permissions,
      missingPermissions,
    };
  });
}

export async function loadConfigFile(workspaceRoot: string): Promise<HarnessBuildConfig | undefined> {
  for (const name of CONFIG_FILENAMES) {
    const path = join(workspaceRoot, name);
    if (!existsSync(path)) continue;
    try {
      const raw = await readFile(path, "utf8");
      const withoutComments = raw.replace(/^\s*\/\/.*$/gm, "");
      return JSON.parse(withoutComments) as HarnessBuildConfig;
    } catch (err) {
      throw new Error(`${path}: ${(err as Error).message}`);
    }
  }
  return undefined;
}

export function describePolicy(policy: Policy): string[] {
  return [
    `denyByDefault: ${policy.denyByDefault}`,
    `permissions: ${policy.permissions.join(", ")}`,
    `fs roots: ${policy.scopes.fsRoots.join(", ")}`,
    `fs deny: ${policy.scopes.fsDeny.join(", ") || "(none)"}`,
    `shell: cwd=${policy.scopes.shell.cwd} timeout=${policy.scopes.shell.timeoutMs}ms allow=[${(policy.scopes.shell.allowCommands ?? []).join(",")}] deny=[${(policy.scopes.shell.denyCommands ?? []).join(",")}]`,
    `net: allow=[${(policy.scopes.net.allowHosts ?? []).join(",")}] deny=[${(policy.scopes.net.denyHosts ?? []).join(",")}]`,
    `budgets: steps=${policy.budgets.maxSteps} calls=${policy.budgets.maxToolCalls} tokens=${policy.budgets.maxTokens} wall=${Math.round(policy.budgets.maxWallClockMs / 1000)}s repeat=${policy.budgets.maxRepeatedActions}`,
    `approval: risk=[${policy.approval.requireForRisk.join(",")}] reversibility=[${policy.approval.requireForReversibility.join(",")}] tools=[${policy.approval.requireForTools.join(",")}]`,
    `verification: perAction=${policy.verification.perAction} blind=${policy.verification.blindVerifier} strict=${policy.verification.strict} expectations=${policy.verification.expectations.length}`,
    `protected paths: ${policy.protectedPaths.length}`,
    `rules: ${policy.rules.length}`,
  ];
}

export * from "./replay.js";
