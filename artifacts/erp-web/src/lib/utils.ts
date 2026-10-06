import { twMerge } from 'tailwind-merge';

import { clsx, type ClassValue } from 'clsx';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Formatira ISO datum (YYYY-MM-DD ali daljši ISO niz) v slovensko obliko dd.mm.yyyy.
 * - Brez timezone zamika: razčleni niz, ne ustvari Date objekta.
 * - null/undefined/prazen niz → "—"
 * - Neveljavna oblika → "—"
 */
export function formatDatum(iso: string | null | undefined): string {
  if (!iso) return "—";
  const match = /^(\d{4})-(\d{2})-(\d{2})(?:$|T|\s)/.exec(iso);
  if (!match) return "—";
  const [, y, m, d] = match;
  return parseDatum(`${d}.${m}.${y}`) ? `${d}.${m}.${y}` : "—";
}

/** Display date → ISO date, without timezone conversion or permissive rollover. */
export function parseDatum(value: string): string | null {
  const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(value.trim());
  if (!match) return null;
  const [, day, month, year] = match;
  const y = Number(year), m = Number(month), d = Number(day);
  if (y < 1 || m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(0);
  date.setUTCFullYear(y, m - 1, d);
  if (date.getUTCFullYear() !== y || date.getUTCMonth() !== m - 1 || date.getUTCDate() !== d) return null;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

/** Actual audit timestamps, unlike document dates, use Ljubljana local time. */
export function formatCasovniZig(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Ljubljana", day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
  }).formatToParts(date).map(part => [part.type, part.value]));
  return `${parts.day}.${parts.month}.${parts.year} ${parts.hour}:${parts.minute}:${parts.second}`;
}
