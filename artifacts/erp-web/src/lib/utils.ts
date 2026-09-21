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
  const s = iso.slice(0, 10); // vzemi samo YYYY-MM-DD
  const [y, m, d] = s.split("-");
  if (!y || !m || !d || y.length !== 4) return "—";
  return `${d}.${m}.${y}`;
}
