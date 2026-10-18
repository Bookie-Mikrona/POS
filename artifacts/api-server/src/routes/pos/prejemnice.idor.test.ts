import express from "express";
import supertest from "supertest";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  rows: [] as unknown[][],
}));

vi.mock("@workspace/db", async (importOriginal) => {
  const original = await importOriginal<typeof import("@workspace/db")>();
  const select = () => {
    const chain: Record<string, any> = {};
    for (const method of ["from", "innerJoin", "leftJoin", "where", "groupBy", "orderBy", "limit"]) {
      chain[method] = () => chain;
    }
    chain.then = (resolve: (value: unknown[]) => unknown, reject: (error: unknown) => unknown) =>
      Promise.resolve(state.rows.shift() ?? []).then(resolve, reject);
    return chain;
  };
  return { ...original, db: { ...original.db, select } };
});

vi.mock("../../middlewares/pos", () => ({
  requireEnota(req: express.Request, res: express.Response, next: express.NextFunction) {
    const companyId = req.header("x-test-company");
    const enotaId = Number(req.header("x-test-enota"));
    if (!companyId || !Number.isInteger(enotaId) || enotaId <= 0) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    (req as any).companyId = companyId;
    (req as any).enotaId = enotaId;
    next();
  },
  requireIzbranaEnota(req: express.Request, res: express.Response, next: express.NextFunction) {
    const companyId = req.header("x-test-company");
    const enotaId = Number(req.header("x-test-enota"));
    if (!companyId || !Number.isInteger(enotaId) || enotaId <= 0) {
      res.status(401).json({ error: "Unauthorized" });
      return;
    }
    (req as any).companyId = companyId;
    (req as any).enotaId = enotaId;
    next();
  },
}));

describe("GET /prejemnice/:id authorization scope", () => {
  let app: express.Express;

  beforeAll(async () => {
    const router = (await import("./prejemnice")).default;
    app = express();
    app.use(express.json());
    app.use(router);
  });

  beforeEach(() => {
    state.rows = [];
  });

  it("zavrne neavtenticiran zahtevek, še preden bere podatke", async () => {
    const response = await supertest(app).get("/prejemnice/42");
    expect(response.status).toBe(401);
    expect(state.rows).toHaveLength(0);
  });

  it.each([
    ["druga enota", "company-a", "2"],
    ["drugo podjetje", "company-b", "1"],
  ])("za %s vrne 404 in ne naloži povezanih podatkov", async (_name, companyId, enotaId) => {
    state.rows = [[]];
    const response = await supertest(app)
      .get("/prejemnice/42")
      .set("x-test-company", companyId)
      .set("x-test-enota", enotaId);
    expect(response.status).toBe(404);
    expect(state.rows).toHaveLength(0);
  });

  it("avtorizirani isti enoti vrne prejemnico in šele nato naloži povezane podatke", async () => {
    state.rows = [[{
      id: 42,
      stevilka: "P-42",
      datum: new Date("2026-03-01T10:00:00Z"),
      datumDokumenta: "2026-03-01",
      stDokumenta: null,
      valuta: "EUR",
      datumZapadlosti: null,
      ddvOsnova: "10.00",
      ddvZnesek: "2.20",
      opomba: null,
      vrstaCen: "neto",
      skupajVrednost: "10.00",
      ustvarjeno: new Date("2026-03-01T10:00:00Z"),
      dobaviteljId: "supplier",
      dobaviteljNaziv: "Dobavitelj",
    }], [], []];
    const response = await supertest(app)
      .get("/prejemnice/42")
      .set("x-test-company", "company-a")
      .set("x-test-enota", "1");
    expect(response.status, response.text).toBe(200);
    expect(response.body).toMatchObject({
      id: 42,
      stevilka: "P-42",
      dobaviteljNaziv: "Dobavitelj",
      postavke: [],
      odvisniStroski: [],
    });
    expect(state.rows).toHaveLength(0);
  });

  it("pri pregledih paketov vrne imena samo za iskalno rešene osebe in obdrži ID-je", async () => {
    const review = (id: number, clerk: string, natakar: number | null) => ({
      id, prejemnicaId: 42, supplierOrderLineId: id, articleName: "Mleko",
      orderPackageName: "zaboj", orderFactor: "6", orderBaseUnit: "L",
      currentPackageName: "večji zaboj", currentFactor: "12", currentBaseUnit: "L",
      actorClerkUserId: clerk, actorNatakarId: natakar, reviewedAt: new Date("2026-03-01T10:00:00Z"),
    });
    state.rows = [[{
      id: 42, stevilka: "P-42", datum: new Date("2026-03-01T10:00:00Z"), valuta: "EUR",
      vrstaCen: "neto", skupajVrednost: "10.00", ustvarjeno: new Date("2026-03-01T10:00:00Z"),
    }], [], [],
    [review(1, "user_known", 7), review(2, "user_other_unit", 8)],
    [{ clerkUserId: "user_known", ime: "Ana", priimek: "Novak" }],
    [{ id: 7, ime: "Jure", priimek: "Kovač" }]];
    const response = await supertest(app)
      .get("/prejemnice/42")
      .set("x-test-company", "company-a")
      .set("x-test-enota", "1");
    expect(response.status, response.text).toBe(200);
    expect(response.body.packageChangeReviews).toMatchObject([
      { actorClerkUserId: "user_known", actorClerkUserName: "Ana Novak", actorNatakarId: 7, actorNatakarName: "Jure Kovač" },
      { actorClerkUserId: "user_other_unit", actorClerkUserName: null, actorNatakarId: 8, actorNatakarName: null },
    ]);
    expect(state.rows).toHaveLength(0);
  });
});

describe("POST /prejemnice generic article unit validation", () => {
  let app: express.Express;

  beforeAll(async () => {
    const router = (await import("./prejemnice")).default;
    app = express();
    app.use(express.json());
    app.use(router);
  });

  beforeEach(() => {
    state.rows = [];
  });

  it("zavrne generični artikel brez izrecne izvorne enote namesto uporabe ciljne enote", async () => {
    state.rows = [[{
      id: 10,
      ime: "Generični artikel",
      imeZaNabavo: null,
      enotaMere: "kg",
      jeSkupinskiNabavniArtikel: true,
      povratnaEmbalaza: false,
      depozitnaVrednost: null,
    }]];

    const response = await supertest(app)
      .post("/prejemnice")
      .set("x-test-company", "company-a")
      .set("x-test-enota", "1")
      .send({ postavke: [{ artikelId: 10, kolicina: 1, cenaKos: 2 }] });

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("izvorne enote");
  });
});