import { describe, expect, it } from "vitest";
import { jeDostavaStatus, jeVeljavenDostavniPrehod } from "./dostava-status";

describe("dostavni statusni tok", () => {
  it("dovoli samo zaporedne prehode in preklic pred prevzemom", () => {
    expect(jeVeljavenDostavniPrehod("prejeto", "potrjeno")).toBe(true);
    expect(jeVeljavenDostavniPrehod("v_pripravi", "preklicano")).toBe(true);
    expect(jeVeljavenDostavniPrehod("pripravljeno", "dostavljeno")).toBe(false);
    expect(jeVeljavenDostavniPrehod("dostavljeno", "preklicano")).toBe(false);
  });

  it("ne sprejme neznanih statusov", () => {
    expect(jeDostavaStatus("na_poti")).toBe(false);
    expect(jeDostavaStatus("prevzel_kurir")).toBe(true);
  });
});