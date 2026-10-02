import { createContext, useContext, useCallback, useEffect, useRef, useState } from "react";
import { createReadyNotificationSound } from "@/lib/readyNotificationSound";

export type GotovToastItem = {
  id: string;
  ime: string;
  kolicina: number;
  opomba: string | null;
  mizaIme: string | null;
  mizaStevilka: number | null;
  prostorIme: string | null;
  vir: "kuhinja" | "tocilnica" | null;
  phase: "active" | "minimized" | "dismissed";
  arrivedAt: number;
};

type GotovToastCtx = {
  toasts: GotovToastItem[];
  dismissToast: (id: string) => void;
  minimizeToast: (id: string) => void;
  reopenToast: (id: string) => void;
};

const Ctx = createContext<GotovToastCtx>({
  toasts: [],
  dismissToast: () => {},
  minimizeToast: () => {},
  reopenToast: () => {},
});

export function GotovToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<GotovToastItem[]>([]);
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  const clearTimer = (id: string) => {
    const t = timersRef.current.get(id);
    if (t) { clearTimeout(t); timersRef.current.delete(id); }
  };

  const scheduleMinimize = useCallback((id: string) => {
    clearTimer(id);
    const t = setTimeout(() => {
      setToasts(prev => prev.map(t => t.id === id && t.phase === "active" ? { ...t, phase: "minimized" } : t));
      timersRef.current.delete(id);
    }, 8000);
    timersRef.current.set(id, t);
  }, []);

  const addToast = useCallback((data: Omit<GotovToastItem, "phase" | "arrivedAt">) => {
    const item: GotovToastItem = { ...data, phase: "active", arrivedAt: Date.now() };
    setToasts(prev => [...prev.filter(t => t.phase !== "dismissed"), item]);
    scheduleMinimize(item.id);
  }, [scheduleMinimize]);

  const dismissToast = useCallback((id: string) => {
    clearTimer(id);
    setToasts(prev => prev.map(t => t.id === id ? { ...t, phase: "dismissed" } : t));
  }, []);

  const minimizeToast = useCallback((id: string) => {
    clearTimer(id);
    setToasts(prev => prev.map(t => t.id === id ? { ...t, phase: "minimized" } : t));
  }, []);

  const reopenToast = useCallback((id: string) => {
    setToasts(prev => prev.map(t => t.id === id ? { ...t, phase: "active" } : t));
    scheduleMinimize(id);
  }, [scheduleMinimize]);

  useEffect(() => {
    const sound = createReadyNotificationSound();
    const unlockSound = () => { void sound.unlock(); };
    function onEvent(e: Event) {
      const detail = (e as CustomEvent<Omit<GotovToastItem, "phase" | "arrivedAt">>).detail;
      addToast(detail);
      void sound.play();
    }
    window.addEventListener("pointerdown", unlockSound, true);
    window.addEventListener("keydown", unlockSound, true);
    window.addEventListener("gotov-toast", onEvent);
    return () => {
      window.removeEventListener("pointerdown", unlockSound, true);
      window.removeEventListener("keydown", unlockSound, true);
      window.removeEventListener("gotov-toast", onEvent);
      sound.dispose();
      for (const timer of timersRef.current.values()) clearTimeout(timer);
      timersRef.current.clear();
    };
  }, [addToast]);

  return (
    <Ctx.Provider value={{ toasts, dismissToast, minimizeToast, reopenToast }}>
      {children}
    </Ctx.Provider>
  );
}

export function useGotovToast() {
  return useContext(Ctx);
}
