import { useState, useEffect, useCallback } from "react";
import {
  useListGlasovniSinonimi,
  useCreateGlasovniSinonim,
  useDeleteGlasovniSinonim,
} from "@workspace/api-client-react";

export interface GlasovniSinonim {
  id: number;
  beseda: string;
  alias: string;
}

/**
 * Hrani seznam sinonimov za glasovne ukaze v bazi (skupno za vse naprave podjetja).
 */
export function useGlasovniSinonimi() {
  const { data, refetch } = useListGlasovniSinonimi();
  const createMutation = useCreateGlasovniSinonim();
  const deleteMutation = useDeleteGlasovniSinonim();

  const sinonimi: GlasovniSinonim[] = (data ?? []).map(s => ({
    id: s.id,
    beseda: s.beseda,
    alias: s.alias,
  }));

  const dodaj = useCallback(
    async (beseda: string, alias: string) => {
      await createMutation.mutateAsync({
        data: { beseda: beseda.trim().toLowerCase(), alias: alias.trim().toLowerCase() },
      });
      refetch();
    },
    [createMutation, refetch]
  );

  const odstrani = useCallback(
    async (indeks: number) => {
      const sinonim = sinonimi[indeks];
      if (!sinonim) return;
      await deleteMutation.mutateAsync({ id: sinonim.id });
      refetch();
    },
    [deleteMutation, refetch, sinonimi]
  );

  return { sinonimi, dodaj, odstrani };
}
