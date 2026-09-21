import { describe, expect, it } from "vitest";
import { buildReturnablePackagingWriteoffBooking } from "./returnablePackagingWriteoffBooking";

describe("buildReturnablePackagingWriteoffBooking", () => {
  it("debits class-4 expense and credits packaging inventory without 220 or partner", () => {
    const lines = buildReturnablePackagingWriteoffBooking({
      packagingAccountId: "3107000",
      writeoffAccountId: "4802000",
      quantity: 2,
      deposit: 3,
    });
    expect(lines).toEqual([
      { accountId: "4802000", side: "debit", amount: "6.00", partnerId: null, vatAmount: "0.00" },
      { accountId: "3107000", side: "credit", amount: "6.00", partnerId: null, vatAmount: "0.00" },
    ]);
    expect(lines.some(line => line.accountId.startsWith("220"))).toBe(false);
  });

  it("represents a historical zero-deposit write-off as zero-value lines without VAT", () => {
    expect(buildReturnablePackagingWriteoffBooking({
      packagingAccountId: "3107000",
      writeoffAccountId: "4802000",
      quantity: 4,
      deposit: 0,
    })).toEqual([
      { accountId: "4802000", side: "debit", amount: "0.00", partnerId: null, vatAmount: "0.00" },
      { accountId: "3107000", side: "credit", amount: "0.00", partnerId: null, vatAmount: "0.00" },
    ]);
  });
});