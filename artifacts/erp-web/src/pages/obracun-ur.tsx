import { Fragment, useMemo, useState } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  ShieldAlert,
  UsersRound,
} from "lucide-react";
import {
  type ObracunUrSkupina,
  type ObracunUrVrstica,
  getGetObracunUrQueryKey,
  useGetObracunUr,
} from "@workspace/api-client-react";
import { useCompany } from "@/contexts/CompanyContext";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

const HOUR_FORMATTER = new Intl.NumberFormat("sl-SI", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function currentMonth(): { od: string; do: string } {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Ljubljana" }).format(new Date());
  const [year, month] = today.split("-").map(Number);
  return {
    od: `${year}-${String(month).padStart(2, "0")}-01`,
    do: `${year}-${String(month).padStart(2, "0")}-${String(new Date(Date.UTC(year, month, 0)).getUTCDate()).padStart(2, "0")}`,
  };
}

function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("sl-SI", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "UTC",
  }).format(new Date(value));
}

function formatHours(value: number): string {
  return `${HOUR_FORMATTER.format(value)} h`;
}

function groupKey(group: ObracunUrSkupina): string {
  return `${group.natakariId}|${group.enotaId}|${JSON.stringify([group.costCenterId, group.smKoda, group.smNaziv])}`;
}

function smSnapshotKey(item: Pick<ObracunUrSkupina, "costCenterId" | "smKoda" | "smNaziv">): string {
  return JSON.stringify([item.costCenterId, item.smKoda, item.smNaziv]);
}

function smLabel(item: Pick<ObracunUrSkupina, "costCenterId" | "smKoda" | "smNaziv">): string {
  if (!item.costCenterId) return "Brez SM";
  return item.smKoda ? `${item.smKoda} — ${item.smNaziv}` : item.smNaziv;
}

function csvValue(value: string | number): string {
  return `"${String(value).replaceAll("\"", "\"\"")}"`;
}

