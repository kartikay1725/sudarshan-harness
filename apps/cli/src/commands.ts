import { existsSync } from "node:fs";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { AuditTrail, labelFor } from "@sudarshan/core";
import { ADAPTER_CATALOG, probeAdapters } from "@sudarshan/adapters";
import { CAPABILITY_CATALOG, PRESETS } from "@sudarshan/capabilities";
import { parseAgentSpec, renderSpecTemplate } from "@sudarshan/spec";
import { buildHarness, describeCapabilities, describePolicy, loadConfigFile, loadReplay, recordTrajectory, runReplay, saveReplay } from "@sudarshan/runtime";
import { bullet, c, heading, keyValue } from "./render.js";
import type { ParsedArgs } from "./args.js";
import { list, num, str } from "./args.js";

export async function doctorCommand(args: ParsedArgs): Promise<number> {
  const workspaceRoot = resolve(str(args.flags, "workspace") ?? process.cwd());
  const fileConfig = await loadConfigFile(workspaceRoot).catch(() => undefined);
  const built = await buildHarness({
    ...fileConfig,
    workspaceRoot,
    adapter: str(args.flags, "adapter") ? { kind: str(args.flags, "adapter") as never, model: str(args.flags, "model") } : fileConfig?.adapter,
    model: str(args.flags, "model") ?? fileConfig?.model,
  });
  const report = await built.harness.doctor();
  const chain = built.harness.auditChainStatus();

  console.log(heading("sudarshan doctor"));
  console.log(keyValue("workspace", report.workspaceRoot));
  console.log(keyValue("adapter", `${report.adapter.label} (${report.adapter.id}) ${report.adapter.available ? c.green("available") : c.red("NOT available")}`));
  console.log(keyValue("tool calling", report.adapter.supportsTools ? c.green("native") : c.yellow("text protocol fallback")));
  console.log(keyValue("model", built.model));
  console.log(keyValue("agent.md", built.spec?.path ? c.green(built.spec.path) : c.grey("none found")));
  console.log(keyValue("audit chain", `${chain.entries} entries, head ${chain.head.slice(0, 16)}… ${chain.ok ? c.green("intact") : c.red("BROKEN")}`));

  console.log(heading("capabilities"));
  for (const cap of report.capabilities) {
    const state = cap.enabled ? c.green("enabled ") : c.grey("disabled");
    const health = cap.health.ok ? c.green("healthy") : c.red(`unhealthy: ${cap.health.detail ?? "?"}`);
    console.log(`  ${state} ${c.bold(cap.id.padEnd(12))} v${cap.version}  ${cap.tools} tool(s)  ${health}`);
    const built2 = built.capabilities.find((b) => b.id === cap.id);
    if (built2?.missingPermissions.length) {
      console.log(`           ${c.yellow(`missing permissions: ${built2.missingPermissions.join(", ")}`)}`);
    }
  }

  console.log(heading("policy"));
  for (const line of describePolicy(built.policy)) console.log(`  ${c.grey(line)}`);

  console.log(heading("providers"));
  const detected = await probeAdapters(process.env);
  for (const entry of detected) {
    const mark = entry.available ? c.green("●") : c.grey("○");
    console.log(`  ${mark} ${entry.descriptor.label.padEnd(34)} ${c.grey(entry.descriptor.local ? "local" : `needs ${entry.descriptor.keyEnv ?? ""}`)} ${entry.available ? c.green("reachable") : c.grey(entry.descriptor.local ? "not reachable" : "no key")}`);
  }

  if (built.warnings.length > 0) {
    console.log(heading("warnings"));
    for (const warning of built.warnings) console.log(bullet(c.yellow(warning)));
  }
  if (report.problems.length > 0) {
    console.log(heading("problems"));
    for (const problem of report.problems) console.log(bullet(c.red(problem)));
    return 1;
  }
  console.log(`\n  ${c.green(c.bold("✓ ready"))} — the Harness can run tasks in this workspace.\n`);
  return 0;
}

