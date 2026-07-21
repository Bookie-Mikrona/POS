import { useState, useEffect, useRef } from "react";

import { useSearch, useLocation as useWouterLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useListMize,
  useCreateMiza,
  useDeleteMiza,
  useUpdateMiza,
  useUpdateNastavitve,
  useUpdateNapraveTerminali,
  useListNatakari,
  useCreateNatakar,
  useUpdateNatakar,
  useDeleteNatakar,
  useListPoslovniProstori,
  useCreatePoslovniProstor,
  useUpdatePoslovniProstor,
  useDeletePoslovniProstor,
  useRegistrirajProstor,
  useZapriProstor,
  useListProstori,
  useCreateProstor,
  useUpdateProstor,
  useDeleteProstor,
  useListEnote,
  useCreateEnota,
  useUpdateEnota,
  useDeleteEnota,
  useListBlagajne,
  useCreateBlagajna,
  useUpdateBlagajna,
  useDeleteBlagajna,
  useListNaprave,
  useUpdateNaprava,
  useDeleteNaprava,
  getListTestniZagoniQueryOptions,
  getGetNastavitveQueryKey,
  getListMizeQueryKey,
  getListNatakariQueryKey,
  getListPoslovniProstoriQueryKey,
  getListProstoriQueryKey,
  getListEnoteQueryKey,
  getListBlagajneQueryKey,
  getListNapraveQueryKey,
} from "@workspace/api-client-react";
import type { TestniZagonPogled, Enota, BlagajnaPogled, Naprava } from "@workspace/api-client-react";
import { useNaprava } from "@/contexts/NapravaContext";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Trash2, Wifi, WifiOff, Save, RefreshCw, Pencil, UserPlus, UserCheck, UserX, Building2, CheckCircle2, AlertCircle, Loader2, PlusCircle, XCircle, RotateCcw, ShieldCheck, Upload, FileKey, AlertTriangle, KeyRound, Users, Shield, EyeOff, Eye, Mail, Send, Search, FlaskConical, ChevronDown, ChevronRight, LayoutDashboard, HardDrive, CloudUpload, FolderDown, Database, Percent, Mic, Plus, X, Printer } from "lucide-react";
import { useGlasovniSinonimi } from "@/hooks/use-glasovni-sinonimi";
import { useGlasovniUkaz, jePodprtGlasovniVnos } from "@/hooks/use-glasovni-ukaz";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { Nastavitve, Miza, Natakari, PoslovniProstor, Prostor } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNastavitve } from "@/contexts/NastavitveContext";

interface UporabnikAdmin {
  id: number; username: string; ime: string | null; email: string | null; vloga: string; aktiven: boolean;
  davcnaStevilka: string | null; ustvarjeno: string; zadnjaEPosta: string | null; enotaId: number | null; blagajnaId: number | null;
}

const PRIVZETI_SINONIMI: { beseda: string; alias: string }[] = [
  // Slo ↔ tuje ime
  { beseda: "pica",     alias: "pizza"     },
  { beseda: "kafa",     alias: "coffee"    },
  { beseda: "pivo",     alias: "beer"      },
  { beseda: "sok",      alias: "juice"     },
  { beseda: "čaj",      alias: "tea"       },
  { beseda: "špageti",  alias: "spaghetti" },
  { beseda: "rižota",   alias: "risotto"   },
  { beseda: "solata",   alias: "salad"     },
  { beseda: "juha",     alias: "soup"      },
  { beseda: "tortica",  alias: "cake"      },
  { beseda: "sladoled", alias: "gelato"    },
  { beseda: "beli",     alias: "beu"       },
  // Velikost pijač — veliko = 0,5 l / 5 dl
  { beseda: "veliko",   alias: "0,5"   },
  { beseda: "veliko",   alias: "0.5"   },
  { beseda: "veliko",   alias: "5 dl"  },
  { beseda: "veliko",   alias: "5dl"   },
  // Velikost pijač — malo/majhno = 0,3–0,33 l / 3 dl
  { beseda: "malo",     alias: "0,3"           },
  { beseda: "malo",     alias: "0.3"           },
  { beseda: "malo",     alias: "0,33"          },
  { beseda: "malo",     alias: "0.33"          },
  { beseda: "malo",     alias: "3 dl"          },
  { beseda: "malo",     alias: "3dl"           },
  { beseda: "malo",     alias: "tri decilitre" },
  { beseda: "malo",     alias: "tri decilitri" },
  { beseda: "majhno",   alias: "0,3"           },
  { beseda: "majhno",   alias: "0.3"           },
  { beseda: "majhno",   alias: "0,33"          },
  { beseda: "majhno",   alias: "0.33"          },
  { beseda: "majhno",   alias: "3 dl"          },
  { beseda: "majhno",   alias: "3dl"           },
  { beseda: "majhno",   alias: "tri decilitre" },
  { beseda: "majhno",   alias: "tri decilitri" },
  // Velikost pijač — veliko = 0,5 l / 5 dl (besedna oblika)
  { beseda: "veliko",   alias: "pet decilitrov" },
  { beseda: "veliko",   alias: "pol litra"      },
  { beseda: "veliko",   alias: "pol litre"      },
];

