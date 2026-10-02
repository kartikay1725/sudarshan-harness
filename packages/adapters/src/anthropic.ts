import type { ChatMessage, CompletionRequest, CompletionResponse, ModelAdapter, ToolCall, Usage } from "@sudarshan/core";
import { newId } from "@sudarshan/core";

export interface AnthropicConfig {
  id?: string;
  label?: string;
  baseURL?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  defaultModel?: string;
  version?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

interface ContentBlock {
  type: string;
  text?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
  tool_use_id?: string;
  content?: string;
}

/**
 * Anthropic (Claude) adapter.
 *
 * Translates the Harness's neutral message format into Anthropic's block-based
 * protocol. Nothing else about the run changes: the gate, capabilities and
 * verification are provider-independent.
 */
export class AnthropicAdapter implements ModelAdapter {
  readonly id: string;
  readonly label: string;
  readonly supportsTools = true;
  private baseURL: string;
  private apiKeyEnv: string;
  private apiKey?: string;
  defaultModel: string;
  private version: string;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;

  constructor(config: AnthropicConfig = {}) {
    this.id = config.id ?? "anthropic";
    this.label = config.label ?? "Anthropic Claude";
    this.baseURL = (config.baseURL ?? process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com").replace(/\/+$/, "");
    this.apiKeyEnv = config.apiKeyEnv ?? "ANTHROPIC_API_KEY";
    this.apiKey = config.apiKey;
    this.defaultModel = config.defaultModel ?? "claude-sonnet-4-5";
    this.version = config.version ?? "2023-06-01";
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 300_000;
  }

  available(): boolean {
    return !!(this.apiKey ?? process.env[this.apiKeyEnv]);
  }

  private resolveKey(): string | undefined {
    return this.apiKey ?? process.env[this.apiKeyEnv];
  }

  async complete(req: CompletionRequest, opts: { signal?: AbortSignal } = {}): Promise<CompletionResponse> {
    const key = this.resolveKey();
    if (!key) throw new Error(`${this.id}: no API key found (set ${this.apiKeyEnv})`);

    const system = req.system ?? req.messages.find((m) => m.role === "system")?.content;
    const body: Record<string, unknown> = {
      model: req.model || this.defaultModel,
      max_tokens: req.maxTokens ?? 4096,
      messages: toAnthropicMessages(req.messages),
      temperature: req.temperature ?? 0.2,
    };
    if (system) body.system = system;
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({ name: t.name, description: t.description, input_schema: t.parameters }));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const res = await this.fetchImpl(`${this.baseURL}/v1/messages`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-api-key": key,
          "anthropic-version": this.version,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${this.id} HTTP ${res.status}: ${text.slice(0, 800)}`);

      const json = JSON.parse(text) as {
        content?: ContentBlock[];
        stop_reason?: string;
        usage?: { input_tokens?: number; output_tokens?: number };
      };

      const contentParts = (json.content ?? []).filter((b) => b.type === "text").map((b) => b.text ?? "");
      const toolCalls: ToolCall[] = (json.content ?? [])
        .filter((b) => b.type === "tool_use")
        .map((b) => ({
          id: b.id ?? newId("call"),
          name: b.name ?? "",
          arguments: (b.input ?? {}) as Record<string, unknown>,
        }));

      const usage: Usage = {
        promptTokens: json.usage?.input_tokens ?? 0,
        completionTokens: json.usage?.output_tokens ?? 0,
        totalTokens: (json.usage?.input_tokens ?? 0) + (json.usage?.output_tokens ?? 0),
      };

      return {
        content: contentParts.join("\n").trim(),
        toolCalls,
        usage,
        stopReason: toolCalls.length > 0 ? "tool_use" : json.stop_reason === "max_tokens" ? "length" : "end_turn",
        adapterId: this.id,
        raw: json,
      };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
}

/**
 * Anthropic requires tool results to arrive as `user` messages containing
 * `tool_result` blocks, and consecutive results must be merged into one turn.
 */
export function toAnthropicMessages(messages: ChatMessage[]): Array<{ role: "user" | "assistant"; content: unknown }> {
  const out: Array<{ role: "user" | "assistant"; content: unknown }> = [];
  let pendingToolResults: ContentBlock[] = [];

  const flush = () => {
    if (pendingToolResults.length > 0) {
      out.push({ role: "user", content: pendingToolResults });
      pendingToolResults = [];
    }
  };

  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "tool") {
      pendingToolResults.push({ type: "tool_result", tool_use_id: m.toolCallId ?? "", content: m.content });
      continue;
    }
    flush();
    if (m.role === "assistant") {
      const blocks: ContentBlock[] = [];
      if (m.content) blocks.push({ type: "text", text: m.content });
      for (const tc of m.toolCalls ?? []) {
        blocks.push({ type: "tool_use", id: tc.id, name: tc.name, input: tc.arguments });
      }
      out.push({ role: "assistant", content: blocks.length > 0 ? blocks : [{ type: "text", text: "" }] });
    } else {
      out.push({ role: "user", content: m.content });
    }
  }
  flush();

  // Anthropic rejects an empty message list and requires alternating turns to
  // start with `user`.
  if (out.length === 0) out.push({ role: "user", content: "(no messages)" });
  return out;
}
