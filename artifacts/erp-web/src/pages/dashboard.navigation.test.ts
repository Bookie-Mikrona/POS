import { createElement } from "react";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { ledgerMock } = vi.hoisted(() => ({ ledgerMock: vi.fn() }));

vi.mock("@workspace/api-client-react", () => ({ useGetLedger: ledgerMock }));
vi.mock("@/contexts/CompanyContext", () => ({ useCompany: vi.fn() }));

import { BankBalanceCard, isCrossArtifactModule } from "./dashboard";

const COMPANY_ID = "33333333-3333-4333-8333-333333333333";
const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const cardProps = {
  companyId: COMPANY_ID,
  totalBalance: "300.00",
  loading: false,
  accounts: [
    { accountId: ACCOUNT_A, accountCode: "1101", accountName: "Prvi TRR", balance: "100.00", hasStatementBalance: true, evidenceDate: "2026-01-10" },
    { accountId: ACCOUNT_B, accountCode: "1102", accountName: "Drugi TRR", balance: "200.00", hasStatementBalance: true, evidenceDate: "2026-01-10" },
  ],
};

// The ledger contract returns chronological rows; the preview shows the last
// seven newest-first, without reversing the shared query-cache array in place.
// The bounded API already returns its seven-row tail, chronologically.
const ledgerLines = Object.freeze(Array.from({ length: 7 }, (_, offset) => {
  const index = offset + 3;
  return ({
  entryId: `entry-${index + 1}`,
  entryDate: `2026-01-${String(index + 1).padStart(2, "0")}`,
  description: `KNJIŽBA-${String(index + 1).padStart(2, "0")}`,
  debit: index === 9 ? "0.00" : "17.00",
  credit: index === 9 ? "12.35" : "0.00",
  });
}));

function renderCard() {
  return render(createElement(BankBalanceCard, cardProps));
}

function accountButton(code: "1101" | "1102") {
  return screen.getByRole("button", { name: new RegExp(code) });
}

function accountPanel(id: string) {
  const panel = document.getElementById(`bank-ledger-${id}`);
  expect(panel).not.toBeNull();
  return panel!;
}

function normalizedMoney(text: string | null | undefined) {
  return text?.replace(/\u2212/g, "-").replace(/\s+/g, " ").trim();
}

beforeEach(() => {
  ledgerMock.mockReset();
  ledgerMock.mockReturnValue({ data: { lines: ledgerLines }, isLoading: false, isError: false });
});

afterEach(cleanup);

describe("navigacija med ERP in ločenimi aplikacijami", () => {
  it("POS odpre s polno dokumentno navigacijo", () => {
    expect(isCrossArtifactModule("pos")).toBe(true);
  });

  it("ERP module ohrani v notranjem usmerjevalniku", () => {
    expect(isCrossArtifactModule("temeljnice")).toBe(false);
    expect(isCrossArtifactModule("porocila")).toBe(false);
  });
});

