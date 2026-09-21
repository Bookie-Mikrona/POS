import { describe, expect, it } from "vitest";
import { getTipBreakdown } from "./tip-reporting";

describe("getTipBreakdown", () => {
  it("keeps a receipt without immutable snapshots historical/unreviewed and unknown", async () => {
    const result = await getTipBreakdown({
      execute: async () => {
        return { rows: [{
          policy_mode: "historical_unreviewed", payment_method: "unknown",
          vat_treatment: "outside_vat", gross: "5", net: "5", vat: "0",
          card_fee: "0", liability: "0", revenue: "0",
        }] };
      },
    }, 1, new Date("2025-01-01T00:00:00Z"), new Date("2025-01-02T00:00:00Z"));

    expect(result.byPolicyMode).toEqual([expect.objectContaining({
      policyMode: "historical_unreviewed", paymentMethod: "unknown", liability: 0, revenue: 0,
    })]);
    expect(result.liability).toBe(0);
    expect(result.revenue).toBe(0);
  });
});