export default function ObracunUrPage() {
  const { activeCompany } = useCompany();
  const role = activeCompany?.role ?? "";
  const allowed = role === "owner" || role === "accountant";
  const initialPeriod = currentMonth();
  const [od, setOd] = useState(initialPeriod.od);
  const [doDatum, setDoDatum] = useState(initialPeriod.do);
  const [enotaId, setEnotaId] = useState("vse");
  const [natakariId, setNatakariId] = useState("vse");
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  const datesValid = Boolean(od && doDatum && od <= doDatum);
  const params = {
    od,
    do: doDatum,
    ...(enotaId !== "vse" ? { enotaId: Number(enotaId) } : {}),
    ...(natakariId !== "vse" ? { natakariId: Number(natakariId) } : {}),
  };
  const { data, isLoading, error, refetch } = useGetObracunUr(params, {
    query: {
      enabled: Boolean(activeCompany?.id) && allowed && datesValid,
      queryKey: getGetObracunUrQueryKey(params),
    },
    request: {
      headers: {
        "X-Company-Id": activeCompany?.id ?? "",
      },
    },
  });

  const enote = useMemo(
    () => [...new Map((data?.vrstice ?? []).map((row) => [row.enotaId, { id: row.enotaId, ime: row.enota }])).values()],
    [data?.vrstice],
  );
  const natakarji = useMemo(
    () => [...new Map((data?.vrstice ?? []).map((row) => [row.natakariId, { id: row.natakariId, ime: row.natakar }])).values()],
    [data?.vrstice],
  );
  const vrsticePoSkupini = useMemo(() => {
    const map = new Map<string, ObracunUrVrstica[]>();
    for (const vrstica of data?.vrstice ?? []) {
      const key = `${vrstica.natakariId}|${vrstica.enotaId}|${smSnapshotKey(vrstica)}`;
      map.set(key, [...(map.get(key) ?? []), vrstica]);
    }
    return map;
  }, [data?.vrstice]);

  const toggleExpanded = (key: string) => {
    setExpanded((previous) => {
      const next = new Set(previous);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const exportCsv = () => {
    if (!data) return;
    const lines = [
      ["OBRAČUN UR", `${formatDate(od)} – ${formatDate(doDatum)}`],
      [],
      ["Datum", "Natakar", "Enota", "Stroškovno mesto", "Začetek", "Konec", "Ure"],
      ...data.vrstice.map((row) => [
        formatDate(row.datum),
        row.natakar,
        row.enota,
        smLabel(row),
        formatTime(row.zacetek),
        formatTime(row.konec),
        HOUR_FORMATTER.format(row.ureTrajanja),
      ]),
      [],
      ["SKUPAJ", "", "", "", "", "", HOUR_FORMATTER.format(data.skupajUr)],
    ];
    const csv = `\uFEFF${lines.map((line) => line.map(csvValue).join(";")).join("\r\n")}`;
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `obracun-ur_${od}_${doDatum}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  if (!activeCompany?.id) {
    return (
      <div className="p-6">
        <Alert><AlertTitle>Ni izbranega podjetja</AlertTitle><AlertDescription>Izberite podjetje za pregled obračuna ur.</AlertDescription></Alert>
      </div>
    );
  }

  if (!allowed) {
    return (
      <div className="p-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" /> Dostop ni dovoljen</CardTitle>
            <CardDescription>Pregled obračuna ur je dostopen računovodji ali lastniku podjetja.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <UsersRound className="h-6 w-6 text-primary" /> Obračun ur
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Zaprte POS izmene po natakarju, enoti in stroškovnem mestu ob odprtju izmene.
          </p>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!data?.vrstice.length}>
          <Download className="h-4 w-4 mr-2" /> Izvozi CSV
        </Button>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            <div className="space-y-1.5">
              <Label htmlFor="erp-obracun-od">Od</Label>
              <Input id="erp-obracun-od" type="date" value={od} onChange={(event) => setOd(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="erp-obracun-do">Do</Label>
              <Input id="erp-obracun-do" type="date" value={doDatum} onChange={(event) => setDoDatum(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Enota</Label>
              <Select value={enotaId} onValueChange={setEnotaId}>
                <SelectTrigger><SelectValue placeholder="Vse enote" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vse">Vse enote</SelectItem>
                  {enote.map((enota) => <SelectItem key={enota.id} value={String(enota.id)}>{enota.ime}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Natakar</Label>
              <Select value={natakariId} onValueChange={setNatakariId}>
                <SelectTrigger><SelectValue placeholder="Vsi natakarji" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vse">Vsi natakarji</SelectItem>
                  {natakarji.map((natakar) => <SelectItem key={natakar.id} value={String(natakar.id)}>{natakar.ime}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <div className="flex items-end">
              <Button className="w-full" onClick={() => refetch()} disabled={!datesValid || isLoading}>
                {isLoading && <Loader2 className="h-4 w-4 mr-2 animate-spin" />} Prikaži
              </Button>
            </div>
          </div>
          {!datesValid && <p className="text-sm text-destructive mt-3">Datum »od« ne sme biti za datumom »do«.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="text-lg">Pregled</CardTitle>
          <CardDescription>{data ? `${formatDate(od)} – ${formatDate(doDatum)} · skupaj ${formatHours(data.skupajUr)}` : "Izberite obdobje za pregled."}</CardDescription>
        </CardHeader>
        <CardContent className="p-0">
          {isLoading ? (
            <div className="p-8 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>
          ) : error ? (
            <p className="p-6 text-sm text-destructive">Obračuna ur ni mogoče naložiti. Poskusite znova.</p>
          ) : !data?.skupine.length ? (
            <p className="p-6 text-sm text-muted-foreground">V izbranem obdobju ni zaprtih izmen.</p>
          ) : (
            <Table>
              <TableHeader><TableRow><TableHead>Natakar</TableHead><TableHead>Enota</TableHead><TableHead>Stroškovno mesto</TableHead><TableHead className="text-right">Št. izmen</TableHead><TableHead className="text-right">Ure skupaj</TableHead><TableHead className="w-10"><span className="sr-only">Podrobnosti</span></TableHead></TableRow></TableHeader>
              <TableBody>
                {data.skupine.map((group) => {
                  const key = groupKey(group);
                  const isExpanded = expanded.has(key);
                  return (
                    <Fragment key={key}>
                      <TableRow>
                        <TableCell className="font-medium">{group.natakar}</TableCell><TableCell>{group.enota}</TableCell><TableCell>{smLabel(group)}</TableCell>
                        <TableCell className="text-right tabular-nums">{group.steviloIzmen}</TableCell><TableCell className="text-right tabular-nums font-semibold">{formatHours(group.skupajUr)}</TableCell>
                        <TableCell><Button type="button" variant="ghost" size="icon" className="h-8 w-8" onClick={() => toggleExpanded(key)} aria-label={isExpanded ? "Skrij posamezne izmene" : "Pokaži posamezne izmene"}>{isExpanded ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}</Button></TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow className="hover:bg-transparent"><TableCell colSpan={6} className="bg-muted/30 px-4 py-3"><div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
                          {(vrsticePoSkupini.get(key) ?? []).map((row) => <div key={row.izmenaId} className="rounded-md border bg-background px-3 py-2 text-sm"><div className="font-medium">{formatDate(row.datum)}</div><div className="text-muted-foreground">{formatTime(row.zacetek)}–{formatTime(row.konec)} · {formatHours(row.ureTrajanja)}</div></div>)}
                        </div></TableCell></TableRow>
                      )}
                    </Fragment>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {data && data.poSM.length > 0 && (
        <Card>
          <CardHeader className="pb-3"><CardTitle className="text-lg">Povzetek po stroškovnih mestih</CardTitle></CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {[...data.poSM].sort((a, b) => b.ur - a.ur).map((sm) => (
              <div key={smSnapshotKey(sm)} className="rounded-lg border p-4">
                <p className="font-medium">{smLabel(sm)}</p><p className="mt-1 text-2xl font-bold tabular-nums">{formatHours(sm.ur)}</p><p className="text-xs text-muted-foreground">{sm.steviloIzmen} {sm.steviloIzmen === 1 ? "izmena" : "izmen"}</p>
              </div>
            ))}
          </CardContent>
        </Card>
      )}
    </div>
  );
}