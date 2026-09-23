import { describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import path from "node:path";

describe("restored POS forward migration", () => {
  it("is additive, idempotent, and covers every restored feature family", async () => {
    const file = await readFile(
      path.resolve(__dirname, "../../../../lib/db/src/migrations/220-restored-pos-public-features.sql"),
      "utf8",
    );
    expect(file).toContain("CREATE TABLE IF NOT EXISTS malica_daily_offers");
    expect(file).toContain("CREATE TABLE IF NOT EXISTS daily_lunch_offers");
    expect(file).toContain("CREATE TABLE IF NOT EXISTS public_venue_profiles");
    expect(file).toContain("CREATE TABLE IF NOT EXISTS voucher_delivery_alerts");
    expect(file).toContain("CREATE TABLE IF NOT EXISTS public_stripe_payment_reviews");
    expect(file).toContain("CREATE TABLE IF NOT EXISTS stripe_connection_alerts");
    expect(file).toContain("ADD COLUMN IF NOT EXISTS");
    expect(file).toContain("CREATE INDEX IF NOT EXISTS");
    expect(file).not.toMatch(/\bDROP\s+(TABLE|INDEX|CONSTRAINT|COLUMN)\b/i);
    expect(file).not.toMatch(/CREATE\s+INDEX\s+CONCURRENTLY/i);
  });
});