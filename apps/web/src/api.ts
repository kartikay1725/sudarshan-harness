import type { AuditEntryView, HarnessEvent, RunDetail, SessionSnapshot, TransitionView } from "./types.js";

const BASE = "";

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { "content-type": "application/json", ...(init?.headers ?? {}) },
  });
  const text = await res.text();
  const payload = text ? (JSON.parse(text) as T) : ({} as T);
  if (!res.ok) {
    const message = (payload as { error?: string }).error ?? `HTTP ${res.status}`;
    throw new Error(message);
  }
  return payload;
}

export const api = {
  health: () => request<{ ok: boolean; version: string }>("/api/health"),
  session: () => request<SessionSnapshot>("/api/session"),
  configure: (config: Record<string, unknown>) =>
    request<SessionSnapshot>("/api/session", { method: "POST", body: JSON.stringify(config) }),
  doctor: () => request<Record<string, unknown>>("/api/doctor"),
  adapters: () => request<{ catalog: Array<Record<string, unknown>>; detected: Array<Record<string, unknown>> }>("/api/adapters"),
  capabilityCatalog: () => request<{ catalog: Array<Record<string, unknown>>; presets: Record<string, { label: string; description: string; capabilities: string[] }> }>("/api/capabilities/catalog"),
  setCapability: (id: string, enabled: boolean) =>
    request<SessionSnapshot>(`/api/capabilities/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify({ enabled }) }),
  setCapabilities: (enabled: string[]) =>
    request<SessionSnapshot>("/api/capabilities", { method: "POST", body: JSON.stringify({ enabled }) }),
  startRun: (body: { task: string; expectations?: string[]; approvalMode?: string; blindVerifier?: boolean; model?: string }) =>
    request<{ queued: boolean }>("/api/runs", { method: "POST", body: JSON.stringify(body) }),
  runs: () => request<{ runs: unknown[] }>("/api/runs"),
  run: (id: string) => request<RunDetail>(`/api/runs/${encodeURIComponent(id)}`),
  approvals: () => request<{ pending: unknown[]; all: unknown[] }>("/api/approvals"),
  resolveApproval: (id: string, body: { status: "approved" | "denied"; scope?: "once" | "class" | "run"; note?: string }) =>
    request<Record<string, unknown>>(`/api/approvals/${encodeURIComponent(id)}`, { method: "POST", body: JSON.stringify(body) }),
  audit: (limit = 400, runId?: string) =>
    request<{ chain: { ok: boolean; entries: number; head: string; brokenAtSeq?: number }; entries: AuditEntryView[] }>(
      `/api/audit?limit=${limit}${runId ? `&runId=${encodeURIComponent(runId)}` : ""}`,
    ),
  transitions: () => request<{ transitions: TransitionView[] }>("/api/transitions"),
  rollback: (transitionId: string) =>
    request<{ ok: boolean; detail: string; verified: boolean }>(`/api/transitions/${encodeURIComponent(transitionId)}/rollback`, { method: "POST" }),
  parseSpec: (content: string) => request<{ spec: Record<string, unknown>; warnings: string[]; checks: string[] }>("/api/spec/parse", { method: "POST", body: JSON.stringify({ content }) }),
  specTemplate: () => request<{ template: string }>("/api/spec/template"),
  promptPreview: (task: string) => request<{ prompt: string }>("/api/prompt", { method: "POST", body: JSON.stringify({ task }) }),
  examples: () => request<{ examples: Array<{ name: string; task: string; steps: number }> }>("/api/examples"),
  example: (name: string) => request<Record<string, unknown>>(`/api/examples/${encodeURIComponent(name)}`),
  replay: (replay: Record<string, unknown>) =>
    request<{ run: { id: string }; workspaceRoot: string; warnings: string[] }>("/api/replay", { method: "POST", body: JSON.stringify({ replay }) }),
};

export interface EventStream {
  close(): void;
}

/** Server-Sent Events from the daemon: the IDE's only source of live truth. */
export function subscribeEvents(
  onEvent: (event: HarnessEvent) => void,
  onError?: (err: Event) => void,
  onReady?: (info: unknown) => void,
): EventStream {
  const source = new EventSource(`${BASE}/api/events`);
  source.addEventListener("ready", (message) => {
    try {
      onReady?.(JSON.parse((message as MessageEvent).data));
    } catch {
      onReady?.(undefined);
    }
  });
  source.onopen = () => onReady?.({ open: true });
  source.onmessage = (message) => {
    try {
      onEvent(JSON.parse(message.data) as HarnessEvent);
    } catch {
      /* ignore malformed frames */
    }
  };
  source.onerror = (err) => onError?.(err);
  return { close: () => source.close() };
}
