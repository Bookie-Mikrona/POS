import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("public profile image retention startup wiring", () => {
  it("starts exactly once from the API listen lifecycle", async () => {
    const source = await readFile(path.resolve(__dirname, "../index.ts"), "utf8");
    expect(source).toContain('import { startPublicProfileImageRetentionScheduler } from "./lib/publicProfileImageRetention";');
    expect(source.match(/startPublicProfileImageRetentionScheduler\(\);/g)).toHaveLength(1);
  });
});