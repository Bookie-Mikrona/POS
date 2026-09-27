import { describe, expect, it } from "vitest";
import { DROBNI_INVENTAR_SKUPINE, drobniInventarSkupina, sortDrobniInventar } from "./drobni-inventar-groups";

describe("drobni inventar v šifrantu", () => {
  it("prikaže vseh sedem skupin z dogovorjeno pogostostjo popisa", () => {
    expect(DROBNI_INVENTAR_SKUPINE.map(group => group.id)).toEqual(["01", "02", "03", "04", "05", "06", "07"]);
    expect(DROBNI_INVENTAR_SKUPINE.map(group => group.popis))
      .toEqual(["Mesečno / trimesečno", "Trimesečno / polletno", "Polletno / letno", "Letno", "Polletno / letno", "Letno", "Letno"]);
  });

  it("stare in nove oznake razvrsti po skupinah, nato po slovenski abecedi", () => {
    const articles = [
      { id: 1, ime: "Žlica", skupina: "03 Jedilni pribor/namizni dodatki" },
      { id: 2, ime: "Kozarec", skupina: "01 Steklovina" },
      { id: 3, ime: "Čaša", skupina: "01 - Steklovina" },
      { id: 4, ime: "Brez skupine", skupina: null },
      { id: 5, ime: "Skleda", skupina: "02 Porcelan/strežna posoda" },
      { id: 6, ime: "Šejker", skupina: "06 Šank" },
    ];
    expect(sortDrobniInventar(articles).map(a => a.id)).toEqual([3, 2, 5, 1, 6, 4]);
    expect(articles[0]?.id).toBe(1);
  });

  it("stare skodelice in servirne deske pokaže v smiselni skupini", () => {
    expect(drobniInventarSkupina({ ime: "Skodelica za espresso s podstavkom", skupina: "01 Steklovina" })?.id).toBe("02");
    expect(drobniInventarSkupina({ ime: "Lesena servirna deska za narezek/žar", skupina: "02 Porcelan/strežna posoda" })?.id).toBe("05");
    expect(drobniInventarSkupina({ ime: "Skodelica za espresso s podstavkom", skupina: "01 - Steklovina" })?.id).toBe("01");
  });
});