import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

/**
 * The IDE is a Vite/React app.
 *
 * In development it proxies /api to the local Harness daemon so the browser
 * only ever talks to one origin. In production (and inside the desktop shell)
 * the daemon serves the built bundle itself, so no proxy is needed.
 */
export default defineConfig({
  plugins: [react()],
  server: {
    host: "0.0.0.0",
    port: Number(process.env.VITE_PORT ?? 5173),
    strictPort: false,
    proxy: {
      "/api": {
        target: process.env.SUDARSHAN_DAEMON ?? "http://127.0.0.1:8787",
        changeOrigin: true,
        // Server-Sent Events must not be buffered.
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes) => {
            if (String(proxyRes.headers["content-type"] ?? "").includes("text/event-stream")) {
              proxyRes.headers["cache-control"] = "no-cache, no-transform";
            }
          });
        },
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
    sourcemap: false,
    chunkSizeWarningLimit: 900,
  },
});
