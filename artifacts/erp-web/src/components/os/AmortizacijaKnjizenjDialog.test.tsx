import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ApiError } from "@workspace/api-client-react";
import { AmortizacijaKnjizenjDialog } from "./AmortizacijaKnjizenjDialog";

const state = vi.hoisted(() => ({
  confirm: vi.fn(), navigate: vi.fn(),
  preview: {
    referenca: "AMORT:2024", skupajBreme: "100.00", steviloSredstev: 1, brezKontov: 0,
    vrstice: [{ kontoStroskaId: "a", kontoPopravkaId: "b", znesek: "100.00", steviloSredstev: 1 }],
  },
}));

vi.mock("@workspace/api-client-react", async (importOriginal) => {
  const { ApiError } = await importOriginal<typeof import("@workspace/api-client-react")>();
  return {
    ApiError,
    useGetOsAmortizacijaNastavitve: () => ({
      data: { kontoStroskaId: "a", kontoPopravkaId: "b", hasGlkModule: true },
    }),
    useUpdateOsAmortizacijaNastavitve: () => ({}),
    usePostOsAmortizacijaKnjizenje: () => ({
      isPending: false,
      mutate: (_body: unknown, options: { onSuccess: (data: unknown) => void }) => options.onSuccess(state.preview),
      mutateAsync: state.confirm,
    }),
    useOsAmortizacijaIzpis: () => ({ isPending: false }),
  };
});
vi.mock("wouter", () => ({ useLocation: () => ["/os", state.navigate] }));

beforeEach(() => { vi.clearAllMocks(); });
afterEach(cleanup);

async function confirm(close = vi.fn()) {
  render(<AmortizacijaKnjizenjDialog open onOpenChange={close} companyId="company" leto={2024} skupajRacunovodska="100.00" />);
  fireEvent.click(await screen.findByRole("button", { name: "Pripravi predogled" }));
  fireEvent.click(await screen.findByRole("button", { name: "Ustvari osnutek temeljnice" }));
  return close;
}

describe("obstoječe amortizacijske temeljnice", () => {
  it.each(["draft", "posted"])("409 %s pokaže status in odpre točno obstoječo temeljnico", async (status) => {
    state.confirm.mockRejectedValue(new ApiError(
      new Response(null, { status: 409 }),
      { error: "Temeljnica že obstaja.", code: "DUPLICATE_PERIOD", existingEntries: [{ entryId: "entry-123", status }] },
      { method: "POST", url: "/api/os/company/amortizacija/knjizenje" },
    ));
    const close = await confirm();
    const button = await screen.findByRole("button", { name: "Odpri obstoječo temeljnico" });
    expect(screen.getByText(status === "draft" ? "Osnutek" : "Potrjena")).toBeTruthy();
    fireEvent.click(button);
    expect(state.navigate).toHaveBeenCalledWith("/temeljnice?id=entry-123");
    expect(close).toHaveBeenCalledWith(false);
  });

  it("pokaže vse blokirajoče temeljnice, tudi pri letnem/mesečnem konfliktu", async () => {
    state.confirm.mockRejectedValue(new ApiError(new Response(null, { status: 409 }), {
      error: "Mesečne temeljnice že obstajajo.", code: "MONTHLY_EXISTS_FOR_YEAR",
      existingEntries: [{ entryId: "first", status: "draft" }, { entryId: "second", status: "posted" }],
    }, { method: "POST", url: "/api/os/company/amortizacija/knjizenje" }));
    await confirm();
    await waitFor(() => expect(screen.getAllByRole("button", { name: "Odpri obstoječo temeljnico" })).toHaveLength(2));
    fireEvent.click(screen.getAllByRole("button", { name: "Odpri obstoječo temeljnico" })[1]);
    expect(state.navigate).toHaveBeenCalledWith("/temeljnice?id=second");
  });

  it("pri drugih napakah ne ponudi napačne povezave", async () => {
    state.confirm.mockRejectedValue(new Error("Napaka pri ustvarjanju."));
    await confirm();
    await screen.findByText("Napaka pri ustvarjanju.");
    expect(screen.queryByRole("button", { name: "Odpri obstoječo temeljnico" })).toBeNull();
  });
});
