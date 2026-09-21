import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import PlateWastePage from "./PlateWaste";

const { mockSaveDaily, mockCreateHandover, mockDownloadPdf } = vi.hoisted(() => ({
  mockSaveDaily: vi.fn(),
  mockCreateHandover: vi.fn(),
  mockDownloadPdf: vi.fn(),
}));

vi.mock("@workspace/api-client-react", async () => {
  const actual = await vi.importActual("@workspace/api-client-react");
  return {
    ...actual as any,
    useGetPlateWasteOverview: () => ({
      data: {
        categoryCode: "20 01 08",
        wasteType: "Biološko razgradljivi kuhinjski odpadek",
        source: "ostanki s krožnikov",
        companyName: "Testno podjetje",
        businessUnitName: "Testna enota",
        entries: [],
        handovers: [{
          id: 7,
          enotaId: 1,
          handoverDate: "2026-08-29",
          entryType: "oddaja",
          quantityKg: 1.2,
          collectorName: "Prevzemnik d.o.o.",
          manifestNumber: "EL-7",
          note: "",
          correctionOfId: null,
          createdBy: "user",
          createdAt: "2026-08-29T10:00:00.000Z",
        }],
        summary: {
          generatedQuantityKg: 2.5,
          handedOverQuantityKg: 1.2,
          remainingQuantityKg: 1.3,
        },
      },
      isLoading: false,
      isError: false,
    }),
    useSavePlateWasteDailyEntry: () => ({
      mutate: mockSaveDaily,
      isPending: false,
    }),
    useCreatePlateWasteHandover: () => ({
      mutate: mockCreateHandover,
      isPending: false,
    }),
    downloadPlateWasteHandoverPdf: mockDownloadPdf,
    getGetPlateWasteOverviewQueryKey: () => ["plate-waste"],
    downloadPlateWasteExport: vi.fn(),
  };
});

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <PlateWastePage />
    </QueryClientProvider>,
  );
}

describe("PlateWastePage", () => {
  beforeEach(() => {
    mockSaveDaily.mockReset();
    mockCreateHandover.mockReset();
    mockDownloadPdf.mockReset();
  });

  it("jasno prikaže, da je evidenca ločena od preostalega sistema", () => {
    renderPage();
    expect(screen.getByText("Neodvisna evidenca")).not.toBeNull();
    expect(screen.getByText(/ne vplivajo na zalogo, prodajo, normative, pripravljeno hrano, kalo ali računovodstvo/i)).not.toBeNull();
    expect(screen.getByText(/Testno podjetje · Testna enota/)).not.toBeNull();
  });

  it("pošlje dnevno količino v kilogramih", () => {
    mockSaveDaily.mockImplementation((_variables, callbacks) => callbacks?.onSuccess?.({}));
    renderPage();
    fireEvent.change(screen.getByLabelText("Količina"), { target: { value: "2,4" } });
    fireEvent.click(screen.getByRole("button", { name: /Shrani dnevni vnos/i }));
    expect(mockSaveDaily).toHaveBeenCalledWith(
      expect.objectContaining({ data: { quantityKg: 2.4, note: undefined } }),
      expect.any(Object),
    );
  });

  it("popravek ustvari novo sledljivo vrstico in ne spreminja izvirne oddaje", () => {
    mockCreateHandover.mockImplementation((_variables, callbacks) => callbacks?.onSuccess?.({}));
    renderPage();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Oddaja prevzemnikom" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Popravek" }));
    fireEvent.click(screen.getByRole("button", { name: "Shrani popravek" }));
    expect(mockCreateHandover).toHaveBeenCalledWith(
      expect.objectContaining({
        data: expect.objectContaining({
          entryType: "popravek",
          quantityKg: -1.2,
          correctionOfId: 7,
        }),
      }),
      expect.any(Object),
    );
  });

  it("omogoči A4 PDF za vsako oddajo ali popravek", () => {
    mockDownloadPdf.mockResolvedValue(new Blob(["%PDF-1.7"]));
    vi.spyOn(URL, "createObjectURL").mockReturnValue("blob:test-pdf");
    renderPage();
    fireEvent.mouseDown(screen.getByRole("tab", { name: "Oddaja prevzemnikom" }), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(screen.getByRole("button", { name: "Odpri A4 PDF za zapis 7" }));
    expect(mockDownloadPdf).toHaveBeenCalledWith(7, expect.objectContaining({ responseType: "blob" }));
  });
});