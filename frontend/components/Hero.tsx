"use client";

import React from "react";
import Image from "next/image";
import { ArrowRight, ArrowUpRight, Cpu, Bot, Shield, CheckCircle2, Server } from "lucide-react";
import { motion } from "framer-motion";

export function Hero() {
  const harnessPrimitives = [
    "Identity",
    "Context",
    "Tools",
    "Permissions",
    "Execution",
    "Independent Verification",
    "Reliability / Agent SRE",
    "Governance",
    "Observability",
  ];

  return (
    <section className="relative mx-auto max-w-6xl px-6 pt-20 pb-16 md:pt-28 md:pb-24">
      {/* Top Hero Layout: Headline & Copy on the Left, Logo on the Right */}
      <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-8 lg:gap-12">
        <div className="max-w-2xl xl:max-w-3xl flex-1">
          <motion.h1
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.05, ease: [0.16, 1, 0.3, 1] }}
            className="text-4xl font-bold tracking-tight text-foreground sm:text-6xl md:text-7xl leading-[1.08]"
          >
            Build the environment your AI agents operate in.
          </motion.h1>

          <motion.p
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.12, ease: [0.16, 1, 0.3, 1] }}
            className="mt-6 text-base sm:text-xl text-muted-foreground leading-relaxed font-normal"
          >
            Sudarshan AI is a customizable, model-agnostic infrastructure layer for building AI agent environments with the tools, permissions, verification and reliability controls you choose.
          </motion.p>

          {/* Primary CTA & Secondary SUTRA Link */}
          <motion.div
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.45, delay: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="mt-8 flex flex-wrap items-center gap-5"
          >
            <a
              href="#pre-register"
              className="inline-flex h-11 items-center justify-center gap-2 rounded-xl bg-foreground px-6 text-sm font-medium text-background shadow-xs transition-all duration-200 hover:opacity-90 active:scale-[0.98]"
            >
              Pre-register <ArrowRight size={15} />
            </a>

            <a
              href="https://sutra.sudarshanai.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="sutra-link inline-flex items-center gap-1.5 text-xs font-medium text-sutra hover:text-sutra-hover transition-colors py-2"
            >
              <span>See what we&apos;re building with SUTRA</span>
              <ArrowUpRight size={14} className="arrow-icon text-sutra" />
            </a>
          </motion.div>
        </div>

        {/* Freely floating logo beside Hero (no box/border) */}
        <motion.div
          initial={{ opacity: 0, scale: 0.92 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.55, delay: 0.15, ease: [0.16, 1, 0.3, 1] }}
          className="flex items-center justify-center lg:justify-end shrink-0 self-center"
        >
          <Image
            src="/logo.png"
            alt="Sudarshan AI logo"
            width={240}
            height={240}
            className="w-36 h-36 sm:w-44 sm:h-44 lg:w-56 lg:h-56 xl:w-64 xl:h-64 object-contain select-none transition-transform duration-500 hover:scale-105"
            priority
          />
        </motion.div>
      </div>

      {/* Hero Visual: System Architecture Flow Diagram */}
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.55, delay: 0.25, ease: [0.16, 1, 0.3, 1] }}
        className="mt-16 rounded-2xl border border-border bg-surface p-6 sm:p-8 shadow-xs"
      >
        {/* Diagram header bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border/80 pb-4 mb-6 text-xs font-mono">
          <div className="flex items-center gap-2 text-muted-foreground">
            <span className="h-2 w-2 rounded-full bg-foreground" />
            <span className="font-semibold text-foreground">EXECUTION ARCHITECTURE</span>
            <span className="text-border">|</span>
            <span className="hidden sm:inline">INDEPENDENT CONTROL PLANE</span>
          </div>
          <div className="text-[11px] text-muted-foreground">
            BOUNDARY: EXTERNAL TO AGENT
          </div>
        </div>

        {/* System Diagram Grid Flow */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 items-stretch">
          {/* Step 1: Model & Agent (Col 1-3) */}
          <div className="lg:col-span-3 flex flex-col gap-3">
            <div className="rounded-xl border border-border bg-surface-elevated p-4 flex-1 transition-all hover:border-foreground/30">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                  01 / Intelligence
                </span>
                <Cpu size={14} className="text-muted-foreground" />
              </div>
              <h2 className="text-sm font-semibold text-foreground mb-1">
                AI Model
              </h2>
              <p className="text-xs text-muted-foreground">
                Provides reasoning and raw token generation. Model-agnostic (Claude, GPT, Codex, Gemini, Llama).
              </p>
            </div>

            <div className="flex justify-center text-muted-foreground">
              <span className="font-mono text-xs">↓</span>
            </div>

            <div className="rounded-xl border border-border bg-surface-elevated p-4 flex-1 transition-all hover:border-foreground/30">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                  02 / Action
                </span>
                <Bot size={14} className="text-muted-foreground" />
              </div>
              <h2 className="text-sm font-semibold text-foreground mb-1">
                AI Agent
              </h2>
              <p className="text-xs text-muted-foreground">
                Formulates intent, requests tool invocations, and proposes changes.
              </p>
            </div>
          </div>

          {/* Connector Arrow (lg only) */}
          <div className="hidden lg:flex lg:col-span-1 items-center justify-center text-muted-foreground font-mono text-lg">
            →
          </div>

          {/* Step 2: The Harness Control Plane (Col 5-8) */}
          <div className="lg:col-span-5 rounded-xl border-2 border-border-strong bg-surface-elevated p-5 relative shadow-xs">
            <div className="absolute -top-3 left-4 rounded-md bg-foreground px-2 py-0.5 text-[10px] font-mono font-medium tracking-wide text-background uppercase">
              Sudarshan AI
            </div>

            <div className="flex items-center justify-between mb-3 mt-1">
              <span className="font-mono text-[10px] text-foreground uppercase tracking-wider font-semibold">
                Control Plane &amp; Execution Envelope
              </span>
              <Shield size={16} className="text-foreground" />
            </div>

            <p className="text-xs text-muted-foreground mb-4">
              Sits around the agent. Independently governs access, verifies outcomes, and enforces security invariants.
            </p>

            {/* Modular Blocks Grid */}
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
              {harnessPrimitives.map((prim) => (
                <div
                  key={prim}
                  className="rounded-lg border border-border bg-surface px-2.5 py-2 text-[11px] font-mono font-medium text-foreground/90 transition-colors hover:border-foreground/40 hover:bg-surface-elevated"
                >
                  {prim}
                </div>
              ))}
            </div>
          </div>

          {/* Connector Arrow (lg only) */}
          <div className="hidden lg:flex lg:col-span-1 items-center justify-center text-muted-foreground font-mono text-lg">
            →
          </div>

          {/* Step 3: Controls & Real Systems (Col 10-12) */}
          <div className="lg:col-span-2 flex flex-col gap-3">
            <div className="rounded-xl border border-border bg-surface-elevated p-4 flex-1 transition-all hover:border-foreground/30">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                  Verification
                </span>
                <CheckCircle2 size={14} className="text-emerald-500" />
              </div>
              <h2 className="text-xs font-semibold text-foreground mb-1">
                Deterministic Checks
              </h2>
              <p className="text-[11px] text-muted-foreground">
                Tests, schemas, static analysis, and independent validators.
              </p>
            </div>

            <div className="rounded-xl border border-border bg-surface-elevated p-4 flex-1 transition-all hover:border-foreground/30">
              <div className="flex items-center justify-between mb-2">
                <span className="font-mono text-[10px] text-muted-foreground uppercase tracking-wider">
                  Target
                </span>
                <Server size={14} className="text-muted-foreground" />
              </div>
              <h2 className="text-xs font-semibold text-foreground mb-1">
                Real Systems
              </h2>
              <p className="text-[11px] text-muted-foreground">
                APIs, repositories, production services, and cloud databases.
              </p>
            </div>
          </div>
        </div>

        {/* Architecture Invariant Subtext */}
        <div className="mt-6 pt-4 border-t border-border/80 flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs font-mono text-muted-foreground">
          <span>THESIS: AI models provide intelligence. Agents provide action. Harnesses provide control.</span>
          <span className="text-foreground font-medium">The agent never defines its own boundary.</span>
        </div>
      </motion.div>
    </section>
  );
}
