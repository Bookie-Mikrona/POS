import { afterAll, describe, expect, it, vi } from "vitest";

const isolation = vi.hoisted(() => ({ tx: null as any }));
vi.mock("@workspace/db", async importOriginal => {
  const actual = await importOriginal<typeof import("@workspace/db")>();
  return { ...actual, db: new Proxy(actual.db, {
    get(target, key) {
      const executor = isolation.tx ?? target;
      const value = executor[key];
      return typeof value === "function" ? value.bind(executor) : value;
    },
  }) };
});
vi.mock("../middlewares/requireAuth", () => ({
  requireAuth: (req: any, _res: any, next: any) => {
    req.clerkUserId = "TEST-pos-sales-vat";
    next();
  },
}));

import express from "express";
import request from "supertest";
import { randomUUID } from "node:crypto";
import Decimal from "decimal.js";
import { and, eq } from "drizzle-orm";
import {
  db, pool, companiesTable, accountingRolesTable, accountingPeriodsTable,
  accountsTable, enoteTable, narocilaTable, racuniTable, postavkeTable,
  posBookingSettingsTable, journalEntriesTable, journalEntryLinesTable,
  vatLedgerTable, vatCodeTable, counterpartiesTable,
} from "@workspace/db";
import journalRouter from "../routes/journalEntries";
import { syncPosBookingForDay, syncPosBookingForMonth } from "./posSyncBooking";
import { loadPosSalesVatCodes, posRevenueVat } from "./posSalesVat";

const app = express();
app.use(express.json());
app.use(journalRouter);
app.use((error: any, _req: any, res: any, _next: any) => res.status(500).json({ error: error.message }));
const DATE = "2026-08-19";
afterAll(() => pool.end());

async function isolated(run: (companyId: string, periodId: string) => Promise<void>) {
  const rollback = new Error("rollback POS sales VAT fixtures");
  let companyId = "";
  try {
    await db.transaction(async tx => {
      isolation.tx = tx;
      const [company] = await db.insert(companiesTable).values({
        podjetjeDavcna: `TEST_POS_VAT_${randomUUID()}`, naziv: "TEST Gostilna Križišče — DDV",
      }).returning();
      companyId = company.id;
      const [period] = await db.insert(accountingPeriodsTable).values({
        companyId, name: "2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
      }).returning();
      await db.insert(accountingRolesTable).values({
        companyId, clerkUserId: "TEST-pos-sales-vat", role: "accountant",
      });
      await run(companyId, period.id);
      throw rollback;
    });
  } catch (error) {
    if (error !== rollback) throw error;
  } finally {
    isolation.tx = null;
  }
  expect(await db.select().from(companiesTable).where(eq(companiesTable.id, companyId))).toHaveLength(0);
}

async function fixture(companyId: string, revenueCode: string, monthly = false) {
  const [cash, revenue, vat, expense, ar] = await db.insert(accountsTable).values([
    { companyId, code: "1000", name: "Gotovina", type: "asset" },
    { companyId, code: revenueCode, name: "Prihodki", type: "revenue" },
    { companyId, code: "2600", name: "DDV", type: "liability" },
    { companyId, code: "4890", name: "Lastna poraba", type: "expense" },
    { companyId, code: "1200", name: "Terjatve", type: "asset" },
  ]).returning();
  const [unit] = await db.insert(enoteTable).values({ companyId, ime: "TEST Križišče" }).returning();
  await db.insert(posBookingSettingsTable).values({
    companyId, cashAccountId: cash.id, revenueAccountId: revenue.id,
    vat22AccountId: vat.id, vat95AccountId: vat.id, vat5AccountId: vat.id,
    lastnaPorabaAccountId: expense.id, reprezentancaAccountId: expense.id,
    kirArAccountId: ar.id, salesBookingFrequency: monthly ? "monthly" : "daily",
    // Deliberately no vat*VatCodeId configuration: mapping is automatic.
  });
  return { cash, revenue, vat, ar, unit };
}

