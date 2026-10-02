import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { CheckSpec, HarnessEvent } from "@sudarshan/core";
import { ADAPTER_CATALOG, probeAdapters } from "@sudarshan/adapters";
import { CAPABILITY_CATALOG, PRESETS, builtinCapability } from "@sudarshan/capabilities";
import { parseAgentSpec, parseVerifyBlock, renderSpecTemplate } from "@sudarshan/spec";
import { recordTrajectory, runReplay, type ReplayFile } from "@sudarshan/runtime";
import { HttpError, Session, publicApproval, summariseRun } from "./state.js";

export interface ServerOptions {
  port?: number;
  host?: string;
  workspaceRoot?: string;
  /** Directory of the built IDE (apps/web/dist). Served when present. */
  staticDir?: string;
  /** Called once the session is ready, before any request is served. */
  onReady?: (info: { port: number; url: string }) => void;
}

export interface RunningServer {
  port: number;
  host: string;
  url: string;
  session: Session;
  close(): Promise<void>;
}

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

/**
 * The local Harness daemon.
 *
 * This is the process that owns enforcement. The IDE (browser or Electron) is
 * only a viewer and a control surface: it can start runs, answer approval
 * prompts and roll back transitions, but every decision is made here, in this
 * process, by the Harness.
 */
export async function startServer(options: ServerOptions = {}): Promise<RunningServer> {
  const host = options.host ?? "0.0.0.0";
  const session = new Session();
  const staticDir = options.staticDir ?? defaultStaticDir();

  if (options.workspaceRoot) {
    await session.configure({ workspaceRoot: resolve(options.workspaceRoot) });
  }

  const server = createServer((req, res) => {
    handle(req, res, session, staticDir).catch((err) => {
      const status = err instanceof HttpError ? err.status : 500;
      const message = err instanceof Error ? err.message : String(err);
      if (status >= 500) console.error(`[sudarshan] ${req.method} ${req.url} -> ${status}: ${message}`);
      sendJson(res, status, { error: message });
    });
  });

  await new Promise<void>((r) => server.listen(options.port ?? 0, host, r));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : options.port ?? 0;
  const url = `http://${host === "0.0.0.0" ? "localhost" : host}:${port}`;
  options.onReady?.({ port, url });

  return {
    port,
    host,
    url,
    session,
    close: () =>
      new Promise<void>((r) => {
        server.closeAllConnections?.();
        server.close(() => r());
      }),
  };
}

/** Extra search roots that only exist when running inside the desktop shell. */
function packagedRoots(): string[] {
  const resources = (process as NodeJS.Process & { resourcesPath?: string }).resourcesPath;
  return typeof resources === "string" && resources ? [join(resources, "ide"), join(resources, "examples")] : [];
}

function defaultStaticDir(): string {
  // `import.meta.url` is empty when this file is bundled to CommonJS for the
  // desktop shell, so every candidate is optional and the fallbacks matter.
  let here: string | undefined;
  try {
    here = fileURLToPath(new URL(".", import.meta.url));
  } catch {
    here = undefined;
  }
  const candidates = [
    ...(here ? [resolve(here, "../../web/dist"), resolve(here, "../../../apps/web/dist")] : []),
    ...packagedRoots().slice(0, 1),
    resolve(process.cwd(), "apps/web/dist"),
  ];
  return candidates.find((c) => existsSync(join(c, "index.html"))) ?? candidates[0]!;
}

async function handle(req: IncomingMessage, res: ServerResponse, session: Session, staticDir: string): Promise<void> {
  const url = new URL(req.url ?? "/", "http://internal");
  const path = url.pathname;
  const method = req.method ?? "GET";

  // Permissive CORS: the daemon is local and the IDE may be served by a
  // different local port (Vite dev server) or from file:// in Electron.
  res.setHeader("access-control-allow-origin", "*");
  res.setHeader("access-control-allow-headers", "content-type");
  res.setHeader("access-control-allow-methods", "GET,POST,PUT,DELETE,OPTIONS");
  if (method === "OPTIONS") {
    res.writeHead(204).end();
    return;
  }

  if (path.startsWith("/api/")) {
    await api(req, res, session, path, method, url);
    return;
  }
  serveStatic(res, staticDir, path);
}

