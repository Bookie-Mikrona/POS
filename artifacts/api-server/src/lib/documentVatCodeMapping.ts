export type DocumentFursVatCode = {
  id: string;
  code: string;
  direction: "IN" | "OUT";
  rate: string | number;
  validFrom: string;
  validTo: string | null;
  isReverseCharge: boolean;
};

export type DocumentCompanyVatCode = {
  id: string;
  companyId: string;
  fursCodeId: string | null;
  rate: string | number;
  behavior: "standard" | "exempt" | "zero_rated" | "reverse_charge";
  validFrom: string | null;
  validTo: string | null;
  isActive: boolean;
};

export type DocumentVatCodeMappingError =
  | { kind: "missing_furs_code"; fursCodeId: string }
  | { kind: "invalid_furs_date"; fursCodeId: string; code: string }
  | { kind: "wrong_direction"; fursCodeId: string; code: string; expected: "IN" | "OUT" }
  | { kind: "missing_company_mapping"; fursCodeId: string; code: string }
  | { kind: "ambiguous_company_mapping"; fursCodeId: string; code: string };

export function documentVatBehavior(code: DocumentFursVatCode): DocumentCompanyVatCode["behavior"] {
  if (code.isReverseCharge) return "reverse_charge";
  if (Number(code.rate) !== 0) return "standard";
  // The FURS exempt supply/purchase codes have no right to deduction. Other
  // non-taxed FURS classifications (exports, EU supplies, etc.) are zero-rated.
  if (code.code === "SOP" || code.code === "POP") return "exempt";
  return "zero_rated";
}

function isValidOnDate(
  validFrom: string | null,
  validTo: string | null,
  date: string,
): boolean {
  return (validFrom == null || validFrom <= date)
    && (validTo == null || validTo >= date);
}

/**
 * Maps submitted global FURS IDs to exactly one active, date-valid tenant code.
 * Never matches by display code or rate alone.
 */
export function resolveDocumentVatCodeMappings(
  fursCodeIds: string[],
  fursCodes: DocumentFursVatCode[],
  companyCodes: DocumentCompanyVatCode[],
  companyId: string,
  invoiceDate: string,
  expectedDirection?: "IN" | "OUT",
): { mappings: Map<string, string>; error: null } | {
  mappings: null;
  error: DocumentVatCodeMappingError;
} {
  const fursById = new Map(fursCodes.map((code) => [code.id, code]));
  const mappings = new Map<string, string>();

  for (const fursCodeId of [...new Set(fursCodeIds)]) {
    const fursCode = fursById.get(fursCodeId);
    if (!fursCode) {
      return { mappings: null, error: { kind: "missing_furs_code", fursCodeId } };
    }
    if (!isValidOnDate(fursCode.validFrom, fursCode.validTo, invoiceDate)) {
      return {
        mappings: null,
        error: { kind: "invalid_furs_date", fursCodeId, code: fursCode.code },
      };
    }
    if (expectedDirection && fursCode.direction !== expectedDirection) {
      return {
        mappings: null,
        error: {
          kind: "wrong_direction",
          fursCodeId,
          code: fursCode.code,
          expected: expectedDirection,
        },
      };
    }

    const validCompanyCodes = companyCodes.filter((companyCode) =>
      companyCode.companyId === companyId
      && companyCode.fursCodeId === fursCodeId
      && companyCode.isActive
      && isValidOnDate(companyCode.validFrom, companyCode.validTo, invoiceDate)
      && Number(companyCode.rate) === Number(fursCode.rate)
      && companyCode.behavior === documentVatBehavior(fursCode),
    );
    if (validCompanyCodes.length !== 1) {
      return {
        mappings: null,
        error: validCompanyCodes.length > 1
          ? { kind: "ambiguous_company_mapping", fursCodeId, code: fursCode.code }
          : { kind: "missing_company_mapping", fursCodeId, code: fursCode.code },
      };
    }
    mappings.set(fursCodeId, validCompanyCodes[0].id);
  }

  return { mappings, error: null };
}

/** Only omitted selections inherit the server's OCR proposal; explicit null is intentional. */
export function inheritOmittedVatCodeSelection<T extends { vatCodeId?: string | null }>(
  submitted: T,
  proposal: { vatCodeId?: string | null } | undefined,
): T {
  if (submitted.vatCodeId !== undefined || !proposal || proposal.vatCodeId === undefined) {
    return submitted;
  }
  return { ...submitted, vatCodeId: proposal.vatCodeId };
}

export function expectedDocumentVatDirection(
  documentType: string | null | undefined,
): "IN" | "OUT" | undefined {
  if (documentType === "invoice_received") return "IN";
  if (documentType === "invoice_issued") return "OUT";
  return undefined;
}