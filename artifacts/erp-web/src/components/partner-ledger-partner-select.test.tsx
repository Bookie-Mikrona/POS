import React from "react";
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { matchesLedgerPartner, PartnerLedgerPartnerSelect } from "./partner-ledger-partner-select";

const originalScroll = Element.prototype.scrollIntoView;
beforeAll(() => {
  vi.stubGlobal("ResizeObserver", class { observe() {} unobserve() {} disconnect() {} });
  Element.prototype.scrollIntoView = vi.fn();
});
afterEach(cleanup);
afterAll(() => {
  vi.unstubAllGlobals();
  Element.prototype.scrollIntoView = originalScroll;
});

const partner = {
  id: "test-partner", name: "Gostilna Križišče d.o.o.", taxId: "SI12345678", registrationNumber: "0012345000",
};

describe("iskanje partnerja na kartici", () => {
  it.each(["križi", "KRIZISCE", "gostilna", "d.o.o.", "3456", "12345678", "SI 12345678", "0012345", "345000", ""])
    ("poišče del naziva, davčne ali matične številke: %s", search => {
      expect(matchesLedgerPartner(partner, search)).toBe(true);
    });
  it("sprejme predpono SI tudi če je davčna shranjena brez nje", () => {
    expect(matchesLedgerPartner({ ...partner, taxId: "12345678" }, "si1234")).toBe(true);
  });
  it("ne vrne drugih partnerjev in varno obravnava manjkajoče številke", () => {
    expect(matchesLedgerPartner(partner, "999999")).toBe(false);
    expect(matchesLedgerPartner({ id: "other", name: "Drug partner", taxId: null }, "123")).toBe(false);
  });
  it("filtrira vidne izbire po vseh treh poljih in potrdi najdenega partnerja z Enter", async () => {
    const change = vi.fn();
    render(<PartnerLedgerPartnerSelect value="all" onChange={change}
      partners={[partner, { id: "other", name: "Drug partner", taxId: "99999999" }]} />);
    fireEvent.click(screen.getByRole("combobox"));
    const input = screen.getByRole("combobox", { name: "Iskanje partnerja" });
    for (const search of ["križi", "3456", "0012345"]) {
      fireEvent.change(input, { target: { value: search } });
      await waitFor(() => {
        expect(screen.getByRole("option", { name: /Gostilna Križišče/ })).toBeVisible();
        expect(screen.queryByRole("option", { name: /Drug partner/ })).not.toBeInTheDocument();
        expect(screen.queryByText("Počisti izbiro partnerja")).not.toBeInTheDocument();
      });
    }
    await waitFor(() => expect(screen.getByRole("option", { name: /Gostilna Križišče/ })).toHaveAttribute("aria-selected", "true"));
    fireEvent.keyDown(input, { key: "Enter" });
    expect(change).toHaveBeenCalledWith(partner.id);
    expect(screen.queryByRole("combobox", { name: "Iskanje partnerja" })).not.toBeInTheDocument();
  });
  it("pokaže prazni rezultat in ne izbere partnerja brez zadetka", async () => {
    const change = vi.fn();
    render(<PartnerLedgerPartnerSelect partners={[partner]} value="all" onChange={change} />);
    fireEvent.click(screen.getByRole("combobox"));
    const input = screen.getByRole("combobox", { name: "Iskanje partnerja" });
    fireEvent.change(input, { target: { value: "neobstoječ partner" } });
    expect(screen.getByRole("status")).toHaveTextContent("Ni ustreznih partnerjev.");
    fireEvent.keyDown(input, { key: "Enter" });
    expect(change).not.toHaveBeenCalled();
  });
});