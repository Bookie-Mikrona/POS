import { describe, expect, it } from "vitest";

import { isCrossArtifactModule } from "./dashboard";

describe("navigacija med ERP in ločenimi aplikacijami", () => {
  it("POS odpre s polno dokumentno navigacijo", () => {
    expect(isCrossArtifactModule("pos")).toBe(true);
  });

  it("ERP module ohrani v notranjem usmerjevalniku", () => {
    expect(isCrossArtifactModule("temeljnice")).toBe(false);
    expect(isCrossArtifactModule("porocila")).toBe(false);
  });
});