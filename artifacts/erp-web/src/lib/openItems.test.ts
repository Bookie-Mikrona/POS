import { describe, expect, it } from "vitest";
import {
  allocationIdentity,
  buildPaymentAllocationPayload,
  canBulkSelectForCutoff,
  canPrepareSupplierPayment,
  getOpenItemKey,
  groupPaymentBatchAllocations,
  isPastCutoff,
  openItemDocumentHref,
  openItemSourceLabel,
} from "./openItems";

const native = {
  id: "ledger:line-1",
  invoiceId: null,
  sourceKind: "ledger" as const,
  sourceId: "line-1",
  journalLineId: "line-1",
  entryId: "entry-1",
  side: "credit" as const,
  paymentDirection: "outbound" as const,
  invoiceType: "received",
  counterpartyId: "supplier-1",
  arApAccountId: "ap-1",
  accountCode: "2200",
  reference: "INV-REF-1",
  remainingAmount: "80.00",
  dueDate: null,
};

describe("mixed open-item UI helpers", () => {
  it("labels native rows as ledger and links them to the journal or partner card", () => {
    expect(openItemSourceLabel(native)).toBe("Postavka GK");
    expect(openItemDocumentHref(native)).toBe("/temeljnice?id=entry-1");
    expect(openItemDocumentHref({ ...native, entryId: null })).toBe(
      "/kartica-partnerja?partnerId=supplier-1&accountId=ap-1",
    );
  });

  it("uses stable non-null selection identities for both native and invoice rows", () => {
    expect(getOpenItemKey(native)).toBe("ledger:line-1");
    expect(allocationIdentity(native)).toEqual({ journalLineId: "line-1" });
    expect(getOpenItemKey({
      invoiceId: "invoice-1",
      journalLineId: null,
      remainingAmount: "10",
    })).toBe("invoice-1");
    expect(getOpenItemKey({
      invoiceId: null,
      journalLineId: "line-fallback",
      remainingAmount: "10",
    })).toBe("line-fallback");
  });

  it("builds invoice and ledger allocations additively without null invoice ids", () => {
    expect(buildPaymentAllocationPayload([
      { id: "inv", invoiceId: "invoice-1", allocatedAmount: "12.50" },
      { id: "native", journalLineId: "line-1", allocatedAmount: "8" },
      { id: "empty", allocatedAmount: "0" },
    ])).toEqual({
      allocations: [{ invoiceId: "invoice-1", allocatedAmount: 12.5 }],
      ledgerAllocations: [{ journalLineId: "line-1", allocatedAmount: 8 }],
    });
  });

  it("groups mixed batch instructions by counterparty/account with exactly one source id per allocation", () => {
    const invoice = {
      invoiceId: "invoice-1",
      invoiceType: "received",
      counterpartyId: "supplier-1",
      arApAccountId: "ap-1",
      remainingAmount: "20",
    };
    expect(groupPaymentBatchAllocations([
      { id: "inv", invoiceId: "invoice-1", allocatedAmount: "20" },
      { id: "native", journalLineId: "line-1", allocatedAmount: "80" },
    ], [invoice, native])).toEqual([{
      counterpartyId: "supplier-1",
      arApAccountId: "ap-1",
      allocations: [
        { invoiceId: "invoice-1", amount: 20 },
        { journalLineId: "line-1", amount: 80 },
      ],
    }]);
  });

  it("keeps reserved and opposite-direction native items out of preparation", () => {
    expect(canPrepareSupplierPayment({ ...native, activePaymentBatchId: "batch-1" })).toBe(false);
    expect(canPrepareSupplierPayment({ ...native, paymentDirection: "inbound" })).toBe(false);
    expect(canPrepareSupplierPayment({ ...native, paymentDirection: null })).toBe(false);
    expect(canPrepareSupplierPayment({
      invoiceId: "legacy-invoice",
      invoiceType: "received",
      remainingAmount: "1",
    })).toBe(true);
  });

  it("does not treat unknown native maturity as overdue or bulk-eligible at a cutoff", () => {
    expect(isPastCutoff(native, "2025-01-01")).toBe(false);
    expect(canBulkSelectForCutoff(native, "2025-01-01")).toBe(false);
    expect(canPrepareSupplierPayment(native)).toBe(true); // allow explicit/manual inclusion
    expect(canBulkSelectForCutoff({ ...native, dueDate: "2024-12-31" }, "2025-01-01")).toBe(true);
  });
});