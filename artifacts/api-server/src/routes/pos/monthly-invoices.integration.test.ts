import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import request from "supertest";
import { pool } from "@workspace/db";
import { randomUUID } from "node:crypto";
import { writeFileSync } from "node:fs";
import router from "./monthly-invoices";
import { assertReceiptNotMonthlyBilled, monthlyInvoiceFacts, validDate } from "../../lib/posMonthlyInvoice";

const app = express();
const ids: Record<string, any> = {};
const suffix = randomUUID().slice(0, 8);
let role = "admin";
app.use(express.json());
app.use((req, _res, next) => {
  Object.assign(req, { companyId: ids.company, enotaId: req.headers["x-other-unit"] ? ids.otherUnit : ids.unit, vloga: role, clerkUserId: "monthly-invoice-integration" });
  next();
});
app.use(router);
app.get("/unrelated", (_req, res) => res.json({ ok: true }));
app.use((e: Error, _req: any, res: any, _next: any) => res.status(500).json({ error: e.message }));

beforeAll(async () => {
  ids.company = (await pool.query("INSERT INTO companies(podjetje_davcna,naziv,naslov,trr) VALUES($1,$2,$3,$4) RETURNING id",
    [`TEST-MONTHLY-${suffix}`, `Mesečni test ${suffix}`, "Testna ulica 1, 1000 Ljubljana", JSON.stringify([{ iban: "SI56000000000000000", bic: "TESTSIXX" }])])).rows[0].id;
  ids.unit = (await pool.query("INSERT INTO enote(company_id,ime,zacetek_dneva_ura) VALUES($1,$2,'04:00') RETURNING id", [ids.company, "Test malice"])).rows[0].id;
  ids.otherUnit = (await pool.query("INSERT INTO enote(company_id,ime) VALUES($1,$2) RETURNING id", [ids.company, "Druga testna enota"])).rows[0].id;
  ids.partner = (await pool.query("INSERT INTO counterparties(company_id,type,name,address,tax_id,payment_terms_days) VALUES($1,'customer',$2,'Testna 2, 1000 Ljubljana','12345678',15) RETURNING id", [ids.company, "Pogodbena firma"])).rows[0].id;
  ids.article = (await pool.query("INSERT INTO artikli(enota_id,ime,cena,davek) VALUES($1,'Malica',8,9.5) RETURNING id", [ids.unit])).rows[0].id;
  await pool.query("INSERT INTO partner_ceniki(enota_id,kupec_id,artikel_id,cena) VALUES($1,$2,$3,8)", [ids.unit, ids.partner, ids.article]);
  ids.order = (await pool.query("INSERT INTO narocila(enota_id) VALUES($1) RETURNING id", [ids.unit])).rows[0].id;
  ids.receipt = (await pool.query("INSERT INTO racuni(enota_id,narocilo_id,stevilka_racuna,skupaj,ddv,osnova,placilna_nacin,status,kupec_cp_id,datum_cas) VALUES($1,$2,$3,16,1.39,14.61,'negotovinsko','testni',$4,'2020-09-20T10:00:00Z') RETURNING id",
    [ids.unit, ids.order, `TEST-${suffix}`, ids.partner])).rows[0].id;
  await pool.query("INSERT INTO postavke(narocilo_id,ime,kolicina,cena_kos,skupaj,davek,racun_id) VALUES($1,'Čičerikina malica',2,8,16,9.5,$2)", [ids.order, ids.receipt]);
}, 30000);

afterAll(async () => {
  if (!ids.company) return;
  await pool.query("DELETE FROM pos_monthly_invoice_receipts WHERE invoice_id IN(SELECT id FROM pos_monthly_invoices WHERE company_id=$1)", [ids.company]);
  await pool.query("DELETE FROM pos_monthly_invoices WHERE company_id=$1", [ids.company]);
  await pool.query("DELETE FROM postavke WHERE narocilo_id=$1", [ids.order ?? -1]);
  await pool.query("DELETE FROM racuni WHERE enota_id=$1", [ids.unit ?? -1]);
  await pool.query("DELETE FROM narocila WHERE enota_id=$1", [ids.unit ?? -1]);
  await pool.query("DELETE FROM partner_ceniki WHERE kupec_id=$1", [ids.partner ?? null]);
  await pool.query("DELETE FROM artikli WHERE enota_id=$1", [ids.unit ?? -1]);
  await pool.query("DELETE FROM counterparties WHERE company_id=$1", [ids.company]);
  await pool.query("DELETE FROM enote WHERE company_id=$1", [ids.company]);
  await pool.query("DELETE FROM companies WHERE id=$1", [ids.company]);
}, 30000);

