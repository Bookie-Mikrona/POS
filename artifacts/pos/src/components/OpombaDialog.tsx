import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { customFetch } from "@workspace/api-client-react";
import { Sparkles, X } from "lucide-react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";

interface HitraOpomba { id: number; besedilo: string; kategorijaId: number | null }

interface Props {
  artikelId: number;
  vrednost: string;
  onPotrdi: (vrednost: string) => void;
  onPreklic: () => void;
}

const MAX_DOLZINA = 80;

function dodajBesedilo(trenutno: string, novo: string): string {
  const deli = trenutno.split(",").map(d => d.trim()).filter(Boolean);
  if (deli.some(d => d.toLowerCase() === novo.toLowerCase())) return deli.join(", ");
  return [...deli, novo].join(", ");
}

/** Opomba na postavki: hitri gumbi po kategoriji, prosto besedilo in predlogi AI, ki jih uporabnik potrdi. */
export default function OpombaDialog({ artikelId, vrednost, onPotrdi, onPreklic }: Props) {
  const [besedilo, setBesedilo] = useState(vrednost);
  const [urejanje, setUrejanje] = useState(false);
  const [predlogi, setPredlogi] = useState<string[] | null>(null);
  const [nalagamPredloge, setNalagamPredloge] = useState(false);
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const queryKey = ["hitre-opombe", artikelId];

  useEffect(() => setBesedilo(vrednost), [vrednost]);

  const { data: gumbi = [] } = useQuery<HitraOpomba[]>({
    queryKey,
    queryFn: () => customFetch<HitraOpomba[]>(`/api/hitre-opombe?artikelId=${artikelId}`),
  });

  const napaka = (e: unknown, naslov: string) =>
    toast({ title: naslov, description: e instanceof Error ? e.message : undefined, variant: "destructive" });

  const shrani = async (tekst: string) => {
    try {
      await customFetch("/api/hitre-opombe", { method: "POST", body: JSON.stringify({ besedilo: tekst }) });
      await queryClient.invalidateQueries({ queryKey });
      toast({ title: "Hitra opomba shranjena" });
    } catch (e) { napaka(e, "Hitre opombe ni mogoče shraniti"); }
  };
  const izbrisi = async (id: number) => {
    try {
      await customFetch(`/api/hitre-opombe/${id}`, { method: "DELETE" });
      await queryClient.invalidateQueries({ queryKey });
    } catch (e) { napaka(e, "Hitre opombe ni mogoče izbrisati"); }
  };
  const pridobiPredloge = async () => {
    setNalagamPredloge(true);
    try {
      const r = await customFetch<{ predlogi: string[] }>("/api/hitre-opombe/predlogi", {
        method: "POST",
        body: JSON.stringify({ artikelId, zeVneseno: besedilo.split(",").map(d => d.trim()).filter(Boolean) }),
      });
      setPredlogi(r.predlogi);
    } catch (e) { napaka(e, "Predlogov AI ni mogoče pridobiti"); }
    finally { setNalagamPredloge(false); }
  };

  const trimmed = besedilo.trim();
  const jeShranjena = gumbi.some(g => g.besedilo.toLowerCase() === trimmed.toLowerCase());

  return (
    <div data-pos-keyboard-overlay className="fixed inset-0 z-[100] flex items-center justify-center bg-black/40 p-4">
      <form
        className="w-full max-w-lg space-y-3 rounded-lg border bg-background p-4 shadow-xl max-h-[90dvh] overflow-y-auto"
        onSubmit={event => { event.preventDefault(); onPotrdi(besedilo); }}
      >
        <div className="flex items-center justify-between">
          <label htmlFor="opomba-dialog-field" className="text-sm font-medium">Opomba</label>
          <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setUrejanje(u => !u)}>
            {urejanje ? "Končaj urejanje" : "Uredi gumbe"}
          </button>
        </div>

        {gumbi.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {gumbi.map(g => (
              <span key={g.id} className="inline-flex items-center rounded-full border bg-muted/40">
                <button
                  type="button"
                  className="px-3 py-1.5 text-sm"
                  onClick={() => setBesedilo(b => dodajBesedilo(b, g.besedilo).slice(0, MAX_DOLZINA * 3))}
                >
                  {g.besedilo}
                </button>
                {urejanje && (
                  <button type="button" aria-label={`Izbriši ${g.besedilo}`} className="pr-2 text-destructive" onClick={() => izbrisi(g.id)}>
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        <Input
          id="opomba-dialog-field"
          autoFocus
          value={besedilo}
          onChange={event => setBesedilo(event.target.value)}
          placeholder="Vnesite besedilo…"
        />

        {urejanje && trimmed && trimmed.length <= MAX_DOLZINA && !jeShranjena && (
          <Button type="button" variant="outline" size="sm" onClick={() => shrani(trimmed)}>
            Shrani »{trimmed}« kot hitri gumb
          </Button>
        )}

        <div className="space-y-2">
          <Button type="button" variant="outline" size="sm" disabled={nalagamPredloge} onClick={pridobiPredloge}>
            <Sparkles className="mr-1 h-3.5 w-3.5" />{nalagamPredloge ? "Iščem predloge…" : "Predlogi AI"}
          </Button>
          {predlogi && (
            predlogi.length === 0 ? (
              <p className="text-xs text-muted-foreground">Ni novih predlogov.</p>
            ) : (
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground">Predlog AI: dotik doda v opombo, nič se ne shrani samodejno.</p>
                <div className="flex flex-wrap gap-2">
                  {predlogi.map(p => (
                    <button
                      key={p}
                      type="button"
                      className="rounded-full border border-dashed border-blue-300 px-3 py-1.5 text-sm text-blue-700"
                      onClick={() => setBesedilo(b => dodajBesedilo(b, p))}
                    >
                      + {p}
                    </button>
                  ))}
                </div>
              </div>
            )
          )}
        </div>

        <div className="flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={onPreklic}>Prekliči</Button>
          <Button type="submit">Potrdi</Button>
        </div>
      </form>
    </div>
  );
}
