import "@testing-library/jest-dom";
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Artikel, PreparedFoodAvailability } from "@workspace/api-client-react";
import {
  getKitchenAvailabilityBadge,
  getKitchenModifierAvailabilityBadge,
  getKitchenPreparedUnit,
  PreparedAvailabilityToolbar,
  type KitchenAvailabilityState,
} from "./PreparedAvailability";

const pizza: Artikel = {
  id: 11,
  ime: "Pica",
  cena: 10,
  davek: 9.5,
  aktiven: true,
  vrstniRed: 1,
  jePica: true,
  mealType: "prepared",
  pripravaVrsta: "pica",
  vrstaArtikla: "storitev",
  jeSkupinskiNabavniArtikel: false,
  povratnaEmbalaza: false,
  drobniInventar: false,
};

const kgPrepared: Artikel = {
  id: 22,
  ime: "Juha na kg",
  cena: 4,
  davek: 9.5,
  aktiven: true,
  vrstniRed: 2,
  enotaMere: "KGM",
  mealType: "prepared",
  prodajniArtikel: false,
  vrstaArtikla: "material",
  jeSkupinskiNabavniArtikel: false,
  povratnaEmbalaza: false,
  drobniInventar: false,
};

const availability: PreparedFoodAvailability = {
  businessDate: "2026-01-01",
  items: [
    {
      articleId: 11,
      articleName: "Pica",
      mealType: "prepared",
      availableQuantity: 4,
      freshQuantity: 12,
      thawedOpenQuantity: 0,
      availableBySize: { mala: 8, normalna: 4, druzinska: null },
    },
    {
      articleId: 22,
      articleName: "Juha na kg",
      mealType: "prepared",
      availableQuantity: 2.4,
      freshQuantity: 2.4,
      thawedOpenQuantity: 0,
    },
    {
      articleId: 33,
      articleName: "Meni",
      mealType: "composite",
      availableQuantity: 3,
      freshQuantity: null,
      thawedOpenQuantity: null,
    },
  ],
  modifierItems: [{ modifierId: 901, availableQuantity: 2 }],
};

const articles: Artikel[] = [
  pizza,
  kgPrepared,
  {
    id: 33,
    ime: "Meni",
    cena: 15,
    davek: 9.5,
    aktiven: true,
    vrstniRed: 3,
    mealType: "composite",
    prodajniArtikel: true,
    vrstaArtikla: "storitev",
    jeSkupinskiNabavniArtikel: false,
    povratnaEmbalaza: false,
    drobniInventar: false,
  },
];

const readyState: KitchenAvailabilityState = { availability, articles, dailyArticleIds: [22] };

describe("KDS prepared-food availability badge helpers", () => {
  it("shows the selected pizza size and defaults legacy lines to normalna without subtracting ticket quantity", () => {
    expect(getKitchenAvailabilityBadge({ artikelId: 11, velikostPice: "mala", kolicina: 99 }, readyState)?.label)
      .toContain("Še na voljo: 8 × mala pica");
    expect(getKitchenAvailabilityBadge({ artikelId: 11 }, readyState)?.label)
      .toContain("Še na voljo: 4 × normalna pica");
  });

  it("treats unconfigured pizza sizes as zero and null as unlimited", () => {
    const state = {
      ...readyState,
      availability: {
        ...availability,
        items: availability.items.map(item => item.articleId === 11
          ? { ...item, availableBySize: { mala: 2, druzinska: null } }
          : item),
      },
    };
    expect(getKitchenAvailabilityBadge({ artikelId: 11, velikostPice: "normalna" }, state)?.label)
      .toContain("Še na voljo: 0 × normalna pica");
    expect(getKitchenAvailabilityBadge({ artikelId: 11, velikostPice: "druzinska" }, state)?.label)
      .toContain("Brez izračunane omejitve");
  });

  it("uses explicit prepared units and does not badge known non-prepared articles", () => {
    expect(getKitchenPreparedUnit("kgm")).toBe("kg");
    expect(getKitchenPreparedUnit("LTR")).toBe("l");
    expect(getKitchenPreparedUnit("g", true)).toBe("neznana enota (g)");
    expect(getKitchenPreparedUnit(null)).toBe("enota neznana");
    expect(getKitchenPreparedUnit(null, true)).toBe("porcija");
    expect(getKitchenPreparedUnit(undefined, true)).toBe("enota neznana");
    expect(getKitchenAvailabilityBadge({ artikelId: 22 }, readyState)?.label)
      .toContain("Še na voljo: 2,4 kg");
    expect(getKitchenAvailabilityBadge({ artikelId: 22 }, { availability, articles: [] })?.label)
      .toContain("Še na voljo: 2,4 enota neznana");
    expect(getKitchenAvailabilityBadge({ artikelId: 404 }, readyState)).toBeNull();
  });

  it("keeps offline, loading and refresh-error states from displaying stale quantities", () => {
    expect(getKitchenAvailabilityBadge({ artikelId: 11 }, { ...readyState, offline: true })?.kind).toBe("offline");
    expect(getKitchenAvailabilityBadge({ artikelId: 11 }, { ...readyState, loading: true })?.kind).toBe("unknown");
    expect(getKitchenAvailabilityBadge({ artikelId: 11 }, { ...readyState, error: true })?.label)
      .toBe("Razpoložljivost ni na voljo");
  });

  it("retains stale records only to identify expected meals and never shows stale quantities after refresh error", () => {
    const refreshedErrorState = { availability, articles, error: true };
    expect(getKitchenAvailabilityBadge({ artikelId: 22 }, refreshedErrorState)).toEqual({
      kind: "unknown",
      label: "Razpoložljivost ni na voljo",
    });
    expect(getKitchenAvailabilityBadge({ artikelId: 11, velikostPice: "mala" }, refreshedErrorState)?.label)
      .not.toContain("8");
  });

  it("looks up modifier capacities by stable modifier id and omits missing entries", () => {
    expect(getKitchenModifierAvailabilityBadge(901, readyState)?.label).toBe("Še na voljo: 2 izbir");
    expect(getKitchenModifierAvailabilityBadge(902, readyState)).toBeNull();
  });
});

