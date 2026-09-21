import React from "react";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";

export function Footer() {
  return (
    <footer className="border-t border-border bg-surface px-6 py-12 text-xs text-muted-foreground">
      <div className="mx-auto max-w-6xl flex flex-col gap-8">
        <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-6">
          <div>
            <div className="flex items-center gap-2.5 mb-1.5">
              <Image
                src="/logo.png"
                alt="Sudarshan AI logo"
                width={22}
                height={22}
                className="h-5 w-5 object-contain"
              />
              <span className="text-sm font-semibold text-foreground">
                Sudarshan AI
              </span>
            </div>
            <p className="text-xs text-muted-foreground max-w-sm leading-relaxed">
              The customizable, model-agnostic infrastructure layer for AI agents.
            </p>
          </div>

          <div className="flex items-center gap-6 text-xs">
            <span className="font-mono text-muted-foreground uppercase text-[11px]">Related:</span>
            <a
              href="https://sutra.sudarshanai.com/"
              target="_blank"
              rel="noopener noreferrer"
              className="sutra-link inline-flex items-center gap-1 font-medium text-sutra hover:text-sutra-hover transition-colors"
            >
              <span>SUTRA</span>
              <ArrowUpRight size={13} className="arrow-icon text-sutra" />
            </a>
            <a
              href="#pre-register"
              className="font-medium text-foreground hover:text-link transition-colors"
            >
              Pre-register
            </a>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border-t border-border/80 pt-6 text-[11px] font-mono text-muted-foreground/80">
          <div>
            © {new Date().getFullYear()} Sudarshan AI. All rights reserved.
          </div>
          <div>
            SUTRA is a product by Sudarshan AI.
          </div>
        </div>
      </div>
    </footer>
  );
}
