import { useState, forwardRef } from "react";
import type { InputHTMLAttributes } from "react";
import { Input } from "@/components/ui/input";
import { useImaTipkovnico } from "@/hooks/useImaTipkovnico";
import SlovenskaKlavijatura from "./SlovenskaKlavijatura";

interface KlavijaturaInputProps extends Omit<InputHTMLAttributes<HTMLInputElement>, "onChange" | "value"> {
  value: string;
  onChange: (value: string) => void;
  naslov?: string;
  klavijaturaPlaceholder?: string;
}

export const KlavijaturaInput = forwardRef<HTMLInputElement, KlavijaturaInputProps>(
  function KlavijaturaInput(
    { value, onChange, naslov, klavijaturaPlaceholder, className, disabled, ...rest },
    ref
  ) {
    const imaTipkovnico = useImaTipkovnico();
    const [odprt, setOdprt] = useState(false);

    if (imaTipkovnico) {
      return (
        <Input
          ref={ref}
          value={value}
          onChange={e => onChange(e.target.value)}
          className={className}
          disabled={disabled}
          {...rest}
        />
      );
    }

    return (
      <>
        <Input
          ref={ref}
          value={value}
          readOnly
          inputMode="none"
          onPointerDown={e => {
            if (disabled) return;
            e.preventDefault();
            setOdprt(true);
          }}
          className={`cursor-pointer ${className ?? ""}`}
          disabled={disabled}
          {...rest}
        />
        {odprt && (
          <SlovenskaKlavijatura
            vrednost={value}
            onPotrdi={v => { onChange(v); setOdprt(false); }}
            onPreklic={() => setOdprt(false)}
            naslov={naslov}
            placeholder={klavijaturaPlaceholder}
          />
        )}
      </>
    );
  }
);
