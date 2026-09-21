import React from "react";
import { Navbar } from "@/components/Navbar";
import { Hero } from "@/components/Hero";
import { CoreIdeaSection } from "@/components/CoreIdeaSection";
import { ComposableSection } from "@/components/ComposableSection";
import { ModelAndToolsSection } from "@/components/ModelAndToolsSection";
import { VerificationSection } from "@/components/VerificationSection";
import { AgentSreSection } from "@/components/AgentSreSection";
import { SecurityBoundarySection } from "@/components/SecurityBoundarySection";
import { SutraConnectionSection } from "@/components/SutraConnectionSection";
import { EarlyAccessForm } from "@/components/EarlyAccessForm";
import { Footer } from "@/components/Footer";

export default function LandingPage() {
  return (
    <div className="min-h-screen flex flex-col bg-background text-foreground relative selection:bg-foreground selection:text-background">
      {/* 1. MINIMAL NAVBAR */}
      <Navbar />

      <main className="flex-1 w-full">
        {/* 2. HERO WITH ARCHITECTURE FLOW */}
        <Hero />

        <div className="h-px w-full bg-border" />

        {/* 3. THE CORE IDEA: Intelligence vs Environment */}
        <CoreIdeaSection />

        <div className="h-px w-full bg-border" />

        {/* 4. COMPOSABLE ARCHITECTURE (LEGO CONCEPT) */}
        <ComposableSection />

        <div className="h-px w-full bg-border" />

        {/* 5. MODEL-AGNOSTIC & TOOLS / MCP */}
        <ModelAndToolsSection />

        <div className="h-px w-full bg-border" />

        {/* 6. INDEPENDENT VERIFICATION */}
        <VerificationSection />

        <div className="h-px w-full bg-border" />

        {/* 7. AGENT SRE / RELIABILITY */}
        <AgentSreSection />

        <div className="h-px w-full bg-border" />

        {/* 8. SECURITY & CONTROL BOUNDARY */}
        <SecurityBoundarySection />

        <div className="h-px w-full bg-border" />

        {/* 9. SUTRA CONNECTION */}
        <SutraConnectionSection />

        <div className="h-px w-full bg-border" />

        {/* 10. PRE-REGISTRATION CTA */}
        <section
          id="pre-register"
          className="mx-auto max-w-6xl px-6 py-24 sm:py-32"
        >
          <div className="mx-auto max-w-xl text-center flex flex-col items-center">
            <div className="font-mono text-xs text-muted-foreground uppercase tracking-wider mb-3 font-semibold">
              Early Access
            </div>
            <h2 className="text-3xl font-bold tracking-tight text-foreground sm:text-5xl leading-tight mb-4">
              Build the harness your agents need.
            </h2>
            <p className="text-base text-muted-foreground leading-relaxed mb-10 max-w-md">
              We&apos;re building the infrastructure layer for agents that need to operate in the real world. Pre-register for early access.
            </p>

            <EarlyAccessForm />
          </div>
        </section>
      </main>

      {/* 11. FOOTER */}
      <Footer />
    </div>
  );
}
