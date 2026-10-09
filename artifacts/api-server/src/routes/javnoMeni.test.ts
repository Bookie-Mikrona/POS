import { randomBytes, randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import supertest from "supertest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import {
  artModSkupineTable,
  artikliTable,
  companiesTable,
  companyPosPlansTable,
  db,
  enoteTable,
  kategorijeTable,
  mizeTable,
  modSkupineTable,
  modNormativiTable,
  modifikatorjiTable,
  multicourseMenuCoursesTable,
  multicourseMenusTable,
  narocilaTable,
  narocnikiTable,
  nastavitveTable,
  postavkeTable,
  preparedFoodDailyLedgersTable,
  qrGostNarocilaTable,
  qrGostPovratneInformacijeTable,
  pool,
  prostoriTable,
  rezervacijeMizTable,
  tipPoliciesTable,
  kdsNalogiTable,
} from "@workspace/db";
import javniMeniRouter, {
  createQrActivationSessionForTest,
  izracunajQrPostavkaCeno,
  projectPublicAvailability,
  qrGeoDistanceMeters,
  resetJavniMeniRateLimit,
} from "./javnoMeni";
import enoteRouter from "./pos/enote";
import { ipMatchesNetwork, isValidIpNetwork } from "../lib/ip-network";
import mizeRouter from "./pos/mize";
import narocilaRouter from "./pos/narocila";
import multicourseMenuRouter from "./pos/multicourse-menu";
import kdsRouter from "./pos/kds";
import { currentBusinessDate } from "../lib/prepared-food-availability";
import {
  anonymizeExpiredQrOrderDeviceLinks,
  QR_GUEST_HISTORY_RETENTION_MS,
} from "../lib/qrHistoryRetention";

const broadcastMock = vi.hoisted(() => vi.fn());
const broadcastToMock = vi.hoisted(() => vi.fn());
const anthropicCreateMock = vi.hoisted(() => vi.fn());

vi.mock("../lib/pos-sse", () => ({
  broadcastToUnit: broadcastMock,
  broadcastToDevice: broadcastToMock,
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create: anthropicCreateMock } },
}));

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();

let companyId: string;
let enotaId: number;
let drugaEnotaId: number;
let mizaId: number;
let tujaMizaId: number;
let tenantCompanyId: string;
let tenantEnotaId: number;
let tenantMizaId: number;
let qrToken = randomBytes(32).toString("base64url");
let vidniArtikelId: number;
let embalazaArtikelId: number;
let embalazaKategorijaId: number;
let skupinaId: number;
let kategorijaId: number;
const TEST_QR_LATITUDE = 46.056947;
const TEST_QR_LONGITUDE = 14.505751;
const TEST_QR_NAPRAVA_ID = "12345678-1234-4123-8123-123456789abc";

function publicApp(autoActivate = true) {
  const app = express();
  app.set("trust proxy", ["loopback", "linklocal", "uniquelocal"]);
  app.use(express.json());
  if (autoActivate) {
    app.use((req, _res, next) => {
      const token = /^\/javno\/meni\/([^/?]+)/.exec(req.path)?.[1];
      if (!token || !enotaId || !mizaId || req.path.endsWith("/aktivacija")) {
        next();
        return;
      }
      const bodyQrNapravaId = typeof req.body?.qrNapravaId === "string" ? req.body.qrNapravaId : null;
      if (req.method === "POST" && req.path.endsWith("/narocilo") && req.body && !req.body.idempotencyKey) {
        req.body.idempotencyKey = randomUUID().replaceAll("-", "");
      }
      const queryQrNapravaId = typeof req.query.qrNapravaId === "string" ? req.query.qrNapravaId : null;
      const qrNapravaId = bodyQrNapravaId ?? queryQrNapravaId ?? TEST_QR_NAPRAVA_ID;
      if (req.method === "GET" && !queryQrNapravaId) {
        req.url += `${req.url.includes("?") ? "&" : "?"}qrNapravaId=${TEST_QR_NAPRAVA_ID}`;
      }
      const session = createQrActivationSessionForTest({ token, enotaId, mizaId, qrNapravaId });
      req.headers.cookie = `bookie_qr_activation=${encodeURIComponent(session)}`;
      next();
    });
  }
  app.use(javniMeniRouter);
  return app;
}

async function readFirstSseEvent(app: express.Express, path: string): Promise<{
  event: string;
  nextEvent: () => Promise<string>;
  close: () => Promise<void>;
}> {
  const server = await new Promise<ReturnType<express.Express["listen"]>>((resolve) => {
    const listening = app.listen(0, "127.0.0.1", () => resolve(listening));
  });
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("Testni SSE strežnik nima vrat.");
  const controller = new AbortController();
  const response = await fetch(`http://127.0.0.1:${address.port}${path}`, { signal: controller.signal });
  expect(response.status).toBe(200);
  const reader = response.body?.getReader();
  if (!reader) throw new Error("SSE odgovor nima telesa.");
  const readEvent = async (): Promise<string> => {
    const next = await reader.read();
    const payload = new TextDecoder().decode(next.value);
    const event = /^event: ([^\n]+)/m.exec(payload)?.[1];
    if (!event) throw new Error(`Neveljaven SSE dogodek: ${payload}`);
    return event;
  };
  const event = await readEvent();
  return {
    event,
    nextEvent: readEvent,
    close: async () => {
      controller.abort();
      await reader.cancel().catch(() => undefined);
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

function mizeApp(izbranaEnotaId: number, vloga: string) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).enotaId = izbranaEnotaId;
    (req as any).vloga = vloga;
    next();
  });
  app.use(mizeRouter);
  return app;
}

function enoteApp() {
  const app = express();
  app.set("trust proxy", ["loopback", "linklocal", "uniquelocal"]);
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).companyId = companyId;
    (req as any).vloga = "admin";
    next();
  });
  app.use(enoteRouter);
  return app;
}

function narocilaApp(izbranaEnotaId: number) {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).enotaId = izbranaEnotaId;
    next();
  });
  app.use(narocilaRouter);
  return app;
}

function staffApp(router: any, izbranaEnotaId: number, clerkUserId = "waiter-test-user") {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    (req as any).enotaId = izbranaEnotaId;
    (req as any).clerkUserId = clerkUserId;
    next();
  });
  app.use(router);
  return app;
}

beforeEach(async () => {
  resetJavniMeniRateLimit();
  broadcastMock.mockClear();
  broadcastToMock.mockClear();
  anthropicCreateMock.mockReset();
  anthropicCreateMock.mockResolvedValue({
    content: [{
      type: "tool_use",
      input: { recommendationKind: "show_eta", factIds: ["eta:0"] },
    }],
  });
  if (mizaId) {
    await db.delete(rezervacijeMizTable).where(eq(rezervacijeMizTable.mizaId, mizaId));
  }
});

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_QR_${RUN_ID}`,
    naziv: `QR lokal ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;

  const [enota] = await db.insert(enoteTable).values({
    companyId,
    ime: `QR enota ${RUN_ID}`,
    capabilities: ["qr_menu", "multi_course", "prepared_food"],
    qrLatitude: String(TEST_QR_LATITUDE),
    qrLongitude: String(TEST_QR_LONGITUDE),
    qrWifiNetworks: ["8.8.8.0/24", "2606:4700:4700::/48"],
  }).returning({ id: enoteTable.id });
  enotaId = enota!.id;
  await db.insert(companyPosPlansTable).values({
    companyId,
    plan: "extended",
    enabledBy: "javnoMeni.test",
  });
  await db.insert(nastavitveTable).values({
    enotaId,
    kljuc: "qrAiAsistentAktiven",
    vrednost: "true",
  });
  await db.insert(tipPoliciesTable).values({
    companyId,
    enotaId,
    effectiveFrom: "2000-01-01",
    mode: "direct_employee",
    evidenceType: "internal_rule",
    evidenceReference: `QR test policy ${RUN_ID}`,
    agreementConfirmed: true,
    cardFeeTreatment: "employer_expense",
    cardFeeKind: "none",
    createdBy: "test",
  });

  const [drugaEnota] = await db.insert(enoteTable).values({
    companyId,
    ime: `Druga QR enota ${RUN_ID}`,
  }).returning({ id: enoteTable.id });
  drugaEnotaId = drugaEnota!.id;

  const [tenantCompany] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_QR_TENANT_${RUN_ID}`,
    naziv: `Drug QR tenant ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  tenantCompanyId = tenantCompany!.id;
  const [tenantEnota] = await db.insert(enoteTable).values({
    companyId: tenantCompanyId,
    ime: `Tuja tenant enota ${RUN_ID}`,
    capabilities: ["qr_menu"],
  }).returning({ id: enoteTable.id });
  tenantEnotaId = tenantEnota!.id;
  await db.insert(companyPosPlansTable).values({
    companyId: tenantCompanyId,
    plan: "extended",
    enabledBy: "javnoMeni.test",
  });
  const [tenantMiza] = await db.insert(mizeTable).values({
    enotaId: tenantEnotaId,
    stevilka: 99,
  }).returning({ id: mizeTable.id });
  tenantMizaId = tenantMiza!.id;

  const [prostor] = await db.insert(prostoriTable).values({
    enotaId,
    ime: `Terasa ${RUN_ID}`,
  }).returning({ id: prostoriTable.id });

  const [miza] = await db.insert(mizeTable).values({
    enotaId,
    stevilka: 7,
    ime: `Miza 7 ${RUN_ID}`,
    prostorId: prostor!.id,
    qrToken,
  }).returning({ id: mizeTable.id });
  mizaId = miza!.id;

  const [tujaMiza] = await db.insert(mizeTable).values({
    enotaId: drugaEnotaId,
    stevilka: 8,
  }).returning({ id: mizeTable.id });
  tujaMizaId = tujaMiza!.id;

  const [kategorija] = await db.insert(kategorijeTable).values({
    enotaId,
    ime: `Pijače ${RUN_ID}`,
    vrstniRed: 1,
  }).returning({ id: kategorijeTable.id });
  kategorijaId = kategorija!.id;
  const [embalazaKategorija] = await db.insert(kategorijeTable).values({
    enotaId,
    ime: "eMbAlAžA",
    vrstniRed: 2,
  }).returning({ id: kategorijeTable.id });
  embalazaKategorijaId = embalazaKategorija!.id;

  const [vidniArtikel] = await db.insert(artikliTable).values({
    enotaId,
    ime: `Kava ${RUN_ID}`,
    opis: "Dvojni espresso",
    slikaUrl: "/api/storage/public-objects/article-images/test-kava.jpg",
    cena: "2.70",
    davek: "22",
    kategorijaId: kategorija!.id,
    prodajniArtikel: true,
    qrNaVoljo: true,
    jeAlkohol: false,
    toGo: true,
  }).returning({ id: artikliTable.id });
  vidniArtikelId = vidniArtikel!.id;

  const [embalazaArtikel] = await db.insert(artikliTable).values({
    enotaId,
    ime: `Embalaža ${RUN_ID}`,
    cena: "0.30",
    davek: "22",
    kategorijaId: embalazaKategorijaId,
    prodajniArtikel: false,
    qrNaVoljo: false,
  }).returning({ id: artikliTable.id });
  embalazaArtikelId = embalazaArtikel!.id;
  await db.update(artikliTable)
    .set({ toGoArtikli: [embalazaArtikelId] })
    .where(eq(artikliTable.id, vidniArtikelId));

  await db.insert(artikliTable).values([
    {
      enotaId,
      ime: `Skrit QR ${RUN_ID}`,
      cena: "1.00",
      davek: "22",
      kategorijaId: kategorija!.id,
      qrNaVoljo: false,
    },
    {
      enotaId,
      ime: `Ni prodajni ${RUN_ID}`,
      cena: "1.00",
      davek: "22",
      kategorijaId: kategorija!.id,
      prodajniArtikel: false,
    },
    {
      enotaId: drugaEnotaId,
      ime: `Tuj artikel ${RUN_ID}`,
      cena: "1.00",
      davek: "22",
      qrNaVoljo: true,
    },
  ]);

  const [skupina] = await db.insert(modSkupineTable).values({
    enotaId,
    ime: `Mleko ${RUN_ID}`,
    obvezna: true,
    minIzbir: 1,
    maxIzbir: 1,
  }).returning({ id: modSkupineTable.id });
  skupinaId = skupina!.id;
  await db.insert(artModSkupineTable).values({
    artikelId: vidniArtikelId,
    skupinaId: skupina!.id,
  });
  await db.insert(modifikatorjiTable).values([
    {
      skupinaId: skupina!.id,
      ime: `Ovseno ${RUN_ID}`,
      cenaDodatek: "0.50",
      aktiven: true,
    },
    {
      skupinaId: skupina!.id,
      ime: `Neaktivno ${RUN_ID}`,
      cenaDodatek: "4.00",
      aktiven: false,
    },
  ]);
});

