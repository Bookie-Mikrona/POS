import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { AccountRecord } from "@workspace/api-client-react";

const mocks = vi.hoisted(() => ({
  user: { vloga: "admin", companyId: "company-1" } as { vloga: string; companyId?: string } | null,
  accounts: [] as AccountRecord[],
  accountsError: null as Error | null,
  customFetch: vi.fn(),
}));

class ResizeObserverMock {
  observe() {}
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("ResizeObserver", ResizeObserverMock);
HTMLElement.prototype.scrollIntoView = vi.fn();

vi.mock("@/contexts/AuthContext", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/hooks/use-toast", () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock("@workspace/api-client-react", () => ({
  customFetch: mocks.customFetch,
  getListAccountsQueryKey: (companyId: string) => [`/api/companies/${companyId}/accounts`],
  useListAccounts: () => ({
    data: { accounts: mocks.accounts },
    isLoading: false,
    isError: !!mocks.accountsError,
    error: mocks.accountsError,
  }),
  useListCounterparties: () => ({
    data: { counterparties: [] },
    isLoading: false,
    isError: false,
    error: null,
  }),
}));

import KontiZaTemeljnicePage, {
  changedBookingSettings,
  eligiblePostingAccounts,
  eligibleVatCodes,
  suggestedAccounts,
} from "./KontiZaTemeljnice";

const account = (overrides: Partial<AccountRecord>): AccountRecord => ({
  id: "account-1",
  companyId: "company-1",
  code: "7600001",
  name: "Prihodki od gostinskih storitev",
  type: "revenue",
  parentId: null,
  isActive: true,
  description: null,
  allowsPosting: true,
  requiresPartner: false,
  requiresCostCenter: false,
  requiresProject: false,
  taxBehavior: "none",
  isCash: false,
  isOpenItem: false,
  createdAt: "2026-01-01",
  updatedAt: "2026-01-01",
  ...overrides,
});

function renderPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <KontiZaTemeljnicePage />
    </QueryClientProvider>,
  );
}

function setupLoadedData() {
  mocks.customFetch.mockImplementation((url: string) => {
    if (url.includes("/vat-codes")) {
      return Promise.resolve({
        vatCodes: [{ id: "vat-22", code: "S22", description: "Standardna stopnja DDV", rate: "22.00" }],
      });
    }
    if (url.includes("pos-booking-settings")) {
      return Promise.resolve({ cashAccountId: "cash-1" });
    }
    return Promise.resolve({});
  });
}

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  mocks.user = { vloga: "admin", companyId: "company-1" };
  mocks.accountsError = null;
  mocks.accounts = [];
});

