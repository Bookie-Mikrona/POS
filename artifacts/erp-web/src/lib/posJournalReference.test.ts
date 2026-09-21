import { describe, expect, it } from "vitest";
import {
  classifyPosJournalReference,
  getMonthlyPosReferenceMonth,
} from "./posJournalReference";

describe("POS reference temeljnic", () => {
  it("razloči mesečne in dnevne POS reference", () => {
    expect(classifyPosJournalReference("POS:PRODAJA:2026-08:E1")).toBe("monthly");
    expect(classifyPosJournalReference("POS:PORABA:2026-08:E12")).toBe("monthly");
    expect(classifyPosJournalReference("POS:LASTREPR:2026-08-31:E1")).toBe("daily");
    expect(classifyPosJournalReference("ROČNO-2026-08")).toBeNull();
  });

  it("iz mesečne reference vrne obračunski mesec", () => {
    expect(getMonthlyPosReferenceMonth("POS:PRODAJA:2026-08:E1")).toBe("2026-08");
    expect(getMonthlyPosReferenceMonth("POS:PRODAJA:2026-08-31:E1")).toBeNull();
  });
});