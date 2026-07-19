/**
 * Testi za potrditveni dialog pri brisanju inventur v komponenti Zaloge.tsx.
 *
 * Pokritost:
 *  1. Klik gumba za brisanje prikaže AlertDialog z naslovom "Izbriši inventuro?"
 *  2. Dialog vsebuje opozorilo o povrnitvi zalog in nepreklicnem dejanju
 *  3. "Prekliči" zapre dialog brez klica mutacije za brisanje
 *  4. "Potrdi" sproži mutacijo za brisanje s pravilnim ID-jem
 *  5. Mutacija se NE pokliče brez klika na gumb za brisanje
 *
 * Opomba: Radix UI TabsContent renderira otroke SAMO ko je zavihek aktiven
 * (children: present && children). Preklapljanje zavihkov zahteva
 * fireEvent.mouseDown (ne click) — Trigger interno poslušna na onMouseDown.
 */
import "@testing-library/jest-dom";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, fireEvent, screen, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import Zaloge from "./Zaloge";

// ── Mock podatki ────────────────────────────────────────────────────────────
const mockInventura = {
  id: 15,
  stevilka: "INV-2025-001",
  datum: "2025-06-01T00:00:00.000Z",
  opomba: null,
  steviloPostavk: 4,
};

// ── Hoisted mock funkcije ───────────────────────────────────────────────────
const mockDeleteMutate = vi.hoisted(() => vi.fn());
const mockToast = vi.hoisted(() => vi.fn());

// ── Moki za @workspace/api-client-react ─────────────────────────────────────
vi.mock("@workspace/api-client-react", () => ({
  useListZaloge: () => ({ data: [], isLoading: false }),
  useListPrejemnice: () => ({ data: [], isLoading: false }),
  useListInventure: () => ({ data: [mockInventura], isLoading: false }),
  useListArtikli: () => ({ data: [] }),
  useListZacetneZaloge: () => ({ data: [], isLoading: false }),
  useCreatePrejemnica: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateInventura: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdatePrejemnica: () => ({ mutate: vi.fn(), isPending: false }),
  useDeletePrejemnica: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateInventura: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteInventura: () => ({
    mutate: mockDeleteMutate,
    isPending: false,
  }),
  useGetKarticaArtikla: () => ({ data: undefined, isLoading: false }),
  useGetPrejemnica: () => ({ data: undefined, isLoading: false }),
  useGetInventura: () => ({ data: undefined, isLoading: false }),
  useCreateZacetnaZaloga: () => ({ mutate: vi.fn(), isPending: false }),
  useGetZacetnaZaloga: () => ({ data: undefined, isLoading: false }),
  useUpdateZacetnaZaloga: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteZacetnaZaloga: () => ({ mutate: vi.fn(), isPending: false }),
  useReconcileZaloge: () => ({ mutate: vi.fn(), isPending: false }),
  getListZalogeQueryKey: () => ["/api/zaloge"],
  getListPrejemniceQueryKey: () => ["/api/prejemnice"],
  getListInventureQueryKey: () => ["/api/inventure"],
  getGetPrejemnicaQueryKey: () => ["/api/prejemnice/detail"],
  getGetInventuraQueryKey: () => ["/api/inventure/detail"],
  getListZacetneZalogeQueryKey: () => ["/api/zacetne-zaloge"],
  getGetZacetnaZalogaQueryKey: () => ["/api/zacetne-zaloge/detail"],
}));

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({
    user: {
      id: 1,
      username: "admin",
      ime: "Admin",
      vloga: "admin",
      podjetjeDavcna: "12345678",
      moraZamenjatiGeslo: false,
    },
    loading: false,
    login: vi.fn(),
    updateUser: vi.fn(),
    logout: vi.fn(),
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: mockToast }),
}));

// ── Pomožne funkcije ────────────────────────────────────────────────────────
function makeQueryClient() {
  return new QueryClient({ defaultOptions: { queries: { retry: false } } });
}

