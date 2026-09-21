import { Decimal } from "decimal.js";

export type PackagingMovementKind = "prejem" | "vracilo";

export function packagingMovementKindForQuantity(
  quantity: string | number,
): PackagingMovementKind {
  return new Decimal(quantity).isNegative() ? "vracilo" : "prejem";
}

export function oppositePackagingMovementKind(
  kind: PackagingMovementKind,
): PackagingMovementKind {
  return kind === "prejem" ? "vracilo" : "prejem";
}