import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Menu from "./Menu";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/contexts/AuthContext";
import { NastavitveProvider } from "@/contexts/NastavitveContext";

const categories = vi.hoisted(() => ({ current: [{ id: 1, ime: "Hrana", tip: "hrana" }] as Array<{ id: number; ime: string; tip: string }> }));
const mockArticles = vi.hoisted(() => [
  { id: 10, ime: "Raw potato", cena: 0, nabavniArtikel: true, prodajniArtikel: false },
  { id: 11, ime: "Fries", cena: 5, nabavniArtikel: false, prodajniArtikel: true, mealType: "prepared" },
  { id: 12, ime: "Osnova omake", cena: 0, nabavniArtikel: false, prodajniArtikel: false, mealType: "ala_carte", taxCategory: "food" },
  { id: 13, ime: "Dunajski zrezek", cena: 15, nabavniArtikel: false, prodajniArtikel: true, mealType: "ala_carte" },
  { id: 14, ime: "Kombinirana jed", cena: 20, nabavniArtikel: false, prodajniArtikel: true, mealType: "composite", kategorijaId: 1, aktiven: true },
]);
const emptyNormativ = vi.hoisted(() => ({ normativRevision: 1, normativi: [] }));

// Mocks
vi.mock("@workspace/api-client-react", async () => {
  const actual = await vi.importActual("@workspace/api-client-react");
  return {
    ...actual as any,
    useListKategorije: () => ({ data: categories.current, isLoading: false }),
    useListArtikli: () => ({ data: mockArticles, isLoading: false }),
    useCreateArtikel: () => ({ mutate: vi.fn(), isPending: false }),
    useUpdateArtikel: () => ({ mutate: vi.fn(), isPending: false }),
    useGetArtikelNormativi: () => ({
      data: emptyNormativ,
      refetch: vi.fn(),
      isFetching: false,
      isLoading: false,
    }),
    useUpdateArtikelNormativi: () => ({ mutate: vi.fn(), isPending: false }),
    useListModSkupine: () => ({ data: [], isLoading: false }),
    useGetArtikelModSkupine: () => ({ data: [], isLoading: false }),
  };
});

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: { vloga: "admin" } }),
  AuthProvider: ({ children }: any) => <>{children}</>
}));
vi.mock("@/contexts/NastavitveContext", () => ({
  useNastavitve: () => ({ nastavitve: {} }),
  NastavitveProvider: ({ children }: any) => <>{children}</>
}));

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: vi.fn().mockImplementation(query => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: vi.fn(), // Deprecated
    removeListener: vi.fn(), // Deprecated
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

window.HTMLElement.prototype.scrollIntoView = vi.fn();
window.HTMLElement.prototype.hasPointerCapture = vi.fn();
window.HTMLElement.prototype.releasePointerCapture = vi.fn();

vi.mock("@/components/ui/select", () => ({
  Select: ({ onValueChange, children }: any) => (
    <div data-testid="select" onClick={() => onValueChange("1")}>
      {children}
    </div>
  ),
  SelectTrigger: ({ children }: any) => <button>{children}</button>,
  SelectValue: ({ children }: any) => <span>{children}</span>,
  SelectContent: ({ children }: any) => <div>{children}</div>,
  SelectItem: ({ children, value }: any) => <div data-value={value}>{children}</div>,
}));

describe("Menu - mealType conditions", () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    categories.current = [{ id: 1, ime: "Hrana", tip: "hrana" }];
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  it("ponudi izključitev KDS in jo ob novem artiklu ponastavi", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider><NastavitveProvider><Menu /></NastavitveProvider></AuthProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Nov artikel" }));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Cena in DDV" }));
    const checkbox = screen.getByRole("checkbox", { name: "Ne prikazuj na KDS" }) as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Nov artikel" })).toBeNull());
    fireEvent.click(screen.getByRole("button", { name: "Nov artikel" }));
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Cena in DDV" }));
    expect((screen.getByRole("checkbox", { name: "Ne prikazuj na KDS" }) as HTMLInputElement).checked).toBe(false);
  });

  it("filter drobnega inventarja preklopi gumb na ustrezen obrazec, drugi filtri pa odprejo navaden artikel", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider><NastavitveProvider><Menu /></NastavitveProvider></AuthProvider>
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId("filter-article-drobni"));
    fireEvent.click(screen.getByRole("button", { name: "Nov drobni inventar" }));
    expect(screen.getByRole("heading", { name: "Nov drobni inventar" })).toBeTruthy();
    expect((screen.getByLabelText("Drobni inventar (količinsko spremljanje)") as HTMLInputElement).checked).toBe(true);
    expect(screen.getByRole("button", { name: /Dodaj drobni inventar/ })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByRole("heading", { name: "Nov drobni inventar" })).toBeNull());
    fireEvent.click(screen.getByTestId("filter-article-vsi"));
    expect(screen.getByRole("button", { name: "Nov artikel" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Nov artikel" }));
    expect(screen.getByRole("heading", { name: "Nov artikel" })).toBeTruthy();
  });

  it("omogoči izbiro zadnje kategorije v dolgem seznamu za nov prodajni artikel", async () => {
    categories.current = Array.from({ length: 35 }, (_, index) => ({
      id: index + 1, ime: `Kategorija ${index + 1}`, tip: "hrana",
    }));
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider><NastavitveProvider><Menu /></NastavitveProvider></AuthProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByText("Nov artikel"));
    const select = screen.getByRole("combobox", { name: "Kategorija" }) as HTMLSelectElement;
    expect(select.querySelectorAll("option")).toHaveLength(36);
    fireEvent.change(select, { target: { value: "35" } });
    expect(select.value).toBe("35");
  });

  it("shows mealType choice for hrana category sales article and defaults to ala_carte", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider>
          <NastavitveProvider>
            <Menu />
          </NastavitveProvider>
        </AuthProvider>
      </QueryClientProvider>
    );

    // Click "Nov artikel"
    const newBtn = await screen.findByText("Nov artikel");
    fireEvent.click(newBtn);

    // Check it's a prodajni artikel (default)
    const prodajniCheckbox = screen.getByLabelText(/Prodajni artikel/i);
    expect((prodajniCheckbox as HTMLInputElement).checked).toBe(true);

    // Select category "Hrana"
    fireEvent.change(screen.getByLabelText("Kategorija"), { target: { value: "1" } });

    // Način priprave je po reorganizaciji obrazca v zavihku Normativ.
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Normativ" }), {
      button: 0,
      ctrlKey: false,
    });

    // Expect "Način priprave (operativno)" to be visible
    const preparationHeading = await screen.findByText("Način priprave (operativno)");
    expect(preparationHeading).not.toBeNull();
    const normHeading = screen.getByText("Normativ za prodajo");
    expect(
      preparationHeading.compareDocumentPosition(normHeading)
      & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    
    // Default is ala_carte
    const alaCarteBtn = screen.getByText("A la carte (sproti)").closest("button");
    expect(alaCarteBtn?.className).toContain("bg-primary/10");
  });

  it("pri sestavljeni jedi ponudi polizdelke in prodajne à la carte artikle", async () => {
    render(
      <QueryClientProvider client={queryClient}>
        <AuthProvider><NastavitveProvider><Menu /></NastavitveProvider></AuthProvider>
      </QueryClientProvider>,
    );
    fireEvent.click(await screen.findByText("Nov artikel"));
    fireEvent.change(screen.getByLabelText("Kategorija"), { target: { value: "1" } });
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Normativ" }), { button: 0, ctrlKey: false });
    fireEvent.click(screen.getByText("Sestavljeno (kombinirano)").closest("button")!);
    expect(screen.getByText("Sestavljeni normativ")).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Dodaj artikel" }));
    const input = screen.getByPlaceholderText("Izberi artikel");
    fireEvent.focus(input);

    expect(await screen.findByRole("button", { name: "Polizdelki" })).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Polizdelki" }));
    expect(screen.getByRole("button", { name: /Osnova omake.*Polizdelek/ })).not.toBeNull();
    expect(screen.queryByRole("button", { name: /Dunajski zrezek.*Prodajni à la carte/ })).toBeNull();

    fireEvent.click(screen.getByRole("button", { name: "Prodajni à la carte" }));
    expect(screen.getByRole("button", { name: /Dunajski zrezek.*Prodajni à la carte/ })).not.toBeNull();
    fireEvent.mouseDown(screen.getByRole("button", { name: /Dunajski zrezek.*Prodajni à la carte/ }));
    expect((input as HTMLInputElement).value).toContain("Dunajski zrezek");
  });

});
