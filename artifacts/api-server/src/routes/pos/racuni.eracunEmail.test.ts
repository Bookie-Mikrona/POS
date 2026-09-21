/**
 * Integracijski testi za POST /racuni/:id/eracun/poslji-email
 * e-poštni kanal za e-SLOG račune.
 *
 * Mockano : posljiEslogEmail (pos-email.ts), generatePosInvoicePdf (puppeteer)
 * Realno  : PostgreSQL (dev baza) — racuni, counterparties, enote, companies
 *
 * Pokriti scenariji:
 *  SCE-1  brez eRacunXml → 422
 *  SCE-2  brez kupecCpId → 422
 *  SCE-3  kupec brez e_racun_email → 422 z besedilom "Dodajte ga v Partnerji"
 *  SCE-4  USPEH: 200, DB status=poslano_email, poslanoDne, odgovor OK
 *         - pravilna e-pošta + XML in PDF argumenta na posljiEslogEmail
 *  SCE-5  SMTP napaka (posljiEslogEmail vrne uspeh:false) → 500,
 *         eRacunEmailOdgovor=NAPAKA, status NE postane poslano_email
 *  SCE-6  eRacunPdf shranjen → generatePosInvoicePdf se NE pokliče
 *  SCE-7  brez eRacunPdf → generatePosInvoicePdf se pokliče (on-the-fly)
 */

import { afterAll, beforeAll, beforeEach, describe, it, expect, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  companiesTable,
  enoteTable,
  counterpartiesTable,
  narocilaTable,
  racuniTable,
  postavkeTable,
} from "@workspace/db";
import racuniRouter from "./racuni";

// ── vi.hoisted: dostopno v vi.mock factory ────────────────────────────────────
const { mockPosljiEslogEmail, mockGeneratePdf } = vi.hoisted(() => ({
  mockPosljiEslogEmail: vi.fn().mockResolvedValue({ uspeh: true }),
  mockGeneratePdf: vi.fn().mockResolvedValue(Buffer.from("FAKE-PDF-CONTENT")),
}));

// ── Mocki ─────────────────────────────────────────────────────────────────────

// pos-email: zamenjamo posljiEslogEmail — ni pravih SMTP klicev
// Opomba: NE uporabljamo importOriginal — ta kliče pravi modul med init
// in povzroči nestabilnost pri tranzitivnih uvozu. Naštejemo vse izvoze ročno.
vi.mock("../../lib/pos-email", () => ({
  posljiEmailZacasnoGeslo: vi.fn(),
  posljiEmailRacun: vi.fn(),
  posljiEslogEmail: mockPosljiEslogEmail,
  posljiTestnoEmail: vi.fn(),
}));

// generatePosInvoicePdf: puppeteer ni dosegljiv v testnem okolju
vi.mock("../../lib/external-export-pdf", () => ({
  generatePosInvoicePdf: mockGeneratePdf,
}));

// nastavitve: vrni veljavno konfiguracijo brez dostopa do DB
vi.mock("./nastavitve", () => ({
  readAll: vi.fn(async () => ({ smtpPassword: "test-smtp-geslo" })),
  readAllWithFallback: vi.fn(async () => ({})),
  toResponse: vi.fn(() => ({
    smtpAktiven: true,
    smtpHost: "smtp.test.local",
    smtpUser: "pos@test.local",
    smtpFrom: "noreply@test.local",
    smtpPort: 587,
    nazivRestavracije: "Test Restavracija d.o.o.",
    davcnaStevilka: null,
  })),
}));

// ── Test identifikatorji ──────────────────────────────────────────────────────
const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();

let companyId: string;
let enotaId: number;
let kupecZEmailId: string;    // counterparty z nastavljenim e_racun_email
let kupecBrezEmailId: string; // counterparty brez e_racun_email

const ustvarjeniRacuniIds: number[] = [];
const ustvarjenaNarocilaIds: number[] = [];

const FAKE_XML = `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>TEST-${RUN_ID}</ID></Invoice>`;
const FAKE_PDF_B64 = Buffer.from("SHRANJENI-PDF-VSEBINA").toString("base64");

