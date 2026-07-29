import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";

export interface HappyHourStatus {
  aktiven: boolean;
  od: string;
  do: string;
  rocno: "auto" | "on" | "off";
}

interface HappyHourCtx {
  status: HappyHourStatus | null;
  loading: boolean;
  setRocno: (rocno: "auto" | "on" | "off") => Promise<void>;
  refresh: () => void;
}

const HappyHourContext = createContext<HappyHourCtx | null>(null);

const BASE = import.meta.env.BASE_URL as string;

export function HappyHourProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<HappyHourStatus | null>(null);
  const [loading, setLoading] = useState(false);

  const fetch_ = useCallback(async () => {
    try {
      const r = await fetch(`${BASE}api/happy-hour`, { credentials: "include" });
      if (r.ok) setStatus(await r.json());
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    void fetch_();
    const id = setInterval(fetch_, 30_000);
    return () => clearInterval(id);
  }, [fetch_]);

  const setRocno = useCallback(async (rocno: "auto" | "on" | "off") => {
    setLoading(true);
    try {
      const r = await fetch(`${BASE}api/happy-hour`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ rocno }),
      });
      if (r.ok) setStatus(await r.json());
    } catch { /* ignore */ } finally {
      setLoading(false);
    }
  }, []);

  return (
    <HappyHourContext.Provider value={{ status, loading, setRocno, refresh: fetch_ }}>
      {children}
    </HappyHourContext.Provider>
  );
}

export function useHappyHour() {
  const ctx = useContext(HappyHourContext);
  if (!ctx) throw new Error("useHappyHour must be used within HappyHourProvider");
  return ctx;
}
