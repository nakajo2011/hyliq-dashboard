/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // Bind to 0.0.0.0 so the dev server is reachable when Vite runs inside
  // the docker-compose `client` service (the container's published port
  // forwards to the host). Local `npm run dev` is unaffected.
  server: {
    host: true,
    port: 5173,
    strictPort: true,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts", "src/**/*.test.tsx"],
    // *.integration.test.ts require a running PocketBase and are opt-in via
    // `npm run test:integration`.
    exclude: ["**/node_modules/**", "**/dist/**", "**/*.integration.test.ts"],
  },
});
