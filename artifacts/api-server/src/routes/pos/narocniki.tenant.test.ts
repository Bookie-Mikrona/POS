import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { eq, inArray } from "drizzle-orm";
import {
  companiesTable,
  db,
  enoteTable,
  narocnikNasloviTable,
  narocnikiTable,
  naseljaTable,
  pool,
} from "@workspace/db";
import { getNaslovi } from "./narocniki";

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();

let companyId: string;
let enotaId: number;
let drugaEnotaId: number;
let narocnikId: number;
let naslovId: number;
let naseljeId: number;

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_NASLOVI_${RUN_ID}`,
    naziv: `Naslovi test ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;

  const [enota] = await db.insert(enoteTable).values({
    companyId,
    ime: `Naslovi A ${RUN_ID}`,
  }).returning({ id: enoteTable.id });
  enotaId = enota!.id;

  const [drugaEnota] = await db.insert(enoteTable).values({
    companyId,
    ime: `Naslovi B ${RUN_ID}`,
  }).returning({ id: enoteTable.id });
  drugaEnotaId = drugaEnota!.id;

  const [naselje] = await db.insert(naseljaTable).values({
    enotaId,
    naziv: `Naselje ${RUN_ID}`,
  }).returning({ id: naseljaTable.id });
  naseljeId = naselje!.id;

  const [narocnik] = await db.insert(narocnikiTable).values({
    enotaId,
    ime: "Testna oseba",
    telefon: "040123456",
    telefonNormaliziran: "040123456",
  }).returning({ id: narocnikiTable.id });
  narocnikId = narocnik!.id;

  const [naslov] = await db.insert(narocnikNasloviTable).values({
    narocnikId,
    ulica: "Glavna",
    hisnaStevilka: "1",
    naseljeId,
  }).returning({ id: narocnikNasloviTable.id });
  naslovId = naslov!.id;
});

afterAll(async () => {
  await db.delete(narocnikNasloviTable).where(eq(narocnikNasloviTable.id, naslovId));
  await db.delete(narocnikiTable).where(eq(narocnikiTable.id, narocnikId));
  await db.delete(naseljaTable).where(eq(naseljaTable.id, naseljeId));
  await db.delete(enoteTable).where(inArray(enoteTable.id, [enotaId, drugaEnotaId]));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("getNaslovi — enotna izolacija", () => {
  it("vrne naslov samo za enoto, ki ji pripada naročnik", async () => {
    const mojiNaslovi = await getNaslovi(narocnikId, enotaId);
    const tujiKontekst = await getNaslovi(narocnikId, drugaEnotaId);

    expect(mojiNaslovi.map((naslov) => naslov.id)).toEqual([naslovId]);
    expect(tujiKontekst).toEqual([]);
  });
});