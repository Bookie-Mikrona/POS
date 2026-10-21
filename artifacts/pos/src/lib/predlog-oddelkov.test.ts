import { describe, expect, it } from "vitest";
import { predlogOddelka } from "./predlog-oddelkov";

describe("predlogOddelka", () => {
  it.each([
    ["Juhe", "Hrana"], ["Zajtrki", "Hrana"], ["Glavne jedi", "Hrana"], ["Otroški meni", "Hrana"],
    ["Sezonske jedi", "Hrana"], ["Priloge", "Hrana"], ["Solate", "Hrana"],
    ["Pice", "Pica"], ["Sladice", "Sladice"], ["Topli napitki", "Kava"],
    ["Brezalkoholne pijače", "Pijača"], ["Pivo", "Pijača"], ["Vino", "Pijača"], ["Žgane pijače", "Pijača"],
    ["Embalaža", "Drugo"], ["Neznano ime", "Drugo"],
  ])("%s → %s", (ime, oddelek) => {
    expect(predlogOddelka(ime)).toBe(oddelek);
  });
});
