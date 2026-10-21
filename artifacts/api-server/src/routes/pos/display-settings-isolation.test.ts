import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

// Prikazne nastavitve naprave (menij, gostota, naročilo, porcije) smejo vplivati samo na videz:
// račun, DDV in fiskalizacija jih ne smejo brati.
const POLJA = ["prikazMenija", "gostotaArtiklov", "prikazNarocila", "spremljajPorcije"];

describe("prikazne nastavitve ne vplivajo na račun", () => {
  const koren = join(__dirname, "..", "..");
  const datoteke = [
    ...readdirSync(join(koren, "routes", "pos")).filter((f) => /^(racuni|narocila|z-porocilo|furs)/.test(f)).map((f) => join(koren, "routes", "pos", f)),
    ...readdirSync(join(koren, "lib")).filter((f) => /^(furs|racun|ddv|prepared-food-availability)/.test(f) && f.endsWith(".ts") && !f.endsWith(".test.ts")).map((f) => join(koren, "lib", f)),
  ].filter((f) => f.endsWith(".ts") && !f.endsWith(".test.ts"));

  it("najde datoteke za preverjanje", () => { expect(datoteke.length).toBeGreaterThan(3); });
  for (const f of datoteke) {
    it(`${f.split("/src/")[1]} ne bere prikaznih polj`, () => {
      const vsebina = readFileSync(f, "utf8");
      for (const polje of POLJA) expect(vsebina).not.toContain(polje);
    });
  }
});
