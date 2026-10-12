import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";
import express from "express";
import supertest from "supertest";

const state = vi.hoisted(() => ({ db: null as any }));
vi.mock("@workspace/db", async importOriginal => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  return {
    ...original,
    db: new Proxy(original.db, {
      get(_target, key) {
        const current = state.db ?? original.db;
        const value = current[key];
        return typeof value === "function" ? value.bind(current) : value;
      },
    }),
  };
});

import { and, eq, sql } from "drizzle-orm";
import {
  db, pool, type PoolClient, companiesTable, companyModulesTable, accountsTable,
  enoteTable, narocilaTable, racuniTable, postavkeTable, posBookingSettingsTable,
  posBookingDraftsTable, posBookingDraftLinesTable, journalEntriesTable,
  artikliTable, zalogaGibiTable,
  preparedFoodDailyLedgersTable, preparedFoodStocksTable,
} from "@workspace/db";
import { syncPosBookingForMonth } from "./posSyncBooking";
import { openingStockEffectiveAt } from "./pos-opening-stock-time";
import preparedFoodRouter from "../routes/pos/prepared-food";
import { getZalogeObDatumu } from "./pos-zaloge-utils";

let client: PoolClient | undefined;
let finishTransaction: (() => void) | undefined;
let transactionDone: Promise<void> | undefined;
beforeAll(async () => {
  client = await pool.connect();
  const rollback = new Error("test rollback");
  let ready!: () => void;
  const started = new Promise<void>(resolve => { ready = resolve; });
  const finished = new Promise<void>(resolve => { finishTransaction = resolve; });
  transactionDone = drizzle(client).transaction(async tx => {
    // Drizzle transactions on this object use savepoints, not BEGIN/COMMIT.
    state.db = tx;
    ready();
    await finished;
    throw rollback;
  }).catch(error => { if (error !== rollback) throw error; });
  await Promise.race([started, transactionDone]);
});
afterAll(async () => {
  vi.useRealTimers();
  if (client) {
    try { finishTransaction?.(); await transactionDone; } finally { client.release(); }
  }
  state.db = null;
  await pool.end();
});

