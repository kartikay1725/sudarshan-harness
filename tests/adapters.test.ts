import { describe, expect, it } from "vitest";
import { ADAPTER_CATALOG, AnthropicAdapter, OpenAICompatibleAdapter, OllamaAdapter, ScriptedAdapter, createAdapter, detectAdapters, toAnthropicMessages } from "@sudarshan/adapters";
import { resolveToolName, parseTextProtocol } from "@sudarshan/core";
import type { ChatMessage } from "@sudarshan/core";

function jsonResponse(payload: unknown): Response {
  return new Response(JSON.stringify(payload), { status: 200, headers: { "content-type": "application/json" } });
}

describe("model independence", () => {
  it("offers a catalog covering cloud, local and self-hosted providers", () => {
    const kinds = ADAPTER_CATALOG.map((d) => d.kind);
    for (const expected of ["openai", "anthropic", "ollama", "lmstudio", "vllm", "deepseek", "groq", "openrouter", "scripted"]) {
      expect(kinds).toContain(expected);
    }
    expect(ADAPTER_CATALOG.filter((d) => d.local).length).toBeGreaterThanOrEqual(4);
  });

  it("detects providers from the environment, local-first", () => {
    const detected = detectAdapters({ OPENAI_API_KEY: "sk-test", ANTHROPIC_API_KEY: "sk-ant-test" } as NodeJS.ProcessEnv);
    const labels = detected.map((d) => d.descriptor.kind);
    expect(labels).toContain("openai");
    expect(labels).toContain("anthropic");
    // Local runtimes are always offered, ahead of cloud keys.
    expect(labels[0]).toMatch(/ollama|lmstudio|vllm/);
    expect(detected.find((d) => d.descriptor.kind === "openai")?.available).toBe(true);
  });

  it("does not detect a cloud provider without a key", () => {
    const detected = detectAdapters({} as NodeJS.ProcessEnv);
    expect(detected.some((d) => d.descriptor.kind === "openai")).toBe(false);
  });

  it("creates the right adapter class per kind", () => {
    expect(createAdapter({ kind: "anthropic" })).toBeInstanceOf(AnthropicAdapter);
    expect(createAdapter({ kind: "ollama" })).toBeInstanceOf(OllamaAdapter);
    expect(createAdapter({ kind: "openai" })).toBeInstanceOf(OpenAICompatibleAdapter);
    expect(createAdapter({ kind: "lmstudio" })).toBeInstanceOf(OpenAICompatibleAdapter);
    expect(createAdapter({ kind: "scripted", script: [] })).toBeInstanceOf(ScriptedAdapter);
  });
});

