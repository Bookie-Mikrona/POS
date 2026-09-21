import { describe, expect, it } from "vitest";
import {
  HOSPITALITY_PROFILES,
  HOSPITALITY_PROFILE_DEFAULTS,
  SERVICE_MODES,
  UNIT_CAPABILITIES,
} from "@workspace/db";

describe("strežniške predloge gostinskih profilov", () => {
  it("določa privzete vrednosti za vseh 13 profilov", () => {
    expect(Object.keys(HOSPITALITY_PROFILE_DEFAULTS)).toEqual([...HOSPITALITY_PROFILES]);
  });

  it("uporablja samo veljavne načine strežbe in funkcije brez podvajanj", () => {
    for (const definition of Object.values(HOSPITALITY_PROFILE_DEFAULTS)) {
      expect(SERVICE_MODES).toContain(definition.serviceMode);
      expect(new Set(definition.capabilities).size).toBe(definition.capabilities.length);
      expect(definition.capabilities.every(capability => UNIT_CAPABILITIES.includes(capability))).toBe(true);
    }
  });

  it("ohrani ozke operativne privzete vrednosti posebnih profilov", () => {
    expect(HOSPITALITY_PROFILE_DEFAULTS.self_service.serviceMode).toBe("self_service");
    expect(HOSPITALITY_PROFILE_DEFAULTS.self_service.capabilities).not.toContain("tables");
    expect(HOSPITALITY_PROFILE_DEFAULTS.fast_food.serviceMode).toBe("counter");
    expect(HOSPITALITY_PROFILE_DEFAULTS.festival_society.temporary).toBe(true);
    expect(HOSPITALITY_PROFILE_DEFAULTS.food_truck.temporary).toBe(true);
  });

  it("fine dining vključuje evidenco pripravljene hrane za mise en place", () => {
    expect(HOSPITALITY_PROFILE_DEFAULTS.fine_dining.capabilities).toContain("prepared_food");
  });
});