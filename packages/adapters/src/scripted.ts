import type { ChatMessage, CompletionRequest, CompletionResponse, ModelAdapter, ToolCall, Usage } from "@sudarshan/core";
import { newId } from "@sudarshan/core";

export type ScriptStep =
  | { kind: "tool"; name: string; arguments?: Record<string, unknown>; content?: string }
  | { kind: "tools"; calls: Array<{ name: string; arguments?: Record<string, unknown> }>; content?: string }
  | { kind: "text"; content: string };

export type ScriptEntry = ScriptStep | ((ctx: ScriptContext) => ScriptStep | undefined);

export interface ScriptContext {
  step: number;
  messages: ChatMessage[];
  /** The Harness feedback for the previous action(s), verbatim. */
  lastFeedback: string[];
  task: string;
}

export interface ScriptedAdapterConfig {
  id?: string;
  label?: string;
  script: ScriptEntry[];
  supportsTools?: boolean;
  /** Emit tool calls as fenced ```tool blocks instead of native tool_calls. */
  textProtocol?: boolean;
  usage?: Partial<Usage>;
}

/**
 * A deterministic, offline model adapter.
 *
 * This exists for two honest reasons:
 *  1. Tests. The whole Harness pipeline (gate -> execute -> verify -> SRE ->
 *     summary) can be exercised without credentials, network or randomness.
 *  2. Demos and CI. A recorded trajectory can be replayed through the real
 *     Harness against the real filesystem.
 *
 * It is NOT a substitute for a model and it is labelled as such everywhere it
 * surfaces in the UI. A scripted adapter decides nothing: it plays back. If you
 * see `scripted` in a run record, that run proves the Harness works — it does
 * not prove an agent can do the task.
 */
export class ScriptedAdapter implements ModelAdapter {
  readonly id: string;
  readonly label: string;
  readonly supportsTools: boolean;
  private script: ScriptEntry[];
  private cursor = 0;
  private textProtocol: boolean;
  private usage: Partial<Usage>;

  constructor(config: ScriptedAdapterConfig) {
    this.id = config.id ?? "scripted";
    this.label = config.label ?? "Scripted (offline replay — no model)";
    this.supportsTools = config.supportsTools ?? !config.textProtocol;
    this.script = config.script;
    this.textProtocol = config.textProtocol ?? false;
    this.usage = config.usage ?? { promptTokens: 10, completionTokens: 10, totalTokens: 20 };
  }

  available(): boolean {
    return true;
  }

  reset(): void {
    this.cursor = 0;
  }

  async complete(req: CompletionRequest): Promise<CompletionResponse> {
    const lastFeedback = [...req.messages].reverse().filter((m) => m.role === "tool").map((m) => m.content);
    const entry = this.script[this.cursor];
    this.cursor++;

    if (!entry) {
      return {
        content: "Script exhausted. No further actions requested.",
        toolCalls: [],
        usage: usageOf(this.usage),
        stopReason: "end_turn",
        adapterId: this.id,
      };
    }

    const step: ScriptStep | undefined = typeof entry === "function" ? entry({ step: this.cursor, messages: req.messages, lastFeedback, task: req.messages.find((m) => m.role === "user")?.content ?? "" }) : entry;
    if (!step) {
      return { content: "Script produced no step; finishing.", toolCalls: [], usage: usageOf(this.usage), stopReason: "end_turn", adapterId: this.id };
    }

    if (step.kind === "text") {
      return { content: step.content, toolCalls: [], usage: usageOf(this.usage), stopReason: "end_turn", adapterId: this.id };
    }

    const calls: ToolCall[] =
      step.kind === "tool"
        ? [{ id: newId("call"), name: step.name, arguments: step.arguments ?? {} }]
        : step.calls.map((c) => ({ id: newId("call"), name: c.name, arguments: c.arguments ?? {} }));

    if (this.textProtocol || !this.supportsTools) {
      const blocks = calls.map((c) => `\`\`\`tool\n${JSON.stringify({ name: c.name, arguments: c.arguments }, null, 2)}\n\`\`\``).join("\n\n");
      return {
        content: [step.kind === "tool" ? step.content ?? "" : "", blocks].filter(Boolean).join("\n\n"),
        toolCalls: [],
        usage: usageOf(this.usage),
        stopReason: "tool_use",
        adapterId: this.id,
      };
    }

    return {
      content: (step.kind === "tool" ? step.content : "") ?? "",
      toolCalls: calls,
      usage: usageOf(this.usage),
      stopReason: "tool_use",
      adapterId: this.id,
    };
  }
}

function usageOf(partial: Partial<Usage>): Usage {
  const prompt = partial.promptTokens ?? 0;
  const completion = partial.completionTokens ?? 0;
  return { promptTokens: prompt, completionTokens: completion, totalTokens: partial.totalTokens ?? prompt + completion };
}
