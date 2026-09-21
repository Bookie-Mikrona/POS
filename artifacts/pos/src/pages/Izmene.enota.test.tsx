import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import IzmenePage from "./Izmene";

const state = vi.hoisted(() => ({
  user: {
    id: 1,
    username: "uporabnik",
    ime: "Uporabnik",
    vloga: "uporabnik",
    podjetjeDavcna: "12345678",
    companyId: "company-1",
    enotaId: 7 as number | undefined,
    enotaIme: null as string | null,
    natakariId: 1 as number | null,
    enote: [] as Array<{ id: number; ime: string }>,
  },
  enote: [] as Array<{
    id: number;
    ime: string;
    costCenterId?: string | null;
  }>,
  costCenters: [] as Array<{ id: string; code: string; name: string }>,
  aktivneIzmene: [] as Array<Record<string, unknown>>,
}));

const mockOpenMutate = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => ({
  useListIzmene: () => ({ data: [], isLoading: false }),
  useListAktivneIzmene: () => ({ data: state.aktivneIzmene, isLoading: false }),
  useListNatakari: () => ({
    data: [{ id: 1, ime: "Ana", priimek: "Novak", aktiven: true }],
  }),
  useListEnote: () => ({ data: state.enote, isLoading: false }),
  useListCostCenters: () => ({
    data: { costCenters: state.costCenters },
    isLoading: false,
  }),
  useOpenIzmena: () => ({ mutate: mockOpenMutate, isPending: false }),
  useZapriIzmeno: () => ({ mutate: vi.fn(), isPending: false }),
  usePredloziIzmeno: () => ({ mutate: vi.fn(), isPending: false }),
  useListOdmori: () => ({ data: [], isLoading: false }),
  useCreateOdmor: () => ({ mutate: vi.fn(), isPending: false }),
  useZapriOdmor: () => ({ mutate: vi.fn(), isPending: false }),
  getListIzmeneQueryKey: () => ["/api/izmene"],
  getListAktivneIzmeneQueryKey: () => ["/api/izmene/aktivne"],
  getListOdmoriQueryKey: (id: number) => [`/api/izmene/${id}/odmori`],
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: state.user,
    loading: false,
    login: vi.fn(),
    updateUser: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  return render(
    <QueryClientProvider client={queryClient}>
      <IzmenePage />
    </QueryClientProvider>,
  );
}

function setUnitData() {
  state.user.enotaId = 7;
  state.user.enotaIme = null;
  state.enote = [{ id: 7, ime: "Terasa", costCenterId: "cc-1" }];
  state.costCenters = [{ id: "cc-1", code: "4.101", name: "Terasa gostinstvo" }];
}

describe("Izmene — kontekst enote in stroškovnega mesta", () => {
  beforeEach(() => {
    state.user.vloga = "uporabnik";
    state.user.natakariId = 1;
    state.user.enotaId = 7;
    state.user.enotaIme = null;
    state.enote = [];
    state.costCenters = [];
    state.aktivneIzmene = [];
    mockOpenMutate.mockReset();
  });

  it("uporabniški pogled razreši naziv enote in za odprtje zahteva PIN", () => {
    setUnitData();

    renderPage();

    expect(screen.getByTestId("izmena-enota-ime")).toHaveTextContent("Terasa");
    expect(screen.getByTestId("izmena-stroskovno-mesto")).toHaveTextContent(
      "4.101 — Terasa gostinstvo",
    );
    expect(screen.getByRole("button", { name: "Odpri izmeno" })).toBeDisabled();
    fireEvent.change(screen.getByLabelText("PIN za odprtje izmene"), {
      target: { value: "1234" },
    });
    expect(screen.getByRole("button", { name: "Odpri izmeno" })).toBeEnabled();
  });

  it("odprtje lastne izmene takoj shrani vrnjeno actor sejo", async () => {
    setUnitData();
    mockOpenMutate.mockImplementation((_input, options) => {
      options.onSuccess({
        id: 91,
        natakariId: 1,
        actorSession: { token: "shift-actor-token", natakarId: 1 },
      });
    });

    renderPage();
    fireEvent.change(screen.getByLabelText("PIN za odprtje izmene"), {
      target: { value: "1234" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Odpri izmeno" }));

    await waitFor(() => {
      expect(sessionStorage.getItem("pos_actor_session")).toBe("shift-actor-token");
      expect(localStorage.getItem("pos_last_operator_id")).toBe("1");
    });
    expect(mockOpenMutate).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          natakariId: 1,
          aktivirajNatakarja: true,
          pin: "1234",
        }),
      }),
      expect.any(Object),
    );
  });

  it("administratorski pogled razreši naziv enote prek enotaId", () => {
    setUnitData();
    state.user.vloga = "admin";

    renderPage();

    expect(screen.getByTestId("izmena-enota-ime")).toHaveTextContent("Terasa");
    expect(screen.getByTestId("izmena-stroskovno-mesto")).toHaveTextContent(
      "4.101 — Terasa gostinstvo",
    );
  });

  it("v uporabniškem fallbacku brez znane enote onemogoči odpiranje", () => {
    state.user.enotaId = undefined;
    state.user.enotaIme = null;

    renderPage();

    expect(screen.getByTestId("izmena-enota-manjka")).toHaveTextContent(
      "Enota ni določena — obrni se na administratorja",
    );
    expect(screen.getByRole("button", { name: "Odpri izmeno" })).toBeDisabled();
    expect(mockOpenMutate).not.toHaveBeenCalled();
  });

  it("v administratorskem pogledu brez znane enote onemogoči odpiranje", () => {
    state.user.vloga = "admin";
    state.user.enotaId = undefined;
    state.user.enotaIme = null;

    renderPage();

    expect(screen.getByTestId("izmena-enota-manjka")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Začni izmeno" })).toBeDisabled();
  });

  it("aktivna izmena prikaže enoto ter snapshot stroškovnega mesta", () => {
    setUnitData();
    state.user.vloga = "admin";
    state.aktivneIzmene = [{
      id: 91,
      natakariId: 2,
      natakarIme: "Boris Novak",
      zacetek: "2026-08-22T08:00:00.000Z",
      konec: null,
      skupajZnesek: 0,
      steviloRacunov: 0,
      enotaIme: "Terasa",
      costCenterId: "cc-1",
    }];

    renderPage();

    expect(screen.getByTestId("izmena-lokacija-91")).toHaveTextContent("Terasa");
    expect(screen.getByTestId("izmena-lokacija-91")).toHaveTextContent(
      "SM: 4.101 — Terasa gostinstvo",
    );
  });
});