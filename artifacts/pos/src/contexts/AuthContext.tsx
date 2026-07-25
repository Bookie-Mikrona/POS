import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from "react";
import { useUser, useAuth as useClerkAuth, useClerk } from "@clerk/clerk-react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetNastavitveQueryKey, setAuthTokenGetter, setEnotaIdGetter } from "@workspace/api-client-react";
import { clearNastavitveStorage } from "./NastavitveContext";
import { clearReturnUrl } from "@/lib/returnUrl";

export const POS_ENOTA_ID_KEY = "pos_enota_id";

export interface Uporabnik {
  id: number;
  username: string;
  ime: string;
  vloga: string;
  podjetjeDavcna: string;
  companyNaziv?: string | null;
  companyNaslov?: string | null;
  moraZamenjatiGeslo?: boolean;
  email?: string | null;
  enotaId?: number;
  enotaIme?: string | null;
  blagajnaId?: number | null;
  blagajnaIme?: string | null;
  blagajnaPpId?: string | null;
  natakariId?: number | null;
  companyId?: string;
  enote?: Array<{ id: number; ime: string }>;
  idZaDdv?: string | null;
  jeDdvZavezanec?: boolean;
  imaTrr?: boolean;
}

interface PosAuthMeResponse {
  id: number;
  clerkUserId: string;
  vloga: string;
  ime: string;
  priimek: string;
  companyId: string | null;
  companyNaziv: string | null;
  companyNaslov: string | null;
  podjetjeDavcna: string;
  idZaDdv: string | null;
  jeDdvZavezanec: boolean;
  imaTrr: boolean;
  enotaId: number | null;
  enotaIme: string | null;
  blagajnaId: number | null;
  blagajnaIme: string | null;
  blagajnaPpId: string | null;
  natakariId: number | null;
  enote: Array<{ id: number; ime: string }>;
  aktiven: boolean;
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
  const { user: clerkUser, isSignedIn, isLoaded: clerkLoaded } = useUser();
  const { getToken } = useClerkAuth();
  const { signOut } = useClerk();
  const [posUser, setPosUser] = useState<Uporabnik | null>(null);
  const [posLoading, setPosLoading] = useState(true);
  const queryClient = useQueryClient();

  // Nastavi Clerk token getter za vse API klice prek api-client-react
  useEffect(() => {
    setAuthTokenGetter(async () => {
      try { return await getToken(); } catch { return null; }
    });
    setEnotaIdGetter(() => localStorage.getItem(POS_ENOTA_ID_KEY));
    return () => {
      setAuthTokenGetter(null);
      setEnotaIdGetter(null);
    };
  }, [getToken]);

  // Po Clerk prijavi: pridobi POS vlogo
  // POMEMBNO: URL mora biti /api/pos/auth/me brez ${BASE_URL} prefiksa.
  // Replit proxy usmerja /pos/* na POS Vite strežnik — /api/* pa direktno na API strežnik.
  useEffect(() => {
    if (!clerkLoaded) return;
    if (!isSignedIn) { setPosUser(null); setPosLoading(false); return; }

    setPosLoading(true);
    getToken()
      .then(token => {
        if (!token) return null;
        return fetch(`/api/pos/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
      })
      .then(r => (r && r.ok ? r.json() : null))
      .then((data: PosAuthMeResponse | null) => {
        if (!data) { setPosUser(null); return; }

        // Določi enotaId: za admin vzamemo shranjeno preferenco, drugače iz vloge
        let enotaId = data.enotaId ?? undefined;
        if (data.vloga === "admin") {
          const enoteIds = new Set((data.enote ?? []).map(e => e.id));
          const storedRaw = localStorage.getItem(POS_ENOTA_ID_KEY);
          const stored = storedRaw ? parseInt(storedRaw, 10) : NaN;

          if (!isNaN(stored) && enoteIds.has(stored)) {
            // Shranjena vrednost je veljavna enota tega podjetja
            enotaId = stored;
          } else {
            // Ni shranjene preference ali je zastarela (drugo podjetje) → vzamemo prvo
            localStorage.removeItem(POS_ENOTA_ID_KEY);
            if (data.enote?.[0]) {
              enotaId = data.enote[0].id;
              localStorage.setItem(POS_ENOTA_ID_KEY, String(enotaId));
            }
          }
        } else if (enotaId) {
          localStorage.setItem(POS_ENOTA_ID_KEY, String(enotaId));
        }

        // Počisti ERP-jev POS hint — smo v POS aplikaciji
        localStorage.removeItem("pos_user_hint");

        setPosUser({
          id: data.id,
          username: clerkUser?.emailAddresses[0]?.emailAddress ?? "",
          ime: `${data.ime} ${data.priimek}`.trim(),
          vloga: data.vloga,
          podjetjeDavcna: data.podjetjeDavcna ?? "",
          companyNaziv: data.companyNaziv ?? null,
          companyNaslov: data.companyNaslov ?? null,
          enotaId,
          enotaIme: data.enotaIme ?? null,
          blagajnaId: data.blagajnaId ?? null,
          blagajnaIme: data.blagajnaIme ?? null,
          blagajnaPpId: data.blagajnaPpId ?? null,
          natakariId: data.natakariId ?? null,
          companyId: data.companyId ?? undefined,
          enote: data.enote,
          idZaDdv: data.idZaDdv ?? null,
          jeDdvZavezanec: data.jeDdvZavezanec ?? false,
          imaTrr: data.imaTrr ?? false,
        });
      })
      .catch(() => setPosUser(null))
      .finally(() => setPosLoading(false));
  }, [clerkLoaded, isSignedIn, getToken, clerkUser]);

  const login = useCallback((u: Uporabnik) => {
    clearNastavitveStorage();
    queryClient.removeQueries({ queryKey: getGetNastavitveQueryKey() });
    setPosUser(u);
  }, [queryClient]);

  const updateUser = useCallback((patch: Partial<Uporabnik>) => {
    setPosUser(prev => {
      if (!prev) return prev;
      const updated = { ...prev, ...patch };
      if (patch.enotaId != null) localStorage.setItem(POS_ENOTA_ID_KEY, String(patch.enotaId));
      return updated;
    });
  }, []);

  const logout = useCallback(async () => {
    clearNastavitveStorage();
    queryClient.removeQueries({ queryKey: getGetNastavitveQueryKey() });
    clearReturnUrl();
    localStorage.removeItem(POS_ENOTA_ID_KEY);
    setPosUser(null);
    await signOut({ redirectUrl: "/pos/" });
  }, [queryClient, signOut]);

  return (
    <AuthContext.Provider value={{
      user: posUser,
      loading: !clerkLoaded || posLoading,
      login,
      updateUser,
      logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth mora biti znotraj AuthProvider");
  return ctx;
}
