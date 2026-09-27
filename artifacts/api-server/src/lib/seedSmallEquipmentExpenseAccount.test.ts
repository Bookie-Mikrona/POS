import { randomUUID } from "node:crypto";
import { afterEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import {
  accountsTable,
  companiesTable,
  db,
  posBookingSettingsTable,
} from "@workspace/db";
import { seedSmallEquipmentExpenseAccount } from "./seedSmallEquipmentExpenseAccount";

const createdCompanyIds: string[] = [];

async function createCompany() {
  const [company] = await db
    .insert(companiesTable)
    .values({
      podjetjeDavcna: `TEST-${randomUUID()}`,
      naziv: "Drobni inventar – test",
    })
    .returning({ id: companiesTable.id });
  createdCompanyIds.push(company.id);
  return company.id;
}

afterEach(async () => {
  await Promise.all(
    createdCompanyIds.splice(0).map((companyId) =>
      db.delete(companiesTable).where(eq(companiesTable.id, companyId)),
    ),
  );
});

describe("seedSmallEquipmentExpenseAccount", () => {
  it("ustvari 404 skupino in konto samo na izrecno zahtevo ter je idempotenten", async () => {
    const companyId = await createCompany();

    const first = await seedSmallEquipmentExpenseAccount(companyId);
    expect(first).toMatchObject({ created: true, filled: true });

    const accounts = await db
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.companyId, companyId));
    const group404 = accounts.find((account) => account.code === "404");
    const expense404 = accounts.find((account) => account.code === "4040000");
    expect(group404).toMatchObject({
      type: "expense",
      isActive: true,
      allowsPosting: false,
      requiresCostCenter: true,
      costCenterPolicy: "required",
    });
    expect(expense404).toMatchObject({
      id: first.accountId,
      type: "expense",
      parentId: group404?.id,
      isActive: true,
      allowsPosting: true,
      requiresCostCenter: true,
      costCenterPolicy: "required",
    });
    const second = await seedSmallEquipmentExpenseAccount(companyId);
    expect(second).toEqual({ accountId: first.accountId, created: false, filled: false });
    expect(accounts).toHaveLength(2);
  });

  it("ne prepiše izbrane nastavitve in ne ustvari konta, če je nastavitev že določena", async () => {
    const companyId = await createCompany();
    const [customAccount] = await db
      .insert(accountsTable)
      .values({
        companyId,
        code: "7770000",
        name: "Lastno konto",
        type: "expense",
      })
      .returning({ id: accountsTable.id });
    await db.insert(posBookingSettingsTable).values({
      companyId,
      drobniInventarExpenseAccountId: customAccount.id,
    });

    const result = await seedSmallEquipmentExpenseAccount(companyId);
    expect(result).toEqual({ accountId: customAccount.id, created: false, filled: false });
    const accounts = await db
      .select({ code: accountsTable.code })
      .from(accountsTable)
      .where(eq(accountsTable.companyId, companyId));
    expect(accounts.map((account) => account.code)).toEqual(["7770000"]);
  });

  it("ne spremeni drugega podjetja", async () => {
    const targetCompanyId = await createCompany();
    const otherCompanyId = await createCompany();

    await seedSmallEquipmentExpenseAccount(targetCompanyId);

    const otherAccounts = await db
      .select({ code: accountsTable.code })
      .from(accountsTable)
      .where(eq(accountsTable.companyId, otherCompanyId));
    const otherSettings = await db
      .select()
      .from(posBookingSettingsTable)
      .where(eq(posBookingSettingsTable.companyId, otherCompanyId));
    expect(otherAccounts).toEqual([]);
    expect(otherSettings).toEqual([]);
  });

  it("uporabi obstoječi aktivni in proknjižljivi konto brez spreminjanja", async () => {
    const companyId = await createCompany();
    const [existing] = await db
      .insert(accountsTable)
      .values({
        companyId,
        code: "4040000",
        name: "Obstoječe prilagojeno ime",
        type: "expense",
        allowsPosting: true,
        requiresCostCenter: false,
        costCenterPolicy: "allowed",
      })
      .returning();

    const result = await seedSmallEquipmentExpenseAccount(companyId);
    expect(result).toEqual({ accountId: existing.id, created: false, filled: true });

    const [unchanged] = await db
      .select()
      .from(accountsTable)
      .where(eq(accountsTable.id, existing.id));
    expect(unchanged).toMatchObject({
      name: "Obstoječe prilagojeno ime",
      allowsPosting: true,
      requiresCostCenter: false,
      costCenterPolicy: "allowed",
    });
  });
});