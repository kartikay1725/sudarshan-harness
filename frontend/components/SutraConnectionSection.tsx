"use client";

import React from "react";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";

export function SutraConnectionSection() {
  return (
    <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
      <div className="max-w-3xl mb-12">
        <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-3 font-semibold">
          First Concrete Implementation
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl leading-tight">
          SUTRA is where we&apos;re starting.
        </h2>
        <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
          Sudarshan AI is the broader infrastructure vision. SUTRA is the first product built around that philosophy, focused specifically on AI-native software engineering.
        </p>
      </div>

      <div className="rounded-2xl border border-border bg-surface p-8 sm:p-10 shadow-xs">
        {/* Conceptual Hierarchy Flow */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6 border-b border-border/80 pb-8 mb-8">
          <div className="flex flex-col gap-1">
            <span className="font-mono text-[11px] text-muted-foreground uppercase tracking-wider">
              SUDARSHAN AI PRODUCT HIERARCHY
            </span>
            <div className="flex flex-wrap items-center gap-2 text-xs font-mono mt-1">
              <span className="font-bold text-foreground">Sudarshan AI</span>
              <span className="text-muted-foreground">→</span>
              <span className="text-muted-foreground">Software Engineering Harness</span>
              <span className="text-muted-foreground">→</span>
              <span className="font-bold text-sutra">SUTRA</span>
            </div>
          </div>

          <a
            href="https://sutra.sudarshanai.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="sutra-link inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-sutra/50 bg-surface-elevated px-5 text-xs font-medium text-sutra transition-all duration-200 hover:bg-sutra hover:text-white active:scale-[0.98]"
          >
            <span>Explore SUTRA</span>
            <ArrowUpRight size={14} className="arrow-icon text-sutra group-hover:text-white" />
          </a>
        </div>

        <p className="text-sm text-muted-foreground leading-relaxed max-w-3xl mb-6">
          In SUTRA, the harness envelope directly isolates coding agents during repository tasks: applying strict branch protections, running containerized CI verification check suites, generating cryptographically verified commit provenance, and requiring human review sign-offs before any code merges to main.
        </p>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          {[
            "Isolated Workspace Leases",
            "Discrete Change Tracking",
            "CI Check Verification",
            "Multi-Pillar Governance",
            "Cryptographic Provenance",
            "Branch Protection Invariants",
            "Human Sign-off Authority",
            "Zero Unauthorized Self-Merges"
          ].map((item) => (
            <div
              key={item}
              className="flex items-center gap-2 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs font-mono text-foreground/90"
            >
              <CheckCircle2 size={13} className="text-sutra shrink-0" />
              <span className="truncate">{item}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
