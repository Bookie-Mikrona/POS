import { useState, useEffect } from "react";
import { Check, X, Delete, ChevronUp, CornerDownLeft } from "lucide-react";

interface Props {
  vrednost: string;
  onPotrdi: (vrednost: string) => void;
  onPreklic: () => void;
  naslov?: string;
  placeholder?: string;
}

const STEVILKE: string[] = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", ".", ","];

const VRSTICE: string[][] = [
  ["q", "w", "e", "r", "t", "z", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", "č"],
  ["y", "x", "c", "v", "b", "n", "m", "š", "ž"],
];

export default function SlovenskaKlavijatura({ vrednost, onPotrdi, onPreklic, naslov, placeholder }: Props) {
  const [besedilo, setBesedilo] = useState(vrednost);
  const [caps, setCaps] = useState(false);

  useEffect(() => {
    setBesedilo(vrednost);
  }, [vrednost]);

  const dodajZnak = (znak: string) => {
    setBesedilo(prev => prev + (caps ? znak.toUpperCase() : znak));
  };

  const brisi = () => setBesedilo(prev => prev.slice(0, -1));
  const brisiVse = () => setBesedilo("");

  const tipkaClass =
    "flex-1 flex items-center justify-center bg-card active:bg-muted border border-border rounded-md text-sm font-medium select-none touch-manipulation";

  return (
    <div
      className="fixed inset-0 z-50"
      style={{ touchAction: "none" }}
    >
      {/* Backdrop — onPointerDown ne onClick: ko se dialog odpre med aktivnim dotikom,
          pointerup/click pade na backdrop in z onClick bi takoj zaprl dialog.
          onPointerDown se sproži šele pri novem dotiku (ne pri istem ki je odprl dialog). */}
      <div
        className="absolute inset-0 bg-black/40"
        onPointerDown={e => { e.preventDefault(); onPreklic(); }}
      />

      {/* Panel — nad spodnjim menijem (16=64px na mobilnih, 0 na desktop) */}
      <div
        className="fixed bottom-16 md:bottom-0 left-0 right-0 bg-background border-t shadow-2xl rounded-t-xl overflow-y-auto"
        style={{ maxHeight: "calc(92vh - 4rem)" }}
      >

        {/* Vnosna vrstica */}
        <div className="flex items-center gap-2 px-3 py-2 border-b bg-muted/30">
          {naslov && (
            <span className="text-xs font-medium text-muted-foreground shrink-0">{naslov}:</span>
          )}
          <div className="flex-1 bg-background border rounded-md px-2.5 py-1.5 min-h-[34px] flex items-center">
            <span className="text-sm flex-1 leading-snug break-all">
              {besedilo || <span className="text-muted-foreground italic text-xs">{placeholder ?? "Vnesite besedilo…"}</span>}
            </span>
            {besedilo && (
              <button
                type="button"
                onPointerDown={e => { e.preventDefault(); brisiVse(); }}
                className="ml-1 text-muted-foreground/50 hover:text-muted-foreground shrink-0"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Tipkovnica */}
        <div className="px-1.5 pt-1.5 pb-1 space-y-1">

          {/* Vrstica številk */}
          <div className="flex gap-1" style={{ height: 36 }}>
            {STEVILKE.map(znak => (
              <button
                key={znak}
                type="button"
                onPointerDown={e => { e.preventDefault(); dodajZnak(znak); }}
                className={tipkaClass}
              >
                {znak}
              </button>
            ))}
          </div>

          {/* Črkovna vrstica */}
          {VRSTICE.map((vrstica, vi) => (
            <div key={vi} className="flex gap-1" style={{ height: 38 }}>
              {vi === 2 && (
                <button
                  type="button"
                  onPointerDown={e => { e.preventDefault(); setCaps(c => !c); }}
                  style={{ flex: "1.4 1 0" }}
                  className={`flex items-center justify-center rounded-md border transition-colors touch-manipulation select-none ${
                    caps
                      ? "bg-primary text-primary-foreground border-primary"
                      : "bg-muted text-foreground border-border"
                  }`}
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
              )}

              {vrstica.map(znak => (
                <button
                  key={znak}
                  type="button"
                  onPointerDown={e => { e.preventDefault(); dodajZnak(znak); }}
                  className={tipkaClass}
                >
                  {caps ? znak.toUpperCase() : znak}
                </button>
              ))}

              {vi === 2 && (
                <button
                  type="button"
                  onPointerDown={e => { e.preventDefault(); brisi(); }}
                  style={{ flex: "1.4 1 0" }}
                  className="flex items-center justify-center bg-muted border border-border rounded-md touch-manipulation select-none"
                >
                  <Delete className="h-4 w-4 text-foreground" />
                </button>
              )}
            </div>
          ))}

          {/* Spodnja vrstica — potrditev desno spodaj */}
          <div className="flex gap-1" style={{ height: 42 }}>
            {/* Prekliči in Potrdi: onClick (ne onPointerDown) — preprečuje click-through.
                Z onPointerDown bi dialog zaprl preden se pointerup/click sproži → klik
                pade na artikel gumb pod tipkovnico → artikel se doda po naključju. */}
            <button
              type="button"
              onClick={onPreklic}
              style={{ flex: "1.8 1 0" }}
              className="flex items-center justify-center gap-1 bg-muted border border-border rounded-md text-sm font-medium touch-manipulation select-none"
            >
              <X className="h-3.5 w-3.5" />
              <span>Prekliči</span>
            </button>

            <button
              type="button"
              onPointerDown={e => { e.preventDefault(); dodajZnak(" "); }}
              style={{ flex: "4 1 0" }}
              className="flex items-center justify-center bg-card border border-border rounded-md text-xs text-muted-foreground touch-manipulation select-none"
            >
              presledek
            </button>

            {/* Potrditev — desni spodnji kot */}
            <button
              type="button"
              onClick={() => onPotrdi(besedilo)}
              style={{ flex: "1.8 1 0" }}
              className="flex flex-col items-center justify-center gap-0.5 bg-primary text-primary-foreground rounded-md touch-manipulation select-none"
              title="Potrdi"
            >
              <CornerDownLeft className="h-5 w-5" />
              <span className="text-[10px] font-semibold leading-none opacity-80">Potrdi</span>
            </button>
          </div>
        </div>

        {/* Safe area */}
        <div style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
      </div>
    </div>
  );
}
