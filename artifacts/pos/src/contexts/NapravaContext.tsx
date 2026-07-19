import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react";
import { getAuthToken, getEnotaId } from "@workspace/api-client-react";

export interface NapravaTerminalConfig {
  terminalAktiven?: boolean;
  terminalIp?: string;
  terminalPort?: number;
  terminalTimeoutMs?: number;
  paytenAndroidAktiven?: boolean;
  paytenAndroidPackageName?: string;
  sumupAktiven?: boolean;
  sumupTerminalSerial?: string;
  sumupApiKeyNastavljen?: boolean;
  vivaAktiven?: boolean;
  vivaClientId?: string;
  vivaClientSecretNastavljen?: boolean;
  vivaSourceCode?: string;
  vivaDemoNacin?: boolean;
  vivaTerminalAktiven?: boolean;
  vivaTerminalId?: string;
  vivaAndroidTerminalAktiven?: boolean;
  vivaAndroidSourceCode?: string;
  vivaTapToPayAktiven?: boolean;
  vivaTapToPaySourceCode?: string;
  agentTiskalnikIme?: string;
  tiskalnikSirina?: 58 | 80;
}

export interface NapravaData {
  id: number;
  podjetjeDavcna: string;
  enotaId: number;
  ime: string;
  napravaKljuc: string;
  placilniTerminal: string | null;
  dovoljeneMize?: number[] | null;
  glasovniPragZaupanja?: number | null;
  terminalConfig?: NapravaTerminalConfig | null;
  ustvarjeno: string;
  posodobljeno: string;
}

const DEVICE_KEY_STORAGE = "pos_naprava_kljuc";
const DEVICE_CACHE_KEY = "naprava_cache_v1";

function getOrCreateDeviceKey(): string {
  let key = localStorage.getItem(DEVICE_KEY_STORAGE);
  if (!key) {
    key = crypto.randomUUID();
    localStorage.setItem(DEVICE_KEY_STORAGE, key);
  }
  return key;
}

function defaultDeviceIme(): string {
  const ua = navigator.userAgent;
  if (/iPad/.test(ua)) return "iPad";
  if (/iPhone/.test(ua)) return "iPhone";
  if (/Android/.test(ua)) return "Android naprava";
  if (/Windows/.test(ua)) return "Windows naprava";
  if (/Macintosh|Mac OS X/.test(ua)) return "Mac naprava";
  if (/Linux/.test(ua)) return "Linux naprava";
  return "Naprava";
}

interface NapravaCtx {
  naprava: NapravaData | null;
  napravaKljuc: string;
  napravaLoading: boolean;
  refreshNaprava: () => Promise<void>;
  updateTerminalConfig: (patch: Partial<NapravaTerminalConfig>) => void;
}

const NapravaContext = createContext<NapravaCtx | null>(null);

export function NapravaProvider({ children }: { children: ReactNode }) {
  const [napravaKljuc] = useState(() => getOrCreateDeviceKey());
  const [naprava, setNaprava] = useState<NapravaData | null>(() => {
    try {
      const raw = localStorage.getItem(DEVICE_CACHE_KEY);
      return raw ? (JSON.parse(raw) as NapravaData) : null;
    } catch {
      return null;
    }
  });
  const [napravaLoading, setNapravaLoading] = useState(false);

  const registriraj = useCallback(async () => {
    setNapravaLoading(true);
    try {
      const base = (import.meta.env.BASE_URL as string).replace(/\/$/, "");
      const token = await getAuthToken();
      const enotaId = getEnotaId();
      if (!token || !enotaId) return; // čakamo na prijavo
      const res = await fetch(`${base}/api/naprave/registracija`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          "X-Enota-Id": enotaId,
        },
        body: JSON.stringify({ napravaKljuc, ime: defaultDeviceIme() }),
      });
      if (!res.ok) return;
      const data = (await res.json()) as NapravaData;
      setNaprava(data);
      try { localStorage.setItem(DEVICE_CACHE_KEY, JSON.stringify(data)); } catch { /* nič */ }
    } catch {
      // API nedostopen — nadaljujemo brez naprave
    } finally {
      setNapravaLoading(false);
    }
  }, [napravaKljuc]);

  const updateTerminalConfig = useCallback((patch: Partial<NapravaTerminalConfig>) => {
    setNaprava(prev => {
      if (!prev) return prev;
      const updated: NapravaData = {
        ...prev,
        terminalConfig: { ...(prev.terminalConfig ?? {}), ...patch },
      };
      try { localStorage.setItem(DEVICE_CACHE_KEY, JSON.stringify(updated)); } catch { /* nič */ }
      return updated;
    });
  }, []);

  useEffect(() => {
    registriraj();
  }, [registriraj]);

  return (
    <NapravaContext.Provider value={{ naprava, napravaKljuc, napravaLoading, refreshNaprava: registriraj, updateTerminalConfig }}>
      {children}
    </NapravaContext.Provider>
  );
}

export function useNaprava(): NapravaCtx {
  const ctx = useContext(NapravaContext);
  if (!ctx) throw new Error("useNaprava mora biti znotraj NapravaProvider");
  return ctx;
}
