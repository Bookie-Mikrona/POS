import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("runs both global offline fiscal workers against a schema-only disposable database", async () => {
  const run = promisify(execFile);
  try {
    const result = await run("pnpm", [
      "exec", "tsx",
      fileURLToPath(new URL("../../../scripts/run-isolated-offline-fiscal-tests.ts", import.meta.url)),
      "src/routes/pos/offline-fiscal-sync.native.integration.test.ts",
      "src/routes/pos/offline-fiscal-sync.cloud-offline.integration.test.ts",
    ], {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    expect(result.stdout).toContain("verified isolated database, schema only");
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw new Error(`Isolated offline fiscal suites failed.\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`, { cause: error });
  }
}, 125_000);
