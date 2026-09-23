import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { PreviewOverlay } from "../pages/JavnaStran";
import { visualTestProducts, visualTestRestaurant } from "@workspace/public-venue-ui/visual-test-fixture";
import "../index.css";

const params = new URLSearchParams(location.search);
const mobile = params.get("device") === "mobile";

function VisualPreview() {
  useEffect(() => {
    if (mobile) document.querySelector<HTMLElement>('[data-testid="button-preview-mobile"]')?.click();
    document.querySelector<HTMLElement>('[data-testid="button-preview-vouchers-tab"]')?.click();
    document.body.dataset.visualReady = "true";
  }, []);

  return (
    <PreviewOverlay
      isOpen
      onClose={() => {}}
      enotaIme={visualTestRestaurant.ime}
      localPreviews={{}}
      productPreviewKeys={visualTestProducts.map(product => product.id!)}
      formValues={{
        slug: visualTestRestaurant.slug,
        active: visualTestRestaurant.aktivna ?? true,
        description: visualTestRestaurant.opis,
        address: visualTestRestaurant.naslov,
        phone: visualTestRestaurant.kontakt.telefon,
        email: visualTestRestaurant.kontakt.email,
        website: visualTestRestaurant.kontakt.spletnaStran,
        primaryColor: visualTestRestaurant.branding.primaryColor ?? "#1B3B36",
        logoUrl: visualTestRestaurant.branding.logoUrl,
        coverImageUrl: visualTestRestaurant.branding.coverImageUrl,
        maxPartySize: visualTestRestaurant.maxPartySize,
        slotMinutes: 30,
        slotCapacity: 20,
        openingHours: visualTestRestaurant.openingHours,
        dateExceptions: [],
        products: visualTestProducts.map(product => ({
          ...product,
          variants: product.variants.map(variant => ({
            ...variant,
            amountEur: variant.amountCents / 100,
          })),
        })),
      }}
    />
  );
}

createRoot(document.getElementById("root")!).render(<VisualPreview />);