import { afterAll, describe, expect, it } from "vitest";
import { readFile } from "node:fs/promises";
import { and, eq } from "drizzle-orm";
import {
  companiesTable, db, enoteTable, narocilaTable, pool, racuniTable,
  tipAllocationsTable, tipPoliciesTable, tipPoolEntriesTable, tipPoolsTable,
  tipSettlementRecoveriesTable, tipSettlementsTable,
} from "@workspace/db";
import { compensateTipAllocationsForReceipt } from "./tip-storno-ledger";

const run = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

async function fixture(kind: "pool" | "direct", settled: boolean) {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `TIP-STORNO-${run}-${Math.random()}`, naziv: "Tip storno integration",
  }).returning();
  const [unit] = await db.insert(enoteTable).values({ companyId: company.id, ime: "Storno enota" }).returning();
  const [policy] = await db.insert(tipPoliciesTable).values({
    companyId: company.id, enotaId: unit.id, effectiveFrom: "2026-10-01",
    mode: kind === "pool" ? "independent_pool" : "direct_employee",
    evidenceType: "collective_agreement", evidenceReference: `policy-${run}`,
    agreementConfirmed: true, cardFeeTreatment: "employer_expense", cardFeeKind: "none", createdBy: "test",
  }).returning();
  const [order] = await db.insert(narocilaTable).values({ enotaId: unit.id, status: "zakljuceno", skupaj: "20" }).returning();
  const [receipt] = await db.insert(racuniTable).values({
    enotaId: unit.id, narociloId: order.id, stevilkaRacuna: `ST-${run}-${Math.random()}`,
    skupaj: "20", ddv: "0", placilnaNacin: "kartica", status: "poslan",
    znesekNapitnina: "10", tipPolicyId: policy.id, tipPolicyMode: policy.mode,
    tipCardFeeKind: "none", tipCardFeeTreatment: "employer_expense", tipCardFeeAmount: "0", tipVatAmount: "0",
  }).returning();
  let poolId: string | null = null;
  if (kind === "pool") {
    const [tipPool] = await db.insert(tipPoolsTable).values({
      companyId: company.id, tipPolicyId: policy.id, name: "Employee pool",
      decisionType: "employee_agreement", decisionDate: "2026-09-30",
      ruleReference: `decision-${run}`, effectiveFrom: "2026-10-01",
      evidenceReference: `evidence-${run}`, createdBy: "test",
    }).returning();
    poolId = tipPool.id;
  }
  const [allocation] = await db.insert(tipAllocationsTable).values({
    companyId: company.id, enotaId: unit.id, racunId: receipt.id, tipPolicyId: policy.id,
    tipPoolId: poolId, recipientSnapshot: kind === "pool" ? "Employee pool" : "Employee",
    grossAmount: "10", feeAmount: "0", netAmount: "10", status: settled ? "settled" : "open", createdBy: "test",
  }).returning();
  if (poolId) await db.insert(tipPoolEntriesTable).values({
    companyId: company.id, poolId, allocationId: allocation.id, entryType: "allocation",
    amount: "10", evidenceReference: `allocation-${run}`, createdBy: "test",
  });
  let settlementId: string | null = null;
  if (settled) {
    const [settlement] = await db.insert(tipSettlementsTable).values({
      companyId: company.id, allocationId: allocation.id, settlementMethod: "bank",
      settlementReference: `bank-${run}`, evidenceReference: `bank-evidence-${run}`,
      settledAt: new Date(), settledBy: "test",
    }).returning();
    settlementId = settlement.id;
  }
  return { companyId: company.id, receiptId: receipt.id, allocationId: allocation.id, poolId, settlementId };
}

async function compensateTwice(receiptId: number) {
  for (let i = 0; i < 2; i++) {
    await db.transaction(tx => compensateTipAllocationsForReceipt(tx, {
      racunId: receiptId, actor: "furs-test", evidenceReference: `Fiskalni storno ${receiptId}`,
    }));
  }
}

afterAll(async () => { await pool.end(); });

describe("automatic fiscal tip storno compensation", () => {
  it("is wired into confirmed fiscal storno finalization", async () => {
    const source = await readFile(new URL("../routes/pos/racuni.ts", import.meta.url), "utf8");
    const finalize = source.slice(source.indexOf("async function finalizeConfirmedStorno"), source.indexOf("async function finalizeConfirmedGiftReceipt"));
    expect(finalize).toContain("await compensateTipAllocationsForReceipt(tx");
  });

  it("keeps an open pool allocation entry and appends exactly one opposite reversal", async () => {
    const f = await fixture("pool", false);
    await compensateTwice(f.receiptId);
    const entries = await db.select().from(tipPoolEntriesTable).where(eq(tipPoolEntriesTable.allocationId, f.allocationId));
    expect(entries.filter(e => e.entryType === "allocation")).toHaveLength(1);
    expect(entries.filter(e => e.entryType === "reversal")).toHaveLength(1);
    expect(entries.reduce((sum, e) => sum + Number(e.amount), 0)).toBe(0);
    const [allocation] = await db.select().from(tipAllocationsTable).where(eq(tipAllocationsTable.id, f.allocationId));
    expect(allocation.status).toBe("cancelled");
  });

  for (const kind of ["pool", "direct"] as const) {
    it(`keeps settled ${kind} evidence and appends one idempotent recovery`, async () => {
      const f = await fixture(kind, true);
      await compensateTwice(f.receiptId);
      const settlements = await db.select().from(tipSettlementsTable).where(eq(tipSettlementsTable.allocationId, f.allocationId));
      const recoveries = await db.select().from(tipSettlementRecoveriesTable).where(and(
        eq(tipSettlementRecoveriesTable.allocationId, f.allocationId), eq(tipSettlementRecoveriesTable.companyId, f.companyId),
      ));
      expect(settlements).toHaveLength(1);
      expect(settlements[0].id).toBe(f.settlementId);
      expect(recoveries).toHaveLength(1);
      if (kind === "pool") {
        const reversals = await db.select().from(tipPoolEntriesTable).where(and(
          eq(tipPoolEntriesTable.allocationId, f.allocationId), eq(tipPoolEntriesTable.entryType, "reversal"),
        ));
        expect(reversals).toHaveLength(1);
      }
      const [allocation] = await db.select().from(tipAllocationsTable).where(eq(tipAllocationsTable.id, f.allocationId));
      expect(allocation.status).toBe("cancelled");
    });
  }
});