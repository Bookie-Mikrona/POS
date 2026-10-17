import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NarocilaDobaviteljem from "./NarocilaDobaviteljem";

const mocks = vi.hoisted(() => ({
  markSent: vi.fn(),
  mutation: vi.fn(),
  navigate: vi.fn(),
  order: {
    id: 704,
    number: "N-2026-0704",
    supplierId: "supplier-704",
    supplierName: "Mlekarna Planika",
    status: "draft",
    createdAt: "2026-10-17T10:00:00.000Z",
    expectedDeliveryDate: "2026-10-22",
    sentAt: null,
    lineCount: 1,
    openQuantity: 12,
    internalNotes: "INTERNAL ONLY: preveriti stanje embalaže.",
    supplierNotes: "Prosimo za dostavo do 10.00.\nHvala.",
    closedReason: null,
    lines: [{
      id: 7041,
      supplierMappingId: 7042,
      articleId: 7043,
      articleName: "Mleko 3,5 %",
      supplierItemName: "Mleko polnomastno",
      supplierCode: "ML-01",
      packageQuantity: 2,
      packageFactor: 6,
      currentPackageFactor: 6,
      packageName: "zaboj",
      baseUnit: "L",
      orderedBaseQuantity: 12,
      receivedBaseQuantity: 0,
      openBaseQuantity: 12,
      unitPrice: 18,
    }],
  },
  dashboard: {
    articles: [{
      articleId: 7043,
      articleName: "Mleko 3,5 %",
      purchaseName: "Mleko polnomastno",
      baseUnit: "L",
      onHand: 2,
      reorderPoint: 5,
      targetStock: 17,
      openOrderQuantity: 0,
      suggestedBaseQuantity: 15,
      suggestedPackageQuantity: 3,
      preferredMappingId: 7042,
      hasSuggestion: true,
      mappings: [{
        id: 7042,
        supplierId: "supplier-704",
        supplierName: "Mlekarna Planika",
        supplierItemName: "Mleko polnomastno",
        supplierCode: "ML-01",
        packageName: "zaboj",
        packageFactor: 6,
        lastPackagePrice: 22.5,
        lastUnitPrice: 3.75,
        lastPriceReceipt: { receiptId: 7044, date: "2026-10-17", receiptNumber: "26100001" },
        priceHistory: [
          { receiptId: 7044, date: "2026-10-17", receiptNumber: "26100001", unitPrice: 3.75 },
          { receiptId: 7032, date: "2026-10-10", receiptNumber: "26000099", unitPrice: 3.25 },
        ],
        active: true,
      }],
    }],
    orders: [],
  },
}));

vi.mock("wouter", () => ({
  useLocation: () => ["/narocila-dobaviteljem", mocks.navigate],
}));

