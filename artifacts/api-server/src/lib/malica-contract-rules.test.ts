import { describe, expect, it } from "vitest";
import { resolveMalicaContractQuote } from "./malica-contract-rules";
describe("Malica contract quotes", () => {
  it("covers all regular cost but leaves extras to guest", () => {
    expect(resolveMalicaContractQuote({ regularCents: 1000, extrasCents: 250, mode: "partner_all" })).toMatchObject({ partnerCoveredCents: 1000, guestPayableCents: 250 });
  });
  it("rounds percent coverage down in cents", () => {
    expect(resolveMalicaContractQuote({ regularCents: 999, mode: "split", splitKind: "percent", splitValue: 33 })).toMatchObject({ partnerCoveredCents: 329, guestPayableCents: 670 });
  });
  it("applies surcharge before split", () => {
    expect(resolveMalicaContractQuote({ regularCents: 1000, mode: "partner_fixed_guest_remainder", splitValue: 900, surchargeCents: 100 })).toMatchObject({ partnerCoveredCents: 900, guestPayableCents: 200 });
  });
});