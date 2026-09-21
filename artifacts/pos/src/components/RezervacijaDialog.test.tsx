import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RezervacijaDialog } from "./RezervacijaDialog";

const createMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());
const toastMock = vi.hoisted(() => vi.fn());

vi.mock("@workspace/api-client-react", () => ({
  getListMizeQueryKey: () => ["/mize"],
  getListRazpolozljiveMizeQueryKey: () => ["/mize/razpolozljivost"],
  getEnotaId: () => "7",
  useCreateRezervacijaMize: () => ({
    mutate: createMock,
    isPending: false,
  }),
  useUpdateRezervacijaMize: () => ({
    mutate: updateMock,
    isPending: false,
  }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: toastMock }),
}));

function renderDialog(
  miza: Record<string, unknown>,
  rezervacija?: Record<string, unknown> | null,
  initialZacetek?: string | null,
) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <RezervacijaDialog
        open
        miza={miza as any}
        rezervacija={rezervacija as any}
        initialZacetek={initialZacetek}
        onOpenChange={vi.fn()}
      />
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  createMock.mockReset();
  updateMock.mockReset();
  toastMock.mockReset();
  vi.stubGlobal("fetch", vi.fn(async () => new Response(null, { status: 404 })));
});

describe("RezervacijaDialog", () => {
  it("pri novi rezervaciji predizpolni termin, izbran v pregledu razpoložljivosti", () => {
    renderDialog({
      id: 11,
      stevilka: 11,
      ime: "Salon",
    }, null, "2035-07-01T18:00:00.000Z");

    expect(screen.getByLabelText("Začetek (čas)")).toHaveValue("2035-07-01T20:00");
  });

  it("predizpolni vse podatke obstoječe rezervacije v času Europe/Ljubljana", () => {
    renderDialog({
      id: 12,
      stevilka: 12,
      ime: "Terasa",
    }, {
      id: 1,
      strankaIme: "Ana Novak",
      telefon: "041 222 333",
      opomba: "Otroški stol",
      zacetek: "2035-07-01T18:00:00.000Z",
    });

    expect(screen.getByLabelText("Telefon")).toHaveValue("041 222 333");
    expect(screen.getByLabelText("Stranka (ime in priimek)")).toHaveValue("Ana Novak");
    expect(screen.getByLabelText("E-pošta")).toHaveValue("");
    expect(screen.getByLabelText("Opombe k stranki")).toHaveValue("");
    expect(screen.getByLabelText("Začetek (čas)")).toHaveValue("2035-07-01T20:00");
    expect(screen.getByLabelText("Opomba k rezervaciji")).toHaveValue("Otroški stol");
  });

  it("zavrne pretekel rok in ne pokliče strežnika", async () => {
    renderDialog({
      id: 13,
      stevilka: 13,
    });

    fireEvent.change(screen.getByLabelText("Telefon"), { target: { value: "040 111 222" } });
    fireEvent.change(screen.getByLabelText("Stranka (ime in priimek)"), { target: { value: "Ana" } });
    fireEvent.change(screen.getByLabelText("Začetek (čas)"), { target: { value: "2020-01-01T12:00" } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Shrani" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Shrani" }));

    expect(await screen.findByText("Čas rezervacije mora biti v prihodnosti")).toBeInTheDocument();
    expect(createMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("pošlje očiščene podatke in zimski lokalni čas pretvori v UTC pri kreiranju", async () => {
    renderDialog({
      id: 14,
      stevilka: 14,
    });

    fireEvent.change(screen.getByLabelText("Telefon"), { target: { value: " 040 111 222 " } });
    fireEvent.change(screen.getByLabelText("Stranka (ime in priimek)"), { target: { value: "  Ana Novak  " } });
    fireEvent.change(screen.getByLabelText("E-pošta"), { target: { value: " ana@example.com " } });
    fireEvent.change(screen.getByLabelText("Opombe k stranki"), { target: { value: "  redna gostja  " } });
    fireEvent.change(screen.getByLabelText("Začetek (čas)"), { target: { value: "2035-12-01T20:00" } });
    fireEvent.change(screen.getByLabelText("Opomba k rezervaciji"), { target: { value: "  ob oknu  " } });
    await waitFor(() => expect(screen.getByRole("button", { name: "Shrani" })).not.toBeDisabled());
    fireEvent.click(screen.getByRole("button", { name: "Shrani" }));

    await waitFor(() => expect(createMock).toHaveBeenCalledTimes(1));
    expect(createMock.mock.calls[0]?.[0]).toEqual({
      id: 14,
      data: {
        strankaIme: "Ana Novak",
        telefon: "040 111 222",
        email: "ana@example.com",
        strankaOpombe: "redna gostja",
        zacetek: "2035-12-01T19:00:00.000Z",
        opomba: "ob oknu",
      },
    });
  });

  it("po vnosu telefona predizpolni podatke znanega naročnika", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify({
      ime: "Maja Kovač",
      email: "maja@example.com",
      opombe: "Alergija na oreščke",
    }), { status: 200 })));
    renderDialog({
      id: 15,
      stevilka: 15,
    });

    fireEvent.change(screen.getByLabelText("Telefon"), { target: { value: "041 987 654" } });

    expect(await screen.findByText("Najden naročnik: Maja Kovač")).toBeInTheDocument();
    expect(screen.getByLabelText("Stranka (ime in priimek)")).toHaveValue("Maja Kovač");
    expect(screen.getByLabelText("E-pošta")).toHaveValue("maja@example.com");
    expect(screen.getByLabelText("Opombe k stranki")).toHaveValue("Alergija na oreščke");
  });

  it("po začasni napaki omogoči ponovno preverjanje istega telefona", async () => {
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new Error("začasna napaka"))
      .mockResolvedValueOnce(new Response(JSON.stringify({
        ime: "Tina Horvat",
        email: null,
        opombe: null,
      }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    renderDialog({
      id: 16,
      stevilka: 16,
    });

    fireEvent.change(screen.getByLabelText("Telefon"), { target: { value: "031 222 333" } });
    expect(await screen.findByText("Naročnika ni bilo mogoče preveriti.")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Poskusi znova" }));

    expect(await screen.findByText("Najden naročnik: Tina Horvat")).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});