describe("Konti za POS temeljnice", () => {
  it("izloči neaktivne, skupinske in ne-7-mestne konte ter predlaga ustrezni razred", () => {
    const accounts = [
      account({ id: "a", code: "7600001" }),
      account({ id: "b", code: "7600002", allowsPosting: false }),
      account({ id: "c", code: "760001", isActive: true }),
      account({ id: "d", code: "7600003", isActive: false }),
      account({ id: "e", code: "1000001" }),
    ];

    const eligible = eligiblePostingAccounts(accounts);
    expect(eligible.map((item) => item.id)).toEqual(["e", "a"]);
    expect(suggestedAccounts(eligible, ["76", "77"]).map((item) => item.id)).toEqual(["a"]);
  });

  it("za vsako DDV nastavitev ponudi samo kode ustrezne stopnje", () => {
    const vatCodes = [
      { id: "vat-5", code: "S5", description: "5 %", rate: "5.00" },
      { id: "vat-95", code: "S95", description: "9,5 %", rate: "9.50" },
      { id: "vat-22", code: "S22", description: "22 %", rate: "22.00" },
    ];

    expect(eligibleVatCodes(vatCodes, 5).map((code) => code.id)).toEqual(["vat-5"]);
    expect(eligibleVatCodes(vatCodes, 9.5).map((code) => code.id)).toEqual(["vat-95"]);
    expect(eligibleVatCodes(vatCodes, 22).map((code) => code.id)).toEqual(["vat-22"]);
  });

  it("prikaže polno matriko prihodkov in ločen konto izstopnega DDV 5 %", async () => {
    mocks.accounts = [
      account({ id: "revenue-1", code: "7600001", name: "Prihodki od storitev" }),
      account({ id: "vat-5", code: "2600005", name: "Obveznost DDV 5 %" }),
    ];
    setupLoadedData();
    renderPage();

    expect(await screen.findByTestId("booking-account-select-revenueMaterial5AccountId")).toBeDefined();
    expect(screen.getByTestId("booking-account-select-revenueGoods5AccountId")).toBeDefined();
    expect(screen.getByTestId("booking-account-select-revenueService22AccountId")).toBeDefined();
    expect(screen.getByTestId("booking-account-select-revenueService95AccountId")).toBeDefined();
    expect(screen.getByTestId("booking-account-select-revenueService5AccountId")).toBeDefined();
    expect(screen.getByTestId("booking-account-select-vat5AccountId")).toBeDefined();
    expect(screen.getByText("Prihodki po vrsti × stopnji in izstopni DDV")).toBeDefined();
  });

  it("ob nespremenjeni zastareli DDV kodi shrani samo dejansko spremenjeno nastavitev", () => {
    const saved = { cashAccountId: "old-cash", vat22VatCodeId: "stara-ddv-koda" };
    const current = { cashAccountId: "new-cash", vat22VatCodeId: "stara-ddv-koda" };

    expect(changedBookingSettings(current, saved)).toEqual({ cashAccountId: "new-cash" });
  });

  it("privzeto pokaže predlagani razred, z iskanjem pa najde tudi konto izven njega", async () => {
    mocks.accounts = [
      account({ id: "cash-1", code: "1000001", name: "Denar v blagajni z zelo dolgim nazivom, ki se mora pravilno skrajšati" }),
      account({ id: "revenue-1", code: "7600001", name: "Prihodki od gostinstva" }),
      account({ id: "other-1", code: "9000001", name: "Konto zunaj predlaganega razreda" }),
    ];
    setupLoadedData();
    renderPage();

    const revenueSelect = await screen.findByTestId("booking-account-select-revenueMaterial95AccountId");
    fireEvent.click(revenueSelect);
    expect(screen.getByText("7600001")).toBeDefined();
    expect(screen.queryByText("9000001")).toBeNull();

    fireEvent.change(screen.getByPlaceholderText("Išči po 7-mestni kodi ali nazivu …"), {
      target: { value: "9000001" },
    });
    expect(await screen.findByText("9000001")).toBeDefined();

    expect(screen.getByTitle(/1000001 — Denar v blagajni/).className).toContain("truncate");
  });

  it("za darilne bone ločeno ponudi samo konto predplačil razreda 23", async () => {
    mocks.accounts = [
      account({ id: "pizza-1", code: "1200001", name: "Bon za pico" }),
      account({ id: "advance-1", code: "2300110", name: "Prejeti predujmi — darilni boni" }),
    ];
    setupLoadedData();
    renderPage();

    const advanceSelect = await screen.findByTestId("booking-account-select-advancePaymentsAccountId");
    fireEvent.click(advanceSelect);
    expect(screen.getByText("2300110")).toBeDefined();
    expect(screen.queryByText("1200001")).toBeNull();
    expect(screen.getByText("Darilni boni (predplačila 230)")).toBeDefined();
    expect(screen.getByText("Bon za pico")).toBeDefined();
  });

  it("jasno pokaže napako, kadar kontnega plana ni mogoče naložiti", async () => {
    mocks.accountsError = new Error("HTTP 503");
    setupLoadedData();
    renderPage();

    const notice = await screen.findByTestId("booking-accounts-unavailable");
    expect(notice.textContent).toContain("Kontnega plana ni bilo mogoče naložiti");
  });

  it.each(["admin_enote", "uporabnik"])("ne dovoli neposrednega odpiranja strani vlogi %s", (vloga) => {
    mocks.user = { vloga, companyId: "company-1" };
    renderPage();

    expect(screen.getByTestId("booking-settings-forbidden")).toBeDefined();
    expect(mocks.customFetch).not.toHaveBeenCalled();
  });

  it("prikaže jasno prazno stanje, kadar ni primernega konta", async () => {
    setupLoadedData();
    mocks.accounts = [account({ code: "7600001", allowsPosting: false })];
    renderPage();

    await waitFor(() => {
      expect(screen.getByTestId("booking-accounts-unavailable").textContent).toContain("ni aktivnih, 7-mestnih proknjižljivih kontov");
    });
  });

  it("pusti DDV izbirnik omogočen, da je zastarelo izbiro mogoče odstraniti", async () => {
    mocks.accounts = [account({ id: "cash-1", code: "1000001" })];
    mocks.customFetch.mockImplementation((url: string) => {
      if (url.includes("/vat-codes")) return Promise.resolve({ vatCodes: [] });
      if (url.includes("pos-booking-settings")) return Promise.resolve({ vat22VatCodeId: "legacy-vat" });
      return Promise.resolve({});
    });
    renderPage();

    const vatSelect = await screen.findByTestId("booking-vat-select-vat22VatCodeId");
    expect(vatSelect.hasAttribute("disabled")).toBe(false);
    expect(screen.getByText(/Trenutna DDV koda ni več veljavna/)).toBeDefined();
  });
});