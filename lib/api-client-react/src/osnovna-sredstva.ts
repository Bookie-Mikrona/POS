/**
 * osnovna-sredstva.ts — Hooks za register osnovnih sredstev (Faza 3a–3b, Možnost A)
 *
 * Hierarhija GLAVA + PODZAPISI:
 *   OsnovnoSredstvo  — glava: skupni atributi + agregati iz doknjižb
 *   OsDoknjizba      — podzapis: vrednostna polja, datumi, lastni status
 *   OsnovnoSredstvoKartica — glava + vse doknjižbe + seštevki
 */

import { useMutation, useQuery } from "@tanstack/react-query";
import type { UseQueryOptions, UseMutationResult } from "@tanstack/react-query";
import { customFetch } from "./custom-fetch";

// ─── Tipi ────────────────────────────────────────────────────────────────────

export interface OsAmortizacijskaSkupina {
  id: string;
  companyId: string;
  koda: string;
  naziv: string;
  racunovodskaStonja: string;
  davcnaStonja: string;
  aktivno: boolean;
  opomba: string | null;
  createdAt: string;
  updatedAt: string;
}

/** Posamezna doknjižba (podzapis sredstva). seq=0 = osnovni nakup; seq≥1 = dograditev. */
export interface OsDoknjizba {
  id: string;
  sredstvoId: string;
  seq: number;
  /** Opis vlaganja — za seq=0 neobvezen; za dograditve priporočljiv. */
  nazivVlaganja: string | null;
  nabavnaVrednost: string;
  odpisanaVrednost: string;
  neamortizljiviDelPct: string;
  datumNabave: string;
  datumAktivacije: string | null;
  datumIzpisa: string | null;
  status: "v_teku" | "v_uporabi" | "odpisano" | "izloceno";
  /** FK na counterparties (dobavitelj tega nakupa). */
  partnerId: string | null;
  /** Številka prejetega računa / nabavnega dokumenta. */
  stRacuna: string | null;
  /** Datum prejetega računa (ISO YYYY-MM-DD). */
  datumRacuna: string | null;
  /**
   * Naziv dobavitelja — prebran iz counterparties prek JOIN na kartici.
   * Prisoten samo na GET /osnovna-sredstva/:id (kartica).
   */
  partnerNaziv?: string | null;
  /**
   * Davčna številka dobavitelja — prebrana iz counterparties prek JOIN.
   * Prisotna samo na GET /osnovna-sredstva/:id (kartica).
   */
  partnerTaxId?: string | null;
  createdAt: string;
  updatedAt: string;
  /** Izračunano: nabavnaVrednost − odpisanaVrednost (= pred obračunom) */
  sedanjaVrednost?: string;
  /** Izračunano: nabavnaVrednost × (100 − neamortizljiviDelPct) / 100 */
  amortizirljivaBaza?: string;
  /**
   * Sedanja vrednost PO vseh shranjenih obračunih (sorazmerna porazdelitev skupne amortizacije).
   * Prisotna samo na kartici (GET /osnovna-sredstva/:id).
   */
  sedanjaVrednostPoObracunu?: string;
}

/** Glava osnovnega sredstva + agregati iz doknjižb (za seznam). */
export interface OsnovnoSredstvo {
  id: string;
  companyId: string;
  inventarnaSt: string;
  naziv: string;
  skupinaId: string | null;
  costCenterId: string | null;
  accountId: string | null;
  kontoPopravkaId: string | null;
  kontoStroskaId: string | null;
  status: "v_teku" | "v_uporabi" | "odpisano" | "izloceno";
  opomba: string | null;
  /**
   * Datum prodaje / odtujitve celotnega sredstva (ISO "YYYY-MM-DD" ali null).
   * Ko nastavljeno, engine ne obračunava AM od prvega dne tega meseca naprej.
   */
  datumOdtujitve: string | null;
  /** Besedilni razlog izločitve (prodaja/odpis/uničenje/…), ali null. */
  razlogIzlocitve: string | null;
  createdAt: string;
  updatedAt: string;
  /** Seštevek nabavnih vrednosti vseh doknjižb (vrne GET seznam) */
  skupnaNabavna?: string;
  /** Seštevek odpisanih vrednosti vseh doknjižb */
  skupnaOdpisana?: string;
  /** skupnaNabavna − skupnaOdpisana */
  sedanjaVrednost?: string;
  /** Število DOGRADITEV (seq>0); osnovna vrstica seq=0 se ne šteje. 0 = brez dograditev. */
  steviloDoknjizb?: number;
  /** Zadnji obračun za to sredstvo v obliki "MM/YYYY", null če ni obračuna */
  obracunPeriod?: string | null;
}

