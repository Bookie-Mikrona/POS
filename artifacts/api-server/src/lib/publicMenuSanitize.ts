/** Prag, pri katerem gostu pokažemo oznako »Še malo« (število preostalih porcij ali manj). */
export const PUBLIC_LOW_STOCK_THRESHOLD = 3;

export type PublicStockStatus = "na_voljo" | "se_malo" | "ni_na_voljo";

/** Količino zaloge pretvori v status, primeren za goste; točna številka nikoli ne zapusti strežnika. */
export function publicStockStatus(
  quantity: number | null | undefined,
  threshold = PUBLIC_LOW_STOCK_THRESHOLD,
): PublicStockStatus {
  if (quantity == null) return "na_voljo";
  if (quantity <= 0) return "ni_na_voljo";
  if (quantity <= threshold) return "se_malo";
  return "na_voljo";
}

/**
 * Javni opis artikla: opis, ki se začne z oznako v oglatih oklepajih
 * (npr. »[Normativ uporabnika — …]«, »[Razvojni osnutek sladice]«), je interna
 * opomba in se ne vrne. Sicer se odstranijo vsa sistemska besedila v oglatih
 * oklepajih.
 */
export function sanitizePublicDescription(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed.startsWith("[")) return null;
  const cleaned = trimmed
    .replace(/\[[^\]]*\]/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ *\n */g, "\n")
    .trim();
  return cleaned || null;
}
