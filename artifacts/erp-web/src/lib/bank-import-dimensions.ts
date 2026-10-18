export interface ImportAccount {
  id: string;
  code: string;
  requiresPartner?: boolean;
  requiresCostCenter?: boolean;
  costCenterPolicy?: string;
  requiresProject?: boolean;
}

export interface BankPaymentDimensions {
  bankCostCenterId?: string | null;
  bankProjectId?: string | null;
  counterCostCenterId?: string | null;
  counterProjectId?: string | null;
}

export function paymentDimensions(value: BankPaymentDimensions): BankPaymentDimensions {
  return Object.fromEntries(
    (["bankCostCenterId", "bankProjectId", "counterCostCenterId", "counterProjectId"] as const)
      .filter(key => value[key] !== undefined)
      .map(key => [key, value[key]]),
  );
}

export type BankImportDecision = (
  | { kind: "matched"; invoiceId: string; counterpartyId: string }
  | { kind: "standalone"; arApAccountId: string; counterpartyId: string }
  | { kind: "reconcile"; paymentId: string }
  | { kind: "skip" }
  | { kind: "pending" }) & BankPaymentDimensions;

/**
 * Dimensions are selected independently for the bank and counter-account.
 * Invoice dimensions are not inherited by the journal lines of a payment.
 * Already-posted payments are only linked, so they do not create new lines.
 */
export function bankImportDimensionWarnings(
  decision: BankImportDecision,
  bankAccountId: string,
  accounts: readonly ImportAccount[],
  invoices: readonly { id: string; arApAccountId?: string | null }[],
  payments: readonly ({
    id: string;
    status: string;
    bankAccountId: string;
    arApAccountId: string;
    counterpartyId: string;
  } & BankPaymentDimensions)[],
  autoPost: boolean,
): string[] {
  if (decision.kind === "skip" || decision.kind === "pending") return [];
  let accountIds: string[];
  let partnerId: string | undefined;
  let dimensions = paymentDimensions(decision);
  if (decision.kind === "reconcile") {
    const payment = payments.find(p => p.id === decision.paymentId);
    if (!payment || payment.status === "posted" || !autoPost) return [];
    accountIds = [payment.bankAccountId, payment.arApAccountId];
    partnerId = payment.counterpartyId;
    dimensions = { ...paymentDimensions(payment), ...dimensions };
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
    const costCenterId = index === 0 ? dimensions.bankCostCenterId : dimensions.counterCostCenterId;
    const projectId = index === 0 ? dimensions.bankProjectId : dimensions.counterProjectId;
    if ((account.requiresCostCenter || account.costCenterPolicy === "required") && !costCenterId) missing.push("stroškovno mesto");
    if (account.requiresProject && !projectId) missing.push("projekt");
    return [
      ...(missing.length ? [`Konto ${account.code}: manjkajo obvezne dimenzije — ${missing.join(", ")}.`] : []),
      ...(account.costCenterPolicy === "not_allowed" && costCenterId ? [`Konto ${account.code}: stroškovno mesto ni dovoljeno.`] : []),
    ];
  });
}
