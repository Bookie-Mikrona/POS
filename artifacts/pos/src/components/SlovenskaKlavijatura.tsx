import { useEffect, useState } from "react";
import { ChevronUp, CornerDownLeft, Delete, X } from "lucide-react";

interface Props {
  vrednost: string;
  onSprememba?: (vrednost: string) => void;
  onPotrdi: (vrednost: string) => void;
  onPreklic: () => void;
  naslov?: string;
  placeholder?: string;
}

const STEVILKE = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "0", ".", ","];
const SIMBOLI = ["@", "+", "-", "_", "/", ":", "(", ")", "€"];
const VRSTICE = [
  ["q", "w", "e", "r", "t", "z", "u", "i", "o", "p"],
  ["a", "s", "d", "f", "g", "h", "j", "k", "l", "č"],
  ["y", "x", "c", "v", "b", "n", "m", "š", "ž"],
];

export default function SlovenskaKlavijatura({
  vrednost,
  onSprememba,
  onPotrdi,
  onPreklic,
  naslov,
  placeholder,
}: Props) {
  const [besedilo, setBesedilo] = useState(vrednost);
  const [caps, setCaps] = useState(false);

  useEffect(() => setBesedilo(vrednost), [vrednost]);

  const posodobi = (novaVrednost: string) => {
    setBesedilo(novaVrednost);
    onSprememba?.(novaVrednost);
  };
  const dodajZnak = (znak: string) => {
    posodobi(besedilo + (caps ? znak.toUpperCase() : znak));
  };
  const brisiZnak = () => posodobi(besedilo.slice(0, -1));
  const tipkaClass =
    "flex flex-1 select-none touch-manipulation items-center justify-center rounded-md border border-border bg-card text-sm font-medium active:bg-muted";

  return (
    <div
      data-pos-keyboard-overlay
      data-pos-keyboard-autofocus-disabled
      className="pointer-events-auto fixed inset-0 z-[100]"
      style={{ touchAction: "none" }}
    >
      <div
        className="absolute inset-0 bg-black/40"
        onPointerDown={event => {
          event.preventDefault();
          onPreklic();
        }}
      />
      <div
        data-pos-keyboard-panel
        className="fixed bottom-16 left-0 right-0 max-h-[calc(92vh-4rem)] overflow-y-auto rounded-t-xl border-t bg-background shadow-2xl md:bottom-0"
      >
        {naslov && (
          <div className="border-b bg-muted/30 px-3 py-1.5 text-center text-xs font-medium text-muted-foreground">
            {naslov}
          </div>
        )}

        <div className="space-y-1 px-1.5 pb-1 pt-1.5">
          <div className="flex h-9 gap-1">
            {STEVILKE.map(znak => (
              <button
                key={znak}
                type="button"
                onPointerDown={event => {
                  event.preventDefault();
                  dodajZnak(znak);
                }}
                className={tipkaClass}
              >
                {znak}
              </button>
            ))}
          </div>

          <div className="flex h-9 gap-1">
            {SIMBOLI.map(znak => (
              <button
                key={znak}
                type="button"
                onPointerDown={event => {
                  event.preventDefault();
                  dodajZnak(znak);
                }}
                className={tipkaClass}
              >
                {znak}
              </button>
            ))}
          </div>

          {VRSTICE.map((vrstica, indeks) => (
            <div key={indeks} className="flex h-[38px] gap-1">
              {indeks === 2 && (
                <button
                  type="button"
                  onPointerDown={event => {
                    event.preventDefault();
                    setCaps(trenutno => !trenutno);
                  }}
                  style={{ flex: "1.4 1 0" }}
                  className={`flex touch-manipulation select-none items-center justify-center rounded-md border ${
                    caps ? "border-primary bg-primary text-primary-foreground" : "border-border bg-muted text-foreground"
                  }`}
                  aria-label="Velike črke"
                >
                  <ChevronUp className="h-4 w-4" />
                </button>
              )}
              {vrstica.map(znak => (
                <button
                  key={znak}
                  type="button"
                  onPointerDown={event => {
                    event.preventDefault();
                    dodajZnak(znak);
                  }}
                  className={tipkaClass}
                >
                  {caps ? znak.toUpperCase() : znak}
                </button>
              ))}
              {indeks === 2 && (
                <button
                  type="button"
                  onPointerDown={event => {
                    event.preventDefault();
                    brisiZnak();
                  }}
                  style={{ flex: "1.4 1 0" }}
                  className="flex touch-manipulation select-none items-center justify-center rounded-md border border-border bg-muted"
                  aria-label="Izbriši znak"
                >
                  <Delete className="h-4 w-4" />
                </button>
              )}
            </div>
          ))}

          <div className="flex h-[42px] gap-1">
            <button
              type="button"
              onClick={onPreklic}
              style={{ flex: "1.8 1 0" }}
              className="flex touch-manipulation select-none items-center justify-center gap-1 rounded-md border border-border bg-muted text-sm font-medium"
            >
              <X className="h-3.5 w-3.5" />
              Prekliči
            </button>
            <button
              type="button"
              onPointerDown={event => {
                event.preventDefault();
                posodobi("");
              }}
              style={{ flex: "1.2 1 0" }}
              className="flex touch-manipulation select-none items-center justify-center rounded-md border border-border bg-muted text-xs font-medium"
              aria-label="Počisti vnos"
            >
              Počisti
            </button>
            <button
              type="button"
              onPointerDown={event => {
                event.preventDefault();
                dodajZnak(" ");
              }}
              style={{ flex: "3 1 0" }}
              className="flex touch-manipulation select-none items-center justify-center rounded-md border border-border bg-card text-xs text-muted-foreground"
            >
              presledek
            </button>
            <button
              type="button"
              onClick={() => onPotrdi(besedilo)}
              style={{ flex: "1.8 1 0" }}
              className="flex touch-manipulation select-none flex-col items-center justify-center gap-0.5 rounded-md bg-primary text-primary-foreground"
              title="Potrdi"
            >
              <CornerDownLeft className="h-5 w-5" />
              <span className="text-[10px] font-semibold leading-none opacity-80">Potrdi</span>
            </button>
          </div>
        </div>
        <div style={{ height: "env(safe-area-inset-bottom, 0px)" }} />
      </div>
    </div>
  );
}