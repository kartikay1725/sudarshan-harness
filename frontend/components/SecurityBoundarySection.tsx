"use client";

import React from "react";
import { ShieldCheck, Lock, CheckCircle2, XCircle, ArrowRight } from "lucide-react";
import { motion } from "framer-motion";

export function SecurityBoundarySection() {
  const boundaryGuarantees = [
    {
      title: "Immutable Permissions",
      desc: "An agent cannot expand its own permission boundaries or escalate token privileges during a session."
    },
    {
      title: "External Verification Rules",
      desc: "Tests, linters, and verification checks run in isolated environments inaccessible to model modification."
    },
    {
      title: "Sovereign Termination",
      desc: "Watchdogs and heartbeat timers run out-of-band. The agent cannot disable its own kill-switches or budgets."
    },
    {
      title: "Non-Self-Approval",
      desc: "An agent cannot self-sign pull requests, bypass branch protection, or merge its own changes without external authority."
    }
  ];

  return (
    <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
      <div className="max-w-3xl mb-14">
        <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-3 font-semibold">
          Security &amp; Control Boundary
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl leading-tight">
          The agent doesn&apos;t own the boundary.
        </h2>
        <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed">
          In traditional sandboxes or agent frameworks, the agent often has visibility into its own system prompt or execution runner. In Sudarshan AI, the security and authority perimeter lives strictly outside the agent.
        </p>
        <p className="mt-3 text-sm sm:text-base text-muted-foreground leading-relaxed">
          An agent cannot modify its own permissions, rewrite verification rules, disable governance policies, suppress monitoring, or tamper with termination conditions.
        </p>
      </div>

      {/* Conceptual Flow Diagram */}
      <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8 mb-12 shadow-xs">
        <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-6">
          Authority Evaluation Pipeline
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-5 gap-3 items-center text-center font-mono text-xs">
          <div className="rounded-lg border border-border bg-surface-elevated p-4">
            <span className="text-[10px] text-muted-foreground block mb-1">01 / Request</span>
            <span className="font-semibold text-foreground">Agent Requests Action</span>
            <span className="text-[10px] text-muted-foreground block mt-1 font-sans">Proposes file edit or API call</span>
          </div>

          <div className="text-muted-foreground">→</div>

          <div className="rounded-lg border-2 border-border-strong bg-surface-elevated p-4">
            <span className="text-[10px] text-foreground block mb-1">02 / Authority Gate</span>
            <span className="font-semibold text-foreground">Harness Evaluates</span>
            <span className="text-[10px] text-muted-foreground block mt-1 font-sans">Checks capability &amp; policy</span>
          </div>

          <div className="text-muted-foreground">→</div>

          <div className="rounded-lg border border-border bg-surface-elevated p-4">
            <span className="text-[10px] text-muted-foreground block mb-1">03 / Decision</span>
            <span className="font-semibold text-foreground">Allow / Deny</span>
            <span className="text-[10px] text-muted-foreground block mt-1 font-sans">Proceeds only if authorized</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-6 pt-6 border-t border-border/80">
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-emerald-500/10 text-emerald-500 shrink-0">
              <CheckCircle2 size={15} />
            </div>
            <span><strong>Independent Verification:</strong> Output tested in isolated runtime before state persistence.</span>
          </div>
          <div className="flex items-center gap-3 text-xs text-muted-foreground">
            <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-foreground shrink-0">
              <Lock size={15} />
            </div>
            <span><strong>Sovereign State:</strong> Security rules remain immutable to agent prompt injection or persuasion.</span>
          </div>
        </div>
      </div>

      {/* Boundary Guarantees Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {boundaryGuarantees.map((item) => (
          <div
            key={item.title}
            className="rounded-xl border border-border bg-surface p-5 transition-all hover:border-border-strong"
          >
            <div className="flex items-center gap-2 mb-2 text-foreground">
              <ShieldCheck size={14} className="text-foreground" />
              <h3 className="text-xs font-semibold">{item.title}</h3>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {item.desc}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
