import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
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
    notes: "Prosimo za dostavo do 10.00.\nHvala.",
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
}));

vi.mock("@workspace/api-client-react", async () => {
  const actual = await vi.importActual("@workspace/api-client-react");
  const mutation = () => ({ mutateAsync: mocks.mutation, isPending: false });
  return {
    ...actual as any,
    useGetSupplierOrderDashboard: () => ({
      data: { articles: [], orders: [] },
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
        notes: mocks.order.notes,
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
    expect(screen.getByTestId("text-supplier-order-print-notes").textContent).toContain("Prosimo za dostavo do 10.00.");
    expect(screen.getByTestId("text-supplier-order-print-notes").textContent).toContain("Hvala.");

    fireEvent.click(screen.getByTestId("button-print-supplier-order-704"));

    expect(print).toHaveBeenCalledOnce();
    expect(mocks.markSent).not.toHaveBeenCalled();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });
});