function renderZaloge() {
  const queryClient = makeQueryClient();
  const result = render(
    <QueryClientProvider client={queryClient}>
      <Zaloge />
    </QueryClientProvider>
  );
  return { queryClient, container: result.container };
}

/**
 * Preklopi na zavihek "Inventure".
 *
 * Radix UI TabsTrigger aktivira zavihek prek onMouseDown (ne onClick),
 * zato moramo posnemati mousedown z button=0 in ctrlKey=false.
 */
function switchToInventure(): void {
  const tabTrigger = screen.getByRole("tab", { name: "Inventure" });
  fireEvent.mouseDown(tabTrigger, { button: 0, ctrlKey: false });
}

/**
 * Poišče gumb za brisanje v aktivnem tabpanelu.
 * Gumb za brisanje ima razred "text-destructive" in je edini takšen gumb
 * ko so podatki za prejemnice in začetne zaloge prazni.
 */
function findInvDeleteButton(container: HTMLElement): HTMLElement {
  const activePanel = container.querySelector<HTMLElement>(
    '[role="tabpanel"][data-state="active"]'
  );
  if (!activePanel) {
    throw new Error("Aktiven tabpanel ni najden");
  }
  const destructive = Array.from(
    activePanel.querySelectorAll<HTMLElement>("button")
  ).filter(b => b.className.includes("text-destructive"));

  if (destructive.length === 0) {
    const allBtns = activePanel.querySelectorAll("button");
    throw new Error(
      `Gumb za brisanje (text-destructive) ni najden. Vsi gumbi v panelu: ${allBtns.length} — razredi: ${Array.from(allBtns).map(b => b.className.substring(0, 60)).join(" | ")}`
    );
  }
  return destructive[0];
}

// ── Testi ───────────────────────────────────────────────────────────────────
describe("Zaloge — brisanje inventure: potrditveni dialog", () => {
  beforeEach(() => {
    mockDeleteMutate.mockReset();
    mockToast.mockReset();
  });

  it("klik gumba za brisanje prikaže AlertDialog z naslovom 'Izbriši inventuro?'", () => {
    const { container } = renderZaloge();
    switchToInventure();
    const deleteButton = findInvDeleteButton(container);
    fireEvent.click(deleteButton);

    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByText("Izbriši inventuro?")).toBeInTheDocument();
  });

  it("dialog vsebuje opozorilo o povrnitvi zalog in nepreklicnem dejanju", () => {
    const { container } = renderZaloge();
    switchToInventure();
    fireEvent.click(findInvDeleteButton(container));

    expect(
      screen.getByText(/zaloge bodo povrnjene na vrednosti pred inventuro/i)
    ).toBeInTheDocument();
    expect(
      screen.getByText(/tega dejanja ni mogoče razveljaviti/i)
    ).toBeInTheDocument();
  });

  it("klik 'Prekliči' zapre dialog brez klica mutacije za brisanje", () => {
    const { container } = renderZaloge();
    switchToInventure();
    fireEvent.click(findInvDeleteButton(container));

    const dialog = screen.getByRole("alertdialog");
    expect(dialog).toBeInTheDocument();

    fireEvent.click(within(dialog).getByText("Prekliči"));

    expect(mockDeleteMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });

  it("klik 'Potrdi' sproži mutacijo za brisanje s pravilnim ID-jem", () => {
    const { container } = renderZaloge();
    switchToInventure();
    fireEvent.click(findInvDeleteButton(container));

    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByText("Potrdi"));

    expect(mockDeleteMutate).toHaveBeenCalledOnce();
    expect(mockDeleteMutate).toHaveBeenCalledWith(
      { id: mockInventura.id },
      expect.objectContaining({
        onSuccess: expect.any(Function),
        onError: expect.any(Function),
      })
    );
  });

  it("mutacija za brisanje se NE pokliče brez klika na gumb za brisanje", () => {
    renderZaloge();
    switchToInventure();

    expect(mockDeleteMutate).not.toHaveBeenCalled();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
});
