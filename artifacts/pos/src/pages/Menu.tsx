import { useState, useEffect, useRef } from "react";
import { trackEvent } from "@/lib/analytics";
import { useF2Save } from "@/hooks/useF2Save";
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
  useGetArtikelNormativeChangeHistory,
  useUpdateArtikelNormativi,
  useListModSkupine,
  useGetArtikelModSkupine,
  useSetArtikelModSkupine,
  useGenerateArtikelImage,
  useUploadArtikelImage,
  getListKategorijeQueryKey,
  getListArtikliQueryKey,
  getGetArtikelNormativiQueryKey,
  getGetArtikelNormativeChangeHistoryQueryKey,
  getGetArtikelModSkupineQueryKey,
  getGetArtikelAlergeniNormativQueryKey,
  getGetPreparedFoodAvailabilityQueryKey,
  getArtikliCenikPdf,
  ApiError,
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DecimalInput, parseDecimal } from "@/components/ui/decimal-input";
import { KlavijaturaInput } from "@/components/KlavijaturaInput";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, Search, X, Copy, Upload, FileUp, FileDown, AlertCircle, CheckCircle2, SlidersHorizontal, ShoppingBag, ImageIcon, Sparkles, Menu as MenuIcon, PackageOpen, ChevronRight, ChevronDown, Check, History, RotateCcw } from "lucide-react";
import type { Kategorija, Artikel, ModSkupinaFull } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { useNastavitve } from "@/contexts/NastavitveContext";
import ModifikatorjePanel from "@/components/ModifikatorjePanel";
import { ArticleImageCropDialog } from "@/components/ArticleImageCropDialog";

import { type NormativItem } from "@/lib/kopiraj-normativ";
type PizzaDoughSelection = { normalna: number; mala: number };
import { requiresClassicNormativ } from "@/lib/multicourse-menu-validation";
import { useKopirajNormativ } from "@/hooks/useKopirajNormativ";
import {
  DEFAULT_NEW_PURCHASE_ARTICLE_TYPE,
  DEFAULT_NEW_SALES_ARTICLE_TYPE,
} from "@/lib/article-type-defaults";
import { AlergenEditor, AlergeniBadge, type AlergenSnapshot } from "@/components/AlergenEditor";
import { MulticourseMenuEditor } from "@/components/MulticourseMenuEditor";
import { NormativeProposalReview } from "@/components/NormativeProposalReview";
import { NormativeChangeHistoryPanel } from "@/components/NormativeChangeHistoryPanel";
import { getNormativStaleMessage, NormativSaveAlert } from "@/components/NormativSaveAlert";
import { clearProposalDraft, readProposalDraft, type NormativeProposalDraft } from "@/lib/normative-proposal-draft";
import { posFetch } from "@/lib/pos-auth-headers";
import {
  canEditNormativ,
  canUseAsNormativInput,
  normativSectionTitle,
} from "@/lib/normativ-eligibility";
import {
  articleMatchesListFilter,
  type ArticleListFilter,
} from "@/lib/article-list-filter";
import {
  type AlergenPovzetek,
  usePreviewArtikelAlergeniNormativ,
} from "@workspace/api-client-react";
import { SmartNormativeProposalDialog } from "@/components/SmartNormativeProposalDialog";
import { EslogUnitPicker } from "@/components/EslogUnitPicker";
import { isGroupablePurchaseUnit } from "@/lib/skupinski-nabavni-artikel";

type KategorijaDialogMode = "nova" | "uredi";
type ArtDialogMode = "nov" | "uredi";

const PRIVZETI_CAS_PRIPRAVE_PICE_MIN = 5;

