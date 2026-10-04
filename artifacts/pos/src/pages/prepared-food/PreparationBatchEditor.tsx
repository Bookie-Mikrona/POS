import { useState } from "react";
import type { PreparationBatch } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";

export function PreparationBatchEditor({ name, defaultPieces, value, readOnly, onChange }: {
  name: string; defaultPieces: number; value: PreparationBatch[] | null;
  readOnly: boolean; onChange: (batches: PreparationBatch[]) => void;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<PreparationBatch[]>([]);
  const valid = draft.length <= 100 && draft.every(b =>
    Number.isSafeInteger(b.batchCount) && b.batchCount >= 1 && b.batchCount <= 10000
    && Number.isSafeInteger(b.piecesPerBatch) && b.piecesPerBatch >= 1 && b.piecesPerBatch <= 10000);
  const total = draft.reduce((sum, b) => sum + b.batchCount * b.piecesPerBatch, 0);
  const setField = (index: number, key: keyof PreparationBatch, number: number) =>
    setDraft(prev => prev.map((b, i) => i === index ? { ...b, [key]: number } : b));
  return <>
    <Button type="button" size="sm" variant="outline" aria-label={`Priprave in razrez: ${name}`}
      onClick={() => { setDraft(value?.map(b => ({ ...b })) ?? (readOnly ? [] : [{ batchCount: 1, piecesPerBatch: defaultPieces }])); setOpen(true); }}>
      Priprave in razrez{value?.length ? ` (${value.length})` : ""}
    </Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="max-w-lg max-h-[85dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Priprave in razrez — {name}</DialogTitle>
          <DialogDescription>Normativ: {defaultPieces} kosov iz priprave. Drugačen razrez spremeni število pripravljenih kosov, ne porabe surovin za isti pekač. Spremembe se shranijo z dnevno evidenco.</DialogDescription>
        </DialogHeader>
        {draft.map((b, i) => <div key={i} className="rounded border p-3 space-y-2">
          <p className="font-medium">Priprava {i + 1}</p>
          <div className="grid grid-cols-2 gap-3">
            <div><Label htmlFor={`batch-count-${i}`}>Število pekačev</Label>
              <Input id={`batch-count-${i}`} type="number" min={1} max={10000} step={1}
                disabled={readOnly} value={b.batchCount} onChange={e => setField(i, "batchCount", Number(e.target.value))} /></div>
            <div><Label htmlFor={`batch-pieces-${i}`}>Kosov iz pekača</Label>
              <Input id={`batch-pieces-${i}`} type="number" min={1} max={10000} step={1}
                disabled={readOnly} value={b.piecesPerBatch} onChange={e => setField(i, "piecesPerBatch", Number(e.target.value))} /></div>
          </div>
          {!readOnly && <Button type="button" variant="ghost" onClick={() => setDraft(prev => prev.filter((_, index) => index !== i))}>Odstrani pripravo {i + 1}</Button>}
        </div>)}
        {!readOnly && <Button type="button" variant="outline" disabled={draft.length >= 100}
          onClick={() => setDraft(prev => [...prev, { batchCount: 1, piecesPerBatch: defaultPieces }])}>Dodaj pripravo</Button>}
        <p className="font-semibold">Skupaj pripravljeno: {total} kosov</p>
        {!valid && <p role="alert" className="text-destructive">Vnesite pozitivna cela števila do 10.000.</p>}
        <DialogFooter>
          <Button variant="outline" onClick={() => setOpen(false)}>{readOnly ? "Zapri" : "Prekliči"}</Button>
          {!readOnly && <Button disabled={!valid || total > 999999} onClick={() => { onChange(draft); setOpen(false); }}>Uporabi pripravljen razrez</Button>}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}