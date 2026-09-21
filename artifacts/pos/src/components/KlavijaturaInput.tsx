import { forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";

interface KlavijaturaInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
  naslov?: string;
  klavijaturaPlaceholder?: string;
}

export const KlavijaturaInput = forwardRef<HTMLInputElement, KlavijaturaInputProps>(
  function KlavijaturaInput(
    {
      value,
      onChange,
      naslov,
      klavijaturaPlaceholder: _klavijaturaPlaceholder,
      className,
      disabled,
      onPointerDown,
      ...rest
    },
    ref
  ) {
    return (
      <Input
        ref={ref}
        value={value}
        onChange={event => onChange(event.target.value)}
        aria-label={rest["aria-label"] ?? naslov}
        className={className}
        disabled={disabled}
        onPointerDown={onPointerDown}
        {...rest}
      />
    );
  }
);
