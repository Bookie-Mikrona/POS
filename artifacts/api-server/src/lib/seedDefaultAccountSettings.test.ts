import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import {
  accountsTable,
  companiesTable,
  db,
  ddvZakljucekSettingsTable,
  osAmortizacijaNastavitveTable,
  posBookingSettingsTable,
  vatCodesTable,
} from "@workspace/db";
import {
  POS_DEFAULT_ACCOUNT_CODES,
  seedDefaultAccountSettings,
} from "./seedDefaultAccountSettings";

const createdCompanyIds: string[] = [];

async function createCompanyWithAccounts(excludedCodes: string[] = []) {
  const [company] = await db
    .insert(companiesTable)
    .values({
      podjetjeDavcna: `TEST-${randomUUID()}`,
      naziv: "Seed nastavitev – test",
    })
    .returning({ id: companiesTable.id });
  createdCompanyIds.push(company.id);

  const accountCodes = [
    ...Object.values(POS_DEFAULT_ACCOUNT_CODES),
    "4302000",
    "0500000",
    "2609000",
    "1609000",
    "1001000",
  ].filter((code) => !excludedCodes.includes(code));
  const accounts = await db
    .insert(accountsTable)
    .values(
      [...new Set(accountCodes)].map((code) => ({
        companyId: company.id,
        code,
        name: `Test konto ${code}`,
        type: "asset" as const,
      })),
    )
    .returning({ id: accountsTable.id, code: accountsTable.code });

  return {
    companyId: company.id,
    idByCode: new Map(accounts.map((account) => [account.code, account.id])),
    codeById: new Map(accounts.map((account) => [account.id, account.code])),
  };
}

function codeOf(codeById: Map<string, string>, accountId: string | null): string | null {
  return accountId ? codeById.get(accountId) ?? null : null;
}

afterEach(async () => {
  await Promise.all(
    createdCompanyIds.splice(0).map((companyId) =>
      db.delete(companiesTable).where(eq(companiesTable.id, companyId)),
    ),
  );
});

