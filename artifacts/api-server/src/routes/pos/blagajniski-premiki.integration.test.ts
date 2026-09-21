import express from "express";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { and, eq, inArray } from "drizzle-orm";

vi.mock("@clerk/express", () => ({
  getAuth: (req: express.Request) => ({ userId: req.header("x-test-user") ?? null }),
}));

import {
  accountingPeriodsTable,
  accountsTable,
  blagajneTable,
  blagajniskeNastavitveTable,
  blagajniskiPremikiTable,
  companiesTable,
  counterpartiesTable,
  db,
  enoteTable,
  journalEntriesTable,
  journalEntryLinesTable,
  posBookingSettingsTable,
  posUporabnikiTable,
} from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import { getCurrentPosBusinessDate } from "../../lib/pos-business-day";
import router from "./blagajniski-premiki";

const runId = Math.random().toString(36).slice(2, 10);
const users = {
  creator: `cash-creator-${runId}`,
  managerB: `cash-manager-b-${runId}`,
  managerC: `cash-manager-c-${runId}`,
  managerD: `cash-manager-d-${runId}`,
};

let companyId: string;
let enotaId: number;
let blagajnaId: number;
let supplierId: string;
let businessDate: string;
let accountIds: Record<"100" | "220" | "109" | "110", string>;

const app = express();
app.use(express.json());
app.use(requireEnota);
app.use(router);

function post(user: string, path: string, body: Record<string, unknown>) {
  return supertest(app)
    .post(path)
    .set("x-test-user", user)
    .set("x-company-id", companyId)
    .set("x-enota-id", String(enotaId))
    .send(body);
}

async function createMovement(user: string, tip: string, amount: number, opis: string) {
  const response = await post(user, "/blagajniski-premiki", {
    blagajnaId,
    poslovniDatum: businessDate,
    tip,
    znesek: amount,
    opis,
    ...(tip === "IZPLACILO_DOBAVITELJU" ? { partnerId: supplierId } : {}),
  });
  expect(response.status).toBe(201);
  return response.body.id as string;
}

async function confirm(user: string, id: string) {
  return post(user, `/blagajniski-premiki/${id}/potrdi`, {});
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `T291${runId}`,
    naziv: `Cash movement regression ${runId}`,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;

  const [enota] = await db.insert(enoteTable).values({
    companyId,
    ime: `Cash movement enota ${runId}`,
  }).returning({ id: enoteTable.id });
  enotaId = enota!.id;

  const [blagajna] = await db.insert(blagajneTable).values({
    enotaId,
    ppId: `P${runId}`,
    bId: "B1",
    ime: `Cash register ${runId}`,
  }).returning({ id: blagajneTable.id });
  blagajnaId = blagajna!.id;
  businessDate = await getCurrentPosBusinessDate(enotaId);

  const [supplier] = await db.insert(counterpartiesTable).values({
    companyId,
    type: "supplier",
    name: `Supplier ${runId}`,
  }).returning({ id: counterpartiesTable.id });
  supplierId = supplier!.id;

  const accounts = await db.insert(accountsTable).values([
    { companyId, code: `100-${runId}`, name: "Cash", type: "asset", isCash: true },
    { companyId, code: `220-${runId}`, name: "Payables", type: "liability", requiresPartner: true },
    { companyId, code: `109-${runId}`, name: "Clearing", type: "asset" },
    { companyId, code: `110-${runId}`, name: "Bank", type: "asset", isCash: true },
  ]).returning({ id: accountsTable.id, code: accountsTable.code });
  accountIds = Object.fromEntries(accounts.map(({ id, code }) => [code.slice(0, 3), id])) as typeof accountIds;

  await db.insert(accountingPeriodsTable).values({
    companyId,
    name: `Open period ${runId}`,
    startDate: "2020-01-01",
    endDate: "2040-12-31",
    status: "open",
  });
  await db.insert(posBookingSettingsTable).values({
    companyId,
    cashAccountId: accountIds["100"],
    payablesAccountId: accountIds["220"],
    cashInTransitAccountId: accountIds["109"],
    bankAccountId: accountIds["110"],
  });
  await db.insert(blagajniskeNastavitveTable).values({
    companyId,
    enotaId,
    blagajnaId,
    menjalniDenar: "50.00",
    updatedBy: users.managerB,
  });
  await db.insert(posUporabnikiTable).values([
    { clerkUserId: users.creator, companyId, enotaId, blagajnaId, vloga: "admin_enote", ime: "User", priimek: "A" },
    { clerkUserId: users.managerB, companyId, enotaId, vloga: "admin_enote", ime: "Manager", priimek: "B" },
    { clerkUserId: users.managerC, companyId, enotaId, vloga: "admin_enote", ime: "Manager", priimek: "C" },
    { clerkUserId: users.managerD, companyId, enotaId, vloga: "admin_enote", ime: "Manager", priimek: "D" },
  ]);

  // A real posted cash movement funds the register; no balance-check bypass.
  const fundingId = await createMovement(users.creator, "POLOG_GOTOVINE", 2000, `Opening cash ${runId}`);
  expect((await confirm(users.managerB, fundingId)).status).toBe(200);
});