describe("OpenAI-compatible adapter", () => {
  it("sends tools and parses tool_calls back", async () => {
    let captured: Record<string, unknown> | undefined;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body)) as Record<string, unknown>;
      return jsonResponse({
        choices: [
          {
            message: {
              content: "Writing the file.",
              tool_calls: [{ id: "call_1", type: "function", function: { name: "filesystem.write", arguments: '{"path":"a.txt","content":"hi"}' } }],
            },
            finish_reason: "tool_calls",
          },
        ],
        usage: { prompt_tokens: 120, completion_tokens: 30, total_tokens: 150 },
      });
    }) as unknown as typeof fetch;

    const adapter = new OpenAICompatibleAdapter({ apiKey: "sk-test", fetchImpl: fakeFetch, defaultModel: "gpt-4o-mini" });
    expect(adapter.available()).toBe(true);

    const res = await adapter.complete({
      model: "gpt-4o-mini",
      messages: [
        { role: "system", content: "You are governed." },
        { role: "user", content: "Write a.txt" },
      ],
      tools: [{ name: "filesystem.write", description: "write", parameters: { type: "object", properties: {} } }],
    });

    expect(captured?.model).toBe("gpt-4o-mini");
    expect((captured?.tools as unknown[]).length).toBe(1);
    expect(captured?.tool_choice).toBe("auto");
    expect(res.toolCalls[0]!.name).toBe("filesystem.write");
    expect(res.toolCalls[0]!.arguments).toEqual({ path: "a.txt", content: "hi" });
    expect(res.stopReason).toBe("tool_use");
    expect(res.usage.totalTokens).toBe(150);
  });

  it("sends prior tool results back with tool_call_id", async () => {
    let captured: Record<string, unknown> | undefined;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body)) as Record<string, unknown>;
      return jsonResponse({ choices: [{ message: { content: "done" }, finish_reason: "stop" }], usage: {} });
    }) as unknown as typeof fetch;

    const adapter = new OpenAICompatibleAdapter({ apiKey: "sk-test", fetchImpl: fakeFetch });
    const messages: ChatMessage[] = [
      { role: "system", content: "sys" },
      { role: "user", content: "task" },
      { role: "assistant", content: "", toolCalls: [{ id: "call_9", name: "filesystem.read", arguments: { path: "a.txt" } }] },
      { role: "tool", toolCallId: "call_9", content: "HARNESS VERIFICATION: PASSED" },
    ];
    const res = await adapter.complete({ model: "m", messages });
    const sent = captured?.messages as Array<Record<string, unknown>>;
    expect(sent[0]!.role).toBe("system");
    expect(sent[2]!.tool_calls).toBeDefined();
    expect(sent[3]).toMatchObject({ role: "tool", tool_call_id: "call_9", content: "HARNESS VERIFICATION: PASSED" });
    expect(res.stopReason).toBe("end_turn");
  });

  it("surfaces HTTP errors instead of inventing a result", async () => {
    const fakeFetch = (async () => new Response("rate limited", { status: 429 })) as unknown as typeof fetch;
    const adapter = new OpenAICompatibleAdapter({ apiKey: "sk-test", fetchImpl: fakeFetch });
    await expect(adapter.complete({ model: "m", messages: [{ role: "user", content: "hi" }] })).rejects.toThrow(/429/);
  });

  it("recovers from sloppy JSON arguments", async () => {
    const fakeFetch = (async () =>
      jsonResponse({
        choices: [{ message: { content: "", tool_calls: [{ id: "c", function: { name: "filesystem.write", arguments: "{'path':'a.txt','content':'x',}" } }] }, finish_reason: "tool_calls" }],
        usage: {},
      })) as unknown as typeof fetch;
    const adapter = new OpenAICompatibleAdapter({ apiKey: "k", fetchImpl: fakeFetch });
    const res = await adapter.complete({ model: "m", messages: [{ role: "user", content: "go" }] });
    expect(res.toolCalls[0]!.arguments).toEqual({ path: "a.txt", content: "x" });
  });

  it("is unavailable without a key", () => {
    const adapter = new OpenAICompatibleAdapter({ apiKeyEnv: "NOT_SET_ANYWHERE", fetchImpl: fetch });
    expect(adapter.available()).toBe(false);
  });
});

describe("Anthropic adapter", () => {
  it("converts Harness messages into blocks and parses tool_use", async () => {
    let captured: Record<string, unknown> | undefined;
    const fakeFetch = (async (_url: string, init: RequestInit) => {
      captured = JSON.parse(String(init.body)) as Record<string, unknown>;
      return jsonResponse({
        content: [
          { type: "text", text: "Creating the file." },
          { type: "tool_use", id: "tu_1", name: "filesystem.write", input: { path: "a.txt", content: "hi" } },
        ],
        stop_reason: "tool_use",
        usage: { input_tokens: 200, output_tokens: 40 },
      });
    }) as unknown as typeof fetch;

    const adapter = new AnthropicAdapter({ apiKey: "sk-ant", fetchImpl: fakeFetch });
    const res = await adapter.complete({
      model: "claude-sonnet-4-5",
      system: "You are governed by the Harness.",
      messages: [
        { role: "system", content: "ignored duplicate" },
        { role: "user", content: "Write a.txt" },
        { role: "assistant", content: "", toolCalls: [{ id: "tu_0", name: "filesystem.read", arguments: { path: "a.txt" } }] },
        { role: "tool", toolCallId: "tu_0", content: "PASSED" },
      ],
      tools: [{ name: "filesystem.write", description: "write", parameters: { type: "object", properties: {} } }],
    });

    expect(captured?.system).toBe("You are governed by the Harness.");
    const messages = captured?.messages as Array<{ role: string; content: unknown }>;
    expect(messages[0]!.role).toBe("user");
    expect(messages[1]!.role).toBe("assistant");
    // Two consecutive tool results would merge; one becomes a single user turn.
    expect(messages[2]!.role).toBe("user");
    expect(JSON.stringify(messages[2]!.content)).toContain("tool_result");
    expect(res.toolCalls[0]!.arguments).toEqual({ path: "a.txt", content: "hi" });
    expect(res.usage.promptTokens).toBe(200);
    expect(res.stopReason).toBe("tool_use");
  });

  it("merges consecutive tool results into one user turn", () => {
    const converted = toAnthropicMessages([
      { role: "user", content: "task" },
      { role: "assistant", content: "", toolCalls: [
        { id: "a", name: "t.one", arguments: {} },
        { id: "b", name: "t.two", arguments: {} },
      ] },
      { role: "tool", toolCallId: "a", content: "A ok" },
      { role: "tool", toolCallId: "b", content: "B ok" },
    ]);
    const last = converted[converted.length - 1]!;
    expect(last.role).toBe("user");
    expect(Array.isArray(last.content)).toBe(true);
    expect((last.content as unknown[]).length).toBe(2);
  });
});

