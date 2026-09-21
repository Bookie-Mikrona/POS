import { describe, expect, it } from "vitest";
import { resolveVisibleSettingsTab } from "./settings-tab-visibility";

describe("settings tab visibility", () => {
  it("keeps only visible deep-link tabs for each role", () => {
    expect(resolveVisibleSettingsTab("mize", "uporabnik")).toBe("nastavitve");
    expect(resolveVisibleSettingsTab("mize", "admin_enote")).toBe("mize");
    expect(resolveVisibleSettingsTab("knjizenje", "admin_enote")).toBe("nastavitve");
    expect(resolveVisibleSettingsTab("knjizenje", "admin")).toBe("knjizenje");
    expect(resolveVisibleSettingsTab("varnostne-kopije", "admin")).toBe("nastavitve");
    expect(resolveVisibleSettingsTab("varnostne-kopije", "superadmin")).toBe("varnostne-kopije");
    expect(resolveVisibleSettingsTab("dostava", "superadmin")).toBe("nastavitve");
  });
});