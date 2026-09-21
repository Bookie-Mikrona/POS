import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Input } from "@/components/ui/input";

interface SecretInputProps {
  value: string;
  onChange: (event: React.ChangeEvent<HTMLInputElement>) => void;
  placeholder?: string;
  disabled?: boolean;
  id?: string;
  nastavljen?: boolean;
  className?: string;
  ariaLabel?: string;
  onKeyDown?: React.KeyboardEventHandler<HTMLInputElement>;
  onBlur?: React.FocusEventHandler<HTMLInputElement>;
  inputMode?: React.HTMLAttributes<HTMLInputElement>["inputMode"];
  inputRef?: React.Ref<HTMLInputElement>;
  autoFocus?: boolean;
}

/**
 * Integracijska skrivnost, ki ni uporabniško/prijavno geslo.
 *
 * Namerno uporablja type="text": Chrome pri type="password" ignorira
 * autocomplete izključitve in ponuja shranjevanje. Firefox
 * -webkit-text-security ne podpira, zato je dodan tudi standardni
 * text-security fallback za brskalnike, ki ga poznajo.
 */
export function SecretInput({
  value,
  onChange,
  placeholder,
  disabled,
  id,
  nastavljen,
  className,
  ariaLabel,
  onKeyDown,
  onBlur,
  inputMode,
  inputRef,
  autoFocus,
}: SecretInputProps) {
  const [masked, setMasked] = useState(true);
  const maskStyle = {
    WebkitTextSecurity: masked ? "disc" : "none",
    textSecurity: masked ? "disc" : "none",
  } as React.CSSProperties;

  return (
    <div className="relative">
      <Input
        ref={inputRef}
        autoFocus={autoFocus}
        id={id}
        name="credential-value"
        type="text"
        value={value}
        onChange={onChange}
        onKeyDown={onKeyDown}
        onBlur={onBlur}
        inputMode={inputMode}
        placeholder={placeholder}
        disabled={disabled}
        autoComplete="off"
        data-1p-ignore="true"
        data-lpignore="true"
        data-masked={masked ? "true" : "false"}
        style={maskStyle}
        className={`pr-10 ${className ?? ""}`}
        aria-label={ariaLabel ?? (nastavljen ? "Skrivnost (nastavljeno)" : undefined)}
      />
      <button
        type="button"
        aria-label={masked ? "Prikaži vrednost" : "Skrij vrednost"}
        title={masked ? "Prikaži vrednost" : "Skrij vrednost"}
        onClick={() => setMasked((current) => !current)}
        disabled={disabled}
        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground disabled:pointer-events-none"
        tabIndex={-1}
      >
        {masked ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}
      </button>
    </div>
  );
}