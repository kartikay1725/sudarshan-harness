/**
 * @sudarshan/adapters — model independence.
 *
 * The security system, the capabilities and the verification engine do not
 * change when the intelligence provider changes. Only this layer does.
 */
export { OpenAICompatibleAdapter, toOpenAIMessages, toOpenAITool, parseArguments } from "./openaiCompatible.js";
export type { OpenAICompatibleConfig } from "./openaiCompatible.js";
export { AnthropicAdapter, toAnthropicMessages } from "./anthropic.js";
export type { AnthropicConfig } from "./anthropic.js";
export { OllamaAdapter } from "./ollama.js";
export type { OllamaConfig } from "./ollama.js";
export { ScriptedAdapter } from "./scripted.js";
export type { ScriptedAdapterConfig, ScriptEntry, ScriptStep, ScriptContext } from "./scripted.js";
export { createAdapter, detectAdapters, probeAdapters, probeEndpoint, defaultAdapter, ADAPTER_CATALOG } from "./factory.js";
export type { AdapterKind, AdapterSpec, AdapterDescriptor, DetectedAdapter } from "./factory.js";
