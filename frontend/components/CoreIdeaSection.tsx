"use client";

import React from "react";
import { 
  Key, 
  Wrench, 
  Layers, 
  ShieldCheck, 
  Terminal, 
  CheckCircle2, 
  Activity, 
  FileLock2, 
  Eye 
} from "lucide-react";
import { motion } from "framer-motion";

export function CoreIdeaSection() {
  const environmentPrimitives = [
    {
      title: "Identity",
      icon: <Key size={16} />,
      desc: "Distinct runtime agent identities separated from human accounts, with scoped cryptographic keys and verifiable leases."
    },
    {
      title: "Tools",
      icon: <Wrench size={16} />,
      desc: "Managed access to APIs, MCP servers, databases, terminals, and custom tools with strict parameter verification."
    },
    {
      title: "Context",
      icon: <Layers size={16} />,
      desc: "Controlled workspace boundaries and relevant system state without unconstrained or accidental prompt leakage."
    },
    {
      title: "Permissions",
      icon: <ShieldCheck size={16} />,
      desc: "Granular capability models evaluated before any action or command executes against underlying systems."
    },
    {
      title: "Execution",
      icon: <Terminal size={16} />,
      desc: "Sandboxed execution wrappers, command runtimes, and managed IPC with deterministic timeout policies."
    },
    {
      title: "Verification",
      icon: <CheckCircle2 size={16} />,
      desc: "Independent validation criteria that cannot be bypassed or marked as passed by the agent itself."
    },
    {
      title: "Reliability",
      icon: <Activity size={16} />,
      desc: "Agent SRE watchdogs: detecting infinite loops, oscillation, stalled runs, and runaway token burn."
    },
    {
      title: "Governance",
      icon: <FileLock2 size={16} />,
      desc: "Multi-pillar policies, sensitive resource guards, and strict authority controls that keep humans sovereign."
    },
    {
      title: "Observability",
      icon: <Eye size={16} />,
      desc: "Structured trajectory telemetry, invocation diffs, and cryptographic audit trails for every agent decision."
    }
  ];

  return (
    <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
      <div className="max-w-3xl mb-14">
        <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-3 font-semibold">
          The Fundamental Distinction
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl leading-tight">
          Models give agents intelligence. The Harness gives them an environment.
        </h2>
        <p className="mt-5 text-base sm:text-lg text-muted-foreground leading-relaxed">
          Modern AI agents are becoming capable of acting across tools, APIs, repositories, data, and external systems. But intelligence alone is not enough to make autonomous execution trustworthy in real-world systems. The execution environment matters.
        </p>
        <p className="mt-3 text-sm sm:text-base text-muted-foreground leading-relaxed">
          The Harness sits around the agent rather than being another agent itself, providing the surrounding infrastructure layer required for real control:
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {environmentPrimitives.map((item, idx) => (
          <motion.div
            key={item.title}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.2 }}
            className="group flex flex-col justify-between rounded-xl border border-border bg-surface p-5 transition-all duration-200 hover:border-foreground/30 hover:bg-surface-elevated hover:shadow-xs"
          >
            <div>
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2.5">
                  <div className="flex h-7 w-7 items-center justify-center rounded-lg bg-muted text-foreground transition-colors group-hover:bg-foreground group-hover:text-background">
                    {item.icon}
                  </div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {item.title}
                  </h3>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground/60">
                  0{idx + 1}
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
  );
}
