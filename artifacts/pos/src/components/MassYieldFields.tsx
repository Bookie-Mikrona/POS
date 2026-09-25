import { useEffect, useState } from "react";
import { Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export interface MassYieldValues {
  brutoTezaG: string;
  netoTezaG: string;
  netoDelezOdst: string;
}

export interface MassYieldPayload {
  brutoTezaG: number | null;
  netoTezaG: number | null;
  netoDelezOdst: number | null;
}

export const EMPTY_MASS_YIELD: MassYieldValues = {
  brutoTezaG: "",
  netoTezaG: "",
  netoDelezOdst: "",
};

export function parseMassValue(value: string): number | null {
  const normalized = value.trim().replace(/\s/g, "").replace(",", ".");
  if (!normalized) return null;
  const number = Number(normalized);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

export function normalizeMassYield(value: MassYieldValues): MassYieldPayload {
  const brutoTezaG = parseMassValue(value.brutoTezaG);
  const netoTezaG = parseMassValue(value.netoTezaG);
  const enteredPercent = parseMassValue(value.netoDelezOdst);
  const netoDelezOdst = brutoTezaG != null && brutoTezaG > 0 && netoTezaG != null
    ? Math.round((netoTezaG / brutoTezaG) * 10000) / 100
    : enteredPercent;
  return { brutoTezaG, netoTezaG, netoDelezOdst };
}

export function normalizeMassYieldOverrides(
  value: MassYieldValues,
  touched: Partial<Record<keyof MassYieldValues, boolean>>,
): Partial<MassYieldPayload> {
  const result: Partial<MassYieldPayload> = {};
  const brutoTezaG = parseMassValue(value.brutoTezaG);
  const netoTezaG = parseMassValue(value.netoTezaG);
  if (touched.brutoTezaG) result.brutoTezaG = brutoTezaG;
  if (touched.netoTezaG) result.netoTezaG = netoTezaG;
  if (brutoTezaG != null && brutoTezaG > 0 && netoTezaG != null
    && (touched.brutoTezaG || touched.netoTezaG)) {
    result.netoDelezOdst = Math.round((netoTezaG / brutoTezaG) * 10000) / 100;
  } else if (touched.netoDelezOdst) {
    result.netoDelezOdst = parseMassValue(value.netoDelezOdst);
  }
  return result;
}

export function netMassPerUnitG(value: MassYieldValues): number | null {
  const neto = parseMassValue(value.netoTezaG);
  if (neto != null) return neto;
  const bruto = parseMassValue(value.brutoTezaG);
  const percent = parseMassValue(value.netoDelezOdst);
  return bruto != null && percent != null ? bruto * percent / 100 : null;
}

const displayNumber = (value: number) => value.toLocaleString("sl-SI", {
  maximumFractionDigits: 2,
});

const PIECE_UNITS = new Set(["kom", "kos", "kom.", "kos.", "pcs", "pc", "pce", "ea", "each", "piece", "pieces", "h87", "ct"]);

export function isPieceUnit(unit?: string | null): boolean {
  return unit != null && PIECE_UNITS.has(unit.trim().toLocaleLowerCase("sl-SI"));
}

export function MassYieldFields({
  value,
  onChange,
  sourceUnit,
  baseUnit,
  quantityUnit,
  quantity,
  lineValue,
  priceMode,
  taxRate,
  buyerVatRegistered,
  autoOpen,
  purchaseQuantity,
  onPurchaseQuantityChange,
  onPurchaseUnitChange,
}: {
  value: MassYieldValues;
  onChange: (next: MassYieldValues) => void;
  sourceUnit?: string | null;
  baseUnit?: string | null;
  quantityUnit?: string | null;
  /** Quantity in article/base units and full line value in euros, for receipt preview. */
  quantity?: number | null;
  lineValue?: number | null;
  priceMode?: "bruto" | "neto";
  /** VAT rate for converting an entered gross receipt value to its net purchase value. */
  taxRate?: number | null;
  /** If false, VAT is part of inventory cost and must not be deducted from a gross price. */
  buyerVatRegistered?: boolean;
  /** Expand the optional yield/source fields for receipt rows that need unit conversion. */
  autoOpen?: boolean;
  /** Optional original supplier purchase count, distinct from stock quantity. */
  purchaseQuantity?: string;
  onPurchaseQuantityChange?: (value: string) => void;
  onPurchaseUnitChange?: (value: string) => void;
}) {
  const [open, setOpen] = useState(Boolean(autoOpen || value.brutoTezaG || value.netoTezaG || value.netoDelezOdst));
  useEffect(() => {
    if (autoOpen || value.brutoTezaG || value.netoTezaG || value.netoDelezOdst) setOpen(true);
  }, [autoOpen, value.brutoTezaG, value.netoTezaG, value.netoDelezOdst]);
  const bruto = parseMassValue(value.brutoTezaG);
  const neto = parseMassValue(value.netoTezaG);
  const enteredPercent = parseMassValue(value.netoDelezOdst);
  const derivedPercent = bruto != null && bruto > 0 && neto != null
    ? (neto / bruto) * 100
    : null;
  const percent = derivedPercent ?? enteredPercent;
  const previewNetG = neto ?? (
    bruto != null && percent != null ? bruto * percent / 100 : null
  );
  const previewQuantity = purchaseQuantity?.trim()
    ? parseMassValue(purchaseQuantity)
    : quantity;
  const previewUnit = purchaseQuantity?.trim() ? sourceUnit : quantityUnit ?? baseUnit;
  const isPieceCount = isPieceUnit(previewUnit);
  const totalUsableKg = isPieceCount && previewNetG != null && previewQuantity != null && previewQuantity > 0
    ? previewNetG * previewQuantity / 1000
    : null;
  const hasValidLineValue = lineValue != null && Number.isFinite(lineValue) && lineValue >= 0;
  const inventoryValue = priceMode === "neto" && hasValidLineValue && buyerVatRegistered === true
    ? lineValue
    : priceMode === "neto" && hasValidLineValue && buyerVatRegistered === false
      && taxRate != null && Number.isFinite(taxRate) && taxRate >= 0
      ? lineValue * (1 + taxRate / 100)
    : priceMode === "bruto" && hasValidLineValue && buyerVatRegistered === false
      ? lineValue
      : priceMode === "bruto" && hasValidLineValue && buyerVatRegistered === true && taxRate != null && Number.isFinite(taxRate) && taxRate >= 0
        ? lineValue / (1 + taxRate / 100)
        : null;
  const perKg = totalUsableKg != null && totalUsableKg > 0 && inventoryValue != null
    ? inventoryValue / totalUsableKg
    : null;
  const estimatedNetMass = neto == null && bruto != null && percent != null;

  return (
    <div className="mt-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="h-8 px-2 text-xs text-muted-foreground"
        aria-expanded={open}
        onClick={() => setOpen(current => !current)}
      >
        <Scale className="mr-1.5 h-4 w-4" />
        {open ? "Skrij maso / izplen" : "Masa / odcejeni izplen"}
        {(value.brutoTezaG || value.netoTezaG || value.netoDelezOdst) && !open && (
          <span className="ml-1 text-primary">• vneseno</span>
        )}
      </Button>
      {open && (
        <div className="space-y-2 rounded-md border bg-muted/20 p-3">
          <p className="text-xs text-muted-foreground">
            Neobvezno. Masa vsebine v gramih na prodajno/nabavno enoto — ne vključite kozarca ali embalaže/pakiranja.
            {sourceUnit ? <> Izvorna enota dobavnice: <strong>{sourceUnit}</strong>.</> : null}
            {" "}To so mase, ne bruto/neto cena z DDV.
          </p>
          {(onPurchaseQuantityChange || onPurchaseUnitChange) && (
            <div className="grid gap-2 sm:grid-cols-2">
              <div className="space-y-1">
                <Label className="text-xs">Izvorna količina pri dobavitelju</Label>
                <Input
                  inputMode="decimal"
                  aria-label="Izvorna količina pri dobavitelju"
                  value={purchaseQuantity ?? ""}
                  onChange={event => onPurchaseQuantityChange?.(event.target.value)}
                  placeholder="npr. 10"
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Izvorna enota pri dobavitelju</Label>
                <Input
                  aria-label="Izvorna enota pri dobavitelju"
                  value={sourceUnit ?? ""}
                  onChange={event => onPurchaseUnitChange?.(event.target.value)}
                  placeholder="npr. KOM"
                />
              </div>
            </div>
          )}
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="space-y-1">
              <Label className="text-xs">Bruto vsebina (g)</Label>
              <Input
                inputMode="decimal"
                aria-label="Bruto masa vsebine v gramih"
                value={value.brutoTezaG}
                onChange={event => onChange({ ...value, brutoTezaG: event.target.value })}
                placeholder="npr. 500"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Neto odcejeno (g)</Label>
              <Input
                inputMode="decimal"
                aria-label="Neto odcejena masa v gramih"
                value={value.netoTezaG}
                onChange={event => onChange({ ...value, netoTezaG: event.target.value })}
                placeholder="npr. 480"
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Neto delež (%)</Label>
              <Input
                inputMode="decimal"
                aria-label="Neto delež v odstotkih"
                value={derivedPercent == null ? value.netoDelezOdst : displayNumber(derivedPercent)}
                readOnly={derivedPercent != null}
                onChange={event => onChange({ ...value, netoDelezOdst: event.target.value })}
                placeholder="ocena, če neto masa ni znana"
              />
            </div>
          </div>
          {derivedPercent != null && (
            <p className="text-xs text-muted-foreground">
              Delež izračunan iz obeh mas: {displayNumber(derivedPercent)} %.
            </p>
          )}
          {derivedPercent == null && value.netoDelezOdst && (
            <p className="text-xs text-muted-foreground">
              Ročna ocena izplena; manjkajočih mas ne ugibamo.
            </p>
          )}
          {totalUsableKg != null && (
            <div className="rounded bg-background px-3 py-2 text-xs" aria-live="polite">
              Predogled: {displayNumber(previewQuantity!)} kos × {displayNumber(previewNetG!)} g uporabne mase
              {estimatedNetMass && <span className="text-muted-foreground"> (ocena iz bruto mase in deleža)</span>}
              {" = "}<strong>{displayNumber(totalUsableKg)} kg</strong>
              {perKg != null && <> · nabavna vrednost zaloge {displayNumber(inventoryValue!)} € ÷ izplen = <strong>{displayNumber(perKg)} €/kg</strong></>}
              <span className="mt-1 block text-muted-foreground">
                {onPurchaseQuantityChange
                  ? "Izvorna količina in izplen omogočata preračun zalogovne količine/cene; celotna nabavna vrednost ostane ohranjena."
                  : "Strošek zaloge ostane nespremenjen; ta izračun je samo informativen."}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}