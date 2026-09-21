import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { WasteRecordsPanel } from "./WasteRecordsPanel";

const createRecord = vi.fn();

vi.mock("@workspace/api-client-react", async () => {
  const actual = await vi.importActual("@workspace/api-client-react");
  return {
    ...actual as any,
    useListPreparedFoodWasteRecords: () => ({ data: [], isLoading: false }),
    useGetPreparedFoodWasteRecord: () => ({ data: undefined }),
    usePreviewPreparedFoodWasteRecord: () => ({
      isLoading: false,
      data: {
        totalQuantity: 2,
        dailyLines: [{
          businessDate: "2026-08-28",
          articleId: 12,
          articleName: "Goveja juha",
          unitOfMeasure: "porcija",
          quantity: 2,
        }],
        summaryLines: [{
          articleId: 12,
          articleName: "Goveja juha",
          unitOfMeasure: "porcija",
          quantity: 2,
        }],
      },
    }),
    useCreatePreparedFoodWasteRecord: () => ({ mutate: createRecord, isPending: false }),
    useUpdatePreparedFoodWasteRecord: () => ({ mutate: vi.fn(), isPending: false }),
    useConfirmPreparedFoodWasteRecord: () => ({ mutate: vi.fn(), isPending: false }),
    getListPreparedFoodWasteRecordsQueryKey: vi.fn(() => ["waste-records"]),
    getListPreparedFoodDailyHistoryQueryKey: vi.fn(() => ["daily-history"]),
    getPreviewPreparedFoodWasteRecordQueryKey: vi.fn(() => ["waste-preview"]),
    getGetPreparedFoodWasteRecordQueryKey: vi.fn(() => ["waste-record"]),
  };
});

describe("WasteRecordsPanel", () => {
  beforeEach(() => createRecord.mockClear());

  it("prikaže zakonske podatke, dnevne vrstice in zahteva oba podpisa", async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <WasteRecordsPanel />
      </QueryClientProvider>
    );
    fireEvent.click(screen.getByRole("button", { name: "Nov zapisnik" }));

    expect(await screen.findByText("Artikli po dnevih")).not.toBeNull();
    expect(screen.getAllByText("Goveja juha").length).toBeGreaterThan(0);
    expect(screen.getByText("Rekapitulacija")).not.toBeNull();
    expect(screen.getByLabelText("Datum zapisnika/odvoza")).not.toBeNull();
    expect(screen.getByLabelText("Obdobje od")).not.toBeNull();
    expect(screen.getByLabelText("Obdobje do")).not.toBeNull();
    expect(screen.getByLabelText("Ugotovitev kala")).not.toBeNull();
    expect(screen.getByLabelText("Razlog odpisa")).not.toBeNull();

    const save = screen.getByRole("button", { name: "Shrani osnutek" }) as HTMLButtonElement;
    expect(save.disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Podpis osebe, ki je kalo ugotovila/predala"), {
      target: { value: "Janez Novak" },
    });
    fireEvent.change(screen.getByLabelText("Podpis odg. osebe"), {
      target: { value: "Vodja Obrata" },
    });
    expect(save.disabled).toBe(false);
    fireEvent.click(save);
    expect(createRecord).toHaveBeenCalledTimes(1);
    expect(createRecord.mock.calls[0][0].data).toMatchObject({
      disposalReason: "Pokvarljivost",
      signaturePerson: "Janez Novak",
      signatureManager: "Vodja Obrata",
    });
  });
});