import type { ActionClassification, SreAlert } from "../types.js";
import type { EventBus } from "../events/bus.js";
import { newId, nowIso, shortHash, canonicalJson } from "../util/index.js";

export interface SreLimits {
  maxRepeatedActions: number;
  maxUnverifiedSteps: number;
  windowSize: number;
  maxCallsPerStep: number;
}

export const DEFAULT_SRE_LIMITS: SreLimits = {
  maxRepeatedActions: 3,
  maxUnverifiedSteps: 5,
  windowSize: 24,
  maxCallsPerStep: 12,
};

interface Observation {
  signature: string;
  tool: string;
  at: string;
  succeeded?: boolean;
  verified?: boolean;
}

/**
 * Agent SRE — the out-of-band watchdog.
 *
 * It watches for the behavioural failure modes of autonomous agents:
 *   loop             same action, same arguments, over and over
 *   oscillation      A -> B -> A -> B (two contradictory approaches fighting)
 *   repeated_failure the same call keeps erroring
 *   stall            steps are passing but nothing verified is changing
 *   runaway          a single step fires an absurd number of tool calls
 *   budget           tokens / calls / wall clock exhausted
 *
 * Two hard rules:
 *   1. The watchdog observes; it never executes. It cannot touch the system.
 *   2. Recovery does not expand authority. An intervention is a *message* to
 *      the agent plus, at most, a stop. It never grants a permission, widens
 *      a scope or relaxes a budget.
 */
export class AgentSre {
  private observations: Observation[] = [];
  private pending: SreAlert[] = [];
  private alerts: SreAlert[] = [];
  private stepCalls = 0;
  private unverifiedSteps = 0;
  private limits: SreLimits;

  constructor(limits: Partial<SreLimits> = {}, private bus?: EventBus) {
    this.limits = { ...DEFAULT_SRE_LIMITS, ...limits };
  }

  signature(tool: string, args: Record<string, unknown>, classification?: ActionClassification): string {
    if (classification?.signature) return `${tool}::${classification.signature}`;
    return `${tool}::${shortHash(canonicalJson(args), 12)}`;
  }

  beginStep(): void {
    this.stepCalls = 0;
  }

  /**
   * Called by the gate BEFORE execution. Returns an alert when the pattern is
   * already bad enough to intervene; `action === "stop"` means the gate must
   * refuse the call.
   */
  evaluateAction(tool: string, args: Record<string, unknown>, classification?: ActionClassification): SreAlert | undefined {
    const sig = this.signature(tool, args, classification);
    const consecutive = this.consecutiveCount(sig);

    this.stepCalls++;
    if (this.stepCalls > this.limits.maxCallsPerStep) {
      return this.raise({
        kind: "runaway",
        severity: "critical",
        message: `${this.stepCalls} tool calls in a single step exceeds the runaway threshold (${this.limits.maxCallsPerStep}).`,
        intervention:
          "HARNESS: You have issued an excessive number of tool calls in one step. Stop, summarise what is actually left, and issue at most one action.",
        action: "stop",
      });
    }

    if (consecutive + 1 >= this.limits.maxRepeatedActions * 2) {
      return this.raise({
        kind: "loop",
        severity: "critical",
        message: `Action "${tool}" with identical arguments has now been attempted ${consecutive + 1} times.`,
        intervention: `HARNESS: BLOCKED. You are repeating the identical action "${tool}" with no change in result. Repeating it will not succeed. Choose a materially different approach, or report that the task cannot be completed and explain the blocker.`,
        action: "stop",
      });
    }

    if (consecutive + 1 >= this.limits.maxRepeatedActions) {
      return this.raise({
        kind: "loop",
        severity: "warn",
        message: `Action "${tool}" repeated ${consecutive + 1}x with identical arguments.`,
        intervention: `HARNESS: You appear to be repeating the same action ("${tool}") with identical arguments. Stop and reconsider your approach — the next identical call will be blocked.`,
        action: "advise",
      });
    }

    const oscillation = this.detectOscillation(sig);
    if (oscillation) {
      return this.raise({
        kind: "oscillation",
        severity: "warn",
        message: `Oscillation detected between ${oscillation.a} and ${oscillation.b}.`,
        intervention:
          "HARNESS: You are oscillating between two contradictory approaches. Pick one, state the criterion you will use to decide, and verify it once — do not undo it again.",
        action: "advise",
      });
    }

    const failures = this.failureCount(sig);
    if (failures >= 3) {
      return this.raise({
        kind: "repeated_failure",
        severity: "warn",
        message: `"${tool}" has failed ${failures} times with identical arguments.`,
        intervention: `HARNESS: "${tool}" keeps failing with the same arguments. Read the error evidence, change the arguments or the approach. Do not retry the identical call.`,
        action: "advise",
      });
    }

    return undefined;
  }

