import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("daily lunch mutation wiring", () => {
  it("keeps the order mutation guarded by current safety controls", async () => {
    const source = await readFile(path.resolve(__dirname, "daily-lunch.ts"), "utf8");
    expect(source).toContain('router.post("/narocila/:id/daily-lunch"');
    expect(source).toContain("idempotency");
    expect(source).toContain("published");
    expect(source).toContain('.for("update")');
    expect(source).toContain("dailyLunchSaleSnapshotsTable");
  });
});