import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "./AuthContext";

const clerkState = vi.hoisted(() => ({
  isSignedIn: true,
  isLoaded: true,
  user: { id: "clerk-1", emailAddresses: [{ emailAddress: "test@example.com" }] },
  getToken: vi.fn<() => Promise<string | null>>(),
  signOut: vi.fn(),
}));
const apiClientState = vi.hoisted(() => ({
  on401Handler: null as null | (() => void),
}));

vi.mock("@clerk/react", () => ({
  useUser: () => ({
    user: clerkState.user,
    isSignedIn: clerkState.isSignedIn,
    isLoaded: clerkState.isLoaded,
  }),
  useAuth: () => ({ getToken: clerkState.getToken }),
  useClerk: () => ({ signOut: clerkState.signOut }),
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetNastavitveQueryKey: () => ["nastavitve"],
  setAuthTokenGetter: vi.fn(),
  setEnotaIdGetter: vi.fn(),
  setOn401Handler: vi.fn((handler: null | (() => void)) => {
    apiClientState.on401Handler = handler;
  }),
  setPosActorSessionGetter: vi.fn(),
}));

function Probe() {
  const { authStatus, user } = useAuth();
  return <div data-testid="auth-state">{authStatus}:{user ? "user" : "none"}</div>;
}

function renderProvider() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <AuthProvider><Probe /></AuthProvider>
    </QueryClientProvider>,
  );
}

describe("POS AuthContext access status", () => {
  beforeEach(() => {
    clerkState.isSignedIn = true;
    clerkState.isLoaded = true;
    clerkState.getToken.mockReset().mockResolvedValue("test-token");
    clerkState.signOut.mockReset().mockResolvedValue(undefined);
    apiClientState.on401Handler = null;
    vi.stubGlobal("fetch", vi.fn());
    localStorage.clear();
    sessionStorage.clear();
  });

  it.each([
    [401, "unauthorized:none"],
    [403, "forbidden:none"],
    [500, "error:none"],
  ])("razloči odgovor %s od odjavljenega uporabnika", async (status, expected) => {
    vi.mocked(fetch).mockResolvedValue(new Response(null, { status }));
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("auth-state").textContent).toBe(expected));
  });

  it("ne kliče POS API-ja, ko Clerk uporabnik ni prijavljen", async () => {
    clerkState.isSignedIn = false;
    renderProvider();
    await waitFor(() => expect(screen.getByTestId("auth-state").textContent).toBe("signed_out:none"));
    expect(fetch).not.toHaveBeenCalled();
  });

  it("preveri POS vlogo s Clerk piškotkom tudi brez ročnega žetona", async () => {
    clerkState.getToken.mockResolvedValue(null);
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({
      id: 1, vloga: "admin", ime: "Test", priimek: "Uporabnik",
      companyId: "company-1", enotaId: null, enote: [],
      enotaCapabilities: [], posPlanCapabilities: [], aktiven: true,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("auth-state").textContent).toBe("ready:user"));
    expect(fetch).toHaveBeenCalledWith("/api/pos/auth/me", {
      credentials: "include",
      cache: "no-store",
    });
    expect(clerkState.getToken).not.toHaveBeenCalled();
  });

  it("ob prehodnem 401 potrdi sejo in ohrani prijavljenega uporabnika", async () => {
    const authMe = {
      id: 1,
      clerkUserId: "clerk-1",
      vloga: "uporabnik",
      ime: "Test",
      priimek: "Uporabnik",
      companyId: "company-1",
      companyNaziv: "Test",
      companyNaslov: null,
      podjetjeDavcna: "12345678",
      idZaDdv: null,
      jeDdvZavezanec: false,
      imaTrr: false,
      enotaId: 11677,
      enotaIme: "Enota",
      enotaHospitalityProfile: null,
      enotaCapabilities: [],
      blagajnaId: null,
      blagajnaIme: null,
      blagajnaPpId: null,
      natakariId: null,
      enote: [],
      aktiven: true,
    };
    vi.mocked(fetch).mockImplementation(async () =>
      new Response(JSON.stringify(authMe), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );

    renderProvider();
    await waitFor(() => expect(screen.getByTestId("auth-state").textContent).toBe("ready:user"));

    await act(async () => {
      apiClientState.on401Handler?.();
    });

    await waitFor(() => expect(vi.mocked(fetch).mock.calls.length).toBeGreaterThanOrEqual(2));
    expect(clerkState.getToken).toHaveBeenLastCalledWith({ skipCache: true });
    expect(screen.getByTestId("auth-state").textContent).toBe("ready:user");
  });
});