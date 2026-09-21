/**
 * Privzeti kontni plan iz Uradnega lista RS št. 81/2024, Priloga 1.
 *
 * Vir vsebuje 2-, 3-, 4- in 6-mestne konte. Pravila za plan v Bookie:
 * - vsak uradni 6-mestni konto se vodi kot 7-mestni (z dodano končno 0);
 * - trimestni konto dobi manjkajoči štirimestni podkonto `xxx0` ter
 *   sedemmestni podkonto `xxx0000`;
 * - štirimestni konto dobi sedemmestni podkonto `xxxx000`, če pod njim
 *   še ni uradnega (iz 6-mestnega pretvorjenega) analitičnega konta.
 */

import {
  OFFICIAL_SRS_2024_SOURCE,
  type OfficialSrs2024SourceAccount,
} from "./generatedSrs2024ChartSource";

export type AccountType = "asset" | "liability" | "equity" | "revenue" | "expense";

export interface AccountTemplate {
  code: string;
  name: string;
  type: AccountType;
  parentCode?: string;
  allowsPosting: boolean;
  requiresPartner?: boolean;
  isCash?: boolean;
  taxBehavior?: "input" | "output" | "none";
  isOpenItem?: boolean;
}

export function accountTypeForCode(code: string): AccountType {
  switch (code[0]) {
    case "0":
    case "1":
    case "3":
      return "asset";
    case "2":
      return "liability";
    case "4":
      return "expense";
    case "5":
      return "liability";
    case "6":
      return "expense";
    case "7":
      return "revenue";
    case "8":
      return "equity";
    case "9":
      if (code.startsWith("990")) return "asset";
      if (code.startsWith("999")) return "liability";
      if (/^9[678]/.test(code)) return "liability";
      return "equity";
    default:
      throw new Error(`Konto ${code} nima določenega tipa.`);
  }
}

function parentCodeFor(code: string): string | undefined {
  if (code.length === 3) return code.slice(0, 2);
  if (code.length === 4) return code.slice(0, 3);
  if (code.length === 7) return code.slice(0, 4);
  return undefined;
}

/**
 * Iz uradnega plana ustvari kombinirani Bookie plan po dogovorjeni logiki.
 * Izvoženo za regresijske teste ter morebitno osvežitev uradnega vira.
 */
export function buildSlovenianChartOfAccounts(
  source: readonly OfficialSrs2024SourceAccount[],
): AccountTemplate[] {
  const sourceByCode = new Map<string, OfficialSrs2024SourceAccount>();
  for (const account of source) {
    if (!/^\d{2}$|^\d{3}$|^\d{4}$|^\d{6}$/.test(account.code)) {
      throw new Error(`Nepričakovana dolžina uradnega konta ${account.code}.`);
    }
    if (sourceByCode.has(account.code)) {
      throw new Error(`Podvojen uradni konto ${account.code}.`);
    }
    sourceByCode.set(account.code, account);
  }

  const plan = new Map<string, Omit<AccountTemplate, "parentCode" | "allowsPosting">>();
  const add = (code: string, name: string): void => {
    if (!plan.has(code)) {
      plan.set(code, { code, name, type: accountTypeForCode(code) });
    }
  };

  // 1. Uradne šestmestne analitike postanejo sedemmestne.
  for (const account of source) {
    add(account.code.length === 6 ? `${account.code}0` : account.code, account.name);
  }

  // 2. Za vsak 3-mestni sintetični konto dodaj manjkajoči 4-mestni in 7-mestni nivo.
  for (const account of source) {
    if (account.code.length !== 3) continue;
    if (!sourceByCode.has(`${account.code}0`)) {
      add(`${account.code}0`, account.name);
    }
    add(`${account.code}0000`, account.name);
  }

  // 3. Za vsak 4-mestni konto zagotovi analitiko, če je že nima.
  for (const account of [...plan.values()]) {
    if (account.code.length !== 4) continue;
    const hasAnalytic = [...plan.keys()].some(
      (candidate) => candidate.length === 7 && candidate.startsWith(account.code),
    );
    if (!hasAnalytic) {
      add(`${account.code}000`, account.name);
    }
  }

  const codes = new Set(plan.keys());
  const templates = [...plan.values()]
    .map((account) => {
      const parentCode = parentCodeFor(account.code);
      if (parentCode && !codes.has(parentCode)) {
        throw new Error(`Za konto ${account.code} manjka nadrejeni konto ${parentCode}.`);
      }

      const allowsPosting = ![...codes].some(
        (candidate) => candidate.length > account.code.length && candidate.startsWith(account.code),
      );

      return {
        ...account,
        parentCode,
        allowsPosting,
      };
    })
    .sort((a, b) => a.code.localeCompare(b.code));

  return templates;
}

/**
 * Shranjen uradni kontni plan za proračunske uporabnike.
 * Ni privzeti plan za zasebna podjetja oziroma d.o.o.
 */
export const BUDGET_CHART_OF_ACCOUNTS = buildSlovenianChartOfAccounts(
  OFFICIAL_SRS_2024_SOURCE,
);

/** Vrne preslikavo konto → nadrejeni konto za drugi korak seeda. */
export function getBudgetParentCodeMap(): Map<string, string> {
  return new Map(
    BUDGET_CHART_OF_ACCOUNTS.flatMap((account) =>
      account.parentCode ? [[account.code, account.parentCode] as const] : [],
    ),
  );
}