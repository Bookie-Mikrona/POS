import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";

it("checks concurrent amortization HTTP requests in a disposable schema-only database", async () => {
  try {
    const result = await promisify(execFile)("pnpm", [
      "exec", "tsx",
      fileURLToPath(new URL("../../../scripts/run-isolated-amortization-tests.ts", import.meta.url)),
    ], {
      cwd: fileURLToPath(new URL("../../..", import.meta.url)),
      timeout: 120_000,
      maxBuffer: 8 * 1024 * 1024,
    });
    expect(result.stdout).toContain("verified isolated database, schema only");
    expect(result.stdout).toContain("removed isolated database");
  } catch (error) {
    const failure = error as Error & { stdout?: string; stderr?: string };
    throw new Error(`Isolated amortization tests failed.\n${failure.stdout ?? ""}\n${failure.stderr ?? ""}`, { cause: error });
  }
}, 125_000);
