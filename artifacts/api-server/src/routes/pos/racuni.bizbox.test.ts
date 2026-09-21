/**
 * Integracijski testi za bizBox dostavi cikel (DEL 2–4):
 *   POST /racuni/:id/eracun/poslji  — shrani docId ob oddaji
 *   POST /racuni/:id/eracun/status  — status iz metaData
 *   isEdiEnabled predpreverba
 *
 * Mockano : loginBizbox, posliBizbox, getBizboxDocMetadata, preveriEdiEnabled
 *           (parseBizboxDocId je pure function — testira se nativno)
 * Realno  : PostgreSQL (dev baza) — racuni, counterparties, enote, companies
 *
 * Pokriti scenariji:
 *  BB-1  JSON odgovor {result:N} → e_racun_bizbox_id=N, status=oddano
 *  BB-2  Golo celo število v telesu → shrani docId
 *  BB-3  Telo brez docId → e_racun_bizbox_id=null, status=oddano
 *  BB-4  isEdiEnabled=false → ediEnabled:false v odg., oddaja se kljub temu izvede
 *  BB-5  Status endpoint: shranjen docId → metaData, posodobi e_racun_bizbox_status
 *  BB-6  Status endpoint: ni docId → 422
 *  BB-7  Status endpoint: metaData vrne dostavljeno → status=dostavljeno v DB
 *  BB-8  Obstoječi tok: e_racun_status='poslano', e_racun_bizbox_odgovor shranjen
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
  bizboxNastavitveTable,
} from "@workspace/db";
import racuniRouter from "./racuni";

// ── vi.hoisted: dostopno v vi.mock factory ────────────────────────────────────
const { mockLogin, mockPoslji, mockGetMetadata, mockPreveriEdi } = vi.hoisted(() => ({
  mockLogin:        vi.fn().mockResolvedValue("FAKE-TOKEN-BB"),
  mockPoslji:       vi.fn().mockResolvedValue({ status: 200, body: '{"result":98765}' }),
  mockGetMetadata:  vi.fn().mockResolvedValue({ bizboxStatus: "v_obdelavi", raw: "{}" }),
  mockPreveriEdi:   vi.fn().mockResolvedValue({ enabled: true, raw: "true" }),
}));

// bizbox lib — mrežne klice zamenjamo z moki; parseBizboxDocId je pure fn, ostane nativni
vi.mock("../../lib/eracun/bizbox", async (importOriginal) => {
  const orig = await importOriginal<typeof import("../../lib/eracun/bizbox")>();
  return {
    ...orig,
    loginBizbox:          mockLogin,
    posljiBizbox:         mockPoslji,
    getBizboxDocMetadata: mockGetMetadata,
    preveriEdiEnabled:    mockPreveriEdi,
  };
});

// nastavitve — brez pravega DB klica; vrnemo testno okolje
vi.mock("./nastavitve", () => ({
  readAll:             vi.fn(async () => ({ bizBoxOkolje: "test" })),
  readAllWithFallback: vi.fn(async () => ({})),
  toResponse:          vi.fn(() => ({})),
}));

// ── Test identifikatorji ──────────────────────────────────────────────────────
const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();
const FAKE_XML = `<?xml version="1.0" encoding="UTF-8"?><Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2"><ID>BB-${RUN_ID}</ID></Invoice>`;

let companyId: string;
let enotaId: number;
let kupecId: string;

const ustvarjeniRacuniIds: number[] = [];
const ustvarjenaNarocilaIds: number[] = [];

// ── Express app s simuliranim POS middleware ──────────────────────────────────
function buildApp() {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).enotaId  = enotaId;
    (req as any).companyId = companyId;
    (req as any).log = {
      info: () => {}, warn: () => {}, debug: () => {}, error: () => {},
    };
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
  eRacunStatus?: "pripravljen" | "poslano" | "poslano_email" | "napaka" | null;
  kupecCpId?: string | null;
  eRacunBizboxId?: string | null;
  eRacunBizboxStatus?: "oddano" | "v_obdelavi" | "dostavljeno" | "zavrnjeno" | "napaka" | null;
}): Promise<number> {
  // narocilo_id je NOT NULL → vedno ustvari narocilo najprej
  const [nar] = await db.insert(narocilaTable).values({ enotaId })
    .returning({ id: narocilaTable.id });
  ustvarjenaNarocilaIds.push(nar!.id);

  const stevilka = `TST-BB-${RUN_ID}-${String(ustvarjeniRacuniIds.length + 1).padStart(3, "0")}`;
  const [r] = await db.insert(racuniTable).values({
    enotaId,
    narociloId: nar!.id,
    stevilkaRacuna: stevilka,
    skupaj: "121.00",
    ddv: "21.00",
    placilnaNacin: "negotovinsko",
    status: "poslan",
    eRacunXml: opts.eRacunXml ?? null,
    eRacunStatus: opts.eRacunStatus ?? null,
    kupecCpId: opts.kupecCpId ?? null,
    eRacunBizboxId: opts.eRacunBizboxId ?? null,
    eRacunBizboxStatus: opts.eRacunBizboxStatus ?? null,
  }).returning({ id: racuniTable.id });
  ustvarjeniRacuniIds.push(r!.id);
  return r!.id;
}

// ── Setup / teardown ──────────────────────────────────────────────────────────
beforeAll(async () => {
  const [c] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_TST_BB_${RUN_ID}`,
    naziv: `Test bizBox ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = c!.id;

  const [e] = await db.insert(enoteTable).values({
    companyId,
    ime: `Enota bizBox ${RUN_ID}`,
  }).returning({ id: enoteTable.id });
  enotaId = e!.id;

  const [k] = await db.insert(counterpartiesTable).values({
    companyId,
    name: `Kupec bizBox ${RUN_ID}`,
    type: "customer",
    taxId: "84040000",
    eRacunPrejemnik: true,
    vatPayer: false,
    isActive: true,
    steviloUpor: 0,
  }).returning({ id: counterpartiesTable.id });
  kupecId = k!.id;

  // Nastavi poverilnici za testno okolje (brisane v afterAll)
  process.env["BIZBOX_USER"] = "test-bizbox-user";
  process.env["BIZBOX_PASS"] = "test-bizbox-pass";
});

afterAll(async () => {
  delete process.env["BIZBOX_USER"];
  delete process.env["BIZBOX_PASS"];

  if (ustvarjeniRacuniIds.length) {
    await db.delete(postavkeTable)
      .where(inArray(postavkeTable.racunId, ustvarjeniRacuniIds))
      .catch(() => {});
    await db.delete(racuniTable)
      .where(inArray(racuniTable.id, ustvarjeniRacuniIds));
  }
  if (ustvarjenaNarocilaIds.length) {
    await db.delete(narocilaTable)
      .where(inArray(narocilaTable.id, ustvarjenaNarocilaIds));
  }
  await db.delete(counterpartiesTable).where(eq(counterpartiesTable.id, kupecId));
  await db.delete(enoteTable).where(eq(enoteTable.id, enotaId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

beforeEach(() => {
  mockLogin.mockClear();
  mockPoslji.mockClear();
  mockGetMetadata.mockClear();
  mockPreveriEdi.mockClear();
  // Privzeti odzivi
  mockLogin.mockResolvedValue("FAKE-TOKEN-BB");
  mockPoslji.mockResolvedValue({ status: 200, body: '{"result":98765}' });
  mockGetMetadata.mockResolvedValue({ bizboxStatus: "v_obdelavi", raw: "{}" });
  mockPreveriEdi.mockResolvedValue({ enabled: true, raw: "true" });
});

// ── Testi: DEL 2 — shranjevanje docId ob oddaji ───────────────────────────────
describe("POST /racuni/:id/eracun/poslji — shrani docId ob oddaji", () => {

  it("BB-1: JSON {result:98765} → e_racun_bizbox_id='98765', e_racun_bizbox_status='oddano'", async () => {
    const id = await insertRacun({
      eRacunXml: FAKE_XML,
      eRacunStatus: "pripravljen",
      kupecCpId: kupecId,
    });
    mockPoslji.mockResolvedValueOnce({ status: 200, body: '{"result":98765}' });

    const res = await supertest(buildApp())
      .post(`/racuni/${id}/eracun/poslji`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.uspeh).toBe(true);
    expect(res.body.docId).toBe("98765");
    expect(res.body.ediEnabled).toBe(true);

    const [row] = await db.select({
      eRacunBizboxId:     racuniTable.eRacunBizboxId,
      eRacunBizboxStatus: racuniTable.eRacunBizboxStatus,
      eRacunStatus:       racuniTable.eRacunStatus,
    }).from(racuniTable).where(eq(racuniTable.id, id));

    expect(row!.eRacunBizboxId).toBe("98765");
    expect(row!.eRacunBizboxStatus).toBe("oddano");
    expect(row!.eRacunStatus).toBe("poslano");   // obstoječ status nespremenjen
  });

  it("BB-2: golo celo število '42000' → docId='42000'", async () => {
    const id = await insertRacun({
      eRacunXml: FAKE_XML,
      eRacunStatus: "pripravljen",
      kupecCpId: kupecId,
    });
    mockPoslji.mockResolvedValueOnce({ status: 200, body: "42000" });

    const res = await supertest(buildApp())
      .post(`/racuni/${id}/eracun/poslji`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.docId).toBe("42000");

    const [row] = await db.select({ eRacunBizboxId: racuniTable.eRacunBizboxId })
      .from(racuniTable).where(eq(racuniTable.id, id));
    expect(row!.eRacunBizboxId).toBe("42000");
  });

  it("BB-3: telo brez razpoznavnega docId → e_racun_bizbox_id=null, status=oddano", async () => {
    const id = await insertRacun({
      eRacunXml: FAKE_XML,
      eRacunStatus: "pripravljen",
      kupecCpId: kupecId,
    });
    mockPoslji.mockResolvedValueOnce({ status: 200, body: "OK" });  // brez docId

    const res = await supertest(buildApp())
      .post(`/racuni/${id}/eracun/poslji`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.docId).toBeNull();

    const [row] = await db.select({
      eRacunBizboxId:     racuniTable.eRacunBizboxId,
      eRacunBizboxStatus: racuniTable.eRacunBizboxStatus,
    }).from(racuniTable).where(eq(racuniTable.id, id));

    expect(row!.eRacunBizboxId).toBeNull();
    expect(row!.eRacunBizboxStatus).toBe("oddano");  // status se vseeno nastavi
  });

  it("BB-4: isEdiEnabled=false → ediEnabled:false v odg., oddaja se vseeno izvede", async () => {
    const id = await insertRacun({
      eRacunXml: FAKE_XML,
      eRacunStatus: "pripravljen",
      kupecCpId: kupecId,
    });
    mockPreveriEdi.mockResolvedValueOnce({ enabled: false, raw: "false" });
    mockPoslji.mockResolvedValueOnce({ status: 200, body: '{"result":11111}' });

    const res = await supertest(buildApp())
      .post(`/racuni/${id}/eracun/poslji`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.uspeh).toBe(true);
    expect(res.body.ediEnabled).toBe(false);  // opozorilo
    expect(res.body.docId).toBe("11111");

    // Oddaja se je izvedla kljub opozorilu
    expect(mockPoslji).toHaveBeenCalledOnce();

    const [row] = await db.select({ eRacunStatus: racuniTable.eRacunStatus })
      .from(racuniTable).where(eq(racuniTable.id, id));
    expect(row!.eRacunStatus).toBe("poslano");
  });

  it("BB-8: obstoječi tok — e_racun_status='poslano', e_racun_bizbox_odgovor shranjen, poslanoDne nastavljen", async () => {
    const id = await insertRacun({
      eRacunXml: FAKE_XML,
      eRacunStatus: "pripravljen",
      kupecCpId: kupecId,
    });
    mockPoslji.mockResolvedValueOnce({ status: 201, body: '{"result":77777}' });

    const res = await supertest(buildApp())
      .post(`/racuni/${id}/eracun/poslji`)
      .send({});
    expect(res.status).toBe(200);

    const [row] = await db.select({
      eRacunStatus:       racuniTable.eRacunStatus,
      eRacunBizboxOdgovor: racuniTable.eRacunBizboxOdgovor,
      eRacunPoslanoDne:   racuniTable.eRacunPoslanoDne,
      eRacunNapaka:       racuniTable.eRacunNapaka,
    }).from(racuniTable).where(eq(racuniTable.id, id));

    expect(row!.eRacunStatus).toBe("poslano");
    expect(row!.eRacunBizboxOdgovor).toContain("HTTP 201");
    expect(row!.eRacunBizboxOdgovor).toContain("77777");
    expect(row!.eRacunPoslanoDne).not.toBeNull();
    expect(row!.eRacunNapaka).toBeNull();
  });
});

// ── Testi: DEL 3 — status preverjanje ────────────────────────────────────────
describe("POST /racuni/:id/eracun/status — preverjanje statusa dostave", () => {

  it("BB-5: shranjen docId → pokliče getBizboxDocMetadata, posodobi e_racun_bizbox_status", async () => {
    const id = await insertRacun({
      eRacunXml: FAKE_XML,
      eRacunStatus: "poslano",
      kupecCpId: kupecId,
      eRacunBizboxId: "98765",
      eRacunBizboxStatus: "oddano",
    });
    mockGetMetadata.mockResolvedValueOnce({ bizboxStatus: "v_obdelavi", raw: '{"status":"pending"}' });

    const res = await supertest(buildApp())
      .post(`/racuni/${id}/eracun/status`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.bizboxStatus).toBe("v_obdelavi");
    expect(res.body.docId).toBe("98765");

    // Preverimo, da je bil poklic z docId="98765"
    expect(mockGetMetadata).toHaveBeenCalledOnce();
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((mockGetMetadata.mock.calls[0] as any[])[2]).toBe("98765");

    // DB posodobljen
    const [row] = await db.select({ eRacunBizboxStatus: racuniTable.eRacunBizboxStatus })
      .from(racuniTable).where(eq(racuniTable.id, id));
    expect(row!.eRacunBizboxStatus).toBe("v_obdelavi");
  });

  it("BB-6: ni docId → 422, getBizboxDocMetadata se ne pokliče", async () => {
    const id = await insertRacun({
      eRacunXml: FAKE_XML,
      eRacunStatus: "poslano",
      eRacunBizboxId: null,
    });

    const res = await supertest(buildApp())
      .post(`/racuni/${id}/eracun/status`)
      .send({});

    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/document ID/i);
    expect(mockGetMetadata).not.toHaveBeenCalled();
  });

  it("BB-7: metaData vrne dostavljeno → e_racun_bizbox_status='dostavljeno' v DB", async () => {
    const id = await insertRacun({
      eRacunXml: FAKE_XML,
      eRacunStatus: "poslano",
      kupecCpId: kupecId,
      eRacunBizboxId: "55555",
      eRacunBizboxStatus: "v_obdelavi",
    });
    mockGetMetadata.mockResolvedValueOnce({ bizboxStatus: "dostavljeno", raw: '{"status":"DELIVERED"}' });

    const res = await supertest(buildApp())
      .post(`/racuni/${id}/eracun/status`)
      .send({});

    expect(res.status).toBe(200);
    expect(res.body.bizboxStatus).toBe("dostavljeno");

    const [row] = await db.select({ eRacunBizboxStatus: racuniTable.eRacunBizboxStatus })
      .from(racuniTable).where(eq(racuniTable.id, id));
    expect(row!.eRacunBizboxStatus).toBe("dostavljeno");
  });
});

// ── BB-9: Per-podjetje DB poverilnice se uporabijo pri oddaji ─────────────────
//
// Ko je v bizbox_nastavitve vnosek za companyId, mora pridobiBizboxPoverilnice()
// dešifrirati geslo iz DB in ga posredovati loginBizbox — NE env BIZBOX_USER/PASS.
// Testira env-fallback pot (brez DB = env; z DB = DB poverilnice).
describe("pridobiBizboxPoverilnice — per-podjetje DB vs env fallback", () => {
  const DB_BIZBOX_USER = `db-user-${RUN_ID}@bizbox.si`;
  const DB_BIZBOX_PASS = `DbGeslo_${RUN_ID}_SuperTajno`;
  const ENC_KEY = "bb9-bizbox-enc-key-za-teste-32-znakov!!";

  beforeAll(async () => {
    // Nastavi ključ za šifriranje (neodvisen od IMAP_ENC_KEY)
    process.env["BIZBOX_ENC_KEY"] = ENC_KEY;

    // Šifriraj geslo in vstavi v bizbox_nastavitve za testni companyId
    const { sifrirajBizboxGeslo } = await import("../../lib/kripto-bizbox");
    await db.insert(bizboxNastavitveTable).values({
      companyId,
      bizboxUser:    DB_BIZBOX_USER,
      bizboxPassEnc: sifrirajBizboxGeslo(DB_BIZBOX_PASS),
      bizboxOkolje:  "test",
    }).onConflictDoUpdate({
      target: bizboxNastavitveTable.companyId,
      set: {
        bizboxUser:    DB_BIZBOX_USER,
        bizboxPassEnc: sifrirajBizboxGeslo(DB_BIZBOX_PASS),
        bizboxOkolje:  "test",
        updatedAt:     new Date(),
      },
    });
  });

  afterAll(async () => {
    delete process.env["BIZBOX_ENC_KEY"];
    await db.delete(bizboxNastavitveTable)
      .where(eq(bizboxNastavitveTable.companyId, companyId))
      .catch(() => {});
  });

  it("BB-9: DB poverilnice se uporabijo pri oddaji (ne env BIZBOX_USER/PASS)", async () => {
    const id = await insertRacun({
      eRacunXml: FAKE_XML,
      eRacunStatus: "pripravljen",
      kupecCpId: kupecId,
    });

    mockLogin.mockClear();
    const res = await supertest(buildApp())
      .post(`/racuni/${id}/eracun/poslji`)
      .send({});

    expect(res.status).toBe(200);

    // loginBizbox mora biti klican z DB user in DB pass — NE z env BIZBOX_USER
    expect(mockLogin).toHaveBeenCalledOnce();
    const loginArgs = mockLogin.mock.calls[0] as [string, string, string];
    expect(loginArgs[1]).toBe(DB_BIZBOX_USER);        // user iz DB
    expect(loginArgs[2]).toBe(DB_BIZBOX_PASS);         // dešifrirano geslo iz DB
    // Ne sme biti klican z env poverilnicami
    expect(loginArgs[1]).not.toBe(process.env["BIZBOX_USER"] ?? "");
  });

  it("BB-9b: env fallback — ko ni DB vnosa, se env poverilnice uporabijo", async () => {
    // Začasno izbriši DB vnosek
    await db.delete(bizboxNastavitveTable)
      .where(eq(bizboxNastavitveTable.companyId, companyId));

    const id = await insertRacun({
      eRacunXml: FAKE_XML,
      eRacunStatus: "pripravljen",
      kupecCpId: kupecId,
    });

    mockLogin.mockClear();
    const res = await supertest(buildApp())
      .post(`/racuni/${id}/eracun/poslji`)
      .send({});

    expect(res.status).toBe(200);

    // loginBizbox mora biti klican z env poverilnicami (nastavljene v beforeAll)
    expect(mockLogin).toHaveBeenCalledOnce();
    const loginArgs = mockLogin.mock.calls[0] as [string, string, string];
    expect(loginArgs[1]).toBe("test-bizbox-user");  // env BIZBOX_USER
    expect(loginArgs[2]).toBe("test-bizbox-pass");  // env BIZBOX_PASS
  });
});
