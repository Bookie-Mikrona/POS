import { describe, expect, it } from "vitest";
import {
  createFinalizationPlan,
  deterministicFinalizationUuid,
  deterministicFursMessageId,
  deterministicInvoiceRequestId,
  FinalizationPlanConflict,
  finalizationPlanAuthority,
  finalizationPlanHash,
  validateFinalizationPlan,
  type FinalizationPlan,
} from "./finalization-plan";

function plan(source: "online" | "offline" = "online"): FinalizationPlan {
  const operationId = "123e4567-e89b-42d3-a456-426614174000";
  return {
    version: 2,
    source,
    sourceOperationId: operationId,
    receipt: {
      localReceiptId: source === "offline" ? deterministicFinalizationUuid(operationId, "receipt") : operationId,
      ...(source === "online" ? { serverRacunId: 7 } : {}),
      companyId: "company", enotaId: 2, orderId: 9,
      legalNumber: "PP-B-42", pp: "PP", b: "B", ppBSequence: 42,
      issuedAt: "2026-01-02T12:00:00.000Z", isPartial: false,
    },
    soldLines: [{
      id: 11, articleId: 12, modifierId: null, name: "Kava",
      quantity: 1, unitGross: 12.2, gross: 12.2, vatRate: 22,
      normativeFactor: 1, articleKind: "artikel",
    }],
    normativeSnapshot: [{ articleId: 20, quantity: -1 }],
    totals: { gross: 12.2, net: 10, vat: 2.2, vatGroups: [{ rate: 22, gross: 12.2, vat: 2.2 }] },
    payment: {
      method: "gotovina", cash: 12.2, card: 0, voucher: 0, pizzaVoucher: 0,
      nonCash: 0, terminalReferenceReservationId: null, cardPaymentAttemptId: null,
      giftVoucherRedemption: 0,
    },
    operator: { waiterId: 3, name: "A B", taxNumber: null, shiftId: 4, actor: "actor" },
    closure: {
      allLinesCovered: true, closeOrder: true, orderId: 9, tableId: 5, clearTipAmount: false,
    },
    tip: { amount: 0, mode: null, policyId: null, feeAmount: 0, netAmount: 0, distributionProfile: null },
    stockMovements: [{
      articleId: 20, quantity: -1, unitWac: 2, value: -2,
      note: "Račun PP-B-42", effectiveAt: "2026-01-02T12:00:00.000Z",
    }],
    kds: { effects: [] },
    accounting: { companyId: "company", businessDate: "2026-01-02", syncAfterCommit: true },
    print: {
      receiptNumber: "PP-B-42", issuedAt: "2026-01-02T12:00:00.000Z",
      customerName: null, customerAddress: null, customerTaxNumber: null,
    },
    reservations: { issueReservationId: source === "offline" ? deterministicFinalizationUuid(operationId, "issue-reservation") : operationId },
    furs: {
      snapshotId: source === "offline" ? deterministicFinalizationUuid(operationId, "furs-snapshot") : operationId, requestHash: "hash",
      canonicalArtifactLink: source === "offline" ? `offline:${operationId}` : "furs-payload-snapshot:snapshot:hash",
    },
  };
}

