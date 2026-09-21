import { describe, expect, it, vi } from "vitest";
import type { ProposedLine } from "@workspace/db";

vi.mock("@clerk/express", () => ({
  clerkClient: { users: { getUser: vi.fn() } },
}));

vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create: vi.fn() } },
}));

import { enrichLinesWithSuggestionSource } from "./documents";

const line: ProposedLine = {
  description: "Nova storitev",
  quantity: 1,
  unitPrice: 100,
  vatRate: 22,
  vatBase: 100,
  vatAmount: 22,
  accountId: "account-new",
  accountCode: "4190",
  confidence: 0.8,
};

describe("izvor OCR predloga kontiranja", () => {
  it("uporabi vzorec, ko predlagani partner ne ustreza nobeni predlogi ali pretekli knjižbi", () => {
    const result = enrichLinesWithSuggestionSource(
      [line],
      "counterparty-new",
      [{ counterpartyId: "counterparty-known", accountId: "account-new", usageCount: 7 }],
      [{ counterpartyId: "counterparty-known", accountCode: "4190" }],
    );

    expect(result[0]).toMatchObject({
      suggestionSource: "pattern",
    });
    expect(result[0].suggestionCount).toBeUndefined();
  });

  it("uporabi vzorec, ko predlagani partner ni določen", () => {
    const result = enrichLinesWithSuggestionSource(
      [line],
      null,
      [{ counterpartyId: "counterparty-known", accountId: "account-new", usageCount: 7 }],
      [{ counterpartyId: "counterparty-known", accountCode: "4190" }],
    );

    expect(result[0]).toMatchObject({
      suggestionSource: "pattern",
    });
    expect(result[0].suggestionCount).toBeUndefined();
  });
});