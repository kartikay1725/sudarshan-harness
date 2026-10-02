import type { ModelAdapter } from "@sudarshan/core";
import { AnthropicAdapter, type AnthropicConfig } from "./anthropic.js";
import { OllamaAdapter, type OllamaConfig } from "./ollama.js";
import { OpenAICompatibleAdapter, type OpenAICompatibleConfig } from "./openaiCompatible.js";
import { ScriptedAdapter, type ScriptedAdapterConfig } from "./scripted.js";

export type AdapterKind =
  | "openai"
  | "anthropic"
  | "ollama"
  | "openai-compatible"
  | "deepseek"
  | "groq"
  | "openrouter"
  | "lmstudio"
  | "vllm"
  | "scripted";

export interface AdapterSpec {
  kind: AdapterKind;
  model?: string;
  baseURL?: string;
  apiKey?: string;
  apiKeyEnv?: string;
  label?: string;
  headers?: Record<string, string>;
  allowMissingKey?: boolean;
  script?: ScriptedAdapterConfig["script"];
  textProtocol?: boolean;
}

export interface AdapterDescriptor {
  kind: AdapterKind;
  label: string;
  defaultModel: string;
  keyEnv?: string;
  baseURL?: string;
  local: boolean;
  notes?: string;
}

/** Everything the IDE's model picker needs. */
export const ADAPTER_CATALOG: AdapterDescriptor[] = [
  { kind: "openai", label: "OpenAI", defaultModel: "gpt-4o-mini", keyEnv: "OPENAI_API_KEY", local: false },
  { kind: "anthropic", label: "Anthropic Claude", defaultModel: "claude-sonnet-4-5", keyEnv: "ANTHROPIC_API_KEY", local: false },
  { kind: "deepseek", label: "DeepSeek", defaultModel: "deepseek-chat", keyEnv: "DEEPSEEK_API_KEY", baseURL: "https://api.deepseek.com/v1", local: false },
  { kind: "groq", label: "Groq", defaultModel: "llama-3.3-70b-versatile", keyEnv: "GROQ_API_KEY", baseURL: "https://api.groq.com/openai/v1", local: false },
  { kind: "openrouter", label: "OpenRouter", defaultModel: "anthropic/claude-3.5-sonnet", keyEnv: "OPENROUTER_API_KEY", baseURL: "https://openrouter.ai/api/v1", local: false },
  { kind: "ollama", label: "Ollama (local)", defaultModel: "qwen2.5-coder:7b", baseURL: "http://127.0.0.1:11434", local: true, notes: "Nothing leaves the machine." },
  { kind: "lmstudio", label: "LM Studio (local)", defaultModel: "local-model", baseURL: "http://127.0.0.1:1234/v1", local: true, notes: "Enable the local server in LM Studio." },
  { kind: "vllm", label: "vLLM (self-hosted)", defaultModel: "served-model", baseURL: "http://127.0.0.1:8000/v1", local: true },
  { kind: "openai-compatible", label: "Any OpenAI-compatible endpoint", defaultModel: "model", keyEnv: "OPENAI_API_KEY", local: false },
  { kind: "scripted", label: "Scripted replay (offline, no model)", defaultModel: "scripted", local: true, notes: "Tests and demos only. Proves the Harness, not the agent." },
];

export function createAdapter(spec: AdapterSpec, env: NodeJS.ProcessEnv = process.env): ModelAdapter {
  switch (spec.kind) {
    case "anthropic":
      return new AnthropicAdapter({
        apiKey: spec.apiKey,
        apiKeyEnv: spec.apiKeyEnv,
        baseURL: spec.baseURL,
        defaultModel: spec.model,
        label: spec.label,
      } as AnthropicConfig);
    case "ollama":
      return new OllamaAdapter({ baseURL: spec.baseURL, defaultModel: spec.model, label: spec.label } as OllamaConfig);
    case "scripted":
      return new ScriptedAdapter({ script: spec.script ?? [{ kind: "text", content: "No script provided." }], textProtocol: spec.textProtocol, label: spec.label });
    case "openai":
      return new OpenAICompatibleAdapter({
        id: "openai",
        label: spec.label ?? "OpenAI",
        baseURL: spec.baseURL ?? env.OPENAI_BASE_URL ?? "https://api.openai.com/v1",
        apiKey: spec.apiKey,
        apiKeyEnv: spec.apiKeyEnv ?? "OPENAI_API_KEY",
        defaultModel: spec.model ?? "gpt-4o-mini",
        headers: spec.headers,
      });
    case "deepseek":
      return new OpenAICompatibleAdapter({
        id: "deepseek",
        label: spec.label ?? "DeepSeek",
        baseURL: spec.baseURL ?? "https://api.deepseek.com/v1",
        apiKey: spec.apiKey,
        apiKeyEnv: spec.apiKeyEnv ?? "DEEPSEEK_API_KEY",
        defaultModel: spec.model ?? "deepseek-chat",
      });
    case "groq":
      return new OpenAICompatibleAdapter({
        id: "groq",
        label: spec.label ?? "Groq",
        baseURL: spec.baseURL ?? "https://api.groq.com/openai/v1",
        apiKey: spec.apiKey,
        apiKeyEnv: spec.apiKeyEnv ?? "GROQ_API_KEY",
        defaultModel: spec.model ?? "llama-3.3-70b-versatile",
      });
    case "openrouter":
      return new OpenAICompatibleAdapter({
        id: "openrouter",
        label: spec.label ?? "OpenRouter",
        baseURL: spec.baseURL ?? "https://openrouter.ai/api/v1",
        apiKey: spec.apiKey,
        apiKeyEnv: spec.apiKeyEnv ?? "OPENROUTER_API_KEY",
        defaultModel: spec.model ?? "openai/gpt-4o-mini",
        headers: { "HTTP-Referer": "https://sudarshanai.com", "X-Title": "Sudarshan Harness", ...(spec.headers ?? {}) },
      });
    case "lmstudio":
      return new OpenAICompatibleAdapter({
        id: "lmstudio",
        label: spec.label ?? "LM Studio (local)",
        baseURL: spec.baseURL ?? "http://127.0.0.1:1234/v1",
        apiKey: spec.apiKey ?? "lm-studio",
        allowMissingKey: true,
        defaultModel: spec.model ?? "local-model",
      });
    case "vllm":
      return new OpenAICompatibleAdapter({
        id: "vllm",
        label: spec.label ?? "vLLM (self-hosted)",
        baseURL: spec.baseURL ?? "http://127.0.0.1:8000/v1",
        apiKey: spec.apiKey ?? "EMPTY",
        allowMissingKey: true,
        defaultModel: spec.model ?? "served-model",
      });
    case "openai-compatible":
    default:
      return new OpenAICompatibleAdapter({
        id: spec.kind,
        label: spec.label ?? "OpenAI-compatible",
        baseURL: spec.baseURL ?? env.OPENAI_BASE_URL,
        apiKey: spec.apiKey,
        apiKeyEnv: spec.apiKeyEnv ?? "OPENAI_API_KEY",
        defaultModel: spec.model ?? "model",
        allowMissingKey: spec.allowMissingKey,
        headers: spec.headers,
      });
  }
}