export default function Menu() {
  const { user } = useAuth();
  const jeUporabnik = user?.vloga === "uporabnik";
  const lahkoVidiZgodovinoNormativa = ["admin", "admin_enote", "superadmin"].includes(user?.vloga ?? "");

  const { data: kategorije, isLoading: loadingK } = useListKategorije();
  const { data: artikli, isLoading: loadingA } = useListArtikli();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { nastavitve } = useNastavitve();
  const picaMalaAktivna = Number((nastavitve as { picaPremerMala?: number } | undefined)?.picaPremerMala ?? 0) > 0;
  const picaDruzinskaAktivna = Number((nastavitve as { picaPremerDruzinska?: number } | undefined)?.picaPremerDruzinska ?? 0) > 0;
  const piceOmogocene = Boolean(
    picaMalaAktivna ||
    Number((nastavitve as { picaPremerNormalna?: number } | undefined)?.picaPremerNormalna ?? 0) > 0 ||
    picaDruzinskaAktivna,
  );

  const createKategorija = useCreateKategorija();
  const deleteKategorija = useDeleteKategorija();
  const updateKategorija = useUpdateKategorija();
  const createArtikel = useCreateArtikel();
  const deleteArtikel = useDeleteArtikel();
  const updateArtikel = useUpdateArtikel();
  const updateNormativi = useUpdateArtikelNormativi();
  const generateArtikelImage = useGenerateArtikelImage();
  const uploadArtikelImage = useUploadArtikelImage();

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
  const [artDialogTab, setArtDialogTab] = useState("osnovno");
  const [artMode, setArtMode] = useState<ArtDialogMode>("nov");
  const [editingArt, setEditingArt] = useState<Artikel | null>(null);
  const [multicourseEditorEnabled, setMulticourseEditorEnabled] = useState(false);
  const [artName, setArtName] = useState("");
  const [artPrice, setArtPrice] = useState("");
  const [artCenaMala, setArtCenaMala] = useState("");
  const [artCenaDruzinska, setArtCenaDruzinska] = useState("");
  const [artCat, setArtCat] = useState("");
  const [artAktiven, setArtAktiven] = useState(true);
  const [artColor, setArtColor] = useState<string | null>(null);
  const [artNabavniArtikel, setArtNabavniArtikel] = useState(false);
  const [artProdajniArtikel, setArtProdajniArtikel] = useState(true);
  const [artPovratnaEmbalaza, setArtPovratnaEmbalaza] = useState(false);
  const [artVrstaEmbalaze, setArtVrstaEmbalaze] = useState<"steklenica" | "zaboj" | "keg" | "balon" | "drugo">("steklenica");
  const [artDepozitnaVrednost, setArtDepozitnaVrednost] = useState("0");
  const [artJePica, setArtJePica] = useState(false);
  const [artImeZaNabavo, setArtImeZaNabavo] = useState("");
  const [artEnotaMere, setArtEnotaMere] = useState<string | null>(null);
  const [eslogUnitPickerOpen, setEslogUnitPickerOpen] = useState(false);
  const [artJeSkupinskiNabavniArtikel, setArtJeSkupinskiNabavniArtikel] = useState(false);
  const lahkoJeSkupinskiNabavniArtikel = artNabavniArtikel && !artProdajniArtikel && isGroupablePurchaseUnit(artEnotaMere);
  const [normativItems, setNormativItems] = useState<NormativItem[]>([]);
  const [pizzaDoughSelection, setPizzaDoughSelection] = useState<PizzaDoughSelection | null>(null);
  const [pizzaDoughSaved, setPizzaDoughSaved] = useState<PizzaDoughSelection | null>(null);
  const [pizzaDoughSaving, setPizzaDoughSaving] = useState(false);
  const [normativExpectedRevision, setNormativExpectedRevision] = useState<number | null>(null);
  const [normativStale, setNormativStale] = useState(false);
  const [proposalDraft, setProposalDraft] = useState<NormativeProposalDraft | null>(null);
  const [proposalConfirmations, setProposalConfirmations] = useState<Set<string>>(new Set());
  const [proposalApplying, setProposalApplying] = useState(false);
  const [proposalStaleMessage, setProposalStaleMessage] = useState<string | null>(null);
  const [normativNapaka, setNormativNapaka] = useState<string | null>(null);
  const [normativDropdownIdx, setNormativDropdownIdx] = useState<number | null>(null);
  const [normativDropdownFilter, setNormativDropdownFilter] = useState("");
  const [normativDropdownHighlight, setNormativDropdownHighlight] = useState(0);
  const [normativDropdownPos, setNormativDropdownPos] = useState<{ top: number; left: number; width: number } | null>(null);
  const [smartProposalDialogOpen, setSmartProposalDialogOpen] = useState(false);
  const artDialogRef = useRef<HTMLDivElement>(null);
  const artDialogBodyRef = useRef<HTMLDivElement>(null);
  const normativArtInputRefs = useRef(new Map<number, HTMLInputElement>());
  const normativKolicinaRefs = useRef(new Map<number, HTMLInputElement>());
  const [artModSkupineIds, setArtModSkupineIds] = useState<number[]>([]);
  const [artPrivzetiModGrpIds, setArtPrivzetiModGrpIds] = useState<number[]>([]);
  const [artToGoArtikli, setArtToGoArtikli] = useState<number[]>([]);
  const [artToGo, setArtToGo] = useState(false);
  const [artHappyHourCena, setArtHappyHourCena] = useState<string>("");
  const [artHappyHourCenaMala, setArtHappyHourCenaMala] = useState<string>("");
  const [artHappyHourCenaDruzinska, setArtHappyHourCenaDruzinska] = useState<string>("");
  const [artVrstaArtikla, setArtVrstaArtikla] = useState<"blago" | "material" | "storitev">(DEFAULT_NEW_SALES_ARTICLE_TYPE);
  const [artMealType, setArtMealType] = useState<"ala_carte" | "prepared" | "composite">("ala_carte");
  const [artCasPripraveMin, setArtCasPripraveMin] = useState("0");
  const [artSkupina, setArtSkupina] = useState<string>("");
  const [artTaxCategory, setArtTaxCategory] = useState<"food" | "hot_beverage" | "cold_beverage" | "alcoholic" | "food_drink" | "vat_super_reduced_5" | "other">("food");
  const [artJeDelMenija, setArtJeDelMenija] = useState(false);
  const artLahkoJeDelMenija = artTaxCategory === "hot_beverage" || artTaxCategory === "cold_beverage";
  const [artAddedSugar, setArtAddedSugar] = useState(false);
  const [artOpisSlike, setArtOpisSlike] = useState("");
  const [artOpisSlikeTouched, setArtOpisSlikeTouched] = useState(false);
  const [artSlikaUrl, setArtSlikaUrl] = useState<string | null>(null);
  const [artImageError, setArtImageError] = useState<string | null>(null);
  const artImageInputRef = useRef<HTMLInputElement>(null);
  const selectingArticleImageRef = useRef(false);
  const [croppingArticleImage, setCroppingArticleImage] = useState<File | null>(null);
  const [artImageEditPrompt, setArtImageEditPrompt] = useState("");
  const [artImageAltText, setArtImageAltText] = useState("");
  const [artImageVersions, setArtImageVersions] = useState<Array<{ id: number; slikaUrl: string; altText: string | null; source: string; isCurrent: boolean; createdAt: string }>>([]);
  const [imageHistoryOpen, setImageHistoryOpen] = useState(false);
  const [imageActionLoading, setImageActionLoading] = useState(false);

  const [artAlergeni, setArtAlergeni] = useState<AlergenSnapshot>({
    alergeni: [],
    alergeniSledi: [],
    alergeniStatus: "nepreverjeno",
    alergeniVir: null,
    alergeniOpombaVira: null,
    alergeniDocumentId: null,
  });

  const [ddvStopnje, setDdvStopnje] = useState({ splosnaSt: 22, nizjaSt: 9.5, znizanaSt: 5 });

  /**
   * Izpeljana pričakovana nabavna DDV stopnja (dobaviteljeva stran = dobava blaga).
   * Nabava blaga je vedno obravnavana kot dobava blaga, zato addedSugar vpliva na stopnjo.
   * hot/cold_beverage brez sladkorja → nižja st. (9,5 %); z sladkorjem → splošna (22 %)
   */
  const pricakovanaNabavnaDdv = (cat: typeof artTaxCategory, addedSugar: boolean, stopnje = ddvStopnje): number => {
    switch (cat) {
      case "food":         return stopnje.nizjaSt;
      case "food_drink":   return stopnje.nizjaSt;
      case "hot_beverage": return addedSugar ? stopnje.splosnaSt : stopnje.nizjaSt;
      case "cold_beverage":return addedSugar ? stopnje.splosnaSt : stopnje.nizjaSt;
      case "alcoholic":    return stopnje.splosnaSt;
      case "vat_super_reduced_5": return stopnje.znizanaSt;
      case "other":        return stopnje.splosnaSt;
      default:             return stopnje.nizjaSt;
    }
  };

  /**
   * Prodajna DDV stopnja pri mizi (eat_in) — privzeta prodajno stran.
   * addedSugar ne vpliva na eat_in (pijače pri mizi so vedno 22 %).
   * To je vrednost, ki se shrani v artikel.davek in jo POS bere pri prodaji.
   */
  const prodajnaDefaultDdv = (cat: typeof artTaxCategory, stopnje = ddvStopnje): number => {
    switch (cat) {
      case "food":          return stopnje.nizjaSt;
      case "food_drink":    return stopnje.nizjaSt;
      case "hot_beverage":  return stopnje.splosnaSt;   // eat_in vedno 22 %
      case "cold_beverage": return stopnje.splosnaSt;   // eat_in vedno 22 %
      case "alcoholic":     return stopnje.splosnaSt;
      case "vat_super_reduced_5": return stopnje.znizanaSt;
      case "other":         return stopnje.splosnaSt;
      default:              return stopnje.nizjaSt;
    }
  };
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

  const [artFilter, setArtFilter] = useState<ArticleListFilter>("vsi");
  const [artSearch, setArtSearch] = useState("");
  const artSearchRef = useRef<HTMLInputElement>(null);
  const selectedArtRowRef = useRef<HTMLTableRowElement>(null);

  type InlinePriceField = "osnovna" | "mala" | "druzinska";
  const [editingPrice, setEditingPrice] = useState<{ id: number; field: InlinePriceField } | null>(null);
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
        headers: user?.enotaId ? { "X-Enota-Id": String(user.enotaId) } : {},
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
        headers: user?.enotaId ? { "X-Enota-Id": String(user.enotaId) } : {},
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
  const [cenikPdfLoading, setCenikPdfLoading] = useState(false);

  const handleIzvozi = async () => {
    setIzvozLoading(true);
    try {
      const r = await fetch(`${import.meta.env.BASE_URL}api/artikli/izvozi-excel`, {
        credentials: "include",
        headers: user?.enotaId ? { "X-Enota-Id": String(user.enotaId) } : {},
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

  const handleCenikPdf = async () => {
    setCenikPdfLoading(true);
    try {
      const blob = await getArtikliCenikPdf({
        credentials: "include",
        headers: user?.enotaId ? { "X-Enota-Id": String(user.enotaId) } : {},
      });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "cenik-z-alergeni.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
    } catch (error) {
      let description = "PDF-cenika ni bilo mogoče ustvariti.";
      if (error instanceof ApiError) {
        const data = error.data as { error?: string; napaka?: string } | null;
        description = data?.error ?? data?.napaka ?? description;
      } else if (error instanceof Error && error.message) {
        description = error.message;
      }
      toast({ title: "Napaka pri izvozu cenika", description, variant: "destructive" });
    } finally {
      setCenikPdfLoading(false);
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
  const {
    data: existingNormativi,
    refetch: refetchNormativi,
    isFetching: normativiFetching,
  } = useGetArtikelNormativi(editingArt?.id ?? 0);
  const {
    data: normativeChangeHistory = [],
    isLoading: normativeChangeHistoryLoading,
    isError: normativeChangeHistoryError,
  } = useGetArtikelNormativeChangeHistory(editingArt?.id ?? 0, {
    query: {
      queryKey: getGetArtikelNormativeChangeHistoryQueryKey(editingArt?.id ?? 0),
      enabled: Boolean(
        lahkoVidiZgodovinoNormativa
        && artDialogOpen
        && artMode === "uredi"
        && editingArt,
      ),
    },
  });
  const { data: existingArtModSkupine } = useGetArtikelModSkupine(editingArt?.id ?? 0);
  const { data: skupineList } = useListModSkupine();
  const setArtikelModSkupineMutation = useSetArtikelModSkupine();
  const pizzaDoughNormsQuery = useQuery({
    queryKey: ["artikel-pizza-dough-norms", editingArt?.id],
    enabled: Boolean(artDialogOpen && artMode === "uredi" && editingArt && artJePica),
    staleTime: 0,
    queryFn: async () => {
      if (!editingArt) return [];
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await posFetch(`${base}/api/artikli/${editingArt.id}/pizza-dough-norms`);
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        const errorMessage = body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error
          : "Normativov testa za pico ni bilo mogoče naložiti.";
        throw new Error(errorMessage);
      }
      if (!Array.isArray(body)) {
        throw new Error("Strežnik je vrnil neveljavne normative testa za pico.");
      }
      return body as Array<{
        size: "mala" | "normalna" | "druzinska";
        ingredient: { id: number; name: string };
        quantity: number;
      }>;
    },
  });
  useEffect(() => {
    if (!artDialogOpen || !artJePica || pizzaDoughNormsQuery.isFetching || !pizzaDoughNormsQuery.data) return;
    const normal = pizzaDoughNormsQuery.data.find(row => row.size === "normalna");
    const small = pizzaDoughNormsQuery.data.find(row => row.size === "mala");
    if (!normal || !small) return;
    const selection = { normalna: normal.ingredient.id, mala: small.ingredient.id };
    setPizzaDoughSaved(current => current ?? selection);
    setPizzaDoughSelection(current => current ?? selection);
  }, [artDialogOpen, artJePica, editingArt?.id, pizzaDoughNormsQuery.data, pizzaDoughNormsQuery.isFetching]);

  const pizzaDoughChanged = Boolean(pizzaDoughSaved && pizzaDoughSelection
    && (pizzaDoughSelection.normalna !== pizzaDoughSaved.normalna
      || pizzaDoughSelection.mala !== pizzaDoughSaved.mala));
  const pizzaDoughChoices = (artikli ?? []).filter(article =>
    article.mealType === "prepared" && !article.prodajniArtikel && article.aktiven
    && ["kos", "kom"].includes(article.enotaMere?.trim().toLocaleLowerCase("sl") ?? ""));
  const savePizzaDough = async () => {
    if (!editingArt || !pizzaDoughSelection || !pizzaDoughSaved) return;
    if (pizzaDoughSelection.normalna === pizzaDoughSelection.mala) {
      setNormativNapaka("Za malo in normalno pico izberite različna hlebčka.");
      return;
    }
    setPizzaDoughSaving(true);
    setNormativNapaka(null);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await posFetch(`${base}/api/artikli/${editingArt.id}/pizza-dough-norms`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          normalDoughArticleId: pizzaDoughSelection.normalna,
          smallDoughArticleId: pizzaDoughSelection.mala,
          expectedNormalDoughArticleId: pizzaDoughSaved.normalna,
          expectedSmallDoughArticleId: pizzaDoughSaved.mala,
        }),
      });
      const body: unknown = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body && typeof body === "object" && "error" in body && typeof body.error === "string"
          ? body.error : "Hlebčkov ni bilo mogoče shraniti.");
      }
      setPizzaDoughSaved({ ...pizzaDoughSelection });
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["artikel-pizza-dough-norms"] }),
        queryClient.invalidateQueries({ queryKey: getGetPreparedFoodAvailabilityQueryKey() }),
      ]);
      toast({ title: "Hlebčka shranjena", description: "Izbira velja za vse pice v tej enoti." });
    } catch (error) {
      setNormativNapaka(error instanceof Error ? error.message : "Hlebčkov ni bilo mogoče shraniti.");
    } finally {
      setPizzaDoughSaving(false);
    }
  };

  const previewAlergeniMutation = usePreviewArtikelAlergeniNormativ();
  const [inheritedAlergeni, setInheritedAlergeni] = useState<AlergenPovzetek | null>(null);
  const [inheritedAlergeniError, setInheritedAlergeniError] = useState<string | null>(null);
  const [loadingInheritedAlergeni, setLoadingInheritedAlergeni] = useState(false);
  const inheritedAlergeniRequestRef = useRef(0);
  const normativAlergeniIds = normativItems
    .map(item => item.vhodniArtikelId)
    .filter((id): id is number => id > 0);
  const normativAlergeniSignature = [...new Set(normativAlergeniIds)].sort((a, b) => a - b).join(",");
  const imaIzrecnoPotrjenProfil = Boolean(
    artAlergeni.alergeniStatus !== "nepreverjeno"
    && artAlergeni.alergeniVir
    && artAlergeni.alergeniVir !== "normativ",
  );
  const uporabiPotrjenDedovanProfil = Boolean(
    !imaIzrecnoPotrjenProfil
    && normativAlergeniIds.length > 0
    && inheritedAlergeni?.potrjen
    && inheritedAlergeni.opozorila.length === 0,
  );

  useEffect(() => {
    const requestId = ++inheritedAlergeniRequestRef.current;
    if (!artDialogOpen || normativAlergeniIds.length === 0) {
      setInheritedAlergeni(null);
      setInheritedAlergeniError(null);
      setLoadingInheritedAlergeni(false);
      return;
    }
    setInheritedAlergeni(null);
    setInheritedAlergeniError(null);
    setLoadingInheritedAlergeni(true);
    const timer = window.setTimeout(() => {
      previewAlergeniMutation.mutate(
        { data: { vhodniArtikelIds: normativAlergeniIds } },
        {
          onSuccess: result => {
            if (requestId === inheritedAlergeniRequestRef.current) setInheritedAlergeni(result);
          },
          onError: () => {
            if (requestId === inheritedAlergeniRequestRef.current) {
              setInheritedAlergeni(null);
              setInheritedAlergeniError("Predogleda alergenov ni bilo mogoče izračunati. Preverite povezavo in poskusite znova.");
            }
          },
          onSettled: () => {
            if (requestId === inheritedAlergeniRequestRef.current) setLoadingInheritedAlergeni(false);
          },
        },
      );
    }, 250);
    return () => window.clearTimeout(timer);
  // Mutation identity is stable; the signature intentionally ignores quantities because allergens are presence-based.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artDialogOpen, normativAlergeniSignature]);

  useEffect(() => {
    if (!artDialogOpen || artMode !== "uredi") return;
    if (existingNormativi && normativExpectedRevision === null) {
      setNormativItems(existingNormativi.normativi.map(n => ({
        vhodniArtikelId: n.vhodniArtikelId,
        kolicina: String(n.kolicina),
        ime: n.vhodniArtikelIme ?? undefined,
      })));
      setNormativExpectedRevision(existingNormativi.normativRevision);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existingNormativi, artDialogOpen, editingArt?.id]);

  const handleRefreshNormativi = async () => {
    try {
      const result = await refetchNormativi();
      if (!result.data) throw result.error ?? new Error("Normativa ni bilo mogoče osvežiti.");
      setNormativItems(result.data.normativi.map(n => ({
        vhodniArtikelId: n.vhodniArtikelId,
        kolicina: String(n.kolicina),
        ime: n.vhodniArtikelIme ?? undefined,
      })));
      setNormativExpectedRevision(result.data.normativRevision);
      if (artJePica) {
        const doughResult = await pizzaDoughNormsQuery.refetch();
        const normal = doughResult.data?.find(row => row.size === "normalna");
        const small = doughResult.data?.find(row => row.size === "mala");
        if (normal && small) {
          const selection = { normalna: normal.ingredient.id, mala: small.ingredient.id };
          setPizzaDoughSelection(selection);
          setPizzaDoughSaved(selection);
        }
      }
      setNormativStale(false);
      setNormativNapaka(null);
      toast({ title: "Normativ osvežen", description: "Prikazane so najnovejše shranjene vrstice." });
    } catch {
      toast({ title: "Normativa ni bilo mogoče osvežiti", variant: "destructive" });
    }
  };

  useEffect(() => {
    if (!artDialogOpen) {
      setNormativDropdownIdx(null);
      setNormativDropdownFilter("");
      setNormativDropdownHighlight(0);
      setNormativDropdownPos(null);
    }
  }, [artDialogOpen]);

  useEffect(() => {
    if (normativDropdownIdx === null || !artDialogOpen) {
      setNormativDropdownPos(null);
      return;
    }

    const positionDropdown = () => {
      const input = normativArtInputRefs.current.get(normativDropdownIdx);
      const dialog = artDialogRef.current;
      if (!input || !dialog) {
        setNormativDropdownPos(null);
        return;
      }
      const inputRect = input.getBoundingClientRect();
      const dialogRect = dialog.getBoundingClientRect();
      setNormativDropdownPos({
        top: inputRect.bottom - dialogRect.top + 4,
        left: inputRect.left - dialogRect.left,
        width: inputRect.width,
      });
    };

    const frame = window.requestAnimationFrame(positionDropdown);
    const dialogBody = artDialogBodyRef.current;
    dialogBody?.addEventListener("scroll", positionDropdown, { passive: true });
    window.addEventListener("resize", positionDropdown);
    return () => {
      window.cancelAnimationFrame(frame);
      dialogBody?.removeEventListener("scroll", positionDropdown);
      window.removeEventListener("resize", positionDropdown);
    };
  }, [artDialogOpen, normativDropdownIdx, normativItems.length]);

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


  // Avtomatski preklop na "blago" ko je normativ 1:1 (artikel = svoja sestavina, količina = 1)
  useEffect(() => {
    if (!artDialogOpen) return;
    const is1to1 =
      normativItems.length === 1 &&
      (normativItems[0]!.vhodniArtikelId === -1 ||
        (editingArt != null && normativItems[0]!.vhodniArtikelId === editingArt.id)) &&
      parseFloat(normativItems[0]!.kolicina) === 1;
    if (is1to1) setArtVrstaArtikla("blago");
  }, [normativItems, artDialogOpen, editingArt]);

  // Auto-populate a 1:1 self norm only for simple purchased-and-sold goods.
  // Prepared/composite dishes must use their real ingredients instead.
  useEffect(() => {
    if (artMode !== "nov" || !artDialogOpen) return;
    if (artProdajniArtikel && artNabavniArtikel && artMealType === "ala_carte") {
      setNormativItems(prev => {
        if (prev.some(n => n.vhodniArtikelId === -1)) return prev;
        return [{ vhodniArtikelId: -1, kolicina: "1" }, ...prev.filter(n => n.vhodniArtikelId !== -1)];
      });
    } else {
      setNormativItems(prev => prev.filter(n => n.vhodniArtikelId !== -1));
    }
  }, [artMode, artDialogOpen, artNabavniArtikel, artProdajniArtikel, artMealType]);

  // Samo nabavni novi artikli so praviloma surovine, zato jih privzeto
  // označimo kot material. Uporabnik lahko predlog še vedno ročno spremeni.
  useEffect(() => {
    if (
      artMode === "nov"
      && artDialogOpen
      && artNabavniArtikel
      && !artProdajniArtikel
    ) {
      setArtVrstaArtikla(DEFAULT_NEW_PURCHASE_ARTICLE_TYPE);
    }
  }, [artMode, artDialogOpen, artNabavniArtikel, artProdajniArtikel]);

  useEffect(() => {
    if (
      artDialogOpen
      && artNabavniArtikel
      && !artProdajniArtikel
      && (artDialogTab === "normativ" || artDialogTab === "slika")
    ) {
      setArtDialogTab("osnovno");
    }
  }, [artDialogOpen, artNabavniArtikel, artProdajniArtikel, artDialogTab]);

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
    const ime = catName.trim();
    if (!ime) return;
    const data = { ime, barva: catColor, vrstniRed: parseInt(catOrder) || 0, tip: catTip === "none" ? null : catTip, dnevnoFiltriranje: catDnevnoFiltriranje };
    const showCategoryError = (err: unknown) => {
      const apiError = err as { data?: { error?: string; napaka?: string }; message?: string };
      toast({
        title: "Kategorije ni bilo mogoče shraniti",
        description: apiError.data?.error ?? apiError.data?.napaka ?? apiError.message,
        variant: "destructive",
      });
    };
    if (catMode === "uredi" && editingKat) {
      updateKategorija.mutate({ id: editingKat.id, data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListKategorijeQueryKey() });
          setCatDialogOpen(false);
          toast({ title: "Kategorija posodobljena" });
        },
        onError: showCategoryError,
      });
    } else {
      createKategorija.mutate({ data }, {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListKategorijeQueryKey() });
          setCatDialogOpen(false);
          toast({ title: "Kategorija dodana" });
        },
        onError: showCategoryError,
      });
    }
  };

  const savePriceInline = (a: Artikel, field: InlinePriceField) => {
    const newCena = parseDecimal(editingPriceVal);
    setEditingPrice(null);
    const oldCena = field === "osnovna"
      ? a.cena
      : field === "mala"
        ? a.cenaMala
        : a.cenaDruzinska;
    if (isNaN(newCena) || newCena === oldCena) return;
    const cenaUpdate = field === "osnovna"
      ? { cena: newCena }
      : field === "mala"
        ? { cenaMala: newCena }
        : { cenaDruzinska: newCena };
    updateArtikel.mutate({ id: a.id, data: {
      ime: a.ime,
      ...cenaUpdate,
      davek: a.davek,
      kategorijaId: a.kategorijaId ?? null, aktiven: a.aktiven, barva: a.barva ?? null,
      nabavniArtikel: a.nabavniArtikel ?? false, prodajniArtikel: a.prodajniArtikel ?? true,
      imeZaNabavo: a.imeZaNabavo ?? null, enotaMere: a.enotaMere ?? null,
      jeSkupinskiNabavniArtikel: Boolean((a as Artikel & { jeSkupinskiNabavniArtikel?: boolean }).jeSkupinskiNabavniArtikel),
    }}, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() }),
      onError: () => toast({ title: "Napaka pri shranjevanju cene", variant: "destructive" }),
    });
  };

  const handleDelKat = (id: number) => {
    deleteKategorija.mutate({ id: String(id) as any }, {
      onSuccess: () => queryClient.invalidateQueries({ queryKey: getListKategorijeQueryKey() }),
    });
  };

  // ── Artikel handlers ─────────────────────────────────────────
  const openNewArt = () => {
    setArtMode("nov"); setEditingArt(null);
    setArtDialogTab("osnovno");
    setMulticourseEditorEnabled(false);
    setArtName(""); setArtPrice(""); setArtCenaMala(""); setArtCenaDruzinska(""); setArtCat(""); setArtAktiven(true); setArtColor(null);
    setArtNabavniArtikel(false); setArtProdajniArtikel(true); setArtJePica(false);
    setArtJeSkupinskiNabavniArtikel(false);
    setArtPovratnaEmbalaza(false);
    setArtVrstaEmbalaze("steklenica");
    setArtDepozitnaVrednost("0");
    setArtPrivzetiModGrpIds([]);
    setArtToGoArtikli([]);
    setArtToGo(false);
    setArtHappyHourCena("");
    setArtHappyHourCenaMala("");
    setArtHappyHourCenaDruzinska("");
    setArtVrstaArtikla(DEFAULT_NEW_SALES_ARTICLE_TYPE);
    setArtMealType("ala_carte");
    setArtCasPripraveMin("0");
    setArtSkupina("");
    setArtTaxCategory("food");
    setArtJeDelMenija(false);
    setArtAddedSugar(false);
    setArtOpisSlike("");
    setArtOpisSlikeTouched(false);
    setArtSlikaUrl(null);
    setArtImageError(null);
    setCroppingArticleImage(null);
    setArtImeZaNabavo(""); setArtEnotaMere(null);
    setNormativItems([]);
    setPizzaDoughSelection(null);
    setPizzaDoughSaved(null);
    setNormativExpectedRevision(null);
    setNormativStale(false);
    setNormativNapaka(null);
    setArtModSkupineIds([]);
    setArtAlergeni({
      alergeni: [],
      alergeniSledi: [],
      alergeniStatus: "nepreverjeno",
      alergeniVir: null,
      alergeniOpombaVira: null,
      alergeniDocumentId: null,
    });
    setArtDialogOpen(true);
  };

  const openEditArt = (a: Artikel) => {
    setArtMode("uredi"); setEditingArt(a);
    setArtDialogTab("osnovno");
    setMulticourseEditorEnabled(Boolean(a.isMulticourseMenu));
    setArtName(a.ime); setArtPrice(String(a.cena));
    setArtCenaMala((a as typeof a & { cenaMala?: number | null }).cenaMala != null ? String((a as typeof a & { cenaMala: number }).cenaMala) : "");
    setArtCenaDruzinska((a as typeof a & { cenaDruzinska?: number | null }).cenaDruzinska != null ? String((a as typeof a & { cenaDruzinska: number }).cenaDruzinska) : "");
    setArtCat(a.kategorijaId != null ? String(a.kategorijaId) : ""); setArtAktiven(a.aktiven);
    setArtColor(a.barva ?? null);
    setArtNabavniArtikel(a.nabavniArtikel ?? false);
    setArtProdajniArtikel(a.prodajniArtikel ?? true);
    setArtPovratnaEmbalaza(a.povratnaEmbalaza);
    setArtVrstaEmbalaze((a.vrstaEmbalaze ?? "steklenica") as "steklenica" | "zaboj" | "keg" | "balon" | "drugo");
    setArtDepozitnaVrednost(a.depozitnaVrednost == null ? "0" : String(a.depozitnaVrednost));
    setArtJePica(a.jePica ?? false);
    setArtPrivzetiModGrpIds([]);
    setArtToGoArtikli((a as typeof a & { toGoArtikli?: number[] }).toGoArtikli ?? []);
    setArtToGo((a as typeof a & { toGo?: boolean }).toGo ?? false);
    setArtHappyHourCena((a as typeof a & { happyHourCena?: number | null }).happyHourCena != null ? String((a as typeof a & { happyHourCena: number }).happyHourCena) : "");
    setArtHappyHourCenaMala(a.happyHourCenaMala != null ? String(a.happyHourCenaMala) : "");
    setArtHappyHourCenaDruzinska(a.happyHourCenaDruzinska != null ? String(a.happyHourCenaDruzinska) : "");
    setArtVrstaArtikla(((a as typeof a & { vrstaArtikla?: string }).vrstaArtikla ?? "storitev") as "blago" | "material" | "storitev");
    setArtMealType((a.mealType as "ala_carte" | "prepared" | "composite") ?? "ala_carte");
    setArtCasPripraveMin(String((a as typeof a & { casPripraveMin?: number }).casPripraveMin ?? 0));
    setArtSkupina((a as typeof a & { skupina?: string | null }).skupina ?? "");
    const existingTaxCategory = (a as typeof a & { taxCategory?: string }).taxCategory ?? "food";
    setArtTaxCategory(existingTaxCategory as "food" | "hot_beverage" | "cold_beverage" | "alcoholic" | "food_drink" | "vat_super_reduced_5" | "other");
    setArtJeDelMenija(
      Boolean((a as typeof a & { jeDelMenija?: boolean }).jeDelMenija)
      && (existingTaxCategory === "hot_beverage" || existingTaxCategory === "cold_beverage"),
    );
    setArtAddedSugar(Boolean((a as typeof a & { addedSugar?: boolean }).addedSugar));
    setArtOpisSlike(a.opisSlike ?? "");
    setArtOpisSlikeTouched(true);
    setArtSlikaUrl(a.slikaUrl ?? null);
    setArtImageAltText("");
    setArtImageEditPrompt("");
    setArtImageVersions([]);
    setImageHistoryOpen(false);
    setArtImageError(null);
    setCroppingArticleImage(null);
    setArtImeZaNabavo(a.imeZaNabavo ?? "");
    setArtEnotaMere(a.enotaMere ?? null);
    setArtJeSkupinskiNabavniArtikel(Boolean((a as Artikel & { jeSkupinskiNabavniArtikel?: boolean }).jeSkupinskiNabavniArtikel));
    setNormativItems([]);
    setPizzaDoughSelection(null);
    setPizzaDoughSaved(null);
    setNormativExpectedRevision(null);
    setNormativStale(false);
    setNormativNapaka(null);
    setArtAlergeni({
      alergeni: a.alergeni ?? [],
      alergeniSledi: a.alergeniSledi ?? [],
      alergeniStatus: a.alergeniStatus ?? "nepreverjeno",
      alergeniVir: a.alergeniVir ?? null,
      alergeniOpombaVira: a.alergeniOpombaVira ?? null,
      alergeniDocumentId: a.alergeniDocumentId ?? null,
    });
    setArtModSkupineIds([]);
    setArtDialogOpen(true);
  };

  // The agent only stores a review draft. Opening this editor still never mutates a normativ.
  useEffect(() => {
    if (proposalDraft || !artikli) return;
    const draft = readProposalDraft();
    if (!draft) return;
    const article = artikli.find(item => item.id === draft.artikelId);
    if (!article) return;
    setProposalDraft(draft);
    setProposalConfirmations(new Set());
    setProposalStaleMessage(null);
    openEditArt(article);
  // Loading the draft once is intentional; it must remain available through stale responses.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [artikli, proposalDraft]);

  const cancelProposalDraft = () => {
    clearProposalDraft();
    setProposalDraft(null);
    setProposalConfirmations(new Set());
    setProposalStaleMessage(null);
  };

  const applyProposalDraft = async () => {
    if (!proposalDraft || proposalApplying || proposalConfirmations.size !== proposalDraft.selected.length) return;
    setProposalApplying(true);
    setProposalStaleMessage(null);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await posFetch(`${base}/api/artikli/${proposalDraft.artikelId}/normativi/spletni-predlogi`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ selections: proposalDraft.selected.map(row => ({ proposalToken: row.proposalToken, confirmed: true })) }),
      });
      const body = await response.json().catch(() => null) as { changed?: number; error?: string; code?: string } | null;
      if (response.status === 409 && body?.code === "NORMATIVE_PROPOSAL_STALE") {
        setProposalStaleMessage(body.error ?? "Predlog normativa ni več aktualen.");
        return;
      }
      if (!response.ok) throw new Error(body?.error ?? "Predlogov normativa ni bilo mogoče uporabiti.");
      clearProposalDraft();
      setProposalDraft(null);
      setProposalConfirmations(new Set());
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: getGetArtikelNormativiQueryKey(proposalDraft.artikelId) }),
        queryClient.invalidateQueries({ queryKey: getGetArtikelNormativeChangeHistoryQueryKey(proposalDraft.artikelId) }),
        queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() }),
      ]);
      toast({ title: "Normativ posodobljen", description: `Uporabljenih sprememb: ${body?.changed ?? proposalDraft.selected.length}.` });
    } catch (error) {
      toast({ title: "Napaka pri uporabi predlogov", description: error instanceof Error ? error.message : "Neznana napaka.", variant: "destructive" });
    } finally {
      setProposalApplying(false);
    }
  };

  const addNormativItem = () => {
    // Sestavljeni artikli so kombinacije porcij. Privzeta količina 1 prepreči,
    // da bi uporabnik izbral sestavino, prazna količina pa bi jo ob shranjevanju
    // tiho izločila iz normativa.
    setNormativItems(prev => [
      ...prev.filter(item => item.vhodniArtikelId !== -1),
      {
        vhodniArtikelId: 0,
        kolicina: artMealType === "composite" ? "1" : "",
      },
    ]);
  };

  const removeNormativItem = (idx: number) => {
    setNormativDropdownIdx(null);
    setNormativDropdownFilter("");
    setNormativDropdownHighlight(0);
    setNormativDropdownPos(null);
    setNormativItems(prev => prev.filter((_, i) => i !== idx));
  };

  const normativNabavniArtikli = (artikli ?? []).filter(a =>
    canUseAsNormativInput(editingArt?.id ?? null, artMealType, a),
  );
  const filteredNormativArtikli = normativDropdownFilter
    ? normativNabavniArtikli.filter(a =>
        [a.imeZaNabavo, a.ime].some(naziv =>
          naziv?.toLowerCase().includes(normativDropdownFilter.toLowerCase())
        )
      )
    : normativNabavniArtikli;

  const openNormativDropdown = (idx: number) => {
    setNormativDropdownIdx(idx);
    setNormativDropdownFilter("");
    setNormativDropdownHighlight(0);
  };

  const selectNormativArtikel = (idx: number, artikelId: number) => {
    const found = normativNabavniArtikli.find(a => a.id === artikelId);
    if (!found) return;
    setNormativItems(prev => prev.map((item, itemIdx) =>
      itemIdx === idx
        ? { ...item, vhodniArtikelId: found.id, ime: found.ime }
        : item
    ));
    setNormativDropdownIdx(null);
    setNormativDropdownFilter("");
    setNormativDropdownHighlight(0);
    setNormativDropdownPos(null);
  };

  const clearNormativArtikel = (idx: number) => {
    setNormativItems(prev => prev.map((item, itemIdx) =>
      itemIdx === idx ? { ...item, vhodniArtikelId: 0, ime: undefined } : item
    ));
    openNormativDropdown(idx);
  };

  const updateNormativItem = (idx: number, field: keyof NormativItem, value: string | number) => {
    setNormativItems(prev => prev.map((item, i) =>
      i === idx ? { ...item, [field]: value } : item
    ));
  };

  const handleArtNameChange = (value: string) => {
    setArtName(value);
    if (artMode === "nov" && !artOpisSlikeTouched) {
      setArtOpisSlike(value);
    }
  };

  const handleArtJePicaChange = (checked: boolean) => {
    setArtJePica(checked);
    if (
      checked
      && artMode === "nov"
      && (artCasPripraveMin.trim() === "" || artCasPripraveMin === "0")
    ) {
      setArtCasPripraveMin(String(PRIVZETI_CAS_PRIPRAVE_PICE_MIN));
    }
  };

  const handleGenerateArtikelImage = () => {
    if (!editingArt) {
      toast({
        title: "Najprej shranite artikel",
        description: "Ko je artikel shranjen, lahko z opisom ustvarite njegovo sliko.",
      });
      return;
    }
    const opisSlike = artOpisSlike.trim();
    if (!opisSlike) {
      setArtImageError("Vnesite opis slike.");
      return;
    }
    setArtImageError(null);
    generateArtikelImage.mutate(
      { id: editingArt.id, data: { opisSlike } },
      {
        onSuccess: (updatedArtikel) => {
          setArtOpisSlike(updatedArtikel.opisSlike ?? opisSlike);
          setArtSlikaUrl(updatedArtikel.slikaUrl ?? null);
          setEditingArt(updatedArtikel);
          queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });
          toast({ title: "Slika artikla je ustvarjena" });
        },
        onError: (error) => {
          const apiError = error as { data?: { error?: string } };
          const message = apiError.data?.error ?? "Slike ni bilo mogoče ustvariti. Poskusite znova.";
          setArtImageError(message);
          toast({ title: "Generiranje slike ni uspelo", description: message, variant: "destructive" });
        },
      },
    );
  };

  const imageRequest = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`${import.meta.env.BASE_URL}api/artikli/${editingArt!.id}${path}`, {
      ...init, credentials: "include",
      headers: { "Content-Type": "application/json", ...(user?.enotaId ? { "X-Enota-Id": String(user.enotaId) } : {}), ...(init.headers ?? {}) },
    });
    if (!response.ok) {
      const body = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(body.error ?? "Operacija s sliko ni uspela.");
    }
    return response.status === 204 ? null : response.json();
  };

  const refreshImageHistory = async () => {
    if (!editingArt) return;
    try {
      const versions = await imageRequest("/slike");
      setArtImageVersions(versions);
    } catch (error) {
      toast({ title: "Zgodovine ni mogoče prebrati", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  const handleEditArticleImage = async () => {
    if (!editingArt || !artImageEditPrompt.trim()) return;
    setImageActionLoading(true); setArtImageError(null);
    try {
      const updated = await imageRequest("/uredi-sliko", { method: "POST", body: JSON.stringify({ prompt: artImageEditPrompt.trim() }) }) as Artikel;
      setEditingArt(updated); setArtSlikaUrl(updated.slikaUrl ?? null); setArtImageEditPrompt("");
      await refreshImageHistory(); queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });
      toast({ title: "Urejena slika je shranjena kot nova različica" });
    } catch (error) { setArtImageError(error instanceof Error ? error.message : "Slike ni mogoče urediti."); }
    finally { setImageActionLoading(false); }
  };

  const handleSetAltText = async () => {
    if (!editingArt || !artSlikaUrl) return;
    setImageActionLoading(true);
    try { await imageRequest("/slike/alt", { method: "PATCH", body: JSON.stringify({ altText: artImageAltText }) }); await refreshImageHistory(); toast({ title: "Nadomestno besedilo shranjeno" }); }
    catch (error) { setArtImageError(error instanceof Error ? error.message : "Besedila ni mogoče shraniti."); }
    finally { setImageActionLoading(false); }
  };

  const handleRestoreImage = async (versionId: number) => {
    if (!editingArt) return;
    setImageActionLoading(true);
    try {
      const updated = await imageRequest(`/slike/${versionId}/obnovi`, { method: "POST" }) as Artikel;
      setEditingArt(updated); setArtSlikaUrl(updated.slikaUrl ?? null); await refreshImageHistory();
      queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() }); toast({ title: "Različica slike je obnovljena" });
    } catch (error) { setArtImageError(error instanceof Error ? error.message : "Različice ni mogoče obnoviti."); }
    finally { setImageActionLoading(false); }
  };

  const handleRemoveImage = async () => {
    if (!editingArt || !window.confirm("Odstranim trenutno sliko? Datoteka ostane varno v zgodovini in jo lahko obnovite.")) return;
    setImageActionLoading(true);
    try { await imageRequest("/slike/trenutna", { method: "DELETE", body: JSON.stringify({ confirm: true }) }); setArtSlikaUrl(null); await refreshImageHistory(); queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() }); }
    catch (error) { setArtImageError(error instanceof Error ? error.message : "Slike ni mogoče odstraniti."); }
    finally { setImageActionLoading(false); }
  };

  const handleUploadArtikelImage = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    selectingArticleImageRef.current = false;
    if (!file) return;
    if (!editingArt) {
      toast({
        title: "Najprej shranite artikel",
        description: "Ko je artikel shranjen, lahko naložite njegovo sliko.",
      });
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setArtImageError("Slika je prevelika. Največja dovoljena velikost je 8 MB.");
      return;
    }
    setArtImageError(null);
    setCroppingArticleImage(file);
  };

  const handleCroppedArticleImageUpload = (file: File) => {
    if (!editingArt) return;
    uploadArtikelImage.mutate(
      { id: editingArt.id, data: { file } },
      {
        onSuccess: (updatedArtikel) => {
          setArtSlikaUrl(updatedArtikel.slikaUrl ?? null);
          setEditingArt(updatedArtikel);
          setCroppingArticleImage(null);
          queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });
          toast({ title: "Slika artikla je naložena" });
        },
        onError: (error) => {
          setCroppingArticleImage(null);
          const apiError = error as { data?: { error?: string } };
          const message = apiError.data?.error ?? "Slike ni bilo mogoče naložiti. Poskusite znova.";
          setArtImageError(message);
          toast({ title: "Nalaganje slike ni uspelo", description: message, variant: "destructive" });
        },
      },
    );
  };

  const openArticleImagePicker = () => {
    if (!editingArt) {
      toast({
        title: "Najprej shranite artikel",
        description: "Ko je artikel shranjen, lahko naložite njegovo sliko.",
      });
      return;
    }
    selectingArticleImageRef.current = true;
    window.setTimeout(() => {
      selectingArticleImageRef.current = false;
    }, 10_000);
    artImageInputRef.current?.click();
  };

  const handleArtDialogOpenChange = (open: boolean) => {
    if (!open && (selectingArticleImageRef.current || uploadArtikelImage.isPending || croppingArticleImage != null)) {
      return;
    }
    if (open) {
      setArtDialogTab("osnovno");
    }
    if (!open) {
      setEslogUnitPickerOpen(false);
      setNormativDropdownIdx(null);
      setNormativDropdownFilter("");
      setNormativDropdownHighlight(0);
      setNormativDropdownPos(null);
    }
    setArtDialogOpen(open);
  };

  const handleSaveArt = () => {
    if (pizzaDoughChanged) {
      setArtDialogTab("normativ");
      setNormativNapaka("Izbira hlebčkov še ni shranjena. Najprej kliknite »Shrani hlebčka«, nato posodobite artikel.");
      return;
    }
    if (artMode === "uredi" && normativExpectedRevision === null) {
      setNormativNapaka("Počakajte, da se normativ naloži, nato poskusite znova.");
      return;
    }
    const isProdajni = artProdajniArtikel;
    const uporabiDedovaneAlergene = uporabiPotrjenDedovanProfil;
    if (!artName) {
      setArtDialogTab("osnovno");
      return;
    }
    if (isProdajni && !artCat) {
      setArtDialogTab("osnovno");
      return;
    }
    if (isProdajni && !artPrice) {
      setArtDialogTab("cena_ddv");
      return;
    }
    const depozitnaVrednost = parseDecimal(artDepozitnaVrednost);
    if (artPovratnaEmbalaza && (!Number.isFinite(depozitnaVrednost) || depozitnaVrednost < 0)) {
      setArtDialogTab("osnovno");
      toast({ title: "Depozitna vrednost mora biti 0 ali več", variant: "destructive" });
      return;
    }
    if (isProdajni && artJePica && picaMalaAktivna && artCenaMala.trim() === "") {
      setArtDialogTab("cena_ddv");
      toast({ title: "Vnesite ceno male pice", variant: "destructive" });
      return;
    }
    if (isProdajni && artJePica && picaDruzinskaAktivna && artCenaDruzinska.trim() === "") {
      setArtDialogTab("cena_ddv");
      toast({ title: "Vnesite ceno družinske pice", variant: "destructive" });
      return;
    }
    const casPripraveMin = Number(artCasPripraveMin);
    if (!Number.isInteger(casPripraveMin) || casPripraveMin < 0) {
      setArtDialogTab("osnovno");
      toast({ title: "Čas priprave mora biti celo število 0 ali več", variant: "destructive" });
      return;
    }
    if (!imaIzrecnoPotrjenProfil && normativAlergeniIds.length > 0 && loadingInheritedAlergeni) {
      setArtDialogTab("alergeni");
      toast({
        title: "Preverjam alergene surovin",
        description: "Počakajte trenutek, da se samodejni profil osveži.",
      });
      return;
    }

    if (
      !uporabiDedovaneAlergene
      &&
      artProdajniArtikel
      && (artMode === "nov" || artAktiven)
      && normativAlergeniIds.length === 0
      && artAlergeni.alergeniStatus === "nepreverjeno"
    ) {
      setArtDialogTab("alergeni");
      toast({
        title: "Določite alergene",
        description: "Prodajni artikel brez normativa zahteva izrecno potrjen alergenski profil.",
        variant: "destructive",
      });
      return;
    }
    if (
      !uporabiDedovaneAlergene
      && artAlergeni.alergeniStatus !== "nepreverjeno"
      && !artAlergeni.alergeniVir
    ) {
      setArtDialogTab("alergeni");
      toast({
        title: "Izberite vir podatkov o alergenih",
        description: "Potrjen alergenski profil mora imeti naveden vir podatkov.",
        variant: "destructive",
      });
      return;
    }
    if (
      !uporabiDedovaneAlergene
      &&
      artAlergeni.alergeniStatus === "potrjeno"
      && artAlergeni.alergeni.length === 0
      && artAlergeni.alergeniSledi.length === 0
    ) {
      setArtDialogTab("alergeni");
      toast({
        title: "Izberite alergen ali sled",
        description: "Za prazen potrjen profil uporabite status »Potrjeno BREZ alergenov«.",
        variant: "destructive",
      });
      return;
    }

    const invalidNormativItem = normativItems.some(
      n => (n.vhodniArtikelId !== -1 && n.vhodniArtikelId <= 0)
        || !Number.isFinite(parseDecimal(n.kolicina))
        || parseDecimal(n.kolicina) <= 0,
    );
    if (invalidNormativItem) {
      setArtDialogTab("normativ");
      setNormativNapaka("Vsaka vrstica normativa mora imeti izbran artikel in količino večjo od 0.");
      return;
    }
    if (
      requiresClassicNormativ(artMealType, Boolean(editingArt?.isMulticourseMenu))
      && normativItems.length === 0
    ) {
      setArtDialogTab("normativ");
      setNormativNapaka("Sestavljeni artikel mora vsebovati vsaj en vhodni artikel.");
      return;
    }

    // -1 is a self-reference placeholder (replaced with real ID in afterSave)
    const validNormativItems = normativItems
      .filter(n => (n.vhodniArtikelId === -1 || n.vhodniArtikelId > 0) && parseDecimal(n.kolicina) > 0)
      .map(n => ({ vhodniArtikelId: n.vhodniArtikelId, kolicina: parseDecimal(n.kolicina) }));
    const alergeniZaShranjevanje: AlergenSnapshot = uporabiDedovaneAlergene && inheritedAlergeni
      ? {
          alergeni: inheritedAlergeni.alergeni.map(item => item.koda),
          alergeniSledi: inheritedAlergeni.alergeniSledi.map(item => item.koda),
          alergeniStatus: inheritedAlergeni.alergeni.length === 0 && inheritedAlergeni.alergeniSledi.length === 0
            ? "potrjeno_brez"
            : "potrjeno",
          alergeniVir: "normativ",
          alergeniOpombaVira: "Samodejno izračunano iz potrjenih surovin v normativu.",
          alergeniDocumentId: null,
        }
      : artAlergeni;

    const data = {
      ime: artName,
      cena: isProdajni ? parseDecimal(artPrice) : 0,
      cenaMala: isProdajni && artJePica && artCenaMala.trim() !== "" ? parseDecimal(artCenaMala) : null,
      cenaDruzinska: isProdajni && artJePica && artCenaDruzinska.trim() !== "" ? parseDecimal(artCenaDruzinska) : null,
      // Prodajni artikli → prodajna stopnja (eat_in privzeto, POS jo bere pri prodaji)
      // Čisto nabavni artikli → pričakovana nabavna stopnja (za validacijo na prejemu)
      davek: artPovratnaEmbalaza
        ? 0
        : artProdajniArtikel
        ? (artTaxCategory === "alcoholic"
          ? ddvStopnje.splosnaSt
          : artJeDelMenija && artLahkoJeDelMenija
            ? ddvStopnje.nizjaSt
            : prodajnaDefaultDdv(artTaxCategory))
        : pricakovanaNabavnaDdv(artTaxCategory, artAddedSugar),
      kategorijaId: artPovratnaEmbalaza ? null : (artCat ? parseInt(artCat) : null),
      aktiven: artAktiven,
      barva: isProdajni ? (artColor ?? null) : null,
      nabavniArtikel: artNabavniArtikel,
      prodajniArtikel: artProdajniArtikel,
      povratnaEmbalaza: artPovratnaEmbalaza,
      vrstaEmbalaze: artPovratnaEmbalaza ? artVrstaEmbalaze : null,
      depozitnaVrednost: artPovratnaEmbalaza ? depozitnaVrednost : null,
      jePica: isProdajni ? artJePica : false,
      jeDodatekZaPico: false,
      privzetiDodatki: [],
      jeModifikator: false,
      privzetiModifikatorji: isProdajni ? artPrivzetiModGrpIds : [],
      toGoArtikli: isProdajni ? artToGoArtikli : [],
      toGo: isProdajni ? artToGo : false,
      imeZaNabavo: artNabavniArtikel ? (artImeZaNabavo || null) : null,
      enotaMere: artNabavniArtikel ? (artEnotaMere || null) : null,
      jeSkupinskiNabavniArtikel: Boolean(lahkoJeSkupinskiNabavniArtikel && artJeSkupinskiNabavniArtikel),
      vrstaArtikla: artPovratnaEmbalaza ? "material" : artVrstaArtikla,
      mealType: (
        (!artProdajniArtikel && !artNabavniArtikel)
        || (artCat && kategorije?.find(k => k.id === parseInt(artCat))?.tip === "hrana")
      ) ? artMealType : "ala_carte",
      casPripraveMin,
      happyHourCena: isProdajni && artHappyHourCena !== "" ? parseDecimal(artHappyHourCena) : null,
      happyHourCenaMala: isProdajni && artJePica && artHappyHourCenaMala !== "" ? parseDecimal(artHappyHourCenaMala) : null,
      happyHourCenaDruzinska: isProdajni && artJePica && artHappyHourCenaDruzinska !== "" ? parseDecimal(artHappyHourCenaDruzinska) : null,
      skupina: artSkupina.trim() || null,
      taxCategory: artTaxCategory,
      jeDelMenija: artProdajniArtikel && artLahkoJeDelMenija && artJeDelMenija,
      addedSugar: artTaxCategory === "food_drink" ? false : artAddedSugar,
      opisSlike: artProdajniArtikel ? (artOpisSlike.trim() || null) : null,
      alergeni: alergeniZaShranjevanje.alergeni,
      alergeniSledi: alergeniZaShranjevanje.alergeniSledi,
      alergeniStatus: alergeniZaShranjevanje.alergeniStatus,
      alergeniVir: alergeniZaShranjevanje.alergeniVir,
      alergeniOpombaVira: alergeniZaShranjevanje.alergeniOpombaVira,
      alergeniDocumentId: alergeniZaShranjevanje.alergeniDocumentId,
    };

    const finishSave = (artikelId: number, label: string, operation: "created" | "updated") => {
      trackEvent("menu_article_saved", {
        operation,
        has_recipe: normativItems.some(item => item.vhodniArtikelId > 0),
      });
      if (artProdajniArtikel) {
        setArtikelModSkupineMutation.mutate(
          { id: artikelId, data: { skupineIds: artModSkupineIds } },
          { onError: () => toast({ title: "Napaka pri shranjevanju modifikatorjev", variant: "destructive" }) }
        );
        queryClient.invalidateQueries({ queryKey: getGetArtikelModSkupineQueryKey(artikelId) });
      }
      queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });
      queryClient.invalidateQueries({ queryKey: getGetArtikelNormativiQueryKey(artikelId) });
      queryClient.invalidateQueries({ queryKey: getGetArtikelAlergeniNormativQueryKey(artikelId) });
      setNormativNapaka(null);
      setNormativStale(false);
      setArtDialogOpen(false);
      toast({ title: label });
    };

    const showNormativSaveError = (err: unknown, articleAlreadySaved: boolean) => {
      const staleMessage = getNormativStaleMessage(err as { status?: number; data?: any });
      const apiErr = err as { status?: number; data?: { error?: string; manjkajoceSestavine?: number[] } };
      const prefix = articleAlreadySaved
        ? "Splošni podatki artikla so bili shranjeni, normativ pa ne. "
        : "Artikel ni bil shranjen. ";
      if (staleMessage) {
        setNormativStale(true);
        setNormativNapaka(`${prefix}${staleMessage}`);
      } else if (apiErr.status === 422 && apiErr.data?.manjkajoceSestavine?.length) {
        const names = apiErr.data.manjkajoceSestavine.map(mid => {
          const found = normativItems.find(n => n.vhodniArtikelId === mid);
          return found?.ime ?? `ID ${mid}`;
        });
        setNormativNapaka(`${prefix}Naslednje sestavine so bile izbrisane: ${names.join(", ")}. Prosimo, zamenjajte ali odstranite te vrstice.`);
      } else if (apiErr.data?.error) {
        setNormativNapaka(`${prefix}${apiErr.data.error}`);
      } else {
        toast({
          title: "Napaka pri shranjevanju normativa",
          description: prefix.trim(),
          variant: "destructive",
        });
      }
    };

    const normativiZaArtikel = (artikelId: number) => validNormativItems.map(n =>
      n.vhodniArtikelId === -1 ? { ...n, vhodniArtikelId: artikelId } : n
    );

    const showArticleSaveError = (err: unknown, normativAlreadySaved = false) => {
      const apiErr = err as {
        data?: { error?: string; napaka?: string; detail?: string };
        message?: string;
      };
      const description = apiErr.data?.error
        ?? apiErr.data?.napaka
        ?? apiErr.data?.detail
        ?? apiErr.message
        ?? "Poskusite znova.";
      toast({
        title: normativAlreadySaved
          ? "Splošnih podatkov ni bilo mogoče posodobiti"
          : artMode === "uredi" ? "Artikla ni bilo mogoče posodobiti" : "Artikla ni bilo mogoče dodati",
        description: normativAlreadySaved
          ? `Normativ je bil shranjen, ime, cena in drugi splošni podatki pa ne. ${description}`
          : description,
        variant: "destructive",
      });
    };

    if (artMode === "uredi" && editingArt) {
      updateArtikel.mutate({
        id: editingArt.id,
        data: {
          ...data,
          normativUpdate: {
            items: normativiZaArtikel(editingArt.id),
            expectedRevision: normativExpectedRevision!,
          },
        },
      }, {
        onSuccess: (updatedArtikel) => {
          queryClient.setQueryData<Artikel[]>(getListArtikliQueryKey(), current =>
            current?.map(article => article.id === updatedArtikel.id ? updatedArtikel : article),
          );
          finishSave(editingArt.id, "Artikel posodobljen", "updated");
        },
        onError: (error) => {
          if (getNormativStaleMessage(error as { status?: number; data?: any })) {
            showNormativSaveError(error, false);
          } else {
            showArticleSaveError(error);
          }
        },
      });
    } else {
      createArtikel.mutate({
        data: {
          ...data,
          normativItems: validNormativItems,
        },
      }, {
        onSuccess: (createdArtikel) => {
          finishSave(createdArtikel.id, "Artikel dodan", "created");
        },
        onError: (err) => showArticleSaveError(err),
      });
    }
  };

  const handleDelArt = (id: number) => {
    deleteArtikel.mutate({ id: String(id) as any }, {
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
  const isGeneratingArticleImage = generateArtikelImage.isPending;
  const isUploadingArticleImage = uploadArtikelImage.isPending;
  useF2Save(handleSaveCat, catDialogOpen && !isPendingCat && !!catName);
  useF2Save(handleSaveArt, artDialogOpen && !isPendingArt && !isGeneratingArticleImage && !!artName);

  return (
    <div className="p-1.5 sm:p-4 lg:p-5 gap-0.5 sm:gap-2 flex-1 h-full min-h-0 overflow-y-auto lg:overflow-hidden flex flex-col bg-muted/10">
      <div className="hidden sm:flex justify-between items-center shrink-0">
        <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-foreground">Upravljanje menija</h1>
      </div>

      <Tabs defaultValue="artikli" className="flex-1 flex flex-col min-h-0">
        <TabsList className="w-full justify-start overflow-x-auto h-8 sm:h-9 p-0.5 bg-muted/20 border border-border/50 rounded-md shrink-0">
          <TabsTrigger value="artikli" className="flex-1 sm:flex-none h-7 sm:h-8 py-0.5 px-2 sm:px-3 text-[11px] sm:text-sm gap-1"><PackageOpen className="w-3.5 h-3.5" /> Artikli</TabsTrigger>
          <TabsTrigger value="kategorije" className="flex-1 sm:flex-none h-7 sm:h-8 py-0.5 px-2 sm:px-3 text-[11px] sm:text-sm gap-1"><MenuIcon className="w-3.5 h-3.5" /> Kategorije</TabsTrigger>
          <TabsTrigger value="modifikatorji" className="flex-1 sm:flex-none h-7 sm:h-8 py-0.5 px-2 sm:px-3 text-[11px] sm:text-sm gap-1"><Sparkles className="w-3.5 h-3.5" /> Modifikatorji</TabsTrigger>
        </TabsList>

        <div className="flex-1 min-h-0 relative mt-0.5 sm:mt-1.5">
          {/* Kategorije Tab */}
          <TabsContent value="kategorije" className="absolute inset-0 m-0 h-full flex flex-col data-[state=active]:flex outline-none">
            <Card className="flex flex-col border-border/50 shadow-sm overflow-hidden bg-card h-full">
            <div className="px-3 py-2 border-b border-border/50 bg-muted/30 flex items-center justify-between">
              <h2 className="font-medium text-sm tracking-tight text-foreground flex items-center gap-1.5">
                <MenuIcon className="w-4 h-4 text-muted-foreground" />
                Kategorije
              </h2>
              {!jeUporabnik && (
                <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={openNewCat}>
                  <Plus className="w-3.5 h-3.5 mr-1" />Nova
                </Button>
              )}
            </div>
            <div className="flex-1 min-h-0 overflow-y-auto p-1 scrollbar-hidden">
              <Table>
                <TableHeader className="invisible h-0">
                  <TableRow>
                    <TableHead className="w-full"></TableHead>
                    <TableHead className="w-10"></TableHead>
                    <TableHead className="w-16"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingK ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-xs text-muted-foreground py-6 border-b-0">Nalaganje...</TableCell></TableRow>
                  ) : !kategorije?.length ? (
                    <TableRow><TableCell colSpan={3} className="text-center text-xs text-muted-foreground py-6 border-b-0">Ni kategorij.</TableCell></TableRow>
                  ) : kategorije?.map(k => (
                    <TableRow key={k.id} className="border-b-0 hover:bg-muted/50 group">
                      <TableCell className="font-medium py-1.5 px-2.5">
                        <div className="flex items-center gap-2">
                          <div className="w-2.5 h-2.5 rounded-full shrink-0 shadow-sm border border-black/10" style={{ backgroundColor: k.barva }} />
                          <span className="text-sm">{k.ime}</span>
                        </div>
                      </TableCell>
                      <TableCell className="text-center text-muted-foreground text-xs py-1.5 px-1">
                        {k.vrstniRed}
                      </TableCell>
                      <TableCell className="text-right py-1.5 px-2">
                        {!jeUporabnik && (
                          <div className="flex justify-end gap-0.5 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" aria-label={`Uredi kategorijo ${k.ime}`} onClick={() => openEditCat(k)}>
                              <Pencil className="w-3 h-3" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive" aria-label={`Izbriši kategorijo ${k.ime}`} onClick={() => handleDelKat(k.id)}>
                              <Trash2 className="w-3 h-3" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </Card>
          </TabsContent>

          {/* Modifikatorji Tab */}
          <TabsContent value="modifikatorji" className="absolute inset-0 m-0 h-full flex flex-col data-[state=active]:flex outline-none">
            <ModifikatorjePanel jeUporabnik={jeUporabnik} />
          </TabsContent>

          {/* Artikli Tab */}
          <TabsContent value="artikli" className="absolute inset-0 m-0 h-full flex flex-col data-[state=active]:flex outline-none">
            <Card className="flex flex-col flex-1 border-border/50 shadow-sm overflow-hidden bg-card h-full">
              <div className="px-1.5 sm:px-3 py-1.5 sm:py-2 border-b border-border/50 bg-muted/30 flex flex-col gap-1 sm:gap-2">
              <div className="flex justify-between items-center gap-2">
                <h2 className="hidden sm:flex font-medium text-sm tracking-tight text-foreground items-center gap-1.5">
                  <PackageOpen className="w-4 h-4 text-muted-foreground" />
                  Artikli
                </h2>
                {!jeUporabnik && (
                   <div className="grid grid-cols-5 sm:flex items-center gap-0.5 w-full sm:w-auto sm:ml-auto">
                     <Button size="sm" variant="ghost" className="h-7 sm:h-8 w-full sm:w-auto px-0.5 sm:px-2 text-[9px] sm:text-xs text-muted-foreground hover:text-foreground" aria-label="Uskladi DDV" onClick={() => setUskladiOpen(true)}>
                       <SlidersHorizontal className="hidden sm:block w-3.5 h-3.5 sm:mr-1.5" /><span>Uskladi DDV</span>
                    </Button>
                     <Button size="sm" variant="ghost" className="h-7 sm:h-8 w-full sm:w-auto px-0.5 sm:px-2 text-[9px] sm:text-xs text-muted-foreground hover:text-foreground" aria-label="Izvozi Excel" onClick={handleIzvozi} disabled={izvozLoading}>
                       <FileDown className="hidden sm:block w-3.5 h-3.5 sm:mr-1.5" /><span>{izvozLoading ? "Izvažam..." : "Excel"}</span>
                    </Button>
                     <Button size="sm" variant="ghost" className="h-7 sm:h-8 w-full sm:w-auto px-0.5 sm:px-2 text-[9px] sm:text-xs text-muted-foreground hover:text-foreground" aria-label="Izvozi cenik PDF" onClick={handleCenikPdf} disabled={cenikPdfLoading}>
                       <FileDown className="hidden sm:block w-3.5 h-3.5 sm:mr-1.5" /><span>{cenikPdfLoading ? "Izvažam..." : "Cenik PDF"}</span>
                    </Button>
                     <Button size="sm" variant="ghost" className="h-7 sm:h-8 w-full sm:w-auto px-0.5 sm:px-2 text-[9px] sm:text-xs text-muted-foreground hover:text-foreground" aria-label="Uvozi artikle" onClick={() => { resetUvoz(); setUvozOpen(true); }}>
                       <Upload className="hidden sm:block w-3.5 h-3.5 sm:mr-1.5" /><span>Uvozi</span>
                    </Button>
                     <Button size="sm" className="h-7 sm:h-8 w-full sm:w-auto px-0.5 sm:px-3 text-[9px] sm:text-xs sm:ml-1" aria-label="Nov artikel" onClick={openNewArt}>
                       <Plus className="hidden sm:block w-3.5 h-3.5 sm:mr-1.5" /><span>Nov artikel</span>
                    </Button>
                  </div>
                )}
              </div>
              <div className="flex flex-col sm:flex-row gap-1.5">
                <div className="grid grid-cols-3 sm:flex gap-1 rounded-lg border-2 border-primary/30 bg-background p-1 shadow-sm shrink-0">
                  {(["vsi", "prodajni", "nabavni", "embalaza", "zNormativom", "brezNormativa", "brezSlike"] as const).map(f => (
                    <button
                      key={f}
                      onClick={() => setArtFilter(f)}
                       className={`min-w-0 min-h-9 rounded-md px-1.5 sm:px-3 py-1.5 text-[11px] sm:text-xs whitespace-nowrap font-semibold transition-all ${
                         artFilter === f
                           ? "bg-primary text-primary-foreground shadow-sm"
                           : "bg-muted/60 text-foreground hover:bg-muted"
                       }`}
                    >
                      {f === "vsi" ? "Vsi" : f === "prodajni" ? "Prodajni" : f === "nabavni" ? "Nabavni" : f === "embalaza" ? "Embalaža" : f === "zNormativom" ? "Z normativom" : f === "brezNormativa" ? "Brez normativa" : "Brez slike"}
                    </button>
                  ))}
                </div>
                <div className="relative flex-1">
                  <div className="relative min-w-0 flex-1">
                    <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-muted-foreground pointer-events-none" />
                    <KlavijaturaInput
                      ref={artSearchRef}
                      value={artSearch}
                      onChange={setArtSearch}
                      placeholder="Iskanje artiklov..."
                      naslov="Iskanje"
                       className="pl-8 pr-8 h-7 sm:h-8 text-xs bg-background border-border/50"
                    />
                    {artSearch && (
                      <button
                        type="button"
                        onClick={() => { setArtSearch(""); artSearchRef.current?.focus(); }}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground p-1"
                        aria-label="Počisti iskanje"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-0 scrollbar-hidden">
              <Table className="table-fixed w-full min-w-0">
                <TableHeader className="bg-muted/10 sticky top-0 z-10 shadow-sm">
                  <TableRow className="border-b border-border/50">
                    <TableHead className="w-[30%] text-xs font-medium h-8 py-0 px-2">Kategorija</TableHead>
                    <TableHead className="hidden lg:table-cell w-[18%] text-xs font-medium h-9 py-0">DDV</TableHead>
                    <TableHead className="w-[26%] text-right text-xs font-medium h-8 py-0 pr-2">Cena</TableHead>
                    <TableHead className="w-[20%] text-center text-xs font-medium h-8 py-0 px-1">Status</TableHead>
                    <TableHead className="w-[14%] h-8 py-0 px-1"></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {loadingA ? (
                    <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4 border-b-0">Nalaganje...</TableCell></TableRow>
                  ) : (() => {
                      const q = artSearch.toLowerCase();
                      const filtered = (artikli ?? [])
                        .filter(a => articleMatchesListFilter(a, artFilter))
                        .filter(a => !q || a.ime.toLowerCase().includes(q) || (a.imeZaNabavo ?? "").toLowerCase().includes(q))
                        .sort((a, b) => a.ime.localeCompare(b.ime, "sl"));
                      if (!filtered.length) return (
                        <TableRow><TableCell colSpan={5} className="text-center text-xs text-muted-foreground py-4 border-b-0">Ni zadetkov</TableCell></TableRow>
                      );
                      return filtered.flatMap(a => [
                    <TableRow
                      key={`${a.id}-naziv`}
                      ref={a.id === editingArt?.id ? selectedArtRowRef : undefined}
                      className={[!a.aktiven ? "opacity-60" : "", a.id === editingArt?.id ? "bg-muted/30" : "", "border-b-0 hover:bg-transparent group"].join(" ").trim()}
                    >
                      <TableCell colSpan={5} className="font-medium min-w-0 pt-2 pb-0.5 px-2.5 sm:px-4">
                        <div className="flex min-w-0 items-start gap-2 leading-tight">
                          {a.barva && <div className="w-2.5 h-2.5 mt-1 rounded-full shrink-0 shadow-sm border border-black/10" style={{ backgroundColor: a.barva }} />}
                          <div className="flex min-w-0 flex-wrap items-center gap-1.5 whitespace-normal">
                            <span className="shrink-0 text-sm font-semibold">{a.ime}</span>
                              {a.povratnaEmbalaza ? (
                                <Badge variant="outline" className="h-4 border-amber-200 bg-amber-50/50 px-1 py-0 text-[9px] font-medium uppercase tracking-wider text-amber-700">
                                  embalaža
                                </Badge>
                              ) : (
                                <>
                                  {a.prodajniArtikel && <Badge variant="outline" className="text-[9px] font-medium px-1 py-0 h-4 uppercase tracking-wider text-muted-foreground bg-muted/20 border-border/50">prodajni</Badge>}
                                  {a.nabavniArtikel && <Badge variant="outline" className="text-[9px] font-medium px-1 py-0 h-4 uppercase tracking-wider border-blue-200 text-blue-700 bg-blue-50/50">nabavni</Badge>}
                                </>
                              )}
                              {a.hasNormativ && <Badge variant="outline" className="text-[9px] font-medium px-1 py-0 h-4 uppercase tracking-wider border-amber-200 text-amber-700 bg-amber-50/50">normativ</Badge>}
                              {!a.povratnaEmbalaza && (() => {
                                const vrsta = (a as typeof a & { vrstaArtikla?: string }).vrstaArtikla ?? DEFAULT_NEW_SALES_ARTICLE_TYPE;
                                const cfg = vrsta === "blago"
                                  ? "border-green-200 text-green-700 bg-green-50/50"
                                  : vrsta === "material"
                                    ? "border-sky-200 text-sky-700 bg-sky-50/50"
                                    : "border-slate-200 text-slate-600 bg-slate-50/50";
                                return <Badge variant="outline" className={`text-[9px] font-medium px-1 py-0 h-4 uppercase tracking-wider ${cfg}`}>{vrsta}</Badge>;
                              })()}
                              {(a as typeof a & { modSkupine?: ModSkupinaFull[] }).modSkupine?.map(s => (
                                <Badge key={s.id} variant="outline" className={`text-[9px] font-medium px-1 py-0 h-4 uppercase tracking-wider ${s.obvezna ? "border-red-200 text-red-700 bg-red-50/50" : "border-purple-200 text-purple-700 bg-purple-50/50"}`}>
                                  {s.ime}
                                </Badge>
                              ))}
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>,
                    <TableRow
                      key={`${a.id}-podatki`}
                      className={[!a.aktiven ? "opacity-60" : "", a.id === editingArt?.id ? "bg-muted/30" : "", "border-b border-border/50 hover:bg-transparent group"].join(" ").trim()}
                    >
                      <TableCell className="w-[30%] py-1 px-2.5 sm:px-4 whitespace-nowrap">
                        <div className="flex min-w-0 items-center gap-1.5 overflow-hidden whitespace-nowrap">
                          {kategorije?.find(k => k.id === a.kategorijaId) && (
                            <div
                              className="w-2 h-2 rounded-full shrink-0 shadow-sm border border-black/10"
                              style={{ backgroundColor: kategorije.find(k => k.id === a.kategorijaId)!.barva }}
                            />
                          )}
                          <span className="truncate text-xs text-muted-foreground">{a.kategorijaIme || "Ni kategorije"}</span>
                        </div>
                      </TableCell>
                      <TableCell className="hidden lg:table-cell w-[18%] py-1 px-2">
                        <div className="flex flex-col gap-0.5 text-[10px] text-muted-foreground">
                          {a.prodajniArtikel && (
                            <span className="whitespace-nowrap flex items-center gap-1">
                              {a.nabavniArtikel && <span className="uppercase tracking-wider opacity-60">prod.</span>}
                              <span className="font-mono">{a.davek}%</span>
                            </span>
                          )}
                          {a.nabavniArtikel && (
                            <span className="whitespace-nowrap flex items-center gap-1">
                              {a.prodajniArtikel && <span className="uppercase tracking-wider opacity-60">nab.</span>}
                              <span className="font-mono">{pricakovanaNabavnaDdv(
                                ((a as typeof a & { taxCategory?: string }).taxCategory ?? "food") as Parameters<typeof pricakovanaNabavnaDdv>[0],
                                Boolean((a as typeof a & { addedSugar?: boolean }).addedSugar)
                              )}%</span>
                            </span>
                          )}
                        </div>
                      </TableCell>
                      <TableCell className="w-[26%] text-right font-medium whitespace-nowrap py-1 px-2 sm:px-4">
                        {(() => {
                          const prices: { field: InlinePriceField; label: string; value: number }[] = [
                            ...(a.jePica ? [{ field: "osnovna" as const, label: "Norm.", value: a.cena }] : [{ field: "osnovna" as const, label: "", value: a.cena }]),
                            ...(a.jePica && a.cenaMala != null ? [{ field: "mala" as const, label: "Mala", value: a.cenaMala }] : []),
                            ...(a.jePica && a.cenaDruzinska != null ? [{ field: "druzinska" as const, label: "Druž.", value: a.cenaDruzinska }] : []),
                          ];
                          return (
                            <div className="flex flex-col items-end gap-0.5">
                              {prices.map(price => {
                                const canEditPrice = a.prodajniArtikel && !jeUporabnik;
                                const isEditing = canEditPrice && editingPrice?.id === a.id && editingPrice.field === price.field;
                                const priceContent = (
                                  <div className="flex items-baseline justify-end gap-1.5">
                                    {price.label && <span className="text-[10px] font-normal uppercase tracking-wider text-muted-foreground/70">{price.label}</span>}
                                    <span className="text-sm font-mono tracking-tight text-foreground">{price.value.toFixed(2)} €</span>
                                  </div>
                                );
                                if (isEditing) {
                                  return (
                                    <div key={price.field} className="flex items-center justify-end gap-1.5">
                                      {price.label && <span className="text-[10px] font-normal uppercase tracking-wider text-muted-foreground/70">{price.label}</span>}
                                      <DecimalInput
                                        value={editingPriceVal}
                                        autoFocus
                                        className="h-6 w-20 px-1.5 py-0 text-right text-sm font-mono bg-background border-primary ring-offset-0 focus-visible:ring-1 focus-visible:ring-primary shadow-sm"
                                        aria-label={`Uredi ${price.label ? `${price.label.toLowerCase()} ` : ""}ceno za ${a.ime}`}
                                        onChange={e => setEditingPriceVal(e.target.value)}
                                        onBlur={() => savePriceInline(a, price.field)}
                                        onKeyDown={e => {
                                          if (e.key === "Enter") savePriceInline(a, price.field);
                                          if (e.key === "Escape") setEditingPrice(null);
                                        }}
                                      />
                                    </div>
                                  );
                                }
                                if (!canEditPrice) {
                                  return <div key={price.field}>{priceContent}</div>;
                                }
                                return (
                                  <button
                                    key={price.field}
                                    type="button"
                                    className="cursor-pointer bg-transparent p-0 text-right transition-colors hover:text-primary hover:bg-muted/50 rounded -mx-1 px-1 -my-0.5 py-0.5"
                                    title="Klikni za spremembo cene"
                                    aria-label={`Uredi ${price.label ? `${price.label.toLowerCase()} ` : ""}ceno za ${a.ime}`}
                                    onClick={() => {
                                      setEditingPrice({ id: a.id, field: price.field });
                                      setEditingPriceVal(String(price.value));
                                    }}
                                  >
                                    {priceContent}
                                  </button>
                                );
                              })}
                            </div>
                          );
                        })()}
                      </TableCell>
                      <TableCell className="w-[20%] text-center py-1 px-1">
                        {!(a.nabavniArtikel && !a.prodajniArtikel) && (
                          a.aktiven
                            ? <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 uppercase tracking-wider border-green-200 text-green-700 bg-green-50/50">Aktiven</Badge>
                            : <Badge variant="outline" className="text-[9px] px-1 py-0 h-4 uppercase tracking-wider border-muted-foreground/30 text-muted-foreground bg-muted/30">Neaktiven</Badge>
                        )}
                      </TableCell>
                      <TableCell className="w-[14%] pr-1 sm:pr-3 pl-0 py-1 text-right whitespace-nowrap">
                        {!jeUporabnik && (
                          <div className="flex items-center justify-end gap-0.5 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-muted-foreground hover:text-foreground" aria-label={`Uredi artikel ${a.ime}`} onClick={() => openEditArt(a)}>
                              <Pencil className="w-3.5 h-3.5" />
                            </Button>
                            <Button variant="ghost" size="icon" className="h-8 w-8 text-destructive/70 hover:text-destructive" aria-label={`Izbriši artikel ${a.ime}`} onClick={() => setPreDelConfirmId(a.id)}>
                              <Trash2 className="w-3.5 h-3.5" />
                            </Button>
                          </div>
                        )}
                      </TableCell>
                    </TableRow>,
                      ]);
                    })()}
                </TableBody>
              </Table>
            </div>
          </Card>
          </TabsContent>
        </div>
      </Tabs>

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
                  <SelectItem value="hrana">Hrana</SelectItem>
                  <SelectItem value="pijaca">Pijača</SelectItem>
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
              {isPendingCat ? "Shranjujem..." : <>{catMode === "uredi" ? "Posodobi" : "Dodaj kategorijo"} <kbd className="ml-1 text-[10px] font-mono opacity-60 border border-current/40 rounded px-0.5 leading-none">F2</kbd></>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Artikel dialog ────────────────────────────────── */}
      <Dialog open={artDialogOpen} onOpenChange={handleArtDialogOpenChange}>
        <DialogContent
          ref={artDialogRef}
          className="w-[calc(100vw-2rem)] sm:max-w-2xl max-h-[90vh] flex flex-col overflow-hidden"
          onEscapeKeyDown={(event) => {
            if (eslogUnitPickerOpen) {
              event.preventDefault();
              setEslogUnitPickerOpen(false);
            } else if (normativDropdownIdx !== null) {
              event.preventDefault();
              setNormativDropdownIdx(null);
              setNormativDropdownFilter("");
              setNormativDropdownHighlight(0);
              setNormativDropdownPos(null);
            }
          }}
          onPointerDownOutside={(event) => {
            // Obrazec artikla vsebuje veliko polj in lahko ostane odprt dlje časa.
            // Periodični globalni portali (CTI, obvestila ipd.) ne smejo povzročiti
            // izgube celotnega neshranjenega vnosa.
            event.preventDefault();
          }}
          onInteractOutside={(event) => {
            event.preventDefault();
          }}
        >
          <DialogHeader>
            <DialogTitle>{artMode === "uredi" ? "Uredi artikel" : "Nov artikel"}</DialogTitle>
          </DialogHeader>
          <div ref={artDialogBodyRef} className="flex-1 min-h-0 overflow-y-auto">
            <div className="space-y-4 pt-2 pb-2 pr-4">
              {proposalDraft && proposalDraft.artikelId === editingArt?.id && (
                <NormativeProposalReview
                  draft={proposalDraft}
                  confirmedTokens={proposalConfirmations}
                  loading={proposalApplying}
                  staleMessage={proposalStaleMessage}
                  onConfirmationChange={(token, checked) => setProposalConfirmations(previous => {
                    const next = new Set(previous);
                    if (checked) next.add(token); else next.delete(token);
                    return next;
                  })}
                  onApply={() => void applyProposalDraft()}
                  onCancel={cancelProposalDraft}
                />
              )}

              <Tabs defaultValue="osnovno" value={artDialogTab} onValueChange={setArtDialogTab} className="flex flex-col w-full">
                <div className="pb-2">
                  <TabsList className="grid h-auto w-full grid-cols-3 gap-1 rounded-lg bg-muted p-1 sm:grid-cols-5">
                    <TabsTrigger value="osnovno" className="border-2 border-border bg-background px-2 py-2 text-[11px] font-semibold data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground sm:text-xs">Osnovno</TabsTrigger>
                    <TabsTrigger value="cena_ddv" className="border-2 border-border bg-background px-2 py-2 text-[11px] font-semibold data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground sm:text-xs">Cena in DDV</TabsTrigger>
                    <TabsTrigger
                      value="normativ"
                      disabled={artNabavniArtikel && !artProdajniArtikel}
                      title={artNabavniArtikel && !artProdajniArtikel ? "Normativ ni pomemben za samo nabavni artikel." : undefined}
                      className="border-2 border-border bg-background px-2 py-2 text-[11px] font-semibold data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground disabled:cursor-not-allowed disabled:border-muted disabled:bg-muted disabled:text-muted-foreground disabled:opacity-50 sm:text-xs"
                    >
                      Normativ
                    </TabsTrigger>
                    <TabsTrigger value="alergeni" className="border-2 border-border bg-background px-2 py-2 text-[11px] font-semibold data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground sm:text-xs">Alergeni</TabsTrigger>
                    <TabsTrigger
                      value="slika"
                      disabled={artNabavniArtikel && !artProdajniArtikel}
                      title={artNabavniArtikel && !artProdajniArtikel ? "Slika ni pomembna za samo nabavni artikel." : undefined}
                      className="border-2 border-border bg-background px-2 py-2 text-[11px] font-semibold data-[state=active]:border-primary data-[state=active]:bg-primary data-[state=active]:text-primary-foreground disabled:cursor-not-allowed disabled:border-muted disabled:bg-muted disabled:text-muted-foreground disabled:opacity-50 sm:text-xs"
                    >
                      Slika
                    </TabsTrigger>
                  </TabsList>
                </div>

                <TabsContent value="osnovno" className="mt-4 space-y-4 focus-visible:outline-none">
              {/* Ime za prodajo */}
              <div className="space-y-2 rounded-lg border-2 border-border/80 bg-card p-3 shadow-sm">
                <Label>{artPovratnaEmbalaza ? "Naziv embalaže" : "Ime za prodajo"}</Label>
                <KlavijaturaInput value={artName} onChange={handleArtNameChange} placeholder="Npr. Espresso" naslov="Ime artikla" />
              </div>

                            {/* Tip artikla */}
              <div className="space-y-2 rounded-lg border-2 border-border/80 bg-card p-3 shadow-sm">
                <Label>Tip artikla</Label>
                <div className="flex flex-wrap gap-4 rounded-lg border-2 border-primary/20 bg-primary/[0.03] p-3">
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={artProdajniArtikel}
                      disabled={artPovratnaEmbalaza}
                      onChange={e => setArtProdajniArtikel(e.target.checked)}
                      className="w-4 h-4 accent-primary disabled:opacity-50"
                    />
                    <span className="text-sm font-medium">Prodajni artikel</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={artNabavniArtikel}
                      disabled={artPovratnaEmbalaza}
                      onChange={e => {
                        setArtNabavniArtikel(e.target.checked);
                        if (e.target.checked && !artImeZaNabavo) {
                          setArtImeZaNabavo(artName);
                        }
                      }}
                      className="w-4 h-4 accent-primary disabled:opacity-50"
                    />
                    <span className="text-sm font-medium">Nabavni artikel</span>
                  </label>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input
                      type="checkbox"
                      checked={artPovratnaEmbalaza}
                      onChange={e => {
                        const checked = e.target.checked;
                        setArtPovratnaEmbalaza(checked);
                        if (checked) {
                          setArtNabavniArtikel(true);
                          setArtProdajniArtikel(false);
                          setArtVrstaArtikla("material");
                          setArtTaxCategory("other");
                          setArtAddedSugar(false);
                          setArtPrice("0");
                          setArtCat("");
                          if (!artImeZaNabavo) setArtImeZaNabavo(artName);
                        }
                      }}
                      className="w-4 h-4 accent-amber-600"
                    />
                    <span className="text-sm font-medium">Povratna embalaža</span>
                  </label>
                </div>
                {artPovratnaEmbalaza && (
                  <div className="grid gap-3 rounded-lg border-2 border-amber-200 bg-amber-50 p-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label>Vrsta embalaže</Label>
                      <Select
                        value={artVrstaEmbalaze}
                        onValueChange={value => setArtVrstaEmbalaze(value as typeof artVrstaEmbalaze)}
                      >
                        <SelectTrigger className="border-amber-300 bg-background">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="steklenica">Steklenica</SelectItem>
                          <SelectItem value="zaboj">Zaboj</SelectItem>
                          <SelectItem value="keg">Sod (keg)</SelectItem>
                          <SelectItem value="balon">Balon</SelectItem>
                          <SelectItem value="drugo">Drugo</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="space-y-2">
                      <Label>Depozitna vrednost / kos</Label>
                      <DecimalInput
                        value={artDepozitnaVrednost}
                        onChange={event => setArtDepozitnaVrednost(event.target.value)}
                        className="border-amber-300 bg-background"
                      />
                      <p className="text-xs text-amber-900">Za evidenčno embalažo vnesite 0.</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Skupina (opcijsko) */}
              {!(artNabavniArtikel && !artProdajniArtikel) && (
                <div className="space-y-2 rounded-lg border-2 border-border/80 bg-card p-3 shadow-sm">
                  <Label>Skupina <span className="text-muted-foreground font-normal text-xs">(opcijsko — za združitev v naročilu)</span></Label>
                  <KlavijaturaInput value={artSkupina} onChange={setArtSkupina} placeholder="Npr. Čaj" naslov="Skupina" />
                </div>
              )}

              {/* Nabavni podatki (pogojno) */}
              {artNabavniArtikel && (
                <div className="space-y-3 rounded-lg border-2 border-blue-300 bg-blue-50 p-3 shadow-sm">
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
                    <Label htmlFor="artikel-enota-mere">Enota mere (e-SLOG)</Label>
                    <EslogUnitPicker
                      id="artikel-enota-mere"
                      value={artEnotaMere}
                      onChange={setArtEnotaMere}
                      open={eslogUnitPickerOpen}
                      onOpenChange={setEslogUnitPickerOpen}
                    />
                  </div>
                  {lahkoJeSkupinskiNabavniArtikel && (
                    <label className="flex items-start gap-2 rounded-md border border-blue-200 bg-white/70 p-2 text-sm">
                      <input
                        type="checkbox"
                        checked={artJeSkupinskiNabavniArtikel}
                        onChange={e => setArtJeSkupinskiNabavniArtikel(e.target.checked)}
                        className="mt-0.5 h-4 w-4 accent-primary"
                        data-testid="checkbox-group-purchase-article"
                      />
                      <span>
                        <span className="font-medium">Skupinski nabavni artikel</span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          Uporabite za združevanje dobaviteljevih nazivov z isto e-SLOG enoto ({artEnotaMere}).
                        </span>
                      </span>
                    </label>
                  )}
                </div>
              )}

              {/* Kategorija — samo za prodajne artikle */}
              {!(artNabavniArtikel && !artProdajniArtikel) && (
                <div className="space-y-2 rounded-lg border-2 border-border/80 bg-card p-3 shadow-sm">
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

                </TabsContent>

                <TabsContent value="cena_ddv" className="mt-4 space-y-4 focus-visible:outline-none">
              {/* Cena */}
              {!(artNabavniArtikel && !artProdajniArtikel) && (
                <div className="flex flex-row items-end gap-4">
                  <div className="min-w-0 flex-1 space-y-2">
                    <Label>{artJePica ? "Cena normalne / osnovne pice (€)" : "Cena (€)"}</Label>
                    <KlavijaturaInput value={artPrice} onChange={setArtPrice} placeholder="2.50" naslov="Cena (€)" inputMode="decimal" />
                  </div>
                  {artJePica && picaMalaAktivna && (
                    <div className="min-w-0 flex-1 space-y-2">
                      <Label>Cena male pice (€) *</Label>
                      <KlavijaturaInput value={artCenaMala} onChange={setArtCenaMala} placeholder="2.50" naslov="Cena male pice (€)" inputMode="decimal" />
                    </div>
                  )}
                  {artJePica && picaDruzinskaAktivna && (
                    <div className="min-w-0 flex-1 space-y-2">
                      <Label>Cena družinske pice (€) *</Label>
                      <KlavijaturaInput value={artCenaDruzinska} onChange={setArtCenaDruzinska} placeholder="2.50" naslov="Cena družinske pice (€)" inputMode="decimal" />
                    </div>
                  )}
                </div>
              )}
              {artJePica && (picaMalaAktivna || picaDruzinskaAktivna) && (
                <p className="text-xs text-muted-foreground">
                  Cena je obvezna za vsako velikost, ki ima v nastavitvah vnesen premer.
                </p>
              )}

              {/* Happy Hour cena — samo za prodajne artikle */}
              {artProdajniArtikel && (
                <div className="space-y-2 rounded-lg border-2 border-amber-300 bg-amber-50/50 p-3 shadow-sm">
                  <div className="flex items-center gap-2">
                    <Sparkles className="w-4 h-4 text-amber-500" />
                    <Label className="font-semibold text-amber-900">Happy Hour cena</Label>
                  </div>
                  <p className="text-xs text-muted-foreground">
                    {artJePica ? "Vnesite posebno ceno samo za velikosti pice, ki naj imajo Happy Hour. Ostale pustite prazne." : "Cena, ki velja med Happy Hour urami. Pusti prazno, če artikel ni del Happy Hour."}
                  </p>
                  <div className={artJePica ? "grid gap-2 sm:grid-cols-3" : ""}>
                    {([
                      ["Normalna", artHappyHourCena, setArtHappyHourCena],
                      ...(artJePica && picaMalaAktivna ? [["Mala", artHappyHourCenaMala, setArtHappyHourCenaMala] as const] : []),
                      ...(artJePica && picaDruzinskaAktivna ? [["Družinska", artHappyHourCenaDruzinska, setArtHappyHourCenaDruzinska] as const] : []),
                    ] as const).map(([naziv, value, setter]) => (
                      <label key={naziv} className="space-y-1">
                        {artJePica && <span className="text-xs font-medium text-amber-900">{naziv}</span>}
                        <div className="flex items-center gap-2">
                          <input type="number" min="0" step="0.01" value={value}
                            onChange={e => setter(e.target.value)} placeholder="npr. 2.50"
                            className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring" />
                          <span className="shrink-0 text-sm text-muted-foreground">€</span>
                        </div>
                      </label>
                    ))}
                  </div>
                </div>
              )}

              {/* DDV kategorija + stopnje glede na tip artikla */}
              <div className="grid grid-cols-1 gap-4 items-start sm:grid-cols-2">
                {/* Levi stolpec: kategorija → stopnja(e) */}
                <div className="space-y-4">
                  <div className="space-y-2">
                    <Label>DDV kategorija</Label>
                    <Select
                      value={artTaxCategory}
                      onValueChange={v => {
                        setArtTaxCategory(v as typeof artTaxCategory);
                        if (v !== "hot_beverage" && v !== "cold_beverage") setArtJeDelMenija(false);
                        if (v !== "hot_beverage" && v !== "cold_beverage") setArtAddedSugar(false);
                      }}
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="food">Hrana — 9,5 %</SelectItem>
                        <SelectItem value="hot_beverage">Topla pijača — 22 %</SelectItem>
                        <SelectItem value="cold_beverage">Hladna pijača — 22 %</SelectItem>
                        <SelectItem value="food_drink">Pijača-jed (gosta čokolada, smoothie …) — 9,5 %</SelectItem>
                        <SelectItem value="vat_super_reduced_5">Znižana stopnja DDV — 5 %</SelectItem>
                        <SelectItem value="alcoholic">Alkohol — 22 %</SelectItem>
                        <SelectItem value="other">Ostalo — 22 %</SelectItem>
                      </SelectContent>
                    </Select>
                    <p className="text-xs text-muted-foreground">
                      {(artNabavniArtikel && !artProdajniArtikel)
                        ? "Narava blaga — za izpeljavo nabavne stopnje na prejemu"
                        : "Narava blaga in način prodaje — razreševalnik pri mizi / za s seboj"}
                    </p>
                    {artTaxCategory === "food_drink" && (
                      <p className="text-xs font-medium text-amber-700">
                        Pri kategoriji Pijača-jed dodan sladkor ne vpliva na DDV; stopnja je vedno 9,5 %.
                      </p>
                    )}
                  </div>

                  {/* Prodajna stopnja — samo za prodajne artikle */}
                  {artProdajniArtikel && (
                    <div className="space-y-2">
                      <Label>Prodajna DDV stopnja</Label>
                      <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm font-medium">
                        {(artTaxCategory === "alcoholic" ? ddvStopnje.splosnaSt : artJeDelMenija && artLahkoJeDelMenija ? ddvStopnje.nizjaSt : prodajnaDefaultDdv(artTaxCategory))} %
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Stopnja pri prodaji (pri mizi) — razreševalnik jo lahko prilagodi za s seboj
                      </p>
                    </div>
                  )}
                  {artProdajniArtikel && artLahkoJeDelMenija && (
                    <label className="flex items-start gap-3 rounded-md border p-3">
                      <input
                        type="checkbox"
                        checked={artJeDelMenija}
                        onChange={e => setArtJeDelMenija(e.target.checked)}
                        className="mt-0.5 h-4 w-4"
                      />
                      <span>
                        <span className="block text-sm font-medium">Del menija</span>
                        <span className="block text-xs text-muted-foreground">Pijača dobi 9,5 %; alkohol ostane 22 %.</span>
                      </span>
                    </label>
                  )}

                  {/* Pričakovana nabavna stopnja — samo za nabavne artikle */}
                  {artNabavniArtikel && (
                    <div className="space-y-2">
                      <Label>Pričakovana nabavna stopnja</Label>
                      <div className="flex h-9 items-center rounded-md border border-input bg-muted px-3 text-sm font-medium">
                        {pricakovanaNabavnaDdv(artTaxCategory, artAddedSugar)} %
                      </div>
                      <p className="text-xs text-muted-foreground">
                        Dobaviteljeva stopnja na prejemu — izpeljano iz kategorije
                      </p>
                    </div>
                  )}
                </div>

                {/* Desni stolpec: dodan sladkor (samo za pijače) */}
                {(artTaxCategory === "hot_beverage" || artTaxCategory === "cold_beverage") && (
                  <div className="flex items-start gap-3 sm:pt-8">
                    <input
                      type="checkbox"
                      id="artAddedSugar"
                      checked={artAddedSugar}
                      onChange={e => setArtAddedSugar(e.target.checked)}
                      className="w-4 h-4 mt-0.5"
                    />
                    <Label htmlFor="artAddedSugar" className="cursor-pointer leading-tight">
                      Vsebuje dodan sladkor
                      <span className="block text-xs font-normal text-muted-foreground">
                        {artTaxCategory === "cold_beverage"
                          ? "22 % pri mizi in za s seboj (brez kljukice: 22 % pri mizi, 9,5 % za s seboj)"
                          : artNabavniArtikel && !artProdajniArtikel
                            ? "Nabavna stopnja: 22 % (z dodanim sladkorjem), 9,5 % (brez)"
                            : "Za s seboj ostane 22 % (brez kljukice: odvisno od nastavitve)"}
                      </span>
                    </Label>
                  </div>
                )}
              </div>

              {/* Je pica — bon za pico */}
              {piceOmogocene && !(artNabavniArtikel && !artProdajniArtikel) && (
                <div className="flex items-center gap-3 rounded-lg border border-orange-200 bg-orange-50 p-3">
                  <input
                    type="checkbox"
                    id="artJePica"
                    checked={artJePica}
                    onChange={e => handleArtJePicaChange(e.target.checked)}
                    className="w-4 h-4 accent-orange-500"
                  />
                  <Label htmlFor="artJePica" className="cursor-pointer flex items-center gap-2">
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
                        {!c && <X className="w-3 h-3 text-gray-400 m-auto" />}
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

                </TabsContent>

                <TabsContent value="normativ" className="mt-4 space-y-4 focus-visible:outline-none">
              {(
                (!artProdajniArtikel && !artNabavniArtikel)
                || (artCat && kategorije?.find(k => k.id === parseInt(artCat))?.tip === "hrana")
              ) && (
                <div className="space-y-2 rounded-lg border p-3">
                  <Label className="font-semibold">Način priprave (operativno)</Label>
                  <p className="text-xs text-muted-foreground mb-2">
                    Določi kako se vodi zaloga in normativa na ravni kuhinje.
                  </p>
                  <div className="flex flex-col gap-2">
                    <button
                      type="button"
                      onClick={() => {
                        if (artMealType !== "ala_carte") setNormativItems([]);
                        setArtMealType("ala_carte");
                      }}
                      className={`py-2 px-3 rounded-md text-sm font-medium border text-left transition-colors ${
                        artMealType === "ala_carte"
                          ? "bg-primary/10 text-primary border-primary"
                          : "bg-background border-input hover:bg-muted/70 text-muted-foreground"
                      }`}
                    >
                      <span className="block font-bold mb-0.5">A la carte (sproti)</span>
                      <span className="block text-xs font-normal opacity-80">Pripravljeno sproti ob naročilu iz osnovnih surovin.</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (artMealType !== "prepared") setNormativItems([]);
                        setArtMealType("prepared");
                      }}
                      className={`py-2 px-3 rounded-md text-sm font-medium border text-left transition-colors ${
                        artMealType === "prepared"
                          ? "bg-primary/10 text-primary border-primary"
                          : "bg-background border-input hover:bg-muted/70 text-muted-foreground"
                      }`}
                    >
                      <span className="block font-bold mb-0.5">Pripravljena hrana (zaloga)</span>
                      <span className="block text-xs font-normal opacity-80">Skuhano vnaprej in zamrznjeno/shranjeno. Normativ so osnovne surovine.</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (artMealType !== "composite") setNormativItems([]);
                        setArtMealType("composite");
                      }}
                      className={`py-2 px-3 rounded-md text-sm font-medium border text-left transition-colors ${
                        artMealType === "composite"
                          ? "bg-primary/10 text-primary border-primary"
                          : "bg-background border-input hover:bg-muted/70 text-muted-foreground"
                      }`}
                    >
                      <span className="block font-bold mb-0.5">Sestavljeno (kombinirano)</span>
                      <span className="block text-xs font-normal opacity-80">Normativ sestavljajo drugi kulinarični artikli (ala carte ali pripravljena hrana).</span>
                    </button>
                  </div>
                </div>
              )}

              {/* Celoten urejevalnik je viden le za obstoječo ali izrecno aktivirano menijsko ovojnico. */}
              {editingArt && artProdajniArtikel && multicourseEditorEnabled && (
                <MulticourseMenuEditor
                  menuArtikelId={editingArt.id}
                  articles={(artikli ?? []).map(article => ({
                    id: article.id,
                    ime: article.ime,
                     kategorijaId: article.kategorijaId,
                     kategorijaIme: kategorije?.find(category => category.id === article.kategorijaId)?.ime ?? null,
                    prodajniArtikel: article.prodajniArtikel,
                    nabavniArtikel: article.nabavniArtikel,
                    mealType: article.mealType,
                    taxCategory: article.taxCategory,
                  }))}
                  onSaved={() => {
                    setEditingArt(current => current ? { ...current, isMulticourseMenu: true } : current);
                    setMulticourseEditorEnabled(true);
                    setNormativNapaka(null);
                  }}
                />
              )}
              {editingArt && artProdajniArtikel && artMealType === "composite" && !multicourseEditorEnabled && (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setMulticourseEditorEnabled(true)}
                >
                  Nastavi kot večhodni meni
                </Button>
              )}

              {/* Normativ je operativna sestava in ni omejen na prodajne artikle. */}
              {canEditNormativ({ prodajniArtikel: artProdajniArtikel, mealType: artMealType }) && (
                <div className="space-y-3 rounded-lg border p-3">
                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <Label className="font-semibold">
                      {normativSectionTitle(artMealType)}
                    </Label>
                    <div className="flex gap-2">
                      {editingArt &&
                       lahkoVidiZgodovinoNormativa &&
                       artProdajniArtikel &&
                       editingArt.prodajniArtikel && (
                         <Button
                           type="button"
                           size="sm"
                           variant="outline"
                           className="text-blue-600 border-blue-200 hover:bg-blue-50"
                           disabled={
                             normativStale ||
                             editingArt.hasNormativ ||
                             normativItems.length > 0 ||
                             artName !== editingArt.ime ||
                             (editingArt.kategorijaId?.toString() ?? "") !== artCat ||
                             (editingArt.mealType ?? "ala_carte") !== artMealType
                           }
                           title={editingArt.hasNormativ || normativItems.length > 0
                             ? "Artikel že ima normativ. Pametni začetni predlog je na voljo le za prazen normativ."
                             : normativStale
                               ? "Najprej osvežite podatke normativa."
                               : artName !== editingArt.ime ||
                                 (editingArt.kategorijaId?.toString() ?? "") !== artCat ||
                                 (editingArt.mealType ?? "ala_carte") !== artMealType
                                 ? "Neshranjene spremembe najprej shranite."
                                 : undefined}
                           onClick={() => setSmartProposalDialogOpen(true)}
                         >
                           <Sparkles className="w-3 h-3 mr-1" />
                           <span>Pametni predlog</span>
                         </Button>
                       )}
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
                  {normativItems.length === 0 && !(editingArt && artJePica) ? (
                    <p className="text-sm text-muted-foreground">Ni določenih vhodnih artiklov.</p>
                  ) : (
                    <div className="space-y-2">
                      {/* Header */}
                      <div className="grid grid-cols-[minmax(0,1fr)_5rem_2rem] gap-1.5 px-1 text-xs text-muted-foreground sm:grid-cols-[minmax(0,1fr)_4rem_6rem_2rem]">
                        <span className="col-span-3 sm:col-span-1">Vhodni artikel</span>
                        <span>Enota</span>
                        <span>Kol.</span>
                        <span></span>
                      </div>
                      {normativItems.map((item, idx) => {
                        const isSelf = item.vhodniArtikelId === -1;
                        const vhodni = isSelf ? null : artikli?.find(a => a.id === item.vhodniArtikelId);
                        const selectedArtikel = isSelf ? null : (vhodni ?? null);
                        const isDropdownOpen = normativDropdownIdx === idx;
                        return (
                          <div key={idx} className="grid grid-cols-[minmax(0,1fr)_5rem_2rem] gap-1.5 items-center sm:grid-cols-[minmax(0,1fr)_4rem_6rem_2rem]">
                            {isSelf ? (
                              <div className="h-8 flex items-center px-2 rounded-md border bg-blue-50 border-blue-200 text-sm text-blue-800 font-medium">
                                Ta artikel
                              </div>
                            ) : (
                              <div className="relative col-span-3 min-w-0 sm:col-span-1">
                                <input
                                  ref={element => {
                                    if (element) normativArtInputRefs.current.set(idx, element);
                                    else normativArtInputRefs.current.delete(idx);
                                  }}
                                  className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                  placeholder="Izberi artikel"
                                  value={
                                    isDropdownOpen
                                      ? normativDropdownFilter
                                      : selectedArtikel
                                        ? `${selectedArtikel.imeZaNabavo || selectedArtikel.ime}${selectedArtikel.enotaMere ? ` (${selectedArtikel.enotaMere})` : ""}`
                                        : item.ime ?? ""
                                  }
                                  onChange={event => {
                                    if (selectedArtikel && !isDropdownOpen) return;
                                    setNormativDropdownFilter(event.target.value);
                                    setNormativDropdownHighlight(0);
                                    if (!isDropdownOpen) setNormativDropdownIdx(idx);
                                  }}
                                  readOnly={!!selectedArtikel && !isDropdownOpen}
                                  onFocus={() => {
                                    if (!isDropdownOpen) openNormativDropdown(idx);
                                  }}
                                  onClick={() => {
                                    if (!isDropdownOpen) openNormativDropdown(idx);
                                  }}
                                  onKeyDown={event => {
                                    if (selectedArtikel && !isDropdownOpen) {
                                      if (event.key === "Enter") {
                                        event.preventDefault();
                                        normativKolicinaRefs.current.get(idx)?.focus();
                                        return;
                                      }
                                      if (event.key === "Backspace" || event.key === "Delete") {
                                        event.preventDefault();
                                        clearNormativArtikel(idx);
                                      }
                                      return;
                                    }
                                    if (event.key === "Escape") {
                                      event.preventDefault();
                                      setNormativDropdownIdx(null);
                                      return;
                                    }
                                    if (event.key === "ArrowDown") {
                                      event.preventDefault();
                                      if (!isDropdownOpen) openNormativDropdown(idx);
                                      else setNormativDropdownHighlight(current =>
                                        Math.min(current + 1, Math.max(filteredNormativArtikli.length - 1, 0))
                                      );
                                      return;
                                    }
                                    if (event.key === "ArrowUp") {
                                      event.preventDefault();
                                      if (!isDropdownOpen) openNormativDropdown(idx);
                                      else setNormativDropdownHighlight(current => Math.max(current - 1, 0));
                                      return;
                                    }
                                    if (event.key === "Enter") {
                                      event.preventDefault();
                                      if (!isDropdownOpen) {
                                        openNormativDropdown(idx);
                                      } else {
                                        const highlighted = filteredNormativArtikli[normativDropdownHighlight];
                                        if (highlighted) selectNormativArtikel(idx, highlighted.id);
                                      }
                                    }
                                  }}
                                />
                              </div>
                            )}
                            <span className="text-left text-sm text-muted-foreground font-mono sm:text-center">
                              {isSelf ? (artEnotaMere ?? "—") : (vhodni?.enotaMere ?? "—")}
                            </span>
                            <DecimalInput
                              ref={element => {
                                if (element) normativKolicinaRefs.current.set(idx, element);
                                else normativKolicinaRefs.current.delete(idx);
                              }}
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
                      {editingArt && artJePica && pizzaDoughNormsQuery.isLoading && (
                        <p className="text-sm text-muted-foreground">Nalaganje hlebčkov …</p>
                      )}
                      {editingArt && artJePica && pizzaDoughNormsQuery.isError && (
                        <p className="text-sm text-destructive">
                          {pizzaDoughNormsQuery.error instanceof Error
                            ? pizzaDoughNormsQuery.error.message
                            : "Hlebčkov ni bilo mogoče naložiti."}
                        </p>
                      )}
                      {editingArt && artJePica && !pizzaDoughNormsQuery.isLoading && !pizzaDoughNormsQuery.isError && !pizzaDoughSaved && (
                        <p className="text-sm text-muted-foreground">V tej enoti še ni nastavljenih hlebčkov za pico.</p>
                      )}
                      {editingArt && artJePica && pizzaDoughSaved && (
                        <>
                          {(["normalna", "mala"] as const).map(size => (
                            <div key={size} className="grid grid-cols-[minmax(0,1fr)_5rem_2rem] gap-1.5 items-center sm:grid-cols-[minmax(0,1fr)_4rem_6rem_2rem]" data-testid={`pizza-dough-${size}`}>
                              <div className="col-span-3 min-w-0 sm:col-span-1">
                                <label htmlFor={`pizza-dough-${size}`} className="block text-xs font-medium text-muted-foreground">
                                  Hlebček · {size === "normalna" ? "normalna" : "mala"}
                                </label>
                                <select
                                  id={`pizza-dough-${size}`}
                                  aria-label={`Vhodni artikel hlebčka za ${size === "normalna" ? "normalno" : "malo"} pico`}
                                  className="h-8 w-full min-w-0 rounded-md border border-input bg-background px-2 text-sm"
                                  value={pizzaDoughSelection?.[size] ?? ""}
                                  disabled={pizzaDoughSaving}
                                  onChange={event => setPizzaDoughSelection(current =>
                                    current ? { ...current, [size]: Number(event.target.value) } : current)}
                                >
                                  <option value="" disabled>Izberi hlebček</option>
                                  {pizzaDoughChoices.map(article => (
                                    <option key={article.id} value={article.id}>{article.ime}</option>
                                  ))}
                                </select>
                              </div>
                              <span className="text-sm text-muted-foreground font-mono sm:text-center">kos</span>
                              <span className="text-right text-sm tabular-nums">1</span>
                              <span />
                            </div>
                          ))}
                          <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                            <span>En hlebček na pico. Izbira velja za vse pice v tej enoti.</span>
                            <Button type="button" size="sm" variant="outline" disabled={!pizzaDoughChanged || pizzaDoughSaving}
                              onClick={() => void savePizzaDough()}>
                              {pizzaDoughSaving ? "Shranjujem..." : "Shrani hlebčka"}
                            </Button>
                          </div>
                        </>
                      )}
                    </div>
                  )}
                </div>
              )}

              {lahkoVidiZgodovinoNormativa && artMode === "uredi" && editingArt && (
                <NormativeChangeHistoryPanel
                  items={normativeChangeHistory}
                  isLoading={normativeChangeHistoryLoading}
                  isError={normativeChangeHistoryError}
                />
              )}

                </TabsContent>

                <TabsContent value="alergeni" className="mt-4 space-y-4 focus-visible:outline-none">
              {/* Deklaracija sledi normativu, ker se alergeni dedujejo iz njegovih vhodnih artiklov. */}
              <div className="space-y-4 rounded-lg border p-4 bg-muted/10">
                <div className="flex flex-col gap-1">
                  <h3 className="text-sm font-semibold flex items-center gap-2">
                    <AlertCircle className="w-4 h-4 text-orange-500" /> Deklaracija in alergeni
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Predogled se sproti in rekurzivno izračuna iz artiklov v normativu. Ročni profil, vir in dodatna opozorila potrdite ločeno spodaj.
                  </p>
                </div>

                {loadingInheritedAlergeni && (
                  <p className="text-xs text-muted-foreground">Izračunavam alergene iz normativa…</p>
                )}
                {inheritedAlergeniError && (
                  <p className="rounded border border-orange-200 bg-orange-50 p-2 text-xs text-orange-800">
                    {inheritedAlergeniError}
                  </p>
                )}

                {inheritedAlergeni && (
                  <div className="space-y-3 rounded-md border bg-background p-3">
                    <div className="flex justify-between items-center">
                      <div>
                        <h4 className="font-semibold text-sm">Samodejno dedovani profil iz normativa</h4>
                        <p className={`text-xs ${inheritedAlergeni.potrjen || imaIzrecnoPotrjenProfil ? "text-emerald-700" : "text-orange-700"}`}>
                          {inheritedAlergeni.potrjen
                            ? "Vsi vhodni profili so preverjeni."
                            : imaIzrecnoPotrjenProfil
                              ? "Artikel ima veljaven neposredno potrjen profil; opozorila normativa ga ne razveljavijo."
                              : "Pred shranjevanjem preverite spodnja opozorila."}
                        </p>
                      </div>
                      {editingArt && (
                        <Button type="button" variant="outline" size="sm" asChild>
                          <a href={`${import.meta.env.BASE_URL}api/artikli/${editingArt.id}/alergeni-normativ.pdf`} target="_blank" rel="noreferrer">
                            <FileDown className="w-3.5 h-3.5 mr-1" />
                            PDF Normativ
                          </a>
                        </Button>
                      )}
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      <div className="rounded border p-2">
                        <p className="text-xs font-medium mb-1">Vsebuje</p>
                        <p className="text-xs text-muted-foreground">
                          {inheritedAlergeni.alergeni.length > 0
                            ? inheritedAlergeni.alergeni.map(item => item.naziv).join(", ")
                            : "Ni dedovanih alergenov."}
                        </p>
                      </div>
                      <div className="rounded border p-2">
                        <p className="text-xs font-medium mb-1">Lahko vsebuje sledi</p>
                        <p className="text-xs text-muted-foreground">
                          {inheritedAlergeni.alergeniSledi.length > 0
                            ? inheritedAlergeni.alergeniSledi.map(item => item.naziv).join(", ")
                            : "Ni dedovanih sledi."}
                        </p>
                      </div>
                    </div>
                    {!imaIzrecnoPotrjenProfil && inheritedAlergeni.opozorila.length > 0 && (
                      <div className="bg-orange-50 text-orange-800 p-2 rounded text-xs border border-orange-200">
                        <p className="font-medium mb-1">Opozorila:</p>
                        <ul className="list-disc pl-4 space-y-0.5">
                          {inheritedAlergeni.opozorila.map((o, i) => <li key={i}>{o}</li>)}
                        </ul>
                      </div>
                    )}
                    {inheritedAlergeni.izvori.length > 0 && <div>
                      <p className="text-xs font-medium mb-1.5 text-muted-foreground">Viri po sestavinah:</p>
                      <ul className="space-y-1">
                        {inheritedAlergeni.izvori.map((izvor, i) => (
                          <li key={i} className="text-xs flex justify-between">
                            <span>{izvor.artikel}</span>
                            <span className="text-muted-foreground">{izvor.vir ?? "Nepreverjeno"}</span>
                          </li>
                        ))}
                      </ul>
                    </div>}
                  </div>
                )}

                {uporabiPotrjenDedovanProfil ? (
                  <div className="flex items-start gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-emerald-900">
                    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />
                    <div>
                      <p className="text-sm font-semibold">Alergeni se samodejno nastavijo iz normativa</p>
                      <p className="text-xs text-emerald-800">
                        Vse surovine imajo potrjen profil. Ob shranjevanju se alergeni in sledi samodejno prenesejo na artikel; ročna potrditev ni potrebna.
                      </p>
                    </div>
                  </div>
                ) : loadingInheritedAlergeni && normativAlergeniIds.length > 0 ? (
                  <p className="rounded-md border bg-muted/30 p-3 text-sm text-muted-foreground">
                    Preverjam alergenske profile surovin…
                  </p>
                ) : (
                  <div className="border-t pt-4">
                    <p className="text-xs font-medium mb-2">
                      {normativAlergeniIds.length > 0
                        ? "Ročna potrditev je potrebna, ker vse surovine nimajo potrjenega profila"
                        : "Ročno potrjen profil artikla"}
                    </p>
                    <AlergenEditor value={artAlergeni} onChange={setArtAlergeni} companyId={user?.companyId} />
                  </div>
                )}
              </div>

                </TabsContent>

                <TabsContent value="slika" className="mt-4 space-y-4 focus-visible:outline-none">
              {/* Slika Artikla za QR meni */}
              {(artJeDelMenija || artCat) && artProdajniArtikel && (
                <div className="space-y-5 rounded-lg border bg-card p-5 shadow-sm">
                  <div className="flex flex-col gap-1.5">
                    <div className="flex items-center justify-between">
                      <Label className="text-base">Slika artikla <span className="text-muted-foreground font-normal text-xs ml-2 rounded-full bg-muted px-2 py-0.5">Javni QR meni</span></Label>
                    </div>
                  </div>

                  <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                    {/* Leva stran: Upload in Generiranje */}
                    <div className="space-y-5">
                      <div className="space-y-3">
                        <Label htmlFor="artOpisSlike" className="text-sm font-medium">Opis slike</Label>
                        <p className="text-xs text-muted-foreground leading-relaxed">
                          Uporabi se za ustvarjanje privlačne slike artikla v QR meniju. Dodate lahko tudi povezave do strani z logotipom ali podobnim artiklom; Replit jih bo uporabil kot vizualno referenco.
                        </p>
                        <textarea
                          id="artOpisSlike"
                          value={artOpisSlike}
                          maxLength={500}
                          rows={3}
                          disabled={isGeneratingArticleImage || isUploadingArticleImage}
                          onChange={(event) => {
                            setArtOpisSlike(event.target.value);
                            setArtOpisSlikeTouched(true);
                            setArtImageError(null);
                          }}
                          placeholder="Npr. sveže pripravljen espresso v beli skodelici https://primer.si/izdelek"
                          className="flex min-h-[80px] w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm outline-none placeholder:text-muted-foreground focus-visible:ring-1 focus-visible:ring-ring"
                        />
                        <div className="flex justify-between items-center text-xs text-muted-foreground">
                          <span>{artOpisSlike.length}/500 znakov</span>
                          {artMode === "nov" && <span>Z vnosom imena se opis samodejno izpolni.</span>}
                        </div>
                      </div>

                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                        <input
                          ref={artImageInputRef}
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={handleUploadArtikelImage}
                        />
                        <Button
                          type="button"
                          variant="outline"
                          onClick={openArticleImagePicker}
                          onPointerDown={(event) => event.stopPropagation()}
                          disabled={isGeneratingArticleImage || isUploadingArticleImage || croppingArticleImage != null}
                          className="w-full bg-background"
                        >
                          <Upload className="mr-2 h-4 w-4 text-muted-foreground" />
                          {isUploadingArticleImage ? "Nalaganje..." : "Naloži sliko"}
                        </Button>
                        <Button
                          type="button"
                          variant="secondary"
                          onClick={handleGenerateArtikelImage}
                          disabled={isGeneratingArticleImage || isUploadingArticleImage || !artOpisSlike.trim()}
                          className="w-full text-xs bg-indigo-50 hover:bg-indigo-100 text-indigo-700 dark:bg-indigo-500/10 dark:hover:bg-indigo-500/20 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/30"
                        >
                          <Sparkles className="mr-2 h-4 w-4" />
                          {isGeneratingArticleImage
                            ? "Generiram..."
                            : artSlikaUrl ? "Generiraj novo" : "Generiraj AI sliko"}
                        </Button>
                      </div>

                      {artImageError && (
                        <div className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2.5 text-sm text-destructive flex items-start gap-2" role="alert">
                          <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                          <p className="leading-tight">{artImageError}</p>
                        </div>
                      )}
                    </div>

                    {/* Desna stran: Predogled in urejanje */}
                    <div className="flex flex-col h-full space-y-4">
                      {artSlikaUrl ? (
                        <div className="flex flex-col overflow-hidden rounded-md border bg-muted/20 flex-1">
                          <div className="relative group overflow-hidden bg-muted">
                            <img
                              src={artSlikaUrl}
                              alt={artImageAltText || `Predogled slike: ${artName || "artikel"}`}
                              className="block aspect-[2.5/1] w-full object-contain transition-transform duration-300 group-hover:scale-105"
                              style={{ aspectRatio: "2.5 / 1" }}
                            />
                            <div className="absolute inset-0 bg-gradient-to-t from-black/60 to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-200 flex items-end justify-between p-3">
                              <span className="text-white text-xs font-medium drop-shadow-md">Predogled (2.5:1)</span>
                              <Button type="button" variant="destructive" size="icon" className="h-7 w-7 rounded-full shadow-lg" onClick={() => void handleRemoveImage()} disabled={imageActionLoading}>
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </div>

                          <div className="space-y-4 p-4 flex-1 flex flex-col justify-between">
                            <div className="space-y-2">
                              <Label htmlFor="artImageAltText" className="text-xs text-muted-foreground font-medium">Nadomestno besedilo (Accessibility)</Label>
                              <div className="flex gap-2">
                                <Input id="artImageAltText" className="h-8 bg-background" value={artImageAltText} maxLength={250} onChange={(event) => setArtImageAltText(event.target.value)} placeholder={`Npr. ${artName} na krožniku`} disabled={imageActionLoading} />
                                <Button type="button" size="sm" variant="outline" className="h-8" onClick={handleSetAltText} disabled={imageActionLoading}>Shrani</Button>
                              </div>
                            </div>

                            <div className="space-y-2 pt-2 border-t border-border/50">
                              <Label htmlFor="artImageEditPrompt" className="text-xs text-muted-foreground font-medium">Hitro AI urejanje</Label>
                              <div className="flex gap-2">
                                <Input id="artImageEditPrompt" className="h-8 bg-background" value={artImageEditPrompt} maxLength={500} onChange={(event) => setArtImageEditPrompt(event.target.value)} placeholder="Npr. odstrani ozadje" disabled={imageActionLoading} />
                                <Button type="button" size="sm" variant="secondary" onClick={() => void handleEditArticleImage()} disabled={imageActionLoading || !artImageEditPrompt.trim()} className="h-8"><Sparkles className="mr-1.5 h-3.5 w-3.5" />Uredi</Button>
                              </div>
                            </div>

                            <div className="pt-3 border-t border-border/50 flex justify-between items-center">
                              <Button type="button" variant="ghost" size="sm" className="h-8 text-muted-foreground" onClick={() => { setImageHistoryOpen(!imageHistoryOpen); if (!imageHistoryOpen) void refreshImageHistory(); }} disabled={imageActionLoading}>
                                <History className="mr-2 h-3.5 w-3.5" />
                                Zgodovina slike
                              </Button>
                            </div>
                          </div>
                        </div>
                      ) : (
                        <div className="flex flex-col items-center justify-center flex-1 min-h-[220px] rounded-md border border-dashed bg-muted/30 px-6 py-8 text-center text-muted-foreground transition-colors hover:bg-muted/50">
                          <ImageIcon className="h-10 w-10 mb-4 text-muted-foreground/50" />
                          <p className="font-medium text-sm text-foreground">Slika še ni ustvarjena</p>
                          <p className="text-xs mt-1 max-w-xs">Dodajte sliko z nalaganjem datoteke ali s pomočjo UI generiranja za boljšo izkušnjo v QR meniju.</p>
                        </div>
                      )}
                    </div>
                  </div>

                  {artSlikaUrl && imageHistoryOpen && (
                    <div className="mt-4 space-y-2 rounded-md bg-muted/40 p-3 border animate-in slide-in-from-top-2">
                      <div className="flex items-center gap-2 mb-2">
                        <History className="h-4 w-4 text-muted-foreground" />
                        <h4 className="font-medium text-sm">Zgodovina različic</h4>
                      </div>
                      {artImageVersions.length === 0 ? <p className="text-sm text-muted-foreground">Zgodovina še ni na voljo.</p> : (
                        <div className="divide-y divide-border/50 border rounded-md bg-background overflow-hidden">
                          {artImageVersions.map((version) => (
                            <div key={version.id} className="flex items-center justify-between gap-3 p-2.5 text-sm hover:bg-muted/30 transition-colors">
                              <div className="flex items-center gap-3">
                                {version.isCurrent ? (
                                  <Badge className="bg-emerald-500/10 text-emerald-700 hover:bg-emerald-500/20 border-transparent shadow-none px-2 py-0.5 font-medium w-[70px] justify-center">Trenutna</Badge>
                                ) : (
                                  <Badge variant="secondary" className="px-2 py-0.5 font-medium text-muted-foreground w-[70px] justify-center">Prejšnja</Badge>
                                )}
                                <span className="font-medium">{version.source}</span>
                                <span className="text-muted-foreground text-xs hidden sm:inline-block">• {new Date(version.createdAt).toLocaleString("sl-SI")}</span>
                              </div>
                              {!version.isCurrent && (
                                <Button type="button" size="sm" variant="outline" className="h-7 text-xs" onClick={() => void handleRestoreImage(version.id)} disabled={imageActionLoading}>
                                  <RotateCcw className="mr-1.5 h-3 w-3" />
                                  Obnovi
                                </Button>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  )}
                </div>
              )}

                </TabsContent>

                <div
                  data-testid="section-article-basic-advanced"
                  className={artDialogTab === "osnovno" ? "mt-4 space-y-4 border-t-2 border-border/70 pt-4" : "hidden"}
                >
              {/* Vrsta artikla */}
              <div className="space-y-2 rounded-lg border-2 border-border/80 bg-card p-3 shadow-sm">
                <Label className="font-semibold">Vrsta artikla (računovodsko)</Label>
                <div className="flex gap-2">
                  {(["blago", "material", "storitev"] as const).map(vrsta => (
                    <button
                      key={vrsta}
                      type="button"
                      onClick={() => setArtVrstaArtikla(vrsta)}
                      className={`flex-1 py-2 px-2 rounded-md text-sm font-semibold border-2 transition-colors ${
                        artVrstaArtikla === vrsta
                          ? "bg-primary text-primary-foreground border-primary shadow-sm ring-2 ring-primary/20"
                          : "bg-background border-border hover:border-primary/60 hover:bg-primary/5 text-foreground"
                      }`}
                    >
                      {vrsta.charAt(0).toUpperCase() + vrsta.slice(1)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2 rounded-lg border-2 border-border/80 bg-card p-3 shadow-sm">
                <Label htmlFor="artikel-cas-priprave" className="font-semibold">Čas priprave (min)</Label>
                <p className="text-xs text-muted-foreground">
                  Uporabi se pri samodejni oceni prevzema telefonskega naročila.
                  {artJePica
                    ? " Za pico je predlaganih 5 minut fizične priprave."
                    : " Za artikle brez priprave nastavite 0."}
                </p>
                <Input
                  id="artikel-cas-priprave"
                  type="number"
                  min="0"
                  step="1"
                  value={artCasPripraveMin}
                  onChange={event => setArtCasPripraveMin(event.target.value)}
                  className="max-w-40"
                />
              </div>

              {/* Modifikatorske skupine — samo za prodajne artikle */}
              {artProdajniArtikel && (
                 <div className="space-y-2 rounded-lg border-2 border-purple-200 bg-purple-50/30 p-3 shadow-sm">
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
                            className={`w-full flex items-center gap-2 rounded-md border-2 px-3 py-2 text-left text-sm font-medium transition-colors ${checked ? "border-purple-500 bg-purple-100 text-purple-950 shadow-sm" : "border-border bg-background hover:border-purple-300 hover:bg-purple-50 text-foreground"}`}
                          >
                            <div className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${checked ? "bg-purple-500 border-purple-500" : "border-muted-foreground/40"}`}>
                              {checked && <Check className="w-3 h-3 text-white" />}
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
                  <div className="rounded-lg border-2 border-blue-300 bg-blue-50 overflow-hidden shadow-sm">
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
                                      className={`flex items-center gap-2 rounded-md border-2 px-2 py-2 text-left text-sm transition-colors ${checked ? "border-blue-500 bg-blue-100 text-blue-950 shadow-sm" : "border-blue-100 bg-white hover:border-blue-300 hover:bg-blue-50 text-foreground"}`}
                                      onClick={() => setArtPrivzetiModGrpIds(prev => checked ? prev.filter(x => x !== m.id) : [...prev, m.id])}
                                    >
                                      <div className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${checked ? "bg-blue-500 border-blue-500" : "border-muted-foreground/40"}`}>
                                        {checked && <Check className="w-3 h-3 text-white" />}
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
                 <div className="space-y-2 rounded-lg border-2 border-orange-200 bg-orange-50/30 p-3 shadow-sm">
                  <div className="flex items-center gap-2">
                    <ShoppingBag className="h-4 w-4 text-orange-500" />
                    <Label className="font-semibold">To Go</Label>
                  </div>
                  <button
                    type="button"
                    onClick={() => setArtToGo(v => !v)}
                    className={`w-full flex items-center gap-2 rounded-md border-2 px-3 py-2 text-left text-sm font-medium transition-colors ${artToGo ? "border-orange-500 bg-orange-100 text-orange-950 shadow-sm" : "border-border bg-background hover:border-orange-300 hover:bg-orange-50 text-foreground"}`}
                  >
                    <div className={`w-3.5 h-3.5 shrink-0 rounded border flex items-center justify-center ${artToGo ? "bg-orange-500 border-orange-500" : "border-muted-foreground/40"}`}>
                      {artToGo && <Check className="w-3 h-3 text-white" />}
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
              </Tabs>
            </div>
          </div>

          {normativDropdownIdx !== null && normativDropdownPos !== null && (
            <div
              style={{
                position: "absolute",
                top: normativDropdownPos.top,
                left: normativDropdownPos.left,
                width: normativDropdownPos.width,
                zIndex: 100,
              }}
              className="max-h-52 overflow-y-auto rounded-md border bg-background py-1 shadow-lg"
            >
              {filteredNormativArtikli.length === 0 ? (
                <p className="px-3 py-2 text-xs text-muted-foreground">
                  {normativDropdownFilter ? `Ni zadetkov za „${normativDropdownFilter}"` : "Ni nabavnih artiklov v šifrantu"}
                </p>
              ) : (
                filteredNormativArtikli.map((artikel, artikelIdx) => (
                  <button
                    key={artikel.id}
                    type="button"
                    className={`w-full flex items-center justify-between cursor-pointer px-3 py-1.5 text-left text-sm ${
                      artikelIdx === normativDropdownHighlight
                        ? "bg-primary/10 font-medium"
                        : "hover:bg-muted"
                    }`}
                    onMouseDown={event => {
                      event.preventDefault();
                      selectNormativArtikel(normativDropdownIdx, artikel.id);
                    }}
                  >
                    <span>
                      {artikel.imeZaNabavo || artikel.ime}
                      {artikel.enotaMere && ` (${artikel.enotaMere})`}
                    </span>
                    <AlergeniBadge snapshot={{
                      alergeni: artikel.alergeni ?? [],
                      alergeniSledi: artikel.alergeniSledi ?? [],
                      alergeniStatus: (artikel as any).alergeniStatus ?? "nepreverjeno",
                      alergeniVir: (artikel as any).alergeniVir ?? null,
                      alergeniOpombaVira: (artikel as any).alergeniOpombaVira ?? null,
                      alergeniDocumentId: (artikel as any).alergeniDocumentId ?? null,
                    }} className="scale-75 origin-right" />
                  </button>
                ))
              )}
            </div>
          )}

          <div className="pt-3 border-t space-y-2">
            {normativNapaka && (
              <NormativSaveAlert
                message={normativNapaka}
                stale={normativStale}
                refreshing={normativiFetching}
                onRefresh={() => void handleRefreshNormativi()}
              />
            )}
            <Button className="w-full" onClick={handleSaveArt} disabled={isPendingArt || isGeneratingArticleImage || isUploadingArticleImage || !artName || (artProdajniArtikel && (!artPrice || !artCat))}>
              {isGeneratingArticleImage ? "Ustvarjam sliko..." : isUploadingArticleImage ? "Nalaganje slike..." : isPendingArt ? "Shranjujem..." : <>{artMode === "uredi" ? "Posodobi" : "Dodaj artikel"} <kbd className="ml-1 text-[10px] font-mono opacity-60 border border-current/40 rounded px-0.5 leading-none">F2</kbd></>}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
      <SmartNormativeProposalDialog
        open={smartProposalDialogOpen}
        onOpenChange={setSmartProposalDialogOpen}
        articleId={editingArt?.id ?? 0}
        articleName={editingArt?.ime ?? ""}
        onApplySuccess={() => {
          void queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });
          void (async () => {
            const result = await refetchNormativi();
            if (!result.data) {
              setNormativStale(true);
              setNormativNapaka("Normativ je shranjen, vendar ga ni bilo mogoče osvežiti. Osvežite podatke.");
              return;
            }
            setNormativItems(result.data.normativi.map(n => ({
              vhodniArtikelId: n.vhodniArtikelId,
              kolicina: String(n.kolicina),
              ime: n.vhodniArtikelIme ?? undefined,
            })));
            setNormativExpectedRevision(result.data.normativRevision);
            setNormativStale(false);
            setNormativNapaka(null);
          })();
        }}
      />
      <ArticleImageCropDialog
        file={croppingArticleImage}
        open={croppingArticleImage != null}
        isUploading={isUploadingArticleImage}
        onOpenChange={(open) => { if (!open && !isUploadingArticleImage) setCroppingArticleImage(null); }}
        onConfirm={handleCroppedArticleImageUpload}
      />
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
                     canEditNormativ(a) &&
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
