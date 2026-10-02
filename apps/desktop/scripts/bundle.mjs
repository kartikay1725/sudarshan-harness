/**
 * Bundle the desktop shell.
 *
 * The desktop app is deliberately NOT part of the npm workspaces graph (so a
 * plain `npm install` at the repo root never downloads Electron). Instead we
 * compile the whole harness — core, adapters, capabilities, spec, runtime and
 * the daemon — straight from TypeScript source into two CommonJS files that
 * Electron can load. Workspace packages are resolved through esbuild aliases,
 * which means the bundle does not depend on node_modules symlinks existing.
 */
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const appDir = resolve(here, "..");
const repoRoot = resolve(appDir, "../..");

const alias = {
  "@sudarshan/core": join(repoRoot, "packages/core/src/index.ts"),
  "@sudarshan/adapters": join(repoRoot, "packages/adapters/src/index.ts"),
  "@sudarshan/capabilities": join(repoRoot, "packages/capabilities/src/index.ts"),
  "@sudarshan/spec": join(repoRoot, "packages/spec/src/index.ts"),
  "@sudarshan/runtime": join(repoRoot, "packages/runtime/src/index.ts"),
  "@sudarshan/server": join(repoRoot, "apps/server/src/index.ts"),
};

const common = {
  bundle: true,
  platform: "node",
  target: "node20",
  format: "cjs",
  sourcemap: process.env.SUDARSHAN_SOURCEMAP === "1",
  logLevel: "info",
  external: ["electron", "fsevents"],
  alias,
  define: { "process.env.SUDARSHAN_DESKTOP": '"1"' },
  // The daemon module uses `import.meta.url` for three things: locating the
  // built IDE, locating recorded examples, and deciding whether it was started
  // directly. In the desktop bundle all three are handled another way (the
  // shell passes `staticDir`, examples ship as resources, and the shell starts
  // the daemon itself), so the empty import.meta is intentional — silence it.
  logOverride: { "empty-import-meta": "silent" },
};

await build({
  ...common,
  entryPoints: [join(appDir, "src/main.ts")],
  outfile: join(appDir, "dist/main.cjs"),
});

await build({
  ...common,
  entryPoints: [join(appDir, "src/preload.ts")],
  outfile: join(appDir, "dist/preload.cjs"),
});

console.log("desktop bundle written to apps/desktop/dist");
