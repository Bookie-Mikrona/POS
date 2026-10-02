export type OpenItemLike = {
  id?: string;
  invoiceId?: string | null;
  journalLineId?: string | null;
  sourceKind?: "invoice" | "ledger" | string;
  sourceId?: string | null;
  entryId?: string | null;
  side?: "debit" | "credit" | null;
  paymentDirection?: "inbound" | "outbound" | null;
  invoiceType?: "issued" | "received" | string;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  dueDate?: string | null;
  counterpartyId?: string;
  arApAccountId?: string;
  accountCode?: string | null;
  activePaymentBatchId?: string | null;
  remainingAmount: string;
  counterpartyName?: string;
  reference?: string | null;
  description?: string | null;
};

export function getOpenItemKey(item: OpenItemLike): string {
  return item.id ?? item.invoiceId ?? item.journalLineId ?? "";
}

export function isLedgerOpenItem(item: OpenItemLike): boolean {
  return item.sourceKind === "ledger" || (!item.invoiceId && !!item.journalLineId);
}

export function openItemSourceLabel(item: OpenItemLike): string {
  return isLedgerOpenItem(item) ? "Postavka GK" : "Račun";
}

export function openItemDocumentLabel(item: OpenItemLike): string {
  return isLedgerOpenItem(item) ? "Dokument" : "Račun";
}

export function openItemDocumentValue(item: OpenItemLike): string {
  if (!isLedgerOpenItem(item)) return item.invoiceNumber || "—";
  return item.reference || item.description || item.invoiceNumber || "Postavka GK";
}

export function isSupplierPaymentDirectionEligible(item: OpenItemLike): boolean {
  if (isLedgerOpenItem(item)) return item.paymentDirection === "outbound";
  // Older invoice payloads do not include paymentDirection; retain the existing received-invoice behavior.
  return item.invoiceType === "received";
}

export function canPrepareSupplierPayment(item: OpenItemLike): boolean {
  return !item.activePaymentBatchId && isSupplierPaymentDirectionEligible(item);
}

export function openItemDocumentHref(item: OpenItemLike): string | null {
  if (item.entryId) return `/temeljnice?id=${encodeURIComponent(item.entryId)}`;
  if (item.counterpartyId && item.arApAccountId) {
    return `/kartica-partnerja?partnerId=${encodeURIComponent(item.counterpartyId)}&accountId=${encodeURIComponent(item.arApAccountId)}`;
  }
  return null;
}

export function allocationIdentity(item: OpenItemLike): { invoiceId?: string; journalLineId?: string } | null {
  if (isLedgerOpenItem(item)) {
    return item.journalLineId ? { journalLineId: item.journalLineId } : null;
  }
  return item.invoiceId ? { invoiceId: item.invoiceId } : null;
}

export type MixedAllocation = {
  id: string;
  invoiceId?: string;
  journalLineId?: string;
  allocatedAmount: string;
};

export function buildPaymentAllocationPayload(allocations: MixedAllocation[]) {
  const valid = allocations.filter(a => Number(a.allocatedAmount) > 0);
  return {
    allocations: valid.filter(a => a.invoiceId).map(a => ({
      invoiceId: a.invoiceId!,
      allocatedAmount: Number(a.allocatedAmount),
    })),
    ledgerAllocations: valid.filter(a => a.journalLineId).map(a => ({
      journalLineId: a.journalLineId!,
      allocatedAmount: Number(a.allocatedAmount),
    })),
  };
}

export function groupPaymentBatchAllocations(
  allocations: MixedAllocation[],
  items: OpenItemLike[],
) {
  const groups = new Map<string, {
    counterpartyId: string;
    arApAccountId: string;
    allocations: { invoiceId?: string; journalLineId?: string; amount: number }[];
  }>();
  for (const allocation of allocations) {
    if (Number(allocation.allocatedAmount) <= 0) continue;
    const item = items.find(candidate => {
      const identity = allocationIdentity(candidate);
      return identity?.invoiceId === allocation.invoiceId &&
        identity?.journalLineId === allocation.journalLineId;
    });
    if (!item || !canPrepareSupplierPayment(item) || !item.counterpartyId || !item.arApAccountId) continue;
    const key = `${item.counterpartyId}:${item.arApAccountId}`;
    const group = groups.get(key) ?? {
      counterpartyId: item.counterpartyId,
      arApAccountId: item.arApAccountId,
      allocations: [],
    };
    group.allocations.push({
      ...(allocation.invoiceId ? { invoiceId: allocation.invoiceId } : {}),
      ...(allocation.journalLineId ? { journalLineId: allocation.journalLineId } : {}),
      amount: Number(allocation.allocatedAmount),
    });
    groups.set(key, group);
  }
  return [...groups.values()].filter(group => group.allocations.length > 0);
}

export function isPastCutoff(item: OpenItemLike, cutoffDate: string): boolean {
  const dueDate = item.dueDate ?? (isLedgerOpenItem(item) ? null : item.invoiceDate);
  if (!cutoffDate || !dueDate) return false;
  return dueDate > cutoffDate;
}

export function canBulkSelectForCutoff(item: OpenItemLike, cutoffDate: string): boolean {
  if (isLedgerOpenItem(item) && !item.dueDate) return false;
  return !isPastCutoff(item, cutoffDate);
}