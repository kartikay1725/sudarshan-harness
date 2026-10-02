/**
 * Sudarshan IDE — desktop shell.
 *
 * The shell's whole job is to host the real thing:
 *
 *   1. start the Harness daemon in-process, bound to 127.0.0.1 (never 0.0.0.0 —
 *      a desktop app must not expose an unauthenticated control surface to the
 *      network);
 *   2. open a window on the same IDE bundle the browser uses, so there is one
 *      code path and one set of guarantees;
 *   3. hand the operator native affordances a browser cannot have: pick a
 *      workspace folder, open the audit log on disk, quit cleanly.
 *
 * The shell never makes authorization decisions. It cannot. The gate, the
 * verifier and the audit trail all live in the daemon process's harness.
 */
import { app, BrowserWindow, dialog, ipcMain, shell } from "electron";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { startServer, type RunningServer } from "@sudarshan/server";
import { buildMenu } from "./menu.js";

interface DesktopState {
  workspaceRoot?: string;
  bounds?: { width: number; height: number; x?: number; y?: number };
}

let server: RunningServer | undefined;
let mainWindow: BrowserWindow | undefined;
let state: DesktopState = {};

const DEV_URL = process.env.SUDARSHAN_DEV_URL;
const isDev = process.argv.includes("--dev") || !!DEV_URL;

/* ------------------------------------------------------------------ *
 * persisted state
 * ------------------------------------------------------------------ */

function statePath(): string {
  return join(app.getPath("userData"), "sudarshan-desktop.json");
}

function loadState(): DesktopState {
  try {
    return JSON.parse(readFileSync(statePath(), "utf8")) as DesktopState;
  } catch {
    return {};
  }
}

function saveState(): void {
  try {
    mkdirSync(app.getPath("userData"), { recursive: true });
    writeFileSync(statePath(), JSON.stringify(state, null, 2));
  } catch {
    /* window geometry is a convenience, not a contract */
  }
}

/* ------------------------------------------------------------------ *
 * daemon
 * ------------------------------------------------------------------ */

function freePort(): Promise<number> {
  return new Promise((done, fail) => {
    const probe = createServer();
    probe.unref();
    probe.on("error", fail);
    probe.listen(0, "127.0.0.1", () => {
      const address = probe.address();
      const port = typeof address === "object" && address ? address.port : 0;
      probe.close(() => done(port));
    });
  });
}

function defaultWorkspace(): string {
  const remembered = state.workspaceRoot;
  if (remembered && existsSync(remembered)) return remembered;
  const cwd = process.env.SUDARSHAN_WORKSPACE;
  if (cwd && existsSync(cwd)) return resolve(cwd);
  return homedir();
}

/** Where the built IDE lives: next to the source in dev, in resources when packaged. */
function staticDir(): string {
  if (app.isPackaged) return join(process.resourcesPath, "ide");
  return resolve(app.getAppPath(), "../web/dist");
}

async function startDaemon(workspaceRoot: string): Promise<RunningServer> {
  const port = await freePort();
  return startServer({
    port,
    // A desktop app binds loopback only. Anyone on the network must not be able
    // to drive an agent on this machine.
    host: "127.0.0.1",
    workspaceRoot,
    staticDir: staticDir(),
  });
}

async function applyWorkspace(workspaceRoot: string, notify = true): Promise<void> {
  if (!existsSync(workspaceRoot)) {
    dialog.showErrorBox("Workspace not found", `${workspaceRoot} does not exist.`);
    return;
  }
  state.workspaceRoot = workspaceRoot;
  saveState();
  if (!server) return;
  await server.session.configure({ workspaceRoot });
  if (notify && mainWindow) mainWindow.webContents.send("workspace:changed", workspaceRoot);
}

