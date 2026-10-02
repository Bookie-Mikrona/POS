/** Display-only import metadata: never use a historical code to resolve a partner. */
export function importedPartnerCode(reference: string | null, description: string): string | null {
  if (!reference?.startsWith("BOOKIE-OLD/K2/")) return null;
  return description.match(/\[Bookie Old GLAVNA #[^,\]]+, konto [^,\]]+, partner ([^\s,\]]+)(?: [^\]]*)?\]$/)?.[1] ?? null;
}