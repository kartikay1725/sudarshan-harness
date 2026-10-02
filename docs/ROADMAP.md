# Roadmap

Ordered by what de-risks the product most, not by what is most fun to build.
Each item states the *proof* that closes it, because this project's own
philosophy applies to its own development: done ≠ verified.

---

## M0 — Foundations (this branch) ✅

- Kernel: gate, policy/scopes, verification, state+rollback, audit chain, SRE, approvals, blind verifier.
- Adapters: OpenAI-compatible, Anthropic, Ollama + descriptors for DeepSeek/Groq/OpenRouter/vLLM/LM Studio; `scripted` for replays.
- Capabilities: filesystem, terminal, git, http + workspace loader.
- `agent.md` spec with verify DSL; CLI; daemon; IDE; Electron shell; 94 tests.
- Replay: recorded decisions executed against a real scratch filesystem, verified end-to-end in CI without keys.

**Proof:** `npm run verify` (typecheck + 94 tests) and `sudarshan replay examples/replays/tidy-inbox.json` → `VERIFIED`.

## M1 — The arbitrary-task milestone ⬅ *next*

The founder's stated gating question: predefined tasks work, but does the
architecture survive a **real human giving an arbitrary task**?

1. Wire a real model in a real workspace (Ollama locally, or a key) and run ten
   messy, unscripted tasks chosen by a human. Record every trajectory.
2. For each run, classify the outcome honestly: `verified`,
   `completed_unverified`, `blocked`, `failed` — and publish the distribution.
   A harness that always says VERIFIED is lying; we want the true curve.
3. Feed the failures back as regression replays (`recordTrajectory` already
   exists), so every incident becomes a permanent test.
4. Instrument the IDE for this: filter runs by outcome, diff the gate's reason
   against what a human would have decided (approval-decision agreement rate).

**Proof:** a published table of 10 tasks × outcome × why, plus the replay files
committed under `examples/replays/`.

## M2 — Generated capabilities (Markdown → code → installable LEGO)

From the vision: an `.md` capability spec becomes generated tool code, is
compiled, tested, security-validated and only then installable — and a
generated tool is **not** auto-trusted (it starts disabled, with approval on
first use).

1. Capability spec format (inputs, outputs, risk, reversibility, checks).
2. Generator emitting TypeScript against the capability interface.
3. Sandbox-compiled + unit-test gate; static checks (no network unless
   declared, no child processes unless declared, path confinement).
4. Install as a workspace capability with `source: "generated"`.

**Proof:** a generated capability passes the same gate/verification tests as
built-ins, and a malicious generated spec is rejected by the static checks.

## M3 — Marketplace

Free / OSS / paid / company capabilities with signatures and review state.
Hard rule from the vision, kept: **the marketplace is not the security
boundary** — every downloaded capability goes through the same install path,
starts disabled, and is governed by local policy.

**Proof:** installing a signed third-party capability and a tampered copy of
the same; the tampered one must fail verification of its signature/checksum.

## M4 — Cross-model state schemas & CI sandboxes

- Portable state/transition schemas so a trajectory recorded on one model can be
  replayed and verified under another (the vision's "cross-model state schemas").
- Pluggable verification sandboxes: run task-level checks in a container or CI
  job instead of the local workspace, with the same check DSL.

**Proof:** one replay verified identically under two adapters and inside a
container.

## M5 — Product hardening

- Package, sign and notarise the desktop builds (macOS notarization, Windows
  code signing, Linux repodata); auto-update channel.
- **Choose a license** for the harness (founder decision; blocks OSS
  publication and marketplace trust).
- CI: typecheck + tests + a replay smoke job on every PR; dependency audits.
- ESLint back into `frontend/` if the team wants it (currently `tsc` only).
- Replace the landing page's per-instance rate limiter with a real edge
  limiter; review the production MongoDB database name (see `docs/AUDIT.md` #3).
- Telemetry off by default; if ever added, it must be opt-in and auditable.

## Explicit non-goals (for now)

- Being an agent, a model router, or a chat UI.
- Prompt-instruction-based security ("please don't do X") as a control.
- Cloud-hosted enforcement: local-first stays first; hosted control planes may
  come later but may never be required.
