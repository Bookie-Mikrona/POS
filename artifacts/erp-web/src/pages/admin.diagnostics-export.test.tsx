import "@testing-library/jest-dom";
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { EventTransferDetail, EventTransferDiagnosticReport, EventTransferMovementDetail } from "@workspace/api-client-react";

const { diagnosticsHookMock, detailHookMock, movementDetailHookMock } = vi.hoisted(() => ({
  diagnosticsHookMock: vi.fn(),
  detailHookMock: vi.fn(),
  movementDetailHookMock: vi.fn(),
}));

vi.mock("@clerk/react", () => ({
  useAuth: () => ({ getToken: vi.fn().mockResolvedValue("test-token") }),
}));

vi.mock("@workspace/api-client-react", () => ({
  getGetAdminEventTransferDiagnosticsQueryKey: (
    companyId: string,
    params: { unitId?: number },
  ) => ["event-transfer-diagnostics", companyId, params],
  getGetAdminEventTransferDetailQueryKey: (companyId: string, eventId: number) =>
    ["event-transfer-detail", companyId, eventId],
  getGetAdminEventTransferMovementDetailQueryKey: (companyId: string, movementId: number) =>
    ["event-transfer-movement-detail", companyId, movementId],
  useGetAdminEventTransferDetail: detailHookMock,
  useGetAdminEventTransferMovementDetail: movementDetailHookMock,
  useGetAdminEventTransferDiagnostics: diagnosticsHookMock,
}));

vi.mock("@/components/ui/select", async () => {
  const ReactModule = await vi.importActual<typeof import("react")>("react");
  const MockSelectTrigger = () => null;
  const MockSelectContent = () => null;
  const MockSelectItem = () => null;
  const MockSelectValue = () => null;

  function MockSelect({
    children,
    value,
    onValueChange,
    disabled,
  }: {
    children: React.ReactNode;
    value: string;
    onValueChange: (value: string) => void;
    disabled?: boolean;
  }) {
    const nodes = ReactModule.Children.toArray(children) as React.ReactElement[];
    const trigger = nodes.find(node => node.type === MockSelectTrigger);
    const content = nodes.find(node => node.type === MockSelectContent);
    const triggerProps = (trigger?.props ?? {}) as Record<string, unknown>;
    const { children: _triggerChildren, ...selectProps } = triggerProps;
    const items = ReactModule.Children.toArray(
      (content?.props as { children?: React.ReactNode } | undefined)?.children,
    ) as Array<React.ReactElement<{ value: string; children: React.ReactNode }>>;

    const testId = String(selectProps["data-testid"] ?? "select");
    return ReactModule.createElement(
      "div",
      null,
      ReactModule.createElement(
        "button",
        {
          ...selectProps,
          type: "button",
          disabled,
        },
        value,
      ),
      items.map(item => ReactModule.createElement(
        "button",
        {
          key: item.props.value,
          type: "button",
          disabled,
          "data-testid": `${testId}-option-${item.props.value}`,
          onClick: () => onValueChange(item.props.value),
        },
        item.props.children,
      )),
    );
  }

  return {
    Select: MockSelect,
    SelectTrigger: MockSelectTrigger,
    SelectContent: MockSelectContent,
    SelectItem: MockSelectItem,
    SelectValue: MockSelectValue,
  };
});

import { AdminDiagnosticsSection } from "./admin";

