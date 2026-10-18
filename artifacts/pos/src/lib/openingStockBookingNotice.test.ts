import { describe, expect, it } from "vitest";
import { openingStockBookingNotice } from "./openingStockBookingNotice";

describe("opozorila otvoritvene zaloge", () => {
  it("prikaže ustvarjen osnutek in vsa opozorila, ne preskočenega knjiženja", () => {
    const notice = openingStockBookingNotice({
      bookingRef: "POS:ZZ:2026:E1",
      bookingWarnings: [
        "Konto 3100 zahteva partnerja.",
        "Konto 9900 zahteva projekt.",
      ],
    });
    expect(notice).toContain("Ustvarjen osnutek temeljnice (POS:ZZ:2026:E1)");
    expect(notice).toContain("Konto 3100 zahteva partnerja.");
    expect(notice).toContain("Konto 9900 zahteva projekt.");
    expect(notice).not.toContain("preskočeno");
    expect(notice).not.toContain("Poknjiženo");
  });

  it("za osnutek brez opozoril ne izmisli manjkajočih dimenzij", () => {
    expect(openingStockBookingNotice({ bookingRef: "POS:ZZ:2026:E1", bookingWarnings: [] }))
      .toBe("Ustvarjen osnutek temeljnice (POS:ZZ:2026:E1).");
  });

  it("ohrani razlog preskoka in običajno shranjevanje brez knjiženja", () => {
    expect(openingStockBookingNotice({ bookingSkipped: "Ni odprtega obdobja" }))
      .toBe("ERP knjiženje preskočeno: Ni odprtega obdobja");
    expect(openingStockBookingNotice({})).toBeUndefined();
  });
});
