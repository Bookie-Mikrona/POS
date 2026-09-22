import { describe, expect, it } from "vitest";
import {
  getPosPlanCapabilities,
  POS_PLAN_CAPABILITIES,
} from "@workspace/db";

describe("POS paketna politika", () => {
  it("paketi se samo širijo", () => {
    expect(POS_PLAN_CAPABILITIES.lite.every(capability =>
      POS_PLAN_CAPABILITIES.standard.includes(capability),
    )).toBe(true);
    expect(POS_PLAN_CAPABILITIES.standard.every(capability =>
      POS_PLAN_CAPABILITIES.extended.includes(capability),
    )).toBe(true);
  });

  it("ne oglašuje neimplementirane samopostrežne funkcije", () => {
    expect(POS_PLAN_CAPABILITIES.extended).not.toContain("self_service");
  });

  it("manjkajoči zapis varno privzame Lite", () => {
    expect(getPosPlanCapabilities(null)).toEqual(POS_PLAN_CAPABILITIES.lite);
  });
});