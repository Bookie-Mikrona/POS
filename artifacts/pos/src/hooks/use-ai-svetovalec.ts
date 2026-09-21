import { useState, useCallback, useRef, useEffect } from "react";
import { getAuthToken, getEnotaId } from "@workspace/api-client-react";
import { useNaprava } from "@/contexts/NapravaContext";

export interface AiNarociloPostavka {
  naziv: string;
  kolicina: number;
  skupaj: number;
  opomba?: string | null;
}

export interface AiNarociloPayload {
  id: number;
  nacin?: string;
  status: string;
  miza?: number | null;
  strankaIme?: string | null;
  telefon?: string | null;
  naslovDostave?: string | null;
  skupaj: number;
  postavke: AiNarociloPostavka[];
}

export interface AiSvetovalecResponse {
  povzetek: string;
  nasveti: string[];
  kriticneNapake: string[];
  blokirano: boolean;
}

export function zahtevajAiDeviceToken(aktiven: boolean, token?: string): string | null {
  if (!aktiven) return null;
  if (!token) throw new Error("Naprava še nima varne AI identitete. Osvežite napravo ali stran.");
  return token;
}

export function useAiSvetovalec(faza: "narocilo" | "blagajna", getNarociloPayload: () => AiNarociloPayload | null) {
  const { naprava, napravaKljuc } = useNaprava();
  const aktiven = naprava?.terminalConfig?.aiSvetovalecAktiven === true;

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState<AiSvetovalecResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  const previousPayloadStr = useRef<string>("");
  const previousOrderId = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastAutomaticCheckAt = useRef(0);

  const performCheck = useCallback(async (
    vprasanje?: string,
    payloadOverride?: AiNarociloPayload,
    force = false,
  ): Promise<AiSvetovalecResponse | null> => {
    if (!aktiven || !naprava?.aiAccessToken) return null;

    const payload = payloadOverride ?? getNarociloPayload();
    if (!payload || payload.postavke.length === 0) {
      setData(null);
      previousPayloadStr.current = "";
      previousOrderId.current = null;
      return null;
    }

    if (previousOrderId.current !== null && previousOrderId.current !== payload.id && !vprasanje) {
      setData(null);
      setError(null);
    }

    const payloadStr = JSON.stringify(payload);
    // If not a manual question, avoid redundant checks
    if (!force && !vprasanje && payloadStr === previousPayloadStr.current && data) {
      return data;
    }

    setLoading(true);
    setError(null);

    try {
      const token = await getAuthToken();
      const enotaId = getEnotaId();
      
      if (!token) throw new Error("Ni prijavljen");

      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/ai/svetovalec`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Authorization": `Bearer ${token}`,
          ...(enotaId ? { "X-Enota-Id": enotaId } : {}),
          "X-Naprava-Id": napravaKljuc,
          "X-AI-Device-Token": naprava.aiAccessToken,
        },
        body: JSON.stringify({
          faza,
          vprasanje,
          narocilo: payload
        })
      });

      if (res.status === 403) {
        throw new Error("Svetovalec je izklopljen na napravi.");
      }

      if (!res.ok) {
        throw new Error("Napaka pri komunikaciji z AI svetovalcem.");
      }

      const responseData = await res.json() as AiSvetovalecResponse;
      setData(responseData);
      previousPayloadStr.current = payloadStr;
      previousOrderId.current = payload.id;
      if (!vprasanje && !force) lastAutomaticCheckAt.current = Date.now();
      return responseData;
    } catch (err: any) {
      setError(err.message || "Prišlo je do napake.");
      return null;
    } finally {
      setLoading(false);
    }
  }, [aktiven, faza, getNarociloPayload, napravaKljuc, naprava?.aiAccessToken, data]);

  const preveriPredIzdajo = useCallback(async (narociloId: number): Promise<{
    kriticneNapake: string[];
    blokirano: boolean;
  } | null> => {
    const aiDeviceToken = zahtevajAiDeviceToken(aktiven, naprava?.aiAccessToken);
    if (!aiDeviceToken) return null;
    const token = await getAuthToken();
    const enotaId = getEnotaId();
    if (!token || !enotaId) throw new Error("Naprave ni mogoče varno preveriti.");
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const res = await fetch(`${base}/api/ai/svetovalec/preveri`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${token}`,
        "X-Enota-Id": enotaId,
        "X-Naprava-Id": napravaKljuc,
        "X-AI-Device-Token": aiDeviceToken,
      },
      body: JSON.stringify({ narociloId }),
    });
    if (!res.ok) throw new Error("Kritičnih kontrol ni mogoče izvesti.");
    const rezultat = await res.json() as { kriticneNapake: string[]; blokirano: boolean };
    setData((prejsnji) => ({
      povzetek: prejsnji?.povzetek ?? "Kritične kontrole so izvedene.",
      nasveti: prejsnji?.nasveti ?? [],
      ...rezultat,
    }));
    return rezultat;
  }, [aktiven, naprava?.aiAccessToken, napravaKljuc]);

  // Debounced auto-check
  useEffect(() => {
    if (!aktiven) return;

    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }

    timerRef.current = setTimeout(() => {
      const currentPayload = getNarociloPayload();
      const dovoljCasa = Date.now() - lastAutomaticCheckAt.current >= 8_000;
      if (currentPayload && dovoljCasa && JSON.stringify(currentPayload) !== previousPayloadStr.current) {
        performCheck(undefined, currentPayload);
      }
    }, 2500);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [aktiven, getNarociloPayload, performCheck]);

  const clear = useCallback(() => {
    setData(null);
    setError(null);
    previousPayloadStr.current = "";
    previousOrderId.current = null;
  }, []);

  return {
    aktiven,
    loading,
    data,
    error,
    performCheck,
    preveriPredIzdajo,
    clear
  };
}