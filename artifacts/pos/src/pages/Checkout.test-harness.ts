import { createElement, type ReactNode } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { vi } from "vitest";

type MockFunction = ReturnType<typeof vi.fn>;

type CheckoutApiClientMockOptions = {
  getNarocila: () => unknown[];
  getAktivneIzmene: () => unknown[];
  createRacunMutate: MockFunction;
  startPaytenAndroidPayment?: MockFunction;
  confirmPaytenAndroidPayment?: MockFunction;
  timeoutPaytenAndroidPayment?: MockFunction;
  authToken?: string | null;
  enotaId?: string | null;
};

const noop = vi.fn();

export function checkoutActorSession(label: string) {
  return `${btoa(JSON.stringify({ n: 1, e: 4102444800000 }))}.${label}`;
}

export const checkoutTestSettings = {
  nazivRestavracije: "Test restavracija",
  naslovRestavracije: "Testna ulica 1",
  davcnaStevilka: "12345678",
  trr: "SI56020000000000000",
  poslovniProstor: "PP001",
  elektronskaNaprava: "B001",
  testniNacin: true,
  smtpAktiven: false,
  certifikatNaložen: false,
};

export const checkoutTestUser = {
  id: 1,
  enotaId: 1,
  username: "natakar",
  ime: "Natakar",
  vloga: "natakar",
  capabilities: ["deposits_tokens"],
  podjetjeDavcna: "12345678",
  imaTrr: true,
  moraZamenjatiGeslo: false,
};

export const checkoutTestTerminalConfig = {
  terminalAktiven: false,
  paytenAndroidAktiven: false,
  sumupAktiven: false,
  sumupTerminalSerial: "",
  vivaAktiven: false,
  vivaTerminalAktiven: false,
  vivaAndroidTerminalAktiven: false,
  vivaTapToPayAktiven: false,
};

export function createCheckoutTestDevice(
  overrides: Record<string, unknown> = {},
) {
  const terminalConfig = {
    ...checkoutTestTerminalConfig,
    ...(overrides.terminalConfig as Record<string, unknown> | undefined),
  };
  return {
    id: 1,
    podjetjeDavcna: "12345678",
    enotaId: 1,
    ime: "Testna naprava",
    napravaKljuc: "test-naprava-kljuc",
    placilniTerminal: null as string | null,
    ustvarjeno: "2026-01-01T00:00:00.000Z",
    posodobljeno: "2026-01-01T00:00:00.000Z",
    ...overrides,
    terminalConfig,
  };
}

export function createCheckoutNastavitveContextMock(
  nastavitve = checkoutTestSettings,
) {
  const value = { nastavitve, nastavitveLoading: false };
  return {
    useNastavitve: () => value,
    NastavitveProvider: ({ children }: { children: ReactNode }) => children,
  };
}

export function createCheckoutBlagajnaContextMock(activeBlagajnaId = 1) {
  const value = { activeBlagajnaId, setActiveBlagajnaId: noop };
  return { useBlagajna: () => value };
}

export function createCheckoutNapravaContextMock(
  naprava = createCheckoutTestDevice(),
) {
  const value = {
    naprava,
    napravaKljuc: String(naprava.napravaKljuc),
    napravaLoading: false,
    refreshNaprava: noop,
  };
  return {
    useNaprava: () => value,
    NapravaProvider: ({ children }: { children: ReactNode }) => children,
  };
}

export function createCheckoutAuthContextMock(user = checkoutTestUser) {
  const value = {
    user,
    loading: false,
    login: noop,
    updateUser: noop,
    logout: noop,
  };
  return { useAuth: () => value };
}

export function createCheckoutTestQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
}

export function CheckoutTestWrapper({
  children,
  qc,
}: {
  children: ReactNode;
  qc: QueryClient;
}) {
  return createElement(QueryClientProvider, { client: qc }, children);
}

/**
 * Skupna, stabilna privzeta pogodba API modula, ki ga uporablja Checkout.
 * Posamezna plačilna zbirka prepiše samo klice integracije, ki jo preverja.
 */
export function createCheckoutApiClientMock({
  getNarocila,
  getAktivneIzmene,
  createRacunMutate,
  startPaytenAndroidPayment = vi.fn(),
  confirmPaytenAndroidPayment = vi.fn(),
  timeoutPaytenAndroidPayment = vi.fn(),
  authToken = "test-clerk-token",
  enotaId = "1",
}: CheckoutApiClientMockOptions) {
  const updateNarocilo = vi.fn();
  const removePostavka = vi.fn();
  const updatePostavkaKolicina = vi.fn();
  const spojiNarocili = vi.fn();
  const posljiEmailRacuna = vi.fn();
  const poisciKupca = vi.fn();
  const blagajne = [{ id: 1, enotaId: 1, aktivna: true, naziv: "Testna blagajna" }];

  return {
    useListBlagajne: () => ({ data: blagajne, isLoading: false }),
    getListBlagajneQueryKey: () => ["/api/blagajne"],
    getEnotaId: () => enotaId,
    getAuthToken: () => Promise.resolve(authToken),
    useListAktivnaNarocila: () => ({ data: getNarocila(), isLoading: false }),
    useGetNarocilo: () => ({ data: undefined, isLoading: false }),
    useCreateRacun: () => ({ mutate: createRacunMutate, isPending: false }),
    useStartPaytenAndroidPayment: () => ({
      mutateAsync: startPaytenAndroidPayment,
      isPending: false,
    }),
    useConfirmPaytenAndroidPayment: () => ({
      mutateAsync: confirmPaytenAndroidPayment,
      isPending: false,
    }),
    useTimeoutPaytenAndroidPayment: () => ({
      mutateAsync: timeoutPaytenAndroidPayment,
      isPending: false,
    }),
    useListAktivneIzmene: () => ({ data: getAktivneIzmene() }),
    useUpdateNarocilo: () => ({ mutate: updateNarocilo, isPending: false }),
    useRemovePostavka: () => ({ mutate: removePostavka }),
    useUpdatePostavkaKolicina: () => ({ mutateAsync: updatePostavkaKolicina }),
    useSpojiNarocili: () => ({
      mutate: spojiNarocili,
      mutateAsync: spojiNarocili,
      isPending: false,
    }),
    usePosljiEmailRacuna: () => ({ mutate: posljiEmailRacuna, isPending: false }),
    useGetPartnerjiCenik: () => ({ data: [], isLoading: false }),
    poisciKupca,
    getListAktivnaNarocilaQueryKey: () => ["/api/narocila/aktivna"],
    getListMizeQueryKey: () => ["/api/mize"],
    getListRacuniQueryKey: () => ["/api/racuni"],
    getGetNarociloQueryKey: (id: number) => ["/api/narocila", id],
  };
}