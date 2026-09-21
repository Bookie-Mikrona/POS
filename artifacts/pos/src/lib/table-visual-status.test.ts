import { describe, expect, it } from "vitest";
import { resolveTableVisualStatus } from "./table-visual-status";

describe("resolveTableVisualStatus", () => {
  it("odprto naročilo vedno preglasi zastarel status prosta", () => {
    expect(resolveTableVisualStatus("prosta", [
      { status: "odprto", postavke: [{ racunId: null }] },
    ])).toBe("zasedena");
  });

  it("loči delno in v celoti zaračunano mizo", () => {
    expect(resolveTableVisualStatus("zasedena", [{
      status: "odprto",
      postavke: [{ racunId: 10 }, { racunId: null }],
    }])).toBe("delno_zaracunana");
    expect(resolveTableVisualStatus("zasedena", [{
      status: "odprto",
      postavke: [{ racunId: 10 }, { racunId: 11 }],
    }])).toBe("vse_zaracunano");
  });

  it("brez odprtega naročila ohrani rezerviran ali zaseden status", () => {
    expect(resolveTableVisualStatus("rezervirana", [])).toBe("rezervirana");
    expect(resolveTableVisualStatus("zasedena", [])).toBe("zasedena");
    expect(resolveTableVisualStatus("prosta", [])).toBe("prosta");
  });
});