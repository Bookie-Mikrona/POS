import { useState, useEffect, useRef } from "react";
import {
  useListShranjeniKupci,
  useCreateShranjenKupec,
  useUpdateShranjenKupec,
  useDeleteShranjenKupec,
  useOsveziShranjenKupec,
  useGetPartnerCenik,
  useUpsertPartnerCenikItem,
  useDeletePartnerCenikItem,
  useListArtikli,
  getListShranjeniKupciQueryKey,
  getGetKupciPogostiQueryKey,
  getGetPartnerCenikQueryKey,
  getEnotaId,
  type ShranjenKupec,
  type PartnerCenikItem,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KlavijaturaInput } from "@/components/KlavijaturaInput";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Plus,
  Minus,
  Pencil,
  Trash2,
  RotateCcw,
  Search,
  Building2,
  Mail,
  Phone,
  MapPin,
  CreditCard,
  ListChecks,
} from "lucide-react";

interface TrrVrstica { iban: string; bic: string }

type VrstaPartnerja = "obcan" | "sp" | "podjetje" | "kmet" | "javni_sektor" | null;

const VRSTA_PARTNERJA_OZNAKE: Record<NonNullable<VrstaPartnerja>, { oznaka: string; opis: string; barva: string }> = {
  obcan:        { oznaka: "Občan",        opis: "Fizična oseba / končni potrošnik",        barva: "bg-gray-100 text-gray-700 border-gray-300" },
  javni_sektor: { oznaka: "Javni sektor", opis: "Šole, vrtci, občine, zavodi, ministrstva …", barva: "bg-sky-100 text-sky-700 border-sky-300" },
  sp:      { oznaka: "S.p.",    opis: "Samostojni podjetnik",                 barva: "bg-blue-100 text-blue-700 border-blue-300" },
  podjetje:{ oznaka: "Podjetje",opis: "Gospodarska družba (d.o.o., d.d. …)",  barva: "bg-violet-100 text-violet-700 border-violet-300" },
  kmet:    { oznaka: "Kmet",    opis: "Kmetijsko gospodarstvo",               barva: "bg-green-100 text-green-700 border-green-300" },
};

interface KupecForm {
  vrstaPartnerja: VrstaPartnerja;
  naziv: string;
  kratkiNaziv: string;
  ulica: string;
  postnaStevilka: string;
  kraj: string;
  drzava: string;
  kodaDrzave: string;
  zavezanecDdv: boolean;
  davcnaStevilka: string;
  idZaDdv: string;
  maticnaStevilka: string;
  kmgMid: string;
  eRacunPrejemnik: boolean;
  eRacunOmrezje: string;
  eRacunEmail: string;
  eRacunNaslov: string;
  trr: TrrVrstica[];
  email: string;
  telefon: string;
}

function prazenForm(): KupecForm {
  return {
    vrstaPartnerja: null, naziv: "", kratkiNaziv: "", ulica: "", postnaStevilka: "", kraj: "",
    drzava: "", kodaDrzave: "", zavezanecDdv: false, davcnaStevilka: "",
    idZaDdv: "", maticnaStevilka: "", kmgMid: "", eRacunPrejemnik: false, eRacunOmrezje: "", eRacunEmail: "", eRacunNaslov: "", trr: [], email: "", telefon: "",
  };
}

function zaznajVrsto(naziv?: string | null, zavezanecDdv?: boolean | null, maticnaStevilka?: string | null): VrstaPartnerja {
  if (!naziv) return null;
  // Gospodarske družbe (d.o.o., d.d., k.d., z.o.o., d.n.o., e.s.p., k.d.d., s.k.e.)
  if (/\bd\.\s*o\.\s*o\.|\bd\.\s*d\.|\bk\.\s*d\.|\bz\.\s*o\.\s*o\.|\bd\.\s*n\.\s*o\.|\be\.\s*s\.\s*p\.|\bk\.\s*d\.\s*d\.|\bs\.\s*k\.\s*e\./i.test(naziv)) return "podjetje";
  // Samostojni podjetnik
  if (/\bs\.\s*p\.(\s|$|,)/i.test(naziv)) return "sp";
  // Kmetijstvo
  if (/\bkmetij|\bkmet\b|\bkgz\b/i.test(naziv)) return "kmet";
  // Javni sektor: šole, vrtci, zavodi, občine, ministrstva, sodišča, bolnice, univerze …
  if (/\bšola\b|\bvrtec\b|\bgimnazija\b|\blicej\b|\buniverzit|\bfakultet|\binštitut\b|\bzavod\b|\bobčina\b|\bministrstvo\b|\bagencija\b|\buprava\b|\bsodišče\b|\bbolnica\b|\bdom\s+zdravja\b|\bzdravstveni\s+dom\b|\bdom\s+starejših\b|\bdom\s+upokojencev\b|\bdom\s+za\b|\bjavni\s+sklad\b|\bsvet\s+zavoda\b|\bkrajevna\s+skupnost\b|\bmestna\s+občina\b/i.test(naziv)) return "javni_sektor";
  // Vsaka entiteta z matično številko je registrirana organizacija — ne fizična oseba
  if (maticnaStevilka?.trim()) return "podjetje";
  // Fizična oseba = brez pravnoorganizacijske oblike in brez DDV
  if (!zavezanecDdv) return "obcan";
  return null;
}