async function api(req: IncomingMessage, res: ServerResponse, session: Session, path: string, method: string, url: URL): Promise<void> {
  const body = method === "POST" || method === "PUT" ? await readJson(req) : {};

  /* -------- health / session -------- */
  if (path === "/api/health") return sendJson(res, 200, { ok: true, service: "sudarshan-harness", version: "0.1.0", time: new Date().toISOString() });

  if (path === "/api/session" && method === "GET") {
    return sendJson(res, 200, session.snapshot());
  }

  if (path === "/api/session" && method === "POST") {
    await session.configure(body as never);
    return sendJson(res, 200, session.snapshot());
  }

  if (path === "/api/doctor" && method === "GET") {
    const harness = session.requireHarness();
    const report = await harness.doctor();
    return sendJson(res, 200, report);
  }

  /* -------- model providers -------- */
  if (path === "/api/adapters" && method === "GET") {
    const detected = await probeAdapters(process.env);
    return sendJson(res, 200, {
      catalog: ADAPTER_CATALOG,
      detected: detected.map((d) => ({ kind: d.descriptor.kind, label: d.descriptor.label, local: d.descriptor.local, available: d.available, defaultModel: d.descriptor.defaultModel, keyEnv: d.descriptor.keyEnv })),
    });
  }

  /* -------- capabilities (LEGO) -------- */
  if (path === "/api/capabilities/catalog" && method === "GET") {
    return sendJson(res, 200, { catalog: CAPABILITY_CATALOG, presets: PRESETS });
  }

  const capabilityMatch = path.match(/^\/api\/capabilities\/([\w-]+)$/);
  if (capabilityMatch && method === "POST") {
    const harness = session.requireHarness();
    const id = capabilityMatch[1]!;
    const enabled = body.enabled === true;
    const installed = harness.registry.has(id);
    if (!installed) {
      const capability = builtinCapability(id, harness.policy);
      if (!capability) throw new HttpError(404, `unknown capability "${id}"`);
      harness.install(capability, { source: "workspace" });
    }
    harness.setEnabled(id, enabled);
    return sendJson(res, 200, session.snapshot());
  }

  if (path === "/api/capabilities" && method === "POST") {
    const harness = session.requireHarness();
    const ids: string[] = Array.isArray(body.enabled) ? body.enabled : [];
    for (const id of ids) {
      if (!harness.registry.has(id)) {
        const capability = builtinCapability(id, harness.policy);
        if (capability) harness.install(capability, { source: "workspace" });
      }
    }
    for (const entry of harness.registry.list()) {
      harness.setEnabled(entry.capability.id, ids.includes(entry.capability.id));
    }
    return sendJson(res, 200, session.snapshot());
  }

  /* -------- policy -------- */
  if (path === "/api/policy" && method === "POST") {
    const config = { ...session.config, ...(body as object) };
    await session.configure(config);
    return sendJson(res, 200, session.snapshot());
  }

  /* -------- runs -------- */
  if (path === "/api/runs" && method === "GET") {
    return sendJson(res, 200, { runs: [...session.runs.values()].map(summariseRun).reverse() });
  }

  if (path === "/api/runs" && method === "POST") {
    const harness = session.requireHarness();
    const task = String(body.task ?? "").trim();
    if (!task) throw new HttpError(400, "task is required");

    const expectations: CheckSpec[] = [];
    if (Array.isArray(body.expectations)) {
      for (const line of body.expectations) {
        if (typeof line === "string") expectations.push(...parseVerifyBlock([line]).checks);
        else if (line && typeof line === "object") expectations.push(line as CheckSpec);
      }
    }
    if (Array.isArray(body.expectLines)) expectations.push(...parseVerifyBlock(body.expectLines.map(String)).checks);

    const approvalMode = (body.approvalMode ?? "manual") as "manual" | "auto" | "deny";
    let detachApprovalPolicy: (() => void) | undefined;
    if (approvalMode !== "manual") {
      detachApprovalPolicy = harness.bus.onType("approval.requested", (event: HarnessEvent) => {
        const payload = event.payload as { approvalId: string; tool: string };
        harness.resolveApproval(payload.approvalId, {
          status: approvalMode === "auto" ? "approved" : "denied",
          scope: approvalMode === "auto" ? "class" : "once",
          by: `operator:approvalMode=${approvalMode}`,
          note: `resolved automatically because the operator started the run with approvalMode=${approvalMode}`,
        });
      });
    }

    const { promise } = await session.startRun(task, {
      runOptions: {
        model: body.model ? String(body.model) : undefined,
        temperature: typeof body.temperature === "number" ? body.temperature : undefined,
        maxTokens: typeof body.maxTokens === "number" ? body.maxTokens : undefined,
        expectations,
        approvalTimeoutMs: typeof body.approvalTimeoutMs === "number" ? body.approvalTimeoutMs : undefined,
        persona: body.persona ? String(body.persona) : undefined,
        rules: Array.isArray(body.rules) ? body.rules.map(String) : undefined,
      },
      approvalMode,
    });

    promise
      .then((run) => {
        detachApprovalPolicy?.();
        if (body.recordTo) {
          recordTrajectory(run);
        }
      })
      .catch(() => detachApprovalPolicy?.());

    return sendJson(res, 202, { queued: true, task, approvalMode, expectations: expectations.length });
  }

  const runMatch = path.match(/^\/api\/runs\/([\w-]+)$/);
  if (runMatch && method === "GET") {
    const run = session.runs.get(runMatch[1]!);
    if (!run) throw new HttpError(404, `unknown run ${runMatch[1]}`);
    return sendJson(res, 200, { run, events: session.events.filter((e) => e.runId === run.id).slice(-2000), audit: session.requireHarness().audit.forRun(run.id) });
  }

  const replayMatch = path.match(/^\/api\/runs\/([\w-]+)\/replay$/);
  if (replayMatch && method === "POST") {
    const run = session.runs.get(replayMatch[1]!);
    if (!run) throw new HttpError(404, `unknown run ${replayMatch[1]}`);
    return sendJson(res, 200, recordTrajectory(run));
  }

  /* -------- approvals (human authority) -------- */
  if (path === "/api/approvals" && method === "GET") {
    const harness = session.requireHarness();
    return sendJson(res, 200, { pending: harness.pendingApprovals().map(publicApproval), all: harness.approvals.all().map(publicApproval) });
  }

  const approvalMatch = path.match(/^\/api\/approvals\/([\w-]+)$/);
  if (approvalMatch && method === "POST") {
    const harness = session.requireHarness();
    const status = body.status === "approved" ? "approved" : "denied";
    const scope = body.scope === "class" || body.scope === "run" ? body.scope : "once";
    const resolved = harness.resolveApproval(approvalMatch[1]!, {
      status,
      scope,
      by: body.by ? String(body.by) : "human:ide",
      note: body.note ? String(body.note) : undefined,
    });
    if (!resolved) throw new HttpError(404, `unknown approval ${approvalMatch[1]}`);
    return sendJson(res, 200, publicApproval(resolved));
  }

  /* -------- events (SSE) -------- */
  if (path === "/api/events" && method === "GET") {
    return streamEvents(req, res, session, url.searchParams.get("runId") ?? undefined);
  }

  /* -------- provenance -------- */
  if (path === "/api/audit" && method === "GET") {
    const limit = Number(url.searchParams.get("limit") ?? 400);
    const runId = url.searchParams.get("runId") ?? undefined;
    const harness = session.requireHarness();
    return sendJson(res, 200, {
      chain: harness.auditChainStatus(),
      entries: session.auditEntries(limit, runId),
    });
  }

  /* -------- recovery -------- */
  if (path === "/api/transitions" && method === "GET") {
    session.requireHarness();
    return sendJson(res, 200, { transitions: session.transitions() });
  }

  const rollbackMatch = path.match(/^\/api\/transitions\/([\w-]+)\/rollback$/);
  if (rollbackMatch && method === "POST") {
    const harness = session.requireHarness();
    const outcome = await harness.rollback(rollbackMatch[1]!);
    return sendJson(res, 200, { transitionId: rollbackMatch[1], ...outcome });
  }

  /* -------- spec (agent.md) -------- */
  if (path === "/api/spec/parse" && method === "POST") {
    const content = String(body.content ?? "");
    const { spec, warnings } = parseAgentSpec(content, body.path ? String(body.path) : "agent.md");
    return sendJson(res, 200, {
      spec: { ...spec, raw: undefined },
      warnings,
      checks: spec.verification.map((c) => (c.kind === "custom" ? "custom" : JSON.stringify(c))),
    });
  }

  if (path === "/api/spec/template" && method === "GET") {
    return sendJson(res, 200, { template: renderSpecTemplate({ workspaceRoot: session.built?.config.workspaceRoot ?? ".", name: "My Agent" }) });
  }

  if (path === "/api/prompt" && method === "POST") {
    const harness = session.requireHarness();
    const task = String(body.task ?? "(preview)");
    return sendJson(res, 200, { prompt: harness.systemPromptPreview(task, session.built?.spec?.verification ?? []) });
  }

  /* -------- replay -------- */
  if (path === "/api/replay" && method === "POST") {
    const replay = body.replay as ReplayFile | undefined;
    if (!replay || !Array.isArray(replay.script)) throw new HttpError(400, "provide a `replay` object with a `script` array");
    const result = await runReplay(replay, { workspaceRoot: body.workspaceRoot ? resolve(String(body.workspaceRoot)) : undefined });
    const run = result.run;
    session.runs.set(run.id, run);

    // Mirror the replay into the session trail and event stream so the IDE can
    // show it. The entry is explicit about provenance: these decisions were
    // recorded earlier, but the actions and their verification are real.
    const summary = run.summary;
    const provenance = {
      runId: run.id,
      task: run.task,
      status: run.status,
      source: "replay",
      recordedFrom: replay.recordedFrom ?? null,
      adapter: "scripted",
      scratchWorkspace: result.workspaceRoot,
      steps: run.steps.length,
      actions: run.steps.flatMap((s) => s.actions).length,
      blocked: run.steps.flatMap((s) => s.actions).filter((a) => !a.decision.allowed).length,
      checksPassed: summary?.verificationsPassed ?? 0,
      checksFailed: summary?.verificationsFailed ?? 0,
      harnessVerified: summary?.harnessVerified ?? false,
      explanation: summary?.explanation ?? "",
    };
    session.built?.harness.audit.append("run.replayed", provenance, run.id);
    session.emit({
      id: `${run.id}:replayed`,
      type: "run.created",
      runId: run.id,
      at: run.startedAt,
      payload: { task: run.task, adapter: "scripted", source: "replay", workspaceRoot: result.workspaceRoot },
    });
    session.emit({
      id: `${run.id}:completed`,
      type: "run.completed",
      runId: run.id,
      at: run.finishedAt ?? new Date().toISOString(),
      payload: { ...provenance },
    });

    return sendJson(res, 200, { run, workspaceRoot: result.workspaceRoot, warnings: result.warnings });
  }

  /* -------- recorded examples (offline demos) -------- */
  if (path === "/api/examples" && method === "GET") {
    const dir = examplesDir();
    if (!existsSync(dir)) return sendJson(res, 200, { examples: [] });
    const examples = readdirSync(dir)
      .filter((name) => name.endsWith(".json"))
      .map((name) => {
        try {
          const file = JSON.parse(readFileSync(join(dir, name), "utf8")) as { task?: string; script?: unknown[] };
          return { name: name.replace(/\.json$/, ""), task: file.task ?? "", steps: Array.isArray(file.script) ? file.script.length : 0 };
        } catch {
          return { name: name.replace(/\.json$/, ""), task: "(unreadable)", steps: 0 };
        }
      });
    return sendJson(res, 200, { examples, dir });
  }

  const exampleMatch = path.match(/^\/api\/examples\/([\w.-]+)$/);
  if (exampleMatch && method === "GET") {
    const name = exampleMatch[1]!;
    if (name.includes("..") || name.includes("/")) throw new HttpError(400, "invalid example name");
    const file = join(examplesDir(), `${name}.json`);
    if (!existsSync(file)) throw new HttpError(404, `no example called "${name}"`);
    return sendJson(res, 200, JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>);
  }

  throw new HttpError(404, `no route for ${method} ${path}`);
}

