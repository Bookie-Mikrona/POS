import { useQuery } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";

export interface PogostoOdgovor {
  artikelIds: number[];
  rocno: Array<{ artikelId: number; akcija: "pripni" | "skrij" }>;
}

export const POGOSTO_QUERY_KEY = ["artikli", "pogosto"] as const;

/** Seznam »Pogosto« (24 artiklov enote). Nalaga se samo, ko ga prikaz menija potrebuje. */
export function usePogosto(enabled: boolean) {
  return useQuery<PogostoOdgovor>({
    queryKey: POGOSTO_QUERY_KEY,
    enabled,
    staleTime: 60_000,
    queryFn: () => customFetch<PogostoOdgovor>("/api/artikli/pogosto", { responseType: "json" }),
  });
}
