import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, router } = vi.hoisted(() => ({
  state: { selectResults: [] as unknown[][], selectIndex: 0 },
  router: { get: vi.fn(), post: vi.fn() },
}));

vi.mock("express", () => ({ Router: () => router }));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn((...args: unknown[]) => args),
  and: vi.fn((...args: unknown[]) => args),
  desc: vi.fn((...args: unknown[]) => args),
  sql: vi.fn(),
  asc: vi.fn((...args: unknown[]) => args),
  inArray: vi.fn((...args: unknown[]) => args),
}));
vi.mock("@workspace/db", () => {
  const table = {};
  return {
    db: {
      select: vi.fn(() => {
        const result = state.selectResults[state.selectIndex++] ?? [];
        const query: any = {};
        query.from = vi.fn(() => query);
        query.where = vi.fn(() => query);
        query.orderBy = vi.fn(() => query);
        query.limit = vi.fn(() => query);
        query.innerJoin = vi.fn(() => query);
        query.then = (resolve: (value: unknown) => unknown, reject: (reason: unknown) => unknown) =>
          Promise.resolve(result).then(resolve, reject);
        return query;
      }),
    },
    documentsTable: table,
    companiesTable: table,
    accountingRolesTable: table,
    counterpartiesTable: table,
    accountsTable: table,
    vatCodesTable: table,
    vatCodeTable: table,
    invoicesTable: table,
    invoiceLinesTable: table,
    accountingPeriodsTable: table,
    counterpartyAccountTemplatesTable: table,
  };
});
vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUser: vi.fn() } } }));
vi.mock("../middlewares/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    getObjectEntityFile() {
      return { download: async () => [Buffer.from("fixture document")] };
    }
  },
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({
  anthropic: { messages: { create: vi.fn() } },
}));
vi.mock("../lib/directPostingAccountValidation", () => ({ validateDirectPostingAccounts: vi.fn() }));
vi.mock("../lib/purchaseSourceDocuments", () => ({ claimPurchaseSourceDocument: vi.fn() }));

import { anthropic } from "@workspace/integrations-anthropic-ai";
import { runOcrWithClaude } from "./documents";

const company = {
  naziv: "Mikrona d.o.o.",
  kratekNaziv: "Mikrona",
  podjetjeDavcna: "SI12345678",
  idZaDdv: "SI12345678",
  maticnaStevilka: "123456789",
};

const counterparties = [
  { id: "own-counterparty", name: "Mikrona d.o.o.", taxId: "SI12345678" },
  { id: "cp-de", name: "Kupci Europa", taxId: "DE123456789" },
  { id: "cp-at", name: "Dobavitelj Austria", taxId: "AT123456789" },
];

const vatCodes = [
  { id: "vat-in", code: "EUB22/95", rate: "22", direction: "IN", isReverseCharge: true, validFrom: "2020-01-01", validTo: null },
  { id: "vat-out", code: "OUT22", rate: "22", direction: "OUT", isReverseCharge: false, validFrom: "2020-01-01", validTo: null },
];

function setup(draft: object, options: {
  companyRows?: unknown[];
  accounts?: unknown[];
  recentBookings?: unknown[];
  templates?: unknown[];
  scopedHistory?: unknown[];
} = {}) {
  state.selectIndex = 0;
  state.selectResults = [
    options.companyRows ?? [company],
    counterparties,
    options.accounts ?? [
      { id: "account-expense", code: "4190", name: "Stroški storitev", isActive: true, allowsPosting: true },
      { id: "account-fa", code: "0400", name: "Oprema", isActive: true, allowsPosting: true },
    ],
    vatCodes,
    options.recentBookings ?? [],
    options.templates ?? [
      { counterpartyId: "cp-de", counterpartyName: "Kupci Europa", invoiceType: "issued", lineDescription: "Prodaja", accountCode: "8000", accountName: "Prihodki", vatRate: "22" },
      { counterpartyId: "cp-de", counterpartyName: "Kupci Europa", invoiceType: "received", lineDescription: "Nabava", accountCode: "4190", accountName: "Stroški", vatRate: "22" },
    ],
    options.scopedHistory ?? [],
  ];
  vi.mocked(anthropic.messages.create).mockResolvedValue({
    content: [{ type: "text", text: JSON.stringify(draft) }],
  } as any);
}

