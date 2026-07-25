import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { getNapravaId } from "@/lib/naprava";

export function useRealtimeSync() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  useEffect(() => {
    if (!user || user.moraZamenjatiGeslo) return;

    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    const napravaId = getNapravaId();
    const enotaId = user.enotaId ?? "";
    const es = new EventSource(`${base}/api/events?napravaId=${encodeURIComponent(napravaId)}&enota_id=${encodeURIComponent(enotaId)}`);

    es.addEventListener("update", () => {
      void queryClient.invalidateQueries({ queryKey: ["/api/narocila"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/narocila/aktivna"] });
      void queryClient.invalidateQueries({ queryKey: ["/api/mize"] });
    });

    es.addEventListener("postavkaPripravljena", (e: MessageEvent) => {
      try {
        const data = JSON.parse(e.data) as {
          postavkaId: number;
          narociloId: number;
          ime: string;
          kolicina: number;
          opomba: string | null;
          mizaIme: string | null;
          mizaStevilka: number | null;
          vir: "kuhinja" | "tocilnica" | null;
        };
        window.dispatchEvent(new CustomEvent("gotov-toast", {
          detail: {
            id: `${data.postavkaId}-${Date.now()}`,
            ime: data.ime,
            kolicina: data.kolicina,
            opomba: data.opomba ?? null,
            mizaIme: data.mizaIme,
            mizaStevilka: data.mizaStevilka,
            vir: data.vir ?? null,
          },
        }));
      } catch { /* nop */ }
    });

    es.addEventListener("error", () => {
      es.close();
    });

    return () => {
      es.close();
    };
  }, [queryClient, user]);
}
