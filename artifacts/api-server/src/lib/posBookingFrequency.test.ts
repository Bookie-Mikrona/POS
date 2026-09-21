import { describe, expect, it } from "vitest";
import { getEffectiveBookingFrequency } from "./posSyncBooking";

describe("POS frekvenca zbirnih temeljnic", () => {
  it("ima ločeni privzeti frekvenci na ravni nastavitev podjetja", () => {
    expect(getEffectiveBookingFrequency({}, "PRODAJA", "2026-08-15")).toBe("daily");
    expect(getEffectiveBookingFrequency({}, "PORABA", "2026-08-15")).toBe("monthly");
  });

  it("do prvega naslednjega meseca uporabi prejšnji režim", () => {
    const settings = {
      salesBookingFrequency: "monthly",
      consumptionBookingFrequency: "daily",
      frequencyEffectiveFrom: "2026-09-01",
      salesBookingFrequencyPrevious: "daily",
      consumptionBookingFrequencyPrevious: "monthly",
    };
    expect(getEffectiveBookingFrequency(settings, "PRODAJA", "2026-08-31")).toBe("daily");
    expect(getEffectiveBookingFrequency(settings, "PORABA", "2026-08-31")).toBe("monthly");
  });

  it("od prvega dne naslednjega meseca uporabi novo, neodvisno frekvenco", () => {
    const settings = {
      salesBookingFrequency: "monthly",
      consumptionBookingFrequency: "daily",
      frequencyEffectiveFrom: "2026-09-01",
      salesBookingFrequencyPrevious: "daily",
      consumptionBookingFrequencyPrevious: "monthly",
    };
    expect(getEffectiveBookingFrequency(settings, "PRODAJA", "2026-09-01")).toBe("monthly");
    expect(getEffectiveBookingFrequency(settings, "PORABA", "2026-09-01")).toBe("daily");
  });
});