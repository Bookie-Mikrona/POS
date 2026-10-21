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
  /** Število artiklov z 5 ali manj porcijami (ali brez); čip je viden samo, ko je > 0. */
  naIztekuSt?: number;
}

const chip = (aktiven: boolean) =>
  `shrink-0 whitespace-nowrap rounded-full border text-xs font-medium min-h-[44px] px-3 transition-colors ${
    aktiven ? "bg-primary text-primary-foreground border-primary" : "bg-background text-foreground hover:bg-muted"
  }`;

/** Majhen zavihek brez obrobe (višina 36 px, besedilo 13 px) za varianti A in B. */
const zavihek = (aktiven: boolean) =>
  `shrink-0 whitespace-nowrap rounded-md h-9 px-3 text-[13px] font-medium transition-colors ${
    aktiven ? "bg-primary text-primary-foreground" : "text-foreground hover:bg-muted"
  }`;

function oddelekKategorije(k: MenuNavKategorija): string {
  return k.oddelek?.trim() || "Drugo";
}

function SpecialniZavihki({ active, onChange, kosiloAktivno, naIztekuSt = 0, vertical }: Pick<MenuNavProps, "active" | "onChange" | "kosiloAktivno" | "naIztekuSt"> & { vertical?: boolean }) {
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
      {naIztekuSt > 0 && (
        <button type="button" data-testid="menu-nav-na-izteku" onClick={() => onChange("na_izteku")} className={cls(active === "na_izteku")}>Na izteku ({naIztekuSt})</button>
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

export function MenuNav({ variant, kategorije, active, onChange, kosiloAktivno, naIztekuSt = 0 }: MenuNavProps) {
  const [izbranOddelek, setIzbranOddelek] = useState<string | null>(null);
  const [sheetOdprt, setSheetOdprt] = useState(false);

  const poOddelkih = useMemo(() => {
    const map = new Map<string, MenuNavKategorija[]>();
    for (const k of kategorije) {
      const o = oddelekKategorije(k);
      map.set(o, [...(map.get(o) ?? []), k]);
    }
    // Oddelki iz seznama, nato morebitni drugi oddelki v vrstnem redu pojavitve; prazni oddelki se ne prikažejo.
    const imena = [...ODDELKI.filter((o) => map.has(o)), ...[...map.keys()].filter((o) => !(ODDELKI as readonly string[]).includes(o))];
    return imena.map((o) => ({ ime: o, kategorije: map.get(o)! }));
  }, [kategorije]);

  if (variant === "C") {
    return (
      <aside
        aria-label="Kategorije"
        data-testid="menu-nav-c"
        className="flex flex-col gap-1.5 overflow-y-auto border-r p-1.5 min-h-0"
      >
        <SpecialniZavihki active={active} onChange={onChange} kosiloAktivno={kosiloAktivno} naIztekuSt={naIztekuSt} vertical />
        {kategorije.map((k) => <KategorijaGumb key={k.id} k={k} active={active} onChange={onChange} vertical />)}
      </aside>
    );
  }

  const pogostoGumb = (
    <button type="button" data-testid="menu-nav-pogosto" aria-label="Pogosto" onClick={() => onChange("pogosto")} className={`${zavihek(active === "pogosto")} inline-flex items-center gap-1`}>
      <Star className="h-4 w-4" aria-hidden /> Pogosto
    </button>
  );
  const kosiloGumb = kosiloAktivno ? (
    <button type="button" data-testid="tab-dnevno-kosilo" onClick={() => onChange("kosilo")} className={zavihek(active === "kosilo")}>Dnevno kosilo</button>
  ) : null;

  if (variant === "B") {
    const aktivnaKat = kategorije.find((k) => String(k.id) === active);
    return (
      <div data-testid="menu-nav-b" className="flex h-9 flex-nowrap items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {pogostoGumb}
        <button type="button" data-testid="menu-nav-kategorije" onClick={() => setSheetOdprt(true)} className={`${zavihek(!!aktivnaKat)} inline-flex items-center gap-1`}>
          {aktivnaKat ? aktivnaKat.ime : `Kategorije (${kategorije.length})`} <ChevronDown className="h-4 w-4" aria-hidden />
        </button>
        {kosiloGumb}
        {naIztekuSt > 0 && (
          <button
            type="button"
            data-testid="menu-nav-na-izteku"
            onClick={() => onChange("na_izteku")}
            className={`ml-auto shrink-0 whitespace-nowrap rounded-full px-2.5 h-7 text-xs font-semibold ${active === "na_izteku" ? "bg-amber-500 text-white" : "bg-amber-100 text-amber-900"}`}
          >
            Na izteku ({naIztekuSt})
          </button>
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

  // Varianta A: ena vrstica zavihkov (Pogosto + oddelki); vrstica kategorij samo, ko je izbran oddelek.
  const aktivnaKat = kategorije.find((k) => String(k.id) === active);
  const oddelek = aktivnaKat ? oddelekKategorije(aktivnaKat) : izbranOddelek;
  const kategorijeOddelka = aktivnaKat ? (poOddelkih.find((o) => o.ime === oddelek)?.kategorije ?? []) : [];
  return (
    <div data-testid="menu-nav-a">
      <div data-testid="menu-nav-oddelki" className="flex h-9 flex-nowrap items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {pogostoGumb}
        {kosiloGumb}
        {poOddelkih.map((o) => (
          <button
            key={o.ime}
            type="button"
            data-testid={`menu-nav-oddelek-${o.ime}`}
            onClick={() => { setIzbranOddelek(o.ime); onChange(String(o.kategorije[0]!.id)); }}
            className={zavihek(aktivnaKat != null && oddelek === o.ime)}
          >
            {o.ime}
          </button>
        ))}
      </div>
      {aktivnaKat && (
        <div data-testid="menu-nav-kategorije-oddelka" className="flex h-9 flex-nowrap items-center gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {kategorijeOddelka.map((k) => {
            const a = active === String(k.id);
            return (
              <button
                key={k.id}
                type="button"
                onClick={() => onChange(String(k.id))}
                style={a ? { backgroundColor: k.barva, color: "#fff" } : undefined}
                className={`shrink-0 whitespace-nowrap rounded-md h-8 px-2.5 text-xs font-medium inline-flex items-center gap-1.5 ${a ? "" : "text-foreground hover:bg-muted"}`}
              >
                {!a && <span className="h-2 w-2 rounded-full" style={{ backgroundColor: k.barva }} aria-hidden />}
                {k.ime}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
