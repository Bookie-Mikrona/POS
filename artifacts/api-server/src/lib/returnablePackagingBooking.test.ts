import { describe, expect, it } from "vitest";
import { buildReturnablePackagingBooking } from "./returnablePackagingBooking";

describe("buildReturnablePackagingBooking", () => {
  it("rounds immutable quantity*deposit and has only DR220/CR315 with no VAT", () => {
    expect(buildReturnablePackagingBooking({
      packagingAccountId: "315", payablesAccountId: "220", supplierId: "supplier",
      quantity: 2, deposit: 1.234,
    })).toEqual([
      { accountId: "220", side: "debit", amount: "2.47", partnerId: "supplier", vatAmount: "0.00" },
      { accountId: "315", side: "credit", amount: "2.47", partnerId: null, vatAmount: "0.00" },
    ]);
  });
});