/** Kartica: glava + vse doknjižbe + skupni seštevki. */
export interface OsnovnoSredstvoKartica extends OsnovnoSredstvo {
  doknjizbe: OsDoknjizba[];
  skupnaNabavna: string;
  skupnaOdpisana: string;
  /** skupnaNabavna − skupnaOdpisana (uvožena); = "pred obračunom" */
  sedanjaVrednost: string;
  /**
   * Alias za sedanjaVrednost — jasnejše ime za UI.
   * = nabavna − uvozena_odpisana; stanje KO UVOŽENO / PRED amortizacijo.
   */
  sedanjaVrednostPredObracunom: string;
  /**
   * Sedanja vrednost PO vseh shranjenih obračunih.
   * = sedanjaVrednostPredObracunom − skupnaAmortizacijaObracunana.
   * Enaka konNed v medletnem registru za zadnje obdobje.
   * Kadar ni obračuna: enaka sedanjaVrednostPredObracunom.
   */
  sedanjaVrednostPoObracunu: string;
  /** Σ obracunano iz os_amortizacija_obracun_sredstvo za VSA leta. "0.00" če ni obračunov. */
  skupnaAmortizacijaObracunana: string;
  /**
   * Število DOGRADITEV (seq>0); enako kot stolpec "#" v registru.
   * Osnova (seq=0) se ne šteje. 0 = brez dograditev.
   */
  steviloDoknjizb: number;
  /**
   * Zadnji obračun za to sredstvo v obliki "MM/YYYY".
   * MAX(leto*100+doMeseca) iz amortizacijske zgodovine. null = ni obračuna.
   * Enako kot stolpec "Obračun OS" v registru.
   */
  obracunPeriod: string | null;
  /** Amortizacijska zgodovina po letih. */
  amortizacijskaZgodovina: Array<{
    leto: number;
    doMeseca: number;
    obracunano: string;
    status: "odprt" | "zakljucen";
  }>;
  /** Kronološki pregled gibanja vrednosti (dogodki po datumu naraščajoče). */
  kronoloskiPregled: KronoloskiDogodek[];
}

/** En kronološki dogodek v pregledu gibanja vrednosti OS. */
export interface KronoloskiDogodek {
  /** ISO datum "YYYY-MM-DD" */
  datum: string;
  /** Opis: "Aktivacija / nabava", "Dograditev — naziv", "Letni obračun (N mes.)", … */
  opis: string;
  /** Sprememba nabavne vrednosti ("+NNN.NN" ali "0.00") */
  spremembaNv: string;
  /** Obračunana amortizacija tega obdobja */
  obracunanaAm: string;
  /** Kumulativni popravek vrednosti ob koncu tega dogodka */
  skupniPv: string;
  /** Neodpisana vrednost = tekoča NV − skupni PV */
  neodpisana: string;
}

// ─── Request body tipi ───────────────────────────────────────────────────────

export interface CreateSkupinaBody {
  koda: string;
  naziv: string;
  racunovodskaStonja: string;
  davcnaStonja?: string;
  aktivno?: boolean;
  opomba?: string | null;
}

export interface UpdateSkupinaBody {
  naziv?: string;
  racunovodskaStonja?: string;
  davcnaStonja?: string;
  aktivno?: boolean;
  opomba?: string | null;
}

/** Ustvari glavo + seq=0 doknjižbo (osnovni nakup). */
export interface CreateOsBody {
  // Glava
  inventarnaSt: string;
  naziv: string;
  skupinaId?: string | null;
  costCenterId?: string | null;
  accountId?: string | null;
  kontoPopravkaId?: string | null;
  kontoStroskaId?: string | null;
  status?: "v_teku" | "v_uporabi" | "odpisano" | "izloceno";
  opomba?: string | null;
  // seq=0 doknjižba (osnovni nakup)
  nabavnaVrednost: string;
  odpisanaVrednost?: string;
  neamortizljiviDelPct?: string;
  datumNabave: string;
  datumAktivacije?: string | null;
  datumIzpisa?: string | null;
  /** Dobavitelj — UUID iz counterparties (izbira, ne vnos). */
  partnerId?: string | null;
  /** Številka prejetega računa. */
  stRacuna?: string | null;
  /** Datum prejetega računa (YYYY-MM-DD). */
  datumRacuna?: string | null;
}

/** Uredi SAMO skupne atribute glave. */
export interface UpdateOsBody {
  /** Nova inventarna številka — mora biti enolična znotraj podjetja. */
  inventarnaSt?: string;
  naziv?: string;
  skupinaId?: string | null;
  costCenterId?: string | null;
  accountId?: string | null;
  kontoPopravkaId?: string | null;
  kontoStroskaId?: string | null;
  status?: "v_teku" | "v_uporabi" | "odpisano" | "izloceno";
  opomba?: string | null;
  /** Datum prodaje / odtujitve (YYYY-MM-DD) ali null za brisanje. */
  datumOdtujitve?: string | null;
  /** Razlog izločitve (prodaja/odpis/uničenje/…). */
  razlogIzlocitve?: string | null;
}

