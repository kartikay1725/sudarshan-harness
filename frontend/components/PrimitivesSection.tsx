"use client";

import React from "react";
import { 
  Key, 
  Layers, 
  Shield, 
  Terminal, 
  CheckCircle2, 
  Eye, 
  GitCommit, 
  Clock, 
  UserCheck 
} from "lucide-react";
import { motion } from "framer-motion";

export function PrimitivesSection() {
  const primitives = [
    {
      key: "01",
      name: "Identity",
      icon: <Key size={16} />,
      desc: "Distinct runtime agent identities separated from human accounts. Token credentials, session keys, and lease binding."
    },
    {
      key: "02",
      name: "Context",
      icon: <Layers size={16} />,
      desc: "Dynamically scoped workspace boundaries, task parameters, and active repository knowledge graphs without unconstrained prompt exposure."
    },
    {
      key: "03",
      name: "Permissions",
      icon: <Shield size={16} />,
      desc: "Granular, capability-based access models (read, write, change, workflow, discussion). Real-time enforcement before actions hit disk."
    },
    {
      key: "04",
      name: "Execution",
      icon: <Terminal size={16} />,
      desc: "Sandboxed tool actuation environments, command execution wrappers, and managed IPC with deterministic timeouts."
    },
    {
      key: "05",
      name: "Verification",
      icon: <CheckCircle2 size={16} />,
      desc: "Authoritative CI evaluations, automated test runs, and static analysis checkpoints that cannot be bypassed or self-certified by the model."
    },
    {
      key: "06",
      name: "Governance",
      icon: <Eye size={16} />,
      desc: "Multi-pillar policy enforcement: branch protection, sensitive file guards, change tracking, and merge gate invariants."
    },
    {
      key: "07",
      name: "Provenance",
      icon: <GitCommit size={16} />,
      desc: "Cryptographic commit attribution, agent session signatures, and immutable change evidence binding commits to specific tasks."
    },
    {
      key: "08",
      name: "Reliability",
      icon: <Clock size={16} />,
      desc: "Runtime agent SRE, heartbeat monitors, deadlock detection, session revocation, and recovery loops when models hallucinate or stall."
    },
    {
      key: "09",
      name: "Human Authority",
      icon: <UserCheck size={16} />,
      desc: "Strict separation of execution and sign-off. Agents write code; humans retain sovereign approval and final merge authority."
    }
  ];

  return (
    <section id="primitives" className="mx-auto max-w-6xl px-6 py-24 sm:py-32">
      <div className="max-w-2xl mb-16">
        <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-3">
          The Substrate
        </div>
        <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl leading-tight">
          Software agents need infrastructure around them.
        </h2>
        <p className="mt-4 text-base text-muted-foreground leading-relaxed">
          Sudarshan AI provides nine architectural primitives that encapsulate autonomous model runs inside an auditable, controllable execution envelope.
        </p>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-5">
        {primitives.map((prim) => (
          <motion.div
            key={prim.name}
            whileHover={{ y: -2 }}
            transition={{ duration: 0.2 }}
            className="group flex flex-col justify-between rounded-xl border border-border bg-surface p-6 transition-all duration-300 hover:border-foreground/40 hover:bg-surface-elevated hover:shadow-sm"
          >
            <div>
              <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2.5 text-foreground">
                  <div className="flex h-7 w-7 items-center justify-center rounded-md bg-muted text-foreground transition-colors group-hover:bg-foreground group-hover:text-background">
                    {prim.icon}
                  </div>
                  <span className="text-sm font-semibold text-foreground">
                    {prim.name}
                  </span>
                </div>
                <span className="font-mono text-[11px] text-muted-foreground/60">
                  {prim.key}
                </span>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {prim.desc}
              </p>
            </div>
          </motion.div>
        ))}
      </div>
    </section>
  );
}