export async function capabilitiesCommand(args: ParsedArgs): Promise<number> {
  const workspaceRoot = resolve(str(args.flags, "workspace") ?? process.cwd());
  const action = args.positionals[0] ?? "list";
  const id = args.positionals[1];

  if (action === "catalog") {
    console.log(heading("capability catalog (installable LEGO blocks)"));
    for (const cap of CAPABILITY_CATALOG) {
      console.log(`  ${c.bold(cap.id.padEnd(12))} ${cap.name} — ${cap.description}`);
      console.log(`    ${c.grey(`permissions: ${cap.permissions.join(", ")} · tools: ${cap.toolCount} · risk: ${cap.risk} · ${cap.local ? "local" : "network"}`)}`);
      console.log(`    ${c.grey(`tags: ${cap.tags.join(", ")}`)}`);
    }
    console.log(heading("presets"));
    for (const [key, preset] of Object.entries(PRESETS)) {
      console.log(`  ${c.bold(key.padEnd(10))} ${preset.label} — ${preset.capabilities.join(", ")}`);
      console.log(`    ${c.grey(preset.description)}`);
    }
    return 0;
  }

  const fileConfig = await loadConfigFile(workspaceRoot).catch(() => undefined);
  const built = await buildHarness({ ...fileConfig, workspaceRoot });

  if (action === "list") {
    console.log(heading("installed capabilities"));
    for (const cap of describeCapabilities(built.harness, built.policy)) {
      console.log(`  ${cap.enabled ? c.green("✓") : c.grey("○")} ${c.bold(cap.id.padEnd(12))} ${c.grey(cap.source.padEnd(12))} ${cap.tools.join(", ")}`);
      if (cap.missingPermissions.length) console.log(`    ${c.yellow(`not granted: ${cap.missingPermissions.join(", ")}`)}`);
    }
    console.log(`\n  ${c.grey(`To change this persistently, edit ${join(workspaceRoot, "sudarshan.config.json")} or agent.md.`)}`);
    return 0;
  }

  if (!id) {
    console.error(c.red("capabilities <enable|disable|install|remove> <id>"));
    return 2;
  }

  const configPath = join(workspaceRoot, "sudarshan.config.json");
  const config = (existsSync(configPath) ? JSON.parse(await readFile(configPath, "utf8")) : { capabilities: { enabled: ["filesystem", "terminal", "git"] } }) as {
    capabilities?: { enabled?: string[]; disabled?: string[]; install?: string[] };
  };
  config.capabilities = config.capabilities ?? {};
  config.capabilities.enabled = config.capabilities.enabled ?? built.capabilities.filter((x) => x.enabled).map((x) => x.id);
  config.capabilities.disabled = config.capabilities.disabled ?? [];

  if (action === "enable") {
    if (!config.capabilities.enabled.includes(id)) config.capabilities.enabled.push(id);
    config.capabilities.disabled = config.capabilities.disabled.filter((x) => x !== id);
  } else if (action === "disable") {
    config.capabilities.enabled = config.capabilities.enabled.filter((x) => x !== id);
    if (!config.capabilities.disabled.includes(id)) config.capabilities.disabled.push(id);
  } else if (action === "install" || action === "remove") {
    config.capabilities.install = config.capabilities.install ?? built.capabilities.map((x) => x.id);
    if (action === "install" && !config.capabilities.install.includes(id)) config.capabilities.install.push(id);
    if (action === "remove") {
      config.capabilities.install = config.capabilities.install.filter((x) => x !== id);
      config.capabilities.enabled = config.capabilities.enabled.filter((x) => x !== id);
    }
  } else {
    console.error(c.red(`unknown capabilities action "${action}"`));
    return 2;
  }

  await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
  console.log(`${c.green("✓")} ${action} ${c.bold(id)} — wrote ${configPath}`);
  if (action === "enable" && id === "http") {
    console.log(c.yellow('  note: enabling "http" also needs the net.request permission, which is not granted by default.'));
    console.log(c.grey('  grant it in sudarshan.config.json: {"policy": {"permissions": [..., "net.request"]}}'));
  }
  if (action === "enable" && id === "git") {
    console.log(c.yellow('  note: git.push is not granted by default — publishing to a remote is an operator decision.'));
  }
  return 0;
}

