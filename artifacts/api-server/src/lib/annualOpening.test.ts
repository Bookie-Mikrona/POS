import { describe, expect, it } from "vitest";
import {
  isReservedOpeningReference, matchesAnnualOpening, moneyCents, type AnnualOpeningSnapshot,
} from "./annualOpening";

const snapshot: AnnualOpeningSnapshot = {
  sourcePeriodId: "prior", destinationPeriodId: "next",
  year: "2026", date: "2026-01-01", reference: "OTV-2026-01",
  lines: [
    { accountId: "equipment", code: "0400001", name: "Oprema", side: "debit", amount: "58100.77" },
    { accountId: "contra", code: "0500001", name: "Popravek vrednosti", side: "credit", amount: "58100.77" },
    { accountId: "customer", code: "1200000", name: "Kupci", side: "debit", amount: "7818.57" },
    { accountId: "capital", code: "9030000", name: "Kapital", side: "credit", amount: "7818.57" },
  ],
  debit: "65919.34", credit: "65919.34",
  reconciliation: [], reconciled: true,
};
const entry = { reference: snapshot.reference, periodId: "next", entryDate: "2026-01-01", sourceType: "manual" };
const lines = snapshot.lines.map((line) => ({
  accountId: line.accountId, side: line.side, amount: line.amount, partnerId: null,
  costCenterId: null, projectId: null, departmentId: null, vatCodeId: null,
  companyVatCodeId: null, vatAmount: "0.00",
}));

describe("letna otvoritev", () => {
  it("reserves opening references on the generic create/autopost route", () => {
    expect(isReservedOpeningReference("OTV-2026-01")).toBe(true);
    expect(isReservedOpeningReference("BOOKIE-OLD/K2/2026/00/000001")).toBe(true);
    expect(isReservedOpeningReference("BANKA-2026-01")).toBe(false);
  });
  it("keeps contra-asset balances gross and compares cents exactly", () => {
    expect(snapshot.debit).toBe(snapshot.credit);
    expect(moneyCents("58100.77")).toBe(5810077);
    expect(matchesAnnualOpening(entry, [...lines].reverse(), snapshot)).toBe(true);
  });

  it("does not grant the partner exception merely for an opening reference", () => {
    expect(matchesAnnualOpening({ ...entry, reference: "OTV-2026-02" }, lines, snapshot)).toBe(false);
    expect(matchesAnnualOpening({ ...entry, entryDate: "2026-01-02" }, lines, snapshot)).toBe(false);
    expect(matchesAnnualOpening({ ...entry, sourceType: "document" }, lines, snapshot)).toBe(false);
    expect(matchesAnnualOpening(entry, lines.map((line) =>
      line.accountId === "customer" ? { ...line, amount: "7818.56" } : line,
    ), snapshot)).toBe(false);
    expect(matchesAnnualOpening(entry, [...lines, lines[0]], snapshot)).toBe(false);
  });

  it("rejects fabricated partner and VAT/dimension changes on an aggregate opening", () => {
    expect(matchesAnnualOpening(entry, lines.map((line) =>
      line.accountId === "customer" ? { ...line, partnerId: "made-up" } : line,
    ), snapshot)).toBe(false);
    expect(matchesAnnualOpening(entry, lines.map((line) =>
      line.accountId === "customer" ? { ...line, vatCodeId: "vat", vatAmount: "3.00" } : line,
    ), snapshot)).toBe(false);
    expect(matchesAnnualOpening(entry, lines.map((line) =>
      line.accountId === "customer" ? { ...line, departmentId: "department" } : line,
    ), snapshot)).toBe(false);
  });
});