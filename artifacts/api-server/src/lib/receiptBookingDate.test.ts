import { describe, expect, it, vi } from "vitest";

vi.mock("./pos-business-day", async importOriginal => {
  const original = await importOriginal<typeof import("./pos-business-day")>();
  return { ...original, getEnotaBusinessDayStart: vi.fn() };
});

import { getEnotaBusinessDayStart } from "./pos-business-day";
import { receiptBookingDate } from "./receiptBookingDate";

describe("receiptBookingDate", () => {
  it("račun ob 02:34 lokalno osveži prejšnji poslovni dan", async () => {
    vi.mocked(getEnotaBusinessDayStart).mockResolvedValue("04:00");
    expect(await receiptBookingDate(42, new Date("2026-10-12T00:34:00Z"))).toBe("2026-10-11");
    expect(getEnotaBusinessDayStart).toHaveBeenCalledWith(42);
  });

  it("račun točno ob začetku poslovnega dne osveži tekoči dan", async () => {
    vi.mocked(getEnotaBusinessDayStart).mockResolvedValue("04:00");
    expect(await receiptBookingDate(42, new Date("2026-10-12T02:00:00Z"))).toBe("2026-10-12");
  });

  it("upošteva začetno uro enote in zgodovinski čas računa", async () => {
    vi.mocked(getEnotaBusinessDayStart).mockResolvedValue("06:00");
    expect(await receiptBookingDate(84, new Date("2026-01-05T04:30:00Z"))).toBe("2026-01-04");
  });
});
