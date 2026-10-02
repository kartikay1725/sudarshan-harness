/**
 * @sudarshan/capabilities — the LEGO box.
 *
 * The Harness core never decides which tools exist. These are the blocks a user
 * can install or remove; the security architecture is identical either way.
 */
import type { Capability, Policy } from "@sudarshan/core";
import { filesystemCapability } from "./filesystem/index.js";
import { terminalCapability } from "./terminal.js";
import { gitCapability } from "./git.js";
import { httpCapability } from "./http.js";

export { filesystemCapability } from "./filesystem/index.js";
export { terminalCapability } from "./terminal.js";
export { gitCapability, runGit, currentBranch, isRepo } from "./git.js";
export { httpCapability } from "./http.js";
export { loadCapabilitiesFromDirectory } from "./loader.js";
export type { LoadedCapability } from "./loader.js";

export interface CapabilityDescriptor {
  id: string;
  name: string;
  description: string;
  permissions: string[];
  toolCount: number;
  /** Suggested personas this block belongs to. */
  tags: Array<"coding" | "research" | "automation" | "data" | "core">;
  risk: "low" | "medium" | "high";
  local: boolean;
}

export const CAPABILITY_CATALOG: CapabilityDescriptor[] = [
  {
    id: "filesystem",
    name: "Filesystem",
    description: "Read, write, edit, move, search and delete files inside the workspace scope.",
    permissions: ["fs.read", "fs.list", "fs.write", "fs.create_dir", "fs.move", "fs.delete"],
    toolCount: 8,
    tags: ["core", "coding", "research", "automation"],
    risk: "medium",
    local: true,
  },
  {
    id: "terminal",
    name: "Terminal",
    description: "Run shell commands (builds, tests, linters, inspections) under policy control.",
    permissions: ["shell.exec"],
    toolCount: 1,
    tags: ["coding", "automation"],
    risk: "high",
    local: true,
  },
  {
    id: "git",
    name: "Git",
    description: "Inspect and change repository state. Pushing is irreversible and needs approval.",
    permissions: ["git.read", "git.write", "git.push"],
    toolCount: 7,
    tags: ["coding"],
    risk: "high",
    local: true,
  },
  {
    id: "http",
    name: "HTTP",
    description: "Outbound HTTP requests, subject to host policy and human approval.",
    permissions: ["net.request"],
    toolCount: 2,
    tags: ["research", "automation", "data"],
    risk: "high",
    local: false,
  },
];

/** Named capability sets, matching the personas from the product vision. */
export const PRESETS: Record<string, { label: string; description: string; capabilities: string[] }> = {
  coding: {
    label: "Coding agent",
    description: "Filesystem + Terminal + Git. Everything needed to change and verify a repository.",
    capabilities: ["filesystem", "terminal", "git"],
  },
  research: {
    label: "Research assistant",
    description: "Filesystem + HTTP. Read the web, write notes, no shell.",
    capabilities: ["filesystem", "http"],
  },
  minimal: {
    label: "Minimal",
    description: "Filesystem only. No shell, no network, no git.",
    capabilities: ["filesystem"],
  },
  full: {
    label: "Everything installed",
    description: "All built-in capabilities. Useful for exploring, not for production.",
    capabilities: ["filesystem", "terminal", "git", "http"],
  },
};

export function builtinCapability(id: string, policy: Policy): Capability | undefined {
  switch (id) {
    case "filesystem":
      return filesystemCapability(policy);
    case "terminal":
      return terminalCapability(policy);
    case "git":
      return gitCapability(policy);
    case "http":
      return httpCapability(policy);
    default:
      return undefined;
  }
}

export function builtinCapabilities(policy: Policy): Capability[] {
  return [filesystemCapability(policy), terminalCapability(policy), gitCapability(policy), httpCapability(policy)];
}
