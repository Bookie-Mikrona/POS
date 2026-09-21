import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

const USER = "packaging-writeoff-test";
let companyId: string;
let enotaId: number;
let supplierId: string;
let articleId: number;
let expenseAccountId: string;
let packagingAccountId: string;

vi.mock("../../middlewares/pos", () => ({
  requireEnota: (req: any, _res: any, next: any) => {
    req.enotaId = enotaId;
    req.clerkUserId = USER;
    next();
  },
}));
vi.mock("@clerk/express", () => ({ getAuth: () => ({ userId: USER }) }));

import express from "express";
import request from "supertest";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  accountsTable, accountingPeriodsTable, artikliTable, companiesTable, counterpartiesTable,
  db, embalazniPrometiTable, enoteTable, journalEntriesTable, journalEntryLinesTable,
  posBookingSettingsTable, zalogaGibiTable, zalogeTable,
} from "@workspace/db";
import embalazaRouter from "./embalaza";

const app = express();
app.use(express.json());
app.use(embalazaRouter);
app.use((error: Error, _req: any, res: any, _next: any) => res.status(500).json({ error: error.message }));

describe("returnable packaging write-off route", () => {
  beforeAll(async () => {
    // Keep this focused route suite runnable in isolation as well as through
    // the normal migration bootstrap.
    await db.execute(sql.raw("ALTER TABLE pos_booking_settings ADD COLUMN IF NOT EXISTS returnable_packaging_writeoff_account_id uuid"));
    await db.execute(sql.raw("ALTER TABLE embalazni_prometi ADD COLUMN IF NOT EXISTS odpis_razlog text"));
    await db.execute(sql.raw("ALTER TABLE embalazni_prometi DROP CONSTRAINT IF EXISTS embalazni_prometi_vrsta_check"));
    await db.execute(sql.raw("ALTER TABLE embalazni_prometi DROP CONSTRAINT IF EXISTS embalazni_prometi_odpis_razlog_check"));
    await db.execute(sql.raw("ALTER TABLE embalazni_prometi ADD CONSTRAINT embalazni_prometi_vrsta_check CHECK (vrsta IN ('prejem','vracilo','odpis') AND ((vrsta = 'odpis' AND odpis_razlog IN ('razbitje','uniceno','nevracljivo')) OR (vrsta <> 'odpis' AND odpis_razlog IS NULL)))"));
    await db.execute(sql.raw("ALTER TABLE embalazni_prometi ADD CONSTRAINT embalazni_prometi_odpis_razlog_check CHECK (odpis_razlog IS NULL OR odpis_razlog IN ('razbitje','uniceno','nevracljivo'))"));
    const [company] = await db.insert(companiesTable).values({ naziv: `Writeoff ${Date.now()}`, podjetjeDavcna: `SI${Date.now()}` }).returning({ id: companiesTable.id });
    companyId = company.id;
    const [unit] = await db.insert(enoteTable).values({ companyId, ime: "Writeoff unit" }).returning({ id: enoteTable.id });
    enotaId = unit.id;
    const [supplier] = await db.insert(counterpartiesTable).values({ companyId, type: "supplier", name: "Writeoff supplier" }).returning({ id: counterpartiesTable.id });
    supplierId = supplier.id;
    const [article] = await db.insert(artikliTable).values({
      enotaId, ime: "Keg", cena: "1", depozitnaVrednost: "5",
      povratnaEmbalaza: true, prodajniArtikel: false, nabavniArtikel: true,
    }).returning({ id: artikliTable.id });
    articleId = article.id;
    const [packaging] = await db.insert(accountsTable).values({
      companyId, code: "3107000", name: "Returnable packaging", type: "asset",
    }).returning({ id: accountsTable.id });
    const [expense] = await db.insert(accountsTable).values({
      companyId, code: "4802000", name: "Packaging write-off", type: "expense",
    }).returning({ id: accountsTable.id });
    packagingAccountId = packaging.id;
    expenseAccountId = expense.id;
    await db.insert(posBookingSettingsTable).values({
      companyId, returnablePackagingAccountId: packagingAccountId,
      returnablePackagingWriteoffAccountId: expenseAccountId,
    });
    await db.insert(accountingPeriodsTable).values({
      companyId, name: "2026", startDate: "2026-01-01", endDate: "2026-12-31", status: "open",
    });
    await db.insert(embalazniPrometiTable).values({
      enotaId, artikelId: articleId, dobaviteljId: supplierId, kolicina: "10",
      depozitnaVrednost: "5", vrsta: "prejem", operationKey: crypto.randomUUID(),
    });
    await db.insert(zalogeTable).values({ artikelId: articleId, kolicina: "10", povprecnaCena: "5", skupnaVrednost: "50" });
  });

  afterAll(async () => {
    await db.delete(journalEntryLinesTable).where(inArray(journalEntryLinesTable.entryId,
      db.select({ id: journalEntriesTable.id }).from(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId))));
    await db.update(embalazniPrometiTable).set({ journalEntryId: null }).where(eq(embalazniPrometiTable.enotaId, enotaId));
    await db.delete(journalEntriesTable).where(eq(journalEntriesTable.companyId, companyId));
    await db.delete(posBookingSettingsTable).where(eq(posBookingSettingsTable.companyId, companyId));
    await db.delete(embalazniPrometiTable).where(eq(embalazniPrometiTable.enotaId, enotaId));
    await db.execute(sql.raw("ALTER TABLE zaloga_gibi DISABLE TRIGGER zaloga_gibi_history_append_only"));
    try { await db.delete(zalogaGibiTable).where(eq(zalogaGibiTable.artikelId, articleId)); }
    finally { await db.execute(sql.raw("ALTER TABLE zaloga_gibi ENABLE TRIGGER zaloga_gibi_history_append_only")); }
    await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  });

  it("replays the same key and rejects a changed payload", async () => {
    const payload = { artikelId: articleId, dobaviteljId: supplierId, kolicina: 1, razlog: "razbitje", operationKey: crypto.randomUUID() };
    const first = await request(app).post("/embalaza/odpis").send(payload);
    if (first.status !== 201) throw new Error(`writeoff setup failed: ${JSON.stringify(first.body)}`);
    const replay = await request(app).post("/embalaza/odpis").send(payload);
    if (replay.status !== 201) throw new Error(`replay failed: ${JSON.stringify(replay.body)}`);
    const mismatch = await request(app).post("/embalaza/odpis").send({ ...payload, kolicina: 2 });
    expect(first.status).toBe(201);
    expect(replay.status).toBe(201);
    expect(replay.body.id).toBe(first.body.id);
    expect(mismatch.status).toBe(409);
  });

  it("rejects supplier and physical overdraw", async () => {
    const supplierOverdraw = await request(app).post("/embalaza/odpis").send({
      artikelId: articleId, dobaviteljId: supplierId, kolicina: 100, razlog: "uniceno", operationKey: crypto.randomUUID(),
    });
    expect(supplierOverdraw.status).toBe(409);
    await db.update(zalogeTable).set({ kolicina: "0" }).where(eq(zalogeTable.artikelId, articleId));
    const physicalOverdraw = await request(app).post("/embalaza/odpis").send({
      artikelId: articleId, dobaviteljId: supplierId, kolicina: 1, razlog: "uniceno", operationKey: crypto.randomUUID(),
    });
    expect(physicalOverdraw.status).toBe(409);
    await db.update(zalogeTable).set({ kolicina: "8" }).where(eq(zalogeTable.artikelId, articleId));
  });

  it("creates negative movements and only expense/3107000 lines", async () => {
    const response = await request(app).post("/embalaza/odpis").send({
      artikelId: articleId, dobaviteljId: supplierId, kolicina: 1, razlog: "nevracljivo", operationKey: crypto.randomUUID(),
    });
    expect(response.status).toBe(201);
    expect(response.body.journalEntryId).toBeTruthy();
    const [movement] = await db.select().from(embalazniPrometiTable).where(eq(embalazniPrometiTable.id, response.body.id));
    expect(Number(movement.kolicina)).toBe(-1);
    const lines = await db.select().from(journalEntryLinesTable).where(eq(journalEntryLinesTable.entryId, response.body.journalEntryId));
    expect(lines).toHaveLength(2);
    expect(lines.map(line => [line.accountId, line.side])).toEqual(expect.arrayContaining([
      [expenseAccountId, "debit"], [packagingAccountId, "credit"],
    ]));
    expect(lines.some(line => line.accountId.startsWith("220"))).toBe(false);
  });

  it("allows historical zero-value write-off without a journal", async () => {
    await db.update(artikliTable).set({ depozitnaVrednost: "0" }).where(eq(artikliTable.id, articleId));
    await db.update(zalogeTable).set({ kolicina: "8" }).where(eq(zalogeTable.artikelId, articleId));
    const response = await request(app).post("/embalaza/odpis").send({
      artikelId: articleId, dobaviteljId: supplierId, kolicina: 1, razlog: "razbitje", operationKey: crypto.randomUUID(),
    });
    expect(response.status).toBe(201);
    expect(response.body.journalEntryId).toBeNull();
  });

  it("allows historical zero-value supplier return without a journal", async () => {
    await db.update(artikliTable).set({ depozitnaVrednost: "0" }).where(eq(artikliTable.id, articleId));
    const response = await request(app).post("/embalaza/vracilo").send({
      artikelId: articleId,
      dobaviteljId: supplierId,
      kolicina: 1,
      operationKey: crypto.randomUUID(),
    });
    expect(response.status).toBe(201);
    expect(response.body.journalEntryId).toBeNull();
    const [movement] = await db.select({
      vrsta: embalazniPrometiTable.vrsta,
      kolicina: embalazniPrometiTable.kolicina,
    }).from(embalazniPrometiTable).where(eq(embalazniPrometiTable.id, response.body.id));
    expect(movement.vrsta).toBe("vracilo");
    expect(Number(movement.kolicina)).toBe(-1);
  });

  it("serializes concurrent requests and permits only one overdraw", async () => {
    await db.update(artikliTable).set({ depozitnaVrednost: "5" }).where(eq(artikliTable.id, articleId));
    await db.update(zalogeTable).set({ kolicina: "8" }).where(eq(zalogeTable.artikelId, articleId));
    const [a, b] = await Promise.all([1, 2].map(() => request(app).post("/embalaza/odpis").send({
      artikelId: articleId, dobaviteljId: supplierId, kolicina: 5, razlog: "razbitje", operationKey: crypto.randomUUID(),
    })));
    expect([a.status, b.status].sort()).toEqual([201, 409]);
  });
});