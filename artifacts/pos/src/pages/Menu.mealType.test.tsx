import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import Menu from "./Menu";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { AuthProvider } from "@/contexts/AuthContext";
import { NastavitveProvider } from "@/contexts/NastavitveContext";

// Mocks
vi.mock("@workspace/api-client-react", async () => {
  const actual = await vi.importActual("@workspace/api-client-react");
  return {
    ...actual as any,
    useListKategorije: () => ({ data: [{ id: 1, ime: "Hrana", tip: "hrana" }], isLoading: false }),
    useListArtikli: () => ({ 
      data: [
        { id: 10, ime: "Raw potato", cena: 0, nabavniArtikel: true, prodajniArtikel: false },
        { id: 11, ime: "Fries", cena: 5, nabavniArtikel: false, prodajniArtikel: true, mealType: "prepared" }
      ], isLoading: false 
    }),
    useCreateArtikel: () => ({ mutate: vi.fn(), isPending: false }),
    useUpdateArtikel: () => ({ mutate: vi.fn(), isPending: false }),
    useGetArtikelNormativi: () => ({
      data: { normativRevision: 1, normativi: [] },
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
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
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
    const selects = screen.getAllByTestId("select");
    console.log("Found selects:", selects.length);
    fireEvent.click(selects[0]);
    if (selects[1]) fireEvent.click(selects[1]);
    if (selects[2]) fireEvent.click(selects[2]);

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

});