const fullReport: EventTransferDiagnosticReport = {
  generatedAt: "2026-09-04T08:15:30.000Z",
  scope: { companyId: "company-1", unitId: 1 },
  readOnly: true,
  checked: { transfers: 2, lines: 2, movements: 3 },
  violationCount: 2,
  summary: { missing_movement: 1, extra_movement: 1 },
  violations: [
    {
      kind: "missing_movement",
      transferId: 10,
      transferExists: true,
      eventId: 20,
      eventExists: true,
      eventName: "Festival",
      direction: "outbound",
      status: "completed",
      sourceUnitId: 1,
      sourceUnitName: "Glavna enota",
      targetUnitId: 2,
      targetUnitName: "Dogodek",
      expected: {
        articleId: 60,
        articleName: "Sok",
        type: "event_transfer_out",
        quantity: "-2.0000",
        unitCost: "3.000000",
        value: "-6.0000",
      },
      detail: "MANJKA PREMIK",
    },
    {
      kind: "extra_movement",
      transferId: 11,
      transferExists: false,
      eventId: 21,
      eventExists: false,
      eventName: "Sejem",
      direction: "return",
      status: "completed",
      sourceUnitId: 2,
      sourceUnitName: "Dogodek",
      targetUnitId: 1,
      targetUnitName: "Glavna enota",
      actual: {
        articleId: 70,
        articleName: "Voda",
        type: "event_return_in",
        quantity: "1.0000",
        unitCost: "1.000000",
        value: "1.0000",
      },
      detail: "ODVEČNI PREMIK",
    },
  ],
};

const brokenLinkReport: EventTransferDiagnosticReport = {
  ...fullReport,
  violationCount: 2,
  summary: { missing_transfer_link: 1, orphan_transfer_link: 1 },
  violations: [
    {
      kind: "missing_transfer_link",
      transferId: 10,
      transferExists: true,
      eventId: 20,
      eventExists: true,
      eventName: "Festival",
      direction: "outbound",
      status: "completed",
      sourceUnitId: 1,
      sourceUnitName: "Glavna enota",
      targetUnitId: 2,
      targetUnitName: "Dogodek",
      movementId: 601,
      actual: {
        articleId: 60,
        articleName: "Sok",
        type: "event_transfer_out",
        quantity: "-2.0000",
        unitCost: "3.000000",
        value: "-6.0000",
      },
      detail: "Premik nima namenske povezave.",
    },
    {
      kind: "orphan_transfer_link",
      transferId: 999,
      transferExists: false,
      eventId: null,
      eventExists: false,
      direction: null,
      status: null,
      sourceUnitId: null,
      targetUnitId: null,
      movementId: 602,
      actual: {
        articleId: 70,
        articleName: "Voda",
        type: "event_return_in",
        quantity: "1.0000",
        unitCost: "1.000000",
        value: "1.0000",
      },
      detail: "Povezani prenos ne obstaja.",
    },
  ],
};

const eventDetail: EventTransferDetail = {
  readOnly: true,
  event: {
    id: 20,
    name: "Festival",
    type: "festival",
    status: "active",
    location: "Park",
    customerName: "Naročnik",
    startsAt: "2026-09-04T08:00:00.000Z",
    endsAt: "2026-09-04T20:00:00.000Z",
    notes: "Brez plastike",
    unitId: 1,
    unitName: "Glavna enota",
  },
  transfers: [{
    id: 10,
    direction: "outbound",
    status: "completed",
    sourceUnitId: 1,
    sourceUnitName: "Glavna enota",
    targetUnitId: 2,
    targetUnitName: "Dogodek",
    returnOfId: null,
    completedAt: "2026-09-04T09:00:00.000Z",
    createdAt: "2026-09-04T08:30:00.000Z",
    lines: [{
      id: 100,
      transferId: 10,
      sourceArticleId: 60,
      sourceArticleName: "Sok",
      targetArticleId: 61,
      targetArticleName: "Sok – dogodek",
      quantity: "2.0000",
      unitCost: "3.000000",
      value: "6.0000000000",
      movements: [
        {
          lineId: 100,
          state: "mismatch",
          movementId: 501,
          expected: {
            articleId: 60,
            articleName: "Sok",
            type: "event_transfer_out",
            quantity: "-2.0000",
            unitCost: "3.000000",
            value: "-6.0000",
          },
          actual: {
            articleId: 60,
            articleName: "Sok",
            type: "event_transfer_out",
            quantity: "-2.0000",
            unitCost: "3.000000",
            value: "-5.0000",
          },
          differences: ["value"],
        },
        {
          lineId: 100,
          state: "missing",
          movementId: null,
          expected: {
            articleId: 61,
            articleName: "Sok – dogodek",
            type: "event_transfer_in",
            quantity: "2.0000",
            unitCost: "3.000000",
            value: "6.0000",
          },
          differences: [],
        },
      ],
    }],
    unexpectedMovements: [{
      movementId: 502,
      reason: "extra",
      actual: {
        articleId: 999,
        articleName: "Nepričakovan artikel",
        type: "event_transfer_in",
        quantity: "1.0000",
        unitCost: "1.000000",
        value: "1.0000",
      },
    }],
  }],
};