describe("Ollama adapter (local-first)", () => {
  it("posts to /api/chat and reads native tool_calls objects", async () => {
    let url = "";
    const fakeFetch = (async (u: string, init: RequestInit) => {
      url = String(u);
      const body = JSON.parse(String(init.body)) as Record<string, unknown>;
      expect(body.stream).toBe(false);
      return jsonResponse({
        message: { role: "assistant", content: "", tool_calls: [{ function: { name: "filesystem.write", arguments: { path: "a.txt", content: "hi" } } }] },
        done_reason: "stop",
        prompt_eval_count: 500,
        eval_count: 25,
      });
    }) as unknown as typeof fetch;

    const adapter = new OllamaAdapter({ baseURL: "http://127.0.0.1:11434", fetchImpl: fakeFetch, defaultModel: "qwen2.5-coder:7b" });
    const res = await adapter.complete({ model: "", messages: [{ role: "user", content: "go" }] });
    expect(url).toBe("http://127.0.0.1:11434/api/chat");
    expect(res.toolCalls[0]!.name).toBe("filesystem.write");
    expect(res.usage.totalTokens).toBe(525);
    expect(res.adapterId).toBe("ollama");
  });

  it("probes the local server and reports unavailability honestly", async () => {
    const failing = (async () => {
      throw new Error("ECONNREFUSED");
    }) as unknown as typeof fetch;
    const adapter = new OllamaAdapter({ fetchImpl: failing });
    const probe = await adapter.probe();
    expect(probe.ok).toBe(false);
    expect(adapter.available()).toBe(false);
  });
});

describe("adapters without native tool calling", () => {
  it("parses fenced tool blocks from the text protocol", () => {
    const content = [
      "I will create the file now.",
      "```tool",
      '{"name": "filesystem.write", "arguments": {"path": "a.txt", "content": "hi"}}',
      "```",
    ].join("\n");
    const calls = parseTextProtocol(content);
    expect(calls.length).toBe(1);
    expect(calls[0]!.name).toBe("filesystem.write");
    expect(calls[0]!.arguments).toEqual({ path: "a.txt", content: "hi" });
  });

  it("ignores prose that merely mentions tools", () => {
    expect(parseTextProtocol("I could call filesystem.write if I wanted.").length).toBe(0);
  });

  it("resolves a bare tool name to the unique installed match", () => {
    const installed = ["filesystem.read", "filesystem.write", "terminal.exec"];
    expect(resolveToolName("write", installed)).toBe("filesystem.write");
    expect(resolveToolName("FILESYSTEM.WRITE", installed)).toBe("filesystem.write");
    expect(resolveToolName("browser.navigate", installed)).toBeUndefined();
  });

  it("never resolves an ambiguous name", () => {
    const installed = ["a.read", "b.read"];
    expect(resolveToolName("read", installed)).toBeUndefined();
  });

  it("ScriptedAdapter emits the text protocol when configured", async () => {
    const adapter = new ScriptedAdapter({
      textProtocol: true,
      script: [{ kind: "tool", name: "filesystem.write", arguments: { path: "a.txt", content: "x" } }],
    });
    expect(adapter.supportsTools).toBe(false);
    const res = await adapter.complete({ model: "scripted", messages: [{ role: "user", content: "go" }] });
    expect(res.toolCalls.length).toBe(0);
    expect(parseTextProtocol(res.content).length).toBe(1);
  });
});
