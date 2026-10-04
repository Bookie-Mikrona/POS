import { useState } from "react";
import { Button } from "@/components/ui/button";
import { DecimalInput } from "@/components/ui/decimal-input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { calculateBatchNormative, type BatchIngredient } from "@/lib/batch-normative";
import type { NormativItem } from "@/lib/kopiraj-normativ";

type Props = {
  items: NormativItem[];
  articles: { id: number; ime: string; enotaMere?: string | null }[];
  disabled?: boolean;
  defaultPieces?: number | null;
  onApply: (items: NormativItem[], pieces: number) => void;
};

export function BatchNormativeCalculator({ items, articles, disabled, defaultPieces, onApply }: Props) {
  const [open, setOpen] = useState(false);
  const [portions, setPortions] = useState("8");
  const [rows, setRows] = useState<BatchIngredient[]>([]);
  const articleMap = new Map(articles.map(article => [article.id, article]));
  let preview: NormativItem[] = [];
  let error = "";
  try { preview = calculateBatchNormative(rows, portions); }
  catch (cause) { error = cause instanceof Error ? cause.message : "Preračun ni uspel."; }
  const update = (index: number, field: "kolicina" | "yieldPercent", value: string) =>
    setRows(current => current.map((row, i) => i === index ? { ...row, [field]: value } : row));

  return (
    <>
      <Button type="button" size="sm" variant="outline" disabled={disabled || !items.length}
        onClick={() => {
          // Existing per-portion quantities must never be mistaken for a tray recipe.
          setRows(items.map(item => ({ ...item,
            kolicina: defaultPieces ? String(Number(item.kolicina) * defaultPieces) : "",
            yieldPercent: "100" })));
          setPortions(String(defaultPieces ?? 12));
          setOpen(true);
        }}>
        Recept za pekač
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Recept za pekač → normativ na kos</DialogTitle>
            <DialogDescription>
              Za zavitke, pite in torte. Vnesite recept za cel pekač v zalogovnih enotah
              surovin. Preračun spremeni samo osnutek normativa, ne zaloge ali shranjenega artikla.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div>
              <Label htmlFor="batch-portions">Število prodajnih kosov iz pekača</Label>
              <DecimalInput id="batch-portions" value={portions} onChange={event => setPortions(event.target.value)} />
            </div>
            <p className="text-sm text-muted-foreground">
              Izkoristek 80 % pomeni, da po čiščenju ostane 80 % surovine.
              Vnesite očiščeno količino; program izračuna nabavno porabo.
              Če recept že vsebuje bruto nabavno količino, pustite 100 %, da se kalo ne prišteje dvakrat.
            </p>
            {rows.map((row, index) => {
              const article = articleMap.get(row.vhodniArtikelId);
              const name = article?.ime ?? row.ime ?? `Surovina ${index + 1}`;
              const unit = article?.enotaMere?.trim() || "zalogovna enota";
              return (
                <div key={`${row.vhodniArtikelId}-${index}`} className="rounded-md border p-3 space-y-2">
                  <p className="font-medium">{name} · {unit}</p>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <div>
                      <Label htmlFor={`batch-quantity-${index}`}>Za pekač ({unit})</Label>
                      <DecimalInput id={`batch-quantity-${index}`} value={row.kolicina}
                        onChange={event => update(index, "kolicina", event.target.value)} />
                    </div>
                    <div>
                      <Label htmlFor={`batch-yield-${index}`}>Izkoristek (%)</Label>
                      <DecimalInput id={`batch-yield-${index}`} value={row.yieldPercent}
                        onChange={event => update(index, "yieldPercent", event.target.value)} />
                    </div>
                    <div>
                      <Label>Na kos ({unit})</Label>
                      <p className="py-2 font-medium" data-testid={`batch-preview-${index}`}>
                        {preview[index] ? Number(preview[index].kolicina).toLocaleString("sl-SI", { maximumFractionDigits: 4 }) : "—"}
                      </p>
                    </div>
                  </div>
                </div>
              );
            })}
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <p className="text-sm text-muted-foreground">
              Po uporabi preverite alergene in shranite artikel z običajnim gumbom.
              Surovine se razknjižijo v evidenci priprave; pri prodaji se odšteje pripravljen kos, ne ponovno surovine.
            </p>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>Prekliči</Button>
            <Button type="button" disabled={disabled || !!error} onClick={() => {
              // Validate again at the action boundary, not only for the preview.
              onApply(calculateBatchNormative(rows, portions), Number(portions.replace(",", ".")));
              setOpen(false);
            }}>Uporabi normativ na kos</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}