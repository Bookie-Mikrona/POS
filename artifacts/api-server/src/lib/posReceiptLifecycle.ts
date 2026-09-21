export type PosReceiptStatus = "draft" | "confirmed";

export class PosReceiptNotReady extends Error {}

export function assertPosReceiptCanBeConfirmed(
  status: PosReceiptStatus,
  lines: Array<{ articleId: number | null; lineType?: string | null }>,
): void {
  if (status === "confirmed") return;
  if (!lines.length) {
    throw new PosReceiptNotReady("Prejemnica nima postavk.");
  }
  if (lines.some(({ articleId, lineType }) =>
    articleId == null && lineType !== "poraba_surovin" && lineType !== "prevoz")) {
    throw new PosReceiptNotReady(
      "Pred potrditvijo je treba upariti vse postavke prejemnice.",
    );
  }
}