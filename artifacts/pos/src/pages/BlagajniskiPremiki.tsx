import { useCallback, useEffect, useMemo, useState } from "react";
import { useListPartnerji, getEnotaId, type Partner } from "@workspace/api-client-react";
import { useBlagajna } from "@/contexts/BlagajnaContext";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { useToast } from "@/hooks/use-toast";
import { Banknote, CheckCircle2, FileText, Landmark, Loader2, Plus, Printer, RefreshCw, RotateCcw, Settings2, ShieldCheck, Wallet } from "lucide-react";
import { poslovniDatumZaCas } from "@/lib/posCas";

type PremikTip = "IZPLACILO_DOBAVITELJU" | "POLOG_GOTOVINE" | "DVIG_GOTOVINE" | "POLOG_TRR" | "PRILIV_TRR" | "STORNO";
type PremikStatus = "OSNUTEK" | "POTRJEN" | "STORNIRAN";
interface Premik {
  id: string; poslovniDatum: string; datumCas: string; tip: PremikTip; status: PremikStatus;
  znesek: number; opis: string; opomba: string | null; partnerId: string | null; partnerNaziv: string | null;
  scenarijPologa: "A" | "B" | null; razlogIzjeme420: string | null; createdBy: string; confirmedBy: string | null;
}
interface Stanje {
  menjalniDenar: number; gotovinskaProdaja: number; pologiGotovine: number; izplacilaDobaviteljem: number;
  dvigiGotovine: number; pologiTrr: number; stanje: number;
}

const TYPES: Array<{ value: Exclude<PremikTip, "STORNO">; label: string; detail: string }> = [
  { value: "IZPLACILO_DOBAVITELJU", label: "Izplačilo dobavitelju", detail: "D 220 / K 100" },
  { value: "POLOG_GOTOVINE", label: "Prejem gotovine / menjalni denar", detail: "D 100 / K 109" },
  { value: "DVIG_GOTOVINE", label: "Dvig z bančnega TRR", detail: "D 109 / K 110" },
  { value: "POLOG_TRR", label: "Polog gotovine na TRR", detail: "D 109 / K 100" },
  { value: "PRILIV_TRR", label: "Bančni priliv po pologu", detail: "D 110 / K 109" },
];
const TYPE_LABEL: Record<PremikTip, string> = {
  IZPLACILO_DOBAVITELJU: "Izplačilo dobavitelju",
  POLOG_GOTOVINE: "Prejem gotovine / menjalni denar",
  DVIG_GOTOVINE: "Dvig z bančnega TRR",
  POLOG_TRR: "Polog na TRR",
  PRILIV_TRR: "Bančni priliv po pologu",
  STORNO: "Storno premika",
};

function today() { return poslovniDatumZaCas(); }
function fmt(value: number) { return `${value.toFixed(2)} €`; }
function manager(vloga?: string) { return vloga === "admin" || vloga === "admin_enote" || vloga === "superadmin"; }
function escapeHtml(value: unknown) {
  return String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;" }[char]!));
}

