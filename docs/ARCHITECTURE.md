# Architecture

Sudarshan is **not an agent**. It is the control and verification layer that an
agent runs inside. The agent thinks freely; it cannot act freely.

One sentence: *a local-first, model-agnostic control and verification layer
that lets agents act autonomously through removable LEGO capabilities while the
Harness enforces security, verifies real-world state, detects failures and
loops, and preserves human authority.*

---

## 1. Layout

```
packages/core         the kernel: gate, policy, verification, state, audit, SRE, approvals
packages/adapters     model providers (OpenAI-compatible, Anthropic, Ollama, …) + scripted
packages/capabilities LEGO blocks: filesystem, terminal, git, http + user-authored loader
packages/spec         agent.md: frontmatter, sections, verify DSL
packages/runtime      buildHarness() composition + record/replay
apps/cli              sudarshan …  (terminal surface)
apps/server           daemon: REST + SSE (the IDE's only backend)
apps/web              the IDE (React + Vite, no UI framework)
apps/desktop          Electron shell: hosts the daemon in-process, loopback only
frontend/             the marketing site (separate product surface)
tests/                94 tests over the kernel, spec, adapters and daemon
playground/           a demo workspace with its own agent.md
examples/             recorded replays + example agent.md specs
```

Everything is TypeScript ESM. There is no build step for development or tests
(`tsx`, `vitest`, Vite compile from source); the desktop shell bundles with
esbuild; the IDE builds with Vite and is served **by the daemon**, so browser,
CLI-`ide` and Electron share one code path.

## 2. The contract the model sees

The system prompt is generated (`prompt/builder.ts`) and states the rules as
facts about the world, not wishes: the capability list is derived from what is
*installed and enabled right now*; denials, verification failures, SRE
interventions and human rejections are returned to the model as structured
feedback with an explicit note that **an explanation never grants permission**.

Model output is only ever a *request*. Tool calls are proposals; the Harness
decides.

## 3. The gate (`gate/authorize.ts`)

Every action request passes this sequence, in order. Any failure short-circuits
with a typed denial code, an `authorization.decided` event and an audit entry:

1. **tool installed?** — the capability must exist in the registry.
2. **capability enabled?** — installed but switched off means no.
3. **arguments schema-valid?**
4. **permission granted?** — deny-by-default; permissions are granted by
   operator policy. Installing a capability never grants its permissions.
5. **explicit deny rules?** — policy `deny` beats everything above.
6. **scope?** — filesystem roots, deny globs, protected paths (denial code
   distinguishes `protected_path` from `scope_violation`), shell command
   allow/deny lists, network host allow/deny lists.
7. **budget?** — steps, tool calls, tokens, wall clock.
8. **loop?** — Agent SRE `stop` verdicts block; `advise` verdicts only inject
   feedback.
9. **human approval?** — unless the class was pre-approved this run, the run
   parks in `waiting_for_approval` until a person answers.

Capabilities re-validate their own arguments (`safePath`, command patterns):
they must never trust what the gate handed them, because a capability can also
be loaded from disk and the gate is not the only reader of arguments.

## 4. Verification: COMPLETED ≠ VERIFIED

Two layers, both deterministic, both declared **before** execution so the
goalposts cannot move afterwards:

- **Action level.** A tool declares `checks` (e.g. `file_hash`, `dir exists`,
  `exit code == 0`, `stdout matches`) and an expected post-state *at request
  time*. After execution the verification engine re-reads **real system state**
  and evaluates them. A tool that declares nothing reports `UNVERIFIED` —
  which the orchestrator treats as not-verified, never as success.
