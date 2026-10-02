/**
 * Preload bridge.
 *
 * The renderer is the same web bundle that runs in a browser, so it never
 * needs Node. Everything it might want from the shell is exposed as an explicit,
 * narrow API — no `require`, no `process`, no filesystem. Keeping this surface
 * small is part of the security posture: the IDE cannot be talked into
 * reaching around the Harness by a prompt injection in the renderer.
 */
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("sudarshanDesktop", {
  /** True when running inside the desktop shell rather than a browser. */
  desktop: true,

  appInfo: (): Promise<{ version: string; port: number; workspaceRoot: string; packaged: boolean }> => ipcRenderer.invoke("app:info"),

  chooseWorkspace: (): Promise<{ workspaceRoot?: string; cancelled: boolean }> => ipcRenderer.invoke("workspace:choose"),

  currentWorkspace: (): Promise<{ workspaceRoot: string }> => ipcRenderer.invoke("workspace:current"),

  /** Rebuild the harness for the current workspace (re-reads agent.md + config). */
  reconfigure: (): Promise<{ ok: boolean; workspaceRoot: string; warnings: string[] }> => ipcRenderer.invoke("harness:reconfigure"),

  openWorkspaceInFileManager: (): Promise<void> => ipcRenderer.invoke("shell:openWorkspace"),

  openAuditFolder: (): Promise<{ ok: boolean; path: string; detail?: string }> => ipcRenderer.invoke("shell:openAudit"),

  openExternal: (url: string): Promise<void> => ipcRenderer.invoke("shell:openExternal", url),

  onWorkspaceChanged: (callback: (workspaceRoot: string) => void): (() => void) => {
    const listener = (_event: unknown, workspaceRoot: string): void => callback(workspaceRoot);
    ipcRenderer.on("workspace:changed", listener);
    return () => ipcRenderer.removeListener("workspace:changed", listener);
  },
});
