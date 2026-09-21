import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DostavaStatusPanel } from "./DostavaStatusPanel";

const updateStatusMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());
const historyDataMock = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => ({
  useListDostavniKurirji: () => ({
    data: [
      { id: 7, ime: "Maja", telefon: "041 111 222", aktiven: true },
      { id: 8, ime: "Neaktiven", telefon: null, aktiven: false },
    ],
    isError: false,
    isLoading: false,
  }),
  useGetDostavaStatusHistory: () => ({ data: historyDataMock(), isError: false, isFetching: false }),
  useUpdateDostavaStatus: (options?: {
    mutation?: {
      onSuccess?: (data: unknown, variables: unknown, context: unknown) => void;
    };
  }) => ({
    mutate: (variables: { id: number; data: { status: string; kurirId: number | null; idempotencyKey: string } }) => {
      updateStatusMock(variables);
      options?.mutation?.onSuccess?.(
        { id: variables.id, status: variables.data.status, idempotent: false },
        variables,
        undefined,
      );
    },
    isPending: false,
  }),
  getGetDostavaStatusHistoryQueryKey: (id: number) => [`/api/narocila/${id}/dostava-zgodovina`],
  getGetNarociloQueryKey: (id: number) => [`/api/narocila/${id}`],
  getListAktivnaNarocilaQueryKey: () => ["/api/narocila/aktivna"],
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

function renderPanel(status: string, kurirId: number | null = null) {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <DostavaStatusPanel narociloId={42} status={status} kurirId={kurirId} />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  updateStatusMock.mockReset();
  toastMock.mockReset();
  historyDataMock.mockReset();
  historyDataMock.mockReturnValue([]);
});

describe("DostavaStatusPanel", () => {
  it("pošlje dovoljen naslednji status z idempotency ključem", async () => {
    renderPanel("prejeto");

    fireEvent.click(screen.getByRole("button", { name: "Potrjeno" }));

    await waitFor(() => {
      expect(updateStatusMock).toHaveBeenCalledWith({
        id: 42,
        data: expect.objectContaining({ status: "potrjeno", kurirId: null }),
      });
      const payload = updateStatusMock.mock.calls[0]?.[0]?.data;
      expect(payload?.idempotencyKey).toEqual(expect.any(String));
      expect(payload?.idempotencyKey.length).toBeGreaterThanOrEqual(8);
    });

    expect(toastMock).toHaveBeenCalledWith({ title: "Status dostave posodobljen" });
  });

  it("pred prevzemom zahteva aktivnega kurirja in ga pošlje strežniku", async () => {
    renderPanel("pripravljeno");

    const prevzem = screen.getByRole("button", { name: "Prevzel kurir" });
    expect(prevzem).toBeDisabled();

    await waitFor(() => expect(screen.getByRole("option", { name: "Maja" })).toBeInTheDocument());
    expect(screen.queryByRole("option", { name: "Neaktiven" })).not.toBeInTheDocument();

    fireEvent.change(screen.getByTestId("dostava-kurir-select"), { target: { value: "7" } });
    expect(prevzem).not.toBeDisabled();
    fireEvent.click(prevzem);

    await waitFor(() => {
      expect(updateStatusMock).toHaveBeenCalledWith({
        id: 42,
        data: expect.objectContaining({
          status: "prevzel_kurir",
          kurirId: 7,
        }),
      });
    });
  });

  it("ohrani že dodeljenega kurirja tudi brez ponovne izbire", async () => {
    renderPanel("pripravljeno", 7);

    const prevzem = screen.getByRole("button", { name: "Prevzel kurir" });
    expect(prevzem).not.toBeDisabled();
    fireEvent.click(prevzem);

    await waitFor(() => {
      expect(updateStatusMock).toHaveBeenCalledWith({
        id: 42,
        data: expect.objectContaining({
          status: "prevzel_kurir",
          kurirId: 7,
        }),
      });
    });
  });

  it("zahteva ponovno izbiro, če je že dodeljeni kurir neaktiven", async () => {
    renderPanel("pripravljeno", 8);

    expect(screen.getByTestId("dostava-neaktiven-kurir")).toHaveTextContent(
      "Trenutni kurir ni več aktiven",
    );
    expect(screen.getByRole("button", { name: "Prevzel kurir" })).toBeDisabled();

    fireEvent.change(screen.getByTestId("dostava-kurir-select"), { target: { value: "7" } });
    expect(screen.getByRole("button", { name: "Prevzel kurir" })).not.toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Prevzel kurir" }));

    await waitFor(() => {
      expect(updateStatusMock).toHaveBeenCalledWith({
        id: 42,
        data: expect.objectContaining({
          status: "prevzel_kurir",
          kurirId: 7,
        }),
      });
    });
  });

  it("pri preklicu ne pošlje stare dodelitve kurirja", async () => {
    renderPanel("pripravljeno", 7);

    fireEvent.click(screen.getByRole("button", { name: "Preklicano" }));

    await waitFor(() => {
      expect(updateStatusMock).toHaveBeenCalledWith({
        id: 42,
        data: expect.objectContaining({
          status: "preklicano",
          kurirId: null,
        }),
      });
    });
  });

  it("v zgodovini pokaže ime kurirja pri prevzemu", () => {
    historyDataMock.mockReturnValue([{
      id: 1,
      narociloId: 42,
      enotaId: 3,
      status: "prevzel_kurir",
      kurirId: 7,
      kurirIme: "Maja",
      idempotencyKey: "history-test-1",
      actorId: null,
      ustvarjeno: "2026-08-31T08:00:00.000Z",
    }]);

    renderPanel("dostavljeno", 7);

    expect(screen.getByText("Prevzel kurir")).toBeInTheDocument();
    expect(screen.getByTestId("dostava-status-panel")).toHaveTextContent("Maja");
  });

  it("neznan status v zgodovini prikaže kot opozorilo namesto praznega besedila", () => {
    historyDataMock.mockReturnValue([{
      id: 2,
      narociloId: 42,
      enotaId: 3,
      status: "pokvarjen_status",
      kurirId: null,
      kurirIme: null,
      idempotencyKey: "history-test-2",
      actorId: null,
      ustvarjeno: "2026-08-31T08:01:00.000Z",
    }]);

    renderPanel("dostavljeno");

    expect(screen.getByTestId("dostava-status-panel")).toHaveTextContent("Neznan status");
  });
});