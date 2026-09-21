import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    exclude: ["src/routes/backup.roundtrip.integration.test.ts"],
    // Run tests serially to avoid DB race conditions
    sequence: { concurrent: false },
    testTimeout: 30000,
  },
});
