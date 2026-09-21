import { afterAll, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  accountingPeriodsTable, accountsTable, companiesTable, db, enoteTable, journalEntriesTable,
  journalEntryLinesTable, narocilaTable, pool, posBookingSettingsTable, racuniTable,
  tipAllocationsTable, tipPoliciesTable, tipSettlementsTable,
} from "@workspace/db";
import { createTipSettlementJournal } from "./tips";
import { compensateTipAllocationsForReceipt } from "../lib/tip-storno-ledger";

const run = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

describe("tip settlement ERP journal", () => {
  it("creates one liability-closing draft and makes retries idempotent", async () => {
    const [company] = await db.insert(companiesTable).values({
      podjetjeDavcna: `TIP-SETTLE-${run}`, naziv: "Tip settlement accounting",
    }).returning();
    const [unit] = await db.insert(enoteTable).values({ companyId: company.id, ime: "Settlement unit" }).returning();
    const [liability] = await db.insert(accountsTable).values({
      companyId: company.id, code: `23${run.slice(-5)}`, name: "Tips liability", type: "liability",
    }).returning();
    const [cash] = await db.insert(accountsTable).values({
      companyId: company.id, code: `10${run.slice(-5)}`, name: "Cash", type: "asset",
    }).returning();
    await db.insert(accountingPeriodsTable).values({
      companyId: company.id, name: "Settlement period", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
    });
    await db.insert(posBookingSettingsTable).values({
      companyId: company.id, tipsLiabilityAccountId: liability.id, cashAccountId: cash.id,
    });
    const [policy] = await db.insert(tipPoliciesTable).values({
      companyId: company.id, enotaId: unit.id, effectiveFrom: "2026-01-01",
      mode: "direct_employee", evidenceType: "employment_contract", evidenceReference: `settle-${run}`,
      agreementConfirmed: true, cardFeeTreatment: "employer_expense", cardFeeKind: "none", createdBy: "test",
    }).returning();
    const [order] = await db.insert(narocilaTable).values({ enotaId: unit.id, status: "zakljuceno", skupaj: "10" }).returning();
    const [receipt] = await db.insert(racuniTable).values({
      enotaId: unit.id, narociloId: order.id, stevilkaRacuna: `SETTLE-${run}`,
      skupaj: "10", ddv: "0", placilnaNacin: "gotovina", status: "poslan", datumCas: new Date("2026-05-01T10:00:00Z"),
      znesekNapitnina: "5", tipPolicyId: policy.id, tipPolicyMode: "direct_employee",
    }).returning();
    const [allocation] = await db.insert(tipAllocationsTable).values({
      companyId: company.id, enotaId: unit.id, racunId: receipt.id, tipPolicyId: policy.id,
      recipientSnapshot: "Employee", grossAmount: "5", feeAmount: "0", netAmount: "5", createdBy: "test",
    }).returning();
    await db.insert(tipSettlementsTable).values({
      companyId: company.id, allocationId: allocation.id, settlementMethod: "cash",
      settlementReference: `cash-${run}`, evidenceReference: `evidence-${run}`,
      settledAt: new Date("2026-05-02T10:00:00Z"), settledBy: "test",
    });

    for (let attempt = 0; attempt < 2; attempt++) {
      await db.transaction(tx => createTipSettlementJournal(
        tx, company.id, allocation.id, new Date("2026-05-02T10:00:00Z"), "5", "cash", "test",
      ));
    }
    const entries = await db.select().from(journalEntriesTable).where(and(
      eq(journalEntriesTable.companyId, company.id),
      eq(journalEntriesTable.reference, `POS:TIP-SETTLEMENT:${allocation.id}`),
    ));
    expect(entries).toHaveLength(1);
    const lines = await db.select().from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, entries[0].id));
    expect(lines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: liability.id, side: "debit", amount: "5.00" }),
      expect.objectContaining({ accountId: cash.id, side: "credit", amount: "5.00" }),
    ]));
    await db.transaction(tx => compensateTipAllocationsForReceipt(tx, {
      racunId: receipt.id, actor: "storno-test", evidenceReference: `storno-${run}`,
    }));
    await db.transaction(tx => compensateTipAllocationsForReceipt(tx, {
      racunId: receipt.id, actor: "storno-test", evidenceReference: `storno-${run}`,
    }));
    const reversals = await db.select({ id: journalEntriesTable.id }).from(journalEntriesTable)
      .where(and(eq(journalEntriesTable.companyId, company.id), eq(journalEntriesTable.reversalOf, entries[0].id)));
    expect(reversals).toHaveLength(1);
  });
});

afterAll(async () => { await pool.end(); });