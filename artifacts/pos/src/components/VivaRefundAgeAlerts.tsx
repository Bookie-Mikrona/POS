import { useState } from "react";
import { Link } from "wouter";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetVivaRefundAlertOverview, getGetVivaRefundAlertOverviewQueryKey,
  useUpdateVivaRefundAlertSettings, getListUnknownVivaRefundsQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";

function useRefundAlerts() {
  const { user } = useAuth();
  const enabled = ["admin", "admin_enote", "superadmin"].includes(user?.vloga ?? "") && !!user?.enotaId;
  const query = useGetVivaRefundAlertOverview({
    query: {
      queryKey: [...getGetVivaRefundAlertOverviewQueryKey(), user?.id, user?.companyId, user?.enotaId],
      enabled, refetchInterval: 60_000, staleTime: 0, retry: false,
    },
  });
  return { ...query, enabled };
}

export function VivaRefundAgeAlertBanner() {
  const { data, isError, enabled } = useRefundAlerts();
  if (!enabled) return null;
  if (isError) return <div role="status" className="border-b bg-amber-50 px-4 py-2 text-xs text-amber-900">Opozoril nejasnih vračil ni mogoče osvežiti. Preverite arhiv računov.</div>;
  if (!data?.alerts.length) return null;
  const critical = new Set(data.alerts.filter(a => a.threshold === "critical").map(a => a.refundId)).size;
  const count = new Set(data.alerts.map(a => a.refundId)).size;
  return (
    <div role="alert" data-testid="viva-refund-age-banner" className={`border-b px-4 py-3 text-sm ${critical ? "border-red-300 bg-red-50 text-red-950" : "border-amber-300 bg-amber-50 text-amber-950"}`}>
      <strong>Nejasna terminalska vračila: {count} zapadlih, od tega {critical} kritičnih.</strong>{" "}
      Odgovorna oseba naj preveri izid na terminalu ali izpisku.{" "}
      <Link href="/racuni" className="font-semibold underline">Odpri arhiv računov</Link>
    </div>
  );
}

export function VivaRefundAlertSettingsPanel() {
  const { user } = useAuth();
  const query = useRefundAlerts();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const mutation = useUpdateVivaRefundAlertSettings();
  const [draft, setDraft] = useState<{ overdueHours: string; criticalHours: string } | null>(null);
  const canEdit = ["admin", "superadmin"].includes(user?.vloga ?? "");
  if (!["admin", "admin_enote", "superadmin"].includes(user?.vloga ?? "")) return null;
  if (query.isError) return <p role="alert" className="text-sm text-red-700">Pragov za nejasna vračila ni mogoče naložiti.</p>;
  if (!query.data) return null;
  const settings = query.data.settings;
  const value = draft ?? { overdueHours: String(settings.overdueHours), criticalHours: String(settings.criticalHours) };
  const overdueHours = Number(value.overdueHours);
  const criticalHours = Number(value.criticalHours);
  const valid = Number.isInteger(overdueHours) && overdueHours >= 1 && Number.isInteger(criticalHours) && criticalHours > overdueHours && criticalHours <= 8760;
  return (
    <details className="rounded-lg border p-3 text-sm">
      <summary className="cursor-pointer font-medium">Opozorila nejasnih vračil · zapadlo po {settings.overdueHours} h · kritično po {settings.criticalHours} h</summary>
      <p className="my-2 text-xs text-muted-foreground">Velja za vse enote podjetja. Starost se šteje od začetka vračila. Pregled se izvede vsakih 5 minut; administratorji prejmejo opozorilo v POS-u. Vsak prag sproži le eno opozorilo na vračilo. Sprememba pragov ne izbriše že sproženih opozoril.</p>
      {canEdit && <form className="flex flex-wrap items-end gap-3" onSubmit={e => {
        e.preventDefault();
        if (!valid) return;
        mutation.mutate({ data: { overdueHours, criticalHours } }, {
          onSuccess: async () => {
            setDraft(null);
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: getGetVivaRefundAlertOverviewQueryKey() }),
              queryClient.invalidateQueries({ queryKey: getListUnknownVivaRefundsQueryKey() }),
            ]);
            toast({ title: "Pragova opozoril sta shranjena" });
          },
          onError: () => toast({ title: "Pragov ni bilo mogoče shraniti", variant: "destructive" }),
        });
      }}>
        <div><Label htmlFor="refund-overdue-hours">Zapadlo po (h)</Label><Input id="refund-overdue-hours" type="number" min={1} max={8759} step={1} value={value.overdueHours} onChange={e => setDraft({ ...value, overdueHours: e.target.value })} disabled={mutation.isPending} /></div>
        <div><Label htmlFor="refund-critical-hours">Kritično po (h)</Label><Input id="refund-critical-hours" type="number" min={overdueHours + 1} max={8760} step={1} value={value.criticalHours} onChange={e => setDraft({ ...value, criticalHours: e.target.value })} disabled={mutation.isPending} /></div>
        <Button type="submit" disabled={!valid || mutation.isPending}>{mutation.isPending ? "Shranjevanje…" : "Shrani pragova podjetja"}</Button>
        {!valid && <p role="alert" className="text-xs text-red-700">Vnesite celi uri od 1 do 8760; kritični prag mora biti poznejši.</p>}
      </form>}
    </details>
  );
}
