import { createContext, useContext, useState, useEffect, useCallback, useRef, type ReactNode } from "react";
import { useUser, useAuth as useClerkAuth, useClerk } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import { getGetNastavitveQueryKey, setAuthTokenGetter, setEnotaIdGetter, setOn401Handler, setPosActorSessionGetter } from "@workspace/api-client-react";
import { clearReturnUrl } from "@/lib/returnUrl";
import type { HospitalityProfile, PosPlan, UnitCapability } from "@/lib/unitProfiles";

export const POS_ENOTA_ID_KEY = "pos_enota_id";

export interface Uporabnik {
  id: number;
  username: string;
  ime: string;
  vloga: string;
  podjetjeDavcna: string;
  companyNaziv?: string | null;
  companyNaslov?: string | null;
  companyUlica?: string | null;
  companyPostna?: string | null;
  companyKraj?: string | null;
  moraZamenjatiGeslo?: boolean;
  email?: string | null;
  enotaId?: number;
  enotaIme?: string | null;
  blagajnaId?: number | null;
  blagajnaIme?: string | null;
  blagajnaPpId?: string | null;
  natakariId?: number | null;
  companyId?: string;
  enote?: Array<{ id: number; ime: string; hospitalityProfile: HospitalityProfile; capabilities: UnitCapability[] }>;
  hospitalityProfile?: HospitalityProfile | null;
  capabilities?: UnitCapability[];
  posPlan?: PosPlan;
  posPlanCapabilities?: UnitCapability[];
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
  enotaHospitalityProfile: HospitalityProfile | null;
  enotaCapabilities: UnitCapability[];
  posPlan: PosPlan | null;
  posPlanCapabilities: UnitCapability[];
  blagajnaId: number | null;
  blagajnaIme: string | null;
  blagajnaPpId: string | null;
  natakariId: number | null;
  enote: Array<{ id: number; ime: string; hospitalityProfile: HospitalityProfile; capabilities: UnitCapability[] }>;
  aktiven: boolean;
}

interface AuthCtx {
  user: Uporabnik | null;
  loading: boolean;
  authStatus: PosAuthStatus;
  login: (u: Uporabnik) => void;
  updateUser: (patch: Partial<Uporabnik>) => void;
  logout: () => Promise<void>;
}

export type PosAuthStatus = "loading" | "signed_out" | "ready" | "unauthorized" | "forbidden" | "error";

