import { getGetPreparedFoodConsumptionQueryKey, useGetPreparedFoodConsumption } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { DecimalInput, parseDecimal } from "@/components/ui/decimal-input";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatPreparedFoodQuantity, preparedFoodUnitLabel } from "@/lib/prepared-food-unit";

export type ConsumptionSelection = {
  articleId: number;
  articleName: string;
  quantity: string;
  unit: string | null | undefined;
  readOnly: boolean;
  closed: boolean;
  unsaved: boolean;
};

function ingredientUnit(unit: string | null): string {
  const labels: Record<string, string> = { KGM: "kg", KG: "kg", GRM: "g", G: "g", LTR: "l", L: "l", MLT: "ml", ML: "ml", H87: "kos", PCE: "kos", EA: "kos", KOS: "kos" };
  return unit ? labels[unit.toUpperCase()] ?? unit : "enota ni določena";
}

export function PreparationConsumptionDialog({
  date, selection, onClose, onQuantityChange,
}: {
  date: string;
  selection: ConsumptionSelection;
  onClose: () => void;
  onQuantityChange: (quantity: string) => void;
}) {
  const quantity = parseDecimal(selection.quantity);
  const valid = Number.isFinite(quantity) && quantity >= 0;
  const params = selection.closed ? undefined : { quantity: valid ? quantity : 0 };
  const { data, isLoading, isError, refetch } = useGetPreparedFoodConsumption(
    date, selection.articleId, params,
    { query: { queryKey: getGetPreparedFoodConsumptionQueryKey(date, selection.articleId, params),
      enabled: selection.closed || valid, staleTime: 0, retry: false } },
  );
  const actual = selection.closed || data?.source === "actual";
  return (
    <Dialog open onOpenChange={open => { if (!open) onClose(); }}>
      <DialogContent className="max-w-2xl max-h-[90dvh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{actual ? "Poraba artiklov" : "Surovine za pripravo"} — {selection.articleName}</DialogTitle>
          <DialogDescription>
            {actual
              ? "Dejanska knjižena poraba ob zaključku dnevne evidence."
              : "Informativni seznam surovin za kuho vnesene količine po normativu. Sam ogled ne spreminja zaloge. Poraba se razknjiži šele ob zaključku dnevne evidence."}
          </DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <label htmlFor="consumption-prepared-quantity">{actual ? "Pripravljeno:" : "Količina za pripravo:"}</label>
          {!selection.readOnly && !actual ? (
            <DecimalInput id="consumption-prepared-quantity" value={selection.quantity}
              onChange={event => onQuantityChange(event.target.value)} className="w-28"
              aria-label="Količina pripravljeno za izračun porabe" />
          ) : (
            <strong>{formatPreparedFoodQuantity(data?.preparedQuantity ?? selection.quantity)}</strong>
          )}
          <span>{preparedFoodUnitLabel(data?.unitOfMeasure ?? selection.unit)}</span>
          {selection.unsaved && !actual && <span className="text-muted-foreground">Neshranjena količina</span>}
        </div>
        {!valid && !selection.closed ? <p role="alert">Vnesite veljavno nenegativno količino.</p>
          : isLoading ? <p role="status">Nalaganje porabe …</p>
          : isError ? <div role="alert" className="space-y-2">
            <p>Porabe ni bilo mogoče pridobiti.</p>
            <Button variant="outline" onClick={() => void refetch()}>Poskusi znova</Button>
          </div>
          : data ? <>
            {data.message && <p className="text-sm text-muted-foreground">{data.message}</p>}
            {data.items.length ? (
              <Table aria-label="Poraba artiklov za pripravljeno količino">
                <TableHeader><TableRow>
                  <TableHead>Artikel</TableHead>
                  <TableHead className="text-right">Količina</TableHead>
                  <TableHead>Enota</TableHead>
                </TableRow></TableHeader>
                <TableBody>{data.items.map(item => (
                  <TableRow key={item.ingredientId}>
                    <TableCell className="break-words">{item.ingredientName}</TableCell>
                    <TableCell className="text-right tabular-nums">{formatPreparedFoodQuantity(item.quantity)}</TableCell>
                    <TableCell>{ingredientUnit(item.unitOfMeasure)}</TableCell>
                  </TableRow>
                ))}</TableBody>
              </Table>
            ) : <p className="text-sm">{data.source === "actual" ? "Ni evidentirane porabe artiklov." : "Normativ nima sestavin za prikaz."}</p>}
          </> : null}
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Zapri</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}