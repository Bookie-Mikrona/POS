import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const settingsSource = readFileSync(resolve(process.cwd(), "src/pages/Settings.tsx"), "utf8");
const quickSwitchSource = readFileSync(resolve(process.cwd(), "src/components/QuickSwitch.tsx"), "utf8");

describe("integracijske skrivnosti v POS Settings", () => {
  it("uporablja SecretInput pri integracijskih skrivnostih, gostujočem Wi-Fi-ju in PIN-u hitre menjave", () => {
    for (const id of [
      "furs-certificate-value",
      "bizbox-credential-value",
      "sumup-access-value",
      "viva-client-credential",
      "smtp-credential-value",
    ]) {
      expect(settingsSource).toContain(`id="${id}"`);
    }
    expect(quickSwitchSource).toContain('id="quick-switch-pin"');
    expect(settingsSource).toContain("Geslo Wi-Fi omrežja za goste");
    expect((settingsSource.match(/<SecretInput\b/g) ?? []).length).toBe(7);
    expect((quickSwitchSource.match(/<SecretInput\b/g) ?? []).length).toBe(1);
  });

  it("ne spreminja izrednega ali uporabniškega prijavnega PIN-a", () => {
    expect(settingsSource).toContain('id="izredni-pin-nov"');
    expect(settingsSource).toContain('id="izredni-pin-potrdi"');
    expect(settingsSource).not.toContain('<SecretInput\n                            id="izredni-pin-nov"');
    expect(settingsSource).toContain('type="password"');
    expect(settingsSource).toContain('autoComplete="current-password"');
    expect(settingsSource).toContain('autoComplete="new-password"');
  });
});