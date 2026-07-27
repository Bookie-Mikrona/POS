/**
 * §71 — Strukturirani error kodi za računovodsko jedro.
 * Frontend prikaže razumljivo sporočilo računovodji; backend vrne strojno berljiv `code`.
 */

export type AccountingErrorCode =
  | "ACCOUNT_NOT_FOUND"
  | "ACCOUNT_INACTIVE"
  | "ACCOUNT_NOT_POSTABLE"
  | "PERIOD_CLOSED"
  | "PERIOD_NOT_FOUND"
  | "ENTRY_NOT_BALANCED"
  | "ENTRY_LINES_TOO_FEW"
  | "LINE_AMOUNT_ZERO"
  | "PARTNER_REQUIRED"
  | "COST_CENTER_REQUIRED"
  | "PROJECT_REQUIRED"
  | "TAX_CODE_REQUIRED"
  | "DUPLICATE_DOCUMENT"
  | "INVALID_TAX_CODE"
  | "COMPANY_NOT_FOUND"
  | "ACCESS_DENIED"
  | "VAT_LEDGER_ERROR";

export interface AccountingErrorPayload {
  code: AccountingErrorCode;
  message: string;
  /** Koda konta pri napakah vezanih na konto */
  account?: string;
  /** Dimenzija pri napakah vezanih na dimenzije */
  dimension?: string;
  /** Vrstica pri napakah vezanih na posamezno vrstico */
  line?: number;
}

/**
 * Ustvari strukturiran error response payload.
 * Uporabi v: res.status(4xx).json(accountingError(...))
 */
export function accountingError(
  code: AccountingErrorCode,
  message: string,
  extra?: Partial<Pick<AccountingErrorPayload, "account" | "dimension" | "line">>,
): AccountingErrorPayload {
  return { code, message, ...extra };
}
