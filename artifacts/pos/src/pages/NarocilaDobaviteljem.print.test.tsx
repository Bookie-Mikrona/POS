import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { QueryClient, QueryClientProvider, useQuery } from "@tanstack/react-query";
import { aroundPosNavigation } from "@/lib/route-navigation-guard";
import NarocilaDobaviteljem from "./NarocilaDobaviteljem";

const mocks = vi.hoisted(() => ({
  markSent: vi.fn(),
  mutation: vi.fn(),
  navigate: vi.fn(),
  aroundNavigation: null as any,
  supplierOrderSummaries: null as any[] | null,
  supplierOrderListFetches: [] as Array<{ status?: string; missingSupplierInstructionsOnly?: boolean }>,
  dashboardRefetchIntervals: [] as Array<number | false | undefined>,
  dashboardFetches: 0,
  queryDashboard: false,
  querySupplierOrderLists: false,
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
      receipts: [] as {
        receiptId: number;
        receiptNumber: string | null;
        supplierDocumentNumber: string | null;
        receiptDate: string;
        receivedBaseQuantity: number;
      }[],
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
  useLocation: () => [
    "/narocila-dobaviteljem",
    (to: string, options?: any) => {
      if (mocks.aroundNavigation) {
        mocks.aroundNavigation(mocks.navigate, to, options);
      } else {
        mocks.navigate(to, options);
      }
    },
  ],
}));

