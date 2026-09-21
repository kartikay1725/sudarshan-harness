"use client";

import React from "react";
import { motion } from "framer-motion";

export function ComposableSection() {
  const stackEquation = [
    { label: "MODEL", desc: "Intelligence core" },
    { label: "TOOLS", desc: "Actuation APIs & MCP" },
    { label: "CONTEXT", desc: "Bounded system state" },
    { label: "PERMISSIONS", desc: "Capability envelope" },
    { label: "VERIFICATION", desc: "Deterministic checks" },
    { label: "RELIABILITY", desc: "Agent SRE guards" },
    { label: "GOVERNANCE", desc: "Sovereign policy" }
  ];

  const modularSteps = [
    {
      step: "01",
      title: "Choose the model",
      desc: "Plug in frontier LLMs or specialized local weights without changing your underlying system integration."
    },
    {
      step: "02",
      title: "Connect the tools",
      desc: "Attach MCP servers, APIs, databases, browsers, or internal CLIs with defined schema validation."
    },
    {
      step: "03",
      title: "Define the capabilities",
      desc: "Specify exact read, write, and command bounds before agents make any calls against real environments."
    },
    {
      step: "04",
      title: "Add verification",
      desc: "Enforce deterministic test suites, lint checks, policy assertions, and independent verification passes."
    },
    {
      step: "05",
      title: "Set reliability boundaries",
      desc: "Configure watchdog thresholds for infinite loop detection, token budgets, and automatic stall mitigation."
    },
    {
      step: "06",
      title: "Decide external authority",
      desc: "Determine which sensitive actions proceed autonomously and which require cryptographic human approval."
    }
  ];

  return (
    <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
      <div className="max-w-3xl mb-14">
        <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-3 font-semibold">
          Composable Architecture
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl leading-tight">
          Don&apos;t build another agent. Build the environment around the agent.
        </h2>
        <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed">
          Instead of locking your team into one rigid, black-box agent framework, Sudarshan AI is designed to be fully composable. We are building toward a platform that allows developers to assemble the exact runtime environment appropriate for their specific agent and domain.
        </p>
      </div>

      {/* Visual Equation: Modular Stack */}
      <div className="rounded-2xl border border-border bg-surface p-6 sm:p-8 mb-12 shadow-xs">
        <div className="text-xs font-mono uppercase tracking-wider text-muted-foreground mb-6">
          The Composition Equation
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-xs font-mono">
          {stackEquation.map((item, idx) => (
            <React.Fragment key={item.label}>
              <div className="flex flex-col rounded-lg border border-border bg-surface-elevated px-3 py-2 transition-all hover:border-foreground/40">
                <span className="font-bold text-foreground">{item.label}</span>
                <span className="text-[10px] text-muted-foreground">{item.desc}</span>
              </div>
              {idx < stackEquation.length - 1 && (
                <span className="text-muted-foreground font-semibold px-1">+</span>
              )}
            </React.Fragment>
          ))}
          <div className="flex items-center gap-2">
            <span className="text-foreground font-bold px-1">=</span>
            <div className="flex flex-col rounded-lg border-2 border-border-strong bg-surface-elevated px-3.5 py-2">
              <span className="font-bold text-foreground">AGENT ENVIRONMENT</span>
              <span className="text-[10px] text-muted-foreground">Governed &amp; Verifiable</span>
            </div>
          </div>
        </div>
      </div>

      {/* Six Modular Steps */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {modularSteps.map((step) => (
          <motion.div
            key={step.step}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.2 }}
            className="group flex flex-col justify-between rounded-xl border border-border bg-surface p-6 transition-all duration-200 hover:border-foreground/30 hover:bg-surface-elevated hover:shadow-xs"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <span className="font-mono text-xs font-semibold text-foreground">
                  STEP {step.step}
                </span>
                <span className="h-1.5 w-1.5 rounded-full bg-border group-hover:bg-foreground transition-colors" />
              </div>
              <h3 className="text-base font-semibold text-foreground mb-2">
                {step.title}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {step.desc}
              </p>
            </div>
          </motion.div>
        ))}
      </div>

      <div className="mt-8 text-xs font-mono text-muted-foreground/80 text-center">
        * The Harness is designed to be extensible across domains; capabilities represent what our platform is actively building toward.
      </div>
    </section>
  );
}
