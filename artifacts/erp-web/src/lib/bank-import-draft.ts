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
  return JSON.parse(raw) as T;
}

export function writeBankImportDraft<T>(key: string, draft: T): void {
  sessionStorage.setItem(key, JSON.stringify(draft));
}
