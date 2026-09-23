import type { JavnaRestavracija } from "@workspace/api-client-react";
import type { PreviewVoucherProduct } from "./index";

function svgData(label: string, color: string, width: number, height: number) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="100%" height="100%" fill="${color}"/><text x="50%" y="50%" text-anchor="middle" dominant-baseline="middle" fill="white" font-family="Arial" font-size="${Math.round(height / 7)}">${label}</text></svg>`,
  )}`;
}

export const visualTestRestaurant: JavnaRestavracija = {
  slug: "vizualni-test",
  ime: "Gostilna Pri Lipi",
  aktivna: true,
  opis: "Sveža lokalna kuhinja in prijazen prostor za druženje.",
  naslov: "Glavna ulica 12, Ljubljana",
  kontakt: {
    telefon: "01 234 56 78",
    email: "info@prilipi.test",
    spletnaStran: "https://example.test",
  },
  openingHours: Array.from({ length: 7 }, (_, index) => ({
    dan: index + 1,
    odprto: index < 6,
    intervals: index < 6 ? [{ od: "08:00", do: "22:00" }] : [],
  })),
  maxPartySize: 12,
  branding: {
    primaryColor: "#1B3B36",
    logoUrl: svgData("GL", "#D97706", 400, 400),
    coverImageUrl: svgData("Gostilna Pri Lipi", "#1B3B36", 1600, 700),
  },
};

export const visualTestProducts: PreviewVoucherProduct[] = [{
  id: "11111111-1111-4111-8111-111111111111",
  naziv: "Bon za večerjo",
  opis: "Podarite večer lokalnih okusov.",
  imageUrl: svgData("Darilni bon", "#9A3412", 960, 640),
  active: true,
  variants: [{
    id: "22222222-2222-4222-8222-222222222222",
    naziv: "Vrednost 50 €",
    amountCents: 5000,
    active: true,
  }],
}];

export const visualTestVoucherCatalog = {
  products: visualTestProducts.map(product => ({
    ...product,
    id: product.id!,
    variants: product.variants.map(variant => ({
      ...variant,
      id: variant.id!,
      currency: "EUR",
    })),
  })),
};