const movementDetail: EventTransferMovementDetail = {
  readOnly: true,
  id: 501,
  articleId: 60,
  articleName: "Sok",
  unitId: 1,
  unitName: "Glavna enota",
  type: "event_transfer_out",
  quantity: "-2.0000",
  unitCost: "3.000000",
  value: "-5.0000",
  note: "Prenos na dogodek",
  actorSnapshot: "user_direct_456",
  sourceSnapshot: "pos_event_transfer",
  referenceId: 10,
  eventTransferId: 10,
  createdAt: "2026-09-04T09:00:00.000Z",
  transferId: 10,
  transferDirection: "outbound",
  transferStatus: "completed",
  transferCreatedBy: "user_123",
  eventId: 20,
  eventName: "Festival",
};

function mockDiagnostics(report: EventTransferDiagnosticReport) {
  diagnosticsHookMock.mockImplementation(() => ({
    data: report,
    isLoading: false,
    isError: false,
    error: null,
  }));
}

function renderDiagnostics() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <AdminDiagnosticsSection />
    </QueryClientProvider>,
  );
}

async function selectOption(testId: string, value: string) {
  const optionTestId = `${testId}-option-${value}`;
  await waitFor(() => {
    expect(screen.getByTestId(testId)).toBeEnabled();
    expect(screen.getByTestId(optionTestId)).toBeEnabled();
  }, { timeout: 5000 });
  fireEvent.click(screen.getByTestId(optionTestId));
}

