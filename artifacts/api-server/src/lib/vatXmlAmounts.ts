export interface KprExportVatAmounts {
  deductibleVat: number;
  nonDeductibleVat: number;
}

/**
 * vat_ledger already stores the deductible part in vat_amount and the
 * non-deductible part in non_deductible_vat. Export must not apply the
 * deduction percentage a second time.
 */
export function getKprExportVatAmounts(
  storedDeductibleVat: number,
  storedNonDeductibleVat: number,
): KprExportVatAmounts {
  return {
    deductibleVat: storedDeductibleVat,
    nonDeductibleVat: storedNonDeductibleVat,
  };
}