/** Dodaj dograditev (seq≥1). Skupino in konte podeduje iz glave. */
export interface CreateDoknjizbaBody {
  nazivVlaganja?: string | null;
  nabavnaVrednost: string;
  odpisanaVrednost?: string;
  neamortizljiviDelPct?: string;
  datumNabave: string;
  datumAktivacije?: string | null;
  datumIzpisa?: string | null;
  status?: "v_teku" | "v_uporabi" | "odpisano" | "izloceno";
  /** Dobavitelj — UUID iz counterparties (izbira, ne vnos). */
  partnerId?: string | null;
  /** Številka prejetega računa. */
  stRacuna?: string | null;
  /** Datum prejetega računa (YYYY-MM-DD). */
  datumRacuna?: string | null;
}

export interface UpdateDoknjizbaBody {
  nazivVlaganja?: string | null;
  nabavnaVrednost?: string;
  odpisanaVrednost?: string;
  neamortizljiviDelPct?: string;
  datumNabave?: string;
  datumAktivacije?: string | null;
  datumIzpisa?: string | null;
  status?: "v_teku" | "v_uporabi" | "odpisano" | "izloceno";
  /** Dobavitelj — UUID iz counterparties (izbira, ne vnos). */
  partnerId?: string | null;
  /** Številka prejetega računa. */
  stRacuna?: string | null;
  /** Datum prejetega računa (YYYY-MM-DD). */
  datumRacuna?: string | null;
}

// ─── Query keys ───────────────────────────────────────────────────────────────

export const osAmortizacijskeSkupineQueryKey = (
  companyId: string,
  opts?: { includeInactive?: boolean },
) => ["os-amortizacijske-skupine", companyId, opts] as const;

export const osnovnaSredstvaQueryKey = (
  companyId: string,
  filters?: Record<string, string | undefined>,
) => ["osnovna-sredstva", companyId, filters] as const;

export const osnovnoSredstvoKarticaQueryKey = (
  companyId: string,
  id: string,
) => ["osnovna-sredstva", companyId, id] as const;

export const osDoknjizbeQueryKey = (
  companyId: string,
  sredstvoId: string,
) => ["os-doknjizbe", companyId, sredstvoId] as const;

// ─── Amortizacijske skupine ────────────────────────────────────────────────

export function useListOsAmortizacijskeSkupine(
  companyId: string,
  opts?: { includeInactive?: boolean },
  queryOpts?: { query?: Partial<UseQueryOptions<{ amortizacijskeSkupine: OsAmortizacijskaSkupina[] }>> },
) {
  const qs = opts?.includeInactive ? "?includeInactive=true" : "";
  return useQuery({
    queryKey: osAmortizacijskeSkupineQueryKey(companyId, opts),
    queryFn: () =>
      customFetch<{ amortizacijskeSkupine: OsAmortizacijskaSkupina[] }>(
        `/api/companies/${companyId}/os-amortizacijske-skupine${qs}`,
      ),
    enabled: !!companyId,
    staleTime: 2 * 60 * 1000,
    ...queryOpts?.query,
  });
}

export function useCreateOsSkupina(
  companyId: string,
): UseMutationResult<OsAmortizacijskaSkupina, Error, CreateSkupinaBody> {
  return useMutation({
    mutationFn: (body: CreateSkupinaBody) =>
      customFetch<OsAmortizacijskaSkupina>(
        `/api/companies/${companyId}/os-amortizacijske-skupine`,
        { method: "POST", body: JSON.stringify(body) },
      ),
  });
}

export function useUpdateOsSkupina(
  companyId: string,
): UseMutationResult<OsAmortizacijskaSkupina, Error, { id: string; data: UpdateSkupinaBody }> {
  return useMutation({
    mutationFn: ({ id, data }) =>
      customFetch<OsAmortizacijskaSkupina>(
        `/api/companies/${companyId}/os-amortizacijske-skupine/${id}`,
        { method: "PATCH", body: JSON.stringify(data) },
      ),
  });
}

// ─── Register osnovnih sredstev ────────────────────────────────────────────

export interface ListOsFilters {
  skupinaId?: string;
  costCenterId?: string;
  accountId?: string;
  status?: "v_teku" | "v_uporabi" | "odpisano" | "izloceno";
  q?: string;
  includeIzloceno?: boolean;
}