const AuthContext = createContext<AuthCtx | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const { user: clerkUser, isSignedIn, isLoaded: clerkLoaded } = useUser();
  const { getToken } = useClerkAuth();
  const { signOut } = useClerk();
  const [posUser, setPosUser] = useState<Uporabnik | null>(null);
  const [authStatus, setAuthStatus] = useState<PosAuthStatus>("loading");
  const queryClient = useQueryClient();
  const revalidatingUnauthorizedRef = useRef(false);
  const getTokenRef = useRef(getToken);
  getTokenRef.current = getToken;
  const clerkUserId = clerkUser?.id ?? null;
  const clerkEmail = clerkUser?.emailAddresses[0]?.emailAddress ?? "";

  // Nastavi Clerk token getter za vse API klice prek api-client-react.
  // Clerk sam osveži potekel žeton. Prisilni skipCache bi pred vsakim API
  // klicem izvedel dodatno omrežno zahtevo in občutno upočasnil celoten POS.
  useEffect(() => {
    setAuthTokenGetter(async (options) => {
      try { return await getToken(options?.skipCache ? { skipCache: true } : undefined); } catch { return null; }
    });
    setEnotaIdGetter(() => localStorage.getItem(POS_ENOTA_ID_KEY));
    setPosActorSessionGetter(() => sessionStorage.getItem("pos_actor_session"));
    return () => {
      setAuthTokenGetter(null);
      setEnotaIdGetter(null);
      setPosActorSessionGetter(null);
    };
  }, [getToken]);

  useEffect(() => {
    const confirmUnauthorized = async () => {
      if (revalidatingUnauthorizedRef.current || !isSignedIn) return;
      revalidatingUnauthorizedRef.current = true;
      try {
        const token = await getToken({ skipCache: true });
        if (!token) {
          queryClient.clear();
          setPosUser(null);
          setAuthStatus("unauthorized");
          return;
        }

        const response = await fetch("/api/pos/auth/me", {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });

        if (response.ok) {
          // Prvotni 401 je bil prehoden. Ohrani celotno drevo aplikacije in
          // samo ponovno naloži neuspele poizvedbe s svežim žetonom.
          await queryClient.invalidateQueries({ refetchType: "active" });
          return;
        }

        if (response.status === 401 || response.status === 403) {
          queryClient.clear();
          setPosUser(null);
          setAuthStatus(response.status === 403 ? "forbidden" : "unauthorized");
        }
        // Omrežne napake in 5xx ne pomenijo potrjene odjave. Obstoječa seja
        // in odprti obrazci ostanejo nedotaknjeni.
      } catch {
        // Prehodna napaka pri osvežitvi ne sme odmontirati POS aplikacije.
      } finally {
        revalidatingUnauthorizedRef.current = false;
      }
    };
    const handleUnauthorized = () => { void confirmUnauthorized(); };
    setOn401Handler(handleUnauthorized);
    window.addEventListener("auth:401", handleUnauthorized);
    return () => {
      setOn401Handler(null);
      window.removeEventListener("auth:401", handleUnauthorized);
    };
  }, [getToken, isSignedIn, queryClient]);

  // Po Clerk prijavi: pridobi POS vlogo
  // POMEMBNO: URL mora biti /api/pos/auth/me brez ${BASE_URL} prefiksa.
  // Replit proxy usmerja /pos/* na POS Vite strežnik — /api/* pa direktno na API strežnik.
  useEffect(() => {
    if (!clerkLoaded) return;
    if (!isSignedIn) {
      setPosUser(null);
      setAuthStatus("signed_out");
      return;
    }

    let active = true;
    setAuthStatus("loading");
    getTokenRef.current()
      .then(token => {
        if (!token) {
          if (active) setAuthStatus("unauthorized");
          return null;
        }
        return fetch(`/api/pos/auth/me`, {
          headers: { Authorization: `Bearer ${token}` },
          cache: "no-store",
        });
      })
      .then(r => {
        if (!r) return null;
        if (r.status === 401) {
          if (active) setAuthStatus("unauthorized");
          return null;
        }
        if (r.status === 403) {
          if (active) setAuthStatus("forbidden");
          return null;
        }
        if (!r.ok) {
          if (active) setAuthStatus("error");
          return null;
        }
        return r.json();
      })
      .then((data: PosAuthMeResponse | null) => {
        if (!active || !data) {
          if (active) setPosUser(null);
          return;
        }

        // POS in ERP si delita origin, zato lahko v localStorage ostane
        // X-Company-Id iz zadnje ERP seje. API klient ga samodejno pripne
        // vsakemu klicu; ob prijavi v POS ga moramo uskladiti s trenutno
        // razrešenim POS podjetjem, sicer middleware vrne 403.
        if (data.companyId) {
          localStorage.setItem("erp_active_company", data.companyId);
        } else {
          localStorage.removeItem("erp_active_company");
        }

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
          username: clerkEmail,
          ime: `${data.ime} ${data.priimek}`.trim(),
          vloga: data.vloga,
          podjetjeDavcna: data.podjetjeDavcna ?? "",
          companyNaziv: data.companyNaziv ?? null,
          companyNaslov: data.companyNaslov ?? null,
          companyUlica: (data as any).companyUlica ?? null,
          companyPostna: (data as any).companyPostna ?? null,
          companyKraj: (data as any).companyKraj ?? null,
          enotaId,
          enotaIme: data.enotaIme ?? null,
          blagajnaId: data.blagajnaId ?? null,
          blagajnaIme: data.blagajnaIme ?? null,
          blagajnaPpId: data.blagajnaPpId ?? null,
          natakariId: data.natakariId ?? null,
          companyId: data.companyId ?? undefined,
          enote: data.enote,
          hospitalityProfile: (
            data.enote.find(enota => enota.id === enotaId)?.hospitalityProfile
            ?? data.enotaHospitalityProfile
            ?? "restaurant"
          ),
          capabilities: (
            data.enote.find(enota => enota.id === enotaId)?.capabilities
            ?? data.enotaCapabilities
            ?? []
          ),
          posPlan: data.posPlan ?? undefined,
          posPlanCapabilities: data.posPlanCapabilities ?? [],
          idZaDdv: data.idZaDdv ?? null,
          jeDdvZavezanec: data.jeDdvZavezanec ?? false,
          imaTrr: data.imaTrr ?? false,
        });
        setAuthStatus("ready");
      })
      .catch(() => {
        if (!active) return;
        setPosUser(null);
        setAuthStatus("error");
      });
    return () => { active = false; };
  // Clerk lahko ob osvežitvi žetona vrne nov objekt user/getToken za istega
  // uporabnika. Celotni objekti zato ne smejo biti odvisnosti tega zagonskega
  // učinka, saj bi ponovni prehod v loading odmontiral odprte POS obrazce.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clerkLoaded, isSignedIn, clerkUserId, clerkEmail]);

  const login = useCallback((u: Uporabnik) => {
    queryClient.removeQueries({ queryKey: getGetNastavitveQueryKey() });
    setPosUser(u);
    setAuthStatus("ready");
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
    queryClient.removeQueries({ queryKey: getGetNastavitveQueryKey() });
    clearReturnUrl();
    localStorage.removeItem(POS_ENOTA_ID_KEY);
    await signOut({ redirectUrl: "/" });
    setPosUser(null);
    setAuthStatus("signed_out");
    // Po odjavi → glavna prijava aplikacije na korenu.
    window.location.href = "/";
  }, [queryClient, signOut]);

  return (
    <AuthContext.Provider value={{
      user: posUser,
      loading: !clerkLoaded || authStatus === "loading",
      authStatus,
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
