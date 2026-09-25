export type PriceBasis = "neto" | "bruto";

export interface ImportedPriceSemantics {
  sourcePrice: number | string | null;
  sourcePriceBasis: PriceBasis | null;
  receiptPriceBasis: PriceBasis;
  discountIncluded: boolean | null;
  discount1?: number | string | null;
  discount2?: number | string | null;
  taxRate?: number | string | null;
}

export interface RestoredImportedPrice {
  price: string;
  discount: string;
  editable: boolean;
}

export interface OriginalReceiptPriceSnapshot {
  artikelId: number;
  price: string;
  discount: string;
  quantity: string;
  packageCount: string;
  sourceQuantity: string;
  taxRate: string;
  receiptPriceBasis: PriceBasis;
  sourcePrice: number | string | null;
  sourcePriceBasis: PriceBasis | null;
  discountIncluded: boolean | null;
  discount1: number | null;
  discount2: number | null;
  netAmount: number | string | null;
  vatAmount: number | string | null;
  stockAmount: number | string | null;
  stockQuantity: number | string | null;
  stockUnitPrice: number | string | null;
  sourceUnit: string | null;
  brutoTezaG: string;
  netoTezaG: string;
  netoDelezOdst: string;
}

export interface ReceiptPriceDraft {
  artikelId: number;
  cenaKos: string;
  popust: string;
  kolicina: string;
  enotVPaketu: string;
  izvKolicina?: string;
  ddvStopnja: string;
  izvCena?: number | string | null;
  izvCenaVrsta?: PriceBasis | null;
  rabatVkljucenVCeni?: boolean | null;
  originalPriceSnapshot?: OriginalReceiptPriceSnapshot;
  izvEnota?: string | null;
  brutoTezaG?: string;
  netoTezaG?: string;
  netoDelezOdst?: string;
}

export function numberFromPrice(value: number | string | null | undefined): number | null {
  if (value == null) return null;
  const normalized = String(value).trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return null;
  const parsed = Number(normalized);
  return Number.isFinite(parsed) ? parsed : null;
}

function amountString(value: number | string | null | undefined): string {
  const parsed = numberFromPrice(value);
  return parsed == null ? "" : String(parsed);
}

function displayAmount(value: number): string {
  return String(Math.round((value + Number.EPSILON) * 10000) / 10000);
}

export function sourceDiscountFactor(
  discount1: number | string | null | undefined,
  discount2: number | string | null | undefined,
  discountIncluded: boolean | null | undefined,
): number {
  if (discountIncluded === true) return 1;
  const first = numberFromPrice(discount1) ?? 0;
  const second = numberFromPrice(discount2) ?? 0;
  return (1 - first / 100) * (1 - second / 100);
}

export function restoreImportedPrice(
  source: ImportedPriceSemantics,
): RestoredImportedPrice {
  const price = numberFromPrice(source.sourcePrice);
  if (price == null || source.sourcePriceBasis == null) {
    return { price: amountString(source.sourcePrice), discount: "", editable: false };
  }

  const discount1 = numberFromPrice(source.discount1) ?? 0;
  const discount2 = numberFromPrice(source.discount2) ?? 0;
  const hasRecordedDiscount = discount1 > 0 || discount2 > 0;
  const discountKnown = source.discountIncluded != null || !hasRecordedDiscount;
  const taxRate = numberFromPrice(source.taxRate);
  let displayPrice = price;
  if (source.sourcePriceBasis !== source.receiptPriceBasis) {
    if (taxRate == null || taxRate < 0) {
      return { price: amountString(source.sourcePrice), discount: "", editable: false };
    }
    const multiplier = 1 + taxRate / 100;
    displayPrice = source.sourcePriceBasis === "neto"
      ? price * multiplier
      : multiplier === 0 ? price : price / multiplier;
  }

  const discountIncluded = source.discountIncluded === true;
  const discount = discountIncluded
    ? ""
    : [discount1, discount2].filter(value => value > 0).join("+");
  return {
    price: displayAmount(displayPrice),
    discount,
    editable: discountKnown,
  };
}

export function originalPriceIsUnchanged(
  row: ReceiptPriceDraft,
  currentBasis: PriceBasis,
): boolean {
  const original = row.originalPriceSnapshot;
  return Boolean(original
    && original.artikelId === row.artikelId
    && original.price === row.cenaKos
    && original.discount === row.popust
    && original.quantity === row.kolicina
    && original.packageCount === row.enotVPaketu
    && original.sourceQuantity === (row.izvKolicina ?? "")
    && original.taxRate === row.ddvStopnja
    && original.receiptPriceBasis === currentBasis);
}

export function buildReceiptPricePayload(
  row: ReceiptPriceDraft,
  currentBasis: PriceBasis,
  calculated: {
    netAmount: number;
    vatAmount: number;
    stockQuantity: number;
    stockUnitPrice: number;
    sourcePrice: number;
    discount1: number;
    discount2: number;
  },
) {
  const original = row.originalPriceSnapshot;
  const unchanged = originalPriceIsUnchanged(row, currentBasis) && original != null;
  const stockInputsUnchanged = unchanged
    && original.sourceUnit === (row.izvEnota ?? null)
    && original.brutoTezaG === (row.brutoTezaG ?? "")
    && original.netoTezaG === (row.netoTezaG ?? "")
    && original.netoDelezOdst === (row.netoDelezOdst ?? "");
  const originalNetAmount = unchanged ? numberFromPrice(original.netAmount) : null;
  const originalVatAmount = unchanged ? numberFromPrice(original.vatAmount) : null;
  const netAmount = originalNetAmount ?? calculated.netAmount;
  const vatAmount = originalVatAmount ?? calculated.vatAmount;
  const retainIncludedDiscount = unchanged || row.rabatVkljucenVCeni === true;

  return {
    ddvOsnova: netAmount,
    ddvZnesek: vatAmount,
    skupaj: currentBasis === "bruto" ? netAmount + vatAmount : netAmount,
    kolicina: stockInputsUnchanged && numberFromPrice(original.stockQuantity) != null
      ? numberFromPrice(original.stockQuantity)!
      : calculated.stockQuantity,
    cenaKos: stockInputsUnchanged && numberFromPrice(original.stockUnitPrice) != null
      ? numberFromPrice(original.stockUnitPrice)!
      : calculated.stockUnitPrice,
    izvCena: unchanged ? numberFromPrice(original.sourcePrice) : calculated.sourcePrice,
    izvCenaVrsta: unchanged ? original.sourcePriceBasis : currentBasis,
    rabatVkljucenVCeni: unchanged
      ? original.discountIncluded
      : row.rabatVkljucenVCeni ?? false,
    rabat1Odst: retainIncludedDiscount
      ? unchanged ? original.discount1 ?? 0 : numberFromPrice(row.originalPriceSnapshot?.discount1) ?? calculated.discount1
      : calculated.discount1,
    rabat2Odst: retainIncludedDiscount
      ? unchanged ? original.discount2 ?? 0 : numberFromPrice(row.originalPriceSnapshot?.discount2) ?? calculated.discount2
      : calculated.discount2,
    unchanged,
  };
}