it.each([
  {
    month: "2026-07", startHour: "06:00", endDate: "2026-07-31",
    start: "2026-07-01T04:00:00Z", end: "2026-08-01T04:00:00Z",
    middle: "2026-07-15T12:00:00Z",
  },
  {
    month: "2025-12", startHour: "04:00", endDate: "2025-12-31",
    start: "2025-12-01T03:00:00Z", end: "2026-01-01T03:00:00Z",
    middle: "2025-12-15T12:00:00Z",
  },
])("mesečni POS osnutek $month upošteva meje enote in se osveži brez podvajanja ali GK", async scenario => {
  const beforeStart = new Date(new Date(scenario.start).getTime() - 1).toISOString();
  const beforeEnd = new Date(new Date(scenario.end).getTime() - 1).toISOString();
  const [company] = await db.insert(companiesTable).values({
    naziv: "Izoliran mesečni preizkus", podjetjeDavcna: `TEST-MONTH-${crypto.randomUUID()}`,
  }).returning();
  const companyId = company.id;
  await db.insert(companyModulesTable).values({ companyId, module: "pos", enabledBy: "test" });
  const accounts = await db.insert(accountsTable).values([
    { companyId, code: "100", name: "Blagajna", type: "asset" },
    { companyId, code: "760", name: "Prihodki", type: "revenue" },
    { companyId, code: "260", name: "DDV", type: "liability" },
    { companyId, code: "400", name: "Stroški materiala", type: "expense" },
    { companyId, code: "310", name: "Zaloga materiala", type: "asset" },
  ]).returning();
  const [unit] = await db.insert(enoteTable).values({
    companyId, ime: "Testna enota", zacetekDnevaUra: scenario.startHour,
  }).returning();
  await db.insert(posBookingSettingsTable).values({
    companyId, salesBookingFrequency: "monthly", consumptionBookingFrequency: "monthly",
    cashAccountId: accounts[0]!.id, revenueService22AccountId: accounts[1]!.id,
    vat22AccountId: accounts[2]!.id,
    cogsMaterialAccountId: accounts[3]!.id, inventoryMaterialAccountId: accounts[4]!.id,
  });
  const [material] = await db.insert(artikliTable).values({
    enotaId: unit.id, ime: "Testni material", cena: "1", nabavniArtikel: true, vrstaArtikla: "material",
  }).returning();
  await db.insert(zalogaGibiTable).values([
    { ustvarjeno: new Date(beforeStart), vrednost: "-100" },
    { ustvarjeno: new Date(scenario.start), vrednost: "-10" },
    { ustvarjeno: new Date(beforeEnd), vrednost: "-20" },
    { ustvarjeno: new Date(scenario.end), vrednost: "-200" },
  ].map(value => ({
    ...value, artikelId: material.id, tip: "poraba" as const, kolicina: value.vrednost,
    cenaKos: "1", sourceSnapshot: "isolated_month_boundary_test",
  })));
  async function sale(at: string, amount: string) {
    const [order] = await db.insert(narocilaTable).values({
      enotaId: unit.id, status: "zakljuceno", skupaj: amount,
    }).returning();
    const [receipt] = await db.insert(racuniTable).values({
      enotaId: unit.id, narociloId: order.id, stevilkaRacuna: crypto.randomUUID(),
      datumCas: new Date(at), skupaj: amount, ddv: "2.20",
      placilnaNacin: "gotovina", status: "poslan", znesekGotovina: amount,
    }).returning();
    await db.insert(postavkeTable).values({
      narociloId: order.id, racunId: receipt.id, ime: "Test",
      kolicina: 1, cenaKos: amount, skupaj: amount, davek: "22", vrstaArtikla: "storitev",
    });
  }
  await sale(beforeStart, "122.00"); // Previous month, excluded
  await sale(scenario.start, "12.20");
  await sale(beforeEnd, "24.40"); // Last millisecond of business month, included
  await sale(scenario.end, "244.00"); // Next month, excluded
  const reference = `POS:PRODAJA:${scenario.month}:E${unit.id}`;
  async function assertDraft(total: number) {
    const drafts = await db.select().from(posBookingDraftsTable).where(and(
      eq(posBookingDraftsTable.companyId, companyId), eq(posBookingDraftsTable.reference, reference),
    ));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.entryDate).toBe(scenario.endDate);
    const lines = await db.select().from(posBookingDraftLinesTable)
      .where(eq(posBookingDraftLinesTable.entryId, drafts[0]!.id));
    expect(lines.filter(line => line.accountId === accounts[0]!.id && line.side === "debit")
      .reduce((sum, line) => sum + Number(line.amount), 0)).toBeCloseTo(total, 2);
    expect(lines.reduce((sum, line) => sum + (line.side === "debit" ? 1 : -1) * Number(line.amount), 0))
      .toBeCloseTo(0, 2);
  }
  // The month is not complete until this unit's business boundary.
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date(beforeEnd));
    const early = await syncPosBookingForMonth(companyId, scenario.month);
    expect(early.created).toEqual([]);
    expect(early.skipped[0]?.reason).toContain("zaključenem celotnem mesecu");
    vi.setSystemTime(new Date(scenario.end));
    expect((await syncPosBookingForMonth(companyId, scenario.month)).created).toContain(reference);
  } finally {
    vi.useRealTimers();
  }
  await assertDraft(36.60);
  await sale(scenario.middle, "12.20");
  await syncPosBookingForMonth(companyId, scenario.month);
  await assertDraft(48.80);
  const consumption = await db.select().from(posBookingDraftsTable).where(and(
    eq(posBookingDraftsTable.companyId, companyId),
    eq(posBookingDraftsTable.reference, `POS:PORABA:${scenario.month}:E${unit.id}`),
  ));
  expect(consumption).toHaveLength(1);
  const consumptionLines = await db.select().from(posBookingDraftLinesTable)
    .where(eq(posBookingDraftLinesTable.entryId, consumption[0]!.id));
  expect(consumptionLines).toEqual(expect.arrayContaining([
    expect.objectContaining({ accountId: accounts[3]!.id, side: "debit", amount: "30.00" }),
    expect.objectContaining({ accountId: accounts[4]!.id, side: "credit", amount: "30.00" }),
  ]));
  const ledger = await db.select({ count: sql<number>`count(*)::int` }).from(journalEntriesTable)
    .where(eq(journalEntriesTable.companyId, companyId));
  expect(ledger[0]!.count).toBe(0);
});

