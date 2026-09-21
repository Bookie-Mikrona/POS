import { useState, useEffect, useRef, useCallback } from "react";

import { useSearch, useLocation as useWouterLocation } from "wouter";
import { useQuery } from "@tanstack/react-query";
import {
  useListMize,
  useCreateMiza,
  useDeleteMiza,
  useUpdateMiza,
  useBulkPozicijaMize,
  useUpdateNastavitve,
  useUpdateNapraveTerminali,
  useEnrollPaytenAndroidBridge,
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
  useGetCurrentPublicIp,
  useListCostCenters,
  useListBlagajne,
  useCreateBlagajna,
  useUpdateBlagajna,
  useDeleteBlagajna,
  useListNaprave,
  useUpdateNaprava,
  useDeleteNaprava,
  getListTestniZagoniQueryOptions,
  getGetNastavitveQueryKey,
  getGetProstorTlorisQueryKey,
  getListMizeQueryKey,
  getListNatakariQueryKey,
  getListPoslovniProstoriQueryKey,
  getListProstoriQueryKey,
  getListEnoteQueryKey,
  getListBlagajneQueryKey,
  getListNapraveQueryKey,
  customFetch,
  getAuthToken,
  getEnotaId,
} from "@workspace/api-client-react";
import type { TestniZagonPogled, Enota, BlagajnaPogled, Naprava } from "@workspace/api-client-react";
import { useNaprava } from "@/contexts/NapravaContext";
import { prikaziZavihekEnote, smeUpravljatiEnote } from "@/lib/enoteTabVidnost";
import { Card, CardContent, CardFooter, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from "@/components/ui/collapsible";
import { Accordion, AccordionItem, AccordionTrigger, AccordionContent } from "@/components/ui/accordion";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SecretInput } from "@/components/SecretInput";
import { DecimalInput, parseDecimal } from "@/components/ui/decimal-input";
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
import { Trash2, Wifi, WifiOff, Save, RefreshCw, Pencil, UserPlus, UserCheck, UserX, Building2, CheckCircle2, AlertCircle, Loader2, PlusCircle, XCircle, RotateCcw, ShieldCheck, Upload, FileKey, FileText, AlertTriangle, KeyRound, Users, Shield, EyeOff, Eye, Mail, Send, Search, FlaskConical, ChevronDown, ChevronRight, LayoutDashboard, HardDrive, CloudUpload, FolderDown, Database, Percent, Mic, Plus, X, Printer, Download, BookOpen, Store, LocateFixed } from "lucide-react";
import { useGlasovniSinonimi } from "@/hooks/use-glasovni-sinonimi";
import { TipPolicySettings } from "@/components/TipPolicySettings";
import { useGlasovniUkaz, jePodprtGlasovniVnos } from "@/hooks/use-glasovni-ukaz";
import { KdsSettings } from "@/components/KdsSettings";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from "recharts";
import type { Nastavitve, Miza, Natakari, PoslovniProstor, Prostor } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNastavitve } from "@/contexts/NastavitveContext";
import { posFetch } from "@/lib/pos-auth-headers";
import { DostavaSettings } from "@/components/DostavaSettings";
import { NaseljaSettings } from "@/components/NaseljaSettings";
import { HappyHourSettings } from "@/components/HappyHourSettings";
import { FiscalServicePairing } from "@/components/FiscalServicePairing";
import { LocalGatewaySettings } from "@/components/LocalGatewaySettings";
import { GatewaySyncReviewPanel } from "@/components/GatewaySyncReviewPanel";
import {
  ALL_UNIT_CAPABILITIES,
  CAPABILITY_LABELS,
  HOSPITALITY_PROFILES,
  SERVICE_MODE_LABELS,
  profileDefaults,
  type HospitalityProfile,
  type ServiceMode,
  type UnitCapability,
} from "@/lib/unitProfiles";
import { parseSettingsNavigation, type SettingsTab } from "@/lib/settings-navigation";
import { resolveVisibleSettingsTab } from "@/lib/settings-tab-visibility";

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

import { TlorisEditor } from "@/components/TlorisEditor";