describe("POS-only monthly contractual invoice", () => {
  let payload: any;
  let issued: any;
  it("rejects malformed dates, month and partner without a database cast error", async () => {
    expect(validDate("2026-02-31")).toBe(false);
    expect((await request(app).get("/pos-monthly-invoices/preview").query({ month: "invalid", counterpartyId: "bad" })).status).toBe(400);
  });
  it("is scoped to the active unit and does not block unrelated waiter routes", async () => {
    expect((await request(app).get("/pos-monthly-invoices/partners")).body).toHaveLength(1);
    expect((await request(app).get("/pos-monthly-invoices/partners").set("X-Other-Unit", "1")).body).toHaveLength(0);
    role = "natakar";
    expect((await request(app).get("/pos-monthly-invoices")).status).toBe(403);
    expect((await request(app).get("/unrelated")).status).toBe(200);
    role = "admin";
  });
  it("previews historical immutable receipt prices, VAT and contractual terms", async () => {
    const p = await request(app).get("/pos-monthly-invoices/preview").query({ month: "2020-09", counterpartyId: ids.partner });
    expect(p.status).toBe(200);
    expect(p.body).toMatchObject({ receiptCount: 1, totalGross: "16.00", totalNet: "14.61", totalVat: "1.39", paymentTermsDays: 15, isTest: true });
    payload = { month: "2020-09", counterpartyId: ids.partner, invoiceDate: "2020-09-30", dueDate: "2020-10-15", expectedReceiptIds: [ids.receipt], idempotencyKey: randomUUID() };
    await expect(assertReceiptNotMonthlyBilled(ids.receipt)).resolves.toBeUndefined();
  });
  it("blocks invalid dates and stale previews, without claiming receipts", async () => {
    expect((await request(app).post("/pos-monthly-invoices").send({ ...payload, dueDate: "2020-09-01" })).status).toBe(400);
    expect((await request(app).post("/pos-monthly-invoices").send({ ...payload, expectedReceiptIds: [ids.receipt + 99999] })).status).toBe(409);
    const p = await monthlyInvoiceFacts(ids.company, ids.unit, ids.partner, "2020-09");
    expect(p.snapshot.receipts).toHaveLength(1);
  });
  it("issues once on simultaneous replay, with no periods, accounts or journals", async () => {
    const result = await Promise.all([request(app).post("/pos-monthly-invoices").send(payload), request(app).post("/pos-monthly-invoices").send(payload)]);
    expect(result.map(r => r.status)).toEqual([201, 201]);
    expect(result[0].body.id).toBe(result[1].body.id);
    issued = result[0].body;
    expect(issued.invoiceNumber).toBe("M-POS-2020-000001");
    const counts = await pool.query("SELECT (SELECT count(*) FROM accounting_periods WHERE company_id=$1) periods,(SELECT count(*) FROM journal_entries WHERE company_id=$1) journals,(SELECT count(*) FROM pos_monthly_invoices WHERE company_id=$1) invoices", [ids.company]);
    expect(counts.rows[0]).toEqual({ periods: "0", journals: "0", invoices: "1" });
  });
  it("rejects a second issue and changed replay, removes billed receipts from eligibility", async () => {
    expect((await request(app).post("/pos-monthly-invoices").send({ ...payload, idempotencyKey: randomUUID() })).status).toBe(409);
    expect((await request(app).post("/pos-monthly-invoices").send({ ...payload, dueDate: "2020-10-16" })).status).toBe(409);
    const p = await request(app).get("/pos-monthly-invoices/preview").query({ month: "2020-09", counterpartyId: ids.partner });
    expect(p.body.receiptCount).toBe(0);
    expect((await request(app).get("/pos-monthly-invoices")).body).toHaveLength(1);
    await expect(assertReceiptNotMonthlyBilled(ids.receipt)).rejects.toMatchObject({ status: 409 });
  });
  it("downloads the stored snapshot PDF, even after partner details change; denies another unit", async () => {
    await pool.query("UPDATE counterparties SET name='Spremenjen naziv' WHERE id=$1", [ids.partner]);
    const pdf = await request(app).get(`/pos-monthly-invoices/${issued.id}/pdf`);
    expect(pdf.status).toBe(200);
    expect(pdf.headers["content-type"]).toMatch(/application\/pdf/);
    expect(Buffer.isBuffer(pdf.body)).toBe(true);
    expect(pdf.body.subarray(0, 5).toString()).toBe("%PDF-");
    writeFileSync("/tmp/pos-monthly-test.pdf", pdf.body);
    expect((await request(app).get(`/pos-monthly-invoices/${issued.id}/pdf`).set("X-Other-Unit", "1")).status).toBe(404);
    expect((await request(app).get("/pos-monthly-invoices")).body[0].counterpartyName).toBe("Pogodbena firma");
  });
});