// ── Express app s simuliranim POS middleware ──────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).enotaId = enotaId;
    (req as any).companyId = companyId;
    (req as any).log = { info: () => {}, warn: () => {}, debug: () => {}, error: () => {} };
    next();
  });
  app.use(racuniRouter);
  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    res.status(500).json({ error: err.message });
  });
  return app;
}

// ── Pomožna: vstavi testni račun neposredno v DB ──────────────────────────────
async function insertRacun(opts: {
  eRacunXml?: string | null;
  eRacunPdf?: string | null;
  eRacunStatus?: "pripravljen" | "poslano" | "poslano_email" | "napaka" | null;
  kupecCpId?: string | null;
  kupecNaziv?: string | null;
}): Promise<number> {
  // narocilo_id je NOT NULL brez default → vedno ustvari narocilo najprej
  const [narocilo] = await db.insert(narocilaTable).values({ enotaId })
    .returning({ id: narocilaTable.id });
  ustvarjenaNarocilaIds.push(narocilo!.id);

  const stevilka = `TST-EM-${RUN_ID}-${String(ustvarjeniRacuniIds.length + 1).padStart(3, "0")}`;
  const [r] = await db.insert(racuniTable).values({
    enotaId,
    narociloId: narocilo!.id,
    stevilkaRacuna: stevilka,
    skupaj: "121.00",
    ddv: "21.00",
    placilnaNacin: "negotovinsko",
    status: "poslan",
    eRacunXml: opts.eRacunXml ?? null,
    eRacunPdf: opts.eRacunPdf ?? null,
    eRacunStatus: opts.eRacunStatus ?? null,
    kupecCpId: opts.kupecCpId ?? null,
    kupecNaziv: opts.kupecNaziv ?? "Test Kupec d.o.o.",
  }).returning({ id: racuniTable.id });
  ustvarjeniRacuniIds.push(r!.id);
  return r!.id;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────
beforeAll(async () => {
  const [c] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_TST_ERACUNEM_${RUN_ID}`,
    naziv: `Test eRacun Email ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = c!.id;

  const [e] = await db.insert(enoteTable).values({
    companyId,
    ime: `Enota eRacunEmail ${RUN_ID}`,
  }).returning({ id: enoteTable.id });
  enotaId = e!.id;

  const [kpz] = await db.insert(counterpartiesTable).values({
    companyId,
    name: `Kupec z emailom ${RUN_ID}`,
    type: "customer",
    eRacunPrejemnik: true,
    eRacunEmail: "kupec@primer.si",
    vatPayer: false,
    isActive: true,
    steviloUpor: 0,
  }).returning({ id: counterpartiesTable.id });
  kupecZEmailId = kpz!.id;

  const [kpb] = await db.insert(counterpartiesTable).values({
    companyId,
    name: `Kupec brez emaila ${RUN_ID}`,
    type: "customer",
    eRacunPrejemnik: false,
    eRacunEmail: null,
    vatPayer: false,
    isActive: true,
    steviloUpor: 0,
  }).returning({ id: counterpartiesTable.id });
  kupecBrezEmailId = kpb!.id;
});

afterAll(async () => {
  if (ustvarjeniRacuniIds.length) {
    await db.delete(postavkeTable).where(inArray(postavkeTable.racunId, ustvarjeniRacuniIds));
    await db.delete(racuniTable).where(inArray(racuniTable.id, ustvarjeniRacuniIds));
  }
  if (ustvarjenaNarocilaIds.length) {
    await db.delete(narocilaTable).where(inArray(narocilaTable.id, ustvarjenaNarocilaIds));
  }
  await db.delete(counterpartiesTable).where(eq(counterpartiesTable.id, kupecZEmailId));
  await db.delete(counterpartiesTable).where(eq(counterpartiesTable.id, kupecBrezEmailId));
  await db.delete(enoteTable).where(eq(enoteTable.id, enotaId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

beforeEach(() => {
  mockPosljiEslogEmail.mockClear();
  mockGeneratePdf.mockClear();
  // Privzeto: uspešno pošiljanje
  mockPosljiEslogEmail.mockResolvedValue({ uspeh: true });
  // Privzeto: generatePosInvoicePdf vrne lažni PDF buffer
  mockGeneratePdf.mockResolvedValue(Buffer.from("FAKE-PDF-CONTENT"));
});

// ── Testi ─────────────────────────────────────────────────────────────────────
describe("POST /racuni/:id/eracun/poslji-email — e-poštni kanal e-SLOG", () => {

  // ── 422 — predpogoji niso izpolnjeni ────────────────────────────────────────
  describe("422 — predpogoji niso izpolnjeni", () => {

    it("SCE-1: račun brez eRacunXml → 422, posljiEslogEmail se ne pokliče", async () => {
      const id = await insertRacun({ eRacunXml: null, kupecCpId: kupecZEmailId });

      const res = await supertest(buildApp())
        .post(`/racuni/${id}/eracun/poslji-email`)
        .send({});

      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/XML ni generiran/i);
      expect(mockPosljiEslogEmail).not.toHaveBeenCalled();
    });

    it("SCE-2: račun brez kupecCpId → 422, posljiEslogEmail se ne pokliče", async () => {
      const id = await insertRacun({
        eRacunXml: FAKE_XML,
        eRacunStatus: "pripravljen",
        kupecCpId: null,
      });

      const res = await supertest(buildApp())
        .post(`/racuni/${id}/eracun/poslji-email`)
        .send({});

      expect(res.status).toBe(422);
      expect(res.body.error).toMatch(/nima povezanega kupca|ni povezanega kupca/i);
      expect(mockPosljiEslogEmail).not.toHaveBeenCalled();
    });

    it("SCE-3: kupec brez e_racun_email → 422 z navodilom o Partnerjih", async () => {
      const id = await insertRacun({
        eRacunXml: FAKE_XML,
        eRacunStatus: "pripravljen",
        kupecCpId: kupecBrezEmailId,
      });

      const res = await supertest(buildApp())
        .post(`/racuni/${id}/eracun/poslji-email`)
        .send({});

      expect(res.status).toBe(422);
      expect(res.body.error).toContain("Dodajte ga v razdelku Partnerji");
      expect(mockPosljiEslogEmail).not.toHaveBeenCalled();
    });
  });

  // ── Uspešno pošiljanje ───────────────────────────────────────────────────────
  describe("uspešno pošiljanje", () => {

    it("SCE-4: USPEH — 200, pravilna e-pošta, XML in PDF posredovana, DB status=poslano_email", async () => {
      const id = await insertRacun({
        eRacunXml: FAKE_XML,
        eRacunPdf: FAKE_PDF_B64,  // shranjeni PDF
        eRacunStatus: "pripravljen",
        kupecCpId: kupecZEmailId,
        kupecNaziv: "Test Kupec d.o.o.",
      });

      const res = await supertest(buildApp())
        .post(`/racuni/${id}/eracun/poslji-email`)
        .send({});

      // HTTP
      expect(res.status).toBe(200);
      expect(res.body.uspeh).toBe(true);
      expect(res.body.email).toBe("kupec@primer.si");

      // posljiEslogEmail poklican natanko enkrat z pravilnimi argumenti
      expect(mockPosljiEslogEmail).toHaveBeenCalledOnce();
      const [_smtp, email, racunArg, xmlArg, pdfArg] = mockPosljiEslogEmail.mock.calls[0]!;

      // Naslovnik
      expect(email).toBe("kupec@primer.si");

      // XML argument = FAKE_XML
      expect(xmlArg).toBe(FAKE_XML);

      // PDF argument = dekodiran FAKE_PDF_B64 (shranjeni, ne generirani)
      expect(Buffer.isBuffer(pdfArg)).toBe(true);
      expect((pdfArg as Buffer).toString()).toBe("SHRANJENI-PDF-VSEBINA");

      // racun metapodatki
      expect(racunArg).toMatchObject({
        skupaj: expect.closeTo(121, 1),
        ddv: expect.closeTo(21, 1),
      });

      // generatePosInvoicePdf se NE pokliče (shranjeni PDF)
      expect(mockGeneratePdf).not.toHaveBeenCalled();

      // DB stanje po uspešnem pošiljanju
      const [row] = await db.select({
        eRacunStatus: racuniTable.eRacunStatus,
        eRacunPoslanoDne: racuniTable.eRacunPoslanoDne,
        eRacunEmailOdgovor: racuniTable.eRacunEmailOdgovor,
      }).from(racuniTable).where(eq(racuniTable.id, id));

      expect(row!.eRacunStatus).toBe("poslano_email");
      expect(row!.eRacunPoslanoDne).not.toBeNull();
      expect(row!.eRacunEmailOdgovor).toContain("OK:");
      expect(row!.eRacunEmailOdgovor).toContain("kupec@primer.si");
    });

    it("SCE-5: SMTP napaka → 500, eRacunEmailOdgovor=NAPAKA, status NE postane poslano_email", async () => {
      const id = await insertRacun({
        eRacunXml: FAKE_XML,
        eRacunPdf: FAKE_PDF_B64,
        eRacunStatus: "pripravljen",
        kupecCpId: kupecZEmailId,
      });

      // Mock: pošiljanje spodleti (npr. SMTP ni dosegljiv)
      mockPosljiEslogEmail.mockResolvedValueOnce({
        uspeh: false,
        napaka: "SMTP connection refused (test mock)",
      });

      const res = await supertest(buildApp())
        .post(`/racuni/${id}/eracun/poslji-email`)
        .send({});

      expect(res.status).toBe(500);
      expect(res.body.error).toContain("SMTP connection refused");

      // DB: status se NE sme spremeniti v poslano_email
      const [row] = await db.select({
        eRacunStatus: racuniTable.eRacunStatus,
        eRacunEmailOdgovor: racuniTable.eRacunEmailOdgovor,
      }).from(racuniTable).where(eq(racuniTable.id, id));

      expect(row!.eRacunStatus).toBe("pripravljen"); // nespremenjen!
      expect(row!.eRacunEmailOdgovor).toContain("NAPAKA");
    });
  });

  // ── PDF fallback logika ──────────────────────────────────────────────────────
  describe("PDF fallback", () => {

    it("SCE-6: eRacunPdf shranjen → generatePosInvoicePdf se NE pokliče", async () => {
      const id = await insertRacun({
        eRacunXml: FAKE_XML,
        eRacunPdf: FAKE_PDF_B64,  // shranjen PDF
        eRacunStatus: "pripravljen",
        kupecCpId: kupecZEmailId,
      });

      const res = await supertest(buildApp())
        .post(`/racuni/${id}/eracun/poslji-email`)
        .send({});

      expect(res.status).toBe(200);
      // Ključno: PDF že shranjen → ni potrebe po regeneriranju
      expect(mockGeneratePdf).not.toHaveBeenCalled();

      // Potrdi: posljiEslogEmail je dobil shranjeni PDF, ne generirani
      const pdfArg = mockPosljiEslogEmail.mock.calls[0]![4] as Buffer;
      expect(pdfArg.toString()).toBe("SHRANJENI-PDF-VSEBINA");
    });

    it("SCE-7: brez eRacunPdf → generatePosInvoicePdf se pokliče, posljiEslogEmail dobi generirani PDF", async () => {
      const id = await insertRacun({
        eRacunXml: FAKE_XML,
        eRacunPdf: null,  // stari račun — ni shranjenega PDF
        eRacunStatus: "pripravljen",
        kupecCpId: kupecZEmailId,
      });

      const res = await supertest(buildApp())
        .post(`/racuni/${id}/eracun/poslji-email`)
        .send({});

      // PDF generiran on-the-fly
      expect(mockGeneratePdf).toHaveBeenCalledOnce();
      expect(res.status).toBe(200);

      // posljiEslogEmail je dobil FAKE-PDF-CONTENT iz mockGeneratePdf
      const pdfArg = mockPosljiEslogEmail.mock.calls[0]![4] as Buffer;
      expect(pdfArg.toString()).toBe("FAKE-PDF-CONTENT");
    });
  });
});