vi.mock("@workspace/api-client-react", async () => {
  const actual = await vi.importActual("@workspace/api-client-react");
  const mutation = () => ({ mutateAsync: mocks.mutation, isPending: false });
  return {
    ...actual as any,
    useGetSupplierOrderDashboard: () => ({
      data: mocks.dashboard,
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useListSupplierOrders: () => ({
      data: [{
        id: mocks.order.id,
        number: mocks.order.number,
        supplierId: mocks.order.supplierId,
        supplierName: mocks.order.supplierName,
        status: mocks.order.status,
        createdAt: mocks.order.createdAt,
        expectedDeliveryDate: mocks.order.expectedDeliveryDate,
        lineCount: mocks.order.lineCount,
        openQuantity: mocks.order.openQuantity,
        internalNotes: mocks.order.internalNotes,
        supplierNotes: mocks.order.supplierNotes,
      }],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    }),
    useGetSupplierOrder: () => ({
      data: mocks.order,
      isLoading: false,
      isError: false,
      refetch: async () => ({ data: mocks.order, isError: false }),
    }),
    useSaveSupplierReorderSettings: mutation,
    useCreateSupplierOrder: mutation,
    useUpdateSupplierOrder: mutation,
    useMarkSupplierOrderSent: () => ({ mutateAsync: mocks.markSent, isPending: false }),
    useCloseSupplierOrder: mutation,
    useCancelSupplierOrder: mutation,
    useCreatePrejemnica: mutation,
  };
});

describe("supplier order print view", () => {
  const print = vi.fn();

  beforeEach(() => {
    mocks.markSent.mockReset();
    mocks.mutation.mockReset();
    mocks.navigate.mockReset();
    mocks.order.internalNotes = "INTERNAL ONLY: preveriti stanje embalaže.";
    mocks.order.supplierNotes = "Prosimo za dostavo do 10.00.\nHvala.";
    print.mockReset();
    Object.defineProperty(window, "print", { configurable: true, value: print });
  });

  afterEach(() => cleanup());

  it("prints the selected order details without marking it as sent", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <NarocilaDobaviteljem />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId("tab-supplier-orders"));
    fireEvent.click(screen.getByTestId("button-open-supplier-order-704"));

    expect(screen.getByTestId("text-supplier-order-print-number").textContent).toContain("N-2026-0704");
    expect(screen.getByTestId("text-supplier-order-print-supplier").textContent).toContain("Mlekarna Planika");
    expect(screen.getByTestId("text-supplier-order-print-delivery").textContent).not.toContain("—");
    expect(screen.getByTestId("row-supplier-order-print-7041").textContent).toContain("zaboj");
    expect(screen.getByTestId("row-supplier-order-print-7041").textContent).toContain("2");
    expect(screen.getByTestId("row-supplier-order-print-7041").textContent).toContain("18,00");
    expect(screen.getByTestId("row-supplier-order-print-7041").textContent).toContain("36,00");
    expect(screen.getByTestId("text-supplier-order-print-instructions").textContent).toContain("Prosimo za dostavo do 10.00.");
    expect(screen.getByTestId("text-supplier-order-print-instructions").textContent).toContain("Hvala.");
    expect(document.querySelector(".supplier-order-print")?.textContent).not.toContain("INTERNAL ONLY");
    expect(screen.getByText("INTERNAL ONLY: preveriti stanje embalaže.")).toBeTruthy();

    fireEvent.click(screen.getByTestId("button-print-supplier-order-704"));

    expect(print).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.markSent).not.toHaveBeenCalled();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("warns before printing when internal notes exist without supplier instructions, then allows printing without exposing them", () => {
    mocks.order.supplierNotes = " \n ";
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <NarocilaDobaviteljem />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId("tab-supplier-orders"));
    fireEvent.click(screen.getByTestId("button-open-supplier-order-704"));
    fireEvent.click(screen.getByTestId("button-print-supplier-order-704"));

    const warning = screen.getByRole("alertdialog");
    expect(warning.textContent).toContain("Naročilo nima navodila za dobavitelja");
    expect(warning.textContent).not.toContain("INTERNAL ONLY");
    expect(print).not.toHaveBeenCalled();
    expect(document.querySelector(".supplier-order-print")?.textContent).not.toContain("INTERNAL ONLY");

    fireEvent.click(screen.getByTestId("button-continue-supplier-order-print"));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(print).toHaveBeenCalledOnce();
    expect(document.querySelector(".supplier-order-print")?.textContent).not.toContain("INTERNAL ONLY");
  });

  it("returns a draft to editing from the print warning without printing", () => {
    mocks.order.supplierNotes = "";
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <NarocilaDobaviteljem />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId("tab-supplier-orders"));
    fireEvent.click(screen.getByTestId("button-open-supplier-order-704"));
    fireEvent.click(screen.getByTestId("button-print-supplier-order-704"));
    fireEvent.click(screen.getByTestId("button-edit-supplier-order-from-print-warning"));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("button", { name: "Shrani osnutek" })).toBeTruthy();
    expect((screen.getByLabelText(/Interna opomba/) as HTMLTextAreaElement).value)
      .toBe("INTERNAL ONLY: preveriti stanje embalaže.");
    expect((screen.getByLabelText(/Navodilo dobavitelju/) as HTMLTextAreaElement).value).toBe("");
    expect(screen.queryByTestId("supplier-order-print")).toBeNull();
    expect(print).not.toHaveBeenCalled();
  });

  it("warns on older non-draft orders too, without offering an unavailable edit action", () => {
    const originalStatus = mocks.order.status;
    mocks.order.status = "sent";
    mocks.order.supplierNotes = "";
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    try {
      render(
        <QueryClientProvider client={queryClient}>
          <NarocilaDobaviteljem />
        </QueryClientProvider>,
      );

      fireEvent.click(screen.getByTestId("tab-supplier-orders"));
      fireEvent.click(screen.getByTestId("button-open-supplier-order-704"));
      fireEvent.click(screen.getByTestId("button-print-supplier-order-704"));

      expect(screen.getByRole("alertdialog").textContent).toContain("naročila pa ni več mogoče urejati");
      expect(screen.queryByTestId("button-edit-supplier-order-from-print-warning")).toBeNull();
      expect(print).not.toHaveBeenCalled();
      fireEvent.click(screen.getByTestId("button-dismiss-supplier-order-print-warning"));
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(print).not.toHaveBeenCalled();
    } finally {
      mocks.order.status = originalStatus;
    }
  });

  it("prints without warning when the internal note is blank even if supplier instructions are blank", () => {
    mocks.order.internalNotes = " \n ";
    mocks.order.supplierNotes = "";
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <NarocilaDobaviteljem />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByTestId("tab-supplier-orders"));
    fireEvent.click(screen.getByTestId("button-open-supplier-order-704"));
    fireEvent.click(screen.getByTestId("button-print-supplier-order-704"));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(print).toHaveBeenCalledOnce();
  });

  it("shows the date and receipt reference for the latest supplier price", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <NarocilaDobaviteljem />
      </QueryClientProvider>,
    );

    const source = screen.getByTestId("last-price-source-7042");
    expect(source.textContent).toContain("22,50");
    expect(source.textContent).toMatch(/3,75\s*€ \/ L/);
    expect(source.textContent).toContain("26100001");
    expect(source.textContent).toContain("17.");
    expect(source.textContent).toContain("2026");

    fireEvent.click(screen.getByTestId("last-price-receipt-7042"));
    expect(mocks.navigate).toHaveBeenCalledWith("/zaloge?prejemnica=7044&nacin=ogled");
  });

  it("shows recent confirmed prices and opens a historical receipt in read-only mode", () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <NarocilaDobaviteljem />
      </QueryClientProvider>,
    );

    const history = screen.getByTestId("price-history-7042");
    fireEvent.click(within(history).getByText(/Zgodovina potrjenih cen/));

    expect(history.textContent).toContain("3,25");
    expect(history.textContent).toContain("10.");
    const historicalReceipt = within(history).getByTestId("price-history-receipt-7042-7032");
    expect(historicalReceipt.textContent).toContain("26000099");

    fireEvent.click(historicalReceipt);
    expect(mocks.navigate).toHaveBeenCalledWith("/zaloge?prejemnica=7032&nacin=ogled");
  });

  it("compares supplier prices by base unit and omits prices with invalid or missing package factors", () => {
    const article = mocks.dashboard.articles[0];
    const originalMappings = article.mappings;
    const [existing] = originalMappings;
    Object.assign(article, {
      mappings: [
        existing,
        {
          ...existing,
          id: 7047,
          supplierId: "supplier-705",
          supplierName: "Mlekarna Ugodna",
          packageName: "karton",
          packageFactor: 8,
          lastPackagePrice: 20,
          lastUnitPrice: 2.5,
          lastPriceReceipt: null,
          priceHistory: [],
        },
        {
          ...existing,
          id: 7048,
          supplierId: "supplier-706",
          supplierName: "Mlekarna Neveljavno",
          packageName: "vreča",
          packageFactor: 0,
          lastPackagePrice: 10,
          lastUnitPrice: null,
          lastPriceReceipt: null,
          priceHistory: [],
        },
        {
          ...existing,
          id: 7049,
          supplierId: "supplier-707",
          supplierName: "Mlekarna Brez Cene",
          packageName: "paket",
          packageFactor: 4,
          lastPackagePrice: null,
          lastUnitPrice: null,
          lastPriceReceipt: null,
          priceHistory: [],
        },
        {
          ...existing,
          id: 7050,
          supplierId: "supplier-708",
          supplierName: "Mlekarna Brez Faktorja",
          packageName: "paket",
          packageFactor: null,
          lastPackagePrice: 16,
          lastUnitPrice: null,
          lastPriceReceipt: null,
          priceHistory: [],
        },
      ],
    });

    try {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={queryClient}>
          <NarocilaDobaviteljem />
        </QueryClientProvider>,
      );

      expect(screen.getByTestId("last-unit-price-7042").textContent).toMatch(/3,75\s*€ \/ L/);
      expect(screen.getByTestId("last-unit-price-7047").textContent).toMatch(/2,50\s*€ \/ L/);
      expect(screen.getByTestId("lowest-unit-price-7047").textContent).toContain("Najnižja cena / enoto");
      expect(screen.getByTestId("unavailable-unit-price-7048").textContent).toContain("velikost pakiranja ni veljavna");
      expect(screen.getByTestId("unavailable-unit-price-7050").textContent).toContain("velikost pakiranja ni veljavna");
      expect(screen.getByText("Zadnja cena ni zabeležena.")).toBeTruthy();
      expect(screen.queryByTestId("last-unit-price-7048")).toBeNull();
      expect(screen.queryByTestId("last-unit-price-7049")).toBeNull();
      expect(screen.queryByTestId("last-unit-price-7050")).toBeNull();
    } finally {
      Object.assign(article, { mappings: originalMappings });
    }
  });

  it("sends internal notes and supplier instructions in separate fields", async () => {
    mocks.mutation.mockResolvedValue(mocks.order);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <NarocilaDobaviteljem />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Osnutek · Mlekarna Planika/ }));
    fireEvent.change(screen.getByLabelText(/Interna opomba/), {
      target: { value: "Samo za ekipo." },
    });
    fireEvent.change(screen.getByLabelText(/Navodilo dobavitelju/), {
      target: { value: "Dostavite pred 10. uro." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Shrani osnutek" }));

    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledWith({
      data: {
        supplierId: "supplier-704",
        expectedDeliveryDate: null,
        internalNotes: "Samo za ekipo.",
        supplierNotes: "Dostavite pred 10. uro.",
        lines: [{ supplierMappingId: 7042, packageQuantity: 3, unitPrice: 22.5 }],
      },
    }));
  });

  it("copies an internal note only on request and prints the reviewed supplier text after saving", async () => {
    const internalNote = "INTERNAL ONLY: pred dostavo pokličite.";
    const existingInstruction = "Dostavite pred 10. uro.";
    const copiedInstruction = `${existingInstruction}\n\n${internalNote}`;
    const reviewedInstruction = `${copiedInstruction}\nProsim, pokličite ob prihodu.`;
    mocks.mutation.mockImplementation(async (input: any) => {
      Object.assign(mocks.order, {
        internalNotes: input.data.internalNotes,
        supplierNotes: input.data.supplierNotes,
      });
      return mocks.order;
    });

    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <NarocilaDobaviteljem />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Osnutek · Mlekarna Planika/ }));
    const internalField = screen.getByLabelText(/Interna opomba/) as HTMLTextAreaElement;
    const supplierField = screen.getByLabelText(/Navodilo dobavitelju/) as HTMLTextAreaElement;
    fireEvent.change(internalField, { target: { value: internalNote } });
    fireEvent.change(supplierField, { target: { value: existingInstruction } });

    expect(screen.queryByTestId("supplier-order-print")).toBeNull();
    fireEvent.click(screen.getByTestId("button-copy-internal-to-supplier"));
    expect(internalField.value).toBe(internalNote);
    expect(supplierField.value).toBe(copiedInstruction);

    fireEvent.click(screen.getByTestId("button-copy-internal-to-supplier"));
    expect(supplierField.value).toBe(copiedInstruction);
    expect(screen.queryByTestId("supplier-order-print")).toBeNull();

    fireEvent.change(supplierField, { target: { value: reviewedInstruction } });
    expect(supplierField.value).toBe(reviewedInstruction);
    fireEvent.click(screen.getByRole("button", { name: "Shrani osnutek" }));
    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledWith({
      data: {
        supplierId: "supplier-704",
        expectedDeliveryDate: null,
        internalNotes: internalNote,
        supplierNotes: reviewedInstruction,
        lines: [{ supplierMappingId: 7042, packageQuantity: 3, unitPrice: 22.5 }],
      },
    }));
    await waitFor(() => expect(screen.getByTestId("text-supplier-order-print-instructions").textContent).toBe(reviewedInstruction));

    const printView = document.querySelector(".supplier-order-print");
    expect(printView?.textContent).not.toContain("Interna opomba");
    fireEvent.click(screen.getByTestId("button-print-supplier-order-704"));
    expect(print).toHaveBeenCalledOnce();
    expect(mocks.markSent).not.toHaveBeenCalled();
  });

  it("does not truncate existing supplier instructions when the copied note would exceed the limit", () => {
    const internalNote = "i".repeat(30);
    const existingInstruction = "s".repeat(1990);
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    render(
      <QueryClientProvider client={queryClient}>
        <NarocilaDobaviteljem />
      </QueryClientProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: /Osnutek · Mlekarna Planika/ }));
    const internalField = screen.getByLabelText(/Interna opomba/) as HTMLTextAreaElement;
    const supplierField = screen.getByLabelText(/Navodilo dobavitelju/) as HTMLTextAreaElement;
    fireEvent.change(internalField, { target: { value: internalNote } });
    fireEvent.change(supplierField, { target: { value: existingInstruction } });

    const copyButton = screen.getByTestId("button-copy-internal-to-supplier");
    expect(copyButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("presegla omejitev 2000 znakov");
    fireEvent.click(copyButton);

    expect(internalField.value).toBe(internalNote);
    expect(supplierField.value).toBe(existingInstruction);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("prefills the next suggested order with the latest price for the current package size", () => {
    const article = mocks.dashboard.articles[0];
    const mapping = article.mappings[0];
    const originalArticle = {
      suggestedBaseQuantity: article.suggestedBaseQuantity,
      suggestedPackageQuantity: article.suggestedPackageQuantity,
    };
    const originalMapping = {
      packageName: mapping.packageName,
      packageFactor: mapping.packageFactor,
      lastPackagePrice: mapping.lastPackagePrice,
    };
    try {
      article.suggestedBaseQuantity = 16;
      article.suggestedPackageQuantity = 2;
      mapping.packageName = "zaboj 8";
      mapping.packageFactor = 8;
      mapping.lastPackagePrice = 30;

      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={queryClient}>
          <NarocilaDobaviteljem />
        </QueryClientProvider>,
      );

      fireEvent.click(screen.getByRole("button", { name: /Osnutek · Mlekarna Planika/ }));

      expect(screen.getByText(/faktor 8/)).toBeTruthy();
      expect((screen.getByLabelText("Količina pakiranj Mleko 3,5 %") as HTMLInputElement).value).toBe("2");
      expect((screen.getByLabelText("Cena pakiranja Mleko 3,5 %") as HTMLInputElement).value).toBe("30");
    } finally {
      Object.assign(article, originalArticle);
      Object.assign(mapping, originalMapping);
    }
  });

  it("requires a quantity check before preparing a receipt when the package changed", async () => {
    const originalStatus = mocks.order.status;
    const originalCurrentPackageFactor = mocks.order.lines[0].currentPackageFactor;
    mocks.order.status = "sent";
    mocks.order.lines[0].currentPackageFactor = 8;
    mocks.mutation.mockResolvedValue({ id: 7045 });

    try {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={queryClient}>
          <NarocilaDobaviteljem />
        </QueryClientProvider>,
      );

      fireEvent.click(screen.getByTestId("tab-supplier-orders"));
      fireEvent.click(screen.getByTestId("button-open-supplier-order-704"));
      fireEvent.click(screen.getByRole("button", { name: "Pripravi prejemnico" }));

      await waitFor(() => expect(screen.getByRole("alertdialog")).toBeTruthy());
      expect(screen.getByRole("alertdialog").textContent).toContain("6 L / pak.");
      expect(screen.getByRole("alertdialog").textContent).toContain("8 L / pak.");
      expect(mocks.mutation).not.toHaveBeenCalled();
      expect((screen.getByRole("button", { name: "Nadaljuj na prejemnico" }) as HTMLButtonElement).disabled).toBe(true);

      fireEvent.click(screen.getByRole("checkbox", { name: /Preveril\/-a sem dejansko količino/ }));
      fireEvent.click(screen.getByRole("button", { name: "Nadaljuj na prejemnico" }));

      await waitFor(() => expect(mocks.mutation).toHaveBeenCalledWith({
        data: expect.objectContaining({
          postavke: [{
            artikelId: 7043,
            supplierOrderLineId: 7041,
            kolicina: 12,
            cenaKos: 3,
            skupaj: undefined,
            izvKolicina: 12,
            izvCena: 3,
            izvEnota: "L",
            enotVPaketu: 1,
          }],
        }),
      }));
      expect(mocks.navigate).toHaveBeenCalledWith("/zaloge?prejemnica=7045");
    } finally {
      mocks.order.status = originalStatus;
      mocks.order.lines[0].currentPackageFactor = originalCurrentPackageFactor;
    }
  });

  it("prepares a receipt without a warning when the package is unchanged", async () => {
    const originalStatus = mocks.order.status;
    mocks.order.status = "sent";
    mocks.mutation.mockResolvedValue({ id: 7046 });

    try {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={queryClient}>
          <NarocilaDobaviteljem />
        </QueryClientProvider>,
      );

      fireEvent.click(screen.getByTestId("tab-supplier-orders"));
      fireEvent.click(screen.getByTestId("button-open-supplier-order-704"));
      fireEvent.click(screen.getByRole("button", { name: "Pripravi prejemnico" }));

      await waitFor(() => expect(mocks.mutation).toHaveBeenCalled());
      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(mocks.navigate).toHaveBeenCalledWith("/zaloge?prejemnica=7046");
    } finally {
      mocks.order.status = originalStatus;
    }
  });
});
