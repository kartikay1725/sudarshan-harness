import type {
  ChatMessage,
  CompletionRequest,
  CompletionResponse,
  ModelAdapter,
  ToolCall,
  ToolSpec,
  Usage,
} from "@sudarshan/core";
import { newId } from "@sudarshan/core";

export interface OpenAICompatibleConfig {
  /** Adapter id, e.g. `openai`, `deepseek`, `groq`, `vllm`, `lmstudio`, `openrouter`. */
  id?: string;
  label?: string;
  baseURL?: string;
  apiKey?: string;
  /** Env var to read the key from. Defaults to OPENAI_API_KEY. */
  apiKeyEnv?: string;
  /** Some local servers need no key but reject empty Authorization headers. */
  allowMissingKey?: boolean;
  defaultModel?: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  /** Extra headers (e.g. OpenRouter app attribution). */
  headers?: Record<string, string>;
}

interface OpenAIToolCall {
  id?: string;
  type?: string;
  function?: { name?: string; arguments?: string | Record<string, unknown> };
}

/**
 * One adapter for the whole OpenAI-compatible ecosystem: OpenAI, Azure-ish
 * gateways, DeepSeek, Groq, Together, OpenRouter, vLLM, LM Studio, llama.cpp
 * server, Ollama's /v1 endpoint.
 *
 * The Harness does not care which one is behind this. Same gate, same
 * capabilities, same verification.
 */
export class OpenAICompatibleAdapter implements ModelAdapter {
  readonly id: string;
  readonly label: string;
  readonly supportsTools = true;
  private baseURL: string;
  private apiKeyEnv: string;
  private apiKey?: string;
  private allowMissingKey: boolean;
  defaultModel: string;
  private fetchImpl: typeof fetch;
  private timeoutMs: number;
  private headers: Record<string, string>;

  constructor(config: OpenAICompatibleConfig = {}) {
    this.id = config.id ?? "openai";
    this.label = config.label ?? "OpenAI-compatible";
    this.baseURL = (config.baseURL ?? process.env.OPENAI_BASE_URL ?? "https://api.openai.com/v1").replace(/\/+$/, "");
    this.apiKeyEnv = config.apiKeyEnv ?? "OPENAI_API_KEY";
    this.apiKey = config.apiKey;
    this.allowMissingKey = config.allowMissingKey ?? false;
    this.defaultModel = config.defaultModel ?? "gpt-4o-mini";
    this.fetchImpl = config.fetchImpl ?? fetch;
    this.timeoutMs = config.timeoutMs ?? 180_000;
    this.headers = config.headers ?? {};
  }

  available(): boolean {
    return this.allowMissingKey || !!this.resolveKey();
  }

  private resolveKey(): string | undefined {
    return this.apiKey ?? process.env[this.apiKeyEnv] ?? process.env.OPENAI_API_KEY;
  }

  async complete(req: CompletionRequest, opts: { signal?: AbortSignal } = {}): Promise<CompletionResponse> {
    const key = this.resolveKey();
    if (!key && !this.allowMissingKey) {
      throw new Error(`${this.id}: no API key found (set ${this.apiKeyEnv})`);
    }

    const messages = toOpenAIMessages(req.messages, req.system);
    const body: Record<string, unknown> = {
      model: req.model || this.defaultModel,
      messages,
      temperature: req.temperature ?? 0.2,
      stream: false,
    };
    if (req.maxTokens) body.max_tokens = req.maxTokens;
    if (req.tools?.length) {
      body.tools = req.tools.map(toOpenAITool);
      body.tool_choice = "auto";
      body.parallel_tool_calls = false;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    const onAbort = () => controller.abort();
    opts.signal?.addEventListener("abort", onAbort, { once: true });

    try {
      const res = await this.fetchImpl(`${this.baseURL}/chat/completions`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(key ? { authorization: `Bearer ${key}` } : {}),
          ...this.headers,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      const text = await res.text();
      if (!res.ok) {
        throw new Error(`${this.id} HTTP ${res.status}: ${text.slice(0, 800)}`);
      }
      const json = JSON.parse(text) as {
        choices?: Array<{
          message?: { content?: string | null; tool_calls?: OpenAIToolCall[] };
          finish_reason?: string;
        }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number; total_tokens?: number };
      };

      const choice = json.choices?.[0];
      const message = choice?.message;
      const toolCalls: ToolCall[] = (message?.tool_calls ?? []).map((tc) => ({
        id: tc.id ?? newId("call"),
        name: tc.function?.name ?? "",
        arguments: parseArguments(tc.function?.arguments),
      }));

      const usage: Usage = {
        promptTokens: json.usage?.prompt_tokens ?? 0,
        completionTokens: json.usage?.completion_tokens ?? 0,
        totalTokens: json.usage?.total_tokens ?? 0,
      };

      return {
        content: typeof message?.content === "string" ? message.content : "",
        toolCalls,
        usage,
        stopReason: toolCalls.length > 0 ? "tool_use" : choice?.finish_reason === "length" ? "length" : "end_turn",
        adapterId: this.id,
        raw: json,
      };
    } finally {
      clearTimeout(timer);
      opts.signal?.removeEventListener("abort", onAbort);
    }
  }
}

export function toOpenAITool(spec: ToolSpec) {
  return {
    type: "function",
    function: {
      name: spec.name,
      description: spec.description,
      parameters: spec.parameters,
    },
  };
}

export function parseArguments(raw: string | Record<string, unknown> | undefined): Record<string, unknown> {
  if (!raw) return {};
  if (typeof raw === "object") return raw;
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { value: parsed };
  } catch {
    // Some models emit single-quoted or trailing-comma JSON. Try a lenient pass.
    try {
      const cleaned = raw
        .replace(/,\s*([}\]])/g, "$1")
        .replace(/'/g, '"');
      const parsed = JSON.parse(cleaned);
      return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : { value: parsed };
    } catch {
      return { __raw: raw };
    }
  }
}

export function toOpenAIMessages(messages: ChatMessage[], system?: string): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  const systemText = system ?? messages.find((m) => m.role === "system")?.content;
  if (systemText) out.push({ role: "system", content: systemText });

  for (const m of messages) {
    if (m.role === "system") continue;
    if (m.role === "assistant") {
      const msg: Record<string, unknown> = { role: "assistant", content: m.content || null };
      if (m.toolCalls?.length) {
        msg.tool_calls = m.toolCalls.map((tc) => ({
          id: tc.id,
          type: "function",
          function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
        }));
      }
      out.push(msg);
    } else if (m.role === "tool") {
      out.push({ role: "tool", tool_call_id: m.toolCallId, content: m.content });
    } else {
      out.push({ role: m.role, content: m.content });
    }
  }
  return out;
}
