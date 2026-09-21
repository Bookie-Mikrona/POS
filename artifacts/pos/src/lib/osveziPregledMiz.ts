import type { QueryClient } from "@tanstack/react-query";
import { getListAktivnaNarocilaQueryKey, getListMizeQueryKey } from "@workspace/api-client-react";

/**
 * Po kreiranju telefonskega naročila zadržimo navigacijo, dokler ni domači
 * pregled osvežen. S tem se ob vrnitvi na pregled ne prikaže stari cache.
 */
export async function osveziPregledMizPoTelefonu(
  queryClient: Pick<QueryClient, "invalidateQueries">,
): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: getListAktivnaNarocilaQueryKey(),
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: getListMizeQueryKey(),
      refetchType: "active",
    }),
  ]);
}