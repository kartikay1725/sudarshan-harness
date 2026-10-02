# Sudarshan Harness

**Not another AI agent.** A control and verification layer that your agent runs
inside. The agent thinks freely; it cannot act freely.

> A local-first, model-agnostic control and verification layer that lets agents
> act autonomously through removable LEGO capabilities while the Harness
> enforces security, verifies real-world state, detects failures and loops, and
> preserves human authority.

- Company: Sudarshan AI · site: https://sudarshanai.com · first product: [SUTRA](https://sutra.sudarshanai.com)
- Status: kernel + CLI + daemon + IDE + desktop shell implemented on this branch, 94 tests green. See [`docs/AUDIT.md`](docs/AUDIT.md), [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md), [`docs/ROADMAP.md`](docs/ROADMAP.md).

## The five rules everything here obeys

1. **Capabilities are LEGO.** Install and remove filesystem, terminal, git,
   http — or your own. Unused ones are gone, not switched off in a prompt.
   The security core never changes shape.
2. **The agent requests; the Harness decides.** Every action passes the gate:
   identity → installed → permission → scope → policy → budget → loop →
   human approval → ALLOW / BLOCK. Enforced by execution architecture.
3. **COMPLETED ≠ VERIFIED.** The agent claiming success is evidence of nothing.
   Verification re-reads **real system state** against checks declared *before*
   execution. Trust order: real state > deterministic check > blind verifier >
   model claim.
4. **Every step is recorded and reversible-or-explicit.** State transitions
   A→B carry their authorization, their undo ops and their reversibility class;
   rollback is only called verified when A→B→A is observed in the real world.
5. **Humans outrank agents.** Approve once, approve a class, or deny. Recovery,
   explanations and retries never expand authority.

## Try it in 60 seconds (no API key needed)

```bash
npm install

# 1. Watch a recorded run execute FOR REAL against a scratch filesystem:
npx tsx apps/cli/src/cli.ts replay examples/replays/tidy-inbox.json
#    → ✓ VERIFIED · 8 steps · 7 actions · 8/8 acceptance checks

# 2. Inspect a workspace the way the Harness sees it:
npx tsx apps/cli/src/cli.ts doctor -w playground
npx tsx apps/cli/src/cli.ts spec   -w playground

# 3. See exactly what the model would be told (and what it may touch):
npx tsx apps/cli/src/cli.ts run -w playground "tidy the inbox" --dry-run
```

The replay is not a mock: recorded *decisions* are played back through the real
gate, real filesystem and real verifier, and are labelled `scripted` everywhere.

## The IDE

```bash
npm run build:web
SUDARSHAN_WORKSPACE=./playground npx tsx apps/server/src/index.ts 8787
# open http://localhost:8787
```

Three panels — **CAPABILITIES · AGENT · EXECUTION** — over five tabs:
**Security | Verification | Provenance | Recovery | Logs**. Approvals appear as
a banner with *approve once / approve this class / deny*. The "replay demo"
menu runs the recorded trajectory end-to-end with zero configuration.

With a model backend configured the same IDE drives live runs:

```bash
ollama serve                      # local-first, no key
# or: export OPENAI_API_KEY=… / ANTHROPIC_API_KEY=…
```

## Desktop (Windows · Linux · macOS)

```bash
cd apps/desktop
npm install        # separate on purpose: never downloads Electron at repo root
npm start          # bundles with esbuild, hosts the daemon on 127.0.0.1
npm run dist       # electron-builder: dmg+zip / nsis+portable / AppImage+deb+rpm
```

The shell embeds the same daemon and serves the same IDE bundle; it binds
loopback only and exposes a narrow preload bridge.

## Give an agent a real task

```bash
cd playground && npm install      # demo workspace with its own agent.md
export OPENAI_API_KEY=…           # or run ollama
npx tsx ../apps/cli/src/cli.ts run -w . "Organise inbox/ and write INDEX.md"
```

`agent.md` is the specification: persona, rules, workflow, the capabilities it
may use, budgets, and — critically — the **acceptance criteria** the Harness
will check against the real filesystem whether or not the agent agrees.

## Repository

```
packages/core         gate · policy · verification · state · audit · SRE · approvals
packages/adapters     openai-compatible · anthropic · ollama · scripted
packages/capabilities filesystem · terminal · git · http · loader
packages/spec         agent.md parser + verify DSL
packages/runtime      buildHarness() · record/replay
apps/cli apps/server apps/web apps/desktop
frontend/             marketing site (sudarshanai.com) — separate surface
tests/                94 tests: kernel, spec, adapters, daemon
playground/ examples/ demo workspace, recorded replays, example specs
```

## Develop

```bash
npm run verify        # typecheck + vitest (94 tests)
npm test
npm run dev:server    # daemon with hot reload
npm run dev:web       # Vite dev server proxying /api to the daemon
```

Marketing site: `cd frontend && npm install && npm run dev`.
