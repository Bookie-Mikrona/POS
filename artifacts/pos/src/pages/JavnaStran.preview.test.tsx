import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { PreviewOverlay } from "./JavnaStran";

const formValues = {
  slug: "testna-enota",
  active: false,
  description: "Svež opis, ki še ni shranjen.",
  address: "Glavna ulica 1",
  phone: "01 234 56 78",
  email: "info@example.com",
  website: "https://example.com",
  primaryColor: "#1B3B36",
  logoUrl: "",
  coverImageUrl: "",
  maxPartySize: 8,
  slotMinutes: 30,
  slotCapacity: 20,
  openingHours: [
    { dan: 1, odprto: true, intervals: [{ od: "08:00", do: "16:00" }] },
    { dan: 2, odprto: false, intervals: [] },
    { dan: 3, odprto: false, intervals: [] },
    { dan: 4, odprto: false, intervals: [] },
    { dan: 5, odprto: false, intervals: [] },
    { dan: 6, odprto: false, intervals: [] },
    { dan: 7, odprto: false, intervals: [] },
  ],
  dateExceptions: [],
  products: [{
    naziv: "Bon za večerjo",
    opis: "Osnutek bona",
    imageUrl: "",
    active: true,
    variants: [{ naziv: "Vrednost", amountEur: 50, active: true }],
  }],
};

describe("predogled javne strani", () => {
  it("prikaže trenutni osnutek, preklopi širino in ne kliče API-ja", () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const onClose = vi.fn();

    render(
      <PreviewOverlay
        isOpen
        onClose={onClose}
        formValues={formValues}
        enotaIme="Testna restavracija"
        localPreviews={{}}
        productPreviewKeys={["voucher-key"]}
      />,
    );

    expect(screen.getByTestId("status-draft-preview").textContent).toContain("spremembe še niso objavljene");
    expect(screen.getByTestId("text-venue-name").textContent).toBe("Testna restavracija");
    expect(screen.getByTestId("text-venue-description").textContent).toContain("še ni shranjen");

    fireEvent.click(screen.getByTestId("button-preview-mobile"));
    expect(screen.getByTestId("preview-device-frame").className).toContain("max-w-[390px]");
    expect(screen.getByTestId("public-contact-hours-grid").className).toContain("@min-[768px]:grid-cols-2");
    expect(screen.getByTestId("public-contact-hours-grid").className).not.toContain(" md:grid-cols-2");

    fireEvent.click(screen.getByTestId("button-preview-vouchers-tab"));
    expect(screen.getByText("Bon za večerjo")).toBeTruthy();
    expect(fetchSpy).not.toHaveBeenCalled();

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledOnce();
    fetchSpy.mockRestore();
  });

  it("po odstranitvi prvega bona ohrani sliko pri pravem bonu", () => {
    const firstProduct = formValues.products[0];
    const secondProduct = {
      ...firstProduct,
      naziv: "Drugi bon",
    };
    const { rerender } = render(
      <PreviewOverlay
        isOpen
        onClose={vi.fn()}
        formValues={{ ...formValues, products: [firstProduct, secondProduct] }}
        enotaIme="Testna restavracija"
        localPreviews={{
          "product_voucher-a": "https://example.com/a.jpg",
          "product_voucher-b": "https://example.com/b.jpg",
        }}
        productPreviewKeys={["voucher-a", "voucher-b"]}
      />,
    );
    fireEvent.click(screen.getByTestId("button-preview-vouchers-tab"));

    rerender(
      <PreviewOverlay
        isOpen
        onClose={vi.fn()}
        formValues={{ ...formValues, products: [secondProduct] }}
        enotaIme="Testna restavracija"
        localPreviews={{
          "product_voucher-a": "https://example.com/a.jpg",
          "product_voucher-b": "https://example.com/b.jpg",
        }}
        productPreviewKeys={["voucher-b"]}
      />,
    );

    const image = screen.getByTestId("card-preview-voucher-0").querySelector("img");
    expect(image?.getAttribute("src")).toBe("https://example.com/b.jpg");
  });
});