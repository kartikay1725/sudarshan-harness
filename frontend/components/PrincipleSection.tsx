import React from "react";

export function PrincipleSection() {
  return (
    <section className="mx-auto max-w-5xl px-6 py-28 sm:py-36">
      <div className="font-mono text-xs text-muted-foreground uppercase tracking-widest mb-6">
        Architectural Invariant
      </div>
      <blockquote className="text-2xl sm:text-4xl md:text-5xl font-extrabold tracking-tight text-foreground leading-[1.2]">
        &ldquo;Agents should be free to do the work.
        <br />
        <span className="text-muted-foreground font-semibold">
          They should not be free to define the rules under which their work becomes trusted engineering output.&rdquo;
        </span>
      </blockquote>
    </section>
  );
}
