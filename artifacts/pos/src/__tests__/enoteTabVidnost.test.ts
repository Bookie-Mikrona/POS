/**
 * Testi vidnosti zavihka "Enote" v Nastavitvah (Settings.tsx uporablja
 * prikaziZavihekEnote / smeUpravljatiEnote iz @/lib/enoteTabVidnost).
 *
 * Pravila:
 *  - admin        → vidi zavihek; sme ustvarjati/brisati
 *  - admin_enote  → vidi zavihek (novo); NE sme ustvarjati/brisati
 *  - superadmin   → NE vidi zavihka
 *  - uporabnik    → NE vidi zavihka
 */

import { describe, it, expect } from "vitest";
import { prikaziZavihekEnote, smeUpravljatiEnote } from "@/lib/enoteTabVidnost";

describe("prikaziZavihekEnote", () => {
  it("admin → zavihek Enote prikazan (obstoječe vedenje ohranjeno)", () => {
    expect(prikaziZavihekEnote("admin")).toBe(true);
  });

  it("admin_enote → zavihek Enote prikazan (novo)", () => {
    expect(prikaziZavihekEnote("admin_enote")).toBe(true);
  });

  it("superadmin → zavihek Enote NI prikazan", () => {
    expect(prikaziZavihekEnote("superadmin")).toBe(false);
  });

  it("uporabnik → zavihek Enote NI prikazan", () => {
    expect(prikaziZavihekEnote("uporabnik")).toBe(false);
  });

  it("brez vloge → NI prikazan", () => {
    expect(prikaziZavihekEnote(undefined)).toBe(false);
  });
});

describe("smeUpravljatiEnote (ustvarjanje/brisanje)", () => {
  it("admin sme ustvarjati in brisati enote", () => {
    expect(smeUpravljatiEnote("admin")).toBe(true);
  });

  it("admin_enote NE sme ustvarjati/brisati (samo urejanje)", () => {
    expect(smeUpravljatiEnote("admin_enote")).toBe(false);
  });

  it("superadmin/uporabnik NE smeta", () => {
    expect(smeUpravljatiEnote("superadmin")).toBe(false);
    expect(smeUpravljatiEnote("uporabnik")).toBe(false);
  });
});
