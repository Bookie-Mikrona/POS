import "@testing-library/jest-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import Menu from "./Menu";

const createArtikel = vi.hoisted(() => vi.fn());
const updateArtikel = vi.hoisted(() => vi.fn());
const updateNormativi = vi.hoisted(() => vi.fn());
const artikli = vi.hoisted(() => ({ current: [] as any[] }));
const authUser = vi.hoisted(() => ({ current: { vloga: "admin" } }));

vi.mock("@workspace/api-client-react", () => ({
  getAuthToken: async () => null,
  getEnotaId: () => null,
  useImportDrobniInventarPredloge: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useGetArtikelNormativeChangeHistory: () => ({ data: [], isLoading: false }),
  getGetArtikelNormativeChangeHistoryQueryKey: () => ["/api/artikli/normativi/zgodovina"],
  getGetPreparedFoodAvailabilityQueryKey: () => ["/api/prepared-food/availability"],
  getArtikliCenikPdf: vi.fn(),
  ApiError: class ApiError extends Error {},
  usePreviewArtikelAlergeniNormativ: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useListKategorije: () => ({ data: [{ id: 1, ime: "Hrana", barva: "#22c55e", vrstniRed: 0 }], isLoading: false }),
  useListArtikli: () => ({ data: artikli.current, isLoading: false }),
  useCreateKategorija: () => ({ mutate: vi.fn(), isPending: false }),
  useDeleteKategorija: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateKategorija: () => ({ mutate: vi.fn(), isPending: false }),
  useCreateArtikel: () => ({ mutate: createArtikel, isPending: false }),
  useDeleteArtikel: () => ({ mutate: vi.fn(), isPending: false }),
  useUpdateArtikel: () => ({ mutate: updateArtikel, isPending: false }),
  useGenerateArtikelImage: () => ({ mutate: vi.fn(), isPending: false }),
  useUploadArtikelImage: () => ({ mutate: vi.fn(), isPending: false }),
  useGetArtikelNormativi: () => ({ data: { normativRevision: 1, normativi: [] } }),
  useUpdateArtikelNormativi: () => ({ mutate: updateNormativi, isPending: false }),
  useListModSkupine: () => ({ data: [] }),
  useGetArtikelModSkupine: () => ({ data: [] }),
  useSetArtikelModSkupine: () => ({ mutate: vi.fn(), isPending: false }),
  useGetArtikelAlergeniNormativ: () => ({ data: [], isLoading: false }),
  useSetArtikelAlergeniNormativ: () => ({ mutate: vi.fn(), isPending: false }),
  getGetArtikelAlergeniNormativQueryKey: () => ["/api/artikli/alergeni-normativ"],
  getListKategorijeQueryKey: () => ["/api/kategorije"],
  getListArtikliQueryKey: () => ["/api/artikli"],
  getGetArtikelNormativiQueryKey: () => ["/api/artikli/normativi"],
  getGetArtikelModSkupineQueryKey: () => ["/api/artikli/mod-skupine"],
}));

