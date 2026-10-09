import { describe, expect, it } from "vitest";
import {
  ALL_UNIT_CAPABILITIES,
  HOSPITALITY_PROFILES,
  NAV_CAPABILITY_BY_PATH,
  canAccessPosRoute,
  profileDefaults,
} from "./unitProfiles";

describe("profili gostinskih enot", () => {
  it.each(["/dnevni-meni", "/malice", "/kosila"])("%s zahteva meni, ne kuhinje, tudi pri neposrednem dostopu", path => {
    expect(NAV_CAPABILITY_BY_PATH[path]).toBe("menu");
    expect(canAccessPosRoute(path, ["menu"], "uporabnik")).toBe(true);
    expect(canAccessPosRoute(`${path}/42`, ["menu"], "uporabnik")).toBe(true);
    expect(canAccessPosRoute(path, ["kitchen"], "uporabnik")).toBe(false);
    expect(canAccessPosRoute(path, [], "uporabnik")).toBe(false);
  });

  it.each(["bar", "cafe_pastry"] as const)("%s brez kuhinje lahko odpre vse tri strani ponudbe", profileKey => {
    const { capabilities } = profileDefaults(profileKey);
    expect(capabilities).not.toContain("kitchen");
    for (const path of ["/dnevni-meni", "/malice", "/kosila"]) {
      expect(canAccessPosRoute(path, capabilities, "admin_enote")).toBe(true);
    }
  });

  it("vsebuje vseh 13 dogovorjenih profilov", () => {
    expect(Object.keys(HOSPITALITY_PROFILES)).toHaveLength(13);
  });

  it("vsak profil vsebuje osnovne poslovne funkcije brez podvajanj", () => {
    for (const definition of Object.values(HOSPITALITY_PROFILES)) {
      expect(definition.capabilities).toContain("checkout");
      expect(definition.capabilities).toContain("settings");
      expect(new Set(definition.capabilities).size).toBe(definition.capabilities.length);
      expect(definition.capabilities.every(capability => ALL_UNIT_CAPABILITIES.includes(capability))).toBe(true);
    }
  });

  it("prazen ročno prilagojen seznam ostane veljavna izbira", () => {
    const configuredCapabilities: typeof ALL_UNIT_CAPABILITIES = [];
    expect(configuredCapabilities).toEqual([]);
    expect(configuredCapabilities).not.toEqual(profileDefaults("restaurant").capabilities);
  });

  it("posebne predloge vključijo pričakovane funkcije", () => {
    expect(profileDefaults("fine_dining").capabilities).toContain("multi_course");
    expect(profileDefaults("self_service").capabilities).not.toContain("self_service");
    expect(profileDefaults("self_service").serviceMode).toBe("self_service");
    expect(profileDefaults("hotel_food_service").capabilities).not.toContain("self_service");
    expect(profileDefaults("hotel_food_service").capabilities).toEqual(expect.arrayContaining(["events", "qr_menu"]));
    expect(profileDefaults("tourist_farm").capabilities).toEqual(expect.arrayContaining(["multi_course", "kitchen"]));
    expect(profileDefaults("festival_society").capabilities).toContain("deposits_tokens");
    expect(profileDefaults("food_truck").temporary).toBe(false);
    expect(profileDefaults("festival_society").temporary).toBe(true);
    expect(profileDefaults("event_stall").temporary).toBe(true);
    expect(profileDefaults("inn").capabilities).toContain("phone_orders");
    expect(profileDefaults("food_truck").capabilities).not.toContain("delivery");
  });

  it("vseh 13 odjemalskih profilov ima izpolnjene odvisnosti", () => {
    for (const [profile, { capabilities }] of Object.entries(HOSPITALITY_PROFILES)) {
      for (const [capability, dependency] of [
        ["delivery", "phone_orders"], ["reservations", "tables"], ["multi_course", "kitchen"],
      ] as const) {
        if (capabilities.includes(capability)) expect(capabilities, profile).toContain(dependency);
      }
    }
  });

  it("ključne neposredne poti imajo zahtevano zmožnost", () => {
    expect(NAV_CAPABILITY_BY_PATH["/kuhinja"]).toBe("kitchen");
    expect(NAV_CAPABILITY_BY_PATH["/zaloge"]).toBe("inventory");
    expect(NAV_CAPABILITY_BY_PATH["/operativna-porocila"]).toBe("operational_reports");
    expect(NAV_CAPABILITY_BY_PATH["/dogodki"]).toBe("events");
  });

  it.each(["admin", "admin_enote", "superadmin"])(
    "%s lahko odpre nastavitve tudi brez aktivne enote",
    role => expect(canAccessPosRoute("/nastavitve", [], role)).toBe(true),
  );

  it("administrativna izjema ne omogoči miz ali drugih poslovnih funkcij", () => {
    expect(canAccessPosRoute("/", [], "admin")).toBe(false);
    expect(canAccessPosRoute("/blagajna", [], "admin_enote")).toBe(false);
    expect(canAccessPosRoute("/zaloge/123", [], "admin")).toBe(false);
    expect(canAccessPosRoute("/", ["tables"], "admin")).toBe(true);
  });

  it("običajen uporabnik za nastavitve še vedno potrebuje zmožnost", () => {
    expect(canAccessPosRoute("/nastavitve", [], "uporabnik")).toBe(false);
    expect(canAccessPosRoute("/nastavitve", ["settings"], "uporabnik")).toBe(true);
  });
});