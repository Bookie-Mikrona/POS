/** Display-only import metadata: never use a historical code to resolve a partner. */
export function importedPartnerCode(reference: string | null, description: string): string | null {
  if (!reference?.startsWith("BOOKIE-OLD/K2/")) return null;
  return description.match(/\[Bookie Old GLAVNA #[^,\]]+, konto [^,\]]+, partner ([^\s,\]]+)(?: [^\]]*)?\]$/)?.[1] ?? null;
}

/** Imported class 00 and canonical annual OTV vouchers are carryforwards. */
export function isPartnerLedgerOpening(reference: string | null): boolean {
  return /^BOOKIE-OLD\/K2\/\d{4}\/00\//.test(reference ?? "")
    || /^OTV-\d{4}-01$/.test(reference ?? "");
}

/**
 * Keep the opening of the first imported year as the balance baseline only.
 * Later annual carryforwards repeat movements already in this history.
 * Group by both partner and account: their imported histories can start in
 * different years. Never discard an ordinary posting based on its description.
 */
export function effectivePartnerLedgerRows<T extends {
  partnerId: string; accountId: string; postingDate: string; reference: string | null;
}>(rows: readonly T[]): T[] {
  const firstYear = new Map<string, string>();
  for (const row of rows) {
    const key = `${row.partnerId}/${row.accountId}`;
    const year = row.postingDate.slice(0, 4);
    if (!firstYear.has(key) || year < firstYear.get(key)!) firstYear.set(key, year);
  }
  return rows.filter(row => !isPartnerLedgerOpening(row.reference)
    || row.postingDate.slice(0, 4) === firstYear.get(`${row.partnerId}/${row.accountId}`));
}