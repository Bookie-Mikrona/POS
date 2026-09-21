import express from "express";
import supertest from "supertest";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";

vi.mock("@clerk/express", () => ({
  getAuth: (req: express.Request) => ({ userId: req.header("x-test-user") ?? null }),
}));

import {
  blagajneTable,
  blagajniskeNastavitveTable,
  blagajniskiPremikiTable,
  companiesTable,
  db,
  enoteTable,
  narocilaTable,
  posCashReconciliationsTable,
  posUporabnikiTable,
  racuniTable,
} from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import blagajniskiPremikiRouter from "./blagajniski-premiki";
import statistikeRouter from "./statistike";
import zPorocilaRouter from "./z-porocila";

const runId = Math.random().toString(36).slice(2, 10);
const cashier = `x-cashier-${runId}`;
const manager = `x-manager-${runId}`;
let companyId: string;
let enotaId: number;
let registerA: number;
let registerB: number;
const registerAPpId = `P%_${runId}`;
const registerABId = "A";
const registerBPpId = `P-LEAKX${runId}`;
const registerBBId = "A";

const app = express();
app.use(express.json());
app.use(requireEnota);
app.use(zPorocilaRouter);
app.use(statistikeRouter);
app.use(blagajniskiPremikiRouter);

function get(user: string, path: string) {
  return supertest(app)
    .get(path)
    .set("x-test-user", user)
    .set("x-company-id", companyId)
    .set("x-enota-id", String(enotaId));
}

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `T293${runId}`,
    naziv: `X report regression ${runId}`,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;
  const [enota] = await db.insert(enoteTable).values({
    companyId,
    ime: `X report enota ${runId}`,
    zacetekDnevaUra: "04:00",
  }).returning({ id: enoteTable.id });
  enotaId = enota!.id;
  const registers = await db.insert(blagajneTable).values([
    { enotaId, ppId: registerAPpId, bId: registerABId, ime: `Register A ${runId}` },
    { enotaId, ppId: registerBPpId, bId: registerBBId, ime: `Register B ${runId}` },
  ]).returning({ id: blagajneTable.id });
  registerA = registers[0]!.id;
  registerB = registers[1]!.id;
  await db.insert(posUporabnikiTable).values([
    {
      clerkUserId: cashier, companyId, enotaId, blagajnaId: registerA,
      vloga: "uporabnik", ime: "Cashier", priimek: runId,
    },
    {
      clerkUserId: manager, companyId, enotaId,
      vloga: "admin_enote", ime: "Manager", priimek: runId,
    },
  ]);
  await db.insert(blagajniskeNastavitveTable).values({
    companyId, enotaId, blagajnaId: registerA,
    menjalniDenar: "50.00", updatedBy: manager,
  });

  const orders = await db.insert(narocilaTable).values(
    Array.from({ length: 9 }, () => ({ enotaId, status: "zakljuceno" as const, skupaj: "0.00" })),
  ).returning({ id: narocilaTable.id });
  const prefix = `${registerAPpId}-${registerABId}`;
  const leakingPrefix = `${registerBPpId}-${registerBBId}`;
  await db.insert(racuniTable).values([
    {
      enotaId, narociloId: orders[0]!.id, stevilkaRacuna: `${prefix}-000001`,
      skupaj: "30.00", ddv: "5.41", placilnaNacin: "gotovina", status: "poslan",
      ustvarjeno: new Date("2025-01-10T10:00:00Z"),
      znesekGotovina: "10.00", znesekKartica: "20.00",
      znesekBon: "0.00", znesekBonPica: null, znesekNegotovinsko: null,
    },
    {
      enotaId, narociloId: orders[1]!.id, stevilkaRacuna: `${prefix}-000002`,
      skupaj: "20.00", ddv: "3.61", placilnaNacin: "kartica", status: "poslan",
      ustvarjeno: new Date("2025-01-11T02:59:59Z"),
      znesekGotovina: "15.00", znesekKartica: null,
      znesekBon: "5.00", znesekBonPica: null, znesekNegotovinsko: null,
    },
    {
      enotaId, narociloId: orders[2]!.id, stevilkaRacuna: `${prefix}-000003`,
      skupaj: "99.00", ddv: "17.85", placilnaNacin: "gotovina", status: "poslan",
      ustvarjeno: new Date("2025-01-11T03:00:00Z"), znesekGotovina: "99.00",
    },
    {
      enotaId, narociloId: orders[3]!.id, stevilkaRacuna: `${prefix}-000004`,
      skupaj: "800.00", ddv: "144.26", placilnaNacin: "gotovina", status: "storniran",
      ustvarjeno: new Date("2025-01-10T12:00:00Z"), znesekGotovina: "800.00",
    },
    {
      enotaId, narociloId: orders[4]!.id, stevilkaRacuna: `${prefix}-000005`,
      skupaj: "700.00", ddv: "126.23", placilnaNacin: "gotovina", status: "poslan",
      jeStorno: true, ustvarjeno: new Date("2025-01-10T13:00:00Z"), znesekGotovina: "700.00",
    },
    {
      enotaId, narociloId: orders[5]!.id, stevilkaRacuna: `${prefix}-000006`,
      skupaj: "10.00", ddv: "1.80", placilnaNacin: "gotovina", status: "poslan",
      ustvarjeno: new Date("2025-01-10T14:00:00Z"),
      znesekGotovina: "12.00", znesekKartica: "0.00", znesekNapitnina: "2.00",
      tipPaymentMethod: "cash", tipPolicyMode: "direct_employee",
      tipCardFeeTreatment: "employer_expense", tipCardFeeKind: "none",
      tipCardFeeTaxTreatment: "not_applicable",
      znesekBon: null, znesekBonPica: null, znesekNegotovinsko: null,
    },
    {
      enotaId, narociloId: orders[6]!.id, stevilkaRacuna: `${prefix}-000007`,
      skupaj: "10.00", ddv: "1.80", placilnaNacin: "kartica", status: "poslan",
      ustvarjeno: new Date("2025-01-10T15:00:00Z"),
      znesekGotovina: "0.00", znesekKartica: "13.00", znesekNapitnina: "3.00",
      tipPaymentMethod: "card", tipPolicyMode: "direct_employee",
      tipCardFeeTreatment: "employer_expense", tipCardFeeKind: "none",
      tipCardFeeTaxTreatment: "not_applicable",
      znesekBon: null, znesekBonPica: null, znesekNegotovinsko: null,
    },
    {
      enotaId, narociloId: orders[7]!.id, stevilkaRacuna: `${prefix}-000008`,
      skupaj: "2.00", ddv: "0.36", placilnaNacin: "kartica", status: "poslan",
      ustvarjeno: new Date("2025-01-10T16:00:00Z"),
      znesekGotovina: "0.00", znesekKartica: "2.00",
      znesekBon: null, znesekBonPica: "10.00", znesekNegotovinsko: null,
    },
    {
      // Without literal LIKE escaping, A's P%_... prefix also matches this B receipt.
      enotaId, narociloId: orders[8]!.id, stevilkaRacuna: `${leakingPrefix}-000001`,
      skupaj: "500.00", ddv: "90.16", placilnaNacin: "kartica", status: "poslan",
      ustvarjeno: new Date("2025-01-10T17:00:00Z"),
      znesekGotovina: "0.00", znesekKartica: "507.00", znesekNapitnina: "7.00",
      tipPaymentMethod: "card", tipPolicyMode: "direct_employee",
      tipCardFeeTreatment: "employer_expense", tipCardFeeKind: "none",
      tipCardFeeTaxTreatment: "not_applicable",
      znesekBon: null, znesekBonPica: null, znesekNegotovinsko: null,
    },
  ]);
  await db.insert(blagajniskiPremikiTable).values([
    {
      companyId, enotaId, blagajnaId: registerA, poslovniDatum: "2025-01-10",
      datumCas: new Date("2025-01-11T02:59:59Z"), tip: "POLOG_GOTOVINE",
      status: "POTRJEN", znesek: "30.00", opis: "Included before cutoff", createdBy: manager,
    },
    {
      companyId, enotaId, blagajnaId: registerA, poslovniDatum: "2025-01-11",
      datumCas: new Date("2025-01-11T03:00:00Z"), tip: "POLOG_GOTOVINE",
      status: "POTRJEN", znesek: "40.00", opis: "Next day at cutoff", createdBy: manager,
    },
  ]);
});

