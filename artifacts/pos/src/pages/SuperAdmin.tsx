import { useState, useEffect, useCallback, useRef } from "react";
import { useLocation } from "wouter";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { useToast } from "@/hooks/use-toast";
import {
  Building2, Plus, Users, UserPlus, ChevronDown, ChevronRight, Pencil, RefreshCw,
  Mail, Database, UserCircle, HardDrive, CloudUpload, Download, Upload, Send,
  Eye, EyeOff, Loader2, CheckCircle2, AlertCircle, Search, Key, Trash2,
} from "lucide-react";
import TestniZagoniPage from "@/pages/TestniZagoni";

interface PodjetjeUporabnik {
  id: number;
  clerkUserId: string;
  username: string; // ime + priimek ali clerkUserId (za prikaz)
  ime: string | null;
  vloga: string;
  aktiven: boolean;
}

interface TrrVrstica { iban: string; bic: string; }

interface Podjetje {
  davcnaStevilka: string;
  naziv: string;
  naslov?: string;
  steviloUporabnikov: number;
  uporabniki: PodjetjeUporabnik[];
}

interface NastavitveGet {
  terminalIp: string;
  terminalPort: number;
  terminalTimeoutMs: number;
  terminalAktiven: boolean;
  nazivRestavracije: string;
  naslovRestavracije: string;
  davcnaStevilka: string;
  poslovniProstor: string;
  elektronskaNaprava: string;
  ponudnikDavcna: string;
  certifikatPot: string;
  certifikatGeslo: string;
  racunPozdrav1: string;
  racunPozdrav2: string;
  testniNacin: boolean;
  fursProxyUrl: string;
  smtpHost: string;
  smtpPort: number;
  smtpUser: string;
  smtpGesloNastavljeno: boolean;
  smtpFrom: string;
  smtpAktiven: boolean;
}

type BackupKopija = { ime: string; velikost: number; ustvarjen: string };
type IdriveStatus = { namesecen: boolean; konfiguriran: boolean; username: string | null };

const getBase = () => import.meta.env.BASE_URL.replace(/\/$/, "");

async function apiFetch(path: string, opts?: RequestInit) {
  const r = await fetch(`${getBase()}${path}`, {
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(opts?.headers ?? {}) },
    ...opts,
  });
  const data = await r.json();
  if (!r.ok) throw new Error((data as { napaka?: string }).napaka ?? "Napaka strežnika");
  return data;
}

// ── NovoPodjetjeDialog ──────────────────────────────────────────────────────

