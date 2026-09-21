import {
  COMPANY_CHART_SOURCE,
  type CompanyChartSourceAccount,
} from "./generatedCompanyChartSource";
import {
  accountTypeForCode,
  type AccountTemplate,
} from "./slovenianChartOfAccounts";

export const ACCOUNT_CLASS_NAMES = {
  "0": "Neopredmetena in opredmetena osnovna sredstva",
  "1": "Kratkoročna sredstva (brez zalog)",
  "2": "Kratkoročne obveznosti in rezervacije",
  "3": "Proizvodnja, nedokončana proizvodnja in storitve",
  "4": "Stroški po vrstah",
  "5": "Proizvajalni stroški, stroški prodaje in upravljanja",
  "6": "Zaloge materiala, proizvodov in blaga",
  "7": "Prihodki in odhodki",
  "8": "Dolgoročne obveznosti, kapital in rezerve",
  "9": "Obračun poslovnega izida in zunajbilančna evidenca",
} as const;

function parentCodeForCompanyAccount(code: string): string | undefined {
  if (code.length === 7) return code.slice(0, 3);
  return undefined;
}

/**
 * Ustvari kontni plan iz potrjenega razdelnika analitičnih kontov.
 * Generator razširi 4-mestne analitike iz vira v 7-mestne kode.
 */
export function buildCompanyChartOfAccounts(
  source: readonly CompanyChartSourceAccount[],
): AccountTemplate[] {
  const byCode = new Map<string, CompanyChartSourceAccount>();

  for (const account of source) {
    if (!/^(?:\d{3}|\d{7})$/.test(account.code)) {
      throw new Error(`Nepričakovana dolžina konta ${account.code}.`);
    }
    if (byCode.has(account.code)) {
      throw new Error(`Podvojen konto ${account.code}.`);
    }
    byCode.set(account.code, account);
  }

  const codes = new Set(byCode.keys());
  return [...byCode.values()]
    .map((account) => {
      const parentCode = parentCodeForCompanyAccount(account.code);
      if (parentCode && !codes.has(parentCode)) {
        throw new Error(`Za konto ${account.code} manjka nadrejeni konto ${parentCode}.`);
      }

      const allowsPosting = ![...codes].some(
        (candidate) =>
          candidate.length > account.code.length && candidate.startsWith(account.code),
      );

      return {
        code: account.code,
        name: account.name,
        type: accountTypeForCode(account.code),
        parentCode,
        allowsPosting,
        requiresPartner: account.requiresPartner ?? false,
        isCash: account.isCash ?? false,
        taxBehavior: account.taxBehavior ?? "none",
        isOpenItem: account.isOpenItem ?? false,
      };
    })
    .sort((left, right) => left.code.localeCompare(right.code));
}

export const COMPANY_CHART_OF_ACCOUNTS = buildCompanyChartOfAccounts(
  COMPANY_CHART_SOURCE,
);

export function getCompanyParentCodeMap(): Map<string, string> {
  return new Map(
    COMPANY_CHART_OF_ACCOUNTS.flatMap((account) =>
      account.parentCode ? [[account.code, account.parentCode] as const] : [],
    ),
  );
}