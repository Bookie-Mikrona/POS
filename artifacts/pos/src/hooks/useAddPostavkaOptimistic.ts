/**
 * useAddPostavkaOptimistic — optimistična posodobitev pri dodajanju artiklov.
 *
 * Za NAVADNE artikle (brez modifikatorjev, brez parentPostavkaId):
 *   - onMutate: artikel takoj vstavi v lokalni cache (temp id < 0), skupaj preračuna lokalno
 *   - onError: rollback na snapshot; strežnik ostane vir resnice za zneske
 *   - onSuccess/onSettled: per-call callback v Order.tsx nastavi strežniški odgovor
 *
 * Za MODIFIKATORJE, To-Go children, uvoz: brez optimistične posodobitve
 * (onMutate vrne { snapshot: undefined }); obstoječe vedenje ostane nespremenjeno.
 *
 * Odločitev o modifikatorjih: modifikatorji ustvarjajo parent+children v eni
 * transakciji, lokalni preračun bi prikazal samo parent brez otrok — to bi zbegalo
 * natakarje. Ker dialog že vizualno blokira čakanje, je izkušnja sprejemljiva brez
 * optimistične posodobitve.
 */

import React from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAddPostavka, getGetNarociloQueryKey } from "@workspace/api-client-react";

/** Minimalni podatki o artiklu, ki jih potrebujemo za gradnjo temp postavke */
export interface ArtikelZaOptimistiko {
  id: number;
  ime: string;
  cena: number;
  cenaMala?: number | null;
  cenaDruzinska?: number | null;
  happyHourCena?: number | null;
  happyHourCenaMala?: number | null;
  happyHourCenaDruzinska?: number | null;
  happyHourAktiven?: boolean;
  happyHourVelikostiPice?: ("mala" | "normalna" | "druzinska")[];
  davek: number;
  jePica?: boolean;
  kdsIzkljucen?: boolean;
  kategorijaId?: number | null;
  kategorijaIme?: string | null;
}

/** Tip podatkov naročila v React Query cache-u (skeletal) */
type NarociloCache = {
  skupaj: number;
  postavke?: TempPostavka[];
  [key: string]: unknown;
};

type TempPostavka = {
  id: number;
  artikelId: number | null;
  ime: string;
  kolicina: number;
  cenaKos: number;
  cenaKosOriginalna: number | null;
  skupaj: number;
  davek: number;
  opomba: string | null;
  kategorijaId: number | null;
  kategorijaIme: string | null;
  jePica: boolean;
  racunId: number | null;
  racunStevilka: string | null;
  gostStevilka: number | null;
  parentPostavkaId: number | null;
  modifikatorId: number | null;
  toGo: boolean;
  ustvarjeno: string;
  pripravljeno: string | null;
};

type MutationContext = { snapshot: NarociloCache | undefined };

/**
 * Optimistične postavke obstajajo samo v React Query cache-u, zato jih API ne
 * more urejati ali brisati. Pravi ID dobijo šele z uspešnim odgovorom strežnika.
 */
export function isTemporaryPostavkaId(postavkaId: number): boolean {
  return postavkaId < 0;
}

/**
 * @param artikliMapRef - React ref na najnovejši Map<artikelId, ArtikelZaOptimistiko>.
 *   V Order.tsx je ref sinhroniziran z artikliMapForOrder na vsakem renderu.
 */
