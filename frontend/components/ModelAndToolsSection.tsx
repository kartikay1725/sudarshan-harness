"use client";

import React from "react";
import { Cpu, Wrench, ShieldAlert } from "lucide-react";
import { motion } from "framer-motion";

export function ModelAndToolsSection() {
  const modelExamples = [
    { name: "Claude", note: "Anthropic API & reasoning models" },
    { name: "GPT", note: "OpenAI multimodal models" },
    { name: "Codex", note: "Specialized code generation" },
    { name: "Gemini", note: "Google long-context models" },
    { name: "Qwen", note: "Open-weight multilingual models" },
    { name: "Llama", note: "Meta open-weight models" },
    { name: "Local Models", note: "Self-hosted vLLM / Ollama weights" },
  ];

  const toolCategories = [
    { title: "MCP Servers", desc: "Standardized tool protocols for file systems, git, and external integrations." },
    { title: "Production APIs", desc: "Cloud services, webhooks, REST/gRPC endpoints, and internal microservices." },
    { title: "Databases", desc: "SQL, vector databases, document stores, and state caches with read/write isolation." },
    { title: "Terminals & CLI", desc: "Containerized shells, package managers, test runners, and build commands." },
    { title: "Browsers", desc: "Automated headless browsers for end-to-end testing, scraping, and verification." },
    { title: "Custom Functions", desc: "Internal proprietary business logic, custom scripts, and domain-specific tools." },
  ];

  return (
    <section className="mx-auto max-w-6xl px-6 py-20 sm:py-28">
      {/* 1. MODEL AGNOSTIC */}
      <div className="mb-20">
        <div className="max-w-3xl mb-10">
          <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-3 font-semibold">
            Model Agnostic
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl leading-tight">
            Bring the intelligence you want.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            The Harness is designed to sit above the model layer. Models will advance, specialized fine-tunes will emerge, and costs will evolve. Sudarshan AI treats the model as a component of the environment, not the environment itself.
          </p>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-7 gap-3">
          {modelExamples.map((item) => (
            <motion.div
              key={item.name}
              whileHover={{ y: -2 }}
              transition={{ duration: 0.15 }}
              className="rounded-xl border border-border bg-surface p-4 text-center transition-all hover:border-foreground/30 hover:bg-surface-elevated hover:shadow-xs"
            >
              <div className="flex justify-center mb-2 text-muted-foreground">
                <Cpu size={18} />
              </div>
              <div className="text-xs font-semibold text-foreground mb-1">
                {item.name}
              </div>
              <div className="text-[10px] text-muted-foreground leading-tight">
                {item.note}
              </div>
            </motion.div>
          ))}
        </div>
        <div className="mt-4 text-[11px] font-mono text-muted-foreground">
          * Model names represent illustrative examples of supported intelligence backends.
        </div>
      </div>

      <div className="h-px w-full bg-border my-16" />

      {/* 2. TOOLS + MCP */}
      <div>
        <div className="max-w-3xl mb-10">
          <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-3 font-semibold">
            Tool Integration &amp; Boundary Control
          </div>
          <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl leading-tight">
            Your tools. Your environment.
          </h2>
          <p className="mt-4 text-base sm:text-lg text-muted-foreground leading-relaxed">
            Real-world agents require access to tools: invoking APIs, querying databases, running terminals, controlling headless browsers, and interacting with domain-specific systems.
          </p>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 mb-8">
          {toolCategories.map((tool) => (
            <div
              key={tool.title}
              className="rounded-xl border border-border bg-surface p-5 transition-all hover:border-border-strong hover:bg-surface-elevated"
            >
              <div className="flex items-center gap-2 mb-2 text-foreground">
                <Wrench size={15} className="text-foreground" />
                <h3 className="text-sm font-semibold">{tool.title}</h3>
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                {tool.desc}
              </p>
            </div>
          ))}
        </div>

        {/* MCP Boundary Precision Note */}
        <div className="rounded-xl border border-border bg-surface-elevated p-6 flex flex-col sm:flex-row sm:items-center gap-4">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-muted text-foreground">
            <ShieldAlert size={20} className="text-foreground" />
          </div>
          <div className="text-xs sm:text-sm text-muted-foreground leading-relaxed">
            <span className="font-semibold text-foreground">The role of Model Context Protocol (MCP): </span>
            MCP can provide a standardized way for agents to connect to tools, while the Harness remains responsible for the surrounding execution and control boundaries. MCP itself is a communication layer, not the ultimate security boundary.
          </div>
        </div>
      </div>
    </section>
  );
}