afterAll(async () => {
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId)).catch(() => {});
  await db.delete(companiesTable).where(eq(companiesTable.id, tenantCompanyId)).catch(() => {});
  await pool.end();
});

describe("javni QR meni", () => {
  describe("dostop glede na POS paket in zmožnost QR menija", () => {
    it.each([
      { name: "Lite", plan: "lite", qrMenu: true, allowed: false },
      { name: "Standard", plan: "standard", qrMenu: true, allowed: false },
      { name: "Extended brez qr_menu", plan: "extended", qrMenu: false, allowed: false },
      { name: "brez zapisa paketa (privzeto Lite)", plan: null, qrMenu: true, allowed: false },
      { name: "Extended s qr_menu", plan: "extended", qrMenu: true, allowed: true },
    ] as const)("$name: preveri meni in klic natakarja z veljavno aktivacijsko sejo", async ({ plan, qrMenu, allowed }) => {
      const [units, plans] = await Promise.all([
        db.select({ capabilities: enoteTable.capabilities }).from(enoteTable).where(eq(enoteTable.id, enotaId)),
        db.select().from(companyPosPlansTable).where(eq(companyPosPlansTable.companyId, companyId)),
      ]);
      const originalUnit = units[0]!;
      const originalPlan = plans[0]!;
      expect(originalUnit).toBeDefined();
      expect(originalPlan).toBeDefined();

      try {
        if (plan === null) {
          await db.delete(companyPosPlansTable).where(eq(companyPosPlansTable.companyId, companyId));
        } else {
          await db.update(companyPosPlansTable).set({ plan }).where(eq(companyPosPlansTable.companyId, companyId));
        }
        const capabilities: typeof originalUnit.capabilities =
          originalUnit.capabilities.filter(capability => capability !== "qr_menu");
        if (qrMenu) capabilities.push("qr_menu");
        await db.update(enoteTable).set({ capabilities }).where(eq(enoteTable.id, enotaId));

        // Sejo podamo izrecno, da zavrnitev ni posledica manjkajočega tokena ali aktivacije.
        const qrNapravaId = randomUUID();
        const session = createQrActivationSessionForTest({ token: qrToken, enotaId, mizaId, qrNapravaId });
        const cookie = `bookie_qr_activation=${encodeURIComponent(session)}`;
        const app = publicApp(false);
        const menu = await supertest(app).get(`/javno/meni/${qrToken}`)
          .query({ qrNapravaId }).set("Cookie", cookie);
        const waiter = await supertest(app).post(`/javno/meni/${qrToken}/natakar`)
          .set("Cookie", cookie).send({ qrNapravaId });
        const current = await supertest(app).get(`/javno/meni/${qrToken}/natakar/trenutni`)
          .query({ qrNapravaId }).set("Cookie", cookie);

        if (allowed) {
          expect(menu.status).toBe(200);
          expect(menu.body.miza).toMatchObject({ stevilka: 7, naziv: `Miza 7 ${RUN_ID}` });
          expect(waiter.status).toBe(201);
          expect(waiter.body).toMatchObject({ id: expect.any(Number), stanje: "caka" });
          expect(current.status).toBe(200);
          expect(current.body).toMatchObject({ id: waiter.body.id, stanje: "caka" });
        } else {
          for (const response of [menu, waiter, current]) {
            expect(response.status).toBe(404);
            expect(response.body).toEqual({ error: "Javni meni ni najden" });
          }
        }
      } finally {
        // Spremenimo le lastne testne podatke in jih obnovimo tudi ob neuspešnem testu.
        await db.update(enoteTable).set({ capabilities: originalUnit.capabilities }).where(eq(enoteTable.id, enotaId));
        await db.insert(companyPosPlansTable).values(originalPlan).onConflictDoUpdate({
          target: companyPosPlansTable.companyId,
          set: { plan: originalPlan.plan, enabledBy: originalPlan.enabledBy, enabledAt: originalPlan.enabledAt },
        });
      }
    });
  });

  it("skrije zmožnost in zavrne AI klic, ko je asistent za enoto izklopljen", async () => {
    await db.update(nastavitveTable)
      .set({ vrednost: "false" })
      .where(and(
        eq(nastavitveTable.enotaId, enotaId),
        eq(nastavitveTable.kljuc, "qrAiAsistentAktiven"),
      ));
    try {
      const menu = await supertest(publicApp()).get(`/javno/meni/${qrToken}`)
        .query({ qrNapravaId: TEST_QR_NAPRAVA_ID });
      expect(menu.status).toBe(200);
      expect(menu.body.qrAiAsistentAktiven).toBe(false);

      const ai = await supertest(publicApp()).post(`/javno/meni/${qrToken}/ai`).send({
        qrNapravaId: TEST_QR_NAPRAVA_ID,
        historyOptIn: false,
        question: "Kaj priporočaš?",
      });
      expect(ai.status).toBe(404);
      expect(anthropicCreateMock).not.toHaveBeenCalled();
    } finally {
      await db.update(nastavitveTable)
        .set({ vrednost: "true" })
        .where(and(
          eq(nastavitveTable.enotaId, enotaId),
          eq(nastavitveTable.kljuc, "qrAiAsistentAktiven"),
        ));
    }
  });

  it("kanonični pogled upošteva vidnost, ročno razpoložljivost in pripravljene sestavljene jedi", () => {
    expect(projectPublicAvailability([
      { id: 4, active: true, salesArticle: true, qrVisible: true, mealType: "composite", availableQuantity: 0 },
      { id: 2, active: true, salesArticle: true, qrVisible: true, mealType: "prepared", availableQuantity: 3 },
      { id: 3, active: true, salesArticle: true, qrVisible: false, mealType: "ala_carte", availableQuantity: null },
      { id: 1, active: false, salesArticle: true, qrVisible: true, mealType: "ala_carte", availableQuantity: null },
    ])).toEqual([
      { id: 2, naVoljo: true, availableQuantity: 3 },
      { id: 3, naVoljo: false, availableQuantity: null },
      { id: 4, naVoljo: false, availableQuantity: 0 },
    ]);
  });

  it("administratorski predogled aktivira meni s podpisanim dovoljenjem brez GPS preverjanja", async () => {
    const previewSession = createQrActivationSessionForTest({
      token: qrToken,
      enotaId,
      mizaId,
      qrNapravaId: TEST_QR_NAPRAVA_ID,
    });

    const response = await supertest(publicApp(false))
      .post(`/javno/meni/${qrToken}/aktivacija`)
      .send({
        qrNapravaId: TEST_QR_NAPRAVA_ID,
        previewSession,
      });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ aktivirano: true });
  });

  it("gost lahko spremeni napitnino odprtega QR naročila brez dodajanja nove postavke", async () => {
    const qrNapravaId = randomUUID();
    const [order] = await db.insert(narocilaTable).values({
      enotaId,
      mizaId,
      status: "odprto",
      vir: "qr_gost",
      qrNapravaId,
      skupaj: "12.00",
      znesekNapitnina: "1.00",
    }).returning({ id: narocilaTable.id });
    const session = createQrActivationSessionForTest({ token: qrToken, enotaId, mizaId, qrNapravaId });

    const response = await supertest(publicApp(false))
      .post(`/javno/meni/${qrToken}/napitnina`)
      .set("Cookie", `bookie_qr_activation=${encodeURIComponent(session)}`)
      .send({ qrNapravaId, znesekNapitnina: 0 });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ znesekNapitnina: 0 });
    const [saved] = await db.select({ tip: narocilaTable.znesekNapitnina })
      .from(narocilaTable)
      .where(eq(narocilaTable.id, order!.id));
    expect(saved?.tip).toBe("0.00");
  });

  it("SSE razpoložljivosti zahteva pravilno QR sejo iste mize, enote in naprave", async () => {
    const endpoint = `/javno/meni/${qrToken}/dogodki?qrNapravaId=${TEST_QR_NAPRAVA_ID}`;
    const withoutSession = await supertest(publicApp(false)).get(endpoint);
    expect(withoutSession.status).toBe(401);

    const wrongDeviceSession = createQrActivationSessionForTest({
      token: qrToken,
      enotaId,
      mizaId,
      qrNapravaId: "12345678-1234-4123-8123-123456789abd",
    });
    const wrongDevice = await supertest(publicApp(false))
      .get(endpoint)
      .set("Cookie", `bookie_qr_activation=${encodeURIComponent(wrongDeviceSession)}`);
    expect(wrongDevice.status).toBe(401);

    // Miza druge enote ne sme odpreti toka niti, če pozna veljavni QR token.
    const foreignTableSession = createQrActivationSessionForTest({
      token: qrToken,
      enotaId: drugaEnotaId,
      mizaId: tujaMizaId,
      qrNapravaId: TEST_QR_NAPRAVA_ID,
    });
    const foreignTable = await supertest(publicApp(false))
      .get(endpoint)
      .set("Cookie", `bookie_qr_activation=${encodeURIComponent(foreignTableSession)}`);
    expect(foreignTable.status).toBe(401);

    const stream = await readFirstSseEvent(publicApp(), endpoint);
    expect(stream.event).toBe("ready");
    await stream.close();
  });

  it("po oddaji ocene ne hrani QR naprave in enkratnost atomsko veže na naročilo", async () => {
    const qrNapravaId = randomUUID();
    const drugaNapravaId = randomUUID();
    const [order] = await db.insert(narocilaTable).values({
      enotaId, mizaId, status: "zakljuceno", vir: "qr_gost", qrNapravaId,
    }).returning({ id: narocilaTable.id });
    const [foreignOrder] = await db.insert(narocilaTable).values({
      enotaId: drugaEnotaId, mizaId: tujaMizaId, status: "zakljuceno", vir: "qr_gost", qrNapravaId,
    }).returning({ id: narocilaTable.id });
    const [line] = await db.insert(postavkeTable).values({
      narociloId: order!.id, ime: `Ocenjena kava ${RUN_ID}`,
      cenaKos: "2.70", skupaj: "2.70", davek: "22",
    }).returning({ id: postavkeTable.id });
    const payload = {
      qrNapravaId,
      foodScore: 5,
      ambienceScore: 4,
      serviceScore: 3,
      itemScores: { [line!.id]: 5 },
      comment: "Odlično",
      consentVersion: "v1",
    };

    try {
      const endpoint = `/javno/meni/${qrToken}/narocila/${order!.id}/povratna-informacija`;
      const submissions = await Promise.all([
        supertest(publicApp()).post(endpoint).send(payload),
        supertest(publicApp()).post(endpoint).send(payload),
      ]);
      expect(submissions.map((response) => response.status).sort()).toEqual([201, 409]);

      const feedbackRows = await db.select({
        narociloId: qrGostPovratneInformacijeTable.narociloId,
        enotaId: qrGostPovratneInformacijeTable.enotaId,
        hranaOcena: qrGostPovratneInformacijeTable.hranaOcena,
      }).from(qrGostPovratneInformacijeTable)
        .where(eq(qrGostPovratneInformacijeTable.narociloId, order!.id));
      expect(feedbackRows).toEqual([{ narociloId: order!.id, enotaId, hranaOcena: 5 }]);

      const storedColumns = await pool.query<{ column_name: string }>(
        `SELECT column_name FROM information_schema.columns
         WHERE table_schema = current_schema()
           AND table_name = 'qr_gost_povratne_informacije'`,
      );
      expect(storedColumns.rows.map((row) => row.column_name)).not.toContain("qr_naprava_id");

      const completion = await supertest(publicApp())
        .get(`/javno/meni/${qrToken}/narocila/${order!.id}/zakljucek?qrNapravaId=${qrNapravaId}`);
      expect(completion.status).toBe(200);
      expect(completion.body).toMatchObject({ completed: true, feedbackEligible: false });

      const wrongDevice = await supertest(publicApp()).post(endpoint).send({ ...payload, qrNapravaId: drugaNapravaId });
      expect(wrongDevice.status).toBe(404);
      const foreignTenant = await supertest(publicApp())
        .post(`/javno/meni/${qrToken}/narocila/${foreignOrder!.id}/povratna-informacija`)
        .send(payload);
      expect(foreignTenant.status).toBe(404);
    } finally {
      await db.delete(qrGostPovratneInformacijeTable).where(eq(qrGostPovratneInformacijeTable.narociloId, order!.id));
      await db.delete(postavkeTable).where(eq(postavkeTable.narociloId, order!.id));
      await db.delete(narocilaTable).where(eq(narocilaTable.id, order!.id));
      await db.delete(narocilaTable).where(eq(narocilaTable.id, foreignOrder!.id));
    }
  });

  it("SSE po spremembi kanonične razpoložljivosti pošlje le signal za ponovno nalaganje", async () => {
    const endpoint = `/javno/meni/${qrToken}/dogodki?qrNapravaId=${TEST_QR_NAPRAVA_ID}`;
    const stream = await readFirstSseEvent(publicApp(), endpoint);
    expect(stream.event).toBe("ready");
    try {
      await db.update(artikliTable).set({ qrNaVoljo: false }).where(eq(artikliTable.id, vidniArtikelId));
      expect(await stream.nextEvent()).toBe("availability");
    } finally {
      await db.update(artikliTable).set({ qrNaVoljo: true }).where(eq(artikliTable.id, vidniArtikelId));
      await stream.close();
    }
  });

  it("izračuna ceno dodatka za vsak kos postavke", () => {
    expect(izracunajQrPostavkaCeno(10, 3, [{ cenaDodatek: 2 }])).toEqual({
      artikelCena: 10,
      modifikatorjiCena: 6,
      skupajCena: 36,
      cenaKos: 12,
    });
  });

  it("izračuna razdaljo za 50-metrsko geografsko omejitev", () => {
    expect(qrGeoDistanceMeters(
      TEST_QR_LATITUDE,
      TEST_QR_LONGITUDE,
      TEST_QR_LATITUDE + 0.0004,
      TEST_QR_LONGITUDE,
    )).toBeGreaterThan(40);
    expect(qrGeoDistanceMeters(
      TEST_QR_LATITUDE,
      TEST_QR_LONGITUDE,
      TEST_QR_LATITUDE + 0.0004,
      TEST_QR_LONGITUDE,
    )).toBeLessThan(50);
  });

  it("pravilno preveri IPv4 in IPv6 CIDR lokalnega Wi-Fi-ja", () => {
    expect(isValidIpNetwork("8.8.8.0/24")).toBe(true);
    expect(isValidIpNetwork("2606:4700:4700::/48")).toBe(true);
    expect(isValidIpNetwork("203.0.113.0/35")).toBe(false);
    expect(isValidIpNetwork("0.0.0.0/0")).toBe(false);
    expect(isValidIpNetwork("::/0")).toBe(false);
    expect(isValidIpNetwork("192.168.1.1")).toBe(false);
    expect(isValidIpNetwork("127.0.0.1")).toBe(false);
    expect(isValidIpNetwork("169.254.0.0/24")).toBe(false);
    expect(isValidIpNetwork("8.0.0.0/8")).toBe(false);
    expect(isValidIpNetwork("2001:db8::/48")).toBe(false);
    expect(ipMatchesNetwork("8.8.8.42", "8.8.8.0/24")).toBe(true);
    expect(ipMatchesNetwork("1.1.1.42", "8.8.8.0/24")).toBe(false);
    expect(ipMatchesNetwork("2606:4700:4700::42", "2606:4700:4700::/48")).toBe(true);
  });

  it("adminu vrne prvi javni IP za notranjo Replit proxy verigo", async () => {
    const response = await supertest(enoteApp())
      .get("/current-public-ip")
      .set("X-Forwarded-For", "8.8.8.42, 10.48.14.127, 127.0.0.1");
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ javniIp: "8.8.8.42", veljavenZaQrWifi: true });
  });

  it("zahteva aktivacijo ter jo dovoli samo znotraj 50 m in z dovolj natančnim GPS", async () => {
    const brezSeje = await supertest(publicApp(false))
      .get(`/javno/meni/${qrToken}?qrNapravaId=${TEST_QR_NAPRAVA_ID}`);
    expect(brezSeje.status).toBe(401);

    const strictApp = publicApp(false);
    const dovoljena = await supertest(strictApp)
      .post(`/javno/meni/${qrToken}/aktivacija`)
      .send({
        qrNapravaId: TEST_QR_NAPRAVA_ID,
        latitude: TEST_QR_LATITUDE + 0.0002,
        longitude: TEST_QR_LONGITUDE,
        accuracy: 12,
      });
    expect(dovoljena.status, JSON.stringify(dovoljena.body)).toBe(200);
    expect(dovoljena.body).toMatchObject({ aktivirano: true, radijMetri: 50 });
    const activationCookie = dovoljena.headers["set-cookie"]?.[0]?.split(";")[0];
    expect(activationCookie).toBeDefined();

    const meni = await supertest(strictApp)
      .get(`/javno/meni/${qrToken}?qrNapravaId=${TEST_QR_NAPRAVA_ID}`)
      .set("Cookie", activationCookie!);
    expect(meni.status).toBe(200);

    const zunaj = await supertest(publicApp(false))
      .post(`/javno/meni/${qrToken}/aktivacija`)
      .send({
        qrNapravaId: TEST_QR_NAPRAVA_ID,
        latitude: TEST_QR_LATITUDE + 0.001,
        longitude: TEST_QR_LONGITUDE,
        accuracy: 10,
      });
    expect(zunaj.status).toBe(403);
    expect(zunaj.body.error).toContain("50 m");

    const robZNapako = await supertest(publicApp(false))
      .post(`/javno/meni/${qrToken}/aktivacija`)
      .send({
        qrNapravaId: TEST_QR_NAPRAVA_ID,
        latitude: TEST_QR_LATITUDE + 0.0004,
        longitude: TEST_QR_LONGITUDE,
        accuracy: 10,
      });
    expect(robZNapako.status).toBe(403);

    const nenatancna = await supertest(publicApp(false))
      .post(`/javno/meni/${qrToken}/aktivacija`)
      .send({
        qrNapravaId: TEST_QR_NAPRAVA_ID,
        latitude: TEST_QR_LATITUDE,
        longitude: TEST_QR_LONGITUDE,
        accuracy: 75,
      });
    expect(nenatancna.status).toBe(403);
    expect(nenatancna.body.error).toContain("natančno");

    const napacnaNaprava = await supertest(strictApp)
      .get(`/javno/meni/${qrToken}?qrNapravaId=${randomUUID()}`)
      .set("Cookie", activationCookie!);
    expect(napacnaNaprava.status).toBe(401);
  });

  it("že veljavne administratorske QR seje ne preverja ponovno z GPS", async () => {
    const session = createQrActivationSessionForTest({
      token: qrToken,
      enotaId,
      mizaId,
      qrNapravaId: TEST_QR_NAPRAVA_ID,
    });
    const response = await supertest(publicApp(false))
      .post(`/javno/meni/${qrToken}/aktivacija`)
      .set("Cookie", `bookie_qr_activation=${encodeURIComponent(session)}`)
      .send({ qrNapravaId: TEST_QR_NAPRAVA_ID });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({ aktivirano: true, radijMetri: 50 });
  });

  it("brez GPS signala aktivira meni samo prek dovoljenega javnega IP-ja Wi-Fi-ja", async () => {
    const strictApp = publicApp(false);
    const dovoljenWifi = await supertest(strictApp)
      .post(`/javno/meni/${qrToken}/aktivacija`)
      .set("X-Forwarded-For", "8.8.8.42, 10.48.14.127, 127.0.0.1")
      .send({ qrNapravaId: TEST_QR_NAPRAVA_ID });
    expect(dovoljenWifi.status, JSON.stringify(dovoljenWifi.body)).toBe(200);
    expect(dovoljenWifi.body).toMatchObject({ aktivirano: true, nacin: "wifi" });

    const tujNaslov = await supertest(strictApp)
      .post(`/javno/meni/${qrToken}/aktivacija`)
      .set("X-Forwarded-For", "1.1.1.42")
      .send({ qrNapravaId: TEST_QR_NAPRAVA_ID });
    expect(tujNaslov.status).toBe(403);
    expect(tujNaslov.body.error).toContain("lokalni Wi-Fi");

    const nenatancenGpsNaWifi = await supertest(strictApp)
      .post(`/javno/meni/${qrToken}/aktivacija`)
      .set("X-Forwarded-For", "8.8.8.42")
      .send({
        qrNapravaId: TEST_QR_NAPRAVA_ID,
        latitude: TEST_QR_LATITUDE,
        longitude: TEST_QR_LONGITUDE,
        accuracy: 100,
      });
    expect(nenatancenGpsNaWifi.status).toBe(200);
    expect(nenatancenGpsNaWifi.body.nacin).toBe("wifi");
  });

  it("zavrne delni GPS nabor in neznana polja tudi na dovoljenem Wi-Fi-ju", async () => {
    const strictApp = publicApp(false);
    for (const delniGps of [
      { latitude: TEST_QR_LATITUDE },
      { longitude: TEST_QR_LONGITUDE },
      { accuracy: 10 },
      { latitude: TEST_QR_LATITUDE, longitude: TEST_QR_LONGITUDE },
    ]) {
      const response = await supertest(strictApp)
        .post(`/javno/meni/${qrToken}/aktivacija`)
        .set("X-Forwarded-For", "8.8.8.42")
        .send({ qrNapravaId: TEST_QR_NAPRAVA_ID, ...delniGps });
      expect(response.status).toBe(400);
      expect(response.body.error).toContain("širina, dolžina in natančnost");
    }

    const neznanoPolje = await supertest(strictApp)
      .post(`/javno/meni/${qrToken}/aktivacija`)
      .set("X-Forwarded-For", "8.8.8.42")
      .send({ qrNapravaId: TEST_QR_NAPRAVA_ID, bypass: true });
    expect(neznanoPolje.status).toBe(400);
    expect(neznanoPolje.body.error).toContain("neznana polja");
  });

  it("admin dobi obstoječi token in se lastništvo mize preveri po enoti", async () => {
    const obstojece = await supertest(mizeApp(enotaId, "admin")).get(`/mize/${mizaId}/qr-token`);
    expect(obstojece.status).toBe(200);
    expect(obstojece.body).toEqual({ qrToken, javniUrl: `/meni/${qrToken}` });

    const tuja = await supertest(mizeApp(enotaId, "admin"))
      .post(`/mize/${tujaMizaId}/qr-token`);
    expect(tuja.status).toBe(404);
  });

  it("samo admin in admin_enote smeta generirati nov token", async () => {
    const zavrnjen = await supertest(mizeApp(enotaId, "uporabnik"))
      .post(`/mize/${mizaId}/qr-token`);
    expect(zavrnjen.status).toBe(403);

    const ustvarjen = await supertest(mizeApp(enotaId, "admin_enote"))
      .post(`/mize/${mizaId}/qr-token`);
    expect(ustvarjen.status).toBe(200);
    expect(ustvarjen.body.qrToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(ustvarjen.body.qrToken).not.toBe(qrToken);
    expect(ustvarjen.body.javniUrl).toBe(`/meni/${ustvarjen.body.qrToken}`);
    qrToken = ustvarjen.body.qrToken;
  });

  it("brez prijave vrne samo dovoljena polja, izdelke iste enote in označi QR razpoložljivost", async () => {
    const response = await supertest(publicApp()).get(`/javno/meni/${qrToken}`);

    expect(response.status).toBe(200);
    expect(response.body.lokal).toEqual({
      podjetjeNaziv: `QR lokal ${RUN_ID}`,
      enotaNaziv: `QR enota ${RUN_ID}`,
    });
    expect(response.body.miza).toEqual({
      stevilka: 7,
      naziv: `Miza 7 ${RUN_ID}`,
      prostorNaziv: `Terasa ${RUN_ID}`,
    });
    expect(response.body.miza).not.toHaveProperty("id");
    expect(response.body.artikli).toHaveLength(2);

    const artikel = response.body.artikli.find((item: { id: number }) => item.id === vidniArtikelId);
    expect(artikel).toMatchObject({
      id: vidniArtikelId,
      naziv: `Kava ${RUN_ID}`,
      opis: "Dvojni espresso",
      slikaUrl: "/api/storage/public-objects/article-images/test-kava.jpg",
      cena: 2.7,
      jeAlkohol: false,
      naVoljo: true,
      toGo: true,
      toGoEmbalaza: [{
        id: embalazaArtikelId,
        naziv: `Embalaža ${RUN_ID}`,
        cena: 0.3,
      }],
      kategorija: { naziv: `Pijače ${RUN_ID}` },
      modifikatorji: [{
        naziv: `Mleko ${RUN_ID}`,
        obvezna: true,
        minIzbir: 1,
        maxIzbir: 1,
        opcije: [{ naziv: `Ovseno ${RUN_ID}`, cena: 0.5 }],
      }],
    });
    expect(artikel).not.toHaveProperty("davek");
    expect(artikel).not.toHaveProperty("taxCategory");
    expect(artikel).not.toHaveProperty("nabavnaDdvStopnja");
    expect(artikel).not.toHaveProperty("qrNaVoljo");
    expect(artikel.kategorija).not.toHaveProperty("id");
    expect(response.body.kategorije[0].artikli[0].id).toBe(vidniArtikelId);
    const artikelBrezSlike = response.body.artikli.find(
      (item: { id: number }) => item.id !== vidniArtikelId,
    );
    expect(artikelBrezSlike).toMatchObject({
      naVoljo: false,
      slikaUrl: null,
    });
  });

  it("neveljaven ali neobstoječ token ne razkrije podatkov", async () => {
    const malformed = await supertest(publicApp()).get("/javno/meni/neveljaven");
    expect(malformed.status).toBe(404);

    const unknown = await supertest(publicApp())
      .get(`/javno/meni/${randomBytes(32).toString("base64url")}`);
    expect(unknown.status).toBe(404);
  });

  it("omeji število javnih zahtev na IP v enem časovnem oknu", async () => {
    const app = publicApp();
    for (let index = 0; index < 60; index += 1) {
      const response = await supertest(app).get(`/javno/meni/${qrToken}`);
      expect(response.status).toBe(200);
    }

    const limited = await supertest(app).get(`/javno/meni/${qrToken}`);
    expect(limited.status).toBe(429);
    expect(limited.headers["retry-after"]).toBeDefined();
  });

  it("ustvari QR naročilo po strežniških cenah, ne porabi prihodnje rezervacije in alkohol takoj pošlje v pripravo", async () => {
    const qrNapravaId = randomUUID();
    const [rezervacijaNarocnik] = await db.insert(narocnikiTable).values({
      enotaId,
      ime: "QR rezervacija",
      telefon: "040 555 444",
      telefonNormaliziran: "+38640555444",
    }).returning({ id: narocnikiTable.id });
    const [rezervacija] = await db.insert(rezervacijeMizTable).values({
      enotaId,
      mizaId,
      narocnikId: rezervacijaNarocnik!.id,
      strankaIme: "QR rezervacija",
      telefon: "040 555 444",
      opomba: "Prihod prek QR menija",
      zacetek: new Date(Date.now() + 4 * 60 * 60 * 1000),
    }).returning({ id: rezervacijeMizTable.id });
    const [modifikator] = await db.select({ id: modifikatorjiTable.id })
      .from(modifikatorjiTable)
      .where(and(eq(modifikatorjiTable.skupinaId, skupinaId), eq(modifikatorjiTable.aktiven, true)));
    const [alkohol] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Pivo ${RUN_ID}`,
      cena: "4.20",
      davek: "22",
      qrNaVoljo: true,
      prodajniArtikel: true,
      jeAlkohol: true,
    }).returning({ id: artikliTable.id });

    const response = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({
        qrNapravaId,
        cena: 0,
        postavke: [
          { artikelId: vidniArtikelId, kolicina: 2, modifikatorji: [modifikator!.id], cenaKos: 0, toGo: true },
          { artikelId: alkohol!.id, kolicina: 1, modifikatorji: [], cenaKos: 0 },
        ],
      });

    expect(response.status, JSON.stringify(response.body)).toBe(201);
    expect(response.body).toMatchObject({
      stanje: "sprejeto",
    });
    expect(response.body).not.toHaveProperty("cakaPotrditev");
    expect(response.body.predvidenPrevzem).toEqual(expect.any(String));
    expect(broadcastMock).toHaveBeenCalledWith(enotaId, "update", {
      type: "narocilo",
      id: response.body.narociloId,
    });

    const [narocilo] = await db.select({
      vir: narocilaTable.vir,
      mizaId: narocilaTable.mizaId,
      skupaj: narocilaTable.skupaj,
      znesekNapitnina: narocilaTable.znesekNapitnina,
      qrNapravaId: narocilaTable.qrNapravaId,
      narocnikId: narocilaTable.narocnikId,
    }).from(narocilaTable).where(eq(narocilaTable.id, response.body.narociloId));
    expect(narocilo).toMatchObject({
      vir: "qr_gost",
      mizaId,
      skupaj: "11.20",
      znesekNapitnina: "0.00",
      qrNapravaId,
      narocnikId: null,
    });
    const [narocnikPoQrNarocilu] = await db.select().from(narocnikiTable)
      .where(eq(narocnikiTable.id, rezervacijaNarocnik!.id));
    expect(narocnikPoQrNarocilu?.steviloNarocil).toBe(0);
    expect(narocnikPoQrNarocilu?.zadnjeNarocilo).toBeNull();
    const [rezervacijaPoQrNarocilu] = await db.select({
      status: rezervacijeMizTable.status,
      narociloId: rezervacijeMizTable.narociloId,
    }).from(rezervacijeMizTable).where(eq(rezervacijeMizTable.id, rezervacija!.id));
    expect(rezervacijaPoQrNarocilu).toEqual({ status: "aktivna", narociloId: null });

    const ponovitev = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({
        qrNapravaId,
        postavke: [
          { artikelId: vidniArtikelId, kolicina: 1, modifikatorji: [modifikator!.id], toGo: true },
        ],
      });
    expect(ponovitev.status, JSON.stringify(ponovitev.body)).toBe(201);
    expect(ponovitev.body.narociloId).toBe(response.body.narociloId);
    const [narocnikPoPonovitvi] = await db.select().from(narocnikiTable)
      .where(eq(narocnikiTable.id, rezervacijaNarocnik!.id));
    expect(narocnikPoPonovitvi?.steviloNarocil).toBe(0);
    const [mizaPoNarocilu] = await db.select().from(mizeTable).where(eq(mizeTable.id, mizaId));
    expect(mizaPoNarocilu).toMatchObject({
      status: "zasedena",
      rezervacijaNarocnikId: null,
      rezervacijaStrankaIme: null,
      rezervacijaTelefon: null,
      rezervacijaOpomba: null,
      rezervacijaVeljaDo: null,
    });

    const postavke = await db.select({
      artikelId: postavkeTable.artikelId,
      modifikatorId: postavkeTable.modifikatorId,
      kolicina: postavkeTable.kolicina,
      cenaKos: postavkeTable.cenaKos,
      skupaj: postavkeTable.skupaj,
      toGo: postavkeTable.toGo,
      parentPostavkaId: postavkeTable.parentPostavkaId,
      statusPotrditve: postavkeTable.statusPotrditve,
    }).from(postavkeTable).where(eq(postavkeTable.narociloId, response.body.narociloId));
    expect(postavke).toEqual(expect.arrayContaining([
      expect.objectContaining({
        artikelId: vidniArtikelId,
        cenaKos: "2.70",
        skupaj: "5.40",
        toGo: true,
        statusPotrditve: "ni_potrebno",
      }),
      expect.objectContaining({
        modifikatorId: modifikator!.id,
        kolicina: 2,
        cenaKos: "0.50",
        skupaj: "1.00",
        statusPotrditve: "ni_potrebno",
      }),
      expect.objectContaining({
        artikelId: embalazaArtikelId,
        kolicina: 2,
        cenaKos: "0.30",
        skupaj: "0.60",
        toGo: true,
        parentPostavkaId: expect.any(Number),
      }),
      expect.objectContaining({ artikelId: alkohol!.id, cenaKos: "4.20", statusPotrditve: "ni_potrebno" }),
    ]));

    const nedovoljenToGo = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({
        qrNapravaId: randomUUID(),
        postavke: [{ artikelId: alkohol!.id, kolicina: 1, modifikatorji: [], toGo: true }],
      });
    expect(nedovoljenToGo.status).toBe(400);
    expect(nedovoljenToGo.body.error).toContain("To Go");

    const removedConfirmation = await supertest(narocilaApp(enotaId))
      .post(`/narocila/${response.body.narociloId}/potrdi-alkohol`);
    expect(removedConfirmation.status).toBe(404);
  });

  it("zavrne novo QR naročilo v dvournem oknu in ohrani rezervacijo aktivno", async () => {
    const [narocnik] = await db.insert(narocnikiTable).values({
      enotaId,
      ime: "Prihajajoči gost",
      telefon: "031 111 222",
      telefonNormaliziran: "+38631111222",
    }).returning({ id: narocnikiTable.id });
    const [rezervacija] = await db.insert(rezervacijeMizTable).values({
      enotaId,
      mizaId,
      narocnikId: narocnik!.id,
      strankaIme: "Prihajajoči gost",
      telefon: "031 111 222",
      zacetek: new Date(Date.now() + 90 * 60 * 1000),
    }).returning({ id: rezervacijeMizTable.id });
    const [modifikator] = await db.select({ id: modifikatorjiTable.id })
      .from(modifikatorjiTable)
      .where(and(eq(modifikatorjiTable.skupinaId, skupinaId), eq(modifikatorjiTable.aktiven, true)));

    const response = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({
        qrNapravaId: randomUUID(),
        postavke: [{ artikelId: vidniArtikelId, kolicina: 1, modifikatorji: [modifikator!.id] }],
      });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("REZERVACIJA_BLOKIRA_QR_NAROCILO");
    const [poPoskusu] = await db.select({
      status: rezervacijeMizTable.status,
      narociloId: rezervacijeMizTable.narociloId,
    }).from(rezervacijeMizTable).where(eq(rezervacijeMizTable.id, rezervacija!.id));
    expect(poPoskusu).toEqual({ status: "aktivna", narociloId: null });
  });

  it("za QR pico uporabi ceno izbrane velikosti, ne osnovne ali poslane cene", async () => {
    const qrNapravaId = randomUUID();
    await db.insert(nastavitveTable).values([
      { enotaId, kljuc: "picaPremerMala", vrednost: "28" },
      { enotaId, kljuc: "picaPremerNormalna", vrednost: "32" },
      { enotaId, kljuc: "picaPremerDruzinska", vrednost: "36" },
    ]);
    const [pica] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Pica ${RUN_ID}`,
      cena: "8.90",
      cenaMala: "6.50",
      cenaDruzinska: "13.20",
      davek: "9.5",
      jePica: true,
      prodajniArtikel: true,
      qrNaVoljo: true,
    }).returning({ id: artikliTable.id });

    const meni = await supertest(publicApp()).get(`/javno/meni/${qrToken}`);
    expect(meni.status).toBe(200);
    const meniPica = meni.body.artikli.find((artikel: { id: number }) => artikel.id === pica!.id);
    expect(meniPica.velikostiPic).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "mala", cena: 6.5 }),
      expect.objectContaining({ id: "normalna", cena: 8.9 }),
      expect.objectContaining({ id: "druzinska", cena: 13.2 }),
    ]));

    const response = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({
        qrNapravaId,
        cena: 0,
        postavke: [{ artikelId: pica!.id, kolicina: 2, velikostPice: "druzinska", modifikatorji: [], cenaKos: 0 }],
      });
    expect(response.status).toBe(201);

    const [narocilo] = await db.select({ skupaj: narocilaTable.skupaj })
      .from(narocilaTable).where(eq(narocilaTable.id, response.body.narociloId));
    expect(narocilo!.skupaj).toBe("26.40");
    const [postavka] = await db.select({
      cenaKos: postavkeTable.cenaKos,
      skupaj: postavkeTable.skupaj,
      velikostPice: postavkeTable.velikostPice,
    }).from(postavkeTable).where(and(
      eq(postavkeTable.narociloId, response.body.narociloId),
      eq(postavkeTable.artikelId, pica!.id),
    ));
    expect(postavka).toMatchObject({ cenaKos: "13.20", skupaj: "26.40", velikostPice: "druzinska" });

    const withoutSize = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({
        qrNapravaId: randomUUID(),
        postavke: [{ artikelId: pica!.id, kolicina: 1, modifikatorji: [], cenaKos: 0 }],
      });
    expect(withoutSize.status).toBe(201);
    const [normalnaPostavka] = await db.select({
      cenaKos: postavkeTable.cenaKos,
      velikostPice: postavkeTable.velikostPice,
    }).from(postavkeTable).where(and(
      eq(postavkeTable.narociloId, withoutSize.body.narociloId),
      eq(postavkeTable.artikelId, pica!.id),
    ));
    expect(normalnaPostavka).toMatchObject({ cenaKos: "8.90", velikostPice: "normalna" });
  });

  it("zavrne manjkajoč obvezni modifikator in artikel, ki ni v javnem meniju", async () => {
    const missingModifier = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({ qrNapravaId: randomUUID(), postavke: [{ artikelId: vidniArtikelId, kolicina: 1, modifikatorji: [] }] });
    expect(missingModifier.status).toBe(400);

    const hidden = await db.select({ id: artikliTable.id }).from(artikliTable).where(and(
      eq(artikliTable.enotaId, enotaId),
      eq(artikliTable.qrNaVoljo, false),
    ));
    const unavailableArticle = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({ qrNapravaId: randomUUID(), postavke: [{ artikelId: hidden[0]!.id, kolicina: 1, modifikatorji: [] }] });
    expect(unavailableArticle.status).toBe(400);
  });

  it("ponovni QR obisk iz iste naprave pokaže zgodovino in novo košarico pripiše istemu naročilu", async () => {
    const qrNapravaId = randomUUID();
    const [modifikator] = await db.select({ id: modifikatorjiTable.id })
      .from(modifikatorjiTable)
      .where(and(eq(modifikatorjiTable.skupinaId, skupinaId), eq(modifikatorjiTable.aktiven, true)));
    const postavka = {
      artikelId: vidniArtikelId,
      kolicina: 1,
      modifikatorji: [modifikator!.id],
      toGo: true,
    };

    const prvo = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({ qrNapravaId, postavke: [postavka], znesekNapitnina: 1.25 });
    expect(prvo.status).toBe(201);
    const savedLines = await db.select({
      artikelId: postavkeTable.artikelId,
      modifikatorId: postavkeTable.modifikatorId,
      parentPostavkaId: postavkeTable.parentPostavkaId,
      jeEmbalaza: postavkeTable.jeEmbalaza,
    }).from(postavkeTable).where(eq(postavkeTable.narociloId, prvo.body.narociloId));
    expect(savedLines.find(line => line.artikelId === embalazaArtikelId)).toMatchObject({
      parentPostavkaId: expect.any(Number),
      jeEmbalaza: true,
    });
    expect(savedLines.find(line => line.modifikatorId != null)?.jeEmbalaza).toBe(false);

    const brezIdentitete = await supertest(publicApp()).get(`/javno/meni/${qrToken}`);
    expect(brezIdentitete.status).toBe(200);
    expect(brezIdentitete.body.obstojeceNarocilo).toBeNull();

    const ponovniObisk = await supertest(publicApp())
      .get(`/javno/meni/${qrToken}?qrNapravaId=${qrNapravaId}`);
    expect(ponovniObisk.status).toBe(200);
    expect(ponovniObisk.body.obstojeceNarocilo).toMatchObject({
      narociloId: prvo.body.narociloId,
      skupaj: 3.5,
      znesekNapitnina: 1.25,
      postavke: [expect.objectContaining({
        ime: `Kava ${RUN_ID}`,
        kolicina: 1,
        skupaj: 2.7,
        toGo: true,
        dodatki: expect.arrayContaining([
          expect.objectContaining({ tip: "modifikator", skupaj: 0.5 }),
          expect.objectContaining({ ime: `Embalaža ${RUN_ID}`, tip: "embalaza", skupaj: 0.3 }),
        ]),
      })],
    });

    const drugaNaprava = await supertest(publicApp())
      .get(`/javno/meni/${qrToken}?qrNapravaId=${randomUUID()}`);
    expect(drugaNaprava.status).toBe(200);
    expect(drugaNaprava.body.obstojeceNarocilo).toBeNull();

    const neuspesnaSpremembaNapitnine = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({
        qrNapravaId,
        postavke: [{ artikelId: -1, kolicina: 1 }],
        znesekNapitnina: 9.99,
      });
    expect(neuspesnaSpremembaNapitnine.status).toBe(400);

    const drugo = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({ qrNapravaId, postavke: [postavka], znesekNapitnina: 2.4 });
    expect(drugo.status).toBe(201);
    expect(drugo.body.narociloId).toBe(prvo.body.narociloId);

    const [zdruzenoNarocilo] = await db.select({
      skupaj: narocilaTable.skupaj,
      znesekNapitnina: narocilaTable.znesekNapitnina,
    })
      .from(narocilaTable)
      .where(eq(narocilaTable.id, prvo.body.narociloId));
    expect(zdruzenoNarocilo!.skupaj).toBe("7.00");
    expect(zdruzenoNarocilo!.znesekNapitnina).toBe("2.40");

    const osvezenObisk = await supertest(publicApp())
      .get(`/javno/meni/${qrToken}?qrNapravaId=${qrNapravaId}`);
    expect(osvezenObisk.body.obstojeceNarocilo).toMatchObject({
      narociloId: prvo.body.narociloId,
      skupaj: 7,
      znesekNapitnina: 2.4,
    });
    expect(osvezenObisk.body.obstojeceNarocilo.postavke).toHaveLength(2);

    const aktivnaPosNarocila = await supertest(narocilaApp(enotaId))
      .get("/narocila/aktivna");
    expect(aktivnaPosNarocila.status).toBe(200);
    expect(aktivnaPosNarocila.body).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: prvo.body.narociloId,
        skupaj: 7,
        znesekNapitnina: 2.4,
      }),
    ]));

    await db.update(narocilaTable).set({ status: "zakljuceno" })
      .where(eq(narocilaTable.id, prvo.body.narociloId));
    const zakljuceno = await supertest(publicApp())
      .get(`/javno/meni/${qrToken}?qrNapravaId=${qrNapravaId}`);
    expect(zakljuceno.body.obstojeceNarocilo).toBeNull();

    const novoPoZakljucku = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({ qrNapravaId, postavke: [postavka] });
    expect(novoPoZakljucku.status).toBe(201);
    expect(novoPoZakljucku.body.narociloId).not.toBe(prvo.body.narociloId);
  });

  it("po 30 dneh skrije in anonimizira samo terminalno QR zgodovino istega tenanta, odprto naročilo pa ohrani", async () => {
    const now = new Date();
    const qrNapravaId = randomUUID();
    const expiredAt = new Date(now.getTime() - QR_GUEST_HISTORY_RETENTION_MS);
    const freshAt = new Date(now.getTime() - QR_GUEST_HISTORY_RETENTION_MS + 60 * 60 * 1000);
    const [expired, fresh, foreign, oldOpen] = await db.insert(narocilaTable).values([
      {
        enotaId, mizaId, status: "zakljuceno", vir: "qr_gost", qrNapravaId,
        ustvarjeno: expiredAt, posodobljeno: expiredAt,
      },
      {
        enotaId, mizaId, status: "zakljuceno", vir: "qr_gost", qrNapravaId,
        ustvarjeno: freshAt, posodobljeno: freshAt,
      },
      {
        enotaId: tenantEnotaId, mizaId: tenantMizaId, status: "zakljuceno", vir: "qr_gost", qrNapravaId,
        ustvarjeno: freshAt, posodobljeno: freshAt,
      },
      {
        enotaId, mizaId, status: "odprto", vir: "qr_gost", qrNapravaId,
        ustvarjeno: expiredAt, posodobljeno: expiredAt,
      },
    ]).returning({ id: narocilaTable.id });
    await db.insert(postavkeTable).values([
      {
        narociloId: expired!.id, ime: "Prestara jed", kolicina: 1,
        cenaKos: "1.00", skupaj: "1.00", davek: "9.5",
      },
      {
        narociloId: fresh!.id, ime: "Sveža jed", kolicina: 1,
        cenaKos: "2.00", skupaj: "2.00", davek: "9.5",
      },
      {
        narociloId: foreign!.id, ime: "Tuja jed", kolicina: 1,
        cenaKos: "3.00", skupaj: "3.00", davek: "9.5",
      },
      {
        narociloId: oldOpen!.id, ime: "Odprta jed", kolicina: 1,
        cenaKos: "4.00", skupaj: "4.00", davek: "9.5",
      },
    ]);
    const [idempotencyRecord] = await db.insert(qrGostNarocilaTable).values({
      enotaId,
      mizaId,
      qrNapravaId,
      idempotencyKey: `retention_${RUN_ID}`,
      requestFingerprint: "retention-test-fingerprint",
      narociloId: expired!.id,
    }).returning({ id: qrGostNarocilaTable.id });
    const activationSession = createQrActivationSessionForTest({
      token: qrToken,
      enotaId,
      mizaId,
      qrNapravaId,
    });
    const activationCookie = `bookie_qr_activation=${encodeURIComponent(activationSession)}`;
    const explicitlyActivatedApp = publicApp(false);

    const historyBeforeCleanup = await supertest(explicitlyActivatedApp)
      .get(`/javno/meni/${qrToken}/zgodovina`)
      .set("Cookie", activationCookie)
      .query({ qrNapravaId, historyOptIn: "true" });
    expect(historyBeforeCleanup.status).toBe(200);
    expect(historyBeforeCleanup.body.orders.map((order: { orderId: number }) => order.orderId))
      .toEqual([fresh!.id]);

    const aiResponse = await supertest(explicitlyActivatedApp)
      .post(`/javno/meni/${qrToken}/ai`)
      .set("Cookie", activationCookie)
      .send({ qrNapravaId, historyOptIn: true, question: "Kaj mi priporočaš glede na prejšnji obisk?" });
    expect(aiResponse.status).toBe(200);
    expect(anthropicCreateMock).toHaveBeenCalledTimes(1);
    const aiPayload = anthropicCreateMock.mock.calls[0]![0];
    const aiInput = JSON.parse(aiPayload.messages[0].content) as {
      history: Array<{ createdAt: string; itemCount: number }>;
    };
    expect(aiInput.history).toEqual([{
      createdAt: freshAt.toISOString(),
      itemCount: 1,
      status: "zakljuceno",
    }]);

    expect(await anonymizeExpiredQrOrderDeviceLinks(now)).toBe(1);

    const retained = await db.select({
      id: narocilaTable.id,
      qrNapravaId: narocilaTable.qrNapravaId,
    }).from(narocilaTable).where(inArray(narocilaTable.id, [
      expired!.id, fresh!.id, foreign!.id, oldOpen!.id,
    ]));
    expect(new Map(retained.map(order => [order.id, order.qrNapravaId]))).toEqual(new Map([
      [expired!.id, null],
      [fresh!.id, qrNapravaId],
      [foreign!.id, qrNapravaId],
      [oldOpen!.id, qrNapravaId],
    ]));
    const [preservedIdempotency] = await db.select({
      id: qrGostNarocilaTable.id,
      qrNapravaId: qrGostNarocilaTable.qrNapravaId,
    }).from(qrGostNarocilaTable).where(eq(qrGostNarocilaTable.id, idempotencyRecord!.id));
    expect(preservedIdempotency).toEqual({
      id: idempotencyRecord!.id,
      qrNapravaId,
    });

    const currentOpenOrder = await supertest(explicitlyActivatedApp)
      .get(`/javno/meni/${qrToken}`)
      .set("Cookie", activationCookie)
      .query({ qrNapravaId });
    expect(currentOpenOrder.status).toBe(200);
    expect(currentOpenOrder.body.obstojeceNarocilo).toMatchObject({
      narociloId: oldOpen!.id,
      postavke: [expect.objectContaining({ ime: "Odprta jed" })],
    });

    const historyAfterCleanup = await supertest(explicitlyActivatedApp)
      .get(`/javno/meni/${qrToken}/zgodovina`)
      .set("Cookie", activationCookie)
      .query({ qrNapravaId, historyOptIn: "true" });
    expect(historyAfterCleanup.body.orders.map((order: { orderId: number }) => order.orderId))
      .toEqual([fresh!.id]);
  });

  it("idempotentno ponovi QR oddajo brez podvojenih postavk, nov ključ pa doda k istemu naročilu", async () => {
    const qrNapravaId = randomUUID();
    const [modifikator] = await db.select({ id: modifikatorjiTable.id }).from(modifikatorjiTable)
      .where(eq(modifikatorjiTable.skupinaId, skupinaId));
    const payload = {
      qrNapravaId,
      idempotencyKey: "qr_retry_key_0001",
      postavke: [{ artikelId: vidniArtikelId, kolicina: 1, modifikatorji: [modifikator!.id] }],
    };
    const app = publicApp();
    const first = await supertest(app).post(`/javno/meni/${qrToken}/narocilo`).send(payload);
    const retry = await supertest(app).post(`/javno/meni/${qrToken}/narocilo`).send(payload);
    expect(first.status).toBe(201);
    expect(retry.status).toBe(201);
    expect(retry.body.narociloId).toBe(first.body.narociloId);
    const afterRetry = await db.select({ id: postavkeTable.id }).from(postavkeTable)
      .where(and(eq(postavkeTable.narociloId, first.body.narociloId), isNull(postavkeTable.parentPostavkaId)));
    expect(afterRetry).toHaveLength(1);

    const second = await supertest(app).post(`/javno/meni/${qrToken}/narocilo`).send({
      ...payload, idempotencyKey: "qr_retry_key_0002",
    });
    expect(second.status).toBe(201);
    expect(second.body.narociloId).toBe(first.body.narociloId);
    const afterAppend = await db.select({ id: postavkeTable.id }).from(postavkeTable)
      .where(and(eq(postavkeTable.narociloId, first.body.narociloId), isNull(postavkeTable.parentPostavkaId)));
    expect(afterAppend).toHaveLength(2);

    await db.update(narocilaTable).set({ status: "zakljuceno" }).where(eq(narocilaTable.id, first.body.narociloId));
    const finalizedRetry = await supertest(app).post(`/javno/meni/${qrToken}/narocilo`).send(payload);
    expect(finalizedRetry.status).toBe(201);
    expect(finalizedRetry.body.narociloId).toBe(first.body.narociloId);
    const mismatch = await supertest(app).post(`/javno/meni/${qrToken}/narocilo`).send({
      ...payload, postavke: [{ ...payload.postavke[0], kolicina: 2 }],
    });
    expect(mismatch.status).toBe(409);
  });

  it("zavrne QR napitnino z več kot dvema decimalkama ali negativno vrednostjo", async () => {
    const qrNapravaId = randomUUID();
    const postavke = [{ artikelId: vidniArtikelId, kolicina: 1, modifikatorji: [] }];

    const prevecDecimalk = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({ qrNapravaId, postavke, znesekNapitnina: 1.234 });
    expect(prevecDecimalk.status).toBe(400);

    const negativna = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({ qrNapravaId, postavke, znesekNapitnina: -0.01 });
    expect(negativna.status).toBe(400);

    const besedilo = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({ qrNapravaId, postavke, znesekNapitnina: "1.00" });
    expect(besedilo.status).toBe(400);
  });

  it("brez potrjene, na poslovni datum veljavne politike blokira QR napitnino, ničelne pa ne", async () => {
    await db.delete(tipPoliciesTable).where(eq(tipPoliciesTable.companyId, companyId));
    const remainingPolicies = await db.select({ id: tipPoliciesTable.id })
      .from(tipPoliciesTable)
      .where(eq(tipPoliciesTable.companyId, companyId));
    expect(remainingPolicies).toHaveLength(0);
    const qrNapravaId = randomUUID();
    const [modifikator] = await db.select({ id: modifikatorjiTable.id })
      .from(modifikatorjiTable)
      .where(and(eq(modifikatorjiTable.skupinaId, skupinaId), eq(modifikatorjiTable.aktiven, true)));
    const postavke = [{ artikelId: vidniArtikelId, kolicina: 1, modifikatorji: [modifikator!.id] }];

    const blocked = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({ qrNapravaId, postavke, znesekNapitnina: 1 });
    expect(blocked.status, JSON.stringify(blocked.body)).toBe(409);
    expect(blocked.body.code).toBe("QR_TIP_POLICY_REQUIRED");

    const zeroTip = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({ qrNapravaId: randomUUID(), postavke, znesekNapitnina: 0 });
    expect(zeroTip.status).toBe(201);
    await db.insert(tipPoliciesTable).values({
      companyId,
      enotaId,
      effectiveFrom: "2000-01-01",
      mode: "direct_employee",
      evidenceType: "internal_rule",
      evidenceReference: `QR restored policy ${RUN_ID}`,
      agreementConfirmed: true,
      cardFeeTreatment: "employer_expense",
      cardFeeKind: "none",
      createdBy: "test",
    });
  });

  it("skrije razprodano pripravljeno hrano in pri sočasnih QR naročilih proda zadnjo porcijo samo enkrat", async () => {
    const [preparedArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Zadnja porcija ${RUN_ID}`,
      cena: "8.00",
      davek: "9.5",
      kategorijaId,
      prodajniArtikel: true,
      qrNaVoljo: true,
      mealType: "prepared",
    }).returning({ id: artikliTable.id });

    const businessDate = await currentBusinessDate(enotaId);
    const [ledger] = await db.insert(preparedFoodDailyLedgersTable).values({
      enotaId,
      artikelId: preparedArticle!.id,
      businessDate,
      thawedQuantity: "0",
      preparedQuantity: "0",
    }).returning({ id: preparedFoodDailyLedgersTable.id });

    const soldOutMenu = await supertest(publicApp()).get(`/javno/meni/${qrToken}`);
    expect(soldOutMenu.status).toBe(200);
    expect(soldOutMenu.body.artikli.some((item: { id: number }) => item.id === preparedArticle!.id)).toBe(false);

    await db.update(preparedFoodDailyLedgersTable)
      .set({ thawedQuantity: "1" })
      .where(eq(preparedFoodDailyLedgersTable.id, ledger!.id));

    const availableMenu = await supertest(publicApp()).get(`/javno/meni/${qrToken}`);
    expect(availableMenu.status).toBe(200);
    expect(availableMenu.body.artikli.find((item: { id: number }) => item.id === preparedArticle!.id))
      .toMatchObject({ mealType: "prepared", availableQuantity: 1 });

    const submit = () => supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({
        qrNapravaId: randomUUID(),
        postavke: [{ artikelId: preparedArticle!.id, kolicina: 1, modifikatorji: [] }],
      });
    const responses = await Promise.all([submit(), submit()]);
    expect(responses.map((response) => response.status).sort()).toEqual([201, 409]);
    expect(responses.find((response) => response.status === 409)?.body.code)
      .toBe("INSUFFICIENT_PREPARED_FOOD_AVAILABILITY");

    const successfulOrderId = responses.find((response) => response.status === 201)!.body.narociloId;
    const [preparedLine] = await db.select({ id: postavkeTable.id })
      .from(postavkeTable)
      .where(and(
        eq(postavkeTable.narociloId, successfulOrderId),
        eq(postavkeTable.artikelId, preparedArticle!.id),
      ));
    const increase = await supertest(narocilaApp(enotaId))
      .patch(`/narocila/${successfulOrderId}/postavke/${preparedLine!.id}`)
      .send({ kolicina: 2 });
    expect(increase.status).toBe(409);
    expect(increase.body.code).toBe("INSUFFICIENT_PREPARED_FOOD_AVAILABILITY");
    const childBypass = await supertest(narocilaApp(enotaId))
      .post(`/narocila/${successfulOrderId}/postavke`)
      .send({
        artikelId: preparedArticle!.id,
        kolicina: 1,
        parentPostavkaId: preparedLine!.id,
      });
    expect(childBypass.status).toBe(400);

    const [changedArticle] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Spremenjena vrsta ${RUN_ID}`,
      cena: "6.00",
      davek: "9.5",
      kategorijaId,
      prodajniArtikel: true,
      qrNaVoljo: true,
      mealType: "ala_carte",
    }).returning({ id: artikliTable.id });
    const saleBeforeChange = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({
        qrNapravaId: randomUUID(),
        postavke: [{ artikelId: changedArticle!.id, kolicina: 1, modifikatorji: [] }],
      });
    expect(saleBeforeChange.status).toBe(201);
    await db.update(artikliTable)
      .set({ mealType: "prepared" })
      .where(eq(artikliTable.id, changedArticle!.id));
    await db.insert(preparedFoodDailyLedgersTable).values({
      enotaId,
      artikelId: changedArticle!.id,
      businessDate,
      thawedQuantity: "1",
      preparedQuantity: "0",
    });
    const menuAfterTypeChange = await supertest(publicApp()).get(`/javno/meni/${qrToken}`);
    expect(menuAfterTypeChange.body.artikli.find((item: { id: number }) => item.id === changedArticle!.id))
      .toMatchObject({ mealType: "prepared", availableQuantity: 1 });

    const [modifierInput] = await db.insert(artikliTable).values({
      enotaId,
      ime: `Vhod modifikatorja ${RUN_ID}`,
      cena: "4.00",
      davek: "9.5",
      kategorijaId,
      prodajniArtikel: true,
      qrNaVoljo: true,
      mealType: "ala_carte",
    }).returning({ id: artikliTable.id });
    const [snapshotModifier] = await db.insert(modifikatorjiTable).values({
      skupinaId,
      ime: `Posnetek ${RUN_ID}`,
      cenaDodatek: "0",
      aktiven: true,
    }).returning({ id: modifikatorjiTable.id });
    await db.insert(modNormativiTable).values({
      modifikatorId: snapshotModifier!.id,
      vhodniArtikelId: modifierInput!.id,
      kolicina: "1",
    });
    const modifierSale = await supertest(publicApp())
      .post(`/javno/meni/${qrToken}/narocilo`)
      .send({
        qrNapravaId: randomUUID(),
        postavke: [{
          artikelId: vidniArtikelId,
          kolicina: 1,
          modifikatorji: [snapshotModifier!.id],
        }],
      });
    expect(modifierSale.status).toBe(201);
    const [modifierChild] = await db.select({
      snapshot: postavkeTable.availabilityRequirements,
    }).from(postavkeTable).where(and(
      eq(postavkeTable.narociloId, modifierSale.body.narociloId),
      eq(postavkeTable.modifikatorId, snapshotModifier!.id),
    ));
    expect(modifierChild!.snapshot).toEqual([{
      articleId: modifierInput!.id,
      quantity: 1,
      mealType: "ala_carte",
    }]);
    await db.update(artikliTable)
      .set({ mealType: "prepared" })
      .where(eq(artikliTable.id, modifierInput!.id));
    await db.insert(preparedFoodDailyLedgersTable).values({
      enotaId,
      artikelId: modifierInput!.id,
      businessDate,
      thawedQuantity: "1",
      preparedQuantity: "0",
    });
    const menuAfterModifierInputChange = await supertest(publicApp()).get(`/javno/meni/${qrToken}`);
    expect(menuAfterModifierInputChange.body.artikli.find(
      (item: { id: number }) => item.id === modifierInput!.id,
    )).toMatchObject({ mealType: "prepared", availableQuantity: 1 });
  });

  it("strežniško uveljavi izbiro štirih oziroma treh različnih hodov in materializira sparjene postavke", async () => {
    const createArticle = async (ime: string, visible = false) => {
      const [article] = await db.insert(artikliTable).values({
        enotaId, ime: `${ime} ${RUN_ID}`, cena: "10.00", davek: "9.5",
        prodajniArtikel: true, qrNaVoljo: visible,
      }).returning({ id: artikliTable.id });
      return article!.id;
    };
    const fixedMenuId = await createArticle("Fiksni meni", true);
    const chooseMenuId = await createArticle("Izberi tri", true);
    const foodIds = await Promise.all([1, 2, 3, 4].map((course) => createArticle(`Hod ${course}`)));
    const wineIds = await Promise.all([1, 2, 3, 4].map((course) => createArticle(`Vino ${course}`)));
    const foreignWineId = await (async () => {
      const [article] = await db.insert(artikliTable).values({
        enotaId: drugaEnotaId, ime: `Tuje vino ${RUN_ID}`, cena: "10.00", davek: "9.5", prodajniArtikel: true,
      }).returning({ id: artikliTable.id });
      return article!.id;
    })();
    const makeCourses = (wineIdsForCourses = wineIds) => foodIds.map((foodArtikelId, index) => ({
      courseNumber: index + 1, foodArtikelId, allowedWineArtikelIds: [wineIdsForCourses[index]!],
    }));
    const [fixed] = await db.insert(multicourseMenusTable).values({
      enotaId, menuArtikelId: fixedMenuId, izbor: "fixed_four",
    }).returning({ id: multicourseMenusTable.id });
    const [choose] = await db.insert(multicourseMenusTable).values({
      enotaId, menuArtikelId: chooseMenuId, izbor: "choose_three", foodPricePercent: "75",
    }).returning({ id: multicourseMenusTable.id });
    await db.insert(multicourseMenuCoursesTable).values([
      ...makeCourses().map((course) => ({ ...course, menuId: fixed!.id })),
      ...makeCourses().map((course) => ({ ...course, menuId: choose!.id })),
    ]);

    const deviceId = randomUUID();
    const base = { qrNapravaId: deviceId, postavke: [{ artikelId: fixedMenuId, kolicina: 1, modifikatorji: [] }] };
    let requestIp = 10;
    const submit = (courses: Array<{ courseNumber: number; foodArtikelId: number; wineArtikelId: number | null }>, key: string, menuArtikelId = fixedMenuId) =>
      supertest(publicApp()).post(`/javno/meni/${qrToken}/narocilo`)
        .set("X-Forwarded-For", `198.51.100.${requestIp++}`).send({
        ...base, idempotencyKey: key,
        postavke: [{ artikelId: menuArtikelId, kolicina: 1, modifikatorji: [] }],
        multicourseSelections: [{ menuArtikelId, courses }],
      });
    const four = wineIds.map((wineArtikelId, index) => ({ courseNumber: index + 1, foodArtikelId: foodIds[index]!, wineArtikelId }));

    // A client must not smuggle the commercial menu wrapper through as an
    // ordinary line, duplicate it, or submit an orphaned course selection.
    expect((await supertest(publicApp()).post(`/javno/meni/${qrToken}/narocilo`)
      .set("X-Forwarded-For", `198.51.100.${requestIp++}`).send({
      qrNapravaId: deviceId, idempotencyKey: "menu_missing_selection",
      postavke: [{ artikelId: fixedMenuId, kolicina: 1, modifikatorji: [] }],
    })).status).toBe(400);
    expect((await supertest(publicApp()).post(`/javno/meni/${qrToken}/narocilo`)
      .set("X-Forwarded-For", `198.51.100.${requestIp++}`).send({
      qrNapravaId: deviceId, idempotencyKey: "menu_duplicate_parent",
      postavke: [
        { artikelId: fixedMenuId, kolicina: 1, modifikatorji: [] },
        { artikelId: fixedMenuId, kolicina: 1, modifikatorji: [] },
      ],
      multicourseSelections: [{ menuArtikelId: fixedMenuId, courses: four }],
    })).status).toBe(400);
    expect((await supertest(publicApp()).post(`/javno/meni/${qrToken}/narocilo`)
      .set("X-Forwarded-For", `198.51.100.${requestIp++}`).send({
      qrNapravaId: deviceId, idempotencyKey: "menu_orphan_selection",
      postavke: [{ artikelId: vidniArtikelId, kolicina: 1, modifikatorji: [] }],
      multicourseSelections: [{ menuArtikelId: fixedMenuId, courses: four }],
    })).status).toBe(400);
    expect((await submit(four.slice(0, 3), "fixed_only_three_01")).status).toBe(400);
    expect((await submit([four[0]!, four[1]!, four[2]!, { courseNumber: 1, foodArtikelId: foodIds[0]!, wineArtikelId: wineIds[0]! }], "fixed_duplicate_001")).status).toBe(400);
    expect((await submit([{ courseNumber: 1, foodArtikelId: foodIds[0]!, wineArtikelId: null }, ...four.slice(1)], "fixed_no_wine_0001")).status).toBe(400);
    expect((await submit([{ courseNumber: 1, foodArtikelId: foodIds[0]!, wineArtikelId: foreignWineId }, ...four.slice(1)], "fixed_foreign_wine")).status).toBe(400);

    const missingWineShare = await submit(four, "fixed_missing_wine_share");
    expect(missingWineShare.status).toBe(400);
    expect(missingWineShare.body.error).toContain("delež cene vina ni nastavljen");
    await db.update(multicourseMenusTable)
      .set({ foodPricePercent: "75" })
      .where(eq(multicourseMenusTable.id, fixed!.id));

    const accepted = await submit(four, "fixed_success_0001");
    expect(accepted.status, JSON.stringify(accepted.body)).toBe(201);
    const replay = await submit(four, "fixed_success_0001");
    expect(replay.status).toBe(201);
    expect(replay.body.narociloId).toBe(accepted.body.narociloId);
    const lines = await db.select({
      artikelId: postavkeTable.artikelId, courseNumber: postavkeTable.courseNumber,
      courseSequence: postavkeTable.courseSequence, pairingGroupId: postavkeTable.pairingGroupId,
    }).from(postavkeTable).where(and(
      eq(postavkeTable.narociloId, accepted.body.narociloId), isNull(postavkeTable.parentPostavkaId),
    ));
    expect(lines).toHaveLength(10); // food charge + wine charge + independently materialized course components
    for (let course = 1; course <= 4; course += 1) {
      expect(lines.filter((line) => line.courseNumber === course)).toEqual(expect.arrayContaining([
        expect.objectContaining({ artikelId: foodIds[course - 1], courseSequence: course, pairingGroupId: expect.any(String) }),
        expect.objectContaining({ artikelId: wineIds[course - 1], courseSequence: course, pairingGroupId: expect.any(String) }),
      ]));
    }

    const chooseThree = await submit(four.slice(0, 3), "choose_success_0001", chooseMenuId);
    expect(chooseThree.status).toBe(201);
    const [threeCourseOrder] = await db.select({ skupaj: narocilaTable.skupaj })
      .from(narocilaTable).where(eq(narocilaTable.id, chooseThree.body.narociloId));
    // The same QR guest appends a second €10 menu to the open order. Its three
    // paired wines are included, so the order grows from €10 to €20, not more.
    expect(threeCourseOrder!.skupaj).toBe("20.00");
    expect((await submit(four, "choose_all_four_001", chooseMenuId)).status).toBe(400);

    const staffMenus = staffApp(multicourseMenuRouter, enotaId);
    const foreignMenuConfig = await supertest(staffMenus)
      .post("/multicourse-menus").send({
        menuArtikelId: foreignWineId, izbor: "fixed_four", courses: makeCourses(),
      });
    expect(foreignMenuConfig.status).toBe(400);
    const foreignCourseConfig = await supertest(staffMenus)
      .post("/multicourse-menus").send({
        menuArtikelId: fixedMenuId, izbor: "fixed_four",
        courses: makeCourses().map((course, index) => index === 0 ? { ...course, foodArtikelId: foreignWineId } : course),
      });
    expect(foreignCourseConfig.status).toBe(400);
    const foreignConfig = await supertest(staffMenus)
      .post("/multicourse-menus").send({
        menuArtikelId: fixedMenuId, izbor: "fixed_four",
        courses: makeCourses([foreignWineId, wineIds[1]!, wineIds[2]!, wineIds[3]!]),
      });
    expect(foreignConfig.status).toBe(400);
  });

  it("večhodni meni zaračuna le menijsko vrstico, preveri hode in v KDS ne pošlje starša", async () => {
    // The menu itself is prepared but deliberately has no daily portion. Only
    // the actual prepared food courses get portions and availability checks.
    const [previousCompany] = await db.select({ idZaDdv: companiesTable.idZaDdv })
      .from(companiesTable).where(eq(companiesTable.id, companyId));
    await db.update(companiesTable).set({ idZaDdv: `SI${RUN_ID}` }).where(eq(companiesTable.id, companyId));
    try {
      const createArticle = async (ime: string, cena: string, values: Partial<typeof artikliTable.$inferInsert> = {}) => {
        const [article] = await db.insert(artikliTable).values({
          enotaId, ime: `${ime} ${RUN_ID}`, cena, davek: "22",
          prodajniArtikel: true, qrNaVoljo: true, ...values,
        }).returning({ id: artikliTable.id });
        return article!.id;
      };
      const menuArtikelId = await createArticle("Meni brez porcije", "40.00", {
        mealType: "prepared", taxCategory: "food",
      });
      const foodIds = await Promise.all([1, 2, 3, 4].map((course) => createArticle(
        `Plačljivi hod ${course}`, `${5 + course}.00`, {
          mealType: "prepared", taxCategory: "food", qrNaVoljo: false, prodajniArtikel: false,
        },
      )));
      const wineIds = await Promise.all([1, 2, 3, 4].map((course) => createArticle(
        `Vino 1dl ${course}`, `${2 + course}.50`, { taxCategory: "alcoholic", jeAlkohol: true, qrNaVoljo: true },
      )));
      const businessDate = await currentBusinessDate(enotaId);
      await db.insert(preparedFoodDailyLedgersTable).values(foodIds.map((artikelId) => ({
        enotaId, artikelId, businessDate, thawedQuantity: "1", preparedQuantity: "0",
      })));
      const [menu] = await db.insert(multicourseMenusTable).values({
        enotaId, menuArtikelId, izbor: "fixed_four", foodPricePercent: "75",
      }).returning({ id: multicourseMenusTable.id });
      await db.insert(multicourseMenuCoursesTable).values(foodIds.map((foodArtikelId, index) => ({
        menuId: menu!.id, courseNumber: index + 1, courseName: `Snapshot hod ${index + 1}`, foodArtikelId,
        allowedWineArtikelIds: [wineIds[index]!],
      })));

      const menuPayload = await supertest(publicApp()).get(`/javno/meni/${qrToken}`);
      expect(menuPayload.status).toBe(200);
      expect(menuPayload.body.artikli).toEqual(expect.arrayContaining([
        expect.objectContaining({ id: foodIds[0] }),
      ]));
      expect(menuPayload.body.multicourseMenus).toEqual(expect.arrayContaining([
        expect.objectContaining({
          menuArtikelId,
          courses: expect.arrayContaining([expect.objectContaining({ foodArtikelId: foodIds[0] })]),
        }),
      ]));
      expect(menuPayload.body.kategorije.flatMap((category: any) => category.artikli))
        .not.toEqual(expect.arrayContaining([expect.objectContaining({ id: foodIds[0] })]));
      const standaloneFood = await supertest(publicApp()).post(`/javno/meni/${qrToken}/narocilo`).send({
        qrNapravaId: randomUUID(),
        idempotencyKey: "non_sales_course_standalone",
        postavke: [{ artikelId: foodIds[0], kolicina: 1, modifikatorji: [] }],
      });
      expect(standaloneFood.status).toBe(400);

      const order = await supertest(publicApp()).post(`/javno/meni/${qrToken}/narocilo`).send({
        qrNapravaId: randomUUID(),
        idempotencyKey: "menu_charge_components_01",
        postavke: [{ artikelId: menuArtikelId, kolicina: 1, modifikatorji: [] }],
        multicourseSelections: [{
          menuArtikelId,
          courses: wineIds.map((wineArtikelId, index) => ({ courseNumber: index + 1, foodArtikelId: foodIds[index]!, wineArtikelId })),
        }],
      });
      expect(order.status, JSON.stringify(order.body)).toBe(201);

      const [savedOrder] = await db.select({ skupaj: narocilaTable.skupaj })
        .from(narocilaTable).where(eq(narocilaTable.id, order.body.narociloId));
      expect(savedOrder!.skupaj).toBe("40.00"); // menu envelope includes all four 1 dl wines
      const lines = await db.select({
        id: postavkeTable.id, artikelId: postavkeTable.artikelId, cenaKos: postavkeTable.cenaKos,
        cenaKosOriginalna: postavkeTable.cenaKosOriginalna, skupaj: postavkeTable.skupaj,
        davek: postavkeTable.davek, courseNumber: postavkeTable.courseNumber,
        courseNameSnapshot: postavkeTable.courseNameSnapshot,
      }).from(postavkeTable).where(and(
        eq(postavkeTable.narociloId, order.body.narociloId), isNull(postavkeTable.parentPostavkaId),
      ));
      const menuLines = lines.filter((line) => line.artikelId === menuArtikelId);
      const menuLine = menuLines.find((line) => line.davek === "9.50")!;
      expect(menuLines).toEqual(expect.arrayContaining([
        expect.objectContaining({ cenaKos: "30.00", skupaj: "30.00", davek: "9.50", courseNumber: null }),
        expect.objectContaining({ cenaKos: "10.00", skupaj: "10.00", davek: "22.00", courseNumber: null }),
      ]));
      for (const foodArtikelId of foodIds) {
        expect(lines.find((line) => line.artikelId === foodArtikelId)).toMatchObject({
          cenaKos: "0.00", cenaKosOriginalna: "0.00", skupaj: "0.00",
          davek: "9.50",
          courseNumber: expect.any(Number),
           courseNameSnapshot: expect.stringMatching(/^Snapshot hod [1-4]$/),
        });
      }
      for (const wineArtikelId of wineIds) {
        expect(lines.find((line) => line.artikelId === wineArtikelId)).toMatchObject({
          cenaKos: "0.00", cenaKosOriginalna: "0.00", skupaj: "0.00",
          davek: "22.00",
          courseNumber: expect.any(Number),
           courseNameSnapshot: expect.stringMatching(/^Snapshot hod [1-4]$/),
        });
      }

      const standaloneWine = await supertest(publicApp()).post(`/javno/meni/${qrToken}/narocilo`).send({
        qrNapravaId: randomUUID(),
        idempotencyKey: "standalone_menu_wine_01",
        postavke: [{ artikelId: wineIds[0], kolicina: 1, modifikatorji: [] }],
      });
      expect(standaloneWine.status).toBe(201);
      const [standaloneWineLine] = await db.select({
        cenaKos: postavkeTable.cenaKos, skupaj: postavkeTable.skupaj,
      }).from(postavkeTable).where(and(
        eq(postavkeTable.narociloId, standaloneWine.body.narociloId),
        eq(postavkeTable.artikelId, wineIds[0]),
      ));
      expect(standaloneWineLine).toEqual({ cenaKos: "3.50", skupaj: "3.50" });

      const kds = staffApp(kdsRouter, enotaId);
      await supertest(kds).post(`/kds/narocila/${order.body.narociloId}/materializiraj`);
      const tickets = await db.select({
        postavkaId: kdsNalogiTable.postavkaId,
      }).from(kdsNalogiTable).where(eq(kdsNalogiTable.narociloId, order.body.narociloId));
      expect(tickets).toHaveLength(8);
      expect(tickets.map((ticket) => ticket.postavkaId)).not.toContain(menuLine.id);
      expect(tickets.map((ticket) => ticket.postavkaId)).toEqual(expect.arrayContaining(
        lines.filter((line) => line.artikelId !== menuArtikelId).map((line) => line.id),
      ));
    } finally {
      await db.update(companiesTable).set({ idZaDdv: previousCompany!.idZaDdv })
        .where(eq(companiesTable.id, companyId));
    }
  });

  it("izolira natakarjeve QR zahtevke po mizi in napravi ter beleži prijavljene prehode stanja", async () => {
    const deviceA = randomUUID();
    const deviceB = randomUUID();
    const own = publicApp();
    const first = await supertest(own).post(`/javno/meni/${qrToken}/natakar`).send({ qrNapravaId: deviceA });
    const duplicate = await supertest(own).post(`/javno/meni/${qrToken}/natakar`).send({ qrNapravaId: deviceA });
    expect(first.status).toBe(201);
    expect(duplicate.body.id).toBe(first.body.id);
    expect((await supertest(own).get(`/javno/meni/${qrToken}/natakar/trenutni?qrNapravaId=${deviceB}`)).body).toBeNull();

    const otherToken = randomBytes(32).toString("base64url");
    await db.insert(mizeTable).values({ enotaId, stevilka: 70, qrToken: otherToken });
    const [otherTable] = await db.select({ id: mizeTable.id }).from(mizeTable).where(eq(mizeTable.qrToken, otherToken));
    const otherApp = publicApp(false);
    const session = createQrActivationSessionForTest({ token: otherToken, enotaId, mizaId: otherTable!.id, qrNapravaId: deviceA });
    const isolated = await supertest(otherApp).post(`/javno/meni/${otherToken}/natakar`)
      .set("Cookie", `bookie_qr_activation=${encodeURIComponent(session)}`).send({ qrNapravaId: deviceA });
    expect(isolated.status).toBe(201);
    expect(isolated.body.id).not.toBe(first.body.id);

    const staff = staffApp(multicourseMenuRouter, enotaId, "authenticated-waiter");
    const confirmed = await supertest(staff).patch(`/qr-waiter-requests/${first.body.id}`).send({ stanje: "potrjeno" });
    expect(confirmed.body).toMatchObject({ stanje: "potrjeno", actorClerkUserId: "authenticated-waiter", potrjeno: expect.any(String) });
    const closed = await supertest(staff).patch(`/qr-waiter-requests/${first.body.id}`).send({ stanje: "zakljuceno" });
    expect(closed.body).toMatchObject({ stanje: "zakljuceno", actorClerkUserId: "authenticated-waiter", zakljuceno: expect.any(String) });
  });

  it("KDS zadrži poznejše hode, dokler osebje po končanem prejšnjem hodu ne sproži fire", async () => {
    const menu = await supertest(publicApp()).get(`/javno/meni/${qrToken}`);
    const configured = menu.body.multicourseMenus?.find((item: any) => item.izbor === "fixed_four");
    expect(configured).toBeDefined();
    const deviceId = randomUUID();
    const courses = configured.courses.map((course: any) => ({
      courseNumber: course.courseNumber, foodArtikelId: course.allowedFoodArtikelIds[0], wineArtikelId: course.allowedWineArtikelIds[0],
    }));
    const order = await supertest(publicApp()).post(`/javno/meni/${qrToken}/narocilo`).send({
      qrNapravaId: deviceId, idempotencyKey: "kds_multicourse_001",
      postavke: [{ artikelId: configured.menuArtikelId, kolicina: 1, modifikatorji: [] }],
      multicourseSelections: [{ menuArtikelId: configured.menuArtikelId, courses }],
    });
    expect(order.status).toBe(201);
    const kds = staffApp(kdsRouter, enotaId);
    await supertest(kds).get("/kds/postaje");
    await supertest(kds).post(`/kds/narocila/${order.body.narociloId}/materializiraj`);
    const tickets = await db.select().from(kdsNalogiTable).where(eq(kdsNalogiTable.narociloId, order.body.narociloId));
    const configuredCourseNames = new Map(configured.courses.map(
      (course: any) => [course.courseNumber, course.courseName],
    ));
    expect(tickets.filter(ticket => ticket.courseNumber != null).every(
      ticket => ticket.courseNameSnapshot === configuredCourseNames.get(ticket.courseNumber),
    )).toBe(true);
    expect(tickets.filter((ticket) => ticket.courseNumber === 1).every((ticket) => ticket.stanje === "aktivno")).toBe(true);
    expect(tickets.filter((ticket) => ticket.courseNumber === 2).every((ticket) => ticket.stanje === "zadrzano")).toBe(true);
    expect((await supertest(kds).post(`/kds/narocila/${order.body.narociloId}/tecaji/2/fire`).send({ idempotencyKey: "too_early" })).status).toBe(409);
    for (const ticket of tickets.filter((ticket) => ticket.courseNumber === 1)) {
      expect((await supertest(kds).post(`/kds/nalogi/${ticket.id}/bump`).send({ idempotencyKey: `bump_${ticket.id}` })).status).toBe(200);
    }
    expect((await supertest(kds).post(`/kds/narocila/${order.body.narociloId}/tecaji/2/fire`).send({ idempotencyKey: "fire_second" })).body)
      .toMatchObject({ ok: true, released: 2 });
  });
});