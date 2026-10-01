import { describe, expect, it } from "vitest";
import {
  expectedDocumentVatDirection,
  inheritOmittedVatCodeSelection,
  resolveDocumentVatCodeMappings,
  type DocumentCompanyVatCode,
  type DocumentFursVatCode,
} from "./documentVatCodeMapping";

const companyId = "tenant-1";
const globalCode: DocumentFursVatCode = {
  id: "global-furs-id",
  code: "EUS22",
  direction: "IN",
  rate: "22.00",
  validFrom: "2025-07-01",
  validTo: null,
  isReverseCharge: true,
};
const tenantCode: DocumentCompanyVatCode = {
  id: "tenant-vat-id",
  companyId,
  fursCodeId: globalCode.id,
  rate: "22.00",
  behavior: "reverse_charge",
  validFrom: "2025-07-01",
  validTo: null,
  isActive: true,
};

function resolve(
  codes: DocumentCompanyVatCode[] = [tenantCode],
  furs: DocumentFursVatCode[] = [globalCode],
  date = "2026-02-01",
  direction: "IN" | "OUT" | undefined = "IN",
) {
  return resolveDocumentVatCodeMappings(
    [globalCode.id],
    furs,
    codes,
    companyId,
    date,
    direction,
  );
}

describe("document global-to-company VAT code mapping", () => {
  it("maps distinct global and tenant UUID namespaces through the exact FURS link", () => {
    const result = resolve();
    expect(result.error).toBeNull();
    expect(result.mappings?.get(globalCode.id)).toBe(tenantCode.id);
    expect(result.mappings?.get(globalCode.id)).not.toBe(globalCode.id);
  });

  it("rejects missing or cross-tenant mappings rather than matching by code/rate", () => {
    expect(resolve([]).error).toMatchObject({ kind: "missing_company_mapping" });
    expect(resolve([{ ...tenantCode, companyId: "tenant-2" }]).error)
      .toMatchObject({ kind: "missing_company_mapping" });
  });

  it("rejects duplicate valid links as ambiguous", () => {
    expect(resolve([tenantCode, { ...tenantCode, id: "tenant-vat-id-2" }]).error)
      .toMatchObject({ kind: "ambiguous_company_mapping" });
  });

  it("rejects inactive, date-invalid, rate-mismatched and behavior-mismatched links", () => {
    expect(resolve([{ ...tenantCode, isActive: false }]).error)
      .toMatchObject({ kind: "missing_company_mapping" });
    expect(resolve([{ ...tenantCode, validFrom: "2027-01-01" }]).error)
      .toMatchObject({ kind: "missing_company_mapping" });
    expect(resolve([{ ...tenantCode, validTo: "2026-01-31" }]).error)
      .toMatchObject({ kind: "missing_company_mapping" });
    expect(resolve([{ ...tenantCode, rate: "9.50" }]).error)
      .toMatchObject({ kind: "missing_company_mapping" });
    expect(resolve([{ ...tenantCode, behavior: "standard" }]).error)
      .toMatchObject({ kind: "missing_company_mapping" });
    expect(resolve([tenantCode], [globalCode], "2025-06-30").error)
      .toMatchObject({ kind: "invalid_furs_date" });
  });

  it("validates direction for received IN and issued OUT, rejecting the opposite side", () => {
    expect(expectedDocumentVatDirection("invoice_received")).toBe("IN");
    expect(expectedDocumentVatDirection("invoice_issued")).toBe("OUT");
    expect(resolve([tenantCode], [{ ...globalCode, direction: "OUT" }], "2026-02-01", "IN").error)
      .toMatchObject({ kind: "wrong_direction" });
    expect(resolve([tenantCode], [globalCode], "2026-02-01", "OUT").error)
      .toMatchObject({ kind: "wrong_direction", expected: "OUT" });
  });

  it("inherits only omitted VAT selections and preserves both an explicit null and user choice", () => {
    const proposal = { vatCodeId: globalCode.id };
    expect(inheritOmittedVatCodeSelection<{ vatCodeId?: string | null }>({}, proposal).vatCodeId)
      .toBe(globalCode.id);
    expect(inheritOmittedVatCodeSelection({ vatCodeId: null }, proposal).vatCodeId).toBeNull();
    expect(inheritOmittedVatCodeSelection({ vatCodeId: "user-selected-furs-id" }, proposal).vatCodeId)
      .toBe("user-selected-furs-id");
  });
});