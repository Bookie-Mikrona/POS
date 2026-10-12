import { afterAll, beforeAll, expect, it, vi } from "vitest";
import { drizzle } from "drizzle-orm/node-postgres";

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
} from "@workspace/db";
import { syncPosBookingForMonth } from "./posSyncBooking";

let client: PoolClient | undefined;
beforeAll(async () => {
  client = await pool.connect();
  await client.query("BEGIN");
  state.db = drizzle(client);
});
afterAll(async () => {
  vi.useRealTimers();
  if (client) {
    try { await client.query("ROLLBACK"); } finally { client.release(); }
  }
  state.db = null;
  await pool.end();
});

it("mesečni POS osnutek upošteva meje enote in se osveži brez podvajanja ali GK", async () => {
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
    companyId, ime: "Testna enota", zacetekDnevaUra: "06:00",
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
    { ustvarjeno: new Date("2026-07-01T03:59:59Z"), vrednost: "-100" },
    { ustvarjeno: new Date("2026-07-01T04:00:00Z"), vrednost: "-10" },
    { ustvarjeno: new Date("2026-08-01T03:59:59Z"), vrednost: "-20" },
    { ustvarjeno: new Date("2026-08-01T04:00:00Z"), vrednost: "-200" },
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
  // July begins at 06:00 local (04:00 UTC), ends August 1 at the same time.
  await sale("2026-07-01T03:59:59Z", "122.00"); // June, excluded
  await sale("2026-07-01T04:00:00Z", "12.20");
  await sale("2026-08-01T03:59:59Z", "24.40"); // July, included
  await sale("2026-08-01T04:00:00Z", "244.00"); // August, excluded
  const reference = `POS:PRODAJA:2026-07:E${unit.id}`;
  async function assertDraft(total: number) {
    const drafts = await db.select().from(posBookingDraftsTable).where(and(
      eq(posBookingDraftsTable.companyId, companyId), eq(posBookingDraftsTable.reference, reference),
    ));
    expect(drafts).toHaveLength(1);
    expect(drafts[0]!.entryDate).toBe("2026-07-31");
    const lines = await db.select().from(posBookingDraftLinesTable)
      .where(eq(posBookingDraftLinesTable.entryId, drafts[0]!.id));
    expect(lines.filter(line => line.accountId === accounts[0]!.id && line.side === "debit")
      .reduce((sum, line) => sum + Number(line.amount), 0)).toBeCloseTo(total, 2);
    expect(lines.reduce((sum, line) => sum + (line.side === "debit" ? 1 : -1) * Number(line.amount), 0))
      .toBeCloseTo(0, 2);
  }
  // At 05:00 local, the unit still belongs to July; 06:00 closes July.
  vi.useFakeTimers({ toFake: ["Date"] });
  try {
    vi.setSystemTime(new Date("2026-08-01T03:00:00Z"));
    const early = await syncPosBookingForMonth(companyId, "2026-07");
    expect(early.created).toEqual([]);
    expect(early.skipped[0]?.reason).toContain("zaključenem celotnem mesecu");
    vi.setSystemTime(new Date("2026-08-01T04:00:00Z"));
    expect((await syncPosBookingForMonth(companyId, "2026-07")).created).toContain(reference);
  } finally {
    vi.useRealTimers();
  }
  await assertDraft(36.60);
  await sale("2026-07-15T12:00:00Z", "12.20");
  await syncPosBookingForMonth(companyId, "2026-07");
  await assertDraft(48.80);
  const consumption = await db.select().from(posBookingDraftsTable).where(and(
    eq(posBookingDraftsTable.companyId, companyId),
    eq(posBookingDraftsTable.reference, `POS:PORABA:2026-07:E${unit.id}`),
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