export async function initCommand(args: ParsedArgs): Promise<number> {
  const workspaceRoot = resolve(str(args.flags, "workspace") ?? process.cwd());
  const name = str(args.flags, "name") ?? "My Agent";
  const capabilities = list(args.flags, "capabilities");
  const specPath = join(workspaceRoot, "agent.md");
  const configPath = join(workspaceRoot, "sudarshan.config.json");

  if (existsSync(specPath) && !args.flags.force) {
    console.log(c.yellow(`agent.md already exists at ${specPath} (use --force to overwrite)`));
  } else {
    await writeFile(specPath, renderSpecTemplate({ name, workspaceRoot, capabilities: capabilities.length ? capabilities : undefined }), "utf8");
    console.log(`${c.green("✓")} wrote ${specPath}`);
  }

  if (!existsSync(configPath)) {
    const config = {
      $schema: "./node_modules/@sudarshan/runtime/config.schema.json",
      workspaceRoot: ".",
      adapter: { kind: capabilities.includes("http") ? "openai" : "openai" },
      capabilities: { enabled: capabilities.length ? capabilities : ["filesystem", "terminal", "git"], workspaceDir: ".sudarshan/capabilities" },
      auditPath: ".sudarshan/audit/audit.jsonl",
      verifier: { enabled: false },
    };
    await mkdir(join(workspaceRoot, ".sudarshan", "capabilities"), { recursive: true });
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, "utf8");
    console.log(`${c.green("✓")} wrote ${configPath}`);
    console.log(`${c.green("✓")} created ${join(workspaceRoot, ".sudarshan/capabilities")} — drop capability modules here to install them`);
  }

  console.log(`\n  ${c.grey("Next:")} ${c.bold("sudarshan doctor")} ${c.grey("then")} ${c.bold('sudarshan run "your task"')}\n`);
  return 0;
}

export async function specCommand(args: ParsedArgs): Promise<number> {
  const workspaceRoot = resolve(str(args.flags, "workspace") ?? process.cwd());
  const path = args.positionals[0] ? resolve(workspaceRoot, args.positionals[0]) : join(workspaceRoot, "agent.md");
  if (!existsSync(path)) {
    console.error(c.red(`no spec at ${path}`));
    return 1;
  }
  const raw = await readFile(path, "utf8");
  const { spec, warnings } = parseAgentSpec(raw, path);

  console.log(heading("agent.md → what the Harness will do"));
  console.log(keyValue("name", spec.name ?? c.grey("(unnamed)")));
  console.log(keyValue("capabilities", spec.capabilities.length ? spec.capabilities.join(", ") : c.grey("(none requested)")));
  if (spec.removeCapabilities.length) console.log(keyValue("removed", c.yellow(spec.removeCapabilities.join(", "))));
  console.log(keyValue("permissions", spec.permissions.length ? spec.permissions.join(", ") : c.grey("(defaults)")));
  console.log(keyValue("model", spec.model ? `${spec.model.adapter ?? "?"}/${spec.model.model ?? "?"}` : c.grey("(default adapter)")));
  console.log(keyValue("approval", spec.approval.risk.length ? `risk: ${spec.approval.risk.join(", ")}` : c.grey("(policy default)")));
  console.log(keyValue("rules", String(spec.rules.length)));
  for (const rule of spec.rules) console.log(bullet(rule));
  if (spec.workflow.length) {
    console.log(keyValue("workflow", `${spec.workflow.length} advisory step(s)`));
    spec.workflow.forEach((w, i) => console.log(bullet(`${i + 1}. ${w}`)));
  }
  console.log(keyValue("scopes", JSON.stringify(spec.scopes)));
  console.log(keyValue("budgets", Object.keys(spec.budgets).length ? JSON.stringify(spec.budgets) : c.grey("(defaults)")));

  console.log(heading("acceptance criteria (deterministic checks)"));
  if (spec.verification.length === 0) {
    console.log(bullet(c.yellow("none declared — the Harness can verify each action but NOT the task. Add a ## Verify section.")));
  }
  for (const check of spec.verification) console.log(bullet(`${c.green("✓")} ${labelFor(check)}`));

  if (warnings.length) {
    console.log(heading("warnings"));
    for (const w of warnings) console.log(bullet(c.yellow(w)));
  }

  const built = await buildHarness({ workspaceRoot, specPath: path });
  console.log(heading("resulting policy"));
  for (const line of describePolicy(built.policy)) console.log(`  ${c.grey(line)}`);
  console.log(`\n  ${c.grey(`unchanged by the spec: ${built.policy.protectedPaths.length} protected paths, deny-by-default=${built.policy.denyByDefault}`)}\n`);
  return 0;
}

