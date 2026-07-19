/**
 * Kapsulira logiko kopiranja normativa iz enega artikla v drug artikel.
 *
 * Ločeno od komponente Menu za:
 *  - enostavno unit-testiranje brez potrebe po renderiranju celotne komponente
 *  - jasno ločitev odgovornosti: UI stanje dialoga ostane v Menu, logika fetchanja in validacije tukaj
 */

import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getArtikelNormativi, getGetArtikelNormativiQueryKey } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { preslikajNormativIzVira, jeNormativPrazen, type NormativItem } from "@/lib/kopiraj-normativ";

export type UseKopirajNormativResult = {
  handleCopyFromArtikel: (sourceId: number) => Promise<void>;
  copyPickerLoading: boolean;
  copyPickerOpen: boolean;
  copyPickerSearch: string;
  setCopyPickerOpen: (open: boolean) => void;
  setCopyPickerSearch: (search: string) => void;
};

export function useKopirajNormativ({
  setNormativItems,
  setNormativNapaka,
}: {
  setNormativItems: (items: NormativItem[]) => void;
  setNormativNapaka: (err: string | null) => void;
}): UseKopirajNormativResult {
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [copyPickerLoading, setCopyPickerLoading] = useState(false);
  const [copyPickerOpen, setCopyPickerOpen] = useState(false);
  const [copyPickerSearch, setCopyPickerSearch] = useState("");

  const handleCopyFromArtikel = async (sourceId: number) => {
    setCopyPickerLoading(true);
    try {
      const normativi = await queryClient.fetchQuery({
        queryKey: getGetArtikelNormativiQueryKey(sourceId),
        queryFn: () => getArtikelNormativi(sourceId),
      });
      if (jeNormativPrazen(normativi)) {
        toast({ title: "Ta artikel nima normativa", variant: "destructive" });
        return;
      }
      setNormativItems(preslikajNormativIzVira(normativi));
      setNormativNapaka(null);
      setCopyPickerOpen(false);
      setCopyPickerSearch("");
      toast({ title: "Normativ kopiran" });
    } catch {
      toast({ title: "Napaka pri pridobivanju normativa", variant: "destructive" });
    } finally {
      setCopyPickerLoading(false);
    }
  };

  return {
    handleCopyFromArtikel,
    copyPickerLoading,
    copyPickerOpen,
    copyPickerSearch,
    setCopyPickerOpen,
    setCopyPickerSearch,
  };
}
