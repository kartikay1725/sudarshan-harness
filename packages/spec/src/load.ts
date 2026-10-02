import { readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import type { Policy } from "@sudarshan/core";
import type { AgentSpec } from "./types.js";
import { applySpecToPolicy, parseAgentSpec } from "./parse.js";

export const SPEC_FILENAMES = ["agent.md", "AGENT.md", "Agent.md", "sudarshan.md", ".sudarshan/agent.md", ".sudarshan/spec.md"];

export async function loadAgentSpec(path: string): Promise<AgentSpec> {
  const raw = await readFile(path, "utf8");
  const { spec } = parseAgentSpec(raw, path);
  return spec;
}

/** Find the first agent spec in a workspace, if any. */
export async function findAgentSpec(workspaceRoot: string): Promise<AgentSpec | undefined> {
  for (const name of SPEC_FILENAMES) {
    const candidate = join(workspaceRoot, name);
    try {
      const info = await stat(candidate);
      if (info.isFile()) return loadAgentSpec(candidate);
    } catch {
      /* keep looking */
    }
  }
  return undefined;
}

export interface ResolvedAgent {
  spec?: AgentSpec;
  policy: Policy;
  persona?: string;
  rules: string[];
  capabilities: string[];
  removeCapabilities: string[];
  model?: { adapter?: string; model?: string; temperature?: number; maxTokens?: number };
}

/**
 * Resolve `agent.md` against a base policy.
 *
 * The spec can narrow the boundary and add acceptance criteria. It cannot widen
 * it: permissions it requests are only added to the *grant list*, which the
 * gate still evaluates against installed capabilities, scopes, protected paths
 * and deny rules.
 */
export function resolveAgent(base: Policy, spec?: AgentSpec): ResolvedAgent {
  if (!spec) {
    return { policy: base, rules: [], capabilities: [], removeCapabilities: [] };
  }
  const policy = applySpecToPolicy(spec, base);
  return {
    spec,
    policy,
    persona: spec.persona,
    rules: spec.rules,
    capabilities: spec.capabilities,
    removeCapabilities: spec.removeCapabilities,
    model: spec.model,
  };
}

/** A starting point for `sudarshan init`. */
export function renderSpecTemplate(opts: { name?: string; workspaceRoot: string; capabilities?: string[] } = { workspaceRoot: "." }): string {
  const capabilities = opts.capabilities ?? ["filesystem", "terminal", "git"];
  return `---
name: ${opts.name ?? "My Agent"}
description: A Sudarshan agent specification. Markdown in, governed agent out.
capabilities: [${capabilities.join(", ")}]
permissions: [fs.read, fs.list, fs.write, shell.exec]
model:
  adapter: openai
  model: gpt-4o-mini
  temperature: 0.2
approval: [high, critical]
budgets:
  maxSteps: 24
  maxToolCalls: 120
---

# Persona

You are a careful engineer working in \`${opts.workspaceRoot}\`.
You prefer small, verifiable changes and you never claim work is finished
without evidence from the real system.

## Rules

- Read before you write.
- Never modify files outside the workspace root.
- Run the project's test command after any change to source code.
- If a step is blocked, do not retry it identically — change the approach or report the blocker.

## Workflow

1. Inspect the workspace and understand the current state.
2. Make the smallest change that satisfies the task.
3. Verify the change with a real check (file contents, tests, or a command).
4. Report what changed and what was verified.

## Scope

roots: .
deny: **/node_modules/**, **/.env

## Verify

<!-- Acceptance criteria. Each line becomes a deterministic check the Harness
     runs against the real system at the end of the run. Without these, the
     Harness can verify each action but cannot verify the TASK. -->

file_exists README.md
command git status --porcelain exit=0
`;
}