function kupecVForm(k: ShranjenKupec): KupecForm {
  return {
    vrstaPartnerja: (k.vrstaPartnerja as VrstaPartnerja) ?? null,
    naziv: k.naziv ?? "",
    kratkiNaziv: k.kratkiNaziv ?? "",
    ulica: k.ulica ?? "",
    postnaStevilka: k.postnaStevilka ?? "",
    kraj: k.kraj ?? "",
    drzava: k.drzava ?? "",
    kodaDrzave: k.kodaDrzave ?? "",
    zavezanecDdv: k.zavezanecDdv ?? false,
    davcnaStevilka: k.davcnaStevilka ?? "",
    idZaDdv: k.idZaDdv ?? "",
    maticnaStevilka: k.maticnaStevilka ?? "",
    kmgMid: k.kmgMid ?? "",
    eRacunPrejemnik: k.eRacunPrejemnik ?? false,
    eRacunOmrezje: k.eRacunOmrezje ?? "",
    eRacunEmail: k.eRacunEmail ?? "",
    eRacunNaslov: k.eRacunNaslov ?? "",
    trr: (k.trr as TrrVrstica[] | null) ?? [],
    email: k.email ?? "",
    telefon: k.telefon ?? "",
  };
}

function sestaviNaslov(k: { ulica?: string | null; postnaStevilka?: string | null; kraj?: string | null }): string | null {
  const row1 = k.ulica?.trim() || null;
  const row2 = [k.postnaStevilka?.trim(), k.kraj?.trim()].filter(Boolean).join(" ") || null;
  return [row1, row2].filter(Boolean).join(", ") || null;
}

interface InetisRezultat {
  id?: number | null;
  naziv?: string | null;
  kratkiNaziv?: string | null;
  ulica?: string | null;
  postnaStevilka?: string | null;
  kraj?: string | null;
  drzava?: string | null;
  kodaDrzave?: string | null;
  zavezanecDdv?: boolean | null;
  davcnaStevilka?: string | null;
  idZaDdv?: string | null;
  maticnaStevilka?: string | null;
  trr?: TrrVrstica[] | null;
  email?: string | null;
  telefon?: string | null;
  eRacunPrejemnik?: boolean | null;
  eRacunOmrezje?: string | null;
  eRacunEmail?: string | null;
  eRacunNaslov?: string | null;
}