/* ------------------------------------------------------------------ *
 * window
 * ------------------------------------------------------------------ */

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: state.bounds?.width ?? 1480,
    height: state.bounds?.height ?? 920,
    x: state.bounds?.x,
    y: state.bounds?.y,
    minWidth: 1024,
    minHeight: 620,
    backgroundColor: "#08080c",
    title: "Sudarshan IDE",
    show: false,
    autoHideMenuBar: process.platform !== "darwin",
    webPreferences: {
      preload: join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      devTools: true,
    },
  });

  mainWindow.once("ready-to-show", () => mainWindow?.show());

  mainWindow.on("close", () => {
    if (!mainWindow) return;
    const bounds = mainWindow.getBounds();
    state.bounds = { width: bounds.width, height: bounds.height, x: bounds.x, y: bounds.y };
    saveState();
  });

  mainWindow.on("closed", () => {
    mainWindow = undefined;
  });

  // Never navigate away from the daemon and never open a window we did not ask
  // for: external links go to the OS browser.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.webContents.on("will-navigate", (event, url) => {
    const allowed = DEV_URL ?? `http://127.0.0.1:${server?.port ?? 0}`;
    if (!url.startsWith(allowed)) event.preventDefault();
  });

  if (DEV_URL) {
    void mainWindow.loadURL(DEV_URL);
  } else if (server) {
    void mainWindow.loadURL(server.url);
  }

  if (isDev) mainWindow.webContents.openDevTools({ mode: "detach" });
}

/* ------------------------------------------------------------------ *
 * ipc
 * ------------------------------------------------------------------ */

function registerIpc(): void {
  ipcMain.handle("app:info", () => ({
    version: app.getVersion(),
    port: server?.port ?? 0,
    workspaceRoot: server?.session.config.workspaceRoot ?? state.workspaceRoot ?? "",
    packaged: app.isPackaged,
  }));

  ipcMain.handle("workspace:choose", async () => {
    const result = await dialog.showOpenDialog(mainWindow!, {
      title: "Choose a workspace for the Harness",
      defaultPath: state.workspaceRoot ?? homedir(),
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled || result.filePaths.length === 0) return { cancelled: true };
    const workspaceRoot = result.filePaths[0]!;
    await applyWorkspace(workspaceRoot);
    return { workspaceRoot, cancelled: false };
  });

  ipcMain.handle("workspace:current", () => ({
    workspaceRoot: server?.session.config.workspaceRoot ?? state.workspaceRoot ?? "",
  }));

  ipcMain.handle("harness:reconfigure", async () => {
    if (!server) return { ok: false, workspaceRoot: "", warnings: ["daemon not running"] };
    const workspaceRoot = server.session.config.workspaceRoot ?? defaultWorkspace();
    const built = await server.session.configure({ workspaceRoot });
    return { ok: true, workspaceRoot, warnings: built.warnings };
  });

  ipcMain.handle("shell:openWorkspace", async () => {
    const root = server?.session.config.workspaceRoot ?? state.workspaceRoot;
    if (root) await shell.openPath(root);
  });

  ipcMain.handle("shell:openAudit", async () => {
    const root = server?.session.config.workspaceRoot ?? state.workspaceRoot;
    if (!root) return { ok: false, path: "", detail: "no workspace" };
    const dir = join(root, ".sudarshan", "audit");
    if (!existsSync(dir)) return { ok: false, path: dir, detail: "no audit entries yet" };
    const error = await shell.openPath(dir);
    return { ok: !error, path: dir, detail: error || undefined };
  });

  ipcMain.handle("shell:openExternal", async (_event, url: unknown) => {
    if (typeof url === "string" && /^https?:\/\//i.test(url)) await shell.openExternal(url);
  });
}

/* ------------------------------------------------------------------ *
 * lifecycle
 * ------------------------------------------------------------------ */

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  state = loadState();

  void app
    .whenReady()
    .then(async () => {
      registerIpc();
      server = await startDaemon(defaultWorkspace());
      buildMenu({
        app,
        getWindow: () => mainWindow,
        server: () => server,
        chooseWorkspace: async () => {
          if (!mainWindow) return;
          const result = await dialog.showOpenDialog(mainWindow, {
            title: "Choose a workspace for the Harness",
            defaultPath: state.workspaceRoot ?? homedir(),
            properties: ["openDirectory", "createDirectory"],
          });
          if (!result.canceled && result.filePaths[0]) await applyWorkspace(result.filePaths[0]!);
        },
        applyWorkspace,
        isDev,
      });
      createWindow();

      app.on("activate", () => {
        if (BrowserWindow.getAllWindows().length === 0) createWindow();
      });
    })
    .catch((err: unknown) => {
      dialog.showErrorBox("Sudarshan Harness failed to start", (err as Error).message);
      app.exit(1);
    });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", (event) => {
    if (!server) return;
    event.preventDefault();
    const closing = server;
    server = undefined;
    void closing.close().finally(() => app.exit(0));
  });
}
