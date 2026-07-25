import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { getNapravaId } from "@/lib/naprava";

export function useRealtimeSync() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  useEffect(() => {
    if (!user || user.moraZamenjatiGeslo) return;

    let es: EventSource | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | null = null;
    let destroyed = false;

    function connect() {
      if (destroyed) return;
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const napravaId = getNapravaId();
      const enotaId = user!.enotaId ?? "";
      es = new EventSource(
        `${base}/api/events?napravaId=${encodeURIComponent(napravaId)}&enota_id=${encodeURIComponent(enotaId)}`
      );

      es.addEventListener("update", (e: MessageEvent) => {
        try {
          const data = JSON.parse(e.data) as { type: string; id?: number };
          void queryClient.invalidateQueries({ queryKey: ["/api/narocila/aktivna"] });
          void queryClient.invalidateQueries({ queryKey: ["/api/mize"] });
          if (data.id) {
            void queryClient.invalidateQueries({ queryKey: [`/api/narocila/${data.id}`] });
          } else {
            // Pokrije vse odprte Order strani
            void queryClient.invalidateQueries({
              predicate: q => {
                const key = q.queryKey[0];
                return typeof key === "string" && /^\/api\/narocila\/\d+$/.test(key);
              },
            });
          }
        } catch { /* nop */ }
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
          if (data.narociloId) {
            void queryClient.invalidateQueries({ queryKey: [`/api/narocila/${data.narociloId}`] });
            void queryClient.invalidateQueries({ queryKey: ["/api/narocila/aktivna"] });
          }
        } catch { /* nop */ }
      });

      es.addEventListener("error", () => {
        es?.close();
        es = null;
        if (!destroyed) {
          retryTimer = setTimeout(connect, 5000);
        }
      });
    }

    connect();

    return () => {
      destroyed = true;
      if (retryTimer) clearTimeout(retryTimer);
      es?.close();
    };
  }, [queryClient, user]);
}
