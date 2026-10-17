import { accountTypeForCode } from "./slovenianChartOfAccounts";

const labels: Record<string, string> = {
  asset: "Sredstvo", liability: "Obveznost", equity: "Kapital",
  revenue: "Prihodek", expense: "Odhodek",
};

/** Reuse the chart generator's SRS rules, including the class 9 exceptions. */
export function expectedAccountType(code: string) {
  return /^\d/.test(code) ? accountTypeForCode(code) : undefined;
}

export function accountTypeWarning(account: { code: string; name: string; type: string }) {
  const expectedType = expectedAccountType(account.code);
  if (!expectedType) return null;
  if (account.type === expectedType) return null;
  return {
    code: account.code,
    name: account.name,
    storedType: account.type,
    expectedType,
    message: `Konto ${account.code} – ${account.name}: izbrani tip je ${labels[account.type] ?? account.type}, po SRS je pričakovan tip ${labels[expectedType]}. Neskladje lahko vpliva na razvrstitev knjižb v poročilih. Izjemo lahko izrecno potrdite.`,
  };
}
