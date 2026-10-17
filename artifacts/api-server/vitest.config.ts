import { configDefaults, defineConfig } from "vitest/config";

const isolatedOfflineFiscalSuites = [
  "src/routes/pos/offline-fiscal-sync.native.integration.test.ts",
  "src/routes/pos/offline-fiscal-sync.cloud-offline.integration.test.ts",
];

export default defineConfig({
  test: {
    environment: "node",
    globals: true,
    // The default run executes these suites through the isolated runner test.
    // They operate a global worker, so running them against business data is unsafe.
    ...(process.env.OFFLINE_FISCAL_TEST_DATABASE_NAME ? { include: isolatedOfflineFiscalSuites } : {}),
    exclude: [
      ...configDefaults.exclude,
      "src/routes/backup.roundtrip.integration.test.ts",
      ...(!process.env.OFFLINE_FISCAL_TEST_DATABASE_NAME ? isolatedOfflineFiscalSuites : []),
    ],
    // Run test files and tests serially to avoid DB race conditions.
    fileParallelism: false,
    sequence: { concurrent: false },
    testTimeout: 30000,
  },
});