describe("PreparedAvailabilityToolbar", () => {
  it("shows only meals listed in daily evidence, not the full prepared/composite catalogue", () => {
    render(<PreparedAvailabilityToolbar state={readyState} />);
    fireEvent.click(screen.getByRole("button", { name: /Razpoložljivost/i }));

    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(/Še na voljo za nova naročila/)).toBeInTheDocument();
    expect(screen.getByText(/Zamrznjene porcije niso vključene/)).toBeInTheDocument();
    expect(screen.queryByTestId("text-shared-prepared-stock")).not.toBeInTheDocument();
    expect(screen.getAllByText(/Nezamrznjeno, za nadaljnjo uporabo:/)).toHaveLength(1);
    expect(screen.getByText("2,4 kg")).toBeInTheDocument();
    expect(screen.queryByTestId("row-prepared-availability-11")).not.toBeInTheDocument();
    expect(screen.queryByTestId("row-prepared-availability-33")).not.toBeInTheDocument();
  });

  it("retains exhausted meals in daily evidence and updates membership when refreshed", () => {
    const { rerender } = render(<PreparedAvailabilityToolbar state={{
      ...readyState,
      articles: articles.map(article => article.id === 22 ? { ...article, prodajniArtikel: true } : article),
      availability: { ...availability, items: availability.items.map(item =>
        item.articleId === 22 ? { ...item, availableQuantity: 0, freshQuantity: 0 } : item) },
    }} />);
    fireEvent.click(screen.getByRole("button", { name: /Razpoložljivost/i }));
    expect(screen.getByTestId("row-prepared-availability-22")).toHaveTextContent("Kapaciteta za prodajo: 0 kg");
    rerender(<PreparedAvailabilityToolbar state={{ ...readyState, dailyArticleIds: [] }} />);
    expect(screen.queryByTestId("row-prepared-availability-22")).not.toBeInTheDocument();
    expect(screen.getByTestId("status-prepared-availability-empty")).toBeInTheDocument();
  });

  it("shows loading, empty, offline and error/retry states without leaking stale data", () => {
    const retry = vi.fn();
    const { rerender } = render(<PreparedAvailabilityToolbar state={{ loading: true }} loading />);
    fireEvent.click(screen.getByRole("button", { name: /Razpoložljivost/i }));
    expect(screen.getByTestId("status-prepared-availability-loading")).toBeInTheDocument();

    rerender(<PreparedAvailabilityToolbar state={{ availability, articles, error: true }} error onRetry={retry} />);
    expect(screen.getByTestId("status-prepared-availability-error")).toBeInTheDocument();
    expect(screen.getByTestId("status-kitchen-stock-error")).toBeInTheDocument();
    expect(screen.queryByTestId("row-prepared-availability-11")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /Poskusi znova/i }));
    expect(retry).toHaveBeenCalledOnce();

    rerender(<PreparedAvailabilityToolbar state={{ offline: true }} offline canRetry={false} />);
    expect(screen.getByTestId("status-prepared-availability-offline")).toBeInTheDocument();
    expect(screen.queryByTestId("row-prepared-availability-11")).not.toBeInTheDocument();

    rerender(<PreparedAvailabilityToolbar state={{ availability: { ...availability, items: [] }, articles, dailyArticleIds: [] }} />);
    expect(screen.getByTestId("status-prepared-availability-empty")).toBeInTheDocument();
  });
});