async function receipt(unitId: number, rate: number, opts: {
  negative?: boolean; own?: boolean; repr?: boolean; customer?: string; paidBusiness?: boolean;
} = {}) {
  const sign = opts.negative ? -1 : 1;
  const net = new Decimal(100).times(sign);
  const vat = net.times(rate).div(100);
  const gross = net.plus(vat);
  const internal = opts.own || opts.repr;
  const payment = opts.own ? "lastna_poraba" : opts.repr ? "reprezentanca"
    : opts.customer && !opts.paidBusiness ? "negotovinsko" : "gotovina";
  const [order] = await db.insert(narocilaTable).values({
    enotaId: unitId, status: "zakljuceno", skupaj: internal ? "0.00" : gross.toFixed(2),
  }).returning();
  const [row] = await db.insert(racuniTable).values({
    enotaId: unitId, narociloId: order.id, stevilkaRacuna: `TEST-${randomUUID()}`,
    datumCas: new Date(`${DATE}T10:00:00+02:00`), status: "poslan",
    placilnaNacin: payment, skupaj: internal ? "0.00" : gross.toFixed(2),
    osnova: net.toFixed(2), ddv: vat.toFixed(2),
    znesekGotovina: payment === "gotovina" ? gross.toFixed(2) : "0.00",
    znesekNegotovinsko: payment === "negotovinsko" ? gross.toFixed(2) : "0.00",
    kupecCpId: opts.customer ?? null,
    kupecNaziv: opts.customer ? "TEST Kupec" : null,
    kupecDavcnaStevilka: opts.customer ? "12345678" : null,
    jeStorno: opts.negative ?? false,
  }).returning();
  await db.insert(postavkeTable).values({
    narociloId: order.id, racunId: row.id, ime: "TEST Prodaja", kolicina: sign,
    cenaKos: gross.abs().toFixed(2), skupaj: gross.toFixed(2),
    davek: rate.toFixed(2), vrstaArtikla: "storitev",
  });
}

async function vatRows(entryId: string) {
  return db.select({
    direction: vatLedgerTable.direction, base: vatLedgerTable.baseAmount,
    vat: vatLedgerTable.vatAmount, code: vatCodeTable.code,
  }).from(vatLedgerTable).innerJoin(vatCodeTable, eq(vatCodeTable.id, vatLedgerTable.vatCodeId))
    .where(eq(vatLedgerTable.journalEntryId, entryId));
}

