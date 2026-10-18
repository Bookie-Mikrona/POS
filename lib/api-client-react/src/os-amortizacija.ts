/**
 * os-amortizacija.ts — Hook za amortizacijski obračun OS (Faza 3c)
 *
 * GET /os/:companyId/amortizacija?leto=YYYY
 *   → izračuna amortizacijo za dano leto, NE zapisuje v bazo
 */

import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ─── Tipi (zrcalijo osAmortizacijaEngine.ts) ─────────────────────────────────

export interface DoknjizbaAmortResult {
  id: string;
  seq: number;
  nabavnaVrednost: string;
  odpisanaVrednost: string;
  neamortizljiviDelPct: string;
  datumAktivacije: string | null;
  datumIzpisa: string | null;
  status: string;
  osnova: string;
  preostalo: string;
  stMesecev: number;
  letnaRacunovodska: string;
  letnaDavcna: string;
  obracunanaRacunovodska: string;
  obracunanaDavcna: string;
  sedanjaVrednostPoObracunu: string;
  opomba: "brez_aktivacije" | "polno_odpisano" | "brez_skupine" | null;
}

export interface SredstvoAmortResult {
  id: string;
  inventarnaSt: string;
  naziv: string;
  /** Present for saved years; current means the historical identity is incomplete. */
  identitySource?: "snapshot" | "current";
  skupinaId: string | null;
  skupinaKoda: string | null;
  skupinaNaziv: string | null;
  racunovodskaStonja: string | null;
  davcnaStonja: string | null;
  accountId: string | null;
  accountCode: string | null;
  accountName: string | null;
  costCenterId: string | null;
  costCenterCode: string | null;
  costCenterName: string | null;
  status: string;
  brezSkupine: boolean;
  doknjizbe: DoknjizbaAmortResult[];
  skupnaOsnova: string;
  skupnaPreostalo: string;
  /**
   * Oslabitev iz zaključenega obračuna PRETEKLEGA leta, aplicirana na osnovo tega leta.
   * "0.00" = ni oslabitve.
   */
  skupnaOslabitev: string;
  skupnaObracunanaRacunovodska: string;
  skupnaObracunanaDavcna: string;
  sedanjaVrednostPoObracunu: string;
  polnoOdpisano: boolean;
  /**
   * Oslabitev vnesena na ZAKLJUCEN obracun TEGA leta (vpliva na osnovo NASLEDNJEGA leta).
   * Prisotno samo na shranjenih obračunih. "0.00" = ni vnesene oslabitve.
   */
  savedOslabitev?: string;
  /**
   * Metoda oslabitve (1 ali 2) za ZAKLJUCEN obracun TEGA leta.
   * Prisotno samo na shranjenih obračunih.
   */
  savedMetodaOslabitve?: number;
  /**
   * Preračunana nova letna AM za ZAKLJUCEN obracun TEGA leta.
   * = nova_knjižna / preostala_doba. Null = ni oslabitve ali ni veljavne vrednosti.
   */
  savedNovaLetnaAmRac?: string | null;
  /**
   * Nova letna AM po oslabitvi, ki jo UPORABLJA engine za TEM letom.
   * Iz najnovejšega preteklega leta z oslabitev_nova_letna_am_rac > 0.
   * Prisotno, ko je motor prevzel preračunano vrednost namesto standardne formule.
   */
  novaLetnaAmPoOslabitvi?: string;
  /**
   * Nova amortizacijska stopnja (%) po oslabitvi = novaLetnaAmPoOslabitvi / skupnaOsnova × 100.
   * Prisotno skupaj z novaLetnaAmPoOslabitvi.
   */
  novaStopnjaPoOslabitvi?: string;
  /**
   * Leto aktivacije osnovne doknjižbe (seq=0).
   * Potrebno za izračun pretečene dobe v UI predogledu oslabitve.
   */
  activationYear?: number;
}

export interface AmortObracunResult {
  leto: number;
  /**
   * Do katerega meseca je shranjen obračun (1–12).
   * null = ni shranjenega obračuna → predogled celoletnega izračuna.
   */
  doMeseca: number | null;
  /**
   * true = ni shranjenega obračuna za to leto → prikazani zneski so predizračun (celo leto).
   * false = prikaz temelji na shranjenem obračunu (doMeseca je iz os_amortizacija_obracun).
   */
  predogled: boolean;
  /**
   * true = shranjeni obračun je zastarel: pravilo ali podatki so se spremenili
   *        po zadnjem zagonu obračuna. Prikazani zneski so shranjeni (= izpis), a ne ažurni.
   * false = obračun ustreza aktualnim nastavitvam in podatkom (ali ni shranjenega obračuna).
   */
  zastarel: boolean;
  /**
   * Razlog zastarelosti v slovenščini; null ko zastarel=false.
   * Primer: "Pravilo začetka amortizacije se je spremenilo iz naslednji_dan v naslednji_mesec"
   */
  zastarelRazlog: string | null;
  skupajRacunovodska: string;
  skupajDavcna: string;
  steviloSredstev: number;
  brezSkupine: number;
  polnoOdpisanih: number;
  aktivnih: number;
  sredstva: SredstvoAmortResult[];
  poKontih: Array<{
    accountCode: string | null;
    accountName: string | null;
    skupajRacunovodska: string;
    skupajDavcna: string;
    stevilaSredstev: number;
  }>;
  poStroskovnihMestih: Array<{
    costCenterCode: string | null;
    costCenterName: string | null;
    skupajRacunovodska: string;
    skupajDavcna: string;
    stevilaSredstev: number;
  }>;
}

// ─── Query key ────────────────────────────────────────────────────────────────

export const osAmortizacijaQueryKey = (companyId: string, leto: number) =>
  ["os-amortizacija", companyId, leto] as const;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGetOsAmortizacija(
  companyId: string,
  leto: number,
  options?: { query?: Partial<UseQueryOptions<AmortObracunResult>> },
): UseQueryResult<AmortObracunResult> {
  return useQuery({
    queryKey: osAmortizacijaQueryKey(companyId, leto),
    queryFn: () =>
      customFetch<AmortObracunResult>(
        `/api/os/${companyId}/amortizacija?leto=${leto}`,
      ),
    enabled: !!companyId && !!leto,
    // Izračun je determinističen — 5 min cache
    staleTime: 5 * 60 * 1000,
    ...options?.query,
  });
}
