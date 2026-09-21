export type TerminalReferenceProvider = "sumup" | "viva";

export function hasCardTerminalCharge(normalizedKartica: number, napitnina: number): boolean {
  return normalizedKartica - napitnina > 0.005;
}

/** Shared reservation orchestration: a provider/reference pair may be reserved once only. */
export async function reserveTerminalReference(
  persist: (provider: TerminalReferenceProvider, reference: string) => Promise<{ id: string } | null>,
  sumupCheckoutId: string,
  vivaTerminalSessionId: string,
): Promise<{ id: string } | null> {
  if (!sumupCheckoutId && !vivaTerminalSessionId) return null;
  return persist(sumupCheckoutId ? "sumup" : "viva", sumupCheckoutId || vivaTerminalSessionId);
}