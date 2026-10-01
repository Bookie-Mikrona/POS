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
  companiesTable: {},
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
import {
  classifyPartyIdentity,
  filterSelfCounterparties,
  findScopedCounterparty,
  normalizeTaxId,
  resolveDocumentParties,
} from "../lib/documentPartyResolution";

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

describe("OCR active-company party resolution", () => {
  const company = {
    naziv: "Mikrona d.o.o.",
    kratekNaziv: "Mikrona",
    podjetjeDavcna: "SI 12-345678",
    idZaDdv: "si12345678",
    maticnaStevilka: "123.456.789",
  };

  it("normalizes SI prefixed and bare Slovenian tax IDs, without collapsing foreign IDs", () => {
    expect(normalizeTaxId(" si 12-345678 ")).toBe("12345678");
    expect(normalizeTaxId("12.345.678")).toBe("12345678");
    expect(normalizeTaxId("de 12-345678")).toBe("DE12345678");
    expect(normalizeTaxId("AT12345678")).not.toBe(normalizeTaxId("12345678"));
  });

  it("recognizes a seven-digit Slovenian registration number and its head-office suffix as the same company", () => {
    const headOffice = { ...company, maticnaStevilka: "5711053000" };
    expect(classifyPartyIdentity({ taxId: "SI12345678", registrationId: "5711053" }, headOffice)).toBe("self");
    expect(classifyPartyIdentity({ registrationId: "5711053" }, headOffice)).toBe("self");
    expect(classifyPartyIdentity({ registrationId: "5711053000" }, { ...company, maticnaStevilka: "5711053" })).toBe("self");
    expect(classifyPartyIdentity({ taxId: "SI12345678", registrationId: "5711053001" }, headOffice)).toBe("conflict");
    expect(classifyPartyIdentity({ taxId: "SI99887766", registrationId: "5711053" }, headOffice)).toBe("conflict");
  });

  it("recognizes company aliases only when party IDs are absent, and treats conflicting IDs as evidence", () => {
    expect(classifyPartyIdentity({ name: "MIKRONA" }, company)).toBe("self");
    expect(classifyPartyIdentity({ name: "Mikrona d.o.o.", taxId: "SI99887766" }, company)).toBe("other");
    expect(classifyPartyIdentity({ name: "Different name", taxId: "12 345 678" }, company)).toBe("self");
    expect(classifyPartyIdentity({ registrationId: "123456789" }, company)).toBe("self");
    expect(classifyPartyIdentity({ taxId: "12345678", registrationId: "999999999" }, company)).toBe("conflict");
  });

  it("corrects company issuer and recipient roles and keeps both-self documents unresolved", () => {
    const customer = { name: "Kupec d.o.o.", taxId: "DE123456789" };
    expect(resolveDocumentParties(
      { name: "Mikrona", taxId: "SI12345678" },
      customer,
      company,
      "invoice_received",
    )).toMatchObject({
      documentType: "invoice_issued",
      oppositeParty: customer,
      correctedModelType: true,
    });
    expect(resolveDocumentParties(
      { name: "Supplier d.o.o.", taxId: "AT123456789" },
      { name: "Mikrona", registrationId: "123456789" },
      company,
      "invoice_issued",
    )).toMatchObject({
      documentType: "invoice_received",
      correctedModelType: true,
    });
    const bothOwn = resolveDocumentParties(
      { name: "Mikrona" },
      { name: "Mikrona d.o.o." },
      company,
      "invoice_received",
    );
    expect(bothOwn.documentType).toBeUndefined();
    expect(bothOwn.oppositeParty).toBeUndefined();
    expect(bothOwn.ambiguous).toBe(true);
  });

  it("filters self from the catalog and never name-matches when an ID conflicts", () => {
    const catalog = [
      { id: "self", name: "Mikrona d.o.o.", taxId: "SI12345678" },
      { id: "customer", name: "Kupec d.o.o.", taxId: "DE123456789" },
      { id: "same-name-conflict", name: "Kupec d.o.o.", taxId: "AT987654321" },
    ];
    const visible = filterSelfCounterparties(catalog, company);
    expect(visible.map(row => row.id)).toEqual(["customer", "same-name-conflict"]);
    expect(findScopedCounterparty(
      { name: "Kupec d.o.o.", taxId: "DE 123456789" },
      company,
      visible,
    )?.id).toBe("customer");
    expect(findScopedCounterparty(
      { name: "Kupec d.o.o.", taxId: "DE000000000" },
      company,
      visible,
    )).toBeUndefined();
    expect(findScopedCounterparty({ name: "Kupec d.o.o." }, company, visible)?.id).toBe("customer");
  });

  it("does not guess a direction for unknown or conflicting roles", () => {
    const unknownRoles = resolveDocumentParties(null, null, company, "unknown");
    expect(unknownRoles.documentType).toBeUndefined();
    expect(unknownRoles.oppositeParty).toBeUndefined();
    expect(unknownRoles.ambiguous).toBe(true);
    const conflictingRoles = resolveDocumentParties(
      { name: "Mikrona", taxId: "SI12345678", registrationId: "999999999" },
      { name: "Kupec", taxId: "DE123456789" },
      company,
      "invoice_received",
    );
    expect(conflictingRoles.documentType).toBeUndefined();
    expect(conflictingRoles.oppositeParty).toBeUndefined();
    expect(conflictingRoles.ambiguous).toBe(true);
  });
});