export interface DetectedAdapter {
  spec: AdapterSpec;
  descriptor: AdapterDescriptor;
  available: boolean;
}

/**
 * Local-first ordering: a reachable local runtime is preferred over a cloud key,
 * because a local model keeps private data on the machine. Cloud providers are
 * still detected and offered.
 */
export function detectAdapters(env: NodeJS.ProcessEnv = process.env): DetectedAdapter[] {
  const detected: DetectedAdapter[] = [];
  for (const descriptor of ADAPTER_CATALOG) {
    if (descriptor.kind === "scripted") continue;
    if (descriptor.local) {
      // A local runtime is always *offered*; whether it is reachable can only be
      // answered by asking it. Use `probeAdapters()` for that.
      detected.push({
        descriptor,
        available: false,
        spec: { kind: descriptor.kind, model: env.SUDARSHAN_MODEL ?? descriptor.defaultModel, baseURL: descriptor.baseURL },
      });
      continue;
    }
    if (descriptor.keyEnv && !env[descriptor.keyEnv]) continue;
    detected.push({
      descriptor,
      available: true,
      spec: { kind: descriptor.kind, model: descriptor.defaultModel, baseURL: descriptor.baseURL, apiKeyEnv: descriptor.keyEnv },
    });
  }
  // Local runtimes first: local-first is a product principle, not a preference.
  return detected.sort((a, b) => Number(b.descriptor.local) - Number(a.descriptor.local));
}

/** Ask each local runtime whether it is actually listening (3s timeout each). */
export async function probeAdapters(env: NodeJS.ProcessEnv = process.env): Promise<DetectedAdapter[]> {
  const detected = detectAdapters(env);
  await Promise.all(
    detected.map(async (entry) => {
      if (!entry.descriptor.local) return;
      entry.available = await probeEndpoint(entry.spec.baseURL ?? entry.descriptor.baseURL, entry.descriptor.kind);
    }),
  );
  return detected.sort((a, b) => Number(b.available) - Number(a.available) || Number(b.descriptor.local) - Number(a.descriptor.local));
}

export async function probeEndpoint(baseURL: string | undefined, kind: AdapterKind): Promise<boolean> {
  if (!baseURL) return false;
  const url = kind === "ollama" ? `${baseURL.replace(/\/+$/, "")}/api/tags` : `${baseURL.replace(/\/+$/, "")}/models`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 2500);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

export function defaultAdapter(env: NodeJS.ProcessEnv = process.env): { adapter: ModelAdapter; spec: AdapterSpec; warning?: string } {
  const detected = detectAdapters(env);
  const spec = env.SUDARSHAN_ADAPTER ? (env.SUDARSHAN_ADAPTER as AdapterSpec["kind"]) : undefined;

  if (spec) {
    const descriptor = ADAPTER_CATALOG.find((d) => d.kind === spec);
    return {
      adapter: createAdapter({ kind: spec, model: env.SUDARSHAN_MODEL, baseURL: env.SUDARSHAN_BASE_URL }, env),
      spec: { kind: spec, model: env.SUDARSHAN_MODEL ?? descriptor?.defaultModel },
      warning: descriptor ? undefined : `unknown adapter kind "${spec}"`,
    };
  }

  if (detected.length > 0) {
    const first = detected[0]!;
    return {
      adapter: createAdapter({ ...first.spec, model: env.SUDARSHAN_MODEL ?? first.spec.model }, env),
      spec: { ...first.spec, model: env.SUDARSHAN_MODEL ?? first.spec.model },
      warning: first.descriptor.local ? undefined : `using cloud provider ${first.descriptor.label}; set SUDARSHAN_ADAPTER=ollama for a local-first run`,
    };
  }

  return {
    adapter: new ScriptedAdapter({ script: [{ kind: "text", content: "No model is configured. Set OPENAI_API_KEY, ANTHROPIC_API_KEY, or start Ollama." }] }),
    spec: { kind: "scripted" },
    warning:
      "no model credentials detected — falling back to the scripted adapter, which cannot perform real work. Configure a provider (OPENAI_API_KEY / ANTHROPIC_API_KEY / OLLAMA_BASE_URL) or pass --adapter.",
  };
}
