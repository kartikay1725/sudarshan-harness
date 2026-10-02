import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { CheckSpec, RunRecord } from "@sudarshan/core";
import { ScriptedAdapter, type ScriptEntry } from "@sudarshan/adapters";
import { Harness } from "@sudarshan/core";
import { builtinCapability } from "@sudarshan/capabilities";
import { buildHarness, type HarnessBuildConfig } from "./index.js";

/**
 * Trajectory recording and replay.
 *
 * A replay is NOT a model. It is a recording of the decisions a model made,
 * played back through the real Harness: real gate, real execution, real
 * verification against the real filesystem. That makes it useful for
 *
 *   - regression tests of the Harness itself,
 *   - demos and CI runs with no API key,
 *   - reproducing an incident exactly as it happened.
 *
 * The run record is always labelled with the `scripted` adapter so nobody can
 * mistake a replay for autonomous work.
 */
export interface ReplayFile {
  version: 1;
  task: string;
  capabilities?: string[];
  adapter?: HarnessBuildConfig["adapter"];
  model?: string;
  expectations?: SerialisableCheck[];
  policy?: HarnessBuildConfig["policy"];
  /** Files to create in a scratch workspace before the replay. */
  fixtures?: Record<string, string>;
  script: ScriptEntry[];
  recordedFrom?: { runId: string; adapter: string; model: string; recordedAt: string };
}

export type SerialisableCheck = Exclude<CheckSpec, { kind: "custom" }>;

export async function loadReplay(path: string): Promise<ReplayFile> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as ReplayFile;
  if (!parsed.task || !Array.isArray(parsed.script)) {
    throw new Error(`${path}: a replay needs a "task" and a "script" array`);
  }
  return parsed;
}

export interface ReplayResult {
  run: RunRecord;
  workspaceRoot: string;
  warnings: string[];
}

export async function runReplay(replay: ReplayFile, opts: { workspaceRoot?: string; keepWorkspace?: boolean } = {}): Promise<ReplayResult> {
  const warnings: string[] = [];
  let workspaceRoot = opts.workspaceRoot;
  let scratch: string | undefined;

  if (!workspaceRoot) {
    const { mkdtemp } = await import("node:fs/promises");
    const { tmpdir } = await import("node:os");
    const { join } = await import("node:path");
    scratch = await mkdtemp(join(tmpdir(), "sudarshan-replay-"));
    workspaceRoot = scratch;
  }

  for (const [path, content] of Object.entries(replay.fixtures ?? {})) {
    const full = resolve(workspaceRoot, path);
    if (!full.startsWith(resolve(workspaceRoot))) {
      warnings.push(`fixture "${path}" escapes the workspace; skipped`);
      continue;
    }
    await mkdir(dirname(full), { recursive: true });
    await writeFile(full, content, "utf8");
  }

  const built = await buildHarness({
    workspaceRoot,
    adapter: replay.adapter,
    model: replay.model,
    capabilities: replay.capabilities ? { install: replay.capabilities, enabled: replay.capabilities } : undefined,
    policy: replay.policy,
  });
  warnings.push(...built.warnings);

  // Swap in the recorded decisions.
  const scripted = new ScriptedAdapter({ id: "replay", label: "Replay (recorded trajectory)", script: replay.script });
  built.harness.setAdapter(scripted);

  const run = await built.harness.run(replay.task, {
    model: replay.model ?? "replay",
    expectations: (replay.expectations ?? []) as CheckSpec[],
    persona: built.spec?.persona,
    rules: built.spec?.rules,
    specPath: built.spec?.path,
  });

  if (!opts.keepWorkspace && scratch) {
    const { rm } = await import("node:fs/promises");
    await rm(scratch, { recursive: true, force: true });
  }

  return { run, workspaceRoot, warnings };
}

/** Turn a completed run into a replayable recording. */
export function recordTrajectory(run: RunRecord, opts: { fixtures?: Record<string, string> } = {}): ReplayFile {
  const script: ScriptEntry[] = [];
  for (const step of run.steps) {
    const assistant = step.messages.find((m) => m.role === "assistant");
    if (assistant?.toolCalls?.length) {
      if (assistant.toolCalls.length === 1) {
        script.push({ kind: "tool", name: assistant.toolCalls[0]!.name, arguments: assistant.toolCalls[0]!.arguments, content: assistant.content });
      } else {
        script.push({
          kind: "tools",
          content: assistant.content,
          calls: assistant.toolCalls.map((c) => ({ name: c.name, arguments: c.arguments })),
        });
      }
    }
    if (step.agentClaim) script.push({ kind: "text", content: step.agentClaim });
  }

  const expectations = (run.config as unknown as { expectations?: CheckSpec[] }).expectations ?? [];
  const serialisable = expectations.filter((c): c is SerialisableCheck => c.kind !== "custom");

  return {
    version: 1,
    task: run.task,
    capabilities: run.config.enabledCapabilities,
    adapter: { kind: "scripted" },
    model: run.config.model,
    expectations: serialisable,
    fixtures: opts.fixtures,
    script,
    recordedFrom: {
      runId: run.id,
      adapter: run.config.adapterId,
      model: run.config.model,
      recordedAt: run.startedAt,
    },
  };
}

export async function saveReplay(replay: ReplayFile, path: string): Promise<void> {
  await mkdir(dirname(resolve(path)), { recursive: true });
  await writeFile(resolve(path), `${JSON.stringify(replay, null, 2)}\n`, "utf8");
}

/** Convenience used by the CLI: build a Harness with an inline script. */
export function harnessWithScript(opts: {
  workspaceRoot: string;
  script: ScriptEntry[];
  capabilities?: string[];
  policy?: HarnessBuildConfig["policy"];
}): Harness {
  const harness = new Harness({
    workspaceRoot: opts.workspaceRoot,
    adapter: new ScriptedAdapter({ script: opts.script }),
    policy: opts.policy,
  });
  for (const id of opts.capabilities ?? ["filesystem"]) {
    const capability = builtinCapability(id, harness.policy);
    if (capability) harness.install(capability);
  }
  return harness;
}