export async function promptCommand(args: ParsedArgs): Promise<number> {
  const workspaceRoot = resolve(str(args.flags, "workspace") ?? process.cwd());
  const task = args.positionals.join(" ") || "(task preview)";
  const built = await buildHarness({ ...await loadConfigFile(workspaceRoot).catch(() => undefined), workspaceRoot });
  const expectations = built.spec?.verification ?? [];
  console.log(built.harness.systemPromptPreview(task, expectations));
  return 0;
}

export async function auditCommand(args: ParsedArgs): Promise<number> {
  const workspaceRoot = resolve(str(args.flags, "workspace") ?? process.cwd());
  const file = str(args.flags, "file") ?? join(workspaceRoot, ".sudarshan", "audit", `audit-${new Date().toISOString().slice(0, 10)}.jsonl`);
  if (!existsSync(file)) {
    console.log(c.yellow(`no audit trail at ${file}`));
    console.log(c.grey("run a task first, or pass --file <path>"));
    return 1;
  }
  const raw = await readFile(file, "utf8");
  const entries = raw
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as Parameters<typeof AuditTrail.verifyEntries>[0][number]);
  const status = AuditTrail.verifyEntries(entries);
  const limit = num(args.flags, "limit") ?? 20;

  console.log(heading("audit trail"));
  console.log(keyValue("file", file));
  console.log(keyValue("entries", String(entries.length)));
  console.log(keyValue("chain", status.ok ? c.green("intact — every hash recomputes") : c.red(`BROKEN at seq ${status.brokenAtSeq}`)));
  console.log(heading(`last ${Math.min(limit, entries.length)} entries`));
  for (const entry of entries.slice(-limit)) {
    console.log(`  ${c.grey(String(entry.seq).padStart(4))} ${entry.at.slice(11, 19)} ${c.bold(entry.type.padEnd(26))} ${c.grey(JSON.stringify(entry.payload).slice(0, 120))}`);
  }
  return status.ok ? 0 : 1;
}

export async function replayCommand(args: ParsedArgs): Promise<number> {
  const file = args.positionals[0];
  if (!file) {
    console.error(c.red("usage: sudarshan replay <file.json> [--keep] [--workspace <dir>] [--out <recording.json>]"));
    return 2;
  }
  const replay = await loadReplay(resolve(file));
  const workspaceRoot = str(args.flags, "workspace");
  console.log(heading("replay (offline — recorded decisions, real enforcement)"));
  console.log(keyValue("task", replay.task));
  console.log(keyValue("script", `${replay.script.length} recorded step(s)`));
  console.log(keyValue("capabilities", (replay.capabilities ?? []).join(", ") || "(default)"));
  console.log(keyValue("checks", String((replay.expectations ?? []).length)));

  const result = await runReplay(replay, { workspaceRoot: workspaceRoot ? resolve(workspaceRoot) : undefined, keepWorkspace: !!args.flags.keep });
  const { formatSummary } = await import("./render.js");
  const run = result.run;
  console.log(keyValue("workspace", result.workspaceRoot));
  for (const line of formatSummary(run)) console.log(line);

  const out = str(args.flags, "out");
  if (out) {
    await saveReplay(recordTrajectory(run), resolve(out));
    console.log(`\n  ${c.green("✓")} recorded trajectory written to ${out}`);
  }
  return run.status === "verified" ? 0 : 1;
}

export function catalogCommand(): number {
  console.log(heading("adapter catalog"));
  for (const d of ADAPTER_CATALOG) {
    console.log(`  ${c.bold(d.kind.padEnd(20))} ${d.label.padEnd(34)} ${c.grey(`default model: ${d.defaultModel}${d.keyEnv ? ` · key: ${d.keyEnv}` : ""}${d.local ? " · local" : ""}`)}`);
  }
  return 0;
}

