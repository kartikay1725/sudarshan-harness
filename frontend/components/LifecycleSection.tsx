"use client";

import React from "react";
import { motion } from "framer-motion";

export function LifecycleSection() {
  const lifecycle = [
    { step: "01", title: "Human Intent", desc: "Engineering objective declared via task, RFC, or issue" },
    { step: "02", title: "Task & Context", desc: "Harness bounds scope, repo slice, and active lease" },
    { step: "03", title: "Agent Execution", desc: "Autonomous agent formulates plan and writes code" },
    { step: "04", title: "Scoped Permissions", desc: "Capability envelope intercepts every file and tool call" },
    { step: "05", title: "Tracked Changes", desc: "Discrete change entity registered with cryptographic signatures" },
    { step: "06", title: "Verification", desc: "Automated CI and test suites run in isolated sandboxes" },
    { step: "07", title: "Governance", desc: "Policy rules, sensitive file checks, and merge criteria evaluated" },
    { step: "08", title: "Human Authority", desc: "Human engineer reviews diff and issues cryptographic sign-off" },
    { step: "09", title: "Trusted Output", desc: "Verified engineering artifact merged safely to main branch" }
  ];

  return (
    <section id="how-it-works" className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
      <div className="max-w-2xl mb-16">
        <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-3">
          Execution Lifecycle
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl leading-tight">
          From raw intent to verified release.
        </h2>
        <p className="mt-4 text-base text-muted-foreground leading-relaxed">
          How work moves through the Sudarshan AI control pipeline without compromising developer autonomy or engineering safety.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {lifecycle.map((item) => (
          <motion.div
            key={item.step}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.2 }}
            className="group flex flex-col justify-between rounded-xl border border-border bg-surface p-6 transition-all duration-300 hover:border-foreground/40 hover:bg-surface-elevated hover:shadow-sm"
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <span className="font-mono text-xs font-semibold text-foreground">
                  STEP {item.step}
                </span>
                <span className="h-2 w-2 rounded-full bg-foreground/40 group-hover:bg-foreground transition-colors" />
              </div>
              <h3 className="text-sm font-semibold text-foreground mb-1.5">
                {item.title}
              </h3>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {item.desc}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
