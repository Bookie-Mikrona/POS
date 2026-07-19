import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // Run tests serially to avoid DB race conditions
    sequence: { concurrent: false },
    testTimeout: 30000,
  },
});