export function useListOsnovnaSredstva(
  companyId: string,
  filters?: ListOsFilters,
  queryOpts?: { query?: Partial<UseQueryOptions<{ osnovnaSredstva: OsnovnoSredstvo[]; zadnjiObracun: string | null }>> },
) {
  const params = new URLSearchParams();
  if (filters?.skupinaId) params.set("skupinaId", filters.skupinaId);
  if (filters?.costCenterId) params.set("costCenterId", filters.costCenterId);
  if (filters?.accountId) params.set("accountId", filters.accountId);
  if (filters?.status) params.set("status", filters.status);
  if (filters?.q) params.set("q", filters.q);
  if (filters?.includeIzloceno) params.set("includeIzloceno", "true");
  const qs = params.toString() ? `?${params.toString()}` : "";

  return useQuery({
    queryKey: osnovnaSredstvaQueryKey(companyId, filters as Record<string, string | undefined>),
    queryFn: () =>
      customFetch<{ osnovnaSredstva: OsnovnoSredstvo[]; zadnjiObracun: string | null }>(
        `/api/companies/${companyId}/osnovna-sredstva${qs}`,
      ),
    enabled: !!companyId,
    staleTime: 60 * 1000,
    ...queryOpts?.query,
  });
}

export function useGetOsnovnoSredstvoKartica(
  companyId: string,
  id: string,
  queryOpts?: { query?: Partial<UseQueryOptions<OsnovnoSredstvoKartica>> },
) {
  return useQuery({
    queryKey: osnovnoSredstvoKarticaQueryKey(companyId, id),
    queryFn: () =>
      customFetch<OsnovnoSredstvoKartica>(
        `/api/companies/${companyId}/osnovna-sredstva/${id}`,
      ),
    enabled: !!companyId && !!id,
    staleTime: 60 * 1000,
    ...queryOpts?.query,
  });
}

export function useCreateOsnovnoSredstvo(
  companyId: string,
): UseMutationResult<OsnovnoSredstvo & { doknjizbe: OsDoknjizba[] }, Error, CreateOsBody> {
  return useMutation({
    mutationFn: (body: CreateOsBody) =>
      customFetch<OsnovnoSredstvo & { doknjizbe: OsDoknjizba[] }>(
        `/api/companies/${companyId}/osnovna-sredstva`,
        { method: "POST", body: JSON.stringify(body) },
      ),
  });
}

export function useUpdateOsnovnoSredstvo(
  companyId: string,
): UseMutationResult<OsnovnoSredstvo, Error, { id: string; data: UpdateOsBody }> {
  return useMutation({
    mutationFn: ({ id, data }) =>
      customFetch<OsnovnoSredstvo>(
        `/api/companies/${companyId}/osnovna-sredstva/${id}`,
        { method: "PATCH", body: JSON.stringify(data) },
      ),
  });
}

export function useIzlociOsnovnoSredstvo(
  companyId: string,
): UseMutationResult<OsnovnoSredstvo, Error, { id: string; datumIzpisa?: string }> {
  return useMutation({
    mutationFn: ({ id, datumIzpisa }) =>
      customFetch<OsnovnoSredstvo>(
        `/api/companies/${companyId}/osnovna-sredstva/${id}`,
        {
          method: "DELETE",
          body: datumIzpisa ? JSON.stringify({ datumIzpisa }) : undefined,
        },
      ),
  });
}

// ─── Doknjižbe (dograditve) ────────────────────────────────────────────────

export function useCreateOsDoknjizba(
  companyId: string,
): UseMutationResult<OsDoknjizba, Error, { sredstvoId: string; data: CreateDoknjizbaBody }> {
  return useMutation({
    mutationFn: ({ sredstvoId, data }) =>
      customFetch<OsDoknjizba>(
        `/api/companies/${companyId}/osnovna-sredstva/${sredstvoId}/doknjizbe`,
        { method: "POST", body: JSON.stringify(data) },
      ),
  });
}

export function useUpdateOsDoknjizba(
  companyId: string,
): UseMutationResult<OsDoknjizba, Error, { sredstvoId: string; doknjizbaId: string; data: UpdateDoknjizbaBody }> {
  return useMutation({
    mutationFn: ({ sredstvoId, doknjizbaId, data }) =>
      customFetch<OsDoknjizba>(
        `/api/companies/${companyId}/osnovna-sredstva/${sredstvoId}/doknjizbe/${doknjizbaId}`,
        { method: "PATCH", body: JSON.stringify(data) },
      ),
  });
}

export function useIzlociOsDoknjizba(
  companyId: string,
): UseMutationResult<OsDoknjizba, Error, { sredstvoId: string; doknjizbaId: string; datumIzpisa?: string }> {
  return useMutation({
    mutationFn: ({ sredstvoId, doknjizbaId, datumIzpisa }) =>
      customFetch<OsDoknjizba>(
        `/api/companies/${companyId}/osnovna-sredstva/${sredstvoId}/doknjizbe/${doknjizbaId}`,
        {
          method: "DELETE",
          body: datumIzpisa ? JSON.stringify({ datumIzpisa }) : undefined,
        },
      ),
  });
}
