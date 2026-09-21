/**
 * os-register-medletni.ts — Hook za medletni register OS
 *
 * GET /api/companies/:companyId/osnovna-sredstva-register
 *   ?leto=YYYY  (opcijsko; brez = zadnji shranjeni obračun)
 *   &skupinaId=...
 *   &costCenterId=...
 *   &status=...
 *   &q=...
 *   &includeIzloceno=true
 *
 * Vrne medletni prikaz: začetno stanje + spremembe + končno stanje.
 */

import { useQuery } from "@tanstack/react-query";
import type { UseQueryOptions, UseQueryResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ─── Tipi ─────────────────────────────────────────────────────────────────────

export interface MedletniRegisterVrstica {
  id: string;
  inventarnaSt: string;
  naziv: string;
  skupinaId: string | null;
  status: string;
  steviloDoknjizb: number;

  /** Sklop 1 — začetno stanje (1.1. leta) */
  zacNV: string;
  zacPV: string;
  zacNed: string;

  /** Sklop 2 — spremembe v obdobju */
  noveNabave: string;
  amortObdobja: string;
  izlocitveNV: string;
  izlocitvePV: string;

  /** Sklop 3 — končno stanje (na dan konca obdobja) */
  konNV: string;
  konPV: string;
  konNed: string;

  // ── SRS metapodatki (dodani prek JOIN v route handlerju) ───────────────────
  /** Koda amortizacijske skupine, npr. "II.5". */
  skupinaKoda: string | null;
  /** Naziv amortizacijske skupine. */
  skupinaNaziv: string | null;
  /** Računovodska amortizacijska stopnja (npr. "2.50"). */
  racunovodskaStonja: string | null;
  /** Davčna amortizacijska stopnja (npr. "2.50"). */
  davcnaStonja: string | null;
  /** Datum nabave iz seq=0 doknjizbe (YYYY-MM-DD). */
  datumNabave: string | null;
  /** Datum aktivacije iz seq=0 doknjizbe (YYYY-MM-DD). */
  datumAktivacije: string | null;
  /** Koda konta OS (npr. "0200"). */
  accountCode: string | null;
  /** Koda konta popravka vrednosti (npr. "0290"). */
  kontoPopravkaCode: string | null;
  /** Koda konta amortizacijskega stroška (npr. "4300"). */
  kontoStroskaCode: string | null;
  /** Koda stroškovnega mesta. */
  costCenterCode: string | null;

  // ── Polja za urejanje sredstva (UUID-ji, ki jih potrebuje edit dialog) ──────
  /** UUID stroškovnega mesta (prisoten v enriched odgovor registra). */
  costCenterId?: string | null;
  /** UUID konta OS. */
  accountId?: string | null;
  /** UUID konta popravka vrednosti. */
  kontoPopravkaId?: string | null;
  /** UUID konta amortizacijskega stroška. */
  kontoStroskaId?: string | null;
  /** Opomba na glavi. */
  opomba?: string | null;
  /** Datum odtujitve (ISO YYYY-MM-DD ali null). */
  datumOdtujitve?: string | null;
  /** Razlog izločitve. */
  razlogIzlocitve?: string | null;
}

export interface MedletniSeštevki {
  zacNV: string;
  zacPV: string;
  zacNed: string;
  noveNabave: string;
  amortObdobja: string;
  izlocitveNV: string;
  izlocitvePV: string;
  konNV: string;
  konPV: string;
  konNed: string;
}

export interface MedletniPeriodo {
  leto: number;
  /** Mesec do katerega je obračunano (1–12). Enak doMeseca iz os_amortizacija_obracun. */
  doMeseca: number;
  /** ISO datum zadnjega dne periode, npr. "2024-06-30". */
  datumKonca: string;
  /**
   * true = ni shranjenega obračuna za to leto →
   *        amortObdobja prikazana kot 0 (ni zaključenega obračuna).
   * false = temelji na shranjenem obračunu.
   */
  predogled: boolean;
}

export interface OsRegisterMedletniResponse {
  periodo: MedletniPeriodo;
  /** Zadnji shranjeni obračun podjetja v obliki "MM/YYYY". */
  zadnjiObracun: string | null;
  /** Obračunsko obdobje za izrano leto, npr. "12/2024". null = ni obračuna za to leto. */
  obracunPeriod: string | null;
  /** Lista let, za katera obstaja shranjeni obračun. Za leto selector v UI. */
  razpolozljivaLeta: number[];
  osnovnaSredstva: MedletniRegisterVrstica[];
  seštevki: MedletniSeštevki;
}

// ─── Query key ────────────────────────────────────────────────────────────────

export const osRegisterMedletniQueryKey = (
  companyId: string,
  leto: number | null,
  filters?: Record<string, string | undefined>,
) => ["os-register-medletni", companyId, leto, filters] as const;

// ─── Hook ─────────────────────────────────────────────────────────────────────

export function useGetOsRegisterMedletni(
  companyId: string,
  leto: number | null,
  filters?: Record<string, string | undefined>,
  options?: { query?: Partial<UseQueryOptions<OsRegisterMedletniResponse>> },
): UseQueryResult<OsRegisterMedletniResponse> {
  return useQuery({
    queryKey: osRegisterMedletniQueryKey(companyId, leto, filters),
    queryFn: () => {
      const params = new URLSearchParams();
      if (leto !== null) params.set("leto", String(leto));
      if (filters) {
        for (const [k, v] of Object.entries(filters)) {
          if (v !== undefined && v !== "") params.set(k, v);
        }
      }
      const qs = params.toString();
      return customFetch<OsRegisterMedletniResponse>(
        `/api/companies/${companyId}/osnovna-sredstva-register${qs ? "?" + qs : ""}`,
      );
    },
    enabled: !!companyId,
    staleTime: 60 * 1000, // 1 min (odvisno od obračuna)
    ...options?.query,
  });
}