function NovoPodjetjeDialog({ onCreated }: { onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [davcna, setDavcna] = useState("");
  const [naziv, setNaziv] = useState("");
  const [kratekNaziv, setKratekNaziv] = useState("");
  const [naslov, setNaslov] = useState("");
  const [maticnaStevilka, setMaticnaStevilka] = useState("");
  const [trr, setTrr] = useState<TrrVrstica[]>([]);
  const [loading, setLoading] = useState(false);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupNapaka, setLookupNapaka] = useState("");
  const { toast } = useToast();

  const reset = () => {
    setDavcna(""); setNaziv(""); setKratekNaziv(""); setNaslov("");
    setMaticnaStevilka(""); setTrr([]); setLookupNapaka("");
  };

  const handleDdvLookup = async () => {
    const d = davcna.replace(/^SI/i, "").trim();
    if (!/^\d{8}$/.test(d)) return;
    setLookupLoading(true);
    setLookupNapaka("");
    try {
      const r = await apiFetch(`/api/superadmin/ddv-lookup?davcna=${encodeURIComponent(d)}`) as {
        naziv?: string; kratekNaziv?: string | null; naslov?: string;
        maticnaStevilka?: string | null; trr?: TrrVrstica[];
      };
      if (r.naziv) setNaziv(r.naziv);
      if (r.kratekNaziv) setKratekNaziv(r.kratekNaziv);
      if (r.naslov) setNaslov(r.naslov);
      if (r.maticnaStevilka) setMaticnaStevilka(r.maticnaStevilka);
      if (r.trr?.length) setTrr(r.trr);
    } catch (err) {
      setLookupNapaka(err instanceof Error ? err.message : "Iskanje ni uspelo");
    } finally {
      setLookupLoading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await apiFetch("/api/superadmin/podjetja", {
        method: "POST",
        body: JSON.stringify({ davcna, naziv, kratekNaziv: kratekNaziv || undefined, naslov: naslov || undefined, maticnaStevilka: maticnaStevilka || undefined, trr: trr.length ? trr : undefined }),
      });
      toast({ title: "Podjetje ustvarjeno", description: `${naziv || davcna} je bilo dodano.` });
      reset();
      setOpen(false);
      onCreated();
    } catch (err) {
      toast({ title: "Napaka", description: err instanceof Error ? err.message : "Napaka", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={o => { setOpen(o); if (!o) reset(); }}>
      <DialogTrigger asChild>
        <Button>
          <Plus className="h-4 w-4 mr-2" />
          Novo podjetje
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md max-h-[90vh] flex flex-col">
        <DialogHeader className="shrink-0">
          <DialogTitle>Ustvari novo podjetje</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2 overflow-y-auto flex-1 pr-1" autoComplete="off">
          <div className="space-y-2">
            <Label>Davčna številka podjetja *</Label>
            <div className="relative">
              <Input
                value={davcna}
                onChange={e => { setDavcna(e.target.value); setLookupNapaka(""); }}
                onBlur={() => void handleDdvLookup()}
                placeholder="12345678"
                required
                disabled={loading}
                autoComplete="off"
              />
              {lookupLoading && (
                <Loader2 className="h-4 w-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
              )}
            </div>
            {lookupNapaka && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3 shrink-0" />{lookupNapaka}
              </p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Naziv *</Label>
            <Input value={naziv} onChange={e => setNaziv(e.target.value)} required disabled={loading} placeholder="Podjetje d.o.o." />
          </div>
          <div className="space-y-2">
            <Label>Kratek naziv</Label>
            <Input value={kratekNaziv} onChange={e => setKratekNaziv(e.target.value)} disabled={loading} placeholder="Podjetje" />
          </div>
          <div className="space-y-2">
            <Label>Naslov</Label>
            <Input value={naslov} onChange={e => setNaslov(e.target.value)} disabled={loading} placeholder="Ulica 1, 1000 Ljubljana" />
          </div>
          <div className="space-y-2">
            <Label>Matična številka</Label>
            <Input value={maticnaStevilka} onChange={e => setMaticnaStevilka(e.target.value)} disabled={loading} placeholder="1234567000" />
          </div>
          {trr.length > 0 && (
            <div className="space-y-1.5">
              <Label>Bančni računi (TRR)</Label>
              {trr.map((t, i) => (
                <div key={i} className="rounded-md bg-muted px-3 py-1.5 text-xs font-mono flex gap-2">
                  <span className="flex-1">{t.iban}</span>
                  {t.bic && <span className="text-muted-foreground">{t.bic}</span>}
                </div>
              ))}
              <p className="text-xs text-muted-foreground">Uvoženo iz registra. Po ustvaritvi urejajte v ERP → Nastavitve.</p>
            </div>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>Prekliči</Button>
            <Button type="submit" disabled={loading || !davcna || !naziv}>
              {loading ? "Ustvarjam..." : "Ustvari"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── NovUporabnikDialog ───────────────────────────────────────────────────────

function NovUporabnikDialog({ davcna, onCreated }: { davcna: string; onCreated: () => void }) {
  const [open, setOpen] = useState(false);
  const [clerkUserId, setClerkUserId] = useState("");
  const [ime, setIme] = useState("");
  const [vloga, setVloga] = useState("admin");
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const reset = () => { setClerkUserId(""); setIme(""); setVloga("admin"); };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await apiFetch(`/api/superadmin/podjetja/${encodeURIComponent(davcna)}/uporabniki`, {
        method: "POST",
        body: JSON.stringify({ clerkUserId, ime, vloga }),
      });
      toast({ title: "Uporabnik dodan" });
      reset();
      setOpen(false);
      onCreated();
    } catch (err) {
      toast({ title: "Napaka", description: err instanceof Error ? err.message : "Napaka", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="sm">
          <UserPlus className="h-3.5 w-3.5 mr-1.5" />
          Dodaj uporabnika
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Nov POS uporabnik</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label>Clerk user ID *</Label>
            <Input value={clerkUserId} onChange={e => setClerkUserId(e.target.value)} placeholder="user_2abc…" required disabled={loading} />
            <p className="text-xs text-muted-foreground">Najdete ga v Clerk Dashboard ali v nastavitvah ERP računa.</p>
          </div>
          <div className="space-y-2">
            <Label>Ime in priimek</Label>
            <Input value={ime} onChange={e => setIme(e.target.value)} placeholder="Janez Novak" disabled={loading} />
          </div>
          <div className="space-y-2">
            <Label>Ime in priimek</Label>
            <Input value={ime} onChange={e => setIme(e.target.value)} disabled={loading} />
          </div>
          <div className="space-y-2">
            <Label>Vloga</Label>
            <Select value={vloga} onValueChange={setVloga} disabled={loading}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="uporabnik">Uporabnik</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>Prekliči</Button>
            <Button type="submit" disabled={loading || !username || !geslo}>
              {loading ? "Dodajam..." : "Dodaj"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── UrediUporabnikaDialog ────────────────────────────────────────────────────

function UrediUporabnikaDialog({ davcna, user, onUpdated }: { davcna: string; user: PodjetjeUporabnik; onUpdated: () => void }) {
  const [open, setOpen] = useState(false);
  const [ime, setIme] = useState(user.ime ?? "");
  const [vloga, setVloga] = useState(user.vloga);
  const [aktiven, setAktiven] = useState(user.aktiven);
  const [loading, setLoading] = useState(false);
  const { toast } = useToast();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      await apiFetch(`/api/superadmin/podjetja/${encodeURIComponent(davcna)}/uporabniki/${user.id}`, {
        method: "PATCH",
        body: JSON.stringify({ ime, vloga, aktiven }),
      });
      toast({ title: "Uporabnik posodobljen" });
      setOpen(false);
      onUpdated();
    } catch (err) {
      toast({ title: "Napaka", description: err instanceof Error ? err.message : "Napaka", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" className="h-7 w-7">
          <Pencil className="h-3.5 w-3.5" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Uredi: {user.username}</DialogTitle>
        </DialogHeader>
        <p className="text-xs text-muted-foreground font-mono px-1">{user.clerkUserId}</p>
        <form onSubmit={handleSubmit} className="space-y-4 mt-2">
          <div className="space-y-2">
            <Label>Ime in priimek</Label>
            <Input value={ime} onChange={e => setIme(e.target.value)} disabled={loading} />
          </div>
          <div className="space-y-2">
            <Label>Vloga</Label>
            <Select value={vloga} onValueChange={setVloga} disabled={loading}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="uporabnik">Uporabnik</SelectItem>
                <SelectItem value="admin_enote">Admin enote</SelectItem>
                <SelectItem value="admin">Admin</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="aktiven"
              checked={aktiven}
              onChange={e => setAktiven(e.target.checked)}
              disabled={loading}
              className="rounded"
            />
            <Label htmlFor="aktiven">Aktiven</Label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={loading}>Prekliči</Button>
            <Button type="submit" disabled={loading}>
              {loading ? "Shranjujem..." : "Shrani"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}

// ── PodjetjeRow ──────────────────────────────────────────────────────────────

function PodjetjeRow({ podjetje, onRefresh }: { podjetje: Podjetje; onRefresh: () => void }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="border rounded-xl overflow-hidden">
      <button
        className="w-full flex items-center gap-4 px-5 py-4 bg-card hover:bg-muted/50 transition-colors text-left"
        onClick={() => setExpanded(v => !v)}
      >
        <Building2 className="h-5 w-5 shrink-0 text-muted-foreground" />
        <div className="flex-1 min-w-0">
          <p className="font-semibold truncate">{podjetje.naziv}</p>
          <p className="text-xs text-muted-foreground">
            {podjetje.davcnaStevilka}
            {podjetje.naslov ? ` · ${podjetje.naslov}` : ""}
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <Badge variant="secondary">
            <Users className="h-3 w-3 mr-1" />
            {podjetje.steviloUporabnikov}
          </Badge>
          {expanded ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
        </div>
      </button>

      {expanded && (
        <div className="border-t bg-muted/20 px-5 py-4 space-y-4">
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium text-muted-foreground">Uporabniki</p>
              <NovUporabnikDialog davcna={podjetje.davcnaStevilka} onCreated={onRefresh} />
            </div>
            {podjetje.uporabniki.length === 0 ? (
              <p className="text-sm text-muted-foreground italic">Ni uporabnikov</p>
            ) : (
              <div className="space-y-2">
                {podjetje.uporabniki.map(u => (
                  <div key={u.id} className="flex items-center gap-3 bg-card border rounded-lg px-4 py-2.5">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-medium truncate">{u.username}{u.ime ? ` — ${u.ime}` : ""}</p>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <Badge variant={u.vloga === "admin" ? "default" : "secondary"} className="text-[10px] px-1.5 py-0">
                          {u.vloga}
                        </Badge>
                        {!u.aktiven && <Badge variant="destructive" className="text-[10px] px-1.5 py-0">neaktiven</Badge>}
                      </div>
                    </div>
                    <UrediUporabnikaDialog davcna={podjetje.davcnaStevilka} user={u} onUpdated={onRefresh} />
                  </div>
                ))}
              </div>
            )}
          </div>

        </div>
      )}
    </div>
  );
}

// ── PodjetjaView ─────────────────────────────────────────────────────────────

function PodjetjaView() {
  const [podjetja, setPodjetja] = useState<Podjetje[]>([]);
  const [loading, setLoading] = useState(true);
  const [napaka, setNapaka] = useState("");
  const [osvezujem, setOsvezujem] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setNapaka("");
    try {
      const data = await apiFetch("/api/superadmin/podjetja");
      setPodjetja(data as Podjetje[]);
    } catch (err) {
      setNapaka(err instanceof Error ? err.message : "Napaka pri nalaganju");
    } finally {
      setLoading(false);
    }
  }, []);

  const osveziInetis = useCallback(async () => {
    setOsvezujem(true);
    try {
      const data = await apiFetch("/api/superadmin/podjetja/osvezi-inetis", { method: "POST" }) as { osvezenih: number };
      await load();
      alert(`Podatki osveženi za ${data.osvezenih} podjetij iz INETIS.`);
    } catch (err) {
      alert(err instanceof Error ? err.message : "Napaka pri osveževanju");
    } finally {
      setOsvezujem(false);
    }
  }, [load]);

  useEffect(() => { void load(); }, [load]);

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Super-admin</h1>
            <p className="text-sm text-muted-foreground mt-0.5">Upravljanje podjetij in njihovih uporabnikov</p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="outline" size="icon" onClick={() => void load()} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
            </Button>
            <Button variant="outline" onClick={() => void osveziInetis()} disabled={osvezujem || loading}>
              <RefreshCw className={`h-4 w-4 mr-2 ${osvezujem ? "animate-spin" : ""}`} />
              Osveži INETIS
            </Button>
            <NovoPodjetjeDialog onCreated={load} />
          </div>
        </div>

        {napaka && (
          <div className="rounded-lg border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {napaka}
          </div>
        )}

        {loading && !napaka && (
          <div className="text-center py-16 text-muted-foreground text-sm">Nalagam...</div>
        )}

        {!loading && !napaka && podjetja.length === 0 && (
          <div className="text-center py-16 text-muted-foreground">
            <Building2 className="h-12 w-12 mx-auto mb-3 opacity-30" />
            <p className="text-sm">Ni registriranih podjetij.</p>
            <p className="text-xs mt-1">Ustvarite prvo podjetje z gumbom zgoraj.</p>
          </div>
        )}

        {!loading && !napaka && podjetja.length > 0 && (
          <div className="space-y-3">
            {podjetja.map(p => (
              <PodjetjeRow key={p.davcnaStevilka} podjetje={p} onRefresh={load} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── EpostaView ───────────────────────────────────────────────────────────────

function EpostaView() {
  const { toast } = useToast();
  const [pageLoading, setPageLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [testOpen, setTestOpen] = useState(false);
  const [testPrejemnik, setTestPrejemnik] = useState("");
  const [testLoading, setTestLoading] = useState(false);
  const [testRezultat, setTestRezultat] = useState<{ uspeh: boolean; napaka?: string } | null>(null);

  const [nasAll, setNasAll] = useState<NastavitveGet | null>(null);
  const [smtpAktiven, setSmtpAktiven] = useState(false);
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpNovGeslo, setSmtpNovGeslo] = useState("");
  const [smtpGesloNastavljeno, setSmtpGesloNastavljeno] = useState(false);
  const [smtpFrom, setSmtpFrom] = useState("");
  const [pokaziGeslo, setPokaziGeslo] = useState(false);

  useEffect(() => {
    void (async () => {
      try {
        const data = await apiFetch("/api/nastavitve") as NastavitveGet;
        setNasAll(data);
        setSmtpAktiven(data.smtpAktiven);
        setSmtpHost(data.smtpHost);
        setSmtpPort(String(data.smtpPort));
        setSmtpUser(data.smtpUser);
        setSmtpGesloNastavljeno(data.smtpGesloNastavljeno);
        setSmtpFrom(data.smtpFrom);
      } catch {
        toast({ title: "Napaka pri nalaganju nastavitev", variant: "destructive" });
      } finally {
        setPageLoading(false);
      }
    })();
  }, [toast]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nasAll) return;
    setSaving(true);
    try {
      const r = await fetch(`${getBase()}/api/nastavitve`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          terminalIp: nasAll.terminalIp,
          terminalPort: nasAll.terminalPort,
          terminalTimeoutMs: nasAll.terminalTimeoutMs,
          terminalAktiven: nasAll.terminalAktiven,
          nazivRestavracije: nasAll.nazivRestavracije,
          naslovRestavracije: nasAll.naslovRestavracije,
          davcnaStevilka: nasAll.davcnaStevilka,
          poslovniProstor: nasAll.poslovniProstor,
          elektronskaNaprava: nasAll.elektronskaNaprava,
          ponudnikDavcna: nasAll.ponudnikDavcna,
          racunPozdrav1: nasAll.racunPozdrav1,
          racunPozdrav2: nasAll.racunPozdrav2,
          certifikatPot: nasAll.certifikatPot,
          certifikatGeslo: nasAll.certifikatGeslo,
          testniNacin: nasAll.testniNacin,
          fursProxyUrl: nasAll.fursProxyUrl,
          smtpHost,
          smtpPort: parseInt(smtpPort) || 587,
          smtpUser,
          smtpFrom,
          smtpAktiven,
          ...(smtpNovGeslo ? { smtpPassword: smtpNovGeslo } : {}),
        }),
      });
      if (!r.ok) {
        const d = await r.json() as { napaka?: string };
        throw new Error(d.napaka ?? "Napaka");
      }
      toast({ title: "E-poštne nastavitve shranjene" });
      setSmtpNovGeslo("");
      if (smtpNovGeslo) setSmtpGesloNastavljeno(true);
    } catch (err) {
      toast({ title: "Napaka pri shranjevanju", description: (err as Error).message, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setTestLoading(true);
    setTestRezultat(null);
    try {
      const r = await fetch(`${getBase()}/api/nastavitve/email-test`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prejemnik: testPrejemnik }),
      });
      const data = await r.json() as { uspeh?: boolean; napaka?: string };
      setTestRezultat({ uspeh: data.uspeh ?? false, napaka: data.napaka });
    } catch (err) {
      setTestRezultat({ uspeh: false, napaka: err instanceof Error ? err.message : "Napaka" });
    } finally {
      setTestLoading(false);
    }
  };

  if (pageLoading) {
    return (
      <div className="flex-1 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <Mail className="h-6 w-6" />
            E-pošta (SMTP)
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Nastavitve SMTP strežnika za pošiljanje e-pošte</p>
        </div>

        <form onSubmit={handleSave} className="space-y-6">
          <Card>
            <CardContent className="pt-6 space-y-4">
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <p className="font-medium text-sm">Pošiljanje e-pošte aktivirano</p>
                  <p className="text-xs text-muted-foreground">Ko je izklopljeno, se e-pošta ne pošilja.</p>
                </div>
                <Switch checked={smtpAktiven} onCheckedChange={setSmtpAktiven} />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2 space-y-2">
                  <Label>SMTP strežnik</Label>
                  <Input placeholder="smtp.gmail.com" value={smtpHost} onChange={e => setSmtpHost(e.target.value)} disabled={!smtpAktiven} />
                </div>
                <div className="space-y-2">
                  <Label>Vrata</Label>
                  <Input type="number" placeholder="587" value={smtpPort} onChange={e => setSmtpPort(e.target.value)} disabled={!smtpAktiven} />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Uporabniško ime (SMTP)</Label>
                  <Input autoComplete="username" placeholder="pos@restavracija.si" value={smtpUser} onChange={e => setSmtpUser(e.target.value)} disabled={!smtpAktiven} />
                </div>
                <div className="space-y-2">
                  <Label>Geslo (SMTP)</Label>
                  {smtpGesloNastavljeno && !smtpNovGeslo && (
                    <p className="text-xs text-green-700 font-medium">✓ Geslo nastavljeno — pustite prazno za ohranitev</p>
                  )}
                  <div className="relative">
                    <Input
                      type={pokaziGeslo ? "text" : "password"}
                      autoComplete="new-password"
                      placeholder={smtpGesloNastavljeno ? "Novo geslo (pustite prazno)" : "geslo ali app password"}
                      value={smtpNovGeslo}
                      onChange={e => setSmtpNovGeslo(e.target.value)}
                      disabled={!smtpAktiven}
                    />
                    <button type="button" onClick={() => setPokaziGeslo(v => !v)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                      {pokaziGeslo ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
              </div>

              <div className="space-y-2 max-w-sm">
                <Label>E-pošta pošiljatelja (From)</Label>
                <Input type="email" placeholder="pos@restavracija.si" value={smtpFrom} onChange={e => setSmtpFrom(e.target.value)} disabled={!smtpAktiven} />
              </div>

              {smtpAktiven && (
                <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 space-y-1">
                  <p className="font-semibold text-blue-800">Nasveti:</p>
                  <ul className="list-disc list-inside space-y-0.5">
                    <li>Gmail: strežnik <code>smtp.gmail.com</code>, vrata <code>587</code>, App Password</li>
                    <li>Outlook/Office365: strežnik <code>smtp.office365.com</code>, vrata <code>587</code></li>
                  </ul>
                </div>
              )}

              <Separator />

              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm font-medium">Preizkus SMTP</p>
                  <p className="text-xs text-muted-foreground">Pošljite testno sporočilo za preverjanje delovanja.</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => { setTestRezultat(null); setTestPrejemnik(""); setTestOpen(true); }}
                  disabled={!smtpGesloNastavljeno && !smtpNovGeslo}
                >
                  <Send className="h-4 w-4 mr-2" />
                  Pošlji testno e-pošto
                </Button>
              </div>
            </CardContent>
          </Card>

          <div className="flex justify-end">
            <Button type="submit" disabled={saving || !nasAll}>
              {saving ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Shranjujem…</> : "Shrani nastavitve"}
            </Button>
          </div>
        </form>
      </div>

      <Dialog open={testOpen} onOpenChange={o => { setTestOpen(o); if (!o) setTestRezultat(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Send className="h-5 w-5" />Pošlji testno e-pošto</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleTest} className="space-y-4">
            <div className="space-y-2">
              <Label>Prejemnik</Label>
              <Input type="email" placeholder="admin@restavracija.si" value={testPrejemnik} onChange={e => setTestPrejemnik(e.target.value)} required disabled={testLoading} />
            </div>
            {testRezultat && (
              <div className={`rounded-lg border p-3 text-sm ${testRezultat.uspeh ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>
                {testRezultat.uspeh
                  ? <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4" />Sporočilo uspešno poslano!</div>
                  : <div><p className="font-medium flex items-center gap-2"><AlertCircle className="h-4 w-4" />Pošiljanje ni uspelo</p><p className="text-xs mt-1 font-mono break-all">{testRezultat.napaka}</p></div>}
              </div>
            )}
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setTestOpen(false)}>Zapri</Button>
              <Button type="submit" disabled={testLoading || !testPrejemnik}>
                {testLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Pošiljam…</> : <><Send className="h-4 w-4 mr-2" />Pošlji</>}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ── BackupView ───────────────────────────────────────────────────────────────

function formatVelikost(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function BackupView() {
  const { toast } = useToast();
  const [kopije, setKopije] = useState<BackupKopija[]>([]);
  const [idriveStatus, setIdriveStatus] = useState<IdriveStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [ustvariLoading, setUstvariLoading] = useState(false);
  const [ustvariSqlLoading, setUstvariSqlLoading] = useState(false);
  const [obnoviLoading, setObnoviLoading] = useState(false);
  const [brisemIme, setBrisemIme] = useState<string | null>(null);
  const [naloziLoading, setNaloziLoading] = useState<string | null>(null);
  const [idriveNastavLoading, setIdriveNastavLoading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);

  const fetchBackupi = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch(`${getBase()}/api/backup/seznam`, { credentials: "include" });
      const d = await r.json() as { kopije: BackupKopija[]; idrive: IdriveStatus };
      setKopije(d.kopije);
      setIdriveStatus(d.idrive);
    } catch {
      toast({ title: "Napaka pri branju kopij", variant: "destructive" });
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { void fetchBackupi(); }, [fetchBackupi]);

  const handleUstvari = async (format: "json" | "sql" = "json") => {
    if (format === "sql") setUstvariSqlLoading(true); else setUstvariLoading(true);
    try {
      const r = await fetch(`${getBase()}/api/backup/ustvari?format=${format}`, { method: "POST", credentials: "include" });
      if (!r.ok) { const d = await r.json() as { error?: string }; throw new Error(d.error ?? "Napaka"); }
      toast({ title: format === "sql" ? "SQL kopija ustvarjena" : "JSON kopija ustvarjena" });
      void fetchBackupi();
    } catch (err) {
      toast({ title: "Napaka", description: (err as Error).message, variant: "destructive" });
    } finally {
      if (format === "sql") setUstvariSqlLoading(false); else setUstvariLoading(false);
    }
  };

  const handleBrisi = async (ime: string) => {
    setBrisemIme(ime);
    try {
      await fetch(`${getBase()}/api/backup/${encodeURIComponent(ime)}`, { method: "DELETE", credentials: "include" });
      toast({ title: "Kopija izbrisana" });
      setKopije(prev => prev.filter(k => k.ime !== ime));
    } catch {
      toast({ title: "Napaka pri brisanju", variant: "destructive" });
    } finally {
      setBrisemIme(null);
    }
  };

  const handleObnovi = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setObnoviLoading(true);
    try {
      const form = new FormData();
      form.append("backup", file);
      const r = await fetch(`${getBase()}/api/backup/obnovi`, { method: "POST", body: form, credentials: "include" });
      if (!r.ok) { const d = await r.json() as { napaka?: string }; throw new Error(d.napaka ?? "Napaka"); }
      toast({ title: "Baza uspešno obnovljena iz kopije" });
      void fetchBackupi();
    } catch (err) {
      toast({ title: "Napaka pri obnovitvi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setObnoviLoading(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const handleNaloziIdrive = async (ime: string) => {
    setNaloziLoading(ime);
    try {
      await fetch(`${getBase()}/api/backup/idrive/nalozi/${encodeURIComponent(ime)}`, { method: "POST", credentials: "include" });
      toast({ title: "Kopija naložena na iDrive" });
    } catch {
      toast({ title: "Napaka pri nalaganju na iDrive", variant: "destructive" });
    } finally {
      setNaloziLoading(null);
    }
  };

  const handleNastaviIdrive = async () => {
    setIdriveNastavLoading(true);
    try {
      await fetch(`${getBase()}/api/backup/idrive/nastavi`, { method: "POST", credentials: "include" });
      toast({ title: "iDrive uspešno konfiguriran" });
      void fetchBackupi();
    } catch {
      toast({ title: "Napaka pri konfiguraciji iDrive", variant: "destructive" });
    } finally {
      setIdriveNastavLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <HardDrive className="h-6 w-6" />
            Varnostne kopije
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Ustvarjanje in upravljanje varnostnih kopij baze podatkov</p>
        </div>

        {idriveStatus && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="flex items-center gap-2 text-base">
                <CloudUpload className="h-4 w-4" />
                iDrive Cloud Backup
              </CardTitle>
              <CardDescription>Samodejno nalaganje kopij v oblak.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                {idriveStatus.konfiguriran
                  ? <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                  : <AlertCircle className="w-5 h-5 text-muted-foreground shrink-0" />}
                <div>
                  <p className="font-medium text-sm">
                    {idriveStatus.konfiguriran
                      ? `Povezan: ${idriveStatus.username}`
                      : idriveStatus.namesecen
                      ? "Odjemalec nameščen, ni konfiguriran"
                      : "iDrive odjemalec ni nameščen"}
                  </p>
                  {!idriveStatus.konfiguriran && (
                    <p className="text-xs text-muted-foreground mt-0.5">
                      {idriveStatus.namesecen
                        ? "Nastavite IDRIVE_USERNAME in IDRIVE_GESLO v Skrivnostih."
                        : "Kliknite 'Nastavi iDrive' za samodejno namestitev."}
                    </p>
                  )}
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  variant={idriveStatus.konfiguriran ? "outline" : "default"}
                  size="sm"
                  onClick={() => void handleNastaviIdrive()}
                  disabled={idriveNastavLoading}
                >
                  {idriveNastavLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CloudUpload className="w-4 h-4 mr-2" />}
                  {idriveStatus.konfiguriran ? "Znova nastavi" : "Nastavi iDrive"}
                </Button>
                <Button variant="ghost" size="sm" onClick={() => void fetchBackupi()} disabled={loading}>
                  <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2">
                <HardDrive className="w-5 h-5" />
                Lokalne varnostne kopije
              </CardTitle>
              <CardDescription>Varnostne kopije baze podatkov na strežniku.</CardDescription>
            </div>
            <div className="flex flex-wrap gap-2">
              <Button variant="outline" size="sm" onClick={() => void fetchBackupi()} disabled={loading}>
                <RefreshCw className={`w-4 h-4 ${loading ? "animate-spin" : ""}`} />
              </Button>
              <Button variant="outline" onClick={() => void handleUstvari("sql")} disabled={ustvariSqlLoading} title="Popolna SQL kopija (shema + podatki)">
                {ustvariSqlLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Database className="w-4 h-4 mr-2" />}
                SQL kopija
              </Button>
              <Button onClick={() => void handleUstvari("json")} disabled={ustvariLoading} title="JSON kopija — odporna na spremembe sheme">
                {ustvariLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Database className="w-4 h-4 mr-2" />}
                JSON kopija
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {loading && kopije.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground text-sm">Nalagam...</div>
            ) : kopije.length === 0 ? (
              <div className="text-center py-8 text-muted-foreground">
                <HardDrive className="w-10 h-10 mx-auto mb-3 opacity-30" />
                <p className="text-sm">Ni varnostnih kopij.</p>
                <p className="text-xs mt-1">Kliknite "JSON kopija" ali "SQL kopija" za prvi backup.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {kopije.map(k => (
                  <div key={k.ime} className="flex items-center gap-3 border rounded-lg px-4 py-3">
                    <HardDrive className="h-4 w-4 shrink-0 text-muted-foreground" />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <p className="text-sm font-medium truncate font-mono">{k.ime}</p>
                        <Badge variant={k.ime.endsWith(".tar.gz") ? "outline" : "secondary"} className="text-xs shrink-0">
                          {k.ime.endsWith(".tar.gz") ? "SQL" : "JSON"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {formatVelikost(k.velikost)} · {new Date(k.ustvarjen).toLocaleString("sl-SI")}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      {idriveStatus?.konfiguriran && (
                        <Button
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8"
                          title="Naloži na iDrive"
                          onClick={() => void handleNaloziIdrive(k.ime)}
                          disabled={naloziLoading === k.ime}
                        >
                          {naloziLoading === k.ime ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CloudUpload className="h-3.5 w-3.5" />}
                        </Button>
                      )}
                      <a
                        href={`${getBase()}/api/backup/${encodeURIComponent(k.ime)}/prenesi`}
                        download
                        className="inline-flex items-center justify-center rounded-md h-8 w-8 hover:bg-accent hover:text-accent-foreground transition-colors"
                        title="Prenesi"
                      >
                        <Download className="h-3.5 w-3.5" />
                      </a>
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10"
                        title="Izbriši"
                        onClick={() => void handleBrisi(k.ime)}
                        disabled={brisemIme === k.ime}
                      >
                        {brisemIme === k.ime ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Upload className="h-4 w-4" />
              Obnova iz datoteke
            </CardTitle>
            <CardDescription>
              Naložite JSON kopijo <span className="font-mono text-xs">.gz</span> ali SQL kopijo <span className="font-mono text-xs">.tar.gz</span> za obnovitev baze.{" "}
              <span className="text-destructive font-medium">Pozor: obstoječi podatki se prebrišejo!</span>
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex items-center gap-3">
              <input
                ref={fileRef}
                type="file"
                accept=".gz,.tar.gz,.sql"
                onChange={e => void handleObnovi(e)}
                disabled={obnoviLoading}
                className="flex-1 text-sm file:mr-3 file:py-1 file:px-3 file:rounded-md file:border file:border-input file:bg-background file:text-sm file:font-medium cursor-pointer"
              />
              {obnoviLoading && <Loader2 className="h-4 w-4 animate-spin shrink-0 text-muted-foreground" />}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── ProfilView ───────────────────────────────────────────────────────────────

function ProfilView() {
  const { user, updateUser } = useAuth();
  const { toast } = useToast();

  const [ime, setIme] = useState(user?.ime ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [imeLoading, setImeLoading] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);

  const [trenutno, setTrenutno] = useState("");
  const [novo, setNovo] = useState("");
  const [ponovitev, setPonovitev] = useState("");
  const [gesloLoading, setGesloLoading] = useState(false);
  const [pokaziTrenutno, setPokaziTrenutno] = useState(false);
  const [pokaziNovo, setPokaziNovo] = useState(false);

  const handleSaveIme = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user?.id) return;
    setImeLoading(true);
    try {
      const r = await fetch(`${getBase()}/api/admin/uporabniki/${user.id}`, {
        method: "PATCH",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ime }),
      });
      if (!r.ok) { const d = await r.json() as { napaka?: string }; throw new Error(d.napaka ?? "Napaka"); }
      updateUser({ ime });
      toast({ title: "Ime posodobljeno" });
    } catch (err) {
      toast({ title: "Napaka", description: (err as Error).message, variant: "destructive" });
    } finally {
      setImeLoading(false);
    }
  };

  const handleSaveEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setEmailLoading(true);
    try {
      const r = await fetch(`${getBase()}/api/auth/email`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: email || null }),
      });
      const data = await r.json() as { ok?: boolean; napaka?: string; email?: string };
      if (!r.ok) throw new Error(data.napaka ?? "Napaka");
      updateUser({ email: data.email ?? undefined });
      toast({ title: "E-pošta posodobljena" });
    } catch (err) {
      toast({ title: "Napaka", description: (err as Error).message, variant: "destructive" });
    } finally {
      setEmailLoading(false);
    }
  };

  const handleSpremenGeslo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (novo !== ponovitev) { toast({ title: "Novi gesli se ne ujemata", variant: "destructive" }); return; }
    if (novo.length < 6) { toast({ title: "Geslo mora imeti vsaj 6 znakov", variant: "destructive" }); return; }
    setGesloLoading(true);
    try {
      const r = await fetch(`${getBase()}/api/auth/geslo`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ trenutno, novo }),
      });
      const data = await r.json() as { ok?: boolean; napaka?: string };
      if (!r.ok) throw new Error(data.napaka ?? "Napaka");
      toast({ title: "Geslo uspešno spremenjeno" });
      setTrenutno(""); setNovo(""); setPonovitev("");
    } catch (err) {
      toast({ title: "Napaka", description: (err as Error).message, variant: "destructive" });
    } finally {
      setGesloLoading(false);
    }
  };

  return (
    <div className="flex-1 overflow-y-auto">
      <div className="max-w-2xl mx-auto px-4 py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight flex items-center gap-3">
            <UserCircle className="h-6 w-6" />
            Moj profil
          </h1>
          <p className="text-sm text-muted-foreground mt-0.5">Upravljanje lastnega računa</p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Osnovno</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-2">
              <Label>Uporabniško ime</Label>
              <Input value={user?.username ?? ""} disabled className="bg-muted" />
              <p className="text-xs text-muted-foreground">Uporabniško ime ni mogoče spremeniti.</p>
            </div>
            <div className="space-y-2">
              <Label>Vloga</Label>
              <Input value={user?.vloga ?? ""} disabled className="bg-muted" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Ime in priimek</CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveIme} className="space-y-3">
              <Input value={ime} onChange={e => setIme(e.target.value)} placeholder="Janez Novak" disabled={imeLoading} />
              <Button type="submit" size="sm" disabled={imeLoading}>
                {imeLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Shranjujem…</> : "Shrani ime"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">E-poštni naslov</CardTitle>
            <CardDescription>Uporablja se za obvestila računa.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSaveEmail} className="space-y-3">
              <Input type="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="super@admin.si" disabled={emailLoading} />
              <Button type="submit" size="sm" disabled={emailLoading}>
                {emailLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Shranjujem…</> : "Shrani e-pošto"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center gap-2">
              <Key className="h-4 w-4" />
              Sprememba gesla
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSpremenGeslo} className="space-y-3">
              <div className="space-y-2">
                <Label>Trenutno geslo</Label>
                <div className="relative">
                  <Input
                    type={pokaziTrenutno ? "text" : "password"}
                    autoComplete="current-password"
                    value={trenutno}
                    onChange={e => setTrenutno(e.target.value)}
                    disabled={gesloLoading}
                    required
                  />
                  <button type="button" onClick={() => setPokaziTrenutno(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {pokaziTrenutno ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Novo geslo</Label>
                <div className="relative">
                  <Input
                    type={pokaziNovo ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder="vsaj 6 znakov"
                    value={novo}
                    onChange={e => setNovo(e.target.value)}
                    disabled={gesloLoading}
                    required
                  />
                  <button type="button" onClick={() => setPokaziNovo(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {pokaziNovo ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Ponovite novo geslo</Label>
                <Input type="password" autoComplete="new-password" value={ponovitev} onChange={e => setPonovitev(e.target.value)} disabled={gesloLoading} required />
              </div>
              <Button type="submit" size="sm" disabled={gesloLoading || !trenutno || !novo || !ponovitev}>
                {gesloLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Shranjujem…</> : "Spremeni geslo"}
              </Button>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

// ── TestiView ────────────────────────────────────────────────────────────────

function TestiView() {
  return <TestniZagoniPage />;
}

// ── SuperAdminPage (main export) ─────────────────────────────────────────────

export default function SuperAdminPage() {
  const [location] = useLocation();
  const sub = location.replace(/^\/superadmin\/?/, "");

  if (sub === "eposta") return <EpostaView />;
  if (sub === "backup") return <BackupView />;
  if (sub === "profil") return <ProfilView />;
  if (sub === "testi") return <TestiView />;
  return <PodjetjaView />;
}
