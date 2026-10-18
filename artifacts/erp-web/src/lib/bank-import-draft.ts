// One tab's recovery journal. A single setItem replaces the entire snapshot,
// including both the user's choices and the acknowledged server operations.
export interface ImportedBankPayment {
  paymentId: string;
  posting: "draft" | "pending" | "posted" | "failed";
  error?: string;
}

export function bankImportDraftKey(userId: string, companyId: string): string {
  return `bank-import-draft:v1:${encodeURIComponent(userId)}:${encodeURIComponent(companyId)}`;
}

export function readBankImportDraft<T>(key: string): T | null {
  const raw = sessionStorage.getItem(key);
  if (!raw) return null;
  const draft = JSON.parse(raw);
  // Expire only unsubmitted choices. Server acknowledgements are recovery
  // evidence and must survive longer than the review's convenience TTL.
  const hasServerProgress = !!draft.registered || Object.keys(draft.imported ?? {}).length > 0;
  if (!hasServerProgress && Number.isFinite(draft.savedAt) &&
      (Date.now() - draft.savedAt >= 30 * 60 * 1000 || draft.savedAt > Date.now())) {
    sessionStorage.removeItem(key);
    return null;
  }
  return draft as T;
}

export function writeBankImportDraft<T>(key: string, draft: T): void {
  sessionStorage.setItem(key, JSON.stringify({ ...draft, savedAt: Date.now() }));
}