describe("razširljiva zgodovina bančnega konta", () => {
  it("pred izborom ne naloži glavne knjige in ne pokaže zgodovine", () => {
    renderCard();

    expect(accountButton("1101")).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(`bank-ledger-${ACCOUNT_A}`)).toBeNull();
    expect(screen.queryByRole("link", { name: "Pokaži vse" })).not.toBeInTheDocument();
    expect(ledgerMock).toHaveBeenLastCalledWith(
      COMPANY_ID, {}, { query: { enabled: false } },
    );
  });

  it("klik odpre pravi konto, ponovni klik ga zapre in onemogoči poizvedbo", () => {
    renderCard();
    const button = accountButton("1101");
    fireEvent.click(button);

    expect(button).toHaveAttribute("aria-expanded", "true");
    expect(button).toHaveAttribute("aria-controls", `bank-ledger-${ACCOUNT_A}`);
    expect(within(accountPanel(ACCOUNT_A)).getByText("KNJIŽBA-10")).toBeInTheDocument();
    expect(ledgerMock).toHaveBeenLastCalledWith(
      COMPANY_ID, { accountId: ACCOUNT_A, recentLimit: 7 }, { query: { enabled: true } },
    );

    fireEvent.click(button);

    expect(button).toHaveAttribute("aria-expanded", "false");
    expect(document.getElementById(`bank-ledger-${ACCOUNT_A}`)).toBeNull();
    expect(screen.queryByText("KNJIŽBA-10")).not.toBeInTheDocument();
    expect(ledgerMock).toHaveBeenLastCalledWith(
      COMPANY_ID, {}, { query: { enabled: false } },
    );
  });

  it("pokaže samo zadnjih sedem knjižb od najnovejše, z datumom in pravilnim predznakom", () => {
    renderCard();
    fireEvent.click(accountButton("1101"));
    const panel = within(accountPanel(ACCOUNT_A));

    expect(panel.getAllByText(/^KNJIŽBA-/).map(node => node.textContent)).toEqual([
      "KNJIŽBA-10", "KNJIŽBA-09", "KNJIŽBA-08", "KNJIŽBA-07",
      "KNJIŽBA-06", "KNJIŽBA-05", "KNJIŽBA-04",
    ]);
    expect(panel.queryByText("KNJIŽBA-03")).not.toBeInTheDocument();
    expect(panel.getByText(/10\.\s*01\.\s*2026/)).toBeInTheDocument();
    expect(normalizedMoney(panel.getByText("KNJIŽBA-10").parentElement?.lastElementChild?.textContent)).toBe("-12,35 €");
    expect(normalizedMoney(panel.getByText("KNJIŽBA-09").parentElement?.lastElementChild?.textContent)).toBe("17,00 €");
    expect(ledgerLines[0].description).toBe("KNJIŽBA-04");
    expect(ledgerLines[6].description).toBe("KNJIŽBA-10");
  });

  it("pri izboru drugega konta zapre prvega in pokaže samo knjižbe drugega", () => {
    ledgerMock.mockImplementation((_companyId: string, params: { accountId?: string }) => ({
      data: { lines: params.accountId === ACCOUNT_B
        ? [{ ...ledgerLines[0], entryId: "second-account-entry", description: "KNJIŽBA DRUGEGA TRR" }]
        : ledgerLines },
      isLoading: false, isError: false,
    }));
    renderCard();
    fireEvent.click(accountButton("1101"));
    fireEvent.click(accountButton("1102"));

    expect(accountButton("1101")).toHaveAttribute("aria-expanded", "false");
    expect(accountButton("1102")).toHaveAttribute("aria-expanded", "true");
    expect(document.getElementById(`bank-ledger-${ACCOUNT_A}`)).toBeNull();
    expect(within(accountPanel(ACCOUNT_B)).getByText("KNJIŽBA DRUGEGA TRR")).toBeInTheDocument();
    expect(screen.queryByText("KNJIŽBA-10")).not.toBeInTheDocument();
    expect(ledgerMock).toHaveBeenLastCalledWith(
      COMPANY_ID, { accountId: ACCOUNT_B, recentLimit: 7 }, { query: { enabled: true } },
    );
  });

  it("prazen rezultat prikaže kot prazno stanje, ne kot napako", () => {
    ledgerMock.mockReturnValue({ data: { lines: [] }, isLoading: false, isError: false });
    renderCard();
    fireEvent.click(accountButton("1101"));
    const panel = within(accountPanel(ACCOUNT_A));

    expect(panel.getByText("Za ta konto še ni knjižb.")).toBeInTheDocument();
    expect(panel.queryByText("Knjižb ni bilo mogoče naložiti.")).not.toBeInTheDocument();
    expect(panel.getByRole("link", { name: "Pokaži vse" })).toHaveAttribute(
      "href", `/glavna-knjiga?accountId=${ACCOUNT_A}`,
    );
  });

  it("ob napaki pokaže opozorilo in ne prikaže praznega stanja ali zastarelih knjižb", () => {
    ledgerMock.mockReturnValue({ data: { lines: ledgerLines }, isLoading: false, isError: true });
    renderCard();
    fireEvent.click(accountButton("1101"));
    const panel = within(accountPanel(ACCOUNT_A));

    expect(panel.getByText("Knjižb ni bilo mogoče naložiti.")).toBeInTheDocument();
    expect(panel.queryByText("Za ta konto še ni knjižb.")).not.toBeInTheDocument();
    expect(panel.queryByText("KNJIŽBA-10")).not.toBeInTheDocument();
  });

  it("med nalaganjem ne kaže praznega stanja in po nalaganju pokaže knjižbe", () => {
    ledgerMock.mockReturnValue({ data: undefined, isLoading: true, isError: false });
    const { rerender } = renderCard();
    fireEvent.click(accountButton("1101"));
    const panel = within(accountPanel(ACCOUNT_A));

    expect(panel.queryByText("Za ta konto še ni knjižb.")).not.toBeInTheDocument();
    expect(panel.queryByText("Knjižb ni bilo mogoče naložiti.")).not.toBeInTheDocument();
    expect(panel.queryByText("KNJIŽBA-10")).not.toBeInTheDocument();

    ledgerMock.mockReturnValue({ data: { lines: ledgerLines }, isLoading: false, isError: false });
    rerender(createElement(BankBalanceCard, cardProps));
    expect(within(accountPanel(ACCOUNT_A)).getByText("KNJIŽBA-10")).toBeInTheDocument();
  });

  it("Pokaži vse vodi v glavno knjigo z ID-jem trenutno izbranega konta", () => {
    renderCard();
    fireEvent.click(accountButton("1101"));
    expect(screen.getByRole("link", { name: "Pokaži vse" })).toHaveAttribute(
      "href", `/glavna-knjiga?accountId=${ACCOUNT_A}`,
    );

    fireEvent.click(accountButton("1102"));
    expect(screen.getAllByRole("link", { name: "Pokaži vse" })).toHaveLength(1);
    expect(screen.getByRole("link", { name: "Pokaži vse" })).toHaveAttribute(
      "href", `/glavna-knjiga?accountId=${ACCOUNT_B}`,
    );
  });
});