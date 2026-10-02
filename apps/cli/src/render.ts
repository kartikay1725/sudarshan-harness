import type { ActionRecord, HarnessEvent, RiskLevel, RunRecord, VerificationReport } from "@sudarshan/core";

const useColor = process.stdout.isTTY === true && !process.env.NO_COLOR;

function wrap(code: number, resetCode = 0) {
  return (text: string) => (useColor ? `\u001b[${code}m${text}\u001b[${resetCode}m` : text);
}

export const c = {
  bold: wrap(1),
  dim: wrap(2),
  italic: wrap(3),
  red: wrap(31),
  green: wrap(32),
  yellow: wrap(33),
  blue: wrap(34),
  magenta: wrap(35),
  cyan: wrap(36),
  grey: wrap(90),
};

export function riskColor(risk: RiskLevel): string {
  switch (risk) {
    case "low":
      return c.green(risk);
    case "medium":
      return c.yellow(risk);
    case "high":
      return c.red(risk);
    case "critical":
      return c.bold(c.red(risk.toUpperCase()));
  }
}

export function statusBadge(status: string): string {
  const s = status.toUpperCase();
  switch (status) {
    case "verified":
      return c.green(c.bold(`✓ ${s}`));
    case "passed":
      return c.green(`✓ ${s}`);
    case "completed_unverified":
      return c.yellow(c.bold(`◐ ${s.replace("_", " ")}`));
    case "verification_failed":
    case "failed":
      return c.red(c.bold(`✗ ${s.replace("_", " ")}`));
    case "blocked":
      return c.red(c.bold(`⛔ ${s}`));
    case "waiting_for_approval":
      return c.magenta(c.bold(`⏸ ${s.replace(/_/g, " ")}`));
    case "indeterminate":
      return c.yellow(`? ${s}`);
    case "skipped":
      return c.grey(`– ${s}`);
    case "running":
      return c.cyan(`▶ ${s}`);
    case "cancelled":
      return c.grey(`■ ${s}`);
    default:
      return s;
  }
}

export function heading(text: string): string {
  return `\n${c.bold(c.cyan(text.toUpperCase()))}\n${c.grey("─".repeat(Math.max(text.length, 24)))}`;
}

export function keyValue(key: string, value: string, indent = 2): string {
  return `${" ".repeat(indent)}${c.grey(key.padEnd(14))} ${value}`;
}

export function bullet(text: string, indent = 2): string {
  return `${" ".repeat(indent)}${c.grey("•")} ${text}`;
}

export function formatArgs(args: Record<string, unknown>, max = 110): string {
  const text = JSON.stringify(args);
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

export function formatAction(action: ActionRecord): string[] {
  const lines: string[] = [];
  const gate = action.decision.allowed
    ? action.decision.approvalRequired
      ? c.magenta("APPROVAL")
      : c.green("ALLOW")
    : c.red(`BLOCK:${action.decision.code ?? "?"}`);
  lines.push(
    `  ${gate}  ${c.bold(action.tool)} ${c.grey(formatArgs(action.args))}  ${c.grey(`risk=${action.decision.risk} rev=${action.decision.reversibility}`)}`,
  );
  if (!action.decision.allowed) {
    lines.push(`        ${c.red(action.decision.reason)}`);
    return lines;
  }
  if (action.result) {
    const outcome = action.result.outcome === "success" ? c.green(action.result.outcome) : c.red(action.result.outcome);
    lines.push(`        ${c.grey("outcome:")} ${outcome}${action.durationMs !== undefined ? c.grey(` in ${action.durationMs}ms`) : ""}`);
    if (action.result.error) lines.push(`        ${c.red(`${action.result.error.code}: ${action.result.error.message}`)}`);
  }
  if (action.verification) lines.push(...formatVerification(action.verification, 8));
  if (action.transition && action.transition.undoOps.length > 0) {
    lines.push(`        ${c.grey(`recovery: ${action.transition.reversibility}, ${action.transition.undoOps.length} undo op(s), transition ${action.transition.id}`)}`);
  }
  return lines;
}

export function formatVerification(report: VerificationReport, indent = 8): string[] {
  const pad = " ".repeat(indent);
  const lines: string[] = [`${pad}${c.grey("verify:")} ${statusBadge(report.status)} ${c.grey(`(${report.source})`)} ${report.summary}`];
  for (const check of report.checks) {
    const mark = check.status === "passed" ? c.green("✓") : check.status === "failed" ? c.red("✗") : c.yellow("?");
    lines.push(`${pad}  ${mark} ${check.label} ${c.grey(`— ${truncate(check.evidence, 140)}`)}`);
    if (check.status === "failed" && check.expected) {
      lines.push(`${pad}      ${c.grey(`expected: ${truncate(check.expected, 120)}`)}`);
      lines.push(`${pad}      ${c.grey(`actual:   ${truncate(check.actual ?? "n/a", 120)}`)}`);
    }
  }
  return lines;
}

export function formatSummary(run: RunRecord): string[] {
  const s = run.summary;
  const lines: string[] = [];
  lines.push(heading("result"));
  lines.push(keyValue("status", statusBadge(run.status)));
  if (s) {
    lines.push(keyValue("agent claimed", s.agentClaimedComplete ? c.green("COMPLETED") : c.grey("did not claim completion")));
    lines.push(keyValue("harness says", s.harnessVerified ? c.green(c.bold("VERIFIED")) : c.yellow(c.bold("NOT VERIFIED"))));
    lines.push(keyValue("steps", String(s.steps)));
    lines.push(keyValue("actions", `${s.actions} (${c.green(`${s.allowed} allowed`)}, ${s.blocked ? c.red(`${s.blocked} blocked`) : "0 blocked"})`));
    lines.push(keyValue("verification", `${c.green(`${s.verificationsPassed} passed`)}, ${s.verificationsFailed ? c.red(`${s.verificationsFailed} failed`) : "0 failed"}`));
    lines.push(keyValue("tokens", `${s.tokens.totalTokens} (${s.tokens.promptTokens} in / ${s.tokens.completionTokens} out)`));
    lines.push(keyValue("duration", `${(s.durationMs / 1000).toFixed(1)}s`));
    lines.push("");
    lines.push(`  ${c.bold("why:")} ${s.explanation}`);
  }
  lines.push("");
  lines.push(`  ${c.grey("COMPLETED != VERIFIED — the agent's claim and the Harness's verdict are reported separately, always.")}`);
  return lines;
}

export function truncate(text: string, max: number): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > max ? `${flat.slice(0, max)}…` : flat;
}

