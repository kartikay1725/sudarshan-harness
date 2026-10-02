import { mkdtemp, rm, writeFile, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Harness, defaultPolicy, type Policy } from "@sudarshan/core";
import { filesystemCapability, terminalCapability, gitCapability } from "@sudarshan/capabilities";
import { ScriptedAdapter, type ScriptEntry } from "@sudarshan/adapters";

export interface TestWorkspace {
  root: string;
  write(path: string, content: string): Promise<string>;
  read(path: string): Promise<string>;
  exists(path: string): Promise<boolean>;
  cleanup(): Promise<void>;
}

export async function createWorkspace(name = "sudarshan-test"): Promise<TestWorkspace> {
  const root = await mkdtemp(join(tmpdir(), `${name}-`));
  return {
    root,
    async write(path: string, content: string) {
      const full = join(root, path);
      await mkdir(join(full, ".."), { recursive: true });
      await writeFile(full, content, "utf8");
      return full;
    },
    async read(path: string) {
      const { readFile } = await import("node:fs/promises");
      return readFile(join(root, path), "utf8");
    },
    async exists(path: string) {
      const { access } = await import("node:fs/promises");
      try {
        await access(join(root, path));
        return true;
      } catch {
        return false;
      }
    },
    async cleanup() {
      await rm(root, { recursive: true, force: true });
    },
  };
}

export interface TestHarnessOptions {
  script: ScriptEntry[];
  capabilities?: Array<"filesystem" | "terminal" | "git">;
  policy?: Partial<Policy>;
  textProtocol?: boolean;
}

export async function createTestHarness(ws: TestWorkspace, opts: TestHarnessOptions) {
  const policy = { ...defaultPolicy(ws.root), ...(opts.policy ?? {}) } as Policy;
  const harness = new Harness({
    workspaceRoot: ws.root,
    adapter: new ScriptedAdapter({ script: opts.script, textProtocol: opts.textProtocol }),
    policy,
    capabilityConfig: {},
  });
  const wanted = opts.capabilities ?? ["filesystem"];
  if (wanted.includes("filesystem")) harness.install(filesystemCapability(harness.policy));
  if (wanted.includes("terminal")) harness.install(terminalCapability(harness.policy));
  if (wanted.includes("git")) harness.install(gitCapability(harness.policy));
  return harness;
}
