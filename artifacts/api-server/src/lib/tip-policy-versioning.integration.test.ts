import { describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  companiesTable,
  db,
  enoteTable,
  narocilaTable,
  racuniTable,
  tipPoliciesTable,
} from "@workspace/db";
import { resolveTipPolicy } from "./tip-policy";

const ROLLBACK = new Error("ROLLBACK_TIP_POLICY_TEST");

describe("tip policy forward-only versioning", () => {
  it("closes a used policy prospectively and resolves its successor on both sides", async () => {
    await expect(db.transaction(async (tx) => {
      const [company] = await tx.insert(companiesTable).values({
        podjetjeDavcna: `TIP-VERSION-${crypto.randomUUID()}`,
        naziv: "Tip policy version test",
      }).returning({ id: companiesTable.id });
      const [unit] = await tx.insert(enoteTable).values({
        companyId: company.id,
        ime: "Policy test unit",
      }).returning({ id: enoteTable.id });
      const [order] = await tx.insert(narocilaTable).values({
        enotaId: unit.id,
        status: "zakljuceno",
        skupaj: "11.00",
      }).returning({ id: narocilaTable.id });
      const [first] = await tx.insert(tipPoliciesTable).values({
        companyId: company.id,
        enotaId: unit.id,
        effectiveFrom: "2026-01-01",
        mode: "direct_employee",
        evidenceType: "employment_contract",
        evidenceReference: "Agreement A",
        agreementConfirmed: true,
        cardFeeTreatment: "employer_expense",
        cardFeeKind: "none",
        createdBy: "test",
      }).returning();
      await tx.insert(racuniTable).values({
        enotaId: unit.id,
        narociloId: order.id,
        stevilkaRacuna: `TIP-VERSION-${crypto.randomUUID()}`,
        skupaj: "10.00",
        ddv: "0.00",
        placilnaNacin: "kartica",
        status: "poslan",
        datumCas: new Date("2026-03-01T12:00:00+01:00"),
        znesekKartica: "11.00",
        znesekNapitnina: "1.00",
        tipPolicyId: first.id,
        tipPolicyMode: "direct_employee",
        tipPaymentMethod: "card",
      });

      await tx.update(tipPoliciesTable)
        .set({ effectiveTo: "2026-12-31", updatedAt: new Date() })
        .where(eq(tipPoliciesTable.id, first.id));
      const [successor] = await tx.insert(tipPoliciesTable).values({
        companyId: company.id,
        enotaId: unit.id,
        effectiveFrom: "2027-01-01",
        mode: "employer_controlled",
        evidenceType: "internal_rule",
        evidenceReference: "Rule B",
        agreementConfirmed: false,
        cardFeeTreatment: "employer_expense",
        cardFeeKind: "none",
        createdBy: "test",
      }).returning();

      expect((await resolveTipPolicy(company.id, unit.id, new Date("2026-12-31T12:00:00+01:00"), tx))?.id).toBe(first.id);
      expect((await resolveTipPolicy(company.id, unit.id, new Date("2027-01-01T12:00:00+01:00"), tx))?.id).toBe(successor.id);
      throw ROLLBACK;
    })).rejects.toBe(ROLLBACK);
  });

  it("rejects closing a used policy before its latest receipt", async () => {
    let rejection: unknown;
    try {
      await db.transaction(async (tx) => {
      const [company] = await tx.insert(companiesTable).values({
        podjetjeDavcna: `TIP-GUARD-${crypto.randomUUID()}`,
        naziv: "Tip policy guard test",
      }).returning({ id: companiesTable.id });
      const [unit] = await tx.insert(enoteTable).values({ companyId: company.id, ime: "Guard unit" }).returning({ id: enoteTable.id });
      const [order] = await tx.insert(narocilaTable).values({ enotaId: unit.id, status: "zakljuceno", skupaj: "11.00" }).returning({ id: narocilaTable.id });
      const [policy] = await tx.insert(tipPoliciesTable).values({
        companyId: company.id, enotaId: unit.id, effectiveFrom: "2026-01-01",
        mode: "direct_employee", evidenceType: "employment_contract", evidenceReference: "Agreement",
        agreementConfirmed: true, cardFeeTreatment: "employer_expense", cardFeeKind: "none", createdBy: "test",
      }).returning();
      await tx.insert(racuniTable).values({
        enotaId: unit.id, narociloId: order.id, stevilkaRacuna: `TIP-GUARD-${crypto.randomUUID()}`,
        skupaj: "10.00", ddv: "0.00", placilnaNacin: "kartica", status: "poslan",
        datumCas: new Date("2026-06-01T12:00:00+02:00"), znesekKartica: "11.00", znesekNapitnina: "1.00",
        tipPolicyId: policy.id, tipPolicyMode: "direct_employee", tipPaymentMethod: "card",
      });
      await tx.update(tipPoliciesTable).set({ effectiveTo: "2026-05-31" }).where(eq(tipPoliciesTable.id, policy.id));
      });
    } catch (error) {
      rejection = error;
    }
    expect((rejection as { cause?: { message?: string } })?.cause?.message)
      .toContain("policy cannot end before its latest receipt snapshot");
  });
});