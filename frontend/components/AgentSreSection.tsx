"use client";

import React from "react";
import { 
  AlertTriangle, 
  RotateCcw, 
  Flame, 
  Clock, 
  TrendingDown, 
  Shuffle, 
  Activity,
  ArrowRight
} from "lucide-react";
import { motion } from "framer-motion";

export function AgentSreSection() {
  const failureModes = [
    {
      title: "Infinite Loops",
      icon: <RotateCcw size={15} />,
      desc: "Repetitively querying the same file or state without producing new forward progress."
    },
    {
      title: "Runaway Tool Calls",
      icon: <AlertTriangle size={15} />,
      desc: "Hammering external APIs, terminals, or databases in rapid unconstrained succession."
    },
    {
      title: "Excessive Token Burn",
      icon: <Flame size={15} />,
      desc: "Accumulating massive conversational contexts that drain token budgets with diminishing returns."
    },
    {
      title: "Oscillation",
      icon: <Shuffle size={15} />,
      desc: "Flipping back and forth between two mutually incompatible changes or hypotheses."
    },
    {
      title: "Stalled Runs",
      icon: <Clock size={15} />,
      desc: "Hanging on unresponsive sub-processes or unhandled tool timeouts without recovery."
    },
    {
      title: "State Degeneracy",
      icon: <TrendingDown size={15} />,
      desc: "Gradually corrupting working copies or context graphs as steps accumulate."
    }
  ];

  return (
    <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
      <div className="max-w-3xl mb-14">
        <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-3 font-semibold">
          Agent Reliability &amp; SRE
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl leading-tight">
          Agents fail differently.
        </h2>
        <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed">
          Traditional software fails with explicit stack traces and status codes. Autonomous agents fail through subtle behavioral degeneration: looping endlessly, burning tokens, oscillating between approaches, or quietly hallucinating away previous progress.
        </p>
        <p className="mt-3 text-sm sm:text-base text-muted-foreground leading-relaxed">
          We position <strong>Agent SRE</strong> as a fundamental pillar of Sudarshan AI: making agent execution actively observable, bounded, and recoverable.
        </p>
      </div>

      {/* Six Agent Failure Modes Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-14">
        {failureModes.map((mode) => (
          <motion.div
            key={mode.title}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.2 }}
            className="rounded-xl border border-border bg-surface p-5 transition-all hover:border-foreground/30 hover:bg-surface-elevated hover:shadow-xs"
          >
            <div className="flex items-center gap-2 mb-2 text-foreground">
              <div className="flex h-6 w-6 items-center justify-center rounded-md bg-muted text-foreground">
                {mode.icon}
              </div>
              <h3 className="text-sm font-semibold">{mode.title}</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {mode.desc}
            </p>
          </motion.div>
        ))}
      </div>

      {/* SRE Control Pipeline */}
      <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8 shadow-xs">
        <div className="flex items-center justify-between mb-6 border-b border-border/80 pb-4">
          <div className="flex items-center gap-2 font-mono text-xs text-muted-foreground">
            <Activity size={14} className="text-foreground" />
            <span className="font-semibold text-foreground">THE AGENT SRE LOOP</span>
          </div>
          <span className="text-[11px] font-mono text-muted-foreground uppercase">
            Active Watchdog Runtime
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-center text-center font-mono text-xs">
          <div className="rounded-lg border border-border bg-surface-elevated p-4">
            <span className="text-[10px] text-muted-foreground block mb-1">01 / Runtime</span>
            <span className="font-bold text-foreground">Execution</span>
            <span className="text-[10px] text-muted-foreground block mt-1 font-sans">Active tool &amp; reasoning cycles</span>
          </div>

          <div className="rounded-lg border border-border bg-surface-elevated p-4">
            <span className="text-[10px] text-muted-foreground block mb-1">02 / Telemetry</span>
            <span className="font-bold text-foreground">Observe</span>
            <span className="text-[10px] text-muted-foreground block mt-1 font-sans">Track trajectory, tokens, calls</span>
          </div>

          <div className="rounded-lg border-2 border-border-strong bg-surface-elevated p-4">
            <span className="text-[10px] text-foreground block mb-1">03 / Analytics</span>
            <span className="font-bold text-foreground">Detect Anomaly</span>
            <span className="text-[10px] text-muted-foreground block mt-1 font-sans">Spot loops, stalls, oscillations</span>
          </div>

          <div className="rounded-lg border border-border bg-surface-elevated p-4">
            <span className="text-[10px] text-muted-foreground block mb-1">04 / Intervention</span>
            <span className="font-bold text-foreground">Mitigate</span>
            <span className="text-[10px] text-muted-foreground block mt-1 font-sans">Recover, stop, or escalate</span>
          </div>
        </div>
      </div>
    </section>
  );
}
