const requestContext = vi.hoisted(() => ({ enotaId: 0, vloga: "admin" }));
vi.mock("../../middlewares/pos", () => ({
  requireEnota: (req: any, _res: unknown, next: () => void) => {
    req.enotaId = requestContext.enotaId;
    req.vloga = requestContext.vloga;
    req.companyId = "scope-is-enforced-by-requireEnota";
    next();
  },
}));

import express from "express";
import supertest from "supertest";
import { eq, inArray } from "drizzle-orm";
import { artikliTable, companiesTable, db, enoteTable, kategorijeTable, normativiTable, pool } from "@workspace/db";
import {
  PRIVZETE_KATEGORIJE, PRIVZETE_SUROVINE, PRIVZETI_ARTIKLI, PRIVZETI_POLIZDELKI,
} from "../../lib/privzeti-sifranti-katalog";
import artikliRouter from "./artikli";

const RUN_ID = Math.random().toString(36).slice(2, 9);
let companyId: string;
let enotaId: number;
let drugaEnotaId: number;
const app = () => { const a = express(); a.use(express.json()); a.use(artikliRouter); return a; };

beforeAll(async () => {
  const [c] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_TST_PS_${RUN_ID}`, naziv: `Test privzeti šifranti ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = c!.id;
  const [u] = await db.insert(enoteTable).values({ companyId, ime: `Enota A ${RUN_ID}`, aktiven: true }).returning({ id: enoteTable.id });
  const [u2] = await db.insert(enoteTable).values({ companyId, ime: `Enota B ${RUN_ID}`, aktiven: true }).returning({ id: enoteTable.id });
  enotaId = u!.id; drugaEnotaId = u2!.id;
});
afterAll(async () => {
  const ids = (await db.select({ id: artikliTable.id }).from(artikliTable)
    .where(inArray(artikliTable.enotaId, [enotaId, drugaEnotaId]))).map((r) => r.id);
  if (ids.length) await db.delete(normativiTable).where(inArray(normativiTable.artikelId, ids));
  await db.delete(enoteTable).where(inArray(enoteTable.id, [enotaId, drugaEnotaId]));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("katalog privzetih šifrantov", () => {
  it("je notranje skladen", () => {
    expect(PRIVZETE_KATEGORIJE).toHaveLength(16);
    expect(PRIVZETI_ARTIKLI.length).toBeGreaterThanOrEqual(230);
    const kljuci = PRIVZETI_ARTIKLI.map((a) => a.kljuc);
    expect(new Set(kljuci).size).toBe(kljuci.length);
    const imena = [...PRIVZETI_ARTIKLI.map((a) => a.ime), ...Object.values(PRIVZETE_SUROVINE).map((s) => s.ime),
      ...Object.values(PRIVZETI_POLIZDELKI).map((p) => p.ime)].map((i) => i.toLocaleLowerCase("sl"));
    expect(new Set(imena).size).toBe(imena.length);
    const kat = new Set(PRIVZETE_KATEGORIJE.map((k) => k.kljuc));
    for (const a of PRIVZETI_ARTIKLI) {
      expect(kat.has(a.kategorija)).toBe(true);
      expect(a.cena).toBeGreaterThan(0);
      if (!a.pakirano) expect(a.normativ.length).toBeGreaterThan(0);
      for (const [k, q] of [...a.normativ, ...Object.values(PRIVZETI_POLIZDELKI).flatMap((p) => p.normativ)]) {
        expect(PRIVZETE_SUROVINE[k] ?? PRIVZETI_POLIZDELKI[k], k).toBeDefined();
        expect(q).toBeGreaterThan(0);
      }
    }
  });
});

describe("POST/GET /artikli/privzeti-sifranti", () => {
  it("zavrne neznan, prazen izbor in uporabnika brez pravic", async () => {
    requestContext.enotaId = enotaId; requestContext.vloga = "admin";
    for (const body of [{}, { artikli: ["ne-obstaja"] }, { kategorije: ["x"] }]) {
      expect((await supertest(app()).post("/artikli/privzeti-sifranti").send(body)).status).toBe(400);
    }
    requestContext.vloga = "natakar";
    expect((await supertest(app()).post("/artikli/privzeti-sifranti").send({ kategorije: ["juhe"] })).status).toBe(403);
  });

  it("uvozi izbrano z odvisnostmi in ne prepiše obstoječega", async () => {
    requestContext.enotaId = enotaId; requestContext.vloga = "admin";
    const [obst] = await db.insert(kategorijeTable).values({ enotaId, ime: "Juhe", barva: "#000000", vrstniRed: 0 }).returning({ id: kategorijeTable.id });
    await db.insert(artikliTable).values({ enotaId, ime: "Goveja juha z zvezdicami", cena: "9.99", davek: "9.5", kategorijaId: obst!.id });
    const izbor = ["juhe-goveja-juha-z-domacimi-rezanci", "juhe-goveja-juha-z-zvezdicami", "brezalk-coca-cola-0-25-l", "vino-odprto-belo-vino-laski-rizling-0-2-l"];
    const r = await supertest(app()).post("/artikli/privzeti-sifranti").send({ artikli: izbor });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ kategorije: 2, artikli: 3, preskoceniArtikli: 1, polizdelki: 1 });
    const kat = await db.select().from(kategorijeTable).where(eq(kategorijeTable.enotaId, enotaId));
    expect(kat.filter((k) => k.ime === "Juhe")).toHaveLength(1);
    expect(kat.find((k) => k.ime === "Brezalkoholne pijače")).toMatchObject({ tip: "pijaca", oddelek: "Pijača" });
    const art = await db.select().from(artikliTable).where(eq(artikliTable.enotaId, enotaId));
    expect(art.find((a) => a.ime === "Goveja juha z zvezdicami")?.cena).toBe("9.99");
    const cola = art.find((a) => a.ime === "Coca-Cola 0,25 l")!;
    expect(cola).toMatchObject({ taxCategory: "cold_beverage", addedSugar: true, nabavniArtikel: true, prodajniArtikel: true, vrstaArtikla: "blago" });
    const vino = art.find((a) => a.ime === "Odprto belo vino – Laški rizling 0,2 l")!;
    expect(vino).toMatchObject({ taxCategory: "alcoholic", jeAlkohol: true, nabavniArtikel: false });
    const norms = await db.select().from(normativiTable).where(inArray(normativiTable.artikelId, art.map((a) => a.id)));
    expect(norms.filter((n) => n.artikelId === cola.id)).toMatchObject([{ vhodniArtikelId: cola.id, kolicina: "1.0000" }]);
    expect(norms.filter((n) => n.artikelId === vino.id)).toHaveLength(1);
    const juha = art.find((a) => a.ime === "Goveja juha (osnova)")!;
    expect(juha).toMatchObject({ nabavniArtikel: false, prodajniArtikel: false });
    expect(norms.filter((n) => n.artikelId === juha.id).length).toBeGreaterThan(0);

    const ponovno = await supertest(app()).post("/artikli/privzeti-sifranti").send({ artikli: izbor });
    expect(ponovno.body).toMatchObject({ kategorije: 0, artikli: 0, preskoceniArtikli: 4, polizdelki: 0, surovine: 0, normativi: 0 });
  });

  it("uvozi celoten katalog vzporedno brez podvajanja, izolirano po enotah", async () => {
    requestContext.enotaId = drugaEnotaId; requestContext.vloga = "admin";
    const telo = { kategorije: PRIVZETE_KATEGORIJE.map((k) => k.kljuc), artikli: PRIVZETI_ARTIKLI.map((a) => a.kljuc) };
    const [a, b] = await Promise.all([
      supertest(app()).post("/artikli/privzeti-sifranti").send(telo),
      supertest(app()).post("/artikli/privzeti-sifranti").send(telo),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    expect([a.body.artikli, b.body.artikli].sort((x, y) => x - y)).toEqual([0, PRIVZETI_ARTIKLI.length]);
    const art = await db.select().from(artikliTable).where(eq(artikliTable.enotaId, drugaEnotaId));
    const imena = art.map((x) => x.ime.toLocaleLowerCase("sl"));
    expect(new Set(imena).size).toBe(imena.length);
    expect(art.filter((x) => x.prodajniArtikel)).toHaveLength(PRIVZETI_ARTIKLI.length);
    expect(art.every((x) => ["food", "food_drink", "hot_beverage", "cold_beverage", "alcoholic", "other"].includes(x.taxCategory))).toBe(true);
    const pregled = await supertest(app()).get("/artikli/privzeti-sifranti");
    expect(pregled.body.kategorije.flatMap((k: any) => k.artikli).every((x: any) => x.obstaja)).toBe(true);
  });
});
