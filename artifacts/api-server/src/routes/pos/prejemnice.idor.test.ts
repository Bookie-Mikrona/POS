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
    chain.then = (resolve: (value: unknown[]) => void, reject: (error: unknown) => void) => {
      try {
        resolve(state.rows.shift() ?? []);
      } catch (error) {
        reject(error);
      }
    };
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
    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      id: 42,
      stevilka: "P-42",
      dobaviteljNaziv: "Dobavitelj",
      postavke: [],
      odvisniStroski: [],
    });
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