import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/lib/reportExporterNames.clerk.integration.test.ts"],
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 90_000,
  },
});
