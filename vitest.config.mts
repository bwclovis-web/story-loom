import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(new URL("./tests/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
    // Cap concurrency so createTestDb hooks stay under the default 10s hookTimeout
    // on this machine. CLI --maxWorkers still overrides.
    maxWorkers: 4,
    testTimeout: 20000,
  },
});
