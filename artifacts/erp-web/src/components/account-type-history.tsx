import { useListAccountTypeConfirmations, getListAccountTypeConfirmationsQueryKey } from "@workspace/api-client-react";
import { Alert, AlertDescription } from "@/components/ui/alert";

const types: Record<string, string> = {
  asset: "Sredstvo", liability: "Obveznost", equity: "Kapital",
  revenue: "Prihodek", expense: "Odhodek",
};
const sources = { create: "Ročno ustvarjanje", update: "Ročno urejanje", import: "Uvoz" };

export function AccountTypeHistory({ companyId, accountId }: { companyId: string; accountId: string }) {
  const { data, isLoading, error } = useListAccountTypeConfirmations(companyId, accountId, {
    query: { queryKey: getListAccountTypeConfirmationsQueryKey(companyId, accountId), staleTime: 0 },
  });
  if (isLoading) return <p role="status">Nalaganje zgodovine potrditev …</p>;
  if (error) return <Alert variant="destructive"><AlertDescription>Zgodovine potrditev ni mogoče naložiti.</AlertDescription></Alert>;
  return (
    <section className="space-y-3">
      <p className="text-sm text-muted-foreground">Pretekla potrditev velja samo za takratno shranjevanje, ne za prihodnje spremembe kode ali tipa.</p>
      {!data?.length ? <p>Za ta konto ni zabeleženih potrditev izjem.</p> : (
        <ol className="space-y-3">
          {data.map(item => (
            <li key={item.id} className="rounded border p-3 text-sm space-y-1">
              <p className="font-medium">{sources[item.source]} · {item.code}</p>
              <p>Izbrani tip: {types[item.selectedType]} · Pričakovani tip: {types[item.expectedType]}</p>
              <p className="break-all">Potrdil (ID uporabnika): {item.actorId}</p>
              <p><time dateTime={item.confirmedAt}>{new Date(item.confirmedAt).toLocaleString("sl-SI", { timeZone: "Europe/Ljubljana" })}</time></p>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