vi.mock("@/contexts/AuthContext", () => ({ useAuth: () => ({ user: authUser.current }) }));
vi.mock("@/contexts/NastavitveContext", () => ({
  useNastavitve: () => ({
    nastavitve: { picaPremerNormalna: 33 },
    nastavitveLoading: false,
  }),
}));
vi.mock("@/hooks/use-toast", () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock("@/hooks/useF2Save", () => ({ useF2Save: () => undefined }));
vi.mock("@/hooks/useKopirajNormativ", () => ({
  useKopirajNormativ: () => ({
    handleCopyFromArtikel: vi.fn(),
    copyPickerLoading: false,
    copyPickerOpen: false,
    copyPickerSearch: "",
    setCopyPickerOpen: vi.fn(),
    setCopyPickerSearch: vi.fn(),
  }),
}));
vi.mock("@/components/ModifikatorjePanel", () => ({ default: () => null }));
vi.mock("@/components/ui/select", () => {
  const SelectContext = React.createContext<(value: string) => void>(() => undefined);
  return {
    Select: ({ onValueChange, children }: any) => (
      <SelectContext.Provider value={onValueChange}>
        <div data-testid="select" onClick={() => onValueChange("1")}>{children}</div>
      </SelectContext.Provider>
    ),
    SelectTrigger: ({ children }: any) => <button type="button">{children}</button>,
    SelectValue: ({ children }: any) => <span>{children}</span>,
    SelectContent: ({ children }: any) => <div>{children}</div>,
    SelectItem: ({ children, value }: any) => {
      const onValueChange = React.useContext(SelectContext);
      return <div data-value={value} onClick={event => {
        event.stopPropagation();
        onValueChange(value);
      }}>{children}</div>;
    },
  };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><Menu /></QueryClientProvider>);
}

describe("Menu — čas priprave artikla", () => {
  beforeEach(() => {
    createArtikel.mockReset();
    updateArtikel.mockReset();
    updateNormativi.mockReset();
    authUser.current = { vloga: "admin" };
    createArtikel.mockImplementation((_args: unknown, callbacks: { onSuccess?: (artikel: { id: number }) => void }) => callbacks.onSuccess?.({ id: 99 }));
    updateNormativi.mockImplementation((_args: unknown, callbacks: { onSuccess?: () => void }) => callbacks.onSuccess?.());
    artikli.current = [
      {
        id: 11,
        ime: "Mleko v steklenici",
        cena: 1,
        imeZaNabavo: "Polnomastno mleko",
        enotaMere: "l",
        nabavniArtikel: true,
        prodajniArtikel: false,
      },
      {
        id: 12,
        ime: "Sladkor",
        cena: 1,
        imeZaNabavo: null,
        enotaMere: "kg",
        nabavniArtikel: true,
        prodajniArtikel: false,
      },
      {
        id: 13,
        ime: "Prodajna kava",
        cena: 2,
        imeZaNabavo: null,
        enotaMere: null,
        nabavniArtikel: false,
        prodajniArtikel: true,
      },
      {
        id: 14,
        ime: "Pica Margherita",
        cena: 8.9,
        cenaMala: 6.5,
        cenaDruzinska: 12.5,
        jePica: true,
        imeZaNabavo: null,
        enotaMere: null,
        nabavniArtikel: false,
        prodajniArtikel: true,
      },
      {
        id: 15,
        ime: "Pica brez dodatnih velikosti",
        cena: 7.5,
        cenaMala: null,
        cenaDruzinska: null,
        jePica: true,
        imeZaNabavo: null,
        enotaMere: null,
        nabavniArtikel: false,
        prodajniArtikel: true,
      },
    ];
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({ splosnaSt: 22, nizjaSt: 9.5, znizanaSt: 5 }), { status: 200 })));
    Object.defineProperty(window, "matchMedia", {
      writable: true,
      value: vi.fn().mockImplementation(query => ({
        matches: true,
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      })),
    });
  });

  it("pri prodajnem artiklu prikaže čas priprave in omogoči vnos", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /nov artikel/i }));
    const input = screen.getByLabelText("Čas priprave (min)");
    fireEvent.change(input, { target: { value: "17" } });
    expect(input).toHaveValue(17);
  });

  it("pri samo nabavnem artiklu ne prikazuje časa priprave in shrani nič", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /nov artikel/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("Npr. Espresso"), {
      target: { value: "Nabavno mleko" },
    });
    fireEvent.change(within(dialog).getByLabelText("Čas priprave (min)"), {
      target: { value: "17" },
    });
    fireEvent.click(within(dialog).getByLabelText("Prodajni artikel"));
    fireEvent.click(within(dialog).getByLabelText("Nabavni artikel"));

    expect(within(dialog).queryByLabelText("Čas priprave (min)")).not.toBeInTheDocument();
    expect(within(dialog).queryByText(/samodejni oceni prevzema telefonskega naročila/i)).not.toBeInTheDocument();

    const submit = within(dialog)
      .getAllByRole("button", { name: /dodaj artikel/i })
      .find(button => button.textContent?.includes("F2"));
    if (!submit) throw new Error("Gumb za shranjevanje artikla ni najden.");
    fireEvent.click(submit);
    expect(createArtikel).toHaveBeenCalledWith(
      expect.objectContaining({ data: expect.objectContaining({
        nabavniArtikel: true,
        prodajniArtikel: false,
        casPripraveMin: 0,
      }) }),
      expect.any(Object),
    );
  });

  it("pošlje oznako del menija pri shranjevanju prodajnega artikla", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /nov artikel/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("Npr. Espresso"), {
      target: { value: "Menijska pijača" },
    });
    fireEvent.click(within(dialog).getAllByTestId("select")[0]!);
    fireEvent.click(within(dialog).getByText("Topla pijača — 22 %"));
    fireEvent.change(within(dialog).getByPlaceholderText("2.50"), {
      target: { value: "2.00" },
    });
    fireEvent.click(within(dialog).getByRole("checkbox", { name: /del menija/i }));

    const submit = within(dialog)
      .getAllByRole("button", { name: /dodaj artikel/i })
      .find(button => button.textContent?.includes("F2"));
    if (!submit) throw new Error("Gumb za shranjevanje artikla ni najden.");
    fireEvent.click(submit);

    expect(createArtikel).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          jeDelMenija: true,
        }),
      }),
      expect.any(Object),
    );
  });

  it("pri kategoriji Pijača-jed odstrani zastarelo oznako dodanega sladkorja", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /nov artikel/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.change(within(dialog).getByPlaceholderText("Npr. Espresso"), {
      target: { value: "Vroča čokolada" },
    });
    fireEvent.click(within(dialog).getAllByTestId("select")[0]!);
    fireEvent.change(within(dialog).getByPlaceholderText("2.50"), {
      target: { value: "3.00" },
    });

    fireEvent.click(within(dialog).getByText("Topla pijača — 22 %"));
    fireEvent.click(await within(dialog).findByRole("checkbox", { name: /vsebuje dodan sladkor/i }));
    fireEvent.click(within(dialog).getByText(/Pijača-jed \(gosta čokolada/));

    await waitFor(() => {
      expect(within(dialog).queryByRole("checkbox", { name: /vsebuje dodan sladkor/i })).not.toBeInTheDocument();
      expect(within(dialog).getByText(/dodan sladkor ne vpliva na DDV/i)).toBeInTheDocument();
    });

    const submit = within(dialog)
      .getAllByRole("button", { name: /dodaj artikel/i })
      .find(button => button.textContent?.includes("F2"));
    if (!submit) throw new Error("Gumb za shranjevanje artikla ni najden.");
    fireEvent.click(submit);

    expect(createArtikel).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          taxCategory: "food_drink",
          addedSugar: false,
        }),
      }),
      expect.any(Object),
    );
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
  });

  it("ob prvem shranjevanju novega artikla takoj shrani tudi vneseni normativ", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /nov artikel/i }));
    const dialog = screen.getByRole("dialog");

    fireEvent.change(within(dialog).getByPlaceholderText("Npr. Espresso"), {
      target: { value: "Nova jed z normativom" },
    });
    fireEvent.click(within(dialog).getAllByTestId("select")[0]!);
    fireEvent.change(within(dialog).getByPlaceholderText("2.50"), {
      target: { value: "8.50" },
    });

    fireEvent.click(within(dialog).getByRole("button", { name: /^Dodaj artikel$/i }));
    const picker = within(dialog).getByPlaceholderText("Izberi artikel");
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "mleko" } });
    fireEvent.mouseDown(await within(dialog).findByRole("button", { name: /polnomastno mleko/i }));
    fireEvent.change(within(dialog).getByPlaceholderText("0"), {
      target: { value: "0,25" },
    });

    const submit = within(dialog)
      .getAllByRole("button", { name: /dodaj artikel/i })
      .find(button => button.textContent?.includes("F2"));
    if (!submit) throw new Error("Gumb za shranjevanje artikla ni najden.");
    fireEvent.click(submit);

    await waitFor(() => {
      expect(updateNormativi).toHaveBeenCalledWith(
        {
          id: 99,
          data: [{ vhodniArtikelId: 11, kolicina: 0.25 }],
        },
        expect.any(Object),
      );
    });
  });

  it("pri novi pici predlaga 5 minut priprave, ročnega vnosa pa ne prepiše", () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /nov artikel/i }));

    const casPriprave = screen.getByLabelText("Čas priprave (min)");
    expect(casPriprave).toHaveValue(0);

    const jePica = screen.getByRole("checkbox", { name: /je pica/i });
    fireEvent.click(jePica);
    expect(casPriprave).toHaveValue(5);
    expect(screen.getByText(/za pico je predlaganih 5 minut/i)).toBeInTheDocument();

    fireEvent.change(casPriprave, { target: { value: "4" } });
    fireEvent.click(jePica);
    fireEvent.click(jePica);
    expect(casPriprave).toHaveValue(4);
  });

  it("v normativu poišče nabavni artikel po običajnem ali nabavnem nazivu", async () => {
    renderPage();
    fireEvent.click(screen.getByRole("button", { name: /nov artikel/i }));
    const dialog = screen.getByRole("dialog");
    fireEvent.click(within(dialog).getByRole("button", { name: /^Dodaj artikel$/i }));

    const picker = within(dialog).getByPlaceholderText("Izberi artikel") as HTMLInputElement;
    fireEvent.focus(picker);
    fireEvent.change(picker, { target: { value: "steklenici" } });

    expect(await within(dialog).findByRole("button", { name: /polnomastno mleko \(l\)/i })).toBeInTheDocument();
    expect(within(dialog).queryByText("Prodajna kava")).not.toBeInTheDocument();

    fireEvent.keyDown(picker, { key: "ArrowDown" });
    fireEvent.keyDown(picker, { key: "Enter" });

    await waitFor(() => expect(picker).toHaveValue("Polnomastno mleko (l)"));
    expect(within(dialog).getByText("l")).toBeInTheDocument();

    fireEvent.click(picker);
    const sugarOption = await within(dialog).findByRole("button", { name: /sladkor \(kg\)/i });
    fireEvent.mouseDown(sugarOption);
    await waitFor(() => expect(picker).toHaveValue("Sladkor (kg)"));

    const quantity = within(dialog).getByPlaceholderText("0");
    fireEvent.change(quantity, { target: { value: "1234,567" } });
    expect(quantity).toHaveValue("1234,567");
    expect(quantity).toHaveClass("w-full");

    fireEvent.keyDown(picker, { key: "Backspace" });
    await waitFor(() => expect(picker).toHaveValue(""));
    expect(await within(dialog).findByRole("button", { name: /polnomastno mleko \(l\)/i })).toBeInTheDocument();

    fireEvent.keyDown(picker, { key: "Escape" });
    await waitFor(() => expect(within(dialog).queryByRole("button", { name: /polnomastno mleko \(l\)/i })).not.toBeInTheDocument());
    expect(dialog).toBeInTheDocument();
  });

  it("pri pici prikaže določene velikosti in neposredno uredi izbrano ceno", async () => {
    renderPage();

    expect(screen.getByRole("button", { name: /uredi normalna ceno za pica margherita/i })).toHaveTextContent(/Normalna:\s*8.90 €/);
    expect(screen.getByRole("button", { name: /uredi mala ceno za pica margherita/i })).toHaveTextContent(/Mala:\s*6.50 €/);
    expect(screen.getByRole("button", { name: /uredi družinska ceno za pica margherita/i })).toHaveTextContent(/Družinska:\s*12.50 €/);

    fireEvent.click(screen.getByRole("button", { name: /uredi mala ceno za pica margherita/i }));
    const malaCena = screen.getByRole("textbox", { name: /uredi mala ceno za pica margherita/i });
    fireEvent.change(malaCena, { target: { value: "7,25" } });
    fireEvent.keyDown(malaCena, { key: "Enter" });

    await waitFor(() => {
      expect(updateArtikel).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 14,
          data: expect.objectContaining({
            cenaMala: 7.25,
          }),
        }),
        expect.any(Object),
      );
    });
    expect(updateArtikel.mock.calls[0][0].data).not.toHaveProperty("cenaDruzinska");

    fireEvent.click(screen.getByRole("button", { name: /uredi družinska ceno za pica margherita/i }));
    const druzinskaCena = screen.getByRole("textbox", { name: /uredi družinska ceno za pica margherita/i });
    fireEvent.change(druzinskaCena, { target: { value: "13,75" } });
    fireEvent.keyDown(druzinskaCena, { key: "Enter" });

    await waitFor(() => expect(updateArtikel).toHaveBeenCalledTimes(2));
    expect(updateArtikel.mock.calls[1][0].data).toEqual(expect.objectContaining({
      ime: "Pica Margherita",
      cenaDruzinska: 13.75,
    }));
    expect(updateArtikel.mock.calls[1][0].data).not.toHaveProperty("cenaMala");
    expect(updateArtikel.mock.calls[1][0].data).not.toHaveProperty("cena");
    expect(screen.getByRole("button", { name: /uredi normalna ceno za pica brez dodatnih velikosti/i })).toHaveTextContent(/Normalna:\s*7.50 €/);
    expect(screen.queryByRole("button", { name: /uredi mala ceno za pica brez dodatnih velikosti/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /uredi družinska ceno za pica brez dodatnih velikosti/i })).not.toBeInTheDocument();
  });

  it("uporabniku prikaže cene pic brez možnosti neposrednega urejanja", () => {
    authUser.current = { vloga: "uporabnik" };
    renderPage();

    const pizzaRow = screen.getByText("Pica Margherita").closest("tr");
    expect(pizzaRow).toHaveTextContent(/Normalna:\s*8.90 €/);
    expect(pizzaRow).toHaveTextContent(/Mala:\s*6.50 €/);
    expect(pizzaRow).toHaveTextContent(/Družinska:\s*12.50 €/);
    expect(screen.queryByRole("button", { name: /uredi .*ceno za pica margherita/i })).not.toBeInTheDocument();
    expect(updateArtikel).not.toHaveBeenCalled();
  });
});