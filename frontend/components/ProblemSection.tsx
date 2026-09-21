"use client";

import React from "react";
import { motion } from "framer-motion";

export function ProblemSection() {
  const questions = [
    {
      q: "Who is acting?",
      desc: "Treating an autonomous agent as an unauthenticated shell or human committer erases the security boundary between author and operator."
    },
    {
      q: "What are they allowed to access?",
      desc: "Unscoped file access allows models to modify CI scripts, security definitions, and secrets without explicit capability authority."
    },
    {
      q: "What task are they acting under?",
      desc: "Changes pushed without bound task context cannot be audited, budgeted, or mapped to verified engineering requirements."
    },
    {
      q: "Can the result be verified?",
      desc: "Prompt output does not guarantee functional correctness. Code must pass deterministic compilation, linting, and CI suites."
    },
    {
      q: "Who approved it?",
      desc: "Agents cannot be allowed to approve their own pull requests or bypass branch protection policies."
    },
    {
      q: "Can the change be traced?",
      desc: "Every commit SHA must carry cryptographic provenance tying it back to the specific agent run, model session, and human prompt."
    },
    {
      q: "What happens when an agent stalls?",
      desc: "Without reliability infrastructure and active heartbeats, failing agent loops burn tokens and leave corrupted working trees."
    },
    {
      q: "What happens when external changes arrive?",
      desc: "When the base branch advances, previously granted human approvals must automatically invalidate against new HEAD SHAs."
    },
    {
      q: "Who holds final authority?",
      desc: "Autonomous software development cannot replace human responsibility. Authority must remain explicitly sovereign."
    }
  ];

  return (
    <section id="vision" className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
      <div className="max-w-2xl mb-16">
        <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-3">
          The Operational Bottleneck
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl leading-tight">
          Capability is accelerating. Control isn&apos;t.
        </h2>
        <p className="mt-4 text-base text-muted-foreground leading-relaxed">
          Agents can increasingly plan, write code, modify repositories, run tests, and create pull requests. But when agents operate directly inside real production repositories, fundamental engineering questions remain unanswered:
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {questions.map((item, idx) => (
          <motion.div
            key={item.q}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.2 }}
            className="group rounded-xl border border-border bg-surface p-6 transition-all duration-300 hover:border-foreground/40 hover:shadow-sm"
          >
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-foreground group-hover:text-foreground">
                {item.q}
              </h3>
              <span className="font-mono text-[11px] text-muted-foreground/70">
                0{idx + 1}
              </span>
            </div>
            <p className="text-xs text-muted-foreground leading-relaxed">
              {item.desc}
            </p>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
