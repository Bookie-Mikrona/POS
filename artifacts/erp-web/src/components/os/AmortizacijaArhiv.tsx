import type { OsAmortizacijaArhivGlava } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { formatDatum } from "@/lib/utils";

interface Props {
  obracuni: OsAmortizacijaArhivGlava[] | undefined;
  isLoading: boolean;
  isError: boolean;
  onRetry: () => void;
  leto: number;
  onSelect: (obracun: OsAmortizacijaArhivGlava) => void;
}

export function AmortizacijaArhiv({ obracuni, isLoading, isError, onRetry, leto, onSelect }: Props) {
  return (
    <section aria-labelledby="amortizacija-arhiv-heading" className="rounded-lg border">
      <h2 id="amortizacija-arhiv-heading" className="px-4 py-3 font-semibold">
        Arhiv shranjenih obračunov
      </h2>
      {isLoading ? (
        <p role="status" className="px-4 pb-4 text-sm text-muted-foreground">Nalaganje obračunov…</p>
      ) : isError ? (
        <div role="alert" className="px-4 pb-4 text-sm text-destructive">
          Arhiva obračunov ni bilo mogoče naložiti.
          <Button variant="outline" size="sm" className="ml-2" onClick={onRetry}>Poskusi znova</Button>
        </div>
      ) : !obracuni?.length ? (
        <p className="px-4 pb-4 text-sm text-muted-foreground">Za to podjetje še ni shranjenih obračunov.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Leto</TableHead>
              <TableHead>Do meseca</TableHead>
              <TableHead className="text-right">Skupaj amortizacija</TableHead>
              <TableHead>Status</TableHead>
              <TableHead>Datum posodobitve</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {obracuni.map((obracun) => (
              <TableRow key={obracun.id} data-state={obracun.leto === leto ? "selected" : undefined}>
                <TableCell>
                  <button
                    type="button"
                    className="font-medium text-primary underline underline-offset-4 rounded-sm focus-visible:outline focus-visible:outline-2"
                    aria-label={`Prikaži sredstva za leto ${obracun.leto}`}
                    aria-pressed={obracun.leto === leto}
                    onClick={() => onSelect(obracun)}
                  >
                    {obracun.leto}
                  </button>
                </TableCell>
                <TableCell>{obracun.doMeseca}</TableCell>
                <TableCell className="text-right tabular-nums">
                  {Number(obracun.skupajAmortizacija).toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                </TableCell>
                <TableCell>
                  <Badge variant="outline" className={obracun.status === "zakljucen"
                    ? "bg-green-50 text-green-700 border-green-200"
                    : "bg-yellow-50 text-yellow-800 border-yellow-200"}>
                    {obracun.status === "zakljucen" ? "Zaključen" : "Odprt"}
                  </Badge>
                </TableCell>
                <TableCell>{formatDatum(obracun.updatedAt)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