/** Live terminal renderer for a running Harness. */
export function createLivePrinter(options: { verbose?: boolean } = {}): (event: HarnessEvent) => void {
  let currentStep = 0;
  return (event: HarnessEvent) => {
    const p = event.payload as Record<string, unknown>;
    switch (event.type) {
      case "run.started":
        console.log(`\n${c.cyan("▶ run started")} ${c.grey(`(${String(p.adapter)} / ${String(p.model)})`)}`);
        break;
      case "step.started":
        currentStep = Number(p.index ?? currentStep + 1);
        console.log(`\n${c.bold(`step ${currentStep}`)}`);
        break;
      case "model.response": {
        const calls = (p.toolCalls as string[]) ?? [];
        if (calls.length > 0) console.log(`  ${c.grey(`model requests: ${calls.join(", ")}`)}`);
        else if (options.verbose && p.contentPreview) console.log(`  ${c.grey(truncate(String(p.contentPreview), 200))}`);
        if (options.verbose) console.log(`  ${c.grey(`tokens: ${JSON.stringify(p.usage)}`)}`);
        break;
      }
      case "authorization.decided": {
        const allowed = p.allowed === true;
        const tag = allowed ? (p.approvalRequired ? c.magenta("⏸ approval required") : c.green("✓ allowed")) : c.red(`⛔ blocked (${String(p.code)})`);
        console.log(`  ${tag} ${c.bold(String(p.tool))} ${c.grey(formatArgs((p.args ?? {}) as Record<string, unknown>, 90))}`);
        if (!allowed) console.log(`      ${c.red(String(p.reason))}`);
        break;
      }
      case "action.completed": {
        const outcome = String(p.outcome ?? "");
        const mark = outcome === "success" ? c.green("✓") : outcome === "blocked" ? c.red("⛔") : c.red("✗");
        const verification = p.verification as { status?: string; summary?: string } | undefined;
        console.log(
          `  ${mark} ${c.grey("executed")} ${String(p.tool ?? "")} ${c.grey(`(${outcome}${p.durationMs !== undefined ? `, ${p.durationMs}ms` : ""})`)}${
            verification?.status ? ` ${statusBadge(verification.status)}` : ""
          }`,
        );
        if (options.verbose && p.text) console.log(c.grey(indentBlock(truncate(String(p.text), 1200), 6)));
        if (verification?.summary && verification.status !== "passed") console.log(`      ${c.grey(verification.summary)}`);
        break;
      }
      case "sre.alert":
        console.log(`  ${c.yellow(`⚠ Agent SRE [${String(p.kind)}/${String(p.severity)}]`)} ${String(p.message)}`);
        if (p.intervention) console.log(`      ${c.grey(truncate(String(p.intervention), 220))}`);
        break;
      case "verification.completed":
        if (p.blind) {
          console.log(`  ${c.magenta("◈ blind verifier (advisory):")} risk=${String((p.verdict as { risk?: string })?.risk)} recommendation=${String((p.verdict as { recommendation?: string })?.recommendation)}`);
        }
        break;
      case "log":
        if (options.verbose) console.log(`  ${c.grey(`[${String(p.level)}] ${String(p.message)}`)}`);
        break;
      case "run.completed":
        break;
      default:
        if (options.verbose) console.log(`  ${c.grey(`${event.type}: ${truncate(JSON.stringify(p), 160)}`)}`);
    }
  };
}

function indentBlock(text: string, spaces: number): string {
  return text
    .split("\n")
    .map((line) => `${" ".repeat(spaces)}${line}`)
    .join("\n");
}
