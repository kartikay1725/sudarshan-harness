# Audit — state of the repository on arrival

Date: 2026-10-02 · Branch: `arena/01a0fbca-sudarshan-harness` · Auditor: Arena agent (with the founder)

This document records what the repository actually contained, what was broken,
what has been fixed in this branch, and what is still open. It exists so that
"the repo" and "the product" stop being confused with each other.

---

## 1. What the repository was

| Area | Reality on arrival |
| --- | --- |
| `frontend/` | A Next.js 16 marketing site for sudarshanai.com with a pre-registration form. Live at sudarshanai.com. |
| Product code | **None.** No harness, no gate, no verification engine, no capabilities, no adapters, no IDE, no CLI, no tests, no CI. |
| `public/llms.txt`, `public/llms-full.txt` | The product *vision* for SUTRA / Sudarshan Harness, in prose. This was the only specification that existed. |
| Tests / CI | None anywhere. |
| LICENSE / CONTRIBUTING / `.env.example` | None. |

Conclusion: the vision was real and unusually well articulated; the software
did not exist. Everything in `packages/`, `apps/`, `tests/`, `examples/` and
`playground/` on this branch is new work, not a repair.

## 2. Defects found in the marketing site (and their status)

| # | Defect | Why it matters | Status |
| --- | --- | --- | --- |
| 1 | UTF-8 BOM at the start of `next.config.ts` (and `.gitignore`, `postcss.config.js`, `lib/utils.ts`, `public/icon.svg`) | Tooling that assumes plain UTF-8 mis-parses the first token; a classic cause of "config silently ignored". | **Fixed** — BOMs stripped. |
| 2 | `"lint": "next lint"` in `frontend/package.json` | `next lint` was removed in Next 16; the script is dead and CI would fail. | **Fixed** — `lint` and `typecheck` now run `tsc --noEmit`. eslint is not installed; if you want ESLint back, add it explicitly. |
| 3 | `client.db()` with no database name in `lib/mongodb.ts` | Writes land in whatever database is baked into the connection string (often `test`). Pre-registrations could be going to the wrong database right now. | **Fixed** — explicit `MONGODB_DB` (default `sudarshan`). **Check your Atlas/production connection string.** |
| 4 | `createIndex({email:1},{unique:true})` executed on every POST | Index creation is schema work, not request work; it costs a round trip per signup and races under concurrency. | **Fixed** — `ensureIndexes()` runs once per process. |
| 5 | In-memory per-IP rate limiter in `app/api/pre-register/route.ts` | Serverless instances do not share memory, so the limiter silently fails open across instances; and the `Map` was unbounded (a memory-growth vector under abuse). | **Partially fixed** — map is now capped and pruned, limits are env-configurable, and the code says plainly that it is *not* a security boundary. Real protection must sit in front of the function (Vercel WAF / Upstash). |
| 6 | Five dead components (`ProblemSection`, `PrincipleSection`, `PrimitivesSection`, `LifecycleSection`, `EcosystemSection`) | Dead code in a landing page is drift: nobody knows which copy is live. | **Fixed** — deleted after verifying no references. |
| 7 | No `.env.example` | New contributors cannot discover `MONGODB_URI`. | **Fixed** — `frontend/.env.example`. |
| 8 | No LICENSE, no CONTRIBUTING, no CI | Legal and operational ambiguity for anything you publish. | **Open** — deliberate: choosing a license is a founder decision. See ROADMAP. |

## 3. What this branch adds (all tested)

- `packages/core` — the harness kernel: authorization gate, policy/scope
  engine, capability registry, verification engine, state transitions +
  rollback, append-only hash-chained audit trail, Agent SRE (loops, budgets,
  stalls), human approval queue, blind verifier, run orchestrator.
- `packages/adapters` — OpenAI-compatible, Anthropic, Ollama (+ DeepSeek, Groq,
  OpenRouter, vLLM, LM Studio descriptors) and a deterministic `scripted`
  adapter used for replays and tests.
- `packages/capabilities` — LEGO blocks: filesystem, terminal, git, http, plus
  a loader for user-authored capabilities from `<workspace>/.sudarshan/capabilities`.
- `packages/spec` — the `agent.md` parser (frontmatter + markdown + verify DSL).
- `packages/runtime` — composition (`buildHarness`) and record/replay.
- `apps/cli` — `sudarshan run|doctor|capabilities|spec|prompt|audit|replay|ide|init`.
- `apps/server` — the daemon: REST + SSE used by the IDE and the desktop shell.
- `apps/web` — the Sudarshan IDE (React + Vite, hand-written CSS).
- `apps/desktop` — Electron shell bundling the daemon in-process (Windows / Linux / macOS).
- `tests/` — 94 tests, all passing (`npm test`), plus root `npm run typecheck`.
- `playground/`, `examples/replays/tidy-inbox.json`, `examples/agents/*.agent.md`.

## 4. What is still NOT proven

1. **Arbitrary human tasks.** Every green path today uses either a scripted
   adapter (replay) or a mock. The milestone that matters — a real person gives
   an unscripted task to a real model through the gate — needs an API key or a
   local Ollama model. Nothing in the architecture blocks it; it has simply not
   been exercised here.
2. **The desktop binaries.** `apps/desktop` bundles and typechecks; it has not
   been packaged or run on Windows/macOS in this environment (no Electron
   download in the sandbox, deliberately).
3. **The marketing site end-to-end.** It typechecks and parses; it has not been
   deployed from this branch, and its database configuration must be reviewed
   by whoever owns the Atlas project (defect #3 above).

See `docs/ROADMAP.md` for the ordered plan.
