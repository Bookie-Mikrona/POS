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
import { artikliTable, companiesTable, db, enoteTable, kategorijeTable, normativiTable, pizzaDoughSettingsTable, pool } from "@workspace/db";
import {
  PRIVZETE_KATEGORIJE, PRIVZETE_SAMOSTOJNE_PRIPRAVLJENE, PRIVZETI_ARTIKLI, PRIVZETI_VSI,
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
    expect(PRIVZETI_ARTIKLI.length).toBeGreaterThanOrEqual(300);
    const kljuci = PRIVZETI_VSI.map((a) => a.kljuc);
    expect(new Set(kljuci).size).toBe(kljuci.length);
    const imena = PRIVZETI_VSI.map((a) => `${a.vloga === "A"}|${a.ime.toLocaleLowerCase("sl")}`);
    expect(new Set(imena).size).toBe(imena.length);
    const kat = new Set(PRIVZETE_KATEGORIJE.map((k) => k.kljuc));
    const po = new Map(PRIVZETI_VSI.map((a) => [a.kljuc, a]));
    for (const a of PRIVZETI_VSI) {
      if (a.kat) expect(kat.has(a.kat), a.ime).toBe(true);
      if (a.vloga === "A") { expect(a.cena, a.ime).toBeGreaterThan(0); expect(a.normativ.length, a.ime).toBeGreaterThan(0); }
      if (a.vloga === "R" || a.vloga === "P") expect(a.normativ.length, a.ime).toBeGreaterThan(0);
      if (a.meal === "composite") expect(a.normativ.length, a.ime).toBeGreaterThan(0);
      for (const [k, q] of a.normativ) { expect(po.has(k), `${a.ime} -> ${k}`).toBe(true); expect(q).toBeGreaterThan(0); }
      for (const k of a.toGoArtikli) expect(po.has(k)).toBe(true);
    }
    expect(PRIVZETI_VSI.some((a) => a.vloga === "R") && PRIVZETI_VSI.some((a) => a.meal === "composite")).toBe(true);
    expect(PRIVZETE_SAMOSTOJNE_PRIPRAVLJENE.every((a) => a.vloga === "R")).toBe(true);
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

  it("uvozi sestavljeno jed s pripravljeno osnovo, pico s testom in ne prepiše obstoječega", async () => {
    requestContext.enotaId = enotaId; requestContext.vloga = "admin";
    const [obst] = await db.insert(kategorijeTable).values({ enotaId, ime: "Juhe", barva: "#000000", vrstniRed: 0 }).returning({ id: kategorijeTable.id });
    await db.insert(artikliTable).values({ enotaId, ime: "Goveja juha z zvezdicami", cena: "9.99", davek: "9.5", kategorijaId: obst!.id, prodajniArtikel: true });
    const izbor = ["A:spageti-po-bolonjsko", "A:ricet-s-klobaso", "A:margerita", "A:goveja-juha-z-zvezdicami", "A:coca-cola-0-25-l"];
    const r = await supertest(app()).post("/artikli/privzeti-sifranti").send({ artikli: izbor });
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ preskoceniArtikli: 1 });
    const art = await db.select().from(artikliTable).where(eq(artikliTable.enotaId, enotaId));
    expect(art.find((a) => a.ime === "Goveja juha z zvezdicami")?.cena).toBe("9.99");
    const sp = art.find((a) => a.ime === "Špageti po bolonjsko" && a.prodajniArtikel)!;
    expect(sp).toMatchObject({ mealType: "composite", prodajniArtikel: true });
    const omaka = art.find((a) => a.ime === "Omaka bolognese")!;
    expect(omaka).toMatchObject({ mealType: "prepared", prodajniArtikel: false, nabavniArtikel: false });
    const norms = await db.select().from(normativiTable).where(inArray(normativiTable.artikelId, art.map((a) => a.id)));
    expect(norms.some((n) => n.artikelId === sp.id && n.vhodniArtikelId === omaka.id)).toBe(true);
    expect(norms.filter((n) => n.artikelId === omaka.id).length).toBeGreaterThan(3);
    // enako ime: pripravljena osnova in prodajna jed obstajata vzporedno
    const ricet = art.filter((a) => a.ime === "Ričet s klobaso");
    expect(ricet.map((a) => a.prodajniArtikel).sort()).toEqual([false, true]);
    const margerita = art.find((a) => a.ime === "Margerita")!;
    expect(margerita).toMatchObject({ jePica: true, mealType: "composite", pripravaVrsta: "pica", toGo: true });
    expect(margerita.cenaMala).not.toBeNull();
    expect((margerita.toGoArtikli as number[]).length).toBe(1);
    const [testo] = await db.select().from(pizzaDoughSettingsTable).where(eq(pizzaDoughSettingsTable.enotaId, enotaId));
    expect(testo).toBeDefined();
    const cola = art.find((a) => a.ime === "Coca-Cola 0,25 l")!;
    expect(cola).toMatchObject({ taxCategory: "cold_beverage", nabavniArtikel: true, prodajniArtikel: true, vrstaArtikla: "blago" });
    expect(norms.filter((n) => n.artikelId === cola.id)).toMatchObject([{ vhodniArtikelId: cola.id, kolicina: "1.0000" }]);

    const ponovno = await supertest(app()).post("/artikli/privzeti-sifranti").send({ artikli: izbor });
    expect(ponovno.body).toMatchObject({ kategorije: 0, artikli: 0, preskoceniArtikli: 5, polizdelki: 0, surovine: 0, normativi: 0 });
  });

  it("uvozi celoten katalog vzporedno brez podvajanja, izolirano po enotah", async () => {
    requestContext.enotaId = drugaEnotaId; requestContext.vloga = "admin";
    const telo = { kategorije: [], artikli: [...PRIVZETI_ARTIKLI, ...PRIVZETE_SAMOSTOJNE_PRIPRAVLJENE].map((a) => a.kljuc) };
    const [a, b] = await Promise.all([
      supertest(app()).post("/artikli/privzeti-sifranti").send(telo),
      supertest(app()).post("/artikli/privzeti-sifranti").send(telo),
    ]);
    expect([a.status, b.status]).toEqual([200, 200]);
    const art = await db.select().from(artikliTable).where(eq(artikliTable.enotaId, drugaEnotaId));
    const imena = art.map((x) => `${x.prodajniArtikel}|${x.ime.toLocaleLowerCase("sl")}`);
    expect(new Set(imena).size).toBe(imena.length);
    expect(art.filter((x) => x.prodajniArtikel)).toHaveLength(PRIVZETI_ARTIKLI.length);
    const pregled = await supertest(app()).get("/artikli/privzeti-sifranti");
    expect(pregled.body.kategorije.flatMap((k: any) => k.artikli).every((x: any) => x.obstaja)).toBe(true);
  });
});
