import { defineCapability, type Capability, type Policy } from "@sudarshan/core";
import { listTool, readTool, searchTool } from "./readTools.js";
import { editTool, writeTool } from "./writeTools.js";
import { createDirTool, moveTool } from "./moveTools.js";
import { deleteTool } from "./deleteTool.js";

/**
 * FILESYSTEM — a LEGO block.
 *
 * Install it and the agent can read and change files inside the workspace
 * scope. Remove it and those tools stop existing: they disappear from the
 * model's tool list *and* from the authorization gate, so a hallucinated
 * `filesystem.write` is refused as an unknown tool rather than executed.
 */
export function filesystemCapability(policy: Policy): Capability {
  return defineCapability({
    id: "filesystem",
    name: "Filesystem",
    version: "0.1.0",
    description: "Read, write, edit, move, search and delete files inside the workspace scope.",
    permissions: ["fs.read", "fs.list", "fs.write", "fs.create_dir", "fs.move", "fs.delete"],
    configSchema: {
      type: "object",
      properties: {
        maxReadBytes: { type: "number", description: "Cap on bytes returned by a single read (default 4 MiB)." },
      },
      additionalProperties: false,
    },
    tools: [listTool(policy), readTool(policy), searchTool(policy), writeTool(policy), editTool(policy), createDirTool(policy), moveTool(policy), deleteTool(policy)],
    async healthCheck(ctx) {
      try {
        const { access } = await import("node:fs/promises");
        await access(ctx.workspaceRoot);
        return { ok: true, detail: `workspace root is accessible: ${ctx.workspaceRoot}` };
      } catch (err) {
        return { ok: false, detail: (err as Error).message };
      }
    },
  });
}
