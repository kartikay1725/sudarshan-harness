import React from "react";
import type { RunDetail, SessionSnapshot } from "../types.js";
import { Badge, CheckList, Empty, Panel, StatusBadge, cls, stringify, timeOf } from "../ui.js";

export function RightPanel({
  runDetail,
  session,
  onSelectRun,
}: {
  runDetail: RunDetail | undefined;
  session: SessionSnapshot | undefined;
  onSelectRun: (id: string) => void;
}) {
  const run = runDetail?.run;

  return (
    <div className="column right">
      <Panel title="Execution" count={run ? `${run.steps.length} step(s)` : "idle"}>
        {!run && <Empty>No run selected. Steps and their verification appear here — every step is checked, not just the last one.</Empty>}
        {run && (
          <>
            <div className="notice" style={{ marginBottom: 10 }}>
              <span className="mono" style={{ fontSize: 11 }}>
                {run.task}
              </span>
              <div className="row tight" style={{ marginTop: 6 }}>
                <StatusBadge status={run.status} />
                <Badge>{timeOf(run.startedAt)} → {run.finishedAt ? timeOf(run.finishedAt) : "…"}</Badge>
                <Badge tone="violet">{run.id.slice(-6)}</Badge>
              </div>
            </div>
            {run.steps.map((step) => {
              const failed = step.actions.some((a) => a.verification?.status === "failed" || (a.result && a.result.outcome !== "success"));
              const anyVerified = step.actions.some((a) => a.verification?.status === "passed");
              return (
                <div key={step.id} className={cls("step-block", failed ? "fail" : anyVerified ? "ok" : "warn")} style={{ marginBottom: 14 }}>
                  <div className="step-head">
                    <span>step {step.index + 1}</span>
                    <span className={failed ? "badge red" : anyVerified ? "badge green" : "badge amber"}>{failed ? "⚠" : anyVerified ? "✓" : "◐"}</span>
                    <span style={{ marginLeft: "auto" }}>
                      {step.actions.length} action(s) · {step.usage.totalTokens} tok
                    </span>
                  </div>

                  {step.agentClaim && (
                    <div className="agent-text" style={{ fontSize: 12 }}>
                      <strong>agent:</strong> {step.agentClaim}
                    </div>
                  )}

                  {step.actions.map((action) => {
                    const tone = !action.decision.allowed ? "bad" : action.verification?.status === "failed" ? "bad" : action.verification?.status === "passed" ? "ok" : "warn";
                    return (
                      <details key={action.id} className="entry" open={tone === "bad"}>
                        <summary className="entry-head" style={{ listStyle: "none" }}>
                          <span className="entry-tool">{action.tool}</span>
                          <span className="entry-args">{stringify(action.args, 120)}</span>
                          {!action.decision.allowed ? (
                            <Badge tone="red" solid>blocked</Badge>
                          ) : action.verification ? (
                            <StatusBadge status={action.verification.status} label={action.verification.status} />
                          ) : (
                            <Badge tone="amber">unverified</Badge>
                          )}
                        </summary>
                        <div className="entry-body">
                          <div style={{ marginBottom: 6 }}>
                            <StatusBadge status={action.decision.allowed ? "allowed" : "blocked"} />{" "}
                            <Badge tone={action.decision.risk === "high" || action.decision.risk === "critical" ? "red" : action.decision.risk === "medium" ? "amber" : "green"}>
                              {action.decision.risk}
                            </Badge>{" "}
                            <Badge tone={action.decision.reversibility === "irreversible" ? "red" : action.decision.reversibility === "reversible" ? "green" : "amber"}>
                              {action.decision.reversibility}
                            </Badge>{" "}
                            {action.decision.approvalRequired && <Badge tone="violet">approval</Badge>}
                          </div>
                          <div style={{ opacity: 0.85, marginBottom: 6 }}>{action.decision.reason}</div>
                          {action.result && (
                            <div style={{ marginBottom: 6 }}>
                              <strong>outcome:</strong> {action.result.outcome}
                              {action.result.metrics && (
                                <span>
                                  {" "}
                                  · {Object.entries(action.result.metrics).map(([k, v]) => `${k}=${v}`).join(" ")}
                                </span>
                              )}
                              {action.result.text ? <div style={{ marginTop: 4, whiteSpace: "pre-wrap" }}>{action.result.text.slice(0, 800)}</div> : null}
                              {action.result.error ? <div style={{ color: "var(--red)", marginTop: 4 }}>{action.result.error.code}: {action.result.error.message}</div> : null}
                            </div>
                          )}
                          {action.verification ? (
                            <div>
                              <strong>{action.verification.summary}</strong>
                              <div style={{ opacity: 0.7, marginBottom: 4 }}>source: {action.verification.source}</div>
                              <CheckList checks={action.verification.checks} />
                            </div>
                          ) : (
                            <div style={{ color: "var(--amber)" }}>no deterministic check declared for this action</div>
                          )}
                          {action.transition && (
                            <div style={{ marginTop: 6, opacity: 0.85 }}>
                              <strong>transition:</strong> {action.transition.id.slice(-8)} · {action.transition.reversibility}
                              {action.transition.rolledBack && <Badge tone="blue">rolled back{action.transition.roundTripVerified ? " · A→B→A verified" : ""}</Badge>}
                            </div>
                          )}
                        </div>
                      </details>
                    );
                  })}

                  {step.sreAlerts.map((alert) => (
                    <div key={alert.id} className="alert-text">
                      <strong>agent sre · {alert.kind} · {alert.severity}</strong>
                      {alert.message}
                      {alert.intervention && <div style={{ marginTop: 4, opacity: 0.85 }}>{alert.intervention}</div>}
                    </div>
                  ))}
                </div>
              );
            })}
          </>
        )}
      </Panel>

      <Panel title="Runs" count={`${session?.runs.length ?? 0}`}>
        {!session?.runs.length && <Empty>No runs yet.</Empty>}
        {session?.runs.map((r) => (
          <div
            key={r.id}
            className="entry"
            style={{ cursor: "pointer", borderLeft: r.id === run?.id ? "2px solid var(--accent)" : undefined }}
            onClick={() => onSelectRun(r.id)}
          >
            <div className="entry-head">
              <StatusBadge status={r.status} />
              <span className="entry-args">{r.task}</span>
              <span className="hash">{timeOf(r.startedAt)}</span>
            </div>
          </div>
        ))}
      </Panel>
    </div>
  );
}
