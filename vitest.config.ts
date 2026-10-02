import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

const r = (p: string) => fileURLToPath(new URL(p, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      "@sudarshan/core": r("./packages/core/src/index.ts"),
      "@sudarshan/adapters": r("./packages/adapters/src/index.ts"),
      "@sudarshan/capabilities": r("./packages/capabilities/src/index.ts"),
      "@sudarshan/spec": r("./packages/spec/src/index.ts"),
      "@sudarshan/runtime": r("./packages/runtime/src/index.ts"),
      "@sudarshan/server": r("./apps/server/src/index.ts"),
    },
  },
  test: {
    environment: "node",
    include: ["packages/*/src/**/*.test.ts", "packages/*/test/**/*.test.ts", "tests/**/*.test.ts"],
    testTimeout: 30000,
    pool: "threads",
  },
});
