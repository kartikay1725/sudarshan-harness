import type { RiskLevel } from "../types.js";

export interface BudgetUsage {
  steps: number;
  toolCalls: number;
  allowedCalls: number;
  blockedCalls: number;
  tokens: number;
  promptTokens: number;
  completionTokens: number;
  startedAt: number;
  elapsedMs: number;
  repeatedActionPeak: number;
  unverifiedSteps: number;
}

export interface BudgetLimits {
  maxSteps: number;
  maxToolCalls: number;
  maxTokens: number;
  maxWallClockMs: number;
}

export interface BudgetViolation {
  limit: keyof BudgetLimits | "repeated" | "unverified";
  used: number;
  allowed: number;
  message: string;
}

/**
 * Budgets are a safety mechanism, not a billing mechanism. An agent that burns
 * 400k tokens or 120 tool calls without finishing is either confused or stuck;
 * either way the Harness stops it rather than letting it continue.
 */
export class BudgetTracker {
  usage: BudgetUsage;

  constructor(private limits: BudgetLimits) {
    this.usage = {
      steps: 0,
      toolCalls: 0,
      allowedCalls: 0,
      blockedCalls: 0,
      tokens: 0,
      promptTokens: 0,
      completionTokens: 0,
      startedAt: Date.now(),
      elapsedMs: 0,
      repeatedActionPeak: 0,
      unverifiedSteps: 0,
    };
  }

  tick(): void {
    this.usage.elapsedMs = Date.now() - this.usage.startedAt;
  }

  addStep(): void {
    this.usage.steps++;
    this.tick();
  }

  addToolCall(allowed: boolean): void {
    this.usage.toolCalls++;
    if (allowed) this.usage.allowedCalls++;
    else this.usage.blockedCalls++;
    this.tick();
  }

  addTokens(prompt: number, completion: number): void {
    this.usage.promptTokens += prompt;
    this.usage.completionTokens += completion;
    this.usage.tokens += prompt + completion;
    this.tick();
  }

  noteRepeatedAction(count: number): void {
    this.usage.repeatedActionPeak = Math.max(this.usage.repeatedActionPeak, count);
  }

  noteVerification(verified: boolean): void {
    this.usage.unverifiedSteps = verified ? 0 : this.usage.unverifiedSteps + 1;
  }

  violation(): BudgetViolation | undefined {
    this.tick();
    const u = this.usage;
    const l = this.limits;
    if (u.steps >= l.maxSteps) return { limit: "maxSteps", used: u.steps, allowed: l.maxSteps, message: `step budget exhausted (${u.steps}/${l.maxSteps})` };
    if (u.toolCalls >= l.maxToolCalls) return { limit: "maxToolCalls", used: u.toolCalls, allowed: l.maxToolCalls, message: `tool-call budget exhausted (${u.toolCalls}/${l.maxToolCalls})` };
    if (u.tokens >= l.maxTokens) return { limit: "maxTokens", used: u.tokens, allowed: l.maxTokens, message: `token budget exhausted (${u.tokens}/${l.maxTokens})` };
    if (u.elapsedMs >= l.maxWallClockMs) return { limit: "maxWallClockMs", used: u.elapsedMs, allowed: l.maxWallClockMs, message: `wall-clock budget exhausted (${Math.round(u.elapsedMs / 1000)}s)` };
    return undefined;
  }

  /** Advisory violations do not block an action; they trigger an SRE intervention. */
  advisories(maxRepeated: number, maxUnverified: number): BudgetViolation[] {
    const out: BudgetViolation[] = [];
    if (this.usage.repeatedActionPeak >= maxRepeated) {
      out.push({ limit: "repeated", used: this.usage.repeatedActionPeak, allowed: maxRepeated, message: `same action repeated ${this.usage.repeatedActionPeak}x` });
    }
    if (this.usage.unverifiedSteps >= maxUnverified) {
      out.push({ limit: "unverified", used: this.usage.unverifiedSteps, allowed: maxUnverified, message: `${this.usage.unverifiedSteps} consecutive steps without a verified state change` });
    }
    const violation = this.violation();
    if (violation) out.push(violation);
    return out;
  }

  percent(): Record<string, number> {
    return {
      steps: pct(this.usage.steps, this.limits.maxSteps),
      toolCalls: pct(this.usage.toolCalls, this.limits.maxToolCalls),
      tokens: pct(this.usage.tokens, this.limits.maxTokens),
      wallClock: pct(this.usage.elapsedMs, this.limits.maxWallClockMs),
    };
  }
}

function pct(used: number, max: number): number {
  if (!max) return 0;
  return Math.round((used / max) * 100);
}

export function riskAtLeast(risk: RiskLevel, threshold: RiskLevel): boolean {
  const order: RiskLevel[] = ["low", "medium", "high", "critical"];
  return order.indexOf(risk) >= order.indexOf(threshold);
}
