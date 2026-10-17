import { describe, expect, it } from "vitest";
import { bankImportDimensionWarnings, type ImportAccount, type BankImportDecision } from "./bank-import-dimensions";

const accounts: ImportAccount[] = [
  { id: "bank", code: "1100000" },
  { id: "expense", code: "4150000", requiresCostCenter: true, requiresProject: true, requiresPartner: true },
  { id: "policy", code: "4160000", costCenterPolicy: "required" },
  { id: "normal", code: "2200000", requiresPartner: true },
];
const standalone = { kind: "standalone" as const, arApAccountId: "expense", counterpartyId: "" };
const invoices = [{ id: "invoice", arApAccountId: "expense" }];
const payment = { id: "payment", status: "draft", bankAccountId: "bank", arApAccountId: "expense", counterpartyId: "partner" };
const warnings = (decision: BankImportDecision, accs = accounts, autoPost = false, status = "draft") =>
  bankImportDimensionWarnings(decision, "bank", accs, invoices, [{ ...payment, status }], autoPost);

describe("bank import required dimensions", () => {
  it("lists every missing dimension and the account code", () => {
    expect(warnings(standalone)).toEqual([
      "Konto 4150000: manjkajo obvezne dimenzije — poslovni partner, stroškovno mesto, projekt.",
    ]);
  });
  it("removes partner warning after selection without hiding other requirements", () => {
    expect(warnings({ ...standalone, counterpartyId: "partner" })[0]).not.toContain("poslovni partner");
    expect(warnings({ ...standalone, counterpartyId: "partner" })[0]).toContain("stroškovno mesto, projekt");
  });
  it("uses the invoice's actual account even for matched transactions", () => {
    expect(warnings({ kind: "matched", invoiceId: "invoice", counterpartyId: "partner" })[0]).toContain("4150000");
  });
  it("honours costCenterPolicy as well as the legacy flag", () => {
    expect(warnings({ ...standalone, arApAccountId: "policy" })[0]).toContain("stroškovno mesto");
  });
  it("validates the bank account too", () => {
    expect(warnings({ ...standalone, arApAccountId: "normal", counterpartyId: "partner" },
      [{ ...accounts[0], requiresProject: true }, ...accounts.slice(1)])).toEqual([
      "Konto 1100000: manjkajo obvezne dimenzije — projekt.",
    ]);
  });
  it("clears warnings when an unrestricted account and partner are selected", () => {
    expect(warnings({ ...standalone, arApAccountId: "normal", counterpartyId: "partner" })).toEqual([]);
  });
  it("does not assume the bank line receives the counter-account partner", () => {
    expect(warnings({ ...standalone, arApAccountId: "normal", counterpartyId: "partner" },
      [{ ...accounts[0], requiresPartner: true }, ...accounts.slice(1)])[0]).toContain("Konto 1100000: manjkajo obvezne dimenzije — poslovni partner");
  });
  it.each(["skip", "pending"] as const)("does not block %s rows", kind => {
    expect(warnings({ kind })).toEqual([]);
  });
  it("checks draft reconciliation only when it will be posted", () => {
    const decision = { kind: "reconcile" as const, paymentId: "payment" };
    expect(warnings(decision)).toEqual([]);
    expect(warnings(decision, accounts, true)[0]).toContain("stroškovno mesto, projekt");
    expect(warnings(decision, accounts, true, "posted")).toEqual([]);
  });
});
