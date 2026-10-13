import { describe, expect, it } from "vitest";
import { hasReceiptPrintChanges } from "./receipt-print-changes";

const receipt = {
  placilnaNacin: "gotovina", znesekGotovina: 2.7, znesekKartica: 0,
  znesekBon: null, znesekBonPica: 0, steviloBonov: null,
  kupecDavcnaStevilka: "12345678", kupecNaziv: "Test d.o.o.", kupecNaslov: "Testni naslov",
};

describe("Ponovni tisk ne spreminja izdanega računa", () => {
  it("nespremenjen račun na podjetje ne potrebuje PATCH", () => {
    expect(hasReceiptPrintChanges(receipt, { ...receipt })).toBe(false);
  });
  it("izpuščena polja, ničle in drugačen zapis istega zneska niso spremembe", () => {
    expect(hasReceiptPrintChanges(receipt, {
      placilnaNacin: "gotovina", znesekGotovina: Number("2.70"), znesekBon: 0,
    })).toBe(false);
  });
  it.each([
    { placilnaNacin: "kartica" },
    { znesekGotovina: 2.69 },
    { znesekKartica: 0.01 },
    { znesekBon: 0.01 },
    { znesekBonPica: 1 },
    { steviloBonov: 1 },
    { kupecDavcnaStevilka: "87654321" },
    { kupecNaziv: "Drug kupec" },
    { kupecNaslov: "Drug naslov" },
  ])("dejansko spremembo še vedno zazna: %o", update => {
    expect(hasReceiptPrintChanges(receipt, { placilnaNacin: "gotovina", ...update })).toBe(true);
  });
  it("sprememba in povrnitev izvirne vrednosti spet omogočata tisk brez PATCH", () => {
    expect(hasReceiptPrintChanges(receipt, { ...receipt, znesekGotovina: 3 })).toBe(true);
    expect(hasReceiptPrintChanges(receipt, { ...receipt, znesekGotovina: 2.70 })).toBe(false);
  });
});
