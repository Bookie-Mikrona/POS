import { describe, expect, it } from "vitest";
import { getBarServingSize, getKdsStationStatusLabel, getPairedFoodName, sortKdsNalogiForStation } from "./kdsBar";
import type { KdsNalog } from "@/hooks/use-kds";

const nalog = (id: number, stanje: KdsNalog["stanje"]): KdsNalog => ({
  id, stanje, enotaId: 1, postajaId: 1, narociloId: 1, postavkaId: id,
  uporabljenFallback: false, ustvarjeno: "2026-01-01T12:00:00Z",
});

describe("bar KDS semantics", () => {
  it("uses bar-specific labels for held, active, and served lines", () => {
    expect(getKdsStationStatusLabel({ ...nalog(1, "aktivno") }, true)).toBe("FIRE · READY TO POUR");
    expect(getKdsStationStatusLabel({ ...nalog(2, "zadrzano"), courseNumber: 3 }, true)).toBe("PENDING · Čaka na FIRE 3. hoda");
    expect(getKdsStationStatusLabel(nalog(3, "ack"), true)).toBe("SERVED · Postreženo");
    expect(getKdsStationStatusLabel(nalog(1, "aktivno"), false)).toBe("FIRE · V pripravi");
  });

  it("finds the paired food by immutable group and selected sequence", () => {
    expect(getPairedFoodName(
      { id: 2, ime: "Malvazija 1 dcl", pairingGroupId: "menu-1", courseSequence: 2 },
      [
        { id: 1, ime: "Brancin", pairingGroupId: "menu-1", courseSequence: 2, kategorijaIme: "Hrana" },
        { id: 2, ime: "Malvazija 1 dcl", pairingGroupId: "menu-1", courseSequence: 2 },
        { id: 3, ime: "Juha", pairingGroupId: "menu-1", courseSequence: 1 },
      ],
    )).toBe("Brancin");
    expect(getBarServingSize("Malvazija 0,1 l")).toBe("1 dcl");
  });

  it("puts active pours before pending and served courses", () => {
    expect(sortKdsNalogiForStation([
      { ...nalog(1, "ack"), courseSequence: 1 },
      { ...nalog(2, "zadrzano"), courseSequence: 2 },
      { ...nalog(3, "aktivno"), courseSequence: 3 },
    ], true).map(item => item.id)).toEqual([3, 2, 1]);
  });
});