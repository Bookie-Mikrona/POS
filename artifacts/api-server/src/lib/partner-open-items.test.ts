import { describe, expect, it } from "vitest";
import {
  cardBalanceIsUnambiguouslyInvoiceMapped,
  ledgerOpenItemType,
  naturalPaymentDirection,
  openItemAgedBucket,
} from "./partner-open-items";

describe("shared partner open-item read-model rules", () => {
  it("only enables payment for natural AP-credit and AR-debit balances", () => {
    expect(naturalPaymentDirection("credit", "liability")).toBe("outbound");
    expect(naturalPaymentDirection("debit", "asset")).toBe("inbound");
    expect(naturalPaymentDirection("debit", "liability")).toBeNull();
    expect(naturalPaymentDirection("credit", "asset")).toBeNull();
    expect(naturalPaymentDirection("credit", "equity")).toBeNull();
  });

  it("keeps GL items without a due date in the explicit undated bucket", () => {
    expect(openItemAgedBucket(null, "2026-06-30")).toBe("undated");
  });

  it("derives document type from account role rather than debit or credit side", () => {
    expect(ledgerOpenItemType("asset", "credit")).toBe("issued");
    expect(ledgerOpenItemType("liability", "debit")).toBe("received");
  });

  it("only uses a shared card balance when exactly one invoice maps to it", () => {
    expect(cardBalanceIsUnambiguouslyInvoiceMapped(1)).toBe(true);
    expect(cardBalanceIsUnambiguouslyInvoiceMapped(2)).toBe(false);
  });

  it("ages only from an actual due date and preserves bucket boundaries", () => {
    expect(openItemAgedBucket("2026-06-30", "2026-06-30")).toBe("current");
    expect(openItemAgedBucket("2026-05-31", "2026-06-30")).toBe("bucket1to30");
    expect(openItemAgedBucket("2026-05-01", "2026-06-30")).toBe("bucket31to60");
    expect(openItemAgedBucket("2026-04-01", "2026-06-30")).toBe("bucket61to90");
    expect(openItemAgedBucket("2026-03-30", "2026-06-30")).toBe("bucketOver90");
  });
});