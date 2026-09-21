/**
 * Testi za useAddPostavkaOptimistic hook.
 *
 * Pokritost:
 *  1. onMutate: navaden artikel → takoj vstavi temp postavko v cache (id < 0)
 *  2. onError: rollback — temp postavka se odstrani iz cache-a
 *  3. onSuccess: strežniški odgovor zamenja temp postavko (real id > 0)
 *  4. Sekvencialno hitro dodajanje — dva tapa v <10ms → 2 temp postavki
 *  5. Skip optimistike za modifikatorje (izbranModifikatorji.length > 0)
 *  6. Skip optimistike za To-Go child (parentPostavkaId ≠ null)
 *
 * Vzorec: renderHook + QueryClientProvider (enak kot useKopirajNormativ.test.ts)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import type { ArtikelZaOptimistiko } from "./useAddPostavkaOptimistic";
import { isTemporaryPostavkaId, useAddPostavkaOptimistic } from "./useAddPostavkaOptimistic";

// ─── vi.hoisted mocks ────────────────────────────────────────────────────────

const mockAddPostavkaFn = vi.hoisted(() => vi.fn<() => Promise<unknown>>());

// ─── Module mocks ────────────────────────────────────────────────────────────

vi.mock("@workspace/api-client-react", async () => {
  // useAddPostavka mora delovati kot pravi hook (useMutation wrapper)
  const { useMutation } = await import("@tanstack/react-query");
  return {
    useAddPostavka: (options?: { mutation?: Record<string, unknown> }) =>
      useMutation({
        mutationFn: (vars: { id: number; data: Record<string, unknown> }) =>
          mockAddPostavkaFn(vars),
        ...options?.mutation,
      }),
    getGetNarociloQueryKey: (id: number) => ["/api/narocila", id],
  };
});

// ─── Testni podatki ───────────────────────────────────────────────────────────

const ARTIKEL_KAVA: ArtikelZaOptimistiko = {
  id: 42,
  ime: "Kava",
  cena: 1.5,
  davek: 9.5,
  jePica: false,
  kategorijaId: 1,
  kategorijaIme: "Pijače",
};

const NAROCILO_ID = 7;

const narociloV_Cacheu = {
  id: NAROCILO_ID,
  skupaj: 3.0,
  postavke: [
    { id: 1, artikelId: 10, ime: "Čaj", kolicina: 2, cenaKos: 1.5, skupaj: 3.0, davek: 9.5 },
  ],
};

// ─── Helper: wrapper + ref ────────────────────────────────────────────────────

function makeWrapper(queryClient: QueryClient) {
  return ({ children }: { children: React.ReactNode }) =>
    React.createElement(QueryClientProvider, { client: queryClient }, children);
}

// ─── Testi ────────────────────────────────────────────────────────────────────

describe("useAddPostavkaOptimistic", () => {
  let qc: QueryClient;
  let artikliMapRef: React.MutableRefObject<Map<number, ArtikelZaOptimistiko>>;

  beforeEach(() => {
    qc = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    // Napolni cache z obstoječim naročilom
    qc.setQueryData(["/api/narocila", NAROCILO_ID], structuredClone(narociloV_Cacheu));
    artikliMapRef = { current: new Map([[ARTIKEL_KAVA.id, ARTIKEL_KAVA]]) };
    mockAddPostavkaFn.mockReset();
  });

  it("začasni negativni ID ni veljaven za API postavke", () => {
    expect(isTemporaryPostavkaId(-1787777131884)).toBe(true);
    expect(isTemporaryPostavkaId(99)).toBe(false);
  });

  it("1. onMutate: temp postavka (id < 0) se takoj vstavi v cache", async () => {
    // API kliče se ne zaključi med testom
    let resolveApi!: (v: unknown) => void;
    mockAddPostavkaFn.mockReturnValue(new Promise((r) => { resolveApi = r; }));

    const { result } = renderHook(() => useAddPostavkaOptimistic(artikliMapRef), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      result.current.mutate({ id: NAROCILO_ID, data: { artikelId: 42, kolicina: 1, opomba: null } });
      // Daj onMutate čas za izvedbo (je async)
      await Promise.resolve();
    });

    const cached = qc.getQueryData<typeof narociloV_Cacheu>(["/api/narocila", NAROCILO_ID]);
    expect(cached?.postavke).toHaveLength(2);
    const tempPostavka = cached?.postavke?.[0];
    expect(tempPostavka?.id).toBeLessThan(0);
    expect(tempPostavka?.ime).toBe("Kava");
    expect(tempPostavka?.cenaKos).toBe(1.5);
    expect(tempPostavka?.skupaj).toBe(1.5);
    expect(cached?.skupaj).toBe(4.5); // 3.0 + 1.5

    resolveApi({ id: NAROCILO_ID, skupaj: 4.5, postavke: [] });
  });

  it("2. onError: rollback — temp postavka se odstrani, skupaj se povrne", async () => {
    let rejectApi!: (e: Error) => void;
    mockAddPostavkaFn.mockReturnValue(new Promise((_, r) => { rejectApi = r; }));

    const { result } = renderHook(() => useAddPostavkaOptimistic(artikliMapRef), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      result.current.mutate({ id: NAROCILO_ID, data: { artikelId: 42, kolicina: 1, opomba: null } });
      await Promise.resolve();
    });

    // Potrdi optimistično stanje
    expect(qc.getQueryData<typeof narociloV_Cacheu>(["/api/narocila", NAROCILO_ID])?.postavke).toHaveLength(2);

    // Simuliraj strežniško napako → rollback
    await act(async () => {
      rejectApi(new Error("Network error"));
      await Promise.resolve();
    });

    const cached = qc.getQueryData<typeof narociloV_Cacheu>(["/api/narocila", NAROCILO_ID]);
    expect(cached?.postavke).toHaveLength(1);
    expect(cached?.skupaj).toBe(3.0);
  });

  it("3. onSuccess: per-call setQueryData zamenja temp postavko s strežniško", async () => {
    const strežniškiOdgovor = {
      id: NAROCILO_ID,
      skupaj: 4.5,
      postavke: [
        { id: 1, artikelId: 10, ime: "Čaj", kolicina: 2, cenaKos: 1.5, skupaj: 3.0, davek: 9.5 },
        { id: 99, artikelId: 42, ime: "Kava", kolicina: 1, cenaKos: 1.5, skupaj: 1.5, davek: 9.5 },
      ],
    };
    mockAddPostavkaFn.mockResolvedValue(strežniškiOdgovor);

    const { result } = renderHook(() => useAddPostavkaOptimistic(artikliMapRef), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      await new Promise<void>((done) => {
        result.current.mutate(
          { id: NAROCILO_ID, data: { artikelId: 42, kolicina: 1, opomba: null } },
          {
            onSuccess: (data) => {
              qc.setQueryData(["/api/narocila", NAROCILO_ID], data);
              done();
            },
          },
        );
      });
    });

    const cached = qc.getQueryData<typeof strežniškiOdgovor>(["/api/narocila", NAROCILO_ID]);
    expect(cached?.postavke).toHaveLength(2);
    const poStavka = cached?.postavke?.find((p) => p.artikelId === 42);
    expect(poStavka?.id).toBe(99); // pravi DB id (> 0), ne temp id
  });

  it("4. Sekvencialno hitro dodajanje — 2 tapa → 2 temp postavki v cache-u", async () => {
    let resolve1!: (v: unknown) => void;
    let resolve2!: (v: unknown) => void;
    mockAddPostavkaFn
      .mockReturnValueOnce(new Promise((r) => { resolve1 = r; }))
      .mockReturnValueOnce(new Promise((r) => { resolve2 = r; }));

    const { result } = renderHook(() => useAddPostavkaOptimistic(artikliMapRef), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      result.current.mutate({ id: NAROCILO_ID, data: { artikelId: 42, kolicina: 1, opomba: null } });
      await Promise.resolve();
    });

    await act(async () => {
      result.current.mutate({ id: NAROCILO_ID, data: { artikelId: 42, kolicina: 1, opomba: null } });
      await Promise.resolve();
    });

    const cached = qc.getQueryData<typeof narociloV_Cacheu>(["/api/narocila", NAROCILO_ID]);
    expect(cached?.postavke).toHaveLength(3); // 1 obstoječa + 2 temp
    expect(cached?.skupaj).toBe(6.0); // 3.0 + 1.5 + 1.5

    resolve1({}); resolve2({});
  });

  it("5. Skip optimistike: modifikatorji → cache se ne spremeni", async () => {
    let resolveApi!: (v: unknown) => void;
    mockAddPostavkaFn.mockReturnValue(new Promise((r) => { resolveApi = r; }));

    const { result } = renderHook(() => useAddPostavkaOptimistic(artikliMapRef), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      result.current.mutate({
        id: NAROCILO_ID,
        data: { artikelId: 42, kolicina: 1, opomba: null, izbranModifikatorji: [5, 6] } as never,
      });
      await Promise.resolve();
    });

    const cached = qc.getQueryData<typeof narociloV_Cacheu>(["/api/narocila", NAROCILO_ID]);
    expect(cached?.postavke).toHaveLength(1); // brez spremembe
    expect(cached?.skupaj).toBe(3.0);

    resolveApi({});
  });

  it("6. Skip optimistike: parentPostavkaId → cache se ne spremeni", async () => {
    let resolveApi!: (v: unknown) => void;
    mockAddPostavkaFn.mockReturnValue(new Promise((r) => { resolveApi = r; }));

    const { result } = renderHook(() => useAddPostavkaOptimistic(artikliMapRef), {
      wrapper: makeWrapper(qc),
    });

    await act(async () => {
      result.current.mutate({
        id: NAROCILO_ID,
        data: { artikelId: 42, kolicina: 1, opomba: null, parentPostavkaId: 100 } as never,
      });
      await Promise.resolve();
    });

    const cached = qc.getQueryData<typeof narociloV_Cacheu>(["/api/narocila", NAROCILO_ID]);
    expect(cached?.postavke).toHaveLength(1);

    resolveApi({});
  });
});