async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
  const headers = new Headers(init?.headers);
  const enotaId = getEnotaId();
  if (enotaId) headers.set("X-Enota-Id", String(enotaId));
  const response = await fetch(`${base}/api${path}`, { ...init, credentials: "include", headers });
  const body = await response.json().catch(() => ({})) as T & { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Napaka ${response.status}`);
  return body;
}

function printDocument(document: Record<string, unknown>) {
  const amount = Number(document.znesek ?? 0).toFixed(2);
  const printed = window.open("", "_blank", "noopener,noreferrer,width=720,height=800");
  if (!printed) return;
  printed.document.write(`<!doctype html><html lang="sl"><head><meta charset="utf-8"><title>Blagajniški dokument</title>
    <style>body{font:14px Arial;padding:28px;max-width:620px;margin:auto;color:#111}h1{font-size:22px}dl{display:grid;grid-template-columns:180px 1fr;gap:10px;border-top:1px solid #bbb;padding-top:16px}dt{font-weight:700}.amount{font-size:28px;font-weight:700;margin:20px 0}.sign{margin-top:64px;display:flex;justify-content:space-between;border-top:1px solid #999;padding-top:8px}</style>
    </head><body><h1>Blagajniški dokument</h1><p>${escapeHtml(document.companyName)}</p><dl>
    <dt>Dokument</dt><dd>${escapeHtml(document.id)}</dd><dt>Datum</dt><dd>${escapeHtml(document.poslovniDatum)}</dd>
    <dt>Vrsta</dt><dd>${escapeHtml(TYPE_LABEL[String(document.tip) as PremikTip] ?? String(document.tip ?? ""))}</dd>
    <dt>Opis</dt><dd>${escapeHtml(document.opis)}</dd><dt>Dobavitelj</dt><dd>${escapeHtml(document.partnerNaziv ?? "—")}</dd>
    <dt>Stanje</dt><dd>${escapeHtml(document.status)}</dd></dl><div class="amount">${amount} EUR</div>
    <div class="sign"><span>Pripravil: ${escapeHtml(document.createdBy)}</span><span>Potrdil: ${escapeHtml(document.confirmedBy ?? "—")}</span></div>
    <script>window.onload=()=>window.print()</script></body></html>`);
  printed.document.close();
}

export default function BlagajniskiPremikiPage() {
  const { activeBlagajnaId } = useBlagajna();
  const { user } = useAuth();
  const { toast } = useToast();
  const [datum, setDatum] = useState(today);
  const [premiki, setPremiki] = useState<Premik[]>([]);
  const [stanje, setStanje] = useState<Stanje | null>(null);
  const [loading, setLoading] = useState(false);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [floatInput, setFloatInput] = useState("");
  const [form, setForm] = useState({
    tip: "IZPLACILO_DOBAVITELJU" as Exclude<PremikTip, "STORNO">, znesek: "", opis: "",
    opomba: "", partnerId: "", scenarijPologa: "A" as "A" | "B", razlogIzjeme420: "",
  });
  const { data: partnerji } = useListPartnerji();
  const isManager = manager(user?.vloga);
  const sortedPartnerji = useMemo(() => (partnerji ?? []) as Partner[], [partnerji]);

  const load = useCallback(async () => {
    if (!activeBlagajnaId) { setPremiki([]); setStanje(null); return; }
    setLoading(true);
    try {
      const params = `datum=${encodeURIComponent(datum)}&blagajnaId=${activeBlagajnaId}`;
      const [list, balance, setting] = await Promise.all([
        api<{ premiki: Premik[] }>(`/blagajniski-premiki?${params}`),
        api<Stanje>(`/blagajniski-premiki/stanje?${params}`),
        api<{ menjalniDenar: number }>(`/blagajniski-premiki/nastavitve?blagajnaId=${activeBlagajnaId}`),
      ]);
      setPremiki(list.premiki);
      setStanje({ ...balance, menjalniDenar: setting.menjalniDenar });
      setFloatInput(setting.menjalniDenar.toFixed(2));
    } catch (error) {
      toast({ title: "Premikov ni bilo mogoče naložiti", description: error instanceof Error ? error.message : "Neznana napaka", variant: "destructive" });
    } finally { setLoading(false); }
  }, [activeBlagajnaId, datum, toast]);

  useEffect(() => { void load(); }, [load]);

  const submitDraft = async () => {
    if (!activeBlagajnaId) return;
    setSubmitting(true);
    try {
      await api("/blagajniski-premiki", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, znesek: form.znesek.replace(",", "."), poslovniDatum: datum, blagajnaId: activeBlagajnaId, partnerId: form.partnerId || null }),
      });
      toast({ title: "Osnutek premika je shranjen", description: "Za knjiženje ga mora potrditi druga pooblaščena oseba." });
      setDialogOpen(false);
      setForm({ tip: "IZPLACILO_DOBAVITELJU", znesek: "", opis: "", opomba: "", partnerId: "", scenarijPologa: "A", razlogIzjeme420: "" });
      await load();
    } catch (error) {
      toast({ title: "Shranjevanje ni uspelo", description: error instanceof Error ? error.message : "Neznana napaka", variant: "destructive" });
    } finally { setSubmitting(false); }
  };

  const confirm = async (id: string) => {
    try {
      await api(`/blagajniski-premiki/${id}/potrdi`, { method: "POST" });
      toast({ title: "Premik je potrjen in knjižen v GLK" });
      await load();
    } catch (error) {
      toast({ title: "Potrditev ni uspela", description: error instanceof Error ? error.message : "Neznana napaka", variant: "destructive" });
    }
  };
  const storno = async (id: string) => {
    const razlog = window.prompt("Vnesite razlog storna:");
    if (!razlog?.trim()) return;
    try {
      await api(`/blagajniski-premiki/${id}/storno`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ opis: razlog }) });
      toast({ title: "Storno je knjižen", description: "Izvirni zapis je ostal v dnevniku." });
      await load();
    } catch (error) {
      toast({ title: "Storno ni uspel", description: error instanceof Error ? error.message : "Neznana napaka", variant: "destructive" });
    }
  };
  const saveFloat = async () => {
    if (!activeBlagajnaId) return;
    try {
      await api("/blagajniski-premiki/nastavitve", { method: "PUT", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ blagajnaId: activeBlagajnaId, menjalniDenar: floatInput.replace(",", ".") }) });
      toast({ title: "Začetni menjalni denar je shranjen" });
      setSettingsOpen(false);
      await load();
    } catch (error) {
      toast({ title: "Nastavitev ni uspela", description: error instanceof Error ? error.message : "Neznana napaka", variant: "destructive" });
    }
  };
  const print = async (id: string) => {
    try { printDocument(await api<Record<string, unknown>>(`/blagajniski-premiki/${id}/dokument`)); }
    catch (error) { toast({ title: "Tisk ni uspel", description: error instanceof Error ? error.message : "Neznana napaka", variant: "destructive" }); }
  };

  if (!activeBlagajnaId) {
    return <div className="p-6"><Card><CardContent className="p-6 text-muted-foreground">Za blagajniške premike najprej izberite blagajno v stranski navigaciji.</CardContent></Card></div>;
  }

  return (
    <div className="p-4 md:p-7 space-y-5 flex-1 overflow-auto">
      <div className="flex flex-wrap gap-3 items-end">
        <div className="mr-auto"><h1 className="text-2xl font-bold flex items-center gap-2"><Wallet className="h-6 w-6 text-primary" /> Blagajniški premiki</h1><p className="text-sm text-muted-foreground mt-1">Ločen dnevnik gotovine; ne vpliva na prihodke ali DDV.</p></div>
        <div><Label className="text-xs">Datum</Label><Input className="w-40" type="date" value={datum} onChange={(e) => setDatum(e.target.value)} /></div>
        <Button variant="outline" onClick={() => void load()} disabled={loading}><RefreshCw className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`} />Osveži</Button>
        {isManager && <Button variant="outline" onClick={() => setSettingsOpen(true)}><Settings2 className="h-4 w-4 mr-2" />Menjalni denar</Button>}
        <Button onClick={() => setDialogOpen(true)}><Plus className="h-4 w-4 mr-2" />Nov premik</Button>
      </div>

      {stanje && <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Card className="border-primary/25"><CardHeader className="p-4 pb-1"><CardTitle className="text-xs text-muted-foreground uppercase">Teoretično stanje</CardTitle></CardHeader><CardContent className="p-4 pt-1 text-2xl font-bold tabular-nums">{fmt(stanje.stanje)}</CardContent></Card>
        <Card><CardHeader className="p-4 pb-1"><CardTitle className="text-xs text-muted-foreground uppercase">Menjalni denar</CardTitle></CardHeader><CardContent className="p-4 pt-1 text-xl font-semibold">{fmt(stanje.menjalniDenar)}</CardContent></Card>
        <Card><CardHeader className="p-4 pb-1"><CardTitle className="text-xs text-muted-foreground uppercase">Gotovinska prodaja</CardTitle></CardHeader><CardContent className="p-4 pt-1 text-xl font-semibold">{fmt(stanje.gotovinskaProdaja)}</CardContent></Card>
        <Card><CardHeader className="p-4 pb-1"><CardTitle className="text-xs text-muted-foreground uppercase">Pologi na TRR</CardTitle></CardHeader><CardContent className="p-4 pt-1 text-xl font-semibold">{fmt(stanje.pologiTrr)}</CardContent></Card>
      </div>}

      <Card>
        <CardHeader className="pb-3"><CardTitle className="text-base flex items-center gap-2"><FileText className="h-4 w-4" /> Dnevnik premikov</CardTitle></CardHeader>
        <CardContent className="p-0 overflow-x-auto">
          <table className="w-full text-sm min-w-[830px]"><thead className="border-y bg-muted/30 text-xs text-muted-foreground"><tr><th className="text-left px-5 py-3">Čas / vrsta</th><th className="text-left px-3 py-3">Opis</th><th className="text-left px-3 py-3">Dobavitelj</th><th className="text-right px-3 py-3">Znesek</th><th className="text-center px-3 py-3">Status</th><th className="px-5 py-3" /></tr></thead>
            <tbody>{premiki.length === 0 ? <tr><td colSpan={6} className="p-10 text-center text-muted-foreground">Za izbrani dan ni blagajniških premikov.</td></tr> : premiki.map((p) => <tr key={p.id} className="border-b last:border-0">
              <td className="px-5 py-3"><p className="font-medium">{TYPE_LABEL[p.tip]}</p><p className="text-xs text-muted-foreground">{new Date(p.datumCas).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" })}{p.scenarijPologa ? ` · scenarij ${p.scenarijPologa}` : ""}</p></td>
              <td className="px-3 py-3">{p.opis}{p.razlogIzjeme420 && <p className="text-xs text-amber-700 mt-1">Izjema 420 €: {p.razlogIzjeme420}</p>}</td><td className="px-3 py-3">{p.partnerNaziv ?? "—"}</td>
              <td className="px-3 py-3 text-right font-semibold tabular-nums">{fmt(p.znesek)}</td><td className="px-3 py-3 text-center"><span className={`inline-flex rounded-full px-2 py-1 text-xs font-medium ${p.status === "POTRJEN" ? "bg-emerald-100 text-emerald-700" : p.status === "STORNIRAN" ? "bg-slate-100 text-slate-600" : "bg-amber-100 text-amber-700"}`}>{p.status}</span></td>
              <td className="px-5 py-3 text-right whitespace-nowrap"><Button size="sm" variant="ghost" onClick={() => void print(p.id)} title="Natisni dokument"><Printer className="h-4 w-4" /></Button>
                {isManager && p.status === "OSNUTEK" && <Button size="sm" variant="outline" className="ml-1" onClick={() => void confirm(p.id)}><CheckCircle2 className="h-4 w-4 mr-1" />Potrdi</Button>}
                {isManager && p.status === "POTRJEN" && <Button size="sm" variant="ghost" className="ml-1 text-destructive" onClick={() => void storno(p.id)} title="Storniraj"><RotateCcw className="h-4 w-4" /></Button>}
              </td></tr>)}</tbody></table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}><DialogContent className="max-w-xl"><DialogHeader><DialogTitle>Nov blagajniški premik</DialogTitle></DialogHeader><div className="grid gap-4 py-2">
        <div><Label>Vrsta premika</Label><Select value={form.tip} onValueChange={(tip) => setForm((f) => ({ ...f, tip: tip as typeof f.tip }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent>{TYPES.map((type) => <SelectItem key={type.value} value={type.value}>{type.label} · {type.detail}</SelectItem>)}</SelectContent></Select></div>
        <div className="grid grid-cols-2 gap-3"><div><Label>Znesek *</Label><Input inputMode="decimal" placeholder="0,00" value={form.znesek} onChange={(e) => setForm((f) => ({ ...f, znesek: e.target.value }))} /></div><div><Label>Opis / razlog *</Label><Input value={form.opis} onChange={(e) => setForm((f) => ({ ...f, opis: e.target.value }))} /></div></div>
        {form.tip === "IZPLACILO_DOBAVITELJU" && <div><Label>Dobavitelj *</Label><Select value={form.partnerId} onValueChange={(partnerId) => setForm((f) => ({ ...f, partnerId }))}><SelectTrigger><SelectValue placeholder="Izberite dobavitelja" /></SelectTrigger><SelectContent>{sortedPartnerji.map((partner) => <SelectItem key={partner.id} value={partner.id}>{partner.naziv}</SelectItem>)}</SelectContent></Select><p className="text-xs text-muted-foreground mt-1">Plačila nad 420 € zahtevajo dokumentiran razlog izjeme; sicer uporabite TRR.</p></div>}
        {form.tip === "POLOG_TRR" && <div><Label>Scenarij pologa na TRR *</Label><Select value={form.scenarijPologa} onValueChange={(scenarijPologa) => setForm((f) => ({ ...f, scenarijPologa: scenarijPologa as "A" | "B" }))}><SelectTrigger><SelectValue /></SelectTrigger><SelectContent><SelectItem value="A">A — menjalni denar ostane v blagajni</SelectItem><SelectItem value="B">B — položen je tudi menjalni denar</SelectItem></SelectContent></Select></div>}
        {form.tip === "IZPLACILO_DOBAVITELJU" && <div><Label>Razlog izjeme 420 €</Label><Textarea value={form.razlogIzjeme420} onChange={(e) => setForm((f) => ({ ...f, razlogIzjeme420: e.target.value }))} placeholder="Obvezno, če posamezno ali dnevno plačilo preseže 420 €." /></div>}
        <div><Label>Opomba</Label><Textarea value={form.opomba} onChange={(e) => setForm((f) => ({ ...f, opomba: e.target.value }))} /></div>
        <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground flex gap-2"><ShieldCheck className="h-4 w-4 shrink-0" />Osnutek lahko pripravi blagajnik. Potrditev in GLK knjiženje opravi druga pooblaščena oseba.</div>
        <Button disabled={submitting} onClick={() => void submitDraft()}>{submitting && <Loader2 className="h-4 w-4 animate-spin mr-2" />}Shrani osnutek</Button>
      </div></DialogContent></Dialog>

      <Dialog open={settingsOpen} onOpenChange={setSettingsOpen}><DialogContent className="max-w-sm"><DialogHeader><DialogTitle>Začetni menjalni denar</DialogTitle></DialogHeader><div className="space-y-3"><p className="text-sm text-muted-foreground">Fiksna popravljiva nastavitev za izbrano blagajno. Privzeta vrednost je 50,00 €.</p><Input inputMode="decimal" value={floatInput} onChange={(e) => setFloatInput(e.target.value)} /><Button className="w-full" onClick={() => void saveFloat()}><Banknote className="h-4 w-4 mr-2" />Shrani nastavitev</Button></div></DialogContent></Dialog>
    </div>
  );
}