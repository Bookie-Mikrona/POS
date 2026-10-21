import { useMemo, useState } from "react";
import { ChevronDown, Star } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";

export const ODDELKI = ["Hrana", "Pica", "Sladice", "Kava", "Pijača", "Drugo"] as const;

export interface MenuNavKategorija {
  id: number;
  ime: string;
  barva: string;
  oddelek?: string | null;
}

interface MenuNavProps {
  variant: "A" | "B" | "C";
  kategorije: MenuNavKategorija[];
  /** "all" | "pogosto" | "kosilo" | ID kategorije kot niz */
  active: string;
  onChange: (value: string) => void;
  kosiloAktivno: boolean;
}

const chip = (aktiven: boolean) =>
  `shrink-0 whitespace-nowrap rounded-full border text-xs font-medium min-h-[44px] px-3 transition-colors ${
    aktiven ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground hover:bg-muted"
  }`;

function oddelekKategorije(k: MenuNavKategorija): string {
  return (ODDELKI as readonly string[]).includes(k.oddelek ?? "") ? (k.oddelek as string) : "Drugo";
}

function SpecialniZavihki({ active, onChange, kosiloAktivno, vertical }: Pick<MenuNavProps, "active" | "onChange" | "kosiloAktivno"> & { vertical?: boolean }) {
  const cls = (a: boolean) => (vertical ? `${chip(a)} w-full justify-start text-left rounded-md` : chip(a));
  return (
    <>
      <button type="button" data-testid="menu-nav-pogosto" onClick={() => onChange("pogosto")} className={`${cls(active === "pogosto")} inline-flex items-center gap-1.5`}>
        <Star className="h-4 w-4" aria-hidden /> Pogosto
      </button>
      <button type="button" onClick={() => onChange("all")} className={cls(active === "all")}>Vse</button>
      {kosiloAktivno && (
        <button type="button" data-testid="tab-dnevno-kosilo" onClick={() => onChange("kosilo")} className={cls(active === "kosilo")}>Dnevno kosilo</button>
      )}
    </>
  );
}

function KategorijaGumb({ k, active, onChange, vertical }: { k: MenuNavKategorija; active: string; onChange: (v: string) => void; vertical?: boolean }) {
  const a = active === String(k.id);
  return (
    <button
      type="button"
      onClick={() => onChange(String(k.id))}
      style={{ borderColor: k.barva, ...(a ? { backgroundColor: k.barva, color: "#fff" } : {}) }}
      className={`shrink-0 whitespace-nowrap border-2 text-xs font-medium min-h-[44px] px-3 transition-colors ${vertical ? "w-full rounded-md text-left" : "rounded-full"}`}
    >
      {k.ime}
    </button>
  );
}

export function MenuNav({ variant, kategorije, active, onChange, kosiloAktivno }: MenuNavProps) {
  const [izbranOddelek, setIzbranOddelek] = useState<string | null>(null);
  const [sheetOdprt, setSheetOdprt] = useState(false);

  const poOddelkih = useMemo(() => {
    const map = new Map<string, MenuNavKategorija[]>();
    for (const k of kategorije) {
      const o = oddelekKategorije(k);
      map.set(o, [...(map.get(o) ?? []), k]);
    }
    return ODDELKI.filter((o) => map.has(o)).map((o) => ({ ime: o, kategorije: map.get(o)! }));
  }, [kategorije]);

  if (variant === "C") {
    return (
      <aside
        aria-label="Kategorije"
        data-testid="menu-nav-c"
        className="flex flex-col gap-1.5 overflow-y-auto border-r p-1.5 min-h-0"
      >
        <SpecialniZavihki active={active} onChange={onChange} kosiloAktivno={kosiloAktivno} vertical />
        {kategorije.map((k) => <KategorijaGumb key={k.id} k={k} active={active} onChange={onChange} vertical />)}
      </aside>
    );
  }

  if (variant === "B") {
    const aktivnaKat = kategorije.find((k) => String(k.id) === active);
    return (
      <div data-testid="menu-nav-b" className="flex flex-wrap items-center gap-1.5 pb-1">
        <button type="button" data-testid="menu-nav-pogosto" onClick={() => onChange("pogosto")} className={`${chip(active === "pogosto")} inline-flex items-center gap-1.5`}>
          <Star className="h-4 w-4" aria-hidden /> Pogosto
        </button>
        <button type="button" data-testid="menu-nav-kategorije" onClick={() => setSheetOdprt(true)} className={`${chip(!!aktivnaKat)} inline-flex items-center gap-1`}>
          {aktivnaKat ? aktivnaKat.ime : `Kategorije (${kategorije.length})`} <ChevronDown className="h-4 w-4" aria-hidden />
        </button>
        <button type="button" onClick={() => onChange("all")} className={chip(active === "all")}>Vse</button>
        {kosiloAktivno && (
          <button type="button" data-testid="tab-dnevno-kosilo" onClick={() => onChange("kosilo")} className={chip(active === "kosilo")}>Dnevno kosilo</button>
        )}
        <Sheet open={sheetOdprt} onOpenChange={setSheetOdprt}>
          <SheetContent side="bottom" className="rounded-t-2xl max-h-[80dvh] overflow-y-auto">
            <SheetHeader><SheetTitle className="text-left">Kategorije ({kategorije.length})</SheetTitle></SheetHeader>
            <div className="grid grid-cols-3 gap-2 pt-3 pb-4" data-testid="menu-nav-b-mreza">
              {kategorije.map((k) => (
                <button
                  key={k.id}
                  type="button"
                  onClick={() => { onChange(String(k.id)); setSheetOdprt(false); }}
                  style={{ backgroundColor: k.barva }}
                  className="min-h-[56px] rounded-lg px-2 py-2 text-sm font-semibold text-white text-center break-words"
                >
                  {k.ime}
                </button>
              ))}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    );
  }

  // Varianta A: oddelki + kategorije izbranega oddelka
  const aktivnaKat = kategorije.find((k) => String(k.id) === active);
  const oddelek = aktivnaKat ? oddelekKategorije(aktivnaKat) : (izbranOddelek ?? poOddelkih[0]?.ime ?? null);
  const kategorijeOddelka = poOddelkih.find((o) => o.ime === oddelek)?.kategorije ?? [];
  return (
    <div data-testid="menu-nav-a" className="space-y-1.5 pb-1">
      <div className="flex flex-wrap items-center gap-1.5">
        <SpecialniZavihki active={active} onChange={onChange} kosiloAktivno={kosiloAktivno} />
        {poOddelkih.map((o) => (
          <button
            key={o.ime}
            type="button"
            data-testid={`menu-nav-oddelek-${o.ime}`}
            onClick={() => { setIzbranOddelek(o.ime); onChange(String(o.kategorije[0]!.id)); }}
            className={chip(aktivnaKat != null && oddelek === o.ime)}
          >
            {o.ime}
          </button>
        ))}
      </div>
      {aktivnaKat && (
        <div className="flex flex-wrap items-center gap-1.5">
          {kategorijeOddelka.map((k) => <KategorijaGumb key={k.id} k={k} active={active} onChange={onChange} />)}
        </div>
      )}
    </div>
  );
}