describe("runOcrWithClaude company-relative party correction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("corrects an own-issued invoice, rejects self/foreign suggestions, clears wrong-role hints and ignores issued EU asset inference", async () => {
    setup({
      rawText: "Reverse charge. Nakup prenosnega računalnika.",
      confidence: 0.9,
      issuer: { name: "Mikrona d.o.o.", taxId: "SI12345678" },
      recipient: { name: "Kupci Europa", taxId: "DE 123 456 789" },
      // Legacy generic fields and model ID incorrectly point back to the issuer.
      counterpartyName: "Mikrona d.o.o.",
      counterpartyTaxId: "SI12345678",
      suggestedCounterpartyId: "own-counterparty",
      suggestedDocumentType: "invoice_received",
      lines: [{
        description: "Nabava prenosnega računalnika",
        quantity: 1,
        unitPrice: 100,
        vatRate: 0,
        vatBase: 100,
        vatAmount: 0,
        accountId: "account-expense",
        accountCode: "4190",
        vatCodeId: "vat-in",
        confidence: 0.8,
      }],
    });

    const result = await runOcrWithClaude("/objects/test.pdf", "application/pdf", "tenant-1");

    expect(result.suggestedDocumentType).toBe("invoice_issued");
    expect(result.counterpartyName).toBe("Kupci Europa");
    expect(result.counterpartyTaxId).toBe("DE 123 456 789");
    expect(result.suggestedCounterpartyId).toBe("cp-de");
    expect(result.suggestedCounterpartyId).not.toBe("own-counterparty");
    expect(result.lines[0]).toMatchObject({
      accountId: undefined,
      accountCode: undefined,
      vatCodeId: undefined,
      suggestionSource: "pattern",
    });
    expect(result.lines[0].assetTypeCandidate).toBeUndefined();
    expect(result.lines[0].vatCodeReviewRequired).toBeUndefined();

    const createArgs = vi.mocked(anthropic.messages.create).mock.calls[0][0] as any;
    const prompt = createArgs.messages[0].content[1].text as string;
    expect(prompt).toContain("Aktivno podjetje (izdajatelj lastnega izdanega računa, ne partner)");
    expect(prompt).toContain('"issuer"');
    expect(prompt).toContain('"recipient"');
    expect(prompt).toContain("izstopni/izdani");
    expect(prompt).toContain("prodaja/prihodek");
    expect(prompt).not.toContain("[id: own-counterparty]");
  });

  it("recognizes an own recipient and uses only inbound VAT enrichment for the external EU supplier", async () => {
    setup({
      rawText: "Reverse charge; tax to be accounted for by the recipient.",
      confidence: 0.9,
      issuer: { name: "Dobavitelj Austria", taxId: "AT123456789" },
      recipient: { name: "Mikrona", registrationId: "123.456.789" },
      suggestedDocumentType: "invoice_received",
      suggestedCounterpartyId: "id-outside-tenant",
      lines: [{
        description: "Svetovalna storitev",
        quantity: 1,
        unitPrice: 100,
        vatRate: 0,
        vatBase: 100,
        vatAmount: 0,
        vatCodeId: "vat-out",
        accountId: "account-expense",
        accountCode: "4190",
        confidence: 0.8,
      }],
    });

    const result = await runOcrWithClaude("/objects/test.pdf", "application/pdf", "tenant-1");

    expect(result.suggestedDocumentType).toBe("invoice_received");
    expect(result.counterpartyName).toBe("Dobavitelj Austria");
    expect(result.suggestedCounterpartyId).toBe("cp-at");
    expect(result.lines[0].vatCodeId).toBe("vat-in");
    expect(result.lines[0].vatCodeReason).toContain("EUB22/95");
  });

  it("recovers a missing issued revenue account from exact posted partner history beyond the old account limit", async () => {
    const accountRows = Array.from({ length: 205 }, (_, index) => ({
      id: `expense-${index}`,
      code: `4${String(index).padStart(6, "0")}`,
      name: `Expense ${index}`,
      isActive: true,
      allowsPosting: true,
    }));
    accountRows.push({
      id: "revenue-7601000",
      code: "7601000",
      name: "Prihodki od najema programske opreme",
      isActive: true,
      allowsPosting: true,
    });
    setup({
      rawText: "Invoice",
      confidence: 0.9,
      issuer: { name: "Mikrona", taxId: "SI12345678" },
      recipient: { name: "Kupci Europa", taxId: "DE123456789" },
      suggestedDocumentType: "invoice_received",
      lines: [{
        description: "Najem programske opreme",
        quantity: 1,
        unitPrice: 100,
        vatRate: 22,
        vatBase: 100,
        vatAmount: 22,
        confidence: 0.8,
      }],
    }, {
      accounts: accountRows,
      recentBookings: [
        { counterpartyId: "cp-de", counterpartyName: "Kupci Europa", counterpartyTaxId: "DE123456789", invoiceType: "received", invoiceLineId: "received-history", lineDescription: "Najem programske opreme", accountId: "revenue-7601000", accountCode: "7601000" },
        { counterpartyId: "cp-de", counterpartyName: "Kupci Europa", counterpartyTaxId: "DE123456789", invoiceType: "issued", invoiceLineId: "issued-unrelated", lineDescription: "Podpora uporabnikom", accountId: "revenue-7601000", accountCode: "7601000" },
      ],
      scopedHistory: [
        { counterpartyId: "cp-de", invoiceLineId: "posted-1", lineDescription: "Najem programske opreme", accountId: "revenue-7601000", accountCode: "7601000" },
        { counterpartyId: "cp-de", invoiceLineId: "posted-2", lineDescription: "NAJEM programske opreme", accountId: "revenue-7601000", accountCode: "7601000" },
        { counterpartyId: "cp-de", invoiceLineId: "posted-unrelated", lineDescription: "Podpora uporabnikom", accountId: "revenue-7601000", accountCode: "7601000" },
        { counterpartyId: "cp-de", invoiceLineId: "wrong-direction", lineDescription: "Najem programske opreme", accountId: "expense-0", accountCode: "4000000" },
      ],
    });

    const result = await runOcrWithClaude("/objects/test.pdf", "application/pdf", "tenant-1");

    expect(result.suggestedDocumentType).toBe("invoice_issued");
    expect(result.lines[0]).toMatchObject({
      accountId: "revenue-7601000",
      accountCode: "7601000",
      suggestionSource: "history",
      suggestionCount: 2,
    });
    const prompt = (vi.mocked(anthropic.messages.create).mock.calls[0][0] as any).messages[0].content[1].text as string;
    expect(prompt).toContain("7601000: Prihodki od najema programske opreme");
    const accountContext = prompt.split("Kontni načrt (konte za knjiženje):\n")[1]?.split("\n\nDDV kode:")[0] ?? "";
    expect(accountContext.split("\n").filter(Boolean).length).toBeLessThanOrEqual(160);
  });

  it("resolves a model account code against the complete active tenant chart", async () => {
    const accountRows = Array.from({ length: 205 }, (_, index) => ({
      id: `expense-${index}`,
      code: `4${String(index).padStart(6, "0")}`,
      name: `Expense ${index}`,
      isActive: true,
      allowsPosting: true,
    }));
    accountRows.push({
      id: "revenue-7601000",
      code: "7601000",
      name: "Prihodki od najema programske opreme",
      isActive: true,
      allowsPosting: true,
    });
    setup({
      rawText: "Invoice",
      confidence: 0.9,
      issuer: { name: "Mikrona", taxId: "SI12345678" },
      recipient: { name: "Kupci Europa", taxId: "DE123456789" },
      suggestedDocumentType: "invoice_issued",
      lines: [{
        description: "Enkratna storitev",
        quantity: 1,
        unitPrice: 100,
        vatRate: 22,
        vatBase: 100,
        vatAmount: 22,
        accountCode: "7601000",
        confidence: 0.8,
      }],
    }, { accounts: accountRows });

    const result = await runOcrWithClaude("/objects/test.pdf", "application/pdf", "tenant-1");

    expect(result.lines[0]).toMatchObject({
      accountId: "revenue-7601000",
      accountCode: "7601000",
    });
  });

  it("fails explicitly when the active tenant company identity is missing", async () => {
    setup({}, { companyRows: [] });
    await expect(runOcrWithClaude("/objects/test.pdf", "application/pdf", "missing-tenant"))
      .rejects.toThrow("OCR company identity not found");
    expect(anthropic.messages.create).not.toHaveBeenCalled();
  });
});