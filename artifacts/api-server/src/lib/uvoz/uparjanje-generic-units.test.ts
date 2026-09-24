import { describe, expect, it } from "vitest";
import Decimal from "decimal.js";
import { PgDialect } from "drizzle-orm/pg-core";
import {
  genericArticleUnitMatches,
  GenericArticleUnitMismatch,
  preračunajRočnoUparjanje,
  PurchaseArticleTargetNotFound,
  potrdiUparjanje,
} from "./uparjanje";

describe("generic purchase article unit compatibility", () => {
  it("compares canonical UN/ECE units rather than source spelling", () => {
    expect(genericArticleUnitMatches("kg", "KGM")).toBe(true);
    expect(genericArticleUnitMatches("KOS", "H87")).toBe(true);
    expect(genericArticleUnitMatches("l", "LTR")).toBe(true);
    expect(genericArticleUnitMatches("m2", "MTK")).toBe(true);
  });

  it("fails closed for missing, unknown, or different units", () => {
    expect(genericArticleUnitMatches(null, "KGM")).toBe(false);
    expect(genericArticleUnitMatches("kg", null)).toBe(false);
    expect(genericArticleUnitMatches("xyz", "XYZ")).toBe(false);
    expect(genericArticleUnitMatches("LTR", "KGM")).toBe(false);
  });

  it("recalculates stock quantity and net unit prices from two source packs", () => {
    const result = preračunajRočnoUparjanje("2", "20", "0", "0", new Decimal(5));
    expect(result.kolicina?.toString()).toBe("10");
    expect(result.cenaKos?.toString()).toBe("4");
    expect(result.netoCena?.toString()).toBe("4");
  });

  it("writes recalculated stock values from immutable invoice fields for generic and regular articles", async () => {
    for (const jeGeneric of [true, false]) {
      const writes: unknown[] = [];
      const fakeDb: any = {
        execute: async (statement: unknown) => {
          writes.push(statement);
          if (writes.length === 1) {
            return { rows: [{
              je_skupinski_nabavni_artikel: jeGeneric,
              nabavni_artikel: true,
              prodajni_artikel: !jeGeneric,
              enota_mere: "kg",
            }] };
          }
          if (writes.length === 2) {
            return { rows: [{
              izv_kolicina: "2",
              izv_cena: "20",
              rabat_1_odst: "0",
              rabat_2_odst: "0",
            }] };
          }
          return { rows: [] };
        },
        transaction: async (callback: (tx: any) => Promise<void>) => callback(fakeDb),
      };

      await potrdiUparjanje(fakeDb, {
        enotaId: 1,
        dobaviteljId: "supplier",
        artikelId: 4,
        postavkaId: 7,
        uporabnikId: 2,
        enotVPaketu: new Decimal(5),
        izvSifra: null,
        izvGtin: null,
        izvNaziv: null,
        izvCena: null,
        izvEnota: "KG",
        datumPrevzema: "2026-05-05",
        zapomni: false,
      });

      const update = new PgDialect().sqlToQuery(writes[2] as any);
      expect(update.sql).toContain("kolicina =");
      expect(update.sql).toContain("cena_kos =");
      expect(update.sql).toContain("neto_cena =");
      expect(update.params).toEqual(expect.arrayContaining(["10", "4"]));
      expect(update.sql).not.toContain("skupaj =");
      expect(update.sql).not.toContain("ddv_");
      expect(update.sql).not.toContain("izv_");
    }
  });

  it("rejects a missing or foreign purchase article before receipt writes", async () => {
    const executed: unknown[] = [];
    const fakeDb: any = {
      execute: async (statement: unknown) => {
        executed.push(statement);
        return { rows: [] };
      },
      transaction: async (callback: (tx: any) => Promise<void>) => callback(fakeDb),
    };

    await expect(potrdiUparjanje(fakeDb, {
      enotaId: 1,
      dobaviteljId: "supplier",
      artikelId: 999,
      postavkaId: 7,
      uporabnikId: 2,
      enotVPaketu: new Decimal(1),
      izvSifra: null,
      izvGtin: null,
      izvNaziv: null,
      izvCena: null,
      izvEnota: "kg",
      datumPrevzema: "2026-05-05",
      zapomni: false,
    })).rejects.toBeInstanceOf(PurchaseArticleTargetNotFound);
    expect(executed).toHaveLength(1);
    const targetLookup = new PgDialect().sqlToQuery(executed[0] as any);
    expect(targetLookup.sql).toContain("enota_id =");
    expect(targetLookup.sql).toContain("nabavni_artikel = true");
    expect(targetLookup.params).toEqual(expect.arrayContaining([999, 1]));
  });

  it("rejects supplier-code learning before any receipt or mapping write on mismatch", async () => {
    const executed: unknown[] = [];
    const fakeDb: any = {
      execute: async (statement: unknown) => {
        executed.push(statement);
        const rows = executed.length === 1
          ? [{
            je_skupinski_nabavni_artikel: true,
            nabavni_artikel: true,
            prodajni_artikel: false,
            enota_mere: "kg",
          }]
          : executed.length === 2
            ? [{
              izv_kolicina: "2",
              izv_cena: "20",
              rabat_1_odst: "0",
              rabat_2_odst: "0",
            }]
            : [];
        return {
          rows,
        };
      },
      transaction: async (callback: (tx: any) => Promise<void>) => callback(fakeDb),
    };

    await expect(potrdiUparjanje(fakeDb, {
      enotaId: 1,
      dobaviteljId: "supplier",
      artikelId: 4,
      postavkaId: 7,
      uporabnikId: 2,
      enotVPaketu: new Decimal(1),
      izvSifra: "SUP-1",
      izvGtin: "4006381333931",
      izvNaziv: "Supplier name",
      izvCena: new Decimal(1),
      izvEnota: "l",
      datumPrevzema: "2026-05-05",
      zapomni: true,
    })).rejects.toBeInstanceOf(GenericArticleUnitMismatch);
    expect(executed).toHaveLength(1);
  });

  it("keeps multiple supplier GTINs on mappings, not the shared article", async () => {
    const executed: unknown[] = [];
    let transactionCalls = 0;
    const fakeDb: any = {
      execute: async (statement: unknown) => {
        executed.push(statement);
        transactionCalls += 1;
        const rows = transactionCalls === 1
          ? [{
            je_skupinski_nabavni_artikel: true,
            nabavni_artikel: true,
            prodajni_artikel: false,
            enota_mere: "kg",
          }]
          : transactionCalls === 2
            ? [{
              izv_kolicina: "2",
              izv_cena: "20",
              rabat_1_odst: "0",
              rabat_2_odst: "0",
            }]
            : [];
        return {
          rows,
        };
      },
      transaction: async (callback: (tx: any) => Promise<void>) => {
        transactionCalls = 0;
        return callback(fakeDb);
      },
    };
    const confirm = (gtin: string, sifra: string) => potrdiUparjanje(fakeDb, {
      enotaId: 1,
      dobaviteljId: "supplier",
      artikelId: 4,
      postavkaId: 7,
      uporabnikId: 2,
      enotVPaketu: new Decimal(1),
      izvSifra: sifra,
      izvGtin: gtin,
      izvNaziv: `Supplier name ${sifra}`,
      izvCena: new Decimal(1),
      izvEnota: "KG",
      datumPrevzema: "2026-05-05",
      zapomni: true,
    });

    await confirm("4006381333931", "SUP-1");
    await confirm("5901234123457", "SUP-2");
    // Each operation validates the target and source line, recalculates the
    // receipt line, upserts a supplier mapping, and writes the audit record.
    // No group GTIN or supplier unit/name is copied onto artikli.
    expect(executed).toHaveLength(10);
  });
});