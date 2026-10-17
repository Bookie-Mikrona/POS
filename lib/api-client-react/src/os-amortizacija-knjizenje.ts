/**
 * os-amortizacija-knjizenje.ts — Hooks za knjiženje amortizacije kot osnutek (Faza 3c/2)
 *
 * GET  /os/:companyId/amortizacija/nastavitve
 * PATCH /os/:companyId/amortizacija/nastavitve
 * GET  /os/:companyId/amortizacija/izpis?leto=YYYY&format=pdf|csv
 * POST  /os/:companyId/amortizacija/knjizenje   { leto, mesec?, dryRun }
 *                                               ← periodId je ODSTRANJEN; backend ga izpelje samodejno
 */

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import type {
  UseMutationResult,
  UseQueryOptions,
  UseQueryResult,
} from "@tanstack/react-query";
import { customFetch, getAuthToken } from "./custom-fetch";
import { useGetOsAmortizacijaArhiv } from "./generated/api";

// ─── Tipi ─────────────────────────────────────────────────────────────────────

export interface OsAmortizacijaNastavitveInfo {
  kontoStroskaId: string | null;
  kontoStroskaCode: string | null;
  kontoStroskaName: string | null;
  kontoPopravkaId: string | null;
  kontoPopravkaCode: string | null;
  kontoPopravkaName: string | null;
  /** Lastno leto amortizacije modula OS — NEODVISNO od GLK accounting_periods. */
  osLeto: number | null;
  /**
   * Pravilo prvega meseca amortizacije (per-company nastavitev):
   *   'naslednji_dan'   → prvi mesec = mesec(datum_aktivacije + 1 dan)
   *   'naslednji_mesec' → prvi mesec = mesec_aktivacije + 1
   */
  praviloZacetkaAmortizacije: "naslednji_dan" | "naslednji_mesec";
  /**
   * True kadar ima podjetje aktiven GLK (ERP) modul.
   * Prikaže gumb "Ustvari osnutek temeljnice" v dialogu.
   * OS-only podjetja (false): tok se konča pri Izpis PDF/CSV.
   */
  hasGlkModule: boolean;
  /**
   * Leto zadnjega shranjenega obračuna (MAX iz os_amortizacija_obracun).
   * null = ni nobenega shranjenega obračuna.
   * Uporablja se za privzeto leto ob vstopu na stran (prioriteta pred osLeto).
   */
  zadnjiObracunLeto: number | null;
}

export interface KnjizenjeVrstica {
  kontoStroskaId: string;
  kontoStroskaCode: string | null;
  kontoStroskaName: string | null;
  kontoPopravkaId: string;
  kontoPopravkaCode: string | null;
  kontoPopravkaName: string | null;
  /** Stroškovno mesto iz OS sredstev v tej vrstici (NULL, kadar ni nastavljeno) */
  costCenterId: string | null;
  znesek: string;
  steviloSredstev: number;
}

export interface KnjizenjePredogled {
  referenca: string;
  leto: number;
  mesec: number | null;
  skupajBreme: string;
  skupajDobro: string;
  uravnotezeno: boolean;
  steviloSredstev: number;
  brezKontov: number;
  vrstice: KnjizenjeVrstica[];
}

export interface KnjizenjePotrditev {
  entryId: string;
  referenca: string;
  status: "draft";
  skupajBreme: string;
  skupajDobro: string;
  steviloVrstic: number;
  opis: string;
}

export interface UpdateNastavitveBody {
  kontoStroskaId?: string | null;
  kontoPopravkaId?: string | null;
  kontoStroskaKoda?: string;
  kontoPopravkaKoda?: string;
  /** Nastavi lastno leto amortizacije OS (null = počisti). */
  osLeto?: number | null;
  /** Pravilo prvega meseca amortizacije: 'naslednji_dan' | 'naslednji_mesec'. */
  praviloZacetkaAmortizacije?: "naslednji_dan" | "naslednji_mesec";
}

export interface PostKnjizenjBody {
  leto: number;
  mesec?: number;
  /** periodId je ODSTRANJEN — backend samodejno izpelje obdobje iz leta/meseca. */
  dryRun: boolean;
}

