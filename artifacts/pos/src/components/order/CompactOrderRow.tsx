import { Mic, MicOff, Minus, Percent, Pencil, Plus, Settings2, ShoppingBag, Trash2, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatEur } from "@/lib/formatEur";

export interface CompactRowDodatek {
  id: number;
  ime: string;
  kolicina: number;
  skupaj: number;
  jeEmbalaza?: boolean;
}

export interface CompactRowKdsOznaka {
  id: number;
  label: string;
  stationName: string;
  badgeClassName: string;
  minutes: number | null;
}

export interface CompactRowAkcije {
  kolicina: (novaKolicina: number) => void;
  dodatekPlus: (id: number, kolicina: number) => void;
  dodatekMinus: (id: number, kolicina: number) => void;
  gost: () => void;
  toGo: () => void;
  popust: () => void;
  mikrofon: () => void;
  zapis: () => void;
  zbrisiZapis: () => void;
  opcije: () => void;
  brisi: () => void;
  odpriRacun: () => void;
}

export interface CompactOrderRowProps {
  postavka: {
    id: number;
    ime: string;
    kolicina: number;
    opomba?: string | null;
    toGo?: boolean;
    racunStevilka?: string | null;
  };
  izbrana: boolean;
  onIzberi: () => void;
  jeRacunana: boolean;
  jeVecHodniMeni: boolean;
  jeVObdelavi: boolean;
  jeZacasna: boolean;
  skupaj: number;
  imaPopust: boolean;
  /** Imena izbranih opcij (modifikatorjev). */
  opcije: string[];
  dodatki: CompactRowDodatek[];
  kdsOznake: CompactRowKdsOznaka[];
  zaloga: { stanje: "ni" | "na_izteku"; porcij: number | null } | null;
  gost: number | null;
  gostBarva: string;
  steviloGostov: number;
  imaToGo: boolean;
  toGoAktiven: boolean;
  imaOpcije: boolean;
  mikrofon: "poslusam" | "napaka" | null;
  popustOdprt: boolean;
  akcije: CompactRowAkcije;
}

const gumbAkcije =
  "flex min-h-[40px] min-w-[56px] flex-1 flex-col items-center justify-center gap-0.5 rounded-md border bg-background px-1.5 text-[10px] font-medium disabled:opacity-50";

/**
 * Strnjena vrstica naročila (nastavitev »Prikaz naročila: novo«).
 * Samo prikaz: vsa dejanja kličejo iste funkcije kot stari prikaz; dejanja za vrstico so
 * v vrstici dejanj izbrane vrstice, ne v vsaki vrstici.
 */