function GlasovniUkaziZavihek() {
  const { sinonimi, dodaj, odstrani } = useGlasovniSinonimi();
  const [novaBeseda, setNovaBeseda] = useState("");
  const [novAlias, setNovAlias] = useState("");
  const [seeding, setSeeding] = useState(false);
  const mikBeseda = useGlasovniUkaz();
  const mikAlias = useGlasovniUkaz();
  const glasovniPodprt = jePodprtGlasovniVnos();

  const handleDodaj = (e: React.FormEvent) => {
    e.preventDefault();
    if (!novaBeseda.trim() || !novAlias.trim()) return;
    dodaj(novaBeseda, novAlias);
    setNovaBeseda("");
    setNovAlias("");
  };

  const handleNaloziPrivzete = async () => {
    setSeeding(true);
    try {
      const obstojeci = new Set(
        sinonimi.map(s => `${s.beseda.toLowerCase()}|${s.alias.toLowerCase()}`)
      );
      for (const par of PRIVZETI_SINONIMI) {
        const kljuc = `${par.beseda.toLowerCase()}|${par.alias.toLowerCase()}`;
        if (!obstojeci.has(kljuc)) {
          await dodaj(par.beseda, par.alias);
          obstojeci.add(kljuc);
        }
      }
    } finally {
      setSeeding(false);
    }
  };

  const toggleMikBeseda = () => {
    if (mikBeseda.poslusam) { mikBeseda.ustavi(); return; }
    mikAlias.ustavi();
    mikBeseda.zacni({ onResult: t => setNovaBeseda(t.trim().toLowerCase()) });
  };

  const toggleMikAlias = () => {
    if (mikAlias.poslusam) { mikAlias.ustavi(); return; }
    mikBeseda.ustavi();
    mikAlias.zacni({ onResult: t => setNovAlias(t.trim().toLowerCase()) });
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><Mic className="w-4 h-4" />Glasovni sinonimi</CardTitle>
          <CardDescription>
            Ko izgovorite <em>dodaj [beseda]</em>, sistem poišče artikel, ki vsebuje <em>alias</em>.
            Primer: beseda <strong>pijača</strong> → alias <strong>drink</strong>. Sinonimi so skupni vsem napravam.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="flex gap-2 justify-end">
            <Button
              variant="outline"
              size="sm"
              onClick={handleNaloziPrivzete}
              disabled={seeding}
            >
              {seeding
                ? <><Loader2 className="w-3.5 h-3.5 mr-1.5 animate-spin" />Nalagam…</>
                : <><RotateCcw className="w-3.5 h-3.5 mr-1.5" />Naloži privzete sinonime</>
              }
            </Button>
          </div>

          <form onSubmit={handleDodaj} className="flex gap-2 items-end flex-wrap">
            <div className="flex-1 min-w-32 space-y-1">
              <Label className="text-xs text-muted-foreground">Beseda (kar izgovorite)</Label>
              <div className="flex gap-1">
                <Input
                  placeholder="npr. pijača"
                  value={novaBeseda}
                  onChange={e => setNovaBeseda(e.target.value)}
                  className={`h-9 ${mikBeseda.poslusam ? "border-red-400 ring-1 ring-red-400" : ""}`}
                />
                {glasovniPodprt && (
                  <Button
                    type="button"
                    size="icon"
                    variant={mikBeseda.poslusam ? "destructive" : "outline"}
                    className="h-9 w-9 shrink-0"
                    onClick={toggleMikBeseda}
                    title={mikBeseda.poslusam ? "Ustavi snemanje" : "Govori besedo"}
                  >
                    <Mic className={`w-4 h-4 ${mikBeseda.poslusam ? "animate-pulse" : ""}`} />
                  </Button>
                )}
              </div>
            </div>
            <div className="flex-1 min-w-32 space-y-1">
              <Label className="text-xs text-muted-foreground">Alias (kaj iskati v meniju)</Label>
              <div className="flex gap-1">
                <Input
                  placeholder="npr. drink"
                  value={novAlias}
                  onChange={e => setNovAlias(e.target.value)}
                  className={`h-9 ${mikAlias.poslusam ? "border-red-400 ring-1 ring-red-400" : ""}`}
                />
                {glasovniPodprt && (
                  <Button
                    type="button"
                    size="icon"
                    variant={mikAlias.poslusam ? "destructive" : "outline"}
                    className="h-9 w-9 shrink-0"
                    onClick={toggleMikAlias}
                    title={mikAlias.poslusam ? "Ustavi snemanje" : "Govori alias"}
                  >
                    <Mic className={`w-4 h-4 ${mikAlias.poslusam ? "animate-pulse" : ""}`} />
                  </Button>
                )}
              </div>
            </div>
            <Button type="submit" size="sm" disabled={!novaBeseda.trim() || !novAlias.trim()}>
              <Plus className="w-4 h-4 mr-1" />Dodaj
            </Button>
          </form>

          {sinonimi.length === 0 ? (
            <p className="text-sm text-muted-foreground text-center py-4">
              Ni dodanih sinonimov. Kliknite <strong>Naloži privzete sinonime</strong> za začetek.
            </p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Beseda (izgovorite)</TableHead>
                  <TableHead>↔</TableHead>
                  <TableHead>Alias (v imenu artikla)</TableHead>
                  <TableHead className="w-10" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {sinonimi.map((s, i) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-medium">{s.beseda}</TableCell>
                    <TableCell className="text-muted-foreground text-xs">ujema</TableCell>
                    <TableCell>{s.alias}</TableCell>
                    <TableCell>
                      <button
                        onClick={() => odstrani(i)}
                        className="text-muted-foreground hover:text-destructive transition-colors"
                        title="Odstrani"
                      >
                        <X className="w-4 h-4" />
                      </button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

export default function Settings() {
  const { user: prijavljen, updateUser } = useAuth();
  const jeAdmin = prijavljen?.vloga === "admin" || prijavljen?.vloga === "superadmin";
  const jeSuperAdmin = prijavljen?.vloga === "superadmin";
  const jeAdminEnote = prijavljen?.vloga === "admin_enote";
  const jeUporabnik = !jeAdmin && !jeAdminEnote && !jeSuperAdmin;

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const { data: mize } = useListMize();
  const createMiza = useCreateMiza();
  const deleteMiza = useDeleteMiza();
  const updateMiza = useUpdateMiza();
  const { data: prostori } = useListProstori();
  const createProstor = useCreateProstor();
  const updateProstorMut = useUpdateProstor();
  const deleteProstorMut = useDeleteProstor();
  const { nastavitve, nastavitveLoading } = useNastavitve();
  const updateNastavitve = useUpdateNastavitve();
  const updateNapraveTerminali = useUpdateNapraveTerminali();
  const { data: natakari } = useListNatakari();
  const createNatakar = useCreateNatakar();
  const updateNatakar = useUpdateNatakar();
  const deleteNatakar = useDeleteNatakar();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  // ── Naprave ────────────────────────────────────────────────
  const { napravaKljuc, naprava: trenutnaNaprava, refreshNaprava, updateTerminalConfig } = useNaprava();
  const { data: naprave } = useListNaprave();
  const updateNapravaMut = useUpdateNaprava();
  const deleteNapravaMut = useDeleteNaprava();
  const [napravEditDialogOpen, setNapravEditDialogOpen] = useState(false);
  const [editingNaprava, setEditingNaprava] = useState<Naprava | null>(null);
  const [napravEditIme, setNapravEditIme] = useState("");
  const [napravEditTerminal, setNapravEditTerminal] = useState<string>("");
  const [napravEditDovoljeneMize, setNapravEditDovoljeneMize] = useState<number[]>([]);
  const [napravEditPragZaupanja, setNapravEditPragZaupanja] = useState<number>(0);

  // ── Add miza form ──────────────────────────────────────────
  const [stevilka, setStevilka] = useState("");
  const [ime, setIme] = useState("");
  const [kapaciteta, setKapaciteta] = useState("4");
  const [prostorId, setProstorId] = useState<string>("none");

  // ── Edit miza dialog ───────────────────────────────────────
  const [editMizaOpen, setEditMizaOpen] = useState(false);
  const [editingMiza, setEditingMiza] = useState<Miza | null>(null);
  const [editStevilka, setEditStevilka] = useState("");
  const [editIme, setEditIme] = useState("");
  const [editKapaciteta, setEditKapaciteta] = useState("4");
  const [editProstorId, setEditProstorId] = useState<string>("none");

  // ── Prostori ───────────────────────────────────────────────
  const [novProstorIme, setNovProstorIme] = useState("");
  const [editProstorOpen, setEditProstorOpen] = useState(false);
  const [editingProstor, setEditingProstor] = useState<Prostor | null>(null);
  const [editProstorIme, setEditProstorIme] = useState("");

  // ── Blagajne ───────────────────────────────────────────────
  const { data: blagajne, refetch: refetchBlagajne } = useListBlagajne();
  const createBlagajna = useCreateBlagajna();
  const updateBlagajnaMut = useUpdateBlagajna();
  const deleteBlagajnaMut = useDeleteBlagajna();
  const [bPpId, setBPpId] = useState("");
  const [bBId, setBBId] = useState("");
  const [bIme, setBIme] = useState("");
  const [bDialogOpen, setBDialogOpen] = useState(false);
  const [editingBlagajna, setEditingBlagajna] = useState<BlagajnaPogled | null>(null);
  const [editBPpId, setEditBPpId] = useState("");
  const [editBBId, setEditBBId] = useState("");
  const [editBIme, setEditBIme] = useState("");
  const [editBAktivna, setEditBAktivna] = useState(true);

  const handleCreateBlagajna = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bIme.trim()) { toast({ title: "Vnesite naziv blagajne", variant: "destructive" }); return; }
    if (!bPpId.trim()) { toast({ title: "Vnesite ID poslovnega prostora", variant: "destructive" }); return; }
    if (!bBId.trim()) { toast({ title: "Vnesite ID elektronske naprave", variant: "destructive" }); return; }
    try {
      await createBlagajna.mutateAsync({ data: { ppId: bPpId.trim(), bId: bBId.trim(), ime: bIme.trim() } });
      setBPpId(""); setBBId(""); setBIme("");
      queryClient.invalidateQueries({ queryKey: getListBlagajneQueryKey() });
      toast({ title: "Blagajna dodana" });
    } catch { toast({ title: "Napaka pri dodajanju blagajne", variant: "destructive" }); }
  };

  const openEditBlagajna = (b: BlagajnaPogled) => {
    setEditingBlagajna(b);
    setEditBPpId(b.ppId);
    setEditBBId(b.bId);
    setEditBIme(b.ime);
    setEditBAktivna(b.aktivna);
    setBDialogOpen(true);
  };

  const handleUpdateBlagajna = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBlagajna) return;
    try {
      await updateBlagajnaMut.mutateAsync({ id: editingBlagajna.id, data: { ppId: editBPpId.trim(), bId: editBBId.trim(), ime: editBIme.trim(), aktivna: editBAktivna } });
      setBDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: getListBlagajneQueryKey() });
      toast({ title: "Blagajna posodobljena" });
    } catch { toast({ title: "Napaka pri posodabljanju blagajne", variant: "destructive" }); }
  };

  const handleDeleteBlagajna = async (id: number) => {
    try {
      await deleteBlagajnaMut.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListBlagajneQueryKey() });
      refetchBlagajne();
      toast({ title: "Blagajna izbrisana" });
    } catch { toast({ title: "Blagajne ni mogoče izbrisati", variant: "destructive" }); }
  };

  // ── Enote ──────────────────────────────────────────────────
  const { data: enote, refetch: refetchEnote } = useListEnote();
  const createEnota = useCreateEnota();
  const updateEnota = useUpdateEnota();
  const deleteEnota = useDeleteEnota();
  const [eIme, setEIme] = useState("");
  const [eOpis, setEOpis] = useState("");
  const [eAktiven, setEAktiven] = useState(true);
  const [editEnotaOpen, setEditEnotaOpen] = useState(false);
  const [editingEnota, setEditingEnota] = useState<Enota | null>(null);
  const [editEIme, setEditEIme] = useState("");
  const [editEOpis, setEditEOpis] = useState("");
  const [editEAktiven, setEditEAktiven] = useState(true);
  const [editEZacetekDnevaUra, setEditEZacetekDnevaUra] = useState("04:00");

  const handleCreateEnota = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eIme.trim()) return;
    try {
      await createEnota.mutateAsync({ data: { ime: eIme.trim(), opis: eOpis.trim() || null, aktiven: eAktiven } });
      setEIme(""); setEOpis(""); setEAktiven(true);
      queryClient.invalidateQueries({ queryKey: getListEnoteQueryKey() });
      toast({ title: "Enota dodana" });
    } catch { toast({ title: "Napaka pri dodajanju enote", variant: "destructive" }); }
  };

  const openEditEnota = (e: Enota) => {
    setEditingEnota(e); setEditEIme(e.ime); setEditEOpis(e.opis ?? ""); setEditEAktiven(e.aktiven);
    setEditEZacetekDnevaUra(e.zacetekDnevaUra ?? "04:00");
    setEditEnotaOpen(true);
  };

  const handleUpdateEnota = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEnota) return;
    try {
      await updateEnota.mutateAsync({ id: editingEnota.id, data: { ime: editEIme.trim(), opis: editEOpis.trim() || null, aktiven: editEAktiven, zacetekDnevaUra: editEZacetekDnevaUra } });
      setEditEnotaOpen(false);
      queryClient.invalidateQueries({ queryKey: getListEnoteQueryKey() });
      toast({ title: "Enota posodobljena" });
    } catch { toast({ title: "Napaka pri posodabljanju enote", variant: "destructive" }); }
  };

  const handleDeleteEnota = async (id: number) => {
    try {
      await deleteEnota.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListEnoteQueryKey() });
      refetchEnote();
      toast({ title: "Enota izbrisana" });
    } catch (err: unknown) {
      const msg = err && typeof err === "object" && "response" in err
        ? await (err as { response: Response }).response?.json().then((j: { error?: string }) => j?.error).catch(() => null)
        : null;
      toast({ title: msg ?? "Enote ni mogoče izbrisati", variant: "destructive" });
    }
  };

  // ── Natakari form ──────────────────────────────────────────
  const [nIme, setNIme] = useState("");
  const [nPriimek, setNPriimek] = useState("");
  const [nDavcna, setNDavcna] = useState("");
  const [nAktiven, setNAktiven] = useState(true);

  // ── Edit natakar dialog ────────────────────────────────────
  const [editNatakarOpen, setEditNatakarOpen] = useState(false);
  const [editingNatakar, setEditingNatakar] = useState<Natakari | null>(null);
  const [editNIme, setEditNIme] = useState("");
  const [editNPriimek, setEditNPriimek] = useState("");
  const [editNDavcna, setEditNDavcna] = useState("");
  const [editNAktiven, setEditNAktiven] = useState(true);

  // ── Poslovni prostori ──────────────────────────────────────
  const { data: poslovniProstori } = useListPoslovniProstori();
  const createPp = useCreatePoslovniProstor();
  const updatePp = useUpdatePoslovniProstor();
  const deletePp = useDeletePoslovniProstor();
  const registrirajPp = useRegistrirajProstor();
  const zapriPp = useZapriProstor();

  const [ppDialogOpen, setPpDialogOpen] = useState(false);
  const [editingPp, setEditingPp] = useState<PoslovniProstor | null>(null);
  const [ppRegResult, setPpRegResult] = useState<{ uspeh: boolean; napaka?: string | null; surovOdgovor?: string } | null>(null);
  const [ppRegDialogOpen, setPpRegDialogOpen] = useState(false);
  const [ppRegTarget, setPpRegTarget] = useState<PoslovniProstor | null>(null);
  const [ppRegMode, setPpRegMode] = useState<"registriraj" | "zapri">("registriraj");
  const [ppFursNacin, setPpFursNacin] = useState<"simulacija" | "testno" | "produkcija">("simulacija");

  // premise form fields
  const [ppProstorId, setPpProstorId] = useState("");
  const [ppNaziv, setPpNaziv] = useState("");
  const [ppTip, setPpTip] = useState<"nepremicnina" | "premicnina" | "elektronska_naprava">("nepremicnina");
  const [ppUlica, setPpUlica] = useState("");
  const [ppHisna, setPpHisna] = useState("");
  const [ppHisnaDodatek, setPpHisnaDodatek] = useState("");
  const [ppSkupnost, setPpSkupnost] = useState("");
  const [ppKraj, setPpKraj] = useState("");
  const [ppPostna, setPpPostna] = useState("");
  const [ppKatastrska, setPpKatastrska] = useState("");
  const [ppStavba, setPpStavba] = useState("");
  const [ppDelStavbe, setPpDelStavbe] = useState("");
  const [ppTablica, setPpTablica] = useState("");
  const [ppVin, setPpVin] = useState("");
  const [ppPremicninaTip, setPpPremicninaTip] = useState<"A" | "B" | "C">("C");
  const [ppVeljavnost, setPpVeljavnost] = useState(new Date().toISOString().slice(0, 10));
  const [ppCertPot, setPpCertPot] = useState("");
  const [ppCertGeslo, setPpCertGeslo] = useState("");

  // ── Nastavitve ─────────────────────────────────────────────
  const [terminalIp, setTerminalIp] = useState("");
  const [terminalPort, setTerminalPort] = useState("9000");
  const [terminalTimeout, setTerminalTimeout] = useState("30000");
  const [terminalAktiven, setTerminalAktiven] = useState(false);
  const [paytenAndroidAktiven, setPaytenAndroidAktiven] = useState(false);
  const [paytenAndroidPackageName, setPaytenAndroidPackageName] = useState("com.payten.mpos");
  const [nazivRestavracije, setNazivRestavracije] = useState("");
  const [naslovRestavracije, setNaslovRestavracije] = useState("");
  const [naslovUlica, setNaslovUlica] = useState("");
  const [naslovPostna, setNaslovPostna] = useState("");
  const [naslovKraj, setNaslovKraj] = useState("");
  const [davcnaStevilka, setDavcnaStevilka] = useState("");
  const [poslovniProstor, setPoslovniProstor] = useState("PP001");
  const [elektronskaNaprava, setElektronskaNaprava] = useState("B001");
  const [ponudnikDavcna, setPonudnikDavcna] = useState("");
  const [certifikatPot, setCertifikatPot] = useState("");
  const [certifikatGeslo, setCertifikatGeslo] = useState("");
  const [racunPozdrav1, setRacunPozdrav1] = useState("Hvala za obisk!");
  const [racunPozdrav2, setRacunPozdrav2] = useState("Vracamo se — se vidimo.");
  const [fursNacin, setFursNacin] = useState<"simulacija" | "testno" | "produkcija">("simulacija");
  const [fursProxyUrl, setFursProxyUrl] = useState("");
  const [simulirajFursNapako, setSimulirajFursNapako] = useState(false);
  const [grupiranjeNacin, setGrupiranjeNacin] = useState<"izklopljeno" | "staro" | "novo">("novo");
  const [grupiranjeNacinShranjujem, setGrupiranjeNacinShranjujem] = useState(false);
  const [agentTiskalnikIme, setAgentTiskalnikIme] = useState("");
  const [tiskalnikSirina, setTiskalnikSirina] = useState<58 | 80>(58);
  const [prodajalecIban, setProdajalecIban] = useState("");
  const [prodajalecBic, setProdajalecBic] = useState("");
  const [racunMaticna, setRacunMaticna] = useState("");
  const [racunSodisce, setRacunSodisce] = useState("");
  const [racunKapital, setRacunKapital] = useState("");
  const [racunDdvKlavzula, setRacunDdvKlavzula] = useState("");
  const [racunZbirnaKlavzula, setRacunZbirnaKlavzula] = useState(false);
  const [racunPravnaKlavzula, setRacunPravnaKlavzula] = useState("");
  const [smtpHost, setSmtpHost] = useState("");
  const [smtpPort, setSmtpPort] = useState("587");
  const [smtpUser, setSmtpUser] = useState("");
  const [smtpNovGeslo, setSmtpNovGeslo] = useState("");
  const [smtpGesloNastavljeno, setSmtpGesloNastavljeno] = useState(false);
  const [izredniNovPin, setIzredniNovPin] = useState("");
  const [izredniPinPotrdi, setIzredniPinPotrdi] = useState("");
  const [izredniPinNapaka, setIzredniPinNapaka] = useState<string | null>(null);
  const [izrednaIzdajaPINNastavljen, setIzrednaIzdajaPINNastavljen] = useState(false);
  const [izredniPinPokaziNov, setIzredniPinPokaziNov] = useState(false);
  const [izredniPinOdprt, setIzredniPinOdprt] = useState(false);
  const [smtpFrom, setSmtpFrom] = useState("");
  const [smtpAktiven, setSmtpAktiven] = useState(false);
  const [smtpPokaziGeslo, setSmtpPokaziGeslo] = useState(false);
  const [sumupAktiven, setSumupAktiven] = useState(false);
  const [sumupNovApiKey, setSumupNovApiKey] = useState("");
  const [sumupApiKeyNastavljen, setSumupApiKeyNastavljen] = useState(false);
  const [sumupTerminalSerial, setSumupTerminalSerial] = useState("");
  const [sumupPokaziApiKey, setSumupPokaziApiKey] = useState(false);
  const [vivaAktiven, setVivaAktiven] = useState(false);
  const [vivaClientId, setVivaClientId] = useState("");
  const [vivaNovClientSecret, setVivaNovClientSecret] = useState("");
  const [vivaClientSecretNastavljen, setVivaClientSecretNastavljen] = useState(false);
  const [vivaSourceCode, setVivaSourceCode] = useState("");
  const [vivaDemoNacin, setVivaDemoNacin] = useState(false);
  const [vivaPokaziSecret, setVivaPokaziSecret] = useState(false);
  const [vivaTerminalAktiven, setVivaTerminalAktiven] = useState(false);
  const [vivaTerminalId, setVivaTerminalId] = useState("");
  const [vivaAndroidTerminalAktiven, setVivaAndroidTerminalAktiven] = useState(false);
  const [vivaAndroidSourceCode, setVivaAndroidSourceCode] = useState("");
  const [vivaTapToPayAktiven, setVivaTapToPayAktiven] = useState(false);
  const [vivaTapToPaySourceCode, setVivaTapToPaySourceCode] = useState("");

  // ── DDV stopnje (samo superadmin) ───────────────────────────
  const [ddvSplosnaSt, setDdvSplosnaSt] = useState("22");
  const [ddvNizjaSt, setDdvNizjaSt] = useState("9.5");
  const [ddvZnizanaSt, setDdvZnizanaSt] = useState("5");
  const [ddvLoading, setDdvLoading] = useState(false);
  const [ddvSaving, setDdvSaving] = useState(false);

  const [smtpTestDialogOpen, setSmtpTestDialogOpen] = useState(false);
  const [smtpTestPrejemnik, setSmtpTestPrejemnik] = useState("");
  const [smtpTestLoading, setSmtpTestLoading] = useState(false);
  const [smtpTestRezultat, setSmtpTestRezultat] = useState<{ uspeh: boolean; napaka?: string } | null>(null);
  const [fursEchoTesting, setFursEchoTesting] = useState(false);
  const [fursEchoResult, setFursEchoResult] = useState<{ uspeh: boolean; statusCode?: number; body?: string; napaka?: string } | null>(null);

  const [testingConnection, setTestingConnection] = useState(false);
  const [connectionResult, setConnectionResult] = useState<{ uspeh: boolean; napaka?: string | null } | null>(null);

  // ── P12 certifikat upload ──────────────────────────────────
  const p12FileRef = useRef<HTMLInputElement>(null);
  const [p12Geslo, setP12Geslo] = useState("");
  const [p12Ime, setP12Ime] = useState("furs-cert.pem");
  const [p12Uploading, setP12Uploading] = useState(false);
  const [p12Rezultat, setP12Rezultat] = useState<{
    uspeh: boolean; certPot?: string; subjekt?: string; veljavnoDo?: string; dniDoIzteka?: number; napaka?: string
  } | null>(null);

  interface CertInfo {
    najden: boolean; certPot?: string; subjekt?: string; izdajatelj?: string;
    veljavnoOd?: string; veljavnoDo?: string; dniDoIzteka?: number; opozorilo?: boolean; napaka?: string
  }
  const { data: certInfo, refetch: refetchCert } = useQuery<CertInfo>({
    queryKey: ["certifikat-info"],
    queryFn: () => fetch(`${base}/api/certifikat/info`).then(r => r.json()),
    staleTime: 60_000,
    enabled: jeAdmin,
  });

  const handleP12Upload = async (e: React.FormEvent) => {
    e.preventDefault();
    const file = p12FileRef.current?.files?.[0];
    if (!file) return;
    setP12Uploading(true);
    setP12Rezultat(null);
    try {
      const fd = new FormData();
      fd.append("datoteka", file);
      fd.append("geslo", p12Geslo);
      fd.append("ime", p12Ime || "furs-cert.pem");
      const res = await fetch(`${base}/api/certifikat/nalozi`, { method: "POST", body: fd });
      const data = await res.json() as typeof p12Rezultat;
      setP12Rezultat(data);
      if (data?.uspeh) {
        void refetchCert();
        localStorage.removeItem("certExpiryCache");
        toast({ title: "Certifikat uspešno naložen v bazo", description: data.subjekt ?? "Certifikat shranjen" });
        if (p12FileRef.current) p12FileRef.current.value = "";
        setP12Geslo("");
      }
    } catch {
      setP12Rezultat({ uspeh: false, napaka: "Omrežna napaka" });
    } finally {
      setP12Uploading(false);
    }
  };

  useEffect(() => {
    if (!jeSuperAdmin) return;
    setDdvLoading(true);
    fetch(`${base}/api/superadmin/ddv-stopnje`, { credentials: "include" })
      .then(r => r.json())
      .then((d: unknown) => {
        const data = d as { splosnaSt: number; nizjaSt: number; znizanaSt: number };
        if (data && typeof data.splosnaSt === "number") {
          setDdvSplosnaSt(String(data.splosnaSt));
          setDdvNizjaSt(String(data.nizjaSt));
          setDdvZnizanaSt(String(data.znizanaSt));
        }
      })
      .catch(() => {})
      .finally(() => setDdvLoading(false));
  }, [jeSuperAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const handleSaveDdvStopnje = async () => {
    setDdvSaving(true);
    try {
      const r = await fetch(`${base}/api/superadmin/ddv-stopnje`, {
        method: "PUT",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          splosnaSt: parseFloat(ddvSplosnaSt),
          nizjaSt: parseFloat(ddvNizjaSt),
          znizanaSt: parseFloat(ddvZnizanaSt),
        }),
      });
      if (!r.ok) {
        const err = await r.json() as { napaka?: string };
        toast({ title: "Napaka", description: err.napaka ?? "Napaka strežnika", variant: "destructive" });
      } else {
        toast({ title: "DDV stopnje shranjene" });
      }
    } catch {
      toast({ title: "Napaka", description: "Omrežna napaka", variant: "destructive" });
    } finally {
      setDdvSaving(false);
    }
  };

  useEffect(() => {
    if (nastavitve) {
      setNazivRestavracije(nastavitve.nazivRestavracije ?? "");
      setNaslovRestavracije(nastavitve.naslovRestavracije ?? "");
      setNaslovUlica((nastavitve as any).naslovUlica ?? "");
      setNaslovPostna((nastavitve as any).naslovPostna ?? "");
      setNaslovKraj((nastavitve as any).naslovKraj ?? "");
      setDavcnaStevilka(nastavitve.davcnaStevilka ?? "");
      setPoslovniProstor(nastavitve.poslovniProstor ?? "PP001");
      setElektronskaNaprava(nastavitve.elektronskaNaprava ?? "B001");
      setPonudnikDavcna(nastavitve.ponudnikDavcna ?? "");
      setCertifikatPot((nastavitve as Nastavitve & { certifikatPot?: string }).certifikatPot ?? "");
      setCertifikatGeslo((nastavitve as Nastavitve & { certifikatGeslo?: string }).certifikatGeslo ?? "");
      setRacunPozdrav1(nastavitve.racunPozdrav1 ?? "Hvala za obisk!");
      setRacunPozdrav2(nastavitve.racunPozdrav2 ?? "Vracamo se — se vidimo.");
      setFursProxyUrl((nastavitve as Nastavitve & { fursProxyUrl?: string }).fursProxyUrl ?? "");
      setSimulirajFursNapako((nastavitve as Nastavitve & { simulirajFursNapako?: boolean }).simulirajFursNapako ?? false);
      setGrupiranjeNacin(((nastavitve as Nastavitve & { grupiranjeNacin?: string }).grupiranjeNacin ?? "novo") as "izklopljeno" | "staro" | "novo");
      const fn = ((nastavitve as Nastavitve & { fursNacin?: string }).fursNacin ?? "simulacija") as "simulacija" | "testno" | "produkcija";
      setFursNacin(fn);
      setPpFursNacin(fn);
      setProdajalecIban((nastavitve as Nastavitve & { prodajalecIban?: string }).prodajalecIban ?? "");
      setProdajalecBic((nastavitve as Nastavitve & { prodajalecBic?: string }).prodajalecBic ?? "");
      setRacunMaticna((nastavitve as Nastavitve & { racunMaticna?: string }).racunMaticna ?? "");
      setRacunSodisce((nastavitve as Nastavitve & { racunSodisce?: string }).racunSodisce ?? "");
      setRacunKapital((nastavitve as Nastavitve & { racunKapital?: string }).racunKapital ?? "");
      setRacunDdvKlavzula((nastavitve as Nastavitve & { racunDdvKlavzula?: string }).racunDdvKlavzula ?? "");
      setRacunZbirnaKlavzula((nastavitve as Nastavitve & { racunZbirnaKlavzula?: boolean }).racunZbirnaKlavzula ?? false);
      setRacunPravnaKlavzula((nastavitve as Nastavitve & { racunPravnaKlavzula?: string }).racunPravnaKlavzula ?? "");
      setSmtpHost((nastavitve as Nastavitve & { smtpHost?: string }).smtpHost ?? "");
      setSmtpPort(String((nastavitve as Nastavitve & { smtpPort?: number }).smtpPort ?? 587));
      setSmtpUser((nastavitve as Nastavitve & { smtpUser?: string }).smtpUser ?? "");
      setSmtpGesloNastavljeno((nastavitve as Nastavitve & { smtpGesloNastavljeno?: boolean }).smtpGesloNastavljeno ?? false);
      setSmtpNovGeslo("");
      setIzrednaIzdajaPINNastavljen((nastavitve as Nastavitve & { izrednaIzdajaPINNastavljen?: boolean }).izrednaIzdajaPINNastavljen ?? false);
      setIzredniNovPin("");
      setIzredniPinPotrdi("");
      setIzredniPinNapaka(null);
      setSmtpFrom((nastavitve as Nastavitve & { smtpFrom?: string }).smtpFrom ?? "");
      setSmtpAktiven((nastavitve as Nastavitve & { smtpAktiven?: boolean }).smtpAktiven ?? false);
    }
  }, [nastavitve]);

  // ── Nalaganje device-specifičnih terminalnih nastavitev ────
  useEffect(() => {
    const c = trenutnaNaprava?.terminalConfig;
    if (!c) return;
    if (c.terminalAktiven !== undefined) setTerminalAktiven(c.terminalAktiven);
    if (c.terminalIp !== undefined) setTerminalIp(c.terminalIp);
    if (c.terminalPort !== undefined) setTerminalPort(String(c.terminalPort));
    if (c.terminalTimeoutMs !== undefined) setTerminalTimeout(String(c.terminalTimeoutMs));
    if (c.paytenAndroidAktiven !== undefined) setPaytenAndroidAktiven(c.paytenAndroidAktiven);
    if (c.paytenAndroidPackageName !== undefined) setPaytenAndroidPackageName(c.paytenAndroidPackageName);
    if (c.sumupAktiven !== undefined) setSumupAktiven(c.sumupAktiven);
    if (c.sumupTerminalSerial !== undefined) setSumupTerminalSerial(c.sumupTerminalSerial);
    if (c.sumupApiKeyNastavljen !== undefined) setSumupApiKeyNastavljen(c.sumupApiKeyNastavljen);
    if (c.vivaAktiven !== undefined) setVivaAktiven(c.vivaAktiven);
    if (c.vivaClientId !== undefined) setVivaClientId(c.vivaClientId);
    if (c.vivaClientSecretNastavljen !== undefined) setVivaClientSecretNastavljen(c.vivaClientSecretNastavljen);
    if (c.vivaSourceCode !== undefined) setVivaSourceCode(c.vivaSourceCode);
    if (c.vivaDemoNacin !== undefined) setVivaDemoNacin(c.vivaDemoNacin);
    if (c.vivaTerminalAktiven !== undefined) setVivaTerminalAktiven(c.vivaTerminalAktiven);
    if (c.vivaTerminalId !== undefined) setVivaTerminalId(c.vivaTerminalId);
    if (c.vivaAndroidTerminalAktiven !== undefined) setVivaAndroidTerminalAktiven(c.vivaAndroidTerminalAktiven);
    if (c.vivaAndroidSourceCode !== undefined) setVivaAndroidSourceCode(c.vivaAndroidSourceCode);
    if (c.vivaTapToPayAktiven !== undefined) setVivaTapToPayAktiven(c.vivaTapToPayAktiven);
    if (c.agentTiskalnikIme !== undefined) setAgentTiskalnikIme(c.agentTiskalnikIme);
    if (c.tiskalnikSirina !== undefined) setTiskalnikSirina(c.tiskalnikSirina);
    if (c.vivaTapToPaySourceCode !== undefined) setVivaTapToPaySourceCode(c.vivaTapToPaySourceCode);
  }, [trenutnaNaprava]);

  // ── Backup handlers ────────────────────────────────────────
  const fetchBackupi = async () => {
    setBackupLoading(true);
    try {
      const r = await fetch(`${base}/api/backup/seznam`, { credentials: "include" });
      if (!r.ok) throw new Error();
      const d = await r.json() as { kopije: { ime: string; velikost: number; ustvarjen: string }[]; idrive: { namesecen: boolean; konfiguriran: boolean; username: string | null } };
      setBackupKopije(d.kopije);
      setIdriveStatus(d.idrive);
    } catch {
      toast({ title: "Napaka pri branju kopij", variant: "destructive" });
    } finally {
      setBackupLoading(false);
    }
  };

  const handleUstvariBackup = async (format: "json" | "sql" = "json") => {
    if (format === "sql") setBackupUstvariSqlLoading(true); else setBackupUstvariLoading(true);
    try {
      const r = await fetch(`${base}/api/backup/ustvari?format=${format}`, { method: "POST", credentials: "include" });
      if (!r.ok) { const d = await r.json() as { error: string }; throw new Error(d.error); }
      await fetchBackupi();
      toast({ title: format === "sql" ? "SQL kopija ustvarjena" : "JSON kopija ustvarjena" });
    } catch (err) {
      toast({ title: "Napaka", description: (err as Error).message, variant: "destructive" });
    } finally {
      if (format === "sql") setBackupUstvariSqlLoading(false); else setBackupUstvariLoading(false);
    }
  };

  const handleBrisiBackup = async (ime: string) => {
    if (!confirm(`Res izbrisati "${ime}"? Tega dejanja ni mogoče razveljaviti.`)) return;
    try {
      await fetch(`${base}/api/backup/${encodeURIComponent(ime)}`, { method: "DELETE", credentials: "include" });
      await fetchBackupi();
      toast({ title: "Kopija izbrisana" });
    } catch {
      toast({ title: "Napaka pri brisanju", variant: "destructive" });
    }
  };

  const handleObnoviBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm("POZOR: Obnovitev bo prepisala vse trenutne podatke v bazi! Nadaljujete?")) {
      e.target.value = "";
      return;
    }
    setBackupObnoviLoading(true);
    try {
      const form = new FormData();
      form.append("datoteka", file);
      const r = await fetch(`${base}/api/backup/obnovi`, { method: "POST", body: form, credentials: "include" });
      if (!r.ok) { const d = await r.json() as { error: string }; throw new Error(d.error); }
      toast({ title: "Baza uspešno obnovljena", description: "Stran se bo osvežila." });
      setTimeout(() => window.location.reload(), 2000);
    } catch (err) {
      toast({ title: "Napaka pri obnovitvi", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBackupObnoviLoading(false);
      e.target.value = "";
    }
  };

  const handleNastaviIdrive = async () => {
    setIdriveNastavitevLoading(true);
    try {
      const r = await fetch(`${base}/api/backup/idrive/nastavi`, { method: "POST", credentials: "include" });
      const d = await r.json() as { ok?: boolean; error?: string };
      if (!r.ok) throw new Error(d.error);
      await fetchBackupi();
      toast({ title: "iDrive uspešno konfiguriran" });
    } catch (err) {
      toast({ title: "Napaka pri konfiguraciji iDrive", description: (err as Error).message, variant: "destructive" });
    } finally {
      setIdriveNastavitevLoading(false);
    }
  };

  const handleNaloziNaIdrive = async (ime: string) => {
    setBackupNaloziIme(ime);
    try {
      const r = await fetch(`${base}/api/backup/idrive/nalozi/${encodeURIComponent(ime)}`, { method: "POST", credentials: "include" });
      const d = await r.json() as { ok?: boolean; error?: string; sporocilo?: string };
      if (!r.ok) throw new Error(d.error);
      toast({ title: "Naloženo na iDrive", description: d.sporocilo });
    } catch (err) {
      toast({ title: "Napaka pri nalaganju", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBackupNaloziIme(null);
    }
  };

  // ── Aktivna enota ──────────────────────────────────────────
  const aktivnaEnotaIme = enote?.find(e => e.id === prijavljen?.enotaId)?.ime ?? null;

  // ── Miza handlers ──────────────────────────────────────────
  // ── Prostori handlers ──────────────────────────────────────
  const handleCreateProstor = (e: React.FormEvent) => {
    e.preventDefault();
    if (!novProstorIme.trim()) return;
    createProstor.mutate(
      { data: { ime: novProstorIme.trim(), vrstniRed: (prostori?.length ?? 0) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProstoriQueryKey() });
          setNovProstorIme("");
          toast({ title: "Prostor dodan" });
        },
      }
    );
  };

  const openEditProstor = (p: Prostor) => {
    setEditingProstor(p);
    setEditProstorIme(p.ime);
    setEditProstorOpen(true);
  };

  const handleUpdateProstor = () => {
    if (!editingProstor) return;
    updateProstorMut.mutate(
      { id: editingProstor.id, data: { ime: editProstorIme } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListProstoriQueryKey() });
          setEditProstorOpen(false);
          toast({ title: "Prostor posodobljen" });
        },
      }
    );
  };

  const handleDeleteProstor = (id: number) => {
    deleteProstorMut.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListProstoriQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListMizeQueryKey() });
        toast({ title: "Prostor izbrisan" });
      },
    });
  };

  // ── Miza handlers ──────────────────────────────────────────
  const handleCreateMiza = (e: React.FormEvent) => {
    e.preventDefault();
    if (!stevilka) return;
    createMiza.mutate(
      { data: { stevilka: parseInt(stevilka), ime: ime || null, kapaciteta: parseInt(kapaciteta), status: "prosta", prostorId: prostorId !== "none" ? parseInt(prostorId) : null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMizeQueryKey() });
          setStevilka(""); setIme(""); setKapaciteta("4"); setProstorId("none");
          toast({ title: "Miza dodana" });
        },
      }
    );
  };

  const handleDelMiza = (id: number) => {
    deleteMiza.mutate({ id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListMizeQueryKey() }),
      onError: (err) => {
        const msg = err instanceof Error ? err.message : null;
        toast({ title: msg ?? "Mize ni mogoče izbrisati", variant: "destructive" });
      },
    });
  };

  const openEditMiza = (m: Miza) => {
    setEditingMiza(m);
    setEditStevilka(String(m.stevilka));
    setEditIme(m.ime ?? "");
    setEditKapaciteta(String(m.kapaciteta));
    setEditProstorId(m.prostorId != null ? String(m.prostorId) : "none");
    setEditMizaOpen(true);
  };

  const handleUpdateMiza = () => {
    if (!editingMiza) return;
    updateMiza.mutate(
      {
        id: editingMiza.id,
        data: {
          stevilka: parseInt(editStevilka),
          ime: editIme || null,
          kapaciteta: parseInt(editKapaciteta),
          status: editingMiza.status as "prosta" | "zasedena" | "rezervirana",
          prostorId: editProstorId !== "none" ? parseInt(editProstorId) : null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListMizeQueryKey() });
          setEditMizaOpen(false);
          toast({ title: "Miza posodobljena" });
        },
        onError: () => toast({ title: "Napaka", variant: "destructive" }),
      }
    );
  };

  // ── Natakar handlers ───────────────────────────────────────
  const handleCreateNatakar = (e: React.FormEvent) => {
    e.preventDefault();
    if (!nIme || !nPriimek) return;
    createNatakar.mutate(
      { data: { ime: nIme, priimek: nPriimek, davcnaStevilka: nDavcna || null, aktiven: nAktiven } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListNatakariQueryKey() });
          setNIme(""); setNPriimek(""); setNDavcna(""); setNAktiven(true);
          toast({ title: "Natakar dodan" });
        },
        onError: () => toast({ title: "Napaka", variant: "destructive" }),
      }
    );
  };

  const openEditNatakar = (n: Natakari) => {
    setEditingNatakar(n);
    setEditNIme(n.ime);
    setEditNPriimek(n.priimek);
    setEditNDavcna(n.davcnaStevilka ?? "");
    setEditNAktiven(n.aktiven);
    setEditNatakarOpen(true);
  };

  const handleUpdateNatakar = () => {
    if (!editingNatakar) return;
    updateNatakar.mutate(
      {
        id: editingNatakar.id,
        data: { ime: editNIme, priimek: editNPriimek, davcnaStevilka: editNDavcna || null, aktiven: editNAktiven },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListNatakariQueryKey() });
          setEditNatakarOpen(false);
          toast({ title: "Natakar posodobljen" });
        },
        onError: () => toast({ title: "Napaka", variant: "destructive" }),
      }
    );
  };

  const handleDeleteNatakar = (id: number) => {
    deleteNatakar.mutate({ id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListNatakariQueryKey() }),
    });
  };

  // ── Nastavitve handlers ────────────────────────────────────
  // ── Poslovni prostori handlers ─────────────────────────────
  const openPpDialog = (pp?: PoslovniProstor) => {
    if (pp) {
      setEditingPp(pp);
      setPpProstorId(pp.prostorId);
      setPpNaziv(pp.naziv ?? "");
      setPpTip((pp.tipProstora as typeof ppTip) ?? "nepremicnina");
      setPpUlica(pp.ulica ?? "");
      setPpHisna(pp.hisnaStevilka ?? "");
      setPpHisnaDodatek(pp.hisnaStevilkaDodatek ?? "");
      setPpSkupnost(pp.skupnost ?? "");
      setPpKraj(pp.kraj ?? "");
      setPpPostna(pp.postnaStevilka ?? "");
      setPpKatastrska(pp.katastrskaStevilka ?? "");
      setPpStavba(pp.stevilkaStavbe ?? "");
      setPpDelStavbe(pp.stevilkaDelaStavbe ?? "");
      setPpTablica(pp.registrskaTablica ?? "");
      setPpVin(pp.vin ?? "");
      setPpPremicninaTip((pp.premicninaTip as "A" | "B" | "C") ?? "C");
      setPpVeljavnost(pp.veljavnostOd ?? new Date().toISOString().slice(0, 10));
      setPpCertPot(pp.certifikatPot ?? "");
      setPpCertGeslo(pp.certifikatGeslo ?? "");
    } else {
      setEditingPp(null);
      setPpProstorId(""); setPpNaziv(""); setPpTip("nepremicnina");
      setPpUlica(""); setPpHisna(""); setPpHisnaDodatek("");
      setPpSkupnost(""); setPpKraj(""); setPpPostna("");
      setPpKatastrska(""); setPpStavba(""); setPpDelStavbe("");
      setPpTablica(""); setPpVin(""); setPpPremicninaTip("C");
      setPpVeljavnost(new Date().toISOString().slice(0, 10));
      setPpCertPot(""); setPpCertGeslo("");
    }
    setPpDialogOpen(true);
  };

  const buildPpVnos = () => ({
    prostorId: ppProstorId,
    naziv: ppNaziv || null,
    tipProstora: ppTip as "nepremicnina" | "premicnina" | "elektronska_naprava",
    ulica: ppUlica || null,
    hisnaStevilka: ppHisna || null,
    hisnaStevilkaDodatek: ppHisnaDodatek || null,
    skupnost: ppSkupnost || null,
    kraj: ppKraj || null,
    postnaStevilka: ppPostna || null,
    katastrskaStevilka: ppKatastrska || null,
    stevilkaStavbe: ppStavba || null,
    stevilkaDelaStavbe: ppDelStavbe || null,
    registrskaTablica: ppTablica || null,
    vin: ppVin || null,
    premicninaTip: ppPremicninaTip || null,
    veljavnostOd: ppVeljavnost || null,
    certifikatPot: ppCertPot || null,
    certifikatGeslo: ppCertGeslo || null,
  });

  const handleSavePp = () => {
    if (!ppProstorId) return;
    const vnos = buildPpVnos();
    if (editingPp) {
      updatePp.mutate({ id: editingPp.id, data: vnos }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPoslovniProstoriQueryKey() });
          setPpDialogOpen(false);
          toast({ title: "Poslovni prostor posodobljen" });
        },
        onError: () => toast({ title: "Napaka", variant: "destructive" }),
      });
    } else {
      createPp.mutate({ data: vnos }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListPoslovniProstoriQueryKey() });
          setPpDialogOpen(false);
          toast({ title: "Poslovni prostor dodan" });
        },
        onError: () => toast({ title: "Napaka", variant: "destructive" }),
      });
    }
  };

  const handleDeletePp = (id: number) => {
    deletePp.mutate({ id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListPoslovniProstoriQueryKey() }),
      onError: () => toast({ title: "Napaka", variant: "destructive" }),
    });
  };

  const openRegDialog = (pp: PoslovniProstor, mode: "registriraj" | "zapri") => {
    setPpRegTarget(pp);
    setPpRegMode(mode);
    setPpRegResult(null);
    setPpRegDialogOpen(true);
  };

  const handleRegistrirajPp = () => {
    if (!ppRegTarget) return;
    const mutation = ppRegMode === "zapri" ? zapriPp : registrirajPp;
    mutation.mutate(
      { id: ppRegTarget.id, data: { fursNacin: ppFursNacin } },
      {
        onSuccess: (data) => {
          queryClient.invalidateQueries({ queryKey: getListPoslovniProstoriQueryKey() });
          setPpRegResult(data as { uspeh: boolean; napaka?: string | null; surovOdgovor?: string });
        },
        onError: () => setPpRegResult({ uspeh: false, napaka: "Omrežna napaka" }),
      }
    );
  };

  // ── SMTP test email ────────────────────────────────────────
  const handleSmtpTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setSmtpTestLoading(true);
    setSmtpTestRezultat(null);
    try {
      const r = await fetch(`${base}/api/nastavitve/email-test`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ prejemnik: smtpTestPrejemnik }),
      });
      const data = await r.json() as { uspeh: boolean; napaka?: string };
      setSmtpTestRezultat(data);
    } catch {
      setSmtpTestRezultat({ uspeh: false, napaka: "Omrežna napaka" });
    } finally {
      setSmtpTestLoading(false);
    }
  };

  // ── FURS echo test ─────────────────────────────────────────
  const handleFursEcho = async () => {
    setFursEchoTesting(true);
    setFursEchoResult(null);
    try {
      const r = await fetch("/api/nastavitve/furs-echo", { method: "POST" });
      const json = await r.json();
      setFursEchoResult(json);
    } catch (e) {
      setFursEchoResult({ uspeh: false, napaka: String(e) });
    } finally {
      setFursEchoTesting(false);
    }
  };

  // ── Nastavitve handlers ────────────────────────────────────
  const handleSaveGrupiranje = async () => {
    setGrupiranjeNacinShranjujem(true);
    try {
      const r = await fetch("/api/nastavitve/grupiranje", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ grupiranjeNacin }),
      });
      if (!r.ok) throw new Error("Napaka");
      await queryClient.invalidateQueries({ queryKey: getGetNastavitveQueryKey() });
      toast({ title: "Prikaz naročil shranjen" });
    } catch {
      toast({ title: "Napaka", description: "Nastavitve ni bilo mogoče shraniti.", variant: "destructive" });
    } finally {
      setGrupiranjeNacinShranjujem(false);
    }
  };

  const handleSaveNastavitve = () => {
    const body: Nastavitve = {
      nazivRestavracije,
      naslovRestavracije,
      ...(naslovUlica || naslovPostna || naslovKraj ? { naslovUlica, naslovPostna, naslovKraj } as any : {}),
      davcnaStevilka,
      poslovniProstor,
      elektronskaNaprava,
      ponudnikDavcna,
      racunPozdrav1,
      racunPozdrav2,
      certifikatPot,
      certifikatGeslo,
      fursNacin,
      fursProxyUrl,
      simulirajFursNapako,
      grupiranjeNacin,
      prodajalecIban,
      prodajalecBic,
      racunMaticna,
      racunSodisce,
      racunKapital,
      racunDdvKlavzula,
      racunZbirnaKlavzula,
      racunPravnaKlavzula,
      smtpHost,
      smtpPort: parseInt(smtpPort) || 587,
      smtpUser,
      ...(smtpNovGeslo ? { smtpPassword: smtpNovGeslo } : {}),
      smtpFrom,
      smtpAktiven,
      ...(izredniNovPin ? { izrednaIzdajaPIN: izredniNovPin } : {}),
    } as Nastavitve;
    if (izredniNovPin || izredniPinPotrdi) {
      if (izredniNovPin.length < 4) { setIzredniPinNapaka("PIN mora imeti vsaj 4 znake."); return; }
      if (izredniNovPin !== izredniPinPotrdi) { setIzredniPinNapaka("PIN-a se ne ujemata."); return; }
    }
    setIzredniPinNapaka(null);
    updateNastavitve.mutate({ data: body }, {
      onSuccess: (data) => {
        queryClient.setQueryData(getGetNastavitveQueryKey(), data);
        setConnectionResult(null);
        setIzredniNovPin("");
        setIzredniPinPotrdi("");
        if (izredniNovPin) setIzrednaIzdajaPINNastavljen(true);
        toast({ title: "Nastavitve shranjene" });
      },
      onError: () => toast({ title: "Napaka", description: "Nastavitev ni bilo mogoče shraniti.", variant: "destructive" }),
    });
  };

  const handleSaveTerminali = () => {
    updateNapraveTerminali.mutate({
      data: {
        terminalAktiven,
        terminalIp,
        terminalPort: parseInt(terminalPort) || 9000,
        terminalTimeoutMs: parseInt(terminalTimeout) || 30000,
        paytenAndroidAktiven,
        paytenAndroidPackageName,
        sumupAktiven,
        sumupTerminalSerial,
        ...(sumupNovApiKey ? { sumupApiKey: sumupNovApiKey } : {}),
        vivaAktiven,
        vivaClientId,
        vivaSourceCode,
        vivaDemoNacin,
        ...(vivaNovClientSecret ? { vivaClientSecret: vivaNovClientSecret } : {}),
        vivaTerminalAktiven,
        vivaTerminalId,
        vivaAndroidTerminalAktiven,
        vivaAndroidSourceCode,
        vivaTapToPayAktiven,
        vivaTapToPaySourceCode,
        agentTiskalnikIme,
        tiskalnikSirina,
      },
    }, {
      onSuccess: async () => {
        await refreshNaprava();
        setSumupNovApiKey("");
        setVivaNovClientSecret("");
        toast({ title: "Nastavitve terminalov shranjene za to napravo" });
      },
      onError: () => toast({ title: "Napaka", description: "Nastavitev ni bilo mogoče shraniti.", variant: "destructive" }),
    });
  };

  const handleTestConnection = async () => {
    setTestingConnection(true);
    setConnectionResult(null);
    try {
      const res = await fetch(`${base}/api/terminal/test`);
      const data = await res.json() as { uspeh: boolean; napaka?: string | null };
      setConnectionResult(data);
    } catch {
      setConnectionResult({ uspeh: false, napaka: "Omrežna napaka" });
    } finally {
      setTestingConnection(false);
    }
  };

  const [gTrenutno, setGTrenutno] = useState("");
  const [gNovo, setGNovo] = useState("");
  const [gPonovitev, setGPonovitev] = useState("");
  const [gLoading, setGLoading] = useState(false);
  const [gNapaka, setGNapaka] = useState("");

  const [profilEmail, setProfilEmail] = useState(prijavljen?.email ?? "");
  const [profilIme, setProfilIme] = useState(prijavljen?.ime ?? "");
  const [profilEmailLoading, setProfilEmailLoading] = useState(false);
  const [profilEmailNapaka, setProfilEmailNapaka] = useState("");

  useEffect(() => {
    setProfilEmail(prijavljen?.email ?? "");
  }, [prijavljen?.email]);

  useEffect(() => {
    setProfilIme(prijavljen?.ime ?? "");
  }, [prijavljen?.ime]);

  const handleUpdateProfilEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setProfilEmailNapaka("");
    if (!profilIme.trim()) {
      setProfilEmailNapaka("Ime ne sme biti prazno");
      return;
    }
    setProfilEmailLoading(true);
    try {
      const r = await fetch(`${base}/api/auth/email`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ email: profilEmail || null, ime: profilIme.trim() }),
      });
      const data = await r.json() as { ok?: boolean; napaka?: string; email?: string | null; ime?: string };
      if (!r.ok) { setProfilEmailNapaka(data.napaka ?? "Napaka pri shranjevanju"); }
      else {
        updateUser({ email: data.email, ...(data.ime ? { ime: data.ime } : {}) });
        toast({ title: "Profil posodobljen" });
      }
    } catch {
      setProfilEmailNapaka("Napaka pri povezavi s strežnikom");
    } finally {
      setProfilEmailLoading(false);
    }
  };

  const handleSpremembaGesla = async (e: React.FormEvent) => {
    e.preventDefault();
    setGNapaka("");
    if (gNovo !== gPonovitev) { setGNapaka("Novi gesli se ne ujemata"); return; }
    if (gNovo.length < 6) { setGNapaka("Novo geslo mora imeti vsaj 6 znakov"); return; }
    setGLoading(true);
    try {
      const r = await fetch(`${base}/api/auth/geslo`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ trenutno: gTrenutno, novo: gNovo }),
      });
      const data = await r.json() as { ok?: boolean; napaka?: string };
      if (!r.ok) { setGNapaka(data.napaka ?? "Napaka pri spremembi gesla"); }
      else {
        setGTrenutno(""); setGNovo(""); setGPonovitev("");
        toast({ title: "Geslo uspešno spremenjeno" });
      }
    } catch {
      setGNapaka("Napaka pri povezavi s strežnikom");
    } finally {
      setGLoading(false);
    }
  };

  // ── Zgodovina testov (samo admin) ─────────────────────────
  const { data: testniZagoni, isLoading: testniZagoniLoading } = useQuery({
    ...getListTestniZagoniQueryOptions({ limit: 20 }),
    enabled: jeAdmin,
  });
  const [razprtiZagoni, setRazprtiZagoni] = useState<Set<number>>(new Set());
  const toggleRazprtZagon = (id: number) => {
    setRazprtiZagoni(prev => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ── Backup state ────────────────────────────────────────────
  const [backupKopije, setBackupKopije] = useState<{ ime: string; velikost: number; ustvarjen: string }[]>([]);
  const [backupLoading, setBackupLoading] = useState(false);
  const [backupUstvariLoading, setBackupUstvariLoading] = useState(false);
  const [backupUstvariSqlLoading, setBackupUstvariSqlLoading] = useState(false);
  const [backupObnoviLoading, setBackupObnoviLoading] = useState(false);
  const [backupNaloziIme, setBackupNaloziIme] = useState<string | null>(null);
  const [idriveStatus, setIdriveStatus] = useState<{ namesecen: boolean; konfiguriran: boolean; username: string | null } | null>(null);
  const [idriveNastavitevLoading, setIdriveNastavitevLoading] = useState(false);
  const backupFileRef = useRef<HTMLInputElement>(null);

  // ── Upravljanje uporabnikov (samo admin) ───────────────────
  const superAdminZavihki = ["nastavitve", "varnostne-kopije", "moj-profil"];
  const [aktivniZavihek, setAktivniZavihek] = useState<string>(
    () => {
      const shranjeni = sessionStorage.getItem("settings.aktivniZavihek") ?? "mize";
      if (jeSuperAdmin && !superAdminZavihki.includes(shranjeni)) return "nastavitve";
      return shranjeni;
    }
  );

  useEffect(() => {
    if (jeSuperAdmin && !superAdminZavihki.includes(aktivniZavihek)) {
      setAktivniZavihek("nastavitve");
    } else if (jeUporabnik && (aktivniZavihek === "mize" || aktivniZavihek === "natakari")) {
      setAktivniZavihek("nastavitve");
    } else if (!jeAdmin && !jeAdminEnote && aktivniZavihek === "uporabniki") {
      setAktivniZavihek("mize");
    } else if (!jeSuperAdmin && aktivniZavihek === "varnostne-kopije") {
      setAktivniZavihek("mize");
    } else if (jeAdminEnote && aktivniZavihek === "enote") {
      setAktivniZavihek("mize");
    }
  }, [jeAdmin, jeAdminEnote, jeSuperAdmin, aktivniZavihek]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { sessionStorage.setItem("settings.aktivniZavihek", aktivniZavihek); }, [aktivniZavihek]);

  // ── Nastavitve sub-section scroll persistence ───────────────
  const NASTAVITVE_CARD_IDS = ["ns-furs", "ns-smtp", "ns-certifikat", "ns-prostori", "ns-terminal", "ns-testi"] as const;
  const NASTAVITVE_SCROLL_KEY = "settings.nastavitveKartica";

  // Restore scroll to last-visited sub-section when entering nastavitve tab
  useEffect(() => {
    if (aktivniZavihek !== "nastavitve") return;
    const savedId = sessionStorage.getItem(NASTAVITVE_SCROLL_KEY);
    if (!savedId) return;
    const t = setTimeout(() => {
      document.getElementById(savedId)?.scrollIntoView({ behavior: "instant", block: "start" });
    }, 50);
    return () => clearTimeout(t);
  }, [aktivniZavihek]); // eslint-disable-line react-hooks/exhaustive-deps

  // Track the topmost visible card while on nastavitve tab
  useEffect(() => {
    if (aktivniZavihek !== "nastavitve") return;
    if (typeof IntersectionObserver === "undefined") return;
    const intersecting = new Set<string>();
    const observer = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          if (entry.isIntersecting) intersecting.add(entry.target.id);
          else intersecting.delete(entry.target.id);
        }
        if (intersecting.size > 0) {
          const topmost = NASTAVITVE_CARD_IDS.find(id => intersecting.has(id));
          if (topmost) sessionStorage.setItem(NASTAVITVE_SCROLL_KEY, topmost);
        }
      },
      { threshold: 0.1 },
    );
    const t = setTimeout(() => {
      NASTAVITVE_CARD_IDS.forEach(id => {
        const el = document.getElementById(id);
        if (el) observer.observe(el);
      });
    }, 0);
    return () => { clearTimeout(t); observer.disconnect(); };
  }, [aktivniZavihek]); // eslint-disable-line react-hooks/exhaustive-deps

  // Filter state driven by URL ?aktiven param (default: "true" = active-only)
  // Three-way: "true" → aktivni, "false" → neaktivni, "all" → vsi
  const rawSearch = useSearch();
  const [, navigateTo] = useWouterLocation();
  const aktivenUrlParam = new URLSearchParams(rawSearch).get("aktiven") ?? "true";
  const uporabnikiZavihek: "aktivni" | "neaktivni" | "vsi" =
    aktivenUrlParam === "all" ? "vsi" :
    aktivenUrlParam === "false" ? "neaktivni" : "aktivni";
  const prikaziVse = uporabnikiZavihek === "vsi";

  const setUporabnikiZavihek = (zavihek: "aktivni" | "neaktivni" | "vsi") => {
    const vrednost = zavihek === "aktivni" ? "true" : zavihek === "neaktivni" ? "false" : "all";
    sessionStorage.setItem("settings.aktivenFilter", vrednost);
    navigateTo(`/nastavitve?aktiven=${vrednost}`, { replace: true });
  };

  // When navigating to the "uporabniki" tab, ensure the URL has the aktiven param set.
  // If the param is missing, restore the last-used filter from sessionStorage (default: "true").
  useEffect(() => {
    if (aktivniZavihek !== "uporabniki" || !jeAdmin) return;
    if (!new URLSearchParams(rawSearch).has("aktiven")) {
      const shranjeni = sessionStorage.getItem("settings.aktivenFilter") ?? "true";
      navigateTo(`/nastavitve?aktiven=${shranjeni}`, { replace: true });
    }
  }, [aktivniZavihek, jeAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  const [uIskanje, setUIskanje] = useState<string>(() => sessionStorage.getItem("settings.uIskanje") ?? "");
  const [uVlogaFilter, setUVlogaFilter] = useState<"vsi" | "admin" | "uporabnik">(
    () => (sessionStorage.getItem("settings.uVlogaFilter") as "vsi" | "admin" | "uporabnik" | null) ?? "vsi"
  );

  useEffect(() => { sessionStorage.setItem("settings.uIskanje", uIskanje); }, [uIskanje]);
  useEffect(() => { sessionStorage.setItem("settings.uVlogaFilter", uVlogaFilter); }, [uVlogaFilter]);

  // API param: "true" = active-only, "false" = inactive-only, "all" = all users
  const apiAktivenParam = uporabnikiZavihek === "aktivni" ? "true" : uporabnikiZavihek === "neaktivni" ? "false" : "all";

  const { data: adminUporabniki, refetch: refetchUporabnike } = useQuery<UporabnikAdmin[]>({
    queryKey: ["admin-uporabniki", apiAktivenParam],
    queryFn: async () => {
      const params = new URLSearchParams({ aktiven: apiAktivenParam });
      const r = await fetch(`${base}/api/admin/uporabniki?${params.toString()}`, { credentials: "include" });
      if (!r.ok) throw new Error("Napaka");
      return r.json() as Promise<UporabnikAdmin[]>;
    },
    enabled: jeAdmin,
  });

  const filtriranUporabniki = (adminUporabniki ?? []).filter(u => {
    const iskalnik = uIskanje.trim().toLowerCase();
    const ujemaIskanje = !iskalnik ||
      u.username.toLowerCase().includes(iskalnik) ||
      (u.ime ?? "").toLowerCase().includes(iskalnik) ||
      (u.email ?? "").toLowerCase().includes(iskalnik);
    const ujemaVloga = uVlogaFilter === "vsi" || u.vloga === uVlogaFilter;
    return ujemaIskanje && ujemaVloga;
  });

  const poudariBesedo = (besedilo: string, iskalnik: string) => {
    if (!iskalnik.trim()) return <>{besedilo}</>;
    const idx = besedilo.toLowerCase().indexOf(iskalnik.trim().toLowerCase());
    if (idx === -1) return <>{besedilo}</>;
    const pred = besedilo.slice(0, idx);
    const ujemanje = besedilo.slice(idx, idx + iskalnik.trim().length);
    const po = besedilo.slice(idx + iskalnik.trim().length);
    return <>{pred}<mark className="bg-yellow-200 dark:bg-yellow-700 text-foreground rounded-sm px-0.5">{ujemanje}</mark>{po}</>;
  };

  const steviloAktivnih = (adminUporabniki ?? []).filter(u => u.aktiven).length;
  const steviloNeaktivnih = (adminUporabniki ?? []).filter(u => !u.aktiven).length;

  const jeFilterAktiven = uIskanje.trim() !== "" || uVlogaFilter !== "vsi";
  const filtriranAktivnih = filtriranUporabniki.filter(u => u.aktiven).length;
  const filtriranNeaktivnih = filtriranUporabniki.filter(u => !u.aktiven).length;

  const [novUDialog, setNovUDialog] = useState(false);
  const [editUDialog, setEditUDialog] = useState(false);
  const [editingU, setEditingU] = useState<UporabnikAdmin | null>(null);
  const [deleteUporabnikTarget, setDeleteUporabnikTarget] = useState<UporabnikAdmin | null>(null);
  const [uLoading, setULoading] = useState(false);

  const [uUsername, setUUsername] = useState("");
  const [uIme, setUIme] = useState("");
  const [uEmail, setUEmail] = useState("");
  const [uVloga, setUVloga] = useState("uporabnik");
  const [uDavcna, setUDavcna] = useState("");
  const [uEnotaId, setUEnotaId] = useState<number | "">("");
  const [uBlagajnaId, setUBlagajnaId] = useState<number | "">("");
  const [uGeslo, setUGeslo] = useState("");
  const [uPokaziGeslo, setUPokaziGeslo] = useState(false);
  const [uNapaka, setUNapaka] = useState("");
  const [uAdminNapaka, setUAdminNapaka] = useState("");
  const [uZacasnoGeslo, setUZacasnoGeslo] = useState<string | null>(null);
  const [uZacasnoGesloPokazano, setUZacasnoGesloPokazano] = useState(false);
  const [uEmailPoslan, setUEmailPoslan] = useState<boolean | null>(null);

  // ── CSV uvoz uporabnikov ───────────────────────────────────
  const csvInputRef = useRef<HTMLInputElement>(null);
  const [csvDatoteka, setCsvDatoteka] = useState<File | null>(null);
  const [csvUvozanje, setCsvUvozanje] = useState(false);
  const [csvRezultat, setCsvRezultat] = useState<{
    ustvarjenih: number;
    preskocenih: number;
    napake: { vrstica: number; napaka: string }[];
  } | null>(null);
  const [csvNapaka, setCsvNapaka] = useState("");

  const handleCsvUvoz = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!csvDatoteka) return;
    setCsvUvozanje(true);
    setCsvRezultat(null);
    setCsvNapaka("");
    try {
      const fd = new FormData();
      fd.append("csv", csvDatoteka);
      const r = await fetch(`${base}/api/admin/import-users`, {
        method: "POST",
        credentials: "include",
        body: fd,
      });
      const data = await r.json() as { ustvarjenih?: number; preskocenih?: number; napake?: { vrstica: number; napaka: string }[]; napaka?: string };
      if (!r.ok) {
        setCsvNapaka(data.napaka ?? "Napaka pri uvozu");
      } else {
        setCsvRezultat({
          ustvarjenih: data.ustvarjenih ?? 0,
          preskocenih: data.preskocenih ?? 0,
          napake: data.napake ?? [],
        });
        setCsvDatoteka(null);
        if (csvInputRef.current) csvInputRef.current.value = "";
        refetchUporabnike();
      }
    } catch {
      setCsvNapaka("Napaka pri povezavi s strežnikom");
    } finally {
      setCsvUvozanje(false);
    }
  };

  const handleDodajUporabnika = async (e: React.FormEvent) => {
    e.preventDefault();
    setUNapaka(""); setULoading(true);
    try {
      const r = await fetch(`${base}/api/admin/uporabniki`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ username: uUsername, geslo: uGeslo, ime: uIme, vloga: uVloga, email: uEmail || undefined, davcna: uVloga === "admin" ? uDavcna : undefined, ...((uVloga === "admin_enote" || uVloga === "uporabnik") && uEnotaId !== "" ? { enotaId: uEnotaId } : {}), ...(uVloga === "uporabnik" && uBlagajnaId !== "" ? { blagajnaId: uBlagajnaId } : {}) }),
      });
      const data = await r.json() as { napaka?: string; emailPoslan?: boolean; emailNapaka?: string };
      if (!r.ok) { setUNapaka(data.napaka ?? "Napaka"); }
      else {
        refetchUporabnike();
        setUZacasnoGeslo(uGeslo);
        setUZacasnoGesloPokazano(false);
        if (data.emailPoslan !== undefined) setUEmailPoslan(data.emailPoslan);
      }
    } catch { setUNapaka("Napaka pri povezavi"); }
    finally { setULoading(false); }
  };

  const openEditU = (u: UporabnikAdmin) => {
    setEditingU(u); setUNapaka(""); setUAdminNapaka(""); setUGeslo(""); setUPokaziGeslo(false);
    setUZacasnoGeslo(null); setUZacasnoGesloPokazano(false); setUEmailPoslan(null);
    setUUsername(u.username); setUIme(u.ime ?? ""); setUEmail(u.email ?? ""); setUVloga(u.vloga);
    setUDavcna(u.davcnaStevilka ?? "");
    setUEnotaId(u.enotaId ?? "");
    setUBlagajnaId(u.blagajnaId ?? "");
    setEditUDialog(true);
  };

  const handleUrediUporabnika = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingU) return;
    setUNapaka(""); setUAdminNapaka(""); setULoading(true);
    const gesloZaShranitev = uGeslo;
    try {
      const body: Record<string, unknown> = { ime: uIme, vloga: uVloga, email: uEmail || null };
      if ((uVloga === "admin" || uVloga === "superadmin") && uDavcna) body["davcna"] = uDavcna;
      if ((uVloga === "admin_enote" || uVloga === "uporabnik") && uEnotaId !== "") body["enotaId"] = uEnotaId;
      if (uVloga === "uporabnik" && uBlagajnaId !== "") body["blagajnaId"] = uBlagajnaId;
      if (gesloZaShranitev) body["geslo"] = gesloZaShranitev;
      const r = await fetch(`${base}/api/admin/uporabniki/${editingU.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await r.json() as { napaka?: string; novoGesloNastavljeno?: boolean; emailPoslan?: boolean; emailNapaka?: string };
      if (!r.ok) {
        if (r.status === 403) {
          setUAdminNapaka(data.napaka ?? "Ni mogoče spremeniti vloge edinega aktivnega admin računa");
        } else {
          setUNapaka(data.napaka ?? "Napaka");
        }
      }
      else {
        refetchUporabnike();
        if (data.novoGesloNastavljeno && gesloZaShranitev) {
          setUGeslo("");
          setUZacasnoGeslo(gesloZaShranitev);
          setUEmailPoslan(data.emailPoslan ?? false);
        } else {
          setEditUDialog(false);
          toast({ title: "Uporabnik posodobljen" });
        }
      }
    } catch { setUNapaka("Napaka pri povezavi"); }
    finally { setULoading(false); }
  };

  const handleToggleAktiven = async (u: UporabnikAdmin) => {
    if (u.id === prijavljen?.id) { toast({ title: "Ne morete deaktivirati samega sebe", variant: "destructive" }); return; }
    try {
      const r = await fetch(`${base}/api/admin/uporabniki/${u.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ aktiven: !u.aktiven }),
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({})) as { napaka?: string };
        if (r.status === 403) {
          toast({
            title: "Zaščita admin računa",
            description: data.napaka ?? "Ni mogoče deaktivirati edinega aktivnega admin računa",
          });
        } else {
          toast({ title: data.napaka ?? "Napaka pri spremembi statusa", variant: "destructive" });
        }
        return;
      }
      refetchUporabnike();
      toast({ title: u.aktiven ? "Uporabnik deaktiviran" : "Uporabnik aktiviran" });
    } catch { toast({ title: "Napaka", variant: "destructive" }); }
  };

  const handleDeleteUporabnik = async () => {
    const u = deleteUporabnikTarget;
    if (!u) return;
    setDeleteUporabnikTarget(null);
    try {
      const r = await fetch(`${base}/api/admin/uporabniki/${u.id}`, {
        method: "DELETE",
        credentials: "include",
      });
      if (!r.ok) {
        const data = await r.json().catch(() => ({})) as { napaka?: string };
        toast({ title: data.napaka ?? "Napaka pri brisanju uporabnika", variant: "destructive" });
        return;
      }
      refetchUporabnike();
      toast({ title: "Uporabnik izbrisan" });
    } catch { toast({ title: "Napaka pri brisanju", variant: "destructive" }); }
  };

  return (
    <div className="p-4 sm:p-8 flex-1 overflow-auto max-w-4xl mx-auto w-full">
      <h1 className="text-3xl font-bold tracking-tight mb-4">Nastavitve sistema</h1>

      <Tabs value={aktivniZavihek} onValueChange={setAktivniZavihek}>
        <TabsList className="mb-4 flex-wrap h-auto gap-0.5">
          {!jeSuperAdmin && !jeUporabnik && <TabsTrigger value="mize">Mize</TabsTrigger>}
          {!jeSuperAdmin && !jeUporabnik && <TabsTrigger value="natakari">Natakarji</TabsTrigger>}
          {jeAdmin && !jeSuperAdmin && <TabsTrigger value="enote">Enote</TabsTrigger>}
          {(jeAdmin || jeAdminEnote) && !jeSuperAdmin && <TabsTrigger value="uporabniki">Uporabniki</TabsTrigger>}
          <TabsTrigger value="nastavitve">Nastavitve</TabsTrigger>
          {jeSuperAdmin && <TabsTrigger value="varnostne-kopije">Varnostne kopije</TabsTrigger>}
          <TabsTrigger value="moj-profil">Moj profil</TabsTrigger>
          <TabsTrigger value="glasovni-ukazi"><Mic className="w-3.5 h-3.5 mr-1 inline" />Glasovni ukazi</TabsTrigger>
        </TabsList>

        {/* ── Upravljanje uporabnikov (admin in admin_enote) ─────── */}
        {(jeAdmin || jeAdminEnote) && (
          <TabsContent value="uporabniki" className="space-y-6">
            <Card>
          <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="flex items-center gap-2"><Users className="h-5 w-5" />Upravljanje uporabnikov</CardTitle>
              <CardDescription>Dodajajte in urejajte uporabniške račune. Dostop samo za administratorje.</CardDescription>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              <div className="flex rounded-md border overflow-hidden">
                <Button
                  size="sm"
                  variant={uporabnikiZavihek === "aktivni" ? "default" : "ghost"}
                  className="rounded-none border-0 h-8"
                  onClick={() => setUporabnikiZavihek("aktivni")}
                >
                  Aktivni
                </Button>
                <Button
                  size="sm"
                  variant={uporabnikiZavihek === "neaktivni" ? "default" : "ghost"}
                  className="rounded-none border-0 border-l h-8"
                  onClick={() => setUporabnikiZavihek("neaktivni")}
                >
                  Neaktivni
                </Button>
                <Button
                  size="sm"
                  variant={uporabnikiZavihek === "vsi" ? "default" : "ghost"}
                  className="rounded-none border-0 border-l h-8"
                  onClick={() => setUporabnikiZavihek("vsi")}
                >
                  Vsi
                </Button>
              </div>
              <Button size="sm" onClick={() => { setUNapaka(""); setUUsername(""); setUIme(""); setUVloga("uporabnik"); setUGeslo(""); setUPokaziGeslo(false); setNovUDialog(true); }}>
                <UserPlus className="h-4 w-4 mr-2" />Dodaj
              </Button>
            </div>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-col sm:flex-row gap-2">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
                <Input
                  value={uIskanje}
                  onChange={e => setUIskanje(e.target.value)}
                  placeholder="Iskanje po imenu ali uporabniškem imenu…"
                  className="pl-8"
                />
              </div>
              <Select value={uVlogaFilter} onValueChange={v => setUVlogaFilter(v as typeof uVlogaFilter)}>
                <SelectTrigger className="w-full sm:w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="vsi">Vse vloge</SelectItem>
                  <SelectItem value="admin">Admin</SelectItem>
                  <SelectItem value="uporabnik">Uporabnik</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {adminUporabniki && (
              <div className="flex items-center gap-3 text-sm text-muted-foreground">
                {uporabnikiZavihek !== "neaktivni" && (
                  <span className="flex items-center gap-1">
                    <UserCheck className="h-4 w-4 text-green-500" />
                    {jeFilterAktiven ? (
                      <span>
                        <span className="font-semibold text-foreground">{filtriranAktivnih}</span>
                        {" od "}
                        <span className="font-semibold text-foreground">{steviloAktivnih}</span>
                        {" aktivnih"}
                      </span>
                    ) : (
                      <span><span className="font-semibold text-foreground">{steviloAktivnih}</span> aktivnih</span>
                    )}
                  </span>
                )}
                {uporabnikiZavihek !== "aktivni" && (
                  <>
                    {uporabnikiZavihek === "vsi" && <span className="text-border">·</span>}
                    <span className="flex items-center gap-1">
                      <UserX className="h-4 w-4 text-muted-foreground" />
                      {jeFilterAktiven ? (
                        <span>
                          <span className="font-semibold text-foreground">{filtriranNeaktivnih}</span>
                          {" od "}
                          <span className="font-semibold text-foreground">{steviloNeaktivnih}</span>
                          {" neaktivnih"}
                        </span>
                      ) : (
                        <span><span className="font-semibold text-foreground">{steviloNeaktivnih}</span> neaktivnih</span>
                      )}
                    </span>
                  </>
                )}
              </div>
            )}
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="whitespace-nowrap">Upr. ime</TableHead>
                  <TableHead>Ime</TableHead>
                  <TableHead className="hidden md:table-cell">E-pošta</TableHead>
                  <TableHead>Vloga</TableHead>
                  <TableHead className="hidden sm:table-cell">Davčna št.</TableHead>
                  <TableHead className="hidden sm:table-cell">Status</TableHead>
                  <TableHead className="hidden lg:table-cell">Zadnja e-pošta</TableHead>
                  <TableHead className="w-20">Dejanja</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filtriranUporabniki.map(u => (
                  <TableRow key={u.id} className={!u.aktiven ? "opacity-50" : ""}>
                    <TableCell className="font-mono font-medium text-xs whitespace-nowrap">{poudariBesedo(u.username, uIskanje)}</TableCell>
                    <TableCell className="whitespace-nowrap">{u.ime ? poudariBesedo(u.ime, uIskanje) : <span className="text-muted-foreground">—</span>}</TableCell>
                    <TableCell className="hidden md:table-cell text-sm">
                      {u.email
                        ? <span className="flex items-center gap-1"><Mail className="h-3 w-3 text-muted-foreground" />{poudariBesedo(u.email, uIskanje)}</span>
                        : <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell>
                      {u.vloga === "superadmin"
                        ? <Badge variant="default" className="gap-1"><ShieldCheck className="h-3 w-3" />Super-admin</Badge>
                        : u.vloga === "admin"
                        ? <Badge variant="default" className="gap-1"><Shield className="h-3 w-3" />Admin</Badge>
                        : u.vloga === "admin_enote"
                        ? <Badge variant="secondary" className="gap-1"><Shield className="h-3 w-3" />Admin enote</Badge>
                        : <Badge variant="outline">Uporabnik</Badge>}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell font-mono text-xs text-muted-foreground">
                      {u.davcnaStevilka ?? <span className="text-muted-foreground">—</span>}
                    </TableCell>
                    <TableCell className="hidden sm:table-cell">
                      {u.aktiven
                        ? <Badge variant="outline" className="text-green-700 border-green-300">Aktiven</Badge>
                        : <Badge variant="outline" className="text-muted-foreground">Neaktiven</Badge>}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-sm text-muted-foreground">
                      {u.zadnjaEPosta
                        ? <span className="flex items-center gap-1" title={new Date(u.zadnjaEPosta).toLocaleString("sl-SI")}>
                            <Send className="h-3 w-3" />
                            {new Date(u.zadnjaEPosta).toLocaleDateString("sl-SI")}
                          </span>
                        : <span>—</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-8 w-8" onClick={() => openEditU(u)} title="Uredi">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon" variant="ghost"
                          className={`h-8 w-8 ${u.aktiven ? "text-destructive hover:text-destructive" : "text-green-600 hover:text-green-700"}`}
                          onClick={() => handleToggleAktiven(u)}
                          title={u.aktiven ? "Deaktiviraj" : "Aktiviraj"}
                          disabled={u.id === prijavljen?.id}
                        >
                          {u.aktiven ? <UserX className="h-4 w-4" /> : <UserCheck className="h-4 w-4" />}
                        </Button>
                        <Button
                          size="icon" variant="ghost"
                          className="h-8 w-8 text-destructive hover:text-destructive"
                          onClick={() => {
                            if (u.id === prijavljen?.id) { toast({ title: "Ne morete izbrisati lastnega računa", variant: "destructive" }); return; }
                            setDeleteUporabnikTarget(u);
                          }}
                          title="Izbriši"
                          disabled={u.id === prijavljen?.id}
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
                {filtriranUporabniki.length === 0 && (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground py-6">
                      {uIskanje || uVlogaFilter !== "vsi"
                        ? "Ni rezultatov za iskanje"
                        : prikaziVse ? "Ni uporabnikov" : "Ni aktivnih uporabnikov"}
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
            </div>
          </CardContent>
          </Card>

          {/* ── Uvoz uporabnikov iz CSV ──────────────────────────── */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Upload className="h-5 w-5" />Uvoz uporabnikov</CardTitle>
              <CardDescription>
                Uvozite več uporabnikov naenkrat iz CSV datoteke. Zahtevani stolpci:
                {" "}<code className="text-xs bg-muted px-1 py-0.5 rounded">username, geslo, ime, vloga, davcna</code>
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <form onSubmit={handleCsvUvoz} className="space-y-4">
                <div className="flex flex-col sm:flex-row gap-3 items-start sm:items-end">
                  <div className="flex-1 space-y-1.5">
                    <Label htmlFor="csv-uvoz">CSV datoteka</Label>
                    <Input
                      id="csv-uvoz"
                      ref={csvInputRef}
                      type="file"
                      accept=".csv,text/csv"
                      onChange={e => {
                        const f = e.target.files?.[0] ?? null;
                        setCsvDatoteka(f);
                        setCsvRezultat(null);
                        setCsvNapaka("");
                      }}
                      className="cursor-pointer"
                    />
                  </div>
                  <Button
                    type="submit"
                    disabled={!csvDatoteka || csvUvozanje}
                    className="shrink-0"
                  >
                    {csvUvozanje
                      ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Uvažam…</>
                      : <><Upload className="h-4 w-4 mr-2" />Uvozi</>}
                  </Button>
                </div>

                {csvNapaka && (
                  <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 p-3 text-sm text-destructive">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    <span>{csvNapaka}</span>
                  </div>
                )}
              </form>

              {csvRezultat && (
                <div className="space-y-3">
                  <div className="flex flex-wrap gap-3">
                    <div className="flex items-center gap-2 rounded-md bg-green-50 border border-green-200 px-3 py-2 text-sm">
                      <UserCheck className="h-4 w-4 text-green-600" />
                      <span className="text-green-800">
                        <span className="font-semibold">{csvRezultat.ustvarjenih}</span> ustvarjenih
                      </span>
                    </div>
                    <div className="flex items-center gap-2 rounded-md bg-amber-50 border border-amber-200 px-3 py-2 text-sm">
                      <UserX className="h-4 w-4 text-amber-600" />
                      <span className="text-amber-800">
                        <span className="font-semibold">{csvRezultat.preskocenih}</span> preskočenih
                      </span>
                    </div>
                  </div>

                  {csvRezultat.napake.length > 0 && (
                    <div className="rounded-md border border-amber-200 bg-amber-50 p-3 space-y-1.5">
                      <p className="text-sm font-medium text-amber-800 flex items-center gap-1.5">
                        <AlertTriangle className="h-4 w-4" />
                        Napake pri uvozu ({csvRezultat.napake.length})
                      </p>
                      <ul className="space-y-1">
                        {csvRezultat.napake.map((n, i) => (
                          <li key={i} className="text-sm text-amber-700 font-mono">
                            <span className="font-semibold">vrstica {n.vrstica}:</span> {n.napaka}
                          </li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {csvRezultat.napake.length === 0 && csvRezultat.ustvarjenih > 0 && (
                    <div className="flex items-center gap-2 text-sm text-green-700">
                      <CheckCircle2 className="h-4 w-4" />
                      Uvoz zaključen brez napak.
                    </div>
                  )}
                </div>
              )}

              <div className="rounded-md bg-muted/60 p-3 text-xs text-muted-foreground space-y-1">
                <p className="font-medium">Primer CSV:</p>
                <pre className="font-mono">username,geslo,ime,vloga,davcna{"\n"}janez.novak,geslo123,Janez Novak,uporabnik,12345678</pre>
                <p>Veljavne vloge: <code>uporabnik</code>, <code>admin</code>. Polje <code>davcna</code> je opcijsko.</p>
                <p>Uporabniki z obstoječim uporabniškim imenom bodo preskočeni.</p>
              </div>
            </CardContent>
          </Card>
          </TabsContent>
        )}

        {/* ── Mize ──────────────────────────────────────────────── */}
        <TabsContent value="mize" className="space-y-6">

        {/* Prostori management card */}
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <LayoutDashboard className="w-5 h-5" />
              Prostori
            </CardTitle>
            <CardDescription>Razdeli restavracijo na prostore (npr. Notranjost, Terasa). Mize nato dodeli prostoru.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <form onSubmit={handleCreateProstor} className="flex gap-2">
              <Input
                placeholder="Ime prostora (npr. Terasa)"
                value={novProstorIme}
                onChange={e => setNovProstorIme(e.target.value)}
                className="max-w-xs"
              />
              <Button type="submit" disabled={createProstor.isPending || !novProstorIme.trim()}>
                <PlusCircle className="w-4 h-4 mr-2" />
                Dodaj
              </Button>
            </form>
            {prostori && prostori.length > 0 ? (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ime prostora</TableHead>
                    <TableHead className="hidden sm:table-cell">Mize</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {prostori.map(p => (
                    <TableRow key={p.id}>
                      <TableCell className="font-medium">{p.ime}</TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground">
                        {mize?.filter(m => m.prostorId === p.id).length ?? 0} miz
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditProstor(p)}>
                            <Pencil className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteProstor(p.id)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            ) : (
              <p className="text-sm text-muted-foreground">Ni dodanih prostorov. Prostori so opcijski — brez njih so vse mize skupaj.</p>
            )}
          </CardContent>
        </Card>

        <Card>
        <CardHeader>
          <CardTitle>Upravljanje miz</CardTitle>
          <CardDescription>Dodaj, uredi ali odstrani mize v restavraciji.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={handleCreateMiza} className="grid grid-cols-2 sm:grid-cols-5 gap-4 items-end bg-muted/50 p-4 rounded-lg">
            <div className="space-y-2">
              <Label>Številka</Label>
              <Input required type="number" value={stevilka} onChange={e => setStevilka(e.target.value)} placeholder="8" />
            </div>
            <div className="space-y-2">
              <Label>Ime (opcijsko)</Label>
              <Input placeholder="Npr. Terasa 1" value={ime} onChange={e => setIme(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Kapaciteta</Label>
              <Input required type="number" min="1" value={kapaciteta} onChange={e => setKapaciteta(e.target.value)} />
            </div>
            {prostori && prostori.length > 0 && (
              <div className="space-y-2">
                <Label>Prostor</Label>
                <Select value={prostorId} onValueChange={setProstorId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Brez prostora" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Brez prostora</SelectItem>
                    {prostori.map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.ime}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button type="submit" disabled={createMiza.isPending}>Dodaj mizo</Button>
          </form>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Številka</TableHead>
                <TableHead>Ime</TableHead>
                <TableHead className="hidden sm:table-cell">Kapaciteta</TableHead>
                <TableHead className="hidden sm:table-cell">Status</TableHead>
                {prostori && prostori.length > 0 && (
                  <TableHead className="hidden sm:table-cell">Prostor</TableHead>
                )}
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {mize?.map(m => (
                <TableRow key={m.id}>
                  <TableCell className="font-bold">{m.stevilka}</TableCell>
                  <TableCell>{m.ime || "—"}</TableCell>
                  <TableCell className="hidden sm:table-cell">{m.kapaciteta} oseb</TableCell>
                  <TableCell className="hidden sm:table-cell">
                    {m.status === "zasedena"
                      ? <Badge className="bg-red-100 text-red-800 border-red-200">Zasedena</Badge>
                      : m.status === "rezervirana"
                      ? <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Rezervirana</Badge>
                      : <Badge className="bg-green-100 text-green-800 border-green-200">Prosta</Badge>
                    }
                  </TableCell>
                  {prostori && prostori.length > 0 && (
                    <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">
                      {prostori.find(p => p.id === m.prostorId)?.ime ?? "—"}
                    </TableCell>
                  )}
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEditMiza(m)}>
                        <Pencil className="w-4 h-4 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDelMiza(m.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
        </TabsContent>

        {/* ── Natakari ──────────────────────────────────────────── */}
        <TabsContent value="natakari" className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Natakarji / operaterji</CardTitle>
          <CardDescription>
            Natakarji se prikažejo na fiskalnem računu in se posredujejo FURS-u kot operater blagajne.
            Davčna številka natakarja je obvezna za produkcijsko fiskalizacijo.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <form onSubmit={handleCreateNatakar} className="grid grid-cols-2 md:grid-cols-5 gap-3 items-end bg-muted/50 p-4 rounded-lg">
            <div className="space-y-2">
              <Label>Ime</Label>
              <Input required placeholder="Janez" value={nIme} onChange={e => setNIme(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Priimek</Label>
              <Input required placeholder="Novak" value={nPriimek} onChange={e => setNPriimek(e.target.value)} />
            </div>
            <div className="col-span-2 md:col-span-1 space-y-2">
              <Label>Davčna št. (FURS)</Label>
              <Input placeholder="12345678" value={nDavcna} onChange={e => setNDavcna(e.target.value)} />
            </div>
            <div className="flex items-center gap-2 pb-0.5">
              <Switch checked={nAktiven} onCheckedChange={setNAktiven} />
              <Label className="cursor-pointer" onClick={() => setNAktiven(v => !v)}>Aktiven</Label>
            </div>
            <Button type="submit" disabled={createNatakar.isPending}>
              <UserPlus className="w-4 h-4 mr-2" />Dodaj
            </Button>
          </form>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Ime in priimek</TableHead>
                <TableHead className="hidden sm:table-cell">Davčna št.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {natakari?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                    Ni dodanih natakarjev.
                  </TableCell>
                </TableRow>
              )}
              {natakari?.map(n => (
                <TableRow key={n.id}>
                  <TableCell className="font-medium">{n.ime} {n.priimek}</TableCell>
                  <TableCell className="hidden sm:table-cell font-mono text-sm">{n.davcnaStevilka ?? "—"}</TableCell>
                  <TableCell>
                    {n.aktiven
                      ? <Badge className="bg-green-100 text-green-800 border-green-200"><UserCheck className="w-3 h-3 mr-1" />Aktiven</Badge>
                      : <Badge variant="outline" className="text-muted-foreground"><UserX className="w-3 h-3 mr-1" />Neaktiven</Badge>
                    }
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      <Button variant="ghost" size="icon" onClick={() => openEditNatakar(n)}>
                        <Pencil className="w-4 h-4 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => handleDeleteNatakar(n.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>
        </TabsContent>

        {/* ── Poslovne enote (samo admin) ────────────────────── */}
        {jeAdmin && (
        <TabsContent value="enote" className="space-y-6">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Building2 className="h-5 w-5" />Poslovne enote</CardTitle>
              <CardDescription>
                Upravljajte poslovne enote. Vsaka enota ima ločene artikle, mize, naročila in nastavitve.
                Enote z obstoječimi podatki ni mogoče izbrisati.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <form onSubmit={handleCreateEnota} className="grid grid-cols-1 md:grid-cols-4 gap-3 items-end bg-muted/50 p-4 rounded-lg">
                <div className="space-y-2 md:col-span-1">
                  <Label>Ime enote</Label>
                  <Input required placeholder="npr. Enota 1" value={eIme} onChange={e => setEIme(e.target.value)} />
                </div>
                <div className="space-y-2 md:col-span-2">
                  <Label>Opis (neobvezno)</Label>
                  <Input placeholder="npr. Osrednja restavracija" value={eOpis} onChange={e => setEOpis(e.target.value)} />
                </div>
                <div className="flex items-center gap-2 pb-0.5">
                  <Switch checked={eAktiven} onCheckedChange={setEAktiven} />
                  <Label className="cursor-pointer" onClick={() => setEAktiven(v => !v)}>Aktivna</Label>
                </div>
                <Button type="submit" disabled={createEnota.isPending} className="md:col-span-4">
                  <PlusCircle className="w-4 h-4 mr-2" />Dodaj enoto
                </Button>
              </form>

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ime</TableHead>
                    <TableHead className="hidden sm:table-cell">Opis</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!enote?.length && (
                    <TableRow>
                      <TableCell colSpan={4} className="text-center text-muted-foreground py-6">
                        Ni poslovnih enot.
                      </TableCell>
                    </TableRow>
                  )}
                  {enote?.map(e => (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.ime}</TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">{e.opis ?? "—"}</TableCell>
                      <TableCell>
                        {e.aktiven
                          ? <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle2 className="w-3 h-3 mr-1" />Aktivna</Badge>
                          : <Badge variant="outline" className="text-muted-foreground"><XCircle className="w-3 h-3 mr-1" />Neaktivna</Badge>
                        }
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditEnota(e)}>
                            <Pencil className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteEnota(e.id)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </TabsContent>
        )}

        {/* ── Varnostne kopije ────────────────────────────────── */}
        <TabsContent value="varnostne-kopije" className="space-y-6">
          {/* iDrive status card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CloudUpload className="w-5 h-5" />
                iDrive Cloud Backup
              </CardTitle>
              <CardDescription>
                Samodejno nalagajte varnostne kopije na vaš iDrive račun. Potrebujete okoljski spremenljivki <code className="text-xs bg-muted px-1 rounded">IDRIVE_USERNAME</code> in <code className="text-xs bg-muted px-1 rounded">IDRIVE_GESLO</code>.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {idriveStatus === null ? (
                <Button variant="outline" onClick={fetchBackupi} disabled={backupLoading}>
                  <RefreshCw className={`w-4 h-4 mr-2 ${backupLoading ? "animate-spin" : ""}`} />
                  Preveri stanje
                </Button>
              ) : (
                <div className="space-y-3">
                  <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                    {idriveStatus.konfiguriran ? (
                      <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                    ) : idriveStatus.namesecen ? (
                      <AlertCircle className="w-5 h-5 text-yellow-600 shrink-0" />
                    ) : (
                      <AlertCircle className="w-5 h-5 text-muted-foreground shrink-0" />
                    )}
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
                            ? "Nastavite IDRIVE_USERNAME in IDRIVE_GESLO v razdelku Skrivnosti."
                            : "Kliknite 'Nastavi iDrive' za samodejno namestitev Linux odjemalca."}
                        </p>
                      )}
                    </div>
                  </div>
                  <div className="flex gap-2 flex-wrap">
                    <Button
                      variant={idriveStatus.konfiguriran ? "outline" : "default"}
                      onClick={handleNastaviIdrive}
                      disabled={idriveNastavitevLoading}
                    >
                      {idriveNastavitevLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <CloudUpload className="w-4 h-4 mr-2" />}
                      {idriveStatus.konfiguriran ? "Znova nastavi" : "Nastavi iDrive"}
                    </Button>
                    <Button variant="ghost" size="sm" onClick={fetchBackupi} disabled={backupLoading}>
                      <RefreshCw className={`w-4 h-4 ${backupLoading ? "animate-spin" : ""}`} />
                    </Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Local backups card */}
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <HardDrive className="w-5 h-5" />
                  Lokalne varnostne kopije
                </CardTitle>
                <CardDescription>Varnostne kopije baze podatkov shranjene na strežniku. Priporočamo reden prenos na zunanji medij ali iDrive.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => { void fetchBackupi(); }} variant="outline" size="sm" disabled={backupLoading}>
                  <RefreshCw className={`w-4 h-4 ${backupLoading ? "animate-spin" : ""}`} />
                </Button>
                <Button variant="outline" onClick={() => void handleUstvariBackup("sql")} disabled={backupUstvariSqlLoading} title="Popolna SQL kopija (shema + podatki)">
                  {backupUstvariSqlLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Database className="w-4 h-4 mr-2" />}
                  SQL kopija
                </Button>
                <Button onClick={() => void handleUstvariBackup("json")} disabled={backupUstvariLoading} title="JSON kopija — odporna na spremembe sheme">
                  {backupUstvariLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Database className="w-4 h-4 mr-2" />}
                  JSON kopija
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {backupKopije.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <HardDrive className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Ni varnostnih kopij.</p>
                  <p className="text-xs mt-1">Kliknite "JSON kopija" ali "SQL kopija" za prvi backup.</p>
                  <Button variant="ghost" size="sm" className="mt-3" onClick={() => { void fetchBackupi(); }} disabled={backupLoading}>
                    <RefreshCw className={`w-4 h-4 mr-2 ${backupLoading ? "animate-spin" : ""}`} />
                    Naloži seznam
                  </Button>
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Ime datoteke</TableHead>
                      <TableHead className="hidden sm:table-cell">Datum</TableHead>
                      <TableHead className="hidden sm:table-cell text-right">Velikost</TableHead>
                      <TableHead></TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {backupKopije.map((k) => (
                      <TableRow key={k.ime}>
                        <TableCell className="font-mono text-xs">
                          <span className="mr-2">{k.ime}</span>
                          <Badge variant={k.ime.endsWith(".tar.gz") ? "outline" : "secondary"} className="text-[10px] px-1.5 py-0 shrink-0">
                            {k.ime.endsWith(".tar.gz") ? "SQL" : "JSON"}
                          </Badge>
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-sm text-muted-foreground">
                          {new Date(k.ustvarjen).toLocaleString("sl-SI")}
                        </TableCell>
                        <TableCell className="hidden sm:table-cell text-right text-sm text-muted-foreground">
                          {(k.velikost / 1024 / 1024).toFixed(1)} MB
                        </TableCell>
                        <TableCell>
                          <div className="flex justify-end gap-1">
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Prenesi"
                              asChild
                            >
                              <a href={`${base}/api/backup/${encodeURIComponent(k.ime)}/prenesi`} download>
                                <FolderDown className="w-4 h-4 text-muted-foreground" />
                              </a>
                            </Button>
                            {idriveStatus?.konfiguriran && (
                              <Button
                                variant="ghost"
                                size="icon"
                                title="Naloži na iDrive"
                                onClick={() => handleNaloziNaIdrive(k.ime)}
                                disabled={backupNaloziIme === k.ime}
                              >
                                {backupNaloziIme === k.ime
                                  ? <Loader2 className="w-4 h-4 animate-spin" />
                                  : <CloudUpload className="w-4 h-4 text-muted-foreground" />
                                }
                              </Button>
                            )}
                            <Button
                              variant="ghost"
                              size="icon"
                              title="Izbriši"
                              onClick={() => handleBrisiBackup(k.ime)}
                            >
                              <Trash2 className="w-4 h-4 text-destructive" />
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>

          {/* Restore card */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Database className="w-5 h-5" />
                Obnovitev iz datoteke
              </CardTitle>
              <CardDescription>
                Naložite JSON kopijo <code className="text-xs bg-muted px-1 rounded">.gz</code> ali SQL kopijo <code className="text-xs bg-muted px-1 rounded">.tar.gz</code> za obnovitev baze podatkov.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 rounded-lg border border-yellow-200 bg-yellow-50 flex gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
                <p className="text-sm text-yellow-800">
                  Obnovitev <strong>prepiše vse trenutne podatke</strong> v bazi (naročila, računi, artikli, nastavitve). Tega dejanja ni mogoče razveljaviti. Pred obnovitvijo priporočamo ustvaritev nove kopije.
                </p>
              </div>
              <input
                ref={backupFileRef}
                type="file"
                accept=".gz,.tar.gz,.sql"
                className="hidden"
                onChange={handleObnoviBackup}
              />
              <Button
                variant="outline"
                className="border-red-200 text-red-700 hover:bg-red-50"
                onClick={() => backupFileRef.current?.click()}
                disabled={backupObnoviLoading}
              >
                {backupObnoviLoading
                  ? <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  : <Upload className="w-4 h-4 mr-2" />
                }
                Izberi datoteko in obnovi bazo
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Moj profil ─────────────────────────────────────── */}
        <TabsContent value="moj-profil" className="space-y-6">

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" />Moj profil</CardTitle>
              <CardDescription>Posodobite svoje prikazno ime in e-poštni naslov.</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-1 mb-4 text-sm text-muted-foreground">
                <p><span className="font-medium text-foreground">Uporabnik:</span> {prijavljen?.username}</p>
                <p><span className="font-medium text-foreground">Vloga:</span> {prijavljen?.vloga}</p>
                {(prijavljen?.vloga === "admin_enote" || prijavljen?.vloga === "uporabnik") && (
                  <p>
                    <span className="font-medium text-foreground">Enota:</span>{" "}
                    <span className="text-foreground">
                      {(enote ?? []).find((en: Enota) => en.id === prijavljen?.enotaId)?.ime ?? `(ID ${prijavljen?.enotaId})`}
                    </span>
                  </p>
                )}
                <p>
                  <span className="font-medium text-foreground">Prikazno ime:</span>{" "}
                  <span className="text-foreground">{prijavljen?.ime}</span>
                </p>
                <p>
                  <span className="font-medium text-foreground">Trenutni e-mail:</span>{" "}
                  {prijavljen?.email
                    ? <span className="text-foreground">{prijavljen.email}</span>
                    : <span className="italic">ni nastavljen</span>}
                </p>
              </div>
              <form onSubmit={handleUpdateProfilEmail} className="max-w-sm space-y-4">
                <div className="space-y-2">
                  <Label>Prikazno ime</Label>
                  <Input
                    type="text"
                    autoComplete="name"
                    placeholder="Janez Novak"
                    value={profilIme}
                    onChange={e => setProfilIme(e.target.value)}
                    disabled={profilEmailLoading}
                  />
                  <p className="text-xs text-muted-foreground">Ime, ki se prikazuje v aplikaciji.</p>
                </div>
                <div className="space-y-2">
                  <Label>E-poštni naslov</Label>
                  <Input
                    type="email"
                    autoComplete="email"
                    placeholder="janez@restavracija.si"
                    value={profilEmail ?? ""}
                    onChange={e => setProfilEmail(e.target.value)}
                    disabled={profilEmailLoading}
                  />
                  <p className="text-xs text-muted-foreground">Naslov, na katerega boste prejeli ponastavitev gesla.</p>
                </div>
                {profilEmailNapaka && <p className="text-sm text-destructive font-medium">{profilEmailNapaka}</p>}
                <Button type="submit" disabled={profilEmailLoading}>
                  {profilEmailLoading
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Shranjujem...</>
                    : <><Save className="h-4 w-4 mr-2" />Shrani profil</>}
                </Button>
              </form>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><KeyRound className="h-5 w-5" />Sprememba gesla</CardTitle>
              <CardDescription>Spremenite geslo za prijavo v aplikacijo.</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleSpremembaGesla} className="max-w-sm space-y-4">
                <div className="space-y-2">
                  <Label>Trenutno geslo</Label>
                  <Input type="password" autoComplete="current-password" value={gTrenutno} onChange={e => setGTrenutno(e.target.value)} disabled={gLoading} />
                </div>
                <div className="space-y-2">
                  <Label>Novo geslo</Label>
                  <Input type="password" autoComplete="new-password" value={gNovo} onChange={e => setGNovo(e.target.value)} disabled={gLoading} />
                </div>
                <div className="space-y-2">
                  <Label>Ponovite novo geslo</Label>
                  <Input type="password" autoComplete="new-password" value={gPonovitev} onChange={e => setGPonovitev(e.target.value)} disabled={gLoading} />
                </div>
                {gNapaka && <p className="text-sm text-destructive font-medium">{gNapaka}</p>}
                <Button type="submit" disabled={gLoading || !gTrenutno || !gNovo || !gPonovitev}>
                  {gLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Shranjujem...</> : "Spremeni geslo"}
                </Button>
              </form>
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── Glasovni ukazi — sinonimi ───────────────────────────── */}
        <TabsContent value="glasovni-ukazi">
          <GlasovniUkaziZavihek />
        </TabsContent>

        {/* ── Nastavitve (FURS, SMTP, certifikat, PP, terminal, testi) ── */}
        <TabsContent value="nastavitve" className="space-y-6">

      {(jeAdmin || jeAdminEnote) && !jeSuperAdmin && (<>
      {/* ── Prikaz naročil ──────────────────────────────────────── */}
      <Card id="ns-prikaz">
        <CardHeader>
          <CardTitle>Prikaz naročil</CardTitle>
          <CardDescription>Način združevanja podobnih artiklov v meniju naročila.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          {(["novo", "staro", "izklopljeno"] as const).map(nacin => {
            const labels: Record<string, { naziv: string; opis: string }> = {
              novo:        { naziv: "Novi sistem (drsni panel)", opis: "Variante se odprejo v drsnem panelu od spodaj — velik, jasen prikaz s cenami in razlikovalnim opisom. Priporočeno." },
              staro:       { naziv: "Stari sistem (mali popover)", opis: "Variante se pokažejo v majhnem oblačičku nad gumbom — kompaktno, brez drsenja." },
              izklopljeno: { naziv: "Izklopljeno", opis: "Vse artikle prikaži ločeno — brez združevanja podobnih imen." },
            };
            const l = labels[nacin]!;
            return (
              <label
                key={nacin}
                className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${grupiranjeNacin === nacin ? "border-primary bg-primary/5" : "hover:bg-muted/50"}`}
              >
                <input
                  type="radio"
                  name="grupiranjeNacin"
                  value={nacin}
                  checked={grupiranjeNacin === nacin}
                  onChange={() => setGrupiranjeNacin(nacin)}
                  className="mt-0.5 accent-primary"
                />
                <div>
                  <p className="text-sm font-medium">{l.naziv}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{l.opis}</p>
                </div>
              </label>
            );
          })}
        </CardContent>
        {jeAdminEnote && !jeAdmin && (
          <CardFooter className="justify-end border-t pt-4">
            <Button
              size="sm"
              onClick={handleSaveGrupiranje}
              disabled={grupiranjeNacinShranjujem}
            >
              <Save className="h-4 w-4 mr-2" />
              {grupiranjeNacinShranjujem ? "Shranjujem..." : "Shrani prikaz naročil"}
            </Button>
          </CardFooter>
        )}
      </Card>
      </>)}

      {/* ── Windows tiskalni agent ──────────────────────────── */}
      {!jeSuperAdmin && navigator.userAgent.includes("Windows") && (<Card id="ns-agent">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Printer className="w-4 h-4" />
            Windows tiskalni agent
          </CardTitle>
          <CardDescription>
            Enostavno tihо tiskanje na USB termalni tiskalnik — brez certifikatov in QZ Tray nastavitev.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">
          {nastavitve?.agentTiskalnikToken ? (
            <>
              {/* Korak 1 — ime tiskalnika */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold">1. Ime Windows tiskalnika</Label>
                <p className="text-xs text-muted-foreground">
                  V PowerShell zaženite <code className="bg-muted px-1 rounded">Get-WmiObject Win32_Printer | Select-Object Name</code> in vpišite točno ime (npr. <code>POS-58</code>).
                </p>
                <div className="flex gap-2">
                  <Input
                    value={agentTiskalnikIme}
                    onChange={e => setAgentTiskalnikIme(e.target.value)}
                    placeholder="npr. POS-58"
                    className="text-sm font-mono"
                  />
                  <Button
                    type="button"
                    size="sm"
                    onClick={() => updateNapraveTerminali.mutate({ data: { agentTiskalnikIme } }, {
                      onSuccess: () => { updateTerminalConfig({ agentTiskalnikIme }); toast({ title: "Ime tiskalnika shranjeno" }); },
                      onError: () => toast({ title: "Napaka", description: "Nastavitve ni bilo mogoče shraniti.", variant: "destructive" }),
                    })}
                    disabled={updateNapraveTerminali.isPending || !agentTiskalnikIme.trim()}
                  >
                    {updateNapraveTerminali.isPending ? "Shranjujem…" : "Shrani"}
                  </Button>
                </div>
              </div>

              {/* Širina tiskalnika */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold">2. Širina tiskalnika</Label>
                <p className="text-xs text-muted-foreground">
                  Izberite širino papirja vašega tiskalnika (58 mm ali 80 mm).
                </p>
                <div className="flex gap-2 items-center">
                  <select
                    className="border rounded px-2 py-1 text-sm bg-background"
                    value={tiskalnikSirina}
                    onChange={e => {
                      const v = Number(e.target.value) as 58 | 80;
                      setTiskalnikSirina(v);
                      updateNapraveTerminali.mutate({ data: { tiskalnikSirina: v } }, {
                        onSuccess: () => { updateTerminalConfig({ tiskalnikSirina: v }); toast({ title: `Širina tiskalnika nastavljena na ${v} mm` }); },
                        onError: () => toast({ title: "Napaka", description: "Nastavitve ni bilo mogoče shraniti.", variant: "destructive" }),
                      });
                    }}
                  >
                    <option value={58}>58 mm (32 stolpcev)</option>
                    <option value={80}>80 mm (40 stolpcev)</option>
                  </select>
                </div>
              </div>

              {/* Korak 3 — prenos skripte */}
              <div className="space-y-2">
                <Label className="text-xs font-semibold">3. Prenesite in zaženite agent</Label>
                <p className="text-xs text-muted-foreground">
                  Prenesite <strong>obe datoteki</strong> in ju shranite v isto mapo (npr. <code className="bg-muted px-1 rounded">C:\POS\</code>).
                  Nato <strong>dvokliknite <code className="bg-muted px-1 rounded">pozeni-agent.bat</code></strong> — agent se zažene brez varnostnih pozivov
                  in se samodejno vpiše v <strong>Startup mapo</strong> za samodejni zagon ob vsaki prijavi.
                </p>
                {agentTiskalnikIme.trim() ? (
                  <div className="flex gap-2 flex-wrap">
                    <a href="/api/print/agent/skript.ps1" download="pos-tiskalnik.ps1" className="inline-flex">
                      <Button type="button" size="sm" variant="outline" className="gap-2">
                        <Printer className="w-4 h-4" />
                        1. pos-tiskalnik.ps1
                      </Button>
                    </a>
                    <a href="/api/print/agent/pozeni.bat" download="pozeni-agent.bat" className="inline-flex">
                      <Button type="button" size="sm" className="gap-2">
                        <Printer className="w-4 h-4" />
                        2. pozeni-agent.bat
                      </Button>
                    </a>
                  </div>
                ) : (
                  <p className="text-xs text-amber-600 font-medium">⚠ Najprej vpišite in shranite ime tiskalnika (korak 1)</p>
                )}

              </div>

              {/* Žeton (za napredne) */}
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">API žeton (za ročno konfiguracijo)</summary>
                <div className="flex gap-2 items-center mt-2">
                  <code className="flex-1 rounded bg-muted px-2 py-1 font-mono break-all select-all">
                    {nastavitve.agentTiskalnikToken}
                  </code>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={() => {
                      navigator.clipboard.writeText(nastavitve.agentTiskalnikToken ?? "").catch(() => {});
                      toast({ title: "Token kopiran" });
                    }}
                  >
                    Kopiraj
                  </Button>
                </div>
              </details>
            </>
          ) : (
            <p className="text-muted-foreground text-xs">Nalagam žeton…</p>
          )}
        </CardContent>
      </Card>)}

      {/* ── FURS & Račun (samo admin podjetja) ───────────────── */}
      {jeAdmin && !jeSuperAdmin && <Card id="ns-furs">
        <CardHeader>
          <CardTitle>Podatki za FURS in račune</CardTitle>
          <CardDescription>
            Ti podatki se vpišejo v vsak fiskalni račun in posredujejo FURS-u pri potrditvi.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {nastavitveLoading ? (
            <div className="h-40 animate-pulse bg-muted rounded-lg" />
          ) : (
            <>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Naziv podjetja</Label>
                  <Input
                    placeholder="Restavracija pri Janezu d.o.o."
                    value={nazivRestavracije}
                    onChange={e => setNazivRestavracije(e.target.value)}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="space-y-2 sm:col-span-2">
                  <Label>Ulica in hišna številka</Label>
                  <Input
                    placeholder="Slovenska cesta 1"
                    value={naslovUlica}
                    onChange={e => {
                      setNaslovUlica(e.target.value);
                      // Posodobi tudi sestavljeni naslov za nazaj-kompatibilnost
                      const deli = [e.target.value, naslovPostna && naslovKraj ? `${naslovPostna} ${naslovKraj}` : naslovKraj].filter(Boolean);
                      setNaslovRestavracije(deli.join(", "));
                    }}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Poštna številka</Label>
                  <Input
                    placeholder="1000"
                    value={naslovPostna}
                    onChange={e => {
                      setNaslovPostna(e.target.value);
                      const deli = [naslovUlica, e.target.value && naslovKraj ? `${e.target.value} ${naslovKraj}` : naslovKraj].filter(Boolean);
                      setNaslovRestavracije(deli.join(", "));
                    }}
                  />
                </div>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Kraj</Label>
                  <Input
                    placeholder="Ljubljana"
                    value={naslovKraj}
                    onChange={e => {
                      setNaslovKraj(e.target.value);
                      const deli = [naslovUlica, naslovPostna && e.target.value ? `${naslovPostna} ${e.target.value}` : e.target.value].filter(Boolean);
                      setNaslovRestavracije(deli.join(", "));
                    }}
                  />
                </div>
              </div>

              <Separator />

              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Davčni podatki</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Davčna številka</Label>
                  <Input
                    placeholder="12345678"
                    value={davcnaStevilka}
                    onChange={e => setDavcnaStevilka(e.target.value)}
                    className="max-w-xs"
                  />
                  <p className="text-xs text-muted-foreground">Brez predpone SI</p>
                </div>
              </div>
              <p className="text-xs text-muted-foreground">
                ID poslovnega prostora (PP) in ID elektronske naprave (B) se upravljajo v sekciji <strong>Blagajne (FURS identifikatorji)</strong> spodaj.
              </p>
              <div className="space-y-2">
                <Label>Davčna št. ponudnika programske opreme</Label>
                <Input
                  placeholder="12345678"
                  value={ponudnikDavcna}
                  onChange={e => setPonudnikDavcna(e.target.value)}
                  className="max-w-xs"
                />
                <p className="text-xs text-muted-foreground">
                  <code>SoftwareSupplierTaxNumber</code> za FURS — davčna številka razvijalca/vzdrževalca programske opreme.
                  Če je prazno, se uporabi davčna številka zavezanca zgoraj.
                </p>
              </div>

              <Separator />

              {aktivnaEnotaIme && (
                <div className="flex items-center gap-2 rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
                  <Building2 className="h-4 w-4 shrink-0 text-blue-600" />
                  <span>Naslednje nastavitve (testni način, FURS proxy, certifikat, PP/BB kode) so shranjene <strong>na nivoju podjetja</strong> in veljajo za vse enote.</span>
                </div>
              )}

              <div className="rounded-lg border p-3 space-y-3">
                <div>
                  <p className="font-medium text-sm">Način pošiljanja FURS</p>
                  <p className="text-xs text-muted-foreground">Določa kako se računi in registracije pošiljajo na FURS</p>
                </div>
                <RadioGroup value={fursNacin} onValueChange={(v) => setFursNacin(v as typeof fursNacin)} className="space-y-1.5">
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="simulacija" id="furs-sim" className="mt-0.5" />
                    <Label htmlFor="furs-sim" className="font-normal cursor-pointer">
                      <span className="font-medium">Simulacija</span>
                      <span className="block text-xs text-muted-foreground">Lokalna simulacija brez FURS — ZOI (MD5) in EOR (UUID) se računata lokalno</span>
                    </Label>
                  </div>
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="testno" id="furs-testno-opt" className="mt-0.5" />
                    <Label htmlFor="furs-testno-opt" className="font-normal cursor-pointer">
                      <span className="font-medium">Testni strežnik FURS</span>
                      <span className="block text-xs text-muted-foreground">blagajne-test.fu.gov.si — zahteva certifikat FURS</span>
                    </Label>
                  </div>
                  <div className="flex items-start space-x-2">
                    <RadioGroupItem value="produkcija" id="furs-prod-opt" className="mt-0.5" />
                    <Label htmlFor="furs-prod-opt" className="font-normal cursor-pointer">
                      <span className="font-medium">Produkcija</span>
                      <span className="block text-xs text-muted-foreground">blagajne.fu.gov.si — zahteva produkcijski certifikat FURS</span>
                    </Label>
                  </div>
                </RadioGroup>
                {fursNacin === "produkcija" && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800">
                    <p className="font-semibold">Produkcijski način</p>
                    <p className="text-amber-700">Za produkcijsko ZOI podpisovanje je potreben produkcijski digitalni certifikat FURS. Testni certifikat ne deluje na produkcijskem strežniku.</p>
                  </div>
                )}
              </div>

              <div className={`flex items-center justify-between rounded-lg border p-3 ${simulirajFursNapako ? "border-red-300 bg-red-50" : ""}`}>
                <div>
                  <p className="font-medium text-sm">Simuliraj napako FURS</p>
                  <p className="text-xs text-muted-foreground">
                    {simulirajFursNapako
                      ? "Vsak poskus izdaje/storna vrne napako FURS sistema (S100) — blagajna ne izda računa"
                      : "Normalno delovanje — računi se pošiljajo na FURS"}
                  </p>
                </div>
                <Switch checked={simulirajFursNapako} onCheckedChange={setSimulirajFursNapako} />
              </div>
              {simulirajFursNapako && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <p className="font-semibold">Simulacija napake je aktivna</p>
                  <p className="text-red-700">Noben račun ne bo izdan, dokler je ta možnost vklopljena. Namenjena izključno testiranju odpornosti blagajne.</p>
                </div>
              )}

              <Separator />

              <div className="space-y-2">
                <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">FURS Proxy URL</p>
                <p className="text-xs text-muted-foreground">
                  URL PHP proxy skripta na slovenskem strežniku za FURS komunikacijo. Replit ima ameriški IP, ki ga FURS WAF blokira.
                  Proxy prejme podpisani SOAP zahtevek in ga posreduje FURS-u iz slovenskega IP-ja.
                  Pustite prazno za direktno komunikacijo (za lokalno namestitev).
                </p>
                <div className="flex gap-2">
                  <Input
                    placeholder="https://www.bookie.si/abc/dlb/furs-proxy.php"
                    value={fursProxyUrl}
                    onChange={e => setFursProxyUrl(e.target.value)}
                    className="flex-1"
                  />
                  <Button variant="outline" onClick={handleFursEcho} disabled={fursEchoTesting}>
                    {fursEchoTesting ? <RefreshCw className="h-4 w-4 animate-spin" /> : <Wifi className="h-4 w-4" />}
                    <span className="ml-2">Testiraj FURS</span>
                  </Button>
                </div>
                {fursEchoResult && (
                  <div className={`text-xs rounded p-2 font-mono whitespace-pre-wrap border ${fursEchoResult.uspeh ? "bg-green-50 border-green-200 text-green-800" : "bg-red-50 border-red-200 text-red-800"}`}>
                    {fursEchoResult.uspeh
                      ? `✅ Echo uspešen (HTTP ${fursEchoResult.statusCode})\n${(fursEchoResult.body ?? "").slice(0, 400)}`
                      : `❌ Napaka: ${fursEchoResult.napaka ?? ""}\nHTTP ${fursEchoResult.statusCode ?? 0}\n${(fursEchoResult.body ?? "").slice(0, 300)}`
                    }
                  </div>
                )}
              </div>

              <Separator />

              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Globalni digitalni certifikat za produkcijsko ZOI</p>
              {(nastavitve as { certifikatNaložen?: boolean })?.certifikatNaložen ? (
                <div className="flex items-center gap-2 rounded-lg border border-green-200 bg-green-50 px-4 py-3">
                  <ShieldCheck className="h-4 w-4 text-green-600 shrink-0" />
                  <span className="text-sm font-medium text-green-800">Certifikat je naložen v bazo in aktiven</span>
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded-lg border border-amber-200 bg-amber-50 px-4 py-3">
                  <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                  <span className="text-sm font-medium text-amber-800">Certifikat ni naložen — računi bodo simulirani</span>
                </div>
              )}
              <p className="text-xs text-muted-foreground">
                Certifikat se shrani v bazo podatkov in je na voljo tudi po restartu strežnika ter v produkcijskem okolju.
                Naložite ga s kartico <strong>Digitalni certifikat FURS</strong> spodaj.
              </p>

              <Separator />

              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pozdrav na računu</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Prva vrstica</Label>
                  <Input
                    placeholder="Hvala za obisk!"
                    value={racunPozdrav1}
                    onChange={e => setRacunPozdrav1(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Druga vrstica</Label>
                  <Input
                    placeholder="Vracamo se — se vidimo."
                    value={racunPozdrav2}
                    onChange={e => setRacunPozdrav2(e.target.value)}
                  />
                </div>
              </div>

              <Separator />

              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Negotovinsko plačilo (TRR)</p>
              <p className="text-xs text-muted-foreground">Podatki se prikažejo na računu, ko je izbrano plačilo na TRR. Kupec mora biti vnesen.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>IBAN prodajalca</Label>
                  <Input
                    placeholder="SI56 1234 5678 9012 345"
                    value={prodajalecIban}
                    onChange={e => setProdajalecIban(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>BIC / SWIFT koda banke</Label>
                  <Input
                    placeholder="LJBASI2X"
                    value={prodajalecBic}
                    onChange={e => setProdajalecBic(e.target.value)}
                  />
                </div>
              </div>

              <Separator />

              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Zakonski podatki v nogi računa (ZGD-1)</p>
              <p className="text-xs text-muted-foreground">Ti podatki so obvezni za d.o.o. in d.d. — izpusti polja, ki zate ne veljajo.</p>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Matična številka</Label>
                  <Input
                    placeholder="npr. 1234567000"
                    value={racunMaticna}
                    onChange={e => setRacunMaticna(e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label>Sodišče vpisa in vložek</Label>
                  <Input
                    placeholder="npr. Okrožno sodišče v LJ, reg. vl. 12345/2020"
                    value={racunSodisce}
                    onChange={e => setRacunSodisce(e.target.value)}
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label>Osnovni kapital</Label>
                <Input
                  placeholder="npr. Osnovni kapital 7.500,00 EUR, vplačan v celoti"
                  value={racunKapital}
                  onChange={e => setRacunKapital(e.target.value)}
                />
              </div>

              <Separator />

              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">DDV klavzula</p>
              <p className="text-xs text-muted-foreground">Izpolni samo če ste mali zavezanci ali velja obrnjeno davčno breme. Prikaže se v nogi vsakega računa.</p>
              <div className="space-y-2">
                <Label>Besedilo DDV klavzule</Label>
                <Input
                  placeholder="npr. DDV ni obračunan na podlagi prvega odstavka 94. člena ZDDV-1."
                  value={racunDdvKlavzula}
                  onChange={e => setRacunDdvKlavzula(e.target.value)}
                />
              </div>

              <Separator />

              <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Pravna opomba</p>
              <p className="text-xs text-muted-foreground">Neobvezno — prikaže se v nogi vsakega računa (npr. lastninski pridržek, zamudne obresti, sodišče).</p>
              <div className="space-y-2">
                <Label>Besedilo pravne opombe</Label>
                <Input
                  placeholder="npr. V primeru zamude plačila si pridržujemo pravico do zakonskih zamudnih obresti."
                  value={racunPravnaKlavzula}
                  onChange={e => setRacunPravnaKlavzula(e.target.value)}
                />
              </div>

              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 space-y-1">
                <p className="font-semibold">Zahtevani podatki za pravo fiskalizacijo:</p>
                <ul className="list-disc list-inside space-y-0.5 text-blue-700">
                  <li>Davčna številka zavezanca za DDV (brez predpone SI)</li>
                  <li>ID poslovnega prostora — pridobi ga z obrazcem na FURS portalu</li>
                  <li>ID elektronske naprave (blagajne) — pridobi ga z obrazcem na FURS portalu</li>
                  <li>Digitalno potrdilo FURS (za produkcijski način) — naloži ga v strežnik</li>
                </ul>
              </div>
            </>
          )}
        </CardContent>
      </Card>}

      {/* ── Blagajne (FURS identifikatorji) ─────────────────── */}
      {jeAdmin && !jeSuperAdmin && (
      <Card id="ns-blagajne">
        <CardHeader>
          <CardTitle>Blagajne (FURS identifikatorji)</CardTitle>
          <CardDescription>
            Vsaka blagajna ima edinstveno kombinacijo ID poslovnega prostora (PP) in ID elektronske naprave (B), registriranih pri FURS.
            Vsaka kombinacija PP+B vzdržuje lastno zaporedje številk računov.
            Admin podjetja in admin enote izbereta aktivno blagajno v blagajniškem vmesniku.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {(blagajne?.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">Ni dodanih blagajn. Dodajte vsaj eno za ločeno sledenje zaporednih številk računov.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Naziv</TableHead>
                  <TableHead>PP ID</TableHead>
                  <TableHead>B ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {blagajne!.map(b => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.ime}</TableCell>
                    <TableCell><code className="text-xs bg-muted px-1 py-0.5 rounded">{b.ppId}</code></TableCell>
                    <TableCell><code className="text-xs bg-muted px-1 py-0.5 rounded">{b.bId}</code></TableCell>
                    <TableCell>
                      <Badge variant={b.aktivna ? "default" : "secondary"}>{b.aktivna ? "Aktivna" : "Neaktivna"}</Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button size="icon" variant="ghost" onClick={() => openEditBlagajna(b)}><Pencil className="h-4 w-4" /></Button>
                        <Button size="icon" variant="ghost" className="text-destructive hover:text-destructive" onClick={() => handleDeleteBlagajna(b.id)}><Trash2 className="h-4 w-4" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
          <Separator />
          <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide">Dodaj blagajno</p>
          <form onSubmit={handleCreateBlagajna} className="space-y-3">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="space-y-1">
                <Label>Naziv blagajne</Label>
                <Input placeholder="Blagajna 1" value={bIme} onChange={e => setBIme(e.target.value)} />
              </div>
              <div className="space-y-1">
                <Label>ID poslovnega prostora</Label>
                <Input placeholder="PP001" value={bPpId} onChange={e => setBPpId(e.target.value)} className="font-mono" />
                <p className="text-xs text-muted-foreground">Registriran pri FURS</p>
              </div>
              <div className="space-y-1">
                <Label>ID elektronske naprave</Label>
                <Input placeholder="B001" value={bBId} onChange={e => setBBId(e.target.value)} className="font-mono" />
                <p className="text-xs text-muted-foreground">Registrirana pri FURS</p>
              </div>
            </div>
            <Button type="submit" disabled={createBlagajna.isPending}>
              {createBlagajna.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Dodajam...</> : <><PlusCircle className="h-4 w-4 mr-2" />Dodaj blagajno</>}
            </Button>
          </form>
        </CardContent>
      </Card>
      )}

      {/* Uredi blagajno dialog */}
      <Dialog open={bDialogOpen} onOpenChange={setBDialogOpen}>
        <DialogContent>
          <DialogHeader><DialogTitle>Uredi blagajno</DialogTitle></DialogHeader>
          <form onSubmit={handleUpdateBlagajna} className="space-y-4">
            <div className="space-y-1">
              <Label>Naziv blagajne</Label>
              <Input value={editBIme} onChange={e => setEditBIme(e.target.value)} placeholder="Blagajna 1" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label>ID poslovnega prostora</Label>
                <Input value={editBPpId} onChange={e => setEditBPpId(e.target.value)} placeholder="PP001" className="font-mono" />
              </div>
              <div className="space-y-1">
                <Label>ID elektronske naprave</Label>
                <Input value={editBBId} onChange={e => setEditBBId(e.target.value)} placeholder="B001" className="font-mono" />
              </div>
            </div>
            <div className="flex items-center gap-2">
              <Switch checked={editBAktivna} onCheckedChange={setEditBAktivna} id="blagajna-aktivna" />
              <Label htmlFor="blagajna-aktivna">Aktivna</Label>
            </div>
            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setBDialogOpen(false)}>Prekliči</Button>
              <Button type="submit" disabled={!editBIme.trim() || !editBPpId.trim() || !editBBId.trim() || updateBlagajnaMut.isPending}>
                {updateBlagajnaMut.isPending ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Shranjujem...</> : "Shrani"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── SMTP e-pošta ──────────────────────────────────────── */}
      {jeSuperAdmin && (
        <Card id="ns-smtp">
          <CardHeader>
            <CardTitle className="flex items-center gap-2"><Mail className="h-5 w-5" />E-pošta (SMTP)</CardTitle>
            <CardDescription>
              Ko je SMTP konfiguriran in aktiven, sistem samodejno pošlje zaposlenim začasno geslo ob resetu računa.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center justify-between rounded-lg border p-3">
              <div>
                <p className="font-medium text-sm">Pošiljanje e-pošte aktivirano</p>
                <p className="text-xs text-muted-foreground">Ko je izklopljeno, se e-pošta ne pošilja — geslo sporočite ročno.</p>
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
                  <p className="text-xs text-green-700 font-medium">✓ Geslo je nastavljeno — pustite prazno, da ga obdržite</p>
                )}
                <div className="relative">
                  <Input
                    type={smtpPokaziGeslo ? "text" : "password"}
                    autoComplete="new-password"
                    placeholder={smtpGesloNastavljeno ? "Novo geslo (pustite prazno za ohranitev)" : "geslo ali app password"}
                    value={smtpNovGeslo}
                    onChange={e => setSmtpNovGeslo(e.target.value)}
                    disabled={!smtpAktiven}
                  />
                  <button type="button" onClick={() => setSmtpPokaziGeslo(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {smtpPokaziGeslo ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
            </div>

            <div className="space-y-2 max-w-sm">
              <Label>E-pošta pošiljatelja (From)</Label>
              <Input type="email" placeholder="pos@restavracija.si" value={smtpFrom} onChange={e => setSmtpFrom(e.target.value)} disabled={!smtpAktiven} />
              <p className="text-xs text-muted-foreground">Naslov, ki se prikaže kot pošiljatelj v e-pošti.</p>
            </div>

            {smtpAktiven && (
              <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 space-y-1">
                <p className="font-semibold">Nasveti za konfiguracijo:</p>
                <ul className="list-disc list-inside space-y-0.5 text-blue-700 text-xs">
                  <li>Gmail: strežnik <code>smtp.gmail.com</code>, vrata <code>587</code>, uporabite App Password (ne navadnega gesla)</li>
                  <li>Outlook/Office365: strežnik <code>smtp.office365.com</code>, vrata <code>587</code></li>
                  <li>Nastavitve shranite s klikom na <strong>Shrani vse nastavitve</strong> spodaj.</li>
                </ul>
              </div>
            )}

            <Separator />

            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium">Preizkus SMTP</p>
                <p className="text-xs text-muted-foreground">Pošljite testno sporočilo, da preverite delovanje SMTP.</p>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => { setSmtpTestRezultat(null); setSmtpTestPrejemnik(""); setSmtpTestDialogOpen(true); }}
                disabled={!smtpGesloNastavljeno && !smtpNovGeslo}
              >
                <Send className="h-4 w-4 mr-2" />
                Pošlji testno e-pošto
              </Button>
            </div>
          </CardContent>
        </Card>
      )}

      <Dialog open={smtpTestDialogOpen} onOpenChange={open => { setSmtpTestDialogOpen(open); if (!open) setSmtpTestRezultat(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Send className="h-5 w-5" />Pošlji testno e-pošto</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleSmtpTest} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="smtp-test-prejemnik">Prejemnik testnega sporočila</Label>
              <Input
                id="smtp-test-prejemnik"
                type="email"
                placeholder="admin@restavracija.si"
                value={smtpTestPrejemnik}
                onChange={e => setSmtpTestPrejemnik(e.target.value)}
                required
                disabled={smtpTestLoading}
              />
              <p className="text-xs text-muted-foreground">Na ta naslov bo poslano kratko testno sporočilo.</p>
            </div>

            {smtpTestRezultat && (
              <div className={`rounded-lg border p-3 text-sm ${smtpTestRezultat.uspeh ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>
                {smtpTestRezultat.uspeh ? (
                  <div className="flex items-center gap-2">
                    <CheckCircle2 className="h-4 w-4 shrink-0" />
                    <span>Testno sporočilo je bilo uspešno poslano!</span>
                  </div>
                ) : (
                  <div className="flex items-start gap-2">
                    <AlertCircle className="h-4 w-4 shrink-0 mt-0.5" />
                    <div>
                      <p className="font-medium">Pošiljanje ni uspelo</p>
                      <p className="text-xs mt-1 font-mono break-all">{smtpTestRezultat.napaka}</p>
                    </div>
                  </div>
                )}
              </div>
            )}

            <div className="flex justify-end gap-2">
              <Button type="button" variant="outline" onClick={() => setSmtpTestDialogOpen(false)}>Zapri</Button>
              <Button type="submit" disabled={smtpTestLoading || !smtpTestPrejemnik}>
                {smtpTestLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Pošiljam…</> : <><Send className="h-4 w-4 mr-2" />Pošlji</>}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {!jeSuperAdmin && !jeUporabnik && (<>
      {/* ── Digitalni certifikat FURS ─────────────────────────── */}
      <Card id="ns-certifikat">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileKey className="h-5 w-5" />
            Digitalni certifikat FURS
            {aktivnaEnotaIme && (
              <Badge variant="outline" className="ml-2 text-xs font-normal text-blue-700 border-blue-200 bg-blue-50">
                <Building2 className="h-3 w-3 mr-1" />{aktivnaEnotaIme}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Naložite certifikat (.p12), ki ste ga prejeli od FURS. Program ga samodejno pretvori v PEM format in shrani v bazo podatkov — trajno, tudi po restartu.
            <span className="block mt-1 text-blue-700">Certifikat je shranjen na nivoju podjetja in velja za vse poslovne enote.</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Trenutni certifikat */}
          <div>
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Trenutni certifikat v bazi</p>
            {!certInfo ? (
              <div className="h-10 animate-pulse bg-muted rounded-lg" />
            ) : certInfo.najden ? (
              <div className={`rounded-lg border p-4 space-y-2 ${certInfo.opozorilo ? "border-amber-300 bg-amber-50" : "border-green-200 bg-green-50"}`}>
                <div className="flex items-center gap-2">
                  {certInfo.opozorilo
                    ? <AlertTriangle className="h-4 w-4 text-amber-600 shrink-0" />
                    : <ShieldCheck className="h-4 w-4 text-green-600 shrink-0" />}
                  <span className={`text-sm font-semibold ${certInfo.opozorilo ? "text-amber-800" : "text-green-800"}`}>
                    {certInfo.opozorilo
                      ? `Certifikat poteče čez ${certInfo.dniDoIzteka} dni!`
                      : `Certifikat je veljaven še ${certInfo.dniDoIzteka} dni`}
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                  <div><span className="font-medium text-foreground">Subjekt:</span> {certInfo.subjekt}</div>
                  <div><span className="font-medium text-foreground">Izdajatelj:</span> {certInfo.izdajatelj}</div>
                  <div><span className="font-medium text-foreground">Veljavno od:</span> {certInfo.veljavnoOd?.slice(0, 10)}</div>
                  <div><span className="font-medium text-foreground">Poteče:</span> {certInfo.veljavnoDo?.slice(0, 10)}</div>
                  <div className="col-span-2 font-mono text-xs break-all opacity-70">{certInfo.certPot}</div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Certifikat ni najden na strežniku. {certInfo.napaka}
              </div>
            )}
          </div>

          <Separator />

          {/* Nalaganje .p12 */}
          <div>
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Naložite nov certifikat (.p12)</p>
            <form onSubmit={handleP12Upload} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label>Datoteka .p12</Label>
                  <input
                    ref={p12FileRef}
                    type="file"
                    accept=".p12,.pfx"
                    required
                    className="flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                  <p className="text-xs text-muted-foreground">Datoteka s končnico .p12 ali .pfx</p>
                </div>
                <div className="space-y-2">
                  <Label>Geslo certifikata</Label>
                  <Input
                    type="password"
                    placeholder="Vnesite geslo za .p12"
                    value={p12Geslo}
                    onChange={e => setP12Geslo(e.target.value)}
                    autoComplete="new-password"
                  />
                  <p className="text-xs text-muted-foreground">Geslo, ki ste ga nastavili ob izvozu certifikata</p>
                </div>
              </div>
              <div className="space-y-2 max-w-xs">
                <Label>Ime datoteke na strežniku</Label>
                <Input
                  placeholder="furs-cert.pem"
                  value={p12Ime}
                  onChange={e => setP12Ime(e.target.value)}
                />
                <p className="text-xs text-muted-foreground">Certifikat se shrani v mapo <code>certs/</code> na strežniku</p>
              </div>

              {p12Rezultat && (
                <div className={`rounded-lg border p-3 text-sm ${p12Rezultat.uspeh ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>
                  {p12Rezultat.uspeh ? (
                    <div className="space-y-1">
                      <p className="font-semibold flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Certifikat uspešno naložen!</p>
                      {p12Rezultat.subjekt && <p className="text-xs">Subjekt: {p12Rezultat.subjekt}</p>}
                      {p12Rezultat.veljavnoDo && <p className="text-xs">Poteče: {p12Rezultat.veljavnoDo.slice(0, 10)} ({p12Rezultat.dniDoIzteka} dni)</p>}
                      <p className="text-xs font-mono opacity-70">{p12Rezultat.certPot}</p>
                    </div>
                  ) : (
                    <p className="font-medium flex items-center gap-2"><AlertCircle className="h-4 w-4" /> {p12Rezultat.napaka}</p>
                  )}
                </div>
              )}

              <Button type="submit" disabled={p12Uploading} className="gap-2">
                {p12Uploading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
                {p12Uploading ? "Pretvarjam in nalagam..." : "Naloži in pretvori certifikat"}
              </Button>
            </form>
          </div>

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-xs text-blue-700 space-y-1">
            <p className="font-semibold text-blue-800">Postopek nalaganja certifikata:</p>
            <ol className="list-decimal list-inside space-y-0.5">
              <li>Iz FURS portala prejmete datoteko s končnico <code>.p12</code></li>
              <li>Izberite datoteko in vnesite geslo, ki ste ga nastavili pri izvozu</li>
              <li>Program samodejno pretvori v PEM format in shrani na strežnik</li>
              <li>Po uspešnem nalaganju posodobite pot v <strong>Nastavitve FURS</strong> zgoraj, če se razlikuje od privzetka</li>
            </ol>
          </div>
        </CardContent>
      </Card>
      </>)}

      {/* ── Poslovni prostori ─────────────────────────────────── */}
      {!jeSuperAdmin && !jeUporabnik && (<>
      <Card id="ns-prostori">
        <CardHeader>
          <div className="flex items-start justify-between gap-4">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="h-5 w-5" />
                Poslovni prostori (FURS)
              </CardTitle>
              <CardDescription className="mt-1">
                Upravljaj registrirane poslovne prostore pri FURS. Vsak prostor mora biti registriran pred izdajo fiskalnih računov.
              </CardDescription>
            </div>
            <Button size="sm" className="shrink-0 gap-2" onClick={() => openPpDialog()}>
              <PlusCircle className="h-4 w-4" />
              Dodaj prostor
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          {(!poslovniProstori || poslovniProstori.length === 0) ? (
            <div className="rounded-lg border border-dashed p-6 text-center text-muted-foreground text-sm">
              Ni dodanih poslovnih prostorov. Kliknite <strong>Dodaj prostor</strong> za začetek.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ID prostora</TableHead>
                  <TableHead className="hidden sm:table-cell">Tip</TableHead>
                  <TableHead className="hidden md:table-cell">Naslov / identifikator</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {poslovniProstori.map(pp => (
                  <TableRow key={pp.id}>
                    <TableCell className="font-mono font-semibold">{pp.prostorId}</TableCell>
                    <TableCell className="hidden sm:table-cell">
                      <Badge variant="outline" className="text-xs">
                        {pp.tipProstora === "nepremicnina" ? "Nepremičnina"
                          : pp.tipProstora === "premicnina" ? "Premičnina"
                          : "⚠ Elektr. naprava (nepodprto)"}
                      </Badge>
                    </TableCell>
                    <TableCell className="hidden md:table-cell text-sm text-muted-foreground">
                      {pp.tipProstora === "nepremicnina"
                        ? [pp.ulica, pp.hisnaStevilka, pp.kraj].filter(Boolean).join(" ")
                        : pp.registrskaTablica ?? pp.vin ?? "—"}
                    </TableCell>
                    <TableCell>
                      {pp.zaprt
                        ? <Badge variant="outline" className="text-muted-foreground gap-1"><XCircle className="h-3 w-3" />Zaprt</Badge>
                        : pp.zadnjaRegistracija
                        ? <Badge className="bg-green-100 text-green-800 border-green-200 gap-1"><CheckCircle2 className="h-3 w-3" />Registriran</Badge>
                        : <Badge variant="outline" className="text-amber-700 border-amber-300 gap-1"><AlertCircle className="h-3 w-3" />Ni registriran</Badge>
                      }
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        {!pp.zaprt && (
                          <Button variant="outline" size="sm" className="gap-1 text-xs" onClick={() => openRegDialog(pp, "registriraj")}>
                            <RotateCcw className="h-3 w-3" />Registriraj
                          </Button>
                        )}
                        {!pp.zaprt && pp.zadnjaRegistracija && (
                          <Button variant="outline" size="sm" className="gap-1 text-xs text-destructive border-destructive/40 hover:bg-destructive/5" onClick={() => openRegDialog(pp, "zapri")}>
                            <XCircle className="h-3 w-3" />Zapri
                          </Button>
                        )}
                        <Button variant="ghost" size="icon" onClick={() => openPpDialog(pp)}>
                          <Pencil className="w-4 h-4 text-muted-foreground" />
                        </Button>
                        <Button variant="ghost" size="icon" onClick={() => handleDeletePp(pp.id)}>
                          <Trash2 className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}

          <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800 space-y-1">
            <p className="font-semibold">Opomba:</p>
            <ul className="list-disc list-inside space-y-0.5 text-blue-700">
              <li>V testnem načinu se pošilja na FURS testni strežnik (blagajne-test.fu.gov.si) — potreben je testni certifikat</li>
              <li>Brez nastavljenega certifikata se izvede lokalna simulacija (brez komunikacije s FURS)</li>
              <li>Za produkcijsko registracijo je potreben produkcijski certifikat FURS (nastavite ga zgoraj ali pri posameznem prostoru)</li>
              <li>Ko je prostor zaprt, ga ni mogoče znova registrirati brez novega vnosa</li>
            </ul>
          </div>
        </CardContent>
      </Card>
      </>)}

      {/* ── Naprave ────────────────────────────────────────────── */}
      {!jeSuperAdmin && <Card id="ns-naprave">
        <CardHeader>
          <CardTitle className="flex items-center gap-2"><HardDrive className="h-5 w-5" />Naprave</CardTitle>
          <CardDescription>Vsaka naprava (brskalnik) dobi edinstveni ključ. Tu nastavite privzeti terminal za vsako napravo.</CardDescription>
        </CardHeader>
        <CardContent>
          {(!naprave || naprave.length === 0) ? (
            <p className="text-sm text-muted-foreground">Ni registriranih naprav.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ime naprave</TableHead>
                  <TableHead>Ključ</TableHead>
                  <TableHead>Terminal</TableHead>
                  <TableHead>Mize</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {naprave.map((n) => (
                  <TableRow key={n.id} className={n.napravaKljuc === napravaKljuc ? "bg-muted/40" : ""}>
                    <TableCell>
                      <span className="font-medium">{n.ime || <span className="text-muted-foreground italic">brez imena</span>}</span>
                      {n.napravaKljuc === napravaKljuc && (
                        <Badge variant="outline" className="ml-2 text-xs">ta naprava</Badge>
                      )}
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">{n.napravaKljuc.slice(0, 8)}…</TableCell>
                    <TableCell className="text-sm">
                      {n.placilniTerminal === null ? (
                        <span className="text-muted-foreground">globalna veriga</span>
                      ) : n.placilniTerminal === "none" ? (
                        <span className="text-muted-foreground">brez terminala</span>
                      ) : n.placilniTerminal}
                    </TableCell>
                    <TableCell className="text-sm text-muted-foreground">
                      {(!n.dovoljeneMize || n.dovoljeneMize.length === 0) ? (
                        <span>vse</span>
                      ) : (
                        <span>{n.dovoljeneMize.length} {n.dovoljeneMize.length === 1 ? "miza" : n.dovoljeneMize.length < 5 ? "mize" : "miz"}</span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                          setEditingNaprava(n);
                          setNapravEditIme(n.ime ?? "");
                          setNapravEditTerminal(n.placilniTerminal ?? "__global__");
                          setNapravEditDovoljeneMize(n.dovoljeneMize ?? []);
                          setNapravEditPragZaupanja(n.glasovniPragZaupanja ?? 0);
                          setNapravEditDialogOpen(true);
                        }}><Pencil className="h-3.5 w-3.5" /></Button>
                        <Button size="icon" variant="ghost" className="h-7 w-7 text-destructive hover:text-destructive" onClick={async () => {
                          await deleteNapravaMut.mutateAsync({ id: n.id });
                          await queryClient.invalidateQueries({ queryKey: getListNapraveQueryKey() });
                          toast({ title: "Naprava izbrisana" });
                        }}><Trash2 className="h-3.5 w-3.5" /></Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>}

      {!jeSuperAdmin && <Dialog open={napravEditDialogOpen} onOpenChange={setNapravEditDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Uredi napravo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-1.5">
              <Label htmlFor="naprav-ime">Ime naprave</Label>
              <Input id="naprav-ime" value={napravEditIme} onChange={e => setNapravEditIme(e.target.value)} placeholder="npr. Blagajna 1" />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="naprav-terminal">Privzeti terminal</Label>
              <Select value={napravEditTerminal} onValueChange={setNapravEditTerminal}>
                <SelectTrigger id="naprav-terminal"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="__global__">Globalna veriga (privzeto)</SelectItem>
                  <SelectItem value="none">Brez terminala (preskoči)</SelectItem>
                  <SelectItem value="payten_hw">Payten Terminal (TCP/IP)</SelectItem>
                  <SelectItem value="payten_android">Payten Android APK</SelectItem>
                  <SelectItem value="sumup">SumUp Business Terminal</SelectItem>
                  <SelectItem value="viva_cloud">Viva Cloud Terminal</SelectItem>
                  <SelectItem value="viva_android">Viva Android Terminal</SelectItem>
                  <SelectItem value="viva_ttp">Viva Tap to Pay</SelectItem>
                  <SelectItem value="viva_smart">Viva Smart Checkout</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">„Globalna veriga" pomeni, da se upošteva globalna prioriteta terminalov iz nastavitev sistema.</p>
            </div>
            <div className="space-y-1.5">
              <Label>Dovoljene mize</Label>
              <p className="text-xs text-muted-foreground">Označite mize, ki so dostopne na tej napravi. Če nič ni označeno, so dostopne vse mize.</p>
              {(!mize || mize.length === 0) ? (
                <p className="text-sm text-muted-foreground italic">Ni nastavljenih miz.</p>
              ) : (
                <div className="border rounded-md p-2 max-h-48 overflow-y-auto space-y-1">
                  {mize.map(m => {
                    const checked = napravEditDovoljeneMize.includes(m.id);
                    return (
                      <label key={m.id} className="flex items-center gap-2 cursor-pointer rounded px-2 py-1 hover:bg-muted text-sm">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            setNapravEditDovoljeneMize(prev =>
                              checked ? prev.filter(id => id !== m.id) : [...prev, m.id]
                            );
                          }}
                          className="h-4 w-4 rounded border-border"
                        />
                        <span>{m.stevilka}{m.ime ? ` — ${m.ime}` : ""}</span>
                      </label>
                    );
                  })}
                </div>
              )}
            </div>
            <div className="space-y-1.5">
              <div className="flex items-center justify-between">
                <Label>Glasovni prag <span className="text-muted-foreground font-normal">(zaupanje)</span></Label>
                <span className="text-sm font-mono font-medium">{Math.round(napravEditPragZaupanja * 100)}%</span>
              </div>
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={napravEditPragZaupanja}
                onChange={e => setNapravEditPragZaupanja(Number(e.target.value))}
                className="w-full h-2 rounded-lg appearance-none cursor-pointer bg-muted"
              />
              <p className="text-xs text-muted-foreground">Ukazi z nižjim zaupanjem se zavrnejo. Privzeto: 50%.</p>
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => setNapravEditDialogOpen(false)}>Prekliči</Button>
              <Button disabled={updateNapravaMut.isPending} onClick={async () => {
                if (!editingNaprava) return;
                await updateNapravaMut.mutateAsync({
                  id: editingNaprava.id,
                  data: {
                    ime: napravEditIme,
                    placilniTerminal: napravEditTerminal === "__global__" ? null : napravEditTerminal,
                    dovoljeneMize: napravEditDovoljeneMize.length > 0 ? napravEditDovoljeneMize : null,
                    glasovniPragZaupanja: napravEditPragZaupanja,
                  }
                });
                await queryClient.invalidateQueries({ queryKey: getListNapraveQueryKey() });
                await refreshNaprava();
                setNapravEditDialogOpen(false);
                toast({ title: "Naprava posodobljena" });
              }}>{updateNapravaMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}&nbsp;Shrani</Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>}

      {/* ── Payten terminal ───────────────────────────────────── */}
      {!jeSuperAdmin && (<>
      <Card id="ns-terminal">
        <CardHeader>
          <CardTitle>Payten POS Terminal</CardTitle>
          <CardDescription>
            Nastavitve za komunikacijo s Payten Android POS terminalom pri kartičnem plačilu.
            Terminal mora biti v isti lokalni mreži kot strežnik.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {nastavitveLoading ? (
            <div className="h-32 animate-pulse bg-muted rounded-lg" />
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold">Terminal aktiven</Label>
                  <p className="text-sm text-muted-foreground">
                    Ko je vklopljeno, se kartična plačila pošljejo na terminal namesto le na FURS.
                  </p>
                </div>
                <Switch
                  checked={terminalAktiven}
                  onCheckedChange={setTerminalAktiven}
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2 space-y-2">
                  <Label>IP naslov terminala</Label>
                  <Input
                    placeholder="192.168.1.100"
                    value={terminalIp}
                    onChange={e => setTerminalIp(e.target.value)}
                    disabled={!terminalAktiven}
                  />
                </div>
                <div className="space-y-2">
                  <Label>TCP Port</Label>
                  <Input
                    type="number"
                    placeholder="9000"
                    value={terminalPort}
                    onChange={e => setTerminalPort(e.target.value)}
                    disabled={!terminalAktiven}
                  />
                </div>
              </div>

              <div className="space-y-2">
                <Label>Timeout (ms)</Label>
                <Input
                  type="number"
                  placeholder="30000"
                  value={terminalTimeout}
                  onChange={e => setTerminalTimeout(e.target.value)}
                  disabled={!terminalAktiven}
                  className="max-w-xs"
                />
                <p className="text-xs text-muted-foreground">Čas čakanja na odgovor terminala v ms (privzeto 30000 = 30s).</p>
              </div>

              <div className="flex gap-3 items-center">
                <Button
                  variant="outline"
                  onClick={handleTestConnection}
                  disabled={testingConnection || !terminalAktiven}
                >
                  {testingConnection ? (
                    <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                  ) : (
                    <Wifi className="h-4 w-4 mr-2" />
                  )}
                  {testingConnection ? "Testiranje..." : "Preizkusi povezavo"}
                </Button>

                {connectionResult && (
                  connectionResult.uspeh ? (
                    <Badge className="bg-green-100 text-green-800 border-green-200">
                      <Wifi className="h-3 w-3 mr-1" />Terminal dosegljiv
                    </Badge>
                  ) : (
                    <Badge variant="destructive">
                      <WifiOff className="h-3 w-3 mr-1" />
                      {connectionResult.napaka ?? "Ni dosegljiv"}
                    </Badge>
                  )
                )}
              </div>
            </>
          )}
          <Separator className="my-2" />
          <div className="flex items-center justify-between rounded-lg border p-4">
            <div className="space-y-0.5">
              <Label className="text-base font-semibold">Payten Android Software (ista naprava)</Label>
              <p className="text-sm text-muted-foreground">
                Ko je vklopljeno, se kartična plačila pošljejo na Payten APK, ki teče vzporedno na isti Android napravi (prek Android Intent).
                {terminalAktiven && (
                  <span className="text-amber-600 ml-1">⚠ Payten hardware terminal je aktiven — Android Software bo prezrt.</span>
                )}
              </p>
            </div>
            <Switch
              checked={paytenAndroidAktiven}
              onCheckedChange={setPaytenAndroidAktiven}
            />
          </div>
          {paytenAndroidAktiven && (
            <div className="space-y-2">
              <Label htmlFor="payten-android-package">Package Name APK-ja</Label>
              <Input
                id="payten-android-package"
                value={paytenAndroidPackageName}
                onChange={e => setPaytenAndroidPackageName(e.target.value)}
                placeholder="com.payten.mpos"
                className="max-w-sm"
              />
              <p className="text-xs text-muted-foreground">
                Android package name Payten aplikacije (privzeto: <code>com.payten.mpos</code>).
                Pridobite ga iz Payten dokumentacije ali s strani APK-ja.
              </p>
            </div>
          )}
        </CardContent>
      </Card>
      </>)}

      {/* ── SumUp terminal ────────────────────────────────────── */}
      {!jeSuperAdmin && (<>
      <Card id="ns-sumup">
        <CardHeader>
          <CardTitle>SumUp Business Terminal</CardTitle>
          <CardDescription>
            Nastavitve za plačila prek SumUp API-ja in SumUp Solo terminala.
            Pridobite API ključ na <a href="https://me.sumup.com/developers" target="_blank" rel="noopener noreferrer" className="underline">me.sumup.com/developers</a>.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {nastavitveLoading ? (
            <div className="h-32 animate-pulse bg-muted rounded-lg" />
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold">SumUp terminal aktiven</Label>
                  <p className="text-sm text-muted-foreground">
                    Ko je vklopljeno, se kartična plačila pošljejo prek SumUp API-ja.
                    {terminalAktiven && (
                      <span className="text-amber-600 ml-1">⚠ Payten terminal je hkrati aktiven — SumUp bo prezrt.</span>
                    )}
                  </p>
                </div>
                <Switch
                  checked={sumupAktiven}
                  onCheckedChange={setSumupAktiven}
                />
              </div>

              <div className="space-y-2">
                <Label>API ključ (osebni dostopni žeton)</Label>
                <div className="flex gap-2">
                  <div className="relative flex-1">
                    <Input
                      type={sumupPokaziApiKey ? "text" : "password"}
                      placeholder={sumupApiKeyNastavljen ? "••••••••••••••••••••••• (nastavljen)" : "sup_sk_..."}
                      value={sumupNovApiKey}
                      onChange={e => setSumupNovApiKey(e.target.value)}
                      disabled={!sumupAktiven}
                      className="pr-10"
                    />
                    <button
                      type="button"
                      onClick={() => setSumupPokaziApiKey(v => !v)}
                      className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      tabIndex={-1}
                    >
                      {sumupPokaziApiKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                {sumupApiKeyNastavljen && !sumupNovApiKey && (
                  <p className="text-xs text-green-600 flex items-center gap-1">
                    <CheckCircle2 className="h-3 w-3" />
                    API ključ je nastavljen. Pustite prazno, da ga obdržite.
                  </p>
                )}
                {!sumupApiKeyNastavljen && (
                  <p className="text-xs text-muted-foreground">
                    Ustvarite osebni dostopni žeton na SumUp razvijalskem portalu.
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <Label>Serijska številka SumUp Solo terminala</Label>
                <Input
                  placeholder="npr. SNXXXXXXXX (neobvezno)"
                  value={sumupTerminalSerial}
                  onChange={e => setSumupTerminalSerial(e.target.value)}
                  disabled={!sumupAktiven}
                  className="max-w-xs"
                />
                <p className="text-xs text-muted-foreground">
                  Če navedete serijsko številko, bo plačilo samodejno poslano na SumUp Solo terminal.
                  Brez serijske številke morate stranki pokazati QR kodo ali plačilno povezavo ročno.
                </p>
              </div>
            </>
          )}
        </CardContent>
      </Card>
      </>)}

      {/* ── Viva Wallet ────────────────────────────────────────── */}
      {!jeSuperAdmin && (<>
      <Card id="ns-viva">
        <CardHeader>
          <CardTitle>Viva Wallet Smart Checkout</CardTitle>
          <CardDescription>
            Nastavitve za plačila prek Viva Wallet Smart Checkout QR kode.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {nastavitveLoading ? (
            <div className="h-24 animate-pulse bg-muted rounded-lg" />
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold">Viva Wallet aktiven</Label>
                  <p className="text-sm text-muted-foreground">
                    Ko je vklopljeno, se kartična plačila opravijo prek Viva Wallet QR kode.
                    {(nastavitve as Nastavitve & { terminalAktiven?: boolean; sumupAktiven?: boolean })?.terminalAktiven && (
                      <span className="text-amber-600 ml-1">⚠ Payten terminal je hkrati aktiven — Viva Wallet bo prezrt.</span>
                    )}
                    {!(nastavitve as Nastavitve & { terminalAktiven?: boolean })?.terminalAktiven && (nastavitve as Nastavitve & { sumupAktiven?: boolean })?.sumupAktiven && (
                      <span className="text-amber-600 ml-1">⚠ SumUp je hkrati aktiven — Viva Wallet bo prezrt.</span>
                    )}
                  </p>
                </div>
                <Switch
                  checked={vivaAktiven}
                  onCheckedChange={setVivaAktiven}
                />
              </div>
              <Separator className="my-2" />
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold">Viva Terminal aktiven</Label>
                  <p className="text-sm text-muted-foreground">
                    Ko je vklopljeno, se kartična plačila pošljejo na fizični Viva.com POS terminal.
                    {(nastavitve as Nastavitve & { terminalAktiven?: boolean })?.terminalAktiven && (
                      <span className="text-amber-600 ml-1">⚠ Payten terminal je hkrati aktiven — Viva Terminal bo prezrt.</span>
                    )}
                    {!(nastavitve as Nastavitve & { terminalAktiven?: boolean })?.terminalAktiven && (nastavitve as Nastavitve & { sumupAktiven?: boolean })?.sumupAktiven && (
                      <span className="text-amber-600 ml-1">⚠ SumUp je hkrati aktiven — Viva Terminal bo prezrt.</span>
                    )}
                  </p>
                </div>
                <Switch
                  checked={vivaTerminalAktiven}
                  onCheckedChange={setVivaTerminalAktiven}
                />
              </div>
              {vivaTerminalAktiven && (
                <div className="space-y-2">
                  <Label htmlFor="viva-terminal-id">Terminal ID</Label>
                  <Input
                    id="viva-terminal-id"
                    value={vivaTerminalId}
                    onChange={e => setVivaTerminalId(e.target.value)}
                    placeholder="npr. 16123456"
                    className="max-w-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    ID fizičnega terminala iz Viva.com Merchant portala (ECR/Cloud Terminal).
                  </p>
                </div>
              )}
              <Separator className="my-2" />
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold">Viva Android Terminal (ista naprava)</Label>
                  <p className="text-sm text-muted-foreground">
                    Ko je vklopljeno, se kartična plačila pošljejo na Viva Terminal APK, ki teče vzporedno na isti Android napravi (prek Android Intent).
                    {(nastavitve as Nastavitve & { terminalAktiven?: boolean })?.terminalAktiven && (
                      <span className="text-amber-600 ml-1">⚠ Payten terminal je aktiven — Android Terminal bo prezrt.</span>
                    )}
                    {!(nastavitve as Nastavitve & { terminalAktiven?: boolean })?.terminalAktiven && (nastavitve as Nastavitve & { sumupAktiven?: boolean })?.sumupAktiven && (
                      <span className="text-amber-600 ml-1">⚠ SumUp je aktiven — Android Terminal bo prezrt.</span>
                    )}
                    {!(nastavitve as Nastavitve & { terminalAktiven?: boolean })?.terminalAktiven && !(nastavitve as Nastavitve & { sumupAktiven?: boolean })?.sumupAktiven && vivaTerminalAktiven && (
                      <span className="text-amber-600 ml-1">⚠ Viva Cloud Terminal je aktiven — Android Terminal bo prezrt.</span>
                    )}
                  </p>
                </div>
                <Switch
                  checked={vivaAndroidTerminalAktiven}
                  onCheckedChange={setVivaAndroidTerminalAktiven}
                />
              </div>
              {vivaAndroidTerminalAktiven && (
                <div className="space-y-2">
                  <Label htmlFor="viva-android-source-code">Source Code / POS ID (opcijsko)</Label>
                  <Input
                    id="viva-android-source-code"
                    value={vivaAndroidSourceCode}
                    onChange={e => setVivaAndroidSourceCode(e.target.value)}
                    placeholder="npr. 1234"
                    className="max-w-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Source Code ali POS ID iz Viva.com Merchant portala (neobvezno).
                    Viva Terminal APK mora biti namesčen na isti napravi.
                  </p>
                </div>
              )}
              <Separator className="my-2" />
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold">Viva Tap to Pay (ista naprava)</Label>
                  <p className="text-sm text-muted-foreground">
                    SoftPOS — NFC-sposoben Android telefon/tablica neposredno bere kontaktno plačilo stranke (Android 9+, NFC, Google Play).
                    {(nastavitve as Nastavitve & { terminalAktiven?: boolean })?.terminalAktiven && (
                      <span className="text-amber-600 ml-1">⚠ Payten terminal je aktiven — Tap to Pay bo prezrt.</span>
                    )}
                    {!(nastavitve as Nastavitve & { terminalAktiven?: boolean })?.terminalAktiven && (nastavitve as Nastavitve & { sumupAktiven?: boolean })?.sumupAktiven && (
                      <span className="text-amber-600 ml-1">⚠ SumUp je aktiven — Tap to Pay bo prezrt.</span>
                    )}
                    {!(nastavitve as Nastavitve & { terminalAktiven?: boolean })?.terminalAktiven && !(nastavitve as Nastavitve & { sumupAktiven?: boolean })?.sumupAktiven && vivaTerminalAktiven && (
                      <span className="text-amber-600 ml-1">⚠ Viva Cloud Terminal je aktiven — Tap to Pay bo prezrt.</span>
                    )}
                    {!(nastavitve as Nastavitve & { terminalAktiven?: boolean })?.terminalAktiven && !(nastavitve as Nastavitve & { sumupAktiven?: boolean })?.sumupAktiven && !vivaTerminalAktiven && vivaAndroidTerminalAktiven && (
                      <span className="text-amber-600 ml-1">⚠ Viva Android Terminal je aktiven — Tap to Pay bo prezrt.</span>
                    )}
                  </p>
                </div>
                <Switch
                  checked={vivaTapToPayAktiven}
                  onCheckedChange={setVivaTapToPayAktiven}
                />
              </div>
              {vivaTapToPayAktiven && (
                <div className="space-y-2">
                  <Label htmlFor="viva-tap-source-code">Source Code / POS ID (opcijsko)</Label>
                  <Input
                    id="viva-tap-source-code"
                    value={vivaTapToPaySourceCode}
                    onChange={e => setVivaTapToPaySourceCode(e.target.value)}
                    placeholder="npr. 1234"
                    className="max-w-sm"
                  />
                  <p className="text-xs text-muted-foreground">
                    Source Code ali POS ID iz Viva.com Merchant portala (neobvezno).
                    Viva Terminal APK mora biti namesčen na isti napravi in podpirati SoftPOS način.
                  </p>
                </div>
              )}
              <Separator className="my-2" />
              {vivaAktiven && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="viva-client-id">Client ID</Label>
                    <Input
                      id="viva-client-id"
                      value={vivaClientId}
                      onChange={e => setVivaClientId(e.target.value)}
                      placeholder="npr. abc123"
                      className="max-w-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Client ID iz Viva Wallet Developer portala (API Credentials → Smart Checkout).
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="viva-client-secret">
                      Client Secret
                      {vivaClientSecretNastavljen && (
                        <span className="ml-2 text-xs font-normal text-green-600">✓ nastavljeno</span>
                      )}
                    </Label>
                    <div className="relative max-w-sm">
                      <Input
                        id="viva-client-secret"
                        type={vivaPokaziSecret ? "text" : "password"}
                        value={vivaNovClientSecret}
                        onChange={e => setVivaNovClientSecret(e.target.value)}
                        placeholder={vivaClientSecretNastavljen ? "Pustite prazno za ohranitev" : "Vnesite Client Secret"}
                        className="pr-10"
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="absolute right-0 top-0 h-full px-3"
                        onClick={() => setVivaPokaziSecret(v => !v)}
                      >
                        {vivaPokaziSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </Button>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Client Secret iz Viva Wallet Developer portala.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="viva-source-code">Source Code (Vir plačila)</Label>
                    <Input
                      id="viva-source-code"
                      value={vivaSourceCode}
                      onChange={e => setVivaSourceCode(e.target.value)}
                      placeholder="npr. 1234"
                      className="max-w-xs"
                    />
                    <p className="text-xs text-muted-foreground">
                      Source code iz Viva Wallet Payment Source (Smart Checkout). Pustite prazno, če ni potreben.
                    </p>
                  </div>
                  <div className="flex items-center justify-between rounded-lg border p-4">
                    <div className="space-y-0.5">
                      <Label className="text-base font-semibold">Demo način</Label>
                      <p className="text-sm text-muted-foreground">
                        Uporablja Viva Wallet demo okolje (demo-api.vivapayments.com). Za testiranje brez pravih plačil.
                      </p>
                    </div>
                    <Switch
                      checked={vivaDemoNacin}
                      onCheckedChange={setVivaDemoNacin}
                    />
                  </div>
                </>
              )}
            </>
          )}
        </CardContent>
      </Card>
      </>)}

      {/* ── Gumb za shranjevanje terminalnih nastavitev ── */}
      {!jeSuperAdmin && (
        <div className="flex justify-end">
          <Button
            size="lg"
            className="w-full sm:w-auto"
            onClick={handleSaveTerminali}
            disabled={nastavitveLoading || updateNapraveTerminali.isPending}
          >
            <Save className="h-4 w-4 mr-2" />
            {updateNapraveTerminali.isPending ? "Shranjujem..." : "Potrdi spremembe"}
          </Button>
        </div>
      )}

      {/* ── Skrbniški PIN za izredno izdajo ─────────────────────── */}
      {jeAdmin && !jeSuperAdmin && (
        <Collapsible open={izredniPinOdprt} onOpenChange={setIzredniPinOdprt}>
          <Card id="ns-izredni-pin">
            <CollapsibleTrigger asChild>
              <CardHeader className="cursor-pointer select-none hover:bg-muted/40 rounded-t-lg transition-colors">
                <CardTitle className="flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Shield className="h-5 w-5" />
                    Skrbniški PIN za izredno izdajo
                    {izrednaIzdajaPINNastavljen
                      ? <span className="ml-2 text-xs font-normal text-green-700 bg-green-100 rounded px-2 py-0.5">Nastavljen</span>
                      : <span className="ml-2 text-xs font-normal text-amber-700 bg-amber-100 rounded px-2 py-0.5">Ni nastavljen</span>
                    }
                  </span>
                  {izredniPinOdprt ? <ChevronDown className="h-4 w-4 text-muted-foreground" /> : <ChevronRight className="h-4 w-4 text-muted-foreground" />}
                </CardTitle>
                <CardDescription>
                  Kliknite za nastavitev PIN kode za izredno izdajo pri DDV neskladju.
                </CardDescription>
              </CardHeader>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <CardContent className="space-y-4">
                {nastavitveLoading ? (
                  <div className="h-24 animate-pulse bg-muted rounded-lg" />
                ) : (
                  <>
                    {izrednaIzdajaPINNastavljen && (
                      <Alert className="border-green-200 bg-green-50">
                        <CheckCircle2 className="h-4 w-4 text-green-600" />
                        <AlertDescription className="text-green-800 text-sm">
                          Skrbniški PIN je nastavljen. Vpišite nov PIN spodaj, da ga spremenite.
                        </AlertDescription>
                      </Alert>
                    )}
                    {!izrednaIzdajaPINNastavljen && (
                      <Alert className="border-amber-200 bg-amber-50">
                        <AlertCircle className="h-4 w-4 text-amber-600" />
                        <AlertDescription className="text-amber-800 text-sm">
                          Skrbniški PIN še ni nastavljen. Izredna izdaja pri DDV neskladju ne bo mogoča.
                        </AlertDescription>
                      </Alert>
                    )}
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="izredni-pin-nov">Nov PIN {izrednaIzdajaPINNastavljen ? "(pustite prazno za ohranitev)" : "(4–8 znakov)"}</Label>
                        <div className="relative">
                          <Input
                            id="izredni-pin-nov"
                            type={izredniPinPokaziNov ? "text" : "password"}
                            inputMode="numeric"
                            placeholder="••••"
                            value={izredniNovPin}
                            onChange={e => { setIzredniNovPin(e.target.value); setIzredniPinNapaka(null); }}
                            maxLength={8}
                          />
                          <button
                            type="button"
                            className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                            onClick={() => setIzredniPinPokaziNov(v => !v)}
                            tabIndex={-1}
                          >
                            {izredniPinPokaziNov ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                          </button>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="izredni-pin-potrdi">Potrdi PIN</Label>
                        <Input
                          id="izredni-pin-potrdi"
                          type="password"
                          inputMode="numeric"
                          placeholder="••••"
                          value={izredniPinPotrdi}
                          onChange={e => { setIzredniPinPotrdi(e.target.value); setIzredniPinNapaka(null); }}
                          maxLength={8}
                        />
                      </div>
                    </div>
                    {izredniPinNapaka && (
                      <p className="text-sm text-destructive font-medium">{izredniPinNapaka}</p>
                    )}
                    <p className="text-xs text-muted-foreground">
                      PIN se shrani šifriran (bcrypt). Skrbniki ga nastavijo, blagajniki ga vpisujejo ob izredni izdaji.
                    </p>
                  </>
                )}
              </CardContent>
            </CollapsibleContent>
          </Card>
        </Collapsible>
      )}

      {/* ── Save button (samo admin) ───────────────────────────── */}
      {jeAdmin && (
        <div className="flex justify-end">
          <Button
            size="lg"
            className="w-full sm:w-auto"
            onClick={handleSaveNastavitve}
            disabled={nastavitveLoading || updateNastavitve.isPending}
          >
            <Save className="h-4 w-4 mr-2" />
            {updateNastavitve.isPending ? "Shranjujem..." : "Shrani vse nastavitve"}
          </Button>
        </div>
      )}

      {/* ── DDV stopnje (samo superadmin) ───────────────────────────── */}
      {jeSuperAdmin && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Percent className="h-5 w-5" />DDV stopnje
            </CardTitle>
            <CardDescription>
              Globalne stopnje DDV, ki veljajo za vsa podjetja v sistemu. Nastavi samo superadmin.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {ddvLoading ? (
              <div className="flex items-center gap-2 text-muted-foreground text-sm py-2">
                <Loader2 className="h-4 w-4 animate-spin" />Nalagam…
              </div>
            ) : (
              <div className="space-y-4">
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                  <div className="space-y-2">
                    <Label>Splošna stopnja (%)</Label>
                    <Input
                      type="number" step="0.1" min="0" max="100"
                      value={ddvSplosnaSt} onChange={e => setDdvSplosnaSt(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Privzeto: 22% — pijača, ostalo</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Nižja stopnja (%)</Label>
                    <Input
                      type="number" step="0.1" min="0" max="100"
                      value={ddvNizjaSt} onChange={e => setDdvNizjaSt(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Privzeto: 9,5% — hrana v gostinstvu</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Znižana stopnja (%)</Label>
                    <Input
                      type="number" step="0.1" min="0" max="100"
                      value={ddvZnizanaSt} onChange={e => setDdvZnizanaSt(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Privzeto: 5% — znižana stopnja</p>
                  </div>
                </div>
                <Button size="sm" onClick={handleSaveDdvStopnje} disabled={ddvSaving}>
                  {ddvSaving
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Shranjujem…</>
                    : <><Save className="h-4 w-4 mr-2" />Shrani DDV stopnje</>}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Zgodovina testov (samo superadmin) ─────────────────────── */}
      {jeSuperAdmin && (
        <Card id="ns-testi">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FlaskConical className="h-5 w-5" />
              Zgodovina zagonov testov
            </CardTitle>
            <CardDescription>
              Zadnjih 20 zagonov avtomatskih testov. Prikazuje trend kakovosti — kdaj so testi tekli, koliko jih je prestalo in kateri so padli.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {testniZagoniLoading && (
              <div className="flex items-center gap-2 text-muted-foreground py-4">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Nalagam...</span>
              </div>
            )}
            {!testniZagoniLoading && (!testniZagoni || testniZagoni.length === 0) && (
              <p className="text-sm text-muted-foreground py-4 text-center">Ni zabeleženih zagonov testov.</p>
            )}
            {testniZagoni && testniZagoni.length > 0 && (() => {
              const kronoloski = [...testniZagoni].reverse();
              const grafikonPodatki = kronoloski.map((z, i) => ({
                index: i + 1,
                datum: new Date(z.zagnanOb).toLocaleString("sl-SI", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }),
                datumPoln: new Date(z.zagnanOb).toLocaleString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }),
                odstotek: z.skupajTestov > 0 ? Math.round((z.prestaloTestov / z.skupajTestov) * 100) : 0,
                status: z.status,
              }));
              const polovica = Math.floor(grafikonPodatki.length / 2);
              const prvaPolovina = grafikonPodatki.slice(0, Math.max(1, polovica));
              const drugaPolovina = grafikonPodatki.slice(Math.max(1, polovica));
              const povprecjePrve = prvaPolovina.reduce((s, d) => s + d.odstotek, 0) / prvaPolovina.length;
              const povprecjeDruge = drugaPolovina.reduce((s, d) => s + d.odstotek, 0) / drugaPolovina.length;
              const trendNavzgor = grafikonPodatki.length >= 2 && povprecjeDruge > povprecjePrve;
              const barvaTrenda = trendNavzgor ? "#16a34a" : "#dc2626";

              return (
                <>
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead className="w-8"></TableHead>
                        <TableHead>Datum</TableHead>
                        <TableHead className="text-center">Skupaj</TableHead>
                        <TableHead className="text-center">Prestalo</TableHead>
                        <TableHead className="text-center">Padlo</TableHead>
                        <TableHead className="hidden sm:table-cell text-right">Čas (s)</TableHead>
                        <TableHead>Status</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {testniZagoni.map((z: TestniZagonPogled) => {
                        const imaPadlih = z.padloTestov > 0 && z.padliTesti;
                        const jeRazprt = razprtiZagoni.has(z.id);
                        return (
                          <>
                            <TableRow
                              key={z.id}
                              className={imaPadlih ? "cursor-pointer hover:bg-muted/50" : ""}
                              onClick={imaPadlih ? () => toggleRazprtZagon(z.id) : undefined}
                            >
                              <TableCell className="pr-0">
                                {imaPadlih ? (
                                  jeRazprt
                                    ? <ChevronDown className="h-4 w-4 text-muted-foreground" />
                                    : <ChevronRight className="h-4 w-4 text-muted-foreground" />
                                ) : null}
                              </TableCell>
                              <TableCell className="font-mono text-xs">
                                {new Date(z.zagnanOb).toLocaleString("sl-SI", {
                                  day: "2-digit", month: "2-digit", year: "numeric",
                                  hour: "2-digit", minute: "2-digit",
                                })}
                              </TableCell>
                              <TableCell className="text-center font-medium">{z.skupajTestov}</TableCell>
                              <TableCell className="text-center text-green-600 font-medium">{z.prestaloTestov}</TableCell>
                              <TableCell className="text-center">
                                {z.padloTestov > 0
                                  ? <span className="text-destructive font-semibold">{z.padloTestov}</span>
                                  : <span className="text-muted-foreground">0</span>
                                }
                              </TableCell>
                              <TableCell className="hidden sm:table-cell text-right text-muted-foreground text-sm">
                                {z.trajanjeSekund !== null && z.trajanjeSekund !== undefined
                                  ? Number(z.trajanjeSekund).toFixed(1)
                                  : "—"}
                              </TableCell>
                              <TableCell>
                                {z.status === "uspesno" && (
                                  <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">
                                    <CheckCircle2 className="h-3 w-3 mr-1" />Uspešno
                                  </Badge>
                                )}
                                {z.status === "neuspesno" && (
                                  <Badge className="bg-red-100 text-red-800 border-red-200 text-xs">
                                    <XCircle className="h-3 w-3 mr-1" />Neuspešno
                                  </Badge>
                                )}
                                {z.status === "napaka" && (
                                  <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200 text-xs">
                                    <AlertTriangle className="h-3 w-3 mr-1" />Napaka
                                  </Badge>
                                )}
                              </TableCell>
                            </TableRow>
                            {imaPadlih && jeRazprt && (
                              <TableRow key={`${z.id}-padli`} className="bg-red-50/50">
                                <TableCell colSpan={7} className="pt-0 pb-3 px-8">
                                  <p className="text-xs font-semibold text-destructive mb-1">Padli testi:</p>
                                  <ul className="space-y-0.5">
                                    {z.padliTesti!.split("\n").filter(Boolean).map((t, i) => (
                                      <li key={i} className="text-xs font-mono text-destructive/80 bg-red-100/60 rounded px-2 py-0.5">{t}</li>
                                    ))}
                                  </ul>
                                </TableCell>
                              </TableRow>
                            )}
                          </>
                        );
                      })}
                    </TableBody>
                  </Table>

                  <div className="mt-6">
                    <p className="text-sm font-medium text-muted-foreground mb-2">
                      Trend prestanih testov (%) — zadnjih {grafikonPodatki.length} zagonov
                    </p>
                    <ResponsiveContainer width="100%" height={200}>
                      <LineChart data={grafikonPodatki} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
                        <XAxis
                          dataKey="datum"
                          tick={{ fontSize: 11, fill: "#6b7280" }}
                          interval="preserveStartEnd"
                        />
                        <YAxis
                          domain={[0, 100]}
                          tickFormatter={(v: number) => `${v}%`}
                          tick={{ fontSize: 11, fill: "#6b7280" }}
                          width={40}
                        />
                        <Tooltip
                          content={({ active, payload }) => {
                            if (!active || !payload || payload.length === 0) return null;
                            const d = payload[0]?.payload as { datum: string; datumPoln: string; odstotek: number; status: string };
                            const statusLabels: Record<string, string> = { uspesno: "Uspešno", neuspesno: "Neuspešno", napaka: "Napaka" };
                            const statusBarve: Record<string, string> = { uspesno: "#16a34a", neuspesno: "#dc2626", napaka: "#ca8a04" };
                            const barva = statusBarve[d.status] ?? "#6b7280";
                            return (
                              <div className="rounded-md border bg-white shadow-sm p-2 text-xs space-y-0.5">
                                <p className="text-muted-foreground">{d.datumPoln}</p>
                                <p className="font-semibold">{d.odstotek}% prestalo</p>
                                <p style={{ color: barva }} className="font-medium">{statusLabels[d.status] ?? d.status}</p>
                              </div>
                            );
                          }}
                        />
                        <ReferenceLine y={100} stroke="#d1d5db" strokeDasharray="4 2" />
                        <Line
                          type="monotone"
                          dataKey="odstotek"
                          stroke={barvaTrenda}
                          strokeWidth={2}
                          dot={(props: { cx: number; cy: number; payload: { status: string } }) => {
                            const statusBarve: Record<string, string> = { uspesno: "#16a34a", neuspesno: "#dc2626", napaka: "#ca8a04" };
                            const barva = statusBarve[props.payload.status] ?? "#6b7280";
                            return <circle key={`dot-${props.cx}-${props.cy}`} cx={props.cx} cy={props.cy} r={5} fill={barva} stroke="#fff" strokeWidth={1.5} />;
                          }}
                          activeDot={(props: { cx: number; cy: number; payload: { status: string } }) => {
                            const statusBarve: Record<string, string> = { uspesno: "#16a34a", neuspesno: "#dc2626", napaka: "#ca8a04" };
                            const barva = statusBarve[props.payload.status] ?? "#6b7280";
                            return <circle key={`adot-${props.cx}-${props.cy}`} cx={props.cx} cy={props.cy} r={7} fill={barva} stroke="#fff" strokeWidth={2} />;
                          }}
                          isAnimationActive={false}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                    <div className="flex items-center gap-4 mt-2 text-xs text-muted-foreground">
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#16a34a" }} />
                        Uspešno
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#dc2626" }} />
                        Neuspešno
                      </span>
                      <span className="flex items-center gap-1.5">
                        <span className="inline-block w-2.5 h-2.5 rounded-full" style={{ backgroundColor: "#ca8a04" }} />
                        Napaka
                      </span>
                    </div>
                  </div>
                </>
              );
            })()}
          </CardContent>
        </Card>
      )}

        </TabsContent>
      </Tabs>

      {/* ── Edit miza dialog ──────────────────────────────────── */}
      <Dialog open={editMizaOpen} onOpenChange={setEditMizaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uredi mizo</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Številka</Label>
              <Input type="number" value={editStevilka} onChange={e => setEditStevilka(e.target.value)} autoFocus />
            </div>
            <div className="space-y-2">
              <Label>Ime (opcijsko)</Label>
              <Input placeholder="Npr. Terasa 1" value={editIme} onChange={e => setEditIme(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Kapaciteta</Label>
              <Input type="number" min="1" value={editKapaciteta} onChange={e => setEditKapaciteta(e.target.value)} />
            </div>
            {prostori && prostori.length > 0 && (
              <div className="space-y-2">
                <Label>Prostor</Label>
                <Select value={editProstorId} onValueChange={setEditProstorId}>
                  <SelectTrigger>
                    <SelectValue placeholder="Brez prostora" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Brez prostora</SelectItem>
                    {prostori.map(p => (
                      <SelectItem key={p.id} value={String(p.id)}>{p.ime}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <Button className="w-full" onClick={handleUpdateMiza} disabled={updateMiza.isPending}>
              {updateMiza.isPending ? "Shranjujem..." : "Posodobi mizo"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit prostor dialog ───────────────────────────────── */}
      <Dialog open={editProstorOpen} onOpenChange={setEditProstorOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uredi prostor</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Ime prostora</Label>
              <Input value={editProstorIme} onChange={e => setEditProstorIme(e.target.value)} autoFocus />
            </div>
            <Button className="w-full" onClick={handleUpdateProstor} disabled={updateProstorMut.isPending}>
              {updateProstorMut.isPending ? "Shranjujem..." : "Posodobi prostor"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Edit enota dialog ─────────────────────────────────── */}
      <Dialog open={editEnotaOpen} onOpenChange={setEditEnotaOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uredi poslovno enoto</DialogTitle>
          </DialogHeader>
          <form onSubmit={handleUpdateEnota} className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Ime enote</Label>
              <Input required autoFocus value={editEIme} onChange={e => setEditEIme(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Opis (neobvezno)</Label>
              <Input placeholder="npr. Osrednja restavracija" value={editEOpis} onChange={e => setEditEOpis(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Začetek poslovnega dne</Label>
              <Input type="time" value={editEZacetekDnevaUra} onChange={e => setEditEZacetekDnevaUra(e.target.value)} />
              <p className="text-xs text-muted-foreground">Dnevni promet se računa od te ure do iste ure naslednjega dne (privzeto 04:00).</p>
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={editEAktiven} onCheckedChange={setEditEAktiven} />
              <Label className="cursor-pointer" onClick={() => setEditEAktiven(v => !v)}>Aktivna</Label>
            </div>
            <Button type="submit" className="w-full" disabled={updateEnota.isPending}>
              {updateEnota.isPending ? "Shranjujem..." : "Posodobi enoto"}
            </Button>
          </form>
        </DialogContent>
      </Dialog>

      {/* ── Edit natakar dialog ───────────────────────────────── */}
      <Dialog open={editNatakarOpen} onOpenChange={setEditNatakarOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Uredi natakarja</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Ime</Label>
                <Input required autoFocus value={editNIme} onChange={e => setEditNIme(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Priimek</Label>
                <Input required value={editNPriimek} onChange={e => setEditNPriimek(e.target.value)} />
              </div>
            </div>
            <div className="space-y-2">
              <Label>Davčna številka (za FURS)</Label>
              <Input placeholder="12345678" value={editNDavcna} onChange={e => setEditNDavcna(e.target.value)} />
            </div>
            <div className="flex items-center gap-3">
              <Switch checked={editNAktiven} onCheckedChange={setEditNAktiven} />
              <Label className="cursor-pointer" onClick={() => setEditNAktiven(v => !v)}>Aktiven</Label>
            </div>
            <Button className="w-full" onClick={handleUpdateNatakar} disabled={updateNatakar.isPending}>
              {updateNatakar.isPending ? "Shranjujem..." : "Posodobi natakarja"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dodaj/Uredi poslovni prostor dialog ───────────────── */}
      <Dialog open={ppDialogOpen} onOpenChange={open => { setPpDialogOpen(open); if (!open) setEditingPp(null); }}>
        <DialogContent className="max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-5 w-5" />
              {editingPp ? "Uredi poslovni prostor" : "Dodaj poslovni prostor"}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2 overflow-y-auto max-h-[75vh] pr-1">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>ID prostora <span className="text-destructive">*</span></Label>
                <Input
                  placeholder="PP001"
                  value={ppProstorId}
                  onChange={e => setPpProstorId(e.target.value)}
                  autoFocus
                  disabled={!!editingPp}
                />
                <p className="text-xs text-muted-foreground">Npr. PP001, PP002 …</p>
              </div>
              <div className="space-y-2">
                <Label>Naziv <span className="text-xs text-muted-foreground">(opcijsko)</span></Label>
                <Input placeholder="Restavracija" value={ppNaziv} onChange={e => setPpNaziv(e.target.value)} />
              </div>
            </div>

            <div className="space-y-2">
              <Label>Tip prostora <span className="text-destructive">*</span></Label>
              <div className="grid grid-cols-2 gap-2">
                {(["nepremicnina", "premicnina"] as const).map(tip => (
                  <button
                    key={tip}
                    type="button"
                    onClick={() => setPpTip(tip)}
                    className={`rounded-lg border p-2 text-xs text-center transition-colors ${ppTip === tip ? "border-primary bg-primary/10 font-semibold text-primary" : "border-muted hover:border-muted-foreground/50"}`}
                  >
                    {tip === "nepremicnina" ? "Nepremičnina" : "Premičnina"}
                  </button>
                ))}
              </div>
            </div>

            {ppTip === "nepremicnina" && (
              <>
                <Separator />
                <p className="text-sm font-semibold">Naslov</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2 space-y-2">
                    <Label>Ulica</Label>
                    <Input placeholder="Slovenska cesta" value={ppUlica} onChange={e => setPpUlica(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Hišna št.</Label>
                    <Input placeholder="1" value={ppHisna} onChange={e => setPpHisna(e.target.value)} />
                  </div>
                </div>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>Dodatek <span className="text-xs text-muted-foreground">(opt.)</span></Label>
                    <Input placeholder="A" value={ppHisnaDodatek} onChange={e => setPpHisnaDodatek(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Poštna št.</Label>
                    <Input placeholder="1000" value={ppPostna} onChange={e => setPpPostna(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Kraj</Label>
                    <Input placeholder="Ljubljana" value={ppKraj} onChange={e => setPpKraj(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Skupnost (občina)</Label>
                  <Input placeholder="Ljubljana" value={ppSkupnost} onChange={e => setPpSkupnost(e.target.value)} className="max-w-xs" />
                  <p className="text-xs text-muted-foreground">Pogosto enako kot kraj — preverite pri FURS.</p>
                </div>

                <Separator />
                <p className="text-sm font-semibold">Katastrski podatki <span className="text-xs font-normal text-muted-foreground">(opcijsko — K.O. + stavba + del stavbe)</span></p>
                <p className="text-xs text-muted-foreground">FURS zahteva vsa tri polja ali nobeno. Najdete jih v zemljiški knjigi ali na GURS portalu.</p>
                <div className="grid grid-cols-3 gap-3">
                  <div className="space-y-2">
                    <Label>Številka K.O.</Label>
                    <Input placeholder="1722" value={ppKatastrska} onChange={e => setPpKatastrska(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Številka stavbe</Label>
                    <Input placeholder="100" value={ppStavba} onChange={e => setPpStavba(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>Številka dela stavbe</Label>
                    <Input placeholder="1" value={ppDelStavbe} onChange={e => setPpDelStavbe(e.target.value)} />
                  </div>
                </div>
              </>
            )}

            {ppTip === "premicnina" && (
              <>
                <Separator />
                <p className="text-sm font-semibold">Identifikacija premičnine</p>
                <p className="text-xs text-muted-foreground">Izpolnite vsaj eno (prednost: tablica → VIN → tip).</p>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-2">
                    <Label>Registrska tablica</Label>
                    <Input placeholder="LJ AB-123" value={ppTablica} onChange={e => setPpTablica(e.target.value)} />
                  </div>
                  <div className="space-y-2">
                    <Label>VIN</Label>
                    <Input placeholder="WBA3A5G59DNP26082" value={ppVin} onChange={e => setPpVin(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-2">
                  <Label>Tip premičnine <span className="text-xs text-muted-foreground">(le če ni tablice/VIN)</span></Label>
                  <div className="grid grid-cols-3 gap-2">
                    {([["A", "Vozilo"], ["B", "Kiosk/stojnica"], ["C", "Elektr. naprava"]] as const).map(([val, label]) => (
                      <button key={val} type="button" onClick={() => setPpPremicninaTip(val)}
                        className={`rounded-lg border p-2 text-xs text-center transition-colors ${ppPremicninaTip === val ? "border-primary bg-primary/10 font-semibold text-primary" : "border-muted hover:border-muted-foreground/50"}`}>
                        {label}
                      </button>
                    ))}
                  </div>
                  {ppPremicninaTip === "C" && (
                    <p className="text-xs text-blue-700 bg-blue-50 border border-blue-200 rounded p-2">
                      Tip C = posamezna elektronska naprava za izdajanje računov (tablica, računalnik). Primerno za POS sistem.
                    </p>
                  )}
                </div>
              </>
            )}

            {ppTip === "elektronska_naprava" && (
              <>
                <Separator />
                <div className="rounded-lg bg-green-50 border border-green-200 p-3 text-sm text-green-800">
                  <p className="font-semibold">Elektronska naprava (PremiseType C)</p>
                  <p className="mt-1">FURS bo registriral prostor kot posamezno elektronsko napravo za izdajo računov (tip C). Primerno za POS tablet ali računalnik.</p>
                </div>
              </>
            )}

            <Separator />
            <div className="space-y-2">
              <Label>Veljavnost od</Label>
              <Input type="date" value={ppVeljavnost} onChange={e => setPpVeljavnost(e.target.value)} className="max-w-xs" />
            </div>

            <Separator />
            <p className="text-sm font-semibold">Certifikat za ta prostor <span className="text-xs font-normal text-muted-foreground">(prepiše globalno nastavitev)</span></p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-2">
                <Label>Pot do PEM ključa</Label>
                <Input placeholder="/etc/pos/pp001.pem" value={ppCertPot} onChange={e => setPpCertPot(e.target.value)} />
              </div>
              <div className="space-y-2">
                <Label>Geslo PEM ključa</Label>
                <Input type="password" placeholder="geslo" value={ppCertGeslo} onChange={e => setPpCertGeslo(e.target.value)} />
              </div>
            </div>

            <Button
              className="w-full gap-2"
              onClick={handleSavePp}
              disabled={!ppProstorId || createPp.isPending || updatePp.isPending}
            >
              {(createPp.isPending || updatePp.isPending) ? (
                <><Loader2 className="h-4 w-4 animate-spin" /> Shranjujem...</>
              ) : (
                <><Save className="h-4 w-4" /> {editingPp ? "Posodobi prostor" : "Dodaj prostor"}</>
              )}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Registracija / Zapiranje prostora dialog ───────────── */}
      <Dialog open={ppRegDialogOpen} onOpenChange={open => { setPpRegDialogOpen(open); if (!open) { setPpRegResult(null); setPpRegTarget(null); } }}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              {ppRegMode === "zapri" ? <XCircle className="h-5 w-5 text-destructive" /> : <Building2 className="h-5 w-5" />}
              {ppRegMode === "zapri" ? "Zapri poslovni prostor pri FURS" : "Registracija poslovnega prostora pri FURS"}
            </DialogTitle>
          </DialogHeader>

          {!ppRegResult ? (
            <div className="space-y-4 pt-2">
              {ppRegTarget && (
                <div className="rounded-lg bg-muted/50 p-3 text-sm space-y-1">
                  <p className="font-medium">Prostor: <span className="font-mono">{ppRegTarget.prostorId}</span>{ppRegTarget.naziv && ` — ${ppRegTarget.naziv}`}</p>
                  <p className="text-muted-foreground">Davčna številka: <span className="font-mono">{davcnaStevilka || "—"}</span></p>
                </div>
              )}

              {ppRegMode === "zapri" && (
                <div className="rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-800">
                  <p className="font-semibold">Pozor: zapiranje prostora</p>
                  <p className="text-red-700">Ko je prostor zaprt, FURS tega prostora ne bo sprejel za nove račune. Dejanje je nepreklicno pri FURS.</p>
                </div>
              )}

              <div className="rounded-lg border p-3 space-y-2">
                <div>
                  <p className="font-medium text-sm">Način pošiljanja FURS</p>
                  <p className="text-xs text-muted-foreground">Privzeto nastavljeno iz globalnih nastavitev FURS.</p>
                </div>
                <RadioGroup value={ppFursNacin} onValueChange={(v) => setPpFursNacin(v as typeof ppFursNacin)} className="space-y-1">
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="simulacija" id="pp-sim" />
                    <Label htmlFor="pp-sim" className="font-normal cursor-pointer">Simulacija</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="testno" id="pp-testno-opt" />
                    <Label htmlFor="pp-testno-opt" className="font-normal cursor-pointer">Testni strežnik</Label>
                  </div>
                  <div className="flex items-center space-x-2">
                    <RadioGroupItem value="produkcija" id="pp-prod-opt" />
                    <Label htmlFor="pp-prod-opt" className="font-normal cursor-pointer">Produkcija</Label>
                  </div>
                </RadioGroup>
                {ppFursNacin === "produkcija" && (
                  <div className="rounded-lg border border-amber-200 bg-amber-50 p-2 text-sm text-amber-800">
                    <p className="font-semibold text-xs">Produkcijski način</p>
                    <p className="text-xs text-amber-700">Zahteva produkcijski certifikat FURS. Testni certifikat ne deluje.</p>
                  </div>
                )}
              </div>

              <Button
                className={`w-full gap-2 ${ppRegMode === "zapri" ? "bg-destructive hover:bg-destructive/90 text-white" : ""}`}
                onClick={handleRegistrirajPp}
                disabled={registrirajPp.isPending || zapriPp.isPending}
              >
                {(registrirajPp.isPending || zapriPp.isPending) ? (
                  <><Loader2 className="h-4 w-4 animate-spin" /> Pošiljam zahtevek...</>
                ) : ppRegMode === "zapri" ? (
                  <><XCircle className="h-4 w-4" /> Pošlji zaprtje prostora</>
                ) : (
                  <><Building2 className="h-4 w-4" /> Pošlji registracijo</>
                )}
              </Button>
            </div>
          ) : (
            <div className="space-y-4 pt-2">
              {ppRegResult.uspeh ? (
                <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-green-800 font-semibold">
                    <CheckCircle2 className="h-5 w-5" />
                    {ppRegMode === "zapri" ? "Zaprtje uspešno" : "Registracija uspešna"}
                  </div>
                  <p className="text-sm text-green-700">
                    Prostor <strong>{ppRegTarget?.prostorId}</strong> je bil {ppRegMode === "zapri" ? "zaprt pri FURS" : "registriran pri FURS"}{ppFursNacin === "produkcija" ? " (produkcija)" : ppFursNacin === "testno" ? " (testni strežnik)" : " (simulacija)"}.
                  </p>
                </div>
              ) : (
                <div className="rounded-xl border border-red-200 bg-red-50 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-red-800 font-semibold">
                    <AlertCircle className="h-5 w-5" />
                    Napaka
                  </div>
                  <p className="text-sm text-red-700">{ppRegResult.napaka ?? "Napaka pri komunikaciji s FURS"}</p>
                </div>
              )}

              <div className="space-y-2">
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Odgovor FURS (surov)</p>
                <pre className="rounded-lg bg-muted p-3 text-xs overflow-auto max-h-40 whitespace-pre-wrap break-all">
                  {(() => {
                    try { return JSON.stringify(JSON.parse(ppRegResult.surovOdgovor ?? "{}"), null, 2); }
                    catch { return ppRegResult.surovOdgovor; }
                  })()}
                </pre>
              </div>

              <div className="flex gap-2">
                <Button variant="outline" className="flex-1" onClick={() => setPpRegResult(null)}>
                  Ponovni poskus
                </Button>
                <Button className="flex-1" onClick={() => setPpRegDialogOpen(false)}>
                  Zapri
                </Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Dodaj uporabnika dialog ────────────────────────────── */}
      <Dialog open={novUDialog} onOpenChange={open => { setNovUDialog(open); if (!open) { setUNapaka(""); setUZacasnoGeslo(null); setUZacasnoGesloPokazano(false); setUEmailPoslan(null); setUUsername(""); setUIme(""); setUEmail(""); setUVloga("uporabnik"); setUDavcna(""); setUGeslo(""); setUEnotaId(""); setUBlagajnaId(""); } }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><UserPlus className="h-5 w-5" />Nov uporabnik</DialogTitle>
          </DialogHeader>

          {uZacasnoGeslo && novUDialog ? (
            <div className="space-y-4 pt-2">
              <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 p-4 space-y-3">
                <p className="text-sm font-medium text-green-800 dark:text-green-300">
                  ✓ Uporabnik je bil uspešno ustvarjen. Ob prvi prijavi bo pozvan, da zamenja geslo.
                </p>
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Začasno geslo za <span className="font-mono font-medium">{uUsername}</span>:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 font-mono text-sm bg-background border rounded px-3 py-2 select-all">
                      {uZacasnoGesloPokazano ? uZacasnoGeslo : "•".repeat(uZacasnoGeslo.length)}
                    </code>
                    <button
                      type="button"
                      onClick={() => setUZacasnoGesloPokazano(v => !v)}
                      className="p-2 rounded-md border hover:bg-muted transition-colors"
                      title={uZacasnoGesloPokazano ? "Skrij geslo" : "Prikaži geslo"}
                    >
                      {uZacasnoGesloPokazano ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => { void navigator.clipboard.writeText(uZacasnoGeslo ?? ""); toast({ title: "Geslo kopirano v odložišče" }); }}
                      className="p-2 rounded-md border hover:bg-muted transition-colors"
                      title="Kopiraj geslo"
                    >
                      <KeyRound className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Sporočite to geslo zaposlenemu. Geslo bo ob prijavi zamenjano z novim.</p>
                {uEmailPoslan === true && <p className="text-xs text-green-700 font-medium">✓ Začasno geslo je bilo poslano na e-poštni naslov zaposlenega.</p>}
                {uEmailPoslan === false && <p className="text-xs text-amber-700">E-pošta ni bila poslana (SMTP ni nastavljen ali napaka). Geslo sporočite ročno.</p>}
              </div>
              <Button className="w-full" onClick={() => { setNovUDialog(false); }}>Zapri</Button>
            </div>
          ) : (
            <form onSubmit={handleDodajUporabnika} className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Uporabniško ime <span className="text-destructive">*</span></Label>
                <Input autoFocus autoComplete="off" value={uUsername} onChange={e => setUUsername(e.target.value)} placeholder="npr. janez" disabled={uLoading} />
              </div>
              <div className="space-y-2">
                <Label>Ime in priimek</Label>
                <Input autoComplete="off" value={uIme} onChange={e => setUIme(e.target.value)} placeholder="Janez Novak" disabled={uLoading} />
              </div>
              <div className="space-y-2">
                <Label>E-poštni naslov <span className="text-muted-foreground text-xs">(za pošiljanje gesla)</span></Label>
                <Input type="email" autoComplete="email" value={uEmail} onChange={e => setUEmail(e.target.value)} placeholder="janez@restavracija.si" disabled={uLoading} />
              </div>
              <div className="space-y-2">
                <Label>Geslo <span className="text-destructive">*</span></Label>
                <div className="relative">
                  <Input
                    type={uPokaziGeslo ? "text" : "password"}
                    autoComplete="new-password"
                    value={uGeslo} onChange={e => setUGeslo(e.target.value)}
                    placeholder="vsaj 6 znakov" disabled={uLoading}
                  />
                  <button type="button" onClick={() => setUPokaziGeslo(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {uPokaziGeslo ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Vloga</Label>
                <div className="flex gap-3 flex-wrap">
                  {(["uporabnik", "admin_enote", "admin"] as const).map(v => (
                    <button key={v} type="button"
                      onClick={() => { setUVloga(v); if (v !== "admin") setUDavcna(""); if (v !== "admin_enote") setUEnotaId(""); }}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-sm font-medium transition-all ${uVloga === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"}`}>
                      {v === "admin" ? <Shield className="h-4 w-4" /> : v === "admin_enote" ? <Shield className="h-3 w-3" /> : <Users className="h-4 w-4" />}
                      {v === "admin" ? "Administrator" : v === "admin_enote" ? "Admin enote" : "Uporabnik"}
                    </button>
                  ))}
                </div>
              </div>
              {(uVloga === "admin_enote" || uVloga === "uporabnik") && (
                <div className="space-y-2">
                  <Label>Enota <span className="text-destructive">*</span></Label>
                  <select
                    value={uEnotaId}
                    onChange={e => setUEnotaId(e.target.value === "" ? "" : Number(e.target.value))}
                    disabled={uLoading}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                  >
                    <option value="">— izberite enoto —</option>
                    {(enote ?? []).map((en: Enota) => (
                      <option key={en.id} value={en.id}>{en.ime}</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">Uporabnik bo uvrščen v izbrano enoto.</p>
                </div>
              )}
              {uVloga === "uporabnik" && (
                <div className="space-y-2">
                  <Label>Blagajna <span className="text-destructive">*</span></Label>
                  <select
                    value={uBlagajnaId}
                    onChange={e => setUBlagajnaId(e.target.value === "" ? "" : Number(e.target.value))}
                    disabled={uLoading}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                  >
                    <option value="">— izberite blagajno —</option>
                    {(blagajne ?? []).filter(b => b.aktivna).map(b => (
                      <option key={b.id} value={b.id}>{b.ppId}-{b.bId} {b.ime}</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">FURS blagajna, ki jo bo ta uporabnik uporabljal pri izdaji računov.</p>
                </div>
              )}
              {uVloga === "admin" && (
                <div className="space-y-2">
                  <Label>Davčna številka podjetja <span className="text-destructive">*</span></Label>
                  <Input
                    autoComplete="off"
                    value={uDavcna}
                    onChange={e => setUDavcna(e.target.value.trim())}
                    placeholder="npr. 12345678"
                    disabled={uLoading}
                  />
                  <p className="text-xs text-muted-foreground">Administrator bo upravljal samo uporabnike tega podjetja.</p>
                </div>
              )}
              {uNapaka && <p className="text-sm text-destructive font-medium">{uNapaka}</p>}
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setNovUDialog(false)} disabled={uLoading}>Prekliči</Button>
                <Button type="submit" className="flex-1" disabled={uLoading || !uUsername || !uGeslo || (uVloga === "admin" && !uDavcna) || ((uVloga === "admin_enote" || uVloga === "uporabnik") && !uEnotaId) || (uVloga === "uporabnik" && !uBlagajnaId)}>
                  {uLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Dodajam...</> : "Dodaj uporabnika"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Uredi uporabnika dialog ────────────────────────────── */}
      <Dialog open={editUDialog} onOpenChange={open => { setEditUDialog(open); if (!open) { setUNapaka(""); setUAdminNapaka(""); setEditingU(null); setUZacasnoGeslo(null); setUZacasnoGesloPokazano(false); } }}>
        <DialogContent className="max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2"><Pencil className="h-5 w-5" />Uredi uporabnika</DialogTitle>
          </DialogHeader>

          {uZacasnoGeslo ? (
            <div className="space-y-4 pt-2">
              <div className="rounded-lg border border-green-200 bg-green-50 dark:border-green-800 dark:bg-green-950/30 p-4 space-y-3">
                <p className="text-sm font-medium text-green-800 dark:text-green-300">
                  ✓ Geslo je bilo uspešno nastavljeno. Zaposleni bo ob naslednji prijavi pozvan, da ga zamenja.
                </p>
                {uEmailPoslan === true && (
                  <div className="flex items-center gap-2 text-sm text-green-700 bg-green-100 rounded-md px-3 py-2">
                    <Send className="h-4 w-4 shrink-0" />
                    Začasno geslo je bilo poslano na e-poštni naslov zaposlenega.
                  </div>
                )}
                {uEmailPoslan === false && editingU?.email && (
                  <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-md px-3 py-2">
                    <Mail className="h-4 w-4 shrink-0" />
                    E-pošta ni bila poslana — preverite SMTP nastavitve. Sporočite geslo ročno.
                  </div>
                )}
                <div className="space-y-1">
                  <p className="text-xs text-muted-foreground">Začasno geslo za <span className="font-mono font-medium">{uUsername}</span>:</p>
                  <div className="flex items-center gap-2">
                    <code className="flex-1 font-mono text-sm bg-background border rounded px-3 py-2 select-all">
                      {uZacasnoGesloPokazano ? uZacasnoGeslo : "•".repeat(uZacasnoGeslo.length)}
                    </code>
                    <button
                      type="button"
                      onClick={() => setUZacasnoGesloPokazano(v => !v)}
                      className="p-2 rounded-md border hover:bg-muted transition-colors"
                      title={uZacasnoGesloPokazano ? "Skrij geslo" : "Prikaži geslo"}
                    >
                      {uZacasnoGesloPokazano ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                    </button>
                    <button
                      type="button"
                      onClick={() => { void navigator.clipboard.writeText(uZacasnoGeslo ?? ""); toast({ title: "Geslo kopirano v odložišče" }); }}
                      className="p-2 rounded-md border hover:bg-muted transition-colors"
                      title="Kopiraj geslo"
                    >
                      <KeyRound className="h-4 w-4" />
                    </button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  {uEmailPoslan ? "Geslo je bilo poslano po e-pošti." : "Sporočite to geslo zaposlenemu ročno."} Geslo bo ob prijavi zamenjano z novim.
                </p>
              </div>
              <Button className="w-full" onClick={() => { setEditUDialog(false); }}>Zapri</Button>
            </div>
          ) : (
            <form onSubmit={handleUrediUporabnika} className="space-y-4 pt-2">
              <div className="space-y-2">
                <Label>Uporabniško ime</Label>
                <Input value={uUsername} disabled className="bg-muted/50 font-mono" />
              </div>
              <div className="space-y-2">
                <Label>Ime in priimek</Label>
                <Input autoComplete="off" value={uIme} onChange={e => setUIme(e.target.value)} placeholder="Janez Novak" disabled={uLoading} />
              </div>
              <div className="space-y-2">
                <Label>E-poštni naslov <span className="text-muted-foreground text-xs">(za pošiljanje gesla)</span></Label>
                <Input type="email" autoComplete="email" value={uEmail} onChange={e => setUEmail(e.target.value)} placeholder="janez@restavracija.si" disabled={uLoading} />
              </div>
              <div className="space-y-2">
                <Label>Novo geslo <span className="text-muted-foreground text-xs">(pustite prazno, da ohranite obstoječe)</span></Label>
                <div className="relative">
                  <Input
                    type={uPokaziGeslo ? "text" : "password"}
                    autoComplete="new-password"
                    value={uGeslo} onChange={e => setUGeslo(e.target.value)}
                    placeholder="vsaj 6 znakov" disabled={uLoading}
                  />
                  <button type="button" onClick={() => setUPokaziGeslo(v => !v)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground">
                    {uPokaziGeslo ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Vloga</Label>
                <div className="flex gap-3">
                  {(["uporabnik", "admin_enote", ...(!jeAdminEnote ? ["admin"] : []), ...(jeSuperAdmin ? ["superadmin"] : [])] as string[]).map(v => (
                    <button key={v} type="button"
                      onClick={() => { setUVloga(v); if (v === "uporabnik" || v === "admin_enote") setUDavcna(""); }}
                      disabled={editingU?.id === prijavljen?.id}
                      className={`flex-1 flex items-center justify-center gap-2 py-2 px-3 rounded-lg border text-sm font-medium transition-all ${uVloga === v ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-muted"} disabled:opacity-50 disabled:cursor-not-allowed`}>
                      {v === "superadmin" ? <ShieldCheck className="h-4 w-4" /> : v === "admin" ? <Shield className="h-4 w-4" /> : v === "admin_enote" ? <Shield className="h-3 w-3" /> : <Users className="h-4 w-4" />}
                      {v === "superadmin" ? "Super-admin" : v === "admin" ? "Administrator" : v === "admin_enote" ? "Admin enote" : "Uporabnik"}
                    </button>
                  ))}
                </div>
                {editingU?.id === prijavljen?.id && (
                  <p className="text-xs text-muted-foreground">Vloge lastnega računa ni mogoče spremeniti.</p>
                )}
              </div>
              {(uVloga === "admin_enote" || uVloga === "uporabnik") && (
                <div className="space-y-2">
                  <Label>Enota <span className="text-destructive">*</span></Label>
                  <select
                    value={uEnotaId}
                    onChange={e => setUEnotaId(e.target.value === "" ? "" : Number(e.target.value))}
                    disabled={uLoading}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                  >
                    <option value="">— izberite enoto —</option>
                    {(enote ?? []).map((en: Enota) => (
                      <option key={en.id} value={en.id}>{en.ime}</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">Uporabnik bo uvrščen v izbrano enoto.</p>
                </div>
              )}
              {uVloga === "uporabnik" && (
                <div className="space-y-2">
                  <Label>Blagajna</Label>
                  <select
                    value={uBlagajnaId}
                    onChange={e => setUBlagajnaId(e.target.value === "" ? "" : Number(e.target.value))}
                    disabled={uLoading}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                  >
                    <option value="">— izberite blagajno —</option>
                    {(blagajne ?? []).filter(b => b.aktivna).map(b => (
                      <option key={b.id} value={b.id}>{b.ppId}-{b.bId} {b.ime}</option>
                    ))}
                  </select>
                  <p className="text-xs text-muted-foreground">FURS blagajna, ki jo bo ta uporabnik uporabljal pri izdaji računov.</p>
                </div>
              )}
              {(uVloga === "admin" || uVloga === "superadmin") && (
                <div className="space-y-2">
                  <Label>Davčna številka podjetja</Label>
                  <Input
                    autoComplete="off"
                    value={uDavcna}
                    onChange={e => setUDavcna(e.target.value.trim())}
                    placeholder="npr. 12345678"
                    disabled={uLoading}
                  />
                  <p className="text-xs text-muted-foreground">Podjetje, ki ga ta račun upravlja.</p>
                </div>
              )}
              {uAdminNapaka && (
                <Alert className="border-amber-300 bg-amber-50 text-amber-900 dark:border-amber-700 dark:bg-amber-950/40 dark:text-amber-200">
                  <Shield className="h-4 w-4 !text-amber-600 dark:!text-amber-400" />
                  <AlertDescription className="font-medium">{uAdminNapaka}</AlertDescription>
                </Alert>
              )}
              {uNapaka && <p className="text-sm text-destructive font-medium">{uNapaka}</p>}
              <div className="flex gap-2 pt-1">
                <Button type="button" variant="outline" className="flex-1" onClick={() => setEditUDialog(false)} disabled={uLoading}>Prekliči</Button>
                <Button type="submit" className="flex-1" disabled={uLoading}>
                  {uLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Shranjujem...</> : "Shrani spremembe"}
                </Button>
              </div>
            </form>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!deleteUporabnikTarget} onOpenChange={(open) => { if (!open) setDeleteUporabnikTarget(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Izbriši uporabnika</AlertDialogTitle>
            <AlertDialogDescription>
              Res želite izbrisati uporabnika <strong>{deleteUporabnikTarget?.username}</strong>? Tega dejanja ni mogoče razveljaviti.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Prekliči</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleDeleteUporabnik}
            >
              Izbriši
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
