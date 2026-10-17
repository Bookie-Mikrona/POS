import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    exclude: ["src/routes/backup.roundtrip.integration.test.ts"],
    // Run test files and tests serially to avoid DB race conditions.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30000,
  },
});
