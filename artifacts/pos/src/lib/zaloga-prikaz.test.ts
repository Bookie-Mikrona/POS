import { describe, expect, it } from "vitest";
import { jeVodja, razpolozljivePorcije, stanjeZaloge } from "./zaloga-prikaz";

describe("stanjeZaloge", () => {
  it("brez spremljanja ali brez izračuna ni stanja", () => {
    expect(stanjeZaloge({ spremljajPorcije: false, availableQuantity: 0 })).toBe("brez");
    expect(stanjeZaloge({ spremljajPorcije: true, availableQuantity: null })).toBe("brez");
  });
  it("meje: 0 = ni, 1..5 = na izteku, 6+ = ok", () => {
    const st = (n: number) => stanjeZaloge({ spremljajPorcije: true, availableQuantity: n });
    expect(st(0)).toBe("ni");
    expect(st(1)).toBe("na_izteku");
    expect(st(5)).toBe("na_izteku");
    expect(st(6)).toBe("ok");
  });
  it("pica: velja najboljša velikost; neomejena velikost pomeni brez omejitve", () => {
    expect(razpolozljivePorcije({ availableBySize: { mala: 2, normalna: 4 } })).toBe(4);
    expect(stanjeZaloge({ spremljajPorcije: true, availableBySize: { mala: 0, normalna: 0 } })).toBe("ni");
    expect(stanjeZaloge({ spremljajPorcije: true, availableBySize: { mala: 0, normalna: null } })).toBe("brez");
  });
  it("vodja je obstoječa vloga", () => {
    expect(jeVodja("admin")).toBe(true);
    expect(jeVodja("admin_enote")).toBe(true);
    expect(jeVodja("uporabnik")).toBe(false);
    expect(jeVodja(undefined)).toBe(false);
  });
});
