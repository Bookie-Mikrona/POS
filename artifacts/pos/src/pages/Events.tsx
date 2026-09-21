import { useMemo, useState } from "react";
import {
  getListPosEventsQueryKey,
  useCreatePosEvent,
  useDeletePosEvent,
  useListEnote,
  useListPosEvents,
  useUpdatePosEvent,
  type PosEvent,
  type PosEventInput,
  customFetch,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Clock, History, MapPin, PackageOpen, Pencil, Plus, Trash2, Users } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";

const TYPE_LABELS = {
  festival: "Veselica / prireditev",
  wedding: "Poroka",
  catering: "Catering",
  celebration: "Drugo slavje",
  other: "Drug dogodek",
} as const;

const STATUS_LABELS = {
  planned: "Načrtovan",
  active: "Aktiven",
  closed: "Zaključen",
  cancelled: "Preklican",
} as const;

type FormState = {
  name: string;
  type: keyof typeof TYPE_LABELS;
  status: keyof typeof STATUS_LABELS;
  location: string;
  customerName: string;
  customerContact: string;
  startsAt: string;
  endsAt: string;
  notes: string;
  linkedUnitIds: number[];
};
type PreparationOptions = {
  articles: Array<{ id: number; name: string; categoryName: string | null; stock: string | null }>;
  users: Array<{ id: number; name: string }>;
  units: Array<{ id: number; name: string }>;
  transfers: Array<{ id: number; targetUnitId: number; direction: "outbound" | "return"; status: string }>;
};
type PreparationPreview = {
  canPrepare: boolean;
  alreadyPrepared: boolean;
  counts: { categories: number; articles: number; norms: number; modifierGroups: number; modifiers: number; modifierNorms: number; staff: number };
  stockLines: Array<{ articleId: number; name: string; quantity: number; available: number; unitCost: number; value: number }>;
  stockTotalQuantity: number;
  stockTotalValue: number;
  warnings: string[];
};
type TransferHistory = Array<{
  id: number;
  direction: "outbound" | "return";
  status: string;
  sourceUnitName: string;
  targetUnitName: string;
  createdByName: string;
  createdAt: string;
  completedAt: string | null;
  totalQuantity: number;
  totalValue: number;
  lines: Array<{ id: number; sourceName: string; quantity: number; unitCost: number; value: number; returnedQuantity?: number; plannedReturnQuantity?: number; remainingQuantity?: number; consumedQuantity?: number }>;
}>;

const toLocalInput = (value: string | Date) => {
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
};

const emptyForm = (): FormState => {
  const start = new Date();
  start.setMinutes(Math.ceil(start.getMinutes() / 15) * 15, 0, 0);
  const end = new Date(start.getTime() + 4 * 60 * 60_000);
  return {
    name: "",
    type: "festival",
    status: "planned",
    location: "",
    customerName: "",
    customerContact: "",
    startsAt: toLocalInput(start),
    endsAt: toLocalInput(end),
    notes: "",
    linkedUnitIds: [],
  };
};

function eventToForm(event: PosEvent): FormState {
  return {
    name: event.name,
    type: event.type,
    status: event.status,
    location: event.location,
    customerName: event.customerName ?? "",
    customerContact: event.customerContact ?? "",
    startsAt: toLocalInput(event.startsAt),
    endsAt: toLocalInput(event.endsAt),
    notes: event.notes ?? "",
    linkedUnitIds: event.linkedUnits.map(unit => unit.id),
  };
}

