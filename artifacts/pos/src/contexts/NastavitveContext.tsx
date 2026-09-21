import { createContext, useContext, type ReactNode } from "react";
import { useGetNastavitve, getGetNastavitveQueryKey } from "@workspace/api-client-react";
import type { Nastavitve } from "@workspace/api-client-react";

interface NastavitveCtx {
  nastavitve: Nastavitve | undefined;
  nastavitveLoading: boolean;
}

const NastavitveContext = createContext<NastavitveCtx | null>(null);

export function NastavitveProvider({ children }: { children: ReactNode }) {
  const { data: nastavitve, isLoading: nastavitveLoading } = useGetNastavitve({
    query: {
      queryKey: getGetNastavitveQueryKey(),
      staleTime: 0,
      refetchOnMount: "always",
    },
  });

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
