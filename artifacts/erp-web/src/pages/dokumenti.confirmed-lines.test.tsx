import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  ConfirmedDocumentLines,
  ConfirmedExchangeRateSummary,
  ConfirmedGrossTreatmentSummary,
  getConfirmedDocumentLines,
} from "./dokumenti";
import type { DocumentExchangeRateSnapshot, DocumentRecord, ProposedLine } from "@workspace/api-client-react";

const baseLine = {
  description: "Računovodska storitev",
  quantity: 1,
  unitPrice: 100,
  vatRate: 22,
  vatBase: 100,
  vatAmount: 22,
  confidence: 0.95,
  accountId: "account-1",
  accountCode: "4150",
} satisfies ProposedLine;

describe("ConfirmedDocumentLines", () => {
  it("v potrjenem pogledu uporabi računovodjeve potrjene vrstice namesto prvotnega OCR predloga", () => {
    const ocrLine = { ...baseLine, suggestionSource: "pattern" as const };
    const confirmedLine = {
      ...baseLine,
      accountCode: "4100",
      suggestionSource: "manual" as const,
    };
    const doc = {
      ocrResult: { rawText: "", confidence: 0.9, lines: [ocrLine] },
      confirmedData: { rawText: "", confidence: 0.9, lines: [confirmedLine] },
    } as Pick<DocumentRecord, "ocrResult" | "confirmedData">;

    render(<ConfirmedDocumentLines lines={getConfirmedDocumentLines(doc)} />);

    expect(screen.getByText("4100")).toBeInTheDocument();
    expect(screen.getByText("Ročna izbira")).toBeInTheDocument();
    expect(screen.queryByText("Tipičen vzorec kontiranja")).not.toBeInTheDocument();
  });

  it("pri vsaki potrjeni vrstici prikaže ohranjeni vir predloga", () => {
    render(
      <ConfirmedDocumentLines
        lines={[
          { ...baseLine, suggestionSource: "history", suggestionCount: 3 },
          { ...baseLine, description: "Elektrika", accountCode: "4120", suggestionSource: "pattern" },
          { ...baseLine, description: "Najemnina", accountCode: "4100", suggestionSource: "manual" },
        ]}
      />,
    );

    expect(screen.getByText("Potrjeno kontiranje")).toBeInTheDocument();
    expect(screen.getByText("Na podlagi 3 potrjenih kontiranj tega partnerja")).toBeInTheDocument();
    expect(screen.getByText("Tipičen vzorec kontiranja")).toBeInTheDocument();
    expect(screen.getByText("Ročna izbira")).toBeInTheDocument();
  });

  it("after reload renders the persisted exchange-rate audit with source and EUR totals", () => {
    const exchangeRate = {
      mode: "manual",
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      requestedDate: "2026-09-01",
      rateDate: "2026-08-31",
      unitsPerEur: 1.1,
      source: "manual",
      sourceUrl: null,
      sourceTotals: { net: 20, vat: 4.4, gross: 24.4 },
      eurTotals: { net: 18.18, vat: 4, gross: 22.18 },
      roundingDifference: 0.01,
      convertedAt: "2026-09-02T10:00:00.000Z",
      manualReason: "Bančni tečaj",
    } satisfies DocumentExchangeRateSnapshot;

    render(<ConfirmedExchangeRateSummary exchangeRate={exchangeRate} />);

    expect(screen.getByText("Potrjena pretvorba valute")).toBeInTheDocument();
    expect(screen.getByText(/USD → EUR · 1 EUR = 1,1 USD/)).toBeInTheDocument();
    expect(screen.getByText(/Utemeljitev ročnega tečaja: Bančni tečaj/)).toBeInTheDocument();
    expect(screen.getByText(/Razlika zaokroževanja/)).toBeInTheDocument();
    expect(screen.getByText(/24,40/)).toBeInTheDocument();
  });

  it("after reload renders gross USD booking totals and the source-cent reconciliation audit", () => {
    const exchangeRate = {
      mode: "ecb",
      vatTreatment: "gross-expense-no-input-vat",
      sourceCurrency: "USD",
      targetCurrency: "EUR",
      requestedDate: "2026-07-30",
      rateDate: "2026-07-30",
      unitsPerEur: 1.1476,
      source: "ECB",
      sourceUrl: null,
      sourceTotals: { net: 250.8, vat: 55.18, gross: 305.98 },
      eurTotals: { net: 266.63, vat: 0, gross: 266.63 },
      roundingDifference: 0,
      convertedAt: "2026-07-30T10:00:00.000Z",
      sourceRoundingAdjustment: {
        sourceCurrency: "USD",
        sourceGross: 305.98,
        lineGross: 305.96,
        amount: 0.02,
        lineIndex: 2,
      },
      expenseEurRoundingAdjustment: {
        amount: 0.02,
        lineIndex: 2,
      },
    } satisfies DocumentExchangeRateSnapshot & {
      expenseEurRoundingAdjustment: { amount: number; lineIndex: number };
    };

    render(<ConfirmedExchangeRateSummary exchangeRate={exchangeRate} />);

    expect(screen.getByText(/Potrjena pretvorba in knjiženje celotnega zneska v strošek/)).toBeInTheDocument();
    expect(screen.getByText(/Knjiženi strošek 266,63/)).toBeInTheDocument();
    expect(screen.getByText(/odbitni DDV 0,00/)).toBeInTheDocument();
    expect(screen.getByText(/Centna uskladitev OCR: seštevek vrstic 305,96.*znesek dokumenta 305,98.*razlika 0,02.*postavke 3/)).toBeInTheDocument();
    expect(screen.getByText(/Uskladitev EUR zaokroževanja: \+0,02 EUR pri postavki 3, da strošek ustreza preračunu celotnega zneska dokumenta/)).toBeInTheDocument();
  });

  it("after reload renders EUR gross-cost totals and persisted source reconciliation", () => {
    render(
      <ConfirmedGrossTreatmentSummary
        currency="EUR"
        grossAmount={305.98}
        sourceTotals={{ net: 250.8, vat: 55.18, gross: 305.98 }}
        sourceRoundingAdjustment={{
          sourceCurrency: "EUR",
          sourceGross: 305.98,
          lineGross: 305.96,
          amount: 0.02,
          lineIndex: 20,
        }}
        expenseEurRoundingAdjustment={{ amount: 0.02, lineIndex: 2 }}
      />,
    );

    expect(screen.getByText(/Izvorni zneski \(EUR\)/)).toBeInTheDocument();
    expect(screen.getByText(/Knjiženi strošek:/).parentElement).toHaveTextContent("305,98");
    expect(screen.getByText(/Odbitni DDV:/).parentElement).toHaveTextContent("0,00");
    expect(screen.getByText(/Centna uskladitev OCR: seštevek vrstic 305,96.*znesek dokumenta 305,98/)).toBeInTheDocument();
    expect(screen.getByText(/Uskladitev EUR zaokroževanja: \+0,02 EUR pri postavki 3, da strošek ustreza preračunu celotnega zneska dokumenta/)).toBeInTheDocument();
  });
});