export default function Events() {
  const { user } = useAuth();
  const { data: events = [], isLoading } = useListPosEvents();
  const { data: units = [] } = useListEnote();
  const createEvent = useCreatePosEvent();
  const updateEvent = useUpdatePosEvent();
  const deleteEvent = useDeletePosEvent();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [editing, setEditing] = useState<PosEvent | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [preparing, setPreparing] = useState<PosEvent | null>(null);
  const [prep, setPrep] = useState<PreparationOptions | null>(null);
  const [targetUnitId, setTargetUnitId] = useState("");
  const [selectedArticles, setSelectedArticles] = useState<number[]>([]);
  const [selectedStaff, setSelectedStaff] = useState<number[]>([]);
  const [quantities, setQuantities] = useState<Record<number, number>>({});
  const [prepBusy, setPrepBusy] = useState(false);
  const [preview, setPreview] = useState<PreparationPreview | null>(null);
  const [historyEvent, setHistoryEvent] = useState<PosEvent | null>(null);
  const [history, setHistory] = useState<TransferHistory | null>(null);
  const canManage = ["admin", "admin_enote", "superadmin"].includes(user?.vloga ?? "");

  const sorted = useMemo(() =>
    [...events].sort((a, b) => new Date(a.startsAt).getTime() - new Date(b.startsAt).getTime()),
  [events]);

  const openCreate = () => {
    setEditing(null);
    setForm(emptyForm());
    setOpen(true);
  };

  const openEdit = (event: PosEvent) => {
    setEditing(event);
    setForm(eventToForm(event));
    setOpen(true);
  };

  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    const data: PosEventInput = {
      name: form.name.trim(),
      type: form.type,
      status: form.status,
      location: form.location.trim(),
      customerName: form.customerName.trim() || null,
      customerContact: form.customerContact.trim() || null,
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
      notes: form.notes.trim() || null,
      linkedUnitIds: form.linkedUnitIds,
    };
    try {
      if (editing) await updateEvent.mutateAsync({ id: editing.id, data });
      else await createEvent.mutateAsync({ data });
      await queryClient.invalidateQueries({ queryKey: getListPosEventsQueryKey() });
      setOpen(false);
      toast({ title: editing ? "Dogodek posodobljen" : "Dogodek ustvarjen" });
    } catch {
      toast({ title: "Dogodka ni bilo mogoče shraniti", variant: "destructive" });
    }
  };

  const remove = async (event: PosEvent) => {
    if (!window.confirm(`Izbrišem dogodek »${event.name}«?`)) return;
    try {
      await deleteEvent.mutateAsync({ id: event.id });
      await queryClient.invalidateQueries({ queryKey: getListPosEventsQueryKey() });
      toast({ title: "Dogodek izbrisan" });
    } catch {
      toast({ title: "Dogodka ni mogoče izbrisati", description: "Aktiven ali zaključen dogodek najprej prekličite.", variant: "destructive" });
    }
  };

  const openPreparation = async (event: PosEvent) => {
    try {
      const options = await customFetch<PreparationOptions>(`/api/pos-events/${event.id}/preparation-options`);
      setPreparing(event);
      setPrep(options);
      setTargetUnitId(options.units[0]?.id ? String(options.units[0].id) : "");
      setSelectedArticles([]);
      setSelectedStaff([]);
      setQuantities({});
      setPreview(null);
    } catch {
      toast({ title: "Podatkov za pripravo ni bilo mogoče naložiti", variant: "destructive" });
    }
  };

  const loadPreview = async () => {
    if (!preparing || !targetUnitId || selectedArticles.length === 0) return;
    setPrepBusy(true);
    try {
      setPreview(await customFetch<PreparationPreview>(`/api/pos-events/${preparing.id}/preparation-preview`, {
        method: "POST",
        body: JSON.stringify({ targetUnitId: Number(targetUnitId), articleIds: selectedArticles, staffUserIds: selectedStaff, quantities }),
      }));
    } catch (error) {
      toast({ title: "Predogleda ni bilo mogoče pripraviti", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setPrepBusy(false);
    }
  };

  const openHistory = async (event: PosEvent) => {
    try {
      setHistoryEvent(event);
      setHistory(null);
      setHistory(await customFetch<TransferHistory>(`/api/pos-events/${event.id}/transfer-history`));
    } catch {
      setHistoryEvent(null);
      toast({ title: "Zgodovine prenosov ni bilo mogoče naložiti", variant: "destructive" });
    }
  };

  const prepareUnit = async () => {
    if (!preparing || !targetUnitId || selectedArticles.length === 0) return;
    setPrepBusy(true);
    try {
      const result = await customFetch<{ reused?: boolean; copiedArticles?: number }>(`/api/pos-events/${preparing.id}/prepare`, {
        method: "POST",
        body: JSON.stringify({ targetUnitId: Number(targetUnitId), articleIds: selectedArticles, staffUserIds: selectedStaff, quantities }),
      });
      toast({
        title: result.reused ? "Enota je že pripravljena" : "Začasna enota je pripravljena",
        description: result.reused ? "Ponovni klik ni podvojil cenika, osebja ali zaloge." : `Prenesenih artiklov: ${result.copiedArticles ?? selectedArticles.length}.`,
      });
      setPreparing(null);
    } catch (error) {
      toast({ title: "Priprava enote ni uspela", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setPrepBusy(false);
    }
  };

  const confirmReturn = async (event: PosEvent, transferId: number) => {
    try {
      await customFetch(`/api/pos-events/${event.id}/returns/${transferId}/confirm`, { method: "POST" });
      toast({ title: "Neporabljena zaloga je vrnjena v matično enoto" });
      await openPreparation(event);
    } catch {
      toast({ title: "Povratni prenos ni uspel", variant: "destructive" });
    }
  };

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 md:p-6">
      <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-center">
        <div>
          <h1 className="text-2xl font-bold">Dogodki in slavja</h1>
          <p className="text-sm text-muted-foreground">Veselice, poroke, catering in začasna prodajna mesta.</p>
        </div>
        {canManage && <Button onClick={openCreate}><Plus className="mr-2 h-4 w-4" />Nov dogodek</Button>}
      </div>

      {isLoading ? (
        <p className="py-12 text-center text-muted-foreground">Nalagam dogodke…</p>
      ) : sorted.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-14 text-center">
            <CalendarDays className="h-10 w-10 text-muted-foreground" />
            <div>
              <p className="font-medium">Ni načrtovanih dogodkov</p>
              <p className="text-sm text-muted-foreground">Dodajte prvo veselico, poroko ali catering.</p>
            </div>
            {canManage && <Button variant="outline" onClick={openCreate}>Dodaj dogodek</Button>}
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {sorted.map(event => (
            <Card key={event.id}>
              <CardHeader className="pb-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <CardTitle className="text-lg">{event.name}</CardTitle>
                    <CardDescription>{TYPE_LABELS[event.type]}</CardDescription>
                  </div>
                  <Badge variant={event.status === "active" ? "default" : "outline"}>{STATUS_LABELS[event.status]}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <div className="flex gap-2"><Clock className="mt-0.5 h-4 w-4 text-muted-foreground" /><span>{new Date(event.startsAt).toLocaleString("sl-SI")} – {new Date(event.endsAt).toLocaleString("sl-SI")}</span></div>
                <div className="flex gap-2"><MapPin className="mt-0.5 h-4 w-4 text-muted-foreground" /><span>{event.location}</span></div>
                {(event.customerName || event.customerContact) && <div className="flex gap-2"><Users className="mt-0.5 h-4 w-4 text-muted-foreground" /><span>{[event.customerName, event.customerContact].filter(Boolean).join(" · ")}</span></div>}
                <div className="flex flex-wrap gap-1">
                  {event.linkedUnits.map(unit => <Badge key={unit.id} variant="secondary">{unit.ime}</Badge>)}
                </div>
                {canManage && <div className="flex justify-end gap-2 pt-2">
                   <Button variant="ghost" size="sm" onClick={() => openHistory(event)}><History className="mr-2 h-4 w-4" />Prenosi</Button>
                  {event.status !== "closed" && event.status !== "cancelled" && <Button variant="outline" size="sm" onClick={() => openPreparation(event)}><PackageOpen className="mr-2 h-4 w-4" />Pripravi enoto</Button>}
                  {event.status === "closed" && <Button variant="outline" size="sm" onClick={() => openPreparation(event)}><PackageOpen className="mr-2 h-4 w-4" />Vrni zalogo</Button>}
                  <Button variant="outline" size="sm" onClick={() => openEdit(event)}><Pencil className="mr-2 h-4 w-4" />Uredi</Button>
                  {["planned", "cancelled"].includes(event.status) && <Button variant="ghost" size="sm" onClick={() => remove(event)}><Trash2 className="h-4 w-4 text-destructive" /></Button>}
                </div>}
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{editing ? "Uredi dogodek" : "Nov dogodek"}</DialogTitle></DialogHeader>
          <form onSubmit={save} className="space-y-4">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2"><Label>Naziv</Label><Input required value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="npr. Gasilska veselica 2026" /></div>
              <div className="space-y-2"><Label>Vrsta</Label><Select value={form.type} onValueChange={value => setForm(f => ({ ...f, type: value as FormState["type"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(TYPE_LABELS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2"><Label>Začetek</Label><Input required type="datetime-local" value={form.startsAt} onChange={e => setForm(f => ({ ...f, startsAt: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Konec</Label><Input required type="datetime-local" value={form.endsAt} onChange={e => setForm(f => ({ ...f, endsAt: e.target.value }))} /></div>
              <div className="space-y-2 sm:col-span-2"><Label>Lokacija</Label><Input required value={form.location} onChange={e => setForm(f => ({ ...f, location: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Naročnik</Label><Input value={form.customerName} onChange={e => setForm(f => ({ ...f, customerName: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Kontakt</Label><Input value={form.customerContact} onChange={e => setForm(f => ({ ...f, customerContact: e.target.value }))} /></div>
              <div className="space-y-2"><Label>Status</Label><Select value={form.status} onValueChange={value => setForm(f => ({ ...f, status: value as FormState["status"] }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{Object.entries(STATUS_LABELS).map(([key, label]) => <SelectItem key={key} value={key}>{label}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2 sm:col-span-2"><Label>Opombe</Label><Textarea value={form.notes} onChange={e => setForm(f => ({ ...f, notes: e.target.value }))} /></div>
            </div>
            <div className="space-y-2 rounded-lg border p-3">
              <Label>Povezane poslovne enote</Label>
              <p className="text-xs text-muted-foreground">Dogodek bo viden tudi v izbranih začasnih ali mobilnih enotah.</p>
              <div className="grid gap-2 sm:grid-cols-2">
                {units.filter(unit => unit.id !== user?.enotaId).map(unit => (
                  <label key={unit.id} className="flex items-center gap-2 rounded-md border p-2 text-sm">
                    <Checkbox
                      checked={form.linkedUnitIds.includes(unit.id)}
                      onCheckedChange={checked => setForm(f => ({
                        ...f,
                        linkedUnitIds: checked ? [...new Set([...f.linkedUnitIds, unit.id])] : f.linkedUnitIds.filter(id => id !== unit.id),
                      }))}
                    />
                    <span>{unit.ime}{unit.isTemporary ? " · začasna" : ""}</span>
                  </label>
                ))}
              </div>
            </div>
            <Button className="w-full" type="submit" disabled={createEvent.isPending || updateEvent.isPending}>
              {editing ? "Shrani spremembe" : "Ustvari dogodek"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={!!preparing} onOpenChange={value => !value && setPreparing(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-2xl">
          <DialogHeader><DialogTitle>{preparing?.status === "closed" ? "Povratni prenos zaloge" : "Priprava začasne enote"}</DialogTitle></DialogHeader>
          {prep && preparing?.status === "closed" ? (
            <div className="space-y-3">
              <p className="text-sm text-muted-foreground">Ob zaključku je sistem pripravil sledljive osnutke za vračilo preostale zaloge.</p>
              {prep.transfers.filter(t => t.direction === "return").map(transfer => (
                <div key={transfer.id} className="flex items-center justify-between rounded-lg border p-3">
                  <span>Povratni prenos #{transfer.id} · {transfer.status === "completed" ? "zaključen" : "osnutek"}</span>
                  {transfer.status === "draft" && <Button size="sm" onClick={() => confirmReturn(preparing, transfer.id)}>Potrdi vračilo</Button>}
                </div>
              ))}
            </div>
          ) : prep ? (
            <div className="space-y-5">
              <div className="space-y-2"><Label>Začasna enota</Label><Select value={targetUnitId} onValueChange={value => { setTargetUnitId(value); setPreview(null); }}><SelectTrigger><SelectValue placeholder="Izberite enoto" /></SelectTrigger><SelectContent>{prep.units.map(unit => <SelectItem key={unit.id} value={String(unit.id)}>{unit.name}</SelectItem>)}</SelectContent></Select></div>
              <div className="space-y-2">
                <Label>Artikli in začetna zaloga</Label>
                <div className="max-h-64 space-y-2 overflow-y-auto rounded-lg border p-2">
                  {prep.articles.map(article => <div key={article.id} className="grid grid-cols-[auto_1fr_7rem] items-center gap-2 rounded p-2 hover:bg-muted/50">
                    <Checkbox checked={selectedArticles.includes(article.id)} onCheckedChange={checked => { setSelectedArticles(ids => checked ? [...ids, article.id] : ids.filter(id => id !== article.id)); setPreview(null); }} />
                    <div><p className="text-sm font-medium">{article.name}</p><p className="text-xs text-muted-foreground">{article.categoryName ?? "Brez kategorije"} · na zalogi {Number(article.stock ?? 0).toLocaleString("sl-SI")}</p></div>
                    <Input type="number" min={0} max={Number(article.stock ?? 0)} step="0.001" disabled={!selectedArticles.includes(article.id)} value={quantities[article.id] ?? 0} onChange={e => { setQuantities(q => ({ ...q, [article.id]: Number(e.target.value) })); setPreview(null); }} />
                  </div>)}
                </div>
              </div>
              <div className="space-y-2"><Label>Osebje z začasnim dostopom</Label><div className="grid gap-2 sm:grid-cols-2">{prep.users.map(person => <label key={person.id} className="flex items-center gap-2 rounded border p-2 text-sm"><Checkbox checked={selectedStaff.includes(person.id)} onCheckedChange={checked => { setSelectedStaff(ids => checked ? [...ids, person.id] : ids.filter(id => id !== person.id)); setPreview(null); }} />{person.name}</label>)}</div></div>
              {preview && <div className="space-y-3 rounded-lg border bg-muted/30 p-3 text-sm">
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                  <div><span className="text-muted-foreground">Kategorije</span><p className="font-semibold">{preview.counts.categories}</p></div>
                  <div><span className="text-muted-foreground">Artikli</span><p className="font-semibold">{preview.counts.articles}</p></div>
                  <div><span className="text-muted-foreground">Normativi</span><p className="font-semibold">{preview.counts.norms + preview.counts.modifierNorms}</p></div>
                  <div><span className="text-muted-foreground">Modifikatorji</span><p className="font-semibold">{preview.counts.modifierGroups} skupin · {preview.counts.modifiers}</p></div>
                  <div><span className="text-muted-foreground">Osebje</span><p className="font-semibold">{preview.counts.staff}</p></div>
                  <div className="col-span-2"><span className="text-muted-foreground">Začetna zaloga</span><p className="font-semibold">{preview.stockTotalQuantity.toLocaleString("sl-SI")} · {preview.stockTotalValue.toLocaleString("sl-SI", { style: "currency", currency: "EUR" })}</p></div>
                </div>
                {preview.warnings.length > 0 && <div className="rounded-md border border-destructive/40 bg-destructive/5 p-2 text-destructive">{preview.warnings.map(warning => <p key={warning}>• {warning}</p>)}</div>}
                {preview.alreadyPrepared && <p className="text-muted-foreground">Ta enota je za dogodek že pripravljena.</p>}
              </div>}
              {!preview ? (
                <Button className="w-full" disabled={prepBusy || !targetUnitId || !selectedArticles.length} onClick={loadPreview}>{prepBusy ? "Pripravljam predogled…" : "Prikaži predogled prenosa"}</Button>
              ) : (
                <Button className="w-full" disabled={prepBusy || !preview.canPrepare} onClick={prepareUnit}>{prepBusy ? "Pripravljam…" : "Potrdi pripravo in prenos zaloge"}</Button>
              )}
            </div>
          ) : null}
        </DialogContent>
      </Dialog>

      <Dialog open={!!historyEvent} onOpenChange={value => !value && setHistoryEvent(null)}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>Prenosi · {historyEvent?.name}</DialogTitle></DialogHeader>
          {!history ? <p className="py-8 text-center text-muted-foreground">Nalagam zgodovino…</p> : history.length === 0 ? (
            <p className="py-8 text-center text-muted-foreground">Za dogodek še ni prenosov.</p>
          ) : <div className="space-y-4">{history.map(transfer => (
            <Card key={transfer.id}>
              <CardHeader className="pb-2">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div><CardTitle className="text-base">{transfer.direction === "outbound" ? "Izhodni" : "Povratni"} dokument #{transfer.id}</CardTitle><CardDescription>{transfer.sourceUnitName} → {transfer.targetUnitName}</CardDescription></div>
                  <Badge variant={transfer.status === "completed" ? "default" : "outline"}>{transfer.status === "completed" ? "Zaključen" : transfer.status === "draft" ? "Osnutek" : "Preklican"}</Badge>
                </div>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                <p className="text-muted-foreground">{new Date(transfer.createdAt).toLocaleString("sl-SI")} · {transfer.createdByName}</p>
                <div className="overflow-x-auto"><table className="w-full min-w-[44rem] text-left"><thead><tr className="border-b text-muted-foreground"><th className="py-2">Artikel</th><th>Količina</th><th>Cena</th><th>Vrednost</th>{transfer.direction === "outbound" && <><th>Porabljeno</th><th>Preostalo</th><th>Vrnjeno</th></>}</tr></thead><tbody>{transfer.lines.map(line => <tr key={line.id} className="border-b last:border-0"><td className="py-2">{line.sourceName}</td><td>{line.quantity.toLocaleString("sl-SI")}</td><td>{line.unitCost.toLocaleString("sl-SI", { style: "currency", currency: "EUR" })}</td><td>{line.value.toLocaleString("sl-SI", { style: "currency", currency: "EUR" })}</td>{transfer.direction === "outbound" && <><td>{(line.consumedQuantity ?? 0).toLocaleString("sl-SI")}</td><td>{(line.remainingQuantity ?? 0).toLocaleString("sl-SI")}</td><td>{(line.returnedQuantity ?? 0).toLocaleString("sl-SI")}{(line.plannedReturnQuantity ?? 0) > 0 ? ` (${line.plannedReturnQuantity} osnutek)` : ""}</td></>}</tr>)}</tbody></table></div>
                <p className="text-right font-semibold">Skupaj: {transfer.totalQuantity.toLocaleString("sl-SI")} · {transfer.totalValue.toLocaleString("sl-SI", { style: "currency", currency: "EUR" })}</p>
              </CardContent>
            </Card>
          ))}</div>}
        </DialogContent>
      </Dialog>
    </div>
  );
}