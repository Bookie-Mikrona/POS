import { createContext, useContext, useState, type ReactNode } from "react";
import { useAuth } from "@/contexts/AuthContext";

const STORAGE_KEY = "pos_active_blagajna_id";

interface BlagajnaCtx {
  activeBlagajnaId: number | null;
  setActiveBlagajnaId: (id: number | null) => void;
}

const BlagajnaContext = createContext<BlagajnaCtx | null>(null);

export function BlagajnaProvider({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  const jeUporabnik = user?.vloga === "uporabnik";

  const [localBlagajnaId, setLocalBlagajnaIdState] = useState<number | null>(() => {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? parseInt(stored) : null;
  });

  const setActiveBlagajnaId = (id: number | null) => {
    if (jeUporabnik) return;
    setLocalBlagajnaIdState(id);
    if (id !== null) localStorage.setItem(STORAGE_KEY, String(id));
    else localStorage.removeItem(STORAGE_KEY);
  };

  const activeBlagajnaId = jeUporabnik ? (user?.blagajnaId ?? null) : localBlagajnaId;

  return (
    <BlagajnaContext.Provider value={{ activeBlagajnaId, setActiveBlagajnaId }}>
      {children}
    </BlagajnaContext.Provider>
  );
}

export function useBlagajna() {
  const ctx = useContext(BlagajnaContext);
  if (!ctx) throw new Error("useBlagajna must be used within BlagajnaProvider");
  return ctx;
}
