import { describe, expect, it } from "vitest";
import {
  businessDateForInstant,
  businessDateFromLocalDateTime,
} from "./pos-business-day";

describe("gostinski poslovni datum", () => {
  it("pred 04:00 uporabi prejšnji datum, od 04:00 naprej pa tekočega", () => {
    expect(businessDateForInstant("2026-08-29T01:59:00.000Z", "04:00")).toBe("2026-08-28");
    expect(businessDateForInstant("2026-08-29T02:00:00.000Z", "04:00")).toBe("2026-08-29");
    expect(businessDateForInstant("2026-08-29T02:01:00.000Z", "04:00")).toBe("2026-08-29");
  });

  it("upošteva drugo konfigurirano uro začetka", () => {
    expect(businessDateFromLocalDateTime("2026-08-29", 5, 29, "05:30")).toBe("2026-08-28");
    expect(businessDateFromLocalDateTime("2026-08-29", 5, 30, "05:30")).toBe("2026-08-29");
  });

  it("ostane pravilen na dneva prehoda na poletni in zimski čas", () => {
    expect(businessDateForInstant("2026-03-29T01:30:00.000Z", "04:00")).toBe("2026-03-28");
    expect(businessDateForInstant("2026-03-29T02:00:00.000Z", "04:00")).toBe("2026-03-29");
    expect(businessDateForInstant("2026-10-25T02:59:00.000Z", "04:00")).toBe("2026-10-24");
    expect(businessDateForInstant("2026-10-25T03:00:00.000Z", "04:00")).toBe("2026-10-25");
  });
});