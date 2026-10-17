import { describe, expect, it } from "vitest";
import { posAccountDimensionWarning } from "./posAccountDimensions";

describe("POS obvezne dimenzije konta", () => {
  it.each([
    ["requiresPartner", "partnerja"],
    ["requiresCostCenter", "stroškovno mesto"],
    ["requiresProject", "projekt"],
  ] as const)("opozori za %s", (flag, label) => {
    expect(posAccountDimensionWarning({ code: "7600000", [flag]: true }))
      .toContain(`Konto 7600000 zahteva ${label}`);
  });

  it("navede vse zahtevane dimenzije", () => {
    expect(posAccountDimensionWarning({
      code: "7600000", requiresPartner: true, requiresCostCenter: true, requiresProject: true,
    })).toContain("partnerja, stroškovno mesto, projekt");
  });

  it("ne opozori, če konto nima zahtev", () => {
    expect(posAccountDimensionWarning({ code: "7600000" })).toBeNull();
  });

  it("pri sinhronizaciji upošteva že izpolnjene dimenzije", () => {
    const account = { code: "7600000", requiresPartner: true, requiresCostCenter: true };
    expect(posAccountDimensionWarning(account, { partnerId: "partner", costCenterId: "sm" })).toBeNull();
    expect(posAccountDimensionWarning(account, { partnerId: "partner" })).toContain("zahteva stroškovno mesto");
    expect(posAccountDimensionWarning(account, { costCenterId: "sm" })).toContain("zahteva partnerja");
  });
});