export function useAddPostavkaOptimistic(
  artikliMapRef: React.RefObject<Map<number, ArtikelZaOptimistiko>>,
) {
  const queryClient = useQueryClient();

  return useAddPostavka<unknown, MutationContext>({
    mutation: {
      onMutate: async (variables): Promise<MutationContext> => {
        const { id, data } = variables;

        // --- skip za kompleksne primere ---
        const dataAny = data as unknown as Record<string, unknown>;
        const hasModifikatorji =
          Array.isArray(dataAny.izbranModifikatorji) &&
          (dataAny.izbranModifikatorji as unknown[]).length > 0;
        const hasParent = dataAny.parentPostavkaId != null;

        if (hasModifikatorji || hasParent) {
          return { snapshot: undefined };
        }

        const queryKey = getGetNarociloQueryKey(id);

        // Prekliči morebitne in-flight refetche, ki bi povozili optimistične vrednosti
        await queryClient.cancelQueries({ queryKey });

        // Snapshot za rollback
        const snapshot = queryClient.getQueryData<NarociloCache>(queryKey);

        const artikel = artikliMapRef.current?.get(data.artikelId);
        if (!artikel) return { snapshot };

        const velikostPice = dataAny.velikostPice as "mala" | "normalna" | "druzinska" | undefined;
        const rednaCenaVelikosti = velikostPice === "mala"
          ? artikel.cenaMala
          : velikostPice === "druzinska"
            ? artikel.cenaDruzinska
            : artikel.cena;
        const happyHourCenaVelikosti = velikostPice === "mala"
          ? artikel.happyHourCenaMala
          : velikostPice === "druzinska"
            ? artikel.happyHourCenaDruzinska
            : artikel.happyHourCena;
        // Stari artikli nimajo dodatnih cen; do njihovega naslednjega urejanja
        // morajo v POS ostati prikazani po osnovni ceni.
        const rednaCena = Number(rednaCenaVelikosti ?? artikel.cena);
        const velikostJeVHappyHour = !artikel.jePica
          || (velikostPice != null && artikel.happyHourVelikostiPice?.includes(velikostPice));
        const uporabiHappyHour = artikel.happyHourAktiven && velikostJeVHappyHour && happyHourCenaVelikosti != null;
        const cenaKos = uporabiHappyHour ? Number(happyHourCenaVelikosti) : rednaCena;
        const kolicina = data.kolicina ?? 1;
        const skupajPostavke = cenaKos * kolicina;

        const tempPostavka: TempPostavka = {
          id: -(Date.now()), // negativni temp ID — nikoli kolizija z DB ID-ji (serial > 0)
          artikelId: data.artikelId,
          ime: artikel.ime,
          kolicina,
          cenaKos,
          cenaKosOriginalna: uporabiHappyHour ? rednaCena : null,
          skupaj: skupajPostavke,
          davek: Number(artikel.davek),
          opomba: data.opomba ?? null,
          kategorijaId: artikel.kategorijaId ?? null,
          kategorijaIme: artikel.kategorijaIme ?? null,
          jePica: artikel.jePica ?? false,
          racunId: null,
          racunStevilka: null,
          gostStevilka: (dataAny.gostStevilka as number | null | undefined) ?? null,
          parentPostavkaId: null,
          modifikatorId: null,
          toGo: false,
          ustvarjeno: new Date().toISOString(),
          pripravljeno: null,
        };

        // Vstavi temp postavko na vrh seznama, skupaj preračunaj lokalno
        queryClient.setQueryData<NarociloCache>(queryKey, (old) => {
          if (!old) return old;
          return {
            ...old,
            skupaj: Number(old.skupaj ?? 0) + skupajPostavke,
            postavke: [tempPostavka, ...(old.postavke ?? [])],
          };
        });

        return { snapshot };
      },

      onError: (_err, variables, context) => {
        // Rollback: povrni snapshot samo za navadne artikle (modifikatorji/parent: snapshot === undefined)
        if (context?.snapshot !== undefined) {
          queryClient.setQueryData<NarociloCache>(
            getGetNarociloQueryKey(variables.id),
            context.snapshot,
          );
        }
      },
      // Strežniški odgovor se zapiše na ravni mutacije, da zaslon ne ostane star, če povratni klic mutate() odpade.
      onSuccess: (updated, variables) => {
        queryClient.setQueryData(getGetNarociloQueryKey(variables.id), updated);
      },
      onSettled: (_data, _error, variables) => {
        void queryClient.invalidateQueries({ queryKey: getGetNarociloQueryKey(variables.id) });
      },
      // onSuccess in onSettled: per-call callbacki v Order.tsx nastavijo strežniški odgovor
      // in invalidirajo aktivna naročila — tukaj ni treba ničesar dodati.
    },
  });
}
