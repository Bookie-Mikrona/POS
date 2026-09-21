import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ObracunUrPage from "./ObracunUr";

const state = vi.hoisted(() => ({
  user: {
    vloga: "admin",
    enotaId: 7,
    companyId: "company-1",
  },
}));

const fixture = vi.hoisted(() => ({
  data: [{
    izmenaId: 91,
    natakariId: 11,
    natakar: "Ana Novak",
    enotaId: 7,
    enota: "Terasa",
    zacetek: "2026-08-14T08:00:00.000Z",
    konec: "2026-08-14T11:30:00.000Z",
    brutoUr: 3.5,
    neplacaniOdmoriUr: 0,
    placaniOdmoriUr: 0,
    efektivneUr: 3.5,
    nadure: 0,
    steviloOdmorov: 0,
    napitnineBruto: 7,
    napitnineNeto: 7,
    napitninaNaEfektivnoUro: 2,
    status: "v_potrditvi",
    potrjenoBy: null,
    potrjenoAt: null,
    zavrnitevRazlog: null as string | null,
  }],
  audit: [] as Array<Record<string, unknown>>,
}));

const data = fixture.data;

vi.mock("@workspace/api-client-react", () => ({
  useListKadrovskiPregled: () => ({ data, isLoading: false }),
  useListIzmenaAudit: () => ({ data: fixture.audit, isLoading: false }),
  useListOdmori: () => ({ data: [], isLoading: false }),
  usePotrdiIzmeno: () => ({
    mutate: (variables: { id: number; data: { status: "potrjeno" | "zavrnjeno"; razlog?: string } }, options?: { onSuccess?: () => void }) => {
      if (variables.data.status === "zavrnjeno") {
        data[0].status = "zavrnjeno";
        data[0].zavrnitevRazlog = variables.data.razlog ?? null;
        fixture.audit = [{
          id: "audit-reject",
          dejanje: "zavrnitev_izmene",
          razlog: variables.data.razlog ?? null,
          actorId: "admin-test",
          createdAt: "2026-08-14T12:00:00.000Z",
          pred: { status: "v_potrditvi" },
          po: { status: "zavrnjeno" },
        }];
      }
      options?.onSuccess?.();
    },
    isPending: false,
  }),
  usePopraviIzmeno: () => ({ mutate: vi.fn(), isPending: false }),
  useListOdsotnosti: () => ({ data: [], isLoading: false }),
  useCreateOdsotnost: () => ({ mutate: vi.fn(), isPending: false }),
  usePotrdiOdsotnost: () => ({ mutate: vi.fn(), isPending: false }),
  useListEnote: () => ({ data: [{ id: 7, ime: "Terasa" }] }),
  useListNatakari: () => ({ data: [{ id: 11, ime: "Ana", priimek: "Novak", aktiven: true }] }),
  getListKadrovskiPregledQueryKey: () => ["/api/izmene/kadrovski-pregled"],
  getListIzmenaAuditQueryKey: (id: number) => [`/api/izmene/${id}/audit`],
  getListOdmoriQueryKey: (id: number) => [`/api/izmene/${id}/odmori`],
  getListOdsotnostiQueryKey: () => ["/api/odsotnosti"],
  getListEnoteQueryKey: () => ["/api/enote"],
  getListNatakariQueryKey: () => ["/api/natakari"],
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: state.user }),
}));

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <ObracunUrPage />
    </QueryClientProvider>,
  );
}

describe("Obračun ur", () => {
  beforeEach(() => {
    Object.assign(data[0], {
      status: "v_potrditvi",
      zavrnitevRazlog: null,
    });
    fixture.audit = [];
  });

  it("prikaže efektivne ure, napitnine in podrobnosti izmene", () => {
    renderPage();

    expect(screen.getByRole("heading", { name: "Kadrovski pregled" })).toBeInTheDocument();
    expect(screen.getByText("Ana Novak")).toBeInTheDocument();
    expect(screen.getAllByText("3,50 h")).toHaveLength(3);
    expect(screen.getByText(/7,00/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Prikaži podrobnosti izmene" }));
    expect(screen.getByText("Ni zabeleženih odmorov.")).toBeInTheDocument();
    expect(screen.getByText("Ni zapisov.")).toBeInTheDocument();
  });

  it("omogoči zavrnitev izmene iz čakalne vrste in pokaže razlog v podrobnostih ter auditu", () => {
    renderPage();

    fireEvent.click(screen.getByTitle("Zavrni izmeno"));
    fireEvent.change(screen.getByPlaceholderText("Npr. ure ne ustrezajo..."), {
      target: { value: "Napaka v urah" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Zavrni izmeno" }));

    expect(screen.getByText("zavrnjeno")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Prikaži podrobnosti izmene" }));

    expect(screen.getByText("Razlog zavrnitve:")).toBeInTheDocument();
    expect(screen.getByText("Napaka v urah")).toBeInTheDocument();
    expect(screen.getByText('"Napaka v urah"')).toBeInTheDocument();
    expect(screen.getByText("zavrnitev_izmene")).toBeInTheDocument();
  });

  it("skrije akcije potrditve in zavrnitve, ko je izmena že potrjena", () => {
    data[0].status = "potrjeno";
    renderPage();

    expect(screen.queryByTitle("Potrdi izmeno")).not.toBeInTheDocument();
    expect(screen.queryByTitle("Zavrni izmeno")).not.toBeInTheDocument();
  });
});
