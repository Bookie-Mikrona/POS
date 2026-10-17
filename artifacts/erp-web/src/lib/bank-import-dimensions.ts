export interface ImportAccount {
  id: string;
  code: string;
  requiresPartner?: boolean;
  requiresCostCenter?: boolean;
  costCenterPolicy?: string;
  requiresProject?: boolean;
}

export type BankImportDecision =
  | { kind: "matched"; invoiceId: string; counterpartyId: string }
  | { kind: "standalone"; arApAccountId: string; counterpartyId: string }
  | { kind: "reconcile"; paymentId: string }
  | { kind: "skip" }
  | { kind: "pending" };

/**
 * Payment imports currently persist partner only, not cost centre or project.
 * Invoice dimensions are not inherited by the journal lines of a payment.
 * Already-posted payments are only linked, so they do not create new lines.
 */
export function bankImportDimensionWarnings(
  decision: BankImportDecision,
  bankAccountId: string,
  accounts: readonly ImportAccount[],
  invoices: readonly { id: string; arApAccountId?: string | null }[],
  payments: readonly {
    id: string;
    status: string;
    bankAccountId: string;
    arApAccountId: string;
    counterpartyId: string;
  }[],
  autoPost: boolean,
): string[] {
  if (decision.kind === "skip" || decision.kind === "pending") return [];
  let accountIds: string[];
  let partnerId: string | undefined;
  if (decision.kind === "reconcile") {
    const payment = payments.find(p => p.id === decision.paymentId);
    if (!payment || payment.status === "posted" || !autoPost) return [];
    accountIds = [payment.bankAccountId, payment.arApAccountId];
    partnerId = payment.counterpartyId;
  } else {
    const counterAccountId = decision.kind === "standalone"
      ? decision.arApAccountId
      : invoices.find(i => i.id === decision.invoiceId)?.arApAccountId;
    accountIds = [bankAccountId, counterAccountId ?? ""];
    partnerId = decision.counterpartyId;
  }
  return accountIds.flatMap((id, index) => {
    const account = accounts.find(a => a.id === id);
    if (!account) return [];
    const missing: string[] = [];
    // Payment posting writes partnerId only on the counter-account line.
    if (account.requiresPartner && (index === 0 || !partnerId)) missing.push("poslovni partner");
    if (account.requiresCostCenter || account.costCenterPolicy === "required") missing.push("stroškovno mesto");
    if (account.requiresProject) missing.push("projekt");
    return missing.length ? [`Konto ${account.code}: manjkajo obvezne dimenzije — ${missing.join(", ")}.`] : [];
  });
}