export default function Settings() {
  const { user: prijavljen, updateUser } = useAuth();
  const jeAdmin = prijavljen?.vloga === "admin" || prijavljen?.vloga === "superadmin";
  const jeSuperAdmin = prijavljen?.vloga === "superadmin";
  const jeAdminEnote = prijavljen?.vloga === "admin_enote";
  const jeUporabnik = !jeAdmin && !jeAdminEnote && !jeSuperAdmin;
  const lahkoNastaviNatakarPin = jeAdmin || jeAdminEnote;

  const base = import.meta.env.BASE_URL.replace(/\/$/, "");

  const { data: mize } = useListMize();
  const createMiza = useCreateMiza();
  const deleteMiza = useDeleteMiza();
  const updateMiza = useUpdateMiza();
  const bulkPozicija = useBulkPozicijaMize();
  const [tlorisSelectedProstorId, setTlorisSelectedProstorId] = useState<number | null>(null);
  const { data: prostori } = useListProstori();
  const createProstor = useCreateProstor();
  const updateProstorMut = useUpdateProstor();
  const deleteProstorMut = useDeleteProstor();
  const { nastavitve, nastavitveLoading } = useNastavitve();
  const updateNastavitve = useUpdateNastavitve();
  const updateNapraveTerminali = useUpdateNapraveTerminali();
  const enrollPaytenBridge = useEnrollPaytenAndroidBridge();
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
  const [napravEditTiskalnikSirina, setNapravEditTiskalnikSirina] = useState<30 | 32 | 58 | 80 | null>(null);
  const [napravEditJeWindows, setNapravEditJeWindows] = useState(false);
  const [napravEditCodePage, setNapravEditCodePage] = useState<"cp1250" | "wpc1250" | "cp852" | "ascii-translit" | "bitmap">("cp1250");
  const [napravEditAiSvetovalecAktiven, setNapravEditAiSvetovalecAktiven] = useState(false);
  const [qrAiAsistentAktiven, setQrAiAsistentAktiven] = useState(false);
  const [toastTocilnicaAktiven, setToastTocilnicaAktiven] = useState(true);

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
  const [bEnotaId, setBEnotaId] = useState<number | "">("");  // admin: enota za novo blagajno
  const [bDialogOpen, setBDialogOpen] = useState(false);
  const [editingBlagajna, setEditingBlagajna] = useState<BlagajnaPogled | null>(null);
  const [editBPpId, setEditBPpId] = useState("");
  const [editBBId, setEditBBId] = useState("");
  const [editBIme, setEditBIme] = useState("");
  const [editBAktivna, setEditBAktivna] = useState(true);
  const [editBEnotaId, setEditBEnotaId] = useState<number | "">("");  // admin: enota pri urejanju

  // Admin: vse blagajne podjetja (brez filtra registracije) za upravljanje
  const { data: vseBlagajne, refetch: refetchVseBlagajne } = useQuery<BlagajnaPogled[]>({
    queryKey: ["admin-blagajne-vse"],
    queryFn: () => customFetch<BlagajnaPogled[]>(`/api/blagajne?all=true`),
    enabled: jeAdmin,
  });

  const handleCreateBlagajna = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bIme.trim()) { toast({ title: "Vnesite naziv blagajne", variant: "destructive" }); return; }
    if (!bPpId.trim()) { toast({ title: "Vnesite ID poslovnega prostora", variant: "destructive" }); return; }
    if (!bBId.trim()) { toast({ title: "Vnesite ID elektronske naprave", variant: "destructive" }); return; }
    if (jeAdmin && !bEnotaId) { toast({ title: "Izberite enoto za blagajno", variant: "destructive" }); return; }
    try {
      const extraData = jeAdmin && bEnotaId ? { enotaId: bEnotaId } : {};
      await createBlagajna.mutateAsync({ data: { ppId: bPpId.trim(), bId: bBId.trim(), ime: bIme.trim(), ...extraData } as any });
      setBPpId(""); setBBId(""); setBIme(""); setBEnotaId("");
      queryClient.invalidateQueries({ queryKey: getListBlagajneQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["admin-blagajne-vse"] });
      toast({ title: "Blagajna dodana" });
    } catch { toast({ title: "Napaka pri dodajanju blagajne", variant: "destructive" }); }
  };

  const openEditBlagajna = (b: BlagajnaPogled) => {
    setEditingBlagajna(b);
    setEditBPpId(b.ppId);
    setEditBBId(b.bId);
    setEditBIme(b.ime);
    setEditBAktivna(b.aktivna);
    setEditBEnotaId((b as any).enotaId ?? "");
    setBDialogOpen(true);
  };

  const handleUpdateBlagajna = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingBlagajna) return;
    try {
      const extraData = jeAdmin && editBEnotaId ? { enotaId: editBEnotaId } : {};
      await updateBlagajnaMut.mutateAsync({ id: editingBlagajna.id, data: { ppId: editBPpId.trim(), bId: editBBId.trim(), ime: editBIme.trim(), aktivna: editBAktivna, ...extraData } as any });
      setBDialogOpen(false);
      queryClient.invalidateQueries({ queryKey: getListBlagajneQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["admin-blagajne-vse"] });
      toast({ title: "Blagajna posodobljena" });
    } catch { toast({ title: "Napaka pri posodabljanju blagajne", variant: "destructive" }); }
  };

  const handleDeleteBlagajna = async (id: number) => {
    try {
      await deleteBlagajnaMut.mutateAsync({ id });
      queryClient.invalidateQueries({ queryKey: getListBlagajneQueryKey() });
      queryClient.invalidateQueries({ queryKey: ["admin-blagajne-vse"] });
      refetchBlagajne();
      refetchVseBlagajne?.();
      toast({ title: "Blagajna izbrisana" });
    } catch { toast({ title: "Blagajne ni mogoče izbrisati", variant: "destructive" }); }
  };

  // ── Enote ──────────────────────────────────────────────────
  const { data: enote, refetch: refetchEnote } = useListEnote();
  const createEnota = useCreateEnota();
  const updateEnota = useUpdateEnota();
  const deleteEnota = useDeleteEnota();
  const currentPublicIp = useGetCurrentPublicIp({ query: { enabled: false, retry: false } as any });
  const [eIme, setEIme] = useState("");
  const [eOpis, setEOpis] = useState("");
  const [eAktiven, setEAktiven] = useState(true);
  const [eCostCenterId, setECostCenterId] = useState("");
  const [eProfile, setEProfile] = useState<HospitalityProfile>("restaurant");
  const [editEnotaOpen, setEditEnotaOpen] = useState(false);
  const [editingEnota, setEditingEnota] = useState<Enota | null>(null);
  const [editEIme, setEditEIme] = useState("");
  const [editEOpis, setEditEOpis] = useState("");
  const [editEAktiven, setEditEAktiven] = useState(true);
  const [editEStudentskiBonAktiven, setEditEStudentskiBonAktiven] = useState(false);
  const [editEZacetekDnevaUra, setEditEZacetekDnevaUra] = useState("04:00");
  const [editECostCenterId, setEditECostCenterId] = useState("");
  const [editEQrLatitude, setEditEQrLatitude] = useState("");
  const [editEQrLongitude, setEditEQrLongitude] = useState("");
  const [editEQrWifiNetworks, setEditEQrWifiNetworks] = useState("");
  const [editEQrWifiSsid, setEditEQrWifiSsid] = useState("");
  const [editEQrWifiPassword, setEditEQrWifiPassword] = useState("");
  const [editEProfile, setEditEProfile] = useState<HospitalityProfile>("restaurant");
  const [editECapabilities, setEditECapabilities] = useState<UnitCapability[]>([]);
  const [editEIsTemporary, setEditEIsTemporary] = useState(false);
  const [editEServiceMode, setEditEServiceMode] = useState<ServiceMode>("mixed");
  const [editETemporaryLocation, setEditETemporaryLocation] = useState("");
  const [editEParentUnitId, setEditEParentUnitId] = useState("");
  const [editEActiveFrom, setEditEActiveFrom] = useState("");
  const [editEActiveTo, setEditEActiveTo] = useState("");
  const [qrLokacijoIscem, setQrLokacijoIscem] = useState(false);

  // STM (stroškovna mesta) za dodelitev enotam — samo aktivna
  const { data: costCentersData } = useListCostCenters(
    prijavljen?.companyId ?? "",
    {},
    { query: { enabled: !!prijavljen?.companyId && (jeAdmin || jeAdminEnote) && !jeSuperAdmin } as any },
  );
  const stroskovnaMesta = costCentersData?.costCenters ?? [];

  const handleCreateEnota = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!eIme.trim()) return;
    try {
      const defaults = profileDefaults(eProfile);
      await createEnota.mutateAsync({ data: {
        ime: eIme.trim(),
        opis: eOpis.trim() || null,
        aktiven: eAktiven,
        costCenterId: eCostCenterId || null,
        hospitalityProfile: eProfile,
        serviceMode: defaults.serviceMode,
        capabilities: defaults.capabilities,
        isTemporary: defaults.temporary ?? false,
      } });
      setEIme(""); setEOpis(""); setEAktiven(true); setECostCenterId(""); setEProfile("restaurant");
      queryClient.invalidateQueries({ queryKey: getListEnoteQueryKey() });
      toast({ title: "Enota dodana" });
    } catch { toast({ title: "Napaka pri dodajanju enote", variant: "destructive" }); }
  };

  const openEditEnota = (e: Enota) => {
    setEditingEnota(e); setEditEIme(e.ime); setEditEOpis(e.opis ?? ""); setEditEAktiven(e.aktiven);
    setEditEZacetekDnevaUra(e.zacetekDnevaUra ?? "04:00");
    setEditECostCenterId(e.costCenterId ?? "");
    setEditEStudentskiBonAktiven(e.studentskiBonAktiven ?? false);
    setEditEQrLatitude(e.qrLatitude == null ? "" : String(e.qrLatitude));
    setEditEQrLongitude(e.qrLongitude == null ? "" : String(e.qrLongitude));
    setEditEQrWifiNetworks((e.qrWifiNetworks ?? []).join("\n"));
    setEditEQrWifiSsid(e.qrWifiSsid ?? "");
    setEditEQrWifiPassword(e.qrWifiPassword ?? "");
    const profile = (e.hospitalityProfile ?? "restaurant") as HospitalityProfile;
    setEditEProfile(profile);
    setEditECapabilities((e.capabilities ?? profileDefaults(profile).capabilities) as UnitCapability[]);
    setEditEIsTemporary(e.isTemporary ?? false);
    setEditEServiceMode((e.serviceMode ?? profileDefaults(profile).serviceMode) as ServiceMode);
    setEditETemporaryLocation(e.temporaryLocation ?? "");
    setEditEParentUnitId(e.parentUnitId == null ? "" : String(e.parentUnitId));
    setEditEActiveFrom(e.activeFrom ? String(e.activeFrom).slice(0, 16) : "");
    setEditEActiveTo(e.activeTo ? String(e.activeTo).slice(0, 16) : "");
    setEditEnotaOpen(true);
  };

  const dolociQrLokacijo = () => {
    if (!navigator.geolocation) {
      toast({ title: "Brskalnik ne podpira določanja lokacije", variant: "destructive" });
      return;
    }
    setQrLokacijoIscem(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setEditEQrLatitude(position.coords.latitude.toFixed(6));
        setEditEQrLongitude(position.coords.longitude.toFixed(6));
        setQrLokacijoIscem(false);
        toast({
          title: "Lokacija določena",
          description: `Natančnost naprave: približno ${Math.round(position.coords.accuracy)} m. Spremembo še shranite.`,
        });
      },
      () => {
        setQrLokacijoIscem(false);
        toast({
          title: "Lokacije ni bilo mogoče določiti",
          description: "Preverite dovoljenje za lokacijo in poskusite znova.",
          variant: "destructive",
        });
      },
      { enableHighAccuracy: true, timeout: 15_000, maximumAge: 0 },
    );
  };

  const dodajTrenutniJavniIp = async () => {
    const result = await currentPublicIp.refetch();
    if (!result.data) {
      toast({ title: "Javnega IP-ja ni bilo mogoče prebrati", variant: "destructive" });
      return;
    }
    if (!result.data.veljavenZaQrWifi) {
      toast({
        title: "Zaznani naslov ni primeren",
        description: `API je zaznal ${result.data.javniIp || "neznan naslov"}, ki ni globalno usmerljiv javni IP.`,
        variant: "destructive",
      });
      return;
    }
    const existing = editEQrWifiNetworks.split(/[\n,]+/).map(value => value.trim()).filter(Boolean);
    if (!existing.includes(result.data.javniIp)) {
      setEditEQrWifiNetworks([...existing, result.data.javniIp].join("\n"));
    }
    toast({
      title: "Javni IP lokalnega Wi-Fi-ja je dodan",
      description: `${result.data.javniIp} — spremembo še shranite.`,
    });
  };

  const handleUpdateEnota = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingEnota) return;
    try {
      const qrLatitude = editEQrLatitude.trim() === "" ? null : Number(editEQrLatitude);
      const qrLongitude = editEQrLongitude.trim() === "" ? null : Number(editEQrLongitude);
      const qrWifiNetworks = [...new Set(
        editEQrWifiNetworks.split(/[\n,]+/).map(value => value.trim()).filter(Boolean),
      )];
      if (qrWifiNetworks.length > 20) {
        toast({ title: "Vnesete lahko največ 20 javnih IP-jev ali CIDR-obsegov", variant: "destructive" });
        return;
      }
      if (editEQrWifiSsid.trim().length > 64) {
        toast({ title: "Ime Wi-Fi omrežja lahko vsebuje največ 64 znakov", variant: "destructive" });
        return;
      }
      if (editEQrWifiPassword.length > 128) {
        toast({ title: "Geslo Wi-Fi omrežja lahko vsebuje največ 128 znakov", variant: "destructive" });
        return;
      }
      if (
        (qrLatitude === null) !== (qrLongitude === null)
        || (qrLatitude !== null && (!Number.isFinite(qrLatitude) || qrLatitude < -90 || qrLatitude > 90))
        || (qrLongitude !== null && (!Number.isFinite(qrLongitude) || qrLongitude < -180 || qrLongitude > 180))
      ) {
        toast({ title: "Lokacija QR menija ni veljavna", variant: "destructive" });
        return;
      }
      await updateEnota.mutateAsync({
        id: editingEnota.id,
        data: {
          ime: editEIme.trim(),
          opis: editEOpis.trim() || null,
          aktiven: editEAktiven,
          zacetekDnevaUra: editEZacetekDnevaUra,
          costCenterId: editECostCenterId || null,
          qrLatitude,
          qrLongitude,
          qrWifiNetworks,
          qrWifiSsid: editEQrWifiSsid.trim() || null,
          qrWifiPassword: editEQrWifiPassword || null,
          studentskiBonAktiven: editEStudentskiBonAktiven,
          hospitalityProfile: editEProfile,
          serviceMode: editEServiceMode,
          capabilities: editECapabilities,
          isTemporary: editEIsTemporary,
          temporaryLocation: editEIsTemporary ? editETemporaryLocation.trim() || null : null,
          parentUnitId: editEParentUnitId ? Number(editEParentUnitId) : null,
          activeFrom: editEActiveFrom ? new Date(editEActiveFrom).toISOString() : null,
          activeTo: editEActiveTo ? new Date(editEActiveTo).toISOString() : null,
        },
      });
      if (prijavljen?.enotaId === editingEnota.id) {
        updateUser({
          hospitalityProfile: editEProfile,
          capabilities: editECapabilities,
          enote: prijavljen.enote?.map(unit => unit.id === editingEnota.id
            ? { ...unit, hospitalityProfile: editEProfile, capabilities: editECapabilities }
            : unit),
        });
      }
      setEditEnotaOpen(false);
      queryClient.invalidateQueries({ queryKey: getListEnoteQueryKey() });
      toast({ title: "Enota posodobljena" });
    } catch (error: unknown) {
      let description: string | undefined;
      if (error && typeof error === "object" && "response" in error) {
        const payload = await (error as { response: Response }).response.json().catch(() => null) as {
          napaka?: string;
          blockers?: Array<{ description?: string }>;
        } | null;
        description = payload?.blockers?.map(blocker => blocker.description).filter(Boolean).join(" ") || payload?.napaka;
      }
      toast({ title: "Enote ni bilo mogoče posodobiti", description, variant: "destructive" });
    }
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
  const [editNClerkUserId, setEditNClerkUserId] = useState<string | null>(null);
  const [editNPosPin, setEditNPosPin] = useState("");
  const [editNPosPinSaving, setEditNPosPinSaving] = useState(false);
  const [posUporabniki, setPosUporabniki] = useState<Array<{ id: number; clerkUserId: string; ime: string; priimek: string; enotaIme?: string | null }>>([]);

  // ── Poslovni prostori ──────────────────────────────────────
  const { data: poslovniProstori } = useListPoslovniProstori();
  const createPp = useCreatePoslovniProstor();
  const updatePp = useUpdatePoslovniProstor();
  const deletePp = useDeletePoslovniProstor();
  const registrirajPp = useRegistrirajProstor();
  const zapriPp = useZapriProstor();

  const [ppDialogOpen, setPpDialogOpen] = useState(false);
  const [editingPp, setEditingPp] = useState<PoslovniProstor | null>(null);
  const [ppEnotaId, setPpEnotaId] = useState<number | "">("");  // admin: enota za prostor
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

  // ── Nastavitve ─────────────────────────────────────────────
  const [terminalIp, setTerminalIp] = useState("");
  const [terminalPort, setTerminalPort] = useState("9000");
  const [terminalTimeout, setTerminalTimeout] = useState("30000");
  const [terminalAktiven, setTerminalAktiven] = useState(false);
  const [paytenAndroidAktiven, setPaytenAndroidAktiven] = useState(false);
  const [paytenBridgePairing, setPaytenBridgePairing] = useState(false);
  const [nazivRestavracije, setNazivRestavracije] = useState("");
  const [naslovRestavracije, setNaslovRestavracije] = useState("");
  const [naslovUlica, setNaslovUlica] = useState("");
  const [naslovPostna, setNaslovPostna] = useState("");
  const [naslovKraj, setNaslovKraj] = useState("");
  const [davcnaStevilka, setDavcnaStevilka] = useState("");
  const [idZaDdv, setIdZaDdv] = useState("");
  const [poslovniProstor, setPoslovniProstor] = useState("PP001");
  const [elektronskaNaprava, setElektronskaNaprava] = useState("B001");
  const [ponudnikDavcna, setPonudnikDavcna] = useState("");
  const [racunPozdrav1, setRacunPozdrav1] = useState("Hvala za obisk!");
  const [racunPozdrav2, setRacunPozdrav2] = useState("Vracamo se — se vidimo.");
  const [fursNacin, setFursNacin] = useState<"simulacija" | "testno" | "produkcija">("simulacija");
  const [fursProxyUrl, setFursProxyUrl] = useState("");
  const [simulirajFursNapako, setSimulirajFursNapako] = useState(false);
  const [dovoliNegativneZaloge, setDovoliNegativneZaloge] = useState(true);
  const [picaPremerMala, setPicaPremerMala] = useState(0);
  const [picaPremerNormalna, setPicaPremerNormalna] = useState(0);
  const [picaPremerDruzinska, setPicaPremerDruzinska] = useState(0);
  const pizzaNormativnaOsnova = picaPremerNormalna > 0
    ? picaPremerNormalna
    : [picaPremerMala, picaPremerDruzinska].find((premer) => premer > 0) ?? 0;
  const pizzaKoeficient = (premer: number) => {
    if (premer <= 0 || pizzaNormativnaOsnova <= 0) return null;
    const povrsina = 3.14 * (premer / 2) ** 2;
    const osnovnaPovrsina = 3.14 * (pizzaNormativnaOsnova / 2) ** 2;
    return povrsina / osnovnaPovrsina;
  };
  const [grupiranjeNacin, setGrupiranjeNacin] = useState<"izklopljeno" | "staro" | "novo">("novo");
  const [grupiranjeNacinShranjujem, setGrupiranjeNacinShranjujem] = useState(false);
  const [agentTiskalnikIme, setAgentTiskalnikIme] = useState("");
  const [tiskalnikSirina, setTiskalnikSirina] = useState<30 | 32 | 58 | 80>(58);
  const [tiskalnikCodePage, setTiskalnikCodePage] = useState<"cp1250" | "wpc1250" | "cp852" | "ascii-translit" | "bitmap">("cp1250");
  const [scannerBridgeStatus, setScannerBridgeStatus] = useState<"checking" | "ok" | "offline" | "idle">("idle");
  const [scannerBridgeVersion, setScannerBridgeVersion] = useState<string | null>(null);
  const [podjetjeTrr, setPodjetjeTrr] = useState<Array<{ iban: string; bic: string }>>([]);
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

  // ── bizBox per-podjetje poverilnice ────────────────────────
  // ── Nastavitve: accordion + iskanje ────────────────────────────
  const [nastavitveSearch, setNavSearch] = useState("");
  const [nsAkkordeon, setNsAkkordeon] = useState<string[]>([]);

  const [bizboxUser, setBizboxUser] = useState("");
  const [bizboxNovGeslo, setBizboxNovGeslo] = useState("");
  const [bizboxGesloNastavljeno, setBizboxGesloNastavljeno] = useState(false);
  const [bizboxOkolje, setBizboxOkolje] = useState<"test" | "prod">("test");
  const [bizboxPosiljateljDavcna, setBizboxPosiljateljDavcna] = useState("");
  const [bizboxShranjujem, setBizboxShranjujem] = useState(false);
  const [bizboxNaložen, setBizboxNaložen] = useState(false);

  // ── e-Račun registracija podjetja (admin ureja prek /api/companies/:id/eracun-nastavitve)
  const [erPrejemnik, setErPrejemnik] = useState(false);
  const [erOmrezje, setErOmrezje] = useState("");
  const [erNaslov, setErNaslov] = useState("");
  const [erEmail, setErEmail] = useState("");
  const [erSifraPu, setErSifraPu] = useState("");
  const [erBic, setErBic] = useState("");
  const [erNaložen, setErNaložen] = useState(false);
  const [erShranjujem, setErShranjujem] = useState(false);

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

  // ── DDV razreševalnik nastavitve ────────────────────────────
  const [toGoTopliNapitekStopnja, setToGoTopliNapitekStopnja] = useState<"konservativno" | "liberalno">("konservativno");
  const [toGoTopliShranjujem, setToGoTopliShranjujem] = useState(false);

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
  const [p12Uploading, setP12Uploading] = useState(false);
  const [p12Rezultat, setP12Rezultat] = useState<{
    uspeh: boolean; nastavljen?: boolean; subject?: string | null; veljaDo?: string | null; napaka?: string
  } | null>(null);

  interface CertInfo {
    nastavljen: boolean;
    subject: string | null;
    veljaDo: string | null;
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
      const res = await fetch(`${base}/api/certifikat/nalozi`, { method: "POST", credentials: "include", body: fd });
      const data = await res.json() as typeof p12Rezultat;
      setP12Rezultat(data);
      if (data?.uspeh) {
        await refetchCert();
        localStorage.removeItem("certExpiryCache");
        toast({ title: "Certifikat uspešno naložen v podjetje", description: data.subject ?? "Certifikat shranjen" });
        if (p12FileRef.current) p12FileRef.current.value = "";
      }
    } catch {
      setP12Rezultat({ uspeh: false, napaka: "Omrežna napaka" });
    } finally {
      setP12Geslo("");
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
          splosnaSt: parseDecimal(ddvSplosnaSt),
          nizjaSt: parseDecimal(ddvNizjaSt),
          znizanaSt: parseDecimal(ddvZnizanaSt),
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
      // Auto-fill iz podatkov podjetja, kadar vrednosti še niso bile shranjene
      setNazivRestavracije(nastavitve.nazivRestavracije || prijavljen?.companyNaziv || "");
      setNaslovRestavracije(nastavitve.naslovRestavracije || prijavljen?.companyNaslov || "");
      setNaslovUlica((nastavitve as any).naslovUlica || prijavljen?.companyUlica || "");
      setNaslovPostna((nastavitve as any).naslovPostna || prijavljen?.companyPostna || "");
      setNaslovKraj((nastavitve as any).naslovKraj || prijavljen?.companyKraj || "");
      setDavcnaStevilka(nastavitve.davcnaStevilka || prijavljen?.podjetjeDavcna || "");
      setIdZaDdv(nastavitve.idZaDdv || prijavljen?.idZaDdv || "");
      setPoslovniProstor(nastavitve.poslovniProstor ?? "PP001");
      setElektronskaNaprava(nastavitve.elektronskaNaprava ?? "B001");
      // ponudnikDavcna: auto-fill iz davčne številke podjetja, če ni bila še nastavljena
      setPonudnikDavcna(
        (nastavitve.ponudnikDavcna || "") ||
        (prijavljen?.podjetjeDavcna ?? "")
      );
      setRacunPozdrav1(nastavitve.racunPozdrav1 ?? "Hvala za obisk!");
      setRacunPozdrav2(nastavitve.racunPozdrav2 ?? "Vracamo se — se vidimo.");
      setFursProxyUrl((nastavitve as Nastavitve & { fursProxyUrl?: string }).fursProxyUrl ?? "");
      setSimulirajFursNapako((nastavitve as Nastavitve & { simulirajFursNapako?: boolean }).simulirajFursNapako ?? false);
      setDovoliNegativneZaloge((nastavitve as Nastavitve & { dovoliNegativneZaloge?: boolean }).dovoliNegativneZaloge ?? true);
      setPicaPremerMala((nastavitve as Nastavitve & { picaPremerMala?: number }).picaPremerMala ?? 0);
      setPicaPremerNormalna((nastavitve as Nastavitve & { picaPremerNormalna?: number }).picaPremerNormalna ?? 0);
      setPicaPremerDruzinska((nastavitve as Nastavitve & { picaPremerDruzinska?: number }).picaPremerDruzinska ?? 0);
      setGrupiranjeNacin(((nastavitve as Nastavitve & { grupiranjeNacin?: string }).grupiranjeNacin ?? "novo") as "izklopljeno" | "staro" | "novo");
      setToGoTopliNapitekStopnja(((nastavitve as any).toGoTopliNapitekStopnja ?? "konservativno") as "konservativno" | "liberalno");
      const fn = ((nastavitve as Nastavitve & { fursNacin?: string }).fursNacin ?? "simulacija") as "simulacija" | "testno" | "produkcija";
      setFursNacin(fn);
      setPpFursNacin(fn);
      setPodjetjeTrr((nastavitve as Nastavitve & { podjetjeTrr?: Array<{ iban: string; bic: string }> }).podjetjeTrr ?? []);
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
      setQrAiAsistentAktiven((nastavitve as Nastavitve & { qrAiAsistentAktiven?: boolean }).qrAiAsistentAktiven ?? false);
      setToastTocilnicaAktiven((nastavitve as Nastavitve & { toastTocilnicaAktiven?: boolean }).toastTocilnicaAktiven ?? true);
    }
  }, [nastavitve, prijavljen]);

  // ── Nalaganje per-podjetje bizBox poverilnic (ločen endpoint) ───────────────
  useEffect(() => {
    if (!jeAdmin) return;
    (async () => {
      try {
        const token = await getAuthToken();
        const enotaId = getEnotaId();
        const headers: Record<string, string> = {};
        if (token) headers["Authorization"] = `Bearer ${token}`;
        if (enotaId) headers["X-Enota-Id"] = enotaId;
        const r = await fetch(`${import.meta.env.BASE_URL}api/bizbox-nastavitve`, {
          credentials: "include",
          headers,
        });
        if (!r.ok) return;
        const data = await r.json() as { gesloNastavljeno?: boolean; bizboxUser?: string; bizboxOkolje?: string; posiljateljDavcna?: string | null };
        setBizboxGesloNastavljeno(data.gesloNastavljeno ?? false);
        setBizboxUser(data.bizboxUser ?? "");
        setBizboxOkolje((data.bizboxOkolje ?? "test") as "test" | "prod");
        setBizboxPosiljateljDavcna(data.posiljateljDavcna ?? "");
        setBizboxNovGeslo("");
        setBizboxNaložen(true);
      } catch { /* omrežna napaka — nič */ }
    })();
  }, [jeAdmin]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── e-Račun registracija: nalaganje (samo admin, za lastno podjetje)
  useEffect(() => {
    if (!jeAdmin || jeSuperAdmin) return;
    const companyId = prijavljen?.companyId;
    if (!companyId) return;
    (async () => {
      try {
        const r = await fetch(`${import.meta.env.BASE_URL}api/companies/${companyId}/eracun-nastavitve`, {
          credentials: "include",
        });
        if (!r.ok) return;
        const data = await r.json() as {
          eRacunPrejemnik?: boolean | null;
          eRacunOmrezje?: string | null;
          eRacunNaslov?: string | null;
          eRacunEmail?: string | null;
          eRacunSifraPu?: string | null;
          eRacunBic?: string | null;
        };
        setErPrejemnik(data.eRacunPrejemnik ?? false);
        setErOmrezje(data.eRacunOmrezje ?? "");
        setErNaslov(data.eRacunNaslov ?? "");
        setErEmail(data.eRacunEmail ?? "");
        setErSifraPu(data.eRacunSifraPu ?? "");
        setErBic(data.eRacunBic ?? "");
        setErNaložen(true);
      } catch { /* omrežna napaka */ }
    })();
  }, [jeAdmin, jeSuperAdmin, prijavljen?.companyId]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Auto-fill iz podatkov podjetja, kadar nastavitve niso naložene (npr. 400) ────
  useEffect(() => {
    if (!prijavljen) return;
    // Polni samo prazna polja — ne prepisuje ničesar kar je že nastavljeno
    setNazivRestavracije(prev => prev || prijavljen.companyNaziv || "");
    setNaslovRestavracije(prev => prev || prijavljen.companyNaslov || "");
    setNaslovUlica(prev => prev || prijavljen.companyUlica || "");
    setNaslovPostna(prev => prev || prijavljen.companyPostna || "");
    setNaslovKraj(prev => prev || prijavljen.companyKraj || "");
    setDavcnaStevilka(prev => prev || (prijavljen.podjetjeDavcna?.replace(/^SI/i, "") ?? ""));
    setIdZaDdv(prev => prev || prijavljen.idZaDdv || "");
    setPonudnikDavcna(prev => prev || (prijavljen.podjetjeDavcna?.replace(/^SI/i, "") ?? ""));
  }, [prijavljen]);

  // ── Nalaganje device-specifičnih terminalnih nastavitev ────
  useEffect(() => {
    const c = trenutnaNaprava?.terminalConfig;
    if (!c) return;
    if (c.terminalAktiven !== undefined) setTerminalAktiven(c.terminalAktiven);
    if (c.terminalIp !== undefined) setTerminalIp(c.terminalIp);
    if (c.terminalPort !== undefined) setTerminalPort(String(c.terminalPort));
    if (c.terminalTimeoutMs !== undefined) setTerminalTimeout(String(c.terminalTimeoutMs));
    if (c.paytenAndroidAktiven !== undefined) setPaytenAndroidAktiven(c.paytenAndroidAktiven);
    setPaytenBridgePairing(Boolean((c as any).paytenBridgePaired));
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
    if (c.tiskalnikCodePage === "cp852" || c.tiskalnikCodePage === "cp1250" || c.tiskalnikCodePage === "wpc1250" || c.tiskalnikCodePage === "ascii-translit" || c.tiskalnikCodePage === "bitmap") setTiskalnikCodePage(c.tiskalnikCodePage);
    if (c.vivaTapToPaySourceCode !== undefined) setVivaTapToPaySourceCode(c.vivaTapToPaySourceCode);
  }, [trenutnaNaprava]);

  // ── Scanner Bridge health check ────────────────────────────
  const checkScannerBridge = useCallback(async () => {
    setScannerBridgeStatus("checking");
    try {
      const r = await fetch("http://127.0.0.1:8765/health", { signal: AbortSignal.timeout(2000) });
      if (r.ok) {
        const d = await r.json() as { version?: string };
        setScannerBridgeVersion(d.version ?? null);
        setScannerBridgeStatus("ok");
      } else {
        setScannerBridgeStatus("offline");
      }
    } catch {
      setScannerBridgeStatus("offline");
    }
  }, []);

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

  const handleUstvariBackup = async () => {
    setBackupUstvariSqlLoading(true);
    try {
      const r = await fetch(`${base}/api/backup/ustvari?format=sql`, { method: "POST", credentials: "include" });
      if (!r.ok) { const d = await r.json() as { error: string }; throw new Error(d.error); }
      await fetchBackupi();
      toast({ title: "SQL kopija ustvarjena" });
    } catch (err) {
      toast({ title: "Napaka", description: (err as Error).message, variant: "destructive" });
    } finally {
      setBackupUstvariSqlLoading(false);
    }
  };

  const handleBrisiBackup = async (ime: string) => {
    if (!confirm(`Res izbrisati "${ime}"? Tega dejanja ni mogoče razveljaviti.`)) return;
    try {
      const response = await fetch(`${base}/api/backup/${encodeURIComponent(ime)}`, { method: "DELETE", credentials: "include" });
      if (!response.ok) {
        const data = await response.json() as { error?: string };
        throw new Error(data.error ?? "Brisanje kopije ni uspelo.");
      }
      await fetchBackupi();
      toast({ title: "Kopija izbrisana" });
    } catch (err) {
      toast({ title: "Napaka pri brisanju", description: (err as Error).message, variant: "destructive" });
    }
  };

  const handleObnoviBackup = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!confirm("POZOR: Obnovitev bo prepisala vse trenutne podatke v bazi. Tik pred obnovitvijo bo ustvarjena dodatna zaščitna kopija. Nadaljujete?")) {
      e.target.value = "";
      return;
    }
    setBackupObnoviLoading(true);
    try {
      const form = new FormData();
      form.append("datoteka", file);
      const r = await fetch(`${base}/api/backup/obnovi`, { method: "POST", body: form, credentials: "include" });
      if (!r.ok) { const d = await r.json() as { error: string }; throw new Error(d.error); }
      toast({ title: "Baza uspešno obnovljena", description: "Pred obnovitvijo je nastala dodatna zaščitna kopija. Stran se bo osvežila." });
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
          if (prostorId !== "none") {
            queryClient.invalidateQueries({ queryKey: getGetProstorTlorisQueryKey(parseInt(prostorId)) });
          }
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
          // Podatkovne rezervacije se upravljajo samo prek rezervacijskega API-ja.
          // Pri urejanju številke/ime rezervirane mize zato obstoječi status ohranimo.
          status: editingMiza.status === "rezervirana" ? undefined : editingMiza.status,
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
    setEditNClerkUserId(n.clerkUserId ?? null);
    setEditNPosPin("");
    // Naloži seznam POS uporabnikov (za dropdown vezave)
    if (prijavljen?.companyId) {
      const companyId = prijavljen.companyId;
      fetch(`/api/pos/admin/podjetja/${companyId}/uporabniki`, { credentials: "include" })
        .then(r => r.ok ? r.json() : [])
        .then((data: Array<{ id: number; clerkUserId: string; ime: string; priimek: string; enotaIme?: string | null }>) => {
          setPosUporabniki(data.filter(u => u.clerkUserId));
        })
        .catch(() => setPosUporabniki([]));
    }
    setEditNatakarOpen(true);
  };

  const handleUpdateNatakar = () => {
    if (!editingNatakar) return;
    updateNatakar.mutate(
      {
        id: editingNatakar.id,
        data: {
          ime: editNIme,
          priimek: editNPriimek,
          davcnaStevilka: editNDavcna || null,
          aktiven: editNAktiven,
          clerkUserId: editNClerkUserId,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListNatakariQueryKey() });
          setEditNatakarOpen(false);
          toast({ title: "Natakar posodobljen" });
        },
        onError: (err: Error) => toast({ title: "Napaka", description: err.message, variant: "destructive" }),
      }
    );
  };

  const handleSetNatakarPosPin = async () => {
    if (!editingNatakar || !/^\d{4,12}$/.test(editNPosPin)) {
      toast({
        title: "PIN mora imeti 4 do 12 številk",
        variant: "destructive",
      });
      return;
    }
    setEditNPosPinSaving(true);
    try {
      const response = await posFetch(
        `${base}/api/quick-switch/natakarji/${editingNatakar.id}/pin`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ pin: editNPosPin }),
        },
      );
      if (!response.ok) {
        const payload = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(payload?.error ?? "PIN-a ni bilo mogoče nastaviti.");
      }
      setEditNPosPin("");
      toast({ title: "POS PIN je nastavljen" });
    } catch (error) {
      toast({
        title: "PIN-a ni bilo mogoče nastaviti",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setEditNPosPinSaving(false);
    }
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
      setPpEnotaId((pp as any).enotaId ?? "");
    } else {
      setEditingPp(null);
      setPpProstorId(""); setPpNaziv(""); setPpTip("nepremicnina");
      setPpUlica(""); setPpHisna(""); setPpHisnaDodatek("");
      setPpSkupnost(""); setPpKraj(""); setPpPostna("");
      setPpKatastrska(""); setPpStavba(""); setPpDelStavbe("");
      setPpTablica(""); setPpVin(""); setPpPremicninaTip("C");
      setPpVeljavnost(new Date().toISOString().slice(0, 10));
      setPpEnotaId("");
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
    ...(jeAdmin && ppEnotaId ? { enotaId: ppEnotaId } : {}),
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
        onError: (err: unknown) => {
          const sporocilo =
            (err as { message?: string })?.message ||
            "Omrežna napaka";
          setPpRegResult({ uspeh: false, napaka: sporocilo });
        },
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

  // ── e-Račun registracija shranjevanje ──────────────────────
  const handleSaveEracunRegistracija = async () => {
    const companyId = prijavljen?.companyId;
    if (!companyId) return;
    setErShranjujem(true);
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}api/companies/${companyId}/eracun-nastavitve`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          eRacunPrejemnik: erPrejemnik,
          eRacunOmrezje: erOmrezje || null,
          eRacunNaslov: erNaslov || null,
          eRacunEmail: erEmail || null,
          eRacunSifraPu: erSifraPu || null,
          eRacunBic: erBic || null,
        }),
      });
      const data = await r.json() as { error?: string };
      if (!r.ok) {
        toast({ title: "Napaka", description: data.error ?? "Napaka pri shranjevanju", variant: "destructive" });
      } else {
        toast({ title: "e-Račun nastavitve shranjene" });
      }
    } catch {
      toast({ title: "Napaka", description: "Omrežna napaka", variant: "destructive" });
    } finally {
      setErShranjujem(false);
    }
  };

  // ── bizBox per-podjetje poverilnice shranjevanje ───────────
  const handleSaveBizbox = async () => {
    if (!bizboxUser.trim()) return;
    setBizboxShranjujem(true);
    try {
      const body: Record<string, string | null> = {
        bizboxUser: bizboxUser.trim(),
        bizboxOkolje,
        posiljateljDavcna: bizboxPosiljateljDavcna.trim() || null,
      };
      if (bizboxNovGeslo) body["bizboxPass"] = bizboxNovGeslo;
      const token = await getAuthToken();
      const enotaId = getEnotaId();
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (token) headers["Authorization"] = `Bearer ${token}`;
      if (enotaId) headers["X-Enota-Id"] = enotaId;
      const r = await fetch(`${import.meta.env.BASE_URL}api/bizbox-nastavitve`, {
        method: "PUT",
        headers,
        credentials: "include",
        body: JSON.stringify(body),
      });
      const data = await r.json() as { uspeh?: boolean; error?: string };
      if (!r.ok) {
        toast({ title: "Napaka", description: data.error ?? "Napaka pri shranjevanju", variant: "destructive" });
      } else {
        setBizboxGesloNastavljeno(true);
        setBizboxNovGeslo("");
        toast({ title: "bizBox poverilnice shranjene", description: "Geslo je šifrirano v bazi." });
      }
    } catch {
      toast({ title: "Napaka", description: "Omrežna napaka", variant: "destructive" });
    } finally {
      setBizboxShranjujem(false);
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
  const handleSaveToGoTopli = async () => {
    setToGoTopliShranjujem(true);
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}api/nastavitve/ddv-razresevalnik`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ toGoTopliNapitekStopnja }),
      });
      if (!r.ok) throw new Error("Napaka");
      await queryClient.invalidateQueries({ queryKey: getGetNastavitveQueryKey() });
      toast({ title: "Nastavitev DDV shranjena" });
    } catch {
      toast({ title: "Napaka", description: "Nastavitve ni bilo mogoče shraniti.", variant: "destructive" });
    } finally {
      setToGoTopliShranjujem(false);
    }
  };

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
      ...(({ idZaDdv }) => ({ idZaDdv }) as any)({ idZaDdv }),
      poslovniProstor,
      elektronskaNaprava,
      ponudnikDavcna,
      racunPozdrav1,
      racunPozdrav2,
      fursNacin,
      fursProxyUrl,
      simulirajFursNapako,
      dovoliNegativneZaloge,
      picaPremerMala,
      picaPremerNormalna,
      picaPremerDruzinska,
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
      qrAiAsistentAktiven,
      toastTocilnicaAktiven,
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
        void queryClient.invalidateQueries({ queryKey: getGetNastavitveQueryKey() });
        setConnectionResult(null);
        setIzredniNovPin("");
        setIzredniPinPotrdi("");
        if (izredniNovPin) setIzrednaIzdajaPINNastavljen(true);
        toast({ title: "Nastavitve shranjene" });
      },
      onError: () => toast({ title: "Napaka", description: "Nastavitev ni bilo mogoče shraniti.", variant: "destructive" }),
    });
  };

  const handlePairPaytenBridge = async () => {
    setPaytenBridgePairing(true);
    try {
      // The native app owns identity creation. Trigger its explicit pairing
      // activity before ever trusting the loopback service.
      window.location.href = "bookie-viva-bridge://pair";
      type BridgeIdentity = { ok?: boolean; keyId?: string; publicKeyBase64Url?: string };
      let identity: BridgeIdentity | null = null;
      for (let attempt = 0; attempt < 8 && !identity; attempt++) {
        await new Promise(resolve => window.setTimeout(resolve, 750));
        const controller = new AbortController();
        const timer = window.setTimeout(() => controller.abort(), 1_500);
        try {
          const response = await fetch("http://127.0.0.1:8092/identity", { signal: controller.signal });
          const candidate = await response.json() as BridgeIdentity;
          if (response.ok && candidate?.ok && candidate.keyId && candidate.publicKeyBase64Url) identity = candidate;
        } catch { /* bridge is still starting or absent */ } finally { window.clearTimeout(timer); }
      }
      if (!identity) throw new Error("Bookie Bridge ni dosegljiv. Namestite ali odprite uradni Bookie Bridge in poskusite znova.");
      const paired = await enrollPaytenBridge.mutateAsync({ data: { keyId: identity.keyId!, publicKeyBase64Url: identity.publicKeyBase64Url! } });
      await refreshNaprava();
      toast({ title: "Bookie Bridge je sparjen", description: `Prstni odtis: ${paired.fingerprint}` });
    } catch (error) {
      toast({ title: "Bridge ni mogoče spariti", description: error instanceof Error ? error.message : "Preverite, ali Bookie Bridge teče na tej napravi.", variant: "destructive" });
    } finally { setPaytenBridgePairing(false); }
  };

  const handleSaveTerminali = () => {
    updateNapraveTerminali.mutate({
      data: {
        terminalAktiven,
        terminalIp,
        terminalPort: parseInt(terminalPort) || 9000,
        terminalTimeoutMs: parseInt(terminalTimeout) || 30000,
        paytenAndroidAktiven,
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
  const [aktivniZavihek, setAktivniZavihek] = useState<string>(
    () => {
      const shranjeni = sessionStorage.getItem("settings.aktivniZavihek") ?? "mize";
      const candidate = ["mize", "natakari", "dostava", "kds", "enote", "knjizenje", "nastavitve", "varnostne-kopije", "moj-profil", "glasovni-ukazi"].includes(shranjeni)
        ? shranjeni as SettingsTab : "mize";
      const deepLink = parseSettingsNavigation(`/nastavitve?${window.location.search.slice(1)}`);
      return resolveVisibleSettingsTab(deepLink?.tab ?? candidate, prijavljen?.vloga);
    }
  );

  useEffect(() => {
    const visible = resolveVisibleSettingsTab(aktivniZavihek as SettingsTab, prijavljen?.vloga);
    if (visible !== aktivniZavihek) setAktivniZavihek(visible);
  }, [aktivniZavihek, prijavljen?.vloga]);

  useEffect(() => { sessionStorage.setItem("settings.aktivniZavihek", aktivniZavihek); }, [aktivniZavihek]);

  // ── Nastavitve sub-section scroll persistence ───────────────
      // ── Nastavitve: iskanje + accordion helpers ──────────────────────────
      const NS_SEARCH_MAP: Record<string, string[]> = {
        "ns-furs":                ["furs","podjetje","naziv","davčna","naslov","trr","iban","bic","fiskalizacija","proxy","pozdrav","opomba","račun"],
        "ns-certifikat":          ["certifikat","p12","pfx","pem","furs","digitalni"],
        "ns-prostori":            ["prostori","poslovni prostor","furs","prostor"],
        "ns-blagajne":            ["blagajna","blagajne","furs","identifikator"],
        "ns-eracun-registracija": ["eračun","e-račun","omrežje","bizbox","zzi","ujp","peppol","iban","registracija","prejemnik"],
        "ns-bizbox":              ["bizbox","zzi","eračun","geslo","poverilnice"],
        "ns-naprave":             ["naprava","naprave","tiskalnik"],
        "ns-terminal":            ["terminal","payten","android","ip","port","plačilo"],
        "ns-sumup":               ["sumup","kartica","terminal","api"],
        "ns-viva":                ["viva","wallet","kartica","tap to pay"],
        "ns-android-tiskalnik":   ["tiskalnik","android","bluetooth","bt","apk","most"],
        "ns-agent":               ["tiskalnik","windows","agent","token","58mm","80mm","usb"],
        "ns-scanner-bridge":      ["scanner","optični","čitalnik","hp","windows","barcode"],
        "ns-happy-hour":          ["happy hour","znižanje","akcija","urnik","cena"],
        "ns-zaloge":              ["zaloge","negativna zaloga","zalog"],
        "ns-prikaz":              ["prikaz naročil","združevanje","artiklov","panel"],
        "ns-izredni-pin":         ["pin","izredna izdaja","pin koda","skrbnik"],
        "ns-ddv-razresev":        ["ddv","razreševalnik","topla pijača","to-go","za s seboj","sladkor"],
        "ns-smtp":                ["smtp","email","e-pošta","pošta","strežnik"],
        "ns-ddv-stopnje":         ["ddv","davek","stopnje","22%","9.5%","5%"],
        "ns-testi":               ["testi","testni zagon","zgodovina","test"],
      };
      const nsSearchLower = nastavitveSearch.toLowerCase().trim();
      const nsSec = (ids: string[]) => {
        if (!nsSearchLower) return true;
        return ids.some(id => (NS_SEARCH_MAP[id] ?? []).some(t =>
          t.toLowerCase().includes(nsSearchLower) || nsSearchLower.includes(t.toLowerCase())));
      };
      const nsAkkordeonValue: string[] = nsSearchLower ? [
        ...((jeAdmin && !jeSuperAdmin) && nsSec(["ns-furs","ns-certifikat","ns-prostori","ns-blagajne"]) ? ["sek-podjetje"] : []),
        ...(jeAdmin && nsSec(["ns-eracun-registracija","ns-bizbox"]) ? ["sek-eracun"] : []),
        ...(!jeSuperAdmin && nsSec(["ns-naprave"]) ? ["sek-naprave"] : []),
        ...(!jeSuperAdmin && nsSec(["ns-terminal","ns-sumup","ns-viva"]) ? ["sek-terminali"] : []),
        ...(!jeSuperAdmin && nsSec(["ns-android-tiskalnik","ns-agent","ns-scanner-bridge"]) ? ["sek-tiskalniki"] : []),
        ...((jeAdmin || jeAdminEnote) && nsSec(["ns-happy-hour","ns-zaloge","ns-prikaz","ns-izredni-pin","ns-ddv-razresev"]) ? ["sek-vedenje"] : []),
        ...(jeSuperAdmin && nsSec(["ns-smtp","ns-ddv-stopnje","ns-testi"]) ? ["sek-sistem"] : []),
      ] : nsAkkordeon;

      const NASTAVITVE_CARD_IDS: string[] = []; // Accordion nadomešča scroll-restore
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

  // URL navigation is read-only: accept only the closed settings contract and
  // never invoke form handlers or mutations while resolving a deep link.
  useEffect(() => {
    const target = parseSettingsNavigation(`/nastavitve?${rawSearch}`);
    if (!target) return;
    let timer: number | undefined;
    const visibleTab = resolveVisibleSettingsTab(target.tab, prijavljen?.vloga);
    if (visibleTab !== aktivniZavihek) {
      setAktivniZavihek(visibleTab);
    }
    if (visibleTab === "nastavitve" && target.tab === "nastavitve" && target.section) {
      setNsAkkordeon(current => current.includes(target.section!) ? current : [...current, target.section!]);
      if (target.card) {
        timer = window.setTimeout(() => {
          const card = document.getElementById(target.card!);
          if (!card) return; // Hidden by the current role/platform: retain the safe tab fallback.
          card.setAttribute("tabindex", "-1");
          card.scrollIntoView({ behavior: "smooth", block: "start" });
          card.focus({ preventScroll: true });
        }, 80);
      }
    }
    return () => { if (timer !== undefined) window.clearTimeout(timer); };
  }, [rawSearch, aktivniZavihek, prijavljen?.vloga]);

  // When navigating to the "uporabniki" tab, ensure the URL has the aktiven param set.
  // If the param is missing, restore the last-used filter from sessionStorage (default: "true").
  useEffect(() => {
    if (aktivniZavihek !== "uporabniki" || !jeAdmin) return;
    const params = new URLSearchParams(rawSearch);
    if (!params.has("aktiven")) {
      const shranjeni = sessionStorage.getItem("settings.aktivenFilter") ?? "true";
      navigateTo(`/nastavitve?tab=uporabniki&aktiven=${shranjeni}`, { replace: true });
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

  // Ko se enota spremeni: počisti blagajno, ki ne pripada enoti, ali jo samodejno izberi
  const handleEnotaChange = useCallback((newEnotaId: number | "") => {
    setUEnotaId(newEnotaId);
    if (newEnotaId === "") { setUBlagajnaId(""); return; }
    const blagajneZaEnoto = (vseBlagajne ?? []).filter(b => b.enotaId === newEnotaId && b.aktivna);
    // Počisti obstoječo blagajno, če ne pripada novi enoti
    setUBlagajnaId(prev => {
      const veljavna = blagajneZaEnoto.find(b => b.id === Number(prev));
      if (veljavna) return prev; // obstoječa je veljavna za to enoto
      if (blagajneZaEnoto.length === 1) return blagajneZaEnoto[0].id; // samodejno izberi edino
      return ""; // počisti
    });
  }, [vseBlagajne]);
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
    <div className="p-4 sm:p-8 flex-1 overflow-auto w-full">
      <h1 className="text-3xl font-bold tracking-tight mb-4">Nastavitve sistema</h1>

      <Tabs value={aktivniZavihek} onValueChange={setAktivniZavihek}>
        <TabsList className="mb-4 flex-wrap h-auto gap-0.5">
          {!jeSuperAdmin && !jeUporabnik && <TabsTrigger value="mize">Mize</TabsTrigger>}
          {!jeSuperAdmin && !jeUporabnik && <TabsTrigger value="natakari">Natakarji</TabsTrigger>}
          {!jeSuperAdmin && !jeUporabnik && <TabsTrigger value="dostava">Dostava</TabsTrigger>}
          {!jeSuperAdmin && !jeUporabnik && <TabsTrigger value="kds">KDS</TabsTrigger>}
          {prikaziZavihekEnote(prijavljen?.vloga) && <TabsTrigger value="enote">Enote</TabsTrigger>}
          {prijavljen?.vloga === "admin" && <TabsTrigger value="knjizenje">Knjiženje</TabsTrigger>}
          <TabsTrigger value="nastavitve">Nastavitve</TabsTrigger>
          {jeSuperAdmin && <TabsTrigger value="varnostne-kopije">Varnostne kopije</TabsTrigger>}
          <TabsTrigger value="moj-profil">Moj profil</TabsTrigger>
          <TabsTrigger value="glasovni-ukazi"><Mic className="w-3.5 h-3.5 mr-1 inline" />Glasovni ukazi</TabsTrigger>
        </TabsList>


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
                    <TableHead className="hidden sm:table-cell text-center">Mize</TableHead>
                    <TableHead className="hidden sm:table-cell text-center">Kapaciteta</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <>
                  {prostori.map(p => {
                    const mizeVProstoru = mize?.filter(m => m.prostorId === p.id) ?? [];
                    const capacity = mizeVProstoru.reduce((sum, m) => sum + (m.kapaciteta || 0), 0);
                    return (
                      <Collapsible key={p.id} asChild open={tlorisSelectedProstorId === p.id} onOpenChange={(open) => setTlorisSelectedProstorId(open ? p.id : null)}>
                        <tbody className="border-0">
                          <TableRow>
                            <TableCell className="font-medium">{p.ime}</TableCell>
                            <TableCell className="hidden sm:table-cell text-center text-muted-foreground">
                              {mizeVProstoru.length}
                            </TableCell>
                            <TableCell className="hidden sm:table-cell text-center text-muted-foreground">
                              {capacity} <span className="text-xs">oseb</span>
                            </TableCell>
                            <TableCell className="text-right">
                              <div className="flex justify-end gap-1">
                                <CollapsibleTrigger asChild>
                                  <Button variant={tlorisSelectedProstorId === p.id ? "secondary" : "outline"} size="sm" className="mr-2">
                                    <LayoutDashboard className="w-3.5 h-3.5 mr-1.5" />
                                    Tloris
                                  </Button>
                                </CollapsibleTrigger>
                                <Button variant="ghost" size="icon" onClick={() => openEditProstor(p)}>
                                  <Pencil className="w-4 h-4 text-muted-foreground" />
                                </Button>
                                <Button variant="ghost" size="icon" onClick={() => handleDeleteProstor(p.id)}>
                                  <Trash2 className="w-4 h-4 text-destructive" />
                                </Button>
                              </div>
                            </TableCell>
                          </TableRow>
                          <CollapsibleContent asChild>
                            <TableRow className="border-0">
                              <TableCell colSpan={4} className="p-0 border-b">
                                <div className="bg-muted/30 p-4 border-t border-b">
                                  <div className="flex justify-between items-center mb-3">
                                    <h4 className="text-sm font-semibold">Tloris prostora: {p.ime}</h4>
                                    <p className="text-xs text-muted-foreground">Povlecite mize na željeno mesto in shranite.</p>
                                  </div>
                                  <TlorisEditor
                                    prostorId={p.id}
                                    mize={mizeVProstoru}
                                  />
                                </div>
                              </TableCell>
                            </TableRow>
                          </CollapsibleContent>
                        </tbody>
                      </Collapsible>
                    );
                  })}
                </>
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
          <form onSubmit={handleCreateMiza} className="grid grid-cols-2 sm:grid-cols-4 gap-4 items-end bg-muted/50 p-4 rounded-lg">
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
                <TableHead className="w-16">ID</TableHead>
                <TableHead>Ime in priimek</TableHead>
                <TableHead className="hidden sm:table-cell">Davčna št.</TableHead>
                <TableHead>Status</TableHead>
                <TableHead className="hidden md:table-cell">POS račun</TableHead>
                <TableHead></TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {natakari?.length === 0 && (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-6">
                    Ni dodanih natakarjev.
                  </TableCell>
                </TableRow>
              )}
              {natakari?.map(n => (
                <TableRow key={n.id}>
                  <TableCell className="font-mono font-semibold">{n.id}</TableCell>
                  <TableCell className="font-medium">{n.ime} {n.priimek}</TableCell>
                  <TableCell className="hidden sm:table-cell font-mono text-sm">{n.davcnaStevilka ?? "—"}</TableCell>
                  <TableCell>
                    {n.aktiven
                      ? <Badge className="bg-green-100 text-green-800 border-green-200"><UserCheck className="w-3 h-3 mr-1" />Aktiven</Badge>
                      : <Badge variant="outline" className="text-muted-foreground"><UserX className="w-3 h-3 mr-1" />Neaktiven</Badge>
                    }
                  </TableCell>
                  <TableCell className="hidden md:table-cell">
                    {n.clerkUserId
                      ? <Badge className="bg-blue-100 text-blue-800 border-blue-200 text-xs"><Shield className="w-3 h-3 mr-1" />Vezan</Badge>
                      : <span className="text-xs text-muted-foreground">—</span>
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

        {!jeSuperAdmin && !jeUporabnik && (
          <TabsContent value="kds" className="space-y-6">
            <KdsSettings />
          </TabsContent>
        )}

        <TabsContent value="dostava" className="space-y-6">
          <DostavaSettings enotaId={prijavljen?.enotaId} />
          <NaseljaSettings />
        </TabsContent>

        {/* ── Poslovne enote (admin + admin_enote) ────────────── */}
        {prikaziZavihekEnote(prijavljen?.vloga) && (
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
              {smeUpravljatiEnote(prijavljen?.vloga) && (
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
                <div className="space-y-2 md:col-span-2">
                  <Label>Vrsta gostinskega obrata</Label>
                  <Select value={eProfile} onValueChange={value => setEProfile(value as HospitalityProfile)}>
                    <SelectTrigger><SelectValue /></SelectTrigger>
                    <SelectContent>
                      {Object.entries(HOSPITALITY_PROFILES).map(([key, definition]) => (
                        <SelectItem key={key} value={key}>{definition.label}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2 md:col-span-4">
                  <Label>Stroškovno mesto (STM) <span className="text-muted-foreground font-normal">(neobvezno)</span></Label>
                  <Select value={eCostCenterId || undefined} onValueChange={value => setECostCenterId(value === "__brez_sm__" ? "" : value)}>
                    <SelectTrigger>
                      <SelectValue placeholder="Izberite stroškovno mesto (neobvezno)" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="__brez_sm__">— brez stroškovnega mesta —</SelectItem>
                      {stroskovnaMesta.map(cc => (
                        <SelectItem key={cc.id} value={cc.id}>{cc.code} – {cc.name}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Neobvezno. Če ga nastavite, se uporabi pri POS→ERP knjiženju.</p>
                </div>
                <Button type="submit" disabled={createEnota.isPending} className="md:col-span-4">
                  <PlusCircle className="w-4 h-4 mr-2" />Dodaj enoto
                </Button>
              </form>
              )}

              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Ime</TableHead>
                    <TableHead className="hidden sm:table-cell">Opis</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>STM</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {!enote?.length && (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground py-6">
                        Ni poslovnih enot.
                      </TableCell>
                    </TableRow>
                  )}
                  {enote?.map(e => {
                    const sm = e.costCenterId ? stroskovnaMesta.find(cc => cc.id === e.costCenterId) : undefined;
                    return (
                    <TableRow key={e.id}>
                      <TableCell className="font-medium">{e.ime}</TableCell>
                      <TableCell className="hidden sm:table-cell text-muted-foreground text-sm">{e.opis ?? "—"}</TableCell>
                      <TableCell>
                        {e.aktiven
                          ? <Badge className="bg-green-100 text-green-800 border-green-200"><CheckCircle2 className="w-3 h-3 mr-1" />Aktivna</Badge>
                          : <Badge variant="outline" className="text-muted-foreground"><XCircle className="w-3 h-3 mr-1" />Neaktivna</Badge>
                        }
                      </TableCell>
                      <TableCell>
                        {e.costCenterId
                          ? <span className="text-sm text-muted-foreground">{sm ? `${sm.code} – ${sm.name}` : "SM dodeljeno"}</span>
                          : <Badge variant="outline" className="text-amber-700 border-amber-300"><AlertCircle className="w-3 h-3 mr-1" />Manjka SM</Badge>
                        }
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditEnota(e)}>
                            <Pencil className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          {smeUpravljatiEnote(prijavljen?.vloga) && (
                          <Button variant="ghost" size="icon" onClick={() => handleDeleteEnota(e.id)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
          {prijavljen?.vloga === "admin" && <TipPolicySettings />}
        </TabsContent>
        )}

        {/* ── Knjiženje POS temeljnic (samo admin podjetja) ─────────────── */}
        {prijavljen?.vloga === "admin" && (
          <TabsContent value="knjizenje" className="space-y-6">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><BookOpen className="h-5 w-5" />Konti za temeljnice</CardTitle>
                <CardDescription>
                  Določite konte in DDV kode, ki se uporabljajo pri samodejnem knjiženju POS prometa.
                </CardDescription>
              </CardHeader>
              <CardFooter>
                <Button onClick={() => navigateTo("/konti-za-temeljnice")} className="gap-2">
                  <BookOpen className="h-4 w-4" />Odpri nastavitve knjiženja
                </Button>
              </CardFooter>
            </Card>
          </TabsContent>
        )}

        {/* ── Varnostne kopije ────────────────────────────────── */}
        <TabsContent value="varnostne-kopije" className="space-y-6">
          {/* Persistent backup storage */}
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <CloudUpload className="w-5 h-5" />
                Trajna hramba kopij
              </CardTitle>
              <CardDescription>
                Kopije so zasebno shranjene v Replit App Storage. Za neodvisno kopijo jih po ustvarjanju prenesite na zunanji medij.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="flex items-center gap-3 p-3 rounded-lg border bg-muted/30">
                <CheckCircle2 className="w-5 h-5 text-green-600 shrink-0" />
                <div>
                  <p className="font-medium text-sm">Zasebni App Storage je pripravljen</p>
                  <p className="text-xs text-muted-foreground mt-0.5">Prenos datoteke vam omogoča dodatno kopijo zunaj projekta.</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Local backups card */}
          <Card>
            <CardHeader className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
              <div>
                <CardTitle className="flex items-center gap-2">
                  <HardDrive className="w-5 h-5" />
                  Varnostne kopije baze
                </CardTitle>
                <CardDescription>Popolne SQL kopije vseh tabel, relacij, sekvenc in podatkov za vsa podjetja.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button onClick={() => { void fetchBackupi(); }} variant="outline" size="sm" disabled={backupLoading}>
                  <RefreshCw className={`w-4 h-4 ${backupLoading ? "animate-spin" : ""}`} />
                </Button>
                <Button variant="outline" onClick={() => void handleUstvariBackup()} disabled={backupUstvariSqlLoading} title="Popolna SQL kopija (shema + podatki)">
                  {backupUstvariSqlLoading ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Database className="w-4 h-4 mr-2" />}
                  SQL kopija
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {backupKopije.length === 0 ? (
                <div className="text-center py-8 text-muted-foreground">
                  <HardDrive className="w-10 h-10 mx-auto mb-3 opacity-30" />
                  <p className="text-sm">Ni varnostnih kopij.</p>
                  <p className="text-xs mt-1">Kliknite »SQL kopija« za prvo popolno kopijo baze.</p>
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
                          <Badge variant="outline" className="text-[10px] px-1.5 py-0 shrink-0">
                            SQL
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
                Naložite preverjeno SQL kopijo <code className="text-xs bg-muted px-1 rounded">.sql</code> ali <code className="text-xs bg-muted px-1 rounded">.sql.gz</code> za obnovitev celotne baze.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="p-3 rounded-lg border border-yellow-200 bg-yellow-50 flex gap-2">
                <AlertTriangle className="w-5 h-5 text-yellow-600 shrink-0 mt-0.5" />
                <p className="text-sm text-yellow-800">
                  Obnovitev <strong>prepiše vse trenutne podatke</strong> v bazi (naročila, računi, artikli, nastavitve). Tik pred obnovitvijo sistem samodejno ustvari dodatno zaščitno kopijo.
                </p>
              </div>
              <input
                ref={backupFileRef}
                type="file"
                accept=".sql,.sql.gz"
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
        <TabsContent value="nastavitve" className="space-y-3 pb-6">

          {/* ── Iskanje nastavitev ─────────────────────────────────────── */}
          <div className="relative mb-1">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground pointer-events-none" />
            <Input
              placeholder="Iščite nastavitve…"
              value={nastavitveSearch}
              onChange={e => setNavSearch(e.target.value)}
              className="pl-9 pr-9"
            />
            {nastavitveSearch && (
              <button type="button" onClick={() => setNavSearch("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground" aria-label="Počisti iskanje">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>

          {jeAdmin && !jeSuperAdmin && (
            <Card id="ns-qr-ai">
              <CardHeader>
                <CardTitle>QR meni</CardTitle>
                <CardDescription>Nastavitve funkcij, ki so gostom na voljo v javnem QR meniju te enote.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                  <div className="space-y-1">
                    <Label htmlFor="qr-ai-asistent-aktiven" className="text-base font-semibold">AI asistent</Label>
                    <p className="text-sm text-muted-foreground">
                      Ko je omogočen, lahko gost v QR meniju vpraša za priporočila, cene, razpoložljivost in čakalni čas.
                    </p>
                  </div>
                  <Switch
                    id="qr-ai-asistent-aktiven"
                    checked={qrAiAsistentAktiven}
                    onCheckedChange={setQrAiAsistentAktiven}
                    data-testid="qr-ai-asistent-aktiven"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          {jeAdmin && !jeSuperAdmin && (
            <Card id="ns-tocilnica-toast">
              <CardHeader>
                <CardTitle>Obvestila iz točilnice</CardTitle>
                <CardDescription>Nastavite prikaz obvestil, ko je pijača pripravljena za postrežbo.</CardDescription>
              </CardHeader>
              <CardContent>
                <div className="flex items-center justify-between gap-4 rounded-lg border p-4">
                  <div className="space-y-1">
                    <Label htmlFor="toast-tocilnica-aktiven" className="text-base font-semibold">Pošiljanje toastov iz točilnice</Label>
                    <p className="text-sm text-muted-foreground">
                      Ko je izklopljeno, se obvestila o pripravljenih postavkah iz točilnice ne prikažejo. Kuhinjska obvestila ostanejo vključena.
                    </p>
                  </div>
                  <Switch
                    id="toast-tocilnica-aktiven"
                    checked={toastTocilnicaAktiven}
                    onCheckedChange={setToastTocilnicaAktiven}
                    data-testid="toast-tocilnica-aktiven"
                  />
                </div>
              </CardContent>
            </Card>
          )}

          <Accordion type="multiple" value={nsAkkordeonValue} onValueChange={v => { if (!nastavitveSearch) setNsAkkordeon(v); }} className="space-y-1">

            {/* ═══ 1 · Podjetje in FURS ════════════════════════════════════ */}
            {(jeAdmin && !jeSuperAdmin) && nsSec(["ns-furs","ns-certifikat","ns-prostori","ns-blagajne"]) && (
              <AccordionItem value="sek-podjetje" id="sek-podjetje" className="border rounded-lg overflow-hidden">
                <AccordionTrigger className="px-4 py-3.5 text-sm font-semibold hover:no-underline hover:bg-muted/40 data-[state=open]:bg-muted/30 min-h-[44px]">
                  <span className="flex items-center gap-2"><Building2 className="h-4 w-4 shrink-0" />Podjetje in FURS</span>
                </AccordionTrigger>
                <AccordionContent className="pb-0">
                  <div className="space-y-4 p-4 pt-2">
      <FiscalServicePairing />
       {jeAdmin && !jeSuperAdmin && <LocalGatewaySettings />}
       <GatewaySyncReviewPanel />
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
                  <p className="text-xs text-muted-foreground">8-mestna davčna številka, brez predpone SI</p>
                </div>
                <div className="space-y-2">
                  <Label>ID za DDV <span className="text-xs text-muted-foreground font-normal">(samo zavezanci)</span></Label>
                  <Input
                    placeholder="SI12345678"
                    value={idZaDdv}
                    onChange={e => setIdZaDdv(e.target.value)}
                    className="max-w-xs"
                  />
                  <p className="text-xs text-muted-foreground">Prazno = podjetje ni DDV zavezanec. Zavezanci vpišejo SI + davčna številka.</p>
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
              {certInfo?.nastavljen ? (
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
              {podjetjeTrr.length > 1 && (
                <div className="space-y-2">
                  <Label>Račun za prejemanje nakazil</Label>
                  <Select
                    value={prodajalecIban}
                    onValueChange={val => {
                      const izbran = podjetjeTrr.find(t => t.iban === val);
                      if (izbran) {
                        setProdajalecIban(izbran.iban);
                        setProdajalecBic(izbran.bic);
                      }
                    }}
                  >
                    <SelectTrigger>
                      <SelectValue placeholder="Izberite TRR..." />
                    </SelectTrigger>
                    <SelectContent>
                      {podjetjeTrr.map((t, i) => (
                        <SelectItem key={i} value={t.iban}>
                          <span className="font-mono text-xs">{t.iban}</span>
                          {t.bic && <span className="text-muted-foreground ml-2 text-xs">{t.bic}</span>}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <p className="text-xs text-muted-foreground">Izbira samodejno izpolni IBAN in BIC spodaj.</p>
                </div>
              )}
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

      {jeAdmin && !jeSuperAdmin && (<>
      {/* ── Digitalni certifikat FURS ─────────────────────────── */}
      <Card id="ns-certifikat">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileKey className="h-5 w-5" />
            FURS digitalno potrdilo (certifikat)
            {aktivnaEnotaIme && (
              <Badge variant="outline" className="ml-2 text-xs font-normal text-blue-700 border-blue-200 bg-blue-50">
                <Building2 className="h-3 w-3 mr-1" />{aktivnaEnotaIme}
              </Badge>
            )}
          </CardTitle>
          <CardDescription>
            Naložite certifikat (.p12 ali .pfx), ki ste ga prejeli od FURS. Program ga samodejno pretvori v PEM format in šifrirano shrani v bazo podatkov.
            <span className="block mt-1 text-blue-700">Certifikat je shranjen na nivoju podjetja in velja za vse poslovne enote.</span>
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">

          {/* Trenutni certifikat */}
          <div>
            <p className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-3">Trenutni certifikat v bazi</p>
            {!certInfo ? (
              <div className="h-10 animate-pulse bg-muted rounded-lg" />
            ) : certInfo.nastavljen ? (
              <div className="rounded-lg border border-green-200 bg-green-50 p-4 space-y-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="h-4 w-4 text-green-600 shrink-0" />
                  <span className="text-sm font-semibold text-green-800">Certifikat naložen</span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1 text-xs text-muted-foreground">
                  <div><span className="font-medium text-foreground">Subjekt:</span> {certInfo.subject ?? "—"}</div>
                  <div><span className="font-medium text-foreground">Velja do:</span> {certInfo.veljaDo ? new Intl.DateTimeFormat("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(certInfo.veljaDo)) : "—"}</div>
                </div>
              </div>
            ) : (
              <div className="rounded-lg border border-dashed p-4 text-sm text-muted-foreground">
                Certifikat ni naložen za to podjetje.
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
                  <SecretInput
                    id="furs-certificate-value"
                    placeholder="Vnesite geslo za .p12"
                    value={p12Geslo}
                    onChange={e => setP12Geslo(e.target.value)}
                  />
                  <p className="text-xs text-muted-foreground">Geslo, ki ste ga nastavili ob izvozu certifikata</p>
                </div>
              </div>
              {p12Rezultat && (
                <div className={`rounded-lg border p-3 text-sm ${p12Rezultat.uspeh ? "border-green-200 bg-green-50 text-green-800" : "border-red-200 bg-red-50 text-red-800"}`}>
                  {p12Rezultat.uspeh ? (
                    <div className="space-y-1">
                      <p className="font-semibold flex items-center gap-2"><CheckCircle2 className="h-4 w-4" /> Certifikat uspešno naložen!</p>
                      {p12Rezultat.subject && <p className="text-xs">Subjekt: {p12Rezultat.subject}</p>}
                      {p12Rezultat.veljaDo && <p className="text-xs">Velja do: {new Intl.DateTimeFormat("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "UTC" }).format(new Date(p12Rezultat.veljaDo))}</p>}
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
              <li>Program samodejno pretvori v PEM format in zasebni ključ šifrirano shrani na nivoju podjetja</li>
              <li>Geslo se uporabi samo med nalaganjem in se ne shrani</li>
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
                  {jeAdmin && <TableHead className="hidden sm:table-cell">Enota</TableHead>}
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
                    {jeAdmin && (
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                        {enote?.find(e => e.id === (pp as any).enotaId)?.ime ?? `Enota ${(pp as any).enotaId}`}
                      </TableCell>
                    )}
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
          {/* Admin vidi vse blagajne podjetja, ostali le blagajne trenutne enote */}
          {(jeAdmin ? (vseBlagajne?.length ?? 0) : (blagajne?.length ?? 0)) === 0 ? (
            <p className="text-sm text-muted-foreground">Ni dodanih blagajn. Dodajte vsaj eno za ločeno sledenje zaporednih številk računov.</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Naziv</TableHead>
                  {jeAdmin && <TableHead className="hidden sm:table-cell">Enota</TableHead>}
                  <TableHead>PP ID</TableHead>
                  <TableHead>B ID</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(jeAdmin ? vseBlagajne! : blagajne!).map(b => (
                  <TableRow key={b.id}>
                    <TableCell className="font-medium">{b.ime}</TableCell>
                    {jeAdmin && (
                      <TableCell className="hidden sm:table-cell text-xs text-muted-foreground">
                        {enote?.find(e => e.id === (b as any).enotaId)?.ime ?? `Enota ${(b as any).enotaId}`}
                      </TableCell>
                    )}
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
            {lahkoNastaviNatakarPin && (
              <div className="space-y-1">
                <Label>Enota <span className="text-destructive">*</span></Label>
                <Select value={bEnotaId === "" ? "" : String(bEnotaId)} onValueChange={v => setBEnotaId(v ? Number(v) : "")}>
                  <SelectTrigger><SelectValue placeholder="Izberite enoto" /></SelectTrigger>
                  <SelectContent>
                    {(enote ?? []).map(e => (
                      <SelectItem key={e.id} value={String(e.id)}>{e.ime}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader><DialogTitle>Uredi blagajno</DialogTitle></DialogHeader>
          <form onSubmit={handleUpdateBlagajna} className="space-y-4">
            {jeAdmin && (
              <div className="space-y-1">
                <Label>Enota</Label>
                <Select value={editBEnotaId === "" ? "" : String(editBEnotaId)} onValueChange={v => setEditBEnotaId(v ? Number(v) : "")}>
                  <SelectTrigger><SelectValue placeholder="Izberite enoto" /></SelectTrigger>
                  <SelectContent>
                    {(enote ?? []).map(e => (
                      <SelectItem key={e.id} value={String(e.id)}>{e.ime}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* ═══ 2 · e-Račun ══════════════════════════════════════════════ */}
            {jeAdmin && nsSec(["ns-eracun-registracija","ns-bizbox"]) && (
              <AccordionItem value="sek-eracun" id="sek-eracun" className="border rounded-lg overflow-hidden">
                <AccordionTrigger className="px-4 py-3.5 text-sm font-semibold hover:no-underline hover:bg-muted/40 data-[state=open]:bg-muted/30 min-h-[44px]">
                  <span className="flex items-center gap-2"><FileText className="h-4 w-4 shrink-0" />e-Račun</span>
                </AccordionTrigger>
                <AccordionContent className="pb-0">
                  <div className="space-y-4 p-4 pt-2">
      {/* ── e-Račun registracija podjetja (admin) ───────────────────── */}
      {jeAdmin && !jeSuperAdmin && (
        <Card id="ns-eracun-registracija">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              e-Račun registracija podjetja
            </CardTitle>
            <CardDescription>
              Registracijski podatki podjetja kot prejemnika e-računov. Določajo, prek katerega
              omrežja podjetje prejema e-račune in kateri naslov/IBAN se uporabi.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!erNaložen && (
              <p className="text-xs text-muted-foreground">Nalagam nastavitve…</p>
            )}
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="er-prejemnik"
                checked={erPrejemnik}
                onChange={e => setErPrejemnik(e.target.checked)}
                className="h-4 w-4 rounded border-input"
              />
              <label htmlFor="er-prejemnik" className="text-sm font-medium cursor-pointer">
                Registriran prejemnik e-računov
              </label>
            </div>
            {erPrejemnik && (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pl-1">
                <div className="space-y-2">
                  <label className="text-sm font-medium">Omrežje</label>
                  <select
                    value={erOmrezje}
                    onChange={e => setErOmrezje(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  >
                    <option value="">Izberi…</option>
                    <option value="BizBox">BizBox</option>
                    <option value="UJP">UJP (javni sektor)</option>
                    <option value="PEPPOL">PEPPOL</option>
                    <option value="ZZI">ZZI</option>
                  </select>
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Naslov / IBAN prejemnika</label>
                  <input
                    type="text"
                    placeholder="SI56…"
                    value={erNaslov}
                    onChange={e => setErNaslov(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">e-Račun e-mail</label>
                  <input
                    type="email"
                    placeholder="eracun@podjetje.si"
                    value={erEmail}
                    onChange={e => setErEmail(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">Šifra PU <span className="text-muted-foreground font-normal">(samo UJP)</span></label>
                  <input
                    type="text"
                    placeholder="001"
                    value={erSifraPu}
                    onChange={e => setErSifraPu(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
                <div className="space-y-2">
                  <label className="text-sm font-medium">BIC banke</label>
                  <input
                    type="text"
                    placeholder="BSLJSI2X"
                    value={erBic}
                    onChange={e => setErBic(e.target.value.toUpperCase())}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>
            )}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSaveEracunRegistracija}
                disabled={erShranjujem}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {erShranjujem
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Shranjujem…</>
                  : <><Save className="h-4 w-4" />Shrani e-Račun nastavitve</>
                }
              </button>
            </div>
          </CardContent>
        </Card>
      )}

      {/* ── bizBox per-podjetje poverilnice ──────────────────────────── */}
      {jeAdmin && (
        <Card id="ns-bizbox">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5" />
              bizBox poverilnice (per-podjetje)
            </CardTitle>
            <CardDescription>
              Poverilnice za oddajo e-računov prek bizBox/ZZI omrežja. Geslo je shranjeno
              AES-256-GCM šifrirano — nikoli v čistopisu. Veljavno za celotno podjetje (vse enote/blagajne).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {!bizboxNaložen && (
              <p className="text-xs text-muted-foreground">Nalagam nastavitve…</p>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Uporabniško ime (bizBox)</label>
                <input
                  type="text"
                  autoComplete="username"
                  placeholder="npr. podjetje@zzi.si"
                  value={bizboxUser}
                  onChange={e => setBizboxUser(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Geslo (bizBox)</label>
                {bizboxGesloNastavljeno && !bizboxNovGeslo && (
                  <p className="text-xs text-green-700 font-medium">✓ Geslo je nastavljeno — pustite prazno, da ga obdržite</p>
                )}
                <div>
                  <SecretInput
                    id="bizbox-credential-value"
                    placeholder={bizboxGesloNastavljeno ? "Novo geslo (pustite prazno za ohranitev)" : "Vnesite geslo za bizBox"}
                    value={bizboxNovGeslo}
                    onChange={e => setBizboxNovGeslo(e.target.value)}
                    className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                  />
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <label className="text-sm font-medium">Okolje</label>
                <select
                  value={bizboxOkolje}
                  onChange={e => setBizboxOkolje(e.target.value as "test" | "prod")}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                >
                  <option value="test">Testno (demo.zzi.si)</option>
                  <option value="prod">Produkcija (ws.zzi.si)</option>
                </select>
                {bizboxOkolje === "prod" && (
                  <p className="text-xs text-red-600 font-medium flex items-center gap-1">
                    <AlertTriangle className="h-3 w-3" />
                    Produkcijsko okolje — e-računi se pošiljajo na ws.zzi.si
                  </p>
                )}
              </div>
              <div className="space-y-2">
                <label className="text-sm font-medium">Pošiljateljev eDDress override</label>
                <input
                  type="text"
                  placeholder="Privzeto: davčna podjetja (brez SI)"
                  value={bizboxPosiljateljDavcna}
                  onChange={e => setBizboxPosiljateljDavcna(e.target.value)}
                  className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                />
                <p className="text-xs text-muted-foreground">Prazno = uporabi davčno številko podjetja</p>
              </div>
            </div>

            <div className="rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-800 space-y-1">
              <p className="font-semibold flex items-center gap-1.5"><Shield className="h-4 w-4" />Varnost</p>
              <ul className="list-disc list-inside space-y-0.5 text-amber-700 text-xs">
                <li>Geslo se šifrira z AES-256-GCM pred shranjevanjem v bazo — nikoli ni v čistopisu</li>
                <li>Ključ za šifriranje (BIZBOX_ENC_KEY) mora biti nastavljen v Replit Secrets</li>
                <li>Geslo se vrne samo ob dejanskem pošiljanju e-računa (interno, nikoli v odgovoru API)</li>
                <li>Ob izbrisu nastavitev se poverilnice odstranijo; sistem preklopi na env spremenljivki (fallback)</li>
              </ul>
            </div>

            <div className="flex justify-end">
              <button
                type="button"
                onClick={handleSaveBizbox}
                disabled={bizboxShranjujem || !bizboxUser.trim() || (!bizboxGesloNastavljeno && !bizboxNovGeslo)}
                className="inline-flex items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground shadow hover:bg-primary/90 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {bizboxShranjujem
                  ? <><Loader2 className="h-4 w-4 animate-spin" />Shranjujem…</>
                  : <><Save className="h-4 w-4" />Shrani bizBox poverilnice</>
                }
              </button>
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
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* ═══ 3 · Tiskalniki in naprave ════════════════════════════════ */}
            {!jeSuperAdmin && nsSec(["ns-naprave"]) && (
              <AccordionItem value="sek-naprave" id="sek-naprave" className="border rounded-lg overflow-hidden">
                <AccordionTrigger className="px-4 py-3.5 text-sm font-semibold hover:no-underline hover:bg-muted/40 data-[state=open]:bg-muted/30 min-h-[44px]">
                  <span className="flex items-center gap-2"><HardDrive className="h-4 w-4 shrink-0" />Tiskalniki in naprave</span>
                </AccordionTrigger>
                <AccordionContent className="pb-0">
                  <div className="space-y-4 p-4 pt-2">
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
            <div className="space-y-4">
              {naprave.find((n) => n.id === trenutnaNaprava?.id) ? (
                <div className="rounded-lg border-2 border-primary/40 bg-primary/5 p-3">
                  <div className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <Badge>Ta naprava</Badge>
                    <span>{naprave.find((n) => n.id === trenutnaNaprava?.id)?.ime || "Naprava brez imena"}</span>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Trenutni brskalnik · ID naprave #{trenutnaNaprava?.id}
                  </p>
                </div>
              ) : (
                <div className="flex flex-col gap-2 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm sm:flex-row sm:items-center sm:justify-between">
                  <span>Trenutni brskalnik še ni registriran za izbrano enoto.</span>
                  <Button size="sm" variant="outline" onClick={async () => {
                    await refreshNaprava();
                    await queryClient.invalidateQueries({ queryKey: getListNapraveQueryKey() });
                  }}>
                    Registriraj to napravo
                  </Button>
                </div>
              )}
            <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Status</TableHead>
                  <TableHead>Ime naprave</TableHead>
                  <TableHead>ID naprave</TableHead>
                  <TableHead>Terminal</TableHead>
                  <TableHead>Mize</TableHead>
                  <TableHead>Tiskalnik</TableHead>
                  <TableHead>AI svetovalec</TableHead>
                  <TableHead className="w-20"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {naprave.map((n) => (
                  <TableRow key={n.id} className={n.id === trenutnaNaprava?.id ? "bg-primary/5 ring-1 ring-inset ring-primary/20" : ""}>
                    <TableCell>
                      {n.id === trenutnaNaprava?.id
                        ? <Badge className="whitespace-nowrap">Ta naprava</Badge>
                        : <span className="text-xs text-muted-foreground">Druga</span>}
                    </TableCell>
                    <TableCell>
                      <span className="font-medium">{n.ime || <span className="text-muted-foreground italic">brez imena</span>}</span>
                    </TableCell>
                    <TableCell className="font-mono text-xs text-muted-foreground">#{n.id}</TableCell>
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
                    <TableCell className="text-sm">
                      {n.terminalConfig?.tiskalnikTip === "windows" || n.terminalConfig?.agentTiskalnikIme ? (
                        <span className="inline-flex items-center gap-1"><Printer className="h-3.5 w-3.5 text-muted-foreground" />Windows{n.terminalConfig?.agentTiskalnikIme ? ` (${n.terminalConfig.agentTiskalnikIme})` : ""}</span>
                      ) : n.terminalConfig?.tiskalnikSirina === 58 ? (
                        <span className="inline-flex items-center gap-1"><Printer className="h-3.5 w-3.5 text-muted-foreground" />ZCS Z92</span>
                      ) : n.terminalConfig?.tiskalnikSirina === 32 ? (
                        <span className="inline-flex items-center gap-1"><Printer className="h-3.5 w-3.5 text-muted-foreground" />BT most — 58 mm</span>
                      ) : n.terminalConfig?.tiskalnikSirina === 30 ? (
                        <span className="inline-flex items-center gap-1"><Printer className="h-3.5 w-3.5 text-muted-foreground" />NB80 — 58 mm</span>
                      ) : n.terminalConfig?.tiskalnikSirina === 80 ? (
                        <span className="inline-flex items-center gap-1"><Printer className="h-3.5 w-3.5 text-muted-foreground" />NB80/BT — 80 mm</span>
                      ) : (
                        <span className="text-muted-foreground text-xs">samodejno</span>
                      )}
                    </TableCell>
                    <TableCell>
                      {n.terminalConfig?.aiSvetovalecAktiven
                        ? <Badge variant="secondary">Vključen</Badge>
                        : <span className="text-xs text-muted-foreground">Izključen</span>}
                    </TableCell>
                    <TableCell>
                      <div className="flex gap-1">
                        <Button size="icon" variant="ghost" className="h-7 w-7" onClick={() => {
                          setEditingNaprava(n);
                          setNapravEditIme(n.ime ?? "");
                          setNapravEditTerminal(n.placilniTerminal ?? "__global__");
                          setNapravEditDovoljeneMize(n.dovoljeneMize ?? []);
                          setNapravEditPragZaupanja(n.glasovniPragZaupanja ?? 0);
                          setNapravEditTiskalnikSirina((n.terminalConfig?.tiskalnikSirina ?? null) as 30 | 32 | 58 | 80 | null);
                          setNapravEditJeWindows(n.terminalConfig?.tiskalnikTip === "windows");
                          const cp = n.terminalConfig?.tiskalnikCodePage;
                          setNapravEditCodePage((cp === "cp852" || cp === "wpc1250" || cp === "ascii-translit" || cp === "bitmap") ? cp : "cp1250");
                          setNapravEditAiSvetovalecAktiven((n.terminalConfig as any)?.aiSvetovalecAktiven ?? false);
                          setNapravEditDialogOpen(true);
                        }} title={n.id === trenutnaNaprava?.id ? "Uredi to napravo" : `Uredi ${n.ime || "napravo"}`}><Pencil className="h-3.5 w-3.5" /></Button>
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
            </div>
            </div>
          )}
        </CardContent>
      </Card>}

      {!jeSuperAdmin && <Dialog open={napravEditDialogOpen} onOpenChange={setNapravEditDialogOpen}>
        <DialogContent className="max-h-[90vh] flex flex-col gap-0 w-full max-w-[min(32rem,calc(100vw-1rem))]">
          <DialogHeader className="shrink-0 pb-2">
            <DialogTitle>Uredi napravo</DialogTitle>
          </DialogHeader>
          <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pr-1">
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
            <div className="space-y-1.5">
              <Label>Vezani tiskalnik</Label>
              <Select
                value={napravEditJeWindows ? "windows" : napravEditTiskalnikSirina == null ? "auto" : String(napravEditTiskalnikSirina)}
                onValueChange={v => {
                  if (v === "windows") { setNapravEditJeWindows(true); setNapravEditTiskalnikSirina(null); }
                  else { setNapravEditJeWindows(false); setNapravEditTiskalnikSirina(v === "auto" ? null : Number(v) as 30 | 32 | 58 | 80); }
                }}
              >
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent className="max-w-[calc(100vw-3rem)]">
                  <SelectItem value="auto">Samodejno zaznaj</SelectItem>
                  <SelectItem value="58">ZCS Z92 — 58 mm (30 stolpcev)</SelectItem>
                  <SelectItem value="32">BT PT210 — 58 mm (32 stolpcev)</SelectItem>
                  <SelectItem value="80">80 mm (40 stolpcev) — NoryoxNB80 / BT most</SelectItem>
                  <SelectItem value="30">NoryoxNB80 — 58 mm (30 stolpcev)</SelectItem>
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Določi kateri tiskalnik je pritrjen na to napravo. Ko je nastavljeno, tiskanje vedno
                gre na pravi tiskalnik — brez zaznavanja, ki bi lahko izbralo napačnega.
              </p>
            </div>
            {/* Kodna stran — skupna nastavitev za BT, omrežni in Windows agent tisk */}
            <div className="space-y-1.5">
              <Label>Kodna stran tiskalnika</Label>
              <select
                className="w-full border rounded px-2 py-1.5 text-sm bg-background"
                value={napravEditCodePage}
                onChange={e => setNapravEditCodePage(e.target.value as "cp1250" | "wpc1250" | "cp852" | "ascii-translit" | "bitmap")}
              >
                <option value="cp1250">Windows-1250 n=45 (privzeto)</option>
                <option value="wpc1250">WPC1250 n=12 — Q10 Back Clip, starejša HW</option>
                <option value="cp852">OEM 852 n=18 — Latin-2, CP852</option>
                <option value="ascii-translit">Brez šumnikov — transliteracija (č→c, €→EUR)</option>
                <option value="bitmap">Slikovni izpis (pravi čšž in €, počasnejši)</option>
              </select>
              <p className="text-xs text-muted-foreground">
                Velja za vse načine tiskanja (Bluetooth, omrežni, Windows agent).
                Če tiskalnik ne prikaže čšž/€: poskusi WPC1250 n=12, nato OEM 852, nato transliteracijo.
              </p>
            </div>
            
            <div className="flex flex-row items-center justify-between rounded-lg border p-3">
              <div className="space-y-0.5">
                <Label>AI Svetovalec</Label>
                <p className="text-[10px] text-muted-foreground">
                  Nevsiljiv pomočnik pri naročilih in blagajni
                </p>
              </div>
              <Switch checked={napravEditAiSvetovalecAktiven} onCheckedChange={setNapravEditAiSvetovalecAktiven} />
            </div>
            
          </div>
          <div className="shrink-0 flex justify-end gap-2 pt-4 mt-2 border-t">
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
                    tiskalnikSirina: napravEditJeWindows ? undefined : napravEditTiskalnikSirina, // null = samodejno (izbriše ključ v backendovem merge)
                    tiskalnikTip: napravEditJeWindows ? "windows" : null,  // null = počisti (ne-Windows)
                    tiskalnikCodePage: napravEditCodePage as "cp1250" | "wpc1250" | "cp852" | "ascii-translit" | "bitmap",
                    aiSvetovalecAktiven: napravEditAiSvetovalecAktiven,
                  } as any
                });
                await queryClient.invalidateQueries({ queryKey: getListNapraveQueryKey() });
                await refreshNaprava();
                setNapravEditDialogOpen(false);
                toast({ title: "Naprava posodobljena" });
              }}>{updateNapravaMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}&nbsp;Shrani</Button>
          </div>
        </DialogContent>
      </Dialog>}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* ═══ 4 · Plačilni terminali ═══════════════════════════════════ */}
            {!jeSuperAdmin && nsSec(["ns-terminal","ns-sumup","ns-viva"]) && (
              <AccordionItem value="sek-terminali" id="sek-terminali" className="border rounded-lg overflow-hidden">
                <AccordionTrigger className="px-4 py-3.5 text-sm font-semibold hover:no-underline hover:bg-muted/40 data-[state=open]:bg-muted/30 min-h-[44px]">
                  <span className="flex items-center gap-2"><LayoutDashboard className="h-4 w-4 shrink-0" />Plačilni terminali</span>
                </AccordionTrigger>
                <AccordionContent className="pb-0">
                  <div className="space-y-4 p-4 pt-2">

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
              {(jeAdmin || jeAdminEnote) && (
                <div className="flex items-center gap-3">
                  <Button type="button" variant="outline" onClick={handlePairPaytenBridge} disabled={paytenBridgePairing}>
                    {paytenBridgePairing ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <KeyRound className="w-4 h-4 mr-2" />}
                    Spari Bookie Bridge
                  </Button>
                  {(trenutnaNaprava?.terminalConfig as any)?.paytenBridgePaired && (
                    <Badge variant="secondary">Sparjen ključ: {(trenutnaNaprava?.terminalConfig as any)?.paytenBridgeKeyId}</Badge>
                  )}
                </div>
              )}
              <p className="text-xs text-muted-foreground">Uradni native Bookie Bridge upravlja paket in podpisni ključ; ročna nastavitev Android paketa ni dovoljena.</p>
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
                  <div className="flex-1">
                    <SecretInput
                      id="sumup-access-value"
                      placeholder={sumupApiKeyNastavljen ? "••••••••••••••••••••••• (nastavljen)" : "sup_sk_..."}
                      value={sumupNovApiKey}
                      onChange={e => setSumupNovApiKey(e.target.value)}
                      disabled={!sumupAktiven}
                    />
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
          <CardTitle>Viva.com plačila</CardTitle>
          <CardDescription>
            Nastavitve za Viva Smart Checkout, fizični terminal, Android Terminal in Tap to Pay.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          {nastavitveLoading ? (
            <div className="h-24 animate-pulse bg-muted rounded-lg" />
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold">Viva Smart Checkout aktiven</Label>
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
              <div className="rounded-lg border border-primary/20 bg-primary/5 p-4 space-y-3">
                <div>
                  <p className="text-sm font-semibold text-foreground">Bookie Viva Bridge — Android APK</p>
                  <p className="text-xs text-muted-foreground mt-1">
                    Namestite na vsako Android napravo, na kateri uporabljate Viva Android Terminal.
                    Ta različica je univerzalna in deluje na ARM 32-bitnih in ARM 64-bitnih napravah.
                    Isti most podpira demo in produkcijsko okolje; izbiro določite spodaj z nastavitvijo »Demo način«.
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <a href={`${base}/api/downloads/BookieVivaBridge.apk`} download="BookieVivaBridge.apk">
                    <Button type="button" size="sm" className="gap-2">
                      <Download className="w-4 h-4" />
                      Prenesi Viva Bridge
                      <span className="text-xs opacity-70 font-normal">v1.1.0</span>
                    </Button>
                  </a>
                </div>
                <p className="text-xs text-muted-foreground">
                  Po prenosu odprite datoteko v mapi Prenosi in potrdite namestitev.
                  Če Android napiše »Aplikacija ni nameščena«, najprej odstranite stari Bookie Viva Bridge in nato namestite preneseni APK.
                </p>
              </div>
              <Separator className="my-2" />
              <div className="flex items-center justify-between rounded-lg border p-4">
                <div className="space-y-0.5">
                  <Label className="text-base font-semibold">Viva Tap to Pay (ista naprava)</Label>
                  <p className="text-sm text-muted-foreground">
                    Tap on Any Device — Viva Terminal aplikacija na isti NFC napravi (Android 8.1+, NFC). Plačilo se začne prek Android inter-app protokola, Bookie pa rezultat pred izdajo računa še preveri pri Viva API-ju.
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
                     Namestite Viva.com Terminal DEMO ali produkcijsko aplikacijo na isto napravo. Demo in produkcijski račun/aplikacija sta ločena; refund/storno preizkusite šele v podprtem produkcijskem okolju.
                  </p>
                </div>
              )}
              <Separator className="my-2" />
              {(vivaAktiven || vivaTerminalAktiven || vivaAndroidTerminalAktiven || vivaTapToPayAktiven) && (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="viva-client-id">Viva Client ID podjetja — Pametne poverilnice za blagajno</Label>
                    <Input
                      id="viva-client-id"
                      value={vivaClientId}
                      onChange={e => setVivaClientId(e.target.value)}
                      placeholder="npr. abc123"
                      className="max-w-sm"
                    />
                    <p className="text-xs text-muted-foreground">
                      Vnesite »ID naročnika« iz istoimenskega razdelka v Viva portalu.
                      Skrbnik ga vnese enkrat; uporablja se na vseh POS napravah istega podjetja.
                    </p>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="viva-client-secret">
                      Viva Client Secret podjetja — Pametne poverilnice za blagajno
                      {vivaClientSecretNastavljen && (
                        <span className="ml-2 text-xs font-normal text-green-600">✓ nastavljeno</span>
                      )}
                    </Label>
                    <div className="max-w-sm">
                      <SecretInput
                        id="viva-client-credential"
                        value={vivaNovClientSecret}
                        onChange={e => setVivaNovClientSecret(e.target.value)}
                        placeholder={vivaClientSecretNastavljen ? "Pustite prazno za ohranitev" : "Vnesite Client Secret"}
                      />
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
        <div className="flex flex-col items-end gap-1.5">
          <p className="text-xs text-muted-foreground text-right">
            Shrani nastavitve plačilnih terminalov (Payten, SumUp, Viva) za to napravo.
          </p>
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
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* ═══ 5 · Povezave s tiskalniki ════════════════════════════════ */}
            {!jeSuperAdmin && nsSec(["ns-android-tiskalnik","ns-agent","ns-scanner-bridge"]) && (
              <AccordionItem value="sek-tiskalniki" id="sek-tiskalniki" className="border rounded-lg overflow-hidden">
                <AccordionTrigger className="px-4 py-3.5 text-sm font-semibold hover:no-underline hover:bg-muted/40 data-[state=open]:bg-muted/30 min-h-[44px]">
                  <span className="flex items-center gap-2"><Printer className="h-4 w-4 shrink-0" />Povezave s tiskalniki</span>
                </AccordionTrigger>
                <AccordionContent className="pb-0">
                  <div className="space-y-4 p-4 pt-2">
      {/* ── POS Android tiskalnik ─────────────────────────────── */}
      {!jeSuperAdmin && !navigator.userAgent.includes("Windows") && (
        <Card id="ns-android-tiskalnik">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Printer className="w-4 h-4" />
              POS Android tiskalnik
            </CardTitle>
            <CardDescription>
              Nastavitve za vgrajen termalni tiskalnik na tej Android napravi (ZCS Z92, NoryoxNB80 ali BT tiskalnik).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5 text-sm">

            {/* Model tiskalnika */}
            <div className="space-y-2">
              <Label className="text-xs font-semibold">Model tiskalnika</Label>
              <p className="text-xs text-muted-foreground">
                Izberite model vgrajenega tiskalnika. Vpliva na število stolpcev na računu
                (ZCS/NB80 58mm = 30 kol., BT 58mm = 32 kol., 80mm = 40 kol.).
              </p>
              <select
                className="w-full border rounded px-2 py-1 text-sm bg-background"
                value={tiskalnikSirina}
                onChange={e => {
                  const v = Number(e.target.value) as 30 | 32 | 58 | 80;
                  setTiskalnikSirina(v);
                  updateNapraveTerminali.mutate({ data: { tiskalnikSirina: v } }, {
                    onSuccess: () => { updateTerminalConfig({ tiskalnikSirina: v }); toast({ title: `Širina tiskalnika nastavljena na ${v} mm` }); },
                    onError: () => toast({ title: "Napaka", description: "Nastavitve ni bilo mogoče shraniti.", variant: "destructive" }),
                  });
                }}
              >
                <option value={58}>58 mm (30 stolpcev) — ZCS Z92</option>
                <option value={32}>58 mm (32 stolpcev) — BT tiskalnik (58mm)</option>
                <option value={30}>58 mm (30 stolpcev) — NoryoxNB80</option>
                <option value={80}>80 mm (40 stolpcev) — NoryoxNB80 ali BT tiskalnik</option>
              </select>
            </div>

            <hr className="border-border" />

            {/* Prenos tiskalniškega mosta */}
            <div className="space-y-3">
              <div>
                <p className="text-xs font-semibold text-foreground">Tiskalni most — Android APK</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Most poveže POS aplikacijo z vgrajenim tiskalnikom prek lokalnega HTTP strežnika na tej napravi.
                  Namestite APK, ki ustreza vašemu modelu tiskalnika.
                </p>
              </div>

              {/* Gumbi za prenos */}
              <div className="flex flex-col sm:flex-row gap-2">
                {(tiskalnikSirina === 58) && (
                  <a className="w-full sm:w-auto" href={`${base}/api/downloads/ZcsPrinterBridge.apk`} download="ZcsPrinterBridge.apk">
                    <Button type="button" size="sm" className="w-full sm:w-auto h-auto min-h-9 justify-start !whitespace-normal text-left gap-2">
                      <Download className="w-4 h-4 shrink-0" />
                      <span className="min-w-0 break-words">ZcsPrinterBridge.apk <span className="text-xs opacity-70 font-normal">ZCS Z92</span></span>
                    </Button>
                  </a>
                )}
                {(tiskalnikSirina === 32 || tiskalnikSirina === 80) && (
                  <a className="w-full sm:w-auto" href={`${base}/api/downloads/BtTiskalniMost.apk`} download="BtTiskalniMost.apk">
                    <Button type="button" size="sm" className="w-full sm:w-auto h-auto min-h-9 justify-start !whitespace-normal text-left gap-2">
                      <Download className="w-4 h-4 shrink-0" />
                      <span className="min-w-0 break-words">BtTiskalniMost.apk <span className="text-xs opacity-70 font-normal">BT most ({tiskalnikSirina === 80 ? "80mm" : "58mm"})</span></span>
                    </Button>
                  </a>
                )}
                {(tiskalnikSirina === 30 || tiskalnikSirina === 80) && (
                  <a className="w-full sm:w-auto" href={`${base}/api/downloads/NoryoxNB80Bridge.apk`} download="NoryoxNB80Bridge.apk">
                    <Button type="button" size="sm" className="w-full sm:w-auto h-auto min-h-9 justify-start !whitespace-normal text-left gap-2">
                      <Download className="w-4 h-4 shrink-0" />
                      <span className="min-w-0 break-words">NoryoxNB80Bridge.apk <span className="text-xs opacity-70 font-normal">NoryoxNB80</span></span>
                    </Button>
                  </a>
                )}
              </div>

              {/* Navodila za namestitev */}
              <div className="space-y-2 pt-1">
                <p className="text-xs font-semibold text-foreground">Namestitev mosta</p>
                <ol className="space-y-1.5 text-xs text-muted-foreground list-none">
                  <li className="flex gap-2">
                    <span className="shrink-0 font-semibold text-foreground/60 w-4">1.</span>
                    <span>Tapnite gumb za prenos APK zgoraj. Datoteka se prenese v mapo <code className="bg-muted px-1 rounded">Prenosi</code>.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="shrink-0 font-semibold text-foreground/60 w-4">2.</span>
                    <span>Odprite <strong>Prenosi</strong> (ali upravljalnik datotek) in tapnite na preneseni APK.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="shrink-0 font-semibold text-foreground/60 w-4">3.</span>
                    <span>Ob prvem zagonu Android vpraša za dovoljenje <em>»Namestitev iz neznanih virov«</em> — dovolite za brskalnik. To se zgodi samo enkrat.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="shrink-0 font-semibold text-foreground/60 w-4">4.</span>
                    <span>Tapnite <strong>Namesti</strong> in po namestitvi <strong>Odpri</strong>.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="shrink-0 font-semibold text-foreground/60 w-4">5.</span>
                    <span>Zaslon prikaže <em>»HTTP strežnik: aktiven · Tiskalnik: AIDL povezan ✓«</em> — most je pripravljen.</span>
                  </li>
                  <li className="flex gap-2">
                    <span className="shrink-0 font-semibold text-foreground/60 w-4">6.</span>
                    <span><strong>Minimizirajte</strong> aplikacijo mosta (ne zapirajte). V POS izberite ustrezen Android most v meniju tiskanja.</span>
                  </li>
                </ol>
              </div>

              {/* Napredne informacije */}
              <details className="text-xs">
                <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Napredne informacije</summary>
                <div className="mt-2 space-y-1 text-muted-foreground">
                  <p>ZcsPrinterBridge in BtTiskalniMost poslušata na <code className="bg-muted px-1 rounded">http://localhost:8090</code></p>
                  <p>NoryoxNB80Bridge posluša na <code className="bg-muted px-1 rounded">http://localhost:8091</code></p>
                  <p>Most je dostopen samo z lokalne naprave (localhost). CORS je omogočen za vse izvore.</p>
                  <p>Obe aplikaciji se samodejno zaženeta ob ponovnem zagonu naprave (avtostart).</p>
                </div>
              </details>
            </div>

          </CardContent>
        </Card>
      )}

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
                <Label className="text-xs font-semibold">2. Širina in kodna stran tiskalnika</Label>
                <p className="text-xs text-muted-foreground">
                  Izberite širino papirja in kodna stran, nastavljeno v tiskalniku. Kodna stran določa pravilno tiskanje znakov č, š, ž.
                  Preverite jo v nastavitvah tiskalnika (tipično OEM 852 ali Windows-1250).
                </p>
                <div className="flex gap-3 flex-wrap items-center">
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
                  <select
                    className="border rounded px-2 py-1 text-sm bg-background"
                    value={tiskalnikCodePage}
                    onChange={e => {
                      const v = e.target.value as "cp1250" | "wpc1250" | "cp852" | "ascii-translit" | "bitmap";
                      setTiskalnikCodePage(v);
                      updateNapraveTerminali.mutate({ data: { tiskalnikCodePage: v } }, {
                        onSuccess: () => { updateTerminalConfig({ tiskalnikCodePage: v }); toast({ title: `Kodna stran nastavljena na ${v === "cp852" ? "OEM 852" : v === "wpc1250" ? "WPC1250 (n=12)" : v === "ascii-translit" ? "Transliteracija (brez šumnikov)" : v === "bitmap" ? "Slikovni izpis" : "Windows-1250 (n=45)"}` }); },
                        onError: () => toast({ title: "Napaka", description: "Nastavitve ni bilo mogoče shraniti.", variant: "destructive" }),
                      });
                    }}
                  >
                    <option value="cp1250">Windows-1250 n=45 (privzeto)</option>
                    <option value="wpc1250">WPC1250 n=12 (starejša HW)</option>
                    <option value="cp852">OEM 852 n=18 (Latin-2, CP852)</option>
                    <option value="ascii-translit">Brez šumnikov (transliteracija + EUR)</option>
                    <option value="bitmap">Slikovni izpis (pravi čšž in €, počasnejši)</option>
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
                    <a
                      href={`${base}/api/print/agent/skript.ps1?token=${encodeURIComponent(nastavitve.agentTiskalnikToken ?? "")}&printer=${encodeURIComponent(agentTiskalnikIme)}&apiBase=${encodeURIComponent(window.location.origin + base + "/api/print/agent")}`}
                      download="pos-tiskalnik.ps1"
                      className="inline-flex"
                    >
                      <Button type="button" size="sm" variant="outline" className="gap-2">
                        <Printer className="w-4 h-4" />
                        1. pos-tiskalnik.ps1
                      </Button>
                    </a>
                    <a href={`${base}/api/print/agent/pozeni.bat`} download="pozeni-agent.bat" className="inline-flex">
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

            </>
          ) : (
            <p className="text-muted-foreground text-xs">Nalagam žeton…</p>
          )}
        </CardContent>
      </Card>)}

      {/* ── Scanner Bridge ───────────────────────────────────── */}
      {!jeSuperAdmin && navigator.userAgent.includes("Windows") && (
      <Card id="ns-scanner-bridge">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Download className="w-4 h-4" />
            Scanner Bridge — HP optični čitalnik
          </CardTitle>
          <CardDescription>
            Lokalni servis, ki poveže POS aplikacijo z WIA-združljivim optičnim čitalnikom za skeniranje dobavnic in dokumentov.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4 text-sm">

          {/* Status */}
          <div className="flex items-center gap-3">
            {scannerBridgeStatus === "checking" && (
              <><Loader2 className="w-4 h-4 animate-spin text-muted-foreground" /><span className="text-muted-foreground">Preverjam…</span></>
            )}
            {scannerBridgeStatus === "ok" && (
              <><CheckCircle2 className="w-4 h-4 text-emerald-600" /><span className="text-emerald-700 font-medium">Bridge teče{scannerBridgeVersion ? ` (v${scannerBridgeVersion})` : ""}</span></>
            )}
            {scannerBridgeStatus === "offline" && (
              <><WifiOff className="w-4 h-4 text-red-500" /><span className="text-red-600">Bridge ne teče — zaženite ScannerBridge.exe</span></>
            )}
            {scannerBridgeStatus === "idle" && (
              <><Wifi className="w-4 h-4 text-muted-foreground" /><span className="text-muted-foreground">Status nepreverjen</span></>
            )}
            <Button type="button" size="sm" variant="outline" className="ml-auto gap-1.5"
              onClick={checkScannerBridge}
              disabled={scannerBridgeStatus === "checking"}>
              <RefreshCw className={`w-3.5 h-3.5 ${scannerBridgeStatus === "checking" ? "animate-spin" : ""}`} />
              Preveri
            </Button>
          </div>

          {/* Navodila */}
          <div className="space-y-3">
            <div className="space-y-1.5">
              <p className="text-xs font-semibold text-foreground">1. Prenesite ScannerBridge.exe</p>
              <p className="text-xs text-muted-foreground">
                Enkratna datoteka — Python ni potreben. Shranite jo kamorkoli (npr. <code className="bg-muted px-1 rounded">C:\Programi\ScannerBridge\</code>).
              </p>
              <a href={`${base}/api/downloads/ScannerBridge.exe`} download="ScannerBridge.exe" className="inline-flex">
                <Button type="button" size="sm" className="gap-2">
                  <Download className="w-4 h-4" />
                  ScannerBridge.exe
                </Button>
              </a>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-semibold text-foreground">2. Zaženite ScannerBridge.exe</p>
              <p className="text-xs text-muted-foreground">
                Ob prvem zagonu Windows prikaže opozorilo SmartScreen (<em>»Windows je zaščitil računalnik«</em>) — kliknite <strong>Več informacij → Vseeno zaženi</strong>. To se zgodi enkrat.
              </p>
              <p className="text-xs text-muted-foreground">
                Nato se ikona pojavi v sistemski vrstici (tray) in bridge se
                <strong> samodejno vpiše v Windows autostart</strong> —
                naslednjič se zažene sam ob prijavi.
              </p>
            </div>

            <div className="space-y-1">
              <p className="text-xs font-semibold text-foreground">3. Preverite povezavo</p>
              <p className="text-xs text-muted-foreground">
                Kliknite <em>Preveri</em> zgoraj — zelena oznaka pomeni, da je bridge dosegljiv in pripravljen za skeniranje.
              </p>
            </div>
          </div>

          {/* Napredne informacije */}
          <details className="text-xs">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground">Napredne informacije</summary>
            <div className="mt-2 space-y-1 text-muted-foreground">
              <p>Bridge posluša na <code className="bg-muted px-1 rounded">http://127.0.0.1:8765</code> — dostopen je samo z lokalne naprave.</p>
              <p>Autostart vnos: <code className="bg-muted px-1 rounded">HKCU\Software\Microsoft\Windows\CurrentVersion\Run → ScannerBridge</code></p>
              <p>Odstranitev avtostarta: <code className="bg-muted px-1 rounded">ScannerBridge.exe --uninstall</code></p>
            </div>
          </details>

        </CardContent>
      </Card>)}
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* ═══ 5 · POS vedenje ══════════════════════════════════════════ */}
            {(jeAdmin || jeAdminEnote) && nsSec(["ns-happy-hour","ns-zaloge","ns-prikaz","ns-izredni-pin","ns-ddv-razresev"]) && (
              <AccordionItem value="sek-vedenje" id="sek-vedenje" className="border rounded-lg overflow-hidden">
                <AccordionTrigger className="px-4 py-3.5 text-sm font-semibold hover:no-underline hover:bg-muted/40 data-[state=open]:bg-muted/30 min-h-[44px]">
                  <span className="flex items-center gap-2"><Store className="h-4 w-4 shrink-0" />POS vedenje</span>
                </AccordionTrigger>
                <AccordionContent className="pb-0">
                  <div className="space-y-4 p-4 pt-2">
      {(jeAdmin || jeAdminEnote) && !jeSuperAdmin && (<>
      {/* ── Happy Hour ──────────────────────────────────────────── */}
      <div id="ns-happy-hour">
        <HappyHourSettings />
      </div>

      {/* ── Zaloge ──────────────────────────────────────────────── */}
      <Card id="ns-zaloge">
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <span>📦 Zaloge</span>
          </CardTitle>
          <CardDescription>Nastavitve za upravljanje s zalogami.</CardDescription>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="rounded-lg border p-3 space-y-3">
            <div>
              <p className="font-medium">Velikosti pic</p>
              <p className="text-sm text-muted-foreground">Vnesite premere v cm. Če so vsi 0, se pice v enoti ne prodajajo.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              {[["Mala", picaPremerMala, setPicaPremerMala], ["Normalna", picaPremerNormalna, setPicaPremerNormalna], ["Družinska", picaPremerDruzinska, setPicaPremerDruzinska]].map(([naziv, vrednost, setVrednost]) => (
                <div key={naziv as string} className="space-y-1">
                  <Label>{naziv as string} (cm)</Label>
                  <Input type="number" min="0" max="100" step="0.5" value={vrednost as number} onChange={(event) => (setVrednost as (v: number) => void)(Math.max(0, Number(event.target.value) || 0))} />
                  {(vrednost as number) > 0 ? (
                    <p className="text-xs text-muted-foreground">
                      Koeficient normativa: <span className="font-semibold text-foreground">×{pizzaKoeficient(vrednost as number)?.toFixed(4).replace(".", ",")}</span>
                      {(vrednost as number) === pizzaNormativnaOsnova && " (osnova)"}
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">Velikost ni aktivna.</p>
                  )}
                </div>
              ))}
            </div>
          </div>
          <div className={`flex items-center justify-between rounded-lg border p-3 ${!dovoliNegativneZaloge ? "border-amber-300 bg-amber-50" : ""}`}>
            <div>
              <p className="text-sm font-medium">Dovoli negativne zaloge</p>
              <p className="text-xs text-muted-foreground mt-0.5">
                {dovoliNegativneZaloge
                  ? "Vklopljeno — prodaja, izdaja in brisanje prejemnic niso blokirani, tudi če zaloga pade pod nič."
                  : "Izklopljeno — transakcija, ki bi povzročila negativno zalogo, se zavrne z napako."}
              </p>
            </div>
            <Switch checked={dovoliNegativneZaloge} onCheckedChange={setDovoliNegativneZaloge} />
          </div>
        </CardContent>
      </Card>

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

      {/* ── DDV razreševalnik (topla pijača to-go) ──────────────────── */}
      {jeAdmin && (
        <Card id="ns-ddv-razresev">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Percent className="h-5 w-5" />DDV razreševalnik — topla pijača za s seboj
            </CardTitle>
            <CardDescription>
              Pravilo za DDV stopnjo tople pijače brez dodanega sladkorja (npr. nesladkan čaj, kava brez sladkorja) pri naročilih "za s seboj".
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              <div className="space-y-3">
                <label className="flex items-start gap-3 cursor-pointer rounded-lg border p-3 hover:bg-muted/40 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input
                    type="radio"
                    name="toGoTopli"
                    value="konservativno"
                    checked={toGoTopliNapitekStopnja === "konservativno"}
                    onChange={() => setToGoTopliNapitekStopnja("konservativno")}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-medium text-sm">22 % — konservativno</div>
                    <div className="text-xs text-muted-foreground">Nesladkana topla pijača za s seboj se obdavči enako kot pri mizi — 22 %. Privzeta nastavitev; varnejša do izrecnega pojasnila FURS.</div>
                  </div>
                </label>
                <label className="flex items-start gap-3 cursor-pointer rounded-lg border p-3 hover:bg-muted/40 transition-colors has-[:checked]:border-primary has-[:checked]:bg-primary/5">
                  <input
                    type="radio"
                    name="toGoTopli"
                    value="liberalno"
                    checked={toGoTopliNapitekStopnja === "liberalno"}
                    onChange={() => setToGoTopliNapitekStopnja("liberalno")}
                    className="mt-0.5"
                  />
                  <div>
                    <div className="font-medium text-sm">9,5 % — nova ureditev (od 2025)</div>
                    <div className="text-xs text-muted-foreground">Nesladkana topla pijača za s seboj se obdavči z 9,5 % (dobava blaga, enako kot hrana). Velja izključno za ta primer — na noben drug artikel nima vpliva.</div>
                  </div>
                </label>
              </div>
              <Button size="sm" onClick={handleSaveToGoTopli} disabled={toGoTopliShranjujem}>
                {toGoTopliShranjujem
                  ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Shranjujem…</>
                  : <><Save className="h-4 w-4 mr-2" />Shrani nastavitev</>}
              </Button>
            </div>
          </CardContent>
        </Card>
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
                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

            {/* ═══ 6 · Sistem (samo superadmin) ════════════════════════════ */}
            {jeSuperAdmin && nsSec(["ns-smtp","ns-ddv-stopnje","ns-testi"]) && (
              <AccordionItem value="sek-sistem" id="sek-sistem" className="border rounded-lg overflow-hidden">
                <AccordionTrigger className="px-4 py-3.5 text-sm font-semibold hover:no-underline hover:bg-muted/40 data-[state=open]:bg-muted/30 min-h-[44px]">
                  <span className="flex items-center gap-2"><Database className="h-4 w-4 shrink-0" />Sistem</span>
                </AccordionTrigger>
                <AccordionContent className="pb-0">
                  <div className="space-y-4 p-4 pt-2">
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
                <div>
                  <SecretInput
                    id="smtp-credential-value"
                    placeholder={smtpGesloNastavljeno ? "Novo geslo (pustite prazno za ohranitev)" : "geslo ali app password"}
                    value={smtpNovGeslo}
                    onChange={e => setSmtpNovGeslo(e.target.value)}
                    disabled={!smtpAktiven}
                  />
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

      {/* ── DDV stopnje (samo superadmin) ───────────────────────────── */}
      {jeSuperAdmin && (
        <Card id="ns-ddv-stopnje">
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
                    <DecimalInput
                      value={ddvSplosnaSt} onChange={e => setDdvSplosnaSt(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Privzeto: 22% — pijača, ostalo</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Nižja stopnja (%)</Label>
                    <DecimalInput
                      value={ddvNizjaSt} onChange={e => setDdvNizjaSt(e.target.value)}
                    />
                    <p className="text-xs text-muted-foreground">Privzeto: 9,5% — hrana v gostinstvu</p>
                  </div>
                  <div className="space-y-2">
                    <Label>Znižana stopnja (%)</Label>
                    <DecimalInput
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

                  </div>
                </AccordionContent>
              </AccordionItem>
            )}

          </Accordion>

          {/* ── Shrani vse nastavitve ──────────────────────────────────── */}
      {/* ── Shrani vse splošne nastavitve (samo admin) ────────────── */}
      {jeAdmin && (
        <div className="flex flex-col items-end gap-1.5">
          <p className="text-xs text-muted-foreground text-right">
            Shrani vse splošne nastavitve podjetja: naziv, naslov, davčna številka, FURS certifikat, testni način in druge sistemske nastavitve.
          </p>
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
        <DialogContent className="max-h-[calc(100dvh-2rem)] overflow-y-auto sm:max-w-lg">
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
              <Label>Vrsta gostinskega obrata</Label>
              <Select
                value={editEProfile}
                onValueChange={value => {
                  const profile = value as HospitalityProfile;
                  setEditEProfile(profile);
                }}
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(HOSPITALITY_PROFILES).map(([key, definition]) => (
                    <SelectItem key={key} value={key}>{definition.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{HOSPITALITY_PROFILES[editEProfile].description}</p>
            </div>
            <div className="space-y-2">
              <Label>Način strežbe</Label>
              <Select value={editEServiceMode} onValueChange={value => setEditEServiceMode(value as ServiceMode)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  {Object.entries(SERVICE_MODE_LABELS).map(([key, label]) => (
                    <SelectItem key={key} value={key}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between">
                <div>
                  <Label>Funkcije te enote</Label>
                  <p className="text-xs text-muted-foreground">Izbira določa namizni in mobilni levi meni za aktivno enoto.</p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    const defaults = profileDefaults(editEProfile);
                    setEditECapabilities(defaults.capabilities);
                    setEditEIsTemporary(defaults.temporary ?? false);
                    setEditEServiceMode(defaults.serviceMode);
                  }}
                >
                  Ponastavi predlogo
                </Button>
              </div>
              <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                {ALL_UNIT_CAPABILITIES.map(capability => (
                  <label key={capability} className="flex items-center gap-2 rounded-md border px-3 py-2 text-sm">
                    <Switch
                      checked={editECapabilities.includes(capability)}
                      onCheckedChange={checked => setEditECapabilities(current =>
                        checked
                          ? [...new Set([...current, capability])]
                          : current.filter(value => value !== capability),
                      )}
                    />
                    <span>{CAPABILITY_LABELS[capability]}</span>
                  </label>
                ))}
              </div>
            </div>
            <div className="space-y-3 rounded-lg border p-3">
              <div className="flex items-center justify-between gap-4">
                <div>
                  <Label>Začasna ali premična enota</Label>
                  <p className="text-xs text-muted-foreground">Za veselice, stojnice, catering in mobilne ponudnike.</p>
                </div>
                <Switch checked={editEIsTemporary} onCheckedChange={setEditEIsTemporary} />
              </div>
              {editEIsTemporary && (
                <>
                  <div className="space-y-2">
                    <Label>Lokacija dogodka ali prodajnega mesta</Label>
                    <Input
                      value={editETemporaryLocation}
                      onChange={event => setEditETemporaryLocation(event.target.value)}
                      placeholder="npr. Glavni trg 1, Ljubljana – vzhodna stojnica"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Matična enota</Label>
                    <Select value={editEParentUnitId || "__brez__"} onValueChange={value => setEditEParentUnitId(value === "__brez__" ? "" : value)}>
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="__brez__">— brez matične enote —</SelectItem>
                        {(enote ?? []).filter(unit => unit.id !== editingEnota?.id).map(unit => (
                          <SelectItem key={unit.id} value={String(unit.id)}>{unit.ime}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-2">
                      <Label>Aktivna od</Label>
                      <Input type="datetime-local" value={editEActiveFrom} onChange={event => setEditEActiveFrom(event.target.value)} />
                    </div>
                    <div className="space-y-2">
                      <Label>Aktivna do</Label>
                      <Input type="datetime-local" value={editEActiveTo} onChange={event => setEditEActiveTo(event.target.value)} />
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className="space-y-2">
              <Label>Začetek poslovnega dne</Label>
              <Input type="time" value={editEZacetekDnevaUra} onChange={e => setEditEZacetekDnevaUra(e.target.value)} />
              <p className="text-xs text-muted-foreground">Dnevni promet se računa od te ure do iste ure naslednjega dne (privzeto 04:00).</p>
            </div>
            <div className="flex items-start justify-between gap-4 rounded-lg border p-3">
              <div className="space-y-1">
                <Label htmlFor="studentski-bon-aktiven">Študentski bon</Label>
                <p className="text-xs text-muted-foreground">
                  Omogoči vnos subvencije študentskega bona pri zaključku računa v tej enoti.
                </p>
              </div>
              <Switch
                id="studentski-bon-aktiven"
                checked={editEStudentskiBonAktiven}
                onCheckedChange={setEditEStudentskiBonAktiven}
                data-testid="studentski-bon-aktiven"
              />
            </div>
            <div className="space-y-2">
              <Label>Stroškovno mesto (STM) <span className="text-muted-foreground font-normal">(neobvezno)</span></Label>
              <Select value={editECostCenterId || undefined} onValueChange={value => setEditECostCenterId(value === "__brez_sm__" ? "" : value)}>
                <SelectTrigger>
                  <SelectValue placeholder="Izberite stroškovno mesto (neobvezno)" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__brez_sm__">— brez stroškovnega mesta —</SelectItem>
                  {stroskovnaMesta.map(cc => (
                    <SelectItem key={cc.id} value={cc.id}>{cc.code} – {cc.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">Neobvezno. Če ga nastavite, se uporabi pri POS→ERP knjiženju.</p>
            </div>
            <div className="space-y-3 rounded-lg border p-3">
              <div>
                <Label>Lokacija QR menija</Label>
                <p className="mt-1 text-xs text-muted-foreground">
                  Gost lahko QR meni aktivira samo največ 50 m od te točke.
                </p>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <Label className="text-xs">Širina</Label>
                  <Input
                    inputMode="decimal"
                    value={editEQrLatitude}
                    onChange={e => setEditEQrLatitude(e.target.value)}
                    placeholder="46.056947"
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Dolžina</Label>
                  <Input
                    inputMode="decimal"
                    value={editEQrLongitude}
                    onChange={e => setEditEQrLongitude(e.target.value)}
                    placeholder="14.505751"
                  />
                </div>
              </div>
              <Button type="button" variant="outline" className="w-full" onClick={dolociQrLokacijo} disabled={qrLokacijoIscem}>
                {qrLokacijoIscem ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <LocateFixed className="mr-2 h-4 w-4" />}
                {qrLokacijoIscem ? "Določam lokacijo..." : "Uporabi trenutno lokacijo"}
              </Button>
              <div className="space-y-2 border-t pt-3">
                <div className="space-y-2">
                  <Label>Wi-Fi AP / SSID za goste</Label>
                  <Input
                    value={editEQrWifiSsid}
                    onChange={e => setEditEQrWifiSsid(e.target.value)}
                    placeholder="npr. Gostilna-Gosti"
                    maxLength={64}
                    autoComplete="off"
                  />
                </div>
                <div className="space-y-2">
                  <Label>Geslo Wi-Fi omrežja za goste</Label>
                  <SecretInput
                    value={editEQrWifiPassword}
                    onChange={e => setEditEQrWifiPassword(e.target.value)}
                    placeholder="Vnesite geslo, ki bo izpisano na QR listu"
                    nastavljen={Boolean(editEQrWifiPassword)}
                  />
                  <p className="text-xs text-muted-foreground">
                    Ime omrežja in geslo bosta vidna na vsakem natisnjenem QR listu za mize te enote.
                  </p>
                </div>
              </div>
              <div className="space-y-2 border-t pt-3">
                <Label>Lokalni Wi-Fi – javni IP/CIDR</Label>
                <Textarea
                  value={editEQrWifiNetworks}
                  onChange={e => setEditEQrWifiNetworks(e.target.value)}
                  placeholder={"Javni IPv4 lokala\nali javni IPv6/CIDR"}
                  rows={3}
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full"
                  onClick={() => void dodajTrenutniJavniIp()}
                  disabled={currentPublicIp.isFetching}
                >
                  {currentPublicIp.isFetching ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Wifi className="mr-2 h-4 w-4" />}
                  {currentPublicIp.isFetching ? "Preverjam javni IP..." : "Dodaj IP trenutnega Wi-Fi-ja"}
                </Button>
                <p className="text-xs text-muted-foreground">
                  Gumb uporabite, ko je POS povezan na Wi-Fi lokala. En javni naslov ali majhen CIDR-obseg na vrstico; zasebni, lokalni in preširoki obsegi so zavrnjeni.
                </p>
              </div>
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
            {editingNatakar && (
              <div className="rounded-lg border bg-muted/30 px-3 py-2 text-sm">
                ID natakarja: <span className="font-mono font-semibold">{editingNatakar.id}</span>
              </div>
            )}
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

            {jeAdmin && (
              <div className="space-y-3 rounded-lg border p-3 bg-muted/30">
                <div>
                  <Label htmlFor="edit-natakar-pos-pin" className="flex items-center gap-1.5">
                    <KeyRound className="h-3.5 w-3.5" />
                    POS PIN
                  </Label>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Natakar se s tem PIN-om prijavi na skupni POS brez lastnega ERP računa.
                  </p>
                </div>
                <div className="flex flex-col gap-2 sm:flex-row">
                  <SecretInput
                    id="edit-natakar-pos-pin"
                    ariaLabel="Novi POS PIN"
                    value={editNPosPin}
                    onChange={event => setEditNPosPin(event.target.value.replace(/\D/g, "").slice(0, 12))}
                    inputMode="numeric"
                    placeholder="4–12 številk"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={editNPosPinSaving || !/^\d{4,12}$/.test(editNPosPin)}
                    onClick={() => void handleSetNatakarPosPin()}
                  >
                    {editNPosPinSaving ? "Nastavljam..." : "Nastavi PIN"}
                  </Button>
                </div>
              </div>
            )}

            {/* ── Vezava na POS račun (za izmene) ─────────────────── */}
            <div className="space-y-2 border rounded-lg p-3 bg-muted/30">
              <Label className="flex items-center gap-1.5">
                <Users className="h-3.5 w-3.5" />
                Poveži s POS računom <span className="font-normal text-muted-foreground text-xs">(za izmene)</span>
              </Label>
              {posUporabniki.length > 0 ? (
                <Select
                  value={editNClerkUserId ?? "__none__"}
                  onValueChange={v => setEditNClerkUserId(v === "__none__" ? null : v)}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Izberi POS račun..." />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">— Brez vezave —</SelectItem>
                    {posUporabniki.map(u => (
                      <SelectItem key={u.clerkUserId} value={u.clerkUserId}>
                        {u.ime} {u.priimek}{u.enotaIme ? ` (${u.enotaIme})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              ) : (
                <p className="text-xs text-muted-foreground">Nalaganje POS računov…</p>
              )}
              <p className="text-xs text-muted-foreground">
                Vezan račun bo natakarjev profil samodejno prepoznal in mu omogočil odpiranje izmene.
              </p>
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
            {jeAdmin && (
              <div className="space-y-2">
                <Label>Enota <span className="text-destructive">*</span></Label>
                <Select value={ppEnotaId === "" ? "" : String(ppEnotaId)} onValueChange={v => setPpEnotaId(v ? Number(v) : "")}>
                  <SelectTrigger><SelectValue placeholder="Izberite enoto" /></SelectTrigger>
                  <SelectContent>
                    {(enote ?? []).map(e => (
                      <SelectItem key={e.id} value={String(e.id)}>{e.ime}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
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
            <div className="rounded-lg border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">
              Ta poslovni prostor uporablja FURS certifikat podjetja (nastavi ga v Podjetje/FURS).
            </div>

            <Button
              className="w-full gap-2"
              onClick={handleSavePp}
              disabled={!ppProstorId || (jeAdmin && !ppEnotaId) || createPp.isPending || updatePp.isPending}
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
                    onChange={e => handleEnotaChange(e.target.value === "" ? "" : Number(e.target.value))}
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
                    disabled={uLoading || !uEnotaId}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                  >
                    <option value="">{uEnotaId ? "— izberite blagajno —" : "— najprej izberite enoto —"}</option>
                    {(vseBlagajne ?? []).filter(b => b.aktivna && (!uEnotaId || b.enotaId === Number(uEnotaId))).map(b => (
                      <option key={b.id} value={b.id}>{b.ppId}-{b.bId} {b.ime}</option>
                    ))}
                  </select>
                  {uBlagajnaId !== "" && (() => { const b = (vseBlagajne ?? []).find(x => x.id === Number(uBlagajnaId)); return b ? <p className="text-xs text-muted-foreground">Poslovni prostor: <span className="font-medium text-foreground">{b.ppId}</span></p> : null; })()}
                  {!uBlagajnaId && uEnotaId && (vseBlagajne ?? []).filter(b => b.aktivna && b.enotaId === Number(uEnotaId)).length === 0 && (
                    <p className="text-xs text-amber-600">Za to enoto ni nastavljenih blagajn.</p>
                  )}
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
                    onChange={e => handleEnotaChange(e.target.value === "" ? "" : Number(e.target.value))}
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
                    disabled={uLoading || !uEnotaId}
                    className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus:outline-none focus:ring-1 focus:ring-ring disabled:opacity-50"
                  >
                    <option value="">{uEnotaId ? "— izberite blagajno —" : "— najprej izberite enoto —"}</option>
                    {(vseBlagajne ?? []).filter(b => b.aktivna && (!uEnotaId || b.enotaId === Number(uEnotaId))).map(b => (
                      <option key={b.id} value={b.id}>{b.ppId}-{b.bId} {b.ime}</option>
                    ))}
                  </select>
                  {uBlagajnaId !== "" && (() => { const b = (vseBlagajne ?? []).find(x => x.id === Number(uBlagajnaId)); return b ? <p className="text-xs text-muted-foreground">Poslovni prostor: <span className="font-medium text-foreground">{b.ppId}</span></p> : null; })()}
                  {!uBlagajnaId && uEnotaId && (vseBlagajne ?? []).filter(b => b.aktivna && b.enotaId === Number(uEnotaId)).length === 0 && (
                    <p className="text-xs text-amber-600">Za to enoto ni nastavljenih blagajn.</p>
                  )}
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