describe("FinalizationPlan", () => {
  it("seals all online snapshots and hashes exact replay deterministically", () => {
    const sealed = createFinalizationPlan(plan());
    expect(Object.isFrozen(sealed)).toBe(true);
    expect(Object.isFrozen(sealed.soldLines[0])).toBe(true);
    expect(finalizationPlanHash(sealed)).toBe(finalizationPlanHash(plan()));
    expect(() => {
      (sealed.stockMovements[0] as { unitWac: number }).unitWac = 99;
    }).toThrow();
  });

  it("accepts a preissued cash-only offline plan", () => {
    expect(validateFinalizationPlan(plan("offline"))).toEqual([]);
  });

  it.each(["", "gateway", "OTHER", 1, {}, null] as const)("rejects explicit invalid sourceAuthority %j", (authority) => {
    const candidate = { ...plan("offline"), sourceAuthority: authority } as unknown as FinalizationPlan;
    expect(() => finalizationPlanAuthority(candidate)).toThrow("Invalid finalization plan sourceAuthority.");
    expect(() => validateFinalizationPlan(candidate)).toThrow("Invalid finalization plan sourceAuthority.");
  });

  it("infers legacy authority only when evidence is unambiguous", () => {
    const cloud = plan("offline");
    expect(finalizationPlanAuthority(cloud)).toBe("CLOUD_OFFLINE");
    const gateway = { ...cloud, cloudBaseline: [] };
    expect(finalizationPlanAuthority(gateway)).toBe("GATEWAY");
  });

  it.each([
    ["missing", (base: FinalizationPlan) => ({ ...base, soldLines: [{ ...base.soldLines[0], sourceLineRef: undefined }] })],
    ["empty", (base: FinalizationPlan) => ({ ...base, soldLines: [{ ...base.soldLines[0], sourceLineRef: " " }] })],
    ["duplicate", (base: FinalizationPlan) => ({ ...base, soldLines: [{ ...base.soldLines[0], sourceLineRef: "same" }, { ...base.soldLines[0], id: 12, sourceLineRef: "same" }] })],
    ["bad parent", (base: FinalizationPlan) => ({ ...base, soldLines: [{ ...base.soldLines[0], sourceLineRef: "child", modifierId: 99, parentSourceLineRef: "missing" }] })],
  ])("rejects Gateway %s stable-reference violations", (_name, mutate) => {
    const base = plan("offline");
    const gateway = {
      ...base, sourceAuthority: "GATEWAY" as const,
      receipt: { ...base.receipt, cloudOrderId: 42, sourceOrderRef: "cloud-order" },
      closure: { ...base.closure, cloudOrderId: 42 },
    };
    expect(validateFinalizationPlan(mutate(gateway))).not.toEqual([]);
  });

  it("binds primed numeric cloud orders without interpreting sourceOrderRef", () => {
    const base = plan("offline");
    const primed = {
      ...base,
      receipt: { ...base.receipt, orderId: 42, cloudOrderId: 42, sourceOrderRef: "42" },
      soldLines: [{ ...base.soldLines[0], id: 9, sourceLineRef: "cloud:42:9", cloudLineId: 9 }],
      closure: { ...base.closure, orderId: 42, cloudOrderId: 42 },
    };
    expect(validateFinalizationPlan(primed)).toEqual([]);
  });

  it("rejects locally invented offline identities", () => {
    const invalid = plan("offline");
    (invalid.receipt as { localReceiptId: string }).localReceiptId = "123e4567-e89b-42d3-a456-426614174000";
    expect(validateFinalizationPlan(invalid)).toContain("Offline finalization IDs do not match deterministic UUIDv5 derivation.");
  });

  it("derives stable dynamic FURS XML identities", () => {
    const operationId = "123e4567-e89b-42d3-a456-426614174000";
    const localReceiptId = deterministicFinalizationUuid(operationId, "receipt");
    expect(deterministicFursMessageId(operationId)).toBe("eed312af-cf3b-5f1a-ac53-b4d2030cc686");
    expect(deterministicInvoiceRequestId(localReceiptId, operationId)).toMatch(
      /^InvoiceRequest-[a-f0-9]{32}-[a-f0-9]{32}$/,
    );
  });

  it("rejects non-cash offline plans", () => {
    const invalid = plan("offline");
    (invalid.payment as { method: string; card: number }).method = "kartica";
    (invalid.payment as { method: string; card: number }).card = 12.2;
    expect(validateFinalizationPlan(invalid)).toContain("Offline finalization accepts cash only.");
  });

  it("uses a typed mismatch conflict", () => {
    const error = new FinalizationPlanConflict("mismatch");
    expect(error.status).toBe(409);
    expect(error.code).toBe("FINALIZATION_PLAN_MISMATCH");
  });

  it("includes the resolved distribution snapshot in the immutable plan hash", () => {
    const base = plan();
    const withProfile: FinalizationPlan = {
      ...base,
      tip: {
        ...base.tip,
        distributionProfile: {
          id: "profile-1",
          name: "Večer",
          entries: [{
            id: "entry-1", groupName: "Strežba", recipientNatakarId: 3,
            recipientSnapshot: "A B", sharePercent: 100,
          }],
        },
      },
    };
    const changed: FinalizationPlan = {
      ...withProfile,
      tip: {
        ...withProfile.tip,
        distributionProfile: {
          ...withProfile.tip.distributionProfile!,
          entries: [{ ...withProfile.tip.distributionProfile!.entries[0], recipientSnapshot: "C D" }],
        },
      },
    };
    expect(finalizationPlanHash(withProfile)).not.toBe(finalizationPlanHash(changed));
  });
});
