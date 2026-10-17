import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import NarocilaDobaviteljem from "./NarocilaDobaviteljem";

const mocks = vi.hoisted(() => ({
  markSent: vi.fn(),
  mutation: vi.fn(),
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
        lastPriceReceipt: { date: "2026-10-17", receiptNumber: "26100001" },
        active: true,
      }],
    }],
    orders: [],
  },
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
      refetch: vi.fn(),
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
    expect(mocks.markSent).not.toHaveBeenCalled();
    expect(mocks.mutation).not.toHaveBeenCalled();
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
    expect(source.textContent).toContain("26100001");
    expect(source.textContent).toContain("17.");
    expect(source.textContent).toContain("2026");
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
});
