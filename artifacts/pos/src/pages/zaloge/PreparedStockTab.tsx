import {
  getGetPreparedFoodAvailabilityQueryKey,
  getListPreparedFoodStocksQueryKey,
  useGetPreparedFoodAvailability,
  useListPreparedFoodStocks,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { buildPreparedStockRows } from "./prepared-stock-rows";

const formatQuantity = (value: number) =>
  value.toLocaleString("sl-SI", { maximumFractionDigits: 3 });

export function PreparedStockTab() {
  const availability = useGetPreparedFoodAvailability({
    query: { queryKey: getGetPreparedFoodAvailabilityQueryKey(), refetchOnMount: "always", refetchInterval: 15_000 },
  });
  const year = Number(availability.data?.businessDate.slice(0, 4) ?? 0);
  const stocks = useListPreparedFoodStocks(year, {
    query: { queryKey: getListPreparedFoodStocksQueryKey(year), enabled: year > 0, refetchOnMount: "always", refetchInterval: 30_000 },
  });

  if (availability.isError || stocks.isError) {
    return <p role="alert" className="text-sm text-destructive">Stanja pripravljenih jedi ni mogoče naložiti.</p>;
  }
  if (!availability.data || !stocks.data) {
    return <p className="py-8 text-center text-sm text-muted-foreground">Nalaganje pripravljenih jedi...</p>;
  }

  const items = availability.data.items.filter(item => item.mealType === "prepared");
  const stockIds = new Set(stocks.data.map(stock => stock.artikelId));
  if (items.some(item =>
    item.freshQuantity == null
    || item.thawedOpenQuantity == null
    || !stockIds.has(item.articleId)
    || stocks.data.find(stock => stock.artikelId === item.articleId)!.frozenQuantity + 1e-6 < item.thawedOpenQuantity
  )) {
    return <p role="alert" className="text-sm text-destructive">Podatki o zalogi pripravljenih jedi niso popolni. Poskusite znova.</p>;
  }
  const rows = buildPreparedStockRows(items, stocks.data);

  return (
    <div className="space-y-3">
      <p className="text-sm text-muted-foreground">
        Stanje za poslovni dan {availability.data.businessDate.split("-").reverse().join(".")}.
        Zamrznjene porcije so vključene v skupno količino, za prodajo pa morajo biti najprej odtajane.
      </p>
      <Card className="min-w-0 overflow-x-auto">
        <Table className="min-w-[510px]">
          <TableHeader>
            <TableRow>
              <TableHead>Pripravljena jed</TableHead>
              <TableHead className="text-right">Nezamrznjeno</TableHead>
              <TableHead className="text-right">Zamrznjeno</TableHead>
              <TableHead className="text-right">Skupaj porcij</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="py-8 text-center text-muted-foreground">
                  Ni pripravljenih jedi
                </TableCell>
              </TableRow>
            ) : rows.map(row => (
              <TableRow key={row.articleId}>
                <TableCell className="font-medium">{row.articleName}</TableCell>
                <TableCell className="text-right tabular-nums">{formatQuantity(row.freshQuantity)}</TableCell>
                <TableCell className="text-right tabular-nums">{formatQuantity(row.frozenQuantity)}</TableCell>
                <TableCell className="text-right font-semibold tabular-nums">{formatQuantity(row.totalQuantity)}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </Card>
    </div>
  );
}