  /** Record what actually happened so loop/failure detection uses facts. */
  observe(tool: string, args: Record<string, unknown>, outcome: { succeeded: boolean; verified: boolean; classification?: ActionClassification }): void {
    const sig = this.signature(tool, args, outcome.classification);
    this.observations.push({ signature: sig, tool, at: nowIso(), succeeded: outcome.succeeded, verified: outcome.verified });
    if (this.observations.length > this.limits.windowSize * 4) {
      this.observations.splice(0, this.observations.length - this.limits.windowSize * 4);
    }
  }

  /** Called at the end of each step with whether anything verified changed. */
  endStep(verifiedChange: boolean): SreAlert[] {
    const raised: SreAlert[] = [];
    if (verifiedChange) {
      this.unverifiedSteps = 0;
    } else {
      this.unverifiedSteps++;
      if (this.unverifiedSteps >= this.limits.maxUnverifiedSteps) {
        const alert = this.raise({
          kind: "stall",
          severity: this.unverifiedSteps >= this.limits.maxUnverifiedSteps * 2 ? "critical" : "warn",
          message: `${this.unverifiedSteps} consecutive steps produced no verified state change.`,
          intervention:
            "HARNESS: Several steps have passed with no verified change in the real system. Restate the remaining work as concrete, checkable outcomes, then take one action that changes state.",
          action: this.unverifiedSteps >= this.limits.maxUnverifiedSteps * 2 ? "stop" : "advise",
        });
        raised.push(alert);
      }
    }
    return raised;
  }

  /** Budget exhaustion is a hard stop, raised out-of-band by the watchdog. */
  raiseBudget(message: string): SreAlert {
    return this.raise({
      kind: "budget",
      severity: "critical",
      message,
      intervention:
        "HARNESS: your execution budget is exhausted. Stop requesting actions and report exactly what is finished, what is verified, and what remains.",
      action: "stop",
    });
  }

  /** Feedback the orchestrator injects into the next model call. */
  takeInterventions(): string[] {
    const messages = this.pending.map((a) => a.intervention).filter((m): m is string => !!m);
    this.pending = [];
    return messages;
  }

  all(): SreAlert[] {
    return [...this.alerts];
  }

  snapshot(): { observations: number; unverifiedSteps: number; alerts: SreAlert[] } {
    return { observations: this.observations.length, unverifiedSteps: this.unverifiedSteps, alerts: this.all() };
  }

  reset(): void {
    this.observations = [];
    this.pending = [];
    this.alerts = [];
    this.stepCalls = 0;
    this.unverifiedSteps = 0;
  }

  /* ---------------- internals ---------------- */

  private consecutiveCount(sig: string): number {
    let count = 0;
    for (let i = this.observations.length - 1; i >= 0; i--) {
      if (this.observations[i]!.signature === sig) count++;
      else break;
    }
    return count;
  }

  private failureCount(sig: string): number {
    return this.observations.filter((o) => o.signature === sig && o.succeeded === false).length;
  }

  private detectOscillation(currentSig: string): { a: string; b: string } | undefined {
    const recent = [...this.observations.slice(-6).map((o) => o.signature), currentSig];
    if (recent.length < 4) return undefined;
    const tail = recent.slice(-4);
    const [s1, s2, s3, s4] = tail as [string, string, string, string];
    if (s1 !== s2 && s1 === s3 && s2 === s4) {
      return { a: this.toolOf(s1), b: this.toolOf(s2) };
    }
    return undefined;
  }

  private toolOf(sig: string): string {
    return this.observations.find((o) => o.signature === sig)?.tool ?? sig.split("::")[0] ?? sig;
  }

  private raise(alert: Omit<SreAlert, "id" | "createdAt">): SreAlert {
    const full: SreAlert = { id: newId("sre"), createdAt: nowIso(), ...alert };
    this.alerts.push(full);
    this.pending.push(full);
    this.bus?.emit("sre.alert", full);
    return full;
  }
}
