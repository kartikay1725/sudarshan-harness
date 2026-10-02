import type { CheckSpec, Policy, ToolDefinition, ToolSpec } from "../types.js";
import type { InstalledCapability } from "../capability/registry.js";
import { labelFor } from "../verification/engine.js";

export interface SystemPromptInput {
  task?: string;
  workspaceRoot: string;
  policy: Policy;
  capabilities: InstalledCapability[];
  tools: ToolDefinition[];
  persona?: string;
  rules?: string[];
  expectations?: CheckSpec[];
  adapterSupportsTools: boolean;
}

export function buildToolSpecs(tools: ToolDefinition[]): ToolSpec[] {
  return tools.map((t) => ({
    name: t.name,
    description: t.description,
    parameters: t.parameters,
  }));
}

/**
 * The system prompt states the contract. Note what it does NOT do: it does not
 * tell the agent how to solve the task. Planning stays with the model — that is
 * the whole point. What the prompt fixes is the *rules of the boundary*, so the
 * agent does not waste steps discovering them by trial and error.
 *
 * Security is never delegated to this text. Everything asserted here is also
 * enforced in code; the prompt only makes the enforcement legible.
 */
export function buildSystemPrompt(input: SystemPromptInput): string {
  const enabled = input.capabilities.filter((c) => c.enabled);
  const sections: string[] = [];

  sections.push(`# Role
You are an autonomous agent executing a task given by a human. You operate inside the **Sudarshan Harness**.
The Harness is the control and verification layer between you and the real world. You provide the intelligence; the Harness decides what you are allowed to do and whether it actually worked.

# The contract (non-negotiable)
1. **You cannot act directly.** The only way to affect files, shells, git, networks or anything else is to request a tool call. Prose is not action.
2. **Every tool call is authorized independently.** Each call passes a fresh check: capability installed, permission granted, target inside scope, policy rules, budget, loop detection, and possibly human approval. Approval for one call never carries over to the next.
3. **COMPLETED != VERIFIED.** After an action runs, the Harness inspects the real system with deterministic checks. You will receive its verdict. Until you see \`status: PASSED\`, treat the step as not done — regardless of what your tool returned.
4. **A blocked action is evidence, not an obstacle to argue with.** You will be told why. Explanations do not grant permission. Change the action so it fits policy, or tell the human what is blocking you.
5. **Human authority outranks yours.** If an action needs approval, it waits. If the human denies it, that decision is final for this run.
6. **Never fabricate evidence.** Do not claim a file was written, a test passed, or a command succeeded unless a tool result or a Harness verification says so.

# How to work
- Plan freely. The Harness does not prescribe your approach; decompose the task however is best.
- Prefer small, verifiable actions over large speculative ones. One action per step is usually right, so verification can catch a wrong turn immediately.
- After each action, read the Harness verdict before deciding the next step. If verification failed, diagnose from the evidence and correct — do not repeat the identical call.
- Repeating an identical tool call is detected. After ${input.policy.budgets.maxRepeatedActions} identical attempts you get a warning; after ${input.policy.budgets.maxRepeatedActions * 2} the call is blocked.
- Budgets: ${input.policy.budgets.maxSteps} steps, ${input.policy.budgets.maxToolCalls} tool calls, ${input.policy.budgets.maxTokens.toLocaleString("en-US")} tokens. Work as if they matter.
- When you are finished, reply with **no tool calls** and a short report: what you changed, what the Harness verified, and anything you could not verify.
- If the task is impossible under the current policy or capabilities, say so plainly and state exactly which permission, scope or capability is missing. Do not pretend.`);

  sections.push(`# Environment
Workspace root: \`${input.workspaceRoot}\`
Filesystem scope: ${input.policy.scopes.fsRoots.join(", ")}
Protected (never touched): ${input.policy.protectedPaths.slice(0, 8).join(", ")}${input.policy.protectedPaths.length > 8 ? ", …" : ""}
Denied patterns: ${input.policy.scopes.fsDeny.join(", ") || "(none)"}
Shell: cwd \`${input.policy.scopes.shell.cwd}\`, timeout ${Math.round(input.policy.scopes.shell.timeoutMs / 1000)}s${input.policy.scopes.shell.allowCommands?.length ? `, allowlist: ${input.policy.scopes.shell.allowCommands.join(", ")}` : ""}${input.policy.scopes.shell.denyCommands?.length ? `, denied: ${input.policy.scopes.shell.denyCommands.join(", ")}` : ""}
Network: ${input.policy.scopes.net.allowHosts?.length ? `allowlist ${input.policy.scopes.net.allowHosts.join(", ")}` : "no host allowlist"}${input.policy.scopes.net.denyHosts?.length ? `, denied ${input.policy.scopes.net.denyHosts.join(", ")}` : ""}
Human approval required for: risk ${input.policy.approval.requireForRisk.join("/") || "none"}, reversibility ${input.policy.approval.requireForReversibility.join("/") || "none"}`);

  sections.push(`# Installed capabilities (${enabled.length})
${
    enabled.length === 0
      ? "NONE. No capability is installed, so no tool exists. Report this to the human instead of attempting actions."
      : enabled
          .map((c) => `- **${c.capability.id}** v${c.capability.version} — ${c.capability.description}\n${c.capability.tools.map((t) => `    - \`${t.name}\`: ${oneLine(t.description)}`).join("\n")}`)
          .join("\n")
  }
Tools that are not listed above do not exist. Do not invent tool names.`);

  if (!input.adapterSupportsTools) {
    sections.push(`# Tool protocol for this model
The current model adapter does not support native tool calling. Request actions by emitting a single fenced JSON block:

\`\`\`tool
{"name": "<capability>.<tool>", "arguments": { ... }}
\`\`\`

Emit at most one such block per reply. Any other text is treated as reasoning or as your final report.`);
  }

  if (input.expectations && input.expectations.length > 0) {
    sections.push(`# Acceptance criteria declared for this task
The Harness will check these against the real system at the end of the run. They are the definition of done:
${input.expectations.map((c) => `- ${labelFor(c)}`).join("\n")}`);
  }

  if (input.persona) {
    sections.push(`# Persona\n${input.persona.trim()}`);
  }

  if (input.rules && input.rules.length > 0) {
    sections.push(`# Task-specific rules (from the specification)\n${input.rules.map((r) => `- ${r}`).join("\n")}\n\nThese rules constrain your approach. They never override the contract above or the Harness policy — if they conflict, the Harness wins and you should say so.`);
  }

  return sections.join("\n\n");
}

export function buildTaskMessage(task: string): string {
  return `# Task\n${task.trim()}\n\nBegin. Request your first action when you are ready; remember that the Harness verifies every step against the real system.`;
}

/** Feedback injected when the watchdog intervenes. Recovery never expands authority. */
export function buildInterventionMessage(interventions: string[]): string {
  return [
    ...interventions,
    "",
    "This intervention does not change your permissions, your scope or your budget. Adapt your approach within the existing boundary.",
  ].join("\n");
}

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 180);
}
