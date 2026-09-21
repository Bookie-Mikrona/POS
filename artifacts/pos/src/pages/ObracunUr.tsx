import { Fragment, useMemo, useState, useEffect } from "react";
import {
  ChevronDown,
  ChevronRight,
  Download,
  Loader2,
  ShieldAlert,
  UsersRound,
  CheckCircle,
  XCircle,
  Edit2,
  History,
  Coffee,
  CalendarDays,
  Plus, Clock
} from "lucide-react";
import {
  getGetObracunUrQueryKey,
  getListEnoteQueryKey,
  getListNatakariQueryKey,
  useListEnote,
  useListNatakari,
  useListKadrovskiPregled,
  useListIzmenaAudit,
  useListOdmori,
  usePotrdiIzmeno,
  usePopraviIzmeno,
  useListOdsotnosti,
  useCreateOdsotnost,
  usePotrdiOdsotnost,
  getListKadrovskiPregledQueryKey,
  getListIzmenaAuditQueryKey,
  getListOdmoriQueryKey,
  getListOdsotnostiQueryKey,
  type KadrovskaVrstica,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { useForm, Controller } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod";

const HOUR_FORMATTER = new Intl.NumberFormat("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const EUR_FORMATTER = new Intl.NumberFormat("sl-SI", { style: "currency", currency: "EUR" });

function currentMonth(): { od: string; do: string } {
  const today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Ljubljana" }).format(new Date());
  const [year, month] = today.split("-").map(Number);
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    od: `${year}-${String(month).padStart(2, "0")}-01`,
    do: `${year}-${String(month).padStart(2, "0")}-${String(daysInMonth).padStart(2, "0")}`,
  };
}

function formatDate(value: string): string {
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}.${month}.${year}` : value;
}

function formatTime(value: string): string {
  return new Intl.DateTimeFormat("sl-SI", { hour: "2-digit", minute: "2-digit", hour12: false }).format(new Date(value));
}

function formatDateTime(value: string): string {
  return new Intl.DateTimeFormat("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(value));
}

function formatHours(value: number): string {
  return `${HOUR_FORMATTER.format(value)} h`;
}

function toDatetimeLocal(isoString: string | null) {
  if (!isoString) return "";
  const d = new Date(isoString);
  const pad = (n: number) => n.toString().padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

const statusColor = (status: string) => {
  switch(status) {
    case 'potrjeno': return 'bg-green-100 text-green-800 border-green-200';
    case 'zavrnjeno': return 'bg-red-100 text-red-800 border-red-200';
    case 'v_potrditvi': return 'bg-yellow-100 text-yellow-800 border-yellow-200';
    case 'osnutek': return 'bg-slate-100 text-slate-800 border-slate-200';
    default: return 'bg-muted text-muted-foreground';
  }
};

const odsotnostTipLabel = (tip: string) => {
  switch(tip) {
    case 'dopust': return 'Dopust';
    case 'bolniska': return 'Bolniška';
    case 'druga_odsotnost': return 'Druga odsotnost';
    default: return tip;
  }
}

// ─── Dialogs ─────────────────────────────────────────────────────────────

function ZavrniIzmenoDialog({ vrstica, open, onOpenChange }: { vrstica: KadrovskaVrstica | null, open: boolean, onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const potrdi = usePotrdiIzmeno();
  const [razlog, setRazlog] = useState("");

  const handleSave = () => {
    if (!vrstica) return;
    if (razlog.length < 3) {
      toast({ title: "Razlog mora biti dolg vsaj 3 znake", variant: "destructive" });
      return;
    }
    potrdi.mutate({ id: vrstica.izmenaId, data: { status: 'zavrnjeno', razlog } }, {
      onSuccess: () => {
        toast({ title: "Izmena zavrnjena" });
        queryClient.invalidateQueries({ queryKey: getListKadrovskiPregledQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListIzmenaAuditQueryKey(vrstica.izmenaId) });
        onOpenChange(false);
      },
      onError: () => toast({ title: "Napaka", variant: "destructive" })
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Zavrni izmeno</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-4">
          <p className="text-sm text-muted-foreground">Vnesite razlog za zavrnitev izmene. Razlog bo zabeležen v revizijski sledi.</p>
          <div className="space-y-2">
            <Label>Razlog zavrnitve</Label>
            <Input value={razlog} onChange={(e) => setRazlog(e.target.value)} placeholder="Npr. ure ne ustrezajo..." />
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
          <Button variant="destructive" onClick={handleSave} disabled={potrdi.isPending}>Zavrni izmeno</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const popraviSchema = z.object({
  zacetek: z.string().min(1, "Začetek je obvezen"),
  konec: z.string().min(1, "Konec je obvezen"),
  razlog: z.string().min(3, "Razlog mora biti dolg vsaj 3 znake"),
});

function PopraviIzmenoDialog({ vrstica, open, onOpenChange }: { vrstica: KadrovskaVrstica | null, open: boolean, onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const popravi = usePopraviIzmeno();

  const form = useForm<z.infer<typeof popraviSchema>>({
    resolver: zodResolver(popraviSchema),
    defaultValues: { zacetek: "", konec: "", razlog: "" },
  });

  useEffect(() => {
    if (vrstica && open) {
      form.reset({
        zacetek: toDatetimeLocal(vrstica.zacetek),
        konec: toDatetimeLocal(vrstica.konec),
        razlog: "",
      });
    }
  }, [vrstica, open, form]);

  const onSubmit = (values: z.infer<typeof popraviSchema>) => {
    if (!vrstica) return;
    const data = {
      zacetek: new Date(values.zacetek).toISOString(),
      konec: new Date(values.konec).toISOString(),
      razlog: values.razlog,
    };
    popravi.mutate({ id: vrstica.izmenaId, data }, {
      onSuccess: () => {
        toast({ title: "Izmena popravljena" });
        queryClient.invalidateQueries({ queryKey: getListKadrovskiPregledQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListIzmenaAuditQueryKey(vrstica.izmenaId) });
        onOpenChange(false);
      },
      onError: (err: any) => toast({ title: "Napaka", description: err.message, variant: "destructive" })
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Popravi izmeno</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Začetek</Label>
              <Input type="datetime-local" {...form.register("zacetek")} />
              {form.formState.errors.zacetek && <p className="text-xs text-destructive">{form.formState.errors.zacetek.message}</p>}
            </div>
            <div className="space-y-2">
              <Label>Konec</Label>
              <Input type="datetime-local" {...form.register("konec")} />
              {form.formState.errors.konec && <p className="text-xs text-destructive">{form.formState.errors.konec.message}</p>}
            </div>
          </div>
          <div className="space-y-2">
            <Label>Razlog popravka</Label>
            <Input {...form.register("razlog")} placeholder="Obvezno pojasnilo spremembe..." />
            {form.formState.errors.razlog && <p className="text-xs text-destructive">{form.formState.errors.razlog.message}</p>}
          </div>
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
            <Button type="submit" disabled={popravi.isPending}>Shrani popravek</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ─── Odsotnosti ──────────────────────────────────────────────────────────

const odsotnostSchema = z.object({
  natakariId: z.coerce.number().min(1, "Izberite natakarja"),
  od: z.string().min(1, "Začetek je obvezen"),
  do: z.string().min(1, "Konec je obvezen"),
  tip: z.enum(["dopust", "bolniska", "druga_odsotnost"]),
  opomba: z.string().optional(),
});

function OdsotnostDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (o: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createOdsotnost = useCreateOdsotnost();
  const { data: natakarji } = useListNatakari();

  const form = useForm<z.infer<typeof odsotnostSchema>>({
    resolver: zodResolver(odsotnostSchema),
    defaultValues: { natakariId: 0, od: "", do: "", tip: "dopust", opomba: "" },
  });

  useEffect(() => {
    if (open) {
      form.reset({ natakariId: 0, od: "", do: "", tip: "dopust", opomba: "" });
    }
  }, [open, form]);

  const onSubmit = (values: z.infer<typeof odsotnostSchema>) => {
    createOdsotnost.mutate({ data: values }, {
      onSuccess: () => {
        toast({ title: "Odsotnost vnesena" });
        queryClient.invalidateQueries({ queryKey: getListOdsotnostiQueryKey() });
        onOpenChange(false);
      },
      onError: (err: any) => toast({ title: "Napaka", description: err.message, variant: "destructive" })
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nov vnos odsotnosti</DialogTitle>
        </DialogHeader>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4 py-4">
          <div className="space-y-2">
            <Label>Natakar</Label>
            <Controller
              control={form.control}
              name="natakariId"
              render={({ field }) => (
                <Select value={String(field.value)} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue placeholder="Izberi natakarja" />
                  </SelectTrigger>
                  <SelectContent>
                    {natakarji?.map(n => (
                      <SelectItem key={n.id} value={String(n.id)}>{n.ime} {n.priimek}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Od</Label>
              <Input type="date" {...form.register("od")} />
            </div>
            <div className="space-y-2">
              <Label>Do</Label>
              <Input type="date" {...form.register("do")} />
            </div>
          </div>
          <div className="space-y-2">
            <Label>Tip odsotnosti</Label>
            <Controller
              control={form.control}
              name="tip"
              render={({ field }) => (
                <Select value={field.value} onValueChange={field.onChange}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="dopust">Dopust</SelectItem>
                    <SelectItem value="bolniska">Bolniška</SelectItem>
                    <SelectItem value="druga_odsotnost">Druga odsotnost</SelectItem>
                  </SelectContent>
                </Select>
              )}
            />
          </div>
          <div className="space-y-2">
            <Label>Opomba</Label>
            <Input {...form.register("opomba")} />
          </div>
          <DialogFooter className="pt-4">
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
            <Button type="submit" disabled={createOdsotnost.isPending}>Shrani</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function OdsotnostiTab({ od, doDatum, natakariId }: { od: string, doDatum: string, natakariId: string }) {
  const { data, isLoading } = useListOdsotnosti({ od, do: doDatum }, { query: { queryKey: getListOdsotnostiQueryKey({ od, do: doDatum }) } });
  const [dialogOpen, setDialogOpen] = useState(false);
  const potrdiOdsotnost = usePotrdiOdsotnost();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const filteredData = useMemo(() => {
    if (!data) return [];
    if (natakariId === "vse") return data;
    return data.filter(d => d.natakariId === Number(natakariId));
  }, [data, natakariId]);

  const handleAction = (id: string, status: "potrjeno" | "zavrnjeno") => {
    potrdiOdsotnost.mutate({ id, data: { status, razlog: status === 'zavrnjeno' ? "Zavrnjeno s strani administratorja" : undefined } }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListOdsotnostiQueryKey() });
        toast({ title: `Odsotnost ${status}` });
      }
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button onClick={() => setDialogOpen(true)} className="gap-2"><Plus className="h-4 w-4" /> Nov vnos</Button>
      </div>
      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Natakar</TableHead>
                <TableHead>Obdobje</TableHead>
                <TableHead>Tip</TableHead>
                <TableHead>Opomba</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Akcije</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
              ) : filteredData.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="text-center py-8 text-muted-foreground">Ni odsotnosti v izbranem obdobju.</TableCell></TableRow>
              ) : (
                filteredData.map(odsotnost => (
                  <TableRow key={odsotnost.id}>
                    <TableCell className="font-medium">{odsotnost.natakar}</TableCell>
                    <TableCell>{formatDate(odsotnost.od)} – {formatDate(odsotnost.do)}</TableCell>
                    <TableCell>{odsotnostTipLabel(odsotnost.tip)}</TableCell>
                    <TableCell className="text-muted-foreground">{odsotnost.opomba || "—"}</TableCell>
                    <TableCell><Badge variant="outline" className={statusColor(odsotnost.status)}>{odsotnost.status}</Badge></TableCell>
                    <TableCell className="text-right">
                      {odsotnost.status === 'osnutek' && (
                        <div className="flex justify-end gap-2">
                          <Button size="sm" variant="outline" className="text-green-600 border-green-200 hover:bg-green-50" onClick={() => handleAction(odsotnost.id, 'potrjeno')}>Potrdi</Button>
                          <Button size="sm" variant="outline" className="text-red-600 border-red-200 hover:bg-red-50" onClick={() => handleAction(odsotnost.id, 'zavrnjeno')}>Zavrni</Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
      <OdsotnostDialog open={dialogOpen} onOpenChange={setDialogOpen} />
    </div>
  );
}

// ─── Shift details (Audit & Breaks) ──────────────────────────────────────

function ShiftDetails({ izmenaId, zavrnitevRazlog }: { izmenaId: number; zavrnitevRazlog?: string | null }) {
  const { data: audit, isLoading: auditLoading } = useListIzmenaAudit(izmenaId, { query: { queryKey: getListIzmenaAuditQueryKey(izmenaId) } });
  const { data: odmori, isLoading: odmoriLoading } = useListOdmori(izmenaId, { query: { queryKey: getListOdmoriQueryKey(izmenaId) } });

  return (
    <div className="grid md:grid-cols-2 gap-6 pt-2 pb-4">
      <div className="space-y-3">
        <h4 className="font-semibold text-sm flex items-center gap-2 text-muted-foreground"><Coffee className="h-4 w-4" /> Odmori</h4>
        {odmoriLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : !odmori?.length ? (
          <p className="text-sm text-muted-foreground">Ni zabeleženih odmorov.</p>
        ) : (
          <div className="space-y-2">
            {odmori.map(o => (
              <div key={o.id} className="text-sm bg-background p-2.5 rounded-md border flex justify-between items-center shadow-sm">
                <div className="flex flex-col gap-0.5">
                  <div className="flex items-center gap-2">
                    <Badge variant="outline" className="text-[10px] uppercase tracking-wider">{o.vrsta}</Badge>
                  </div>
                  <span className="text-muted-foreground mt-1">
                    {formatTime(o.zacetek)} – {o.konec ? formatTime(o.konec) : "v teku"}
                  </span>
                  {o.opomba && <span className="text-xs text-muted-foreground italic">"{o.opomba}"</span>}
                </div>
                {o.trajanjeUr != null && <span className="font-semibold text-lg">{formatHours(o.trajanjeUr)}</span>}
              </div>
            ))}
          </div>
        )}
        {zavrnitevRazlog && (
          <div className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-800">
            <span className="font-semibold">Razlog zavrnitve:</span> {zavrnitevRazlog}
          </div>
        )}
      </div>

      <div className="space-y-3">
        <h4 className="font-semibold text-sm flex items-center gap-2 text-muted-foreground"><History className="h-4 w-4" /> Revizijska sled</h4>
        {auditLoading ? (
          <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
        ) : !audit?.length ? (
          <p className="text-sm text-muted-foreground">Ni zapisov.</p>
        ) : (
          <div className="space-y-4 border-l-2 border-muted/60 pl-4 ml-2">
            {audit.map(a => (
              <div key={a.id} className="text-sm relative bg-background p-3 rounded-md border shadow-sm">
                <div className="absolute w-3 h-3 bg-primary rounded-full -left-[23px] top-4 border-2 border-background" />
                <div className="flex justify-between items-start mb-1">
                  <p className="font-semibold">{a.dejanje}</p>
                  <p className="text-xs text-muted-foreground">{formatDateTime(a.createdAt)}</p>
                </div>
                {a.razlog && <p className="text-muted-foreground mt-1.5 text-xs italic bg-muted/50 p-2 rounded">"{a.razlog}"</p>}
                <p className="mt-2 text-[11px] text-muted-foreground">Izvedel: {a.actorId}</p>
                {(a.pred || a.po) && (
                  <div className="mt-2 grid gap-2 text-[11px]">
                    {a.pred && (
                      <div className="rounded bg-muted/50 p-2">
                        <span className="font-medium">Pred spremembo:</span>
                        <pre className="mt-1 whitespace-pre-wrap break-all">{JSON.stringify(a.pred, null, 2)}</pre>
                      </div>
                    )}
                    {a.po && (
                      <div className="rounded bg-muted/50 p-2">
                        <span className="font-medium">Po spremembi:</span>
                        <pre className="mt-1 whitespace-pre-wrap break-all">{JSON.stringify(a.po, null, 2)}</pre>
                      </div>
                    )}
                  </div>
                )}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Izmene Tab ─────────────────────────────────────────────────────

function KadrovskiPregledTab({
  od, doDatum, enotaId, natakariId
}: { od: string, doDatum: string, enotaId: string, natakariId: string }) {
  const params = {
    od,
    do: doDatum,
    ...(enotaId !== "vse" ? { enotaId: Number(enotaId) } : {}),
    ...(natakariId !== "vse" ? { natakariId: Number(natakariId) } : {}),
  };
  const { data, isLoading } = useListKadrovskiPregled(params, {
    query: { queryKey: getListKadrovskiPregledQueryKey(params) },
  });

  const [expanded, setExpanded] = useState<Set<number>>(new Set());
  const [zavrniIzmeno, setZavrniIzmeno] = useState<KadrovskaVrstica | null>(null);
  const [popraviIzmeno, setPopraviIzmeno] = useState<KadrovskaVrstica | null>(null);
  const queryClient = useQueryClient();
  const potrdi = usePotrdiIzmeno();
  const { toast } = useToast();

  const filteredData = useMemo(() => {
    if (!data) return [];
    return data.filter(d => {
      const matchEnota = enotaId === "vse" || d.enotaId === Number(enotaId);
      const matchNatakar = natakariId === "vse" || d.natakariId === Number(natakariId);
      return matchEnota && matchNatakar;
    });
  }, [data, enotaId, natakariId]);

  const toggleExpanded = (id: number) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handlePotrdi = (vrstica: KadrovskaVrstica) => {
    potrdi.mutate({ id: vrstica.izmenaId, data: { status: 'potrjeno' } }, {
      onSuccess: () => {
        toast({ title: "Izmena potrjena" });
        queryClient.invalidateQueries({ queryKey: getListKadrovskiPregledQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListIzmenaAuditQueryKey(vrstica.izmenaId) });
      },
      onError: () => toast({ title: "Napaka pri potrjevanju", variant: "destructive" })
    });
  };

  // Group summary
  const exportCsv = () => {
    if (filteredData.length === 0) return;
    const lines = [
      ["OBRACUN UR", `${formatDate(od)} - ${formatDate(doDatum)}`],
      [],
      ["Natakar", "Enota", "Zacetek", "Konec", "Efektivne Ure", "Nadure", "Odmori", "Bruto Ure", "Napitnine (Neto)", "Napitnine/uro"],
      ...filteredData.map(v => [
        v.natakar,
        v.enota,
        formatTime(v.zacetek),
        v.konec ? formatTime(v.konec) : "v teku",
        HOUR_FORMATTER.format(v.efektivneUr),
        HOUR_FORMATTER.format(v.nadure),
        HOUR_FORMATTER.format(v.placaniOdmoriUr + v.neplacaniOdmoriUr),
        HOUR_FORMATTER.format(v.brutoUr),
        EUR_FORMATTER.format(v.napitnineNeto),
        EUR_FORMATTER.format(v.napitninaNaEfektivnoUro)
      ]),
      [],
      ["SKUPAJ", "", "", "", HOUR_FORMATTER.format(summary.efektivne), HOUR_FORMATTER.format(summary.nadure), HOUR_FORMATTER.format(summary.odmori), HOUR_FORMATTER.format(summary.bruto), "", ""]
    ];

    const csv = `\uFEFF${lines.map(line => line.map(c => `"${String(c).replace(/"/g, '""')}"`).join(";")).join("\r\n")}`;
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `kadrovski-pregled_${od}_${doDatum}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const summary = useMemo(() => {
    let efektivne = 0, nadure = 0, odmori = 0, bruto = 0;
    filteredData.forEach(d => {
      efektivne += d.efektivneUr;
      nadure += d.nadure;
      odmori += d.placaniOdmoriUr + d.neplacaniOdmoriUr;
      bruto += d.brutoUr;
    });
    return { efektivne, nadure, odmori, bruto };
  }, [filteredData]);

  return (
    <div className="space-y-4">

      <div className="flex justify-end">
        <Button variant="outline" onClick={exportCsv} disabled={filteredData.length === 0}>
          <Download className="h-4 w-4 mr-2" /> Izvozi CSV
        </Button>
      </div>
      {filteredData.length > 0 && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Efektivne ure</p><p className="text-2xl font-bold">{formatHours(summary.efektivne)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Nadure</p><p className="text-2xl font-bold text-orange-600">{formatHours(summary.nadure)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Odmori (ure)</p><p className="text-2xl font-bold">{formatHours(summary.odmori)}</p></CardContent></Card>
          <Card><CardContent className="p-4"><p className="text-sm text-muted-foreground">Bruto prisotnost</p><p className="text-2xl font-bold">{formatHours(summary.bruto)}</p></CardContent></Card>
        </div>
      )}

      <Card>
        <CardContent className="p-0">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-10"></TableHead>
                <TableHead>Natakar</TableHead>
                <TableHead>Enota</TableHead>
                <TableHead>Izmena (čas)</TableHead>
                <TableHead className="text-right">Efektivno</TableHead>
                <TableHead className="text-right">Nadure</TableHead>
                <TableHead className="text-right">Napitnine</TableHead>
                <TableHead className="text-center">Status</TableHead>
                <TableHead className="text-right pr-4">Akcije</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8"><Loader2 className="h-5 w-5 animate-spin mx-auto text-muted-foreground" /></TableCell></TableRow>
              ) : filteredData.length === 0 ? (
                <TableRow><TableCell colSpan={9} className="text-center py-8 text-muted-foreground">V izbranem obdobju ni zabeleženih izmen.</TableCell></TableRow>
              ) : (
                filteredData.map(v => {
                  const isExp = expanded.has(v.izmenaId);
                  return (
                    <Fragment key={v.izmenaId}>
                      <TableRow className="hover:bg-muted/30">
                        <TableCell>
                           <Button
                             variant="ghost"
                             size="icon"
                             className="h-8 w-8"
                             onClick={() => toggleExpanded(v.izmenaId)}
                             aria-label={isExp ? "Skrij podrobnosti izmene" : "Prikaži podrobnosti izmene"}
                           >
                            {isExp ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                          </Button>
                        </TableCell>
                        <TableCell className="font-medium">{v.natakar}</TableCell>
                        <TableCell className="text-sm">{v.enota}</TableCell>
                        <TableCell className="text-sm">
                          <div>{formatDate(v.zacetek)}</div>
                          <div className="text-muted-foreground">{formatTime(v.zacetek)} – {v.konec ? formatTime(v.konec) : "v teku"}</div>
                        </TableCell>
                        <TableCell className="text-right font-semibold">{formatHours(v.efektivneUr)}</TableCell>
                        <TableCell className="text-right text-orange-600">{v.nadure > 0 ? formatHours(v.nadure) : "—"}</TableCell>
                        <TableCell className="text-right text-sm">
                          {v.napitnineNeto > 0 ? (
                            <>
                              <div className="font-medium text-emerald-600">{EUR_FORMATTER.format(v.napitnineNeto)}</div>
                              <div className="text-[10px] text-muted-foreground">{EUR_FORMATTER.format(v.napitninaNaEfektivnoUro)}/h</div>
                            </>
                          ) : "—"}
                        </TableCell>
                        <TableCell className="text-center">
                          <Badge variant="outline" className={statusColor(v.status)}>{v.status}</Badge>
                        </TableCell>
                        <TableCell className="text-right pr-4">
                          <div className="flex justify-end gap-1">
                            {v.status !== 'potrjeno' && v.konec && (
                              <>
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-green-600 hover:text-green-700 hover:bg-green-50" onClick={() => handlePotrdi(v)} title="Potrdi izmeno" disabled={potrdi.isPending}>
                                  <CheckCircle className="h-4 w-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-red-600 hover:text-red-700 hover:bg-red-50" onClick={() => setZavrniIzmeno(v)} title="Zavrni izmeno">
                                  <XCircle className="h-4 w-4" />
                                </Button>
                                <Button size="icon" variant="ghost" className="h-8 w-8 text-blue-600 hover:text-blue-700 hover:bg-blue-50" onClick={() => setPopraviIzmeno(v)} title="Popravi ure">
                                  <Edit2 className="h-4 w-4" />
                                </Button>
                              </>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                      {isExp && (
                        <TableRow className="bg-muted/10">
                          <TableCell colSpan={9} className="p-4 border-b">
                            <ShiftDetails izmenaId={v.izmenaId} zavrnitevRazlog={v.zavrnitevRazlog} />
                          </TableCell>
                        </TableRow>
                      )}
                    </Fragment>
                  )
                })
              )}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <ZavrniIzmenoDialog vrstica={zavrniIzmeno} open={!!zavrniIzmeno} onOpenChange={(o) => !o && setZavrniIzmeno(null)} />
      <PopraviIzmenoDialog vrstica={popraviIzmeno} open={!!popraviIzmeno} onOpenChange={(o) => !o && setPopraviIzmeno(null)} />
    </div>
  );
}

// ─── Main Page Component ─────────────────────────────────────────────────

export default function ObracunUrPage() {
  const { user } = useAuth();
  const allowed = user?.vloga === "admin" || user?.vloga === "admin_enote" || user?.vloga === "superadmin";
  const initialPeriod = currentMonth();

  const [od, setOd] = useState(initialPeriod.od);
  const [doDatum, setDoDatum] = useState(initialPeriod.do);
  const [enotaId, setEnotaId] = useState(user?.vloga === "admin_enote" && user.enotaId ? String(user.enotaId) : "vse");
  const [natakariId, setNatakariId] = useState("vse");

  const datesValid = Boolean(od && doDatum && od <= doDatum);

  const { data: enoteData } = useListEnote({ query: { enabled: allowed, queryKey: getListEnoteQueryKey() } });
  const { data: natakarjiData } = useListNatakari({ query: { enabled: allowed, queryKey: getListNatakariQueryKey() } });

  if (!allowed) {
    return (
      <div className="p-4 md:p-6 max-w-2xl">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><ShieldAlert className="h-5 w-5" /> Dostop ni dovoljen</CardTitle>
            <CardDescription>Pregled obračuna ur je dostopen samo POS administratorjem.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  return (
    <div className="p-4 md:p-6 space-y-5 max-w-7xl mx-auto">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
            <UsersRound className="h-6 w-6 text-primary" /> Kadrovski pregled
          </h1>
          <p className="text-sm text-muted-foreground mt-1">
            Ure, odmori, odsotnosti in napitnine osebja.
          </p>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            <div className="space-y-1.5">
              <Label htmlFor="obracun-od">Od</Label>
              <Input id="obracun-od" type="date" value={od} onChange={(event) => setOd(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="obracun-do">Do</Label>
              <Input id="obracun-do" type="date" value={doDatum} onChange={(event) => setDoDatum(event.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label>Enota</Label>
              <Select value={enotaId} onValueChange={setEnotaId} disabled={user?.vloga === "admin_enote"}>
                <SelectTrigger><SelectValue placeholder="Vse enote" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vse">Vse enote</SelectItem>
                  {(enoteData ?? []).map((enota) => (
                    <SelectItem key={enota.id} value={String(enota.id)}>{enota.ime}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Natakar</Label>
              <Select value={natakariId} onValueChange={setNatakariId}>
                <SelectTrigger><SelectValue placeholder="Vsi natakarji" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="vse">Vsi natakarji</SelectItem>
                  {(natakarjiData ?? []).map((natakar) => (
                    <SelectItem key={natakar.id} value={String(natakar.id)}>
                      {natakar.ime} {natakar.priimek}{natakar.aktiven ? "" : " (neaktiven)"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>
          {!datesValid && <p className="text-sm text-destructive mt-3">Datum »od« ne sme biti za datumom »do«.</p>}
        </CardContent>
      </Card>

      {datesValid && (
        <Tabs defaultValue="izmene">
          <TabsList className="mb-4">
            <TabsTrigger value="izmene" className="gap-2"><Clock className="h-4 w-4" /> Pregled izmen</TabsTrigger>
            <TabsTrigger value="odsotnosti" className="gap-2"><CalendarDays className="h-4 w-4" /> Odsotnosti</TabsTrigger>
          </TabsList>

          <TabsContent value="izmene" className="mt-0">
            <KadrovskiPregledTab od={od} doDatum={doDatum} enotaId={enotaId} natakariId={natakariId} />
          </TabsContent>

          <TabsContent value="odsotnosti" className="mt-0">
            <OdsotnostiTab od={od} doDatum={doDatum} natakariId={natakariId} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}
