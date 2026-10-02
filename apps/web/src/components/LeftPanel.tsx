import React, { useEffect, useState } from "react";
import { api } from "../api.js";
import type { SessionSnapshot } from "../types.js";
import { Badge, Empty, Panel, StatusBadge, cls } from "../ui.js";

interface AdapterOption {
  kind: string;
  label: string;
  local: boolean;
  available: boolean;
  defaultModel: string;
  keyEnv?: string;
}

export function LeftPanel({
  session,
  onChanged,
}: {
  session: SessionSnapshot | undefined;
  onChanged: () => void;
}) {
  const [workspaceRoot, setWorkspaceRoot] = useState(session?.workspaceRoot ?? "");
  const [adapterKind, setAdapterKind] = useState("openai");
  const [model, setModel] = useState("");
  const [adapters, setAdapters] = useState<AdapterOption[]>([]);
  const [presets, setPresets] = useState<Record<string, { label: string; description: string; capabilities: string[] }>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string } | undefined>();
  const [prompt, setPrompt] = useState<string>();
  const [promptBusy, setPromptBusy] = useState(false);

  useEffect(() => {
    if (session?.workspaceRoot) setWorkspaceRoot(session.workspaceRoot);
    if (session?.adapterId) setAdapterKind(session.adapterId);
    if (session?.model) setModel(session.model);
  }, [session?.workspaceRoot, session?.adapterId, session?.model]);

  useEffect(() => {
    api.adapters()
      .then((res) => {
        const detected = res.detected as unknown as AdapterOption[];
        const rest = (res.catalog as unknown as AdapterOption[]).filter((c) => !detected.some((d) => d.kind === c.kind));
        setAdapters([...detected, ...rest]);
      })
      .catch(() => setAdapters([]));
    api.capabilityCatalog()
      .then((res) => setPresets(res.presets))
      .catch(() => undefined);
  }, []);

  async function applySession() {
    setBusy(true);
    setMessage(undefined);
    try {
      await api.configure({ workspaceRoot, adapter: { kind: adapterKind, model: model || undefined }, model: model || undefined });
      setMessage({ tone: "good", text: "session reconfigured" });
      onChanged();
    } catch (err) {
      setMessage({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function toggleCapability(id: string, enabled: boolean) {
    setBusy(true);
    try {
      await api.setCapability(id, enabled);
      onChanged();
    } catch (err) {
      setMessage({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  async function applyPreset(ids: string[]) {
    setBusy(true);
    try {
      await api.setCapabilities(ids);
      onChanged();
    } catch (err) {
      setMessage({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(false);
    }
  }

  const enabledCount = session?.capabilities.filter((c) => c.enabled).length ?? 0;

  return (
    <div className="column left">
      <Panel title="Session" count={session?.configured ? "configured" : "not configured"}>
        <label className="field">
          <span>workspace root</span>
          <input type="text" value={workspaceRoot} onChange={(e) => setWorkspaceRoot(e.target.value)} spellCheck={false} />
        </label>
        <div className="row" style={{ marginBottom: 9 }}>
          <label className="field" style={{ flex: 1, marginBottom: 0 }}>
            <span>model adapter</span>
            <select value={adapterKind} onChange={(e) => setAdapterKind(e.target.value)}>
              {adapters.map((a) => (
                <option key={a.kind} value={a.kind}>
                  {a.label}
                  {a.local ? " · local" : a.available ? "" : " · no key"}
                </option>
              ))}
              {adapters.length === 0 && <option value={adapterKind}>{adapterKind}</option>}
            </select>
          </label>
          <label className="field" style={{ flex: 1, marginBottom: 0 }}>
            <span>model</span>
            <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o-mini" spellCheck={false} />
          </label>
        </div>
        <div className="row">
          <button className="primary" onClick={applySession} disabled={busy || !workspaceRoot}>
            {busy ? "applying…" : "apply session"}
          </button>
          <button
            className="ghost"
            onClick={async () => {
              try {
                const report = await api.doctor();
                const problems = (report.problems as string[]) ?? [];
                setMessage(problems.length ? { tone: "bad", text: problems.join(" · ") } : { tone: "good", text: "doctor: everything checks out" });
              } catch (err) {
                setMessage({ tone: "bad", text: (err as Error).message });
              }
            }}
          >
            run doctor
          </button>
        </div>
        {message && (
          <div className={cls("notice", message.tone === "bad" ? "bad" : "good")} style={{ marginTop: 8 }}>
            {message.text}
          </div>
        )}
        {session && session.warnings.length > 0 && (
          <div style={{ marginTop: 8 }}>
            {session.warnings.slice(0, 4).map((w, i) => (
              <div key={i} className="notice warn">
                {w}
                {/not available/i.test(w) && (
                  <div style={{ marginTop: 4, color: "var(--text-faint)" }}>
                    export OPENAI_API_KEY=… · ANTHROPIC_API_KEY=… · or run `ollama serve` for a local model, then restart the daemon. Local-first: keys never leave this machine.
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </Panel>

      <Panel
        title="Capabilities"
        count={`${enabledCount}/${session?.capabilities.length ?? 0} installed`}
        actions={
          <span className="row tight">
            {Object.entries(presets).map(([key, preset]) => (
              <button key={key} className="tiny ghost" title={preset.description} onClick={() => applyPreset(preset.capabilities)}>
                {preset.label.split(" ")[0]}
              </button>
            ))}
          </span>
        }
      >
        {session?.capabilities.length === 0 && <Empty>Nothing installed. The core stays; the tools are yours to choose.</Empty>}
        {session?.capabilities.map((cap) => (
          <div key={cap.id} className={cls("cap", cap.enabled && "on")} onClick={() => toggleCapability(cap.id, !cap.enabled)}>
            <input type="checkbox" checked={cap.enabled} readOnly />
            <div>
              <div className="cap-name">
                {cap.descriptor?.name ?? cap.id}
                <Badge tone={cap.enabled ? "blue" : ""}>{cap.enabled ? "installed" : "removed"}</Badge>
                {cap.source !== "builtin" && <Badge tone="violet">{cap.source}</Badge>}
              </div>
              <div className="cap-desc">{cap.descriptor?.description ?? `${cap.tools.length} tool(s)`}</div>
              <div className="cap-tools">{cap.tools.join(" · ")}</div>
              {cap.enabled && cap.missingPermissions.length > 0 && (
                <div className="cap-warn">not granted: {cap.missingPermissions.join(", ")}</div>
              )}
            </div>
            <Badge tone={cap.descriptor?.risk === "high" ? "red" : cap.descriptor?.risk === "medium" ? "amber" : "green"}>{cap.descriptor?.risk ?? "low"}</Badge>
          </div>
        ))}
        <div className="notice" style={{ marginTop: 8 }}>
          Removing a capability removes its tools from the model's view <em>and</em> from the authorization gate. The security architecture is unchanged either way.
        </div>
      </Panel>

      <Panel title="Specification" count={session?.spec ? "agent.md" : "none"}>
        {!session?.spec && (
          <Empty>
            No agent.md in this workspace. Run <code>sudarshan init</code> or add one to describe persona, rules, capabilities and acceptance criteria.
          </Empty>
        )}
        {session?.spec && (
          <>
            <div className="kv">
              <span className="k">name</span>
              <span className="v">{session.spec.name ?? "(unnamed)"}</span>
              <span className="k">path</span>
              <span className="v">{session.spec.path}</span>
              <span className="k">capabilities</span>
              <span className="v">{session.spec.capabilities.join(", ") || "(none)"}</span>
              <span className="k">rules</span>
              <span className="v">{session.spec.rules.length}</span>
              <span className="k">acceptance</span>
              <span className="v">{session.spec.verification.length} deterministic check(s)</span>
            </div>
            {session.spec.persona && (
              <div className="notice" style={{ marginTop: 8 }}>
                <strong>persona</strong>
                <div style={{ whiteSpace: "pre-wrap" }}>{session.spec.persona.slice(0, 400)}</div>
              </div>
            )}
            {session.spec.rules.length > 0 && (
              <ul style={{ paddingLeft: 16, margin: "8px 0 0", color: "var(--text-dim)", fontSize: 11.5 }}>
                {session.spec.rules.map((r, i) => (
                  <li key={i}>{r}</li>
                ))}
              </ul>
            )}
            {session.spec.verification.length > 0 && (
              <details style={{ marginTop: 8 }}>
                <summary style={{ cursor: "pointer", fontSize: 10.5, fontFamily: "var(--mono)", color: "var(--text-faint)", textTransform: "uppercase", letterSpacing: "0.08em" }}>
                  acceptance criteria ({session.spec.verification.length}) — checked against real state
                </summary>
                <div style={{ marginTop: 6 }}>
                  {session.spec.verification.map((check, i) => (
                    <div key={i} className="check pass">
                      <span className="mark">◈</span>
                      <span className="label" style={{ fontSize: 10.5, color: "var(--text-dim)" }}>{check}</span>
                    </div>
                  ))}
                </div>
              </details>
            )}
            <div className="row" style={{ marginTop: 10 }}>
              <button
                className="tiny"
                disabled={promptBusy}
                onClick={async () => {
                  if (prompt) {
                    setPrompt(undefined);
                    return;
                  }
                  setPromptBusy(true);
                  try {
                    const res = await api.promptPreview("(task preview)");
                    setPrompt(res.prompt);
                  } catch (err) {
                    setPrompt(`failed: ${(err as Error).message}`);
                  } finally {
                    setPromptBusy(false);
                  }
                }}
              >
                {prompt ? "hide system prompt" : "view the exact system prompt"}
              </button>
            </div>
            {prompt && (
              <pre style={{ marginTop: 6, background: "var(--bg-inset)", border: "1px solid var(--border)", borderRadius: 6, padding: 8, fontSize: 10.5, whiteSpace: "pre-wrap", maxHeight: 260, overflow: "auto", color: "var(--text-dim)" }}>
                {prompt}
              </pre>
            )}
          </>
        )}
      </Panel>

      <Panel title="Policy" count={session?.policy ? "active" : "—"}>
        {!session?.policy && <Empty>No policy yet.</Empty>}
        {session?.policy && (
          <>
            <div className="kv">
              <span className="k">deny by default</span>
              <span className="v">{String(session.policy.denyByDefault)}</span>
              <span className="k">permissions</span>
              <span className="v">{session.policy.permissions.join(", ")}</span>
              <span className="k">protected</span>
              <span className="v">{session.policy.protectedPaths.length} path patterns</span>
              <span className="k">rules</span>
              <span className="v">{session.policy.rules.length}</span>
              <span className="k">budgets</span>
              <span className="v">
                steps {session.policy.budgets.maxSteps} · calls {session.policy.budgets.maxToolCalls} · tokens {Number(session.policy.budgets.maxTokens).toLocaleString()}
              </span>
            </div>
            <div style={{ marginTop: 8 }}>
              {session.policy.rules.map((rule, i) => (
                <div key={i} className="row tight" style={{ marginBottom: 3 }}>
                  <Badge tone={rule.effect === "deny" ? "red" : rule.requireApproval ? "violet" : "green"}>{rule.effect === "deny" ? "DENY" : rule.requireApproval ? "APPROVAL" : "ALLOW"}</Badge>
                  <span className="mono" style={{ fontSize: 10.5, color: "var(--text-faint)" }}>
                    {rule.tool ?? rule.permission ?? "*"}
                  </span>
                  <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>{rule.reason}</span>
                </div>
              ))}
            </div>
            {session.audit && (
              <div className="row" style={{ marginTop: 10 }}>
                <StatusBadge status={session.audit.ok ? "passed" : "failed"} label={session.audit.ok ? "audit chain intact" : "audit chain broken"} />
                <span className="hash">{session.audit.entries} entries · {session.audit.head.slice(0, 12)}…</span>
              </div>
            )}
          </>
        )}
      </Panel>
    </div>
  );
}