afterAll(async () => {
  if (!companyId) return;
  await db.delete(blagajniskiPremikiTable).where(eq(blagajniskiPremikiTable.companyId, companyId));
  await db.delete(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
  await db.delete(blagajniskeNastavitveTable).where(eq(blagajniskeNastavitveTable.companyId, companyId));
  await db.delete(posBookingSettingsTable).where(eq(posBookingSettingsTable.companyId, companyId));
  await db.delete(posUporabnikiTable).where(eq(posUporabnikiTable.companyId, companyId));
  await db.delete(accountingPeriodsTable).where(eq(accountingPeriodsTable.companyId, companyId));
  await db.delete(accountsTable).where(eq(accountsTable.companyId, companyId));
  await db.delete(counterpartiesTable).where(eq(counterpartiesTable.companyId, companyId));
  await db.delete(blagajneTable).where(eq(blagajneTable.id, blagajnaId));
  await db.delete(enoteTable).where(eq(enoteTable.id, enotaId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

describe("blagajniški premiki endpoint regression", () => {
  it("posts a supplier payout and its dual-control reversal with exact accounting", async () => {
    const payoutId = await createMovement(users.creator, "IZPLACILO_DOBAVITELJU", 100, `Payout lifecycle ${runId}`);
    expect((await confirm(users.creator, payoutId)).status).toBe(422);

    const approved = await confirm(users.managerB, payoutId);
    expect(approved.status).toBe(200);
    expect(approved.body).toMatchObject({ status: "POTRJEN", confirmedBy: users.managerB });

    const [payout] = await db.select().from(blagajniskiPremikiTable).where(eq(blagajniskiPremikiTable.id, payoutId));
    expect(payout!.status).toBe("POTRJEN");
    expect(payout!.journalEntryId).toBeTruthy();
    const originalLines = await db.select().from(journalEntryLinesTable)
      .where(eq(journalEntryLinesTable.entryId, payout!.journalEntryId!));
    expect(originalLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: accountIds["220"], side: "debit", amount: "100.00", partnerId: supplierId }),
      expect.objectContaining({ accountId: accountIds["100"], side: "credit", amount: "100.00" }),
    ]));
    expect(originalLines).toHaveLength(2);

    const prepared = await post(users.managerB, `/blagajniski-premiki/${payoutId}/storno`, { opis: "Wrong payout" });
    expect(prepared.status).toBe(201);
    expect(prepared.body.stornoOdId).toBe(payoutId);
    expect((await confirm(users.managerB, prepared.body.id)).status).toBe(422);
    expect((await confirm(users.managerC, prepared.body.id)).status).toBe(200);

    const [originalAfter] = await db.select().from(blagajniskiPremikiTable).where(eq(blagajniskiPremikiTable.id, payoutId));
    const [storno] = await db.select().from(blagajniskiPremikiTable).where(eq(blagajniskiPremikiTable.id, prepared.body.id));
    const [reversalEntry] = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.id, storno!.journalEntryId!));
    expect(originalAfter!.status).toBe("STORNIRAN");
    expect(storno).toMatchObject({ status: "POTRJEN", stornoOdId: payoutId, confirmedBy: users.managerC });
    expect(reversalEntry!.status).toBe("posted");
    expect(reversalEntry!.reversalOf).toBe(payout!.journalEntryId);
    const reversalLines = await db.select().from(journalEntryLinesTable)
      .where(eq(journalEntryLinesTable.entryId, storno!.journalEntryId!));
    expect(reversalLines).toEqual(expect.arrayContaining([
      expect.objectContaining({ accountId: accountIds["100"], side: "debit", amount: "100.00" }),
      expect.objectContaining({ accountId: accountIds["220"], side: "credit", amount: "100.00", partnerId: supplierId }),
    ]));
    expect(reversalLines).toHaveLength(2);
  });

  it("serializes true concurrent reversal preparation and approval", async () => {
    const payoutId = await createMovement(users.creator, "IZPLACILO_DOBAVITELJU", 80, `Concurrent reversal ${runId}`);
    expect((await confirm(users.managerB, payoutId)).status).toBe(200);

    const first = post(users.managerB, `/blagajniski-premiki/${payoutId}/storno`, { opis: "Duplicate race one" });
    const second = post(users.managerC, `/blagajniski-premiki/${payoutId}/storno`, { opis: "Duplicate race two" });
    const preparedResponses = await Promise.all([first, second]);
    expect(preparedResponses.map((r) => r.status).sort()).toEqual([201, 422]);

    const children = await db.select().from(blagajniskiPremikiTable)
      .where(eq(blagajniskiPremikiTable.stornoOdId, payoutId));
    expect(children).toHaveLength(1);
    const reversalId = children[0]!.id;
    const reversalCreator = children[0]!.createdBy;
    expect((await confirm(reversalCreator, reversalId)).status).toBe(422);

    const approvers = [users.managerB, users.managerC, users.managerD].filter((user) => user !== reversalCreator);
    const approvalOne = confirm(approvers[0], reversalId);
    const approvalTwo = confirm(approvers[1], reversalId);
    const approvals = await Promise.all([approvalOne, approvalTwo]);
    expect(approvals.map((response) => response.status).sort()).toEqual([200, 422]);

    const [original] = await db.select().from(blagajniskiPremikiTable).where(eq(blagajniskiPremikiTable.id, payoutId));
    const [reversal] = await db.select().from(blagajniskiPremikiTable).where(eq(blagajniskiPremikiTable.id, reversalId));
    expect(original!.status).toBe("STORNIRAN");
    expect(reversal!.status).toBe("POTRJEN");
    const reversalEntries = await db.select().from(journalEntriesTable)
      .where(eq(journalEntriesTable.reversalOf, original!.journalEntryId!));
    expect(reversalEntries).toHaveLength(1);
    expect(reversal!.journalEntryId).toBe(reversalEntries[0]!.id);
  });

  it("enforces the EUR 420 supplier/day limit under true concurrent confirmations", async () => {
    const firstId = await createMovement(users.creator, "IZPLACILO_DOBAVITELJU", 250, `Limit first ${runId}`);
    const secondId = await createMovement(users.creator, "IZPLACILO_DOBAVITELJU", 200, `Limit second ${runId}`);

    const first = confirm(users.managerB, firstId);
    const second = confirm(users.managerC, secondId);
    const responses = await Promise.all([first, second]);
    expect(responses.filter((r) => r.status === 200)).toHaveLength(1);
    expect(responses.filter((r) => r.status === 422)).toHaveLength(1);

    const rows = await db.select().from(blagajniskiPremikiTable).where(and(
      inArray(blagajniskiPremikiTable.id, [firstId, secondId]),
      eq(blagajniskiPremikiTable.companyId, companyId),
      eq(blagajniskiPremikiTable.enotaId, enotaId),
      eq(blagajniskiPremikiTable.blagajnaId, blagajnaId),
      eq(blagajniskiPremikiTable.partnerId, supplierId),
      eq(blagajniskiPremikiTable.poslovniDatum, businessDate),
    ));
    const successful = rows.filter((row) => row.status === "POTRJEN");
    const rejected = rows.filter((row) => row.status === "OSNUTEK");
    expect(successful).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    const allConfirmedForSupplierDay = await db.select().from(blagajniskiPremikiTable).where(and(
      eq(blagajniskiPremikiTable.companyId, companyId),
      eq(blagajniskiPremikiTable.enotaId, enotaId),
      eq(blagajniskiPremikiTable.blagajnaId, blagajnaId),
      eq(blagajniskiPremikiTable.partnerId, supplierId),
      eq(blagajniskiPremikiTable.poslovniDatum, businessDate),
      eq(blagajniskiPremikiTable.tip, "IZPLACILO_DOBAVITELJU"),
      eq(blagajniskiPremikiTable.status, "POTRJEN"),
    ));
    expect(allConfirmedForSupplierDay.reduce((sum, row) => sum + Number(row.znesek), 0)).toBeLessThanOrEqual(420);
    expect(rejected[0]).toMatchObject({ journalEntryId: null, confirmedBy: null });
    expect(successful[0]!.journalEntryId).toBeTruthy();
    const entries = await db.select().from(journalEntriesTable)
      .where(eq(journalEntriesTable.id, successful[0]!.journalEntryId!));
    expect(entries).toHaveLength(1);
  });
});