afterAll(async () => {
  if (!companyId) return;
  await db.delete(posCashReconciliationsTable).where(eq(posCashReconciliationsTable.companyId, companyId));
  await db.delete(blagajniskiPremikiTable).where(eq(blagajniskiPremikiTable.companyId, companyId));
  await db.delete(racuniTable).where(eq(racuniTable.enotaId, enotaId));
  await db.delete(narocilaTable).where(eq(narocilaTable.enotaId, enotaId));
  await db.delete(blagajniskeNastavitveTable).where(eq(blagajniskeNastavitveTable.companyId, companyId));
  await db.delete(posUporabnikiTable).where(eq(posUporabnikiTable.companyId, companyId));
  await db.delete(blagajneTable).where(eq(blagajneTable.enotaId, enotaId));
  await db.delete(enoteTable).where(eq(enoteTable.id, enotaId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
});

describe("X report payment, authorization, and business-day regression", () => {
  it("uses split payments and the same half-open business day as cash movements", async () => {
    const x = await get(cashier, `/x-porocilo?blagajnaId=${registerA}&poslovniDatum=2025-01-10`);
    expect(x.status, JSON.stringify(x.body)).toBe(200);
    expect(x.body.totals).toMatchObject({
      promet_dneva: 72, stevilo_racunov: 5, znesek_napitnina: 5,
      gotovina: 37, kartica: 35, bon: 5, bonPica: 10, bon_pica: 10, negotovinsko: 0,
    });
    expect(
      x.body.totals.gotovina + x.body.totals.kartica + x.body.totals.bon
      + x.body.totals.negotovinsko,
    ).toBe(x.body.totals.promet_dneva + x.body.totals.znesek_napitnina);
    expect(x.body).toMatchObject({ gotovinskaProdaja: 37, pricakovanaGotovina: 117 });
    expect(x.body.tipBreakdown.gross).toBe(5);
    expect(x.body.tipBreakdown.byPolicyMode).toEqual(expect.arrayContaining([
      expect.objectContaining({ paymentMethod: "cash", gross: 2 }),
      expect.objectContaining({ paymentMethod: "card", gross: 3 }),
    ]));

    const stats = await get(cashier, `/statistike/promet-obdobja?od=2025-01-10&do=2025-01-10&blagajnaId=${registerA}`);
    expect(stats.status, JSON.stringify(stats.body)).toBe(200);
    expect(stats.body).toMatchObject({ skupajPromet: 72, steviloRacunov: 5 });
    expect(stats.body.prometPoNacinuPlacila).toMatchObject({
      gotovina: 37, kartica: 35, bon: 5, bonPica: 10, napitnina: 5, negotovinsko: 0,
    });
    expect(stats.body.tipBreakdown).toMatchObject({ gross: 5 });

    const journal = await get(cashier, `/blagajniski-premiki?datum=2025-01-10&blagajnaId=${registerA}`);
    expect(journal.status).toBe(200);
    expect(journal.body.premiki.map((row: { opis: string }) => row.opis)).toEqual(["Included before cutoff"]);
  });

  it("restricts a cashier to the active assigned register but not a manager", async () => {
    const denied = await get(cashier, `/x-porocilo?blagajnaId=${registerB}&poslovniDatum=2025-01-10`);
    expect(denied.status).toBe(403);
    expect(denied.body.error).toBe("Blagajnik lahko uporablja samo svojo dodeljeno blagajno.");
    const deniedWrite = await supertest(app)
      .post("/x-porocilo/uskladitev-gotovine")
      .set("x-test-user", cashier).set("x-company-id", companyId).set("x-enota-id", String(enotaId))
      .send({ blagajnaId: registerB, poslovniDatum: "2025-01-10", prestetaGotovina: 50, idempotencyKey: `denied-${runId}` });
    expect(deniedWrite.status).toBe(403);
    expect(deniedWrite.body.error).toBe("Blagajnik lahko uporablja samo svojo dodeljeno blagajno.");
    const deniedClose = await supertest(app)
      .post("/z-porocilo/zakljuci")
      .set("x-test-user", cashier).set("x-company-id", companyId).set("x-enota-id", String(enotaId))
      .send({ blagajnaId: registerB, poslovniDatum: "2025-01-10" });
    expect(deniedClose.status).toBe(403);
    expect(deniedClose.body.error).toBe("Blagajnik lahko uporablja samo svojo dodeljeno blagajno.");
    const managerB = await get(manager, `/x-porocilo?blagajnaId=${registerB}&poslovniDatum=2025-01-10`);
    expect(managerB.status, JSON.stringify(managerB.body)).toBe(200);
    expect(managerB.body.totals).toMatchObject({
      promet_dneva: 500, stevilo_racunov: 1, gotovina: 0, kartica: 507,
      bon: 0, bonPica: 0, negotovinsko: 0, znesek_napitnina: 7,
    });
    expect(managerB.body.tipBreakdown.gross).toBe(7);
  });

  it("moves exact-cutoff receipt and movement to the next business date", async () => {
    const x = await get(cashier, `/x-porocilo?blagajnaId=${registerA}&poslovniDatum=2025-01-11`);
    expect(x.status, JSON.stringify(x.body)).toBe(200);
    expect(x.body.totals).toMatchObject({ promet_dneva: 99, stevilo_racunov: 1, gotovina: 99 });
    const journal = await get(cashier, `/blagajniski-premiki?datum=2025-01-11&blagajnaId=${registerA}`);
    expect(journal.status).toBe(200);
    expect(journal.body.premiki.map((row: { opis: string }) => row.opis)).toEqual(["Next day at cutoff"]);
  });
});