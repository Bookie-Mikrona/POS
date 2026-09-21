export type DirectPostingAccount = {
  id: string;
  code: string;
  isActive: boolean;
  allowsPosting: boolean;
};

export type DirectPostingAccountValidation =
  | { valid: true }
  | {
      valid: false;
      reason: "missing" | "inactive" | "group";
      accounts: DirectPostingAccount[];
    };

/**
 * Preveri, ali so vsi izbrani konti primerni za neposredno knjiženje.
 * Konti morajo pripadati preverjenemu podjetju (seznam accounts je že omejen
 * na podjetje), biti aktivni in imeti omogočeno neposredno knjiženje.
 */
export function validateDirectPostingAccounts(
  accountIds: string[],
  accounts: DirectPostingAccount[],
): DirectPostingAccountValidation {
  const uniqueAccountIds = [...new Set(accountIds)];
  const accountsById = new Map(accounts.map(account => [account.id, account]));
  const missing = uniqueAccountIds
    .filter(id => !accountsById.has(id))
    .map(id => ({ id, code: id, isActive: false, allowsPosting: false }));

  if (missing.length > 0) {
    return { valid: false, reason: "missing", accounts: missing };
  }

  const selectedAccounts = uniqueAccountIds
    .map(id => accountsById.get(id))
    .filter((account): account is DirectPostingAccount => account !== undefined);
  const inactive = selectedAccounts.filter(account => !account.isActive);
  if (inactive.length > 0) {
    return { valid: false, reason: "inactive", accounts: inactive };
  }

  const group = selectedAccounts.filter(account => !account.allowsPosting);
  if (group.length > 0) {
    return { valid: false, reason: "group", accounts: group };
  }

  return { valid: true };
}