import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import request from "supertest";

const { currentDayState, dbState, previousDayState, simTimeState } = vi.hoisted(() => ({
  currentDayState: { closed: false, closedDates: new Set<string>() },
  simTimeState: { value: new Date("2026-08-23T10:02:00.000Z") },
  dbState: {
    order: null as Record<string, any> | null,
    article: null as Record<string, any> | null,
    toGoArtikli: [] as Record<string, any>[],
    customer: null as Record<string, any> | null,
    naselje: null as Record<string, any> | null,
    postavke: [] as Record<string, any>[],
    queueLines: [] as Record<string, any>[],
    settings: {
      telefonNarocilaOsnovniCasMin: "10",
      telefonNarocilaCakalnaVrstaMin: "0",
      telefonNarocilaKapaciteta: "1",
      telefonNarocilaNajvecCasMin: "90",
      telefonNarocilaZaokrozevanjeMin: "5",
    } as Record<string, string>,
    estimateSelect: 0,
    nextOrderId: 1,
    nextPostavkaId: 1,
    selectQueue: [] as unknown[][],
  },
  previousDayState: {
    allowed: true,
    previousBusinessDate: null as string | null,
    missingRegisters: [] as Array<{ id: number; name: string }>,
  },
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const orig = await importOriginal<typeof import("@workspace/db")>();
  const keys = (projection: Record<string, unknown> | undefined) => Object.keys(projection ?? {});

  function orderRow() {
    if (!dbState.order) return [];
    return [{
      ...dbState.order,
      mizaStevilka: null,
      mizaIme: null,
      prostorId: null,
      prostorIme: null,
    }];
  }

  function postavkeRows() {
    return dbState.postavke.map((p) => ({
      id: p.id,
      artikelId: p.artikelId,
      ime: p.ime,
      kolicina: p.kolicina,
      cenaKos: p.cenaKos,
      cenaKosOriginalna: p.cenaKosOriginalna ?? p.cenaKos,
      skupaj: p.skupaj,
      davek: p.davek,
      opomba: p.opomba ?? null,
      kategorijaId: null,
      kategorijaIme: null,
      jePica: false,
      racunId: null,
      racunStevilka: null,
      gostStevilka: null,
      parentPostavkaId: p.parentPostavkaId ?? null,
      modifikatorId: p.modifikatorId ?? null,
      toGo: p.toGo ?? false,
      casPripraveMin: dbState.article?.casPripraveMin ?? 0,
      kategorijaTip: dbState.article?.kategorijaTip ?? "hrana",
      ustvarjeno: p.ustvarjeno ?? new Date("2026-08-23T10:00:00.000Z"),
      pripravljeno: p.pripravljeno ?? null,
    }));
  }

  function selectRows(projection: Record<string, unknown> | undefined, table: unknown) {
    if (dbState.selectQueue.length) return dbState.selectQueue.shift()!;
    const selected = keys(projection);

    if (selected.includes("artikelId") && selected.includes("casPripraveMin") && selected.includes("kolicina") && selected.includes("kategorijaTip")) {
      const rows = selected.includes("pripravljeno")
        ? dbState.postavke.map((p) => ({
          artikelId: p.artikelId,
           casPripraveMin: p.casPripraveMin ?? dbState.article?.casPripraveMin ?? 0,
          kolicina: p.kolicina,
           kategorijaTip: p.kategorijaTip ?? dbState.article?.kategorijaTip ?? "hrana",
           pripravljeno: p.pripravljeno ?? null,
        }))
        : dbState.queueLines;
      return rows;
    }
    if (selected.length === 2 && selected.includes("kljuc") && selected.includes("vrednost")) {
      dbState.estimateSelect = 0;
      return Object.entries(dbState.settings).map(([kljuc, vrednost]) => ({ kljuc, vrednost }));
    }
    if (selected.length === 1 && selected.includes("vrednost") && table === orig.nastavitveTable) {
      return dbState.settings.dostavaArtikelId ? [{ vrednost: dbState.settings.dostavaArtikelId }] : [];
    }
    if (selected.length === 1 && selected[0] === "id" && table === orig.mizeTable) return [{ id: 5 }];
    if (selected.includes("staraMizaId") && selected.includes("novaMizaId")) return [];
    if (selected.includes("nacin") && selected.includes("strankaIme")) return orderRow();
    if (selected.includes("cenaKosOriginalna") && selected.includes("casPripraveMin")) return postavkeRows();
    if (selected.includes("naziv") && selected.includes("telefon")) return [{ naziv: "Ana", telefon: "040123456" }];
    if (selected.length === 1 && selected[0] === "id" && table === orig.postavkeTable) {
      return dbState.postavke.map((p) => ({ id: p.id }));
    }
    if (selected.length === 1 && selected[0] === "id") return [];
    if (table === orig.artikliTable && selected.includes("kategorijaIme") && selected.includes("id") && selected.includes("ime") && selected.includes("cena")) {
      return dbState.toGoArtikli;
    }
    if (table === orig.postavkeTable && selected.includes("artikelDavek") && selected.includes("taxCategory")) {
      return dbState.postavke.map((p) => ({
        ...p,
        artikelDavek: dbState.article?.davek ?? p.davek,
        taxCategory: dbState.article?.taxCategory ?? null,
        addedSugar: dbState.article?.addedSugar ?? false,
      }));
    }
    if (table === orig.artikliTable) return dbState.article ? [dbState.article] : [];
    if (table === orig.narocilaTable) return dbState.order ? [dbState.order] : [];
    if (table === orig.postavkeTable) return dbState.postavke.length ? [dbState.postavke[0]] : [];
    if (table === orig.narocnikiTable) return dbState.customer ? [dbState.customer] : [];
    if (table === orig.naseljaTable) return dbState.naselje ? [dbState.naselje] : [];
    return [];
  }

  function chain(projection?: Record<string, unknown>) {
    let table: unknown;
    const result = {
      from: (from: unknown) => { table = from; return result; },
      where: () => result,
      leftJoin: () => result,
      innerJoin: () => result,
      orderBy: () => result,
      limit: () => result,
      for: () => result,
      then: (resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) =>
        Promise.resolve(selectRows(projection, table)).then(resolve, reject),
      catch: (reject: (error: unknown) => unknown) =>
        Promise.resolve(selectRows(projection, table)).catch(reject),
    };
    return result;
  }

  function update(table: unknown) {
    return {
      set: (values: Record<string, unknown>) => ({
        where: async () => {
          if (table === orig.narocilaTable && dbState.order) Object.assign(dbState.order, values);
          if (table === orig.postavkeTable && dbState.postavke[0]) Object.assign(dbState.postavke[0], values);
          if (table === orig.narocnikiTable && dbState.customer) {
            if ("steviloNarocil" in values) {
              dbState.customer.steviloNarocil = (dbState.customer.steviloNarocil ?? 0) + 1;
            }
            const { steviloNarocil: _steviloNarocil, ...otherValues } = values;
            Object.assign(dbState.customer, otherValues);
          }
          return [];
        },
      }),
    };
  }

  function insert(table: unknown) {
    return {
      values: (values: Record<string, any>) => {
        const commit = async () => {
          if (table === orig.narocilaTable) {
            dbState.order = {
              id: dbState.nextOrderId++,
              mizaId: null,
              status: "odprto",
              skupaj: "0",
              opomba: null,
              stevilkaNarocila: 1,
              toGo: false,
              ustvarjeno: new Date("2026-08-23T10:02:00.000Z"),
              posodobljeno: new Date("2026-08-23T10:02:00.000Z"),
              ...values,
            };
            return [dbState.order];
          }
          if (table === orig.postavkeTable) {
            const postavka = {
              id: dbState.nextPostavkaId++,
              ustvarjeno: new Date("2026-08-23T10:02:00.000Z"),
              ...values,
            };
            dbState.postavke.push(postavka);
            return [{ id: postavka.id }];
          }
          if (table === orig.narocnikiTable) {
            dbState.customer = { id: 20, steviloNarocil: 0, ...values };
            return [dbState.customer];
          }
          return [];
        };
        const result = {
          returning: commit,
          then: (resolve: (value: unknown) => unknown) => commit().then(resolve),
          onConflictDoNothing: () => result,
        };
        return result;
      },
    };
  }

  return {
    ...orig,
    db: {
      select: (projection?: Record<string, unknown>) => chain(projection),
      update,
      insert,
      delete: (table: unknown) => ({
        where: async () => {
          if (table === orig.postavkeTable) dbState.postavke.shift();
          return [];
        },
      }),
      execute: async () => ({ rows: [] }),
      transaction: async (fn: (tx: unknown) => unknown) => fn({
        select: (projection?: Record<string, unknown>) => chain(projection),
        update,
        insert,
        execute: async () => ({ rows: [] }),
        delete: (table: unknown) => ({
          where: async () => {
            if (table === orig.postavkeTable) dbState.postavke.shift();
            return [];
          },
        }),
      }),
    },
  };
});

vi.mock("../lib/pos-sse", () => ({
  broadcastToUnit: vi.fn(),
  broadcastToDevice: vi.fn(),
  addClient: vi.fn(),
  removeClient: vi.fn(),
}));

vi.mock("../lib/ddv-resolver", () => ({
  isMenuEligibleTaxCategory: (category: string) => category === "food" || category === "food_drink",
  loadVatRules: vi.fn(async () => []),
  resolveRate: vi.fn(({
    supplyKind,
    taxCategory,
    addedSugar,
    fallbackRate,
  }: {
    supplyKind: string;
    taxCategory: string;
    addedSugar: boolean;
    fallbackRate: number;
  }) => supplyKind === "to_go" && taxCategory === "hot_beverage" && !addedSugar
    ? { rate: 9.5, ruleId: 301 }
    : { rate: fallbackRate, ruleId: null }),
  resolveSupplyKind: vi.fn((narociloToGo: boolean, postavkaToGo: boolean) =>
    narociloToGo || postavkaToGo ? "to_go" : "eat_in"),
  getNastavitveMap: vi.fn(async () => ({})),
}));

vi.mock("../lib/sim-datum", () => ({
  getSimDatumOrNow: vi.fn(async () => new Date(simTimeState.value)),
}));

vi.mock("../lib/pos-z-helpers", () => ({
  getCurrentPoslovniDatum: vi.fn(async () => "2026-08-23"),
  lockPosBusinessDay: vi.fn(async () => undefined),
  isPosBusinessDayClosed: vi.fn(async (_tx, _enotaId, businessDate: string) =>
    currentDayState.closed || currentDayState.closedDates.has(businessDate)),
  checkPreviousBusinessDayClosed: vi.fn(async () => ({ ...previousDayState })),
}));

vi.mock("../lib/rezervacijeMiz", async (importOriginal) => {
  const original = await importOriginal<typeof import("../lib/rezervacijeMiz")>();
  return {
    ...original,
    assertOpenOrderCanChange: vi.fn(async () => undefined),
    jeMizaBlokiranaZaNarocilo: vi.fn(async () => false),
    zakleniMizo: vi.fn(async () => true),
  };
});

import narocilaRouter from "../routes/pos/narocila";
import { lockPosBusinessDay } from "../lib/pos-z-helpers";

// ETA/telephone order tests don't provision KDS stations; that service has its
// own integration coverage against real station/task fixtures.
vi.mock("../routes/pos/kds", () => ({ materializirajKdsNaloge: vi.fn(async () => undefined) }));

function app() {
  const result = express();
  result.use(express.json());
  result.use((req, _res, next) => {
    (req as unknown as { enotaId: number }).enotaId = 1;
    next();
  });
  result.use(narocilaRouter);
  result.use((error: Error, _req: any, res: any, _next: any) => {
    res.status(500).json({ error: error.message });
  });
  return result;
}

function resetState() {
  currentDayState.closed = false;
  currentDayState.closedDates.clear();
  simTimeState.value = new Date("2026-08-23T10:02:00.000Z");
  previousDayState.allowed = true;
  previousDayState.previousBusinessDate = null;
  previousDayState.missingRegisters = [];
  dbState.order = null;
  dbState.article = {
    id: 9,
    ime: "Pizza",
    cena: "10.00",
    davek: "22",
    toGo: true,
    nabavniArtikel: false,
    happyHourCena: null,
    casPripraveMin: 17,
    kategorijaTip: "hrana",
    jePica: false,
    taxCategory: "food",
    addedSugar: false,
    toGoArtikli: [],
  };
  dbState.toGoArtikli = [];
  dbState.customer = null;
  dbState.naselje = null;
  dbState.postavke = [];
  dbState.queueLines = [];
  dbState.estimateSelect = 0;
  dbState.nextOrderId = 1;
  dbState.nextPostavkaId = 1;
  dbState.selectQueue = [];
  dbState.settings = {
    dostavaArtikelId: "41",
    telefonNarocilaOsnovniCasMin: "10",
    telefonNarocilaCakalnaVrstaMin: "0",
    telefonNarocilaKapaciteta: "1",
    telefonNarocilaNajvecCasMin: "90",
    telefonNarocilaZaokrozevanjeMin: "5",
  };
}

async function createTelephoneOrder() {
  return request(app()).post("/narocila").send({
    nacin: "telefon",
    strankaIme: "Ana",
    strankaTelefon: "040123456",
  });
}

beforeEach(resetState);

describe("telefonska naročila", () => {
  it("ne odpre novega naročila po Z-zaključku tekočega poslovnega dne", async () => {
    currentDayState.closed = true;

    const response = await createTelephoneOrder();

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: "TRENUTNI_POSLOVNI_DAN_JE_ZAKLJUCEN",
      businessDate: "2026-08-23",
    });
    expect(dbState.order).toBeNull();
    expect(dbState.customer).toBeNull();
  });

  it("blokira novo naročilo, dokler prejšnji delovni dan nima zaklenjenega Z-poročila", async () => {
    previousDayState.allowed = false;
    previousDayState.previousBusinessDate = "2026-08-22";
    previousDayState.missingRegisters = [{ id: 4, name: "Glavna blagajna" }];

    const response = await createTelephoneOrder();

    expect(response.status).toBe(409);
    expect(response.body).toMatchObject({
      code: "PREJSNJI_POSLOVNI_DAN_NI_ZAKLJUCEN",
      previousBusinessDate: "2026-08-22",
      missingRegisters: [{ id: 4, name: "Glavna blagajna" }],
    });
    expect(response.body.error).toContain("Glavna blagajna");
    expect(dbState.order).toBeNull();
    expect(dbState.customer).toBeNull();
  });

  it("po Z-zaključku ne dovoli ponovnega odprtja zaključenega naročila", async () => {
    await createTelephoneOrder();
    dbState.order!.status = "zakljuceno";
    currentDayState.closed = true;

    const response = await request(app()).put("/narocila/1").send({ status: "odprto" });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("TRENUTNI_POSLOVNI_DAN_JE_ZAKLJUCEN");
    expect(dbState.order!.status).toBe("zakljuceno");
  });

  it("po Z-zaključku ne dovoli ponovnega odprtja s prenosom na drugo mizo", async () => {
    await request(app()).post("/narocila").send({ mizaId: 5 });
    dbState.order!.status = "zakljuceno";
    currentDayState.closed = true;

    const response = await request(app()).put("/narocila/1").send({
      status: "odprto",
      mizaId: 6,
    });

    expect(response.status).toBe(409);
    expect(response.body.code).toBe("TRENUTNI_POSLOVNI_DAN_JE_ZAKLJUCEN");
    expect(dbState.order).toMatchObject({ status: "zakljuceno", mizaId: 5 });
    expect(lockPosBusinessDay).toHaveBeenCalled();
  });

  it("tudi zapiranje naročila serializira z Z-zaključkom", async () => {
    await request(app()).post("/narocila").send({ mizaId: 5 });
    vi.mocked(lockPosBusinessDay).mockClear();

    const response = await request(app()).put("/narocila/1").send({ status: "zakljuceno" });

    expect(response.status).toBe(200);
    expect(dbState.order!.status).toBe("zakljuceno");
    expect(lockPosBusinessDay).toHaveBeenCalledTimes(1);
  });

  it("naročila iz že Z-zaklenjenega prejšnjega dne ne odpre znova naslednji dan", async () => {
    await createTelephoneOrder();
    dbState.order!.status = "zakljuceno";
    currentDayState.closedDates.add("2026-08-23");
    simTimeState.value = new Date("2026-08-24T10:02:00.000Z");

    const reopenResponse = await request(app()).put("/narocila/1").send({ status: "odprto" });
    const addItemResponse = await request(app()).post("/narocila/1/postavke").send({
      artikelId: 9,
      kolicina: 1,
    });

    expect(reopenResponse.status).toBe(409);
    expect(reopenResponse.body).toMatchObject({
      code: "IZVORNI_POSLOVNI_DAN_JE_ZAKLJUCEN",
      originalBusinessDate: "2026-08-23",
    });
    expect(dbState.order!.status).toBe("zakljuceno");
    expect(addItemResponse.status).toBe(409);
    expect(dbState.postavke).toHaveLength(0);
  });

  it("GET aktivnih naročil vrne podatke prevzema za UI", async () => {
    dbState.selectQueue = [[{
      id: 4, stevilkaNarocila: 10, mizaId: null, mizaStevilka: null, mizaIme: null,
      prostorId: null, prostorIme: null, status: "odprto", skupaj: "0",
      opomba: null, toGo: true, nacin: "telefon", strankaIme: "Ana",
      strankaTelefon: "040123456", shranjeniKupecId: 8,
      predvidenPrevzem: new Date("2026-08-23T10:30:00Z"), predvidenPrevzemRocen: false,
      ustvarjeno: new Date("2026-08-23T10:00:00Z"), posodobljeno: null,
    }], [], []];

    const response = await request(app()).get("/narocila/aktivna");
    expect(response.status).toBe(200);
    expect(response.body[0]).toMatchObject({
      nacin: "telefon",
      strankaIme: "Ana",
      strankaTelefon: "040123456",
      shranjeniKupecId: 8,
      predvidenPrevzemRocen: false,
    });
    expect(response.body[0].predvidenPrevzem).toBe("2026-08-23T10:30:00.000Z");
  });

  it("ustvari telefonsko naročilo, shrani naročnika tudi za prevzem in izračuna prevzem", async () => {
    const response = await createTelephoneOrder();

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      nacin: "telefon",
      strankaIme: "Ana",
      strankaTelefon: "040123456",
      predvidenPrevzemRocen: false,
    });
    expect(response.body.predvidenPrevzem).toBe("2026-08-23T10:15:00.000Z");
    expect(dbState.order).toMatchObject({
      nacin: "telefon",
      strankaIme: "Ana",
      strankaTelefon: "040123456",
      narocnikId: 20,
      predvidenPrevzem: new Date("2026-08-23T10:15:00.000Z"),
    });
    expect(dbState.customer).toMatchObject({
      id: 20,
      ime: "Ana",
      telefon: "040123456",
      steviloNarocil: 1,
    });
  });

  it("praznemu naročilu mize še ne določi časa priprave brez postavk", async () => {
    const response = await request(app()).post("/narocila").send({ mizaId: 5 });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      nacin: "miza",
      predvidenPrevzemRocen: false,
      predvidenPrevzem: null,
    });
    expect(dbState.order).toMatchObject({
      nacin: "miza",
      predvidenPrevzem: null,
    });
  });

  it("zavrne telefonsko naročilo, ki vsebuje mizo", async () => {
    const response = await request(app()).post("/narocila").send({
      nacin: "telefon",
      mizaId: 3,
      strankaIme: "Ana",
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("vezano na mizo");
  });

  it("ročno nastavljen čas označi kot ročen in ga samodejni preračun ne prepiše", async () => {
    await createTelephoneOrder();
    const rocniCas = "2026-08-23T12:34:00.000Z";

    const response = await request(app()).put("/narocila/1").send({
      predvidenPrevzem: rocniCas,
    });
    expect(response.status).toBe(200);
    expect(response.body.predvidenPrevzem).toBe(rocniCas);
    expect(response.body.predvidenPrevzemRocen).toBe(true);

    dbState.article!.casPripraveMin = 60;
    const addResponse = await request(app()).post("/narocila/1/postavke").send({
      artikelId: 9,
      kolicina: 1,
    });
    expect(addResponse.status, JSON.stringify(addResponse.body)).toBe(201);
    expect(addResponse.body.predvidenPrevzem).toBe(rocniCas);
    expect(addResponse.body.predvidenPrevzemRocen).toBe(true);
  });

  it("po izklopu ročnega časa ponovno izračuna oceno", async () => {
    await createTelephoneOrder();
    const rocniCas = "2026-08-23T12:34:00.000Z";
    await request(app()).put("/narocila/1").send({ predvidenPrevzem: rocniCas });

    const response = await request(app()).put("/narocila/1").send({
      predvidenPrevzemRocen: false,
    });

    expect(response.status).toBe(200);
    expect(response.body.predvidenPrevzemRocen).toBe(false);
    expect(response.body.predvidenPrevzem).not.toBe(rocniCas);
  });

  it("posodobi oceno po dodajanju in po brisanju postavke", async () => {
    await createTelephoneOrder();
    const predDodajanjem = dbState.order!.predvidenPrevzem;

    dbState.article!.casPripraveMin = 40;
    const addResponse = await request(app()).post("/narocila/1/postavke").send({
      artikelId: 9,
      kolicina: 1,
    });
    expect(addResponse.status).toBe(201);
    const poDodajanju = dbState.order!.predvidenPrevzem;
    expect(poDodajanju).not.toEqual(predDodajanjem);

    const deleteResponse = await request(app()).delete("/narocila/1/postavke/1");
    expect(deleteResponse.status).toBe(200);
    expect(dbState.order!.predvidenPrevzem).not.toEqual(poDodajanju);
  });

  it("za čisto pijačo uporabi bar, mešano naročilo pa ponovno kuhinjo", async () => {
    await createTelephoneOrder();
    dbState.article!.kategorijaTip = "pijaca";
    dbState.article!.casPripraveMin = 0;
    dbState.queueLines = [{ artikelId: 81, kategorijaTip: "hrana", casPripraveMin: 60, kolicina: 1 }];

    const drinkResponse = await request(app()).post("/narocila/1/postavke").send({
      artikelId: 9,
      kolicina: 1,
    });
    expect(drinkResponse.status).toBe(201);
    const drinkDelayMinutes = (dbState.order!.predvidenPrevzem.getTime() - Date.now()) / 60_000;
    expect(drinkDelayMinutes).toBeGreaterThan(2.9);
    expect(drinkDelayMinutes).toBeLessThanOrEqual(3);

    dbState.article!.kategorijaTip = "hrana";
    dbState.queueLines = [];
    const mixedResponse = await request(app()).post("/narocila/1/postavke").send({
      artikelId: 9,
      kolicina: 1,
    });
    expect(mixedResponse.status).toBe(201);
    const mixedDelayMinutes = (dbState.order!.predvidenPrevzem.getTime() - Date.now()) / 60_000;
    expect(mixedDelayMinutes).toBeGreaterThanOrEqual(9.9);
    expect(mixedDelayMinutes).toBeLessThanOrEqual(15);
  });

  it("pri novem pivu ne všteje že pripravljene hrane istega naročila", async () => {
    const orderResponse = await request(app()).post("/narocila").send({ mizaId: 5 });
    expect(orderResponse.status).toBe(201);

    dbState.postavke.push({
      id: 99,
      artikelId: 100,
      ime: "Pripravljena pica",
      kolicina: 1,
      cenaKos: "10.00",
      skupaj: "10.00",
      davek: "9.5",
      casPripraveMin: 12,
      kategorijaTip: "hrana",
      pripravljeno: new Date("2026-08-23T10:01:00.000Z"),
    });
    dbState.article!.ime = "Pivo";
    dbState.article!.kategorijaTip = "pijaca";
    dbState.article!.casPripraveMin = 0;

    const response = await request(app()).post("/narocila/1/postavke").send({
      artikelId: 9,
      kolicina: 1,
    });

    expect(response.status).toBe(201);
    const delayMinutes = (dbState.order!.predvidenPrevzem.getTime() - Date.now()) / 60_000;
    expect(delayMinutes).toBeGreaterThan(2.9);
    expect(delayMinutes).toBeLessThanOrEqual(3);
  });

  it("sprejme običajen artikel in ga na telefonskem naročilu samodejno označi To Go", async () => {
    await createTelephoneOrder();

    dbState.article!.toGo = false;
    const response = await request(app()).post("/narocila/1/postavke").send({
      artikelId: 9,
      kolicina: 1,
    });
    expect(response.status).toBe(201);
    expect(dbState.postavke[0]).toMatchObject({ artikelId: 9, toGo: true });
  });

  it("za POS pico brez poslane velikosti izbere normalno ceno namesto male", async () => {
    await createTelephoneOrder();
    Object.assign(dbState.article!, {
      jePica: true,
      cena: "10.00",
      cenaMala: "7.00",
      cenaDruzinska: "15.00",
    });
    Object.assign(dbState.settings, {
      picaPremerMala: "28",
      picaPremerNormalna: "32",
      picaPremerDruzinska: "36",
    });

    const response = await request(app()).post("/narocila/1/postavke").send({
      artikelId: 9,
      kolicina: 1,
    });

    expect(response.status).toBe(201);
    expect(dbState.postavke[0]).toMatchObject({
      artikelId: 9,
      cenaKos: "10",
      cenaKosOriginalna: "10",
      velikostPice: "normalna",
    });
  });

  it("pri telefonskem prevzemu samodejno doda pripadajoči To Go artikel", async () => {
    await createTelephoneOrder();
    dbState.article!.toGoArtikli = [19];
    dbState.toGoArtikli = [{ id: 19, ime: "Škatla za pico", cena: "0.30" }];

    const response = await request(app()).post("/narocila/1/postavke").send({
      artikelId: 9,
      kolicina: 1,
    });

    expect(response.status).toBe(201);
    expect(dbState.postavke).toHaveLength(2);
    expect(dbState.postavke[1]).toMatchObject({
      artikelId: 19, parentPostavkaId: dbState.postavke[0].id, toGo: true, davek: "22",
    });
  });

  it("konfigurirane dostavne storitve ne označi To Go niti pri neposrednem dodajanju postavke", async () => {
    await createTelephoneOrder();
    dbState.article = {
      id: 41, ime: "Dostava", cena: "0.70", davek: "22", vrstaArtikla: "storitev",
      aktiven: true, toGo: false, casPripraveMin: 0,
    };

    const response = await request(app()).post("/narocila/1/postavke").send({
      artikelId: 41,
      kolicina: 1,
    });

    expect(response.status).toBe(201);
    expect(dbState.postavke[0]).toMatchObject({ artikelId: 41, toGo: false });
  });

  it("za že odprto dostavo ohrani izjemo To Go po menjavi trenutne nastavitve storitve", async () => {
    dbState.article = {
      id: 41, ime: "Dostava A", cena: "0.70", davek: "22", vrstaArtikla: "storitev",
      aktiven: true, toGo: false, casPripraveMin: 0,
    };
    dbState.customer = { id: 11, ime: "Ana Novak", telefon: "040123456", steviloNarocil: 3 };
    dbState.naselje = { id: 7, naziv: "Center", oddaljenostKm: "5", cenaDostave: "0", casDostaveMin: 12 };
    await request(app()).post("/narocila").send({
      nacin: "telefon", nacinIzpolnitve: "dostava", narocnikId: 11,
      dostavaNaslov: { ulica: "Glavna", hisnaStevilka: "12", naseljeId: 7 },
    });

    dbState.settings.dostavaArtikelId = "42";
    const response = await request(app()).post("/narocila/1/postavke").send({
      artikelId: 41,
      kolicina: 1,
    });

    expect(response.status).toBe(201);
    expect(dbState.postavke.at(-1)).toMatchObject({ artikelId: 41, toGo: false });
  });

  it("vrne predvideni čas, zaokrožen na večkratnik nastavljenega intervala", async () => {
    const response = await createTelephoneOrder();
    const minutes = new Date(response.body.predvidenPrevzem).getUTCMinutes();

    expect(minutes % 5).toBe(0);
  });

  it("ob dostavi shrani snapshot, zaračuna dostavno postavko in poveča statistiko naročnika", async () => {
    dbState.article = {
      id: 41, ime: "Dostava", cena: "0.70", davek: "22", vrstaArtikla: "storitev",
      aktiven: true, toGo: false, casPripraveMin: 0,
    };
    dbState.customer = { id: 11, ime: "Ana Novak", telefon: "040123456", steviloNarocil: 3 };
    dbState.naselje = { id: 7, naziv: "Center", oddaljenostKm: "5", cenaDostave: "3.50", casDostaveMin: 12 };

    const response = await request(app()).post("/narocila").send({
      nacin: "telefon",
      nacinIzpolnitve: "dostava",
      narocnikId: 11,
      dostavaNaslov: { ulica: "Glavna ulica", hisnaStevilka: "12A", naseljeId: 7 },
    });

    expect(response.status).toBe(201);
    expect(response.body).toMatchObject({
      nacinIzpolnitve: "dostava",
      narocnikId: 11,
      dostavaUlica: "Glavna ulica",
      dostavaNaseljeNaziv: "Center",
      dostavaCena: 3.5,
      dostavaCasMin: 12,
      predvidenPrevzem: "2026-08-23T10:15:00.000Z",
      predvidenaDostava: "2026-08-23T10:27:00.000Z",
    });
    expect(dbState.postavke).toHaveLength(1);
    expect(dbState.postavke[0]).toMatchObject({
      artikelId: 41, cenaKos: "3.5", skupaj: "3.5", davek: "22",
    });
    expect(dbState.customer.steviloNarocil).toBe(4);
  });

  it("predogled dostave pokaže kilometrski izračun iz dostavne storitve", async () => {
    dbState.article = {
      id: 41, ime: "Prevoz", cena: "0.70", davek: "22", vrstaArtikla: "storitev",
      aktiven: true, toGo: false, casPripraveMin: 0,
    };
    dbState.naselje = { id: 7, naziv: "Center", oddaljenostKm: "5", cenaDostave: "0", casDostaveMin: 12 };

    const response = await request(app()).get("/dostava/predogled?naseljeId=7");

    expect(response.status).toBe(200);
    expect(response.body).toEqual({
      storitevIme: "Prevoz",
      cenaNaKm: 0.7,
      oddaljenostKm: 5,
      cenaNaselja: 0,
      cenaDostave: 3.5,
      casDostaveMin: 12,
    });
  });

  it("ob odpiranju starega telefonskega naročila varno uskladi nezaračunano To Go oznako", async () => {
    await createTelephoneOrder();
    dbState.postavke = [{
      id: 1, narociloId: 1, artikelId: 9, ime: "Pizza", kolicina: 1,
      cenaKos: "10", cenaKosOriginalna: "10", skupaj: "10", davek: "9.5", toGo: false,
    }];

    const response = await request(app()).get("/narocila/1");

    expect(response.status).toBe(200);
    expect(response.body.postavke[0].toGo).toBe(true);
    expect(dbState.postavke[0].toGo).toBe(true);
  });

  it("ob odpiranju starega To Go naročila preračuna DDV nesladkanega čaja brez uporabljenega pravila", async () => {
    await createTelephoneOrder();
    dbState.article = {
      id: 9,
      ime: "Nesladkan čaj",
      cena: "3.00",
      davek: "22",
      taxCategory: "hot_beverage",
      addedSugar: false,
      aktiven: true,
      toGo: true,
      casPripraveMin: 0,
    };
    dbState.postavke = [{
      id: 1,
      narociloId: 1,
      artikelId: 9,
      ime: "Nesladkan čaj",
      kolicina: 1,
      cenaKos: "3",
      cenaKosOriginalna: "3",
      skupaj: "3",
      davek: "22",
      toGo: false,
      appliedRuleId: null,
      racunId: null,
      parentPostavkaId: null,
    }];

    const response = await request(app()).get("/narocila/1");

    expect(response.status).toBe(200);
    expect(response.body.postavke[0]).toMatchObject({
      ime: "Nesladkan čaj",
      toGo: true,
      davek: 9.5,
    });
    expect(dbState.postavke[0]).toMatchObject({
      toGo: true,
      davek: "9.5",
      appliedRuleId: 301,
    });
  });

  it("prevzemnemu telefonskemu naročilu ne doda dostavne postavke", async () => {
    const response = await createTelephoneOrder();
    expect(response.status).toBe(201);
    expect(response.body.nacinIzpolnitve).toBe("prevzem");
    expect(dbState.postavke).toHaveLength(0);
  });

  it("ob spremembi naselja posodobi snapshot, ceno postavke in čas prihoda", async () => {
    dbState.article = {
      id: 41, ime: "Dostava", cena: "0.70", davek: "9.5", vrstaArtikla: "storitev",
      aktiven: true, toGo: false, casPripraveMin: 0,
    };
    dbState.customer = { id: 11, ime: "Ana Novak", telefon: "040123456", steviloNarocil: 3 };
    dbState.naselje = { id: 7, naziv: "Center", oddaljenostKm: "5", cenaDostave: "3.50", casDostaveMin: 12 };
    await request(app()).post("/narocila").send({
      nacin: "telefon", nacinIzpolnitve: "dostava", narocnikId: 11,
      dostavaNaslov: { ulica: "Glavna", hisnaStevilka: "12", naseljeId: 7 },
    });

    dbState.naselje = { id: 8, naziv: "Šiška", oddaljenostKm: "8", cenaDostave: "5.00", casDostaveMin: 20 };
    const response = await request(app()).put("/narocila/1").send({
      dostavaNaslov: { ulica: "Glavna", hisnaStevilka: "12", naseljeId: 8 },
    });

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      dostavaNaseljeId: 8,
      dostavaNaseljeNaziv: "Šiška",
      dostavaCena: 5,
      dostavaCasMin: 20,
    });
    expect(new Date(response.body.predvidenaDostava).getTime()).toBe(
      new Date(response.body.predvidenPrevzem).getTime() + 20 * 60_000,
    );
    expect(dbState.postavke).toHaveLength(1);
    expect(dbState.postavke[0]).toMatchObject({ cenaKos: "5", skupaj: "5", davek: "9.5" });
  });

  it("dostavo zavrne, če enota nima nastavljenega dostavnega artikla", async () => {
    delete dbState.settings.dostavaArtikelId;
    const response = await request(app()).post("/narocila").send({
      nacin: "telefon",
      nacinIzpolnitve: "dostava",
      strankaIme: "Ana",
      strankaTelefon: "040123456",
      dostavaNaslov: { ulica: "Glavna", hisnaStevilka: "12", naseljeId: 7 },
    });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("Nastavite dostavno storitev");
  });
});