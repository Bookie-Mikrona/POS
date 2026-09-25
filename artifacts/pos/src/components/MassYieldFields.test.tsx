import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { MassYieldFields, normalizeMassYield, normalizeMassYieldOverrides } from "./MassYieldFields";

describe("masa in odcejeni izplen", () => {
  it("izračuna neto delež iz obeh mas in ne ugiba manjkajočih vrednosti", () => {
    expect(normalizeMassYield({ brutoTezaG: "500", netoTezaG: "480", netoDelezOdst: "" })).toEqual({
      brutoTezaG: 500,
      netoTezaG: 480,
      netoDelezOdst: 96,
    });
    expect(normalizeMassYield({ brutoTezaG: "", netoTezaG: "", netoDelezOdst: "80,5" })).toEqual({
      brutoTezaG: null,
      netoTezaG: null,
      netoDelezOdst: 80.5,
    });
    expect(normalizeMassYield({ brutoTezaG: "500", netoTezaG: "", netoDelezOdst: "" })).toEqual({
      brutoTezaG: 500,
      netoTezaG: null,
      netoDelezOdst: null,
    });
  });

  it("ostane privzeto zložen in prikaže izplen ter informativno ceno na kg", () => {
    const onChange = vi.fn();
    const { container } = render(
      <MassYieldFields
        value={{ brutoTezaG: "", netoTezaG: "", netoDelezOdst: "" }}
        onChange={onChange}
        quantity={10}
        lineValue={50}
        sourceUnit="kos"
        baseUnit="kom"
      />,
    );
    expect(container.querySelector('[aria-expanded="false"]')).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /Masa \/ odcejeni izplen/ }));
    fireEvent.change(screen.getByLabelText("Neto odcejena masa v gramih"), { target: { value: "480" } });
    expect(onChange).toHaveBeenCalledWith({ brutoTezaG: "", netoTezaG: "480", netoDelezOdst: "" });
    const { rerender } = render(
      <MassYieldFields
        value={{ brutoTezaG: "", netoTezaG: "480", netoDelezOdst: "" }}
        onChange={onChange}
        quantity={10}
        lineValue={50}
        priceMode="neto"
        buyerVatRegistered
        baseUnit="kom"
      />,
    );
    expect(screen.getAllByText(/4,8 kg/).length).toBeGreaterThan(0);
    expect(screen.getAllByText(/10,42 €\/kg/).length).toBeGreaterThan(0);
    rerender(
      <MassYieldFields
        value={{ brutoTezaG: "500", netoTezaG: "480", netoDelezOdst: "" }}
        onChange={onChange}
        quantity={10}
        lineValue={50}
        priceMode="neto"
        buyerVatRegistered
        baseUnit="kom"
      />,
    );
    expect(screen.getAllByText(/96 %/).length).toBeGreaterThan(0);
  });

  it("prikaže ocenjeni neto izplen za kose in €/kg samo iz neto nabavne vrednosti", () => {
    render(
      <MassYieldFields
        value={{ brutoTezaG: "500", netoTezaG: "", netoDelezOdst: "80" }}
        onChange={vi.fn()}
        quantity={10}
        lineValue={48.8}
        priceMode="bruto"
        taxRate={22}
        buyerVatRegistered
        baseUnit="kom"
      />,
    );
    expect(screen.getByText(/10 kos × 400 g uporabne mase/)).toBeTruthy();
    expect(screen.getByText(/4 kg/)).toBeTruthy();
    expect(screen.getByText(/10 €\/kg/)).toBeTruthy();
  });

  it("skrije numerični predogled, kadar osnovna enota ni kos", () => {
    render(
      <MassYieldFields
        value={{ brutoTezaG: "500", netoTezaG: "480", netoDelezOdst: "" }}
        onChange={vi.fn()}
        quantity={10}
        lineValue={50}
        priceMode="neto"
        baseUnit="kg"
      />,
    );
    expect(screen.queryByText(/Predogled:/)).toBeNull();
    expect(screen.queryByText(/€/)).toBeNull();
  });

  it("pri nakupu kozarcev ohrani polno vrednost za DDV nezavezanca", () => {
    render(
      <MassYieldFields
        value={{ brutoTezaG: "500", netoTezaG: "480", netoDelezOdst: "" }}
        onChange={vi.fn()}
        sourceUnit="KOM"
        purchaseQuantity="10"
        quantity={4.8}
        lineValue={50}
        priceMode="bruto"
        taxRate={22}
        buyerVatRegistered={false}
        baseUnit="kg"
      />,
    );
    expect(screen.getByText(/10 kos × 480 g uporabne mase/)).toBeTruthy();
    expect(screen.getByText(/10,42 €\/kg/)).toBeTruthy();
  });

  it("pri kg zalogi samodejno pokaže izvorno količino in enoto prejemnice", () => {
    render(
      <MassYieldFields
        value={{ brutoTezaG: "", netoTezaG: "", netoDelezOdst: "" }}
        onChange={vi.fn()}
        sourceUnit=""
        baseUnit="kg"
        autoOpen
        onPurchaseQuantityChange={vi.fn()}
        onPurchaseUnitChange={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /Skrij maso \/ izplen/ }).getAttribute("aria-expanded")).toBe("true");
    expect(screen.getByLabelText("Izvorna količina pri dobavitelju")).toBeTruthy();
    expect(screen.getByLabelText("Izvorna enota pri dobavitelju")).toBeTruthy();
  });

  it("iz uparjanja ne pošlje praznih mass override polj, če so neurejena", () => {
    expect(normalizeMassYieldOverrides(
      { brutoTezaG: "", netoTezaG: "", netoDelezOdst: "" },
      {},
    )).toEqual({});
    expect(normalizeMassYieldOverrides(
      { brutoTezaG: "", netoTezaG: "", netoDelezOdst: "80" },
      { netoDelezOdst: true },
    )).toEqual({ netoDelezOdst: 80 });
  });
});