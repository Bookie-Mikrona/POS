/**
 * Testi za skupino Šifranti v POS sidebarju (prava komponenta SifrantiSidebar).
 *
 * Preverja:
 *   - skupina je vedno prikazana vsem POS vlogam (admin, admin_enote, uporabnik),
 *     brez odvisnosti od import.meta.env.DEV
 *   - Poslovni partnerji vodijo na /partnerji za vse vloge (POS Link)
 *   - Stroškovna mesta in Kontni plan: admin podjetja → interni POS povezavi
 *   - Stroškovna mesta in Kontni plan: admin_enote/uporabnik → toast opozorilo
 *     "Nimate dodeljene pravice", navigacija se ne izvede
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import React from "react";

// ── Mocks ────────────────────────────────────────────────────────────────────

const mockToast = vi.fn();
const mockWindowOpen = vi.fn();

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// Wouter: useLocation vrne lokacijo; Link renderira <a>
vi.mock("wouter", () => ({
  useLocation: () => ["/", vi.fn()],
  Link: ({ href, children, className, ...rest }: { href: string; children: React.ReactNode; className?: string }) =>
    React.createElement("a", { href, className, ...rest }, children),
}));

import { SifrantiSidebar } from "@/components/SifrantiSidebar";

// ── Testi ─────────────────────────────────────────────────────────────────────

describe("SifrantiSidebar — skupina Šifranti v POS sidebarju", () => {
  beforeEach(() => {
    mockToast.mockClear();
    mockWindowOpen.mockClear();
    vi.stubGlobal("open", mockWindowOpen);
  });

  // ── Vidnost ──────────────────────────────────────────────────────────────

  it("skupina Šifranti je prikazana pri vlogi 'admin'", () => {
    render(<SifrantiSidebar vloga="admin" />);
    expect(screen.getByTestId("sifranti-sidebar")).toBeDefined();
    expect(screen.getByText("Šifranti")).toBeDefined();
  });

  it("skupina Šifranti je prikazana pri vlogi 'admin_enote'", () => {
    render(<SifrantiSidebar vloga="admin_enote" />);
    expect(screen.getByTestId("sifranti-sidebar")).toBeDefined();
  });

  it("skupina Šifranti je prikazana pri vlogi 'uporabnik'", () => {
    render(<SifrantiSidebar vloga="uporabnik" />);
    expect(screen.getByTestId("sifranti-sidebar")).toBeDefined();
  });

  it("vsi trije šifranti so navedeni v skupini", () => {
    render(<SifrantiSidebar vloga="uporabnik" />);
    expect(screen.getByText("Poslovni partnerji")).toBeDefined();
    expect(screen.queryByText("Partnerji", { exact: true })).toBeNull();
    expect(screen.getByText("Stroškovna mesta")).toBeDefined();
    expect(screen.getByText("Kontni plan")).toBeDefined();
  });

  // ── Poslovni partnerji (vsi) ──────────────────────────────────────────────

  it.each(["admin", "admin_enote", "uporabnik"])(
    "Poslovni partnerji je povezava na /partnerji za vlogo '%s'",
    (vloga) => {
      render(<SifrantiSidebar vloga={vloga} />);
      const link = screen.getByTestId("sifranti-link-partnerji");
      expect(link.getAttribute("href")).toBe("/partnerji");
    },
  );

  // ── Stroškovna mesta / Kontni plan — admin podjetja ───────────────────────

  it("admin podjetja vidi Link za Stroškovna mesta in Kontni plan", () => {
    render(<SifrantiSidebar vloga="admin" />);
    const linkStm = screen.getByTestId("sifranti-link-stroskovana-mesta");
    expect(linkStm.getAttribute("href")).toBe("/stroskovana-mesta");
    expect(linkStm.getAttribute("target")).toBeNull();

    const linkKontni = screen.getByTestId("sifranti-link-kontni-plan");
    expect(linkKontni.getAttribute("href")).toBe("/kontni-plan");
    expect(linkKontni.getAttribute("target")).toBeNull();
    expect(mockWindowOpen).not.toHaveBeenCalled();
  });

  // ── Stroškovna mesta / Kontni plan — brez pravice ─────────────────────────

  it.each([
    ["admin_enote", "sifranti-btn-stroskovana-mesta"],
    ["admin_enote", "sifranti-btn-kontni-plan"],
    ["uporabnik", "sifranti-btn-stroskovana-mesta"],
    ["uporabnik", "sifranti-btn-kontni-plan"],
  ])("vloga '%s' klikne %s → toast opozorilo, navigacija se NE izvede", (vloga, testId) => {
    render(<SifrantiSidebar vloga={vloga} />);
    fireEvent.click(screen.getByTestId(testId));
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({
        title: "Nimate dodeljene pravice",
        variant: "destructive",
      }),
    );
    expect(mockWindowOpen).not.toHaveBeenCalled();
  });
});
