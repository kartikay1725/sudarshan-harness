import React, { useCallback, useEffect, useRef, useState } from "react";
import { api, subscribeEvents } from "./api.js";
import type { ApprovalView, HarnessEvent, RunDetail, SessionSnapshot } from "./types.js";
import { Badge, StatusBadge, cls } from "./ui.js";
import { LeftPanel } from "./components/LeftPanel.js";
import { CenterPanel, type RunRequest } from "./components/CenterPanel.js";
import { RightPanel } from "./components/RightPanel.js";
import { Dock, type DockTab } from "./components/Dock.js";

const REFRESH_ON = new Set([
  "run.created",
  "run.completed",
  "run.status_changed",
  "approval.requested",
  "approval.resolved",
  "capability.changed",
  "capability.installed",
  "capability.removed",
  "policy.updated",
  "rollback.completed",
]);

export function App() {
  const [session, setSession] = useState<SessionSnapshot>();
  const [events, setEvents] = useState<HarnessEvent[]>([]);
  const [runDetail, setRunDetail] = useState<RunDetail>();
  const [activeRunId, setActiveRunId] = useState<string>();
  const [connected, setConnected] = useState(false);
  const [streaming, setStreaming] = useState(false);
  const [error, setError] = useState<string>();
  const [notice, setNotice] = useState<string>();
  const [tab, setTab] = useState<DockTab>("security");
  const [transitionCount, setTransitionCount] = useState(0);
  const [busy, setBusy] = useState(false);
  const eventsRef = useRef<HarnessEvent[]>([]);

  const refresh = useCallback(async () => {
    try {
      const snapshot = await api.session();
      setSession(snapshot);
      setConnected(true);
      setError(undefined);
      return snapshot;
    } catch (err) {
      setConnected(false);
      setError(`daemon unreachable: ${(err as Error).message}`);
      return undefined;
    }
  }, []);

  const countTransitions = useCallback(async () => {
    try {
      const res = await api.transitions();
      setTransitionCount(res.transitions.length);
    } catch {
      setTransitionCount(0);
    }
  }, []);

  /* ---------------- live event stream ---------------- */
  useEffect(() => {
    const stream = subscribeEvents(
      (event) => {
        eventsRef.current = [...eventsRef.current.slice(-3999), event];
        setEvents(eventsRef.current);
        if (event.runId && event.type === "run.created") setActiveRunId(event.runId);
        if (REFRESH_ON.has(event.type)) {
          void refresh();
          void countTransitions();
        }
      },
      () => setStreaming(false),
      () => setStreaming(true),
    );
    void refresh();
    void countTransitions();
    const heartbeat = setInterval(() => {
      void refresh();
    }, 5000);
    return () => {
      stream.close();
      clearInterval(heartbeat);
    };
  }, [refresh, countTransitions]);

  /* ---------------- run detail polling ---------------- */
  useEffect(() => {
    if (!activeRunId) return;
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    const load = async () => {
      try {
        const detail = await api.run(activeRunId);
        if (cancelled) return;
        setRunDetail(detail);
        if (detail.run.finishedAt && timer) {
          clearInterval(timer);
          timer = undefined;
        }
      } catch {
        /* run may not be persisted yet */
      }
    };
    void load();
    timer = setInterval(() => void load(), 1200);
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [activeRunId]);

  /* ---------------- actions ---------------- */
  async function startRun(req: RunRequest) {
    setBusy(true);
    setNotice(undefined);
    try {
      await api.startRun({
        task: req.task,
        expectations: req.expectations,
        approvalMode: req.approvalMode,
        blindVerifier: req.blindVerifier,
      });
      await refresh();
      const snapshot = await api.session();
      if (snapshot?.runs[0]) setActiveRunId(snapshot.runs[0]!.id);
      setTab("security");
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function resolveApproval(id: string, status: "approved" | "denied", scope: "once" | "class", note?: string) {
    try {
      await api.resolveApproval(id, { status, scope, note });
      await refresh();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function loadExample(name: string) {
    setBusy(true);
    setNotice(undefined);
    try {
      const replay = await api.example(name);
      const result = await api.replay(replay);
      await refresh();
      setActiveRunId(result.run.id);
      setTab("verification");
      setNotice(`REPLAY · recorded decisions, real filesystem actions · scratch workspace ${result.workspaceRoot}`);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const approvals = (session?.pendingApprovals ?? []) as ApprovalView[];
  const decisions = (runDetail?.run.steps ?? []).flatMap((s) => s.actions);
  const verifications = decisions.filter((a) => a.verification);
  const status = runDetail?.run.status ?? session?.runs[0]?.status ?? "idle";

  return (
    <div className="ide">
      <header className="topbar">
        <div className="brand">
          <span className={cls("brand-mark", (session?.running ?? false) && "armed")} />
          <div>
            <div className="brand-name">Sudarshan</div>
            <div className="brand-sub">harness · control &amp; verification</div>
          </div>
        </div>

        <div className="topbar-fields">
          <Badge tone={connected ? "green" : "red"}>{connected ? "● daemon" : "○ daemon offline"}</Badge>
          <Badge tone={streaming ? "blue" : "amber"} title={streaming ? "server-sent events attached" : "event stream unavailable — falling back to polling"}>
            {streaming ? "live stream" : "polling"}
          </Badge>
          <Badge tone="blue">{session?.configured ? session.workspaceRoot : "no workspace"}</Badge>
          <Badge>{session?.adapterId ?? "no adapter"} · {session?.model ?? "no model"}</Badge>
          <Badge tone={decisions.filter((d) => !d.decision.allowed).length ? "red" : "green"}>
            {decisions.filter((d) => d.decision.allowed).length} allowed · {decisions.filter((d) => !d.decision.allowed).length} blocked
          </Badge>
          {session?.queue.length ? <Badge tone="violet">{session.queue.length} queued</Badge> : null}
        </div>

        <div className="topbar-status">
          <span className="principle">COMPLETED ≠ VERIFIED</span>
          <StatusBadge status={status} />
          {busy && <span className="spinner" />}
          <ExamplesMenu onPick={loadExample} disabled={busy} />
        </div>
      </header>

      {error && <div className="error-bar">⚠ {error}</div>}
      {notice && <div className="error-bar" style={{ background: "var(--amber-dim)", borderColor: "#5b4a12", color: "#fde68a" }}>{notice}</div>}

      <main className="main">
        <LeftPanel session={session} onChanged={() => void refresh()} />
        <CenterPanel
          session={session}
          events={activeRunId ? events.filter((e) => !e.runId || e.runId === activeRunId) : events}
          runDetail={runDetail}
          approvals={approvals}
          running={session?.running ?? false}
          onStart={(req) => void startRun(req)}
          onResolveApproval={(id, s, scope, note) => void resolveApproval(id, s, scope, note)}
        />
        <RightPanel runDetail={runDetail} session={session} onSelectRun={setActiveRunId} />
      </main>

      <Dock
        tab={tab}
        onTab={setTab}
        runDetail={runDetail}
        events={events}
        counts={{
          security: decisions.length,
          verification: verifications.length,
          provenance: session?.audit?.entries ?? 0,
          recovery: transitionCount,
          logs: events.length,
        }}
      />
    </div>
  );
}

function ExamplesMenu({ onPick, disabled }: { onPick: (name: string) => void; disabled: boolean }) {
  const [examples, setExamples] = useState<Array<{ name: string; task: string; steps: number }>>([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    api.examples()
      .then((res) => setExamples(res.examples))
      .catch(() => setExamples([]));
  }, []);

  if (examples.length === 0) return null;

  return (
    <div style={{ position: "relative" }}>
      <button className="tiny" disabled={disabled} onClick={() => setOpen((v) => !v)}>
        replay demo ▾
      </button>
      {open && (
        <div
          style={{
            position: "absolute",
            right: 0,
            top: "130%",
            width: 320,
            background: "var(--bg-panel)",
            border: "1px solid var(--border-strong)",
            borderRadius: 6,
            boxShadow: "0 12px 36px rgba(0,0,0,0.6)",
            zIndex: 50,
            padding: 6,
          }}
        >
          <div style={{ fontSize: 10.5, color: "var(--text-faint)", padding: "2px 6px 6px" }}>
            Recorded agent decisions replayed against a real scratch filesystem — no API key needed. The Harness still authorizes, executes and verifies for real.
          </div>
          {examples.map((ex) => (
            <button
              key={ex.name}
              className="ghost"
              style={{ display: "block", width: "100%", textAlign: "left", padding: "6px 8px" }}
              onClick={() => {
                setOpen(false);
                onPick(ex.name);
              }}
            >
              <div style={{ fontSize: 12, color: "var(--text)" }}>{ex.name}</div>
              <div style={{ fontSize: 11, color: "var(--text-faint)" }}>
                {ex.task} · {ex.steps} step(s)
              </div>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
