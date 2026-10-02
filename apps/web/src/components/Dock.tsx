import React, { useCallback, useEffect, useState } from "react";
import { api } from "../api.js";
import type { AuditEntryView, HarnessEvent, RunDetail, TransitionView } from "../types.js";
import { Badge, CheckList, Empty, StatusBadge, cls, shortHash, stringify, timeOf } from "../ui.js";

export type DockTab = "security" | "verification" | "provenance" | "recovery" | "logs";

export const DOCK_TABS: Array<{ id: DockTab; label: string }> = [
  { id: "security", label: "Security" },
  { id: "verification", label: "Verification" },
  { id: "provenance", label: "Provenance" },
  { id: "recovery", label: "Recovery" },
  { id: "logs", label: "Logs" },
];

export function Dock({
  tab,
  onTab,
  runDetail,
  events,
  counts,
}: {
  tab: DockTab;
  onTab: (tab: DockTab) => void;
  runDetail: RunDetail | undefined;
  events: HarnessEvent[];
  counts: { security: number; verification: number; provenance: number; recovery: number; logs: number };
}) {
  return (
    <div className="dock">
      <div className="dock-tabs">
        {DOCK_TABS.map((t) => (
          <button key={t.id} className={cls("dock-tab", tab === t.id && "active")} onClick={() => onTab(t.id)}>
            {t.label}
            <span className="pip">{counts[t.id]}</span>
          </button>
        ))}
        <span style={{ marginLeft: "auto", fontFamily: "var(--mono)", fontSize: 10, color: "var(--text-faint)", paddingRight: 6 }}>
          harness &gt; agent · real state &gt; model claim
        </span>
      </div>
      <div className="dock-body">
        {tab === "security" && <SecurityTab runDetail={runDetail} />}
        {tab === "verification" && <VerificationTab runDetail={runDetail} />}
        {tab === "provenance" && <ProvenanceTab runId={runDetail?.run.id} />}
        {tab === "recovery" && <RecoveryTab runDetail={runDetail} />}
        {tab === "logs" && <LogsTab events={events} />}
      </div>
    </div>
  );
}

