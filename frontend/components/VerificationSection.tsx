"use client";

import React from "react";
import { CheckCircle2, XCircle, ArrowRight, ShieldCheck } from "lucide-react";
import { motion } from "framer-motion";

export function VerificationSection() {
  const verificationMechanisms = [
    { name: "Deterministic Checks", desc: "Binary assertions, schema validations, and deterministic assertions that cannot be negotiated." },
    { name: "Test Suites", desc: "Automated unit, integration, and end-to-end regression suites run in isolated sandboxes." },
    { name: "Policy Rules", desc: "Organizational invariants, sensitive file prohibitions, and credential leakage scanners." },
    { name: "Static Analysis", desc: "AST linters, type checkers, and security vulnerability scanners evaluated out-of-band." },
    { name: "External Validators", desc: "Third-party oracle verification, CI/CD pipeline triggers, and staging deploy health checks." },
    { name: "Consensus Checks", desc: "Independent model evaluation or human sign-off gates for high-risk operations." }
  ];

  return (
    <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
      <div className="max-w-3xl mb-14">
        <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-3 font-semibold">
          Independent Verification
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl leading-tight">
          An agent should not be the final judge of its own work.
        </h2>
        <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed">
          When an agent declares &ldquo;I have completed the task,&rdquo; that statement is merely a claim from a probabilistic model. Treating agent self-assessment as trusted output creates catastrophic failure modes.
        </p>
      </div>

      {/* Comparison: Agent Completion vs Verified Completion */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 mb-14">
        {/* Agent Completion Box */}
        <div className="rounded-xl border border-red-500/20 bg-surface p-6 sm:p-7 relative">
          <div className="flex items-center justify-between mb-4">
            <span className="font-mono text-xs text-red-500 uppercase tracking-wider font-semibold">
              The Flawed Assumption
            </span>
            <XCircle size={18} className="text-red-500/80" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">
            &ldquo;Agent Completion&rdquo;
          </h3>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            The model generates output, evaluates its own responses, and declares success without external verification. If the agent hallucinates, misses edge cases, or introduces breaking changes, the error passes directly to production.
          </p>
        </div>

        {/* Verified Completion Box */}
        <div className="rounded-xl border-2 border-emerald-500/40 bg-surface-elevated p-6 sm:p-7 relative shadow-xs">
          <div className="flex items-center justify-between mb-4">
            <span className="font-mono text-xs text-emerald-500 uppercase tracking-wider font-semibold">
              The Harness Standard
            </span>
            <CheckCircle2 size={18} className="text-emerald-500" />
          </div>
          <h3 className="text-lg font-bold text-foreground mb-2">
            &ldquo;Verified Completion&rdquo;
          </h3>
          <p className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            The agent proposes an action or change. The Harness runs external, deterministic verification checks. Output is accepted only if independent checks pass; otherwise, the Harness intervenes to recover, retry, or escalate.
          </p>
        </div>
      </div>

      {/* Verification Flow Diagram */}
      <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8 mb-12 shadow-xs">
        <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-6">
          Verification Flow
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-4 gap-4 items-center text-center">
          <div className="rounded-lg border border-border bg-surface-elevated p-4">
            <span className="font-mono text-[10px] text-muted-foreground block mb-1">01</span>
            <span className="text-xs font-semibold text-foreground">Agent Executes</span>
            <span className="text-[10px] text-muted-foreground block mt-1">Generates plan or diff</span>
          </div>

          <div className="flex items-center justify-center text-muted-foreground">
            <ArrowRight size={16} className="hidden sm:block text-muted-foreground" />
            <span className="sm:hidden font-mono text-xs">↓</span>
          </div>

          <div className="rounded-lg border-2 border-border-strong bg-surface-elevated p-4">
            <span className="font-mono text-[10px] text-foreground block mb-1">02</span>
            <span className="text-xs font-semibold text-foreground">Independent Verification</span>
            <span className="text-[10px] text-muted-foreground block mt-1">External assertions &amp; tests</span>
          </div>

          <div className="flex items-center justify-center text-muted-foreground">
            <ArrowRight size={16} className="hidden sm:block text-muted-foreground" />
            <span className="sm:hidden font-mono text-xs">↓</span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <div className="rounded-lg border border-emerald-500/30 bg-emerald-500/5 p-4 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-foreground">Outcome: PASS</span>
              <p className="text-[11px] text-muted-foreground">Continue pipeline or request human approval</p>
            </div>
            <CheckCircle2 size={16} className="text-emerald-500" />
          </div>

          <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 flex items-center justify-between">
            <div>
              <span className="text-xs font-semibold text-foreground">Outcome: FAIL</span>
              <p className="text-[11px] text-muted-foreground">Recover context, retry with feedback, or halt execution</p>
            </div>
            <XCircle size={16} className="text-amber-500" />
          </div>
        </div>
      </div>

      {/* Mechanism Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {verificationMechanisms.map((mech) => (
          <div
            key={mech.name}
            className="rounded-xl border border-border bg-surface p-5 transition-all hover:border-border-strong"
          >
            <div className="flex items-center gap-2 mb-2">
              <ShieldCheck size={14} className="text-foreground" />
              <h3 className="text-xs font-semibold text-foreground">{mech.name}</h3>
            </div>
            <p className="text-[11px] text-muted-foreground leading-relaxed">
              {mech.desc}
            </p>
          </div>
        ))}
      </div>
    </section>
  );
}
