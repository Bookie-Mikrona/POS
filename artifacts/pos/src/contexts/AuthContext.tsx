import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetNastavitveQueryKey } from "@workspace/api-client-react";
import { clearNastavitveStorage } from "./NastavitveContext";
import { saveReturnUrl, clearReturnUrl } from "@/lib/returnUrl";

export interface Uporabnik {
  id: number;
  username: string;
  ime: string;
  vloga: string;
  podjetjeDavcna: string;
  moraZamenjatiGeslo?: boolean;
  email?: string | null;
  enotaId?: number;
  blagajnaId?: number | null;
}

interface AuthCtx {
  user: Uporabnik | null;
  loading: boolean;
  login: (u: Uporabnik) => void;
  updateUser: (patch: Partial<Uporabnik>) => void;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<Uporabnik | null>(null);
  const [loading, setLoading] = useState(true);
  const queryClient = useQueryClient();

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  useEffect(() => {
    fetch(`${base}/api/auth/me`, { credentials: "include" })
      .then(r => (r.ok ? r.json() : null))
      .then((data: Uporabnik | null) => setUser(data))
      .catch(() => setUser(null))
      .finally(() => setLoading(false));
  }, [base]);

  const login = useCallback((u: Uporabnik) => {
    clearNastavitveStorage();
    queryClient.removeQueries({ queryKey: getGetNastavitveQueryKey() });
    setUser(u);
  }, [queryClient]);
  const updateUser = useCallback((patch: Partial<Uporabnik>) => setUser(prev => prev ? { ...prev, ...patch } : prev), []);

  const clearNastavitveCache = useCallback(() => {
    clearNastavitveStorage();
    queryClient.removeQueries({ queryKey: getGetNastavitveQueryKey() });
  }, [queryClient]);

  const logout = useCallback(async () => {
    await fetch(`${base}/api/auth/logout`, { method: "POST", credentials: "include" });
    clearNastavitveCache();
    clearReturnUrl();
    setUser(null);
  }, [base, clearNastavitveCache]);

  useEffect(() => {
    const handler = () => {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const pathname = window.location.pathname;
      const routerPath = base && pathname.startsWith(base)
        ? pathname.slice(base.length) || "/"
        : pathname;
      if (routerPath !== "/login") {
        saveReturnUrl(routerPath);
      }
      clearNastavitveCache();
      setUser(null);
    };
    window.addEventListener("auth:401", handler);
    return () => window.removeEventListener("auth:401", handler);
  }, [clearNastavitveCache]);

  useEffect(() => {
    const handler = () => {
      setUser(prev => prev ? { ...prev, moraZamenjatiGeslo: true } : prev);
    };
    window.addEventListener("auth:403", handler);
    return () => window.removeEventListener("auth:403", handler);
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading, login, updateUser, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth mora biti znotraj AuthProvider");
  return ctx;
}
