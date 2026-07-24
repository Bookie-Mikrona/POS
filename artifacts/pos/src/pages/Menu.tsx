import { useState, useEffect, useRef } from "react";
import {
  useListKategorije,
  useListArtikli,
  useCreateKategorija,
  useCreateArtikel,
  useDeleteKategorija,
  useDeleteArtikel,
  useUpdateKategorija,
  useUpdateArtikel,
  useGetArtikelNormativi,
  useUpdateArtikelNormativi,
  useListModSkupine,
  useGetArtikelModSkupine,
  useSetArtikelModSkupine,
  getListKategorijeQueryKey,
  getListArtikliQueryKey,
  getGetArtikelNormativiQueryKey,
  getGetArtikelModSkupineQueryKey,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KlavijaturaInput } from "@/components/KlavijaturaInput";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Search, X, Copy, Upload, FileUp, FileDown, AlertCircle, CheckCircle2, SlidersHorizontal, ShoppingBag } from "lucide-react";
import type { Kategorija, Artikel, ModSkupinaFull } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import ModifikatorjePanel from "@/components/ModifikatorjePanel";

import { type NormativItem } from "@/lib/kopiraj-normativ";
import { useKopirajNormativ } from "@/hooks/useKopirajNormativ";

type KategorijaDialogMode = "nova" | "uredi";
type ArtDialogMode = "nov" | "uredi";

const ESLOG_ENOTE = [
  { koda: "KOM", ime: "kos (KOM)" },
  { koda: "KGM", ime: "kilogram (KGM)" },
  { koda: "GRM", ime: "gram (GRM)" },
  { koda: "LTR", ime: "liter (LTR)" },
  { koda: "DLT", ime: "deciliter (DLT)" },
  { koda: "MLT", ime: "mililiter (MLT)" },
];

