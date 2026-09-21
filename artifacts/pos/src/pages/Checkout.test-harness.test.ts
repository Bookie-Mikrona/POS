import { describe, expect, it, vi } from "vitest";
import { createCheckoutApiClientMock } from "./Checkout.test-harness";

function createHarness(
  overrides: Partial<Parameters<typeof createCheckoutApiClientMock>[0]> = {},
) {
  const narocila = [{ id: 1 }];
  const aktivneIzmene = [{ id: 2, natakariId: 7 }];
  const createRacunMutate = vi.fn();
  const api = createCheckoutApiClientMock({
    getNarocila: () => narocila,
    getAktivneIzmene: () => aktivneIzmene,
    createRacunMutate,
    ...overrides,
  });
  return { api, narocila, aktivneIzmene, createRacunMutate };
}

describe("createCheckoutApiClientMock", () => {
  it("ob ponovnih klicih hookov ohrani podatkovne in mutacijske reference", () => {
    const { api, narocila, aktivneIzmene, createRacunMutate } = createHarness();

    expect(api.useListAktivnaNarocila().data).toBe(narocila);
    expect(api.useListAktivnaNarocila().data).toBe(narocila);
    expect(api.useListAktivneIzmene().data).toBe(aktivneIzmene);
    expect(api.useListAktivneIzmene().data).toBe(aktivneIzmene);

    expect(api.useCreateRacun().mutate).toBe(createRacunMutate);
    expect(api.useCreateRacun().mutate).toBe(api.useCreateRacun().mutate);
    expect(api.useUpdateNarocilo().mutate).toBe(api.useUpdateNarocilo().mutate);
    expect(api.useRemovePostavka().mutate).toBe(api.useRemovePostavka().mutate);
    expect(api.useUpdatePostavkaKolicina().mutateAsync)
      .toBe(api.useUpdatePostavkaKolicina().mutateAsync);
    expect(api.useSpojiNarocili().mutate).toBe(api.useSpojiNarocili().mutateAsync);
    expect(api.useSpojiNarocili().mutate).toBe(api.useSpojiNarocili().mutate);
    expect(api.usePosljiEmailRacuna().mutate).toBe(api.usePosljiEmailRacuna().mutate);
  });

  it("Payten override zamenja samo namenski mutateAsync funkciji", () => {
    const startPaytenAndroidPayment = vi.fn();
    const confirmPaytenAndroidPayment = vi.fn();
    const { api, createRacunMutate } = createHarness({
      startPaytenAndroidPayment,
      confirmPaytenAndroidPayment,
    });

    expect(api.useStartPaytenAndroidPayment().mutateAsync)
      .toBe(startPaytenAndroidPayment);
    expect(api.useConfirmPaytenAndroidPayment().mutateAsync)
      .toBe(confirmPaytenAndroidPayment);
    expect(api.useCreateRacun().mutate).toBe(createRacunMutate);
    expect(api.useUpdateNarocilo().mutate).not.toBe(startPaytenAndroidPayment);
    expect(api.useUpdateNarocilo().mutate).not.toBe(confirmPaytenAndroidPayment);
  });

  it("uporabi centralna privzeta auth podatka", async () => {
    const { api } = createHarness();

    expect(api.getEnotaId()).toBe("1");
    await expect(api.getAuthToken()).resolves.toBe("test-clerk-token");
  });
});