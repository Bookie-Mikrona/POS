import { createContext, useContext, useEffect, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { useGetNastavitve, getGetNastavitveQueryKey } from "@workspace/api-client-react";
import type { Nastavitve } from "@workspace/api-client-react";

const STORAGE_KEY = "nastavitve_v2";
const TTL_MS = 5 * 60 * 1000; // 5 minut

interface StoredEntry {
  data: Nastavitve;
  ts: number;
}

function readFromStorage(): StoredEntry | undefined {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return undefined;
    return JSON.parse(raw) as StoredEntry;
  } catch {
    return undefined;
  }
}

function writeToStorage(n: Nastavitve) {
  try {
    const entry: StoredEntry = { data: n, ts: Date.now() };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(entry));
  } catch {
    // localStorage nedostopen — molče nadaljujemo
  }
}

export function clearNastavitveStorage() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // nič
  }
}

interface NastavitveCtx {
  nastavitve: Nastavitve | undefined;
  nastavitveLoading: boolean;
}

const NastavitveContext = createContext<NastavitveCtx | null>(null);

export function NastavitveProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();

  // Ob montaži: če je localStorage svež, pred-napolnimo cache prek setQueryData.
  // Na ta način removeQueries ob prijavi drugega uporabnika dejansko pobriše
  // cache in React Query fetcha svežo vrednost — brez initialData fallbacka.
  useEffect(() => {
    const existing = queryClient.getQueryData(getGetNastavitveQueryKey());
    if (existing) return; // cache že ima podatke, ne prepisujemo
    const stored = readFromStorage();
    if (!stored) return;
    const age = Date.now() - stored.ts;
    if (age < TTL_MS) {
      queryClient.setQueryData(getGetNastavitveQueryKey(), stored.data);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // samo enkrat ob montaži

  const { data: nastavitve, isLoading: nastavitveLoading } = useGetNastavitve({
    query: {
      queryKey: getGetNastavitveQueryKey(),
      staleTime: TTL_MS,
    },
  });

  // Ob pridobitvi svežih podatkov posodobimo localStorage
  useEffect(() => {
    if (nastavitve) {
      writeToStorage(nastavitve);
    }
  }, [nastavitve]);

  // Poslušamo storage event iz drugih zavihkov in takoj posodobimo cache
  useEffect(() => {
    function onStorage(e: StorageEvent) {
      if (e.key !== STORAGE_KEY || e.newValue === null) return;
      try {
        const entry = JSON.parse(e.newValue) as StoredEntry;
        queryClient.setQueryData(getGetNastavitveQueryKey(), entry.data);
      } catch {
        // Napačen format — ignoriramo
      }
    }
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, [queryClient]);

  return (
    <NastavitveContext.Provider value={{ nastavitve, nastavitveLoading }}>
      {children}
    </NastavitveContext.Provider>
  );
}

export function useNastavitve() {
  const ctx = useContext(NastavitveContext);
  if (!ctx) throw new Error("useNastavitve mora biti znotraj NastavitveProvider");
  return ctx;
}
