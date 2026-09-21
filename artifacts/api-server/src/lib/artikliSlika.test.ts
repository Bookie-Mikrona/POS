import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { and, eq, inArray, isNull } from "drizzle-orm";
import { artikliTable, companiesTable, db, enoteTable, pool } from "@workspace/db";

const RUN_ID = Math.random().toString(36).slice(2, 8).toUpperCase();

let companyId: string;
let enotaId: number;
let artikelWithImageId: number;
let artikelWithoutImageId: number;

beforeAll(async () => {
  const [company] = await db.insert(companiesTable).values({
    podjetjeDavcna: `SI_SLIKA_TEST_${RUN_ID}`,
    naziv: `Test slike ${RUN_ID}`,
  }).returning({ id: companiesTable.id });
  companyId = company!.id;

  const [enota] = await db.insert(enoteTable).values({
    companyId,
    ime: `Test enota slike ${RUN_ID}`,
  }).returning({ id: enoteTable.id });
  enotaId = enota!.id;

  const [artikelWithImage] = await db.insert(artikliTable).values({
    enotaId,
    ime: `Artikel s sliko ${RUN_ID}`,
    cena: "10.00",
    davek: "22",
    opisSlike: "Profesionalna fotografija testnega artikla",
    slikaUrl: "https://example.com/test-image.jpg",
  }).returning({ id: artikliTable.id });
  artikelWithImageId = artikelWithImage!.id;

  const [artikelWithoutImage] = await db.insert(artikliTable).values({
    enotaId,
    ime: `Artikel brez slike ${RUN_ID}`,
    cena: "12.00",
    davek: "9.5",
    opisSlike: null,
    slikaUrl: null,
  }).returning({ id: artikliTable.id });
  artikelWithoutImageId = artikelWithoutImage!.id;
});

afterAll(async () => {
  await db.delete(artikliTable).where(inArray(artikliTable.id, [
    artikelWithImageId,
    artikelWithoutImageId,
  ]));
  await db.delete(enoteTable).where(eq(enoteTable.id, enotaId));
  await db.delete(companiesTable).where(eq(companiesTable.id, companyId));
  await pool.end();
});

describe("slikovna polja artikla", () => {
  it("poizvedba vrne opis_slike in slika_url poleg obstoječih polj", async () => {
    const rows = await db.select({
      id: artikliTable.id,
      ime: artikliTable.ime,
      opis_slike: artikliTable.opisSlike,
      slika_url: artikliTable.slikaUrl,
    }).from(artikliTable).where(
      inArray(artikliTable.id, [artikelWithImageId, artikelWithoutImageId]),
    );

    expect(rows).toHaveLength(2);
    expect(rows.every((row) =>
      Object.prototype.hasOwnProperty.call(row, "opis_slike") &&
      Object.prototype.hasOwnProperty.call(row, "slika_url"),
    )).toBe(true);
    expect(rows.map((row) => row.ime)).toEqual(expect.arrayContaining([
      `Artikel s sliko ${RUN_ID}`,
      `Artikel brez slike ${RUN_ID}`,
    ]));
  });

  it("sprejme NULL vrednosti opisa in URL-ja slike brez napake", async () => {
    const rows = await db.select({
      id: artikliTable.id,
      ime: artikliTable.ime,
      opis_slike: artikliTable.opisSlike,
      slika_url: artikliTable.slikaUrl,
    }).from(artikliTable).where(and(
      eq(artikliTable.id, artikelWithoutImageId),
      isNull(artikliTable.opisSlike),
      isNull(artikliTable.slikaUrl),
    ));

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      id: artikelWithoutImageId,
      ime: `Artikel brez slike ${RUN_ID}`,
      opis_slike: null,
      slika_url: null,
    });
  });

  it("ohrani shranjen opis in URL za sliko", async () => {
    const [row] = await db.select({
      opis_slike: artikliTable.opisSlike,
      slika_url: artikliTable.slikaUrl,
    }).from(artikliTable).where(eq(artikliTable.id, artikelWithImageId));

    expect(row).toEqual({
      opis_slike: "Profesionalna fotografija testnega artikla",
      slika_url: "https://example.com/test-image.jpg",
    });
  });
});