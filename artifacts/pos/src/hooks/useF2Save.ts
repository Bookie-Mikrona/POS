import { useEffect } from "react";

/**
 * Registrira F2 bližnjico za shranjevanje.
 * @param handler  Funkcija, ki se pokliče ob pritisku F2
 * @param enabled  Ali je bližnjica aktivna (privzeto true); nastavi na false, ko je gumb Shrani onemogočen
 */
export function useF2Save(handler: () => void, enabled = true) {
  useEffect(() => {
    if (!enabled) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "F2") {
        e.preventDefault();
        handler();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [handler, enabled]);
}
