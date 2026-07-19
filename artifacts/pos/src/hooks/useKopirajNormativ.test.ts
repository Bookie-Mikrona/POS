/**
 * Testi za useKopirajNormativ hook.
 *
 * Pokritost:
 *  1. Artikel z normativom → vrstice se nadomestijo, toast "Normativ kopiran", picker se zapre
 *  2. Artikel brez normativa → napaka toast "Ta artikel nima normativa", vrstice ostanejo nespremenjene
 *  3. Napaka pri pridobivanju normativa (fetchQuery vrže napako) → toast za splošno napako
 *
 * Hook testiramo z renderHook iz @testing-library/react, ki ne potrebuje
 * renderiranja celotne komponente in s tem izognemo težavam z Radix UI v jsdom.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { Normativ } from "@workspace/api-client-react";
import { useKopirajNormativ } from "./useKopirajNormativ";

// ─── vi.hoisted mocks ────────────────────────────────────────────────────────

const mockGetArtikelNormativi = vi.hoisted(() => vi.fn<() => Promise<Normativ[]>>());
const mockToast = vi.hoisted(() => vi.fn());

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", () => ({
  getArtikelNormativi: mockGetArtikelNormativi,
  getGetArtikelNormativiQueryKey: (id: number) => ["/api/artikli", id, "normativi"],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ─── Testni podatki ───────────────────────────────────────────────────────────

const normativVira: Normativ[] = [
  {
    id: 1,
    artikelId: 20,
    vhodniArtikelId: 30,
    vhodniArtikelIme: "Kava v zrnu",
    enotaMere: "GRM",
    kolicina: 8,
    vrstniRed: 1,
  },
  {
    id: 2,
    artikelId: 20,
    vhodniArtikelId: 31,
    vhodniArtikelIme: "Voda",
    enotaMere: "MLT",
    kolicina: 30,
    vrstniRed: 2,
  },
];

// ─── Helpers ─────────────────────────────────────────────────────────────────

function makeWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("useKopirajNormativ", () => {
  let setNormativItems: ReturnType<typeof vi.fn>;
  let setNormativNapaka: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    setNormativItems = vi.fn();
    setNormativNapaka = vi.fn();
    mockToast.mockReset();
    mockGetArtikelNormativi.mockReset();
  });

  it("artikel z normativom: vrstice se nadomestijo z normativom vira", async () => {
    mockGetArtikelNormativi.mockResolvedValue(normativVira);

    const { result } = renderHook(
      () => useKopirajNormativ({ setNormativItems, setNormativNapaka }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      await result.current.handleCopyFromArtikel(20);
    });

    expect(setNormativItems).toHaveBeenCalledOnce();
    expect(setNormativItems).toHaveBeenCalledWith([
      { vhodniArtikelId: 30, kolicina: "8", ime: "Kava v zrnu" },
      { vhodniArtikelId: 31, kolicina: "30", ime: "Voda" },
    ]);
  });

  it("artikel z normativom: prikaže toast 'Normativ kopiran'", async () => {
    mockGetArtikelNormativi.mockResolvedValue(normativVira);

    const { result } = renderHook(
      () => useKopirajNormativ({ setNormativItems, setNormativNapaka }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      await result.current.handleCopyFromArtikel(20);
    });

    expect(mockToast).toHaveBeenCalledWith({ title: "Normativ kopiran" });
  });

  it("artikel z normativom: picker se zapre po kopiranju", async () => {
    mockGetArtikelNormativi.mockResolvedValue(normativVira);

    const { result } = renderHook(
      () => useKopirajNormativ({ setNormativItems, setNormativNapaka }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      result.current.setCopyPickerOpen(true);
    });
    expect(result.current.copyPickerOpen).toBe(true);

    await act(async () => {
      await result.current.handleCopyFromArtikel(20);
    });

    expect(result.current.copyPickerOpen).toBe(false);
    expect(result.current.copyPickerSearch).toBe("");
  });

  it("artikel brez normativa: prikaže napako toast in NE zamenja obstoječih vrstic", async () => {
    mockGetArtikelNormativi.mockResolvedValue([]);

    const { result } = renderHook(
      () => useKopirajNormativ({ setNormativItems, setNormativNapaka }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      await result.current.handleCopyFromArtikel(20);
    });

    expect(mockToast).toHaveBeenCalledWith({
      title: "Ta artikel nima normativa",
      variant: "destructive",
    });

    expect(setNormativItems).not.toHaveBeenCalled();
  });

  it("artikel brez normativa: picker ostane odprt (copiranje ni uspelo)", async () => {
    mockGetArtikelNormativi.mockResolvedValue([]);

    const { result } = renderHook(
      () => useKopirajNormativ({ setNormativItems, setNormativNapaka }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      result.current.setCopyPickerOpen(true);
    });

    await act(async () => {
      await result.current.handleCopyFromArtikel(20);
    });

    expect(result.current.copyPickerOpen).toBe(true);
  });

  it("napaka pri pridobivanju normativa: prikaže splošno napako toast", async () => {
    mockGetArtikelNormativi.mockRejectedValue(new Error("Network error"));

    const { result } = renderHook(
      () => useKopirajNormativ({ setNormativItems, setNormativNapaka }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      await result.current.handleCopyFromArtikel(20);
    });

    expect(mockToast).toHaveBeenCalledWith({
      title: "Napaka pri pridobivanju normativa",
      variant: "destructive",
    });

    expect(setNormativItems).not.toHaveBeenCalled();
  });

  it("copyPickerLoading je true med pridobivanjem in false po koncu", async () => {
    let resolveFetch!: (val: Normativ[]) => void;
    mockGetArtikelNormativi.mockImplementation(
      () => new Promise<Normativ[]>(resolve => { resolveFetch = resolve; })
    );

    const { result } = renderHook(
      () => useKopirajNormativ({ setNormativItems, setNormativNapaka }),
      { wrapper: makeWrapper() }
    );

    expect(result.current.copyPickerLoading).toBe(false);

    let handlerPromise!: Promise<void>;
    act(() => {
      handlerPromise = result.current.handleCopyFromArtikel(20);
    });

    expect(result.current.copyPickerLoading).toBe(true);

    await act(async () => {
      resolveFetch(normativVira);
      await handlerPromise;
    });

    expect(result.current.copyPickerLoading).toBe(false);
  });

  it("fetchQuery pokliče getArtikelNormativi s pravilnim sourceId", async () => {
    mockGetArtikelNormativi.mockResolvedValue(normativVira);

    const { result } = renderHook(
      () => useKopirajNormativ({ setNormativItems, setNormativNapaka }),
      { wrapper: makeWrapper() }
    );

    await act(async () => {
      await result.current.handleCopyFromArtikel(42);
    });

    expect(mockGetArtikelNormativi).toHaveBeenCalledWith(42);
  });
});
