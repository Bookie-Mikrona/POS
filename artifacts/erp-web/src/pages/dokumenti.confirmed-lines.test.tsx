import "@testing-library/jest-dom";
import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ConfirmedDocumentLines, getConfirmedDocumentLines } from "./dokumenti";
import type { DocumentRecord, ProposedLine } from "@workspace/api-client-react";

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
});