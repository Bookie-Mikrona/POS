import { useRef, useState } from "react";
import { Input } from "@/components/ui/input";
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover";
import { X } from "lucide-react";

export const ESLOG_UNITS = [
  { code: "H87", label: "kos (H87)", display: "kos" },
  { code: "KGM", label: "kilogram (KGM)", display: "kg" },
  { code: "GRM", label: "gram (GRM)", display: "g" },
  { code: "LTR", label: "liter (LTR)", display: "l" },
  { code: "MLT", label: "mililiter (MLT)", display: "ml" },
  { code: "MTR", label: "meter (MTR)", display: "m" },
  { code: "MTK", label: "kvadratni meter (MTK)", display: "m²" },
  { code: "MTQ", label: "kubični meter (MTQ)", display: "m³" },
  { code: "CT", label: "karton (CT)", display: "karton" },
  { code: "BX", label: "škatla (BX)", display: "škatla" },
] as const;

export function displayEslogUnit(value: string | null | undefined): string {
  const unit = value?.trim() ?? "";
  return ESLOG_UNITS.find(item => item.code === unit.toUpperCase())?.display ?? unit;
}

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("sl");
}

export function filterEslogUnits(query: string, units: ReadonlyArray<{ code: string; label: string }> = ESLOG_UNITS) {
  const search = normalize(query.trim());
  return units.filter(unit => normalize(`${unit.label} ${unit.code}`).includes(search));
}

type Props = {
  id: string;
  value: string | null;
  onChange: (value: string | null) => void;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
};

export function EslogUnitPicker({ id, value, onChange, open: controlledOpen, onOpenChange }: Props) {
  const [localOpen, setLocalOpen] = useState(false);
  const open = controlledOpen ?? localOpen;
  const setOpen = (next: boolean) => {
    setLocalOpen(next);
    onOpenChange?.(next);
  };
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const current = value && !ESLOG_UNITS.some(unit => unit.code === value)
    ? [{ code: value, label: `Obstoječa enota (${value})` }]
    : [];
  const matches = filterEslogUnits(query, [...current, ...ESLOG_UNITS]);
  const selected = [...current, ...ESLOG_UNITS].find(unit => unit.code === value);

  const choose = (code: string) => {
    onChange(code);
    setQuery("");
    setOpen(false);
    inputRef.current?.focus();
  };

  return (
    <div className="flex items-center gap-1">
      <Popover open={open} onOpenChange={next => {
        setOpen(next);
        if (!next) setQuery("");
      }}>
        <PopoverAnchor asChild>
          <Input
            ref={inputRef}
            id={id}
            role="combobox"
            aria-autocomplete="list"
            aria-expanded={open}
            aria-controls={`${id}-options`}
            aria-activedescendant={open && matches[active] ? `${id}-option-${matches[active].code}` : undefined}
            value={open ? query : (current.length ? selected?.label ?? value ?? "" : displayEslogUnit(value))}
            placeholder={open ? "Išči po nazivu ali kodi..." : "Izberi enoto mere..."}
            autoComplete="off"
            onFocus={() => {
              setQuery("");
              setActive(0);
              setOpen(true);
            }}
            onClick={() => setOpen(true)}
            onChange={event => {
              setQuery(event.target.value);
              setActive(0);
              setOpen(true);
            }}
            onKeyDown={event => {
              if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
              } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
                setActive(previous => Math.max(0, Math.min(matches.length - 1, previous + (event.key === "ArrowDown" ? 1 : -1))));
              } else if (event.key === "Enter" && open && matches[active]) {
                event.preventDefault();
                choose(matches[active].code);
              }
            }}
          />
        </PopoverAnchor>
        <PopoverContent
          align="start"
          sideOffset={4}
          className="z-[70] w-[min(25rem,calc(100vw-2rem))] max-h-64 overflow-y-auto p-1"
          onOpenAutoFocus={event => event.preventDefault()}
          onEscapeKeyDown={event => {
            event.preventDefault();
            setOpen(false);
          }}
        >
          <div id={`${id}-options`} role="listbox" aria-label="Enote mere">
            {matches.length === 0 ? (
              <p className="px-3 py-2 text-sm text-muted-foreground">Ni ujemajočih enot.</p>
            ) : matches.map((unit, index) => (
              <button
                key={unit.code}
                id={`${id}-option-${unit.code}`}
                type="button"
                role="option"
                aria-selected={value === unit.code}
                className={`block w-full rounded px-3 py-2 text-left text-sm ${index === active ? "bg-accent text-accent-foreground" : "hover:bg-muted"}`}
                onMouseDown={event => event.preventDefault()}
                onMouseEnter={() => setActive(index)}
                onClick={() => choose(unit.code)}
              >
                {unit.label}
              </button>
            ))}
          </div>
        </PopoverContent>
      </Popover>
      {current.length > 0 && (
        <span className="text-xs text-amber-700">Obstoječa enota ni v standardnem izboru e-SLOG. Pred izvozom preverite njeno kodo.</span>
      )}
      {value && (
        <button type="button" aria-label="Odstrani enoto mere" title="Odstrani enoto mere"
          className="rounded p-2 text-muted-foreground hover:bg-muted" onClick={() => { onChange(null); setQuery(""); setOpen(false); }}>
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}