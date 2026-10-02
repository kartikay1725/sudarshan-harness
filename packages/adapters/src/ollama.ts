import type { ChatMessage, CompletionRequest, CompletionResponse, ModelAdapter, ToolCall, Usage } from "@sudarshan/core";
import { newId } from "@sudarshan/core";

export interface OllamaConfig {
  id?: string;
  label?: string;
  /** Default: http://127.0.0.1:11434 — local-first, nothing leaves the machine. */
  baseURL?: string;
  defaultModel?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  keepAlive?: string;
}

interface OllamaToolCall {
  function?: { name?: string; arguments?: Record<string, unknown> | string };
}

/**
 * Ollama adapter — the local-first path.
 *
 * Sudarshan + Ollama + a local model + local capabilities runs entirely on the
 * user's machine: no company data, financial data or private documents leave
 * it. Same gate, same verification, same audit trail as a cloud model.
 *
 * Uses the native /api/chat endpoint (better keep_alive + tool support than the
 * OpenAI shim).
 */
export class OllamaAdapter implements ModelAdapter {
  readonly id: string;
  readonly label: string;
  readonly supportsTools = true;
  private baseURL: string;
  defaultModel: string;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;
  private keepAlive: string;
  private cachedModels: string[] = [];

  constructor(config: OllamaConfig = {}) {
    this.id = config.id ?? "ollama";
    this.label = config.label ?? "Ollama (local)";
    this.baseURL = (config.baseURL ?? process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434").replace(/\/+$/, "");
    this.defaultModel = config.defaultModel ?? process.env.OLLAMA_MODEL ?? "qwen2.5-coder:7b";
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 300_000;
    this.keepAlive = config.keepAlive ?? "10m";
  }

  /** Available only when the local server answers. */
  available(): boolean {
    // Synchronous interface, so this is a cached probe refreshed by `probe()`.
    return this.cachedModels.length > 0 || this.lastProbeOk === true;
  }

  private lastProbeOk?: boolean;

  async probe(): Promise<{ ok: boolean; models: string[]; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 3000);
    try {
      const res = await this.fetchImpl(`${this.baseURL}/api/tags`, { signal: controller.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as { models?: Array<{ name?: string }> };
      this.cachedModels = (json.models ?? []).map((m) => m.name ?? "").filter(Boolean);
      this.lastProbeOk = true;
      return { ok: true, models: this.cachedModels };
    } catch (err) {
      this.cachedModels = [];
      this.lastProbeOk = false;
      return { ok: false, models: [], error: err instanceof Error ? err.message : String(err) };
    } finally {
      clearTimeout(timer);
    }
  }

  async complete(req: CompletionRequest, opts: { signal?: AbortSignal } = {}): Promise<CompletionResponse> {
    const messages: ChatMessage[] = [];
    const system = req.system ?? req.messages.find((m) => m.role === "system")?.content;
    if (system) messages.push({ role: "system", content: system });
    for (const m of req.messages) {
      if (m.role === "system") continue;
      messages.push(m);
    }

    const body: Record<string, unknown> = {
      model: req.model || this.defaultModel,
      messages: messages.map(toOllamaMessage),
      stream: false,
      keep_alive: this.keepAlive,
      options: {
        temperature: req.temperature ?? 0.2,
        ...(req.maxTokens ? { num_predict: req.maxTokens } : {}),
      },
    };
    if (req.tools?.length) {
      body.tools = req.tools.map((t) => ({ type: "function", function: { name: t.name, description: t.description, parameters: t.parameters } }));
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const res = await this.fetchImpl(`${this.baseURL}/api/chat`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      const text = await res.text();
      if (!res.ok) throw new Error(`${this.id} HTTP ${res.status}: ${text.slice(0, 800)}`);
      const json = JSON.parse(text) as {
        message?: { role?: string; content?: string; tool_calls?: OllamaToolCall[] };
        done_reason?: string;
        prompt_eval_count?: number;
        eval_count?: number;
      };

      const toolCalls: ToolCall[] = (json.message?.tool_calls ?? []).map((tc) => ({
        id: newId("call"),
        name: tc.function?.name ?? "",
        arguments: normalise(tc.function?.arguments),
      }));

      const usage: Usage = {
        promptTokens: json.prompt_eval_count ?? 0,
        completionTokens: json.eval_count ?? 0,
        totalTokens: (json.prompt_eval_count ?? 0) + (json.eval_count ?? 0),
      };

      this.lastProbeOk = true;
      return {
        content: json.message?.content ?? "",
        toolCalls,
        usage,
        stopReason: toolCalls.length > 0 ? "tool_use" : json.done_reason === "length" ? "length" : "end_turn",
        adapterId: this.id,
        raw: json,
      };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
}

function normalise(args: Record<string, unknown> | string | undefined): Record<string, unknown> {
  if (!args) return {};
  if (typeof args === "string") {
    try {
      const parsed = JSON.parse(args);
      return parsed && typeof parsed === "object" ? parsed : { value: parsed };
    } catch {
      return { __raw: args };
    }
  }
  return args;
}

function toOllamaMessage(m: ChatMessage): Record<string, unknown> {
  if (m.role === "tool") return { role: "tool", content: m.content };
  if (m.role === "assistant" && m.toolCalls?.length) {
    return {
      role: "assistant",
      content: m.content || "",
      tool_calls: m.toolCalls.map((tc) => ({ function: { name: tc.name, arguments: tc.arguments } })),
    };
  }
  return { role: m.role, content: m.content };
}