function SecurityTab({ runDetail }: { runDetail: RunDetail | undefined }) {
  const rows = (runDetail?.run.steps ?? []).flatMap((s) => s.actions);
  if (rows.length === 0) return <Empty>No authorization decisions yet. Every action request is recorded here — allowed or blocked, with the rule that decided it.</Empty>;
  return (
    <table className="grid">
      <thead>
        <tr>
          <th>step</th>
          <th>tool</th>
          <th>decision</th>
          <th>risk</th>
          <th>reversibility</th>
          <th>approval</th>
          <th>reason / rule</th>
          <th>targets</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((action) => (
          <tr key={action.id}>
            <td>{action.stepId.slice(-4)}</td>
            <td style={{ color: "var(--text)" }}>{action.tool}</td>
            <td className={action.decision.allowed ? "ok" : "no"}>{action.decision.allowed ? "ALLOW" : `BLOCK ${action.decision.code ?? ""}`}</td>
            <td className={action.decision.risk === "high" || action.decision.risk === "critical" ? "no" : action.decision.risk === "medium" ? "warn" : "ok"}>{action.decision.risk}</td>
            <td className={action.decision.reversibility === "irreversible" ? "no" : action.decision.reversibility === "reversible" ? "ok" : "warn"}>{action.decision.reversibility}</td>
            <td>{action.decision.approvalRequired ? "required" : "—"}</td>
            <td title={stringify(action.decision, 2000)}>
              {action.decision.reason}
              {action.decision.ruleId ? ` [${action.decision.ruleId}]` : ""}
            </td>
            <td>{action.decision.targets.map((t) => t.value).join(" ")}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function VerificationTab({ runDetail }: { runDetail: RunDetail | undefined }) {
  const run = runDetail?.run;
  const summary = run?.summary;
  const actions = (run?.steps ?? []).flatMap((s) => s.actions).filter((a) => a.verification);
  if (!run) return <Empty>No verification yet.</Empty>;
  return (
    <div>
      <div className="row tight" style={{ marginBottom: 8 }}>
        <StatusBadge status={run.status} />
        <Badge tone={summary?.harnessVerified ? "green" : "red"} solid>
          harness: {summary?.harnessVerified ? "VERIFIED" : "NOT VERIFIED"}
        </Badge>
        <Badge tone={summary?.agentClaimedComplete ? "amber" : ""}>agent claim: {summary?.agentClaimedComplete ? "COMPLETED" : "none"}</Badge>
        <Badge tone="green">{summary?.verificationsPassed ?? 0} checks passed</Badge>
        <Badge tone={(summary?.verificationsFailed ?? 0) > 0 ? "red" : ""}>{summary?.verificationsFailed ?? 0} failed</Badge>
        <span style={{ fontSize: 11, color: "var(--text-faint)" }}>{summary?.explanation}</span>
      </div>

      {summary?.blindVerification && (
        <div className="notice" style={{ borderLeftColor: "var(--violet)", marginBottom: 10 }}>
          <strong style={{ color: "var(--violet)" }}>blind verifier (advisory — the Harness stays authoritative)</strong>
          {summary.blindVerification.skippedReason ? (
            <div>skipped: {summary.blindVerification.skippedReason}</div>
          ) : (
            <>
              <div className="row tight" style={{ marginTop: 4 }}>
                <StatusBadge status={summary.blindVerification.verdict.risk} label={`risk ${summary.blindVerification.verdict.risk}`} />
                <Badge>recommendation: {summary.blindVerification.verdict.recommendation}</Badge>
                <Badge>confidence {summary.blindVerification.verdict.confidence}</Badge>
                <Badge tone="violet">{summary.blindVerification.adapterId ?? "separate adapter"}</Badge>
              </div>
              <div style={{ marginTop: 4 }}>{summary.blindVerification.verdict.reasoning}</div>
              {summary.blindVerification.verdict.findings.length > 0 && (
                <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                  {summary.blindVerification.verdict.findings.map((f, i) => (
                    <li key={i}>{f}</li>
                  ))}
                </ul>
              )}
            </>
          )}
        </div>
      )}

      {actions.length === 0 ? (
        <Empty>No action-level verification recorded.</Empty>
      ) : (
        actions.map((action) => (
          <div key={action.id} className="entry" style={{ marginBottom: 7 }}>
            <div className="entry-head" style={{ cursor: "default" }}>
              <span className="entry-tool">{action.tool}</span>
              <span className="entry-args">{stringify(action.args, 100)}</span>
              <StatusBadge status={action.verification!.status} />
              <Badge tone={action.verification!.source === "deterministic" ? "blue" : ""}>{action.verification!.source}</Badge>
            </div>
            <div className="entry-body">
              <div style={{ marginBottom: 5 }}>{action.verification!.summary}</div>
              <CheckList checks={action.verification!.checks} />
            </div>
          </div>
        ))
      )}
    </div>
  );
}

function ProvenanceTab({ runId }: { runId: string | undefined }) {
  const [entries, setEntries] = useState<AuditEntryView[]>([]);
  const [chain, setChain] = useState<{ ok: boolean; entries: number; head: string; brokenAtSeq?: number }>();
  const [loading, setLoading] = useState(false);
  const [onlyThisRun, setOnlyThisRun] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.audit(500, onlyThisRun ? runId : undefined);
      setEntries(res.entries);
      setChain(res.chain);
    } catch {
      setEntries([]);
      setChain(undefined);
    } finally {
      setLoading(false);
    }
  }, [onlyThisRun, runId]);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div>
      <div className="row tight" style={{ marginBottom: 8 }}>
        <button className="tiny" onClick={() => void load()} disabled={loading}>
          {loading ? "loading…" : "refresh"}
        </button>
        <label className="row tight" style={{ cursor: "pointer", fontSize: 11, color: "var(--text-dim)" }}>
          <input type="checkbox" checked={onlyThisRun} onChange={(e) => setOnlyThisRun(e.target.checked)} disabled={!runId} />
          this run only
        </label>
        {chain && (
          <>
            <StatusBadge status={chain.ok ? "passed" : "failed"} label={chain.ok ? "hash chain intact" : "chain broken"} />
            <Badge>{chain.entries} entries</Badge>
            <span className="hash">head {shortHash(chain.head, 16)}</span>
            {chain.brokenAtSeq !== undefined && <Badge tone="red">broken at seq {chain.brokenAtSeq}</Badge>}
          </>
        )}
        <span style={{ fontSize: 10.5, color: "var(--text-faint)", marginLeft: "auto" }}>
          append-only · sha256(entry ‖ prevHash) · stored as JSONL in the workspace
        </span>
      </div>
      {entries.length === 0 ? (
        <Empty>No audit entries.</Empty>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>seq</th>
              <th>time</th>
              <th>type</th>
              <th>payload</th>
              <th>prev</th>
              <th>hash</th>
            </tr>
          </thead>
          <tbody>
            {entries
              .slice()
              .reverse()
              .map((entry) => (
                <tr key={entry.seq}>
                  <td>{entry.seq}</td>
                  <td>{timeOf(entry.at)}</td>
                  <td style={{ color: "var(--accent)" }}>{entry.type}</td>
                  <td title={stringify(entry.payload, 4000)}>{stringify(entry.payload, 240)}</td>
                  <td className="hash">{shortHash(entry.prevHash, 8)}</td>
                  <td className="hash">{shortHash(entry.hash, 12)}</td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function RecoveryTab({ runDetail }: { runDetail: RunDetail | undefined }) {
  const [transitions, setTransitions] = useState<TransitionView[]>([]);
  const [busy, setBusy] = useState<string>();
  const [message, setMessage] = useState<{ tone: "good" | "bad"; text: string }>();

  const load = useCallback(async () => {
    try {
      const res = await api.transitions();
      setTransitions(res.transitions);
    } catch {
      setTransitions([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function rollback(transition: TransitionView) {
    if (transition.reversibility === "irreversible") {
      setMessage({ tone: "bad", text: `${transition.tool} is irreversible — there is no undo. This is why it needed approval.` });
      return;
    }
    if (!window.confirm(`Roll back ${transition.tool} (${transition.reversibility})?\nThe Harness will re-read the real state to confirm A→B→A.`)) return;
    setBusy(transition.id);
    try {
      const res = await api.rollback(transition.id);
      setMessage({ tone: res.ok ? "good" : "bad", text: `${res.detail}${res.verified ? " — round-trip A→B→A VERIFIED against real state" : " — round-trip NOT verified"}` });
      await load();
    } catch (err) {
      setMessage({ tone: "bad", text: (err as Error).message });
    } finally {
      setBusy(undefined);
    }
  }

  // Transitions belonging to a run that executed in a scratch workspace (a
  // replay) are recorded facts but cannot be rolled back from here: that
  // workspace is gone. Show them honestly instead of pretending.
  const liveIds = new Set(transitions.map((t) => t.id));
  const recorded = (runDetail?.run.steps ?? [])
    .flatMap((step) => step.actions)
    .filter((a) => a.transition && !liveIds.has(a.transition!.id))
    .map((a) => ({
      id: a.transition!.id,
      actionId: a.id,
      stepId: a.stepId,
      tool: a.tool,
      reversibility: a.transition!.reversibility,
      undoOps: a.transition!.undoOps as TransitionView["undoOps"],
      rolledBack: a.transition!.rolledBack,
      roundTripVerified: a.transition!.roundTripVerified,
      before: a.transition!.before,
      after: a.transition!.after,
      recorded: true,
    }));
  const rows = [...transitions.slice().reverse(), ...recorded];

  return (
    <div>
      <div className="row tight" style={{ marginBottom: 8 }}>
        <button className="tiny" onClick={() => void load()}>
          refresh
        </button>
        <Badge>{rows.length} recorded transition(s)</Badge>
        <span style={{ fontSize: 10.5, color: "var(--text-faint)" }}>
          rollback re-captures the real state after undoing; “verified” only when live hashes match state A
        </span>
      </div>
      {message && <div className={cls("notice", message.tone === "bad" ? "bad" : "good")}>{message.text}</div>}
      {rows.length === 0 ? (
        <Empty>No state transitions recorded yet.</Empty>
      ) : (
        <table className="grid">
          <thead>
            <tr>
              <th>id</th>
              <th>tool</th>
              <th>reversibility</th>
              <th>undo</th>
              <th>status</th>
              <th>before → after</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
                <tr key={t.id}>
                  <td>{t.id.slice(-8)}</td>
                  <td style={{ color: "var(--text)" }}>{t.tool}</td>
                  <td className={t.reversibility === "irreversible" ? "no" : t.reversibility === "reversible" ? "ok" : "warn"}>{t.reversibility}</td>
                  <td>{t.undoOps.length === 0 ? "—" : t.undoOps.map((o) => o.description).join("; ")}</td>
                  <td>
                    {t.rolledBack ? (
                      <Badge tone="blue">rolled back{t.roundTripVerified ? " ✓ verified" : " ✗ unverified"}</Badge>
                    ) : (
                      <Badge>live</Badge>
                    )}
                  </td>
                  <td className="hash" title={stringify({ before: t.before, after: t.after }, 2000)}>
                    {stringify(t.before, 90)} → {stringify(t.after, 90)}
                  </td>
                  <td>
                    {!t.rolledBack && !("recorded" in t && t.recorded) && (
                      <button className="tiny danger" disabled={busy === t.id || t.undoOps.length === 0} onClick={() => void rollback(t)}>
                        {busy === t.id ? "…" : "rollback"}
                      </button>
                    )}
                    {"recorded" in t && t.recorded ? <Badge tone="violet">recorded · scratch workspace released</Badge> : null}
                  </td>
                </tr>
              ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function LogsTab({ events }: { events: HarnessEvent[] }) {
  if (events.length === 0) return <Empty>No events yet.</Empty>;
  return (
    <div>
      {events
        .slice(-600)
        .reverse()
        .map((event) => {
          const bad = event.type.includes("blocked") || event.type.endsWith(".failed") || (event.payload as Record<string, unknown>)?.allowed === false;
          const warn = event.type.includes("sre") || event.type.includes("approval") || event.type.includes("warning");
          return (
            <div key={event.id} className={cls("log-line", bad && "bad", warn && "warn")} title={stringify(event.payload, 3000)}>
              <span className="t">{timeOf(event.at)}</span>
              <span className="type">{event.type}</span>
              <span className="p">{stringify(event.payload, 300)}</span>
            </div>
          );
        })}
    </div>
  );
}