/** Recorded example trajectories shipped with the repository (offline demos). */
function examplesDir(): string {
  const candidates = [
    resolve(process.cwd(), "examples/replays"),
    ...packagedRoots().slice(1),
  ];
  try {
    candidates.push(resolve(join(fileURLToPath(import.meta.url), "../../../examples/replays")));
  } catch {
    /* bundled to CommonJS: import.meta.url is unavailable */
  }
  return candidates.find((dir) => existsSync(dir)) ?? candidates[0]!;
}

function streamEvents(req: IncomingMessage, res: ServerResponse, session: Session, runId?: string): void {
  res.writeHead(200, {
    "content-type": "text/event-stream; charset=utf-8",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(`retry: 2000\n\n`);

  const backlog = runId ? session.events.filter((e) => e.runId === runId).slice(-500) : session.events.slice(-500);
  for (const event of backlog) res.write(`data: ${JSON.stringify(event)}\n\n`);
  res.write(`event: ready\ndata: ${JSON.stringify({ backlog: backlog.length })}\n\n`);

  const detach = session.subscribe((event) => {
    if (runId && event.runId !== runId) return;
    try {
      res.write(`data: ${JSON.stringify(event)}\n\n`);
    } catch {
      detach();
    }
  });

  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${new Date().toISOString()}\n\n`);
    } catch {
      clearInterval(heartbeat);
    }
  }, 15_000);

  req.on("close", () => {
    clearInterval(heartbeat);
    detach();
  });
}

function serveStatic(res: ServerResponse, staticDir: string, path: string): void {
  const indexHtml = join(staticDir, "index.html");
  if (!existsSync(indexHtml)) {
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(`<!doctype html><html><body style="font-family:ui-monospace,monospace;background:#0b0b0f;color:#e6e6ef;padding:40px">
      <h1>Sudarshan Harness daemon</h1>
      <p>The API is running. The IDE bundle has not been built yet.</p>
      <p>Run <code>npm run dev:web</code> (Vite dev server on port 5173) or <code>npm run build:web</code> then reload this page.</p>
      <ul>
        <li><a style="color:#8ab4ff" href="/api/health">/api/health</a></li>
        <li><a style="color:#8ab4ff" href="/api/session">/api/session</a></li>
        <li><a style="color:#8ab4ff" href="/api/adapters">/api/adapters</a></li>
      </ul>
    </body></html>`);
    return;
  }

  const rel = path === "/" ? "index.html" : path.replace(/^\/+/, "");
  const full = resolve(staticDir, rel);
  if (!full.startsWith(resolve(staticDir))) {
    res.writeHead(403).end("forbidden");
    return;
  }
  const target = existsSync(full) && statSync(full).isFile() ? full : indexHtml;
  const type = MIME[extname(target).toLowerCase()] ?? "application/octet-stream";
  res.writeHead(200, { "content-type": type, "cache-control": target.endsWith("index.html") ? "no-cache" : "public, max-age=3600" });
  createReadStream(target).pipe(res);
}

async function readJson(req: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  if (chunks.length === 0) return {};
  const text = Buffer.concat(chunks).toString("utf8");
  if (!text.trim()) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    throw new HttpError(400, "request body is not valid JSON");
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const text = JSON.stringify(payload);
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", "content-length": Buffer.byteLength(text) });
  res.end(text);
}

/* -------- standalone entry point -------- */
const isDirectRun = process.argv[1] && import.meta.url === new URL(`file://${resolve(process.argv[1])}`).href;
if (isDirectRun) {
  const port = Number(process.env.SUDARSHAN_PORT ?? process.argv[2] ?? 8787);
  const host = process.env.SUDARSHAN_HOST ?? "0.0.0.0";
  const workspaceRoot = process.env.SUDARSHAN_WORKSPACE ?? process.cwd();
  startServer({ port, host, workspaceRoot })
    .then((server) => {
      console.log(`sudarshan harness daemon listening on ${server.url}`);
      console.log(`workspace: ${workspaceRoot}`);
      console.log(`ide bundle: ${existsSync(join(defaultStaticDir(), "index.html")) ? defaultStaticDir() : "not built (run npm run build:web)"}`);
    })
    .catch((err) => {
      console.error(`failed to start: ${(err as Error).message}`);
      process.exit(1);
    });
}
