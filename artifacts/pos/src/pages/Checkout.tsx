import { useState, useEffect, useRef, useCallback } from "react";
import { trackEvent } from "@/lib/analytics";
import { availableShiftOperators } from "@/lib/available-shift-operators";
import {
  expandCheckoutSplitPostavkaIds,
  toggleCheckoutSplitPostavka,
} from "@/lib/checkout-split-selection";
import { useSearch, useLocation, Link } from "wouter";
import {
  useListAktivnaNarocila,
  useGetNarocilo,
  useCreateRacun,
  useListAktivneIzmene,
  useUpdateNarocilo,
  useRemovePostavka,
  useUpdatePostavkaKolicina,
  useSpojiNarocili,
  usePosljiEmailRacuna,
  useGetPartnerjiCenik,
  useStartPaytenAndroidPayment,
  useConfirmPaytenAndroidPayment,
  useTimeoutPaytenAndroidPayment,
  poisciKupca,
  getListAktivnaNarocilaQueryKey,
  getListMizeQueryKey,
  getListRacuniQueryKey,
  getGetNarociloQueryKey,
  useListBlagajne,
  getListBlagajneQueryKey,
} from "@workspace/api-client-react";
import { useNastavitve } from "@/contexts/NastavitveContext";
import { useAuth } from "@/contexts/AuthContext";
import { useBlagajna } from "@/contexts/BlagajnaContext";
import { useNaprava } from "@/contexts/NapravaContext";
import { Card, CardContent, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import {
  Receipt, CreditCard, Banknote, Gift, CheckCircle2,
  XCircle, Loader2, Monitor, User, AlertTriangle, AlertCircle,
  Pizza, Plus, Minus, ShieldAlert, KeyRound, ArrowLeft,
  Scissors, GitMerge, Users, Building2, QrCode,
  Copy, ExternalLink, Check, Mail, FileText, Printer, Landmark, LockKeyhole,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { RacunInputPlacilnaNacin, Narocilo } from "@workspace/api-client-react";
import { getEnotaId } from "@workspace/api-client-react";
import { PrintReceiptButton } from "@/components/PrintReceiptButton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { KlavijaturaInput } from "@/components/KlavijaturaInput";
import { DdvNeskladjeAlert } from "@/components/DdvNeskladjeAlert";
import { formatMizaProstor } from "@/lib/formatMizaProstor";
import { getPosAuthHeaders, posFetch } from "@/lib/pos-auth-headers";
import {
  notifyPosActorSessionChanged,
  POS_ACTOR_SESSION_CHANGED_EVENT,
  requestPosActorSession,
} from "@/lib/pos-actor-session";
import { QrGostStaffInfo } from "@/components/QrGostStaffInfo";
import { printTextViaZcsBridge } from "@/lib/zcsAndroidPrinter";
import {
  formatXPorociloPrintLines,
  type XPorociloPremik,
  type XPorociloPromet,
  type XPorociloStanje,
} from "@/lib/xPorocilo";
import { formatZPorociloPrintLines, type ZPorociloSnapshot } from "@/lib/zPorocilo";
import {
  izracunajAktivniTerminal,
  type NapravaTerminalOverride,
} from "@/lib/paytenAndroid";
import {
  buildVivaAndroidSaleIntent,
  buildBookieVivaBridgeCallbackUrl,
  buildBookieVivaBridgeLaunchUrl,
  getVivaCallbackNarociloId,
  isVivaAndroidSaleCallback,
  parseVivaAndroidSaleCallback,
} from "@/lib/vivaAndroidIntent";
import { applyTipCapture, type TipCaptureMethod } from "@/lib/tipCapture";
import {
  clearGiftCardPaymentState,
  buildCardGiftIssuancePayment,
  buildGiftSumupPayBody,
  readGiftCardPaymentState,
  writeGiftCardPaymentState,
  type GiftCardPaymentState,
} from "@/lib/giftCardPaymentState";
import {
  cacheOfflineSnapshot,
  checkLocalFiscalCapability,
  discoverLocalFiscalCapability,
  fetchAndCacheOfflineAuthorityBundle,
  getValidOfflineAuthorityBundle,
  getCachedOfflineCapability,
  isOfflineOrderLocked,
  issueOfflineCashReceipt,
  isLocalFiscalServiceEnabled,
  legalLjubljanaTimestamp,
  reserveOfflineOperationId,
  syncOfflineFiscalReceipts,
  UnknownFiscalOutcomeError,
} from "@/lib/offlineFiscal";
import { issueGatewayCashReceipt, gatewayPosService, localOrderRoute, parseLocalOrderRoute } from "@/lib/gatewayClient";
import { useGatewayOfflineContext } from "@/lib/gatewayOfflineStore";
import { useAiSvetovalec } from "@/hooks/use-ai-svetovalec";
import { AiSvetovalecPanel } from "@/components/AiSvetovalecPanel";
import { IndividualVoucherScanner, type IndividualVoucherPreview } from "@/components/IndividualVoucherScanner";
import { poslovniDatumZaCas } from "@/lib/posCas";

interface IssuedRacun {
  id: number;
  stevilkaRacuna: string;
  opozorilo?: string | null;
  skupaj: number;
  zoi: string | null;
  eor: string | null;
  status: string;
  jeDelni: boolean;
  narociloId: number | null;
  datumCas: Date;
  znesekNapitnina?: number;
}

type TerminalStanje = "idle" | "cakanje" | "odobren" | "zavrnjen" | "napaka" | "preklic";

interface TerminalRezultat {
  avtorizacijskaKoda?: string | null;
  kartica?: string | null;
  maskiranPan?: string | null;
  napaka?: string | null;
}

interface DarilniBonStanje {
  izdano: number;
  unovceno: number;
  odprto: number;
}

interface VivaPaymentIdentifiers {
  sessionId: string | null;
  transactionId: string | null;
  orderCode: string | null;
}

const VIVA_TAP_TO_PAY_STORAGE_KEYS = {
  narociloId: "vivaTapToPay_narociloId",
  placilo: "vivaTapToPay_placilo",
  attempt: "vivaTapToPay_attempt",
} as const;

function writeVivaTapToPayStorage(key: string, value: string): void {
  sessionStorage.setItem(key, value);
  localStorage.setItem(key, value);
}

function readVivaTapToPayStorage(key: string): string | null {
  return sessionStorage.getItem(key) ?? localStorage.getItem(key);
}

function removeVivaTapToPayStorage(key: string): void {
  sessionStorage.removeItem(key);
  localStorage.removeItem(key);
}

type ZBlocker = {
  type: string;
  message: string;
  items?: Array<{ id: number; label: string }>;
};

export default function Checkout() {
  const gatewayOffline = useGatewayOfflineContext();
  const { user } = useAuth();
  const imaTrr = user?.imaTrr ?? false;
  const lahkoProdajaDarilneBone = user?.vloga === "superadmin" || (user?.capabilities ?? []).includes("deposits_tokens");
  const search = useSearch();
  const preselectedId = new URLSearchParams(search).get("narocilo");
  const gatewayRouteId = preselectedId ? parseLocalOrderRoute(preselectedId) ?? null : null;
  const gatewayCheckoutMode = !!gatewayRouteId || gatewayOffline.effectiveAuthority === "GATEWAY" ||
    (!!gatewayRouteId && gatewayOffline.authorityForOrder(gatewayRouteId) === "GATEWAY");
  const preselectedNarociloId = (() => {
    if (!preselectedId) return null;
    const id = parseInt(preselectedId, 10);
    return Number.isFinite(id) && id > 0 ? id : null;
  })();
  const vivaCallbackNarociloId = getVivaCallbackNarociloId(search);
  const [resumeNarociloId, setResumeNarociloId] = useState<number | null>(vivaCallbackNarociloId);
  // Pri prihodu iz naročila imamo ID že v URL-ju. Neposreden GET lahko zadene
  // cache iz Order strani in ne sme čakati na počasnejši seznam vseh naročil.
  const neposrednoNarociloId = resumeNarociloId ?? preselectedNarociloId;
  const { data: resumeNarocilo } = useGetNarocilo(neposrednoNarociloId ?? 0, {
    query: {
      enabled: neposrednoNarociloId !== null && !gatewayCheckoutMode,
      retry: false,
      queryKey: getGetNarociloQueryKey(neposrednoNarociloId ?? 0),
    },
  });
  const { data: cloudNarocila, isLoading } = useListAktivnaNarocila({
    query: {
      refetchOnMount: "always",
      queryKey: getListAktivnaNarocilaQueryKey(),
    },
  });
  const gatewayNarocila: Narocilo[] = (gatewayOffline.snapshot?.orders ?? [])
    .map(item => {
      const projection = (item.projection ?? item) as Record<string, any>;
      const { postavke: _postavke, ...canonicalProjection } = projection;
      return canonicalProjection;
    })
    .map(order => ({
      ...order, id: String(order.id ?? order.orderId),
      status: order.status === "OPEN" || order.status === "open" ? "odprto" : order.status,
      postavke: order.postavke ?? order.lines ?? [],
      skupaj: Number(order.skupaj ?? order.total ?? 0),
    })) as unknown as Narocilo[];
  const narocila = gatewayCheckoutMode ? gatewayNarocila : cloudNarocila;
  const { nastavitve } = useNastavitve();
  const { data: aktivneIzmene, isLoading: aktivneIzmeneLoading } = useListAktivneIzmene();
  const { activeBlagajnaId } = useBlagajna();
  const { data: seznamBlagajn } = useListBlagajne({
    query: { queryKey: [...getListBlagajneQueryKey(), user?.enotaId ?? null] },
  });
  const aktivnaBlagajna = seznamBlagajn?.find(b => b.id === activeBlagajnaId);
  const imeAktivneBlagajne = aktivnaBlagajna
    ? `${aktivnaBlagajna.ppId}-${aktivnaBlagajna.bId}${aktivnaBlagajna.ime ? ` ${aktivnaBlagajna.ime}` : ""}`
    : activeBlagajnaId ? `Blagajna #${activeBlagajnaId}` : "Ni izbrana";
  const { naprava, napravaKljuc } = useNaprava();
  const createRacun = useCreateRacun();
  const startPaytenAndroidPayment = useStartPaytenAndroidPayment();
  const confirmPaytenAndroidPayment = useConfirmPaytenAndroidPayment();
  const timeoutPaytenAndroidPayment = useTimeoutPaytenAndroidPayment();
  const posljiEmail = usePosljiEmailRacuna();
  const updateNarocilo = useUpdateNarocilo();
  const removePostavka = useRemovePostavka();
  const updateKolicinaHook = useUpdatePostavkaKolicina();
  const spojiMutation = useSpojiNarocili();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [, setLocation] = useLocation();
  // Keep only the minimum snapshots needed to prove an offline cash receipt
  // belongs to the currently selected unit.  They are not used for card or
  // server fiscalisation.
  useEffect(() => {
    if (!nastavitve || !user) return;
    void Promise.all([
      cacheOfflineSnapshot("unit", { enotaId: user.enotaId, poslovniProstor: nastavitve.poslovniProstor, elektronskaNaprava: nastavitve.elektronskaNaprava }),
      cacheOfflineSnapshot("operator", { id: user.id, enotaId: user.enotaId }),
    ]);
    // Pairing is refreshed only while the POS is online. A failed local check
    // is intentionally silent here; checkout will explain why issuing is
    // blocked instead of guessing.
    if (isLocalFiscalServiceEnabled()) void discoverLocalFiscalCapability();
  }, [nastavitve, user]);
  useEffect(() => {
    if (!isLocalFiscalServiceEnabled()) return;
    void syncOfflineFiscalReceipts();
    const timer = window.setInterval(() => void syncOfflineFiscalReceipts(), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  const preselectedGost = (() => {
    const raw = new URLSearchParams(search).get("gost");
    if (!raw) return null;
    const n = parseInt(raw);
    return isNaN(n) ? null : n;
  })();
  const autoSelectedRef = useRef(false);
  const autoSplitDoneRef = useRef<number | null>(null);
  // Shranjuje zaračunane postavkeIds in narociloId ob izdaji delnega računa
  const billedInfoRef = useRef<{ narociloId: number; postavkeIds: number[] } | null>(null);
  // Narocilo ID za samodejno izdajo računa po povratku iz Viva Android Terminal APK
  const vivaAndroidAutoIssueNarociloRef = useRef<number | null>(null);
  // Narocilo ID za samodejno izdajo računa po povratku iz Viva Tap to Pay (SoftPOS)
  const vivaTapToPayAutoIssueNarociloRef = useRef<number | null>(null);
  // Zastavica: ali je bil zadnji račun izdan samodejno po Tap to Pay?
  const vivaTapToPayIssueRef = useRef(false);
  // State sprožilec je potreben, ker se Android callback lahko vrne v novem
  // brskalniškem kontekstu. Ref sam po sebi ne zagotovi ponovnega renderja,
  // zato bi lahko ostal prikaz »Plačilo potrjeno«, račun pa se ne bi izdal.
  const [vivaTapToPayAutoIssueId, setVivaTapToPayAutoIssueId] = useState<number | null>(null);

  const [selectedNarocilo, setSelectedNarocilo] = useState<number | null>(
    vivaCallbackNarociloId ?? preselectedNarociloId
  );
  const [selectedGatewayOrderId, setSelectedGatewayOrderId] = useState<string | null>(gatewayRouteId);
  const effectiveSelectedOrderKey = gatewayCheckoutMode ? selectedGatewayOrderId : selectedNarocilo;
  const [pendingPaytenCompletion, setPendingPaytenCompletion] = useState<{ paymentAttemptId: string; amount: number; narociloId: number; placilniNacin: RacunInputPlacilnaNacin; sekundarniNacin: "gotovina" | "kartica" } | null>(null);
  const paytenRecoverySnapshotRef = useRef<any>(null);
  const [placilniNacin, setPlacilniNacin] = useState<RacunInputPlacilnaNacin>("gotovina");
  // Napitnino lahko določi samo gost na javnem QR meniju. POS jo ob izdaji
  // prenese brez prikaza ali možnosti spreminjanja.
  const [znesekNapitnina, setZnesekNapitnina] = useState(0);
  const znesekNapitninaRef = useRef(0);
  const [, setNacinZajemaNapitnine] = useState<TipCaptureMethod>("card");
  // Terminal callbacks can cause the automatic issue effect before React has
  // rendered restored state. Keep the selected capture channel synchronously
  // alongside state so the terminal amount and receipt use the same snapshot.
  const nacinZajemaNapitnineRef = useRef<TipCaptureMethod>("card");
  const [dniOdloga, setDniOdloga] = useState(8);
  const [fursNacin, setFursNacin] = useState<"simulacija" | "testno" | "produkcija">("simulacija");

  useEffect(() => {
    if (nastavitve) {
      setFursNacin(((nastavitve as typeof nastavitve & { fursNacin?: string }).fursNacin ?? "simulacija") as "simulacija" | "testno" | "produkcija");
    }
  }, [nastavitve]);
  useEffect(() => {
    if (nastavitve?.studentskiBonAktiven === true) return;
    setZnesekSubvencija(0);
    setSspReferenca("");
  }, [nastavitve?.studentskiBonAktiven]);
  const [selectedNatakarId, setSelectedNatakarId] = useState<string>(
    () => localStorage.getItem("pos_last_operator_id") ?? "none"
  );
  useEffect(() => {
    const syncSelectedActor = () => {
      const actorId = localStorage.getItem("pos_last_operator_id");
      setSelectedNatakarId(actorId ?? "none");
    };
    window.addEventListener(POS_ACTOR_SESSION_CHANGED_EVENT, syncSelectedActor);
    return () => window.removeEventListener(POS_ACTOR_SESSION_CHANGED_EVENT, syncSelectedActor);
  }, []);
  const [issuedRacun, setIssuedRacun] = useState<IssuedRacun | null>(null);
  interface DdvPostavka {
    ime: string;
    kolicina: number;
    skupaj: number;
    davek: number;
    ddv: number;
  }
  const [ddvNapaka, setDdvNapaka] = useState<{
    sporocilo: string;
    podrobnosti: string;
    razlika?: number;
    skupajNarocilo?: number;
    skupajIzPostavk?: number;
    postavke?: DdvPostavka[];
  } | null>(null);
  const [fursNapaka, setFursNapaka] = useState<string | null>(null);
  const [pinDialogOpen, setPinDialogOpen] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [pinNapaka, setPinNapaka] = useState<string | null>(null);

  const [emailDialogOpen, setEmailDialogOpen] = useState(false);
  const [emailInput, setEmailInput] = useState("");
  const [emailRezultat, setEmailRezultat] = useState<{ uspeh: boolean; napaka?: string | null } | null>(null);

  // ── X-poročilo ───────────────────────────────────────────────
  const poslovniDatumDanes = (zacetekUra: string): string => {
    const [h, m] = zacetekUra.split(":").map(Number);
    const now = new Date();
    const dateLJ = now.toLocaleDateString("sv-SE", { timeZone: "Europe/Ljubljana" });
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: "Europe/Ljubljana", hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(now);
    const hLJ = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);
    const mLJ = parseInt(parts.find(p => p.type === "minute")?.value ?? "0", 10);
    const afterCutoff = hLJ > (h ?? 4) || (hLJ === (h ?? 4) && mLJ >= (m ?? 0));
    if (afterCutoff) return dateLJ;
    const prev = new Date(dateLJ + "T12:00:00Z");
    prev.setUTCDate(prev.getUTCDate() - 1);
    return prev.toISOString().slice(0, 10);
  };
  const zacetekUra = (nastavitve as { zacetekDnevaUra?: string } | null)?.zacetekDnevaUra ?? "04:00";
  const privzetiDatum = poslovniDatumDanes(zacetekUra);
  const [izpisPrometaOpen, setIzpisPrometaOpen] = useState(false);
  const [izpisOd, setIzpisOd] = useState(privzetiDatum);
  const [izpisDo, setIzpisDo] = useState(privzetiDatum);
  const [izpisData, setIzpisData] = useState<XPorociloPromet | null>(null);
  const [izpisStanje, setIzpisStanje] = useState<XPorociloStanje | null>(null);
  const [izpisPremiki, setIzpisPremiki] = useState<XPorociloPremik[]>([]);
  const [izpisLoading, setIzpisLoading] = useState(false);
  const [izpisNapaka, setIzpisNapaka] = useState<string | null>(null);

  // ── Z-poročilo ───────────────────────────────────────────────
  const [zPorociloOpen, setZPorociloOpen] = useState(false);
  const [zLoading, setZLoading] = useState(false);
  const [zSnapshot, setZSnapshot] = useState<ZPorociloSnapshot | null>(null);
  const [zNapaka, setZNapaka] = useState<string | null>(null);
  const [zBlokade, setZBlokade] = useState<ZBlocker[]>([]);
  const [zFinalizingId, setZFinalizingId] = useState<number | null>(null);
  const [zPoslovniDatum, setZPoslovniDatum] = useState(privzetiDatum);
  type XCashSnapshot = { pricakovanaGotovina: number; reconciliation: { prestetaGotovina: number; razlika: number; overrideRazlog?: string | null } | null; blockers: ZBlocker[] };
  const [xCash, setXCash] = useState<XCashSnapshot | null>(null);
  const [xCashInput, setXCashInput] = useState("");
  const [xOverrideReason, setXOverrideReason] = useState("");
  const [xCashLoading, setXCashLoading] = useState(false);
  const [zOdklepOpen, setZOdklepOpen] = useState(false);
  const [zOdklepRazlog, setZOdklepRazlog] = useState("");
  const [zOdklepLoading, setZOdklepLoading] = useState(false);
  const [zOdklepNapaka, setZOdklepNapaka] = useState<string | null>(null);

  const datumRe = /^\d{4}-\d{2}-\d{2}$/;
  const izpisVeljavenOd = datumRe.test(izpisOd);
  const izpisVeljavenDo = datumRe.test(izpisDo);

  const handleIzpisPromet = async () => {
    if (!izpisVeljavenOd || !izpisVeljavenDo) {
      setIzpisNapaka("Vnesite veljavna datuma v obliki LLLL-MM-DD."); return;
    }
    if (izpisOd !== izpisDo) {
      setIzpisNapaka("X-poročilo je vedno pregled enega poslovnega dne."); return;
    }
    if (!activeBlagajnaId) {
      setIzpisNapaka("Pred prikazom X-poročila izberite blagajno v stranski navigaciji."); return;
    }
    setIzpisLoading(true); setIzpisNapaka(null); setIzpisData(null); setIzpisStanje(null); setIzpisPremiki([]);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const datum = encodeURIComponent(izpisOd.trim());
      const blagajnaId = encodeURIComponent(String(activeBlagajnaId));
      const [prometResponse, stanjeResponse, premikiResponse] = await Promise.all([
        posFetch(`${base}/api/statistike/promet-obdobja?od=${datum}&do=${datum}&blagajnaId=${blagajnaId}&_t=${Date.now()}`),
        posFetch(`${base}/api/blagajniski-premiki/stanje?datum=${datum}&blagajnaId=${blagajnaId}`),
        posFetch(`${base}/api/blagajniski-premiki?datum=${datum}&blagajnaId=${blagajnaId}`),
      ]);
      if (!prometResponse.ok || !stanjeResponse.ok || !premikiResponse.ok) {
        let msg = "Napaka pri pridobivanju podatkov.";
        const failedResponse = [prometResponse, stanjeResponse, premikiResponse].find((response) => !response.ok);
        try { const j = await failedResponse?.json(); msg = j?.error ?? j?.napaka ?? msg; } catch { /* ignore */ }
        setIzpisNapaka(msg); return;
      }
      const [promet, stanje, premiki] = await Promise.all([
        prometResponse.json() as Promise<XPorociloPromet>,
        stanjeResponse.json() as Promise<XPorociloStanje>,
        premikiResponse.json() as Promise<{ premiki: XPorociloPremik[] }>,
      ]);
      setIzpisData(promet);
      setIzpisStanje(stanje);
      setIzpisPremiki(premiki.premiki);
    } catch { setIzpisNapaka("Napaka pri pridobivanju podatkov."); }
    finally { setIzpisLoading(false); }
  };

  const handleNatisniPromet = async () => {
    if (!izpisData || !izpisStanje) return;
    const zdaj = new Date().toLocaleString("sl-SI", { timeZone: "Europe/Ljubljana", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    // privzetek 58 (→32 kol) samo na mestu uporabe; undefined (samodejno) = ZCS 58mm default
    const standardW = (naprava?.terminalConfig?.tiskalnikSirina ?? 58) === 58 ? 32 : 40;
    const jeWindows = navigator.userAgent.includes("Windows");
    const jeAndroid = navigator.userAgent.includes("Android");
    const agentIme2 = naprava?.terminalConfig?.agentTiskalnikIme ?? "";
    const buildLinije = (width: number): string[] => formatXPorociloPrintLines({
      width,
      datum: izpisOd,
      printedAt: zdaj,
      promet: izpisData,
      stanje: izpisStanje,
      premiki: izpisPremiki,
    });

    // Windows agent
    if (jeWindows && agentIme2) {
      const linije = buildLinije(standardW);
      try {
        const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
        const r = await posFetch(`${base}/api/print/promet/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ linije }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({})) as { error?: string };
          toast({ title: "Napaka pri tiskanju", description: err.error ?? `Napaka (${r.status})`, variant: "destructive" });
        } else {
          toast({ title: "X-poročilo v čakalni vrsti", description: "Windows agent bo natisnil izpis v naslednjih sekundah." });
        }
      } catch {
        toast({ title: "Napaka pri tiskanju", description: "Ni mogoče doseči strežnika.", variant: "destructive" });
      }
      return;
    }

    // Open popup synchronously before any await so Chrome/Edge cannot block it.
    // We will navigate it to the blob URL after the async ZCS check completes.
    const popupWin = !jeAndroid ? window.open("about:blank", "_blank", "width=340,height=640") : null;

    // ZCS Z92: 30 kolon
    const zcsRez = await printTextViaZcsBridge({ linee: buildLinije(30), qrUrl: null });
    if (zcsRez.ok) { popupWin?.close(); return; }

    // Na Androidu (ZCS Z92) ne prikazujemo brskalniške izbire — samo napaka
    if (jeAndroid) {
      toast({ title: "Napaka tiskanja", description: zcsRez.error ?? "ZCS tiskalni most ni dosegljiv.", variant: "destructive" });
      return;
    }

    if (!popupWin) {
      toast({ title: "Tiskalnik blokiran", description: "Dovolite pojavna okna v brskalniku.", variant: "destructive" });
      return;
    }

    // brskalniški tisk — za ne-Android naprave (PC, Mac)
    const linije = buildLinije(standardW);
    const vrHtml = (s: string) => `<div class="vr">${s.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>X-poročilo</title>
<style>
  @page { margin: 3mm 2mm; size: auto; }
  * { margin: 0; padding: 0; box-sizing: border-box; }
  body { font-family: "Courier New", Courier, monospace; white-space: pre; color: #000; background: #fff; padding: 1mm; }
  .vr  { white-space: pre; }
  @media print { body { font-size: 8pt; line-height: 1.3; } }
  @media print and (min-width: 70mm) { body { font-size: 10pt; line-height: 1.35; } }
</style></head>
<body>
${linije.map(vrHtml).join("\n")}
</body>
<script>window.onload=function(){window.print();setTimeout(function(){window.close();},1200);}<\/script>
</html>`;
    const blob = new Blob([html], { type: "text/html; charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    popupWin.location.href = blobUrl;
    setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000);
  };

  // ── Z-poročilo handler ───────────────────────────────────────
  // Če je pretekli dan ostal brez Z-poročila, ga ponudimo namesto današnjega (varovalo pred zamenjavo dneva).
  const predlagajZDatum = async (): Promise<string> => {
    if (!activeBlagajnaId) return zPoslovniDatum;
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const r = await posFetch(`${base}/api/z-porocilo/status?blagajnaId=${activeBlagajnaId}`);
      if (!r.ok) return zPoslovniDatum;
      const data = await r.json() as { manjkajociDatum?: string | null };
      const datum = data.manjkajociDatum ?? privzetiDatum;
      setZPoslovniDatum(datum);
      return datum;
    } catch {
      /* ob napaki ostane izbrani datum */
      return zPoslovniDatum;
    }
  };

  const handleZZakljuci = async () => {
    if (!activeBlagajnaId) { setZNapaka("Izberite blagajno v stranski navigaciji."); return; }
    setZLoading(true); setZNapaka(null); setZBlokade([]); setZSnapshot(null);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const r = await posFetch(`${base}/api/z-porocilo/zakljuci`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blagajnaId: activeBlagajnaId, poslovniDatum: zPoslovniDatum }),
      });
      const data = await r.json() as ZPorociloSnapshot & {
        error?: string;
        napaka?: string;
        blockers?: ZBlocker[];
      };
      if (!r.ok) {
        setZNapaka(data.error ?? data.napaka ?? `Napaka (${r.status})`);
        setZBlokade(data.blockers ?? []);
        return;
      }
      setZSnapshot({
        ...data,
        grandTotalPrej: Number(data.grandTotalPrej),
        grandTotalNov: Number(data.grandTotalNov),
        prometDneva: Number(data.prometDneva),
        skupajPromet: Number(data.skupajPromet),
        skupajDdv: Number(data.skupajDdv),
        gotovina: Number(data.gotovina), kartica: Number(data.kartica), znesekNapitnina: Number(data.znesekNapitnina), sumup: Number(data.sumup),
        bon: Number(data.bon), bonPica: Number(data.bonPica),
        negotovinsko: Number(data.negotovinsko), reprezentanca: Number(data.reprezentanca),
        lastnaPoraba: Number(data.lastnaPoraba),
        menjalniDenar: Number(data.menjalniDenar), gotovinskaProdaja: Number(data.gotovinskaProdaja),
        pologiGotovine: Number(data.pologiGotovine), izplacilaJobaviteljem: Number(data.izplacilaJobaviteljem),
        pologiTrr: Number(data.pologiTrr), stanjeBlagajne: Number(data.stanjeBlagajne),
        darilniBoniIzdaja: Number(data.darilniBoniIzdaja), darilniBoniUnovcitev: Number(data.darilniBoniUnovcitev),
        sspSubvencija: Number(data.sspSubvencija),
        fursPotrjeni: Number(data.fursPotrjeni), fursNepotrjeni: Number(data.fursNepotrjeni),
      });
    } catch { setZNapaka("Ni mogoče doseči strežnika."); }
    finally { setZLoading(false); }
  };

  const loadXCash = async (datumPrepis?: string) => {
    if (!activeBlagajnaId) return;
    setXCashLoading(true);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const response = await posFetch(`${base}/api/x-porocilo?blagajnaId=${activeBlagajnaId}&poslovniDatum=${encodeURIComponent(datumPrepis ?? zPoslovniDatum)}`);
      const data = await response.json() as XCashSnapshot & { error?: string; napaka?: string };
      if (!response.ok) { setZNapaka(data.error ?? data.napaka ?? "X-poročila ni mogoče pridobiti."); return; }
      setXCash(data);
      setXCashInput(data.reconciliation ? String(data.reconciliation.prestetaGotovina) : "");
      setXOverrideReason(data.reconciliation?.overrideRazlog ?? "");
      setZBlokade(data.blockers ?? []);
    } catch { setZNapaka("Ni mogoče doseči strežnika."); }
    finally { setXCashLoading(false); }
  };

  const handleFinalizirajRacun = async (racunId: number) => {
    if (!requireCurrentActorSession()) return;
    if (!acquirePaymentGuard("Finalizacija računa je v teku.")) return;
    setZFinalizingId(racunId);
    setZNapaka(null);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const response = await posFetch(`${base}/api/racuni/${racunId}/poslovna-finalizacija`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      const data = await response.json() as { error?: string; napaka?: string; stevilkaRacuna?: string };
      if (!response.ok) {
        setZNapaka(data.error ?? data.napaka ?? `Finalizacije ni mogoče dokončati (${response.status}).`);
        releasePaymentGuard();
        return;
      }
      toast({
        title: "Poslovna finalizacija dokončana",
        description: data.stevilkaRacuna
          ? `Račun ${data.stevilkaRacuna} je pripravljen za zaključek dneva.`
          : "Račun je finaliziran.",
      });
      await loadXCash();
      releasePaymentGuard();
    } catch {
      setZNapaka("Ni mogoče doseči strežnika.");
      requirePaymentReconciliation("Izid poslovne finalizacije ni znan. Pred nadaljevanjem preverite račun in nato odklenite plačilni tok.");
    } finally {
      setZFinalizingId(null);
    }
  };

  const saveCashReconciliation = async () => {
    if (!activeBlagajnaId || !Number.isFinite(Number(xCashInput))) return;
    setXCashLoading(true);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const response = await posFetch(`${base}/api/x-porocilo/uskladitev-gotovine`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ blagajnaId: activeBlagajnaId, poslovniDatum: zPoslovniDatum, prestetaGotovina: Number(xCashInput), overrideRazlog: xOverrideReason, idempotencyKey: crypto.randomUUID() }),
      });
      const data = await response.json() as { error?: string; napaka?: string };
      if (!response.ok) { setZNapaka(data.error ?? data.napaka ?? "Uskladitve ni mogoče shraniti."); return; }
      await loadXCash();
    } catch { setZNapaka("Ni mogoče doseči strežnika."); }
    finally { setXCashLoading(false); }
  };

  const handleZNatisni = async (z: ZPorociloSnapshot) => {
    const zdaj = new Date().toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" });
    const linije = formatZPorociloPrintLines({
      width: 32,
      datum: z.poslovniDatum,
      printedAt: zdaj,
      z,
      promet: {
        skupajPromet: z.skupajPromet, skupajDDV: z.skupajDdv,
        prometPoNacinuPlacila: { gotovina: z.gotovina, kartica: z.kartica, sumup: z.sumup, bon: z.bon, bonPica: z.bonPica, steviloBonov: z.steviloBonov, negotovinsko: z.negotovinsko, napitnina: z.znesekNapitnina, reprezentanca: z.reprezentanca, lastna_poraba: z.lastnaPoraba },
        prometPoBlagajnah: [], prometPoNatakarjih: [], ddvPoStopnjah: z.ddvPoStopnjah, prihodkiPoVrsti: { storitve: 0, blago: 0, material: 0 },
        izdaniKuponi: 0, prejetiKuponi: 0, podjetje: { naziv: "", naslov: "", davcnaStevilka: "" }, enota: { id: 0, ime: "" },
      },
      stanje: { menjalniDenar: z.menjalniDenar, gotovinskaProdaja: z.gotovinskaProdaja, pologiGotovine: z.pologiGotovine, izplacilaDobaviteljem: z.izplacilaJobaviteljem, pologiTrr: z.pologiTrr, stanje: z.stanjeBlagajne },
      premiki: [],
    });
    const vrHtml = (s: string) => `<div class="vr">${s.replace(/&/g, "&amp;").replace(/</g, "&lt;")}</div>`;
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Z-porocilo</title><style>@page{margin:3mm 2mm;size:auto}*{margin:0;padding:0;box-sizing:border-box}body{font-family:"Courier New",Courier,monospace;white-space:pre;color:#000;background:#fff;padding:1mm}.vr{white-space:pre}@media print{body{font-size:8pt;line-height:1.3}}</style></head><body>${linije.map(vrHtml).join("\n")}</body><script>window.onload=function(){window.print();setTimeout(function(){window.close();},1200);}<\/script></html>`;
    const blob = new Blob([html], { type: "text/html; charset=utf-8" });
    const blobUrl = URL.createObjectURL(blob);
    const popupWin = window.open("about:blank", "_blank", "width=340,height=640");
    if (popupWin) { popupWin.location.href = blobUrl; setTimeout(() => URL.revokeObjectURL(blobUrl), 30_000); }
  };

  const handleZOdklep = async () => {
    if (!zSnapshot) return;
    if (!zOdklepRazlog.trim()) { setZOdklepNapaka("Razlog odklepa je obvezen."); return; }
    setZOdklepLoading(true); setZOdklepNapaka(null);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const r = await posFetch(`${base}/api/z-porocilo/${zSnapshot.id}/odkleni`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ razlog: zOdklepRazlog.trim() }),
      });
      const data = await r.json() as { error?: string; napaka?: string };
      if (!r.ok) { setZOdklepNapaka(data.error ?? data.napaka ?? `Napaka (${r.status})`); return; }
      setZOdklepOpen(false); setZOdklepRazlog(""); setZSnapshot(null);
      toast({ title: "Z-poročilo odklenjeno", description: "Dan je odklenjen. Nov Z-zaključek bo generiral naslednjo Z-številko." });
    } catch { setZOdklepNapaka("Ni mogoče doseči strežnika."); }
    finally { setZOdklepLoading(false); }
  };

  const [terminalStanje, setTerminalStanje] = useState<TerminalStanje>("idle");
  const [terminalRezultat, setTerminalRezultat] = useState<TerminalRezultat | null>(null);
  // React state alone is not an adequate double-submit guard: two click events
  // can run before React has rendered the disabled button.  The ref is the
  // synchronous authority; state only makes the lock visible to the operator.
  const paymentGuardRef = useRef<"idle" | "in-flight" | "reconciliation-required">("idle");
  const [paymentGuard, setPaymentGuard] = useState<{
    state: "idle" | "in-flight" | "reconciliation-required";
    message: string;
  }>({ state: "idle", message: "" });
  const acquirePaymentGuard = (message: string) => {
    if (paymentGuardRef.current !== "idle") return false;
    paymentGuardRef.current = "in-flight";
    setPaymentGuard({ state: "in-flight", message });
    return true;
  };
  const releasePaymentGuard = () => {
    paymentGuardRef.current = "idle";
    setPaymentGuard({ state: "idle", message: "" });
  };
  const requirePaymentReconciliation = (message: string) => {
    paymentGuardRef.current = "reconciliation-required";
    setPaymentGuard({ state: "reconciliation-required", message });
  };
  const requireCurrentActorSession = () => {
    const selectedId = selectedNatakarId !== "none" ? Number(selectedNatakarId) : null;
    const actorToken = sessionStorage.getItem("pos_actor_session");
    if (actorToken && selectedId) {
      try {
        const encoded = actorToken.split(".")[0];
        const base64 = encoded!.replace(/-/g, "+").replace(/_/g, "/");
        const payload = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))) as { n?: number; e?: number };
        // Potekla seja (strežnik jo zavrne) — takoj zahtevaj PIN, ne šele ob napaki izdaje.
        const potekla = typeof payload.e === "number" && payload.e <= Date.now() + 5_000;
        if (payload.n === selectedId && !potekla) return true;
      } catch {
        // Pokvarjen ali star žeton se spodaj zamenja z novo PIN potrditvijo.
      }
      sessionStorage.removeItem("pos_actor_session");
    } else if (actorToken) {
      try {
        const base64 = actorToken.split(".")[0]!.replace(/-/g, "+").replace(/_/g, "/");
        const { e } = JSON.parse(atob(base64.padEnd(Math.ceil(base64.length / 4) * 4, "="))) as { e?: number };
        if (typeof e === "number" && e <= Date.now() + 5_000) sessionStorage.removeItem("pos_actor_session");
        else return true;
      } catch {
        return true;
      }
    }
    if (selectedId) {
      localStorage.setItem("pos_last_natakar_id", String(selectedId));
      localStorage.setItem("pos_last_operator_id", String(selectedId));
    }
    requestPosActorSession();
    toast({
      title: "Vnesite PIN izbranega natakarja",
      description: "Natakar je že izbran. Vnesite samo njegov PIN in nato izdajo računa ponovno potrdite.",
      variant: "destructive",
    });
    return false;
  };
  const resetPaymentGuardAfterReconciliation = () => {
    // This is deliberately an explicit operator action.  A timeout/network
    // failure must never silently open the way for a second card charge.
    releasePaymentGuard();
    recoveryCompletionAttemptRef.current = null;
    recoverySelectionTokenRef.current = null;
    setRecoverableCardPayment(null);
    setAvailableRecoveries([]);
    setTerminalStanje("idle");
    setTerminalRezultat(null);
  };
  const paymentOrFinalizationInProgress = paymentGuard.state !== "idle";
  const [vivaCheckoutUrl, setVivaCheckoutUrl] = useState<string | null>(null);
  const [vivaBridgeLaunchUrl, setVivaBridgeLaunchUrl] = useState<string | null>(null);
  const [vivaSmartTimeout, setVivaSmartTimeout] = useState(false);
  const [sumupQrCheckoutId, setSumupQrCheckoutId] = useState<string | null>(null);
  const [sumupQrZnesek, setSumupQrZnesek] = useState<number | null>(null);
  const [lastSumupCheckoutId, setLastSumupCheckoutId] = useState<string | null>(null);
  // State se med isto asinhrono funkcijo ne osveži takoj. Ta ref zato nosi
  // točno referenco plačila, ki jo je ravnokar potrdil terminal.
  const currentTerminalReferenceRef = useRef<{ provider: "sumup" | "viva"; value: string } | null>(null);
  // Viva identifikatorji morajo ostati na voljo isti izdaji računa tudi, ko
  // React state še ni ponovno izrisal po uspešnem terminalskem pollingu.
  const vivaPaymentIdentifiersRef = useRef<VivaPaymentIdentifiers>({
    sessionId: null,
    transactionId: null,
    orderCode: null,
  });
  // Isti ključ se uporabi za ponovitev istega terminalskega koraka. Nov ključ
  // nastane šele za drug ponudnik, naročilo ali znesek.
  const cardPaymentAttemptRef = useRef<{ key: string; provider: "payten" | "sumup" | "viva_smart" | "viva_terminal" | "simulacija"; narociloId: number; znesek: number } | null>(null);
  type CardProvider = "payten" | "sumup" | "viva_smart" | "viva_terminal" | "simulacija";
  type RecoverableCardPayment = {
    paymentAttemptId: string;
    attemptId: string;
    provider: CardProvider;
    narociloId: number;
    znesek: number;
    ustvarjeno?: string;
  };
  const [recoverableCardPayment, setRecoverableCardPayment] = useState<RecoverableCardPayment | null>(null);
  const [availableRecoveries, setAvailableRecoveries] = useState<RecoverableCardPayment[]>([]);
  const [cardRecoveryChecking, setCardRecoveryChecking] = useState(false);
  const cardRecoveryRequestRef = useRef(0);
  const recoveryCompletionAttemptRef = useRef<string | null>(null);
  const recoverySelectionTokenRef = useRef<string | null>(null);
  const currentCardBindingRef = useRef<{ narociloId: number | null; znesek: number }>({ narociloId: null, znesek: 0 });
  const cardAttemptStorageKey = (provider: CardProvider, narociloId: number) =>
    `pos.card-payment-attempt.${provider}.${narociloId}`;
  const getCardPaymentAttemptId = (provider: CardProvider, narociloId: number, znesek: number) => {
    const current = cardPaymentAttemptRef.current;
    if (current && current.provider === provider && current.narociloId === narociloId && current.znesek === znesek) return current.key;
    try {
      const stored = JSON.parse(sessionStorage.getItem(cardAttemptStorageKey(provider, narociloId)) ?? "null") as { key?: string; znesek?: number } | null;
      if (stored?.key && stored.znesek === znesek) return stored.key;
    } catch { /* invalid old browser storage is replaced below */ }
    return crypto.randomUUID();
  };
  const rememberCardPaymentAttempt = (provider: CardProvider, narociloId: number, znesek: number, key: string) => {
    cardPaymentAttemptRef.current = { key, provider, narociloId, znesek };
    sessionStorage.setItem(cardAttemptStorageKey(provider, narociloId), JSON.stringify({ key, znesek }));
  };
  const clearCardPaymentAttempt = () => {
    const current = cardPaymentAttemptRef.current;
    if (current) sessionStorage.removeItem(cardAttemptStorageKey(current.provider, current.narociloId));
    cardPaymentAttemptRef.current = null;
    recoveryCompletionAttemptRef.current = null;
    recoverySelectionTokenRef.current = null;
    setRecoverableCardPayment(null);
    setAvailableRecoveries([]);
  };
  const giftCardPaymentStateRef = useRef<GiftCardPaymentState | null>(null);
  const confirmedGiftCardPaymentRef = useRef<{ idempotencyKey: string; amountCents: number; attemptId: string } | null>(null);
  const [sumupQrLinkKopiran, setSumupQrLinkKopiran] = useState(false);

  const [steviloBonov, setSteviloBonov] = useState(0);
  const DARILNI_BON_KORAK = 10;
  const [znesekDarilnegaBona, setZnesekDarilnegaBona] = useState(0);
  const [znesekSubvencija, setZnesekSubvencija] = useState(0);
  const [sspReferenca, setSspReferenca] = useState("");
  const [sekundarniNacin, setSekundarniNacin] = useState<"gotovina" | "kartica">("gotovina");
  const [individualVoucherMode, setIndividualVoucherMode] = useState(false);
  const [individualVoucherCode, setIndividualVoucherCode] = useState("");
  const [individualVoucherPreview, setIndividualVoucherPreview] = useState<IndividualVoucherPreview | null>(null);
  useEffect(() => {
    setIndividualVoucherMode(false);
    setIndividualVoucherCode("");
    setIndividualVoucherPreview(null);
  }, [effectiveSelectedOrderKey]);
  const [darilniBonDialogOpen, setDarilniBonDialogOpen] = useState(false);
  const [darilniBonZnesekIzdaja, setDarilniBonZnesekIzdaja] = useState("");
  const [darilniBonPlaciloIzdaja, setDarilniBonPlaciloIzdaja] = useState<"gotovina" | "kartica">("gotovina");
  // Isti ključ ostane živ ob mrežnem ponavljanju iste izdaje, po uspehu pa se
  // zavrže za naslednji samostojni bon.
  const darilniBonIdempotencyKeyRef = useRef<string | null>(null);
  const racunIdempotencyRef = useRef<{ key: string; fingerprint: string } | null>(null);
  const [darilniBonStanje, setDarilniBonStanje] = useState<DarilniBonStanje | null>(null);
  const [darilniBonLoading, setDarilniBonLoading] = useState(false);
  const [darilniBonIzdajanje, setDarilniBonIzdajanje] = useState(false);
  const [darilniBonNapaka, setDarilniBonNapaka] = useState<string | null>(null);

  useEffect(() => {
    const restored = readGiftCardPaymentState(sessionStorage, getEnotaId(), napravaKljuc);
    giftCardPaymentStateRef.current = restored;
    if (!restored) return;
    darilniBonIdempotencyKeyRef.current = restored.idempotencyKey;
    setDarilniBonZnesekIzdaja(current => current || (restored.amountCents / 100).toFixed(2));
    setDarilniBonPlaciloIzdaja("kartica");
    if (restored.status === "completed" && restored.attemptId) {
      confirmedGiftCardPaymentRef.current = {
        idempotencyKey: restored.idempotencyKey,
        amountCents: restored.amountCents,
        attemptId: restored.attemptId,
      };
    }
  }, [napravaKljuc]);

  const naloziDarilniBonStanje = async () => {
    const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
    const response = await posFetch(`${base}/api/darilni-boni/stanje`);
    if (!response.ok) throw new Error("Stanja darilnih bonov ni bilo mogoče pridobiti.");
    const stanje = await response.json() as DarilniBonStanje;
    setDarilniBonStanje(stanje);
    return stanje;
  };

  const odpriIzdajoDarilnegaBona = () => {
    setDarilniBonDialogOpen(true);
    setDarilniBonNapaka(null);
    setDarilniBonLoading(true);
    void naloziDarilniBonStanje()
      .catch((error: unknown) => setDarilniBonNapaka(error instanceof Error ? error.message : "Napaka pri branju evidence bonov."))
      .finally(() => setDarilniBonLoading(false));
  };

  const izdajDarilniBon = async () => {
    if (!requireCurrentActorSession()) return;
    if (!acquirePaymentGuard("Izdaja darilnega bona je v teku.")) return;
    const normalizedAmount = darilniBonZnesekIzdaja.trim().replace(",", ".");
    if (!/^\d+(?:\.\d{1,2})?$/.test(normalizedAmount)) {
      setDarilniBonNapaka("Vnesite znesek z največ dvema decimalnima mestoma.");
      releasePaymentGuard();
      return;
    }
    const znesek = Number(normalizedAmount);
    const amountCents = Math.round(znesek * 100);
    if (!Number.isFinite(znesek) || amountCents <= 0 || amountCents > 1_000_000) {
      setDarilniBonNapaka("Znesek darilnega bona mora biti med 0,01 € in 10.000,00 €.");
      releasePaymentGuard();
      return;
    }
    setDarilniBonIzdajanje(true);
    setDarilniBonNapaka(null);
    try {
      const persistedPayment = giftCardPaymentStateRef.current
        ?? readGiftCardPaymentState(sessionStorage, getEnotaId(), napravaKljuc);
      const idempotencyKey = darilniBonIdempotencyKeyRef.current
        ?? persistedPayment?.idempotencyKey
        ?? crypto.randomUUID();
      darilniBonIdempotencyKeyRef.current = idempotencyKey;
      if (persistedPayment && persistedPayment.amountCents !== amountCents) {
        throw new Error("Obstoječi kartični poskus je vezan na drug znesek. Dokončajte ga z istim zneskom.");
      }
      if (darilniBonPlaciloIzdaja === "gotovina" && confirmedGiftCardPaymentRef.current) {
        throw new Error("Kartično plačilo je že potrjeno. Darilni bon izdajte s kartico in z istim zneskom.");
      }
      if (darilniBonPlaciloIzdaja === "kartica") {
        const confirmedPayment = confirmedGiftCardPaymentRef.current;
        if (confirmedPayment) {
          if (confirmedPayment.idempotencyKey !== idempotencyKey || confirmedPayment.amountCents !== amountCents) {
            throw new Error("Za že potrjeno kartično plačilo ponovite izdajo z istim zneskom.");
          }
        } else if (!showSumupFlow) {
          throw new Error("Izbrani kartični terminal za izdajo bona ne vrne varne reference plačila.");
        } else {
          const attemptId = await sendGiftToSumup(idempotencyKey, amountCents);
          if (!attemptId) throw new Error("Kartično plačilo ni bilo potrjeno; darilni bon ni izdan.");
          confirmedGiftCardPaymentRef.current = {
            idempotencyKey,
            amountCents,
            attemptId,
          };
        }
      }

      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const headers: Record<string, string> = { "Content-Type": "application/json" };
      if (napravaKljuc) headers["X-Naprava-Id"] = napravaKljuc;
      const response = await posFetch(`${base}/api/darilni-boni/izdaja`, {
        method: "POST",
        credentials: "include",
        headers,
        body: JSON.stringify({
          znesek: amountCents / 100,
          placilnaNacin: darilniBonPlaciloIzdaja,
          idempotencyKey,
          natakariId: selectedNatakarId !== "none" ? parseInt(selectedNatakarId) : null,
          blagajnaId: activeBlagajnaId ?? null,
          ...(darilniBonPlaciloIzdaja === "kartica"
            ? {
                paymentAttemptId: buildCardGiftIssuancePayment({
                  idempotencyKey,
                  amountCents,
                  attemptId: confirmedGiftCardPaymentRef.current?.attemptId,
                }).paymentAttemptId,
              }
            : {}),
        }),
      });
      const result = await response.json() as {
        error?: string;
        id?: number;
        stevilkaRacuna?: string;
        skupaj?: number;
        status?: string;
        datumCas?: string;
        zoi?: string | null;
        eor?: string | null;
        fursNapaka?: string | null;
        stanje?: DarilniBonStanje;
        opozorilo?: string;
        pending?: boolean;
        fursState?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "Darilnega bona ni bilo mogoče izdati.");
      if (response.status === 202 || result.pending || result.fursState === "unknown" || result.fursState === "sending") {
        throw new Error(result.error ?? "Izid izdaje še ni dokončen. Poskusite ponovno z istim ključem; plačila ne ponavljajte.");
      }
      setDarilniBonStanje(result.stanje ?? await naloziDarilniBonStanje());
      setDarilniBonZnesekIzdaja("");
      setDarilniBonDialogOpen(false);
      darilniBonIdempotencyKeyRef.current = null;
      confirmedGiftCardPaymentRef.current = null;
      giftCardPaymentStateRef.current = null;
      clearGiftCardPaymentState(sessionStorage, getEnotaId(), napravaKljuc);
      setFursNapaka(result.fursNapaka ?? null);
      if (result.id && result.stevilkaRacuna && result.status && result.datumCas) {
        setIssuedRacun({
          id: result.id,
          stevilkaRacuna: result.stevilkaRacuna,
          skupaj: result.skupaj ?? znesek,
          zoi: result.zoi ?? null,
          eor: result.eor ?? null,
          status: result.status,
          opozorilo: result.opozorilo ?? null,
          jeDelni: false,
          narociloId: null,
          datumCas: new Date(result.datumCas),
        });
      }
      queryClient.invalidateQueries({ queryKey: getListRacuniQueryKey() });
      toast({
        title: "Darilni bon je izdan",
        description: `${result.stevilkaRacuna ?? "Račun"} · ${znesek.toFixed(2)} €. ${result.opozorilo ?? ""}`.trim(),
      });
      releasePaymentGuard();
    } catch (error) {
      setDarilniBonNapaka(error instanceof Error ? error.message : "Darilnega bona ni bilo mogoče izdati.");
      requirePaymentReconciliation("Izid izdaje darilnega bona ni znan. Preverite evidenco bonov in račun, preden odklenete nov poskus.");
    } finally {
      setDarilniBonIzdajanje(false);
    }
  };

  useEffect(() => {
    if (placilniNacin !== "bon") return;
    void naloziDarilniBonStanje().catch(() => {
      // Evidenca je informativna; opozorilo ob presežku zagotovi strežnik.
    });
  }, [placilniNacin]);

  const [splitMode, setSplitMode] = useState(false);
  const [splitPostavkeIds, setSplitPostavkeIds] = useState<Set<number>>(new Set());
  const [spojiPosameznoId, setSpojiPosameznoId] = useState<number | null>(null);
  const [združiDialogOpen, setZdruziDialogOpen] = useState(false);
  const [združiIzbrana, setZdruziIzbrana] = useState<Set<number>>(new Set());

  const [kupecDavcna, setKupecDavcna] = useState("");
  const [kupecNaziv, setKupecNaziv] = useState<string | null>(null);
  const [kupecNaslov, setKupecNaslov] = useState<string | null>(null);
  const [kupecNapaka, setKupecNapaka] = useState<string | null>(null);
  const [kupecIscemo, setKupecIscemo] = useState(false);
  const [kupecRocniVnos, setKupecRocniVnos] = useState(false);
  const [kupecZavezanecDdv, setKupecZavezanecDdv] = useState(false);
  const [kupecId, setKupecId] = useState<string | null>(null);
  // enabled: false ko kupecId ni izbran — preprečimo klic z ID="" → 404
  const { data: kupecCenik } = useGetPartnerjiCenik(kupecId ?? "", {
    query: { enabled: kupecId !== null } as any,
  });

  // Auto-select naročilo iz URL param (?narocilo=ID)
  useEffect(() => {
    if (!narocila || autoSelectedRef.current || !preselectedId) return;
    const id = parseInt(preselectedId);
    if (isNaN(id)) return;
    const najdeno = narocila.find(n => n.id === id);
    if (najdeno) {
      setSelectedNarocilo(id);
      autoSelectedRef.current = true;
    }
  }, [narocila, preselectedId]);

  // Reset ko se zamenja naročilo
  useEffect(() => {
    // Viva callbacks restore payment context before the URL auto-selects the
    // order. Do not overwrite it while their secure confirmation is pending.
    if (
      selectedNarocilo !== null &&
      (vivaAndroidAutoIssueNarociloRef.current === selectedNarocilo
        || vivaTapToPayAutoIssueNarociloRef.current === selectedNarocilo)
    ) return;
    const izbranoNarocilo = narocila?.find((n) => n.id === selectedNarocilo)
      ?? (resumeNarocilo?.id === selectedNarocilo ? resumeNarocilo : undefined);
    const predlaganaQrNapitnina = Number(izbranoNarocilo?.znesekNapitnina ?? 0);
    setPlacilniNacin(predlaganaQrNapitnina > 0 ? "kartica" : "gotovina");
    setZnesekNapitnina(predlaganaQrNapitnina);
    znesekNapitninaRef.current = predlaganaQrNapitnina;
    const nacin = predlaganaQrNapitnina > 0 ? "card" : "cash";
    setNacinZajemaNapitnine(nacin);
    nacinZajemaNapitnineRef.current = nacin;
    setSteviloBonov(0);
    setZnesekDarilnegaBona(0);
    setIndividualVoucherMode(false);
    setIndividualVoucherCode("");
    setIndividualVoucherPreview(null);
    setZnesekSubvencija(0);
    setSspReferenca("");
    setSplitMode(false);
    setSplitPostavkeIds(new Set());
    autoSplitDoneRef.current = null;
  }, [selectedNarocilo, narocila, resumeNarocilo]);

  const dovoljeneMizeSet = naprava?.dovoljeneMize?.length
    ? new Set(naprava.dovoljeneMize)
    : null;
  const odprta = (narocila?.filter(n =>
    n.status === "odprto" &&
    (n.postavke?.length ?? 0) > 0 &&
    (dovoljeneMizeSet === null || n.mizaId == null || dovoljeneMizeSet.has(n.mizaId))
  ) ?? []);
  // Po Android callbacku ima neposredni odgovor za naročilo prednost pred
  // seznamom aktivnih naročil. Seznam se lahko med povratkom osveži in
  // vsebuje staro ali začasno manjkajočo vrstico, medtem ko je ta odgovor
  // namenjen prav nadaljevanju izdaje računa.
  const selectedOrder = gatewayCheckoutMode && selectedGatewayOrderId
    ? (narocila ?? []).find(n => String(n.id) === selectedGatewayOrderId)
    : resumeNarocilo?.id === selectedNarocilo
    ? resumeNarocilo
    : odprta.find(n => n.id === selectedNarocilo);
  const gatewayCloudOrderId = (() => {
    if (!gatewayCheckoutMode || !selectedOrder) return null;
    const candidate = (selectedOrder as typeof selectedOrder & { cloudOrderId?: unknown }).cloudOrderId;
    const numeric = typeof candidate === "number" ? candidate : Number(candidate);
    return Number.isSafeInteger(numeric) && numeric > 0 ? numeric : null;
  })();
  useEffect(() => {
    const snapshot = paytenRecoverySnapshotRef.current;
    if (!snapshot || !selectedOrder) return;
    setPlacilniNacin(snapshot.placilniNacin);
    setSekundarniNacin(snapshot.sekundarniNacin);
    setZnesekDarilnegaBona(snapshot.znesekDarilnegaBona);
    setSteviloBonov(snapshot.steviloBonov);
    setZnesekNapitnina(snapshot.znesekNapitnina); znesekNapitninaRef.current = snapshot.znesekNapitnina;
    setNacinZajemaNapitnine(snapshot.nacinZajemaNapitnine); nacinZajemaNapitnineRef.current = snapshot.nacinZajemaNapitnine;
  }, [selectedOrder]);
  const [offlineOrderLocked, setOfflineOrderLocked] = useState(false);
  useEffect(() => {
    setOfflineOrderLocked(effectiveSelectedOrderKey != null && isOfflineOrderLocked(effectiveSelectedOrderKey));
  }, [effectiveSelectedOrderKey]);

  const getNarociloPayload = useCallback(() => {
    if (!selectedOrder) return null;
    return {
      id: selectedOrder.id,
      nacin: (selectedOrder as any).nacin,
      status: selectedOrder.status,
      miza: selectedOrder.mizaId,
      strankaIme: selectedOrder.strankaIme,
      telefon: selectedOrder.strankaTelefon,
      naslovDostave: selectedOrder.dostavaUlica
        ? [
            `${selectedOrder.dostavaUlica} ${selectedOrder.dostavaHisnaStevilka ?? ""}`.trim(),
            selectedOrder.dostavaNaseljeNaziv,
          ].filter(Boolean).join(", ")
        : null,
      skupaj: selectedOrder.skupaj,
      postavke: (selectedOrder.postavke ?? []).filter((p: any) => !p.parentPostavkaId).map((p: any) => ({
        naziv: p.ime,
        kolicina: p.kolicina,
        skupaj: p.skupaj,
        opomba: p.opomba
      }))
    };
  }, [selectedOrder]);

  const aiSvetovalec = useAiSvetovalec("blagajna", getNarociloPayload);

  useEffect(() => {
    const items = selectedOrder?.postavke ?? [];
    void Promise.all([
      cacheOfflineSnapshot("catalog", items),
      cacheOfflineSnapshot("taxes", items.map(postavka => ({ id: postavka.id, davek: postavka.davek }))),
    ]);
  }, [selectedOrder]);

  // Avtomatsko vklopi razdelitev računa kadar ima naročilo več gostov,
  // ali kadar je bil iz naročila posredovan specifičen gost (?gost=N)
  useEffect(() => {
    if (gatewayCheckoutMode) {
      setSplitMode(false);
      setSplitPostavkeIds(new Set());
      return;
    }
    if (!selectedOrder || selectedOrder.id === autoSplitDoneRef.current) return;
    const uncovered = (selectedOrder.postavke ?? []).filter(p => p.racunId === null);
    const gostStevilkaField = (p: typeof uncovered[0]) =>
      (p as typeof p & { gostStevilka?: number | null }).gostStevilka ?? null;
    const gostji = [...new Set(
      uncovered.map(gostStevilkaField).filter((g): g is number => g !== null)
    )].sort((a, b) => a - b);

    // Specifičen gost iz URL (?gost=N) — aktiviraj split z njegovimi postavkami
    if (preselectedGost !== null && gostji.includes(preselectedGost)) {
      autoSplitDoneRef.current = selectedOrder.id;
      setSplitMode(true);
      setSplitPostavkeIds(new Set(
        uncovered.filter(p => gostStevilkaField(p) === preselectedGost).map(p => p.id)
      ));
      return;
    }

    // Privzeto: auto-split ko ima naročilo 2+ gostov
    if (gostji.length < 2 || uncovered.length <= 1) return;
    autoSplitDoneRef.current = selectedOrder.id;
    setSplitMode(true);
    setSplitPostavkeIds(new Set(
      uncovered.filter(p => gostStevilkaField(p) === gostji[0]).map(p => p.id)
    ));
  }, [selectedOrder, preselectedGost, gatewayCheckoutMode]);
  const aktivniOperaterji = availableShiftOperators(aktivneIzmene);
  useEffect(() => {
    if (!isLocalFiscalServiceEnabled()) return;
    if (selectedNatakarId === "none") return;
    const selectedShift = aktivniOperaterji.find(item => String(item.natakariId) === selectedNatakarId);
    if (!selectedShift) return;
    void discoverLocalFiscalCapability().then(async capability => {
      if (!capability?.identity || capability.envelopeFormat !== "furs-v2") return;
      const headers = await getPosAuthHeaders(
        napravaKljuc ? { "X-Naprava-Id": napravaKljuc } : undefined,
      );
      await fetchAndCacheOfflineAuthorityBundle({
        deviceId: capability.identity.deviceId,
        waiterId: selectedShift.natakariId,
        shiftId: selectedShift.id,
        identity: capability.identity,
        headers: Object.fromEntries(headers.entries()),
      });
    }).catch(() => {
      // A previous still-valid signed bundle remains usable. Offline issuance
      // performs full signature, scope, operator and validity checks again.
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNatakarId, aktivneIzmene, napravaKljuc]);

  // Druga odprta naročila na isti mizi
  const drugaNarocilaIsteMize = selectedOrder?.mizaId != null
    ? odprta.filter(n => n.mizaId === selectedOrder.mizaId && n.id !== selectedOrder.id)
    : [];

  const steviloNarocilaLabel = (n: number) => {
    if (n === 1) return "1 odprto naročilo";
    if (n === 2) return "2 odprti naročili";
    if (n >= 3 && n <= 4) return `${n} odprta naročila`;
    return `${n} odprtih naročil`;
  };

  // Mirroring server-side round formula (needed for computed values below)
  const round2 = (n: number) => Math.round(n * 100) / 100;

  // Uncovered = postavke that haven't been billed yet
  const uncoveredPostavke = selectedOrder?.postavke?.filter(p => p.racunId === null) ?? [];
  const billedPostavke = selectedOrder?.postavke?.filter(p => p.racunId != null) ?? [];

  // A modifier tree is billed as one commercial component. Keep the split
  // selection in sync with the server by including every available ancestor
  // and descendant, not just the immediate children of a selected item.
  const effectiveSplitPostavkeIds = splitMode
    ? expandCheckoutSplitPostavkaIds(splitPostavkeIds, uncoveredPostavke)
    : new Set<number>();

  // In split mode, only the user-selected subset; otherwise all uncovered
  const effectivePostavke = splitMode
    ? uncoveredPostavke.filter(p => effectiveSplitPostavkeIds.has(p.id))
    : uncoveredPostavke;

  const effectiveSkupaj = round2(effectivePostavke.reduce((acc, p) => acc + Number(p.skupaj), 0));
  const nezaracunaneSkupaj = round2(uncoveredPostavke.reduce((acc, p) => acc + Number(p.skupaj), 0));

  // Partnerski cenik — prekalkuliran skupaj za efektivne postavke
  const cenikMap = kupecCenik && kupecCenik.length > 0
    ? new Map(kupecCenik.map(c => [c.artikelId, c.cena]))
    : null;
  const effectiveSkupajSCenikom = cenikMap
    ? round2(effectivePostavke.reduce((acc, p) => {
        const customCena = (p as typeof p & { artikelId?: number | null }).artikelId != null
          ? cenikMap.get((p as typeof p & { artikelId?: number | null }).artikelId!)
          : undefined;
        return acc + (customCena !== undefined ? round2(customCena * Number(p.kolicina)) : Number(p.skupaj));
      }, 0))
    : null;

  // Za reprezentanco/lastno porabo: vse cene v UI = 0 (100% popust); DDV za račun/FURS se računa v ozadju
  const jeBrezplacno = placilniNacin === "reprezentanca" || placilniNacin === "lastna_poraba";

  // displaySkupaj — effectiveSkupaj z upoštevanjem cenika (za prikaz in plačilo)
  const displaySkupaj = jeBrezplacno ? 0 : (effectiveSkupajSCenikom ?? effectiveSkupaj);
  const displayNezaracunaneSkupaj = jeBrezplacno ? 0 : (cenikMap
    ? round2(uncoveredPostavke.reduce((acc, p) => {
        const customCena = (p as typeof p & { artikelId?: number | null }).artikelId != null
          ? cenikMap.get((p as typeof p & { artikelId?: number | null }).artikelId!)
          : undefined;
        return acc + (customCena !== undefined ? round2(customCena * Number(p.kolicina)) : Number(p.skupaj));
      }, 0))
    : nezaracunaneSkupaj);

  // DDV razčlenitev po stopnjah za prikaz pred izdajo (upošteva cenik)
  const ddvPoStopnjahDisplay: { stopnja: number; osnova: number; ddvZnesek: number }[] = (() => {
    const stopnjeMap = new Map<number, { osnova: number; ddvZnesek: number }>();
    for (const p of effectivePostavke) {
      const customCena = (cenikMap && (p as typeof p & { artikelId?: number | null }).artikelId != null)
        ? cenikMap.get((p as typeof p & { artikelId?: number | null }).artikelId!)
        : undefined;
      const vsota = customCena !== undefined ? round2(customCena * Number(p.kolicina)) : Number(p.skupaj);
      const stopnja = Number(p.davek);
      const ddvZ = round2(vsota * stopnja / (100 + stopnja));
      const osnova = round2(vsota - ddvZ);
      const cur = stopnjeMap.get(stopnja) ?? { osnova: 0, ddvZnesek: 0 };
      stopnjeMap.set(stopnja, { osnova: round2(cur.osnova + osnova), ddvZnesek: round2(cur.ddvZnesek + ddvZ) });
    }
    return [...stopnjeMap.entries()]
      .sort(([a], [b]) => a - b)
      .map(([stopnja, v]) => ({ stopnja, ...v }));
  })();

  // Detect pizza items (by jePica flag)
  const piceSeznam: { cenaKos: number; ime: string }[] = [];
  for (const p of effectivePostavke) {
    if (p.kolicina > 0 && p.jePica) {
      for (let i = 0; i < p.kolicina; i++) {
        piceSeznam.push({ cenaKos: Number(p.cenaKos), ime: p.ime });
      }
    }
  }
  // Sort descending by price so most expensive are covered first
  piceSeznam.sort((a, b) => b.cenaKos - a.cenaKos);

  const skupnoStevicoPic = piceSeznam.length;
  const showBonZaPico = skupnoStevicoPic > 0;
  const steviloBonovDejanski = Math.min(steviloBonov, skupnoStevicoPic);
  const znesekBonov = piceSeznam
    .slice(0, steviloBonovDejanski)
    .reduce((sum, p) => sum + p.cenaKos, 0);
  const znesekPreostalega = Math.max(0, displaySkupaj - znesekBonov);
  const vsePlacanoZBoni = steviloBonovDejanski > 0 && znesekPreostalega < 0.005;

  // Darilni bon
  const znesekDarilnegaBonaDejanski = placilniNacin === "bon"
    ? individualVoucherMode
      ? (individualVoucherPreview
        ? Math.min(individualVoucherPreview.balanceCents / 100, znesekPreostalega)
        : 0)
      : Math.min(znesekDarilnegaBona, znesekPreostalega)
    : 0;
  const znesekPoKritiZDarilnimBonom = Math.max(0, znesekPreostalega - znesekDarilnegaBonaDejanski);
  const vsePlacanoZDarilnimBonom = placilniNacin === "bon" && znesekDarilnegaBonaDejanski > 0 && znesekPoKritiZDarilnimBonom < 0.005;
  // SŠP ostane ločen od bonov za pico in darilnih bonov: gre za terjatev, ne popust.
  const sspDovoljen = nastavitve?.studentskiBonAktiven === true
    && steviloBonovDejanski === 0
    && (placilniNacin === "gotovina" || placilniNacin === "kartica");
  const znesekSubvencijaDejanski = sspDovoljen
    ? Math.min(Math.max(0, znesekSubvencija), znesekPreostalega)
    : 0;
  const znesekZaDoplacilo = Math.max(0, znesekPreostalega - znesekSubvencijaDejanski);
  const jeKarticniTok = placilniNacin === "kartica"
    || (placilniNacin === "bon" && sekundarniNacin === "kartica" && !vsePlacanoZDarilnimBonom);
  const znesekKarticnegaDoplacila = placilniNacin === "bon"
    ? znesekPoKritiZDarilnimBonom
    : znesekZaDoplacilo;
  const placiloOmogocaNapitnino = placilniNacin === "gotovina"
    || placilniNacin === "kartica"
    || (placilniNacin === "bon" && !vsePlacanoZDarilnimBonom);
  const lahkoNapitnina = placiloOmogocaNapitnino
    && (znesekZaDoplacilo > 0.005 || znesekPoKritiZDarilnimBonom > 0.005);
  const dejanskiNacinZajemaNapitnine: TipCaptureMethod = jeKarticniTok
    ? nacinZajemaNapitnineRef.current
    : "cash";
  const zajemNapitnine = applyTipCapture(
    0,
    znesekKarticnegaDoplacila,
    lahkoNapitnina ? znesekNapitnina : 0,
    dejanskiNacinZajemaNapitnine,
  );
  const terminalskiZnesek = zajemNapitnine.card;
  const karticnaNapitnina = dejanskiNacinZajemaNapitnine === "card"
    ? round2(lahkoNapitnina ? znesekNapitnina : 0)
    : 0;

  // Per-naprava terminal override: null = prioritetna veriga trenutne naprave,
  // 'none' = brez, spec. vrednost = točno ta terminal.
  const napravaTerminal = naprava?.placilniTerminal ?? null;
  const terminalConfig = naprava?.terminalConfig ?? null;

  // Prioritetna veriga uporablja izključno zastavice trenutne naprave:
  // Payten HW → Payten Android SW → SumUp → Viva Cloud → Viva Android → Viva TtP → Viva Smart.
  const _aktivniTerminal = izracunajAktivniTerminal(
    terminalConfig,
    napravaTerminal as NapravaTerminalOverride,
  );
  const terminalAktiven          = _aktivniTerminal === "payten_hw";
  const paytenAndroidAktiven     = _aktivniTerminal === "payten_android";
  const sumupAktiven             = _aktivniTerminal === "sumup";
  const vivaTerminalAktiven      = _aktivniTerminal === "viva_cloud";
  const vivaAndroidTerminalAktiven = _aktivniTerminal === "viva_android";
  const vivaTapToPayAktiven      = _aktivniTerminal === "viva_ttp";
  const vivaAktiven              = _aktivniTerminal === "viva_smart";
  const showTerminalFlow = jeKarticniTok && terminalAktiven && !vsePlacanoZBoni && znesekKarticnegaDoplacila > 0.005;
  const showPaytenAndroidFlow = jeKarticniTok && paytenAndroidAktiven && !vsePlacanoZBoni && znesekKarticnegaDoplacila > 0.005;
  const showSumupFlow = jeKarticniTok && sumupAktiven && !vsePlacanoZBoni && znesekKarticnegaDoplacila > 0.005;
  const showVivaTerminalFlow = jeKarticniTok && vivaTerminalAktiven && !vsePlacanoZBoni && znesekKarticnegaDoplacila > 0.005;
  const showVivaAndroidTerminalFlow = jeKarticniTok && vivaAndroidTerminalAktiven && !vsePlacanoZBoni && znesekKarticnegaDoplacila > 0.005;
  const showVivaTapToPayFlow = jeKarticniTok && vivaTapToPayAktiven && !vsePlacanoZBoni && znesekKarticnegaDoplacila > 0.005;
  const showVivaFlow = jeKarticniTok && vivaAktiven && !vsePlacanoZBoni && znesekKarticnegaDoplacila > 0.005;
  // This control is intentionally absent from production bundles and from
  // units without the explicit simulation capability. The server repeats all
  // checks and remains the authority for both amount and eligibility.
  const simulationAmount = selectedOrder
    ? round2(Number(selectedOrder.skupaj) + Number((selectedOrder as typeof selectedOrder & { znesekNapitnina?: number }).znesekNapitnina ?? 0))
    : 0;
  const showSimulationFlow = import.meta.env.DEV
    && nastavitve?.fursNacin === "simulacija"
    && user?.capabilities?.includes("simulation") === true
    && placilniNacin === "kartica"
    && !splitMode
    && terminalskiZnesek > 0
    && Math.abs(terminalskiZnesek - simulationAmount) < 0.005;
  currentCardBindingRef.current = { narociloId: selectedNarocilo, znesek: terminalskiZnesek };
  const findStoredCardAttempt = (narociloId: number, znesek: number) => {
    const providers: CardProvider[] = ["payten", "sumup", "viva_smart", "viva_terminal", "simulacija"];
    for (const provider of providers) {
      try {
        const stored = JSON.parse(sessionStorage.getItem(cardAttemptStorageKey(provider, narociloId)) ?? "null") as { key?: string; znesek?: number } | null;
        if (stored?.key && stored.znesek === znesek) return { provider, key: stored.key };
      } catch { /* invalid storage is ignored */ }
    }
    return null;
  };
  const inspectRecoverableCardPayment = async (
    provider: CardProvider,
    narociloId: number,
    znesek: number,
    paymentAttemptId: string,
  ): Promise<boolean> => {
    const requestId = ++cardRecoveryRequestRef.current;
    setCardRecoveryChecking(true);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const params = new URLSearchParams({ narociloId: String(narociloId), znesek: znesek.toFixed(2) });
      const response = await posFetch(
        `${base}/api/terminal/card-payment-attempts/${encodeURIComponent(paymentAttemptId)}/recovery?${params}`,
      );
      if (!response.ok) return false;
      const result = await response.json() as {
        paymentAttemptId: string;
        attemptId: string;
        provider: CardProvider;
        status: string;
        recoverable: boolean;
      };
      const currentBinding = currentCardBindingRef.current;
      if (
        requestId !== cardRecoveryRequestRef.current
        || currentBinding.narociloId !== narociloId
        || Math.abs(currentBinding.znesek - znesek) >= 0.005
      ) return false;
      if (!result.recoverable || result.status !== "completed") return false;
      const recovered = {
        paymentAttemptId: result.paymentAttemptId,
        attemptId: result.attemptId,
        provider: result.provider,
        narociloId,
        znesek,
      };
      rememberCardPaymentAttempt(provider, narociloId, znesek, result.paymentAttemptId);
      setRecoverableCardPayment(recovered);
      setAvailableRecoveries([recovered]);
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: "Kartično plačilo je že potrjeno, račun pa še ni izdan. Plačila ne ponavljajte." });
      requirePaymentReconciliation("Potrjeno plačilo lahko varno povežete z računom brez nove bremenitve.");
      return true;
    } catch {
      return false;
    } finally {
      if (requestId === cardRecoveryRequestRef.current) {
        setCardRecoveryChecking(false);
      }
    }
  };

  useEffect(() => {
    if (!selectedNarocilo || terminalskiZnesek <= 0 || !jeKarticniTok || issuedRacun) return;
    const stored = findStoredCardAttempt(selectedNarocilo, terminalskiZnesek);
    if (stored) {
      void inspectRecoverableCardPayment(stored.provider, selectedNarocilo, terminalskiZnesek, stored.key);
    }
    return () => { cardRecoveryRequestRef.current += 1; };
  // Recovery is intentionally keyed only by the immutable payment binding.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNarocilo, terminalskiZnesek, jeKarticniTok, issuedRacun]);
  useEffect(() => {
    // A recovery selection is valid only for the exact immutable checkout
    // binding that exposed it. Keep browser storage for same-device recovery,
    // but never carry a displayed candidate or completion marker across a
    // payment/order change.
    recoveryCompletionAttemptRef.current = null;
    recoverySelectionTokenRef.current = null;
    setRecoverableCardPayment(null);
    setAvailableRecoveries([]);
  }, [selectedNarocilo, terminalskiZnesek, jeKarticniTok]);
  useEffect(() => {
    if (!selectedNarocilo || terminalskiZnesek <= 0 || !jeKarticniTok || issuedRacun) return;
    // The same-device path keeps its precise key verification. The broader
    // discovery query is for a new browser/session and must not race it.
    if (findStoredCardAttempt(selectedNarocilo, terminalskiZnesek)) return;
    const requestId = ++cardRecoveryRequestRef.current;
    const load = async () => {
      try {
        const base = import.meta.env.BASE_URL.replace(/\/$/, "");
        const params = new URLSearchParams({ narociloId: String(selectedNarocilo), znesek: terminalskiZnesek.toFixed(2) });
        const response = await posFetch(`${base}/api/terminal/card-payment-attempts/recovery?${params}`);
        if (!response.ok) return;
        const result = await response.json() as { attempts?: Array<{ paymentAttemptId: string; attemptId: string; provider: CardProvider; znesek: number; ustvarjeno?: string }> };
        if (requestId !== cardRecoveryRequestRef.current) return;
        const attempts = (result.attempts ?? []).filter(attempt =>
          attempt.paymentAttemptId && attempt.attemptId && Number(attempt.znesek) === terminalskiZnesek,
        ).map(attempt => ({ ...attempt, narociloId: selectedNarocilo, znesek: terminalskiZnesek }));
        setAvailableRecoveries(attempts);
        if (attempts.length > 0) {
          // Discovery never issues a receipt. It only presents the operator with
          // a server-filtered choice, which must be confirmed by the button.
          setRecoverableCardPayment(attempts[0]);
          setTerminalStanje("napaka");
          setTerminalRezultat({ napaka: "Najdeno je potrjeno plačilo brez računa. Pred nadaljevanjem ga izrecno izberite." });
          requirePaymentReconciliation("Izberite potrjeno plačilo, ki ga želite povezati z računom.");
        }
      } catch { /* A stored same-device attempt remains available for its existing check. */ }
    };
    void load();
    return () => { cardRecoveryRequestRef.current += 1; };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNarocilo, terminalskiZnesek, jeKarticniTok, issuedRacun]);
  // Preverimo samo NEzaračunane postavke (racunId === null) — zaračunane imajo zaklenjene
  // cene in ne smejo vplivati na konsistentnostni pregled pred novo izdajo.
  const nezaracunanePostavkeZaCheck = selectedOrder?.postavke?.filter(p => p.racunId === null) ?? [];
  const zaracunanePostavkeSkupaj = round2(
    (selectedOrder?.postavke ?? []).filter(p => p.racunId !== null).reduce((acc, p) => acc + Number(p.skupaj), 0)
  );
  const vsotaPostavkIzracunana: number | null = selectedOrder?.postavke && selectedOrder.postavke.length > 0
    ? round2(nezaracunanePostavkeZaCheck.reduce((acc, p) => acc + round2(Number(p.kolicina) * Number(p.cenaKos)), 0))
    : null;
  const neskladjePostavkSkupaj: number | null = vsotaPostavkIzracunana !== null && selectedOrder
    ? round2(Math.abs(vsotaPostavkIzracunana - round2(Number(selectedOrder.skupaj) - zaracunanePostavkeSkupaj)))
    : null;
  const imaNeskladjePostavk = neskladjePostavkSkupaj !== null && neskladjePostavkSkupaj > 0.01;

  const gostBarva = (g: number) => {
    const palette = [
      "bg-blue-100 text-blue-700 border-blue-300",
      "bg-green-100 text-green-700 border-green-300",
      "bg-purple-100 text-purple-700 border-purple-300",
      "bg-orange-100 text-orange-700 border-orange-300",
    ];
    return palette[(g - 1) % palette.length];
  };

  const gostjeZZneskom = (() => {
    const mapa = new Map<number, number>();
    for (const p of uncoveredPostavke) {
      const g = (p as typeof p & { gostStevilka?: number | null }).gostStevilka;
      if (g == null) continue;
      mapa.set(g, (mapa.get(g) ?? 0) + Number(p.skupaj));
    }
    return [...mapa.entries()]
      .sort(([a], [b]) => a - b)
      .map(([g, znesek]) => ({ g, znesek: round2(znesek) }));
  })();
  const prikaziGostSestevek = gostjeZZneskom.length >= 2;

  const aktivniGost = (() => {
    if (!splitMode || effectiveSplitPostavkeIds.size === 0) return null;
    for (const { g } of gostjeZZneskom) {
      const gostIds = uncoveredPostavke
        .filter(p => (p as typeof p & { gostStevilka?: number | null }).gostStevilka === g)
        .map(p => p.id);
      if (
        gostIds.length > 0 &&
        gostIds.every(id => effectiveSplitPostavkeIds.has(id)) &&
        gostIds.length === effectiveSplitPostavkeIds.size
      ) return g;
    }
    return null;
  })();

  // Razčlenitev plačil za prikaz in validacijo
  const zneskiZaPrikaz: { oznaka: string; znesek: number }[] = [];
  if (selectedOrder) {
    if (steviloBonovDejanski > 0) zneskiZaPrikaz.push({ oznaka: "Bon za pico", znesek: znesekBonov });
      if (znesekSubvencijaDejanski > 0) zneskiZaPrikaz.push({ oznaka: "Študentski bon (subvencija)", znesek: znesekSubvencijaDejanski });
    if (!vsePlacanoZBoni) {
      if (placilniNacin === "bon") {
        if (znesekDarilnegaBonaDejanski > 0) zneskiZaPrikaz.push({ oznaka: "Darilni bon", znesek: znesekDarilnegaBonaDejanski });
        if (!vsePlacanoZDarilnimBonom && znesekPoKritiZDarilnimBonom > 0.005) {
          zneskiZaPrikaz.push({
            oznaka: sekundarniNacin === "gotovina" ? "Gotovina" : "Kartica",
            znesek: sekundarniNacin === "kartica"
              ? terminalskiZnesek
              : round2(znesekPoKritiZDarilnimBonom + zajemNapitnine.cash),
          });
          if (sekundarniNacin === "kartica" && zajemNapitnine.cash > 0) {
            zneskiZaPrikaz.push({ oznaka: "Gotovinska napitnina", znesek: zajemNapitnine.cash });
          }
        }
      } else if (placilniNacin === "gotovina") {
        zneskiZaPrikaz.push({ oznaka: "Gotovina", znesek: round2(znesekZaDoplacilo + zajemNapitnine.cash) });
      } else if (placilniNacin === "kartica") {
        zneskiZaPrikaz.push({ oznaka: "Kartica", znesek: terminalskiZnesek });
      } else if (placilniNacin === "reprezentanca") {
        zneskiZaPrikaz.push({ oznaka: "Reprezentanca", znesek: znesekPreostalega });
      } else if (placilniNacin === "lastna_poraba") {
        zneskiZaPrikaz.push({ oznaka: "Lastna poraba", znesek: znesekPreostalega });
      }
    }
  }
  const vsotaPlacil = round2(zneskiZaPrikaz.reduce((s, i) => s + i.znesek, 0));

  // If saved operator is no longer on an active shift, clear selection
  useEffect(() => {
    if (!aktivneIzmene || selectedNatakarId === "none") return;
    const stillActive = aktivniOperaterji.some(i => String(i.natakariId) === selectedNatakarId);
    if (!stillActive) {
      setSelectedNatakarId("none");
      localStorage.removeItem("pos_last_operator_id");
    }
  }, [aktivneIzmene, selectedNatakarId]);

  const handleNatakarChange = (value: string) => {
    if (value === "none") {
      setSelectedNatakarId("none");
      localStorage.removeItem("pos_last_operator_id");
      localStorage.removeItem("pos_last_natakar_id");
      sessionStorage.removeItem("pos_actor_session");
      notifyPosActorSessionChanged();
    } else {
      localStorage.setItem("pos_last_natakar_id", value);
      requestPosActorSession();
    }
  };

  const sendToSumup = async (narociloId: number, znesek: number): Promise<boolean> => {
    setTerminalStanje("cakanje");
    setTerminalRezultat(null);
    setSumupQrCheckoutId(null);
    setSumupQrZnesek(null);
    try {
      const paymentAttemptId = getCardPaymentAttemptId("sumup", narociloId, znesek);
      rememberCardPaymentAttempt("sumup", narociloId, znesek, paymentAttemptId);
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await posFetch(`${base}/api/terminal/sumup/pay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": paymentAttemptId,
          ...(napravaKljuc ? { "X-Naprava-Id": napravaKljuc } : {}),
        },
        body: JSON.stringify({ narociloId, znesek, znesekNapitninaKartica: karticnaNapitnina, paymentAttemptId }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setTerminalStanje("napaka");
        setTerminalRezultat({ napaka: err.error ?? "SumUp napaka" });
        return false;
      }
      const { checkoutId } = await res.json() as { checkoutId?: string };
      if (!checkoutId) {
        setTerminalStanje("napaka");
        setTerminalRezultat({ napaka: "Prejšnji poskus plačila je v neznanem stanju. Ne začenjajte novega plačila; preverite terminal oziroma podporo." });
        return false;
      }

      const serial = terminalConfig?.sumupTerminalSerial ?? "";
      if (!serial) {
        setSumupQrCheckoutId(checkoutId);
        setSumupQrZnesek(znesek);
      }

      for (let i = 0; i < 90; i++) {
        await new Promise<void>(r => setTimeout(r, 2000));
        const statusRes = await posFetch(
          `${base}/api/terminal/sumup/status/${encodeURIComponent(checkoutId)}`,
          { headers: napravaKljuc ? { "X-Naprava-Id": napravaKljuc } : {} },
        );
        const statusData = await statusRes.json() as { status: string; napaka?: string | null };
        if (statusData.status === "PAID") {
          setSumupQrCheckoutId(null);
          setSumupQrZnesek(null);
          currentTerminalReferenceRef.current = { provider: "sumup", value: checkoutId };
          setLastSumupCheckoutId(checkoutId);
          setTerminalStanje("odobren");
          return true;
        } else if (statusData.status === "FAILED") {
          setSumupQrCheckoutId(null);
          setSumupQrZnesek(null);
          setTerminalStanje("napaka");
          setTerminalRezultat({ napaka: statusData.napaka ?? "SumUp plačilo neuspešno" });
          return false;
        }
      }

      setSumupQrCheckoutId(null);
      setSumupQrZnesek(null);
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: "Čas za SumUp plačilo je potekel (3 min)" });
      return false;
    } catch (err) {
      setSumupQrCheckoutId(null);
      setSumupQrZnesek(null);
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: err instanceof Error ? err.message : "Omrežna napaka" });
      return false;
    }
  };

  const sendGiftToSumup = async (idempotencyKey: string, amountCents: number): Promise<string | null> => {
    setTerminalStanje("cakanje");
    setTerminalRezultat(null);
    setSumupQrCheckoutId(null);
    setSumupQrZnesek(null);
    const znesek = amountCents / 100;
    const persistPayment = (state: GiftCardPaymentState) => {
      giftCardPaymentStateRef.current = state;
      writeGiftCardPaymentState(sessionStorage, getEnotaId(), napravaKljuc, state);
    };
    const restored = giftCardPaymentStateRef.current;
    persistPayment({
      idempotencyKey,
      amountCents,
      attemptId: restored?.idempotencyKey === idempotencyKey ? restored.attemptId : undefined,
      status: restored?.idempotencyKey === idempotencyKey ? restored.status : "pending",
    });
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await posFetch(`${base}/api/terminal/sumup/pay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": idempotencyKey,
          ...(napravaKljuc ? { "X-Naprava-Id": napravaKljuc } : {}),
        },
        body: JSON.stringify(buildGiftSumupPayBody({ idempotencyKey, amountCents })),
      });
      const payment = await res.json() as {
        checkoutId?: string;
        attemptId?: string;
        status?: string;
        recoveryRequired?: boolean;
        error?: string;
      };
      if (!res.ok || !payment.checkoutId || !payment.attemptId) {
        if (payment.status === "unknown" || payment.recoveryRequired) {
          persistPayment({ idempotencyKey, amountCents, attemptId: payment.attemptId, status: "unknown" });
        }
        throw new Error(payment.error ?? "Prejšnji poskus plačila je v neznanem stanju. Ne sprožite novega plačila.");
      }
      persistPayment({
        idempotencyKey,
        amountCents,
        attemptId: payment.attemptId,
        status: payment.status === "completed" ? "completed" : "pending",
      });
      if (!(terminalConfig?.sumupTerminalSerial ?? "")) {
        setSumupQrCheckoutId(payment.checkoutId);
        setSumupQrZnesek(znesek);
      }
      for (let i = 0; i < 90; i++) {
        await new Promise<void>(resolve => setTimeout(resolve, 2000));
        const statusRes = await posFetch(
          `${base}/api/terminal/sumup/status/${encodeURIComponent(payment.checkoutId)}`,
          { headers: napravaKljuc ? { "X-Naprava-Id": napravaKljuc } : {} },
        );
        const status = await statusRes.json() as { status: string; napaka?: string | null };
        if (status.status === "PAID") {
          setSumupQrCheckoutId(null);
          setSumupQrZnesek(null);
          setTerminalStanje("odobren");
          persistPayment({ idempotencyKey, amountCents, attemptId: payment.attemptId, status: "completed" });
          return payment.attemptId;
        }
        if (status.status === "FAILED") {
          if (!status.napaka) {
            giftCardPaymentStateRef.current = null;
            confirmedGiftCardPaymentRef.current = null;
            clearGiftCardPaymentState(sessionStorage, getEnotaId(), napravaKljuc);
            darilniBonIdempotencyKeyRef.current = null;
          }
          throw new Error(status.napaka ?? "SumUp plačilo ni uspelo.");
        }
      }
      persistPayment({ idempotencyKey, amountCents, attemptId: payment.attemptId, status: "unknown" });
      throw new Error("Čas za SumUp plačilo je potekel. Ne sprožite novega plačila; poskusite znova z istim ključem.");
    } catch (error) {
      setSumupQrCheckoutId(null);
      setSumupQrZnesek(null);
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: error instanceof Error ? error.message : "Omrežna napaka" });
      return null;
    }
  };

  const sendToVivaTerminal = async (narociloId: number, znesek: number): Promise<boolean> => {
    setTerminalStanje("cakanje");
    setTerminalRezultat(null);
    try {
      const paymentAttemptId = getCardPaymentAttemptId("viva_terminal", narociloId, znesek);
      rememberCardPaymentAttempt("viva_terminal", narociloId, znesek, paymentAttemptId);
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await posFetch(`${base}/api/terminal/viva/terminal/pay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": paymentAttemptId,
          ...(napravaKljuc ? { "X-Naprava-Id": napravaKljuc } : {}),
        },
        body: JSON.stringify({ narociloId, znesek, znesekNapitninaKartica: karticnaNapitnina, paymentAttemptId }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setTerminalStanje("napaka");
        setTerminalRezultat({ napaka: err.error ?? "Viva Terminal napaka" });
        return false;
      }
      const { sessionId } = await res.json() as { sessionId?: string };
      if (!sessionId) {
        setTerminalStanje("napaka");
        setTerminalRezultat({ napaka: "Prejšnji poskus plačila je v neznanem stanju. Ne začenjajte novega plačila; preverite terminal oziroma podporo." });
        return false;
      }

      for (let i = 0; i < 90; i++) {
        await new Promise<void>(r => setTimeout(r, 2000));
        const statusRes = await posFetch(
          `${base}/api/terminal/viva/terminal/status/${encodeURIComponent(sessionId)}`,
          { headers: napravaKljuc ? { "X-Naprava-Id": napravaKljuc } : {} },
        );
        const statusData = await statusRes.json() as {
          status: string;
          napaka?: string | null;
          transactionId?: string | null;
          orderCode?: string | null;
        };
        if (statusData.status === "PAID") {
          currentTerminalReferenceRef.current = { provider: "viva", value: sessionId };
          vivaPaymentIdentifiersRef.current = {
            sessionId,
            transactionId: statusData.transactionId?.trim() || null,
            orderCode: statusData.orderCode?.trim() || null,
          };
          setTerminalStanje("odobren");
          return true;
        } else if (statusData.status === "FAILED") {
          setTerminalStanje("napaka");
          setTerminalRezultat({ napaka: statusData.napaka ?? "Viva Terminal plačilo neuspešno" });
          return false;
        }
      }

      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: "Čas za Viva Terminal plačilo je potekel (3 min)" });
      return false;
    } catch (err) {
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: err instanceof Error ? err.message : "Omrežna napaka" });
      return false;
    }
  };

  const preverjajVivaSmartCheckout = async (orderCode: string): Promise<boolean> => {
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");

    for (let i = 0; i < 90; i++) {
      await new Promise<void>(r => setTimeout(r, 2000));
      try {
        const statusRes = await posFetch(
          `${base}/api/terminal/viva/status/${encodeURIComponent(orderCode)}`,
          { headers: napravaKljuc ? { "X-Naprava-Id": napravaKljuc } : {} },
        );

        // Statusna HTTP napaka je prehodna. Naročilo lahko Viva objavi z
        // zamikom, zato QR ostane prikazan in preverjanje teče naprej.
        if (!statusRes.ok) continue;

        const statusData = await statusRes.json() as {
          status: string;
          napaka?: string | null;
          transactionId?: string | null;
          orderCode?: string | null;
          vivaStateId?: number | null;
          vivaHttpStatus?: number | null;
        };
        if (statusData.status === "PAID") {
          vivaPaymentIdentifiersRef.current = {
            sessionId: null,
            transactionId: statusData.transactionId?.trim() || null,
            orderCode: statusData.orderCode?.trim() || orderCode,
          };
          setTerminalStanje("odobren");
          return true;
        }
        if (statusData.status === "FAILED") {
          setTerminalStanje("napaka");
          setTerminalRezultat({ napaka: statusData.napaka ?? "Viva Wallet plačilo neuspešno" });
          return false;
        }
      } catch {
        // Omrežna/parsna napaka statusa ni dokaz neuspešnega plačila.
      }
    }

    setVivaSmartTimeout(true);
    setTerminalStanje("napaka");
    setTerminalRezultat({
      napaka: "Časovna omejitev — plačilo ni bilo potrjeno v roku. Plačilo je lahko še v obdelavi; ponovno preverite stanje ali prekličite postopek.",
    });
    return false;
  };

  const sendToViva = async (narociloId: number, znesek: number): Promise<boolean> => {
    setTerminalStanje("cakanje");
    setTerminalRezultat(null);
    setVivaCheckoutUrl(null);
    setVivaSmartTimeout(false);
    try {
      const paymentAttemptId = getCardPaymentAttemptId("viva_smart", narociloId, znesek);
      rememberCardPaymentAttempt("viva_smart", narociloId, znesek, paymentAttemptId);
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await posFetch(`${base}/api/terminal/viva/pay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": paymentAttemptId,
          ...(napravaKljuc ? { "X-Naprava-Id": napravaKljuc } : {}),
        },
        body: JSON.stringify({ narociloId, znesek, znesekNapitninaKartica: karticnaNapitnina, paymentAttemptId }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setTerminalStanje("napaka");
        setTerminalRezultat({ napaka: err.error ?? "Viva Wallet napaka" });
        return false;
      }
      const { orderCode, checkoutUrl } = await res.json() as { orderCode?: string; checkoutUrl?: string };
      if (!orderCode || !checkoutUrl) {
        setTerminalStanje("napaka");
        setTerminalRezultat({ napaka: "Prejšnji poskus plačila je v neznanem stanju. Ne začenjajte novega plačila; preverite terminal oziroma podporo." });
        return false;
      }
      setVivaCheckoutUrl(checkoutUrl);
      vivaPaymentIdentifiersRef.current = {
        sessionId: null,
        transactionId: null,
        orderCode,
      };
      return preverjajVivaSmartCheckout(orderCode);
    } catch (err) {
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: err instanceof Error ? err.message : "Omrežna napaka" });
      return false;
    }
  };

  const sendToTerminal = async (narociloId: number, znesek: number): Promise<boolean> => {
    setTerminalStanje("cakanje");
    setTerminalRezultat(null);
    try {
      const paymentAttemptId = getCardPaymentAttemptId("payten", narociloId, znesek);
      rememberCardPaymentAttempt("payten", narociloId, znesek, paymentAttemptId);
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await posFetch(`${base}/api/terminal/pay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": paymentAttemptId,
          ...(napravaKljuc ? { "X-Naprava-Id": napravaKljuc } : {}),
        },
        body: JSON.stringify({ narociloId, znesek, znesekNapitninaKartica: karticnaNapitnina, paymentAttemptId }),
      });
      const data = await res.json() as {
        status: string;
        avtorizacijskaKoda?: string | null;
        kartica?: string | null;
        maskiranPan?: string | null;
        napaka?: string | null;
      };

      setTerminalRezultat({
        avtorizacijskaKoda: data.avtorizacijskaKoda,
        kartica: data.kartica,
        maskiranPan: data.maskiranPan,
        napaka: data.napaka,
      });

      if (data.status === "odobren") {
        setTerminalStanje("odobren");
        return true;
      } else if (data.status === "zavrnjen") {
        setTerminalStanje("zavrnjen");
        return false;
      } else if (data.status === "preklic") {
        setTerminalStanje("preklic");
        return false;
      } else {
        setTerminalStanje("napaka");
        return false;
      }
    } catch (err) {
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: err instanceof Error ? err.message : "Omrežna napaka" });
      return false;
    }
  };

  const sendToSimulation = async (narociloId: number, znesek: number): Promise<boolean> => {
    setTerminalStanje("cakanje");
    setTerminalRezultat(null);
    const paymentAttemptId = getCardPaymentAttemptId("simulacija", narociloId, znesek);
    rememberCardPaymentAttempt("simulacija", narociloId, znesek, paymentAttemptId);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await posFetch(`${base}/api/terminal/simulation/pay`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": paymentAttemptId,
          ...(napravaKljuc ? { "X-Naprava-Id": napravaKljuc } : {}),
        },
        credentials: "include",
        body: JSON.stringify({ narociloId, znesek, paymentAttemptId }),
      });
      const data = await response.json() as { status?: string; error?: string };
      if (!response.ok || data.status !== "completed") {
        setTerminalStanje("napaka");
        setTerminalRezultat({ napaka: data.error ?? "Simuliranega plačila ni bilo mogoče potrditi." });
        return false;
      }
      setTerminalStanje("odobren");
      return true;
    } catch (error) {
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: error instanceof Error ? error.message : "Omrežna napaka" });
      return false;
    }
  };

  const izracunajZneske = () => {
    const zneski: {
      znesekGotovina?: number | null;
      znesekKartica?: number | null;
      znesekBon?: number | null;
      steviloBonov?: number | null;
      znesekBonPica?: number | null;
      znesekSubvencija?: number | null;
      sspReferenca?: string | null;
      izdaniKuponi?: number | null;
      znesekNegotovinsko?: number | null;
    } = {
      znesekGotovina: null,
      znesekKartica: null,
      znesekBon: null,
      steviloBonov: steviloBonovDejanski > 0 ? steviloBonovDejanski : null,
      znesekBonPica: steviloBonovDejanski > 0 ? znesekBonov : null,
      znesekSubvencija: znesekSubvencijaDejanski > 0 ? znesekSubvencijaDejanski : null,
      sspReferenca: sspReferenca.trim() || null,
      izdaniKuponi: skupnoStevicoPic > 0 ? skupnoStevicoPic - steviloBonovDejanski : null,
      znesekNegotovinsko: null,
    };
    if (vsePlacanoZBoni) return zneski;
    if (placilniNacin === "bon") {
      if (znesekDarilnegaBonaDejanski > 0) zneski.znesekBon = znesekDarilnegaBonaDejanski;
      if (!vsePlacanoZDarilnimBonom && znesekPoKritiZDarilnimBonom > 0.005) {
        if (sekundarniNacin === "gotovina") zneski.znesekGotovina = round2(znesekPoKritiZDarilnimBonom + zajemNapitnine.cash);
        else {
          zneski.znesekKartica = terminalskiZnesek;
          if (zajemNapitnine.cash > 0) zneski.znesekGotovina = zajemNapitnine.cash;
        }
      }
    } else if (placilniNacin === "gotovina") {
      zneski.znesekGotovina = round2(znesekZaDoplacilo + zajemNapitnine.cash);
    } else if (placilniNacin === "kartica") {
      zneski.znesekKartica = terminalskiZnesek;
    } else if (placilniNacin === "negotovinsko") {
      zneski.znesekNegotovinsko = znesekPreostalega;
    } else if (placilniNacin === "reprezentanca") {
      zneski.znesekNegotovinsko = znesekPreostalega;
    } else if (placilniNacin === "lastna_poraba") {
      zneski.znesekNegotovinsko = znesekPreostalega;
    }
    return zneski;
  };

  const preveriIndividualniBonZaIzdajo = (): string | null => {
    if (!individualVoucherMode) return null;
    if (recoverableCardPayment || availableRecoveries.length > 0) {
      return "Na naročilu je čakajoče potrjeno kartično plačilo. Najprej ga obnovite z izbranim običajnim plačilom; individualnega bona ne dodajajte k že opravljeni kartični transakciji.";
    }
    if (!individualVoucherCode.trim()) return "Vnesite ali skenirajte kodo individualnega bona.";
    if (!individualVoucherPreview) return "Koda bona še ni preverjena. Preverite jo pred izdajo računa.";
    if (!["active", "available", "aktiven", "veljaven"].includes(individualVoucherPreview.status.toLowerCase())) {
      return "Individualni bon ni v veljavnem statusu za unovčitev.";
    }
    if (znesekDarilnegaBonaDejanski <= 0) return "Znesek unovčitve bona ne sme biti 0 €.";
    if (sekundarniNacin === "kartica" && znesekPoKritiZDarilnimBonom > 0.005) {
      return "Mešano plačilo s kartico in individualnim spletnim bonom ni omogočeno, ker strežnik ne zagotavlja trajne predavtorizacije bona pred kartičnim plačilom. Izberite gotovino ali bon, ki pokrije celoten preostanek.";
    }
    return null;
  };

  const issueRacun = async (bypassOpts?: { preskociDDVPreverjanje: boolean; skrbnisPIN: string }) => {
    if (!selectedNarocilo) return;
    const voucherIssueError = preveriIndividualniBonZaIzdajo();
    if (voucherIssueError) {
      toast({ title: "Individualni bon ni pripravljen", description: voucherIssueError, variant: "destructive" });
      return;
    }
    if (!requireCurrentActorSession()) {
      if (paymentGuardRef.current === "in-flight") releasePaymentGuard();
      return;
    }
    // Automatic terminal callbacks enter here without a click handler.  Claim
    // the same guard in that case, while preserving the guard already claimed
    // by the regular payment handler.
    if (paymentGuardRef.current === "idle" && !acquirePaymentGuard("Izdaja računa je v teku.")) return;
    if (paymentGuardRef.current === "reconciliation-required") return;
    if (aiSvetovalec.aktiven) {
      try {
        const pregled = await aiSvetovalec.preveriPredIzdajo(selectedNarocilo);
        if (pregled?.blokirano) {
          releasePaymentGuard();
          toast({
            title: "Izdaja blokirana",
            description: pregled.kriticneNapake.join(" "),
            variant: "destructive",
          });
          return;
        }
      } catch (error) {
        releasePaymentGuard();
        toast({
          title: "Izdaja začasno blokirana",
          description: error instanceof Error ? error.message : "Kritičnih kontrol ni mogoče izvesti.",
          variant: "destructive",
        });
        return;
      }
    }
    const natakariId = selectedNatakarId !== "none" ? parseInt(selectedNatakarId) : null;
    const dejanskiNacin: RacunInputPlacilnaNacin = vsePlacanoZBoni ? "bon_pica" : placilniNacin;
    const zneski = izracunajZneske();
    const postavkeIds = splitMode ? [...effectiveSplitPostavkeIds] : undefined;
    const kupecPolja = (kupecDavcna || kupecNaziv) ? {
      kupecDavcnaStevilka: /^\d{8}$/.test(kupecDavcna.trim()) ? kupecDavcna.trim() : undefined,
      kupecNaziv: kupecNaziv ?? undefined,
      kupecNaslov: kupecNaslov ?? undefined,
      kupecZavezanecDdv: kupecZavezanecDdv || undefined,
      kupecId: kupecId ?? undefined,
    } : {};
    const sumupCheckoutPolje = lastSumupCheckoutId ? { sumupCheckoutId: lastSumupCheckoutId } : {};
    const vivaPaymentIdentifiers = vivaPaymentIdentifiersRef.current;
    const vivaTerminalPolje = vivaPaymentIdentifiers.sessionId
      ? { vivaTerminalSessionId: vivaPaymentIdentifiers.sessionId }
      : {};
    const vivaTransactionPolje = vivaPaymentIdentifiers.transactionId
      ? { vivaTransactionId: vivaPaymentIdentifiers.transactionId }
      : {};
    const vivaOrderCodePolje = vivaPaymentIdentifiers.orderCode
      ? { vivaOrderCode: vivaPaymentIdentifiers.orderCode }
      : {};
    const dniOdlogaPolje = dejanskiNacin === "negotovinsko" ? { dniOdloga } : {};
    const paymentAttemptPolje = zneski.znesekKartica && zneski.znesekKartica > 0
      ? { paymentAttemptId: cardPaymentAttemptRef.current?.key }
      : {};
    const recoverySelectionPolje = recoveryCompletionAttemptRef.current
      ? {
          recoverySelectedAttemptId: recoveryCompletionAttemptRef.current,
          recoverySelectionToken: recoverySelectionTokenRef.current,
        }
      : {};
    const racunData = { narociloId: selectedNarocilo, placilnaNacin: dejanskiNacin, fursNacin, natakariId, blagajnaId: activeBlagajnaId ?? null, znesekNapitnina: lahkoNapitnina ? znesekNapitninaRef.current : 0, tipPaymentMethod: lahkoNapitnina && znesekNapitninaRef.current > 0 ? dejanskiNacinZajemaNapitnine : undefined, ...zneski, ...(individualVoucherMode ? { individualVoucherCode: individualVoucherCode.trim() } : {}), ...bypassOpts, ...(postavkeIds ? { postavkeIds } : {}), ...kupecPolja, ...sumupCheckoutPolje, ...vivaTerminalPolje, ...vivaTransactionPolje, ...vivaOrderCodePolje, ...paymentAttemptPolje, ...recoverySelectionPolje, ...dniOdlogaPolje };
    const fingerprint = JSON.stringify(racunData);
    const idempotencyKey = racunIdempotencyRef.current?.fingerprint === fingerprint
      ? racunIdempotencyRef.current.key
      : crypto.randomUUID();
    racunIdempotencyRef.current = { key: idempotencyKey, fingerprint };
    createRacun.mutate(
      { data: { ...racunData, idempotencyKey } },
      {
        onSuccess: (racun) => {
          trackEvent("receipt_issued", {
            payment_method: dejanskiNacin,
            partial: racun.jeDelni ?? false,
            split_payment: splitMode,
            fiscal_state: racun.fursNapaka ? "warning" : "ok",
          });
          racunIdempotencyRef.current = null;
          setIndividualVoucherCode("");
          setIndividualVoucherPreview(null);
          setIndividualVoucherMode(false);
          clearCardPaymentAttempt();
          // Native Bridge recovery evidence survives navigation and is cleared
          // only after the fiscal receipt mutation itself succeeded.
          localStorage.removeItem(PAYTEN_BRIDGE_STORAGE);
          setDdvNapaka(null);
          setPinDialogOpen(false);
          setPinInput("");
          setPinNapaka(null);
          setFursNapaka(racun.fursNapaka ?? null);
          const jeDelni = racun.jeDelni ?? false;
          if (jeDelni && selectedNarocilo && splitMode && effectiveSplitPostavkeIds.size > 0) {
            billedInfoRef.current = { narociloId: selectedNarocilo, postavkeIds: [...effectiveSplitPostavkeIds] };
          } else {
            billedInfoRef.current = null;
          }
          setIssuedRacun({
            id: racun.id,
            stevilkaRacuna: racun.stevilkaRacuna,
            skupaj: racun.skupaj,
            zoi: racun.zoi ?? null,
            eor: racun.eor ?? null,
            status: racun.status,
            opozorilo: racun.opozorilo ?? null,
            jeDelni,
            narociloId: racun.narociloId ?? null,
            datumCas: new Date(racun.datumCas ?? racun.ustvarjeno),
            znesekNapitnina: lahkoNapitnina ? znesekNapitninaRef.current : 0,
          });
          queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListMizeQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListRacuniQueryKey() });
          vivaPaymentIdentifiersRef.current = { sessionId: null, transactionId: null, orderCode: null };
          releasePaymentGuard();
          if (vivaTapToPayIssueRef.current) {
            vivaTapToPayIssueRef.current = false;
            const smtpAktiven = (nastavitve as { smtpAktiven?: boolean } | null)?.smtpAktiven ?? false;
            if (smtpAktiven) {
              setEmailInput("");
              setEmailRezultat(null);
              setEmailDialogOpen(true);
            }
          }
        },
        onError: (err: unknown) => {
          // Po potrjenem terminalskem plačilu ne puščaj uporabnika na zaslonu
          // »izdajam račun«, če strežniška izdaja odpove.
          setTerminalStanje("idle");
          const body = (err as { data?: { code?: string; error?: string } })?.data;
          const status = (err as { status?: number })?.status;
          if (status === 409 && body?.code === "ORDER_ALREADY_CLOSED") {
            racunIdempotencyRef.current = null;
            setSelectedNarocilo(null);
            setIssuedRacun(null);
            setDdvNapaka(null);
            releasePaymentGuard();
            void queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
            void queryClient.invalidateQueries({ queryKey: getListMizeQueryKey() });
            void queryClient.invalidateQueries({ queryKey: getListRacuniQueryKey() });
            toast({
              title: "Račun je že izdan",
              description: "Naročilo je bilo zaključeno na drugem terminalu. Vračam vas na pregled miz.",
              variant: "destructive",
            });
            setLocation("/");
            return;
          }
          if (status === 401 && typeof body?.code === "string" && body.code.startsWith("POS_ACTOR_")) {
            // Strežnik je zahtevo zavrnil pred izdajo: račun ni nastal, zato je varno ponoviti.
            racunIdempotencyRef.current = null;
            sessionStorage.removeItem("pos_actor_session");
            notifyPosActorSessionChanged();
            requestPosActorSession();
            releasePaymentGuard();
            toast({
              title: body.code === "POS_ACTOR_SHIFT_CLOSED" ? "Izmena natakarja je zaprta" : "Seja natakarja je potekla",
              description: "Račun ni bil izdan. Ponovno vnesite PIN natakarja in znova potrdite izdajo.",
              variant: "destructive",
              duration: 10000,
            });
            return;
          }
          if (status === 401) {
            toast({
              title: "Prijavna seja je potekla",
              description: "Račun ni bil izdan. Po ponovni prijavi lahko varno ponovite izdajo.",
              variant: "destructive",
              duration: 10000,
            });
          }
          // A mutation error can be a lost response after FURS/receipt
          // creation. Keep the attempt and its idempotency key locked until
          // the operator has reconciled the outcome explicitly.
          requirePaymentReconciliation("Izid izdaje računa ni znan. Preverite seznam računov oziroma FURS in šele nato odklenite nov poskus.");
          const currentAttempt = cardPaymentAttemptRef.current;
          if (currentAttempt) {
            void inspectRecoverableCardPayment(
              currentAttempt.provider,
              currentAttempt.narociloId,
              currentAttempt.znesek,
              currentAttempt.key,
            );
          }
          if (body?.code === "MISSING_ZACETNE_ZALOGE") {
            toast({ title: "Začetne zaloge niso vnesene", description: body.error ?? "Pred izdajo računa vnesite začetne zaloge v razdelku Zaloge.", variant: "destructive", duration: 8000 });
            return;
          }
          if (body?.code === "DDV_NESKLADJE") {
            const b = body as {
              code: string;
              error?: string;
              razlika?: number;
              skupajNarocilo?: number;
              skupajIzPostavk?: number;
              postavke?: Array<{ ime: string; kolicina: number; skupaj: number; davek: number; ddv: number }>;
            };
            setDdvNapaka({
              sporocilo: `Vrednosti na računu niso usklajene${b.razlika !== undefined ? ` (razlika ${b.razlika.toFixed(2)} €)` : ""} — preverite postavke spodaj.`,
              podrobnosti: b.error ?? "",
              razlika: b.razlika,
              skupajNarocilo: b.skupajNarocilo,
              skupajIzPostavk: b.skupajIzPostavk,
              postavke: b.postavke,
            });
            return;
          }
          if (body?.code === "NAPACEN_IZREDNI_PIN") {
            setPinNapaka("Napačen PIN. Poskusite znova.");
            return;
          }
          if (body?.code === "IZREDNI_PIN_NI_NASTAVLJEN") {
            setPinDialogOpen(false);
            setPinInput("");
            toast({ title: "PIN ni nastavljen", description: "Skrbniški PIN za izredno izdajo ni nastavljen. Nastavite ga v razdelku Nastavitve.", variant: "destructive", duration: 8000 });
            return;
          }
          setDdvNapaka(null);
          toast({ title: "Napaka", description: (body?.error ?? (body as { napaka?: string } | undefined)?.napaka) ? `Ni bilo mogoče izdati računa: ${body?.error ?? (body as { napaka?: string }).napaka}${body?.code ? ` [${body.code}]` : (body as { koda?: string } | undefined)?.koda ? ` [${(body as { koda?: string }).koda}]` : ""}` : `Ni bilo mogoče izdati računa.${status ? ` (koda ${status})` : ""}`, variant: "destructive", duration: 10000 });
        },
      }
    );
  };

  useEffect(() => {
    if (!pendingPaytenCompletion || !selectedOrder || selectedOrder.id !== pendingPaytenCompletion.narociloId) return;
    // Selection effects may clear an in-memory ref while the durable native
    // context rehydrates. Restore only the already server-confirmed binding.
    if (cardPaymentAttemptRef.current?.key !== pendingPaytenCompletion.paymentAttemptId) {
      cardPaymentAttemptRef.current = { key: pendingPaytenCompletion.paymentAttemptId, provider: "payten", narociloId: pendingPaytenCompletion.narociloId, znesek: pendingPaytenCompletion.amount };
    }
    const attempt = cardPaymentAttemptRef.current;
    if (placilniNacin !== pendingPaytenCompletion.placilniNacin || sekundarniNacin !== pendingPaytenCompletion.sekundarniNacin) return;
    if (attempt?.key !== pendingPaytenCompletion.paymentAttemptId || attempt.provider !== "payten"
      || attempt.narociloId !== selectedOrder.id || Math.abs(attempt.znesek - pendingPaytenCompletion.amount) > 0.005
      || Math.abs(terminalskiZnesek - pendingPaytenCompletion.amount) > 0.005) {
      requirePaymentReconciliation("Obnovljeni Payten podatki se ne ujemajo z naročilom; račun ni bil izdan.");
      setPendingPaytenCompletion(null);
      return;
    }
    setTerminalStanje("odobren");
    paymentGuardRef.current = "in-flight";
    setPaymentGuard({ state: "in-flight", message: "Zaključujem račun s potrjenim Payten Bridge plačilom." });
    setPendingPaytenCompletion(null);
    issueRacun();
  // issueRacun intentionally runs once after restored state is rendered.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPaytenCompletion, selectedOrder, terminalskiZnesek, placilniNacin, sekundarniNacin]);

  // Native Bookie Bridge is the only trusted Payten Android completion path.
  const PAYTEN_BRIDGE_STORAGE = "paytenBridgePayment";
  const handlePaytenAndroidPay = async () => {
    if (!selectedNarocilo || !selectedOrder) return;
    const paymentAttemptId = getCardPaymentAttemptId("payten", selectedNarocilo, terminalskiZnesek);
    rememberCardPaymentAttempt("payten", selectedNarocilo, terminalskiZnesek, paymentAttemptId);
    let reservation: { paymentAttemptId: string; attemptId: string; status: string; launchUrl?: string; pollToken?: string; expiresAt?: string };
    try {
      reservation = await startPaytenAndroidPayment.mutateAsync({
        data: {
          znesek: terminalskiZnesek,
          znesekNapitninaKartica: karticnaNapitnina,
          narociloId: selectedNarocilo,
          paymentAttemptId,
        },
      });
    } catch {
      requirePaymentReconciliation("Payten Android poskusa ni bilo mogoče varno rezervirati na strežniku. Ne začenjajte plačila.");
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: "Payten Android: strežniška rezervacija plačila ni uspela." });
      return;
    }
    if (reservation.status === "unknown" || reservation.status === "completed" || !reservation.launchUrl || !reservation.pollToken) {
      requirePaymentReconciliation("Za ta Payten Android poskus je potrebna strežniška uskladitev. Ne začenjajte novega plačila.");
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: "Payten Android: obstoječi poskus ni primeren za novo bremenitev." });
      return;
    }
    localStorage.setItem(PAYTEN_BRIDGE_STORAGE, JSON.stringify({
      paymentAttemptId: reservation.paymentAttemptId, attemptId: reservation.attemptId, pollToken: reservation.pollToken,
      expiresAt: reservation.expiresAt, narociloId: selectedNarocilo, provider: "payten", amount: terminalskiZnesek,
      paymentSnapshot: { placilniNacin, sekundarniNacin, znesekDarilnegaBona, steviloBonov, znesekNapitnina, nacinZajemaNapitnine: nacinZajemaNapitnineRef.current },
    }));
    setTerminalStanje("cakanje");
    window.location.href = reservation.launchUrl;
  };

  // Poll only the token-gated loopback result. Browser URL callbacks are not proof.
  useEffect(() => {
    let context: { paymentAttemptId: string; attemptId: string; pollToken: string; expiresAt?: string; narociloId?: number; provider?: string; amount?: number; paymentSnapshot?: any } | null = null;
    try { context = JSON.parse(localStorage.getItem(PAYTEN_BRIDGE_STORAGE) ?? "null"); } catch { return; }
    if (!context?.paymentAttemptId || !context.pollToken) return;
    if (Number.isInteger(context.narociloId) && context.narociloId! > 0) {
      setResumeNarociloId(context.narociloId!);
      setSelectedNarocilo(context.narociloId!);
      cardPaymentAttemptRef.current = { key: context.paymentAttemptId, provider: "payten", narociloId: context.narociloId!, znesek: Number(context.amount ?? 0) };
      const snapshot = context.paymentSnapshot;
      if (!snapshot || (snapshot.placilniNacin !== "kartica" && !(snapshot.placilniNacin === "bon" && snapshot.sekundarniNacin === "kartica"))
        || !Number.isFinite(snapshot.znesekDarilnegaBona) || !Number.isFinite(snapshot.steviloBonov)
        || !Number.isFinite(snapshot.znesekNapitnina) || (snapshot.nacinZajemaNapitnine !== "card" && snapshot.nacinZajemaNapitnine !== "cash")) {
        requirePaymentReconciliation("Shranjen Payten Bridge kontekst ni popoln; račun ni bil izdan.");
        return;
      }
      paytenRecoverySnapshotRef.current = snapshot;
      setPlacilniNacin(snapshot.placilniNacin);
      setSekundarniNacin(snapshot.sekundarniNacin);
      setZnesekDarilnegaBona(snapshot.znesekDarilnegaBona);
      setSteviloBonov(snapshot.steviloBonov);
      setZnesekNapitnina(snapshot.znesekNapitnina); znesekNapitninaRef.current = snapshot.znesekNapitnina;
      setNacinZajemaNapitnine(snapshot.nacinZajemaNapitnine); nacinZajemaNapitnineRef.current = snapshot.nacinZajemaNapitnine;
    }
    let cancelled = false;
    const poll = async () => {
      if (cancelled) return;
      if (context!.expiresAt && Date.now() > Date.parse(context!.expiresAt)) {
        await timeoutPaytenAndroidPayment.mutateAsync({ data: { paymentAttemptId: context!.paymentAttemptId } }).catch(() => {});
        requirePaymentReconciliation("Čas čakanja na podpisan Payten rezultat je potekel; račun ni bil izdan.");
        setTerminalStanje("napaka"); return;
      }
      try {
        const r = await fetch(`http://127.0.0.1:8092/payten-result?attemptId=${encodeURIComponent(context!.attemptId)}&pollToken=${encodeURIComponent(context!.pollToken)}`);
        const result = await r.json() as { pending?: boolean; ok?: boolean; envelope?: unknown };
        if (result.ok && !result.pending && result.envelope) {
          const confirmed = await confirmPaytenAndroidPayment.mutateAsync({ data: { paymentAttemptId: context!.paymentAttemptId, envelope: result.envelope as any } });
          if (confirmed.status === "COMPLETED") {
            // Other checkout effects may run while the order is rehydrating;
            // reassert the durable server attempt immediately before gating
            // fiscal finalisation.
            cardPaymentAttemptRef.current = { key: context!.paymentAttemptId, provider: "payten", narociloId: context!.narociloId!, znesek: Number(context!.amount) };
            setPendingPaytenCompletion({ paymentAttemptId: context!.paymentAttemptId, amount: Number(context!.amount), narociloId: context!.narociloId!, placilniNacin: context!.paymentSnapshot.placilniNacin, sekundarniNacin: context!.paymentSnapshot.sekundarniNacin }); return;
          }
        }
      } catch { /* bridge may be temporarily unavailable; deadline remains authoritative */ }
      if (!cancelled) window.setTimeout(poll, 1500);
    };
    // Let restored payment state commit before a fast local bridge response can
    // trigger receipt finalisation.
    const initialPoll = window.setTimeout(() => { void poll(); }, 0);
    return () => { cancelled = true; window.clearTimeout(initialPoll); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Viva Android Terminal — same-device Viva inter-app sale request.
  // Tap to Pay is a Terminal-app/device ability, so both Android paths use
  // the documented `action=sale` protocol and differ only by their BOOKIE callback.
  const handleVivaAndroidPay = () => {
    void handleVivaTapToPayPay("android");
  };

  // Viva Tap to Pay on Android — SoftPOS uses the same documented Viva sale
  // intent as Android Terminal; the Terminal app/device selects the NFC capability.
  const handleVivaTapToPayPay = async (mode: "android" | "tap-to-pay" = "tap-to-pay") => {
    if (!selectedNarocilo || !selectedOrder) return;
    const amountCents = Math.round(terminalskiZnesek * 100);
    const paymentAttemptId = getCardPaymentAttemptId("viva_terminal", selectedNarocilo, terminalskiZnesek);
    rememberCardPaymentAttempt("viva_terminal", selectedNarocilo, terminalskiZnesek, paymentAttemptId);
    const sourceCode = mode === "android"
      ? terminalConfig?.vivaAndroidSourceCode ?? ""
      : terminalConfig?.vivaTapToPaySourceCode ?? "";
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    setTerminalStanje("cakanje");
    setTerminalRezultat(null);
    setVivaBridgeLaunchUrl(null);
    const response = await posFetch(`${base}/api/terminal/viva/tap-to-pay/start`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": paymentAttemptId,
        ...(napravaKljuc ? { "X-Naprava-Id": napravaKljuc } : {}),
      },
      body: JSON.stringify({
        narociloId: selectedNarocilo,
        znesek: terminalskiZnesek,
        znesekNapitninaKartica: karticnaNapitnina,
        paymentAttemptId,
      }),
    });
    const start = await response.json() as { clientTransactionId?: string; error?: string; status?: string; recoveryRequired?: boolean };
    if (!response.ok || !start.clientTransactionId) {
      if (response.status === 409) {
        sessionStorage.removeItem(cardAttemptStorageKey("viva_terminal", selectedNarocilo));
        cardPaymentAttemptRef.current = null;
        setTerminalStanje("napaka");
        setTerminalRezultat({
          napaka: start.error
            ? `${start.error} Preverite, da prejšnje plačilo ni bilo izvedeno, nato ponovno pritisnite »Izdaj račun« z novim ključem.`
            : "Viva je zavrnila rezervacijo plačila (409). Preverite, da prejšnje plačilo ni bilo izvedeno, nato ponovno pritisnite »Izdaj račun«.",
        });
        return;
      }
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: start.error ?? "Viva Android plačila ni bilo mogoče začeti." });
      return;
    }
    if (start.recoveryRequired || start.status === "completed" || start.status === "unknown") {
      setTerminalStanje("napaka");
      setTerminalRezultat({
        napaka: start.status === "completed"
          ? "To plačilo je že potrjeno. Obnovite izdajo računa; ne sprožite novega plačila."
          : "Izid prejšnjega plačila ni znan. Preverite Viva Terminal oziroma portal; novega plačila ne sprožite.",
      });
      return;
    }

    // Android lahko povratni HTTPS naslov odpre v novem zavihku/PWA kontekstu.
    // sessionStorage med kontekstoma ni skupen, zato isti preverljivi kontekst
    // hranimo tudi v localStorage. Strežnik ga ob confirm še vedno preveri
    // proti predhodno rezerviranemu paymentAttemptId.
    writeVivaTapToPayStorage(VIVA_TAP_TO_PAY_STORAGE_KEYS.narociloId, String(selectedNarocilo));
    writeVivaTapToPayStorage(
      VIVA_TAP_TO_PAY_STORAGE_KEYS.placilo,
      JSON.stringify({ placilniNacin, sekundarniNacin, znesekDarilnegaBona, steviloBonov, znesekNapitnina, nacinZajemaNapitnine: nacinZajemaNapitnineRef.current }),
    );
    writeVivaTapToPayStorage(
      VIVA_TAP_TO_PAY_STORAGE_KEYS.attempt,
      JSON.stringify({ paymentAttemptId, clientTransactionId: start.clientTransactionId }),
    );

    // Callback URL: vrne se na blagajno s predizbranim naročilom
    const returnUrl = `${window.location.origin}${base}/blagajna?narocilo=${selectedNarocilo}&vivaTapToPay=1`;
    const callbackUrl = buildBookieVivaBridgeCallbackUrl(returnUrl, start.clientTransactionId);

    const intentUrl = buildVivaAndroidSaleIntent({
      amountCents,
      clientTransactionId: start.clientTransactionId,
      callbackUrl,
      sourceCode,
      demo: Boolean(terminalConfig?.vivaDemoNacin),
    });

    const bridgeLaunchUrl = buildBookieVivaBridgeLaunchUrl(intentUrl, callbackUrl);
    setVivaBridgeLaunchUrl(bridgeLaunchUrl);
  };

  const obnoviAndroidPlacilo = (storedPlacilo: string | null) => {
    try {
      const placilo = JSON.parse(storedPlacilo ?? "{}") as { placilniNacin?: RacunInputPlacilnaNacin; sekundarniNacin?: "gotovina" | "kartica"; znesekDarilnegaBona?: number; steviloBonov?: number; znesekNapitnina?: number; nacinZajemaNapitnine?: TipCaptureMethod };
      setPlacilniNacin(placilo.placilniNacin ?? "kartica");
      setSekundarniNacin(placilo.sekundarniNacin ?? "kartica");
      setZnesekDarilnegaBona(placilo.znesekDarilnegaBona ?? 0);
      setSteviloBonov(placilo.steviloBonov ?? 0);
      const tip = placilo.znesekNapitnina ?? 0;
      setZnesekNapitnina(tip); znesekNapitninaRef.current = tip;
      const nacin = placilo.nacinZajemaNapitnine === "cash" || placilo.nacinZajemaNapitnine === "card"
        ? placilo.nacinZajemaNapitnine
        : (placilo.placilniNacin === "kartica" || (placilo.placilniNacin === "bon" && placilo.sekundarniNacin === "kartica"))
          ? "card" : "cash";
      setNacinZajemaNapitnine(nacin);
      nacinZajemaNapitnineRef.current = nacin;
    } catch { setPlacilniNacin("kartica"); }
  };

  useEffect(() => {
    if (!vivaBridgeLaunchUrl || terminalStanje !== "cakanje") return;
    let stopped = false;
    let timer: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (stopped) return;
      try {
        const stored = readVivaTapToPayStorage(VIVA_TAP_TO_PAY_STORAGE_KEYS.attempt);
        const attempt = stored
          ? JSON.parse(stored) as { clientTransactionId?: string }
          : null;
        const clientTransactionId = attempt?.clientTransactionId?.trim();
        if (clientTransactionId) {
          const response = await fetch(
            `http://localhost:8092/result?clientTransactionId=${encodeURIComponent(clientTransactionId)}`,
          );
          const result = await response.json() as { pending?: boolean; returnUrl?: string };
          if (!result.pending && result.returnUrl) {
            const target = new URL(result.returnUrl);
            if (target.origin === window.location.origin && target.pathname.endsWith("/pos/blagajna")) {
              window.location.replace(target.toString());
              return;
            }
          }
        }
      } catch {
        // Bridge 1.0.7 in starejši nima lokalnega rezultatnega kanala.
      }
      if (!stopped) timer = setTimeout(poll, document.hidden ? 1500 : 500);
    };

    const onVisible = () => {
      if (!document.hidden) void poll();
    };
    document.addEventListener("visibilitychange", onVisible);
    void poll();
    return () => {
      stopped = true;
      if (timer) clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [vivaBridgeLaunchUrl, terminalStanje]);

  // Zaznaj povratek iz Viva Android Terminal APK (ob prvem namestitvi komponente).
  // Viva APK doda v callbackUrl: vivaResult=ok|fail, transactionId, clientTransactionId, errorCode.
  // Ref: https://developer.vivawallet.com/integration-reference/card-terminals-sdk/android-ecr-sdk/
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("vivaAndroid") !== "1") return;

    // Počisti callback parametre iz URL (ohrani ?narocilo= za auto-select)
    const newUrl = new URL(window.location.href);
    ["vivaAndroid", "vivaResult", "transactionId", "clientTransactionId", "errorCode"].forEach(k => newUrl.searchParams.delete(k));
    window.history.replaceState(null, "", newUrl.toString());

    const storedId = sessionStorage.getItem("vivaAndroid_narociloId");
    const storedPlacilo = sessionStorage.getItem("vivaAndroid_placilo");
    sessionStorage.removeItem("vivaAndroid_narociloId");
    sessionStorage.removeItem("vivaAndroid_placilo");
    if (!storedId) return;
    const narId = parseInt(storedId);
    if (isNaN(narId)) return;

    const rezultat = parseVivaAndroidSaleCallback(params);
    if (rezultat.kind === "approved") {
      obnoviAndroidPlacilo(storedPlacilo);
      // APK je potrdil plačilo — nastavi zastavico za samodejno izdajo računa
      vivaPaymentIdentifiersRef.current = {
        sessionId: null,
        transactionId: rezultat.transactionId,
        orderCode: null,
      };
      vivaAndroidAutoIssueNarociloRef.current = narId;
      setResumeNarociloId(narId);
      setSelectedNarocilo(narId);
      setTerminalStanje("odobren");
    } else if (rezultat.kind === "failed") {
      setZnesekNapitnina(0); znesekNapitninaRef.current = 0;
      // APK je sporočil napako
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: `Viva Android Terminal: plačilo neuspešno (${rezultat.reason})` });
    } else {
      setZnesekNapitnina(0); znesekNapitninaRef.current = 0;
      // APK ni vrnil vivaResult — fail-safe: ne izdajamo računa brez potrditve
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: "Viva Android Terminal: plačilo ni bilo potrjeno (ni rezultata). Preverite terminal in poskusite znova." });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ko je narocilo naloženo po povratku iz Viva Android Terminal, samodejno izda račun
  useEffect(() => {
    const pendingId = vivaAndroidAutoIssueNarociloRef.current;
    if (!pendingId) return;
    if (selectedNarocilo !== pendingId) return;
    if (!selectedOrder) return;
    if (!jeKarticniTok) return;

    vivaAndroidAutoIssueNarociloRef.current = null;
    issueRacun();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNarocilo, selectedOrder, placilniNacin, sekundarniNacin, jeKarticniTok]);

  // Zaznaj povratek iz Viva Tap to Pay (SoftPOS) ob prvem namestitvi komponente.
  // Viva APK doda v callbackUrl: vivaResult=ok|fail, transactionId, clientTransactionId, errorCode.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const callbackClientTransactionId = params.get("clientTransactionId")?.trim() ?? "";
    const callbackNarociloId = params.get("narocilo")?.trim() ?? "";
    const storedId = readVivaTapToPayStorage(VIVA_TAP_TO_PAY_STORAGE_KEYS.narociloId)
      ?? (callbackNarociloId || null);
    const storedPlacilo = readVivaTapToPayStorage(VIVA_TAP_TO_PAY_STORAGE_KEYS.placilo);
    // clientTransactionId je isti strežniško rezervirani idempotency key.
    // Callback ga sme uporabiti kot stateless obnovo, ker confirm nato pri Vivi
    // preveri transactionId, znesek in merchant reference; sam URL ni dokaz plačila.
    const storedAttempt = readVivaTapToPayStorage(VIVA_TAP_TO_PAY_STORAGE_KEYS.attempt)
      ?? (callbackClientTransactionId
        ? JSON.stringify({
            paymentAttemptId: callbackClientTransactionId,
            clientTransactionId: callbackClientTransactionId,
          })
        : null);
    const hasStoredAttempt = Boolean(storedId && storedAttempt);
    if (!isVivaAndroidSaleCallback(params, "vivaTapToPay", hasStoredAttempt)) {
      // Sam obstoj shranjenega poskusa ne pomeni povratka iz Vive. Ob običajnem
      // odpiranju blagajne brez callback parametrov ga pustimo nedotaknjenega
      // in ne prikažemo lažne terminalske napake.
      return;
    }

    // Počisti callback parametre iz URL (ohrani ?narocilo= za auto-select)
    const newUrl = new URL(window.location.href);
    ["vivaTapToPay", "vivaResult", "status", "transactionId", "orderCode", "clientTransactionId", "errorCode", "message"].forEach(k => newUrl.searchParams.delete(k));
    window.history.replaceState(null, "", newUrl.toString());

    if (!storedId) return;
    const narId = parseInt(storedId);
    if (isNaN(narId)) return;

    const rezultat = parseVivaAndroidSaleCallback(params);
    if (rezultat.kind === "approved") {
      let attempt: { paymentAttemptId?: string; clientTransactionId?: string } = {};
      try { attempt = JSON.parse(storedAttempt ?? "{}") as typeof attempt; } catch { /* fail-safe below */ }
      const callbackOrderCode = params.get("orderCode")?.trim() ?? "";
      if ((!rezultat.transactionId && !callbackOrderCode) || !attempt.paymentAttemptId || !attempt.clientTransactionId || callbackClientTransactionId !== attempt.clientTransactionId) {
        setTerminalStanje("napaka");
        setTerminalRezultat({ napaka: "Viva Tap to Pay: povratni podatki ne ustrezajo začetemu plačilu. Račun ni bil izdan." });
        return;
      }
      // Naročilo naloži neposredno in vzporedno s strežniškim preverjanjem Vive.
      // Izdaja ostane blokirana do statusa PAID, zato hitrejši fetch ne oslabi
      // potrjevanja plačila ali zaščite pred podvojitvijo.
      setResumeNarociloId(narId);
      setSelectedNarocilo(narId);
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      void posFetch(`${base}/api/terminal/viva/tap-to-pay/confirm`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Idempotency-Key": attempt.paymentAttemptId,
          ...(napravaKljuc ? { "X-Naprava-Id": napravaKljuc } : {}),
        },
        body: JSON.stringify({
          paymentAttemptId: attempt.paymentAttemptId,
          clientTransactionId: attempt.clientTransactionId,
          transactionId: rezultat.transactionId,
          orderCode: callbackOrderCode || undefined,
        }),
      }).then(async response => {
        const confirmed = await response.json() as {
          status?: string;
          transactionId?: string;
          error?: string;
          napaka?: string;
        };
        if (!response.ok || confirmed.status !== "PAID") {
          setTerminalStanje("napaka");
          setTerminalRezultat({ napaka: confirmed.error ?? confirmed.napaka ?? "Viva transakcije ni bilo mogoče potrditi. Preverite terminal; novega plačila ne sprožite." });
          return;
        }
        removeVivaTapToPayStorage(VIVA_TAP_TO_PAY_STORAGE_KEYS.narociloId);
        removeVivaTapToPayStorage(VIVA_TAP_TO_PAY_STORAGE_KEYS.placilo);
        removeVivaTapToPayStorage(VIVA_TAP_TO_PAY_STORAGE_KEYS.attempt);
        obnoviAndroidPlacilo(storedPlacilo);
        rememberCardPaymentAttempt(
          "viva_terminal",
          narId,
          Number((Number(terminalskiZnesek)).toFixed(2)),
          attempt.paymentAttemptId!,
        );
        vivaPaymentIdentifiersRef.current = {
          sessionId: null,
          transactionId: confirmed.transactionId ?? rezultat.transactionId,
          orderCode: callbackOrderCode || null,
        };
        vivaTapToPayAutoIssueNarociloRef.current = narId;
        setVivaTapToPayAutoIssueId(narId);
        setTerminalStanje("odobren");
      }).catch(() => {
        setTerminalStanje("napaka");
        setTerminalRezultat({ napaka: "Viva transakcije trenutno ni mogoče preveriti. Preverite terminal; novega plačila ne sprožite." });
      });
    } else if (rezultat.kind === "failed") {
      removeVivaTapToPayStorage(VIVA_TAP_TO_PAY_STORAGE_KEYS.narociloId);
      removeVivaTapToPayStorage(VIVA_TAP_TO_PAY_STORAGE_KEYS.placilo);
      removeVivaTapToPayStorage(VIVA_TAP_TO_PAY_STORAGE_KEYS.attempt);
      setZnesekNapitnina(0); znesekNapitninaRef.current = 0;
      // APK je sporočil napako
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: `Viva Tap to Pay: plačilo neuspešno (${rezultat.reason})` });
    } else {
      setZnesekNapitnina(0); znesekNapitninaRef.current = 0;
      // APK ni vrnil vivaResult — fail-safe: ne izdajamo računa brez potrditve
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: "Viva Tap to Pay: plačilo ni bilo potrjeno (ni rezultata). Preverite terminal in poskusite znova." });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ko je narocilo naloženo po povratku iz Viva Tap to Pay, samodejno izda račun
  useEffect(() => {
    const pendingId = vivaTapToPayAutoIssueId;
    if (!pendingId) return;
    if (selectedNarocilo !== pendingId) return;
    if (!selectedOrder) return;
    // Če se je callback odprl v novem brskalniškem kontekstu brez shranjenega
    // plačilnega snapshot-a, je varni privzeti tok kartica. Ne ostani na
    // zaslonu »Plačilo potrjeno« samo zato, ker je začetni state gotovina.
    if (!jeKarticniTok) {
      setPlacilniNacin("kartica");
      setSekundarniNacin("kartica");
      return;
    }

    vivaTapToPayAutoIssueNarociloRef.current = null;
    setVivaTapToPayAutoIssueId(null);
    vivaTapToPayIssueRef.current = true;
    issueRacun();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vivaTapToPayAutoIssueId, selectedNarocilo, selectedOrder, placilniNacin, sekundarniNacin, jeKarticniTok, terminalStanje]);

  const handleIzdajRacun = async () => {
    const selectedOrderKey = gatewayCheckoutMode ? selectedGatewayOrderId : selectedNarocilo;
    if (!selectedOrderKey || !selectedOrder) return;
    const voucherIssueError = preveriIndividualniBonZaIzdajo();
    if (voucherIssueError) {
      toast({ title: "Individualni bon ni pripravljen", description: voucherIssueError, variant: "destructive" });
      return;
    }
    if (!requireCurrentActorSession()) return;
    if (isOfflineOrderLocked(selectedOrderKey)) {
      setOfflineOrderLocked(true);
      toast({ title: "Naročilo je zaklenjeno", description: "Za naročilo že obstaja lokalna fiskalna operacija. Pred spremembo ali novo izdajo jo uskladite v lokalni vrsti.", variant: "destructive" });
      return;
    }
    if (aiSvetovalec.aktiven && selectedNarocilo !== null) {
      try {
        const pregled = await aiSvetovalec.preveriPredIzdajo(selectedNarocilo);
        if (pregled?.blokirano) {
          toast({ title: "Izdaja blokirana", description: pregled.kriticneNapake.join(" "), variant: "destructive" });
          return;
        }
      } catch (error) {
        toast({
          title: "Plačilo začasno blokirano",
          description: error instanceof Error ? error.message : "Kritičnih kontrol ni mogoče izvesti.",
          variant: "destructive",
        });
        return;
      }
    }
    // Fiscalization consumes the same sticky authority decision as Home and
    // Order; it must never perform a second navigator/network decision.
    const gatewayOfflineAuthority = gatewayCheckoutMode;
    const gatewayUnavailable = gatewayOfflineAuthority && !gatewayOffline.healthy;
    // Fiskalnega dokumenta ali nove kartične avtorizacije nikoli ne ustvarimo
    // lokalno. Kartični attempt/idempotency key ostane v sessionStorage in se
    // ob ponovnem poskusu po vrnitvi povezave ponovno uporabi.
    if (gatewayUnavailable) {
      toast({ title: "LAN gateway ni dosegljiv", description: "Samodejni preklop fiskalne avtoritete je blokiran.", variant: "destructive" });
      return;
    }
    if (gatewayOfflineAuthority) {
      // No mixed tender, vouchers, subsidy or tips can enter the local fiscal
      // flow.  The service receives one canonical, cash-only receipt.
      if (placilniNacin !== "gotovina" || znesekNapitninaRef.current > 0 || splitMode) {
        toast({ title: "Offline je dovoljena samo gotovina", description: "Kartica, mešana plačila, boni, subvencije, delni računi in napitnina zahtevajo povezavo.", variant: "destructive" });
        return;
      }
      const capabilityCheck = gatewayOfflineAuthority
        ? { capability: await getCachedOfflineCapability(), reason: undefined }
        : await checkLocalFiscalCapability();
      const cachedDevice = capabilityCheck.capability;
      const enotaId = Number(user?.enotaId);
      if (gatewayOfflineAuthority) {
        if (!cachedDevice?.identity || !Number.isInteger(enotaId) || !nastavitve) {
          toast({ title: "Gateway izdaja je blokirana", description: "Manjka identiteta POS nastavitve.", variant: "destructive" });
          return;
        }
      } else if (capabilityCheck.reason || !cachedDevice?.identity || !Number.isInteger(enotaId) || !nastavitve) {
        toast({ title: "Offline fiskalna izdaja je blokirana", description: capabilityCheck.reason ?? "Storitev nima provisionirane identitete za izbrano enoto, prostor in napravo.", variant: "destructive" });
        return;
      }
      try {
        if (!acquirePaymentGuard("Lokalna fiskalna izdaja je v teku.")) return;
        const legalTimestamp = legalLjubljanaTimestamp();
        const items = (selectedOrder.postavke ?? []).filter(postavka => postavka.racunId == null);
        const waiterId = Number(selectedNatakarId);
        const selectedShift = aktivniOperaterji.find(item => item.natakariId === waiterId);
        if (!selectedShift) throw new Error("Izbrana izmena ni več aktivna.");
        const authorityBundle = await getValidOfflineAuthorityBundle(cachedDevice!.identity, waiterId, selectedShift.id);
        let gatewayOrderVersion = 0;
        if (gatewayOfflineAuthority && gatewayOffline.scope) {
          const snapshot = await gatewayPosService(gatewayOffline.scope).snapshot();
            gatewayOrderVersion = Number(snapshot.orders.find(order => String(order.orderId) === String(selectedGatewayOrderId))?.version ?? 0);
        }
          const sourceRefFor = (postavka: any) => gatewayOfflineAuthority
            ? String(postavka.lineId ?? postavka.id)
            : `cloud:${selectedNarocilo}:${postavka.id}`;
         const sourceRefs = new Set(items.map((postavka: any) => sourceRefFor(postavka)));
         const orderedItems = [...items].sort((a: any, b: any) =>
           (a.parentSourceLineRef || a.parentPostavkaId ? 1 : 0) -
           (b.parentSourceLineRef || b.parentPostavkaId ? 1 : 0));
         const canonicalBySource = new Map<string, { vatRate: number; articleId: number | null }>();
         const soldLines = orderedItems.map(postavka => {
          const articleId = (postavka as typeof postavka & { artikelId?: number | null }).artikelId ?? null;
          const modifierId = (postavka as typeof postavka & { modifikatorId?: number | null }).modifikatorId ?? null;
            if ((postavka as any).modifierSourceArticleId != null) {
              throw new Error("Računa ni mogoče zaključiti brez povezave: authority bundle za gnezdene izbire modifikatorjev še ni podprt.");
            }
            const parentSourceLineRef = gatewayOfflineAuthority
              ? ((postavka as any).parentSourceLineRef
                ?? ((postavka as any).parentPostavkaId != null
                  ? String((postavka as any).parentPostavkaId) : null))
              : ((postavka as any).parentPostavkaId != null
                ? `cloud:${selectedNarocilo}:${(postavka as any).parentPostavkaId}` : null);
           const parent = parentSourceLineRef
             ? orderedItems.find((candidate: any) => sourceRefFor(candidate) === parentSourceLineRef)
             : null;
           if (parentSourceLineRef && (!parent || !sourceRefs.has(parentSourceLineRef))) {
             throw new Error(`Modifikator ${postavka.id} nima veljavne nadrejene postavke.`);
           }
            if (modifierId != null && Number((parent as any)?.modifikatorId ?? (parent as any)?.modifierId) > 0) {
              throw new Error("Računa ni mogoče zaključiti brez povezave: authority bundle za gnezdene izbire modifikatorjev še ni podprt.");
            }
           const modifierFact = modifierId == null ? undefined
             : authorityBundle.modifiers.find(entry => entry.modifierId === modifierId);
           if (modifierId != null && !modifierFact) {
             throw new Error(`Modifikator ${modifierId} ni v veljavnem authority bundlu.`);
           }
           if (modifierId != null && !parentSourceLineRef) {
             throw new Error(`Modifikator ${modifierId} nima nadrejene postavke.`);
           }
           if (modifierId == null && articleId === null) {
             throw new Error(`Vrstica ${postavka.id} nima podpisanega articleId.`);
           }
           const parentArticleId = (parent as any)?.artikelId ?? (parent as any)?.articleId;
           if (modifierFact && modifierFact.articleIds?.length &&
               !modifierFact.articleIds.includes(Number(parentArticleId))) {
             throw new Error(`Modifikator ${modifierId} ni dovoljen za nadrejeni artikel.`);
           }
           const facts = modifierFact ? [] : authorityBundle.catalog.filter(entry => entry.articleId === articleId);
           if (!modifierFact && !facts.length) throw new Error(`Artikel ${articleId} ni v veljavnem authority bundlu.`);
           const authoritativeVatRate = modifierFact
             ? modifierFact.vatRule === "inherit_parent"
               ? canonicalBySource.get(parentSourceLineRef!)?.vatRate
               : Number(modifierFact.vatRate)
             : Number(facts[0]!.vatRate);
           if (!Number.isFinite(authoritativeVatRate)) {
             throw new Error(`Za vrstico ${postavka.id} ni mogoče določiti podpisane DDV stopnje.`);
           }
           const vatRate = authoritativeVatRate as number;
           if (postavka.davek != null && Math.abs(Number(postavka.davek) - vatRate) > 0.001) {
             throw new Error(`DDV vrstice ${postavka.id} se ne ujema s podpisanim authority bundlom.`);
           }
           const quantity = Number(postavka.kolicina);
           const authoritativeUnitGross = modifierFact ? Number(modifierFact.priceDelta) : Number(facts[0].unitGross);
           const lineGross = Number(postavka.skupaj);
           if (!Number.isFinite(quantity) || quantity <= 0 ||
               !Number.isFinite(authoritativeUnitGross) || !Number.isFinite(lineGross) ||
               round2(lineGross) !== round2(quantity * authoritativeUnitGross)) {
              throw new Error(`Cena, količina ali bruto znesek vrstice ${postavka.id} odstopa od podpisanega bundla.`);
          }
           const canonical = {
            id: Number((postavka as any).cloudLineId ?? 0),
             sourceLineRef: sourceRefFor(postavka),
            cloudLineId: Number.isSafeInteger(Number((postavka as any).cloudLineId))
              && Number((postavka as any).cloudLineId) > 0
              ? Number((postavka as any).cloudLineId) : null,
             articleId, modifierId, name: modifierFact?.name ?? facts[0]!.name,
            quantity, unitGross: authoritativeUnitGross, gross: lineGross,
             vatRate,
             normativeFactor: modifierFact?.normativeQuantity == null ? null : Number(modifierFact.normativeQuantity),
             articleKind: modifierFact ? "modifier" : facts[0].articleKind,
             note: (postavka as any).opomba ?? null, toGo: Boolean((postavka as any).toGo),
             courseNumber: (postavka as any).courseNumber ?? null,
              courseSequence: (postavka as any).courseSequence ?? null,
              courseNameSnapshot: (postavka as any).courseNameSnapshot ?? null,
             pairingGroupId: (postavka as any).pairingGroupId ?? null,
             parentCloudLineId: (postavka as any).parentCloudLineId ?? null,
             parentSourceLineRef,
           };
           canonicalBySource.set(sourceRefFor(postavka), { vatRate, articleId });
           return canonical;
        });
         const gross = Number(soldLines.reduce((sum, line) => sum + line.gross, 0).toFixed(2));
         const taxes = new Map<string, { taxable: number; tax: number }>();
         for (const line of soldLines) {
           const itemNet = round2(line.vatRate > 0 ? line.gross / (1 + line.vatRate / 100) : line.gross);
           const itemTax = round2(line.gross - itemNet);
           const key = line.vatRate.toFixed(2);
           const current = taxes.get(key) ?? { taxable: 0, tax: 0 };
           current.taxable += itemNet;
           current.tax += itemTax;
           taxes.set(key, current);
         }
         const taxLines = [...taxes.entries()].map(([rate, value]) => ({
           rate, taxable: Number(value.taxable.toFixed(2)).toFixed(2), tax: Number(value.tax.toFixed(2)).toFixed(2),
         }));
         const totalTax = Number(taxLines.reduce((sum, line) => sum + Number(line.tax), 0).toFixed(2));
         if (items.length > authorityBundle.policies.maxLines || gross > Number(authorityBundle.policies.maxReceiptGross)) {
           throw new Error("Račun presega podpisane omejitve authority bundla.");
         }
        const normative = new Map<number, number>();
        const stockFacts = new Map<number, number>();
        for (const line of soldLines) {
           const modifierFacts = line.modifierId == null ? [] : authorityBundle.modifiers.filter(entry => entry.modifierId === line.modifierId);
           const sourceFacts = line.modifierId == null
             ? authorityBundle.catalog.filter(entry => entry.articleId === line.articleId && entry.inputArticleId !== null)
             : modifierFacts;
           for (const fact of sourceFacts.filter(entry => entry.inputArticleId !== null)) {
            const inputId = fact.inputArticleId!;
            const quantity = line.quantity * Number(fact.normativeQuantity ?? "0");
            normative.set(inputId, (normative.get(inputId) ?? 0) + quantity);
            stockFacts.set(inputId, Number(fact.unitWac ?? "0"));
          }
        }
        const vatGroups = [...taxes.entries()].map(([rate, value]) => ({
           rate: Number(rate), gross: round2(value.taxable + value.tax), vat: round2(value.tax),
        }));
        // All editable facts have now passed the signed-bundle checks. Persist
        // the operation boundary before constructing or POSTing the plan.
         const sourceOrderRef = String(selectedOrderKey);
         const operationId = reserveOfflineOperationId(sourceOrderRef);
        const finalizationPlanTemplate = {
           version: 2 as const, source: "offline" as const, sourceAuthority: gatewayOfflineAuthority ? "GATEWAY" as const : "CLOUD_OFFLINE" as const, sourceOperationId: operationId,
           receiptContext: {
             companyId: authorityBundle.server.companyId, enotaId,
             orderId: gatewayOfflineAuthority ? gatewayCloudOrderId : selectedNarocilo,
             cloudOrderId: gatewayOfflineAuthority ? gatewayCloudOrderId : selectedNarocilo,
             sourceOrderRef, isPartial: false,
           },
          soldLines,
           cloudBaseline: gatewayOfflineAuthority
             ? ((selectedOrder as any)?.baseLines ?? []).filter((line: any) => line.cloudLineId != null).map((line: any) => ({
               cloudLineId: Number(line.cloudLineId), articleId: line.articleId ?? line.artikelId ?? null,
               modifierId: line.modifierId ?? line.modifikatorId ?? null, name: line.name ?? line.ime ?? null,
               quantity: Number(line.quantity ?? line.kolicina), unitGross: Number(line.unitGross ?? line.cenaKos),
               gross: Number(line.gross ?? line.skupaj), vatRate: Number(line.vatRate ?? line.davek),
               note: line.note ?? line.opomba ?? null, toGo: Boolean(line.toGo ?? line.to_go),
                courseNumber: line.courseNumber ?? null, courseSequence: line.courseSequence ?? null,
                courseNameSnapshot: line.courseNameSnapshot ?? null, pairingGroupId: line.pairingGroupId ?? null,
               parentCloudLineId: line.parentCloudLineId ?? line.parentPostavkaId ?? null,
               parentSourceLineRef: line.parentSourceLineRef ?? null,
             })) : undefined,
          normativeSnapshot: [...normative].map(([articleId, quantity]) => ({ articleId, quantity: -quantity })),
          totals: { gross, net: Number((gross - totalTax).toFixed(2)), vat: Number(totalTax.toFixed(2)), vatGroups },
          payment: {
            method: "gotovina" as const, cash: gross, card: 0 as const, voucher: 0 as const,
            pizzaVoucher: 0 as const, nonCash: 0 as const, terminalReferenceReservationId: null,
            cardPaymentAttemptId: null, giftVoucherRedemption: 0 as const,
          },
          operator: {
            waiterId: authorityBundle.operator.waiterId, name: authorityBundle.operator.name,
            taxNumber: authorityBundle.operator.taxNumber, shiftId: authorityBundle.operator.shiftId,
            actor: String(user?.id ?? ""),
          },
           closure: {
             allLinesCovered: true, closeOrder: true,
             orderId: gatewayOfflineAuthority ? gatewayCloudOrderId : selectedNarocilo,
             cloudOrderId: gatewayOfflineAuthority ? gatewayCloudOrderId : selectedNarocilo,
             sourceOrderRef, tableId: selectedOrder.mizaId ?? null, clearTipAmount: true,
           },
          tip: { amount: 0 as const, mode: null, policyId: null, feeAmount: 0 as const, netAmount: 0 as const },
          stockMovements: [...normative].map(([articleId, quantity]) => ({
            articleId, quantity: -quantity, unitWac: stockFacts.get(articleId) ?? 0,
            value: Number((-quantity * (stockFacts.get(articleId) ?? 0)).toFixed(4)),
            note: `offline:${operationId}`, effectiveAt: legalTimestamp,
          })),
          // Receipt finalization has no KDS mutation; never infer one from live
          // order state during delayed server execution.
          kds: { effects: [] },
          accounting: { companyId: authorityBundle.server.companyId, businessDate: poslovniDatumZaCas(legalTimestamp, zacetekUra), syncAfterCommit: true },
          // The service allocates the sequence and replaces this premise-label
          // seed with the complete PP-B-sequence legal number.
          print: { receiptNumber: cachedDevice.identity.premiseLabel, issuedAt: legalTimestamp, customerName: null, customerAddress: null, customerTaxNumber: null },
        };
        const issueInput = {
           orderId: gatewayOfflineAuthority ? gatewayCloudOrderId : selectedNarocilo,
          request: {
            operationId,
            authorityBundle,
            orderEventSnapshot: {
               orderId: gatewayOfflineAuthority ? gatewayCloudOrderId : selectedNarocilo,
               cloudOrderId: gatewayOfflineAuthority ? gatewayCloudOrderId : selectedNarocilo,
               sourceOrderRef,
              orderVersion: gatewayOfflineAuthority
                ? gatewayOrderVersion
                : Number((selectedOrder as typeof selectedOrder & { version?: number }).version ?? 0),
              eventId: null,
              capturedAt: legalTimestamp,
              lineIds: soldLines.map(line => line.id),
            },
            finalizationPlanTemplate,
            legalTimestamp,
            interruptionStartedAt: legalTimestamp,
          },
        };
        const receipt = await (gatewayOfflineAuthority
          ? (() => issueGatewayCashReceipt<Record<string, any>>(issueInput.request)
              .then(result => ({
                number: result.canonicalPayload.finalizationPlan.receipt.legalNumber,
                zoi: result.canonicalPayload.legalInvoice.zoi,
              })))()
          : issueOfflineCashReceipt({
            orderId: selectedNarocilo ?? selectedGatewayOrderId!,
            request: issueInput.request,
          }));
        if (gatewayOfflineAuthority && selectedGatewayOrderId) {
          gatewayOffline.unpinOrder(selectedGatewayOrderId);
        }
        setOfflineOrderLocked(true);
        toast({ title: "Offline gotovinski račun je izdan", description: `${receipt.number} · ZOI ${receipt.zoi}. EOR še ni prejet; račun čaka na prenos.` });
      } catch (error) {
         setOfflineOrderLocked(isOfflineOrderLocked(selectedOrderKey));
        toast({
          title: error instanceof UnknownFiscalOutcomeError ? "Izid izdaje ni znan" : "Offline izdaja ni uspela",
          description: error instanceof Error ? error.message : "Računa ni bilo mogoče varno izdati.",
          variant: "destructive",
        });
      } finally { releasePaymentGuard(); }
      return;
    }
    if (gatewayCheckoutMode || selectedNarocilo === null) return;
    if (jeKarticniTok && selectedNarocilo !== null && terminalskiZnesek > 0) {
      const inspectedNarociloId = selectedNarocilo;
      const inspectedAmount = terminalskiZnesek;
      const stored = findStoredCardAttempt(selectedNarocilo, terminalskiZnesek);
      if (stored) {
        const recoverable = await inspectRecoverableCardPayment(
          stored.provider,
          inspectedNarociloId,
          inspectedAmount,
          stored.key,
        );
        if (recoverable) return;
        const currentBinding = currentCardBindingRef.current;
        if (
          currentBinding.narociloId !== inspectedNarociloId
          || Math.abs(currentBinding.znesek - inspectedAmount) >= 0.005
        ) return;
      }
    }
    if (!acquirePaymentGuard("Plačilo oziroma izdaja računa je v teku.")) return;
    vivaPaymentIdentifiersRef.current = { sessionId: null, transactionId: null, orderCode: null };

    if (showSimulationFlow) {
      const odobren = await sendToSimulation(selectedNarocilo, simulationAmount);
      if (!odobren) { requirePaymentReconciliation("Simuliranega plačila ni bilo mogoče varno potrditi."); return; }
    } else if (showTerminalFlow) {
      const odobren = await sendToTerminal(selectedNarocilo, terminalskiZnesek);
      if (!odobren) { requirePaymentReconciliation("Terminal ni vrnil varnega zaključka. Preverite plačilo, preden odklenete nov poskus."); return; }
    } else if (showPaytenAndroidFlow) {
      // Payten Android Intent — navigira stran; račun se izda po povratku prek callback URL
      handlePaytenAndroidPay();
      return;
    } else if (showSumupFlow) {
      const odobren = await sendToSumup(selectedNarocilo, terminalskiZnesek);
      if (!odobren) { requirePaymentReconciliation("SumUp plačilo ni varno zaključeno. Preverite terminal oziroma QR plačilo, preden odklenete nov poskus."); return; }
    } else if (showVivaTerminalFlow) {
      const odobren = await sendToVivaTerminal(selectedNarocilo, terminalskiZnesek);
      if (!odobren) { requirePaymentReconciliation("Viva terminal plačilo ni varno zaključeno. Preverite terminal, preden odklenete nov poskus."); return; }
    } else if (showVivaAndroidTerminalFlow) {
      // Android Intent — navigira stran; račun se izda po povratku prek callback URL
      handleVivaAndroidPay();
      return;
    } else if (showVivaTapToPayFlow) {
      // Tap to Pay Android Intent — navigira stran; račun se izda po povratku prek callback URL
      handleVivaTapToPayPay();
      return;
    } else if (showVivaFlow) {
      const odobren = await sendToViva(selectedNarocilo, terminalskiZnesek);
      if (!odobren) { requirePaymentReconciliation("Viva Wallet plačilo ni varno zaključeno. Preverite stanje plačila, preden odklenete nov poskus."); return; }
    }

    issueRacun();
  };

  const handleRetryTerminal = async () => {
    if (!selectedNarocilo || !selectedOrder) return;
    if (!requireCurrentActorSession()) return;
    const inspectedNarociloId = selectedNarocilo;
    const inspectedAmount = terminalskiZnesek;
    const stored = findStoredCardAttempt(selectedNarocilo, terminalskiZnesek);
    if (stored) {
      const recoverable = await inspectRecoverableCardPayment(
        stored.provider,
        inspectedNarociloId,
        inspectedAmount,
        stored.key,
      );
      if (recoverable) return;
      const currentBinding = currentCardBindingRef.current;
      if (
        currentBinding.narociloId !== inspectedNarociloId
        || Math.abs(currentBinding.znesek - inspectedAmount) >= 0.005
      ) return;
    }
    if (!acquirePaymentGuard("Ponovno preverjanje oziroma plačilo je v teku.")) return;
    vivaPaymentIdentifiersRef.current = { sessionId: null, transactionId: null, orderCode: null };
    const terminalZnesek = terminalskiZnesek;
    if (showPaytenAndroidFlow) {
      // Payten Android Intent — navigira stran
      handlePaytenAndroidPay();
      return;
    }
    if (showVivaAndroidTerminalFlow) {
      // Android Intent — navigira stran
      handleVivaAndroidPay();
      return;
    }
    if (showVivaTapToPayFlow) {
      // Tap to Pay Android Intent — navigira stran
      handleVivaTapToPayPay();
      return;
    }
    const odobren = showVivaFlow
      ? await sendToViva(selectedNarocilo, terminalZnesek)
      : showVivaTerminalFlow
        ? await sendToVivaTerminal(selectedNarocilo, terminalZnesek)
        : showSumupFlow
          ? await sendToSumup(selectedNarocilo, terminalZnesek)
          : await sendToTerminal(selectedNarocilo, terminalZnesek);
    if (odobren) issueRacun();
    else requirePaymentReconciliation("Terminal ni vrnil varnega zaključka. Preverite plačilo, preden odklenete nov poskus.");
  };

  const handleRecoverPaidReceipt = async (selectedRecovery = recoverableCardPayment) => {
    const recovery = selectedRecovery;
    if (!recovery || createRacun.isPending || cardRecoveryChecking) return;
    if (!requireCurrentActorSession()) return;
    const currentBinding = currentCardBindingRef.current;
    if (
      currentBinding.narociloId !== recovery.narociloId
      || Math.abs(currentBinding.znesek - recovery.znesek) >= 0.005
    ) return;
    cardPaymentAttemptRef.current = {
      key: recovery.paymentAttemptId,
      provider: recovery.provider,
      narociloId: recovery.narociloId,
      znesek: recovery.znesek,
    };
    setCardRecoveryChecking(true);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const response = await posFetch(
        `${base}/api/terminal/card-payment-attempts/${encodeURIComponent(recovery.attemptId)}/recovery/select`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ narociloId: recovery.narociloId, znesek: recovery.znesek }),
        },
      );
      if (!response.ok) {
        const data = await response.json().catch(() => ({})) as { error?: string };
        toast({ title: "Plačila ni mogoče obnoviti", description: data.error ?? "Izbrano plačilo ni več na voljo.", variant: "destructive" });
        return;
      }
      const selection = await response.json() as { selectionToken?: string };
      if (!selection.selectionToken) {
        toast({ title: "Plačila ni mogoče obnoviti", description: "Strežnik ni potrdil izbire plačila.", variant: "destructive" });
        return;
      }
      recoverySelectionTokenRef.current = selection.selectionToken;
    } catch {
      toast({ title: "Plačila ni mogoče obnoviti", description: "Ni mogoče potrditi izbire plačila.", variant: "destructive" });
      return;
    } finally {
      setCardRecoveryChecking(false);
    }
    paymentGuardRef.current = "in-flight";
    recoveryCompletionAttemptRef.current = recovery.attemptId;
    setPaymentGuard({ state: "in-flight", message: "Zaključujem račun z že potrjenim plačilom." });
    setTerminalStanje("odobren");
    issueRacun();
  };

  const handleVivaTimeoutRecheck = async () => {
    const orderCode = vivaPaymentIdentifiersRef.current.orderCode;
    if (!orderCode) return;
    if (!requireCurrentActorSession()) return;
    if (!acquirePaymentGuard("Preverjanje Viva plačila je v teku.")) return;

    setVivaSmartTimeout(false);
    setTerminalRezultat(null);
    setTerminalStanje("cakanje");
    const odobren = await preverjajVivaSmartCheckout(orderCode);
    if (odobren) issueRacun();
    else requirePaymentReconciliation("Viva plačila ni bilo mogoče varno potrditi. Preverite stanje, preden odklenete nov poskus.");
  };

  const handleNewRacun = () => {
    setIssuedRacun(null);
    setTerminalStanje("idle");
    setTerminalRezultat(null);
    setVivaCheckoutUrl(null);
    setVivaSmartTimeout(false);
    setSumupQrCheckoutId(null);
    setSumupQrZnesek(null);
    setLastSumupCheckoutId(null);
    cardPaymentAttemptRef.current = null;
    setZnesekNapitnina(0);
    znesekNapitninaRef.current = 0;
    vivaPaymentIdentifiersRef.current = { sessionId: null, transactionId: null, orderCode: null };
    setFursNapaka(null);
    setResumeNarociloId(null);
    setVivaTapToPayAutoIssueId(null);
    setSplitMode(false);
    setSplitPostavkeIds(new Set());
    const preostalaOdprta = odprta.filter(n => n.id !== selectedNarocilo);
    setSelectedNarocilo(null);
    setSelectedGatewayOrderId(null);
    if (preostalaOdprta.length === 0) {
      setLocation("/");
    }
  };

  const handleIzdajPreostanek = async () => {
    // After a partial receipt: delete billed postavke and renumber remaining guests
    setIssuedRacun(null);
    setTerminalStanje("idle");
    setTerminalRezultat(null);
    setVivaCheckoutUrl(null);
    setSumupQrCheckoutId(null);
    setSumupQrZnesek(null);
    setLastSumupCheckoutId(null);
    cardPaymentAttemptRef.current = null;
    vivaPaymentIdentifiersRef.current = { sessionId: null, transactionId: null, orderCode: null };
    setFursNapaka(null);
    setResumeNarociloId(null);
    setVivaTapToPayAutoIssueId(null);
    setSplitMode(false);
    setSplitPostavkeIds(new Set());
    setSteviloBonov(0);
    setZnesekDarilnegaBona(0);

    const billed = billedInfoRef.current;
    billedInfoRef.current = null;
    if (!billed || billed.postavkeIds.length === 0) return;

    const { narociloId, postavkeIds: billedIds } = billed;

    // Get fresh order data from cache
    const allNarocila = queryClient.getQueryData<typeof narocila>(getListAktivnaNarocilaQueryKey());
    const order = allNarocila?.find(n => n.id === narociloId)
      ?? (resumeNarocilo?.id === narociloId ? resumeNarocilo : undefined);
    if (!order) return;

    const vsePostavke = order.postavke ?? [];
    const billedSet = new Set(billedIds);

    const gostFn = (p: (typeof vsePostavke)[0]) =>
      (p as typeof p & { gostStevilka?: number | null }).gostStevilka ?? null;

    const invalidateNarocilo = () => Promise.all([
      queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() }),
      queryClient.invalidateQueries({ queryKey: getGetNarociloQueryKey(narociloId) }),
    ]);

    // Identify the empty guest: whose ALL unbilled items are in billedSet
    const billedGostje = [...new Set(
      [...billedSet].map(id => {
        const p = vsePostavke.find(q => q.id === id);
        return p ? gostFn(p) : null;
      }).filter((g): g is number => g !== null)
    )];
    const emptyGuest = billedGostje.length === 1 ? billedGostje[0] : null;

    // Last guest = max gostStevilka across ALL postavke (billed + unbilled)
    const allGostje = vsePostavke.map(gostFn).filter((g): g is number => g !== null);
    const lastGuest = allGostje.length > 0 ? Math.max(...allGostje) : null;

    if (!emptyGuest || !lastGuest || emptyGuest === lastGuest) {
      await invalidateNarocilo();
      return;
    }

    // Last guest's unbilled items (excluding those just billed)
    const lastGuestItems = vsePostavke.filter(p =>
      gostFn(p) === lastGuest && p.racunId === null && !billedSet.has(p.id)
    );

    if (lastGuestItems.length === 0) {
      // Last guest has no unbilled items → just remove slot (maxGostVPostavkah auto-syncs)
      await invalidateNarocilo();
      return;
    }

    // Last guest has items → move them to emptyGuest (or clear if only 1 guest remains)
    const otherGostjeItems = vsePostavke.filter(p =>
      p.racunId === null && !billedSet.has(p.id) &&
      gostFn(p) !== lastGuest && gostFn(p) !== emptyGuest
    );
    const newGostStevilka = otherGostjeItems.length === 0 ? null : emptyGuest;

    try {
      await Promise.all(
        lastGuestItems.map(p =>
          updateKolicinaHook.mutateAsync({
            id: narociloId,
            postavkaId: p.id,
            data: { kolicina: p.kolicina, gostStevilka: newGostStevilka },
          })
        )
      );
    } catch {
      toast({ title: "Napaka", description: "Ni bilo mogoče premakniti postavk gosta", variant: "destructive" });
    }

    await invalidateNarocilo();
  };

  const handleIzrednaIzdajaPIN = () => {
    if (!pinInput.trim()) { setPinNapaka("Vnesite PIN."); return; }
    setPinNapaka(null);
    issueRacun({ preskociDDVPreverjanje: true, skrbnisPIN: pinInput });
  };

  const handleOdpriZdruziDialog = () => {
    setZdruziIzbrana(new Set(drugaNarocilaIsteMize.map(n => n.id)));
    setZdruziDialogOpen(true);
  };

  const handleZdruziIzbrana = async () => {
    if (gatewayCheckoutMode || !selectedNarocilo || združiIzbrana.size === 0) return;
    const izbranaList = drugaNarocilaIsteMize.filter(n => združiIzbrana.has(n.id));
    try {
      for (const n of izbranaList) {
        await spojiMutation.mutateAsync({ id: selectedNarocilo, data: { virNarociloId: n.id } });
      }
      await queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
      setZdruziDialogOpen(false);
      toast({ title: "Združeno", description: izbranaList.length === drugaNarocilaIsteMize.length ? "Vsa naročila te mize so bila uspešno združena." : `${izbranaList.length} naročil${izbranaList.length === 1 ? "o" : "a"} uspešno združeno.` });
    } catch {
      toast({ title: "Napaka", description: "Združevanje ni uspelo.", variant: "destructive" });
    }
  };

  const handleZdruziPosamezno = async (virNarociloId: number) => {
    if (gatewayCheckoutMode || !selectedNarocilo) return;
    setSpojiPosameznoId(virNarociloId);
    try {
      await spojiMutation.mutateAsync({ id: selectedNarocilo, data: { virNarociloId } });
      await queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
      toast({ title: "Združeno", description: `Naročilo #${virNarociloId} je bilo uspešno združeno v trenutno naročilo.` });
    } catch {
      toast({ title: "Napaka", description: "Združevanje ni uspelo.", variant: "destructive" });
    } finally {
      setSpojiPosameznoId(null);
    }
  };

  // Pri neposrednem prihodu na konkretno naročilo ne blokiraj prikaza zaradi
  // osveževanja seznama ostalih naročil. Ta seznam se lahko naloži v ozadju.
  if (isLoading && !selectedOrder) return (
    <div className="p-8 space-y-3">
      <Skeleton className="h-[400px]" />
    </div>
  );

  // ── Success ────────────────────────────────────────────────
  if (issuedRacun) {
    const fursUspeh = !fursNapaka && issuedRacun.status !== "napaka";
    const smtpAktiven = (nastavitve as { smtpAktiven?: boolean } | null)?.smtpAktiven ?? false;

    const handlePosljiEmail = (e: React.FormEvent) => {
      e.preventDefault();
      if (!emailInput.trim() || !issuedRacun) return;
      setEmailRezultat(null);
      posljiEmail.mutate(
        { id: issuedRacun.id, data: { prejemnik: emailInput.trim() } },
        {
          onSuccess: (r) => setEmailRezultat({ uspeh: r.uspeh, napaka: r.napaka ?? null }),
          onError: () => setEmailRezultat({ uspeh: false, napaka: "Napaka pri pošiljanju" }),
        }
      );
    };

    return (
      <div className="p-4 md:p-8 flex items-start md:items-center justify-center flex-1 overflow-y-auto">
        {/* ── Dialog: Pošlji e-račun ─────────────────────── */}
        <Dialog open={emailDialogOpen} onOpenChange={(open) => {
          if (!open) { setEmailDialogOpen(false); setEmailRezultat(null); }
        }}>
          <DialogContent className="sm:max-w-sm" data-testid="dialog-email-racun">
            <DialogHeader>
              <DialogTitle className="flex items-center gap-2">
                <Mail className="h-5 w-5 text-blue-600" />
                Pošlji e-račun stranki
              </DialogTitle>
            </DialogHeader>
            <form onSubmit={handlePosljiEmail} className="space-y-4 py-2">
              <p className="text-sm text-muted-foreground">
                Vnesite e-poštni naslov stranke za pošiljanje računa{" "}
                <span className="font-mono font-semibold">{issuedRacun.stevilkaRacuna}</span>.
              </p>
              <Input
                type="email"
                autoFocus
                placeholder="stranka@email.si"
                value={emailInput}
                onChange={e => { setEmailInput(e.target.value); setEmailRezultat(null); }}
                disabled={posljiEmail.isPending || emailRezultat?.uspeh === true}
                data-testid="input-email-racun"
              />
              {emailRezultat && (
                <p className={`text-sm font-medium ${emailRezultat.uspeh ? "text-green-700" : "text-destructive"}`}>
                  {emailRezultat.uspeh ? "E-račun je bil uspešno poslan." : (emailRezultat.napaka ?? "Pošiljanje ni uspelo.")}
                </p>
              )}
              <DialogFooter className="gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => { setEmailDialogOpen(false); setEmailRezultat(null); }}
                >
                  {emailRezultat?.uspeh ? "Zapri" : "Preskoči"}
                </Button>
                {!emailRezultat?.uspeh && (
                  <Button
                    type="submit"
                    disabled={!emailInput.trim() || posljiEmail.isPending}
                    data-testid="button-potrdi-email"
                  >
                    {posljiEmail.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Mail className="h-4 w-4 mr-2" />}
                    Pošlji
                  </Button>
                )}
              </DialogFooter>
            </form>
          </DialogContent>
        </Dialog>

        <Card className="w-full max-w-md text-center my-auto">
          <CardHeader className="pb-2">
            <div className="flex justify-center mb-4">
              {fursUspeh ? (
                <CheckCircle2 className="h-16 w-16 text-green-500" />
              ) : (
                <AlertTriangle className="h-16 w-16 text-amber-500" />
              )}
            </div>
            <CardTitle className="text-2xl">
              {fursUspeh ? "Račun izdan" : "Račun shranjen — napaka FURS"}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {fursNapaka ? (
              <Alert className="border-red-400 bg-red-50 text-red-900 text-left" data-testid="alert-furs-napaka">
                <AlertTriangle className="h-5 w-5 text-red-600" />
                <AlertTitle className="text-red-900 font-bold">Fiskalizacija ni uspela</AlertTitle>
                <AlertDescription className="mt-1 text-red-800 text-sm" data-testid="alert-furs-napaka-sporocilo">
                  {fursNapaka}
                </AlertDescription>
              </Alert>
            ) : issuedRacun.jeDelni ? (
              <Alert className="border-blue-400 bg-blue-50 text-blue-900 text-left">
                <Scissors className="h-5 w-5 text-blue-600" />
                <AlertTitle className="text-blue-900 font-bold">Delni račun izdan</AlertTitle>
                <AlertDescription className="mt-1 text-blue-800 text-sm">
                  Del naročila je bil zaračunan. Preostale postavke čakajo na ločen račun.
                </AlertDescription>
              </Alert>
            ) : (
              <p className="text-muted-foreground">Račun je bil uspešno izdan in poslan na FURS.</p>
            )}
            {issuedRacun.opozorilo && (
              <Alert className="border-amber-400 bg-amber-50 text-amber-900 text-left">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
                <AlertTitle className="text-amber-900 font-bold">Opozorilo</AlertTitle>
                <AlertDescription className="mt-1 text-amber-800 text-sm">
                  {issuedRacun.opozorilo}
                </AlertDescription>
              </Alert>
            )}
            <div className="rounded-lg bg-muted p-4 text-left space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Številka:</span>
                <span className="font-mono font-semibold">{issuedRacun.stevilkaRacuna}</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-muted-foreground">Znesek:</span>
                <span className="font-bold">{issuedRacun.skupaj.toFixed(2)} €</span>
              </div>
              {issuedRacun.znesekNapitnina && issuedRacun.znesekNapitnina > 0 && (
                <div className="flex justify-between text-sm">
                  <span className="text-muted-foreground">Napitnina:</span>
                  <span className="font-bold">{issuedRacun.znesekNapitnina.toFixed(2)} €</span>
                </div>
              )}
              <div className="flex justify-between text-sm items-center">
                <span className="text-muted-foreground">FURS:</span>
                {fursNapaka ? (
                  <Badge className="bg-red-100 text-red-800 border-red-200" data-testid="badge-furs-napaka">Napaka fiskalizacije</Badge>
                ) : issuedRacun.zoi ? (
                  <Badge className="bg-green-100 text-green-800 border-green-200">Davčno potrjen</Badge>
                ) : (
                  <Badge className="bg-yellow-100 text-yellow-800 border-yellow-200">Testni izpis</Badge>
                )}
              </div>
              {terminalRezultat?.avtorizacijskaKoda && (
                <>
                  <Separator />
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Avtoriz. koda:</span>
                    <span className="font-mono">{terminalRezultat.avtorizacijskaKoda}</span>
                  </div>
                  {terminalRezultat.kartica && (
                    <div className="flex justify-between text-sm">
                      <span className="text-muted-foreground">Kartica:</span>
                      <span>{terminalRezultat.kartica} {terminalRezultat.maskiranPan}</span>
                    </div>
                  )}
                </>
              )}
                  {issuedRacun.zoi && !fursUspeh && (
                <div className="pt-2 border-t space-y-2">
                  <div>
                    <p className="text-xs text-muted-foreground mb-1">ZOI:</p>
                    <p className="font-mono text-xs break-all">{issuedRacun.zoi}</p>
                  </div>
                  {nastavitve?.davcnaStevilka && (() => {
                    const dt = issuedRacun.datumCas;
                    const ljStr = new Intl.DateTimeFormat("sv-SE", {
                      timeZone: "Europe/Ljubljana",
                      year: "numeric", month: "2-digit", day: "2-digit",
                      hour: "2-digit", minute: "2-digit", second: "2-digit",
                      hour12: false,
                    }).format(dt);
                    const datum = ljStr.replace(/[-: ]/g, ""); // "20260625043000" — brez T
                    const qrUrl = `https://blagajne.fu.gov.si/check?zoi=${issuedRacun.zoi}&davSt=${nastavitve?.davcnaStevilka}&datum=${datum}`;
                    return (
                      <div className="flex flex-col items-center gap-1">
                        <QRCodeSVG value={qrUrl} size={200} />
                        <p className="text-xs text-muted-foreground">Preveritev pri FURS</p>
                      </div>
                    );
                  })()}
                </div>
              )}
            </div>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            {fursUspeh ? (
              <>
                <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground" data-testid="status-samodejni-tisk">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Račun je potrjen. Samodejno tiskam …
                </div>
                <PrintReceiptButton
                  racunId={issuedRacun.id}
                  stevilkaRacuna={issuedRacun.stevilkaRacuna}
                  className="hidden"
                  autoPrint
                  onAfterPrint={issuedRacun.jeDelni ? handleIzdajPreostanek : handleNewRacun}
                />
              </>
            ) : (
              <PrintReceiptButton
                racunId={issuedRacun.id}
                stevilkaRacuna={issuedRacun.stevilkaRacuna}
                variant="default"
                size="lg"
                className="w-full"
                onAfterPrint={issuedRacun.jeDelni ? handleIzdajPreostanek : handleNewRacun}
              />
            )}
            {smtpAktiven && (
              <Button
                variant="outline"
                className="w-full"
                onClick={() => { setEmailInput(""); setEmailRezultat(null); setEmailDialogOpen(true); }}
                data-testid="button-poslji-email-racun"
              >
                <Mail className="h-4 w-4 mr-2" />
                Pošlji e-račun
              </Button>
            )}
            <Button variant="outline" className="w-full" onClick={handleNewRacun} data-testid="button-nov-racun">
              <ArrowLeft className="h-4 w-4 mr-2" />
              {issuedRacun.jeDelni ? "Zaključi naročilo" : "Nazaj"}
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // ── Terminal waiting / result overlay ─────────────────────
  if (terminalStanje === "odobren") {
    return (
      <div className="p-8 flex items-center justify-center flex-1">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-10 pb-8 space-y-4">
            <Loader2 className="h-14 w-14 mx-auto animate-spin text-primary" />
            <p className="text-xl font-semibold">Plačilo potrjeno</p>
            <p className="text-muted-foreground text-sm">
              Izdajam račun, čakam na FURS in pripravljam stran za tiskanje.
            </p>
            <p className="text-xs text-muted-foreground">
              Ne zapirajte blagajne in ne ponavljajte plačila.
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (terminalStanje === "cakanje") {
    if (sumupQrCheckoutId) {
      const qrUrl = `https://pay.sumup.com/b2b/v2/${sumupQrCheckoutId}`;
      const prikazZnesek = sumupQrZnesek ?? selectedOrder?.skupaj ?? 0;
      return (
        <div className="p-8 flex items-center justify-center flex-1">
          <Card className="w-full max-w-sm text-center">
            <CardHeader className="pb-2">
              <CardTitle className="flex items-center justify-center gap-2 text-lg">
                <QrCode className="h-5 w-5 text-primary" />
                Plačilo s SumUp
              </CardTitle>
            </CardHeader>
            <CardContent className="pb-8 space-y-5">
              <div className="flex justify-center">
                <div className="rounded-xl border-4 border-primary/20 p-3 bg-white inline-block">
                  <QRCodeSVG
                    value={qrUrl}
                    size={200}
                    level="M"
                    includeMargin={false}
                  />
                </div>
              </div>
              <p className="font-bold text-3xl text-primary">{Number(prikazZnesek).toFixed(2)} €</p>
              <div className="flex items-center justify-center gap-2 text-muted-foreground text-sm">
                <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                <span>Čakam na plačilo...</span>
              </div>
              <p className="text-xs text-muted-foreground">
                Stranka naj skenira QR kodo s telefonom ali odpre SumUp aplikacijo.
              </p>
              <div className="flex gap-2 justify-center pt-1">
                <Button
                  variant="outline"
                  size="sm"
                  data-testid="button-kopiraj-link"
                  onClick={() => {
                    navigator.clipboard.writeText(qrUrl).then(() => {
                      setSumupQrLinkKopiran(true);
                      setTimeout(() => setSumupQrLinkKopiran(false), 2000);
                    });
                  }}
                >
                  {sumupQrLinkKopiran ? (
                    <Check className="h-4 w-4 mr-1.5 text-green-600" />
                  ) : (
                    <Copy className="h-4 w-4 mr-1.5" />
                  )}
                  {sumupQrLinkKopiran ? "Kopirano!" : "Kopiraj link"}
                </Button>
                <Button
                  variant="outline"
                  size="sm"
                  asChild
                >
                  <a href={qrUrl} target="_blank" rel="noopener noreferrer" data-testid="link-odpri-zavihku">
                    <ExternalLink className="h-4 w-4 mr-1.5" />
                    Odpri v novem zavihku
                  </a>
                </Button>
              </div>
            </CardContent>
          </Card>
        </div>
      );
    }

    if (showVivaFlow && vivaCheckoutUrl) {
      return (
        <div className="p-8 flex items-center justify-center flex-1">
          <Card className="w-full max-w-sm text-center">
            <CardContent className="pt-8 pb-8 space-y-4">
              <p className="text-xl font-semibold">Viva Wallet plačilo</p>
              <p className="text-muted-foreground text-sm">
                Stranka naj skenira QR kodo s telefonom in opravi plačilo.
              </p>
              <div className="flex justify-center py-2">
                <QRCodeSVG value={vivaCheckoutUrl} size={200} />
              </div>
              <p className="font-bold text-2xl text-primary">
                {terminalskiZnesek.toFixed(2)} €
              </p>
              <div className="flex items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                <span>Čakam na potrditev plačila...</span>
              </div>
              <a
                href={vivaCheckoutUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="block text-xs text-blue-600 underline break-all"
              >
                Odpri plačilni link
              </a>
            </CardContent>
          </Card>
        </div>
      );
    }
    if ((showVivaAndroidTerminalFlow || showVivaTapToPayFlow) && vivaBridgeLaunchUrl) {
      return (
        <div className="p-8 flex items-center justify-center flex-1">
          <Card className="w-full max-w-sm text-center">
            <CardContent className="pt-8 pb-8 space-y-5">
              <CreditCard className="h-14 w-14 mx-auto text-primary" />
              <div className="space-y-2">
                <p className="text-xl font-semibold">Plačilo je pripravljeno</p>
                <p className="text-muted-foreground text-sm">
                  Plačilni poskus je varno rezerviran. Z naslednjim dotikom odprite Viva Terminal.
                </p>
              </div>
              <p className="font-bold text-2xl text-primary">{terminalskiZnesek.toFixed(2)} €</p>
              <Button className="w-full" size="lg" asChild>
                <a href={vivaBridgeLaunchUrl} data-testid="link-odpri-viva-terminal">
                  <ExternalLink className="h-5 w-5 mr-2" />
                  Odpri Viva Terminal
                </a>
              </Button>
              <p className="text-xs text-muted-foreground">
                Če Viva ne prikaže jasnega rezultata, plačila ne ponavljajte.
              </p>
            </CardContent>
          </Card>
        </div>
      );
    }
    return (
      <div className="p-8 flex items-center justify-center flex-1">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-10 pb-8 space-y-4">
            <Loader2 className="h-14 w-14 mx-auto animate-spin text-primary" />
            <p className="text-xl font-semibold">Čakam na terminal...</p>
            <p className="text-muted-foreground text-sm">
              Stranka naj vstavi ali prisloni kartico na terminal.
            </p>
            <p className="font-bold text-2xl text-primary">{terminalskiZnesek.toFixed(2)} €</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (terminalStanje === "zavrnjen" || terminalStanje === "preklic" || terminalStanje === "napaka") {
    const isDeclined = terminalStanje === "zavrnjen";
    const isCancelled = terminalStanje === "preklic";
    return (
      <div className="p-8 flex items-center justify-center flex-1">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-10 pb-8 space-y-4">
            <XCircle className="h-14 w-14 mx-auto text-destructive" />
            <p className="text-xl font-semibold">
              {isDeclined ? "Kartica zavrnjena" : isCancelled ? "Plačilo preklicano" : "Napaka terminala"}
            </p>
            {terminalRezultat?.napaka && (
              <p className="text-sm text-muted-foreground">{terminalRezultat.napaka}</p>
            )}
            <p className="text-muted-foreground text-sm">Račun ni bil izdan.</p>
          </CardContent>
          <CardFooter className="flex flex-col gap-3">
            {paymentGuard.state === "reconciliation-required" ? (
              <>
                <Alert className="text-left border-amber-300 bg-amber-50">
                  <AlertTriangle className="h-4 w-4 text-amber-700" />
                  <AlertTitle>Preverjanje plačila je potrebno</AlertTitle>
                  <AlertDescription data-testid="status-payment-guard">{paymentGuard.message}</AlertDescription>
                </Alert>
                {recoverableCardPayment && (
                  <div className="w-full space-y-2">
                    {availableRecoveries.length > 1 && (
                      <p className="text-left text-sm text-muted-foreground" data-testid="text-recovery-choice">
                        Izberite potrjeno plačilo za ta račun:
                      </p>
                    )}
                    {(availableRecoveries.length ? availableRecoveries : [recoverableCardPayment]).map((recovery, index) => (
                      <Button
                        key={recovery.attemptId}
                        className="w-full"
                        onClick={() => void handleRecoverPaidReceipt(recovery)}
                        disabled={createRacun.isPending || cardRecoveryChecking}
                        data-testid={index === 0 ? "button-recover-paid-receipt" : `button-recover-paid-receipt-${recovery.attemptId}`}
                      >
                        <Receipt className="h-4 w-4 mr-2" />
                        {availableRecoveries.length > 1
                          ? `Izberi ${recovery.provider} plačilo (${recovery.znesek.toFixed(2)} €${recovery.ustvarjeno ? `, ${new Date(recovery.ustvarjeno).toLocaleString("sl-SI", { timeZone: "Europe/Ljubljana" })}` : ""})`
                          : "Zaključi račun brez novega plačila"}
                      </Button>
                    ))}
                  </div>
                )}
                {!recoverableCardPayment && (
                  <Button variant="outline" className="w-full" onClick={resetPaymentGuardAfterReconciliation} data-testid="button-reset-payment-guard">
                    Po preverjanju odkleni nov poskus
                  </Button>
                )}
              </>
            ) : vivaSmartTimeout && showVivaFlow && vivaPaymentIdentifiersRef.current.orderCode ? (
              <Button className="w-full" onClick={handleVivaTimeoutRecheck} data-testid="button-recheck-viva-status">
                Ponovno preveri stanje plačila
              </Button>
            ) : (
              <Button className="w-full" onClick={handleRetryTerminal} data-testid="button-retry-terminal">
                Poskusi znova
              </Button>
            )}
            <Button variant="outline" className="w-full" disabled={paymentOrFinalizationInProgress} onClick={() => {
              setTerminalStanje("idle");
              setTerminalRezultat(null);
              setVivaSmartTimeout(false);
              setVivaCheckoutUrl(null);
              setPlacilniNacin("gotovina");
            }} data-testid="button-change-payment">
               Zamenjaj plačilo
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // ── Main checkout form ─────────────────────────────────────
  return (
    <div className="flex-1 overflow-auto bg-muted/10">
      {/* ── Dialog: razvojna izdaja večnamenskega darilnega bona ─────────── */}
      <Dialog open={darilniBonDialogOpen} onOpenChange={(open) => {
        setDarilniBonDialogOpen(open);
        if (!open) setDarilniBonNapaka(null);
      }}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-izdaja-darilnega-bona">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Gift className="h-5 w-5 text-violet-600" />
              Prodaj darilni bon
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Alert>
              <Gift className="h-4 w-4" />
              <AlertTitle>Predplačilo brez DDV</AlertTitle>
              <AlertDescription>
                Bon se vodi skupno za podjetje brez kode, serijske številke ali roka veljavnosti. Ob unovčitvi nastane običajen obdavčen račun.
              </AlertDescription>
            </Alert>
            <div className="rounded-md border bg-muted/30 p-3 text-sm">
              {darilniBonLoading ? (
                <span className="flex items-center gap-2 text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Nalagam evidenco …</span>
              ) : darilniBonStanje ? (
                <div className="grid grid-cols-3 gap-2 text-center">
                  <div><p className="text-xs text-muted-foreground">Izdano</p><p className="font-semibold">{darilniBonStanje.izdano.toFixed(2)} €</p></div>
                  <div><p className="text-xs text-muted-foreground">Unovčeno</p><p className="font-semibold">{darilniBonStanje.unovceno.toFixed(2)} €</p></div>
                  <div><p className="text-xs text-muted-foreground">Odprto</p><p className={`font-semibold ${darilniBonStanje.odprto < 0 ? "text-destructive" : "text-green-700"}`}>{darilniBonStanje.odprto.toFixed(2)} €</p></div>
                </div>
              ) : <span className="text-muted-foreground">Stanje evidence ni na voljo.</span>}
            </div>
            <div className="space-y-2">
              <Label htmlFor="darilni-bon-znesek">Znesek bona</Label>
              <Input
                id="darilni-bon-znesek"
                type="text"
                inputMode="decimal"
                placeholder="npr. 25,00"
                value={darilniBonZnesekIzdaja}
                onChange={(event) => setDarilniBonZnesekIzdaja(event.target.value)}
                onKeyDown={(event) => { if (event.key === "Enter") void izdajDarilniBon(); }}
                autoFocus
                data-testid="input-darilni-bon-znesek"
              />
            </div>
            <div className="space-y-2">
              <Label>Prejeto plačilo</Label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { value: "gotovina" as const, label: "Gotovina", Icon: Banknote },
                  { value: "kartica" as const, label: "Kartica", Icon: CreditCard },
                ].map(({ value, label, Icon }) => (
                  <Button
                    key={value}
                    type="button"
                    variant={darilniBonPlaciloIzdaja === value ? "default" : "outline"}
                    className="gap-2"
                    onClick={() => setDarilniBonPlaciloIzdaja(value)}
                  >
                    <Icon className="h-4 w-4" /> {label}
                  </Button>
                ))}
              </div>
            </div>
            {darilniBonNapaka && <p className="text-sm text-destructive">{darilniBonNapaka}</p>}
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setDarilniBonDialogOpen(false)} disabled={darilniBonIzdajanje || paymentOrFinalizationInProgress}>Prekliči</Button>
            <Button onClick={() => void izdajDarilniBon()} disabled={darilniBonIzdajanje || paymentOrFinalizationInProgress} data-testid="button-izdaj-darilni-bon">
              {darilniBonIzdajanje ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Gift className="h-4 w-4 mr-2" />}
              Izdaj bon
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── PIN dialog za izredno izdajo ─────────────────────── */}
      <Dialog open={pinDialogOpen} onOpenChange={(open) => { if (!open) { setPinDialogOpen(false); setPinInput(""); setPinNapaka(null); } }}>
        <DialogContent className="sm:max-w-sm" data-testid="dialog-izredni-pin">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <KeyRound className="h-5 w-5 text-amber-600" />
              Izredna izdaja — PIN skrbnika
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <p className="text-sm text-muted-foreground">
              Vnesite skrbniški PIN za potrditev izredne izdaje računa kljub manjšemu DDV neskladju
              {ddvNapaka?.razlika !== undefined && <> (razlika <strong>{ddvNapaka.razlika.toFixed(2)} €</strong>)</>}.
            </p>
            <div className="space-y-2">
              <Input
                type="password"
                inputMode="numeric"
                placeholder="Skrbniški PIN"
                value={pinInput}
                onChange={e => { setPinInput(e.target.value); setPinNapaka(null); }}
                onKeyDown={e => { if (e.key === "Enter") handleIzrednaIzdajaPIN(); }}
                autoFocus
                data-testid="input-izredni-pin"
              />
              {pinNapaka && (
                <p className="text-sm text-destructive font-medium" data-testid="napaka-izredni-pin">{pinNapaka}</p>
              )}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => { setPinDialogOpen(false); setPinInput(""); setPinNapaka(null); }}>
              Prekliči
            </Button>
            <Button
              onClick={handleIzrednaIzdajaPIN}
              disabled={createRacun.isPending || paymentOrFinalizationInProgress}
              className="bg-amber-600 hover:bg-amber-700"
              data-testid="button-potrdi-izredni-pin"
            >
              {createRacun.isPending || paymentOrFinalizationInProgress ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldAlert className="h-4 w-4 mr-2" />}
              Potrdi izredno izdajo
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Potrdi združevanje naročil ───────────────── */}
      <Dialog open={združiDialogOpen} onOpenChange={setZdruziDialogOpen}>
        <DialogContent className="sm:max-w-md" data-testid="dialog-združi-narocila">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <GitMerge className="h-5 w-5 text-amber-600" />
              Združi naročila te mize
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-3 py-2">
            <p className="text-sm text-muted-foreground">
              Izberite naročila, ki jih želite združiti v trenutno naročilo.
            </p>
            <div className="space-y-2">
              {drugaNarocilaIsteMize.map(n => (
                <div
                  key={n.id}
                  className="rounded-md border px-3 py-2 flex items-start gap-3 cursor-pointer hover:bg-muted/40"
                  onClick={() => setZdruziIzbrana(prev => {
                    const next = new Set(prev);
                    if (next.has(n.id)) next.delete(n.id); else next.add(n.id);
                    return next;
                  })}
                  data-testid={`dialog-narocilo-row-${n.id}`}
                >
                  <Checkbox
                    id={`združi-narocilo-${n.id}`}
                    checked={združiIzbrana.has(n.id)}
                    onCheckedChange={(checked) => setZdruziIzbrana(prev => {
                      const next = new Set(prev);
                      if (checked) next.add(n.id); else next.delete(n.id);
                      return next;
                    })}
                    onClick={e => e.stopPropagation()}
                    className="mt-0.5"
                    data-testid={`dialog-checkbox-narocilo-${n.id}`}
                  />
                  <div className="flex-1 min-w-0">
                    <label htmlFor={`združi-narocilo-${n.id}`} className="font-semibold text-sm cursor-pointer">
                      Naročilo #{n.stevilkaNarocila ?? n.id} — {Number(n.skupaj).toFixed(2)} €
                    </label>
                    {(() => { const gl = (n.postavke ?? []).filter(p => p.racunId === null && p.parentPostavkaId == null); return gl.length > 0 && (
                      <ul className="mt-0.5 space-y-0 text-xs text-muted-foreground">
                        {gl.slice(0, 3).map(p => (
                          <li key={p.id}>{p.kolicina}× {p.ime}</li>
                        ))}
                        {gl.length > 3 && (
                          <li className="italic">+ {gl.length - 3} več...</li>
                        )}
                      </ul>
                    ); })()}
                  </div>
                </div>
              ))}
            </div>
          </div>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setZdruziDialogOpen(false)} disabled={spojiMutation.isPending}>
              Prekliči
            </Button>
            <Button
              onClick={() => { void handleZdruziIzbrana(); }}
              disabled={spojiMutation.isPending || združiIzbrana.size === 0}
              className="bg-amber-600 hover:bg-amber-700 text-white"
              data-testid="button-potrdi-združi-izbrana"
            >
              {spojiMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : (
                <GitMerge className="h-4 w-4 mr-2" />
              )}
              Združi izbrana{združiIzbrana.size > 0 ? ` (${združiIzbrana.size})` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: X-poročilo ─────────────────────────────── */}
      <Dialog open={izpisPrometaOpen} onOpenChange={(o) => { setIzpisPrometaOpen(o); if (!o) { setIzpisData(null); setIzpisStanje(null); setIzpisPremiki([]); setIzpisNapaka(null); } }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              X-poročilo
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!activeBlagajnaId && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Blagajna ni izbrana</AlertTitle>
                <AlertDescription>Za X-poročilo najprej izberite aktivno blagajno v stranski navigaciji.</AlertDescription>
              </Alert>
            )}
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Poslovni dan</Label>
                <Input type="date" value={izpisOd} onChange={e => { setIzpisOd(e.target.value); setIzpisDo(e.target.value); setIzpisData(null); setIzpisStanje(null); }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Blagajna</Label>
                <Input value={imeAktivneBlagajne} disabled />
              </div>
            </div>
            <Button className="w-full" onClick={handleIzpisPromet} disabled={izpisLoading || !activeBlagajnaId}>
              {izpisLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Nalagam...</> : "Prikaži X-poročilo"}
            </Button>
            {izpisNapaka && <p className="text-sm text-destructive">{izpisNapaka}</p>}
            {izpisData && (
              <div className="space-y-4">
                {/* Podatki podjetja */}
                {izpisData.podjetje.naziv && (
                  <div className="text-center text-sm">
                    <p className="font-semibold">{izpisData.podjetje.naziv}</p>
                    {izpisData.enota.ime && <p className="font-medium text-primary">Poslovna enota: {izpisData.enota.ime}</p>}
                    {izpisData.podjetje.naslov && <p className="text-muted-foreground text-xs">{izpisData.podjetje.naslov}</p>}
                    {izpisData.podjetje.davcnaStevilka && <p className="text-muted-foreground text-xs">ID za DDV: {izpisData.podjetje.davcnaStevilka}</p>}
                  </div>
                )}

                {/* Način plačila */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Način plačila</p>
                  <div className="rounded-md border divide-y text-sm">
                    <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Gotovina</span><span className="font-medium">{izpisData.prometPoNacinuPlacila.gotovina.toFixed(2)} €</span></div>
                    <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Kartica (bremenitev)</span><span className="font-medium">{izpisData.prometPoNacinuPlacila.kartica.toFixed(2)} €</span></div>
                    {izpisData.prometPoNacinuPlacila.napitnina !== 0 && <div className="flex justify-between px-3 py-1.5 text-amber-900 bg-amber-50/50"><span>Napitnine (ločeno)</span><span className="font-medium">{izpisData.prometPoNacinuPlacila.napitnina.toFixed(2)} €</span></div>}
                    {izpisData.prometPoNacinuPlacila.sumup > 0 && <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">SumUp</span><span className="font-medium">{izpisData.prometPoNacinuPlacila.sumup.toFixed(2)} €</span></div>}
                    <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Bon</span><span className="font-medium">{izpisData.prometPoNacinuPlacila.bon.toFixed(2)} €</span></div>
                    {izpisData.prometPoNacinuPlacila.bonPica > 0 && <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Bon za pico ({izpisData.prometPoNacinuPlacila.steviloBonov}×)</span><span className="font-medium">{izpisData.prometPoNacinuPlacila.bonPica.toFixed(2)} €</span></div>}
                    {izpisData.prometPoNacinuPlacila.negotovinsko > 0 && <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">TRR</span><span className="font-medium">{izpisData.prometPoNacinuPlacila.negotovinsko.toFixed(2)} €</span></div>}
                    <div className="flex justify-between px-3 py-1.5 bg-muted/40 font-semibold"><span>Prodajni skupaj</span><span>{izpisData.skupajPromet.toFixed(2)} €</span></div>
                    {(izpisData.prometPoNacinuPlacila.reprezentanca > 0 || izpisData.prometPoNacinuPlacila.lastna_poraba > 0) && (
                      <>
                        <div className="px-3 py-1 bg-muted/20"><span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">Navidezni promet</span></div>
                        {izpisData.prometPoNacinuPlacila.reprezentanca > 0 && <div className="flex justify-between px-3 py-1.5 opacity-70"><span className="text-muted-foreground">Reprezentanca</span><span className="font-medium">{izpisData.prometPoNacinuPlacila.reprezentanca.toFixed(2)} €</span></div>}
                        {izpisData.prometPoNacinuPlacila.lastna_poraba > 0 && <div className="flex justify-between px-3 py-1.5 opacity-70"><span className="text-muted-foreground">Lastna poraba</span><span className="font-medium">{izpisData.prometPoNacinuPlacila.lastna_poraba.toFixed(2)} €</span></div>}
                      </>
                    )}
                  </div>
                </div>

                {izpisStanje && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Blagajniški dnevnik — gibanje gotovine</p>
                    <div className="rounded-md border divide-y text-sm">
                      <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Menjalni denar</span><span className="font-medium">{izpisStanje.menjalniDenar.toFixed(2)} €</span></div>
                      <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">+ Gotovinska prodaja</span><span className="font-medium">{izpisStanje.gotovinskaProdaja.toFixed(2)} €</span></div>
                      <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">+ Prejemi gotovine</span><span className="font-medium">{izpisStanje.pologiGotovine.toFixed(2)} €</span></div>
                      <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">− Izplačila dobaviteljem</span><span className="font-medium">{izpisStanje.izplacilaDobaviteljem.toFixed(2)} €</span></div>
                      <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">− Pologi na TRR</span><span className="font-medium">{izpisStanje.pologiTrr.toFixed(2)} €</span></div>
                      <div className="flex justify-between px-3 py-1.5 bg-muted/40 font-semibold"><span>Teoretično stanje</span><span>{izpisStanje.stanje.toFixed(2)} €</span></div>
                    </div>
                  </div>
                )}

                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Podroben dnevnik premikov</p>
                  <div className="rounded-md border divide-y text-sm">
                    {izpisPremiki.length === 0 ? (
                      <p className="px-3 py-2 text-muted-foreground">Za ta poslovni dan ni premikov.</p>
                    ) : izpisPremiki.map((premik) => (
                      <div key={premik.id} className="px-3 py-2 space-y-0.5">
                        <div className="flex justify-between gap-2">
                          <span className="font-medium">{premik.tip.replaceAll("_", " ")}</span>
                          <span className="font-semibold whitespace-nowrap">{premik.znesek.toFixed(2)} €</span>
                        </div>
                        <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
                          <span>{new Date(premik.datumCas).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" })} · {premik.status === "OSNUTEK" ? "Osnutek — neknjiženo" : premik.status === "STORNIRAN" ? "Storno" : "Potrjeno"}</span>
                          {premik.partnerNaziv && <span className="truncate">{premik.partnerNaziv}</span>}
                        </div>
                        {premik.opis && <p className="text-xs text-muted-foreground">{premik.opis}</p>}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Po blagajni */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Po blagajni</p>
                  <div className="rounded-md border divide-y text-sm">
                    {izpisData.prometPoBlagajnah.map(b => (
                      <div key={b.blagajnaKoda} className="px-3 py-1.5 space-y-0.5">
                        <div className="flex justify-between">
                          <span className="font-mono font-medium">{b.blagajnaKoda}</span>
                          <span className="font-semibold">{b.skupaj.toFixed(2)} € <span className="text-muted-foreground font-normal text-xs">({b.steviloRacunov} rač.)</span></span>
                        </div>
                        {b.odZap && (
                          <div className="text-xs text-muted-foreground">
                            Rač. {b.odZap} – {b.doZap}
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>

                {/* Po natakarju */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Po natakarju</p>
                  <div className="rounded-md border divide-y text-sm">
                    {izpisData.prometPoNatakarjih.map(n => (
                      <div key={n.natakarIme} className="px-3 py-1.5 space-y-0.5">
                        <div className="flex justify-between">
                          <span className="font-medium">{n.natakarIme}</span>
                          <span className="font-semibold">{n.skupaj.toFixed(2)} €</span>
                        </div>
                        <div className="flex gap-3 text-xs text-muted-foreground">
                          {n.gotovina > 0 && <span>Got. {n.gotovina.toFixed(2)} €</span>}
                          {n.kartica > 0 && <span>Krt. {n.kartica.toFixed(2)} €</span>}
                          {n.sumup > 0 && <span>SumUp {n.sumup.toFixed(2)} €</span>}
                          {n.bon > 0 && <span>Bon {n.bon.toFixed(2)} €</span>}
                          {n.bonPica > 0 && <span>Bon pica ({n.steviloBonov}×) {n.bonPica.toFixed(2)} €</span>}
                          <span className="ml-auto">{n.steviloRacunov} rač.</span>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Prihodki po vrsti */}
                {izpisData.prihodkiPoVrsti && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Prihodki po vrsti (neto)</p>
                    <div className="rounded-md border divide-y text-sm">
                      <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Storitve</span><span className="font-medium">{(izpisData.prihodkiPoVrsti.storitve ?? 0).toFixed(2)} €</span></div>
                      <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Blago</span><span className="font-medium">{(izpisData.prihodkiPoVrsti.blago ?? 0).toFixed(2)} €</span></div>
                      <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Material</span><span className="font-medium">{(izpisData.prihodkiPoVrsti.material ?? 0).toFixed(2)} €</span></div>
                      <div className="flex justify-between px-3 py-1.5 bg-muted/40 font-semibold"><span>Skupaj neto</span><span>{((izpisData.prihodkiPoVrsti.storitve ?? 0) + (izpisData.prihodkiPoVrsti.blago ?? 0) + (izpisData.prihodkiPoVrsti.material ?? 0)).toFixed(2)} €</span></div>
                    </div>
                  </div>
                )}

                {/* DDV po stopnjah */}
                {izpisData.ddvPoStopnjah.length > 0 && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">DDV po stopnjah</p>
                    <div className="rounded-md border divide-y text-sm">
                      {izpisData.ddvPoStopnjah.map(d => (
                        <div key={d.stopnja} className="px-3 py-1.5 space-y-0.5">
                          <div className="flex justify-between">
                            <span className="text-muted-foreground">DDV {d.stopnja.toFixed(1).replace(".", ",")} %</span>
                            <span className="font-medium">{d.ddvZnesek.toFixed(2)} €</span>
                          </div>
                          <div className="flex justify-between text-xs text-muted-foreground">
                            <span>Osnova</span>
                            <span>{d.osnova.toFixed(2)} €</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* Boni za pico — kuponi */}
                {(izpisData.izdaniKuponi > 0 || izpisData.prejetiKuponi > 0) && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Boni za pico</p>
                    <div className="rounded-md border divide-y text-sm">
                      <div className="flex justify-between px-3 py-1.5">
                        <span className="text-muted-foreground">Izdani kuponi</span>
                        <span className="font-medium">{izpisData.izdaniKuponi}</span>
                      </div>
                      <div className="flex justify-between px-3 py-1.5">
                        <span className="text-muted-foreground">Prejeti kuponi</span>
                        <span className="font-medium">{izpisData.prejetiKuponi}</span>
                      </div>
                    </div>
                  </div>
                )}

              </div>
            )}
          </div>
          {izpisData && (
            <DialogFooter>
              <Button variant="outline" onClick={handleNatisniPromet} className="w-full bg-orange-500 hover:bg-orange-600 text-white border-orange-500">
                <Printer className="h-4 w-4 mr-2" />Natisni
              </Button>
            </DialogFooter>
          )}
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Z-poročilo ─────────────────────────────── */}
      <Dialog open={zPorociloOpen} onOpenChange={(o) => { setZPorociloOpen(o); if (o) void predlagajZDatum().then(d => loadXCash(d)); else { setZSnapshot(null); setZNapaka(null); setZBlokade([]); setXCash(null); } }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <LockKeyhole className="h-5 w-5 text-orange-600" />
              Z-poročilo — dnevni zaključek
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!activeBlagajnaId && (
              <Alert variant="destructive">
                <AlertTriangle className="h-4 w-4" />
                <AlertTitle>Blagajna ni izbrana</AlertTitle>
                <AlertDescription>Za Z-poročilo najprej izberite aktivno blagajno v stranski navigaciji.</AlertDescription>
              </Alert>
            )}
            {!zSnapshot && (
              <>
                <div className="rounded-md border p-3 space-y-2">
                  <Label htmlFor="z-poslovni-datum">Poslovni dan za zaključek</Label>
                  <Input
                    id="z-poslovni-datum"
                    type="date"
                    value={zPoslovniDatum}
                    max={privzetiDatum}
                    onChange={(event) => {
                      setZPoslovniDatum(event.target.value);
                      setXCash(null);
                      setZBlokade([]);
                      setZNapaka(null);
                    }}
                  />
                  <p className="text-xs text-muted-foreground">
                    Če je bil zaključek izpuščen, izberite pretekli poslovni dan in zaključite najprej njega.
                  </p>
                </div>
                <div className="rounded-md border p-3 space-y-3" data-testid="x-cash-reconciliation">
                  <div className="flex items-center justify-between">
                    <p className="font-medium text-sm">X-pregled in uskladitev gotovine</p>
                    <Button type="button" variant="ghost" size="sm" onClick={() => void loadXCash()} disabled={xCashLoading || !activeBlagajnaId}>Osveži</Button>
                  </div>
                  {xCash && <>
                    <div className="flex justify-between text-sm"><span className="text-muted-foreground">Pričakovana gotovina</span><strong>{xCash.pricakovanaGotovina.toFixed(2)} €</strong></div>
                    {xCash.reconciliation && <div className="flex justify-between text-sm"><span className="text-muted-foreground">Zabeležena razlika</span><strong className={xCash.reconciliation.razlika === 0 ? "text-green-700" : "text-orange-700"}>{xCash.reconciliation.razlika.toFixed(2)} €</strong></div>}
                    <Input type="number" step="0.01" min="0" value={xCashInput} onChange={event => setXCashInput(event.target.value)} placeholder="Prešteta gotovina" aria-label="Prešteta gotovina" />
                    <Input value={xOverrideReason} onChange={event => setXOverrideReason(event.target.value)} placeholder="Razlog odstopanja (ob razliki obvezen)" aria-label="Razlog odstopanja" />
                    <Button type="button" variant="outline" className="w-full" onClick={() => void saveCashReconciliation()} disabled={xCashLoading || !xCashInput}>Potrdi uskladitev</Button>
                  </>}
                  {!xCash && !xCashLoading && <p className="text-sm text-muted-foreground">Odprite X-pregled za pričakovano stanje blagajne.</p>}
                </div>
                <Alert className="border-orange-300 bg-orange-50 text-orange-900">
                  <AlertTriangle className="h-4 w-4 text-orange-600" />
                  <AlertTitle className="text-orange-900 font-semibold">Enkratno dejanje</AlertTitle>
                  <AlertDescription className="text-orange-800 text-sm">
                    Z-poročilo zaklene blagajno za izbrani poslovni dan {zPoslovniDatum.split("-").reverse().join(".")}. Po zaključku ustvarjanje novih računov za ta dan ni več mogoče.
                    Odklep zahteva administratorski dostop in obvezen razlog.
                  </AlertDescription>
                </Alert>
                {zNapaka && (
                  <Alert variant="destructive">
                    <AlertTriangle className="h-4 w-4" />
                    <AlertTitle>Dneva ni mogoče zaključiti</AlertTitle>
                    <AlertDescription>
                      <p>{zNapaka}</p>
                      {zBlokade.length > 0 && (
                        <ul className="mt-2 list-disc space-y-1 pl-5" data-testid="z-porocilo-blokade">
                          {zBlokade.map((blocker) => (
                            <li key={blocker.type}>
                              <div>{blocker.message}</div>
                              {blocker.type === "BUSINESS_FINALIZATION_PENDING" && blocker.items?.map((item) => (
                                <div key={item.id} className="mt-1 flex items-center justify-between gap-2 rounded border bg-background px-2 py-1">
                                  <span className="font-medium">{item.label}</span>
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    onClick={() => void handleFinalizirajRacun(item.id)}
                                    disabled={zFinalizingId !== null || paymentOrFinalizationInProgress}
                                  >
                                    {zFinalizingId === item.id
                                      ? <><Loader2 className="h-3 w-3 mr-1 animate-spin" />Obdelujem...</>
                                      : "Dokončaj"}
                                  </Button>
                                </div>
                              ))}
                            </li>
                          ))}
                        </ul>
                      )}
                    </AlertDescription>
                  </Alert>
                )}
                <Button
                  className="w-full bg-orange-600 hover:bg-orange-700 text-white"
                  onClick={handleZZakljuci}
                  disabled={zLoading || !activeBlagajnaId}
                >
                  {zLoading
                    ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Zapisujem zaključek...</>
                    : <><LockKeyhole className="h-4 w-4 mr-2" />Zaključi dan (Z-poročilo)</>}
                </Button>
              </>
            )}
            {zSnapshot && (
              <div className="space-y-4">
                <div className="rounded-md border bg-green-50 border-green-200 p-4 text-center">
                  <p className="text-green-800 font-bold text-lg">Z-POROČILO USPEŠNO</p>
                  <p className="text-green-700 text-sm">Z-številka: <strong>#{zSnapshot.zStevilka}</strong></p>
                  <p className="text-green-700 text-sm">Poslovni dan: <strong>{zSnapshot.poslovniDatum}</strong></p>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Grand Total</p>
                  <div className="rounded-md border divide-y text-sm">
                    <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">GT prej</span><span className="font-medium">{zSnapshot.grandTotalPrej.toFixed(2)} €</span></div>
                    <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">+ Promet dneva</span><span className="font-medium">{zSnapshot.prometDneva.toFixed(2)} €</span></div>
                    <div className="flex justify-between px-3 py-1.5 bg-muted/40 font-semibold"><span>GT nov (kumulativa)</span><span>{zSnapshot.grandTotalNov.toFixed(2)} €</span></div>
                  </div>
                </div>
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Promet dneva</p>
                  <div className="rounded-md border divide-y text-sm">
                    <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Skupaj promet</span><span className="font-medium">{zSnapshot.skupajPromet.toFixed(2)} €</span></div>
                    <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Gotovina</span><span className="font-medium">{zSnapshot.gotovina.toFixed(2)} €</span></div>
                    <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Kartica (bremenitev)</span><span className="font-medium">{(zSnapshot.kartica + zSnapshot.sumup).toFixed(2)} €</span></div>
                    {zSnapshot.znesekNapitnina !== 0 && <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Napitnine (ločeno)</span><span className="font-medium">{zSnapshot.znesekNapitnina.toFixed(2)} €</span></div>}
                    {zSnapshot.bon > 0 && <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Bon</span><span className="font-medium">{zSnapshot.bon.toFixed(2)} €</span></div>}
                    <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Število računov</span><span className="font-medium">{zSnapshot.steviloRacunov}</span></div>
                  </div>
                </div>
                {(zSnapshot.fursPotrjeni > 0 || zSnapshot.fursNepotrjeni > 0) && (
                  <div>
                    <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">FURS</p>
                    <div className="rounded-md border divide-y text-sm">
                      <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Potrjeni</span><span className="font-medium text-green-700">{zSnapshot.fursPotrjeni}</span></div>
                      {zSnapshot.fursNepotrjeni > 0 && <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground text-red-600">! Nepotrjeni</span><span className="font-medium text-red-600">{zSnapshot.fursNepotrjeni}</span></div>}
                    </div>
                  </div>
                )}
                <div className="flex gap-2">
                  <Button variant="outline" className="flex-1" onClick={() => handleZNatisni(zSnapshot)}>
                    <Printer className="h-4 w-4 mr-2" /> Natisni
                  </Button>
                  <Button variant="outline" className="flex-1 border-red-300 text-red-700 hover:bg-red-50" onClick={() => { setZOdklepOpen(true); setZOdklepRazlog(""); setZOdklepNapaka(null); }}>
                    <KeyRound className="h-4 w-4 mr-2" /> Admin odklep
                  </Button>
                </div>
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Dialog: Admin odklep Z-poročila ─────────────────── */}
      <Dialog open={zOdklepOpen} onOpenChange={(o) => { setZOdklepOpen(o); if (!o) { setZOdklepRazlog(""); setZOdklepNapaka(null); } }}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <KeyRound className="h-5 w-5" /> Admin odklep Z-poročila
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertDescription>Odklep razvelavi zaklep tega poslovnega dne. Razlog bo revizijsko shranjen.</AlertDescription>
            </Alert>
            <div className="space-y-1">
              <Label>Razlog odklepa (obvezno)</Label>
              <Input
                value={zOdklepRazlog}
                onChange={e => setZOdklepRazlog(e.target.value)}
                placeholder="Npr. Napačen vnos — potrebna storno korekcija"
              />
            </div>
            {zOdklepNapaka && <p className="text-sm text-destructive">{zOdklepNapaka}</p>}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setZOdklepOpen(false)} disabled={zOdklepLoading}>Prekliči</Button>
            <Button variant="destructive" onClick={handleZOdklep} disabled={zOdklepLoading || !zOdklepRazlog.trim()}>
              {zOdklepLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Odklepam...</> : "Odkleni"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <div className="checkout-layout grid grid-cols-1 md:grid-cols-2">
        {/* Left: open orders */}
        <div className="flex flex-col md:border-r">
          <div className="px-3 pt-2 pb-1 sm:p-4 md:p-6 space-y-1">
          <div className="space-y-1">
            <h1 className="text-xl font-bold tracking-tight">Blagajna</h1>
            <div className={`grid w-full gap-2 ${lahkoProdajaDarilneBone ? "grid-cols-3" : "grid-cols-2"}`}>
              {lahkoProdajaDarilneBone && <Button variant="outline" size="sm" className="h-8 w-full min-w-0 gap-1 px-1.5 text-[10px] sm:text-xs" onClick={odpriIzdajoDarilnegaBona} disabled={paymentOrFinalizationInProgress} data-testid="button-odpri-izdajo-darilnega-bona" title="Prodaj darilni bon">
                <Gift className="h-3.5 w-3.5 shrink-0 text-violet-600" />
                <span className="truncate">Darilni bon</span>
              </Button>}
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-full min-w-0 gap-1 px-1.5 text-[10px] sm:text-xs"
                onClick={() => setIzpisPrometaOpen(true)}
                title="Izpis prometa"
                aria-label="Izpis prometa"
              >
                <FileText className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Izpis prometa</span>
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                className="h-8 w-full min-w-0 gap-1 px-1.5 text-[10px] sm:text-xs border-orange-300 text-orange-700 hover:bg-orange-50"
                onClick={() => {
                  setZPorociloOpen(true);
                  setZSnapshot(null);
                  setZNapaka(null);
                  void predlagajZDatum().then(d => loadXCash(d));
                }}
                title="Z-poročilo — dnevni zaključek"
                aria-label="Z-poročilo — dnevni zaključek"
              >
                <LockKeyhole className="h-3.5 w-3.5 shrink-0" />
                <span className="truncate">Z-poročilo</span>
              </Button>
            </div>
          </div>
          <h2 className="text-base font-semibold">Odprta naročila</h2>
          {odprta.length === 0 ? (
            <Card>
              <CardContent className="p-3 py-2 text-center text-xs text-muted-foreground">
                Ni odprtih naročil za izdajo računa.
              </CardContent>
            </Card>
          ) : (
            odprta.map(narocilo => (
              <Card
                key={narocilo.id}
                className={`cursor-pointer transition-all hover:border-primary ${
                  (gatewayCheckoutMode ? selectedGatewayOrderId === String(narocilo.id) : selectedNarocilo === narocilo.id)
                    ? "border-primary ring-2 ring-primary border-2" : ""
                }`}
                onClick={() => {
                  if (gatewayCheckoutMode) setSelectedGatewayOrderId(String(narocilo.id));
                  else setSelectedNarocilo(narocilo.id);
                  setDdvNapaka(null);
                }}
                data-testid={`card-narocilo-${narocilo.id}`}
              >
                <QrGostStaffInfo
                  vir={narocilo.vir}
                  predvidenPrevzem={narocilo.predvidenPrevzem}
                  pripravljeno={(narocilo.postavke ?? []).filter(p => p.racunId === null && p.parentPostavkaId == null).length > 0 &&
                    (narocilo.postavke ?? []).filter(p => p.racunId === null && p.parentPostavkaId == null).every(p => !!p.pripravljeno)}
                  compact
                  className="mx-6 mt-3"
                />
                <CardHeader className="pb-2">
                  <div className="flex justify-between">
                     <div className="flex items-center gap-2">
                       <CardTitle>{formatMizaProstor(narocilo)}</CardTitle>
                       {narocilo.vir === "qr_gost" && (
                         <Badge className="bg-violet-100 text-violet-800 border border-violet-200" data-testid={`badge-qr-gost-${narocilo.id}`}>
                           QR gost
                         </Badge>
                       )}
                     </div>
                    <span className="font-bold text-xl text-primary">
                      {(narocilo.postavke ?? []).filter(p => p.racunId === null).reduce((s, p) => s + Number(p.skupaj), 0).toFixed(2)} €
                    </span>
                  </div>
                </CardHeader>
                <CardContent className="space-y-2">
                  {(() => {
                    const nezaplacane = (narocilo.postavke ?? []).filter(p => p.racunId === null && p.parentPostavkaId == null);
                    return (<>
                      <p className="text-sm text-muted-foreground">{nezaplacane.length} artiklov</p>
                      {nezaplacane.length > 0 && (
                        <ul className="text-xs text-muted-foreground space-y-0.5">
                          {nezaplacane.slice(0, 3).map(p => (
                            <li key={p.id}>{p.kolicina}× {p.ime}</li>
                          ))}
                          {nezaplacane.length > 3 && (
                            <li className="italic">+ {nezaplacane.length - 3} več...</li>
                          )}
                        </ul>
                      )}
                    </>);
                  })()}
                  <button
                    className="flex items-center gap-1 text-xs font-medium text-primary border border-primary/40 rounded px-2 py-1 hover:bg-primary/10 transition-colors mt-1"
                     disabled={gatewayCheckoutMode}
                     onClick={e => {
                       e.stopPropagation();
                       if (gatewayCheckoutMode) return;
                        const routeId = gatewayCheckoutMode ? localOrderRoute(String(narocilo.id)) : String(narocilo.id);
                        setLocation(narocilo.id === selectedNarocilo && aktivniGost !== null ? `/narocilo/${routeId}?gost=${aktivniGost}` : `/narocilo/${routeId}`);
                     }}
                  >
                    <ArrowLeft className="w-3 h-3" />
                    Na naročilo
                  </button>
                </CardContent>
              </Card>
            ))
          )}
          </div>{/* /p-8 space-y-4 */}
        </div>{/* /flex-col md:border-r */}

        {/* Right: payment */}
          <div className="px-3 pt-0 pb-1 sm:p-4 md:p-6 space-y-1">
          <div className="flex items-center justify-between">
            <h2 className="text-base font-semibold">Zaključek računa</h2>
          </div>
          <Card className="sticky top-0">
            <CardContent className="p-2 pt-1 pb-1 sm:p-3 space-y-1">
              {selectedOrder ? (
                <>
                  {aiSvetovalec.aktiven && (
                    <AiSvetovalecPanel 
                      loading={aiSvetovalec.loading}
                      data={aiSvetovalec.data}
                      error={aiSvetovalec.error}
                      onRefresh={(vprasanje) => aiSvetovalec.performCheck(vprasanje)}
                      isBlagajna={true}
                      className="mb-2"
                    />
                  )}
                  {/* Banner: druga odprta naročila na isti mizi */}
                  {drugaNarocilaIsteMize.length > 0 && (
                    <Alert className="border-amber-400 bg-amber-50 text-amber-900" data-testid="alert-druga-narocila-mize">
                      <GitMerge className="h-4 w-4 text-amber-600" />
                      <AlertTitle className="text-amber-900 font-semibold">
                        {selectedOrder.mizaIme ?? selectedOrder.mizaStevilka != null
                          ? <>Na mizi <strong>{formatMizaProstor(selectedOrder)}</strong> je še {steviloNarocilaLabel(drugaNarocilaIsteMize.length)}</>
                          : <>Je še {steviloNarocilaLabel(drugaNarocilaIsteMize.length)}</>
                        }
                      </AlertTitle>
                      <AlertDescription className="mt-1 text-amber-800 text-sm space-y-3">
                        <p>Priporoča se, da naročila najprej združite v pregledu naročila.</p>
                        <div className="space-y-2">
                          {drugaNarocilaIsteMize.map(n => (
                            <div
                              key={n.id}
                              className="rounded-md border border-amber-300 bg-amber-100/60 px-3 py-2 flex items-start justify-between gap-3"
                              data-testid={`banner-narocilo-${n.id}`}
                            >
                              <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                  <span className="font-semibold text-amber-900 text-sm">
                                    {formatMizaProstor(n)} — naročilo #{n.id}
                                  </span>
                                  <span className="font-bold text-amber-900 text-sm">
                                    {Number(n.skupaj).toFixed(2)} €
                                  </span>
                                </div>
                                {(() => { const gl = (n.postavke ?? []).filter(p => p.racunId === null && p.parentPostavkaId == null); return gl.length > 0 && (
                                  <ul className="mt-0.5 space-y-0 text-xs text-amber-800">
                                    {gl.slice(0, 3).map(p => (
                                      <li key={p.id}>{p.kolicina}× {p.ime}</li>
                                    ))}
                                    {gl.length > 3 && (
                                      <li className="italic">+ {gl.length - 3} več...</li>
                                    )}
                                  </ul>
                                ); })()}
                              </div>
                              <div className="flex flex-col gap-1 shrink-0">
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-amber-500 text-amber-900 hover:bg-amber-200 text-xs px-2 py-1 h-auto w-full"
                                  onClick={() => { void handleZdruziPosamezno(n.id); }}
                                   disabled={gatewayCheckoutMode || spojiMutation.isPending}
                                  data-testid={`button-združi-narocilo-${n.id}`}
                                >
                                  {spojiPosameznoId === n.id ? (
                                    <Loader2 className="h-3 w-3 mr-1 animate-spin" />
                                  ) : (
                                    <GitMerge className="h-3 w-3 mr-1" />
                                  )}
                                  Združi sem
                                </Button>
                                <Button
                                  size="sm"
                                  variant="outline"
                                  className="border-amber-500 text-amber-900 hover:bg-amber-200 text-xs px-2 py-1 h-auto w-full"
                                   onClick={() => {
                                     if (gatewayCheckoutMode) setSelectedGatewayOrderId(String(n.id));
                                     else setSelectedNarocilo(n.id);
                                     setDdvNapaka(null);
                                   }}
                                  data-testid={`button-odpri-narocilo-${n.id}`}
                                >
                                  Odpri naročilo #{n.stevilkaNarocila ?? n.id}
                                </Button>
                              </div>
                            </div>
                          ))}
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            size="sm"
                            variant="default"
                            className="bg-amber-600 hover:bg-amber-700 text-white border-0"
                            onClick={handleOdpriZdruziDialog}
                            disabled={gatewayCheckoutMode || spojiMutation.isPending}
                            data-testid="button-združi-vsa-narocila"
                          >
                            <GitMerge className="h-3.5 w-3.5 mr-1.5" />
                            Združi naročila te mize
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-amber-500 text-amber-900 hover:bg-amber-100"
                            disabled={gatewayCheckoutMode}
                            onClick={() => {
                              if (gatewayCheckoutMode || selectedNarocilo === null) return;
                              const routeId = gatewayCheckoutMode ? localOrderRoute(String(selectedNarocilo)) : String(selectedNarocilo);
                              setLocation(aktivniGost !== null ? `/narocilo/${routeId}?gost=${aktivniGost}` : `/narocilo/${routeId}`);
                            }}
                            data-testid="button-nazaj-na-narocilo"
                          >
                            <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                            Nazaj na naročilo
                          </Button>
                        </div>
                      </AlertDescription>
                    </Alert>
                  )}

                  {/* Natakar — 1. mesto */}
                  <div className="space-y-1">
                    <Label className="text-sm flex items-center gap-2">
                      <User className="h-4 w-4" />
                      Natakar
                    </Label>
                    {aktivneIzmeneLoading ? (
                      <div
                        className="flex min-h-10 items-center gap-2 rounded-md border border-muted bg-muted/30 px-3 py-2 text-xs text-muted-foreground"
                        role="status"
                        aria-live="polite"
                      >
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Nalagam aktivne izmene …
                      </div>
                    ) : (aktivneIzmene?.length ?? 0) === 0 ? (
                      <Alert className="border-red-300 bg-red-50 text-red-900 py-2">
                        <AlertCircle className="h-4 w-4 text-red-600" />
                        <AlertTitle className="text-red-900 font-semibold text-sm">Ni odprtih izmen</AlertTitle>
                        <AlertDescription className="text-red-800 text-xs mt-0.5">
                          Pred izdajo računa mora biti na tej enoti odprta vsaj ena delovna izmena. Pojdite v razdelek <strong>Izmene</strong> in odprite izmeno.
                        </AlertDescription>
                      </Alert>
                    ) : (
                      <>
                        <Select value={selectedNatakarId} onValueChange={handleNatakarChange}>
                          <SelectTrigger>
                            <SelectValue placeholder="Izberite natakarja" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="none">— Brez natakarja —</SelectItem>
                            {aktivniOperaterji.map(izmena => (
                              <SelectItem key={izmena.natakariId} value={String(izmena.natakariId)}>
                                {izmena.natakarIme}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                        {aktivniOperaterji.length === 0 && (
                          <p className="text-xs text-muted-foreground">
                            Vsi natakarji z odprto izmeno so trenutno na odmoru.
                          </p>
                        )}
                      </>
                    )}
                  </div>

                  <Separator />

                  <div className="rounded-lg bg-muted/50 p-2 space-y-0.5">
                    <div className="flex justify-between text-sm font-medium">
                      <span>{formatMizaProstor(selectedOrder)}</span>
                      <span className="text-primary font-bold">
                        {splitMode
                          ? <>{displaySkupaj.toFixed(2)} € <span className="text-xs font-normal text-muted-foreground">/ {displayNezaracunaneSkupaj.toFixed(2)} €</span></>
                          : <>{displayNezaracunaneSkupaj.toFixed(2)} €</>
                        }
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {splitMode
                        ? `${uncoveredPostavke.filter(p => p.parentPostavkaId == null && effectiveSplitPostavkeIds.has(p.id)).length} / ${uncoveredPostavke.filter(p => p.parentPostavkaId == null).length} izbranih`
                        : `${uncoveredPostavke.filter(p => p.parentPostavkaId == null).length} artiklov`}
                    </p>
                  </div>


                  {/* Seštevek po gostih */}
                  {prikaziGostSestevek && (() => {
                    return (
                      <div className="rounded-lg border bg-background p-3 space-y-2" data-testid="sestevek-po-gostih">
                        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide flex items-center gap-1.5">
                          <Users className="h-3.5 w-3.5" />
                          Po gostih
                          <span className="text-[10px] font-normal normal-case tracking-normal text-muted-foreground/70 ml-1">— klikni za razdelitev</span>
                        </p>
                        {gostjeZZneskom.map(({ g, znesek: znesekGost }) => {
                          const znesek = jeBrezplacno ? 0 : znesekGost;
                          const jeIzbran = aktivniGost === g;
                          return (
                            <button
                              key={g}
                              type="button"
                              data-testid={`gost-izberi-${g}`}
                              onClick={() => {
                                const ids = uncoveredPostavke
                                  .filter(p => (p as typeof p & { gostStevilka?: number | null }).gostStevilka === g)
                                  .map(p => p.id);
                                if (jeIzbran) {
                                  setSplitMode(false);
                                  setSplitPostavkeIds(new Set());
                                } else {
                                  setSplitMode(true);
                                  setSplitPostavkeIds(new Set(ids));
                                }
                              }}
                              className={`w-full flex items-center justify-between rounded-md px-2 py-1.5 transition-colors ${
                                jeIzbran
                                  ? "ring-2 ring-primary bg-primary/5"
                                  : "hover:bg-muted/60"
                              }`}
                            >
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full border ${gostBarva(g)}`}>
                                Gost {g}
                              </span>
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-mono font-semibold">{znesek.toFixed(2)} €</span>
                                {jeIzbran && (
                                  <CheckCircle2 className="h-4 w-4 text-primary shrink-0" />
                                )}
                              </div>
                            </button>
                          );
                        })}
                      </div>
                    );
                  })()}

                  {/* Split bill toggle */}
                  {uncoveredPostavke.length > 1 && (
                    <div>
                      <Button
                        type="button"
                        variant={splitMode ? "default" : "outline"}
                        size="sm"
                        className="gap-2"
                        onClick={() => {
                          if (splitMode) {
                            setSplitMode(false);
                            setSplitPostavkeIds(new Set());
                          } else {
                            setSplitMode(true);
                            // Samodejno predlogi prvega gosta z neračunanimi artikli
                            const prvGost = [...new Set(
                              uncoveredPostavke
                                .map(p => (p as typeof p & { gostStevilka?: number | null }).gostStevilka)
                                .filter((g): g is number => g !== null && g !== undefined)
                            )].sort((a, b) => a - b)[0];
                            if (prvGost !== undefined) {
                              setSplitPostavkeIds(new Set(
                                uncoveredPostavke
                                  .filter(p => (p as typeof p & { gostStevilka?: number | null }).gostStevilka === prvGost)
                                  .map(p => p.id)
                              ));
                            } else {
                              setSplitPostavkeIds(new Set(uncoveredPostavke.map(p => p.id)));
                            }
                          }
                        }}
                        data-testid="button-razdeli-racun"
                      >
                        <Scissors className="h-4 w-4" />
                        {splitMode ? "Prekliči razdelitev" : "Razdeli račun"}
                      </Button>

                      {splitMode && (
                        <div className="mt-3 rounded-lg border bg-background p-3 space-y-2">
                          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Izberi postavke za ta račun</p>
                          {/* Hitri gumbi za izbor po gostih */}
                          {(() => {
                            const gostje = [...new Set(
                              uncoveredPostavke
                                .map(p => (p as typeof p & { gostStevilka?: number | null }).gostStevilka)
                                .filter((g): g is number => g !== null && g !== undefined)
                            )].sort((a, b) => a - b);
                            if (gostje.length === 0) return null;
                            return (
                              <div className="flex gap-1.5 flex-wrap items-center pb-1 border-b">
                                <span className="text-[10px] text-muted-foreground uppercase tracking-wide">Hitro izberi:</span>
                                {gostje.map(g => (
                                  <button
                                    key={g}
                                    type="button"
                                    className={`text-xs px-2 py-0.5 rounded-full border font-medium transition-colors ${gostBarva(g)}`}
                                    onClick={() => {
                                      const ids = uncoveredPostavke
                                        .filter(p => (p as typeof p & { gostStevilka?: number | null }).gostStevilka === g)
                                        .map(p => p.id);
                                      setSplitPostavkeIds(new Set(ids));
                                    }}
                                  >
                                    Gost {g}
                                  </button>
                                ))}
                              </div>
                            );
                          })()}
                          {uncoveredPostavke.filter(p => p.parentPostavkaId == null).map(p => {
                            const postavkeSkupine = uncoveredPostavke.filter(c =>
                              expandCheckoutSplitPostavkaIds([p.id], uncoveredPostavke).has(c.id));
                            return (
                            <label key={p.id} className="flex items-center gap-3 cursor-pointer rounded-md p-1.5 hover:bg-muted/50">
                              <Checkbox
                                id={`split-p-${p.id}`}
                                checked={effectiveSplitPostavkeIds.has(p.id)}
                                onCheckedChange={(checked) => {
                                  setSplitPostavkeIds(prev => toggleCheckoutSplitPostavka(
                                    prev,
                                    p.id,
                                    checked === true,
                                    uncoveredPostavke,
                                  ));
                                }}
                              />
                              <span className="flex-1 text-sm flex items-center gap-1.5">
                                {(() => {
                                  const g = (p as typeof p & { gostStevilka?: number | null }).gostStevilka;
                                  return g != null ? (
                                    <span className={`text-[9px] font-bold px-1.5 py-0.5 rounded-full border shrink-0 ${gostBarva(g)}`}>G{g}</span>
                                  ) : null;
                                })()}
                                {p.kolicina}× {p.ime}
                              </span>
                              {(() => {
                                const originalCena = round2(postavkeSkupine.reduce((acc, postavka) => acc + Number(postavka.skupaj), 0));
                                const cenaSkupine = round2(postavkeSkupine.reduce((acc, postavka) => {
                                  const artikelId = (postavka as typeof postavka & { artikelId?: number | null }).artikelId;
                                  const customCena = cenikMap && artikelId != null ? cenikMap.get(artikelId) : undefined;
                                  return acc + (customCena !== undefined
                                    ? round2(customCena * Number(postavka.kolicina))
                                    : Number(postavka.skupaj));
                                }, 0));
                                const displayCena = jeBrezplacno ? 0 : cenaSkupine;
                                return (
                                  <span className="text-sm font-mono text-muted-foreground shrink-0">
                                    {displayCena.toFixed(2)} €
                                    {jeBrezplacno && (
                                      <span className="ml-1 line-through text-xs opacity-50">{originalCena.toFixed(2)}</span>
                                    )}
                                    {!jeBrezplacno && cenaSkupine !== originalCena && (
                                      <span className="ml-1 line-through text-xs opacity-50">{originalCena.toFixed(2)}</span>
                                    )}
                                  </span>
                                );
                              })()}
                            </label>
                            );
                          })}
                          <div className="border-t pt-2 flex justify-between text-sm font-semibold">
                            <span>Skupaj izbrano:</span>
                            <span className="text-primary">{displaySkupaj.toFixed(2)} €</span>
                          </div>
                        </div>
                      )}
                    </div>
                  )}

                  {selectedOrder.ddvNeskladje && (
                    <DdvNeskladjeAlert razlika={selectedOrder.ddvNeskladje.razlika} />
                  )}

                  {imaNeskladjePostavk && vsotaPostavkIzracunana !== null && (
                    <Alert className="border-amber-500 bg-amber-50 text-amber-900" data-testid="alert-neskladje-postavk">
                      <AlertTriangle className="h-5 w-5 text-amber-600" />
                      <AlertTitle className="text-amber-900 font-bold">Neskladje zneska naročila</AlertTitle>
                      <AlertDescription className="mt-1 space-y-2">
                        <p className="text-amber-800 text-sm">
                          Skupaj na naročilu (<span className="font-mono font-semibold">{round2(Number(selectedOrder.skupaj)).toFixed(2)} €</span>) se ne ujema z vsoto postavk (<span className="font-mono font-semibold">{vsotaPostavkIzracunana.toFixed(2)} €</span>) — razlika <span className="font-mono font-semibold">{neskladjePostavkSkupaj!.toFixed(2)} €</span>.
                        </p>
                        <p className="text-amber-800 text-sm">
                          Račun ne bo sprejet. Popravite naročilo (dodajte ali odstranite artikel) ali se obrnite na skrbnika.
                        </p>
                      </AlertDescription>
                    </Alert>
                  )}

                  <Separator />

                  {/* Kupec (davčna številka) */}
                  <div className="space-y-1">
                    {!kupecRocniVnos ? (
                      <>
                        <div className="flex gap-2 items-center">
                          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <KlavijaturaInput
                            placeholder="Davčna številka kupca"
                            value={kupecDavcna}
                            maxLength={8}
                            inputMode="numeric"
                            naslov="Davčna številka"
                            onChange={v => {
                              const cleaned = v.replace(/\D/g, "").slice(0, 8);
                              setKupecDavcna(cleaned);
                              if (!cleaned) { setKupecNaziv(null); setKupecNaslov(null); setKupecNapaka(null); return; }
                              if (/^\d{8}$/.test(cleaned) && !kupecIscemo) {
                                setKupecIscemo(true);
                                poisciKupca({ davcna: cleaned })
                                  .then(d => {
                                    setKupecNaziv(d.kratkiNaziv || d.naziv || null);
                                    const ns = [d.ulica, [d.postnaStevilka, d.kraj].filter(Boolean).join(" ")].filter(Boolean).join(", ");
                                    setKupecNaslov(ns || d.naslov || null);
                                    setKupecZavezanecDdv(d.zavezanecDdv ?? false);
                                    setKupecId(d.id ?? null);
                                    setKupecNapaka(null);
                                  })
                                  .catch(() => {
                                    setKupecNaziv(null);
                                    setKupecNaslov(null);
                                    setKupecId(null);
                                    setKupecNapaka("Kupec ni najden v INETIS — vnesite ročno.");
                                  })
                                  .finally(() => setKupecIscemo(false));
                              }
                            }}
                            className="h-8 flex-1"
                          />
                          {kupecIscemo && <Loader2 className="h-4 w-4 animate-spin text-muted-foreground shrink-0" />}
                          <button
                            type="button"
                            onClick={() => {
                              setKupecRocniVnos(v => !v);
                              setKupecDavcna("");
                              setKupecNaziv(null);
                              setKupecNaslov(null);
                              setKupecNapaka(null);
                              setKupecId(null);
                              setKupecZavezanecDdv(false);
                            }}
                            className="text-xs px-2 py-0.5 rounded border transition-colors font-normal shrink-0 border-input text-muted-foreground hover:border-primary hover:text-primary"
                          >
                            Ročni vnos
                          </button>
                        </div>
                        {kupecNapaka && <p className="text-xs text-amber-600">{kupecNapaka}</p>}
                        {kupecDavcna.length > 0 && (
                          <div className="space-y-1.5">
                            <div className="flex items-center gap-2">
                              <Label htmlFor="kupec-naziv" className="text-xs text-muted-foreground shrink-0 w-14">Naziv</Label>
                              <KlavijaturaInput
                                id="kupec-naziv"
                                placeholder="Naziv podjetja ali osebe"
                                value={kupecNaziv ?? ""}
                                onChange={v => setKupecNaziv(v || null)}
                                naslov="Naziv kupca"
                                className="h-8 text-sm flex-1"
                              />
                            </div>
                            <div className="flex items-center gap-2">
                              <Label htmlFor="kupec-naslov" className="text-xs text-muted-foreground shrink-0 w-14">Naslov</Label>
                              <KlavijaturaInput
                                id="kupec-naslov"
                                placeholder="Ulica, kraj"
                                value={kupecNaslov ?? ""}
                                onChange={v => setKupecNaslov(v || null)}
                                naslov="Naslov kupca"
                                className="h-8 text-sm flex-1"
                              />
                            </div>
                            <button
                              type="button"
                              onClick={() => { setKupecDavcna(""); setKupecNaziv(null); setKupecNaslov(null); setKupecNapaka(null); setKupecZavezanecDdv(false); setKupecId(null); }}
                              className="text-xs text-destructive hover:underline"
                            >
                              Odstrani kupca
                            </button>
                            {effectiveSkupajSCenikom !== null && (
                              <div className="mt-1 rounded-md bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-xs text-amber-800 flex items-center gap-1.5">
                                <span className="shrink-0">🏷️</span>
                                <span>Partnerski cenik aktiven</span>
                              </div>
                            )}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="space-y-1.5">
                        <div className="flex items-center gap-2">
                          <Building2 className="h-4 w-4 shrink-0 text-muted-foreground" />
                          <span className="text-xs text-muted-foreground flex-1">Ročni vnos kupca</span>
                          <button
                            type="button"
                            onClick={() => { setKupecRocniVnos(false); setKupecDavcna(""); setKupecNaziv(null); setKupecNaslov(null); setKupecNapaka(null); setKupecId(null); setKupecZavezanecDdv(false); }}
                            className="text-xs px-2 py-0.5 rounded border transition-colors font-normal shrink-0 bg-primary text-primary-foreground border-primary"
                          >
                            Ročni vnos
                          </button>
                        </div>
                        <div className="flex items-center gap-2">
                          <Label htmlFor="kupec-naziv-rocni" className="text-xs text-muted-foreground shrink-0 w-14">Naziv</Label>
                          <KlavijaturaInput
                            id="kupec-naziv-rocni"
                            placeholder="Naziv podjetja ali osebe"
                            value={kupecNaziv ?? ""}
                            onChange={v => setKupecNaziv(v || null)}
                            naslov="Naziv kupca"
                            className="h-8 text-sm flex-1"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Label htmlFor="kupec-naslov-rocni" className="text-xs text-muted-foreground shrink-0 w-14">Naslov</Label>
                          <KlavijaturaInput
                            id="kupec-naslov-rocni"
                            placeholder="Ulica, kraj"
                            value={kupecNaslov ?? ""}
                            onChange={v => setKupecNaslov(v || null)}
                            naslov="Naslov kupca"
                            className="h-8 text-sm flex-1"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Label htmlFor="kupec-davcna-rocni" className="text-xs text-muted-foreground shrink-0 w-14">Davčna</Label>
                          <KlavijaturaInput
                            id="kupec-davcna-rocni"
                            placeholder="npr. 12345678"
                            value={kupecDavcna}
                            maxLength={8}
                            inputMode="numeric"
                            naslov="Davčna številka"
                            onChange={v => setKupecDavcna(v.replace(/\D/g, "").slice(0, 8))}
                            className="h-8 text-sm flex-1"
                          />
                        </div>
                        <div className="flex items-center gap-2">
                          <Checkbox
                            id="kupec-zavezanec-rocni"
                            checked={kupecZavezanecDdv}
                            onCheckedChange={v => setKupecZavezanecDdv(!!v)}
                          />
                          <Label htmlFor="kupec-zavezanec-rocni" className="text-xs cursor-pointer">Zavezanec za DDV</Label>
                        </div>
                        {(kupecNaziv || kupecNaslov || kupecDavcna) && (
                          <button
                            type="button"
                            onClick={() => { setKupecDavcna(""); setKupecNaziv(null); setKupecNaslov(null); setKupecZavezanecDdv(false); }}
                            className="text-xs text-destructive hover:underline"
                          >
                            Počisti podatke kupca
                          </button>
                        )}
                      </div>
                    )}
                  </div>

                  <Separator />

                  {/* Bon za pico — prikaži samo, če so pice na naročilu */}
                  {showBonZaPico && (
                    <div className="space-y-2">
                      <Label className="text-sm flex items-center gap-2">
                        <Pizza className="h-4 w-4 text-orange-500" />
                        Bon za pico
                        <span className="text-xs font-normal text-muted-foreground ml-1">
                          ({skupnoStevicoPic} {skupnoStevicoPic === 1 ? "pica" : skupnoStevicoPic < 5 ? "pice" : "pic"} na naročilu)
                        </span>
                      </Label>

                      {/* Število bonov — štejnik */}
                      <div className="flex items-center gap-4">
                        <button
                          type="button"
                          onClick={() => setSteviloBonov(v => Math.max(0, v - 1))}
                          disabled={steviloBonovDejanski === 0}
                          className="h-9 w-9 rounded-full border-2 flex items-center justify-center hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          aria-label="Zmanjšaj število bonov"
                        >
                          <Minus className="h-4 w-4" />
                        </button>
                        <div className="text-center min-w-[3rem]">
                          <span className="text-2xl font-bold">{steviloBonovDejanski}</span>
                          <p className="text-xs text-muted-foreground leading-tight">bonov</p>
                        </div>
                        <button
                          type="button"
                          onClick={() => setSteviloBonov(v => Math.min(skupnoStevicoPic, v + 1))}
                          disabled={steviloBonovDejanski >= skupnoStevicoPic}
                          className="h-9 w-9 rounded-full border-2 flex items-center justify-center hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                          aria-label="Povečaj število bonov"
                        >
                          <Plus className="h-4 w-4" />
                        </button>
                        <div className="flex-1 text-right">
                          <p className="text-sm text-muted-foreground">Pokrito z boni</p>
                          <p className="font-bold text-orange-600">{znesekBonov.toFixed(2)} €</p>
                        </div>
                      </div>

                      {/* Razčlenitev pokritih pic */}
                      {steviloBonovDejanski > 0 && (
                        <div className="rounded-lg bg-orange-50 border border-orange-200 p-3 space-y-1">
                          <p className="text-xs font-semibold text-orange-800 mb-1">Pokrite pice (od najdražje):</p>
                          {piceSeznam.slice(0, steviloBonovDejanski).map((p, i) => (
                            <div key={i} className="flex justify-between text-xs text-orange-700">
                              <span>{p.ime}</span>
                              <span className="font-mono">{p.cenaKos.toFixed(2)} €</span>
                            </div>
                          ))}
                          {!vsePlacanoZBoni && (
                            <div className="flex justify-between text-xs text-muted-foreground border-t border-orange-200 mt-1 pt-1">
                              <span>Preostalo za plačilo:</span>
                              <span className="font-mono font-semibold text-foreground">{znesekPreostalega.toFixed(2)} €</span>
                            </div>
                          )}
                          {vsePlacanoZBoni && (
                            <p className="text-xs text-green-700 font-semibold border-t border-orange-200 mt-1 pt-1 text-center">
                              ✓ Celoten znesek pokrit z boni
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Separator samo ko je bon za pico aktiven */}
                  {showBonZaPico && steviloBonovDejanski > 0 && <Separator />}

                  {nastavitve?.studentskiBonAktiven === true && steviloBonovDejanski === 0 && (
                    <div className="space-y-3 rounded-lg border border-emerald-200 bg-emerald-50/60 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <Label htmlFor="ssp-subvencija" className="text-sm font-medium text-emerald-950">
                            Študentski bon — subvencija
                          </Label>
                          <p className="mt-0.5 text-xs text-emerald-800">
                            Subvencija se vodi kot terjatev do MDDSZ/ŠOS; DDV in vrednost računa ostaneta nespremenjena.
                          </p>
                        </div>
                        {znesekSubvencijaDejanski > 0 && (
                          <Badge className="shrink-0 bg-emerald-700">{znesekSubvencijaDejanski.toFixed(2)} €</Badge>
                        )}
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="space-y-1">
                          <Label htmlFor="ssp-subvencija" className="text-xs text-emerald-900">Subvencija (€)</Label>
                          <Input
                            id="ssp-subvencija"
                            type="number"
                            inputMode="decimal"
                            min="0"
                            max={znesekPreostalega}
                            step="0.01"
                            value={znesekSubvencija === 0 ? "" : znesekSubvencija}
                            onChange={(event) => {
                              const value = Number(event.target.value);
                              setZnesekSubvencija(Number.isFinite(value) ? Math.max(0, value) : 0);
                            }}
                            disabled={placilniNacin !== "gotovina" && placilniNacin !== "kartica"}
                            data-testid="ssp-subvencija-input"
                          />
                        </div>
                        <div className="space-y-1">
                          <Label htmlFor="ssp-referenca" className="text-xs text-emerald-900">Lokalna/NFC referenca (neobvezno)</Label>
                          <Input
                            id="ssp-referenca"
                            maxLength={128}
                            value={sspReferenca}
                            onChange={(event) => setSspReferenca(event.target.value)}
                            disabled={placilniNacin !== "gotovina" && placilniNacin !== "kartica"}
                            placeholder="NFC ali lokalna koda"
                            data-testid="ssp-referenca-input"
                          />
                        </div>
                      </div>
                      {znesekSubvencijaDejanski > 0 && (
                        <p className="text-xs font-medium text-emerald-900">
                          Doplačilo {placilniNacin === "kartica" ? "s kartico" : "z gotovino"}: {znesekZaDoplacilo.toFixed(2)} €
                        </p>
                      )}
                    </div>
                  )}

                  {!vsePlacanoZBoni && (
                    <div className="space-y-2">
                      <Label className="text-sm">
                        {steviloBonovDejanski > 0
                          ? <>Način plačila za preostalo <span className="text-primary font-bold">{znesekPreostalega.toFixed(2)} €</span></>
                          : "Način plačila"
                        }
                      </Label>
                      <RadioGroup
                        value={placilniNacin}
                        onValueChange={(v: RacunInputPlacilnaNacin) => {
                          setPlacilniNacin(v);
                          if (v === "gotovina" || v === "kartica") {
                            const nacin = v === "kartica" ? "card" : "cash";
                            setNacinZajemaNapitnine(nacin);
                            nacinZajemaNapitnineRef.current = nacin;
                          }
                          setTerminalStanje("idle");
                          if (v !== "bon") {
                            setZnesekDarilnegaBona(0);
                            setIndividualVoucherMode(false);
                            setIndividualVoucherCode("");
                            setIndividualVoucherPreview(null);
                          }
                          if (v !== "gotovina" && v !== "kartica") {
                            setZnesekSubvencija(0);
                            setSspReferenca("");
                          }
                        }}
                        className={`grid gap-3 ${kupecNaziv || kupecDavcna ? "grid-cols-3" : "grid-cols-3"} sm:${kupecNaziv || kupecDavcna ? "grid-cols-6" : "grid-cols-5"}`}
                      >
                        {[
                          { value: "gotovina",     label: "Gotovina",       Icon: Banknote },
                          ...(imaTrr ? [{ value: "kartica", label: "Kartica", Icon: CreditCard }] : []),
                          ...(lahkoProdajaDarilneBone ? [{ value: "bon", label: "Bon", Icon: Gift }] : []),
                          ...(imaTrr && (kupecNaziv || kupecDavcna) ? [{ value: "negotovinsko", label: "TRR", Icon: Landmark }] : []),
                          { value: "reprezentanca", label: "Reprezentanca", Icon: Landmark },
                          { value: "lastna_poraba", label: "Lastna poraba", Icon: Banknote },
                        ].map(({ value, label, Icon }) => (
                          <div key={value}>
                            <RadioGroupItem value={value} id={value} className="peer sr-only" />
                            <Label
                              htmlFor={value}
                              className="flex flex-col items-center justify-center rounded-md border-2 border-muted bg-popover p-2 hover:bg-accent hover:text-accent-foreground peer-data-[state=checked]:border-primary peer-data-[state=checked]:text-primary cursor-pointer min-h-[4.5rem]"
                            >
                              <Icon className="mb-1 h-5 w-5 shrink-0" />
                              <span className="text-xs text-center leading-tight w-full break-words">{label}</span>
                            </Label>
                          </div>
                        ))}
                      </RadioGroup>

                      {/* Negotovinsko — dnevi odloga plačila */}
                      {placilniNacin === "negotovinsko" && (
                        <div className="mt-3">
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-muted-foreground flex-1">Dnevi odloga plačila</span>
                            <button
                              type="button"
                              onClick={() => setDniOdloga(v => Math.max(1, v - 1))}
                              className="h-9 w-9 rounded-full border-2 flex items-center justify-center hover:bg-muted transition-colors"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="text-xl font-bold font-mono min-w-[3rem] text-center">{dniOdloga}</span>
                            <button
                              type="button"
                              onClick={() => setDniOdloga(v => v + 1)}
                              className="h-9 w-9 rounded-full border-2 flex items-center justify-center hover:bg-muted transition-colors"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>
                        </div>
                      )}

                      {/* Darilni bon — znesek input (samo ko je bon izbran) */}
                      {placilniNacin === "bon" && (
                        <div className="mt-3 space-y-3">
                          <div className="grid grid-cols-2 gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant={individualVoucherMode ? "outline" : "default"}
                              onClick={() => {
                                setIndividualVoucherMode(false);
                                setIndividualVoucherCode("");
                                setIndividualVoucherPreview(null);
                              }}
                              data-testid="button-legacy-voucher-mode"
                            >
                              Stari boni (skupna evidenca)
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={individualVoucherMode ? "default" : "outline"}
                              onClick={() => {
                                setIndividualVoucherMode(true);
                                setZnesekDarilnegaBona(0);
                                setSekundarniNacin("gotovina");
                              }}
                              data-testid="button-individual-voucher-mode"
                            >
                              Spletni bon s kodo
                            </Button>
                          </div>
                          {!individualVoucherMode && darilniBonStanje && (
                            <p className={`rounded-md border px-3 py-2 text-xs ${darilniBonStanje.odprto < 0 ? "border-amber-300 bg-amber-50 text-amber-900" : "border-blue-200 bg-blue-50 text-blue-800"}`}>
                              <strong>Stari boni — skupna evidenca (brez kode):</strong> odprto <strong>{darilniBonStanje.odprto.toFixed(2)} €</strong>. To ni stanje posameznega bona.
                            </p>
                          )}
                          {individualVoucherMode ? (
                            <IndividualVoucherScanner
                              key={`individual-voucher-${String(effectiveSelectedOrderKey ?? "none")}`}
                              value={individualVoucherCode}
                              onChange={setIndividualVoucherCode}
                              onVerified={setIndividualVoucherPreview}
                              payableCents={Math.round(znesekPreostalega * 100)}
                            />
                          ) : <div className="flex items-center gap-3">
                            <span className="text-sm text-muted-foreground flex-1">Znesek starih bonov (brez kode)</span>
                            <button
                              type="button"
                              onClick={() => setZnesekDarilnegaBona(v => Math.max(0, v - DARILNI_BON_KORAK))}
                              disabled={znesekDarilnegaBonaDejanski === 0}
                              className="h-9 w-9 rounded-full border-2 flex items-center justify-center hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              <Minus className="h-4 w-4" />
                            </button>
                            <span className="text-xl font-bold font-mono min-w-[5.5rem] text-center">
                              {znesekDarilnegaBonaDejanski.toFixed(2)} €
                            </span>
                            <button
                              type="button"
                              onClick={() => setZnesekDarilnegaBona(v => Math.min(znesekPreostalega, v + DARILNI_BON_KORAK))}
                              disabled={znesekDarilnegaBonaDejanski >= znesekPreostalega - 0.005}
                              className="h-9 w-9 rounded-full border-2 flex items-center justify-center hover:bg-muted disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                            >
                              <Plus className="h-4 w-4" />
                            </button>
                          </div>}

                          {znesekDarilnegaBonaDejanski > 0 && (
                            <div className="rounded-lg bg-blue-50 border border-blue-200 p-3 space-y-2">
                              <div className="flex justify-between text-sm">
                                <span className="text-blue-700">Pokrito z darilnim bonom:</span>
                                <span className="font-mono font-bold text-blue-800">{znesekDarilnegaBonaDejanski.toFixed(2)} €</span>
                              </div>
                              {!vsePlacanoZDarilnimBonom && (
                                <>
                                  <div className="flex justify-between text-sm border-t border-blue-200 pt-2">
                                    <span className="font-medium">Preostalo za plačilo:</span>
                                    <span className="font-mono font-bold">{znesekPoKritiZDarilnimBonom.toFixed(2)} €</span>
                                  </div>
                                  <div className="flex gap-2 pt-1">
                                    {[
                                      { value: "gotovina" as const, label: "Gotovina", Icon: Banknote },
                                      ...(!individualVoucherMode ? [{ value: "kartica" as const, label: "Kartica", Icon: CreditCard }] : []),
                                    ].map(({ value, label, Icon }) => (
                                      <button
                                        key={value}
                                        type="button"
                                        onClick={() => {
                                          setSekundarniNacin(value);
                                            const nacin = value === "kartica" ? "card" : "cash";
                                            setNacinZajemaNapitnine(nacin);
                                            nacinZajemaNapitnineRef.current = nacin;
                                        }}
                                        className={`flex-1 flex items-center justify-center gap-2 rounded-md border-2 p-2 text-sm transition-colors ${
                                          sekundarniNacin === value
                                            ? "border-primary text-primary bg-primary/5"
                                            : "border-muted hover:bg-muted"
                                        }`}
                                      >
                                        <Icon className="h-4 w-4" />
                                        {label}
                                      </button>
                                    ))}
                                  </div>
                                  {individualVoucherMode && (
                                    <p className="text-xs text-amber-800">
                                      Doplačilo z individualnim bonom je dovoljeno samo z gotovino. Kartica je izključena, ker strežnik ne zagotavlja trajne predavtorizacije bona pred kartičnim plačilom.
                                    </p>
                                  )}
                                </>
                              )}
                              {vsePlacanoZDarilnimBonom && (
                                <p className="text-xs text-green-700 font-semibold border-t border-blue-200 pt-2 text-center">
                                  ✓ Celoten znesek pokrit z darilnim bonom
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                      )}
                    </div>
                  )}

                  {/* Opozorilo prikažemo samo, če ni aktiviran noben način kartičnega plačila. */}
                  {!vsePlacanoZBoni &&
                    jeKarticniTok &&
                    !(
                      terminalAktiven ||
                      paytenAndroidAktiven ||
                      sumupAktiven ||
                      vivaTerminalAktiven ||
                      vivaAndroidTerminalAktiven ||
                      vivaTapToPayAktiven ||
                      vivaAktiven
                    ) && (
                      <div className="rounded-lg border border-muted-foreground/20 bg-muted p-3 text-sm flex items-start gap-3 text-muted-foreground">
                        <Monitor className="h-4 w-4 mt-0.5 shrink-0" />
                        <span>
                          POS terminal ni aktiviran. Omogočite Payten, SumUp ali Viva Wallet v <strong>Nastavitvah</strong>.
                        </span>
                      </div>
                    )}

                  <Separator />

                  {ddvNapaka && (
                    <Alert className="border-red-500 bg-red-50 text-red-900 shadow-lg ring-2 ring-red-300" data-testid="alert-ddv-neskladje">
                      <AlertTriangle className="h-5 w-5 text-red-600" />
                      <AlertTitle className="text-red-900 font-bold text-base">⚠ Napaka DDV — račun ni bil izdan</AlertTitle>
                      <AlertDescription className="mt-1 space-y-3">
                        <p className="text-red-800 font-semibold text-sm leading-snug" data-testid="alert-ddv-sporocilo">
                          {ddvNapaka.razlika !== undefined
                            ? <>Seštevek DDV v naročilu se ne ujema z vsoto postavk za <strong>{ddvNapaka.razlika.toFixed(2)} €</strong>.</>
                            : "Seštevek DDV v naročilu se ne ujema z vsoto postavk."
                          }
                        </p>
                        {ddvNapaka.skupajNarocilo !== undefined && ddvNapaka.skupajIzPostavk !== undefined && (
                          <div className="text-xs text-red-800 bg-red-100 rounded p-2 space-y-0.5">
                            <div className="flex justify-between">
                              <span>Skupaj po naročilu:</span>
                              <span className="font-mono font-semibold">{ddvNapaka.skupajNarocilo.toFixed(2)} €</span>
                            </div>
                            <div className="flex justify-between">
                              <span>Skupaj iz postavk:</span>
                              <span className="font-mono font-semibold">{ddvNapaka.skupajIzPostavk.toFixed(2)} €</span>
                            </div>
                          </div>
                        )}
                        {ddvNapaka.postavke && ddvNapaka.postavke.length > 0 && (
                          <div className="border-t border-red-200 pt-2" data-testid="alert-ddv-postavke">
                            <p className="text-xs font-semibold text-red-800 mb-1">Razčlenitev DDV po postavkah:</p>
                            <table className="w-full text-xs text-red-800">
                              <thead>
                                <tr className="border-b border-red-200">
                                  <th className="text-left py-0.5 pr-2 font-medium">Artikel</th>
                                  <th className="text-right py-0.5 px-1 font-medium">Kol.</th>
                                  <th className="text-right py-0.5 px-1 font-medium">Skupaj</th>
                                  <th className="text-right py-0.5 px-1 font-medium">St. DDV</th>
                                  <th className="text-right py-0.5 pl-1 font-medium">DDV</th>
                                </tr>
                              </thead>
                              <tbody>
                                {ddvNapaka.postavke.map((p, i) => (
                                  <tr key={i} className="border-b border-red-100 last:border-0">
                                    <td className="py-0.5 pr-2 truncate max-w-[100px]">{p.ime}</td>
                                    <td className="text-right py-0.5 px-1">{p.kolicina}×</td>
                                    <td className="text-right py-0.5 px-1 font-mono">{p.skupaj.toFixed(2)} €</td>
                                    <td className="text-right py-0.5 px-1">{p.davek}%</td>
                                    <td className="text-right py-0.5 pl-1 font-mono">{p.ddv.toFixed(2)} €</td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                        {ddvNapaka.podrobnosti && (
                          <p className="text-red-700 text-xs font-mono break-words border-t border-red-200 pt-2" data-testid="alert-ddv-podrobnosti">
                            {ddvNapaka.podrobnosti}
                          </p>
                        )}
                        <div className="border-t border-red-200 pt-2 text-xs text-red-800 font-medium">
                          Stopite v stik s skrbnikom sistema ali popravite cene artiklov v razdelku <strong>Meni</strong>, nato znova poskusite izdati račun.
                        </div>
                        {ddvNapaka.razlika !== undefined && ddvNapaka.razlika < 0.05 && (
                          <div className="border-t border-red-200 pt-2">
                            <Button
                              type="button"
                              variant="outline"
                              size="sm"
                              className="w-full border-amber-400 bg-amber-50 text-amber-900 hover:bg-amber-100 hover:border-amber-500"
                              onClick={() => { setPinDialogOpen(true); setPinInput(""); setPinNapaka(null); }}
                              data-testid="button-izredna-izdaja"
                            >
                              <ShieldAlert className="h-4 w-4 mr-2 text-amber-600" />
                              Izredna izdaja (PIN skrbnika)
                            </Button>
                            <p className="text-xs text-red-700 mt-1 text-center">
                              Razlika {ddvNapaka.razlika.toFixed(2)} € je manjša od 0.05 € — dovoljena izredna izdaja s PIN kodo skrbnika.
                            </p>
                          </div>
                        )}
                      </AlertDescription>
                    </Alert>
                  )}


                </>
              ) : (
                <div className="py-1 text-center text-[11px] text-muted-foreground">
                  Izberite naročilo za izdajo računa
                </div>
              )}
            </CardContent>
            <CardFooter className="p-1">
              {paymentOrFinalizationInProgress && (
                <p className="mb-1 flex w-full items-center justify-center gap-1 text-center text-[11px] text-muted-foreground" data-testid="status-payment-guard">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  {paymentGuard.message}
                </p>
              )}
              <Button
                className="w-full min-h-7 h-auto py-0.5 text-[11px] leading-tight"
                size="sm"
                disabled={!effectiveSelectedOrderKey || activeBlagajnaId == null || offlineOrderLocked || createRacun.isPending || cardRecoveryChecking || paymentOrFinalizationInProgress || aktivniOperaterji.length === 0 || selectedNatakarId === "none" || imaNeskladjePostavk || (splitMode && effectiveSplitPostavkeIds.size === 0)}
                onClick={handleIzdajRacun}
                data-testid="button-izdaj-racun"
              >
                {showSimulationFlow ? (
                  <>
                    <CreditCard className="w-5 h-5 mr-2" />
                    {createRacun.isPending ? "Izdajanje..." : "Simuliraj kartično plačilo in izdaj račun"}
                  </>
                ) : showTerminalFlow ? (
                  <>
                    <CreditCard className="w-5 h-5 mr-2" />
                    {createRacun.isPending ? "Izdajanje..." : "Pošlji na terminal in izdaj račun"}
                  </>
                ) : showPaytenAndroidFlow ? (
                  <>
                    <CreditCard className="w-5 h-5 mr-2" />
                    {createRacun.isPending ? "Izdajanje..." : "Odpri Payten APK in plačaj"}
                  </>
                ) : showSumupFlow ? (
                  <>
                    <CreditCard className="w-5 h-5 mr-2" />
                    {createRacun.isPending ? "Izdajanje..." : "Plačaj prek SumUp in izdaj račun"}
                  </>
                ) : showVivaTerminalFlow ? (
                  <>
                    <CreditCard className="w-5 h-5 mr-2" />
                    {createRacun.isPending ? "Izdajanje..." : "Pošlji na Viva terminal in izdaj račun"}
                  </>
                ) : showVivaAndroidTerminalFlow ? (
                  <>
                    <CreditCard className="w-5 h-5 mr-2" />
                    {createRacun.isPending ? "Izdajanje..." : "Odpri Viva Terminal APK in plačaj"}
                  </>
                ) : showVivaTapToPayFlow ? (
                  <>
                    <CreditCard className="w-5 h-5 mr-2" />
                    {createRacun.isPending ? "Izdajanje..." : "Tap to Pay in izdaj račun"}
                  </>
                ) : showVivaFlow ? (
                  <>
                    <CreditCard className="w-5 h-5 mr-2" />
                    {createRacun.isPending ? "Izdajanje..." : "Plačaj prek Viva Wallet in izdaj račun"}
                  </>
                ) : (
                  <>
                    <Receipt className="w-5 h-5 mr-2" />
                    {createRacun.isPending ? "Izdajanje..." : "Izdaj račun"}
                  </>
                )}
              </Button>
            </CardFooter>
          </Card>
        </div>
      </div>
    </div>
  );
}
