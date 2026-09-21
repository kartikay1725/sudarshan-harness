import React from "react";
import Image from "next/image";
import { ArrowUpRight } from "lucide-react";

export function Navbar() {
  return (
    <header className="sticky top-0 z-50 w-full bg-background/85 backdrop-blur-md transition-all">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-6">
        {/* Brand identity: Sudarshan AI */}
        <div className="flex items-center gap-2.5">
          <Image
            src="/logo.png"
            alt="Sudarshan AI logo"
            width={32}
            height={32}
            className="h-8 w-8 object-contain transition-transform duration-200 hover:scale-105"
            priority
          />
          <span className="text-sm font-semibold tracking-tight text-foreground">
            Sudarshan AI
          </span>
        </div>

        {/* Minimal Actions: Only SUTRA external link and Pre-register CTA */}
        <div className="flex items-center gap-4">
          <a
            href="https://sutra.sudarshanai.com/"
            target="_blank"
            rel="noopener noreferrer"
            className="sutra-link hidden sm:inline-flex items-center gap-1 text-xs font-medium text-sutra hover:text-sutra-hover transition-colors"
          >
            <span>SUTRA</span>
            <ArrowUpRight size={13} className="arrow-icon text-sutra" />
          </a>

          <a
            href="#pre-register"
            className="inline-flex h-9 items-center justify-center rounded-lg bg-foreground px-4 text-xs font-medium text-background shadow-xs transition-all duration-200 hover:opacity-90 active:scale-[0.98]"
          >
            Pre-register
          </a>
        </div>
      </div>
    </header>
  );
}

