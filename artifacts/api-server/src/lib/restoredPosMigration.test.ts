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
    expect(file).toContain("soup_id integer REFERENCES malica_daily_included_courses");
    expect(file).toContain("dessert_id integer REFERENCES malica_daily_included_courses");
    expect(file).toContain("created_at timestamptz NOT NULL DEFAULT now()");
    expect(file).toContain("invoice_id uuid NOT NULL REFERENCES invoices");
    expect(file).toContain("malica_immutable_fact_guard");
    expect(file).toContain("invoices_contract_summary_period_unique");
    expect(file).toContain("DROP TRIGGER IF EXISTS malica_sale_snapshots_immutable");
    expect(file).toContain("malica_partner_group_prices_uq");
    expect(file).toContain("ix_individual_vouchers_delivery_retry");
    expect(file).toContain("ix_public_stripe_payment_review_audit_review");
    expect(file).toContain("public_stripe_payment_review_audit_action_check");
    expect(file).toContain("ADD COLUMN IF NOT EXISTS");
    expect(file).toContain("CREATE INDEX IF NOT EXISTS");
    expect(file).not.toMatch(/\bDROP\s+(TABLE|COLUMN)\b/i);
    expect(file).toContain("DROP INDEX IF EXISTS invoices_contract_summary_period_unique");
    expect(file).toContain("DROP CONSTRAINT IF EXISTS invoices_contract_summary_period_unique");
    const allocationBackfill = file.indexOf("UPDATE malica_allocations AS allocation");
    const businessDateRequired = file.indexOf(
      "ALTER TABLE malica_allocations ALTER COLUMN business_date SET NOT NULL",
    );
    expect(allocationBackfill).toBeGreaterThan(-1);
    expect(businessDateRequired).toBeGreaterThan(allocationBackfill);
    expect(file).not.toMatch(/CREATE\s+INDEX\s+CONCURRENTLY/i);
  });
});