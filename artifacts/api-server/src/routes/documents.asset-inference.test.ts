import { describe, expect, it, vi } from "vitest";

const { router } = vi.hoisted(() => ({
  router: { get: vi.fn(), post: vi.fn() },
}));

vi.mock("express", () => ({ Router: () => router }));
vi.mock("drizzle-orm", () => ({
  eq: vi.fn(),
  and: vi.fn(),
  desc: vi.fn(),
  sql: vi.fn(),
  asc: vi.fn(),
  inArray: vi.fn(),
}));
vi.mock("@workspace/db", () => ({
  db: {},
  documentsTable: {},
  accountingRolesTable: {},
  counterpartiesTable: {},
  accountsTable: {},
  vatCodesTable: {},
  vatCodeTable: {},
  invoicesTable: {},
  invoiceLinesTable: {},
  accountingPeriodsTable: {},
  counterpartyAccountTemplatesTable: {},
}));
vi.mock("@clerk/express", () => ({ clerkClient: { users: { getUser: vi.fn() } } }));
vi.mock("../middlewares/requireAuth", () => ({ requireAuth: vi.fn() }));
vi.mock("../lib/objectStorage", () => ({
  ObjectStorageService: class {
    getObjectEntityFile() { return undefined; }
  },
}));
vi.mock("@workspace/integrations-anthropic-ai", () => ({ anthropic: { messages: { create: vi.fn() } } }));
vi.mock("../lib/directPostingAccountValidation", () => ({ validateDirectPostingAccounts: vi.fn() }));
vi.mock("../lib/purchaseSourceDocuments", () => ({ claimPurchaseSourceDocument: vi.fn() }));

import { inferAssetCandidate, isEuSupplierTaxId } from "./documents";

describe("OCR document fixed-asset inference", () => {
  it("proposes equipment only when the line has explicit acquisition evidence", () => {
    expect(inferAssetCandidate("Nabava prenosnega računalnika")).toMatchObject({
      candidate: "OTHER_FA",
    });
    expect(inferAssetCandidate("Mesečni najem računalniške opreme").candidate).toBeNull();
  });

  it("proposes real estate only for explicit purchase/investment descriptions", () => {
    expect(inferAssetCandidate("Nakup poslovnega prostora")).toMatchObject({
      candidate: "REALESTATE",
    });
    expect(inferAssetCandidate("Stroški vzdrževanja stavbe").candidate).toBeNull();
  });

  it("recognizes EU VAT prefixes without treating Slovenian VAT IDs as foreign EU suppliers", () => {
    expect(isEuSupplierTaxId("DE123456789")).toBe(true);
    expect(isEuSupplierTaxId("EL123456789")).toBe(true);
    expect(isEuSupplierTaxId("SI12345678")).toBe(false);
    expect(isEuSupplierTaxId("12345678")).toBe(false);
  });
});