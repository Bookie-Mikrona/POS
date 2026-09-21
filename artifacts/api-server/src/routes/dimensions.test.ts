/**
 * Testi za superadmin dostop v dimensions.ts resolveAccess
 * in isSuperAdmin helper iz requireSuperAdmin.ts.
 *
 * Pokritost:
 *  1. isSuperAdmin() — vrne true za ID v SUPER_ADMIN_IDS, false za ostale
 *  2. resolveAccess simulacija: superadmin → { role: "owner" } brez DB klica
 *  3. resolveAccess simulacija: owner/accountant → vloga iz DB (nespremenjeno)
 *  4. resolveAccess simulacija: neznan uporabnik → 403 (nespremenjeno)
 *
 * Strategija: ker je resolveAccess zasebna funkcija v modulu, testiramo
 * isSuperAdmin helper neposredno (je exportiran) in obnašanje simuliramo
 * s čistimi funkcijami, ki odražajo isto logiko.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { isSuperAdmin } from "../middlewares/requireSuperAdmin";

// ─── 1. isSuperAdmin helper ───────────────────────────────────────────────────

describe("isSuperAdmin()", () => {
  const ORIGINAL_ENV = process.env.SUPER_ADMIN_IDS;

  afterEach(() => {
    // Povrni env po vsakem testu
    if (ORIGINAL_ENV === undefined) {
      delete process.env.SUPER_ADMIN_IDS;
    } else {
      process.env.SUPER_ADMIN_IDS = ORIGINAL_ENV;
    }
  });

  it("vrne true, ko je clerkUserId v SUPER_ADMIN_IDS", () => {
    process.env.SUPER_ADMIN_IDS = "admin_clerk_1,admin_clerk_2";
    expect(isSuperAdmin("admin_clerk_1")).toBe(true);
    expect(isSuperAdmin("admin_clerk_2")).toBe(true);
  });

  it("vrne false, ko clerkUserId NI v SUPER_ADMIN_IDS", () => {
    process.env.SUPER_ADMIN_IDS = "admin_clerk_1";
    expect(isSuperAdmin("user_clerk_xyz")).toBe(false);
    expect(isSuperAdmin("admin_clerk_1x")).toBe(false); // podoben, ne enak
  });

  it("vrne false, ko SUPER_ADMIN_IDS ni nastavljen", () => {
    delete process.env.SUPER_ADMIN_IDS;
    expect(isSuperAdmin("anyone")).toBe(false);
  });

  it("ignorira bele znake v SUPER_ADMIN_IDS (vejičnik + presledek)", () => {
    process.env.SUPER_ADMIN_IDS = " admin_clerk_1 , admin_clerk_2 ";
    expect(isSuperAdmin("admin_clerk_1")).toBe(true);
    expect(isSuperAdmin("admin_clerk_2")).toBe(true);
  });
});

// ─── 2. resolveAccess logika (simulacija z isto logiko) ───────────────────────
//
// resolveAccess ni exportirana, zato testiramo logiko v obliki čiste funkcije,
// ki odraža natanko isto pot odločitev — popravek je minimalen (isSuperAdmin pred DB).

type Role = "owner" | "accountant" | "viewer";

/** Simulacija resolveAccess po popravku (brez dejanske DB) */
function simulateResolveAccess(
  clerkUserId: string,
  dbRow: { role: Role } | null,
): { role: Role } | "forbidden" {
  // Superadmin: brez DB klica, takoj owner
  if (isSuperAdmin(clerkUserId)) return { role: "owner" };

  if (!dbRow) return "forbidden";
  return { role: dbRow.role };
}

describe("resolveAccess logika (po popravku)", () => {
  beforeEach(() => {
    process.env.SUPER_ADMIN_IDS = "super_admin_clerk_id";
  });

  afterEach(() => {
    delete process.env.SUPER_ADMIN_IDS;
  });

  it("superadmin → { role: 'owner' } neodvisno od DB (brez accounting_roles)", () => {
    const result = simulateResolveAccess("super_admin_clerk_id", null);
    expect(result).toEqual({ role: "owner" });
  });

  it("superadmin → { role: 'owner' } tudi ko bi DB vrnil accountant", () => {
    // Zagotovi, da superadmin ne dobi nižje vloge, če bi se pojavil v accounting_roles
    const result = simulateResolveAccess("super_admin_clerk_id", { role: "accountant" });
    expect(result).toEqual({ role: "owner" });
  });

  it("navadni owner → { role: 'owner' } iz DB (nespremenjeno)", () => {
    const result = simulateResolveAccess("owner_clerk_id", { role: "owner" });
    expect(result).toEqual({ role: "owner" });
  });

  it("navadni accountant → { role: 'accountant' } iz DB (nespremenjeno)", () => {
    const result = simulateResolveAccess("accountant_clerk_id", { role: "accountant" });
    expect(result).toEqual({ role: "accountant" });
  });

  it("viewer → { role: 'viewer' } iz DB (nespremenjeno)", () => {
    const result = simulateResolveAccess("viewer_clerk_id", { role: "viewer" });
    expect(result).toEqual({ role: "viewer" });
  });

  it("neznan uporabnik brez DB vrstice → forbidden (403)", () => {
    const result = simulateResolveAccess("unknown_clerk_id", null);
    expect(result).toBe("forbidden");
  });
});

// ─── 3. canEdit logika (frontend simulacija) ──────────────────────────────────
//
// Odraža canEdit useMemo iz stroskovana-mesta.tsx po popravku.

function simulateCanEdit(
  meData: { isSuperAdmin?: boolean; companies?: { id: string; role: string }[] } | undefined,
  companyId: string,
): boolean {
  if (meData?.isSuperAdmin) return true;
  const role = meData?.companies?.find((c) => c.id === companyId)?.role;
  return role === "owner" || role === "accountant";
}

describe("canEdit logika frontend (po popravku)", () => {
  const COMPANY_ID = "company-uuid-123";

  it("superadmin (isSuperAdmin=true) → canEdit=true brez company vloge", () => {
    expect(simulateCanEdit({ isSuperAdmin: true, companies: [] }, COMPANY_ID)).toBe(true);
  });

  it("superadmin → canEdit=true tudi brez companies polja", () => {
    expect(simulateCanEdit({ isSuperAdmin: true }, COMPANY_ID)).toBe(true);
  });

  it("owner → canEdit=true (nespremenjeno)", () => {
    expect(simulateCanEdit(
      { isSuperAdmin: false, companies: [{ id: COMPANY_ID, role: "owner" }] },
      COMPANY_ID,
    )).toBe(true);
  });

  it("accountant → canEdit=true (nespremenjeno)", () => {
    expect(simulateCanEdit(
      { isSuperAdmin: false, companies: [{ id: COMPANY_ID, role: "accountant" }] },
      COMPANY_ID,
    )).toBe(true);
  });

  it("viewer → canEdit=false (nespremenjeno)", () => {
    expect(simulateCanEdit(
      { isSuperAdmin: false, companies: [{ id: COMPANY_ID, role: "viewer" }] },
      COMPANY_ID,
    )).toBe(false);
  });

  it("brez vloge (ni v accounting_roles) → canEdit=false (nespremenjeno)", () => {
    expect(simulateCanEdit(
      { isSuperAdmin: false, companies: [] },
      COMPANY_ID,
    )).toBe(false);
  });

  it("meData=undefined → canEdit=false (nespremenjeno)", () => {
    expect(simulateCanEdit(undefined, COMPANY_ID)).toBe(false);
  });
});
