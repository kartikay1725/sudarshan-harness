/**
 * Native application menu.
 *
 * Deliberately close to what a developer expects from VS Code / Cursor: File,
 * Edit, View, Window, Help — plus one menu that is ours, "Harness", because the
 * things an operator needs most here are not file operations. They are: which
 * workspace is under control, re-read the specification, and open the audit
 * trail on disk.
 */
import { Menu, dialog, shell, type App, type BrowserWindow, type MenuItemConstructorOptions } from "electron";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { RunningServer } from "@sudarshan/server";

export interface MenuContext {
  app: App;
  getWindow: () => BrowserWindow | undefined;
  server: () => RunningServer | undefined;
  chooseWorkspace: () => Promise<void>;
  applyWorkspace: (workspaceRoot: string, notify?: boolean) => Promise<void>;
  isDev: boolean;
}

export function buildMenu(ctx: MenuContext): void {
  const isMac = process.platform === "darwin";
  const workspaceRoot = (): string => ctx.server()?.session.config.workspaceRoot ?? "";

  const template: MenuItemConstructorOptions[] = [
    ...(isMac
      ? ([
          {
            label: ctx.app.name,
            submenu: [
              { role: "about", label: "About Sudarshan IDE" },
              { type: "separator" },
              { role: "services" },
              { type: "separator" },
              { role: "hide" },
              { role: "hideOthers" },
              { role: "unhide" },
              { type: "separator" },
              { role: "quit" },
            ],
          },
        ] as MenuItemConstructorOptions[])
      : []),

    {
      label: "File",
      submenu: [
        { label: "Open Workspace…", accelerator: "CmdOrCtrl+O", click: () => void ctx.chooseWorkspace() },
        {
          label: "Open Workspace Folder",
          click: async () => {
            const root = workspaceRoot();
            if (root) await shell.openPath(root);
          },
        },
        { type: "separator" },
        isMac ? { role: "close" } : { role: "quit", label: "Exit" },
      ],
    },

    {
      label: "Harness",
      submenu: [
        {
          label: "Reload Specification & Policy",
          accelerator: "CmdOrCtrl+Shift+R",
          click: async () => {
            const root = workspaceRoot();
            if (!root) return;
            await ctx.applyWorkspace(root);
          },
        },
        {
          label: "Show Session Health…",
          click: async () => {
            const server = ctx.server();
            if (!server) return;
            const snapshot = server.session.snapshot();
            const audit = await server.session.built?.harness.doctor().catch(() => undefined);
            await dialog.showMessageBox(ctx.getWindow()!, {
              type: "info",
              title: "Harness session",
              message: `${snapshot.adapterId ?? "no adapter"} · ${snapshot.model ?? "no model"}`,
              detail: [
                `workspace      ${snapshot.workspaceRoot ?? "—"}`,
                `capabilities   ${snapshot.capabilities.filter((c) => c.enabled).map((c) => c.id).join(", ") || "none"}`,
                `tools exposed  ${snapshot.tools.length}`,
                `runs           ${snapshot.runs.length}`,
                `audit chain    ${snapshot.audit ? (snapshot.audit.ok ? `intact (${snapshot.audit.entries} entries)` : "BROKEN") : "—"}`,
                snapshot.warnings.length ? `\nwarnings:\n${snapshot.warnings.map((w) => `  · ${w}`).join("\n")}` : "",
                audit?.problems?.length ? `\nproblems:\n${audit.problems.map((p: string) => `  · ${p}`).join("\n")}` : "",
              ]
                .filter(Boolean)
                .join("\n"),
              buttons: ["Close"],
            });
          },
        },
        { type: "separator" },
        {
          label: "Open Audit Log Folder",
          click: async () => {
            const root = workspaceRoot();
            if (!root) return;
            const dir = join(root, ".sudarshan", "audit");
            if (!existsSync(dir)) {
              await dialog.showMessageBox(ctx.getWindow()!, {
                type: "warning",
                title: "No audit log yet",
                message: `${dir} does not exist`,
                detail: "Run a task first. Every authorization decision, action and verification is appended there as hash-chained JSONL.",
              });
              return;
            }
            await shell.openPath(dir);
          },
        },
        {
          label: "Open Daemon in Browser",
          click: async () => {
            const server = ctx.server();
            if (server) await shell.openExternal(server.url);
          },
        },
      ],
    },

    { label: "Edit", submenu: [{ role: "undo" }, { role: "redo" }, { type: "separator" }, { role: "cut" }, { role: "copy" }, { role: "paste" }, { role: "selectAll" }] },

    {
      label: "View",
      submenu: [
        { role: "reload" },
        { role: "forceReload" },
        { role: "toggleDevTools" },
        { type: "separator" },
        { role: "resetZoom" },
        { role: "zoomIn" },
        { role: "zoomOut" },
        { type: "separator" },
        { role: "togglefullscreen" },
      ],
    },

    {
      label: "Window",
      submenu: [{ role: "minimize" }, { role: "zoom" }, ...(isMac ? ([{ type: "separator" }, { role: "front" }] as MenuItemConstructorOptions[]) : ([{ role: "close" }] as MenuItemConstructorOptions[]))],
    },

    {
      label: "Help",
      submenu: [
        { label: "Sudarshan AI", click: () => void shell.openExternal("https://sudarshanai.com") },
        { label: "What the Harness enforces", click: () => void shell.openExternal("https://sudarshanai.com/#principles") },
        { type: "separator" },
        {
          label: "COMPLETED ≠ VERIFIED",
          enabled: false,
        },
      ],
    },
  ];

  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
