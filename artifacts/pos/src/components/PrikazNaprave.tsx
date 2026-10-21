import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useUpdateNaprava } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import {
  useNaprava,
  type GostotaArtiklov,
  type PrikazMenija,
  type PrikazNarocila,
} from "@/contexts/NapravaContext";

export interface PrikazNastavitve {
  prikazMenija: PrikazMenija;
  gostotaArtiklov: GostotaArtiklov;
  prikazNarocila: PrikazNarocila;
}

export const PRIKAZ_PRIVZETO: PrikazNastavitve = {
  prikazMenija: "trenutno",
  gostotaArtiklov: "privzeto",
  prikazNarocila: "staro",
};

const MENI: Array<[PrikazMenija, string]> = [
  ["trenutno", "Trenutno"],
  ["A", "A: oddelki"],
  ["B", "B: vse kat."],
  ["C", "C: stranska (ležeče)"],
];
const GOSTOTA: Array<[GostotaArtiklov, string]> = [
  ["privzeto", "Privzeto"],
  ["kompaktno", "Kompaktno"],
  ["seznam", "Seznam"],
  ["velika", "Velika"],
];
const NAROCILO: Array<[PrikazNarocila, string]> = [
  ["staro", "Staro"],
  ["novo", "Novo"],
];

function Izbira<T extends string>({
  naslov,
  moznosti,
  vrednost,
  onChange,
  disabled,
}: {
  naslov: string;
  moznosti: Array<[T, string]>;
  vrednost: T;
  onChange: (v: T) => void;
  disabled?: boolean;
}) {
  return (
    <div className="space-y-1.5" role="radiogroup" aria-label={naslov}>
      <p className="text-sm font-medium">{naslov}</p>
      <div className="flex flex-wrap gap-2">
        {moznosti.map(([v, label]) => (
          <button
            key={v}
            type="button"
            role="radio"
            aria-checked={vrednost === v}
            disabled={disabled}
            onClick={() => onChange(v)}
            className={`min-h-[44px] rounded-md border px-3 text-sm font-medium transition-colors disabled:opacity-60 ${
              vrednost === v
                ? "bg-primary text-primary-foreground border-primary"
                : "bg-background text-foreground hover:bg-muted"
            }`}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function PrikazIzbire({
  vrednost,
  onChange,
  disabled,
  takojUveljavi,
}: {
  vrednost: PrikazNastavitve;
  onChange: (v: PrikazNastavitve) => void;
  disabled?: boolean;
  /** Izbira se shrani takoj (hitro okno); to se izrecno pove. */
  takojUveljavi?: boolean;
}) {
  return (
    <div className="space-y-3" data-testid="prikaz-izbire">
      <Izbira naslov="Prikaz menija" moznosti={MENI} vrednost={vrednost.prikazMenija} disabled={disabled}
        onChange={(v) => onChange({ ...vrednost, prikazMenija: v })} />
      <Izbira naslov="Gostota artiklov" moznosti={GOSTOTA} vrednost={vrednost.gostotaArtiklov} disabled={disabled}
        onChange={(v) => onChange({ ...vrednost, gostotaArtiklov: v })} />
      <Izbira naslov="Prikaz naročila" moznosti={NAROCILO} vrednost={vrednost.prikazNarocila} disabled={disabled}
        onChange={(v) => onChange({ ...vrednost, prikazNarocila: v })} />
      <div className="space-y-1 text-xs leading-snug text-muted-foreground whitespace-normal break-words" data-testid="prikaz-opomba">
        <p>Velja samo za to napravo. Naročanje in obračun se ne spremenita.</p>
        {takojUveljavi && <p className="font-medium text-foreground">Izbira se shrani in uveljavi takoj, gumb »Shrani« ni potreben.</p>}
      </div>
    </div>
  );
}

/** Hitro preklapljanje prikaza za trenutno napravo (meni »Več«). */
export function PrikazTrenutneNaprave() {
  const { naprava, refreshNaprava } = useNaprava();
  const { toast } = useToast();
  const update = useUpdateNaprava();
  const [saving, setSaving] = useState(false);
  if (!naprava) return null;
  const vrednost: PrikazNastavitve = {
    prikazMenija: naprava.prikazMenija ?? PRIKAZ_PRIVZETO.prikazMenija,
    gostotaArtiklov: naprava.gostotaArtiklov ?? PRIKAZ_PRIVZETO.gostotaArtiklov,
    prikazNarocila: naprava.prikazNarocila ?? PRIKAZ_PRIVZETO.prikazNarocila,
  };
  const shrani = async (nova: PrikazNastavitve) => {
    setSaving(true);
    try {
      await update.mutateAsync({ id: naprava.id, data: nova });
      await refreshNaprava();
    } catch (error) {
      toast({
        title: "Prikaza ni bilo mogoče shraniti",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setSaving(false);
    }
  };
  return (
    <div className="mb-4 pb-4 border-b space-y-2" data-testid="prikaz-trenutne-naprave">
      <p className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60 px-1">
        Prikaz (ta naprava) {saving && <Loader2 className="h-3 w-3 animate-spin" />}
      </p>
      <PrikazIzbire vrednost={vrednost} onChange={(v) => void shrani(v)} disabled={saving} takojUveljavi />
    </div>
  );
}