- **Task level.** Acceptance criteria come from `agent.md` (`## Verify`) and/or
  the run request (`--expect`, the IDE's criteria box). They are evaluated
  against the real workspace after the run. A run is `verified` only if they
  pass.

**Trust ranking** (`TRUST_RANK`): `real_state (3) > deterministic_check (2) >
blind_verifier (1) > model_claim (0)`. The final status is derived from these
ranks in `summarise()`; "the agent said it finished" can never produce
`verified` on its own.

**Blind verifier.** Optionally a second model reviews the trajectory with no
parent context, read-only tools, and no ability to grant itself permissions.
It returns risk + reasoning. It is *advisory*: a `high/critical` + `reject`
verdict can only **downgrade** `verified` → `completed_unverified`, never
upgrade anything, and never block by itself. The Harness stays authoritative.

## 5. State, reversibility, rollback

Every executed action that changes state records a transition:

```
before snapshot (real hashes) → action + authorization id → after snapshot
reversibility: REVERSIBLE | COMPENSATABLE | IRREVERSIBLE | UNKNOWN
undoOps: [{kind, description, …}]
```

`UNKNOWN` is treated as irreversible at the gate (it needs approval).
`harness.rollback(transitionId)` runs the undo ops, then **re-captures the real
state** and sets `roundTripVerified` only when live hashes match state A
(A→B→A). The IDE's Recovery tab shows exactly this, and labels recorded
transitions whose scratch workspace no longer exists as not rollbackable
instead of pretending.

## 6. Agent SRE

Loop detection (same action repeated), oscillation, stall, budget pressure and
repeated-failure each produce an alert with an intervention that is injected as
feedback: *advise* at `maxRepeatedActions`, *stop* at twice that. Recovery never
expands authority: a retry goes through the whole gate again.

## 7. Human authority

`approval.requested` parks the run. The human can approve once, approve the
**class** (tool + risk + reversibility signature) for the rest of the run, or
deny with a note. Denial feedback tells the agent, plainly, that human authority
outranks it and not to retry. `approvalMode` per run: `manual` (default),
`auto` (classes pre-authorised, still recorded), `deny` (everything blocks —
useful for audits).

## 8. Provenance

`audit/trail.ts` is an append-only JSONL chain: each entry stores
`sha256(payload ‖ prevHash)`. `verifyChain()` detects any edit or reorder.
Entries cover capability install/enable, every authorization decision, every
action, every verification report, approvals, rollbacks and replay provenance.
The trail lives in `<workspace>/.sudarshan/audit/` — inside the thing being
governed, on disk, inspectable with `sudarshan audit` and in the IDE.

## 9. Capabilities as LEGO

A capability = descriptor (id, risk, tags, local?) + tools (name, JSON schema,
risk/reversibility classifier, declared checks, undo description) + optional
`healthCheck`. Built-ins ship in `packages/capabilities`; anything else can be
dropped into `<workspace>/.sudarshan/capabilities/*.ts` and is loaded the same
way — a broken file yields a stub whose tools error loudly, never a crash.
Removing a capability removes its tools from the model's view **and** from the
gate. The core security architecture is unchanged by any of this: capabilities
are guests, the gate is the house.

## 10. Models

Adapters implement one interface: `complete(messages, tools) → response`.
OpenAI-compatible (OpenAI, DeepSeek, Groq, OpenRouter, vLLM, LM Studio),
Anthropic, Ollama, and `scripted`. Detection probes before use; the default
adapter falls back to `scripted` with an explicit warning when nothing is
available, so the system is honest rather than silently fake. Local-first:
Ollama needs no key and no cloud.

## 11. Replay

`runReplay(file)` builds a scratch workspace from `fixtures`, swaps in the
`scripted` adapter with the recorded decisions, and then executes **for real**:
real gate, real filesystem, real verification. Replays are labelled `scripted`
everywhere they appear. Uses: CI without keys, demos, incident reproduction,
and regression-testing the Harness itself. Recording (`recordTrajectory`)
rebuilds a script from a real run so any verified run becomes a regression test.

## 12. Topology

```
                ┌──────────────────────────────┐
 browser / IDE  │  apps/web (React)            │
   (same UI)    └───────────┬──────────────────┘
                            │ REST + SSE (relative URLs)
 Electron shell ────────────┤
 (loopback only)            ▼
                ┌──────────────────────────────┐
                │ apps/server daemon           │
                │  └─ Harness (packages/core)  │──▶ model adapters
                │      ├─ gate                 │──▶ real filesystem/shell/git/http
                │      ├─ verification engine  │
                │      ├─ state store/rollback │
                │      └─ audit trail (JSONL)  │
                └──────────────────────────────┘
```

The desktop shell starts the daemon bound to `127.0.0.1` and loads the same
bundle; the browser build reaches the daemon through a dev-server proxy or the
daemon's own static serving. No UI code ever holds authority — it only
*displays* decisions the kernel already made.
