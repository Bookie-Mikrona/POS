import { describe, expect, it } from "vitest";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { neveljavnoPoljePrikaza } from "./naprave";

describe("prikaz na napravi", () => {
  it("sprejme samo znane vrednosti in izpuščena polja", () => {
    expect(neveljavnoPoljePrikaza({})).toBeNull();
    expect(neveljavnoPoljePrikaza({ prikazMenija: "C", gostotaArtiklov: "seznam", prikazNarocila: "novo" })).toBeNull();
    expect(neveljavnoPoljePrikaza({ prikazMenija: "D" })).toBe("prikazMenija");
    expect(neveljavnoPoljePrikaza({ gostotaArtiklov: 3 })).toBe("gostotaArtiklov");
    expect(neveljavnoPoljePrikaza({ prikazNarocila: null })).toBe("prikazNarocila");
  });

  it("obstoječe naprave dobijo obstoječi prikaz (privzete vrednosti stolpcev)", async () => {
    const res = await db.execute(sql`
      SELECT column_name, column_default, is_nullable FROM information_schema.columns
      WHERE table_name = 'naprave' AND column_name IN ('prikaz_menija','gostota_artiklov','prikaz_narocila')
      ORDER BY column_name`);
    const rows = Object.fromEntries((res.rows as any[]).map((r) => [r.column_name, r]));
    expect(rows.prikaz_menija.column_default).toContain("trenutno");
    expect(rows.gostota_artiklov.column_default).toContain("privzeto");
    expect(rows.prikaz_narocila.column_default).toContain("staro");
    expect(Object.values(rows).every((r: any) => r.is_nullable === "NO")).toBe(true);
  });
});