describe("seedDefaultAccountSettings", () => {
  it("nastavi module z obstoječimi konti in manjkajoči konto pusti prazen", async () => {
    const fixture = await createCompanyWithAccounts(["7620300"]);

    const result = await db.transaction((tx) =>
      seedDefaultAccountSettings(fixture.companyId, tx),
    );

    expect(result.posBookingSettings).toMatchObject({ created: true });
    expect(result.vatCodes).toMatchObject({ created: 3 });
    expect(result.amortization).toMatchObject({ created: true });
    expect(result.vatClosing).toMatchObject({ created: true });

    const [posSettings] = await db
      .select()
      .from(posBookingSettingsTable)
      .where(eq(posBookingSettingsTable.companyId, fixture.companyId));
    expect(codeOf(fixture.codeById, posSettings.cashAccountId)).toBe("1000000");
    expect(codeOf(fixture.codeById, posSettings.vat22AccountId)).toBe("2600000");
    expect(codeOf(fixture.codeById, posSettings.revenueService22AccountId)).toBe("7601100");
    expect(codeOf(fixture.codeById, posSettings.payablesAccountId)).toBe("2200000");
    expect(codeOf(fixture.codeById, posSettings.returnablePackagingAccountId)).toBe("3107000");
    expect(codeOf(fixture.codeById, posSettings.cashInTransitAccountId)).toBe("1090000");
    expect(codeOf(fixture.codeById, posSettings.nabavaObracunAccountId)).toBe("3000000");
    expect(codeOf(fixture.codeById, posSettings.otherCostsAccountId)).toBe("4809000");
    expect(codeOf(fixture.codeById, posSettings.cogsGoodsAccountId)).toBe("7000000");
    expect(codeOf(fixture.codeById, posSettings.wasteAccountId)).toBe("4050000");
    expect(codeOf(fixture.codeById, posSettings.reprezentancaAccountId)).toBe("4141000");
    expect(codeOf(fixture.codeById, posSettings.lastnaPorabaAccountId)).toBe("4809000");
    expect(codeOf(fixture.codeById, posSettings.openingBalanceAccountId)).toBe("9000000");
    expect(posSettings.cashInTransitAccountId).not.toBe(posSettings.nabavaObracunAccountId);
    expect(posSettings.revenueGoods5AccountId).toBeNull();

    const vatCodes = await db
      .select()
      .from(vatCodesTable)
      .where(eq(vatCodesTable.companyId, fixture.companyId));
    const vat22 = vatCodes.find((vatCode) => vatCode.code === "S22");
    expect(vat22).toBeDefined();
    expect(codeOf(fixture.codeById, vat22!.accountOutputId)).toBe("2600000");
    expect(codeOf(fixture.codeById, vat22!.accountInputId)).toBe("1600000");
    expect(vatCodes.map((vatCode) => vatCode.code).sort()).toEqual(["S22", "S5", "S95"]);

    const [amortization] = await db
      .select()
      .from(osAmortizacijaNastavitveTable)
      .where(eq(osAmortizacijaNastavitveTable.companyId, fixture.companyId));
    expect(codeOf(fixture.codeById, amortization.kontoStroskaId)).toBe("4302000");
    expect(codeOf(fixture.codeById, amortization.kontoPopravkaId)).toBe("0500000");

    const [vatClosing] = await db
      .select()
      .from(ddvZakljucekSettingsTable)
      .where(eq(ddvZakljucekSettingsTable.companyId, fixture.companyId));
    expect(codeOf(fixture.codeById, vatClosing.netoObveznostAccountId)).toBe("2609000");
    expect(codeOf(fixture.codeById, vatClosing.netoTerjatevAccountId)).toBe("1609000");
  });

  it("ob drugem zagonu ne prepiše že nastavljenih vrednosti", async () => {
    const fixture = await createCompanyWithAccounts();
    await db.transaction((tx) => seedDefaultAccountSettings(fixture.companyId, tx));
    const customAccountId = fixture.idByCode.get("1001000")!;

    await db
      .update(posBookingSettingsTable)
      .set({ cashAccountId: customAccountId })
      .where(eq(posBookingSettingsTable.companyId, fixture.companyId));
    await db
      .update(vatCodesTable)
      .set({ accountOutputId: customAccountId })
      .where(and(
        eq(vatCodesTable.companyId, fixture.companyId),
        eq(vatCodesTable.code, "S22"),
      ));
    await db
      .update(osAmortizacijaNastavitveTable)
      .set({ kontoStroskaId: customAccountId })
      .where(eq(osAmortizacijaNastavitveTable.companyId, fixture.companyId));

    const result = await db.transaction((tx) =>
      seedDefaultAccountSettings(fixture.companyId, tx),
    );

    expect(result.posBookingSettings).toEqual({ created: false, filled: 0 });
    expect(result.vatCodes).toEqual({ created: 0, filled: 0 });
    expect(result.amortization).toEqual({ created: false, filled: 0 });
    expect(result.vatClosing).toEqual({ created: false, filled: 0 });

    const [posSettings] = await db
      .select()
      .from(posBookingSettingsTable)
      .where(eq(posBookingSettingsTable.companyId, fixture.companyId));
    expect(posSettings.cashAccountId).toBe(customAccountId);

    const [vat22] = await db
      .select()
      .from(vatCodesTable)
      .where(and(
        eq(vatCodesTable.companyId, fixture.companyId),
        eq(vatCodesTable.code, "S22"),
      ));
    expect(vat22.accountOutputId).toBe(customAccountId);

    const [amortization] = await db
      .select()
      .from(osAmortizacijaNastavitveTable)
      .where(eq(osAmortizacijaNastavitveTable.companyId, fixture.companyId));
    expect(amortization.kontoStroskaId).toBe(customAccountId);
  });

});