import { useCallback, useEffect, useState, type SetStateAction } from "react";

export type BankImportResult = {
  userId: string;
  companyId: string;
  created: number;
  skipped: number;
  posted: number;
  postErrors: { message: string; paymentId?: string }[];
};

type Durability = "local" | "session" | "none";

export const bankImportStorageMessages: Record<Durability, string> = {
  local: "Napake so shranjene v tem brskalniku in jih je mogoče obnoviti po osvežitvi ali ponovnem odprtju strani.",
  session: "Trajno shranjevanje ni uspelo. Napake je mogoče obnoviti po osvežitvi istega zavihka, ne pa v drugem zavihku ali po zaprtju tega zavihka.",
  none: "Napak ni bilo mogoče shraniti v brskalnik. Po osvežitvi ali zaprtju strani tega opozorila ne bo mogoče obnoviti. Pred odhodom preverite navedene transakcije in si zabeležite napake.",
};

function validResult(value: unknown, userId: string, companyId: string): value is BankImportResult {
  if (!value || typeof value !== "object") return false;
  const result = value as BankImportResult;
  return result.userId === userId && result.companyId === companyId
    && [result.created, result.skipped, result.posted].every(n => Number.isSafeInteger(n) && n >= 0)
    && Array.isArray(result.postErrors) && result.postErrors.every(error =>
      error && typeof error.message === "string"
      && (error.paymentId === undefined || typeof error.paymentId === "string"));
}

function restore(key: string, userId: string, companyId: string): BankImportResult | null {
  // A fallback may be newer than a local copy whose replacement was refused.
  for (const name of ["sessionStorage", "localStorage"] as const) {
    try {
      const raw = window[name].getItem(key);
      if (raw === null) continue;
      const value: unknown = JSON.parse(raw);
      // null is a tombstone: do not resurrect an older local warning.
      if (value === null) return null;
      if (validResult(value, userId, companyId)) return value;
    } catch {
      // Both accessing the storage property and reading it can be refused.
    }
  }
  return null;
}

function persist(key: string, value: BankImportResult | null): Durability {
  const json = JSON.stringify(value?.postErrors.length ? value : null);
  try {
    window.localStorage.setItem(key, json);
    try {
      window.sessionStorage.removeItem(key);
    } catch {
      // If removal alone is blocked, try replacing an outdated fallback.
      try { window.sessionStorage.setItem(key, json); } catch { /* Local copy is durable. */ }
    }
    return "local";
  } catch {
    try {
      window.sessionStorage.setItem(key, json);
      return "session";
    } catch {
      return "none";
    }
  }
}

/** Persist only within the authenticated user/company scope, never a shared key. */
export function useBankImportResult(userId: string | undefined, companyId: string | undefined) {
  const key = userId && companyId
    ? `bank-import-result:${JSON.stringify([userId, companyId])}` : null;
  const [snapshot, setSnapshot] = useState<{
    key: string | null;
    value: BankImportResult | null;
    durability: Durability;
  }>({ key: null, value: null, durability: "none" });

  useEffect(() => {
    setSnapshot({
      key,
      value: key && userId && companyId ? restore(key, userId, companyId) : null,
      durability: "none",
    });
  }, [key, userId, companyId]);

  useEffect(() => {
    if (!key || snapshot.key !== key) return;
    const durability = persist(key, snapshot.value);
    setSnapshot(current => current.key === key && current.value === snapshot.value
      && current.durability !== durability ? { ...current, durability } : current);
  }, [key, snapshot.key, snapshot.value]);

  const setResult = useCallback((update: SetStateAction<BankImportResult | null>) => {
    setSnapshot(current => {
      if (!key || current.key !== key) return current;
      const value = typeof update === "function" ? update(current.value) : update;
      if (value && (value.userId !== userId || value.companyId !== companyId)) return current;
      return { ...current, value };
    });
  }, [key, userId, companyId]);

  return {
    result: key && snapshot.key === key ? snapshot.value : null,
    setResult,
    storageMessage: bankImportStorageMessages[snapshot.durability],
  };
}