export default function Menu() {
  const { user } = useAuth();
  const jeUporabnik = user?.vloga === "uporabnik";

  const { data: kategorije, isLoading: loadingK } = useListKategorije();
  const { data: artikli, isLoading: loadingA } = useListArtikli();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const createKategorija = useCreateKategorija();
  const deleteKategorija = useDeleteKategorija();
  const updateKategorija = useUpdateKategorija();
  const createArtikel = useCreateArtikel();
  const deleteArtikel = useDeleteArtikel();
  const updateArtikel = useUpdateArtikel();
  const updateNormativi = useUpdateArtikelNormativi();

  // ── Kategorija dialog ────────────────────────────────────────
  const [catDialogOpen, setCatDialogOpen] = useState(false);
  const [catMode, setCatMode] = useState<KategorijaDialogMode>("nova");
  const [editingKat, setEditingKat] = useState<Kategorija | null>(null);
  const [catName, setCatName] = useState("");
  const [catColor, setCatColor] = useState("#22c55e");
  const [catOrder, setCatOrder] = useState("0");
  const [catTip, setCatTip] = useState<"hrana" | "pijaca" | "none">("none");
  const [catDnevnoFiltriranje, setCatDnevnoFiltriranje] = useState(false);

  // ── Artikel dialog ───────────────────────────────────────────
  const [artDialogOpen, setArtDialogOpen] = useState(false);
  const [artMode, setArtMode] = useState<ArtDialogMode>("nov");
  const [editingArt, setEditingArt] = useState<Artikel | null>(null);
  const [artName, setArtName] = useState("");
  const [artPrice, setArtPrice] = useState("");
  const [artCat, setArtCat] = useState("");
  const [artTax, setArtTax] = useState("");
  const [artAktiven, setArtAktiven] = useState(true);
  const [artColor, setArtColor] = useState<string | null>(null);
  const [artNabavniArtikel, setArtNabavniArtikel] = useState(false);
  const [artProdajniArtikel, setArtProdajniArtikel] = useState(true);
  const [artJePica, setArtJePica] = useState(false);
  const [artImeZaNabavo, setArtImeZaNabavo] = useState("");
  const [artEnotaMere, setArtEnotaMere] = useState<string | null>(null);
  const [normativItems, setNormativItems] = useState<NormativItem[]>([]);
  const [normativNapaka, setNormativNapaka] = useState<string | null>(null);
  const [artModSkupineIds, setArtModSkupineIds] = useState<number[]>([]);
  const [artPrivzetiModGrpIds, setArtPrivzetiModGrpIds] = useState<number[]>([]);
  const [artToGoArtikli, setArtToGoArtikli] = useState<number[]>([]);
  const [artToGo, setArtToGo] = useState(false);
  const [artVrstaArtikla, setArtVrstaArtikla] = useState<"blago" | "material" | "storitev">("storitev");

  const [ddvStopnje, setDdvStopnje] = useState({ splosnaSt: 22, nizjaSt: 9.5, znizanaSt: 5 });
  const [uskladiOpen, setUskladiOpen] = useState(false);
  const [uskladiLoading, setUskladiLoading] = useState(false);

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}api/nastavitve/ddv-stopnje`, { credentials: "include" })
      .then(r => r.json())
      .then((d: unknown) => {
        const data = d as { splosnaSt: number; nizjaSt: number; znizanaSt: number };
        if (data && typeof data.splosnaSt === "number") setDdvStopnje(data);
      })
      .catch(() => {});
  }, []);

  const handleUskladiDdv = async () => {
    setUskladiLoading(true);
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}api/artikli/uskladi-ddv`, {
        method: "POST",
        credentials: "include",
      });
      if (!r.ok) {
        const err = await r.json() as { napaka?: string };
        toast({ title: "Napaka", description: err.napaka ?? "Napaka strežnika", variant: "destructive" });
      } else {
        const d = await r.json() as { posodobljeno: number };
        toast({
          title: "Uskladitev zaključena",
          description: d.posodobljeno === 0
            ? "Vse stopnje so že usklajene."
            : `Posodobljeno ${d.posodobljeno} ${d.posodobljeno === 1 ? "artikel" : d.posodobljeno < 5 ? "artikli" : "artiklov"}.`,
        });
        await queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });
      }
    } catch {
      toast({ title: "Napaka", description: "Omrežna napaka", variant: "destructive" });
    } finally {
      setUskladiLoading(false);
      setUskladiOpen(false);
    }
  };

  const [artFilter, setArtFilter] = useState<"vsi" | "prodajni" | "nabavni" | "zNormativom" | "brezNormativa">("vsi");
  const [artSearch, setArtSearch] = useState("");
  const artSearchRef = useRef<HTMLInputElement>(null);
  const selectedArtRowRef = useRef<HTMLTableRowElement>(null);

  const [editingPriceId, setEditingPriceId] = useState<number | null>(null);
  const [editingPriceVal, setEditingPriceVal] = useState("");

  // ── Kopiraj normativ iz drugega artikla ───────────────────────
  const {
    handleCopyFromArtikel,
    copyPickerLoading,
    copyPickerOpen,
    copyPickerSearch,
    setCopyPickerOpen,
    setCopyPickerSearch,
  } = useKopirajNormativ({ setNormativItems, setNormativNapaka });

  // ── Excel uvoz ────────────────────────────────────────────────
  type UvozKorak = "izbira" | "predogled" | "rezultat";
  type UvozPredogled = { ime: string; cena: number; ddv: number; kategorija: string | null };
  type UvozNapaka = { vrstica: number; napaka: string };
  type UvozRezultat = { uvozenih: number; preskocenih: number; napake: UvozNapaka[]; normativiUvozenih: number };

  const [uvozOpen, setUvozOpen] = useState(false);
  const [uvozKorak, setUvozKorak] = useState<UvozKorak>("izbira");
  const [uvozDatoteka, setUvozDatoteka] = useState<File | null>(null);
  const [uvozLoading, setUvozLoading] = useState(false);
  const [uvozPredogled, setUvozPredogled] = useState<UvozPredogled[]>([]);
  const [uvozNapake, setUvozNapake] = useState<UvozNapaka[]>([]);
  const [uvozSkupaj, setUvozSkupaj] = useState(0);
  const [uvozVeljavnih, setUvozVeljavnih] = useState(0);
  const [uvozNormativov, setUvozNormativov] = useState(0);
  const [uvozPodvojeni, setUvozPodvojeni] = useState<"preskoči" | "posodobi">("preskoči");
  const [uvozRezultat, setUvozRezultat] = useState<UvozRezultat | null>(null);
  const uvozFileRef = useRef<HTMLInputElement>(null);

  const resetUvoz = () => {
    setUvozKorak("izbira");
    setUvozDatoteka(null);
    setUvozLoading(false);
    setUvozPredogled([]);
    setUvozNapake([]);
    setUvozSkupaj(0);
    setUvozVeljavnih(0);
    setUvozNormativov(0);
    setUvozPodvojeni("preskoči");
    setUvozRezultat(null);
    if (uvozFileRef.current) uvozFileRef.current.value = "";
  };

  const handleUvozDatoteka = async (file: File) => {
    setUvozDatoteka(file);
    setUvozLoading(true);
    try {
      const fd = new FormData();
      fd.append("excel", file);
      const r = await fetch(`${import.meta.env.BASE_URL}api/artikli/uvozi-excel?dryRun=true`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const data = await r.json() as { napaka?: string; predogled?: UvozPredogled[]; napake?: UvozNapaka[]; skupaj?: number; veljavnih?: number; normativov?: number };
      if (!r.ok) {
        toast({ title: data.napaka ?? "Napaka pri branju datoteke", variant: "destructive" });
        return;
      }
      setUvozPredogled(data.predogled ?? []);
      setUvozNapake(data.napake ?? []);
      setUvozSkupaj(data.skupaj ?? 0);
      setUvozVeljavnih(data.veljavnih ?? 0);
      setUvozNormativov(data.normativov ?? 0);
      setUvozKorak("predogled");
    } catch {
      toast({ title: "Napaka pri branju datoteke", variant: "destructive" });
    } finally {
      setUvozLoading(false);
    }
  };

  const handleUvozPotrdi = async () => {
    setUvozLoading(true);
    try {
      const fd = new FormData();
      fd.append("excel", uvozDatoteka!);
      const r = await fetch(`${import.meta.env.BASE_URL}api/artikli/uvozi-excel?dryRun=false&podvojeni=${uvozPodvojeni}`, {
        method: "POST",
        body: fd,
        credentials: "include",
      });
      const data = await r.json() as { napaka?: string; uvozenih?: number; preskocenih?: number; napake?: UvozNapaka[]; normativiUvozenih?: number };
      if (!r.ok) {
        toast({ title: data.napaka ?? "Napaka pri uvozu", variant: "destructive" });
        return;
      }
      setUvozRezultat({
        uvozenih: data.uvozenih ?? 0,
        preskocenih: data.preskocenih ?? 0,
        napake: data.napake ?? [],
        normativiUvozenih: data.normativiUvozenih ?? 0,
      });
      setUvozKorak("rezultat");
      queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListKategorijeQueryKey() });
    } catch {
      toast({ title: "Napaka pri uvozu", variant: "destructive" });
    } finally {
      setUvozLoading(false);
    }
  };

  // ── Excel izvoz ────────────────────────────────────────────────
  const [izvozLoading, setIzvozLoading] = useState(false);

  const handleIzvozi = async () => {
    setIzvozLoading(true);
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}api/artikli/izvozi-excel`, {
        credentials: "include",
      });
      if (!r.ok) {
        toast({ title: "Napaka pri izvozu", variant: "destructive" });
        return;
      }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "artikli.xlsx";
      a.click();
      URL.revokeObjectURL(url);
    } catch {
      toast({ title: "Napaka pri izvozu", variant: "destructive" });
    } finally {
      setIzvozLoading(false);
    }
  };

  // ── Potrditveni dialog za brisanje sestavine ──────────────────
  const [delConfirmOpen, setDelConfirmOpen] = useState(false);
  const [delConfirmArtikelId, setDelConfirmArtikelId] = useState<number | null>(null);
  const [delConfirmVporabljenaV, setDelConfirmVporabljenaV] = useState<{ id: number; ime: string }[]>([]);
  const [preDelConfirmId, setPreDelConfirmId] = useState<number | null>(null);

  const COLOR_PALETTE = [
    null,
    "#ef4444", "#f97316", "#eab308", "#22c55e",
    "#14b8a6", "#3b82f6", "#8b5cf6", "#ec4899",
    "#64748b", "#84cc16", "#06b6d4", "#f59e0b",
  ];

  // Fetch existing normativi when editing
  const { data: existingNormativi } = useGetArtikelNormativi(editingArt?.id ?? 0);
  const { data: existingArtModSkupine } = useGetArtikelModSkupine(editingArt?.id ?? 0);
  const { data: skupineList } = useListModSkupine();
  const setArtikelModSkupineMutation = useSetArtikelModSkupine();

  useEffect(() => {
    if (!artDialogOpen || artMode !== "uredi") return;
    if (existingNormativi) {
      setNormativItems(existingNormativi.map(n => ({
        vhodniArtikelId: n.vhodniArtikelId,
        kolicina: String(n.kolicina),
        ime: n.vhodniArtikelIme ?? undefined,
      })));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingNormativi, artDialogOpen, editingArt?.id]);

  useEffect(() => {
    if (!artDialogOpen || artMode !== "uredi") return;
    if (existingArtModSkupine) {
      setArtModSkupineIds(existingArtModSkupine.map(s => s.id));
      const allModIds = new Set(existingArtModSkupine.flatMap(s => s.modifikatorji.map(m => m.id)));
      const privMod = (editingArt as typeof editingArt & { privzetiModifikatorji?: number[] })?.privzetiModifikatorji ?? [];
      setArtPrivzetiModGrpIds(privMod.filter(id => allModIds.has(id)));
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingArtModSkupine, artDialogOpen, editingArt?.id]);

  // Scroll selected article into view after dialog closes
  useEffect(() => {
    if (!artDialogOpen && editingArt) {
      setTimeout(() => selectedArtRowRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" }), 50);
    }
  }, [artDialogOpen]);


  // Auto-populate self-normativ when both checkboxes are checked in "nov" mode
  useEffect(() => {
    if (artMode !== "nov" || !artDialogOpen) return;
    if (artProdajniArtikel && artNabavniArtikel) {
      setNormativItems(prev => {
        if (prev.some(n => n.vhodniArtikelId === -1)) return prev;
        return [{ vhodniArtikelId: -1, kolicina: "1" }, ...prev.filter(n => n.vhodniArtikelId !== -1)];
      });
    } else {
      setNormativItems(prev => prev.filter(n => n.vhodniArtikelId !== -1));
    }
  }, [artMode, artDialogOpen, artNabavniArtikel, artProdajniArtikel]);

  // ── Kategorija handlers ──────────────────────────────────────
  const openNewCat = () => {
    setCatMode("nova"); setEditingKat(null);
    setCatName(""); setCatColor("#22c55e"); setCatOrder("0"); setCatTip("none"); setCatDnevnoFiltriranje(false);
    setCatDialogOpen(true);
  };

  const openEditCat = (k: Kategorija) => {
    setCatMode("uredi"); setEditingKat(k);
    setCatName(k.ime); setCatColor(k.barva); setCatOrder(String(k.vrstniRed));
    setCatTip((k.tip as "hrana" | "pijaca") ?? "none");
    setCatDnevnoFiltriranje((k as typeof k & { dnevnoFiltriranje?: boolean }).dnevnoFiltriranje ?? false);
    setCatDialogOpen(true);
  };

  const handleSaveCat = () => {
    if (!catName) return;
    const data = { ime: catName, barva: catColor, vrstniRed: parseInt(catOrder) || 0, tip: catTip === "none" ? null : catTip, dnevnoFiltriranje: catDnevnoFiltriranje };
    if (catMode === "uredi" && editingKat) {
      updateKategorija.mutate({ id: editingKat.id, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListKategorijeQueryKey() });
          setCatDialogOpen(false);
          toast({ title: "Kategorija posodobljena" });
        },
        onError: () => toast({ title: "Napaka", variant: "destructive" }),
      });
    } else {
      createKategorija.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListKategorijeQueryKey() });
          setCatDialogOpen(false);
          toast({ title: "Kategorija dodana" });
        },
        onError: () => toast({ title: "Napaka", variant: "destructive" }),
      });
    }
  };

  const savePriceInline = (a: Artikel) => {
    const newCena = parseFloat(editingPriceVal);
    setEditingPriceId(null);
    if (isNaN(newCena) || newCena === a.cena) return;
    updateArtikel.mutate({ id: a.id, data: {
      ime: a.ime, cena: newCena, davek: a.davek,
      kategorijaId: a.kategorijaId ?? null, aktiven: a.aktiven, barva: a.barva ?? null,
      nabavniArtikel: a.nabavniArtikel ?? false, prodajniArtikel: a.prodajniArtikel ?? true,
      imeZaNabavo: a.imeZaNabavo ?? null, enotaMere: a.enotaMere ?? null,
    }}, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() }),
      onError: () => toast({ title: "Napaka pri shranjevanju cene", variant: "destructive" }),
    });
  };

  const handleDelKat = (id: number) => {
    deleteKategorija.mutate({ id }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListKategorijeQueryKey() }),
    });
  };

  // ── Artikel handlers ─────────────────────────────────────────
  const openNewArt = () => {
    setArtMode("nov"); setEditingArt(null);
    setArtName(""); setArtPrice(""); setArtCat(""); setArtTax(String(ddvStopnje.nizjaSt)); setArtAktiven(true); setArtColor(null);
    setArtNabavniArtikel(false); setArtProdajniArtikel(true); setArtJePica(false);
    setArtPrivzetiModGrpIds([]);
    setArtToGoArtikli([]);
    setArtToGo(false);
    setArtVrstaArtikla("storitev");
    setArtImeZaNabavo(""); setArtEnotaMere(null);
    setNormativItems([]);
    setNormativNapaka(null);
    setArtModSkupineIds([]);
    setArtDialogOpen(true);
  };

  const openEditArt = (a: Artikel) => {
    setArtMode("uredi"); setEditingArt(a);
    setArtName(a.ime); setArtPrice(String(a.cena));
    setArtCat(a.kategorijaId != null ? String(a.kategorijaId) : ""); setArtTax(String(a.davek)); setArtAktiven(a.aktiven);
    setArtColor(a.barva ?? null);
    setArtNabavniArtikel(a.nabavniArtikel ?? false);
    setArtProdajniArtikel(a.prodajniArtikel ?? true);
    setArtJePica(a.jePica ?? false);
    setArtPrivzetiModGrpIds([]);
    setArtToGoArtikli((a as typeof a & { toGoArtikli?: number[] }).toGoArtikli ?? []);
    setArtToGo((a as typeof a & { toGo?: boolean }).toGo ?? false);
    setArtVrstaArtikla(((a as typeof a & { vrstaArtikla?: string }).vrstaArtikla ?? "storitev") as "blago" | "material" | "storitev");
    setArtImeZaNabavo(a.imeZaNabavo ?? "");
    setArtEnotaMere(a.enotaMere ?? null);
    setNormativItems([]);
    setNormativNapaka(null);
    setArtModSkupineIds([]);
    setArtDialogOpen(true);
  };

  const addNormativItem = () => {
    setNormativItems(prev => [...prev, { vhodniArtikelId: 0, kolicina: "" }]);
  };

  const removeNormativItem = (idx: number) => {
    setNormativItems(prev => prev.filter((_, i) => i !== idx));
  };

  const updateNormativItem = (idx: number, field: keyof NormativItem, value: string | number) => {
    setNormativItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, [field]: value } : item
    ));
  };

  const handleSaveArt = () => {
    const isOnlyNabavni = artNabavniArtikel && !artProdajniArtikel;
    if (!artName) return;
    if (!isOnlyNabavni && (!artPrice || !artCat || !artTax)) return;

    // -1 is a self-reference placeholder (replaced with real ID in afterSave)
    const validNormativItems = normativItems
      .filter(n => (n.vhodniArtikelId === -1 || n.vhodniArtikelId > 0) && parseFloat(n.kolicina) > 0)
      .map(n => ({ vhodniArtikelId: n.vhodniArtikelId, kolicina: parseFloat(n.kolicina) }));

    const data = {
      ime: artName,
      cena: isOnlyNabavni ? 0 : parseFloat(artPrice),
      davek: isOnlyNabavni ? 0 : parseFloat(artTax),
      kategorijaId: isOnlyNabavni ? null : (artCat ? parseInt(artCat) : null),
      aktiven: isOnlyNabavni ? false : artAktiven,
      barva: isOnlyNabavni ? null : (artColor ?? null),
      nabavniArtikel: artNabavniArtikel,
      prodajniArtikel: artProdajniArtikel,
      jePica: !isOnlyNabavni ? artJePica : false,
      jeDodatekZaPico: false,
      privzetiDodatki: [],
      jeModifikator: false,
      privzetiModifikatorji: !isOnlyNabavni ? artPrivzetiModGrpIds : [],
      toGoArtikli: !isOnlyNabavni ? artToGoArtikli : [],
      toGo: !isOnlyNabavni ? artToGo : false,
      imeZaNabavo: artNabavniArtikel ? (artImeZaNabavo || null) : null,
      enotaMere: artNabavniArtikel ? (artEnotaMere || null) : null,
      vrstaArtikla: artVrstaArtikla,
    };

    const afterSave = (artikelId: number, label: string) => {
      // Replace self-reference placeholder (-1) with the real article ID
      const normativiToSave = validNormativItems.map(n =>
        n.vhodniArtikelId === -1 ? { ...n, vhodniArtikelId: artikelId } : n
      );
      updateNormativi.mutate({ id: artikelId, data: normativiToSave }, {
        onSuccess: () => {
          if (artProdajniArtikel) {
            setArtikelModSkupineMutation.mutate(
              { id: artikelId, data: { skupineIds: artModSkupineIds } },
              { onError: () => toast({ title: "Napaka pri shranjevanju modifikatorjev", variant: "destructive" }) }
            );
            queryClient.invalidateQueries({ queryKey: getGetArtikelModSkupineQueryKey(artikelId) });
          }
          queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });
          queryClient.invalidateQueries({ queryKey: getGetArtikelNormativiQueryKey(artikelId) });
          setNormativNapaka(null);
          setArtDialogOpen(false);
          toast({ title: label });
        },
        onError: (err) => {
          const apiErr = err as { status?: number; data?: { error?: string; manjkajoceSestavine?: number[] } };
          if (apiErr.status === 422 && apiErr.data?.manjkajoceSestavine?.length) {
            const missingIds = apiErr.data.manjkajoceSestavine;
            const names = missingIds.map(mid => {
              const found = normativItems.find(n => n.vhodniArtikelId === mid);
              return found?.ime ?? `ID ${mid}`;
            });
            setNormativNapaka(`Naslednje sestavine so bile izbrisane: ${names.join(", ")}. Prosimo, zamenjajte ali odstranite te vrstice.`);
          } else {
            toast({ title: "Napaka pri shranjevanju normativa", variant: "destructive" });
          }
        },
      });
    };

    if (artMode === "uredi" && editingArt) {
      updateArtikel.mutate({ id: editingArt.id, data }, {
        onSuccess: () => afterSave(editingArt.id, "Artikel posodobljen"),
        onError: () => toast({ title: "Napaka", variant: "destructive" }),
      });
    } else {
      createArtikel.mutate({ data }, {
        onSuccess: (createdArtikel) => afterSave(createdArtikel.id, "Artikel dodan"),
        onError: () => toast({ title: "Napaka", variant: "destructive" }),
      });
    }
  };

  const handleDelArt = (id: number) => {
    deleteArtikel.mutate({ id }, {
      onSuccess: (data) => {
        queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });
        const resp = data as unknown as { deaktiviran?: boolean } | undefined;
        if (resp?.deaktiviran) {
          toast({ title: "Artikel deaktiviran", description: "Artikel ima zgodovino naročil in ne more biti izbrisan. Skrit je iz menija." });
        } else {
          toast({ title: "Artikel izbrisan" });
        }
      },
      onError: (err) => {
        const apiErr = err as { status?: number; data?: { vpNormativi?: { id: number; ime: string }[] } };
        if (apiErr.status === 409) {
          setDelConfirmArtikelId(id);
          setDelConfirmVporabljenaV(apiErr.data?.vpNormativi ?? []);
          setDelConfirmOpen(true);
        } else {
          toast({ title: "Napaka pri brisanju", variant: "destructive" });
        }
      },
    });
  };

  const closeDelConfirm = () => {
    setDelConfirmOpen(false);
    setDelConfirmArtikelId(null);
    setDelConfirmVporabljenaV([]);
  };

  const handleOpenBlockingArtikel = (artikelId: number) => {
    const art = artikli?.find(a => a.id === artikelId);
    if (art) {
      closeDelConfirm();
      openEditArt(art);
    }
  };

  const isPendingCat = createKategorija.isPending || updateKategorija.isPending;
  const isPendingArt = createArtikel.isPending || updateArtikel.isPending || updateNormativi.isPending;

  return (
    <div className="p-4 sm:p-8 space-y-8 flex-1 overflow-auto">
      <h1 className="text-3xl font-bold tracking-tight">Upravljanje menija</h1>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        {/* ── Kategorije ────────────────────────────────── */}
        <div className="space-y-4">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Kategorije</h2>
            {!jeUporabnik && (
              <Button size="sm" onClick={openNewCat}>
                <Plus className="w-4 h-4 mr-2" />Nova
              </Button>
            )}
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ime</TableHead>
                  <TableHead className="w-8 text-center">Red</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingK ? (
                  <TableRow><TableCell colSpan={3} className="text-center text-muted-foreground py-6">Nalaganje...</TableCell></TableRow>
                ) : kategorije?.map(k => (
                  <TableRow key={k.id}>
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: k.barva }} />
                        {k.ime}
                      </div>
                    </TableCell>
                    <TableCell className="text-center text-muted-foreground text-sm">{k.vrstniRed}</TableCell>
                    <TableCell className="text-right">
                      {!jeUporabnik && (
                        <div className="flex justify-end gap-1">
                          <Button variant="ghost" size="icon" onClick={() => openEditCat(k)}>
                            <Pencil className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="icon" onClick={() => handleDelKat(k.id)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </Card>
        </div>

        {/* ── Artikli ───────────────────────────────────── */}
        <div className="lg:col-span-2 space-y-4 min-w-0">
          <div className="flex justify-between items-center">
            <h2 className="text-xl font-semibold">Artikli</h2>
            {!jeUporabnik && (
              <div className="flex gap-2 flex-wrap justify-end">
                <Button size="sm" variant="outline" onClick={() => setUskladiOpen(true)}>
                  <SlidersHorizontal className="w-4 h-4 mr-2" />Uskladitev stopenj
                </Button>
                <Button size="sm" variant="outline" onClick={handleIzvozi} disabled={izvozLoading}>
                  <FileDown className="w-4 h-4 mr-2" />{izvozLoading ? "Izvažam..." : "Izvozi Excel"}
                </Button>
                <Button size="sm" variant="outline" onClick={() => { resetUvoz(); setUvozOpen(true); }}>
                  <Upload className="w-4 h-4 mr-2" />Uvozi Excel
                </Button>
                <Button size="sm" onClick={openNewArt}>
                  <Plus className="w-4 h-4 mr-2" />Nov artikel
                </Button>
              </div>
            )}
          </div>
          {/* Filter + iskanje */}
          <div className="flex flex-col sm:flex-row gap-2">
            <div className="flex rounded-md border overflow-hidden shrink-0 flex-wrap">
              {(["vsi", "prodajni", "nabavni", "zNormativom", "brezNormativa"] as const).map(f => (
                <button
                  key={f}
                  onClick={() => setArtFilter(f)}
                  className={`px-3 py-1.5 text-sm transition-colors ${artFilter === f ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted"}`}
                >
                  {f === "vsi" ? "Vsi" : f === "prodajni" ? "Prodajni" : f === "nabavni" ? "Nabavni" : f === "zNormativom" ? "Z normativom" : "Brez normativa"}
                </button>
              ))}
            </div>
            <div className="relative flex-1">
              <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
              <KlavijaturaInput
                ref={artSearchRef}
                value={artSearch}
                onChange={setArtSearch}
                placeholder="Iskanje artiklov..."
                naslov="Iskanje"
                className="pl-8 pr-8"
              />
              {artSearch && (
                <button
                  onClick={() => { setArtSearch(""); artSearchRef.current?.focus(); }}
                  className="absolute right-2.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
            </div>
          </div>
          <Card>
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Ime za prodajo</TableHead>
                  <TableHead className="hidden lg:table-cell">Kategorija</TableHead>
                  <TableHead className="hidden xl:table-cell">DDV</TableHead>
                  <TableHead className="text-right">Cena</TableHead>
                  <TableHead className="hidden lg:table-cell text-center">Status</TableHead>
                  <TableHead className="w-24 shrink-0"></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {loadingA ? (
                  <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Nalaganje...</TableCell></TableRow>
                ) : (() => {
                    const q = artSearch.toLowerCase();
                    const filtered = (artikli ?? [])
                      .filter(a => artFilter === "prodajni" ? a.prodajniArtikel : artFilter === "nabavni" ? a.nabavniArtikel : artFilter === "zNormativom" ? a.hasNormativ : artFilter === "brezNormativa" ? !a.hasNormativ : true)
                      .filter(a => !q || a.ime.toLowerCase().includes(q) || (a.imeZaNabavo ?? "").toLowerCase().includes(q))
                      .sort((a, b) => a.ime.localeCompare(b.ime, "sl"));
                    if (!filtered.length) return (
                      <TableRow><TableCell colSpan={6} className="text-center text-muted-foreground py-6">Ni zadetkov</TableCell></TableRow>
                    );
                    return filtered.map(a => (
                  <TableRow
                    key={a.id}
                    ref={a.id === editingArt?.id ? selectedArtRowRef : undefined}
                    className={[!a.aktiven ? "opacity-50" : "", a.id === editingArt?.id ? "bg-muted/60" : ""].join(" ").trim()}
                  >
                    <TableCell className="font-medium">
                      <div className="flex items-center gap-2">
                        {a.barva && <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: a.barva }} />}
                        <div>
                          <div>{a.ime}</div>
                          <div className="flex flex-wrap gap-1 mt-0.5">
                            {a.prodajniArtikel && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4">prodajni</Badge>}
                            {a.nabavniArtikel && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-blue-300 text-blue-700">nabavni</Badge>}
                            {a.hasNormativ && <Badge variant="outline" className="text-[10px] px-1 py-0 h-4 border-amber-400 text-amber-700 bg-amber-50">normativ</Badge>}
                            {(a as typeof a & { modSkupine?: ModSkupinaFull[] }).modSkupine?.map(s => (
                              <Badge key={s.id} variant="outline" className={`text-[10px] px-1 py-0 h-4 ${s.obvezna ? "border-red-300 text-red-700 bg-red-50" : "border-purple-300 text-purple-700 bg-purple-50"}`}>
                                {s.ime}
                              </Badge>
                            ))}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell className="hidden lg:table-cell">
                      <div className="flex items-center gap-1.5">
                        {kategorije?.find(k => k.id === a.kategorijaId) && (
                          <div
                            className="w-2.5 h-2.5 rounded-full shrink-0"
                            style={{ backgroundColor: kategorije.find(k => k.id === a.kategorijaId)!.barva }}
                          />
                        )}
                        {a.kategorijaIme}
                      </div>
                    </TableCell>
                    <TableCell className="hidden xl:table-cell">{a.davek}%</TableCell>
                    <TableCell className="text-right font-bold whitespace-nowrap">
                      {a.prodajniArtikel && editingPriceId === a.id ? (
                        <Input
                          type="number" step="0.01" min="0"
                          value={editingPriceVal}
                          autoFocus
                          className="w-24 text-right h-7 px-1 text-sm"
                          onChange={e => setEditingPriceVal(e.target.value)}
                          onBlur={() => savePriceInline(a)}
                          onKeyDown={e => {
                            if (e.key === "Enter") savePriceInline(a);
                            if (e.key === "Escape") setEditingPriceId(null);
                          }}
                        />
                      ) : (
                        <span
                          className={a.prodajniArtikel && !jeUporabnik ? "cursor-pointer hover:text-primary transition-colors" : ""}
                          title={a.prodajniArtikel && !jeUporabnik ? "Klikni za spremembo cene" : undefined}
                          onClick={() => {
                            if (!a.prodajniArtikel || jeUporabnik) return;
                            setEditingPriceId(a.id);
                            setEditingPriceVal(String(a.cena));
                          }}
                        >
                          {a.cena.toFixed(2)} €
                        </span>
                      )}
                    </TableCell>
                    <TableCell className="hidden lg:table-cell text-center">
                      {!(a.nabavniArtikel && !a.prodajniArtikel) && (
                        a.aktiven
                          ? <Badge className="bg-green-100 text-green-800 border-green-200 text-xs">Aktiven</Badge>
                          : <Badge variant="secondary" className="text-xs">Neaktiven</Badge>
                      )}
                    </TableCell>
                    <TableCell className="pr-4 pl-1 py-2 text-right whitespace-nowrap">
                      {!jeUporabnik && (
                        <div className="flex justify-end gap-0.5">
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={`Uredi artikel ${a.ime}`} onClick={() => openEditArt(a)}>
                            <Pencil className="w-4 h-4 text-muted-foreground" />
                          </Button>
                          <Button variant="ghost" size="sm" className="h-8 w-8 p-0" aria-label={`Izbriši artikel ${a.ime}`} onClick={() => setPreDelConfirmId(a.id)}>
                            <Trash2 className="w-4 h-4 text-destructive" />
                          </Button>
                        </div>
                      )}
                    </TableCell>
                  </TableRow>
                    ));
                  })()}
              </TableBody>
            </Table>
          </Card>
        </div>
      </div>

      {/* ── Modifikatorske skupine ────────────────────────── */}
      <ModifikatorjePanel jeUporabnik={jeUporabnik} />

      {/* ── Kategorija dialog ─────────────────────────────── */}
      <Dialog open={catDialogOpen} onOpenChange={setCatDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{catMode === "uredi" ? "Uredi kategorijo" : "Nova kategorija"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Ime</Label>
              <KlavijaturaInput value={catName} onChange={setCatName} placeholder="Npr. Pijače" naslov="Ime kategorije" />
            </div>
            <div className="space-y-2">
              <Label>Tip kategorije</Label>
              <Select value={catTip} onValueChange={v => setCatTip(v as "hrana" | "pijaca" | "none")}>
                <SelectTrigger><SelectValue placeholder="Neopredeljeno" /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Neopredeljeno</SelectItem>
                  <SelectItem value="hrana">🍽 Hrana</SelectItem>
                  <SelectItem value="pijaca">🥤 Pijača</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Barva</Label>
                <div className="flex items-center gap-2">
                  <Input type="color" value={catColor} onChange={e => setCatColor(e.target.value)} className="w-12 h-10 p-1 cursor-pointer" />
                  <span className="text-sm text-muted-foreground font-mono">{catColor}</span>
                </div>
              </div>
              <div className="space-y-2">
                <Label>Vrstni red</Label>
                <Input type="number" value={catOrder} onChange={e => setCatOrder(e.target.value)} min="0" />
              </div>
            </div>
            <label className="flex items-center gap-3 rounded-lg border p-3 cursor-pointer select-none hover:bg-muted/40 transition-colors">
              <input
                type="checkbox"
                checked={catDnevnoFiltriranje}
                onChange={e => setCatDnevnoFiltriranje(e.target.checked)}
                className="w-4 h-4 accent-primary"
              />
              <div>
                <p className="text-sm font-medium">Dnevno filtriranje modifikatorjev</p>
                <p className="text-xs text-muted-foreground">Artikli te kategorije prikazujejo samo modifikatorje iz dnevnega menija</p>
              </div>
            </label>
            <Button className="w-full" onClick={handleSaveCat} disabled={isPendingCat || !catName}>
              {isPendingCat ? "Shranjujem..." : catMode === "uredi" ? "Posodobi" : "Dodaj kategorijo"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Artikel dialog ────────────────────────────────── */}
      <Dialog open={artDialogOpen} onOpenChange={setArtDialogOpen}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle>{artMode === "uredi" ? "Uredi artikel" : "Nov artikel"}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto">
            <div className="space-y-4 pt-2 pb-2 pr-4">

              {/* Ime za prodajo */}
              <div className="space-y-2">
                <Label>Ime za prodajo</Label>
                <KlavijaturaInput value={artName} onChange={setArtName} placeholder="Npr. Espresso" naslov="Ime artikla" />
              </div>

              {/* Tip artikla */}
              <div className="space-y-2">
                <Label>Tip artikla</Label>
                <div className="flex gap-4 rounded-lg border p-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={artProdajniArtikel}
                      onChange={e => setArtProdajniArtikel(e.target.checked)}
                      className="w-4 h-4 accent-primary"
                    />
                    <span className="text-sm font-medium">Prodajni artikel</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={artNabavniArtikel}
                      onChange={e => {
                        setArtNabavniArtikel(e.target.checked);
                        if (e.target.checked && !artImeZaNabavo) {
                          setArtImeZaNabavo(artName);
                        }
                      }}
                      className="w-4 h-4 accent-primary"
                    />
                    <span className="text-sm font-medium">Nabavni artikel</span>
                  </label>
                </div>
              </div>

              {/* Nabavni podatki (pogojno) */}
              {artNabavniArtikel && (
                <div className="space-y-3 rounded-lg border border-blue-200 bg-blue-50 p-3">
                  <p className="text-sm font-semibold text-blue-800">Podatki za nabavo</p>
                  <div className="space-y-2">
                    <Label>Ime za nabavo</Label>
                    <KlavijaturaInput
                      value={artImeZaNabavo}
                      onChange={setArtImeZaNabavo}
                      placeholder="Npr. Vino belo 0,75l"
                      naslov="Ime za nabavo"
                    />
                  </div>
                  <div className="space-y-2">
                    <Label>Enota mere (Eslog)</Label>
                    <Select value={artEnotaMere ?? ""} onValueChange={v => setArtEnotaMere(v || null)}>
                      <SelectTrigger>
                        <SelectValue placeholder="Izberi enoto mere..." />
                      </SelectTrigger>
                      <SelectContent>
                        {ESLOG_ENOTE.map(e => (
                          <SelectItem key={e.koda} value={e.koda}>{e.ime}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* Kategorija — samo za prodajne artikle */}
              {!(artNabavniArtikel && !artProdajniArtikel) && (
                <div className="space-y-2">
                  <Label>Kategorija</Label>
                  <Select value={artCat} onValueChange={setArtCat}>
                    <SelectTrigger><SelectValue placeholder="Izberi kategorijo..." /></SelectTrigger>
                    <SelectContent>
                      {kategorije?.map(k => (
                        <SelectItem key={k.id} value={k.id.toString()}>
                          <div className="flex items-center gap-2">
                            <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: k.barva }} />
                            {k.ime}
                          </div>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Cena + DDV — samo za prodajne artikle */}
              {!(artNabavniArtikel && !artProdajniArtikel) && (
                <div className="grid grid-cols-2 gap-4">
                  <div className="space-y-2">
                    <Label>Cena (€)</Label>
                    <KlavijaturaInput value={artPrice} onChange={setArtPrice} placeholder="2.50" naslov="Cena (€)" inputMode="decimal" />
                  </div>
                  <div className="space-y-2">
                    <Label>DDV (%)</Label>
                    <Select value={artTax} onValueChange={setArtTax}>
                      <SelectTrigger className={!artTax ? "border-destructive text-muted-foreground" : ""}>
                        <SelectValue placeholder="— izberite stopnjo —" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value={String(ddvStopnje.znizanaSt)}>{ddvStopnje.znizanaSt}% (znižana stopnja)</SelectItem>
                        <SelectItem value={String(ddvStopnje.nizjaSt)}>{ddvStopnje.nizjaSt}% (nižja stopnja)</SelectItem>
                        <SelectItem value={String(ddvStopnje.splosnaSt)}>{ddvStopnje.splosnaSt}% (splošna stopnja)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
              )}

              {/* Je pica — bon za pico */}
              {!(artNabavniArtikel && !artProdajniArtikel) && (
                <div className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
                  <input
                    type="checkbox"
                    id="artJePica"
                    checked={artJePica}
                    onChange={e => setArtJePica(e.target.checked)}
                    className="w-4 h-4 accent-orange-500"
                  />
                  <Label htmlFor="artJePica" className="cursor-pointer flex items-center gap-2">
                    <span>🍕</span>
                    <span>Je pica</span>
                    <span className="text-xs font-normal text-muted-foreground">(omogoča plačilo z bonom za pico)</span>
                  </Label>
                </div>
              )}

              {/* Barva kartice — samo za prodajne artikle */}
              {!(artNabavniArtikel && !artProdajniArtikel) && (
                <div className="space-y-2">
                  <Label>Barva kartice</Label>
                  <div className="flex flex-wrap gap-2">
                    {COLOR_PALETTE.map((c, i) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => setArtColor(c)}
                        className={`w-7 h-7 rounded-full border-2 transition-all ${
                          artColor === c
                            ? "border-primary ring-2 ring-primary ring-offset-1 scale-110"
                            : "border-transparent hover:scale-110"
                        }`}
                        style={{ backgroundColor: c ?? "#e5e7eb" }}
                        title={c ?? "Brez barve"}
                      >
                        {!c && <span className="text-xs text-gray-400 flex items-center justify-center h-full">✕</span>}
                      </button>
                    ))}
                  </div>
                  {artColor && <p className="text-xs text-muted-foreground font-mono">{artColor}</p>}
                </div>
              )}

              {/* Aktiven — samo za prodajne artikle */}
              {!(artNabavniArtikel && !artProdajniArtikel) && (
                <div className="flex items-center gap-3 rounded-lg border p-3">
                  <input
                    type="checkbox"
                    id="artAktiven"
                    checked={artAktiven}
                    onChange={e => setArtAktiven(e.target.checked)}
                    className="w-4 h-4 accent-primary"
                  />
                  <Label htmlFor="artAktiven" className="cursor-pointer">
                    Artikel je aktiven (viden v meniju)
                  </Label>
                </div>
              )}

              {/* Normativ za prodajo */}
              {artProdajniArtikel && (
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <Label className="font-semibold">Normativ za prodajo</Label>
                    <div className="flex gap-2">
                      <Button type="button" size="sm" variant="outline" onClick={() => { setCopyPickerOpen(true); setCopyPickerSearch(""); }}>
                        <Copy className="w-3 h-3 mr-1" />
                        <span className="hidden sm:inline">Kopiraj iz drugega artikla</span>
                        <span className="sm:hidden">Kopiraj</span>
                      </Button>
                      <Button type="button" size="sm" variant="outline" onClick={addNormativItem}>
                        <Plus className="w-3 h-3 mr-1" />Dodaj artikel
                      </Button>
                    </div>
                  </div>
                  {normativItems.length === 0 ? (
                    <p className="text-sm text-muted-foreground">Ni določenih vhodnih artiklov.</p>
                  ) : (
                    <div className="space-y-2">
                      {/* Header */}
                      <div className="grid grid-cols-[1fr_4rem_3.5rem_2rem] gap-1.5 text-xs text-muted-foreground px-1">
                        <span>Vhodni artikel</span>
                        <span>Enota</span>
                        <span>Kol.</span>
                        <span></span>
                      </div>
                      {normativItems.map((item, idx) => {
                        const isSelf = item.vhodniArtikelId === -1;
                        const vhodni = isSelf ? null : artikli?.find(a => a.id === item.vhodniArtikelId);
                        return (
                          <div key={idx} className="grid grid-cols-[1fr_4rem_3.5rem_2rem] gap-1.5 items-center">
                            {isSelf ? (
                              <div className="h-8 flex items-center px-2 rounded-md border bg-blue-50 border-blue-200 text-sm text-blue-800 font-medium">
                                Ta artikel
                              </div>
                            ) : (
                              <Select
                                value={item.vhodniArtikelId ? String(item.vhodniArtikelId) : ""}
                                onValueChange={v => {
                                  const parsed = parseInt(v);
                                  const found = artikli?.find(a => a.id === parsed);
                                  setNormativItems(prev => prev.map((it, i) =>
                                    i === idx ? { ...it, vhodniArtikelId: parsed, ime: found?.ime } : it
                                  ));
                                }}
                              >
                                <SelectTrigger className="h-8 text-sm">
                                  <SelectValue placeholder="Artikel..." />
                                </SelectTrigger>
                                <SelectContent>
                                  {artikli?.filter(a => a.nabavniArtikel).map(a => (
                                    <SelectItem key={a.id} value={String(a.id)}>
                                      {a.ime}
                                      {a.enotaMere && <span className="ml-1 text-muted-foreground">({a.enotaMere})</span>}
                                    </SelectItem>
                                  ))}
                                </SelectContent>
                              </Select>
                            )}
                            <span className="text-sm text-muted-foreground text-center font-mono">
                              {isSelf ? (artEnotaMere ?? "—") : (vhodni?.enotaMere ?? "—")}
                            </span>
                            <Input
                              type="number"
                              step="0.0001"
                              min="0.0001"
                              className="h-8 text-sm text-right"
                              value={item.kolicina}
                              placeholder="0"
                              onChange={e => updateNormativItem(idx, "kolicina", e.target.value)}
                            />
                            <Button
                              type="button"
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8"
                              onClick={() => removeNormativItem(idx)}
                            >
                              <Trash2 className="w-3.5 h-3.5 text-destructive" />
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Vrsta artikla */}
              <div className="space-y-2 rounded-lg border p-3">
                <Label className="font-semibold">Vrsta artikla</Label>
                <div className="flex gap-2">
                  {(["blago", "material", "storitev"] as const).map(vrsta => (
                    <button
                      key={vrsta}
                      type="button"
                      onClick={() => setArtVrstaArtikla(vrsta)}
                      className={`flex-1 py-1.5 px-2 rounded-md text-sm font-medium border transition-colors ${
                        artVrstaArtikla === vrsta
                          ? "bg-primary text-primary-foreground border-primary"
                          : "bg-background border-input hover:bg-muted/70 text-muted-foreground"
                      }`}
                    >
                      {vrsta.charAt(0).toUpperCase() + vrsta.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              {/* Modifikatorske skupine — samo za prodajne artikle */}
              {artProdajniArtikel && (
                <div className="space-y-2 rounded-lg border p-3">
                  <Label className="font-semibold">Modifikatorske skupine</Label>
                  {!skupineList?.length ? (
                    <p className="text-sm text-muted-foreground">
                      Ni definiranih skupin. Dodajte jih v razdelku Modifikatorske skupine.
                    </p>
                  ) : (
                    <div className="space-y-1">
                      {skupineList.map(s => {
                        const checked = artModSkupineIds.includes(s.id);
                        return (
                          <button
                            key={s.id}
                            type="button"
                            onClick={() => {
                              setArtModSkupineIds(prev => checked ? prev.filter(x => x !== s.id) : [...prev, s.id]);
                              if (checked) {
                                const modIds = existingArtModSkupine?.find(g => g.id === s.id)?.modifikatorji.map(m => m.id) ?? [];
                                setArtPrivzetiModGrpIds(prev => prev.filter(id => !modIds.includes(id)));
                              }
                            }}
                            className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors ${checked ? "bg-purple-50 text-purple-900" : "hover:bg-muted/70 text-muted-foreground"}`}
                          >
                            <div className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${checked ? "bg-purple-500 border-purple-500" : "border-muted-foreground/40"}`}>
                              {checked && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
                            </div>
                            <span className="truncate font-medium">{s.ime}</span>
                            {s.obvezna ? (
                              <Badge className="ml-auto bg-red-100 text-red-800 border-red-200 text-[10px] px-1 py-0 h-4 shrink-0">Obvezna</Badge>
                            ) : (
                              <span className="ml-auto text-xs text-muted-foreground shrink-0">{s.maxIzbir > 0 ? `maks ${s.maxIzbir}` : "izbirna"}</span>
                            )}
                          </button>
                        );
                      })}
                    </div>
                  )}
                </div>
              )}

              {/* Privzeti modifikatorji v skupinah */}
              {artProdajniArtikel && (() => {
                const linkedSkupine = (existingArtModSkupine ?? []).filter(s => artModSkupineIds.includes(s.id));
                const vseMod = linkedSkupine.flatMap(s => s.modifikatorji.filter(m => m.aktiven).map(m => ({ ...m, skupinaIme: s.ime })));
                if (vseMod.length === 0) return null;
                return (
                  <div className="rounded-lg border border-blue-200 bg-blue-50 overflow-hidden">
                    <div className="bg-white/70 p-3 space-y-2">
                      <p className="text-xs font-semibold text-blue-800">Privzeti modifikatorji (samodejno prednastavjeni v dialogu)</p>
                      <p className="text-xs text-muted-foreground">Obkljukani modifikatorji bodo ob naročilu artikla že označeni — strežnik jih samo potrdi.</p>
                      <div className="space-y-2">
                        {linkedSkupine.filter(s => artModSkupineIds.includes(s.id)).map(skupina => {
                          const modifikatorji = skupina.modifikatorji.filter(m => m.aktiven);
                          if (modifikatorji.length === 0) return null;
                          return (
                            <div key={skupina.id}>
                              <p className="text-[11px] font-semibold text-blue-700 mb-1">{skupina.ime}</p>
                              <div className="grid grid-cols-2 gap-1">
                                {modifikatorji.map(m => {
                                  const checked = artPrivzetiModGrpIds.includes(m.id);
                                  return (
                                    <button
                                      key={m.id}
                                      type="button"
                                      className={`flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors ${checked ? "bg-blue-100 text-blue-900" : "hover:bg-blue-50/80 text-muted-foreground"}`}
                                      onClick={() => setArtPrivzetiModGrpIds(prev => checked ? prev.filter(x => x !== m.id) : [...prev, m.id])}
                                    >
                                      <div className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${checked ? "bg-blue-500 border-blue-500" : "border-muted-foreground/40"}`}>
                                        {checked && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
                                      </div>
                                      <span className="truncate">{m.ime}</span>
                                      {Number(m.cenaDodatek) !== 0 && (
                                        <span className="ml-auto text-[10px] text-muted-foreground shrink-0">+{Number(m.cenaDodatek).toFixed(2)} €</span>
                                      )}
                                    </button>
                                  );
                                })}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                      {artModSkupineIds.some(id => !(existingArtModSkupine ?? []).find(s => s.id === id)) && (
                        <p className="text-[11px] text-muted-foreground italic">Za novo dodane skupine najprej shranite artikel, nato znova uredite privzete.</p>
                      )}
                    </div>
                  </div>
                );
              })()}

              {/* To Go — samo za prodajne artikle */}
              {artProdajniArtikel && (
                <div className="space-y-2 rounded-lg border p-3">
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="h-4 w-4 text-orange-500" />
                    <Label className="font-semibold">To Go</Label>
                  </div>
                  <button
                    type="button"
                    onClick={() => setArtToGo(v => !v)}
                    className={`w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-left text-sm transition-colors ${artToGo ? "bg-orange-50 text-orange-900" : "hover:bg-muted/70 text-muted-foreground"}`}
                  >
                    <div className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${artToGo ? "bg-orange-500 border-orange-500" : "border-muted-foreground/40"}`}>
                      {artToGo && <span className="text-white text-[9px] font-bold leading-none">✓</span>}
                    </div>
                    <span className="font-medium">To Go artikel</span>
                    <span className="ml-auto text-xs text-muted-foreground">{artToGo ? "Prikazuje To Go gumb v naročilu" : "Brez To Go gumba"}</span>
                  </button>
                  {artToGo && (
                    <>
                      <p className="text-xs text-muted-foreground">Embalaža: artikli, ki se samodejno dodajo k naročilu ob kliku na To Go gumb.</p>
                  {artToGoArtikli.length > 0 && (
                    <div className="space-y-1">
                      {artToGoArtikli.map((toGoId) => {
                        const toGoArt = (artikli ?? []).find(a => a.id === toGoId);
                        return (
                          <div key={toGoId} className="flex items-center gap-2 px-2 py-1.5 rounded-md bg-orange-50 border border-orange-100">
                            <ShoppingBag className="h-3.5 w-3.5 text-orange-400 shrink-0" />
                            <span className="text-sm flex-1 truncate">{toGoArt?.ime ?? `Artikel #${toGoId}`}</span>
                            <button
                              type="button"
                              onClick={() => setArtToGoArtikli(prev => prev.filter(id => id !== toGoId))}
                              className="h-5 w-5 flex items-center justify-center rounded hover:bg-orange-100 text-orange-400 hover:text-destructive transition-colors"
                            >
                              <X className="h-3 w-3" />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <Select
                    value=""
                    onValueChange={(val) => {
                      const id = parseInt(val);
                      if (!artToGoArtikli.includes(id)) setArtToGoArtikli(prev => [...prev, id]);
                    }}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Dodaj artikel za To Go..." />
                    </SelectTrigger>
                    <SelectContent>
                      {(artikli ?? [])
                        .filter(a => a.aktiven && a.prodajniArtikel && !artToGoArtikli.includes(a.id))
                        .map(a => (
                          <SelectItem key={a.id} value={String(a.id)}>{a.ime}</SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                    </>
                  )}
                </div>
              )}

            </div>
          </div>

          <div className="pt-3 border-t space-y-2">
            {normativNapaka && (
              <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>{normativNapaka}</span>
              </div>
            )}
            <Button className="w-full" onClick={handleSaveArt} disabled={isPendingArt || !artName || (!(artNabavniArtikel && !artProdajniArtikel) && (!artPrice || !artCat))}>
              {isPendingArt ? "Shranjujem..." : artMode === "uredi" ? "Posodobi" : "Dodaj artikel"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      {/* ── Kopiraj normativ – picker dialog ──────────────────── */}
      <Dialog open={copyPickerOpen} onOpenChange={open => { if (!open) { setCopyPickerOpen(false); setCopyPickerSearch(""); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Kopiraj normativ iz artikla</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <p className="text-sm text-muted-foreground">
              Izberite artikel, katerega normativ želite kopirati. Obstoječe vrstice bodo zamenjane.
            </p>
            <div className="relative">
              <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Iskanje artikla..."
                className="pl-8"
                value={copyPickerSearch}
                onChange={e => setCopyPickerSearch(e.target.value)}
                autoFocus
              />
            </div>
            <ScrollArea className="h-64">
              <div className="space-y-1 pr-2">
                {(() => {
                  const search = copyPickerSearch.toLowerCase();
                  const all = (artikli ?? []).filter(a =>
                    a.prodajniArtikel &&
                    a.id !== editingArt?.id &&
                    a.ime.toLowerCase().includes(search)
                  );
                  const withNormativ = all.filter(a => a.hasNormativ);
                  const withoutNormativ = all.filter(a => !a.hasNormativ);
                  const candidates = [...withNormativ, ...withoutNormativ];
                  if (candidates.length === 0) {
                    return <p className="text-sm text-muted-foreground text-center py-6">Ni rezultatov.</p>;
                  }
                  return candidates.map(a => (
                    <button
                      key={a.id}
                      type="button"
                      disabled={copyPickerLoading || !a.hasNormativ}
                      onClick={() => a.hasNormativ && handleCopyFromArtikel(a.id)}
                      className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors flex items-center justify-between gap-2 ${
                        a.hasNormativ
                          ? "hover:bg-accent hover:text-accent-foreground disabled:opacity-50"
                          : "opacity-40 cursor-not-allowed"
                      }`}
                    >
                      <span className="flex items-center gap-2 min-w-0">
                        <span className={`font-medium truncate ${!a.hasNormativ ? "text-muted-foreground" : ""}`}>{a.ime}</span>
                        {a.kategorijaId && kategorije && (
                          <span className="text-xs text-muted-foreground shrink-0">
                            {kategorije.find(k => k.id === a.kategorijaId)?.ime}
                          </span>
                        )}
                      </span>
                      {a.hasNormativ && (
                        <span className="shrink-0 inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-medium text-green-700">
                          normativ
                        </span>
                      )}
                    </button>
                  ));
                })()}
              </div>
            </ScrollArea>
          </div>
        </DialogContent>
      </Dialog>
      {/* ── Uskladitev DDV stopenj dialog ─────────────────────── */}
      <Dialog open={uskladiOpen} onOpenChange={open => !uskladiLoading && setUskladiOpen(open)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <SlidersHorizontal className="w-5 h-5" />Uskladitev DDV stopenj
            </DialogTitle>
            <DialogDescription>
              Vsi artikli bodo posodobljeni na najbližjo nastavljeno DDV stopnjo.
              Artikli z 0 % DDV ostanejo nespremenjeni.
            </DialogDescription>
          </DialogHeader>
          <div className="rounded-lg border bg-muted/40 p-4 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Splošna stopnja</span>
              <span className="font-medium">{ddvStopnje.splosnaSt} %</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Nižja stopnja</span>
              <span className="font-medium">{ddvStopnje.nizjaSt} %</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Znižana stopnja</span>
              <span className="font-medium">{ddvStopnje.znizanaSt} %</span>
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setUskladiOpen(false)} disabled={uskladiLoading}>
              Prekliči
            </Button>
            <Button onClick={() => void handleUskladiDdv()} disabled={uskladiLoading}>
              {uskladiLoading ? "Usklajujem…" : "Potrdi uskladitev"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Excel uvoz dialog ─────────────────────────────────── */}
      <Dialog open={uvozOpen} onOpenChange={open => { if (!open) { resetUvoz(); setUvozOpen(false); } else setUvozOpen(true); }}>
        <DialogContent className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[90vh] flex flex-col overflow-hidden">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileUp className="w-5 h-5" />
              {uvozKorak === "izbira" && "Uvoz artiklov iz Excela"}
              {uvozKorak === "predogled" && "Predogled uvoza"}
              {uvozKorak === "rezultat" && "Rezultat uvoza"}
            </DialogTitle>
          </DialogHeader>

          <div className="flex-1 min-h-0 overflow-y-auto pr-1">

            {/* ── Korak 1: Izbira datoteke ── */}
            {uvozKorak === "izbira" && (
              <div className="space-y-5 pt-2 pb-2">
                <div className="rounded-lg border-2 border-dashed border-muted-foreground/30 p-6 text-center space-y-3">
                  <Upload className="w-10 h-10 mx-auto text-muted-foreground/50" />
                  <div>
                    <p className="text-sm font-medium">Izberite Excel datoteko (.xlsx)</p>
                    <p className="text-xs text-muted-foreground mt-1">
                      List <strong>Artikli</strong> — obvezni stolpci:{" "}
                      <code className="font-mono bg-muted px-1 rounded">ime</code>,{" "}
                      <code className="font-mono bg-muted px-1 rounded">cena</code>,{" "}
                      <code className="font-mono bg-muted px-1 rounded">ddv</code>{" "}
                      + opcijsko: kategorija, barva, aktiven, nabavniArtikel, prodajniArtikel, imeZaNabavo, enotaMere
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      List <strong>Normativi</strong> (opcijsko) — stolpci: artikelIme, sestavinaIme, kolicina, enotaMere
                    </p>
                    <p className="text-xs text-muted-foreground mt-0.5">
                      Veljavne DDV stopnje: <strong>0</strong>, <strong>{ddvStopnje.znizanaSt}</strong>, <strong>{ddvStopnje.nizjaSt}</strong>, <strong>{ddvStopnje.splosnaSt}</strong>
                    </p>
                  </div>
                  <Button size="sm" onClick={() => uvozFileRef.current?.click()} disabled={uvozLoading}>
                    {uvozLoading ? "Berem..." : "Izberi datoteko"}
                  </Button>
                  <input
                    ref={uvozFileRef}
                    type="file"
                    accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
                    className="hidden"
                    onChange={e => {
                      const f = e.target.files?.[0];
                      if (f) void handleUvozDatoteka(f);
                    }}
                  />
                </div>

                <div className="rounded-lg bg-muted/50 p-4 space-y-2">
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Nasvet</p>
                  <p className="text-xs text-muted-foreground">
                    Za pripravo predloge najprej uporabite <strong>Izvozi Excel</strong> — izvoz vsebuje vse obstoječe
                    artikle in normative v pravilni strukturi, ki jo lahko uredite in uvozite nazaj.
                  </p>
                </div>
              </div>
            )}

            {/* ── Korak 2: Predogled ── */}
            {uvozKorak === "predogled" && (
              <div className="space-y-4 pt-2 pb-2">
                {/* Statistike */}
                <div className="flex flex-wrap gap-2">
                  <div className="flex items-center gap-1.5 rounded-full bg-blue-50 border border-blue-200 px-3 py-1 text-xs font-medium text-blue-800">
                    Skupaj vrstic: <strong>{uvozSkupaj}</strong>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-full bg-green-50 border border-green-200 px-3 py-1 text-xs font-medium text-green-800">
                    <CheckCircle2 className="w-3.5 h-3.5" />Veljavnih: <strong>{uvozVeljavnih}</strong>
                  </div>
                  {uvozNormativov > 0 && (
                    <div className="flex items-center gap-1.5 rounded-full bg-purple-50 border border-purple-200 px-3 py-1 text-xs font-medium text-purple-800">
                      Normativov: <strong>{uvozNormativov}</strong>
                    </div>
                  )}
                  {uvozNapake.length > 0 && (
                    <div className="flex items-center gap-1.5 rounded-full bg-red-50 border border-red-200 px-3 py-1 text-xs font-medium text-red-800">
                      <AlertCircle className="w-3.5 h-3.5" />Napak: <strong>{uvozNapake.length}</strong>
                    </div>
                  )}
                </div>

                {/* Predogled tabele */}
                {uvozPredogled.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                      Predogled{uvozPredogled.length < uvozVeljavnih ? ` (prvih ${uvozPredogled.length} od ${uvozVeljavnih})` : ""}
                    </p>
                    <div className="rounded-lg border overflow-hidden">
                      <table className="w-full text-sm">
                        <thead className="bg-muted/50">
                          <tr>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground">Ime</th>
                            <th className="text-right px-3 py-2 font-medium text-muted-foreground">Cena</th>
                            <th className="text-right px-3 py-2 font-medium text-muted-foreground">DDV</th>
                            <th className="text-left px-3 py-2 font-medium text-muted-foreground hidden sm:table-cell">Kategorija</th>
                          </tr>
                        </thead>
                        <tbody>
                          {uvozPredogled.map((r, i) => (
                            <tr key={i} className="border-t">
                              <td className="px-3 py-2">{r.ime}</td>
                              <td className="px-3 py-2 text-right font-mono">{r.cena.toFixed(2)} €</td>
                              <td className="px-3 py-2 text-right font-mono">{r.ddv}%</td>
                              <td className="px-3 py-2 text-muted-foreground hidden sm:table-cell">{r.kategorija ?? "—"}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}

                {/* Napake */}
                {uvozNapake.length > 0 && (
                  <div className="space-y-1.5">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Napake pri razčlenjevanju</p>
                    <div className="rounded-lg border border-red-200 bg-red-50 divide-y divide-red-100 max-h-40 overflow-y-auto">
                      {uvozNapake.map((n, i) => (
                        <div key={i} className="px-3 py-1.5 flex gap-2 text-xs text-red-800">
                          <span className="font-mono shrink-0">Vrstica {n.vrstica}:</span>
                          <span>{n.napaka}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Možnosti za podvojene */}
                {uvozVeljavnih > 0 && (
                  <div className="space-y-2 rounded-lg border p-3">
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Podvojeni artikli</p>
                    <div className="flex flex-col gap-2">
                      {(["preskoči", "posodobi"] as const).map(v => (
                        <label key={v} className="flex items-start gap-2.5 cursor-pointer">
                          <input
                            type="radio"
                            name="podvojeni"
                            value={v}
                            checked={uvozPodvojeni === v}
                            onChange={() => setUvozPodvojeni(v)}
                            className="mt-0.5 accent-primary"
                          />
                          <div>
                            <span className="text-sm font-medium">
                              {v === "preskoči" ? "Preskoči obstoječe" : "Posodobi ceno in DDV"}
                            </span>
                            <p className="text-xs text-muted-foreground">
                              {v === "preskoči"
                                ? "Artikli z enakim imenom ne bodo uvoženi (dodani med napake)."
                                : "Artikli z enakim imenom bodo posodobljeni s podatki iz Excela."}
                            </p>
                          </div>
                        </label>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* ── Korak 3: Rezultat ── */}
            {uvozKorak === "rezultat" && uvozRezultat && (
              <div className="space-y-4 pt-2 pb-2">
                <div className="flex flex-col gap-3">
                  <div className="flex items-center gap-3 rounded-lg bg-green-50 border border-green-200 p-4">
                    <CheckCircle2 className="w-8 h-8 text-green-600 shrink-0" />
                    <div>
                      <p className="font-semibold text-green-900">Uvoz zaključen</p>
                      <p className="text-sm text-green-800 mt-0.5">
                        Uvoženih: <strong>{uvozRezultat.uvozenih}</strong> artiklov
                        {uvozRezultat.preskocenih > 0 && `, preskočenih: ${uvozRezultat.preskocenih}`}
                        {uvozRezultat.normativiUvozenih > 0 && `, normativov nastavljenih: ${uvozRezultat.normativiUvozenih}`}
                      </p>
                    </div>
                  </div>
                  {uvozRezultat.napake.length > 0 && (
                    <div className="space-y-1.5">
                      <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Napake pri uvozu</p>
                      <div className="rounded-lg border border-red-200 bg-red-50 divide-y divide-red-100 max-h-52 overflow-y-auto">
                        {uvozRezultat.napake.map((n, i) => (
                          <div key={i} className="px-3 py-1.5 flex gap-2 text-xs text-red-800">
                            <span className="font-mono shrink-0">Vrstica {n.vrstica}:</span>
                            <span>{n.napaka}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

          </div>

          <div className="pt-3 border-t flex gap-2">
            {uvozKorak === "izbira" && (
              <Button variant="outline" className="flex-1" onClick={() => { resetUvoz(); setUvozOpen(false); }}>
                Prekliči
              </Button>
            )}
            {uvozKorak === "predogled" && (
              <>
                <Button variant="outline" className="flex-1" onClick={resetUvoz} disabled={uvozLoading}>
                  ← Nazaj
                </Button>
                <Button
                  className="flex-1"
                  onClick={handleUvozPotrdi}
                  disabled={uvozLoading || uvozVeljavnih === 0}
                >
                  {uvozLoading ? "Uvažam..." : `Uvozi ${uvozVeljavnih} artiklov`}
                </Button>
              </>
            )}
            {uvozKorak === "rezultat" && (
              <Button className="flex-1" onClick={() => { resetUvoz(); setUvozOpen(false); }}>
                Zapri
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: potrditev brisanja artikla ─────────────────── */}
      <Dialog open={preDelConfirmId !== null} onOpenChange={open => { if (!open) setPreDelConfirmId(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Izbriši artikel</DialogTitle>
            <DialogDescription>
              {preDelConfirmId !== null && (() => {
                const art = artikli?.find(a => a.id === preDelConfirmId);
                return art ? `Ali ste prepričani, da želite izbrisati "${art.ime}"?` : "Ali ste prepričani, da želite izbrisati ta artikel?";
              })()}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2 pt-2">
            <Button variant="outline" onClick={() => setPreDelConfirmId(null)}>Prekliči</Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (preDelConfirmId !== null) {
                  handleDelArt(preDelConfirmId);
                  setPreDelConfirmId(null);
                }
              }}
            >
              Izbriši
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: sestavina v uporabi v normativih ──────────── */}
      <Dialog open={delConfirmOpen} onOpenChange={open => { if (!open) closeDelConfirm(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Artikel je v uporabi</DialogTitle>
          </DialogHeader>
          <div className="space-y-3 pt-1">
            <p className="text-sm text-muted-foreground">
              Tega artikla ni mogoče izbrisati, ker je naveden kot sestavina v normativu naslednjih artiklov:
            </p>
            <ul className="space-y-1.5">
              {delConfirmVporabljenaV.map(a => (
                <li key={a.id}>
                  <button
                    type="button"
                    onClick={() => handleOpenBlockingArtikel(a.id)}
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium text-left hover:bg-accent hover:text-accent-foreground transition-colors"
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-destructive shrink-0" />
                    <span className="flex-1">{a.ime}</span>
                    <span className="text-xs text-muted-foreground">Odpri normativ →</span>
                  </button>
                </li>
              ))}
            </ul>
            <p className="text-sm text-muted-foreground">
              Najprej odprite normativ posameznega artikla, odstranite to sestavino in shranite. Nato bo brisanje mogoče.
            </p>
            <div className="pt-1">
              <Button variant="outline" className="w-full" onClick={closeDelConfirm}>
                Zapri
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
