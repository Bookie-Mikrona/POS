import { describe, expect, it } from "vitest";
import { normalizirajAlergenProfil } from "./alergeni";

const confirmed = {
  alergeniVir: "etiketa",
  alergeniVerifiedBy: "tester",
  alergeniVerifiedAt: "2025-01-01T12:00:00.000Z",
};

describe("alergenski profil", () => {
  it("sprejme vse in samo stabilne EU kode", () => {
    const profile = normalizirajAlergenProfil({
      ...confirmed, alergeniStatus: "potrjeno",
      alergeni: ["GLUTEN", "RAKI", "JAJCA", "RIBE", "ARASIDI", "SOJA", "MLEKO", "OREŠČKI", "ZELENA", "GORČICA", "SEZAM", "SULFITI", "VOLČJI_BOB", "MEHKUŽCI"],
      alergeniSledi: [],
    });
    expect(profile.alergeni).toHaveLength(14);
    expect(() => normalizirajAlergenProfil({ ...confirmed, alergeniStatus: "potrjeno", alergeni: ["NEZNAN"], alergeniSledi: [] })).toThrow();
  });

  it("vsebuje prevlada nad sledmi", () => {
    const profile = normalizirajAlergenProfil({ ...confirmed, alergeniStatus: "potrjeno", alergeni: ["MLEKO"], alergeniSledi: ["MLEKO", "SOJA"] });
    expect(profile.alergeniSledi).toEqual(["SOJA"]);
  });

  it("potrjeno_brez zahteva dejansko prazna seznama", () => {
    expect(() => normalizirajAlergenProfil({ ...confirmed, alergeniStatus: "potrjeno_brez", alergeni: ["MLEKO"], alergeniSledi: [] })).toThrow();
    expect(normalizirajAlergenProfil({ ...confirmed, alergeniStatus: "potrjeno_brez", alergeni: [], alergeniSledi: [] }).alergeniStatus).toBe("potrjeno_brez");
  });

  it("prazen potrjen profil mora biti izrecno potrjeno_brez", () => {
    expect(() => normalizirajAlergenProfil({
      ...confirmed,
      alergeniStatus: "potrjeno",
      alergeni: [],
      alergeniSledi: [],
    })).toThrow(/potrjeno_brez/);
  });
});