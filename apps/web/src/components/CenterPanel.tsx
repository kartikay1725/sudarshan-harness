import React, { useMemo, useState } from "react";
import type { ApprovalView, HarnessEvent, RunDetail, SessionSnapshot } from "../types.js";
import { Badge, CheckList, Empty, StatusBadge, cls, stringify, timeOf } from "../ui.js";

export interface RunRequest {
  task: string;
  expectations: string[];
  approvalMode: "manual" | "auto" | "deny";
  blindVerifier: boolean;
  model?: string;
}

export function CenterPanel({
  session,
  events,
  runDetail,
  approvals,
  running,
  onStart,
  onResolveApproval,
}: {
  session: SessionSnapshot | undefined;
  events: HarnessEvent[];
  runDetail: RunDetail | undefined;
  approvals: ApprovalView[];
  running: boolean;
  onStart: (req: RunRequest) => void;
  onResolveApproval: (id: string, status: "approved" | "denied", scope: "once" | "class", note?: string) => void;
}) {
  const [task, setTask] = useState("");
  const [extraChecks, setExtraChecks] = useState("");
  const [approvalMode, setApprovalMode] = useState<"manual" | "auto" | "deny">("manual");
  const [blindVerifier, setBlindVerifier] = useState(false);
  const [showLogs, setShowLogs] = useState(false);
  const [note, setNote] = useState<Record<string, string>>({});

  const specChecks = session?.spec?.verification ?? [];
  const run = runDetail?.run;
  const steps = useMemo(() => {
    // While a run is in flight the event stream is the freshest source. Once it
    // finishes (or for a replay, which never streamed through this session) the
    // run record is authoritative and complete, so render from that instead.
    if (run && (run.finishedAt || events.length === 0)) return blocksFromRun(run);
    return groupByStep(events.filter((e) => e.type !== "log" || showLogs));
  }, [events, showLogs, run]);
  const summary = runDetail?.run.summary;

  function submit() {
    if (!task.trim()) return;
    onStart({
      task: task.trim(),
      expectations: extraChecks
        .split("\n")
        .map((l) => l.trim())
        .filter(Boolean),
      approvalMode,
      blindVerifier,
    });
  }

  return (
    <div className="column center">
      <div className="composer">
        <div className="row spread" style={{ marginBottom: 6 }}>
          <span style={{ fontSize: 10.5, letterSpacing: "0.12em", textTransform: "uppercase", color: "var(--text-faint)" }}>
            task for the agent
          </span>
          <span className="row tight">
            {session?.spec?.verification.length ? <Badge tone="green">{specChecks.length} checks from agent.md</Badge> : <Badge tone="amber">no acceptance criteria</Badge>}
            <Badge tone={session?.configured ? "blue" : "red"}>{session?.adapterId ?? "no adapter"} / {session?.model ?? "no model"}</Badge>
          </span>
        </div>
        <textarea
          value={task}
          placeholder='e.g. "Organise inbox/: invoices into finance/, notes into meetings/, then write INDEX.md"'
          onChange={(e) => setTask(e.target.value)}
          onKeyDown={(e) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") submit();
          }}
          spellCheck={false}
        />
        <div className="row" style={{ marginTop: 7 }}>
          <button className="primary" onClick={submit} disabled={running || !task.trim() || !session?.configured}>
            {running ? "running under harness…" : "run under harness"}
          </button>
          <label className="field" style={{ marginBottom: 0, minWidth: 148 }}>
            <span>human approval</span>
            <select value={approvalMode} onChange={(e) => setApprovalMode(e.target.value as never)}>
              <option value="manual">ask me (default)</option>
              <option value="auto">pre-authorise classes</option>
              <option value="deny">deny everything</option>
            </select>
          </label>
          <label className="row tight" style={{ cursor: "pointer", fontSize: 11.5, color: "var(--text-dim)" }}>
            <input type="checkbox" checked={blindVerifier} onChange={(e) => setBlindVerifier(e.target.checked)} />
            blind verifier
          </label>
          <label className="row tight" style={{ cursor: "pointer", fontSize: 11.5, color: "var(--text-dim)" }}>
            <input type="checkbox" checked={showLogs} onChange={(e) => setShowLogs(e.target.checked)} />
            verbose logs
          </label>
          <span style={{ marginLeft: "auto", fontSize: 10.5, color: "var(--text-faint)" }} className="mono">
            ⌘/ctrl + ⏎
          </span>
        </div>
        <details style={{ marginTop: 7 }}>
          <summary style={{ cursor: "pointer", fontSize: 11, color: "var(--text-faint)", fontFamily: "var(--mono)" }}>
            extra acceptance criteria for this run (one per line)
          </summary>
          <textarea
            style={{ marginTop: 6, minHeight: 52 }}
            value={extraChecks}
            onChange={(e) => setExtraChecks(e.target.value)}
            placeholder={'file_exists report.md\ncommand npm test exit=0\nglob_count src/**/*.ts min=1'}
            spellCheck={false}
          />
          <div style={{ fontSize: 10.5, color: "var(--text-faint)", marginTop: 3 }}>
            These are checked against the real system after the run. Without criteria the Harness can verify each <em>action</em> but not the <em>task</em>.
          </div>
        </details>
      </div>

      {approvals.map((approval) => (
        <div className="approval" key={approval.id}>
          <h4>⏸ waiting for human approval</h4>
          <dl>
            <dt>action</dt>
            <dd>{approval.tool}</dd>
            <dt>arguments</dt>
            <dd>{stringify(approval.args, 400)}</dd>
            <dt>risk</dt>
            <dd>
              <StatusBadge status={approval.risk} />
            </dd>
            <dt>reversibility</dt>
            <dd>
              <Badge tone={approval.reversibility === "irreversible" ? "red" : approval.reversibility === "reversible" ? "green" : "amber"}>{approval.reversibility}</Badge>
              {approval.reversibility === "irreversible" && <span style={{ color: "var(--red)" }}> — cannot be undone</span>}
            </dd>
            <dt>targets</dt>
            <dd>{approval.targets.map((t) => `${t.kind}:${t.value}`).join(", ") || "—"}</dd>
            <dt>why</dt>
            <dd>{approval.reason}</dd>
          </dl>
          <input
            type="text"
            placeholder="note to the audit trail (optional)"
            value={note[approval.id] ?? ""}
            onChange={(e) => setNote((n) => ({ ...n, [approval.id]: e.target.value }))}
            style={{ marginBottom: 7 }}
          />
          <div className="row">
            <button className="good" onClick={() => onResolveApproval(approval.id, "approved", "once", note[approval.id])}>
              approve once
            </button>
            <button className="good" onClick={() => onResolveApproval(approval.id, "approved", "class", note[approval.id])} title="Approve every action of this class for the rest of the run">
              approve this class
            </button>
            <button className="danger" onClick={() => onResolveApproval(approval.id, "denied", "once", note[approval.id])}>
              deny
            </button>
            <span style={{ fontSize: 10.5, color: "var(--text-faint)", marginLeft: "auto" }}>class = {approval.classKey}</span>
          </div>
        </div>
      ))}

      <div className="stream">
        {summary && (
          <div className="verdict">
            <div>
              <div className="k">agent claims</div>
              <div className={cls("v", summary.agentClaimedComplete ? "maybe" : "no")}>{summary.agentClaimedComplete ? "COMPLETED" : "NO CLAIM"}</div>
            </div>
            <div>
              <div className="k">harness verdict</div>
              <div className={cls("v", summary.harnessVerified ? "ok" : "no")}>{summary.harnessVerified ? "VERIFIED" : "NOT VERIFIED"}</div>
            </div>
            <div className="verdict-explain">
              <StatusBadge status={summary.status} /> <span style={{ marginLeft: 6 }}>{summary.explanation}</span>
              <div className="row tight" style={{ marginTop: 6 }}>
                <Badge>{summary.steps} steps</Badge>
                <Badge tone="green">{summary.allowed} allowed</Badge>
                <Badge tone={summary.blocked ? "red" : ""}>{summary.blocked} blocked</Badge>
                <Badge tone="green">{summary.verificationsPassed} verified</Badge>
                <Badge tone={summary.verificationsFailed ? "red" : ""}>{summary.verificationsFailed} failed</Badge>
                <Badge>{summary.tokens.totalTokens} tokens</Badge>
                <Badge>{(summary.durationMs / 1000).toFixed(1)}s</Badge>
              </div>
              {summary.blindVerification && (
                <div className="notice" style={{ marginTop: 8, borderLeftColor: "var(--violet)" }}>
                  <strong style={{ color: "var(--violet)" }}>blind verifier — advisory, not authoritative</strong>
                  risk {summary.blindVerification.verdict.risk} · recommendation {summary.blindVerification.verdict.recommendation} · confidence{" "}
                  {summary.blindVerification.verdict.confidence}
                  {summary.blindVerification.skippedReason ? ` · skipped: ${summary.blindVerification.skippedReason}` : ""}
                  {summary.blindVerification.verdict.reasoning && <div style={{ marginTop: 3 }}>{summary.blindVerification.verdict.reasoning}</div>}
                  {summary.blindVerification.verdict.findings.length > 0 && (
                    <ul style={{ margin: "4px 0 0", paddingLeft: 16 }}>
                      {summary.blindVerification.verdict.findings.map((f, i) => (
                        <li key={i}>{f}</li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </div>
          </div>
        )}

        {steps.length === 0 && <Empty>{running ? "waiting for the first step…" : "Give the agent a task. Every action it requests will appear here with the Harness's verdict."}</Empty>}

        {steps.map((step) => (
          <div key={step.key} className={cls("step-block", step.tone)}>
            <div className="step-head">
              <span>{step.label}</span>
              <span style={{ marginLeft: "auto" }}>{step.time}</span>
            </div>
            {step.items}
          </div>
        ))}
      </div>
    </div>
  );
}

type Block = { key: string; label: string; time: string; tone?: "ok" | "bad" | "warn"; items: React.ReactNode[] };

/** Rebuild the transcript from a finished run record. */
function blocksFromRun(run: RunDetail["run"]): Block[] {
  const blocks: Block[] = [
    {
      key: "run",
      label: "run",
      time: timeOf(run.startedAt),
      items: [
        <div className="harness-text" key="start">
          ▶ run started · {run.id} · {run.config?.adapterId ?? "?"} / {run.config?.model ?? "?"}
        </div>,
      ],
    },
  ];

  for (const step of run.steps) {
    const items: React.ReactNode[] = [];
    let tone: Block["tone"];

    if (step.agentClaim) {
      items.push(
        <div className="agent-text" key="claim">
          <strong>agent claims completion:</strong>
          {"\n"}
          {step.agentClaim}
        </div>,
      );
    }

    for (const action of step.actions) {
      const blocked = !action.decision.allowed;
      const verify = action.verification;
      items.push(
        <div className="entry" key={action.id} style={{ borderLeft: `2px solid ${blocked ? "var(--red)" : verify?.status === "failed" ? "var(--red)" : verify?.status === "passed" ? "var(--green)" : "var(--amber)"}` }}>
          <div className="entry-head" style={{ cursor: "default" }}>
            <span className="entry-tool">{action.tool}</span>
            <span className="entry-args">{stringify(action.args, 140)}</span>
            {blocked ? <Badge tone="red" solid>⛔ blocked</Badge> : <StatusBadge status={action.result?.outcome ?? "success"} />}
            {verify && <StatusBadge status={verify.status} label={`verify ${verify.status}`} />}
          </div>
          <div className="entry-body">
            <div style={{ marginBottom: 4 }}>{action.decision.reason}</div>
            {action.result?.text && <div style={{ marginBottom: 6, whiteSpace: "pre-wrap" }}>{action.result.text.slice(0, 600)}</div>}
            {action.result?.error && <div style={{ color: "var(--red)", marginBottom: 6 }}>{action.result.error.code}: {action.result.error.message}</div>}
            {verify ? <CheckList checks={verify.checks} /> : <div style={{ color: "var(--amber)" }}>no deterministic check — effect UNVERIFIED</div>}
          </div>
        </div>,
      );
      if (blocked || verify?.status === "failed" || (action.result && action.result.outcome !== "success")) tone = "bad";
      else if (!tone && verify?.status === "passed") tone = "ok";
      else if (!tone) tone = "warn";
    }

    for (const alert of step.sreAlerts) {
      items.push(
        <div className="alert-text" key={alert.id}>
          <strong>
            agent sre · {alert.kind} · {alert.severity}
          </strong>
          {alert.message}
          {alert.intervention && <div style={{ marginTop: 4, opacity: 0.85 }}>{alert.intervention}</div>}
        </div>,
      );
      if (tone !== "bad") tone = "warn";
    }

    blocks.push({
      key: step.id,
      label: `step ${step.index + 1}`,
      time: timeOf(step.startedAt),
      tone,
      items,
    });
  }

  blocks.push({
    key: "run-end",
    label: "result",
    time: timeOf(run.finishedAt),
    items: [<div className="harness-text" key="end">■ run finished — {run.status.toUpperCase()}</div>],
  });

  return blocks;
}

type P = Record<string, unknown>;

function groupByStep(events: HarnessEvent[]): Array<{ key: string; label: string; time: string; tone?: "ok" | "bad" | "warn"; items: React.ReactNode[] }> {
  const order: string[] = [];
  const buckets = new Map<string, { label: string; time: string; items: React.ReactNode[]; tone?: "ok" | "bad" | "warn" }>();

  const push = (key: string, label: string, at: string, node: React.ReactNode, tone?: "ok" | "bad" | "warn") => {
    if (!buckets.has(key)) {
      buckets.set(key, { label, time: timeOf(at), items: [], tone });
      order.push(key);
    }
    const bucket = buckets.get(key)!;
    bucket.items.push(node);
    if (tone === "bad") bucket.tone = "bad";
    else if (tone === "warn" && bucket.tone !== "bad") bucket.tone = "warn";
    else if (tone === "ok" && !bucket.tone) bucket.tone = "ok";
  };

  for (const event of events) {
    const p = event.payload as P;
    const stepKey = event.stepId ?? "run";
    switch (event.type) {
      case "run.started":
        push("run", "run", event.at, <div className="harness-text">▶ run started · adapter {String(p.adapter)} · model {String(p.model)}</div>);
        break;
      case "model.response": {
        const calls = (p.toolCalls as string[]) ?? [];
        if (calls.length > 0) {
          push(stepKey, `step`, event.at, <div className="agent-text"><strong>agent requests:</strong> {calls.join(", ")}</div>);
        } else if (p.contentPreview) {
          push(stepKey, `step`, event.at, <div className="agent-text"><strong>agent claims completion:</strong>{"\n"}{String(p.contentPreview)}</div>, "warn");
        }
        break;
      }
      case "authorization.decided": {
        const allowed = p.allowed === true;
        push(
          stepKey,
          "step",
          event.at,
          <div className={allowed ? "harness-text" : "alert-text"}>
            {allowed ? (p.approvalRequired ? "⏸ allowed, pending human approval" : "✓ authorized") : `⛔ BLOCKED (${String(p.code)})`} — {String(p.tool)}{" "}
            {stringify(p.args, 200)}
            <div style={{ opacity: 0.8 }}>{String(p.reason)}</div>
          </div>,
          allowed ? "ok" : "bad",
        );
        break;
      }
      case "action.completed": {
        const verification = p.verification as { status?: string; summary?: string } | undefined;
        const outcome = String(p.outcome ?? "");
        push(
          stepId(event) ?? stepKey,
          "step",
          event.at,
          <div className="entry">
            <div className="entry-head" style={{ cursor: "default" }}>
              <span className="entry-tool">{String(p.tool ?? "")}</span>
              <span className="entry-args">{outcome}{p.durationMs !== undefined ? ` · ${p.durationMs}ms` : ""}</span>
              <StatusBadge status={outcome} />
              {verification?.status && <StatusBadge status={verification.status} label={`verify ${verification.status}`} />}
            </div>
            {p.text ? <div className="entry-body">{String(p.text)}</div> : null}
          </div>,
          verification?.status === "failed" ? "bad" : outcome === "success" ? "ok" : "bad",
        );
        break;
      }
      case "sre.alert":
        push(stepKey, "step", event.at, <div className="alert-text"><strong>agent sre · {String(p.kind)} · {String(p.severity)}</strong>{String(p.message)}{p.intervention ? <div style={{ marginTop: 4, opacity: 0.85 }}>{String(p.intervention)}</div> : null}</div>, "warn");
        break;
      case "approval.requested":
        push(stepKey, "step", event.at, <div className="alert-text"><strong>human approval requested</strong>{String(p.tool)} · risk {String(p.risk)} · {String(p.reversibility)}</div>, "warn");
        break;
      case "approval.resolved":
        push(stepKey, "step", event.at, <div className="harness-text">approval {String(p.status)} by {String(p.by ?? "human")} (scope {String(p.scope)}){p.note ? ` — ${String(p.note)}` : ""}</div>, p.status === "approved" ? "ok" : "bad");
        break;
      case "rollback.completed":
        push("run", "run", event.at, <div className="harness-text">↩ rollback {String(p.ok ? "succeeded" : "failed")} · round-trip {String(p.verified ? "VERIFIED" : "not verified")} · {String(p.detail)}</div>);
        break;
      case "run.completed":
        push("run-end", "result", event.at, <div className="harness-text">■ run finished — see the verdict above</div>);
        break;
      case "log":
        push(stepKey, "step", event.at, <div className="log-line"><span className="t">{timeOf(event.at)}</span><span className="type">{String(p.where ?? "log")}</span><span className="p">{String(p.message)}</span></div>);
        break;
      default:
        break;
    }
  }

  return order.map((key) => {
    const bucket = buckets.get(key)!;
    const label = key === "run" ? "run" : key === "run-end" ? "result" : `step ${key.slice(-4)}`;
    return { key, label, time: bucket.time, tone: bucket.tone, items: bucket.items };
  });
}

function stepId(event: HarnessEvent): string | undefined {
  return event.stepId;
}

export { CheckList };