describe("Admin diagnostika – CSV prenos", () => {
  let createObjectUrlMock: ReturnType<typeof vi.fn>;
  let anchorClickMock: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    diagnosticsHookMock.mockReset();
    detailHookMock.mockReset();
    movementDetailHookMock.mockReset();
    detailHookMock.mockImplementation((_companyId: string, eventId: number) => ({
      data: eventId === 20 ? eventDetail : undefined,
      isLoading: false,
      isError: false,
      error: null,
    }));
    movementDetailHookMock.mockImplementation((_companyId: string, movementId: number) => ({
      data: movementId > 0
        ? {
          ...movementDetail,
          id: movementId,
          actorSnapshot: movementId === 602 ? null : movementDetail.actorSnapshot,
          sourceSnapshot: movementId === 602 ? null : movementDetail.sourceSnapshot,
        }
        : undefined,
      isLoading: false,
      isError: false,
      error: null,
    }));
    vi.stubGlobal("fetch", vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      expect(init?.method ?? "GET").toBe("GET");
      const url = String(input);
      if (url === "/api/admin/companies") {
        return Promise.resolve(new Response(JSON.stringify({
          companies: [{
            id: "company-1",
            podjetjeDavcna: "11111111",
            naziv: "Mikrona d.o.o.",
            kratekNaziv: null,
            modules: ["erp", "pos"],
            userCount: 1,
            createdAt: "2026-01-01T00:00:00.000Z",
          }],
        }), { status: 200 }));
      }
      if (url === "/api/admin/companies/company-1/enote") {
        return Promise.resolve(new Response(JSON.stringify({
          enote: [{
            id: 1,
            ime: "Glavna enota",
            aktiven: true,
            prostorId: null,
            prostorNaziv: null,
          }],
        }), { status: 200 }));
      }
      throw new Error(`Nepričakovan GET ${url}`);
    }));

    Object.defineProperty(window, "ResizeObserver", {
      configurable: true,
      value: class {
        observe() {}
        unobserve() {}
        disconnect() {}
      },
    });
    Object.defineProperty(window, "PointerEvent", {
      configurable: true,
      value: MouseEvent,
    });
    Object.defineProperty(Element.prototype, "hasPointerCapture", {
      configurable: true,
      value: () => false,
    });
    Object.defineProperty(Element.prototype, "setPointerCapture", {
      configurable: true,
      value: () => {},
    });
    Object.defineProperty(Element.prototype, "releasePointerCapture", {
      configurable: true,
      value: () => {},
    });
    Object.defineProperty(Element.prototype, "scrollIntoView", {
      configurable: true,
      value: () => {},
    });

    createObjectUrlMock = vi.fn(() => "blob:test-download");
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: createObjectUrlMock,
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    anchorClickMock = vi.spyOn(HTMLAnchorElement.prototype, "click")
      .mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    anchorClickMock.mockRestore();
    vi.unstubAllGlobals();
    vi.clearAllMocks();
  });

  it("prenese samo trenutno podjetje, enoto in filtrirano vrsto", async () => {
    mockDiagnostics(fullReport);
    renderDiagnostics();

    await selectOption("select-diag-company", "company-1");
    await selectOption("select-diag-unit", "1");
    await selectOption("select-diag-filter", "missing_movement");

    const button = screen.getByTestId("button-download-diagnostics-csv");
    await waitFor(() => expect(button).toBeEnabled());
    fireEvent.click(button);

    expect(diagnosticsHookMock).toHaveBeenLastCalledWith(
      "company-1",
      { unitId: 1 },
      expect.anything(),
    );
    expect(createObjectUrlMock).toHaveBeenCalledTimes(1);
    expect(anchorClickMock).toHaveBeenCalledTimes(1);
    const anchor = anchorClickMock.mock.instances[0] as HTMLAnchorElement;
    expect(anchor.download).toBe(
      "diagnostika-dogodkovnih-prenosov-mikrona-d-o-o-2026-09-04.csv",
    );

    const blob = createObjectUrlMock.mock.calls[0][0] as Blob;
    const csv = await blob.text();
    expect(csv).toContain("MANJKA PREMIK");
    expect(csv).not.toContain("ODVEČNI PREMIK");
    expect(csv).toContain('"Enota";"Glavna enota";"1"');
    expect(csv).toContain('"Filter";"Manjkajoč premik zaloge"');
  });

  it("pri praznem poročilu ne ustvari datoteke", async () => {
    mockDiagnostics({
      ...fullReport,
      violationCount: 0,
      summary: {},
      violations: [],
    });
    renderDiagnostics();

    await selectOption("select-diag-company", "company-1");
    const button = screen.getByTestId("button-download-diagnostics-csv");
    await waitFor(() => expect(button).toBeDisabled());
    fireEvent.click(button);

    expect(createObjectUrlMock).not.toHaveBeenCalled();
    expect(anchorClickMock).not.toHaveBeenCalled();
  });

  it("odpre veljaven prenos, ohrani filtre in osiroteli ID pusti neklikljiv", async () => {
    mockDiagnostics(fullReport);
    renderDiagnostics();

    await selectOption("select-diag-company", "company-1");
    await selectOption("select-diag-unit", "1");
    await selectOption("select-diag-filter", "missing_movement");

    fireEvent.click(await screen.findByTestId("button-transfer-detail-0"));

    expect(await screen.findByTestId("dialog-event-transfer-detail")).toBeInTheDocument();
    expect(screen.getByText("Festival · #20")).toBeInTheDocument();
    expect(screen.getAllByText("Sok – dogodek ·")).toHaveLength(2);
    expect(screen.getByTestId("event-detail-transfer-10")).toHaveClass("border-purple-400");
    expect(screen.getByText("Vrednosti se razlikujejo")).toBeInTheDocument();
    expect(screen.getByText("Premik manjka")).toBeInTheDocument();
    expect(screen.getByText("Povezanega dejanskega premika ni.")).toBeInTheDocument();
    expect(screen.getByText("Nepričakovani dodatni premiki (1)")).toBeInTheDocument();
    expect(screen.getByText("Nepričakovan artikel ·")).toBeInTheDocument();
    expect(detailHookMock).toHaveBeenLastCalledWith(
      "company-1",
      20,
      expect.objectContaining({ query: expect.objectContaining({ enabled: true }) }),
    );

    fireEvent.click(screen.getByRole("button", { name: "premik #501" }));
    expect(await screen.findByTestId("dialog-movement-audit")).toBeInTheDocument();
    expect(screen.getByText("Premik zaloge #501")).toBeInTheDocument();
    expect(screen.getByText("Čas nastanka").parentElement).toHaveTextContent("2026");
    expect(screen.getByText("user_123")).toBeInTheDocument();
    expect(screen.getByText("user_direct_456")).toBeInTheDocument();
    expect(screen.getByText("pos_event_transfer")).toBeInTheDocument();
    expect(screen.getByText("Izvor povezanega prenosa")).toBeInTheDocument();
    expect(screen.getByText("Prenos na dogodek")).toBeInTheDocument();
    expect(movementDetailHookMock).toHaveBeenLastCalledWith(
      "company-1",
      501,
      expect.objectContaining({ query: expect.objectContaining({ enabled: true }) }),
    );

    const closeButtons = screen.getAllByRole("button", { name: /close/i });
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    await waitFor(() => expect(screen.queryByTestId("dialog-movement-audit")).not.toBeInTheDocument());
    expect(screen.getByTestId("dialog-event-transfer-detail")).toBeInTheDocument();
    expect(screen.getByTestId("event-detail-transfer-10")).toHaveClass("border-purple-400");
    expect(screen.getByTestId("select-diag-company")).toHaveTextContent("company-1");
    expect(screen.getByTestId("select-diag-unit")).toHaveTextContent("1");
    expect(screen.getByTestId("select-diag-filter")).toHaveTextContent("missing_movement");

    expect(screen.queryByTestId("button-event-detail-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-transfer-detail-1")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /close/i }));
    await waitFor(() => expect(screen.queryByTestId("dialog-event-transfer-detail")).not.toBeInTheDocument());
    expect(screen.getByTestId("select-diag-company")).toHaveTextContent("company-1");
    expect(screen.getByTestId("select-diag-unit")).toHaveTextContent("1");
    expect(screen.getByTestId("select-diag-filter")).toHaveTextContent("missing_movement");
  });

  it("odpre sled premika tudi brez veljavne povezave na prenos ali dogodek", async () => {
    mockDiagnostics(brokenLinkReport);
    renderDiagnostics();
    await selectOption("select-diag-company", "company-1");

    expect(screen.queryByTestId("button-transfer-detail-1")).not.toBeInTheDocument();
    expect(screen.queryByTestId("button-event-detail-1")).not.toBeInTheDocument();

    fireEvent.click(await screen.findByTestId("button-movement-detail-0"));
    expect(await screen.findByText("Premik zaloge #601")).toBeInTheDocument();
    expect(movementDetailHookMock).toHaveBeenLastCalledWith(
      "company-1",
      601,
      expect.objectContaining({ query: expect.objectContaining({ enabled: true }) }),
    );

    let closeButtons = screen.getAllByRole("button", { name: /close/i });
    fireEvent.click(closeButtons[closeButtons.length - 1]);
    await waitFor(() => expect(screen.queryByTestId("dialog-movement-audit")).not.toBeInTheDocument());

    fireEvent.click(screen.getByTestId("button-movement-detail-1"));
    expect(await screen.findByText("Premik zaloge #602")).toBeInTheDocument();
    expect(movementDetailHookMock).toHaveBeenLastCalledWith(
      "company-1",
      602,
      expect.objectContaining({ query: expect.objectContaining({ enabled: true }) }),
    );
    expect(screen.getByText("Pri tem premiku ni dokazljivo zabeležen")).toBeInTheDocument();
    expect(screen.getByText("Pri starejšem premiku ni zabeležen")).toBeInTheDocument();
    expect(screen.getByTestId("select-diag-company")).toHaveTextContent("company-1");
  });
});