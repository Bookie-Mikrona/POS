export type PreparationBatch = { batchCount: number; piecesPerBatch: number };

export function productionTotals(
  batches: PreparationBatch[] | null | undefined,
  referencePieces: number | null | undefined,
  legacyQuantity: number,
) {
  if (batches == null) return { pieces: legacyQuantity, recipeQuantity: legacyQuantity };
  if (!Number.isSafeInteger(referencePieces) || referencePieces! < 1 || referencePieces! > 10000
    || batches.length > 100) throw new Error("Normativ nima veljavnega števila kosov iz priprave.");
  let pieces = 0;
  let recipeQuantity = 0;
  for (const b of batches) {
    if (!Number.isSafeInteger(b.batchCount) || b.batchCount < 1 || b.batchCount > 10000
      || !Number.isSafeInteger(b.piecesPerBatch) || b.piecesPerBatch < 1 || b.piecesPerBatch > 10000) {
      throw new Error("Število priprav in kosov mora biti pozitivno celo število do 10.000.");
    }
    pieces += b.batchCount * b.piecesPerBatch;
    recipeQuantity += b.batchCount * referencePieces!;
  }
  if (pieces > 999999.9999 || recipeQuantity > 999999.9999) throw new Error("Pripravljena količina je prevelika.");
  return { pieces, recipeQuantity };
}