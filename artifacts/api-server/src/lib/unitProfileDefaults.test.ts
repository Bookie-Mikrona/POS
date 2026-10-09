import { describe, expect, it } from "vitest";
import {
  HOSPITALITY_PROFILES,
  HOSPITALITY_PROFILE_DEFAULTS,
  SERVICE_MODES,
  UNIT_CAPABILITIES,
  getPosPlanCapabilities,
} from "@workspace/db";
import { getMissingCapabilityDependencies } from "./unitCapabilityPolicy";

describe("strežniške predloge gostinskih profilov", () => {
  it.each(HOSPITALITY_PROFILES)("%s uporablja samo funkcije, vključene v paket Extended", profile => {
    const extended = getPosPlanCapabilities("extended");
    for (const capability of HOSPITALITY_PROFILE_DEFAULTS[profile].capabilities) {
      expect(extended, `${profile}: ${capability}`).toContain(capability);
    }
  });
  it("popravi le začetne predloge samopostrežbe, hotela in turistične kmetije", () => {
    expect(HOSPITALITY_PROFILE_DEFAULTS.self_service.capabilities).not.toContain("self_service");
    expect(HOSPITALITY_PROFILE_DEFAULTS.self_service.serviceMode).toBe("self_service");
    expect(HOSPITALITY_PROFILE_DEFAULTS.hotel_food_service.capabilities).not.toContain("self_service");
    expect(HOSPITALITY_PROFILE_DEFAULTS.hotel_food_service.capabilities).toEqual(expect.arrayContaining(["events", "qr_menu"]));
    expect(HOSPITALITY_PROFILE_DEFAULTS.tourist_farm.capabilities).toEqual(expect.arrayContaining(["multi_course", "kitchen"]));
  });
  it("vseh 13 profilov ima izpolnjene odvisnosti", () => {
    for (const [profile, definition] of Object.entries(HOSPITALITY_PROFILE_DEFAULTS)) {
      expect(getMissingCapabilityDependencies(definition.capabilities), profile).toEqual([]);
    }
    expect(HOSPITALITY_PROFILE_DEFAULTS.inn.capabilities).toContain("phone_orders");
    expect(HOSPITALITY_PROFILE_DEFAULTS.food_truck.capabilities).not.toContain("delivery");
  });
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
    expect(HOSPITALITY_PROFILE_DEFAULTS.food_truck.temporary).toBe(false);
  });

  it("fine dining vključuje evidenco pripravljene hrane za mise en place", () => {
    expect(HOSPITALITY_PROFILE_DEFAULTS.fine_dining.capabilities).toContain("prepared_food");
  });
});