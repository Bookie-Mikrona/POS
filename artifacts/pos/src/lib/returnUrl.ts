const KEY = "returnUrl";
const TTL_MS = 30 * 60 * 1000;

interface Stored {
  url: string;
  ts: number;
}

export function saveReturnUrl(url: string): void {
  const entry: Stored = { url, ts: Date.now() };
  localStorage.setItem(KEY, JSON.stringify(entry));
}

export function clearReturnUrl(): void {
  localStorage.removeItem(KEY);
}

export function getAndClearReturnUrl(): string | null {
  const raw = localStorage.getItem(KEY);
  localStorage.removeItem(KEY);
  if (!raw) return null;
  try {
    const entry = JSON.parse(raw) as Stored;
    if (Date.now() - entry.ts > TTL_MS) return null;
    return entry.url;
  } catch {
    return null;
  }
}
