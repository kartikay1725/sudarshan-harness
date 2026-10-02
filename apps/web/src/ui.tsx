import React, { useState } from "react";

export function cls(...parts: Array<string | false | undefined | null>): string {
  return parts.filter(Boolean).join(" ");
}

export type Tone = "green" | "red" | "amber" | "violet" | "blue" | "";

export function Badge({ children, tone = "", solid = false, title }: { children: React.ReactNode; tone?: Tone; solid?: boolean; title?: string }) {
  return (
    <span className={cls("badge", tone, solid && "solid")} title={title}>
      {children}
    </span>
  );
}

export function statusTone(status: string): Tone {
  switch (status) {
    case "verified":
    case "passed":
    case "allowed":
    case "success":
    case "approved":
      return "green";
    case "failed":
    case "verification_failed":
    case "blocked":
    case "denied":
    case "error":
    case "timeout":
    case "critical":
      return "red";
    case "completed_unverified":
    case "indeterminate":
    case "waiting_for_approval":
    case "medium":
    case "warn":
    case "skipped":
      return "amber";
    case "high":
      return "red";
    case "low":
      return "green";
    case "running":
      return "blue";
    default:
      return "";
  }
}

export function StatusBadge({ status, label }: { status: string; label?: string }) {
  const tone = statusTone(status);
  const glyph = tone === "green" ? "✓" : tone === "red" ? "✗" : tone === "amber" ? "◐" : "·";
  return <Badge tone={tone} solid>{`${glyph} ${(label ?? status).replace(/_/g, " ")}`}</Badge>;
}

export function Entry({
  title,
  args,
  badges,
  children,
  tone,
  defaultOpen = false,
}: {
  title: string;
  args?: string;
  badges?: React.ReactNode;
  children?: React.ReactNode;
  tone?: "ok" | "bad" | "warn";
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const border = tone === "bad" ? "var(--red)" : tone === "warn" ? "var(--amber)" : tone === "ok" ? "var(--green)" : undefined;
  return (
    <div className="entry" style={border ? { borderLeft: `2px solid ${border}` } : undefined}>
      <div className="entry-head" onClick={() => setOpen((v) => !v)}>
        <span className="entry-tool">{title}</span>
        {args !== undefined && <span className="entry-args">{args}</span>}
        {badges}
        <span className="badge">{open ? "▾" : "▸"}</span>
      </div>
      {open && children ? <div className="entry-body">{children}</div> : null}
    </div>
  );
}

export function CheckList({ checks }: { checks: Array<{ label: string; status: string; evidence: string; expected?: string; actual?: string }> }) {
  return (
    <div>
      {checks.map((check, i) => (
        <div key={i} className={cls("check", check.status === "passed" ? "pass" : check.status === "failed" ? "fail" : "indet")}>
          <span className="mark">{check.status === "passed" ? "✓" : check.status === "failed" ? "✗" : "?"}</span>
          <span className="label">{check.label}</span>
          <span className="evidence">
            {check.evidence}
            {check.status === "failed" && check.expected ? ` · expected ${check.expected} · actual ${check.actual ?? "n/a"}` : ""}
          </span>
        </div>
      ))}
    </div>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function timeOf(iso?: string): string {
  if (!iso) return "--:--:--";
  const d = new Date(iso);
  return d.toTimeString().slice(0, 8);
}

export function shortHash(hash?: string, len = 10): string {
  return hash ? `${hash.slice(0, len)}…` : "—";
}

export function stringify(value: unknown, max = 4000): string {
  try {
    const text = typeof value === "string" ? value : JSON.stringify(value, null, 2);
    return text && text.length > max ? `${text.slice(0, max)}\n… truncated` : (text ?? "");
  } catch {
    return String(value);
  }
}

export function Panel({
  title,
  count,
  children,
  actions,
}: {
  title: string;
  count?: string;
  children: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <section className="panel">
      <header className="panel-head">
        <span>{title}</span>
        {actions}
        {count !== undefined && <span className="count">{count}</span>}
      </header>
      <div className="panel-body">{children}</div>
    </section>
  );
}