vi.mock("@workspace/api-client-react", async () => {
  const actual = await vi.importActual<any>("@workspace/api-client-react");
  const mutation = () => ({ mutateAsync: mocks.mutation, isPending: false });
  return {
    ...actual as any,
    useGetSupplierOrderDashboard: (options?: any) => {
      mocks.dashboardRefetchIntervals.push(options?.query?.refetchInterval);
      if (mocks.queryDashboard) {
        const query = useQuery({
          ...options?.query,
          queryKey: actual.getGetSupplierOrderDashboardQueryKey(),
          queryFn: () => {
            mocks.dashboardFetches += 1;
            return mocks.dashboard;
          },
          initialData: mocks.dashboard,
        });
        return {
          data: query.data,
          isLoading: query.isLoading,
          isError: query.isError,
          refetch: query.refetch,
        };
      }
      return {
        data: mocks.dashboard,
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
    },
    useListSupplierOrders: (params?: { status?: string; missingSupplierInstructionsOnly?: boolean }) => {
      const getSummaries = () => {
        const summaries = mocks.supplierOrderSummaries ?? [{
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
        }];
        const statusFiltered = params?.status
          ? summaries.filter(order => order.status === params.status)
          : summaries;
        return params?.missingSupplierInstructionsOnly
          ? statusFiltered.filter(order => Boolean(order.internalNotes?.trim()) && !order.supplierNotes?.trim())
          : statusFiltered.slice(0, 200);
      };
      const query = mocks.querySupplierOrderLists
        ? useQuery({
          queryKey: actual.getListSupplierOrdersQueryKey(params),
          queryFn: () => {
            mocks.supplierOrderListFetches.push(params ?? {});
            return getSummaries();
          },
          initialData: getSummaries,
        })
        : null;
      if (!query) {
        return {
          data: getSummaries(),
          isLoading: false,
          isError: false,
          refetch: vi.fn(),
        };
      }
      return {
        data: query.data,
        isLoading: query.isLoading,
        isError: query.isError,
        refetch: query.refetch,
      };
    },
    useListSupplierOrdersMissingInstructions: (params: { status?: string; search?: string; page: number; pageSize: number }) => {
      const getPage = () => {
        const normalize = (value: string) => value.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("sl");
        const search = normalize(params.search?.trim() ?? "");
        const filtered = (mocks.supplierOrderSummaries ?? [mocks.order]).filter(order =>
          (!params.status || order.status === params.status)
          && Boolean(order.internalNotes?.trim())
          && !order.supplierNotes?.trim()
          && (!search || normalize(`${order.number} ${order.supplierName}`).includes(search)),
        );
        const offset = (params.page - 1) * params.pageSize;
        return {
          orders: filtered.slice(offset, offset + params.pageSize),
          total: filtered.length,
          page: params.page,
          pageSize: params.pageSize,
        };
      };
      const query = mocks.querySupplierOrderLists
        ? useQuery({
          queryKey: actual.getListSupplierOrdersMissingInstructionsQueryKey(params),
          queryFn: () => {
            mocks.supplierOrderListFetches.push({ ...params, missingSupplierInstructionsOnly: true });
            return getPage();
          },
          initialData: getPage,
        })
        : null;
      return query ?? {
        data: getPage(),
        isLoading: false,
        isError: false,
        refetch: vi.fn(),
      };
    },
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

type EditorDismissal = "close-button" | "cancel-button" | "outside-click";

function renderSupplierOrderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <NarocilaDobaviteljem />
    </QueryClientProvider>,
  );
}

async function prepareHistoryAtSupplierOrder() {
  window.history.replaceState(null, "", "/history-before-supplier-order");
  window.history.pushState(null, "", "/narocila-dobaviteljem");
  window.history.pushState(null, "", "/history-after-supplier-order");
  await act(async () => {
    window.history.back();
    await waitFor(() => expect(window.location.pathname).toBe("/narocila-dobaviteljem"));
  });
  return window.history.state;
}

async function traverseHistoryAndWait(
  direction: "back" | "forward",
  expectedPath: string,
) {
  await act(async () => {
    window.history[direction]();
    await waitFor(() => expect(window.location.pathname).toBe(expectedPath));
  });
}

function receiptDateDaysAgo(daysAgo: number) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "Europe/Ljubljana",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const partValue = (type: string) => Number(parts.find(part => part.type === type)?.value);
  const timestamp = Date.UTC(
    partValue("year"),
    partValue("month") - 1,
    partValue("day") - daysAgo,
  );
  return new Date(timestamp).toISOString().slice(0, 10);
}

function expectedReceiptDate(value: string) {
  return new Intl.DateTimeFormat("sl-SI", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(new Date(`${value}T00:00:00.000Z`));
}

function openNewOrderEditor() {
  fireEvent.click(screen.getByRole("button", { name: "Novo naročilo" }));
  return screen.getByRole("dialog", { name: "Naročilo dobavitelju" });
}

function openSavedDraftEditor() {
  fireEvent.click(screen.getByTestId("tab-supplier-orders"));
  fireEvent.click(screen.getByTestId("button-open-supplier-order-704"));
  fireEvent.click(screen.getByRole("button", { name: "Uredi osnutek" }));
  return screen.getByRole("dialog", { name: "Naročilo dobavitelju" });
}

function dismissOrderEditor(method: EditorDismissal) {
  if (method === "close-button") {
    fireEvent.click(screen.getByTestId("button-close-supplier-order-editor"));
  } else if (method === "cancel-button") {
    fireEvent.click(screen.getByTestId("button-cancel-supplier-order-editor"));
  } else {
    fireEvent.mouseDown(screen.getByTestId("supplier-order-editor-backdrop"));
  }
}

describe("supplier order print view", () => {
  const print = vi.fn();

  beforeEach(() => {
    mocks.markSent.mockReset();
    mocks.mutation.mockReset();
    mocks.navigate.mockReset();
    mocks.aroundNavigation = aroundPosNavigation;
    mocks.supplierOrderSummaries = null;
    mocks.supplierOrderListFetches = [];
    mocks.dashboardRefetchIntervals = [];
    mocks.dashboardFetches = 0;
    mocks.queryDashboard = false;
    mocks.querySupplierOrderLists = false;
    mocks.order.id = 704;
    mocks.order.number = "N-2026-0704";
    mocks.order.status = "draft";
    mocks.order.internalNotes = "INTERNAL ONLY: preveriti stanje embalaže.";
    mocks.order.supplierNotes = "Prosimo za dostavo do 10.00.\nHvala.";
    print.mockReset();
    Object.defineProperty(window, "print", { configurable: true, value: print });
  });

  afterEach(() => cleanup());

  it("polls the reorder dashboard only while suggestions are open", () => {
    renderSupplierOrderPage();

    expect(mocks.dashboardRefetchIntervals.at(-1)).toBe(30_000);
    fireEvent.click(screen.getByTestId("tab-supplier-orders"));
    expect(mocks.dashboardRefetchIntervals.at(-1)).toBe(false);

    fireEvent.click(screen.getByRole("button", { name: /^Predlogi/ }));
    expect(mocks.dashboardRefetchIntervals.at(-1)).toBe(30_000);
  });

  it("updates reorder savings on refresh without replacing edited order quantities", async () => {
    const originalDashboard = mocks.dashboard;
    const article = originalDashboard.articles[0];
    const alternateOffer = {
      ...article.mappings[0],
      id: 7061,
      supplierId: "supplier-7061",
      supplierName: "Mlekarna Ugodna",
      supplierItemName: "Mleko akcijsko",
      lastPackagePrice: 18,
      lastUnitPrice: 3,
    };
    mocks.dashboard = {
      ...originalDashboard,
      articles: [{
        ...article,
        mappings: [...article.mappings, alternateOffer],
      }],
    };
    mocks.queryDashboard = true;
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });

    try {
      render(
        <QueryClientProvider client={queryClient}>
          <NarocilaDobaviteljem />
        </QueryClientProvider>,
      );
      expect(screen.getByTestId("supplier-total-savings-7061").textContent).toContain("15 L");
      expect(screen.getByTestId("supplier-total-savings-7061").textContent).toContain("11,25");

      fireEvent.click(screen.getByRole("button", { name: "Novo naročilo" }));
      fireEvent.change(screen.getByRole("combobox", { name: "Dobavitelj" }), {
        target: { value: "supplier-704" },
      });
      fireEvent.change(screen.getByRole("combobox", { name: "Dodaj postavko" }), {
        target: { value: "7042" },
      });
      const quantityInput = screen.getByRole("spinbutton", { name: "Količina pakiranj Mleko 3,5 %" });
      fireEvent.change(quantityInput, { target: { value: "8" } });

      const previousFetches = mocks.dashboardFetches;
      mocks.dashboard = {
        ...mocks.dashboard,
        articles: [{
          ...mocks.dashboard.articles[0],
          onHand: 1,
          openOrderQuantity: 4,
          suggestedBaseQuantity: 12,
          suggestedPackageQuantity: 2,
        }],
      };

      fireEvent.click(screen.getByRole("button", { name: "Osveži" }));

      await waitFor(() => {
        expect(mocks.dashboardFetches).toBeGreaterThan(previousFetches);
        expect(screen.getByTestId("supplier-total-savings-7061").textContent).toContain("12 L");
        expect(screen.getByTestId("supplier-total-savings-7061").textContent).toContain("9,00");
      });
      expect(quantityInput).toHaveProperty("value", "8");
    } finally {
      cleanup();
      queryClient.clear();
      mocks.dashboard = originalDashboard;
      mocks.queryDashboard = false;
    }
  });

  it("prints the selected order details without marking it as sent", () => {
    const supplierInstructions = "Prosimo za dostavo do 10.00. 🚚\nOdložite pri zadnjem vhodu.\nHvala.";
    mocks.order.supplierNotes = supplierInstructions;
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
    const instructions = screen.getByTestId("text-supplier-order-print-instructions");
    expect(instructions.textContent).toBe(supplierInstructions);
    expect(instructions.style.whiteSpace).toBe("pre-wrap");
    expect(document.querySelector(".supplier-order-print")?.textContent).not.toContain("INTERNAL ONLY");
    expect(screen.getByText("INTERNAL ONLY: preveriti stanje embalaže.")).toBeTruthy();

    fireEvent.click(screen.getByTestId("button-print-supplier-order-704"));

    expect(print).toHaveBeenCalledOnce();
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(mocks.markSent).not.toHaveBeenCalled();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("prints the package snapshot saved on the order after the supplier mapping changes", () => {
    const line = mocks.order.lines[0];
    const originalLine = { ...line };
    Object.assign(line, {
      packageName: "zaboj 6",
      packageFactor: 6,
      currentPackageFactor: 8,
      baseUnit: "L",
    });

    try {
      renderSupplierOrderPage();
      fireEvent.click(screen.getByTestId("tab-supplier-orders"));
      fireEvent.click(screen.getByTestId("button-open-supplier-order-704"));

      const printedLine = screen.getByTestId("row-supplier-order-print-7041");
      expect(printedLine.textContent).toContain("zaboj 6");
      expect(printedLine.textContent).toContain("1 pak. = 6 L");
      expect(printedLine.textContent).not.toContain("1 pak. = 8 L");
    } finally {
      Object.assign(line, originalLine);
    }
  });

  it("shows confirmed receipts for an order line and opens the selected receipt read-only", () => {
    const originalOrder = {
      status: mocks.order.status,
      openQuantity: mocks.order.openQuantity,
      lines: mocks.order.lines,
    };
    mocks.order.status = "partially_received";
    mocks.order.openQuantity = 6;
    mocks.order.lines = [{
      ...mocks.order.lines[0],
      receivedBaseQuantity: 6,
      openBaseQuantity: 6,
      receipts: [{
        receiptId: 7044,
        receiptNumber: "26100001",
        supplierDocumentNumber: "R-54",
        receiptDate: "2026-10-17",
        receivedBaseQuantity: 6,
      }],
    }];

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
      fireEvent.click(screen.getByTestId("button-toggle-order-line-receipts-7041"));

      const receipts = screen.getByTestId("order-line-receipts-7041");
      expect(receipts.textContent).toContain("Prejemnica 26100001");
      expect(receipts.textContent).toContain("R-54");
      expect(receipts.textContent).toContain("17. okt. 2026");
      expect(screen.getByTestId("text-order-line-receipts-total-7041").textContent).toContain("6 L");

      fireEvent.click(screen.getByTestId("button-open-order-receipt-7044"));
      expect(mocks.navigate).toHaveBeenCalledWith("/zaloge?prejemnica=7044&nacin=ogled");
    } finally {
      mocks.order.status = originalOrder.status;
      mocks.order.openQuantity = originalOrder.openQuantity;
      mocks.order.lines = originalOrder.lines;
    }
  });

  it("filters orders with an internal note but no supplier instructions without copying or changing them", () => {
    const internalNote = "INTERNAL ONLY: preveriti stanje embalaže.";
    const sharedSummary = {
      supplierId: mocks.order.supplierId,
      supplierName: mocks.order.supplierName,
      status: mocks.order.status,
      createdAt: mocks.order.createdAt,
      expectedDeliveryDate: mocks.order.expectedDeliveryDate,
      lineCount: mocks.order.lineCount,
      openQuantity: mocks.order.openQuantity,
    };
    mocks.order.internalNotes = internalNote;
    mocks.order.supplierNotes = "";
    mocks.supplierOrderSummaries = [
      {
        ...sharedSummary,
        id: 704,
        number: "N-2026-0704",
        internalNotes: internalNote,
        supplierNotes: " \n ",
      },
      {
        ...sharedSummary,
        id: 705,
        number: "N-2026-0705",
        internalNotes: " \n ",
        supplierNotes: null,
      },
      {
        ...sharedSummary,
        id: 706,
        number: "N-2026-0706",
        internalNotes: internalNote,
        supplierNotes: "Prosimo, dostavite pred 10. uro.",
      },
    ];
    renderSupplierOrderPage();
    fireEvent.click(screen.getByTestId("tab-supplier-orders"));

    expect(screen.getByTestId("row-supplier-order-704")).toBeTruthy();
    expect(screen.getByTestId("row-supplier-order-705")).toBeTruthy();
    expect(screen.getByTestId("row-supplier-order-706")).toBeTruthy();
    expect(screen.queryByText(internalNote)).toBeNull();

    fireEvent.click(screen.getByTestId("filter-orders-missing-supplier-instructions"));

    const filterButton = screen.getByTestId("filter-orders-missing-supplier-instructions");
    expect(filterButton.getAttribute("aria-pressed")).toBe("true");
    expect(filterButton.textContent).toContain("1");
    expect(screen.getByTestId("row-supplier-order-704")).toBeTruthy();
    expect(screen.queryByTestId("row-supplier-order-705")).toBeNull();
    expect(screen.queryByTestId("row-supplier-order-706")).toBeNull();
    expect(screen.queryByText(internalNote)).toBeNull();

    fireEvent.click(screen.getByTestId("button-open-supplier-order-704"));
    expect(screen.getByText(internalNote)).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Uredi osnutek" }));
    expect((screen.getByLabelText(/Interna opomba/) as HTMLTextAreaElement).value).toBe(internalNote);
    expect((screen.getByLabelText(/Navodilo dobavitelju/) as HTMLTextAreaElement).value).toBe("");
    expect(mocks.order.supplierNotes).toBe("");
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("shows missing-instruction orders beyond the latest-200 limit", () => {
    const sharedSummary = {
      supplierId: mocks.order.supplierId,
      supplierName: "Nedavni dobavitelj",
      status: "draft",
      createdAt: mocks.order.createdAt,
      expectedDeliveryDate: null,
      lineCount: 0,
      openQuantity: 0,
      internalNotes: null,
      supplierNotes: null,
    };
    const recentOrders = Array.from({ length: 200 }, (_, index) => ({
      ...sharedSummary,
      id: 2000 + index,
      number: `N-2026-${String(index).padStart(4, "0")}`,
    }));
    const olderOrder = {
      ...sharedSummary,
      id: 1999,
      number: "N-2010-1999",
      supplierName: "Zgodovinski dobavitelj",
      status: "sent",
      createdAt: "2010-01-01T10:00:00.000Z",
      internalNotes: "Starejša interna opomba.",
      supplierNotes: " \n ",
    };
    mocks.supplierOrderSummaries = [...recentOrders, olderOrder];
    renderSupplierOrderPage();
    fireEvent.click(screen.getByTestId("tab-supplier-orders"));

    expect(screen.queryByTestId("row-supplier-order-1999")).toBeNull();
    const filterButton = screen.getByTestId("filter-orders-missing-supplier-instructions");
    expect(filterButton.textContent).toContain("1");
    fireEvent.click(filterButton);

    expect(screen.getByTestId("row-supplier-order-1999")).toBeTruthy();
    expect(screen.queryByTestId("row-supplier-order-2000")).toBeNull();
  });

  it("removes a saved old order from the missing-instructions review and refreshes both list caches", async () => {
    const recentOrders = Array.from({ length: 200 }, (_, index) => ({
      id: 2000 + index,
      number: `N-2026-${String(index).padStart(4, "0")}`,
      supplierId: "supplier-704",
      supplierName: "Nedavni dobavitelj",
      status: "draft",
      createdAt: mocks.order.createdAt,
      expectedDeliveryDate: null,
      lineCount: 0,
      openQuantity: 0,
      internalNotes: null,
      supplierNotes: null,
    }));
    const oldOrder = {
      id: 1999,
      number: "N-2010-1999",
      supplierId: "supplier-704",
      supplierName: "Zgodovinski dobavitelj",
      status: "draft",
      createdAt: "2010-01-01T10:00:00.000Z",
      expectedDeliveryDate: null,
      lineCount: 1,
      openQuantity: 12,
      internalNotes: "Starejša interna opomba.",
      supplierNotes: null,
    };
    Object.assign(mocks.order, {
      id: oldOrder.id,
      number: oldOrder.number,
      supplierName: oldOrder.supplierName,
      status: oldOrder.status,
      internalNotes: oldOrder.internalNotes,
      supplierNotes: "",
    });
    mocks.supplierOrderSummaries = [...recentOrders, oldOrder];
    mocks.querySupplierOrderLists = true;
    mocks.mutation.mockImplementation(async ({ data }: any) => {
      Object.assign(mocks.order, {
        internalNotes: data.internalNotes,
        supplierNotes: data.supplierNotes,
      });
      Object.assign(oldOrder, {
        internalNotes: data.internalNotes,
        supplierNotes: data.supplierNotes,
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
    fireEvent.click(screen.getByTestId("tab-supplier-orders"));
    fireEvent.click(screen.getByTestId("filter-orders-missing-supplier-instructions"));

    const missingInstructionsFilter = screen.getByTestId("filter-orders-missing-supplier-instructions");
    expect(missingInstructionsFilter.textContent).toContain("1");
    expect(screen.getByTestId("row-supplier-order-1999")).toBeTruthy();
    await waitFor(() => {
      expect(mocks.supplierOrderListFetches).toEqual(expect.arrayContaining([
        {},
        expect.objectContaining({ missingSupplierInstructionsOnly: true, page: 1, pageSize: 50 }),
      ]));
    });
    const regularFetchesBeforeSave = mocks.supplierOrderListFetches.filter(params => !params.missingSupplierInstructionsOnly).length;
    const historyFetchesBeforeSave = mocks.supplierOrderListFetches.filter(params => params.missingSupplierInstructionsOnly).length;

    fireEvent.click(screen.getByTestId("button-open-supplier-order-1999"));
    fireEvent.click(screen.getByRole("button", { name: "Uredi osnutek" }));
    fireEvent.change(screen.getByLabelText(/Navodilo dobavitelju/), {
      target: { value: "Dostavite pred 10. uro." },
    });
    fireEvent.click(screen.getByRole("button", { name: "Shrani osnutek" }));

    await waitFor(() => {
      expect(screen.queryByTestId("row-supplier-order-1999")).toBeNull();
      expect(missingInstructionsFilter.textContent).toContain("0");
      expect(mocks.supplierOrderListFetches.filter(params => !params.missingSupplierInstructionsOnly).length)
        .toBeGreaterThan(regularFetchesBeforeSave);
      expect(mocks.supplierOrderListFetches.filter(params => params.missingSupplierInstructionsOnly).length)
        .toBeGreaterThan(historyFetchesBeforeSave);
    });
  });

  it("searches supplier orders by number or supplier without exposing internal notes", () => {
    const internalNote = "INTERNAL ONLY: unique note search token";
    const sharedSummary = {
      supplierId: mocks.order.supplierId,
      createdAt: mocks.order.createdAt,
      expectedDeliveryDate: mocks.order.expectedDeliveryDate,
      lineCount: mocks.order.lineCount,
      openQuantity: mocks.order.openQuantity,
    };
    mocks.supplierOrderSummaries = [
      {
        ...sharedSummary,
        id: 704,
        number: "N-2026-0704",
        supplierName: "Mlekarna Planika",
        status: "draft",
        internalNotes: internalNote,
        supplierNotes: "",
      },
      {
        ...sharedSummary,
        id: 705,
        number: "N-2026-0705",
        supplierName: "Kmetija Domače",
        status: "sent",
        internalNotes: "INTERNAL ONLY: second private note",
        supplierNotes: "Dostavite pred 10. uro.",
      },
    ];
    renderSupplierOrderPage();
    fireEvent.click(screen.getByTestId("tab-supplier-orders"));
    const search = screen.getByTestId("input-search-supplier-orders") as HTMLInputElement;

    fireEvent.change(search, { target: { value: "0704" } });
    expect(screen.getByTestId("row-supplier-order-704")).toBeTruthy();
    expect(screen.queryByTestId("row-supplier-order-705")).toBeNull();

    for (const value of ["domace", "domače", "  DOMAČE  ", "domac\u030ce"]) {
      fireEvent.change(search, { target: { value } });
      expect(screen.getByTestId("row-supplier-order-705")).toBeTruthy();
      expect(screen.queryByTestId("row-supplier-order-704")).toBeNull();
      expect(screen.getByTestId("row-supplier-order-705").textContent).toContain("Kmetija Domače");
      expect(screen.getByTestId("row-supplier-order-705").textContent).toContain("N-2026-0705");
    }

    fireEvent.change(search, { target: { value: "Kmetija" } });
    expect(screen.getByTestId("row-supplier-order-705")).toBeTruthy();
    expect(screen.queryByTestId("row-supplier-order-704")).toBeNull();

    fireEvent.change(search, { target: { value: internalNote } });
    expect(screen.getByText("Ni zadetkov za iskanje")).toBeTruthy();
    expect(screen.queryByTestId("row-supplier-order-704")).toBeNull();
    expect(screen.queryByTestId("row-supplier-order-705")).toBeNull();
    expect(screen.queryByText(internalNote)).toBeNull();
  });

  it("combines supplier-order search with status and missing-instruction filters", () => {
    const internalNote = "PRIVATE internal note";
    const sharedSummary = {
      supplierId: mocks.order.supplierId,
      createdAt: mocks.order.createdAt,
      expectedDeliveryDate: mocks.order.expectedDeliveryDate,
      lineCount: mocks.order.lineCount,
      openQuantity: mocks.order.openQuantity,
      internalNotes: internalNote,
    };
    mocks.supplierOrderSummaries = [
      {
        ...sharedSummary,
        id: 710,
        number: "N-2026-0710",
        supplierName: "Mlekarna Planika",
        status: "draft",
        supplierNotes: null,
      },
      {
        ...sharedSummary,
        id: 711,
        number: "N-2026-0711",
        supplierName: "Mlekarna Planika",
        status: "sent",
        supplierNotes: "Dostavite pred 10. uro.",
      },
      {
        ...sharedSummary,
        id: 712,
        number: "N-2026-0712",
        supplierName: "Mlekarna Planika",
        status: "sent",
        supplierNotes: null,
      },
      {
        ...sharedSummary,
        id: 713,
        number: "N-2026-0713",
        supplierName: "Domače dobrote",
        status: "sent",
        supplierNotes: null,
      },
    ];
    renderSupplierOrderPage();
    fireEvent.click(screen.getByTestId("tab-supplier-orders"));

    fireEvent.change(screen.getByTestId("input-search-supplier-orders"), {
      target: { value: "planika" },
    });
    fireEvent.change(screen.getAllByRole("combobox", { name: "Filtriraj naročila po statusu" })[0], {
      target: { value: "sent" },
    });
    fireEvent.click(screen.getByTestId("filter-orders-missing-supplier-instructions"));

    expect(screen.getByTestId("row-supplier-order-712")).toBeTruthy();
    expect(screen.queryByTestId("row-supplier-order-710")).toBeNull();
    expect(screen.queryByTestId("row-supplier-order-711")).toBeNull();
    expect(screen.queryByTestId("row-supplier-order-713")).toBeNull();

    fireEvent.change(screen.getByTestId("input-search-supplier-orders"), {
      target: { value: "0711" },
    });
    expect(screen.getByText("Ni zadetkov za iskanje")).toBeTruthy();
    expect(screen.queryByTestId("row-supplier-order-712")).toBeNull();

    const resetButton = screen.getByRole("button", { name: "Ponastavi iskanje in filtre" });
    fireEvent.click(resetButton);

    expect((screen.getByTestId("input-search-supplier-orders") as HTMLInputElement).value).toBe("");
    for (const statusSelect of screen.getAllByRole("combobox", { name: "Filtriraj naročila po statusu" })) {
      expect(statusSelect).toHaveProperty("value", "all");
    }
    expect(screen.getByTestId("filter-orders-missing-supplier-instructions").getAttribute("aria-pressed")).toBe("false");
    for (const orderId of [710, 711, 712, 713]) {
      expect(screen.getByTestId(`row-supplier-order-${orderId}`)).toBeTruthy();
    }
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

  it("closes the print warning with Escape, restores focus to the print button, and does not print", () => {
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
    const printButton = screen.getByTestId("button-print-supplier-order-704");
    fireEvent.click(printButton);

    const warning = screen.getByRole("alertdialog");
    expect(document.activeElement).toBe(warning);
    expect(print).not.toHaveBeenCalled();

    fireEvent.keyDown(warning, { key: "Escape", code: "Escape" });

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(document.activeElement).toBe(printButton);
    expect(print).not.toHaveBeenCalled();
  });

  it("keeps Tab and Shift+Tab within the print warning actions", () => {
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
    const printButton = screen.getByTestId("button-print-supplier-order-704");
    fireEvent.click(printButton);

    const warning = screen.getByRole("alertdialog");
    const firstAction = screen.getByTestId("button-dismiss-supplier-order-print-warning");
    const lastAction = screen.getByTestId("button-continue-supplier-order-print");
    expect(document.activeElement).toBe(warning);

    fireEvent.keyDown(warning, { key: "Tab", code: "Tab" });
    expect(document.activeElement).toBe(firstAction);
    expect(warning.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(printButton);

    warning.focus();
    fireEvent.keyDown(warning, { key: "Tab", code: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(lastAction);
    expect(warning.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(printButton);

    fireEvent.keyDown(lastAction, { key: "Tab", code: "Tab" });
    expect(document.activeElement).toBe(firstAction);
    expect(warning.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(printButton);

    fireEvent.keyDown(firstAction, { key: "Tab", code: "Tab", shiftKey: true });
    expect(document.activeElement).toBe(lastAction);
    expect(warning.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(printButton);

    fireEvent.keyDown(lastAction, { key: "Tab", code: "Tab" });
    expect(document.activeElement).toBe(firstAction);
    expect(warning.contains(document.activeElement)).toBe(true);
    expect(print).not.toHaveBeenCalled();
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

  it("keeps Tab and Shift+Tab within the visible actions for a sent order warning", () => {
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

      const warning = screen.getByRole("alertdialog");
      expect(warning.textContent).toContain("naročila pa ni več mogoče urejati");
      expect(print).not.toHaveBeenCalled();

      const [firstAction, lastAction] = within(warning).getAllByRole("button");
      expect(firstAction).toBe(screen.getByTestId("button-dismiss-supplier-order-print-warning"));
      expect(lastAction).toBe(screen.getByTestId("button-continue-supplier-order-print"));
      expect(document.activeElement).toBe(warning);

      lastAction.focus();
      fireEvent.keyDown(lastAction, { key: "Tab", code: "Tab" });
      expect(document.activeElement).toBe(firstAction);
      expect(warning.contains(document.activeElement)).toBe(true);

      firstAction.focus();
      fireEvent.keyDown(firstAction, { key: "Tab", code: "Tab", shiftKey: true });
      expect(document.activeElement).toBe(lastAction);
      expect(warning.contains(document.activeElement)).toBe(true);

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

  it("opens the API-selected source receipt when multiple confirmed receipts share a date", () => {
    const mapping = mocks.dashboard.articles[0].mappings[0];
    const originalSource = mapping.lastPriceReceipt;
    const originalHistory = mapping.priceHistory;
    const receiptDate = "2026-10-17";
    mapping.lastPriceReceipt = {
      receiptId: 7184,
      date: receiptDate,
      receiptNumber: "WIN-7184",
    };
    mapping.priceHistory = [
      { receiptId: 7184, date: receiptDate, receiptNumber: "WIN-7184", unitPrice: 3.75 },
      { receiptId: 7012, date: receiptDate, receiptNumber: "LOW-7012", unitPrice: 3.5 },
    ];

    try {
      renderSupplierOrderPage();

      const source = screen.getByTestId("last-price-receipt-7042");
      expect(source.textContent).toContain("WIN-7184");
      expect(source.textContent).toContain(expectedReceiptDate(receiptDate));

      fireEvent.click(source);

      expect(mocks.navigate).toHaveBeenCalledExactlyOnceWith(
        "/zaloge?prejemnica=7184&nacin=ogled",
      );
      expect(mocks.navigate).not.toHaveBeenCalledWith(
        "/zaloge?prejemnica=7012&nacin=ogled",
      );
    } finally {
      mapping.lastPriceReceipt = originalSource;
      mapping.priceHistory = originalHistory;
    }
  });

  it("marks old prices, preserves their source and date, and treats missing dates as unknown", () => {
    const article = mocks.dashboard.articles[0];
    const originalMappings = article.mappings;
    const [preferred] = originalMappings;
    const recentDate = receiptDateDaysAgo(89);
    const staleDate = receiptDateDaysAgo(90);
    const recentPreferred = {
      ...preferred,
      lastPriceReceipt: { ...preferred.lastPriceReceipt, date: recentDate },
      priceHistory: preferred.priceHistory.map((entry: any, index: number) =>
        index === 0 ? { ...entry, date: recentDate } : entry,
      ),
    };
    const staleOffer = {
      ...preferred,
      id: 7059,
      supplierId: "supplier-717",
      supplierName: "Mlekarna Stara",
      supplierItemName: "Mleko iz stare cene",
      packageFactor: 8,
      lastPackagePrice: 20,
      lastUnitPrice: 2.5,
      lastPriceReceipt: { receiptId: 7109, date: staleDate, receiptNumber: "R-7109" },
      priceHistory: [{ receiptId: 7109, date: staleDate, receiptNumber: "R-7109", unitPrice: 2.5 }],
    };
    const missingDateOffer = {
      ...preferred,
      id: 7060,
      supplierId: "supplier-718",
      supplierName: "Mlekarna Brez Datuma",
      packageFactor: 6,
      lastPackagePrice: 27,
      lastUnitPrice: 4.5,
      lastPriceReceipt: { receiptId: 7110, date: null, receiptNumber: "R-7110" },
      priceHistory: [],
    };
    const missingReceiptOffer = {
      ...preferred,
      id: 7061,
      supplierId: "supplier-719",
      supplierName: "Mlekarna Brez Vira",
      packageFactor: 6,
      lastPackagePrice: 30,
      lastUnitPrice: 5,
      lastPriceReceipt: null,
      priceHistory: [],
    };
    Object.assign(article, {
      mappings: [recentPreferred, staleOffer, missingDateOffer, missingReceiptOffer],
    });

    try {
      renderSupplierOrderPage();

      expect(screen.queryByTestId("supplier-price-freshness-7042")).toBeNull();
      expect(screen.getByTestId("supplier-price-freshness-7059").textContent)
        .toContain("90 dni ali več");
      expect(screen.getByTestId("last-unit-price-7059").textContent).toContain("2,50");
      expect(screen.getByTestId("lowest-unit-price-7059").textContent)
        .toContain("Najnižja cena / enoto");
      expect(screen.getByTestId("supplier-savings-7059").textContent)
        .toContain("cenejša");
      const staleSource = screen.getByTestId("last-price-receipt-7059");
      expect(staleSource.textContent).toContain("R-7109");
      expect(staleSource.textContent).toContain(expectedReceiptDate(staleDate));

      expect(screen.getByTestId("supplier-price-freshness-7060").textContent)
        .toContain("ni znana");
      expect(screen.getByTestId("last-price-receipt-7060").textContent)
        .toContain("Datum ni znan");
      expect(screen.getByTestId("supplier-price-freshness-7061").textContent)
        .toContain("ni znana");
      expect(screen.getByTestId("last-price-source-7061").textContent)
        .toContain("Vir prejemnice ni zabeležen");
    } finally {
      Object.assign(article, { mappings: originalMappings });
    }
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

  it("highlights price increases, decreases, unchanged prices, and zero-price comparisons", () => {
    const mapping = mocks.dashboard.articles[0].mappings[0];
    const originalPriceHistory = mapping.priceHistory;
    mapping.priceHistory = [
      { receiptId: 7101, date: "2026-10-17", receiptNumber: "R-7101", unitPrice: 5 },
      { receiptId: 7102, date: "2026-10-16", receiptNumber: "R-7102", unitPrice: 4 },
      { receiptId: 7103, date: "2026-10-15", receiptNumber: "R-7103", unitPrice: 5 },
      { receiptId: 7104, date: "2026-10-14", receiptNumber: "R-7104", unitPrice: 5 },
      { receiptId: 7105, date: "2026-10-13", receiptNumber: "R-7105", unitPrice: 0 },
      { receiptId: 7106, date: "2026-10-12", receiptNumber: "R-7106", unitPrice: 3 },
      { receiptId: 7107, date: "2026-10-11", receiptNumber: "R-7107", unitPrice: 0 },
      { receiptId: 7108, date: "2026-10-10", receiptNumber: "R-7108", unitPrice: 0 },
    ];

    try {
      renderSupplierOrderPage();
      const history = screen.getByTestId("price-history-7042");
      fireEvent.click(within(history).getByText(/Zgodovina potrjenih cen/));
      const changeFor = (receiptId: number) =>
        screen.getByTestId(`price-history-change-7042-${receiptId}`).textContent ?? "";

      expect(changeFor(7101)).toContain("Podražitev");
      expect(changeFor(7101)).toMatch(/\+1,00\s?€/);
      expect(changeFor(7101)).toMatch(/\+25\s?%/);

      expect(changeFor(7102)).toContain("Pocenitev");
      expect(changeFor(7102)).toMatch(/−1,00\s?€/);
      expect(changeFor(7102)).toMatch(/−20\s?%/);

      expect(changeFor(7103)).toContain("Brez spremembe");
      expect(changeFor(7103)).toMatch(/0,00\s?€/);
      expect(changeFor(7103)).toMatch(/0\s?%/);

      expect(changeFor(7104)).toContain("Podražitev");
      expect(changeFor(7104)).toMatch(/\+5,00\s?€/);
      expect(changeFor(7104)).toContain("odstotek ni izračunljiv");
      expect(changeFor(7104)).not.toContain("%");

      expect(changeFor(7105)).toContain("Pocenitev");
      expect(changeFor(7105)).toMatch(/−3,00\s?€/);
      expect(changeFor(7105)).toMatch(/−100\s?%/);

      expect(changeFor(7106)).toContain("Podražitev");
      expect(changeFor(7106)).toMatch(/\+3,00\s?€/);
      expect(changeFor(7106)).toContain("odstotek ni izračunljiv");
      expect(changeFor(7106)).not.toContain("%");

      expect(changeFor(7107)).toContain("Brez spremembe");
      expect(changeFor(7107)).toMatch(/0,00\s?€/);
      expect(changeFor(7107)).not.toContain("%");
      expect(screen.queryByTestId("price-history-change-7042-7108")).toBeNull();
    } finally {
      mapping.priceHistory = originalPriceHistory;
    }
  });

  it("summarizes the net movement across the displayed saved base-unit prices", () => {
    const mapping = mocks.dashboard.articles[0].mappings[0];
    const originalPriceHistory = mapping.priceHistory;
    mapping.priceHistory = [
      { receiptId: 7111, date: "2026-10-17", receiptNumber: "R-7111", unitPrice: 5.5 },
      { receiptId: 7112, date: "2026-10-16", receiptNumber: "R-7112", unitPrice: 5 },
      { receiptId: 7113, date: "2026-10-15", receiptNumber: "R-7113", unitPrice: 4 },
      { receiptId: 7114, date: "2026-10-14", receiptNumber: "R-7114", unitPrice: 3 },
      { receiptId: 7115, date: "2026-10-13", receiptNumber: "R-7115", unitPrice: 2 },
    ];

    try {
      renderSupplierOrderPage();
      const history = screen.getByTestId("price-history-7042");
      fireEvent.click(within(history).getByText(/Zgodovina potrjenih cen/));
      const overallChange = within(history).getByTestId("price-history-overall-change-7042");

      expect(overallChange.textContent).toContain("Skupna sprememba od najstarejše do najnovejše prikazane cene");
      expect(overallChange.textContent).toMatch(/\+3,50\s?€/);
      expect(overallChange.textContent).toMatch(/\+175\s?%/);
      expect(overallChange.textContent).toContain("samo prikazane prejemnice");
      expect(screen.getByTestId("price-history-change-7042-7111").textContent)
        .toContain("Glede na prejšnjo potrjeno ceno");
    } finally {
      mapping.priceHistory = originalPriceHistory;
    }
  });

  it("explains that the overall percentage is unavailable when the oldest visible price is zero", () => {
    const mapping = mocks.dashboard.articles[0].mappings[0];
    const originalPriceHistory = mapping.priceHistory;
    mapping.priceHistory = [
      { receiptId: 7121, date: "2026-10-17", receiptNumber: "R-7121", unitPrice: 4 },
      { receiptId: 7122, date: "2026-10-16", receiptNumber: "R-7122", unitPrice: 0 },
    ];

    try {
      renderSupplierOrderPage();
      const history = screen.getByTestId("price-history-7042");
      fireEvent.click(within(history).getByText(/Zgodovina potrjenih cen/));
      const overallChange = within(history).getByTestId("price-history-overall-change-7042");

      expect(overallChange.textContent).toMatch(/\+4,00\s?€/);
      expect(overallChange.textContent).toContain("odstotek ni izračunljiv pri najstarejši ceni 0,00");
      expect(overallChange.textContent).not.toMatch(/0\s?%/);
    } finally {
      mapping.priceHistory = originalPriceHistory;
    }
  });

  it("hides the overall movement until at least two valid visible prices are available", () => {
    const mapping = mocks.dashboard.articles[0].mappings[0];
    const originalPriceHistory = mapping.priceHistory;
    mapping.priceHistory = [
      { receiptId: 7131, date: "2026-10-17", receiptNumber: "R-7131", unitPrice: Number.NaN },
      { receiptId: 7132, date: "2026-10-16", receiptNumber: "R-7132", unitPrice: 3.5 },
      { receiptId: 7133, date: "2026-10-15", receiptNumber: "R-7133", unitPrice: -1 },
    ];

    try {
      renderSupplierOrderPage();
      const history = screen.getByTestId("price-history-7042");
      fireEvent.click(within(history).getByText(/Zgodovina potrjenih cen/));

      expect(within(history).queryByTestId("price-history-overall-change-7042")).toBeNull();
    } finally {
      mapping.priceHistory = originalPriceHistory;
    }
  });

  it("shows nonzero precision for sub-cent price changes near the percentage rounding threshold", () => {
    const mapping = mocks.dashboard.articles[0].mappings[0];
    const originalPriceHistory = mapping.priceHistory;
    mapping.priceHistory = [
      { receiptId: 7110, date: "2026-10-17", receiptNumber: "R-7110", unitPrice: 1.0004 },
      { receiptId: 7111, date: "2026-10-16", receiptNumber: "R-7111", unitPrice: 1 },
      { receiptId: 7112, date: "2026-10-15", receiptNumber: "R-7112", unitPrice: 1.00049 },
      { receiptId: 7113, date: "2026-10-14", receiptNumber: "R-7113", unitPrice: 1 },
      { receiptId: 7114, date: "2026-10-13", receiptNumber: "R-7114", unitPrice: 1.0005 },
      { receiptId: 7115, date: "2026-10-12", receiptNumber: "R-7115", unitPrice: 1 },
      { receiptId: 7116, date: "2026-10-11", receiptNumber: "R-7116", unitPrice: 1000.000001 },
      { receiptId: 7117, date: "2026-10-10", receiptNumber: "R-7117", unitPrice: 1000 },
      { receiptId: 7118, date: "2026-10-09", receiptNumber: "R-7118", unitPrice: 0.9996 },
      { receiptId: 7119, date: "2026-10-08", receiptNumber: "R-7119", unitPrice: 1 },
    ];

    try {
      renderSupplierOrderPage();
      const history = screen.getByTestId("price-history-7042");
      fireEvent.click(within(history).getByText(/Zgodovina potrjenih cen/));
      const changeFor = (receiptId: number) =>
        screen.getByTestId(`price-history-change-7042-${receiptId}`).textContent ?? "";

      expect(changeFor(7110)).toMatch(/\+0,0004\s?€/);
      expect(changeFor(7110)).toMatch(/\+0,04\s?%/);
      expect(changeFor(7110)).not.toMatch(/\+0,0\s?%/);

      expect(changeFor(7112)).toMatch(/\+0,00049\s?€/);
      expect(changeFor(7112)).toMatch(/\+0,05\s?%/);

      expect(changeFor(7114)).toMatch(/\+0,0005\s?€/);
      expect(changeFor(7114)).toMatch(/\+0,05\s?%/);

      expect(changeFor(7116)).toMatch(/\+0,000001\s?€/);
      expect(changeFor(7116)).toContain("odstotek je manjši od 0,000001 %");
      expect(changeFor(7116)).not.toMatch(/\+?0(?:,0+)?\s?%/);

      expect(changeFor(7118)).toMatch(/−0,0004\s?€/);
      expect(changeFor(7118)).toMatch(/−0,04\s?%/);
    } finally {
      mapping.priceHistory = originalPriceHistory;
    }
  });

  it("shows savings against the preferred supplier only for valid comparable prices", () => {
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
          supplierItemName: "Mleko v kartonu",
          packageName: "karton",
          packageFactor: 8,
          lastPackagePrice: 20,
          lastUnitPrice: 2.5,
          lastPriceReceipt: null,
          priceHistory: [],
        },
        {
          ...existing,
          id: 7064,
          supplierId: "supplier-710",
          supplierName: "Mlekarna Malo cenejša",
          packageName: "kos",
          packageFactor: 1,
          lastPackagePrice: 3.7496,
          lastUnitPrice: 3.7496,
          lastPriceReceipt: null,
          priceHistory: [],
        },
        {
          ...existing,
          id: 7051,
          supplierId: "supplier-709",
          supplierName: "Mlekarna Dražja",
          supplierItemName: "Mleko dražje",
          packageName: "zaboj",
          packageFactor: 6,
          lastPackagePrice: 27,
          lastUnitPrice: 4.5,
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
      const savings = screen.getByTestId("supplier-savings-7047");
      expect(savings.textContent).toContain("Mlekarna Ugodna · Mleko v kartonu");
      expect(savings.textContent).toMatch(/1,25\s*€ \/ L/);
      expect(savings.textContent).toContain("33,3 %");
      expect(savings.textContent).toContain("Mlekarna Planika · Mleko polnomastno");
      const smallSavings = screen.getByTestId("supplier-savings-7064");
      expect(smallSavings.textContent).toMatch(/0,0004\s?€ \/ L/);
      expect(smallSavings.textContent).toContain("0,01 %");
      expect(smallSavings.textContent).not.toContain("0,0 %");
      const totalSavings = screen.getByTestId("supplier-total-savings-7047");
      expect(totalSavings.textContent).toContain("15 L");
      expect(totalSavings.textContent).toMatch(/18,75\s*€/);
      expect(totalSavings.textContent).toContain("Mlekarna Ugodna · Mleko v kartonu");
      expect(totalSavings.textContent).toContain("Mlekarna Planika · Mleko polnomastno");
      expect(article.preferredMappingId).toBe(7042);
      expect(screen.queryByTestId("supplier-savings-7042")).toBeNull();
      expect(screen.queryByTestId("supplier-total-savings-7042")).toBeNull();
      expect(screen.queryByTestId("supplier-savings-7048")).toBeNull();
      expect(screen.queryByTestId("supplier-savings-7049")).toBeNull();
      expect(screen.queryByTestId("supplier-savings-7050")).toBeNull();
      expect(screen.queryByTestId("supplier-savings-7051")).toBeNull();
      for (const mappingId of [7048, 7049, 7050, 7051]) {
        expect(screen.queryByTestId(`supplier-total-savings-${mappingId}`)).toBeNull();
      }
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

  it("hides savings that round to zero while keeping lowest-price ties based on exact prices", () => {
    const article = mocks.dashboard.articles[0];
    const originalMappings = article.mappings;
    const [existing] = originalMappings;
    const preferred = {
      ...existing,
      lastPackagePrice: 1000,
      lastUnitPrice: 1000,
    };
    const makeOffer = (id: number, lastUnitPrice: number) => ({
      ...existing,
      id,
      supplierId: `supplier-${id}`,
      supplierName: `Dobavitelj ${id}`,
      packageName: "kos",
      packageFactor: 1,
      lastPackagePrice: lastUnitPrice,
      lastUnitPrice,
      lastPriceReceipt: null,
      priceHistory: [],
    });
    Object.assign(article, {
      mappings: [
        preferred,
        makeOffer(7201, 999.99999951),
        makeOffer(7202, 999.99999949),
        makeOffer(7203, 999.99999949),
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

      expect(screen.queryByTestId("supplier-savings-7201")).toBeNull();
      expect(screen.queryByTestId("supplier-total-savings-7201")).toBeNull();
      expect(screen.getByTestId("lowest-unit-price-7202").textContent)
        .toContain("Najnižja cena / enoto");
      expect(screen.getByTestId("lowest-unit-price-7203").textContent)
        .toContain("Najnižja cena / enoto");
      expect(screen.queryByTestId("lowest-unit-price-7201")).toBeNull();

      const visibleSaving = screen.getByTestId("supplier-savings-7203");
      expect(visibleSaving.textContent).toMatch(/0,000001\s?€ \/ L/);
    } finally {
      Object.assign(article, { mappings: originalMappings });
    }
  });

  it("keeps a saving when the percentage is visible even if the unit amount rounds to zero", () => {
    const article = mocks.dashboard.articles[0];
    const originalMappings = article.mappings;
    const [existing] = originalMappings;
    const preferred = {
      ...existing,
      lastPackagePrice: 1,
      lastUnitPrice: 1,
    };
    const cheaperOffer = {
      ...existing,
      id: 7204,
      supplierId: "supplier-7204",
      supplierName: "Skoraj enaka cena",
      packageName: "kos",
      packageFactor: 1,
      lastPackagePrice: 0.99999951,
      lastUnitPrice: 0.99999951,
      lastPriceReceipt: null,
      priceHistory: [],
    };
    Object.assign(article, { mappings: [preferred, cheaperOffer] });

    try {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={queryClient}>
          <NarocilaDobaviteljem />
        </QueryClientProvider>,
      );

      const visibleSaving = screen.getByTestId("supplier-savings-7204");
      expect(visibleSaving.textContent).toMatch(/0,00\s?€ \/ L/);
      expect(visibleSaving.textContent).toContain("0,00005 %");
    } finally {
      Object.assign(article, { mappings: originalMappings });
    }
  });

  it("keeps a valid offer ranked lowest when stored prices are non-finite", () => {
    const article = mocks.dashboard.articles[0];
    const originalMappings = article.mappings;
    const [preferred] = originalMappings;
    const validLowerOffer = {
      ...preferred,
      id: 7047,
      supplierId: "supplier-705",
      supplierName: "Mlekarna Ugodna",
      supplierItemName: "Mleko v kartonu",
      packageName: "karton",
      packageFactor: 8,
      lastPackagePrice: 20,
      lastUnitPrice: 2.5,
      lastPriceReceipt: null,
      priceHistory: [],
    };
    Object.assign(article, {
      mappings: [
        preferred,
        validLowerOffer,
        {
          ...preferred,
          id: 7062,
          supplierId: "supplier-720",
          supplierName: "Mlekarna Pokvarjena cena paketa",
          packageFactor: 6,
          lastPackagePrice: Number.POSITIVE_INFINITY,
          lastUnitPrice: 1,
          lastPriceReceipt: null,
          priceHistory: [],
        },
        {
          ...preferred,
          id: 7063,
          supplierId: "supplier-721",
          supplierName: "Mlekarna Pokvarjena cena enote",
          packageFactor: 6,
          lastPackagePrice: 24,
          lastUnitPrice: Number.NaN,
          lastPriceReceipt: null,
          priceHistory: [],
        },
      ],
    });

    try {
      renderSupplierOrderPage();

      expect(screen.getByTestId("last-unit-price-7047").textContent).toMatch(/2,50\s*€ \/ L/);
      expect(screen.getByTestId("lowest-unit-price-7047").textContent)
        .toContain("Najnižja cena / enoto");
      for (const mappingId of [7062, 7063]) {
        expect(screen.queryByTestId(`last-unit-price-${mappingId}`)).toBeNull();
        expect(screen.queryByTestId(`lowest-unit-price-${mappingId}`)).toBeNull();
        expect(screen.queryByTestId(`supplier-savings-${mappingId}`)).toBeNull();
      }
      expect(screen.getByTestId("unavailable-unit-price-7063").textContent)
        .toContain("Cena na osnovno enoto ni prikazana");
    } finally {
      Object.assign(article, { mappings: originalMappings });
    }
  });

  it("does not show total savings when the suggested base quantity is unavailable", () => {
    const article = mocks.dashboard.articles[0];
    const originalMappings = article.mappings;
    const originalSuggestedBaseQuantity = article.suggestedBaseQuantity;
    const [preferred] = originalMappings;
    const cheaperOffer = {
      ...preferred,
      id: 7056,
      supplierId: "supplier-714",
      supplierName: "Mlekarna Ugodna",
      packageFactor: 8,
      lastPackagePrice: 20,
      lastUnitPrice: 2.5,
      lastPriceReceipt: null,
      priceHistory: [],
    };
    Object.assign(article, {
      suggestedBaseQuantity: null,
      mappings: [preferred, cheaperOffer],
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

      expect(screen.getByTestId("supplier-savings-7056").textContent).toContain("cenejša");
      expect(screen.queryByTestId("supplier-total-savings-7056")).toBeNull();
      expect(article.preferredMappingId).toBe(7042);
    } finally {
      Object.assign(article, {
        suggestedBaseQuantity: originalSuggestedBaseQuantity,
        mappings: originalMappings,
      });
    }
  });

  it("shows tied lowest-price badges without reporting savings for equal offers", () => {
    const article = mocks.dashboard.articles[0];
    const originalMappings = article.mappings;
    const [preferred] = originalMappings;
    const tiedAlternative = {
      ...preferred,
      id: 7057,
      supplierId: "supplier-715",
      supplierName: "Mlekarna Enaka",
      supplierItemName: "Mleko po isti ceni",
      packageName: "karton",
      packageFactor: 8,
      lastPackagePrice: 30,
      lastUnitPrice: 3.75,
      lastPriceReceipt: null,
      priceHistory: [],
    };
    const moreExpensiveOffer = {
      ...preferred,
      id: 7058,
      supplierId: "supplier-716",
      supplierName: "Mlekarna Dražja",
      packageFactor: 6,
      lastPackagePrice: 27,
      lastUnitPrice: 4.5,
      lastPriceReceipt: null,
      priceHistory: [],
    };
    Object.assign(article, { mappings: [preferred, tiedAlternative, moreExpensiveOffer] });

    try {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={queryClient}>
          <NarocilaDobaviteljem />
        </QueryClientProvider>,
      );

      for (const mappingId of [7042, 7057]) {
        expect(screen.getByTestId(`lowest-unit-price-${mappingId}`).textContent)
          .toContain("Najnižja cena / enoto");
      }
      expect(screen.queryByTestId("lowest-unit-price-7058")).toBeNull();
      expect(screen.queryByTestId("supplier-savings-7057")).toBeNull();
      expect(screen.queryByTestId("supplier-total-savings-7057")).toBeNull();
      expect(article.preferredMappingId).toBe(7042);
    } finally {
      Object.assign(article, { mappings: originalMappings });
    }
  });

  it("keeps a valid zero package and unit price in the lowest-price comparison", () => {
    const article = mocks.dashboard.articles[0];
    const originalMappings = article.mappings;
    const [preferred] = originalMappings;
    const zeroPriceOffer = {
      ...preferred,
      id: 7054,
      supplierId: "supplier-712",
      supplierName: "Mlekarna Brezplačno",
      supplierItemName: "Promocijsko mleko",
      packageName: "promocijski zaboj",
      packageFactor: 6,
      lastPackagePrice: 0,
      lastUnitPrice: 0,
      lastPriceReceipt: null,
      priceHistory: [],
    };
    Object.assign(article, { mappings: [preferred, zeroPriceOffer] });

    try {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={queryClient}>
          <NarocilaDobaviteljem />
        </QueryClientProvider>,
      );

      expect(screen.getByTestId("last-price-source-7054").textContent).toMatch(/0,00/);
      expect(screen.getByTestId("last-unit-price-7054").textContent).toMatch(/0,00\s*€ \/ L/);
      expect(screen.getByTestId("lowest-unit-price-7054").textContent).toContain("Najnižja cena / enoto");
    } finally {
      Object.assign(article, { mappings: originalMappings });
    }
  });

  it("hides comparable prices and lowest badges when the article has no base unit", () => {
    const article = mocks.dashboard.articles[0];
    const originalMappings = article.mappings;
    const originalBaseUnit = article.baseUnit;
    const [preferred] = originalMappings;
    const alternative = {
      ...preferred,
      id: 7055,
      supplierId: "supplier-713",
      supplierName: "Mlekarna Druga",
      packageFactor: 8,
      lastPackagePrice: 20,
      lastUnitPrice: 2.5,
      lastPriceReceipt: null,
      priceHistory: [],
    };
    Object.assign(article, { baseUnit: null, mappings: [preferred, alternative] });

    try {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false } },
      });
      render(
        <QueryClientProvider client={queryClient}>
          <NarocilaDobaviteljem />
        </QueryClientProvider>,
      );

      for (const mappingId of [preferred.id, alternative.id]) {
        expect(screen.queryByTestId(`last-unit-price-${mappingId}`)).toBeNull();
        expect(screen.queryByTestId(`lowest-unit-price-${mappingId}`)).toBeNull();
        expect(screen.getByTestId(`unavailable-unit-price-${mappingId}`).textContent)
          .toContain("osnovna enota ni določena");
      }
      expect(screen.queryByTestId("supplier-savings-7055")).toBeNull();
      expect(screen.queryByTestId("supplier-total-savings-7055")).toBeNull();
    } finally {
      Object.assign(article, { baseUnit: originalBaseUnit, mappings: originalMappings });
    }
  });

  it("does not show savings when the preferred offer has no valid unit price", () => {
    const article = mocks.dashboard.articles[0];
    const originalMappings = article.mappings;
    const [existing] = originalMappings;
    Object.assign(article, {
      mappings: [
        {
          ...existing,
          lastPackagePrice: null,
          lastUnitPrice: null,
          lastPriceReceipt: null,
          priceHistory: [],
        },
        {
          ...existing,
          id: 7052,
          supplierId: "supplier-710",
          supplierName: "Mlekarna Ugodna",
          packageFactor: 8,
          lastPackagePrice: 20,
          lastUnitPrice: 2.5,
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

      expect(screen.getByTestId("last-unit-price-7052")).toBeTruthy();
      expect(screen.queryByTestId("supplier-savings-7052")).toBeNull();
      expect(screen.queryByTestId("supplier-total-savings-7052")).toBeNull();
    } finally {
      Object.assign(article, { mappings: originalMappings });
    }
  });

  it("warns about a 90-day-old draft price, shows its source, and still allows saving", async () => {
    const mapping = mocks.dashboard.articles[0].mappings[0];
    const originalSource = mapping.lastPriceReceipt;
    const staleDate = receiptDateDaysAgo(90);
    mapping.lastPriceReceipt = {
      receiptId: 7190,
      date: staleDate,
      receiptNumber: "STALE-7190",
    };
    mocks.mutation.mockResolvedValue(mocks.order);

    try {
      renderSupplierOrderPage();

      fireEvent.click(screen.getByRole("button", { name: /Osnutek · Mlekarna Planika/ }));

      const warning = screen.getByTestId("supplier-order-price-stale-7042-0");
      expect(warning.textContent).toContain("90 dni ali več");
      expect(warning.textContent).toContain("Pred shranjevanjem preverite ceno");
      const source = screen.getByTestId("supplier-order-price-receipt-7042-0");
      expect(source.textContent).toContain("STALE-7190");
      expect(source.textContent).toContain(expectedReceiptDate(staleDate));
      expect((screen.getByRole("button", { name: "Shrani osnutek" }) as HTMLButtonElement).disabled)
        .toBe(false);

      fireEvent.click(screen.getByRole("button", { name: "Shrani osnutek" }));
      await waitFor(() => expect(mocks.mutation).toHaveBeenCalledWith({
        data: {
          supplierId: "supplier-704",
          expectedDeliveryDate: null,
          internalNotes: null,
          supplierNotes: null,
          lines: [{ supplierMappingId: 7042, packageQuantity: 3, unitPrice: 22.5 }],
        },
      }));
    } finally {
      mapping.lastPriceReceipt = originalSource;
    }
  });

  it.each([
    ["neveljaven datum", "not-a-date", true],
    ["manjkajoč datum", null, true],
    ["manjkajoč vir prejemnice", null, false],
  ])("označi %s kot neznano v osnutku", (_description, date, hasReceipt) => {
    const mapping = mocks.dashboard.articles[0].mappings[0];
    const originalSource = mapping.lastPriceReceipt;
    (mapping as any).lastPriceReceipt = hasReceipt
      ? { receiptId: 7191, date, receiptNumber: "UNKNOWN-7191" }
      : null;

    try {
      renderSupplierOrderPage();
      fireEvent.click(screen.getByRole("button", { name: /Osnutek · Mlekarna Planika/ }));

      expect(screen.getByTestId("supplier-order-price-age-unknown-7042-0").textContent)
        .toContain("Starost cene ni znana");
      expect(screen.queryByTestId("supplier-order-price-stale-7042-0")).toBeNull();
      if (hasReceipt) {
        const source = screen.getByTestId("supplier-order-price-receipt-7042-0");
        expect(source.textContent).toContain("UNKNOWN-7191");
        expect(source.textContent).toContain("Datum ni znan");
      } else {
        expect(screen.getByTestId("supplier-order-price-source-7042-0").textContent)
          .toContain("Vir prejemnice ni zabeležen");
      }
      expect((screen.getByRole("button", { name: "Shrani osnutek" }) as HTMLButtonElement).disabled)
        .toBe(false);
    } finally {
      mapping.lastPriceReceipt = originalSource;
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

  it("shows used and remaining supplier-instruction characters after typing and copying a note", () => {
    renderSupplierOrderPage();
    openNewOrderEditor();
    const supplierCounter = screen.getByTestId("supplier-note-character-count");
    const internalCounter = screen.getByTestId("internal-note-character-count");
    const copyPreview = screen.getByTestId("supplier-note-copy-preview");
    const supplierNotes = screen.getByLabelText(/Navodilo dobavitelju/) as HTMLTextAreaElement;
    const internalNote = screen.getByLabelText(/Interna opomba/) as HTMLTextAreaElement;
    const typedInstructions = "Dostavite pred 10. uro.";

    expect(supplierCounter.textContent).toBe("0 / 2000 znakov · preostalo 2000");
    expect(internalCounter.textContent).toBe("0 / 2000 znakov · preostalo 2000");
    expect(copyPreview.textContent).toBe("Po kopiranju: 0 / 2000 znakov · preostalo 2000");
    fireEvent.change(supplierNotes, { target: { value: typedInstructions } });
    expect(supplierCounter.textContent).toBe(`${typedInstructions.length} / 2000 znakov · preostalo ${2000 - typedInstructions.length}`);
    expect(internalCounter.textContent).toBe("0 / 2000 znakov · preostalo 2000");
    expect(copyPreview.textContent).toBe(`Po kopiranju: ${typedInstructions.length} / 2000 znakov · preostalo ${2000 - typedInstructions.length}`);

    const noteToCopy = "Pokličite ob prihodu.";
    fireEvent.change(internalNote, { target: { value: noteToCopy } });
    expect(internalCounter.textContent).toBe(`${noteToCopy.length} / 2000 znakov · preostalo ${2000 - noteToCopy.length}`);
    expect(supplierCounter.textContent).toBe(`${typedInstructions.length} / 2000 znakov · preostalo ${2000 - typedInstructions.length}`);
    const combinedInstructions = `${typedInstructions}\n\n${noteToCopy}`;
    expect(copyPreview.textContent).toBe(`Po kopiranju: ${combinedInstructions.length} / 2000 znakov · preostalo ${2000 - combinedInstructions.length}`);

    fireEvent.click(screen.getByTestId("button-copy-internal-to-supplier"));
    expect(supplierNotes.value).toBe(combinedInstructions);
    expect(supplierCounter.textContent).toBe(`${combinedInstructions.length} / 2000 znakov · preostalo ${2000 - combinedInstructions.length}`);
    expect(internalCounter.textContent).toBe(`${noteToCopy.length} / 2000 znakov · preostalo ${2000 - noteToCopy.length}`);
  });

  it("counts emoji and multiple line breaks in both notes and submits text within the field limit", async () => {
    mocks.mutation.mockResolvedValue(mocks.order);
    renderSupplierOrderPage();
    fireEvent.click(screen.getByRole("button", { name: /Osnutek · Mlekarna Planika/ }));

    const internalNotes = `🔒\n\n${"i".repeat(1992)}\nend`;
    const supplierNotes = `🚚\n\n${"s".repeat(1991)}\nend`;
    const internalField = screen.getByLabelText(/Interna opomba/) as HTMLTextAreaElement;
    const supplierField = screen.getByLabelText(/Navodilo dobavitelju/) as HTMLTextAreaElement;
    fireEvent.change(internalField, { target: { value: internalNotes } });
    fireEvent.change(supplierField, { target: { value: supplierNotes } });

    expect(internalNotes.length).toBe(2000);
    expect(supplierNotes.length).toBe(1999);
    expect(internalField.maxLength).toBe(2000);
    expect(supplierField.maxLength).toBe(2000);
    expect(screen.getByTestId("internal-note-character-count").textContent)
      .toBe("2000 / 2000 znakov · preostalo 0");
    expect(screen.getByTestId("supplier-note-character-count").textContent)
      .toBe("1999 / 2000 znakov · preostalo 1");

    fireEvent.click(screen.getByRole("button", { name: "Shrani osnutek" }));

    await waitFor(() => expect(mocks.mutation).toHaveBeenCalledWith({
      data: {
        supplierId: "supplier-704",
        expectedDeliveryDate: null,
        internalNotes,
        supplierNotes,
        lines: [{ supplierMappingId: 7042, packageQuantity: 3, unitPrice: 22.5 }],
      },
    }));
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
    const characterCount = screen.getByTestId("supplier-note-character-count");
    expect(characterCount.textContent).toBe("1990 / 2000 znakov · preostalo 10");
    expect(screen.getByTestId("supplier-note-copy-preview").textContent)
      .toBe("Po kopiranju: 2022 / 2000 znakov · preostalo -22");

    const copyButton = screen.getByTestId("button-copy-internal-to-supplier");
    expect(copyButton.hasAttribute("disabled")).toBe(true);
    expect(screen.getByRole("alert").textContent).toContain("presegla omejitev 2000 znakov");
    fireEvent.click(copyButton);

    expect(internalField.value).toBe(internalNote);
    expect(supplierField.value).toBe(existingInstruction);
    expect(characterCount.textContent).toBe("1990 / 2000 znakov · preostalo 10");
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("allows copying when the predicted supplier instructions reach the character limit exactly", () => {
    const internalNote = "i".repeat(30);
    const existingInstruction = "s".repeat(1968);
    renderSupplierOrderPage();
    openNewOrderEditor();

    const internalField = screen.getByLabelText(/Interna opomba/) as HTMLTextAreaElement;
    const supplierField = screen.getByLabelText(/Navodilo dobavitelju/) as HTMLTextAreaElement;
    fireEvent.change(internalField, { target: { value: internalNote } });
    fireEvent.change(supplierField, { target: { value: existingInstruction } });

    expect(screen.getByTestId("supplier-note-copy-preview").textContent)
      .toBe("Po kopiranju: 2000 / 2000 znakov · preostalo 0");
    const copyButton = screen.getByTestId("button-copy-internal-to-supplier");
    expect(copyButton.hasAttribute("disabled")).toBe(false);

    fireEvent.click(copyButton);
    expect(supplierField.value).toBe(`${existingInstruction}\n\n${internalNote}`);
    expect(supplierField.value.length).toBe(2000);
  });

  it.each([
    ["gumbom za zapiranje", "close-button"],
    ["preklicem", "cancel-button"],
    ["klikom zunaj", "outside-click"],
  ] as const)("warns about unsaved changes when closing %s", (_label, method) => {
    renderSupplierOrderPage();
    openNewOrderEditor();
    const supplierNotes = screen.getByLabelText(/Navodilo dobavitelju/) as HTMLTextAreaElement;
    fireEvent.change(supplierNotes, { target: { value: "Dostavite pred 12. uro." } });

    dismissOrderEditor(method);

    expect(screen.getByRole("alertdialog").textContent).toMatch(/neshranjene spremembe/i);
    fireEvent.click(screen.getByTestId("button-continue-supplier-order-editor"));
    expect(screen.getByRole("dialog", { name: "Naročilo dobavitelju" })).toBeTruthy();
    expect(supplierNotes.value).toBe("Dostavite pred 12. uro.");
  });

  it.each([
    ["gumbom za zapiranje", "close-button"],
    ["preklicem", "cancel-button"],
    ["klikom zunaj", "outside-click"],
  ] as const)("closes an unchanged draft directly when closing %s", (_label, method) => {
    renderSupplierOrderPage();
    openNewOrderEditor();

    dismissOrderEditor(method);

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Naročilo dobavitelju" })).toBeNull();
  });

  it("closes an unchanged saved draft without showing a warning", () => {
    renderSupplierOrderPage();
    openSavedDraftEditor();

    expect((screen.getByLabelText(/Navodilo dobavitelju/) as HTMLTextAreaElement).value)
      .toBe("Prosimo za dostavo do 10.00.\nHvala.");
    dismissOrderEditor("cancel-button");

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Naročilo dobavitelju" })).toBeNull();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("returns focus to the order row after closing an editor whose details trigger unmounted", () => {
    renderSupplierOrderPage();
    const editor = openSavedDraftEditor();
    const orderRowOpener = screen.getByTestId("button-open-supplier-order-704");

    dismissOrderEditor("cancel-button");

    expect(screen.queryByRole("dialog", { name: "Naročilo dobavitelju" })).toBeNull();
    expect(document.activeElement).toBe(orderRowOpener);
    expect(mocks.mutation).not.toHaveBeenCalled();
    expect(editor.isConnected).toBe(false);
  });

  it("closes order details with Escape and restores focus to the row opener", () => {
    renderSupplierOrderPage();
    fireEvent.click(screen.getByTestId("tab-supplier-orders"));
    const opener = screen.getByTestId("button-open-supplier-order-704");
    fireEvent.click(opener);

    const details = screen.getByRole("dialog", { name: "N-2026-0704" });
    expect(document.activeElement).toBe(details);
    fireEvent.keyDown(details, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "N-2026-0704" })).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("closes a clean order editor with Escape and restores focus to its opener", () => {
    renderSupplierOrderPage();
    const opener = screen.getByRole("button", { name: "Novo naročilo" });
    const editor = openNewOrderEditor();

    expect(document.activeElement).toBe(editor);
    fireEvent.keyDown(editor, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Naročilo dobavitelju" })).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("uses Escape in the unsaved-changes prompt to continue editing without discarding", () => {
    renderSupplierOrderPage();
    const editor = openNewOrderEditor();
    const supplierNotes = screen.getByLabelText(/Navodilo dobavitelju/) as HTMLTextAreaElement;
    fireEvent.change(supplierNotes, { target: { value: "Dostavite pred 12. uro." } });
    const promptOpener = screen.getByTestId("button-close-supplier-order-editor");
    fireEvent.click(promptOpener);

    const prompt = screen.getByRole("alertdialog");
    expect(document.activeElement).toBe(screen.getByTestId("button-continue-supplier-order-editor"));
    fireEvent.keyDown(prompt, { key: "Escape" });

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.getByRole("dialog", { name: "Naročilo dobavitelju" })).toBe(editor);
    expect(supplierNotes.value).toBe("Dostavite pred 12. uro.");
    expect(document.activeElement).toBe(promptOpener);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("uses Escape in a dirty editor to ask before discarding its changes", () => {
    renderSupplierOrderPage();
    const editor = openNewOrderEditor();
    const supplierNotes = screen.getByLabelText(/Navodilo dobavitelju/) as HTMLTextAreaElement;
    fireEvent.change(supplierNotes, { target: { value: "Dostavite pred 12. uro." } });

    fireEvent.keyDown(editor, { key: "Escape" });

    expect(screen.getByRole("alertdialog").textContent).toMatch(/neshranjene spremembe/i);
    expect(screen.getByRole("dialog", { name: "Naročilo dobavitelju" })).toBe(editor);
    expect(supplierNotes.value).toBe("Dostavite pred 12. uro.");
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("closes the order-reason dialog with Escape and restores focus without closing the order", () => {
    const originalStatus = mocks.order.status;
    mocks.order.status = "sent";
    try {
      renderSupplierOrderPage();
      fireEvent.click(screen.getByTestId("tab-supplier-orders"));
      fireEvent.click(screen.getByTestId("button-open-supplier-order-704"));
      const opener = screen.getByTestId("button-open-close-order-dialog");
      fireEvent.click(opener);

      const closeDialog = screen.getByRole("dialog", { name: "Zapri naročilo" });
      fireEvent.keyDown(closeDialog, { key: "Escape" });

      expect(screen.queryByRole("dialog", { name: "Zapri naročilo" })).toBeNull();
      expect(screen.getByRole("dialog", { name: "N-2026-0704" })).toBeTruthy();
      expect(document.activeElement).toBe(opener);
      expect(mocks.mutation).not.toHaveBeenCalled();
    } finally {
      mocks.order.status = originalStatus;
    }
  });

  it("closes a supplier order once and focuses the stable print control after the opener disappears", async () => {
    const originalStatus = mocks.order.status;
    mocks.order.status = "sent";
    mocks.mutation.mockImplementation(async () => {
      mocks.order.status = "closed";
      return mocks.order;
    });
    try {
      renderSupplierOrderPage();
      fireEvent.click(screen.getByTestId("tab-supplier-orders"));
      fireEvent.click(screen.getByTestId("button-open-supplier-order-704"));
      const opener = screen.getByTestId("button-open-close-order-dialog");
      fireEvent.click(opener);
      fireEvent.change(screen.getByLabelText("Razlog zaprtja"), {
        target: { value: "Dobavitelj ne more dobaviti preostanka" },
      });

      fireEvent.click(screen.getByRole("button", { name: "Potrdi zaprtje" }));

      await waitFor(() => {
        expect(mocks.mutation).toHaveBeenCalledOnce();
        expect(mocks.mutation).toHaveBeenCalledWith({
          id: 704,
          data: { reason: "Dobavitelj ne more dobaviti preostanka" },
        });
        expect(screen.queryByRole("dialog", { name: "Zapri naročilo" })).toBeNull();
      });
      const printButton = screen.getByTestId("button-print-supplier-order-704");
      expect(opener.isConnected).toBe(false);
      expect(document.activeElement).toBe(printButton);
    } finally {
      mocks.order.status = originalStatus;
    }
  });

  it("keeps the close-order dialog and typed reason after a failed close", async () => {
    const originalStatus = mocks.order.status;
    mocks.order.status = "sent";
    mocks.mutation.mockRejectedValueOnce(new Error("Close failed"));
    try {
      renderSupplierOrderPage();
      fireEvent.click(screen.getByTestId("tab-supplier-orders"));
      fireEvent.click(screen.getByTestId("button-open-supplier-order-704"));
      fireEvent.click(screen.getByTestId("button-open-close-order-dialog"));
      const reason = "Dobavitelj ne more dobaviti preostanka";
      fireEvent.change(screen.getByLabelText("Razlog zaprtja"), { target: { value: reason } });

      fireEvent.click(screen.getByRole("button", { name: "Potrdi zaprtje" }));

      await waitFor(() => expect(screen.getByText("Close failed")).toBeTruthy());
      expect(mocks.mutation).toHaveBeenCalledOnce();
      expect(screen.getByRole("dialog", { name: "Zapri naročilo" })).toBeTruthy();
      expect((screen.getByLabelText("Razlog zaprtja") as HTMLInputElement).value).toBe(reason);
      expect(screen.getByRole("button", { name: "Potrdi zaprtje" }).hasAttribute("disabled")).toBe(false);
    } finally {
      mocks.order.status = originalStatus;
    }
  });

  it("closes reorder settings with Escape and restores focus without saving", () => {
    renderSupplierOrderPage();
    const opener = screen.getByRole("button", { name: "Nastavi Mleko 3,5 %" });
    fireEvent.click(opener);

    const settings = screen.getByRole("dialog", { name: "Mleko 3,5 %" });
    expect(document.activeElement).toBe(settings);
    fireEvent.keyDown(settings, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Mleko 3,5 %" })).toBeNull();
    expect(document.activeElement).toBe(opener);
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("returns focus to the page heading if a reorder-settings opener disappears", () => {
    renderSupplierOrderPage();
    const opener = screen.getByRole("button", { name: "Nastavi Mleko 3,5 %" });
    fireEvent.click(opener);

    const settings = screen.getByRole("dialog", { name: "Mleko 3,5 %" });
    fireEvent.click(screen.getByTestId("tab-supplier-orders"));
    fireEvent.keyDown(settings, { key: "Escape" });

    expect(screen.queryByRole("dialog", { name: "Mleko 3,5 %" })).toBeNull();
    expect(opener.isConnected).toBe(false);
    expect(document.activeElement).toBe(screen.getByRole("heading", { name: "Naročila dobaviteljem" }));
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("closes the package review with Escape without preparing a receipt or closing order details", async () => {
    const originalStatus = mocks.order.status;
    const originalCurrentPackageFactor = mocks.order.lines[0].currentPackageFactor;
    mocks.order.status = "sent";
    mocks.order.lines[0].currentPackageFactor = 8;
    try {
      renderSupplierOrderPage();
      fireEvent.click(screen.getByTestId("tab-supplier-orders"));
      fireEvent.click(screen.getByTestId("button-open-supplier-order-704"));
      const opener = screen.getByRole("button", { name: "Pripravi prejemnico" });
      fireEvent.click(opener);

      const review = await screen.findByRole("alertdialog");
      expect(document.activeElement).toBe(review);
      fireEvent.keyDown(review, { key: "Escape" });

      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(screen.getByRole("dialog", { name: "N-2026-0704" })).toBeTruthy();
      expect(document.activeElement).toBe(opener);
      expect(mocks.mutation).not.toHaveBeenCalled();
      expect(mocks.navigate).not.toHaveBeenCalled();
    } finally {
      mocks.order.status = originalStatus;
      mocks.order.lines[0].currentPackageFactor = originalCurrentPackageFactor;
    }
  });

  it("returns focus to order details if the package-review opener disappears", async () => {
    const originalStatus = mocks.order.status;
    const originalCurrentPackageFactor = mocks.order.lines[0].currentPackageFactor;
    mocks.order.status = "sent";
    mocks.order.lines[0].currentPackageFactor = 8;
    try {
      renderSupplierOrderPage();
      fireEvent.click(screen.getByTestId("tab-supplier-orders"));
      fireEvent.click(screen.getByTestId("button-open-supplier-order-704"));
      const opener = screen.getByRole("button", { name: "Pripravi prejemnico" });
      fireEvent.click(opener);

      const review = await screen.findByRole("alertdialog");
      const orderDetails = screen.getByRole("dialog", { name: "N-2026-0704" });
      mocks.order.status = "draft";
      fireEvent.click(screen.getByRole("checkbox", { name: /Preveril\/-a sem dejansko količino/ }));
      expect(opener.isConnected).toBe(false);

      fireEvent.keyDown(review, { key: "Escape" });

      expect(screen.queryByRole("alertdialog")).toBeNull();
      expect(screen.getByRole("dialog", { name: "N-2026-0704" })).toBe(orderDetails);
      expect(document.activeElement).toBe(orderDetails);
      expect(mocks.mutation).not.toHaveBeenCalled();
    } finally {
      mocks.order.status = originalStatus;
      mocks.order.lines[0].currentPackageFactor = originalCurrentPackageFactor;
    }
  });

  it("warns about changed saved-draft instructions and keeps them when continuing", () => {
    renderSupplierOrderPage();
    openSavedDraftEditor();
    const supplierNotes = screen.getByLabelText(/Navodilo dobavitelju/) as HTMLTextAreaElement;
    fireEvent.change(supplierNotes, { target: { value: "Dostavite pred 12. uro." } });

    dismissOrderEditor("close-button");

    expect(screen.getByRole("alertdialog").textContent).toMatch(/neshranjene spremembe/i);
    fireEvent.click(screen.getByTestId("button-continue-supplier-order-editor"));

    expect(screen.getByRole("dialog", { name: "Naročilo dobavitelju" })).toBeTruthy();
    expect(supplierNotes.value).toBe("Dostavite pred 12. uro.");
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("explicitly discards changed saved-draft instructions and closes the editor without saving", () => {
    renderSupplierOrderPage();
    openSavedDraftEditor();
    fireEvent.change(screen.getByLabelText(/Navodilo dobavitelju/), {
      target: { value: "Dostavite pred 12. uro." },
    });

    dismissOrderEditor("close-button");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-discard-supplier-order-editor"));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Naročilo dobavitelju" })).toBeNull();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("allows app navigation and browser exit when the order draft is unchanged", () => {
    renderSupplierOrderPage();
    openNewOrderEditor();

    const beforeUnloadEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnloadEvent);
    expect(beforeUnloadEvent.defaultPrevented).toBe(false);

    act(() => mocks.aroundNavigation(mocks.navigate, "/zaloge"));

    expect(mocks.navigate).toHaveBeenCalledWith("/zaloge");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("warns before app navigation and browser exit only when the order draft changed", () => {
    renderSupplierOrderPage();
    openNewOrderEditor();
    const supplierNotes = screen.getByLabelText(/Navodilo dobavitelju/) as HTMLTextAreaElement;
    fireEvent.change(supplierNotes, { target: { value: "Dostavite pred 12. uro." } });

    const beforeUnloadEvent = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(beforeUnloadEvent);
    expect(beforeUnloadEvent.defaultPrevented).toBe(true);

    act(() => mocks.aroundNavigation(mocks.navigate, "/zaloge"));

    expect(screen.getByRole("alertdialog").textContent).toMatch(/neshranjene spremembe/i);
    expect(mocks.navigate).not.toHaveBeenCalled();
    fireEvent.click(screen.getByTestId("button-continue-supplier-order-editor"));
    expect(screen.getByRole("dialog", { name: "Naročilo dobavitelju" })).toBeTruthy();
    expect(supplierNotes.value).toBe("Dostavite pred 12. uro.");
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("discards a changed draft and resumes the requested app navigation without saving", () => {
    renderSupplierOrderPage();
    openNewOrderEditor();
    fireEvent.change(screen.getByLabelText(/Navodilo dobavitelju/), {
      target: { value: "Dostavite pred 12. uro." },
    });

    act(() => mocks.aroundNavigation(mocks.navigate, "/zaloge"));
    expect(mocks.navigate).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("button-discard-supplier-order-editor"));

    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Naročilo dobavitelju" })).toBeNull();
    expect(mocks.navigate).toHaveBeenCalledWith("/zaloge");
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("allows browser Back and Forward when the order draft is unchanged", async () => {
    await prepareHistoryAtSupplierOrder();
    renderSupplierOrderPage();
    openNewOrderEditor();

    await traverseHistoryAndWait("back", "/history-before-supplier-order");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await traverseHistoryAndWait("forward", "/narocila-dobaviteljem");
    expect(screen.queryByRole("alertdialog")).toBeNull();
    await traverseHistoryAndWait("forward", "/history-after-supplier-order");
    expect(screen.queryByRole("alertdialog")).toBeNull();
  });

  it("restores the page when Back is canceled and reaches that Back destination when the changed draft is discarded", async () => {
    const supplierEntryState = await prepareHistoryAtSupplierOrder();
    renderSupplierOrderPage();
    openNewOrderEditor();
    const supplierNotes = screen.getByLabelText(/Navodilo dobavitelju/) as HTMLTextAreaElement;
    fireEvent.change(supplierNotes, { target: { value: "Dostavite pred 12. uro." } });

    await act(async () => {
      window.history.back();
      await screen.findByRole("alertdialog");
      await waitFor(() => expect(window.history.state).toEqual(supplierEntryState));
    });
    expect(window.location.pathname).toBe("/narocila-dobaviteljem");

    fireEvent.click(screen.getByTestId("button-continue-supplier-order-editor"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(supplierNotes.value).toBe("Dostavite pred 12. uro.");
    expect(window.location.pathname).toBe("/narocila-dobaviteljem");

    await act(async () => {
      window.history.back();
      await screen.findByRole("alertdialog");
      await waitFor(() => expect(window.history.state).toEqual(supplierEntryState));
    });
    fireEvent.click(screen.getByTestId("button-discard-supplier-order-editor"));
    await waitFor(() => expect(window.location.pathname).toBe("/history-before-supplier-order"));
    expect(screen.queryByRole("dialog", { name: "Naročilo dobavitelju" })).toBeNull();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("restores the page when Forward warns and resumes the intended Forward destination on discard", async () => {
    const supplierEntryState = await prepareHistoryAtSupplierOrder();
    renderSupplierOrderPage();
    openNewOrderEditor();
    fireEvent.change(screen.getByLabelText(/Navodilo dobavitelju/), {
      target: { value: "Dostavite pred 12. uro." },
    });

    await act(async () => {
      window.history.forward();
      await screen.findByRole("alertdialog");
      await waitFor(() => expect(window.history.state).toEqual(supplierEntryState));
    });
    expect(window.location.pathname).toBe("/narocila-dobaviteljem");

    fireEvent.click(screen.getByTestId("button-discard-supplier-order-editor"));
    await waitFor(() => expect(window.location.pathname).toBe("/history-after-supplier-order"));
    expect(screen.queryByRole("dialog", { name: "Naročilo dobavitelju" })).toBeNull();
    expect(mocks.mutation).not.toHaveBeenCalled();
  });

  it("lets the user continue editing a copied note or explicitly discard it", () => {
    renderSupplierOrderPage();
    openNewOrderEditor();
    const internalNote = screen.getByLabelText(/Interna opomba/) as HTMLTextAreaElement;
    fireEvent.change(internalNote, { target: { value: "Pokličite ob prihodu." } });
    fireEvent.click(screen.getByTestId("button-copy-internal-to-supplier"));
    const supplierNotes = screen.getByLabelText(/Navodilo dobavitelju/) as HTMLTextAreaElement;

    dismissOrderEditor("close-button");
    expect(screen.getByRole("alertdialog")).toBeTruthy();
    fireEvent.click(screen.getByTestId("button-continue-supplier-order-editor"));
    expect(supplierNotes.value).toBe("Pokličite ob prihodu.");

    dismissOrderEditor("cancel-button");
    fireEvent.click(screen.getByTestId("button-discard-supplier-order-editor"));
    expect(screen.queryByRole("alertdialog")).toBeNull();
    expect(screen.queryByRole("dialog", { name: "Naročilo dobavitelju" })).toBeNull();
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

  it("prepares and saves a one-time draft from a cheaper offer using that offer's package factor", async () => {
    const article = mocks.dashboard.articles[0];
    const originalMappings = article.mappings;
    const preferredMappingId = article.preferredMappingId;
    const cheaperOffer = {
      ...originalMappings[0],
      id: 7059,
      supplierId: "supplier-717",
      supplierName: "Mlekarna Stara",
      supplierItemName: "Mleko v večjem pakiranju",
      packageName: "zaboj 8",
      packageFactor: 8,
      lastPackagePrice: 20,
      lastUnitPrice: 2.5,
    };
    article.mappings = [...originalMappings, cheaperOffer];

    try {
      renderSupplierOrderPage();

      fireEvent.click(screen.getByTestId("prepare-cheaper-offer-7043-7059"));

      expect((screen.getByLabelText("Dobavitelj") as HTMLSelectElement).value).toBe("supplier-717");
      expect(screen.getByText(/faktor 8/)).toBeTruthy();
      expect((screen.getByLabelText("Količina pakiranj Mleko 3,5 %") as HTMLInputElement).value).toBe("2");
      expect((screen.getByLabelText("Cena pakiranja Mleko 3,5 %") as HTMLInputElement).value).toBe("20");
      expect(article.preferredMappingId).toBe(preferredMappingId);
      expect(mocks.mutation).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId("button-cancel-supplier-order-editor"));
      fireEvent.click(screen.getByRole("button", { name: /Osnutek · Mlekarna Planika/ }));

      expect((screen.getByLabelText("Dobavitelj") as HTMLSelectElement).value).toBe("supplier-704");
      expect((screen.getByLabelText("Količina pakiranj Mleko 3,5 %") as HTMLInputElement).value).toBe("3");
      expect(article.preferredMappingId).toBe(preferredMappingId);
      expect(mocks.mutation).not.toHaveBeenCalled();

      fireEvent.click(screen.getByTestId("button-cancel-supplier-order-editor"));
      mocks.mutation.mockResolvedValue(mocks.order);
      fireEvent.click(screen.getByTestId("prepare-cheaper-offer-7043-7059"));
      fireEvent.click(screen.getByRole("button", { name: "Shrani osnutek" }));

      await waitFor(() => expect(mocks.mutation).toHaveBeenCalledWith({
        data: {
          supplierId: "supplier-717",
          expectedDeliveryDate: null,
          internalNotes: null,
          supplierNotes: null,
          lines: [{ supplierMappingId: 7059, packageQuantity: 2, unitPrice: 20 }],
        },
      }));
      expect(article.preferredMappingId).toBe(preferredMappingId);
    } finally {
      article.mappings = originalMappings;
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

  it("warns only about changed open lines and prepares the receipt without fully received lines", async () => {
    const originalOrder = {
      status: mocks.order.status,
      lineCount: mocks.order.lineCount,
      openQuantity: mocks.order.openQuantity,
      lines: mocks.order.lines,
    };
    const receivedLine = {
      ...mocks.order.lines[0],
      id: 7041,
      articleId: 7043,
      articleName: "Že prevzeto mleko",
      packageQuantity: 1,
      packageFactor: 6,
      currentPackageFactor: 8,
      orderedBaseQuantity: 6,
      receivedBaseQuantity: 6,
      openBaseQuantity: 0,
    };
    const openLine = {
      ...mocks.order.lines[0],
      id: 7051,
      supplierMappingId: 7052,
      articleId: 7053,
      articleName: "Odprta smetana",
      supplierItemName: "Smetana",
      packageQuantity: 1,
      packageFactor: 4,
      currentPackageFactor: 7,
      packageName: "paket",
      orderedBaseQuantity: 4,
      receivedBaseQuantity: 0,
      openBaseQuantity: 4,
      unitPrice: 20,
    };
    mocks.order.status = "partially_received";
    mocks.order.lineCount = 2;
    mocks.order.openQuantity = 4;
    mocks.order.lines = [receivedLine, openLine];
    mocks.mutation.mockResolvedValue({ id: 7047 });

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

      const warning = await screen.findByRole("alertdialog");
      expect(warning.textContent).toContain("Odprta smetana");
      expect(warning.textContent).not.toContain("Že prevzeto mleko");
      expect(warning.textContent).toContain("4 L / pak.");
      expect(warning.textContent).toContain("7 L / pak.");
      expect(warning.textContent).not.toContain("6 L / pak.");
      expect(mocks.mutation).not.toHaveBeenCalled();

      fireEvent.click(screen.getByRole("checkbox", { name: /Preveril\/-a sem dejansko količino/ }));
      fireEvent.click(screen.getByRole("button", { name: "Nadaljuj na prejemnico" }));

      await waitFor(() => expect(mocks.mutation).toHaveBeenCalledWith({
        data: expect.objectContaining({
          postavke: [{
            artikelId: 7053,
            supplierOrderLineId: 7051,
            kolicina: 4,
            cenaKos: 5,
            skupaj: undefined,
            izvKolicina: 4,
            izvCena: 5,
            izvEnota: "L",
            enotVPaketu: 1,
          }],
        }),
      }));
      expect(mocks.navigate).toHaveBeenCalledWith("/zaloge?prejemnica=7047");
    } finally {
      mocks.order.status = originalOrder.status;
      mocks.order.lineCount = originalOrder.lineCount;
      mocks.order.openQuantity = originalOrder.openQuantity;
      mocks.order.lines = originalOrder.lines;
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
