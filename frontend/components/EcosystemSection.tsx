"use client";

import React from "react";
import { ArrowUpRight, CheckCircle2 } from "lucide-react";
import { motion } from "framer-motion";

export function EcosystemSection() {
  return (
    <>
      {/* 7. AGENT-AGNOSTIC */}
      <section className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
        <div className="rounded-2xl border border-border bg-surface p-8 sm:p-12 shadow-xs">
          <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-3">
            Open Interoperability
          </div>
          <h2 className="text-2xl sm:text-4xl font-bold tracking-tight text-foreground mb-4">
            Bring the agents you already use.
          </h2>
          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed max-w-2xl mb-8">
            Sudarshan AI is built around an agent-agnostic model. Rather than forcing your team into a single proprietary coding model, the harness wraps around whatever autonomous systems you deploy today and tomorrow.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3.5">
            {[
              { name: "Claude", desc: "Anthropic API & Claude Code" },
              { name: "Codex", desc: "OpenAI code models & CLI" },
              { name: "Cursor", desc: "Background agent rules" },
              { name: "Open-source", desc: "Llama, DeepSeek, Qwen" },
              { name: "Custom Agents", desc: "Internal LangChain / CrewAI" },
              { name: "Future Agents", desc: "Next-generation models" },
            ].map((agent) => (
              <motion.div
                key={agent.name}
                whileHover={{ y: -2 }}
                transition={{ duration: 0.15 }}
                className="rounded-xl border border-border bg-surface-elevated p-4 transition-all duration-200 hover:border-foreground/30 hover:shadow-xs"
              >
                <div className="text-xs font-semibold text-foreground mb-1">
                  {agent.name}
                </div>
                <div className="text-[11px] text-muted-foreground leading-tight">
                  {agent.desc}
                </div>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <div className="h-px w-full bg-border" />

      {/* 8. FIRST PRODUCT: SUTRA */}
      <section id="products" className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
        <div className="max-w-2xl mb-12">
          <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-3">
            Production Implementation
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl leading-tight">
            The first system built on the Harness.
          </h2>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            SUTRA is an AI-native engineering control plane built by Sudarshan AI. While Sudarshan AI establishes the broad platform and vision for agent infrastructure, SUTRA is the live production product connecting agents to software engineering workflows today.
          </p>
        </div>

        <div className="rounded-2xl border border-border bg-surface p-8 sm:p-10 shadow-xs transition-all hover:border-foreground/30">
          <div className="flex flex-wrap items-center justify-between gap-4 border-b border-border/80 pb-6 mb-6">
            <div>
              <span className="font-mono text-[11px] text-muted-foreground uppercase tracking-wider">
                SUDARSHAN AI PRODUCTS
              </span>
              <h3 className="text-xl sm:text-2xl font-bold text-foreground mt-1">
                SUTRA — AI-Native Engineering Control Plane
              </h3>
            </div>
            <span className="rounded-md border border-foreground/30 bg-foreground text-background px-3 py-1 font-mono text-xs font-semibold uppercase tracking-wider">
              Live in Production
            </span>
          </div>

          <p className="text-sm sm:text-base text-muted-foreground leading-relaxed max-w-3xl mb-8">
            SUTRA operationalizes the harness primitives by linking autonomous coding agents directly with repositories, tasks, discrete change lifecycles, pull requests, automated CI verification, multi-pillar governance, human approvals, and cryptographic commit provenance.
          </p>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-8">
            {[
              "Repositories & Bare Sync",
              "Tasks & Leases",
              "Discrete Changes",
              "CI Check Verification",
              "Pull Requests",
              "Multi-Pillar Governance",
              "Human Review Sign-off",
              "Commit Provenance"
            ].map((feature) => (
              <div
                key={feature}
                className="flex items-center gap-2 rounded-lg border border-border bg-surface-elevated px-3 py-2 text-xs font-mono text-foreground"
              >
                <CheckCircle2 size={13} className="text-foreground shrink-0" />
                <span className="truncate">{feature}</span>
              </div>
            ))}
          </div>

          <div>
            <a
              href="https://sutra.sudarshanai.com"
              target="_blank"
              rel="noopener noreferrer"
              className="sutra-link inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-foreground px-5 text-xs font-medium text-background transition-all hover:opacity-90 active:scale-[0.98]"
            >
              Explore SUTRA in Production <ArrowUpRight size={14} className="arrow-icon" />
            </a>
          </div>
        </div>
      </section>

      <div className="h-px w-full bg-border" />

      {/* 9. WHAT WE ARE BUILDING TOWARD */}
      <section className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
        <div className="max-w-2xl mb-16">
          <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-3">
            The Road Ahead
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl leading-tight">
            What we are building toward.
          </h2>
          <p className="mt-4 text-base text-muted-foreground leading-relaxed">
            As models transition from generating text to orchestrating enterprise software systems, the required platform layer expands.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
          {[
            {
              title: "Agent SRE & Heartbeats",
              status: "BEING BUILT",
              desc: "Runtime health monitors, automated stall recovery, and resource budget watchdogs that prevent runaways."
            },
            {
              title: "Decentralized Identity & Keys",
              status: "BEING BUILT",
              desc: "Hardware-anchored agent keys and short-lived ephemeral certificates for zero-trust microservice actuation."
            },
            {
              title: "Cross-Model Interoperability",
              status: "LONG-TERM",
              desc: "Standardized state schemas allowing Claude, Codex, and local open-weight models to hand off complex tasks seamlessly."
            },
            {
              title: "Knowledge & Telemetry Graphs",
              status: "AVAILABLE IN SUTRA",
              desc: "Continuous codebase dependency indexing and token trajectory telemetry available in the SUTRA control plane today."
            },
            {
              title: "Composable Harness Primitives",
              status: "BEING BUILT",
              desc: "Pluggable verification modules that embed directly into CI/CD pipelines, Kubernetes clusters, and local dev containers."
            },
            {
              title: "Multi-Agent Consensus Gates",
              status: "LONG-TERM",
              desc: "Adversarial verification pairs where independent models critique and test each other before human escalation."
            }
          ].map((item) => (
            <motion.div
              key={item.title}
              whileHover={{ y: -2 }}
              transition={{ duration: 0.2 }}
              className="group flex flex-col justify-between rounded-xl border border-border bg-surface p-6 transition-all duration-300 hover:border-foreground/40 hover:bg-surface-elevated hover:shadow-sm"
            >
              <div>
                <div className="flex items-center justify-between mb-3">
                  <h3 className="text-sm font-semibold text-foreground">
                    {item.title}
                  </h3>
                  <span className="rounded border border-border bg-muted/60 px-2 py-0.5 font-mono text-[10px] font-medium text-muted-foreground uppercase">
                    {item.status}
                  </span>
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  {item.desc}
                </p>
              </div>
            </motion.div>
          ))}
        </div>
      </section>
    </>
  );
}