describe("POS → ERP automatic sales VAT", () => {
  it.each(["8000", "8002", "8003", "8004"])("Križišče dnevni iztržek na %s: net bases, mixed rates, no duplication", async code => {
    await isolated(async companyId => {
      const { revenue, vat, unit } = await fixture(companyId, code);
      for (const rate of [22, 9.5, 5, 0]) await receipt(unit.id, rate);
      const result = await syncPosBookingForDay(companyId, DATE);
      expect(result.skipped).toEqual([]);
      const [entry] = await db.select().from(journalEntriesTable).where(and(
        eq(journalEntriesTable.companyId, companyId),
        eq(journalEntriesTable.reference, `POS:PRODAJA:${DATE}:E${unit.id}`),
      ));
      expect(entry).toBeTruthy();
      const lines = await db.select().from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, entry.id));
      expect(lines.filter(l => l.accountId === revenue.id)).toHaveLength(4);
      expect(lines.filter(l => l.accountId === vat.id).every(l => l.vatCodeId == null)).toBe(true);
      expect(await vatRows(entry.id)).toEqual([]);
      const response = await request(app).post(`/companies/${companyId}/entries/${entry.id}/post`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(await vatRows(entry.id)).toEqual(expect.arrayContaining([
        { direction: "OUT", base: "100.00", vat: "22.00", code: "S22" },
        { direction: "OUT", base: "100.00", vat: "9.50", code: "S95" },
        { direction: "OUT", base: "100.00", vat: "5.00", code: "S5" },
      ]));
      expect(await vatRows(entry.id)).toHaveLength(3);
      expect((await request(app).post(`/companies/${companyId}/entries/${entry.id}/post`)).status).toBe(400);
      await syncPosBookingForDay(companyId, DATE);
      expect(await vatRows(entry.id)).toHaveLength(3);
    });
  });

  it.each(["own", "repr", "refund", "monthly", "monthlyOwn", "paidBusiness", "receivable"] as const)(
    "preserves net base and tax for %s", async kind => {
      await isolated(async companyId => {
        const monthly = kind === "monthly" || kind === "monthlyOwn";
        const { unit } = await fixture(companyId, "8000", monthly);
        let customer: string | undefined;
        if (kind === "receivable" || kind === "paidBusiness") {
          const [partner] = await db.insert(counterpartiesTable).values({
            companyId, type: "customer", name: "TEST Kupec", taxId: "12345678",
          }).returning();
          customer = partner.id;
        }
        for (const rate of [22, 9.5]) await receipt(unit.id, rate, {
          own: kind === "own" || kind === "monthlyOwn", repr: kind === "repr", negative: kind === "refund",
          customer, paidBusiness: kind === "paidBusiness",
        });
        await syncPosBookingForDay(companyId, DATE);
        if (monthly) await syncPosBookingForMonth(companyId, DATE.slice(0, 7));
        const entries = await db.select().from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
        expect(entries.length).toBeGreaterThan(0);
        for (const entry of entries) {
          if (entry.status === "draft") {
            const response = await request(app).post(`/companies/${companyId}/entries/${entry.id}/post`);
            expect(response.status, JSON.stringify(response.body)).toBe(200);
          }
        }
        const rows = (await Promise.all(entries.map(entry => vatRows(entry.id)))).flat();
        const sign = kind === "refund" ? "-" : "";
        expect(rows).toHaveLength(2);
        expect(rows).toEqual(expect.arrayContaining([
          { direction: "OUT", base: `${sign}100.00`, vat: `${sign}22.00`, code: "S22" },
          { direction: "OUT", base: `${sign}100.00`, vat: `${sign}9.50`, code: "S95" },
        ]));
      });
    },
  );

  it("calculates VAT from net, preserves issued cents, and fails explicitly without a code", async () => {
    const codes = new Map([["22.00", "S22-ID"], ["9.50", "S95-ID"]]);
    expect(posRevenueVat(codes, new Decimal(22), new Decimal(100))).toEqual({ vatCodeId: "S22-ID", vatAmount: "22.00" });
    expect(posRevenueVat(codes, new Decimal(9.5), new Decimal(100))).toEqual({ vatCodeId: "S95-ID", vatAmount: "9.50" });
    expect(posRevenueVat(codes, new Decimal(22), new Decimal("8.19"), new Decimal("1.81")).vatAmount).toBe("1.81");
    expect(() => posRevenueVat(new Map(), new Decimal(22), new Decimal(100))).toThrow("FURS DDV");
    expect(posRevenueVat(new Map(), new Decimal(0), new Decimal(100))).toEqual({});
    expect(await loadPosSalesVatCodes("1900-01-01")).toEqual(new Map());
  });

  it("selects the document-date code version and rejects overlapping versions", async () => {
    await isolated(async () => {
      const [first, second] = await db.insert(vatCodeTable).values([
        {
          code: "S22", description: "TEST historical version", direction: "OUT", rate: "22.00",
          validFrom: "1800-01-01", validTo: "1809-12-31",
        },
        {
          code: "S22", description: "TEST next version", direction: "OUT", rate: "22.00",
          validFrom: "1810-01-01", validTo: "1819-12-31",
        },
      ]).returning();
      expect((await loadPosSalesVatCodes("1800-01-01")).get("22.00")).toBe(first.id);
      expect((await loadPosSalesVatCodes("1809-12-31")).get("22.00")).toBe(first.id);
      expect((await loadPosSalesVatCodes("1810-01-01")).get("22.00")).toBe(second.id);
      expect(await loadPosSalesVatCodes("1820-01-01")).toEqual(new Map());
      await db.insert(vatCodeTable).values({
        code: "S22", description: "TEST ambiguous version", direction: "OUT", rate: "22.00",
        validFrom: "1805-01-01", validTo: "1807-12-31",
      });
      await expect(loadPosSalesVatCodes("1806-01-01")).rejects.toThrow("Več veljavnih");
    });
  });
});
