import { forwardRef, type ChangeEvent, type ComponentPropsWithoutRef } from "react";
import { Input } from "@/components/ui/input";

export interface DecimalInputProps extends Omit<ComponentPropsWithoutRef<typeof Input>, "type"> {
  /** Dovoli vnos negativnih vrednosti (za doplačila / popuste). Privzeto: false. */
  allowNegative?: boolean;
}

/**
 * Enotno decimalno vnosno polje — vejica (,) kot decimalno ločilo.
 * Nadomešča <Input type="number"> povsod kjer se vnaša decimalna vrednost.
 *
 * - Pika (.) se samodejno zamenja z vejico.
 * - Dovoljeni znaki: cifre, ena vejica, minus (če allowNegative).
 * - Na mobilnih napravah pokaže numerično tipkovnico (inputMode="decimal").
 * - Vrednosti iz stanja z decimalno piko ("12.5") prikaže z vejico ("12,5").
 */
const DecimalInput = forwardRef<HTMLInputElement, DecimalInputProps>(
  ({ onChange, allowNegative = false, value, ...props }, ref) => {
    // Prikaži vrednost z vejico (za vrednosti iz API-ja ali stanja zapisane s piko)
    const displayValue =
      typeof value === "string" ? value.replace(".", ",") : value;

    const handleChange = (e: ChangeEvent<HTMLInputElement>) => {
      let val = e.target.value;

      // 1. Piko zamenjaj z vejico
      val = val.replace(/\./g, ",");

      // 2. Ohrani samo dovoljene znake
      val = allowNegative
        ? val.replace(/[^\d,\-]/g, "")
        : val.replace(/[^\d,]/g, "");

      // 3. Minus samo na začetku (če allowNegative)
      if (allowNegative) {
        const isNeg = val.includes("-");
        val = val.replace(/-/g, "");
        if (isNeg) val = "-" + val;
      }

      // 4. Samo ena vejica
      const ci = val.indexOf(",");
      if (ci !== -1) {
        val = val.slice(0, ci + 1) + val.slice(ci + 1).replace(/,/g, "");
      }

      // Posreduj normaliziran event nadrejeni komponenti
      onChange?.({
        ...e,
        target: { ...e.target, value: val } as EventTarget & HTMLInputElement,
        currentTarget: { ...e.currentTarget, value: val } as EventTarget & HTMLInputElement,
      });
    };

    return (
      <Input
        {...props}
        ref={ref}
        type="text"
        inputMode="decimal"
        value={displayValue}
        onChange={handleChange}
      />
    );
  }
);

DecimalInput.displayName = "DecimalInput";

export { DecimalInput };

/** Pomožna funkcija: razčleni decimalni niz (vejica ali pika) v število. */
export function parseDecimal(val: string | number | null | undefined): number {
  if (typeof val === "number") return val;
  return parseFloat(String(val ?? "").replace(",", "."));
}
