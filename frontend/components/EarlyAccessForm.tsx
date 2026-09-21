"use client";

import React, { useState } from "react";
import { Check } from "lucide-react";
import { motion } from "framer-motion";

export function EarlyAccessForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("You're on the list.");

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError("");

    if (!name.trim()) {
      setError("Please enter your name.");
      return;
    }

    if (!email || !email.includes("@") || !email.includes(".")) {
      setError("Please enter a valid email address.");
      return;
    }

    setLoading(true);

    try {
      const res = await fetch("/api/pre-register", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: name.trim(),
          email: email.trim(),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setError(data.error || "Something went wrong. Please try again.");
        setLoading(false);
        return;
      }

      setStatusMessage(data.message || "You're on the list.");
      setSubmitted(true);
      setLoading(false);
    } catch (err) {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  };

  return (
    <div className="w-full max-w-md">
      {!submitted ? (
        <form onSubmit={handleSubmit} className="flex flex-col gap-4 text-left">
          <div>
            <label htmlFor="early-name" className="block text-xs font-semibold text-foreground mb-1.5">
              Name
            </label>
            <input
              id="early-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Ada Lovelace"
              maxLength={100}
              required
              className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 transition-all focus:border-foreground focus:bg-surface-elevated focus:outline-none focus:ring-1 focus:ring-foreground"
            />
          </div>

          <div>
            <label htmlFor="early-email" className="block text-xs font-semibold text-foreground mb-1.5">
              Work Email
            </label>
            <input
              id="early-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="ada@company.com"
              maxLength={254}
              required
              className="w-full rounded-lg border border-border bg-surface px-4 py-2.5 text-sm text-foreground placeholder:text-muted-foreground/60 transition-all focus:border-foreground focus:bg-surface-elevated focus:outline-none focus:ring-1 focus:ring-foreground"
            />
          </div>

          {error && (
            <p className="text-xs text-red-500 font-medium">{error}</p>
          )}

          <button
            type="submit"
            disabled={loading}
            className="mt-2 inline-flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-foreground px-6 text-sm font-medium text-background shadow-xs transition-all duration-200 hover:opacity-90 active:scale-[0.98] disabled:opacity-50"
          >
            {loading ? (
              <>
                <span className="spinner" />
                <span>Registering...</span>
              </>
            ) : (
              <span>Pre-register</span>
            )}
          </button>
        </form>
      ) : (
        <motion.div
          initial={{ opacity: 0, scale: 0.96 }}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ duration: 0.3 }}
          className="rounded-xl border border-border-strong bg-surface p-6 text-center shadow-xs"
        >
          <div className="mx-auto mb-3 flex h-8 w-8 items-center justify-center rounded-full bg-foreground text-background">
            <Check size={16} strokeWidth={3} />
          </div>
          <div className="text-base font-semibold text-foreground mb-1">
            {statusMessage}
          </div>
          <div className="text-xs text-muted-foreground">
            We will send release updates directly to {email}.
          </div>
        </motion.div>
      )}
    </div>
  );
}
