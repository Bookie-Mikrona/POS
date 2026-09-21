import { describe, expect, it } from "vitest";
import { parseSettingsNavigation, resolveSettingsNavigationTarget } from "./settings-navigation";

describe("settings navigation contract", () => {
  it("round-trips a real card using its required accordion section", () => {
    const url = resolveSettingsNavigationTarget({ tab: "nastavitve", card: "ns-viva" });
    expect(url).toBe("/nastavitve?tab=nastavitve&section=sek-terminali&card=ns-viva");
    expect(parseSettingsNavigation(url)).toEqual({ tab: "nastavitve", section: "sek-terminali", card: "ns-viva" });
  });
  it("rejects arbitrary settings parameters and mismatched cards", () => {
    expect(parseSettingsNavigation("/nastavitve?tab=nastavitve&card=ns-viva")).toBeNull();
    expect(parseSettingsNavigation("/nastavitve?tab=nastavitve&section=sek-sistem&card=ns-viva")).toBeNull();
    expect(parseSettingsNavigation("/nastavitve?tab=nastavitve&section=sek-terminali&card=ns-viva&save=true")).toBeNull();
    expect(parseSettingsNavigation("/nastavitve?tab=nastavitve&tab=kds")).toBeNull();
    expect(parseSettingsNavigation("/nastavitve?tab=nastavitve&section=sek-terminali&section=sek-sistem")).toBeNull();
    expect(parseSettingsNavigation("/nastavitve?tab=nastavitve&section=sek-terminali&card=ns-viva&card=ns-viva")).toBeNull();
  });
});