export interface PostObracunBody {
  leto: number;
  doMeseca: number;
}

export interface GlkOsnutekInfo {
  ustvarjen: boolean;
  posodobljen: boolean;
  temeljnicaId: string | null;
  sporocilo: string;
}

export interface ObracunGlavaInfo {
  obracunId: string;
  leto: number;
  doMeseca: number;
  status: "odprt" | "zakljucen";
  referenca: string;
  skupajBreme: string;
  skupajDobro: string;
  steviloSredstev: number;
  brezKontov: number;
  vrstice: KnjizenjeVrstica[];
  /** GLK osnutek: prisoten samo za GLK-podjetja */
  glkOsnutek: GlkOsnutekInfo;
}

export const osAmortizacijaObracunQueryKey = (companyId: string) =>
  ["os-amortizacija-obracun", companyId] as const;

/** Company-scoped archive key, shared with all mutations affecting saved runs. */
export function useGetOsAmortizacijaObracuni(companyId: string) {
  return useGetOsAmortizacijaArhiv(companyId, {
    query: {
      queryKey: osAmortizacijaObracunQueryKey(companyId),
      enabled: !!companyId,
      staleTime: 30_000,
      refetchOnMount: "always",
    },
  });
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const osAmortizacijaNastavitveQueryKey = (companyId: string) =>
  ["os-amortizacija-nastavitve", companyId] as const;

// ─── Hook: GET nastavitve ─────────────────────────────────────────────────────

export function useGetOsAmortizacijaNastavitve(
  companyId: string,
  options?: { query?: Partial<UseQueryOptions<OsAmortizacijaNastavitveInfo>> },
): UseQueryResult<OsAmortizacijaNastavitveInfo> {
  return useQuery({
    queryKey: osAmortizacijaNastavitveQueryKey(companyId),
    queryFn: () =>
      customFetch<OsAmortizacijaNastavitveInfo>(
        `/api/os/${companyId}/amortizacija/nastavitve`,
      ),
    enabled: !!companyId,
    staleTime: 60_000,
    ...options?.query,
  });
}

// ─── Hook: PATCH nastavitve ───────────────────────────────────────────────────

export function useUpdateOsAmortizacijaNastavitve(
  companyId: string,
): UseMutationResult<OsAmortizacijaNastavitveInfo, Error, UpdateNastavitveBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      customFetch<OsAmortizacijaNastavitveInfo>(
        `/api/os/${companyId}/amortizacija/nastavitve`,
        { method: "PATCH", body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: osAmortizacijaNastavitveQueryKey(companyId) });
    },
  });
}

// ─── Hook: Prenos temeljnice amortizacije (PDF / CSV) ────────────────────────
// NEODVISEN od GLK accounting_periods — deluje z OS vlogo (brez ERP).

export function useOsAmortizacijaIzpis(companyId: string): UseMutationResult<
  Blob,
  Error,
  { leto: number; format: "pdf" | "csv" }