export function CompactOrderRow(p: CompactOrderRowProps) {
  const { postavka, akcije } = p;
  const urejanje = !p.jeRacunana && !p.jeVecHodniMeni;
  const imeZToGo = `${postavka.ime}${postavka.toGo && !/\sTo-Go$/i.test(postavka.ime) ? " To-Go" : ""}`;
  const povzetek = [
    ...p.opcije,
    ...(p.izbrana ? [] : p.dodatki.map((d) => `+ ${d.ime}${d.kolicina > 1 ? ` ×${d.kolicina}` : ""}`)),
  ];
  const imaDrugoVrstico =
    povzetek.length > 0 || !!postavka.opomba || p.zaloga != null || p.kdsOznake.length > 0 || p.gost != null || p.jeRacunana;

  return (
    <div
      data-testid={`compact-row-${postavka.id}`}
      aria-busy={p.jeZacasna || undefined}
      className={`rounded-md border px-1.5 py-1 transition-colors ${
        p.izbrana ? "border-primary bg-primary/5" : "border-transparent"
      } ${p.jeRacunana ? "opacity-50" : ""}`}
    >
      <div className="flex items-start gap-1">
        {urejanje && (
          <div className="flex shrink-0 items-center gap-0.5 pt-0.5" data-testid={`order-item-quantity-${postavka.id}`}>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              aria-label="Zmanjšaj količino"
              data-testid={`row-minus-${postavka.id}`}
              disabled={p.jeVObdelavi}
              onClick={() => akcije.kolicina(postavka.kolicina - 1)}
            >
              <Minus className="h-3.5 w-3.5" />
            </Button>
            <span className={`w-6 text-center text-sm font-bold tabular-nums ${postavka.kolicina < 0 ? "text-destructive" : ""}`}>
              {postavka.kolicina}
            </span>
            <Button
              variant="outline"
              size="icon"
              className="h-7 w-7"
              aria-label="Povečaj količino"
              data-testid={`row-plus-${postavka.id}`}
              disabled={p.jeVObdelavi}
              onClick={() => akcije.kolicina(postavka.kolicina + 1)}
            >
              <Plus className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
        {!urejanje && (
          <span className="w-6 shrink-0 pt-1 text-center text-sm font-bold tabular-nums">{postavka.kolicina}</span>
        )}
        <button
          type="button"
          data-testid={`row-izberi-${postavka.id}`}
          aria-pressed={p.izbrana}
          onClick={p.onIzberi}
          className="flex min-h-[36px] min-w-0 flex-1 items-start gap-2 text-left"
        >
          <span
            className={`line-clamp-2 min-w-0 flex-1 text-sm font-medium leading-snug ${p.jeRacunana ? "line-through text-muted-foreground" : ""}`}
          >
            {imeZToGo}
          </span>
          <span className={`shrink-0 text-sm font-extrabold tabular-nums ${postavka.kolicina < 0 ? "text-destructive" : ""}`}>
            {formatEur(p.skupaj)}
          </span>
        </button>
      </div>

      {imaDrugoVrstico && (
        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-0.5 pl-1 text-[11px] leading-tight text-muted-foreground" data-testid={`row-podrobnosti-${postavka.id}`}>
          {p.gost != null && (
            <span className={`rounded-full border px-1.5 py-px text-[10px] font-bold ${p.gostBarva}`}>G{p.gost}</span>
          )}
          {povzetek.length > 0 && <span className="min-w-0 truncate">{povzetek.join(" · ")}</span>}
          {postavka.opomba && <span className="min-w-0 truncate italic">»{postavka.opomba}«</span>}
          {p.jeZacasna && <span className="animate-pulse">Shranjujem…</span>}
          {p.jeRacunana && (
            <button type="button" className="underline" onClick={akcije.odpriRacun}>
              zaračunano{postavka.racunStevilka ? ` ${postavka.racunStevilka}` : ""}
            </button>
          )}
          {p.kdsOznake.map((k) => (
            <span key={k.id} className={`rounded px-1 py-px text-[10px] font-semibold ${k.badgeClassName}`}>
              {k.stationName && `${k.stationName}: `}{k.label}{k.minutes != null && ` · ${k.minutes} min`}
            </span>
          ))}
          {p.zaloga && (
            <span
              data-testid={`row-zaloga-${postavka.id}`}
              className={`rounded-full px-1.5 py-px text-[10px] font-bold ${p.zaloga.stanje === "ni" ? "bg-black/60 text-white" : "bg-amber-300 text-black"}`}
            >
              {p.zaloga.stanje === "ni" ? "Ni" : `${p.zaloga.porcij} porcij`}
            </span>
          )}
        </div>
      )}

      {p.izbrana && (
        <div className="mt-1 space-y-1" data-testid={`row-actions-${postavka.id}`}>
          {p.dodatki.map((d) => (
            <div key={d.id} className="flex items-center gap-1 pl-2 text-xs">
              <span className="font-semibold text-amber-500">+</span>
              <span className="min-w-0 flex-1 truncate">{d.ime}</span>
              {!p.jeRacunana && (
                <Button variant="outline" size="icon" className="h-6 w-6" aria-label={`Manj: ${d.ime}`} disabled={p.jeVObdelavi} onClick={() => akcije.dodatekMinus(d.id, d.kolicina)}>
                  <Minus className="h-3 w-3" />
                </Button>
              )}
              <span className="w-5 text-center font-bold tabular-nums">{d.kolicina}</span>
              {!p.jeRacunana && (
                <Button variant="outline" size="icon" className="h-6 w-6" aria-label={`Več: ${d.ime}`} disabled={p.jeVObdelavi} onClick={() => akcije.dodatekPlus(d.id, d.kolicina)}>
                  <Plus className="h-3 w-3" />
                </Button>
              )}
              {!d.jeEmbalaza && <span className="tabular-nums text-muted-foreground">{formatEur(d.skupaj)}</span>}
            </div>
          ))}
          {!p.jeRacunana && (
            <div className="flex flex-wrap gap-1">
              {!p.jeVecHodniMeni && p.steviloGostov > 0 && (
                <button type="button" data-testid="row-akcija-gost" className={gumbAkcije} disabled={p.jeVObdelavi} onClick={akcije.gost}>
                  <Users className="h-4 w-4" />Gost
                </button>
              )}
              {!p.jeVecHodniMeni && p.imaToGo && (
                <button type="button" data-testid="row-akcija-togo" className={`${gumbAkcije} ${p.toGoAktiven ? "border-orange-500 bg-orange-500 text-white" : ""}`} disabled={p.jeVObdelavi} onClick={akcije.toGo}>
                  <ShoppingBag className="h-4 w-4" />To Go
                </button>
              )}
              <button type="button" data-testid="row-akcija-popust" className={`${gumbAkcije} ${p.imaPopust || p.popustOdprt ? "border-amber-300 bg-amber-50 text-amber-700" : ""}`} disabled={p.jeVObdelavi} onClick={akcije.popust}>
                <Percent className="h-4 w-4" />Popust
              </button>
              {p.imaOpcije && !p.jeVecHodniMeni && !p.jeVObdelavi && (
                <button type="button" data-testid="row-akcija-opcije" className={gumbAkcije} onClick={akcije.opcije}>
                  <Settings2 className="h-4 w-4" />Opcije
                </button>
              )}
              {!p.jeVecHodniMeni && (
                <button type="button" data-testid="row-akcija-zapis" className={gumbAkcije} disabled={p.jeVObdelavi} onClick={akcije.zapis}>
                  <Pencil className="h-4 w-4" />Zapis
                </button>
              )}
              {!p.jeVecHodniMeni && (
                <button
                  type="button"
                  data-testid="row-akcija-glas"
                  className={`${gumbAkcije} ${p.mikrofon === "poslusam" ? "animate-pulse border-red-200 bg-red-50 text-red-500" : ""}`}
                  disabled={p.jeVObdelavi}
                  onClick={akcije.mikrofon}
                >
                  {p.mikrofon === "poslusam" ? <MicOff className="h-4 w-4" /> : <Mic className="h-4 w-4" />}Glas
                </button>
              )}
              {postavka.opomba && (
                <button type="button" data-testid="row-akcija-zbrisi-zapis" className={gumbAkcije} onClick={akcije.zbrisiZapis}>
                  <X className="h-4 w-4" />Brez zapisa
                </button>
              )}
              <button type="button" data-testid="row-akcija-brisi" className={`${gumbAkcije} border-red-200 bg-red-50 text-red-600`} disabled={p.jeVObdelavi} onClick={akcije.brisi}>
                <Trash2 className="h-4 w-4" />Briši
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
