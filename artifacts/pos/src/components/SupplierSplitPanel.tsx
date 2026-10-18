import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetSupplierOrderDashboardQueryKey,
  getGetSupplierOrderSplitQueryKey,
  getListSupplierOrdersQueryKey,
  useCreateSupplierOrder,
  useGetSupplierOrderSplit,
  useSaveSupplierMappingMinimum,
  useSaveSupplierTerms,
} from "@workspace/api-client-react";
import type { SupplierOrderSplitGroup } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

type Strategy = "cheapest" | "fewest_suppliers";

const money = (value: number | null | undefined) =>
  value == null ? "—" : new Intl.NumberFormat("sl-SI", { style: "currency", currency: "EUR" }).format(value);

function GroupCard({
  group,
  onChanged,
  onNotice,
}: {
  group: SupplierOrderSplitGroup;
  onChanged: () => Promise<void>;
  onNotice: (text: string, error?: boolean) => void;
}) {
  const saveTerms = useSaveSupplierTerms();
  const saveMinimum = useSaveSupplierMappingMinimum();
  const createOrder = useCreateSupplierOrder();
  const [minAmount, setMinAmount] = useState(group.minOrderAmount == null ? "" : String(group.minOrderAmount));
  const [leadDays, setLeadDays] = useState(group.leadTimeDays == null ? "" : String(group.leadTimeDays));
  const busy = saveTerms.isPending || saveMinimum.isPending || createOrder.isPending;
  const fail = (error: unknown, fallback: string) =>
    onNotice(error instanceof Error ? error.message : fallback, true);

  const submitTerms = async () => {
    const amount = minAmount.trim() === "" ? null : Number(minAmount.replace(",", "."));
    const days = leadDays.trim() === "" ? null : Number(leadDays);
    if ((amount !== null && (!Number.isFinite(amount) || amount < 0))
      || (days !== null && (!Number.isInteger(days) || days < 0 || days > 365))) {
      onNotice("Najmanjši znesek mora biti 0 ali več, rok pa celo število dni od 0 do 365.", true);
      return;
    }
    try {
      await saveTerms.mutateAsync({ supplierId: group.supplierId, data: { minOrderAmount: amount, leadTimeDays: days } });
      onNotice(`Pogoji dobavitelja ${group.supplierName} so shranjeni.`);
      await onChanged();
    } catch (error) { fail(error, "Pogojev ni bilo mogoče shraniti."); }
  };
  const submitMinimum = async (mappingId: number, value: string) => {
    const quantity = value.trim() === "" ? null : Number(value.replace(",", "."));
    if (quantity !== null && (!Number.isFinite(quantity) || quantity <= 0)) {
      onNotice("Najmanjša količina mora biti večja od nič.", true);
      return;
    }
    try {
      await saveMinimum.mutateAsync({ mappingId, data: { minPackageQuantity: quantity } });
      await onChanged();
    } catch (error) { fail(error, "Najmanjše količine ni bilo mogoče shraniti."); }
  };
  const createDraft = async () => {
    try {
      const result = await createOrder.mutateAsync({
        data: {
          supplierId: group.supplierId,
          expectedDeliveryDate: null,
          internalNotes: null,
          supplierNotes: null,
          lines: group.lines.map(line => ({
            supplierMappingId: line.supplierMappingId,
            packageQuantity: line.packageQuantity,
            unitPrice: line.unitPrice ?? undefined,
          })),
        },
      });
      onNotice(`Osnutek ${result.number} je shranjen. Naročilo samo ne spremeni zaloge ali računovodstva.`);
      await onChanged();
    } catch (error) { fail(error, "Osnutka ni bilo mogoče shraniti."); }
  };

  return (
    <div className="rounded-xl border border-[#ded6c7] bg-white p-4" data-testid={`supplier-split-group-${group.supplierId}`}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[#243d35]">{group.supplierName}</h3>
          <p className="mt-0.5 text-xs text-[#68756e]">
            Skupaj {money(group.total)}{group.totalComplete ? "" : " (nekatere cene niso znane)"}
            {group.leadTimeDays != null && ` · dobava v ${group.leadTimeDays} dneh`}
          </p>
        </div>
        <Button size="sm" disabled={busy} onClick={() => void createDraft()} className="bg-[#285d50] text-white hover:bg-[#204b41]">
          Ustvari osnutek
        </Button>
      </div>
      {group.meetsMinimum === false && (
        <p role="alert" className="mt-2 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900">
          Najmanjši znesek naročila {money(group.minOrderAmount)} ni dosežen; manjka še {money(group.shortfall)}.
        </p>
      )}
      <div className="mt-3 flex flex-wrap items-end gap-3 text-xs font-semibold text-[#5f7068]">
        <label>Najmanjši znesek (€)
          <Input inputMode="decimal" value={minAmount} onChange={event => setMinAmount(event.target.value)} className="mt-1 h-9 w-32 border-[#dcd4c6] text-right" />
        </label>
        <label>Rok dobave (dni)
          <Input inputMode="numeric" value={leadDays} onChange={event => setLeadDays(event.target.value)} className="mt-1 h-9 w-28 border-[#dcd4c6] text-right" />
        </label>
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void submitTerms()}>Shrani pogoje</Button>
      </div>
      <table className="mt-3 w-full text-left text-xs">
        <thead className="text-[#68756e]">
          <tr>
            <th className="py-1.5 pr-2">Artikel</th>
            <th className="py-1.5 pr-2 text-right">Pakiranja</th>
            <th className="py-1.5 pr-2 text-right">Cena pakiranja</th>
            <th className="py-1.5 pr-2 text-right">Skupaj</th>
            <th className="py-1.5 text-right">Najmanj pakiranj</th>
          </tr>
        </thead>
        <tbody>
          {group.lines.map(line => (
            <tr key={line.supplierMappingId} className="border-t border-[#eee8dc]">
              <td className="py-2 pr-2">
                {line.articleName}
                {line.supplierItemName && <span className="block text-[#68756e]">{line.supplierItemName}</span>}
              </td>
              <td className="py-2 pr-2 text-right">
                {line.packageQuantity}{line.packageName ? ` ${line.packageName}` : ""}
                {line.moqRaised && <span className="block text-amber-800">dvignjeno na najmanjšo količino</span>}
              </td>
              <td className="py-2 pr-2 text-right">{money(line.unitPrice)}</td>
              <td className="py-2 pr-2 text-right">{money(line.lineTotal)}</td>
              <td className="py-2 text-right">
                <Input
                  key={`${line.supplierMappingId}-${line.minPackageQuantity ?? ""}`}
                  inputMode="decimal"
                  defaultValue={line.minPackageQuantity == null ? "" : String(line.minPackageQuantity)}
                  onBlur={event => {
                    if (event.target.value !== (line.minPackageQuantity == null ? "" : String(line.minPackageQuantity))) {
                      void submitMinimum(line.supplierMappingId, event.target.value);
                    }
                  }}
                  aria-label={`Najmanjša količina pakiranj ${line.articleName}`}
                  className="ml-auto h-8 w-20 border-[#dcd4c6] text-right"
                  placeholder="—"
                />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function SupplierSplitPanel({ onNotice }: { onNotice: (text: string, error?: boolean) => void }) {
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [strategy, setStrategy] = useState<Strategy>("cheapest");
  const params = { strategy };
  const { data, isLoading, isError, refetch } = useGetSupplierOrderSplit(params, {
    query: { queryKey: getGetSupplierOrderSplitQueryKey(params), enabled: open },
  });
  const onChanged = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: getGetSupplierOrderSplitQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetSupplierOrderDashboardQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getListSupplierOrdersQueryKey() }),
    ]);
  };

  return (
    <section className="mt-4 overflow-hidden rounded-2xl border border-[#ded6c7] bg-[#fffefa]" data-testid="supplier-split-panel">
      <button
        type="button"
        onClick={() => setOpen(value => !value)}
        aria-expanded={open}
        className="flex w-full items-center justify-between px-4 py-3 text-left text-sm font-semibold text-[#243d35] sm:px-5"
      >
        Predlog razdelitve po dobaviteljih
        <span className="text-xs font-normal text-[#68756e]">{open ? "Skrij" : "Prikaži"}</span>
      </button>
      {open && (
        <div className="space-y-3 border-t border-[#eee8dc] px-4 py-4 sm:px-5">
          <div className="flex flex-wrap items-center gap-3 text-xs text-[#5f7068]">
            <label className="font-semibold">Način razdelitve
              <select
                value={strategy}
                onChange={event => setStrategy(event.target.value as Strategy)}
                className="ml-2 h-9 rounded-lg border border-[#dcd4c6] bg-white px-3 text-sm font-normal text-[#344b43]"
              >
                <option value="cheapest">Najnižja cena na enoto</option>
                <option value="fewest_suppliers">Čim manj dobaviteljev</option>
              </select>
            </label>
            <span>Cene so zadnje potrjene cene; osnutek ne spremeni zaloge.</span>
          </div>
          {isLoading && <p className="text-sm text-[#68756e]">Pripravljam predlog…</p>}
          {isError && (
            <p role="alert" className="text-sm text-rose-800">
              Predloga ni bilo mogoče naložiti. <button type="button" className="underline" onClick={() => void refetch()}>Poskusi znova</button>
            </p>
          )}
          {data && data.groups.length === 0 && data.unassigned.length === 0 && (
            <p className="text-sm text-[#68756e]">Trenutno ni artiklov, ki bi jih bilo treba naročiti.</p>
          )}
          {data?.groups.map(group => (
            <GroupCard key={`${strategy}-${group.supplierId}`} group={group} onChanged={onChanged} onNotice={onNotice} />
          ))}
          {data && data.unassigned.length > 0 && (
            <div className="rounded-lg border border-[#e3c9c2] bg-rose-50 px-3 py-2 text-xs text-rose-900">
              <div className="font-semibold">Artikli brez predloga:</div>
              <ul className="mt-1 list-disc pl-4">
                {data.unassigned.map(item => (
                  <li key={item.articleId}>
                    {item.articleName} — {item.reason === "no_supplier" ? "ni aktivne dobaviteljske povezave" : "ni znane cene pri nobenem dobavitelju"}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