> {
  return useMutation({
    mutationFn: async ({ leto, format }: { leto: number; format: "pdf" | "csv" }) => {
      const token = await getAuthToken();
      const url = `/api/os/${companyId}/amortizacija/izpis?leto=${encodeURIComponent(leto)}&format=${format}`;
      const response = await fetch(url, {
        method: "GET",
        headers: {
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
      });
      if (!response.ok) {
        let msg = `Napaka pri generiranju izpisa (${response.status})`;
        try { const j = await response.json() as { error?: string }; if (j.error) msg = j.error; } catch { /* ignore */ }
        throw new Error(msg);
      }
      return response.blob();
    },
  });
}

// ─── Hook: POST knjizenje (dryRun ali dejanski) ───────────────────────────────

/**
 * dryRun=true  → vrne KnjizenjePredogled (brez zapisa v DB; brez GLK modula)
 * dryRun=false → vrne KnjizenjePotrditev (ustvari OSNUTEK temeljnice; zahteva GLK modul)
 *
 * periodId je ODSTRANJEN iz body — backend samodejno izpelje GLK obdobje iz leta/meseca.
 * Za OS-only podjetja (brez GLK modula) je dryRun=false 403; dryRun=true deluje normalno.
 */
export function usePostOsAmortizacijaKnjizenje(
  companyId: string,
): UseMutationResult<KnjizenjePredogled | KnjizenjePotrditev, Error, PostKnjizenjBody> {
  return useMutation({
    mutationFn: (body) =>
      customFetch<KnjizenjePredogled | KnjizenjePotrditev>(
        `/api/os/${companyId}/amortizacija/knjizenje`,
        { method: "POST", body: JSON.stringify(body) },
      ),
  });
}

// ─── Hook: POST obracun (shrani / ažurira mesečni obračun) ───────────────────

export function usePostOsAmortizacijaObracun(
  companyId: string,
): UseMutationResult<ObracunGlavaInfo, Error, PostObracunBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      customFetch<ObracunGlavaInfo>(
        `/api/os/${companyId}/amortizacija/obracun`,
        { method: "POST", body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: osAmortizacijaObracunQueryKey(companyId) });
    },
  });
}

// ─── Hook: POST storno (razveljavi ZADNJI letni obračun) ─────────────────────

export interface PostStornoBody {
  /** Leto obračuna, ki ga želimo stornirati. Mora biti zadnje (najvišje) leto za podjetje. */
  leto: number;
}

export interface StornoResult {
  ok: boolean;
  storniranLeto: number;
  /** true kadar je bil k obračunu priložen GLK osnutek in je bil izbrisan */
  glkOsnutekObrisan: boolean;
}

// ─── Hook: PUT oslabitev vrednosti OS na zaključenem letnem obračunu ─────────

export interface PutOslabitevBody {
  /** Leto zaključenega obračuna (1990–2100) */
  leto: number;
  /** ID sredstva iz osnovna_sredstva.id */
  sredstvoId: string;
  /** Znesek oslabitve (>= 0). "0.00" odstrani obstoječo oslabitev. */
  oslabitev: string;
  /**
   * Metoda obračuna oslabitve:
   *   1 (privzeto) = preostala doba iz stopnje (100/stopnja − pretečena)
   *   2            = uporabnik vnese novo (krajšo) preostalo dobo (novaDoba)
   */
  metodaOslabitve?: number;
  /**
   * Metoda 2: nova preostala doba v letih (min 1).
   * Ignorirana pri Metodi 1.
   */
  novaDoba?: number;
}

export interface PutOslabitevResult {
  ok: boolean;
  leto: number;
  sredstvoId: string;
  oslabitev: string;
  /** Shranjena metoda oslabitve (1 ali 2). */
  metodaOslabitve: number;
  /** Metoda 2: shranjena nova preostala doba v letih. null = M1. */
  novaDoba: number | null;
  /** Preračunana nova letna AM (€/leto). null = oslabitev 0 ali ni veljavne vrednosti. */
  novaLetnaAmRac: string | null;
  /** Nova amortizacijska stopnja (%). null = enako kot novaLetnaAmRac. */
  novaStopnjaRac: string | null;
  /** Preostala doba (leta) uporabljena pri izračunu. null = oslabitev 0. */
  preostalaDoba: number | null;
  opomba: string;
}

export function usePutOsAmortizacijaOslabitev(
  companyId: string,
): UseMutationResult<PutOslabitevResult, Error, PutOslabitevBody> {
  return useMutation({
    mutationFn: (body) =>
      customFetch<PutOslabitevResult>(
        `/api/os/${companyId}/amortizacija/obracun/oslabitev`,
        { method: "PUT", body: JSON.stringify(body) },
      ),
  });
}

export function usePostOsAmortizacijaStorno(
  companyId: string,
): UseMutationResult<StornoResult, Error, PostStornoBody> {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body) =>
      customFetch<StornoResult>(
        `/api/os/${companyId}/amortizacija/obracun/storno`,
        { method: "POST", body: JSON.stringify(body) },
      ),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: osAmortizacijaObracunQueryKey(companyId) });
    },
  });
}