it("letna otvoritev artiklov nastopi po novoletni porabi, zamrznjene porcije pa šele po zaključku stare evidence", async () => {
  const [company] = await db.insert(companiesTable).values({
    naziv: "Izoliran letni preizkus", podjetjeDavcna: `TEST-MONTH-${crypto.randomUUID()}`,
  }).returning();
  const [unit] = await db.insert(enoteTable).values({
    companyId: company.id, ime: "Letni test", zacetekDnevaUra: "04:00",
  }).returning();
  const [material] = await db.insert(artikliTable).values({
    enotaId: unit.id, ime: "Material", cena: "2", vrstaArtikla: "material", nabavniArtikel: true,
  }).returning();
  const openingAt = await openingStockEffectiveAt(unit.id, 2026, new Date("2026-01-01T00:00:00Z"));
  expect(openingAt.toISOString()).toBe("2026-01-01T03:00:00.000Z");
  expect(await openingStockEffectiveAt(unit.id, 2026, new Date("2026-02-01T00:00:00Z")))
    .toEqual(new Date("2026-02-01T00:00:00Z"));
  await db.insert(zalogaGibiTable).values([
    { tip: "prejem" as const, kolicina: "10", vrednost: "20", effectiveAtSnapshot: new Date("2025-12-31T18:00:00Z") },
    { tip: "poraba" as const, kolicina: "-2", vrednost: "-4", effectiveAtSnapshot: new Date("2026-01-01T02:59:59Z") },
    { tip: "inventura" as const, kolicina: "8", vrednost: "16", effectiveAtSnapshot: openingAt, opomba: "Začetne zaloge 2026" },
    { tip: "poraba" as const, kolicina: "-1", vrednost: "-2", effectiveAtSnapshot: new Date("2026-01-01T03:00:01Z") },
  ].map(value => ({ ...value, artikelId: material.id, cenaKos: "2", sourceSnapshot: "isolated_annual_test" })));
  expect((await getZalogeObDatumu([material.id], new Date(openingAt.getTime() - 1))).get(material.id)?.kolicina).toBe(8);
  expect((await getZalogeObDatumu([material.id], new Date("2026-01-01T04:00:00Z"))).get(material.id)?.kolicina).toBe(7);

  const [meal] = await db.insert(artikliTable).values({
    enotaId: unit.id, ime: "Zamrznjena jed", cena: "9", mealType: "prepared",
  }).returning();
  const [oldStock] = await db.insert(preparedFoodStocksTable).values({
    enotaId: unit.id, artikelId: meal.id, year: 2025,
    openingQuantity: "10", frozenQuantity: "10", frozenCostPerPortion: "2.50",
  }).returning();
  const [oldDay] = await db.insert(preparedFoodDailyLedgersTable).values({
    enotaId: unit.id, artikelId: meal.id, businessDate: "2025-12-31",
  }).returning();
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { (req as any).enotaId = unit.id; next(); });
  app.use(preparedFoodRouter);
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2026-01-01T02:59:59Z"));
    const tooEarly = await supertest(app).get("/prepared-food/stocks/2026");
    expect(tooEarly.status).toBe(409);
    vi.setSystemTime(openingAt);
    const stillOpen = await supertest(app).get("/prepared-food/stocks/2026");
    expect(stillOpen.status).toBe(409);
    expect(stillOpen.body.error).toContain("zaključite dnevno evidenco");
    expect(await db.select().from(preparedFoodStocksTable).where(and(
      eq(preparedFoodStocksTable.enotaId, unit.id), eq(preparedFoodStocksTable.year, 2026),
    ))).toHaveLength(0);
    // Emulate the old day's completed balance; route must copy only this final state.
    await db.update(preparedFoodStocksTable).set({ frozenQuantity: "8" }).where(eq(preparedFoodStocksTable.id, oldStock.id));
    await db.update(preparedFoodDailyLedgersTable).set({ closedAt: openingAt }).where(eq(preparedFoodDailyLedgersTable.id, oldDay.id));
    const carried = await supertest(app).get("/prepared-food/stocks/2026");
    expect(carried.status).toBe(200);
    expect(carried.body[0]).toMatchObject({ year: 2026, openingQuantity: 8, frozenQuantity: 8, openingCostPerPortion: 2.5 });
    const again = await supertest(app).get("/prepared-food/stocks/2026");
    expect(again.body[0].id).toBe(carried.body[0].id);
  } finally {
    vi.useRealTimers();
  }
});