export default function Partnerji() {
  const { data: kupci, isLoading } = useListShranjeniKupci();
  const createMutation = useCreateShranjenKupec();
  const updateMutation = useUpdateShranjenKupec();
  const deleteMutation = useDeleteShranjenKupec();
  const osveziMutation = useOsveziShranjenKupec();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [iskanje, setIskanje] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [cenikDodajArtikelId, setCenikDodajArtikelId] = useState<string>("");
  const [cenikDodajCena, setCenikDodajCena] = useState<string>("");

  const upsertCenikMutation = useUpsertPartnerCenikItem();
  const deleteCenikMutation = useDeletePartnerCenikItem();
  const { data: vsiArtikli } = useListArtikli();
  const { data: cenikData, refetch: refetchCenik } = useGetPartnerCenik(editId ?? 0);
  const [form, setForm] = useState<KupecForm>(prazenForm());
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteNaziv, setDeleteNaziv] = useState("");
  const [poisciLoading, setPoisciLoading] = useState(false);
  const [osvezevanje, setOsvezevanje] = useState<Set<number>>(new Set());

  // Mini-dialog: dodaj po davčni številki
  const [hitriDodajOpen, setHitriDodajOpen] = useState(false);
  const [hitriDavcna, setHitriDavcna] = useState("");
  const [hitriLoading, setHitriLoading] = useState(false);
  const [hitriNajden, setHitriNajden] = useState<string | null>(null);
  const hitriInputRef = useRef<HTMLInputElement>(null);

  const filtrirani = (kupci ?? []).filter(k => {
    if (!iskanje) return true;
    const q = iskanje.toLowerCase();
    return (
      k.naziv.toLowerCase().includes(q) ||
      (k.kratkiNaziv ?? "").toLowerCase().includes(q) ||
      (k.davcnaStevilka ?? "").includes(q) ||
      (k.maticnaStevilka ?? "").includes(q) ||
      (k.email ?? "").toLowerCase().includes(q) ||
      (k.kraj ?? "").toLowerCase().includes(q)
    );
  });

  function odpriNov() {
    setHitriDavcna("");
    setHitriNajden(null);
    setHitriDodajOpen(true);
    setTimeout(() => hitriInputRef.current?.focus(), 80);
  }

  function handleHitriRocni() {
    setHitriDodajOpen(false);
    setEditId(null);
    setForm(prazenForm());
    setEditOpen(true);
  }

  async function handleHitriPoisci(davcnaOverride?: string) {
    const davcna = (davcnaOverride ?? hitriDavcna).trim();
    if (!/^\d{8}$/.test(davcna)) return;
    setHitriLoading(true);
    setHitriNajden(null);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const enotaId = getEnotaId();
      const r = await fetch(`${base}/api/kupec/poisci?davcna=${davcna}`, {
        credentials: "include",
        headers: enotaId ? { "X-Enota-Id": enotaId } : {},
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as InetisRezultat;
      const vrsta = zaznajVrsto(data.naziv, data.zavezanecDdv, data.maticnaStevilka);
      setForm({
        ...prazenForm(),
        vrstaPartnerja: vrsta,
        davcnaStevilka: davcna,
        naziv: data.naziv ?? "",
        kratkiNaziv: data.kratkiNaziv ?? "",
        ulica: data.ulica ?? "",
        postnaStevilka: data.postnaStevilka ?? "",
        kraj: data.kraj ?? "",
        drzava: data.drzava ?? "",
        kodaDrzave: data.kodaDrzave ?? "",
        zavezanecDdv: data.zavezanecDdv ?? false,
        idZaDdv: data.idZaDdv ?? "",
        maticnaStevilka: data.maticnaStevilka ?? "",
        trr: data.trr ?? [],
        email: data.email ?? "",
        telefon: data.telefon ?? "",
        eRacunPrejemnik: data.eRacunPrejemnik ?? false,
        eRacunOmrezje: data.eRacunOmrezje ?? "",
        eRacunEmail: data.eRacunEmail ?? "",
        eRacunNaslov: data.eRacunNaslov ?? "",
      });
      setEditId(data.id ?? null);
      setHitriDodajOpen(false);
      setEditOpen(true);
      toast({ title: "Partner najden", description: data.naziv ?? "Podatki uvoženi iz registra." });
    } catch {
      setHitriNajden(null);
      toast({ title: "Partner ni najden", description: "Podjetja s to davčno ni v registru. Preverite številko ali uporabite ročni vnos.", variant: "destructive" });
    } finally {
      setHitriLoading(false);
    }
  }

  useEffect(() => {
    if (!hitriDodajOpen || !/^\d{8}$/.test(hitriDavcna)) return;
    const t = setTimeout(() => { void handleHitriPoisci(hitriDavcna); }, 600);
    return () => clearTimeout(t);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hitriDavcna, hitriDodajOpen]);

  function odpriUredi(k: ShranjenKupec) {
    setEditId(k.id);
    setForm(kupecVForm(k));
    setEditOpen(true);
  }

  function odpriDelete(k: ShranjenKupec) {
    setDeleteId(k.id);
    setDeleteNaziv(k.naziv ?? "");
  }

  async function handleOsvezi(k: ShranjenKupec) {
    setOsvezevanje(prev => new Set(prev).add(k.id));
    try {
      await osveziMutation.mutateAsync({ id: k.id });
      await queryClient.invalidateQueries({ queryKey: getListShranjeniKupciQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getGetKupciPogostiQueryKey() });
      toast({ title: "Podatki osveženi", description: `„${k.naziv}" posodobljen iz registra AJPES/INETIS.` });
    } catch (err: unknown) {
      const napaka = (err as { response?: { data?: { napaka?: string } } })?.response?.data?.napaka
        ?? "Napaka pri iskanju v registru.";
      toast({ title: "Osveževanje ni uspelo", description: napaka, variant: "destructive" });
    } finally {
      setOsvezevanje(prev => { const s = new Set(prev); s.delete(k.id); return s; });
    }
  }

  const setField = (key: keyof KupecForm, value: string | boolean) =>
    setForm(f => ({ ...f, [key]: value }));

  const addTrr = () => setForm(f => ({ ...f, trr: [...f.trr, { iban: "", bic: "" }] }));
  const removeTrr = (i: number) => setForm(f => ({ ...f, trr: f.trr.filter((_, idx) => idx !== i) }));
  const setTrr = (i: number, key: "iban" | "bic", val: string) =>
    setForm(f => { const trr = [...f.trr]; trr[i] = { ...trr[i]!, [key]: val }; return { ...f, trr }; });

  async function handlePoisci() {
    const davcna = form.davcnaStevilka.trim();
    if (!/^\d{8}$/.test(davcna)) {
      toast({ title: "Napačna davčna", description: "Davčna številka mora imeti 8 cifer.", variant: "destructive" });
      return;
    }
    setPoisciLoading(true);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const enotaId = getEnotaId();
      const r = await fetch(`${base}/api/kupec/poisci?davcna=${davcna}`, {
        credentials: "include",
        headers: enotaId ? { "X-Enota-Id": enotaId } : {},
      });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const data = await r.json() as InetisRezultat;
      setForm(f => {
        const novaVrsta = zaznajVrsto(data.naziv ?? f.naziv, data.zavezanecDdv ?? f.zavezanecDdv, data.maticnaStevilka ?? f.maticnaStevilka);
        return {
          ...f,
          naziv: data.naziv ?? f.naziv,
          kratkiNaziv: data.kratkiNaziv ?? f.kratkiNaziv,
          ulica: data.ulica ?? f.ulica,
          postnaStevilka: data.postnaStevilka ?? f.postnaStevilka,
          kraj: data.kraj ?? f.kraj,
          drzava: data.drzava ?? f.drzava,
          kodaDrzave: data.kodaDrzave ?? f.kodaDrzave,
          zavezanecDdv: data.zavezanecDdv ?? f.zavezanecDdv,
          idZaDdv: data.idZaDdv ?? f.idZaDdv,
          maticnaStevilka: data.maticnaStevilka ?? f.maticnaStevilka,
          trr: (data.trr && data.trr.length > 0) ? data.trr : f.trr,
          email: data.email ?? f.email,
          telefon: data.telefon ?? f.telefon,
          ...(novaVrsta !== null ? { vrstaPartnerja: novaVrsta } : {}),
          ...(data.eRacunPrejemnik != null ? {
            eRacunPrejemnik: data.eRacunPrejemnik,
            eRacunOmrezje: data.eRacunOmrezje ?? f.eRacunOmrezje,
            ...(data.eRacunEmail != null ? { eRacunEmail: data.eRacunEmail ?? "" } : {}),
            ...(data.eRacunNaslov != null ? { eRacunNaslov: data.eRacunNaslov ?? "" } : {}),
          } : {}),
        };
      });
      toast({ title: "Podatki najdeni", description: data.naziv ?? "Partner je bil najden v registru." });
    } catch {
      toast({ title: "Partner ni najden", description: "Podjetje s to davčno številko ni v registru.", variant: "destructive" });
    } finally {
      setPoisciLoading(false);
    }
  }

  async function handleShrani() {
    if (!form.naziv.trim()) {
      toast({ title: "Obvezno polje", description: "Dolgi naziv je obvezen.", variant: "destructive" });
      return;
    }
    setSaving(true);
    const payload = {
      vrstaPartnerja: form.vrstaPartnerja ?? null,
      naziv: form.naziv.trim(),
      kratkiNaziv: form.kratkiNaziv.trim() || null,
      ulica: form.ulica.trim() || null,
      postnaStevilka: form.postnaStevilka.trim() || null,
      kraj: form.kraj.trim() || null,
      drzava: form.drzava.trim() || null,
      kodaDrzave: form.kodaDrzave.trim() || null,
      zavezanecDdv: form.zavezanecDdv || null,
      davcnaStevilka: form.davcnaStevilka.trim() || null,
      idZaDdv: form.idZaDdv.trim() || null,
      maticnaStevilka: form.maticnaStevilka.trim() || null,
      kmgMid: form.kmgMid.trim() || null,
      eRacunPrejemnik: form.eRacunPrejemnik || null,
      eRacunOmrezje: form.eRacunOmrezje.trim() || null,
      eRacunEmail: form.eRacunEmail.trim() || null,
      eRacunNaslov: form.eRacunNaslov.trim() || null,
      trr: form.trr.filter(t => t.iban.trim()).map(t => ({ iban: t.iban.trim(), bic: t.bic.trim() })),
      email: form.email.trim() || null,
      telefon: form.telefon.trim() || null,
    };
    try {
      if (editId != null) {
        await updateMutation.mutateAsync({ id: editId, data: payload });
        toast({ title: "Partner posodobljen", description: `"${payload.naziv}" je bil posodobljen.` });
      } else {
        await createMutation.mutateAsync({ data: payload });
        toast({ title: "Partner dodan", description: `"${payload.naziv}" je bil dodan v šifrant.` });
      }
      void queryClient.invalidateQueries({ queryKey: getListShranjeniKupciQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetKupciPogostiQueryKey() });
      setEditOpen(false);
    } catch {
      toast({ title: "Napaka", description: "Podatkov ni bilo mogoče shraniti.", variant: "destructive" });
    } finally {
      setSaving(false);
    }
  }

  async function handleCenikUpsert() {
    if (editId == null) return;
    const artikelId = parseInt(cenikDodajArtikelId);
    const cena = parseFloat(cenikDodajCena.replace(",", "."));
    if (isNaN(artikelId) || isNaN(cena) || cena < 0) {
      toast({ title: "Napaka", description: "Izberite artikel in vnesite veljavno ceno.", variant: "destructive" }); return;
    }
    try {
      await upsertCenikMutation.mutateAsync({ id: editId, artikelId, data: { cena } });
      void queryClient.invalidateQueries({ queryKey: getGetPartnerCenikQueryKey(editId) });
      void refetchCenik();
      setCenikDodajArtikelId("");
      setCenikDodajCena("");
      toast({ title: "Cenik posodobljen" });
    } catch {
      toast({ title: "Napaka", description: "Cenika ni bilo mogoče shraniti.", variant: "destructive" });
    }
  }

  async function handleCenikDelete(artikelId: number) {
    if (editId == null) return;
    try {
      await deleteCenikMutation.mutateAsync({ id: editId, artikelId });
      void queryClient.invalidateQueries({ queryKey: getGetPartnerCenikQueryKey(editId) });
      void refetchCenik();
    } catch {
      toast({ title: "Napaka", description: "Cenika ni bilo mogoče odstraniti.", variant: "destructive" });
    }
  }

  function handleDelete() {
    if (deleteId == null) return;
    deleteMutation.mutate(
      { id: deleteId },
      {
        onSuccess: () => {
          toast({ title: "Partner izbrisan", description: `"${deleteNaziv}" je bil odstranjen.` });
          void queryClient.invalidateQueries({ queryKey: getListShranjeniKupciQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetKupciPogostiQueryKey() });
          setDeleteId(null);
        },
        onError: () => {
          toast({ title: "Napaka", description: "Partnerja ni bilo mogoče izbrisati.", variant: "destructive" });
          setDeleteId(null);
        },
      }
    );
  }

  return (
    <div className="p-4 sm:p-8 space-y-6 flex-1 overflow-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Šifrant partnerjev</h1>
        <Button onClick={odpriNov} className="shrink-0">
          <Plus className="h-4 w-4 mr-2" />
          Dodaj partnerja
        </Button>
      </div>

      {/* Iskanje */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <KlavijaturaInput
          placeholder="Išči po nazivu, davčni, matični, kraju…"
          value={iskanje}
          onChange={setIskanje}
          naslov="Iskanje"
          className="pl-9"
        />
      </div>

      {/* Tabela / seznam */}
      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : filtrirani.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          {(kupci?.length ?? 0) === 0
            ? "Šifrant je prazen. Dodajte prvega poslovnega partnerja."
            : "Ni partnerjev, ki bi ustrezali iskanju."}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Naziv</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground hidden md:table-cell">Davčna / ID DDV</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground hidden lg:table-cell">Naslov</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground hidden xl:table-cell">Kontakt</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground hidden xl:table-cell">TRR</th>
                <th className="w-20 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtrirani.map((k, idx) => {
                const naslov = sestaviNaslov(k) ?? k.naslov;
                const trr = (k.trr as TrrVrstica[] | null) ?? [];
                return (
                  <tr key={k.id} className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${idx % 2 === 0 ? "" : "bg-muted/10"}`}>
                    <td className="px-4 py-3">
                      <p className="font-medium leading-snug">{k.kratkiNaziv || k.naziv}</p>
                      {k.kratkiNaziv && (
                        <p className="text-xs text-muted-foreground truncate max-w-[220px]">{k.naziv}</p>
                      )}
                      <div className="flex flex-wrap gap-1 mt-0.5">
                        {k.vrstaPartnerja && VRSTA_PARTNERJA_OZNAKE[k.vrstaPartnerja as NonNullable<VrstaPartnerja>] && (
                          <span className={`inline-block text-[10px] font-semibold border rounded px-1.5 py-0 ${VRSTA_PARTNERJA_OZNAKE[k.vrstaPartnerja as NonNullable<VrstaPartnerja>].barva}`}>
                            {VRSTA_PARTNERJA_OZNAKE[k.vrstaPartnerja as NonNullable<VrstaPartnerja>].oznaka}
                          </span>
                        )}
                        {k.zavezanecDdv && (
                          <span className="inline-block text-[10px] font-semibold text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-1.5 py-0">DDV</span>
                        )}
                        {k.eRacunPrejemnik && (
                          <span className="inline-block text-[10px] font-semibold text-indigo-700 bg-indigo-50 border border-indigo-200 rounded px-1.5 py-0" title={k.eRacunOmrezje ?? undefined}>e-Račun</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell">
                      {k.davcnaStevilka && (
                        <p className="font-mono text-xs">{k.davcnaStevilka}</p>
                      )}
                      {k.idZaDdv && (
                        <p className="font-mono text-xs text-muted-foreground">{k.idZaDdv}</p>
                      )}
                      {k.maticnaStevilka && (
                        <p className="text-xs text-muted-foreground">MŠ: {k.maticnaStevilka}</p>
                      )}
                      {!k.davcnaStevilka && !k.idZaDdv && !k.maticnaStevilka && (
                        <span className="text-xs text-muted-foreground italic">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell">
                      {naslov ? (
                        <p className="text-xs text-muted-foreground max-w-[200px] leading-snug">{naslov}</p>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell">
                      <div className="space-y-0.5">
                        {k.email && (
                          <p className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Mail className="h-3 w-3 shrink-0" />
                            <span className="truncate max-w-[160px]">{k.email}</span>
                          </p>
                        )}
                        {k.telefon && (
                          <p className="flex items-center gap-1 text-xs text-muted-foreground">
                            <Phone className="h-3 w-3 shrink-0" />
                            {k.telefon}
                          </p>
                        )}
                        {!k.email && !k.telefon && (
                          <span className="text-xs text-muted-foreground italic">—</span>
                        )}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden xl:table-cell">
                      {trr.length > 0 ? (
                        <div className="space-y-0.5">
                          {trr.slice(0, 2).map((t, i) => (
                            <p key={i} className="flex items-center gap-1 text-xs font-mono text-muted-foreground">
                              <CreditCard className="h-3 w-3 shrink-0" />
                              <span className="truncate max-w-[160px]">{t.iban}</span>
                            </p>
                          ))}
                          {trr.length > 2 && (
                            <p className="text-xs text-muted-foreground">+{trr.length - 2} več</p>
                          )}
                        </div>
                      ) : (
                        <span className="text-xs text-muted-foreground italic">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1 justify-end">
                        <button
                          type="button"
                          onClick={() => odpriUredi(k)}
                          className="p-1.5 rounded text-muted-foreground hover:text-primary hover:bg-muted transition-colors"
                          title="Uredi partnerja"
                        >
                          <Pencil className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          onClick={() => handleOsvezi(k)}
                          disabled={osvezevanje.has(k.id)}
                          className="p-1.5 rounded text-muted-foreground hover:text-blue-600 hover:bg-muted transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          title={k.davcnaStevilka ? "Osveži podatke iz registra AJPES/INETIS" : "Za osveževanje je potrebna davčna številka"}
                        >
                          {osvezevanje.has(k.id)
                            ? <Loader2 className="h-3.5 w-3.5 animate-spin" />
                            : <RotateCcw className="h-3.5 w-3.5" />
                          }
                        </button>
                        <button
                          type="button"
                          onClick={() => odpriDelete(k)}
                          className="p-1.5 rounded text-muted-foreground hover:text-destructive hover:bg-muted transition-colors"
                          title="Izbriši partnerja"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* Statistika */}
      {!isLoading && (kupci?.length ?? 0) > 0 && (
        <p className="text-xs text-muted-foreground">
          {filtrirani.length === kupci?.length
            ? `${kupci!.length} ${kupci!.length === 1 ? "partner" : kupci!.length < 5 ? "partnerji" : "partnerjev"} v šifrantu`
            : `${filtrirani.length} od ${kupci!.length} partnerjev`}
        </p>
      )}

      {/* Mini-dialog: dodaj po davčni številki */}
      <Dialog open={hitriDodajOpen} onOpenChange={open => { setHitriDodajOpen(open); if (!open) setHitriNajden(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              Dodaj poslovnega partnerja
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-1">
            <div className="space-y-2">
              <Label className="text-xs font-medium">Davčna številka</Label>
              <div className="flex gap-2">
                <Input
                  ref={hitriInputRef}
                  value={hitriDavcna}
                  onChange={e => setHitriDavcna(e.target.value.replace(/\D/g, "").slice(0, 8))}
                  placeholder="12345678"
                  className="flex-1 text-base tracking-widest font-mono"
                  maxLength={8}
                  onKeyDown={e => {
                    if (e.key === "Enter" && /^\d{8}$/.test(hitriDavcna)) void handleHitriPoisci();
                  }}
                  disabled={hitriLoading}
                />
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => void handleHitriPoisci()}
                  disabled={hitriLoading || !/^\d{8}$/.test(hitriDavcna)}
                  className="shrink-0 px-3"
                  title="Poišči v poslovnem registru"
                >
                  {hitriLoading
                    ? <Loader2 className="h-4 w-4 animate-spin" />
                    : <Search className="h-4 w-4" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Vnesite 8-mestno davčno. Podatki se samodejno uvozijo iz registra AJPES/INETIS.
              </p>
            </div>

            {hitriNajden && (
              <div className="bg-green-50 border border-green-200 rounded-md px-3 py-2">
                <p className="text-sm font-medium text-green-800 truncate">{hitriNajden}</p>
                <p className="text-xs text-green-600 mt-0.5">Najdeno v registru</p>
              </div>
            )}

            <div className="flex items-center justify-between pt-1 border-t">
              <span className="text-xs text-muted-foreground">Brez davčne ali tuja podjetja:</span>
              <button
                type="button"
                className="text-xs text-primary underline underline-offset-2 hover:no-underline"
                onClick={handleHitriRocni}
              >
                Ročni vnos
              </button>
            </div>
          </div>
        </DialogContent>
      </Dialog>

      {/* Dialog za dodajanje / urejanje */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="p-4 pb-0 shrink-0">
            <DialogTitle className="flex items-center gap-2">
              <Building2 className="h-4 w-4 text-muted-foreground" />
              {editId != null ? "Uredi partnerja" : "Nov poslovni partner"}
            </DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 pt-3">
            <div className="space-y-5">

              {/* Vrsta partnerja */}
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Vrsta partnerja</p>
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {(Object.entries(VRSTA_PARTNERJA_OZNAKE) as [NonNullable<VrstaPartnerja>, typeof VRSTA_PARTNERJA_OZNAKE[NonNullable<VrstaPartnerja>]][]).map(([key, meta]) => (
                    <button
                      key={key}
                      type="button"
                      onClick={() => setForm(f => ({ ...f, vrstaPartnerja: f.vrstaPartnerja === key ? null : key }))}
                      className={`flex flex-col items-start px-3 py-2 rounded-lg border text-left transition-all ${
                        form.vrstaPartnerja === key
                          ? `${meta.barva} ring-2 ring-offset-1 ring-current`
                          : "bg-background border-border hover:bg-muted/50"
                      }`}
                    >
                      <span className="text-sm font-semibold leading-tight">{meta.oznaka}</span>
                      <span className="text-[10px] text-muted-foreground leading-tight mt-0.5 line-clamp-2">{meta.opis}</span>
                    </button>
                  ))}
                </div>
              </section>

              {/* Identifikacija */}
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identifikacija</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Dolgi naziv *</Label>
                    <KlavijaturaInput value={form.naziv} onChange={v => setField("naziv", v)} placeholder="Polno ime / firma" naslov="Naziv" />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Kratki naziv</Label>
                    <KlavijaturaInput value={form.kratkiNaziv} onChange={v => setField("kratkiNaziv", v)} placeholder="Skrajšano ime" naslov="Kratki naziv" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Davčna številka</Label>
                    <div className="flex gap-1.5">
                      <KlavijaturaInput
                        value={form.davcnaStevilka}
                        onChange={v => setField("davcnaStevilka", v)}
                        placeholder="12345678"
                        naslov="Davčna številka"
                        className="flex-1"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => { void handlePoisci(); }}
                        disabled={poisciLoading || !/^\d{8}$/.test(form.davcnaStevilka.trim())}
                        className="shrink-0 h-9 px-2.5 text-xs"
                        title="Poišči v poslovnem registru (INETIS)"
                      >
                        {poisciLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                      </Button>
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">ID za DDV</Label>
                    <KlavijaturaInput value={form.idZaDdv} onChange={v => setField("idZaDdv", v)} placeholder="SI12345678" naslov="ID za DDV" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Matična številka</Label>
                    <KlavijaturaInput value={form.maticnaStevilka} onChange={v => setField("maticnaStevilka", v)} placeholder="1234567000" naslov="Matična številka" />
                  </div>
                  {form.vrstaPartnerja === "kmet" && (
                    <div className="col-span-2 space-y-1">
                      <Label className="text-xs">KMG-MID (identifikator kmetije)</Label>
                      <KlavijaturaInput
                        value={form.kmgMid}
                        onChange={v => setField("kmgMid", v)}
                        placeholder="100012345"
                        naslov="KMG-MID"
                      />
                    </div>
                  )}
                  <div className="flex items-center gap-2 pt-5">
                    <Checkbox id="zavezanec" checked={form.zavezanecDdv}
                      onCheckedChange={v => setField("zavezanecDdv", !!v)} />
                    <Label htmlFor="zavezanec" className="text-xs cursor-pointer">Zavezanec za DDV</Label>
                  </div>
                </div>
              </section>

              {/* Naslov */}
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                  <MapPin className="h-3 w-3" /> Naslov
                </p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Ulica in hišna številka</Label>
                    <KlavijaturaInput value={form.ulica} onChange={v => setField("ulica", v)} placeholder="Ulica 12" naslov="Ulica" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Poštna številka</Label>
                    <KlavijaturaInput value={form.postnaStevilka} onChange={v => setField("postnaStevilka", v)} placeholder="1000" naslov="Poštna številka" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Kraj</Label>
                    <KlavijaturaInput value={form.kraj} onChange={v => setField("kraj", v)} placeholder="Ljubljana" naslov="Kraj" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Država</Label>
                    <KlavijaturaInput value={form.drzava} onChange={v => setField("drzava", v)} placeholder="Slovenija" naslov="Država" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Koda države (ISO)</Label>
                    <KlavijaturaInput value={form.kodaDrzave} onChange={v => setField("kodaDrzave", v)} placeholder="SI" naslov="Koda države" maxLength={3} />
                  </div>
                </div>
              </section>

              {/* E-račun */}
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">E-račun</p>
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Checkbox
                      id="eRacunPrejemnik"
                      checked={form.eRacunPrejemnik}
                      onCheckedChange={v => setForm(f => ({ ...f, eRacunPrejemnik: !!v, eRacunOmrezje: v ? f.eRacunOmrezje : "", eRacunEmail: v ? f.eRacunEmail : "", eRacunNaslov: v ? f.eRacunNaslov : "" }))}
                    />
                    <Label htmlFor="eRacunPrejemnik" className="text-xs cursor-pointer">
                      Partner je registriran za prejem e-računov (eRegister GZS)
                    </Label>
                  </div>
                  {form.eRacunPrejemnik && (
                    <div className="space-y-2 pl-6">
                      <div className="space-y-1">
                        <Label className="text-xs">Ponudnik / omrežje</Label>
                        <KlavijaturaInput
                          value={form.eRacunOmrezje}
                          onChange={v => setField("eRacunOmrezje", v)}
                          placeholder="npr. UJP, bizBox, Halcom, NLB, OTP…"
                          naslov="E-račun omrežje"
                        />
                        <p className="text-[10px] text-muted-foreground leading-snug">
                          Podatek iz registra <span className="font-mono">bizbox.zzi.si</span>. Preverite pred prvim pošiljanjem.
                        </p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">Naslov prejemnika / IBAN</Label>
                        <KlavijaturaInput
                          value={form.eRacunNaslov}
                          onChange={v => setField("eRacunNaslov", v)}
                          placeholder="npr. SI56012576030659753"
                          naslov="E-račun naslov / IBAN"
                        />
                        <p className="text-[10px] text-muted-foreground leading-snug">
                          Za UJP omrežje: IBAN bančnega računa prejemnika (iz bizBox registra).
                        </p>
                      </div>
                      <div className="space-y-1">
                        <Label className="text-xs">E-pošta za e-račune</Label>
                        <KlavijaturaInput
                          value={form.eRacunEmail}
                          onChange={v => setField("eRacunEmail", v)}
                          placeholder="racuni@sola.si"
                          naslov="E-pošta za e-račune"
                        />
                        <p className="text-[10px] text-muted-foreground leading-snug">
                          Neobvezno — e-poštni naslov za dostavo e-računov, če se razlikuje od splošnega.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </section>

              {/* Kontakt */}
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kontakt</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">E-pošta</Label>
                    <KlavijaturaInput value={form.email} onChange={v => setField("email", v)} placeholder="info@podjetje.si" naslov="E-pošta" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Telefon</Label>
                    <KlavijaturaInput value={form.telefon} onChange={v => setField("telefon", v)} placeholder="+386 1 234 5678" naslov="Telefon" />
                  </div>
                </div>
              </section>

              {/* TRR */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                    <CreditCard className="h-3 w-3" /> TRR računi
                  </p>
                  <button type="button" onClick={addTrr}
                    className="flex items-center gap-1 text-xs text-primary hover:underline">
                    <Plus className="h-3 w-3" /> Dodaj TRR
                  </button>
                </div>
                {form.trr.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Ni vpisanih TRR računov.</p>
                ) : (
                  <div className="space-y-2">
                    {form.trr.map((t, i) => (
                      <div key={i} className="flex gap-2 items-end">
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs">IBAN</Label>
                          <KlavijaturaInput value={t.iban} onChange={v => setTrr(i, "iban", v)} placeholder="SI56 1234 5678 9012 3456" naslov="IBAN" />
                        </div>
                        <div className="w-28 space-y-1">
                          <Label className="text-xs">BIC</Label>
                          <KlavijaturaInput value={t.bic} onChange={v => setTrr(i, "bic", v)} placeholder="LJBASI2X" naslov="BIC" />
                        </div>
                        <button type="button" onClick={() => removeTrr(i)}
                          className="shrink-0 mb-1 text-muted-foreground hover:text-destructive">
                          <Minus className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

              {/* Cenik — samo za obstoječe partnerje */}
              {editId != null && (
                <section className="space-y-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center gap-1">
                      <ListChecks className="h-3 w-3" /> Cenik partnerja
                    </p>
                  </div>
                  <p className="text-[10px] text-muted-foreground leading-snug">
                    Dogovorjene cene artiklov za tega partnerja. Ob zaključku računa z davčno tega partnerja se cene samodejno prekalkulirajo.
                  </p>
                  {(cenikData ?? []).length === 0 ? (
                    <p className="text-xs text-muted-foreground italic">Ni posebnih cen — veljajo standardne cene cenika.</p>
                  ) : (
                    <div className="divide-y divide-border rounded-md border text-xs overflow-hidden">
                      {(cenikData ?? []).map((v: PartnerCenikItem) => (
                        <div key={v.artikelId} className="flex items-center gap-2 px-3 py-2">
                          <div className="flex-1 min-w-0">
                            <span className="font-medium truncate block">{v.artikelIme}</span>
                            {v.kategorijaIme && <span className="text-muted-foreground">{v.kategorijaIme}</span>}
                          </div>
                          <span className="text-muted-foreground line-through whitespace-nowrap">{(v.originalCena ?? 0).toFixed(2)} €</span>
                          <Input
                            type="number"
                            className="w-24 h-7 text-xs text-right"
                            step="0.01"
                            min="0"
                            defaultValue={v.cena.toFixed(2)}
                            onBlur={e => {
                              const nova = parseFloat(e.currentTarget.value.replace(",", "."));
                              if (!isNaN(nova) && nova >= 0 && nova !== v.cena) {
                                void upsertCenikMutation.mutateAsync({ id: editId, artikelId: v.artikelId, data: { cena: nova } })
                                  .then(() => { void queryClient.invalidateQueries({ queryKey: getGetPartnerCenikQueryKey(editId) }); void refetchCenik(); })
                                  .catch(() => toast({ title: "Napaka", description: "Cene ni bilo mogoče shraniti.", variant: "destructive" }));
                              }
                            }}
                          />
                          <button type="button" onClick={() => { void handleCenikDelete(v.artikelId); }}
                            className="text-muted-foreground hover:text-destructive shrink-0">
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}
                  {/* Dodaj artikel */}
                  <div className="flex gap-2 items-end">
                    <div className="flex-1 min-w-0">
                      <Label className="text-xs">Artikel</Label>
                      <Select value={cenikDodajArtikelId} onValueChange={setCenikDodajArtikelId}>
                        <SelectTrigger className="h-8 text-xs">
                          <SelectValue placeholder="Izberite artikel …" />
                        </SelectTrigger>
                        <SelectContent>
                          {(vsiArtikli ?? [])
                            .filter(a => a.prodajniArtikel && !(cenikData ?? []).some((c: PartnerCenikItem) => c.artikelId === a.id))
                            .map(a => (
                              <SelectItem key={a.id} value={String(a.id)} className="text-xs">
                                {a.ime} — {Number(a.cena).toFixed(2)} €
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="w-24">
                      <Label className="text-xs">Cena (€)</Label>
                      <Input
                        type="number"
                        className="h-8 text-xs"
                        step="0.01"
                        min="0"
                        placeholder="0.00"
                        value={cenikDodajCena}
                        onChange={e => setCenikDodajCena(e.currentTarget.value)}
                        onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); void handleCenikUpsert(); } }}
                      />
                    </div>
                    <Button size="sm" variant="outline" className="h-8 shrink-0"
                      onClick={() => { void handleCenikUpsert(); }}
                      disabled={!cenikDodajArtikelId || !cenikDodajCena}>
                      <Plus className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </section>
              )}
            </div>
          </div>

          <div className="shrink-0 p-4 pt-3 border-t flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setEditOpen(false)}>Prekliči</Button>
            <Button onClick={() => { void handleShrani(); }} disabled={saving}>
              {saving ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Shrani
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* Potrditev brisanja */}
      <AlertDialog open={deleteId != null} onOpenChange={open => { if (!open) setDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Izbriši partnerja?</AlertDialogTitle>
            <AlertDialogDescription>
              Poslovni partner <strong>"{deleteNaziv}"</strong> bo trajno izbrisan iz šifranta.
              Obstoječi računi, na katerih je naveden, ostanejo nespremenjeni.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Prekliči</AlertDialogCancel>
            <AlertDialogAction
              onClick={handleDelete}
              className="bg-destructive hover:bg-destructive/90"
            >
              Izbriši
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
