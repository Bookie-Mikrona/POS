import { useState, useEffect, useRef } from "react";
import { useSearch, useLocation, Link } from "wouter";
import {
  useListAktivnaNarocila,
  useCreateRacun,
  useListAktivneIzmene,
  useUpdateNarocilo,
  useRemovePostavka,
  useUpdatePostavkaKolicina,
  useSpojiNarocili,
  usePosljiEmailRacuna,
  useGetPartnerCenik,
  poisciKupca,
  getListAktivnaNarocilaQueryKey,
  getListMizeQueryKey,
  getListRacuniQueryKey,
  getGetNarociloQueryKey,
} from "@workspace/api-client-react";
import { useNastavitve } from "@/contexts/NastavitveContext";
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
  Copy, ExternalLink, Check, Mail, FileText, Printer, Landmark,
} from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { RacunInputPlacilnaNacin } from "@workspace/api-client-react";
import { getEnotaId } from "@workspace/api-client-react";
import { PrintReceiptButton } from "@/components/PrintReceiptButton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { KlavijaturaInput } from "@/components/KlavijaturaInput";
import { DdvNeskladjeAlert } from "@/components/DdvNeskladjeAlert";
import { printTextViaZcsBridge } from "@/lib/zcsAndroidPrinter";
import {
  parsePaytenAndroidCallback,
  izracunajAktivniTerminal,
  type NastavitveTerminal,
  type NapravaTerminalOverride,
} from "@/lib/paytenAndroid";

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
}

type TerminalStanje = "idle" | "cakanje" | "odobren" | "zavrnjen" | "napaka" | "preklic";

interface TerminalRezultat {
  avtorizacijskaKoda?: string | null;
  kartica?: string | null;
  maskiranPan?: string | null;
  napaka?: string | null;
}

export default function Checkout() {
  const { data: narocila, isLoading } = useListAktivnaNarocila({ query: { refetchOnMount: "always", queryKey: getListAktivnaNarocilaQueryKey() } });
  const { nastavitve } = useNastavitve();
  const { data: aktivneIzmene } = useListAktivneIzmene();
  const { activeBlagajnaId } = useBlagajna();
  const { naprava } = useNaprava();
  const createRacun = useCreateRacun();
  const posljiEmail = usePosljiEmailRacuna();
  const updateNarocilo = useUpdateNarocilo();
  const removePostavka = useRemovePostavka();
  const updateKolicinaHook = useUpdatePostavkaKolicina();
  const spojiMutation = useSpojiNarocili();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const search = useSearch();
  const [, setLocation] = useLocation();
  const preselectedId = new URLSearchParams(search).get("narocilo");
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
  // Narocilo ID za samodejno izdajo računa po povratku iz Payten Android Software APK
  const paytenAndroidAutoIssueNarociloRef = useRef<number | null>(null);
  // Narocilo ID za samodejno izdajo računa po povratku iz Viva Android Terminal APK
  const vivaAndroidAutoIssueNarociloRef = useRef<number | null>(null);
  // Narocilo ID za samodejno izdajo računa po povratku iz Viva Tap to Pay (SoftPOS)
  const vivaTapToPayAutoIssueNarociloRef = useRef<number | null>(null);
  // Zastavica: ali je bil zadnji račun izdan samodejno po Tap to Pay?
  const vivaTapToPayIssueRef = useRef(false);

  const [selectedNarocilo, setSelectedNarocilo] = useState<number | null>(null);
  const [placilniNacin, setPlacilniNacin] = useState<RacunInputPlacilnaNacin>("gotovina");
  const [dniOdloga, setDniOdloga] = useState(8);
  const [fursNacin, setFursNacin] = useState<"simulacija" | "testno" | "produkcija">("simulacija");

  useEffect(() => {
    if (nastavitve) {
      setFursNacin(((nastavitve as typeof nastavitve & { fursNacin?: string }).fursNacin ?? "simulacija") as "simulacija" | "testno" | "produkcija");
    }
  }, [nastavitve]);
  const [selectedNatakarId, setSelectedNatakarId] = useState<string>(
    () => localStorage.getItem("pos_last_operator_id") ?? "none"
  );
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

  // ── Izpis prometa ───────────────────────────────────────────
  interface IzpisPrometaData {
    skupajPromet: number; steviloRacunov: number; skupajDDV: number;
    prometPoNacinuPlacila: { gotovina: number; kartica: number; bon: number; sumup: number; bonPica: number; steviloBonov: number; negotovinsko: number; reprezentanca: number; lastna_poraba: number };
    prometPoBlagajnah: { blagajnaKoda: string; skupaj: number; steviloRacunov: number; odZap: string | null; doZap: string | null }[];
    prometPoNatakarjih: { natakarIme: string; skupaj: number; gotovina: number; kartica: number; sumup: number; bon: number; bonPica: number; steviloBonov: number; steviloRacunov: number }[];
    ddvPoStopnjah: { stopnja: number; ddvZnesek: number; osnova: number }[];
    prihodkiPoVrsti: { storitve: number; blago: number };
    izdaniKuponi: number; prejetiKuponi: number;
    odZap: string | null; doZap: string | null;
    podjetje: { naziv: string; naslov: string; davcnaStevilka: string };
  }
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
  const [izpisData, setIzpisData] = useState<IzpisPrometaData | null>(null);
  const [izpisLoading, setIzpisLoading] = useState(false);
  const [izpisNapaka, setIzpisNapaka] = useState<string | null>(null);

  const datumRe = /^\d{4}-\d{2}-\d{2}$/;
  const izpisVeljavenOd = datumRe.test(izpisOd);
  const izpisVeljavenDo = datumRe.test(izpisDo);

  const handleIzpisPromet = async () => {
    if (!izpisVeljavenOd || !izpisVeljavenDo) {
      setIzpisNapaka("Vnesite veljavna datuma v obliki LLLL-MM-DD."); return;
    }
    setIzpisLoading(true); setIzpisNapaka(null); setIzpisData(null);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const enotaId = getEnotaId();
      const headers: Record<string, string> = {};
      if (enotaId) headers["X-Enota-Id"] = enotaId;
      const r = await fetch(`${base}/api/statistike/promet-obdobja?od=${encodeURIComponent(izpisOd.trim())}&do=${encodeURIComponent(izpisDo.trim())}`, { credentials: "include", headers });
      if (!r.ok) {
        let msg = "Napaka pri pridobivanju podatkov.";
        try { const j = await r.json(); msg = j?.error ?? j?.napaka ?? msg; } catch { /* ignore */ }
        setIzpisNapaka(msg); return;
      }
      setIzpisData(await r.json() as IzpisPrometaData);
    } catch { setIzpisNapaka("Napaka pri pridobivanju podatkov."); }
    finally { setIzpisLoading(false); }
  };

  const handleNatisniPromet = async () => {
    if (!izpisData) return;
    const EUR = (n: number) => {
      const s = Math.abs(n).toFixed(2);
      return (n < 0 ? "-" : " ") + s + " EUR";
    };
    const zdaj = new Date().toLocaleString("sl-SI", { timeZone: "Europe/Ljubljana", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit", second: "2-digit" });
    const { naziv, naslov, davcnaStevilka } = izpisData.podjetje;
    const standardW = naprava?.terminalConfig?.tiskalnikSirina === 58 ? 32 : 40;
    const jeWindows = navigator.userAgent.includes("Windows");
    const jeAndroid = navigator.userAgent.includes("Android");
    const agentIme2 = naprava?.terminalConfig?.agentTiskalnikIme ?? "";
    const buildLinije = (W: number): string[] => {
    const vr = (label: string, val: string) => {
      const pad = Math.max(1, W - label.length - val.length);
      return label + " ".repeat(pad) + val;
    };
    const SEP = "-".repeat(W);

    const natakarVrstice = izpisData.prometPoNatakarjih.flatMap(n => [
      vr("Prodajal :" + n.natakarIme, ""),
      vr("Sk.promet:", EUR(n.skupaj)),
      vr("Gotovina :", EUR(n.gotovina)),
      vr("Kartica  :", EUR(n.kartica)),
      ...(n.sumup > 0 ? [vr("SumUp    :", EUR(n.sumup))] : []),
      vr("Bon      :", EUR(n.bon)),
      ...(n.bonPica > 0 ? [vr(`Bon pica (${n.steviloBonov}x):`, EUR(n.bonPica))] : []),
    ]);

    const ddvVrstice = izpisData.ddvPoStopnjah.flatMap(d => {
      const lbl = `DDV ${d.stopnja.toFixed(1).replace(".", ",")}%`;
      return [vr(`${lbl} osnova:`, EUR(d.osnova)), vr(`${lbl} DDV   :`, EUR(d.ddvZnesek))];
    });

    const skupajVrstice = [
      vr("Skupaj   :", ""),
      vr("Sk.promet:", EUR(izpisData.skupajPromet)),
      vr("Gotovina :", EUR(izpisData.prometPoNacinuPlacila.gotovina)),
      vr("Kartica  :", EUR(izpisData.prometPoNacinuPlacila.kartica)),
      ...(izpisData.prometPoNacinuPlacila.sumup > 0 ? [vr("SumUp    :", EUR(izpisData.prometPoNacinuPlacila.sumup))] : []),
      vr("Bon      :", EUR(izpisData.prometPoNacinuPlacila.bon)),
      ...(izpisData.prometPoNacinuPlacila.bonPica > 0 ? [vr(`Bon pica (${izpisData.prometPoNacinuPlacila.steviloBonov}x):`, EUR(izpisData.prometPoNacinuPlacila.bonPica))] : []),
      ...(izpisData.prometPoNacinuPlacila.negotovinsko > 0 ? [vr("TRR      :", EUR(izpisData.prometPoNacinuPlacila.negotovinsko))] : []),
      ...(izpisData.prometPoNacinuPlacila.reprezentanca > 0 ? [vr("Reprez.  :", EUR(izpisData.prometPoNacinuPlacila.reprezentanca))] : []),
      ...(izpisData.prometPoNacinuPlacila.lastna_poraba > 0 ? [vr("Last.por.:", EUR(izpisData.prometPoNacinuPlacila.lastna_poraba))] : []),
    ];

    const blagajneVrstice = izpisData.prometPoBlagajnah.flatMap((b, i) => [
      ...(i > 0 ? [SEP] : []),
      vr("Blagajn.:", b.blagajnaKoda + " (" + b.steviloRacunov + " rac.)"),
      ...(b.odZap ? [vr("Od zap. :", b.odZap), vr("Do zap. :", b.doZap ?? "")] : []),
    ]);

    const prihodkiVrstaBlok = [
      SEP,
      vr("Prihodki po vrsti (neto)", ""),
      vr("Storitve :", EUR(izpisData.prihodkiPoVrsti.storitve)),
      vr("Blago(to go):", EUR(izpisData.prihodkiPoVrsti.blago)),
      vr("Sk.neto  :", EUR(izpisData.prihodkiPoVrsti.storitve + izpisData.prihodkiPoVrsti.blago)),
    ];

    const kuponskiBlok = (izpisData.izdaniKuponi > 0 || izpisData.prejetiKuponi > 0) ? [
      SEP,
      vr("Boni za pico", ""),
      vr("Izdani kup.:", String(izpisData.izdaniKuponi)),
      vr("Prejeti kup.:", String(izpisData.prejetiKuponi)),
    ] : [];

    const ddvFinale = ddvVrstice.length > 0 ? ddvVrstice : [vr("DDV      :", EUR(izpisData.skupajDDV))];

    return [
      ...(naziv ? [naziv] : []),
      ...(naslov ? [naslov] : []),
      ...(davcnaStevilka ? [`ID DDV:${davcnaStevilka}`] : []),
      SEP,
      vr("Dat.od:", izpisOd + " do:" + izpisDo),
      vr("Ura   :", zdaj.slice(-8)),
      SEP,
      ...blagajneVrstice,
      SEP,
      ...natakarVrstice,
      SEP,
      ...skupajVrstice,
      ...prihodkiVrstaBlok,
      SEP,
      vr("Skupaj DDV:", ""),
      ...ddvFinale,
      ...kuponskiBlok,
    ];
    }; // buildLinije

    // Windows agent
    if (jeWindows && agentIme2) {
      const linije = buildLinije(standardW);
      try {
        const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
        const r = await fetch(`${base}/api/print/promet/agent`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          credentials: "include",
          body: JSON.stringify({ linije }),
        });
        if (!r.ok) {
          const err = await r.json().catch(() => ({})) as { error?: string };
          toast({ title: "Napaka pri tiskanju", description: err.error ?? `Napaka (${r.status})`, variant: "destructive" });
        } else {
          toast({ title: "Promet v čakalni vrsti", description: "Windows agent bo natisnil izpis v naslednjih sekundah." });
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
    const html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>Izpis prometa</title>
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

  const [terminalStanje, setTerminalStanje] = useState<TerminalStanje>("idle");
  const [terminalRezultat, setTerminalRezultat] = useState<TerminalRezultat | null>(null);
  const [vivaCheckoutUrl, setVivaCheckoutUrl] = useState<string | null>(null);
  const [sumupQrCheckoutId, setSumupQrCheckoutId] = useState<string | null>(null);
  const [sumupQrZnesek, setSumupQrZnesek] = useState<number | null>(null);
  const [lastSumupCheckoutId, setLastSumupCheckoutId] = useState<string | null>(null);
  const [lastVivaTerminalSessionId, setLastVivaTerminalSessionId] = useState<string | null>(null);
  const [sumupQrLinkKopiran, setSumupQrLinkKopiran] = useState(false);

  const [steviloBonov, setSteviloBonov] = useState(0);
  const DARILNI_BON_KORAK = 10;
  const [znesekDarilnegaBona, setZnesekDarilnegaBona] = useState(0);
  const [sekundarniNacin, setSekundarniNacin] = useState<"gotovina" | "kartica">("gotovina");

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
  const [kupecId, setKupecId] = useState<number | null>(null);
  const { data: kupecCenik } = useGetPartnerCenik(kupecId ?? 0);

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
    setPlacilniNacin("gotovina");
    setSteviloBonov(0);
    setZnesekDarilnegaBona(0);
    setSplitMode(false);
    setSplitPostavkeIds(new Set());
    autoSplitDoneRef.current = null;
  }, [selectedNarocilo]);

  const dovoljeneMizeSet = naprava?.dovoljeneMize?.length
    ? new Set(naprava.dovoljeneMize)
    : null;
  const odprta = (narocila?.filter(n =>
    n.status === "odprto" &&
    (n.postavke?.length ?? 0) > 0 &&
    (dovoljeneMizeSet === null || n.mizaId == null || dovoljeneMizeSet.has(n.mizaId))
  ) ?? []);
  const selectedOrder = odprta.find(n => n.id === selectedNarocilo);

  // Avtomatsko vklopi razdelitev računa kadar ima naročilo več gostov,
  // ali kadar je bil iz naročila posredovan specifičen gost (?gost=N)
  useEffect(() => {
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
  }, [selectedOrder, preselectedGost]);
  const aktivniOperaterji = aktivneIzmene ?? [];

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

  // In split mode, only the user-selected subset; otherwise all uncovered
  const effectivePostavke = splitMode
    ? uncoveredPostavke.filter(p => splitPostavkeIds.has(p.id))
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
    ? Math.min(znesekDarilnegaBona, znesekPreostalega)
    : 0;
  const znesekPoKritiZDarilnimBonom = Math.max(0, znesekPreostalega - znesekDarilnegaBonaDejanski);
  const vsePlacanoZDarilnimBonom = placilniNacin === "bon" && znesekDarilnegaBonaDejanski > 0 && znesekPoKritiZDarilnimBonom < 0.005;

  // Per-naprava terminal override: null = globalna veriga, 'none' = brez, spec. vrednost = točno ta terminal
  const napravaTerminal = naprava?.placilniTerminal ?? null;

  // Prioritetna veriga: Payten HW → Payten Android SW → SumUp → Viva Cloud → Viva Android → Viva TtP → Viva Smart
  const _aktivniTerminal = izracunajAktivniTerminal(
    nastavitve as NastavitveTerminal | null,
    napravaTerminal as NapravaTerminalOverride,
  );
  const terminalAktiven          = _aktivniTerminal === "payten_hw";
  const paytenAndroidAktiven     = _aktivniTerminal === "payten_android";
  const sumupAktiven             = _aktivniTerminal === "sumup";
  const vivaTerminalAktiven      = _aktivniTerminal === "viva_cloud";
  const vivaAndroidTerminalAktiven = _aktivniTerminal === "viva_android";
  const vivaTapToPayAktiven      = _aktivniTerminal === "viva_ttp";
  const vivaAktiven              = _aktivniTerminal === "viva_smart";
  const showTerminalFlow = placilniNacin === "kartica" && terminalAktiven && !vsePlacanoZBoni;
  const showPaytenAndroidFlow = placilniNacin === "kartica" && paytenAndroidAktiven && !vsePlacanoZBoni;
  const showSumupFlow = placilniNacin === "kartica" && sumupAktiven && !vsePlacanoZBoni;
  const showVivaTerminalFlow = placilniNacin === "kartica" && vivaTerminalAktiven && !vsePlacanoZBoni;
  const showVivaAndroidTerminalFlow = placilniNacin === "kartica" && vivaAndroidTerminalAktiven && !vsePlacanoZBoni;
  const showVivaTapToPayFlow = placilniNacin === "kartica" && vivaTapToPayAktiven && !vsePlacanoZBoni;
  const showVivaFlow = placilniNacin === "kartica" && vivaAktiven && !vsePlacanoZBoni;
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
    if (!splitMode || splitPostavkeIds.size === 0) return null;
    for (const { g } of gostjeZZneskom) {
      const gostIds = uncoveredPostavke
        .filter(p => (p as typeof p & { gostStevilka?: number | null }).gostStevilka === g)
        .map(p => p.id);
      if (
        gostIds.length > 0 &&
        gostIds.every(id => splitPostavkeIds.has(id)) &&
        gostIds.length === splitPostavkeIds.size
      ) return g;
    }
    return null;
  })();

  // Razčlenitev plačil za prikaz in validacijo
  const zneskiZaPrikaz: { oznaka: string; znesek: number }[] = [];
  if (selectedOrder) {
    if (steviloBonovDejanski > 0) zneskiZaPrikaz.push({ oznaka: "Bon za pico", znesek: znesekBonov });
    if (!vsePlacanoZBoni) {
      if (placilniNacin === "bon") {
        if (znesekDarilnegaBonaDejanski > 0) zneskiZaPrikaz.push({ oznaka: "Darilni bon", znesek: znesekDarilnegaBonaDejanski });
        if (!vsePlacanoZDarilnimBonom && znesekPoKritiZDarilnimBonom > 0.005)
          zneskiZaPrikaz.push({ oznaka: sekundarniNacin === "gotovina" ? "Gotovina" : "Kartica", znesek: znesekPoKritiZDarilnimBonom });
      } else if (placilniNacin === "gotovina") {
        zneskiZaPrikaz.push({ oznaka: "Gotovina", znesek: znesekPreostalega });
      } else if (placilniNacin === "kartica") {
        zneskiZaPrikaz.push({ oznaka: "Kartica", znesek: znesekPreostalega });
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
    const stillActive = aktivneIzmene.some(i => String(i.natakariId) === selectedNatakarId);
    if (!stillActive) {
      setSelectedNatakarId("none");
      localStorage.removeItem("pos_last_operator_id");
    }
  }, [aktivneIzmene]);

  const handleNatakarChange = (value: string) => {
    setSelectedNatakarId(value);
    if (value === "none") {
      localStorage.removeItem("pos_last_operator_id");
    } else {
      localStorage.setItem("pos_last_operator_id", value);
    }
  };

  const sendToSumup = async (narociloId: number, znesek: number): Promise<boolean> => {
    setTerminalStanje("cakanje");
    setTerminalRezultat(null);
    setSumupQrCheckoutId(null);
    setSumupQrZnesek(null);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/terminal/sumup/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ narociloId, znesek }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setTerminalStanje("napaka");
        setTerminalRezultat({ napaka: err.error ?? "SumUp napaka" });
        return false;
      }
      const { checkoutId } = await res.json() as { checkoutId: string };

      const serial = (nastavitve as { sumupTerminalSerial?: string } | null)?.sumupTerminalSerial ?? "";
      if (!serial) {
        setSumupQrCheckoutId(checkoutId);
        setSumupQrZnesek(znesek);
      }

      for (let i = 0; i < 90; i++) {
        await new Promise<void>(r => setTimeout(r, 2000));
        const statusRes = await fetch(`${base}/api/terminal/sumup/status/${encodeURIComponent(checkoutId)}`);
        const statusData = await statusRes.json() as { status: string; napaka?: string | null };
        if (statusData.status === "PAID") {
          setSumupQrCheckoutId(null);
          setSumupQrZnesek(null);
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

  const sendToVivaTerminal = async (narociloId: number, znesek: number): Promise<boolean> => {
    setTerminalStanje("cakanje");
    setTerminalRezultat(null);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/terminal/viva/terminal/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ narociloId, znesek }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setTerminalStanje("napaka");
        setTerminalRezultat({ napaka: err.error ?? "Viva Terminal napaka" });
        return false;
      }
      const { sessionId } = await res.json() as { sessionId: string };

      for (let i = 0; i < 90; i++) {
        await new Promise<void>(r => setTimeout(r, 2000));
        const statusRes = await fetch(`${base}/api/terminal/viva/terminal/status/${encodeURIComponent(sessionId)}`);
        const statusData = await statusRes.json() as { status: string; napaka?: string | null };
        if (statusData.status === "PAID") {
          setLastVivaTerminalSessionId(sessionId);
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

  const sendToViva = async (narociloId: number, znesek: number): Promise<boolean> => {
    setTerminalStanje("cakanje");
    setTerminalRezultat(null);
    setVivaCheckoutUrl(null);
    try {
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/terminal/viva/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ narociloId, znesek }),
      });
      if (!res.ok) {
        const err = await res.json() as { error?: string };
        setTerminalStanje("napaka");
        setTerminalRezultat({ napaka: err.error ?? "Viva Wallet napaka" });
        return false;
      }
      const { orderCode, checkoutUrl } = await res.json() as { orderCode: string; checkoutUrl: string };
      setVivaCheckoutUrl(checkoutUrl);

      for (let i = 0; i < 90; i++) {
        await new Promise<void>(r => setTimeout(r, 2000));
        const statusRes = await fetch(`${base}/api/terminal/viva/status/${encodeURIComponent(orderCode)}`);
        const statusData = await statusRes.json() as { status: string; napaka?: string | null };
        if (statusData.status === "PAID") {
          setTerminalStanje("odobren");
          return true;
        } else if (statusData.status === "FAILED") {
          setTerminalStanje("napaka");
          setTerminalRezultat({ napaka: statusData.napaka ?? "Viva Wallet plačilo neuspešno" });
          return false;
        }
      }

      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: "Čas za Viva Wallet plačilo je potekel (3 min)" });
      return false;
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
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const res = await fetch(`${base}/api/terminal/pay`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ narociloId, znesek }),
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

  const izracunajZneske = () => {
    const zneski: {
      znesekGotovina?: number | null;
      znesekKartica?: number | null;
      znesekBon?: number | null;
      steviloBonov?: number | null;
      znesekBonPica?: number | null;
      izdaniKuponi?: number | null;
      znesekNegotovinsko?: number | null;
    } = {
      znesekGotovina: null,
      znesekKartica: null,
      znesekBon: null,
      steviloBonov: steviloBonovDejanski > 0 ? steviloBonovDejanski : null,
      znesekBonPica: steviloBonovDejanski > 0 ? znesekBonov : null,
      izdaniKuponi: skupnoStevicoPic > 0 ? skupnoStevicoPic - steviloBonovDejanski : null,
      znesekNegotovinsko: null,
    };
    if (vsePlacanoZBoni) return zneski;
    if (placilniNacin === "bon") {
      if (znesekDarilnegaBonaDejanski > 0) zneski.znesekBon = znesekDarilnegaBonaDejanski;
      if (!vsePlacanoZDarilnimBonom && znesekPoKritiZDarilnimBonom > 0.005) {
        if (sekundarniNacin === "gotovina") zneski.znesekGotovina = znesekPoKritiZDarilnimBonom;
        else zneski.znesekKartica = znesekPoKritiZDarilnimBonom;
      }
    } else if (placilniNacin === "gotovina") {
      zneski.znesekGotovina = znesekPreostalega;
    } else if (placilniNacin === "kartica") {
      zneski.znesekKartica = znesekPreostalega;
    } else if (placilniNacin === "negotovinsko") {
      zneski.znesekNegotovinsko = znesekPreostalega;
    } else if (placilniNacin === "reprezentanca") {
      zneski.znesekNegotovinsko = znesekPreostalega;
    } else if (placilniNacin === "lastna_poraba") {
      zneski.znesekNegotovinsko = znesekPreostalega;
    }
    return zneski;
  };

  const issueRacun = (bypassOpts?: { preskociDDVPreverjanje: boolean; skrbnisPIN: string }) => {
    if (!selectedNarocilo) return;
    const natakariId = selectedNatakarId !== "none" ? parseInt(selectedNatakarId) : null;
    const dejanskiNacin: RacunInputPlacilnaNacin = vsePlacanoZBoni ? "bon_pica" : placilniNacin;
    const zneski = izracunajZneske();
    const postavkeIds = splitMode ? [...splitPostavkeIds] : undefined;
    const kupecPolja = (kupecDavcna || kupecNaziv) ? {
      kupecDavcnaStevilka: /^\d{8}$/.test(kupecDavcna.trim()) ? kupecDavcna.trim() : undefined,
      kupecNaziv: kupecNaziv ?? undefined,
      kupecNaslov: kupecNaslov ?? undefined,
      kupecZavezanecDdv: kupecZavezanecDdv || undefined,
      kupecId: kupecId ?? undefined,
    } : {};
    const sumupCheckoutPolje = lastSumupCheckoutId ? { sumupCheckoutId: lastSumupCheckoutId } : {};
    const vivaTerminalPolje = lastVivaTerminalSessionId ? { vivaTerminalSessionId: lastVivaTerminalSessionId } : {};
    const dniOdlogaPolje = dejanskiNacin === "negotovinsko" ? { dniOdloga } : {};
    createRacun.mutate(
      { data: { narociloId: selectedNarocilo, placilnaNacin: dejanskiNacin, fursNacin, natakariId, blagajnaId: activeBlagajnaId ?? null, ...zneski, ...bypassOpts, ...(postavkeIds ? { postavkeIds } : {}), ...kupecPolja, ...sumupCheckoutPolje, ...vivaTerminalPolje, ...dniOdlogaPolje } },
      {
        onSuccess: (racun) => {
          setDdvNapaka(null);
          setPinDialogOpen(false);
          setPinInput("");
          setPinNapaka(null);
          setFursNapaka(racun.fursNapaka ?? null);
          const jeDelni = racun.jeDelni ?? false;
          if (jeDelni && selectedNarocilo && splitMode && splitPostavkeIds.size > 0) {
            billedInfoRef.current = { narociloId: selectedNarocilo, postavkeIds: [...splitPostavkeIds] };
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
          });
          queryClient.invalidateQueries({ queryKey: getListAktivnaNarocilaQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListMizeQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListRacuniQueryKey() });
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
          const body = (err as { data?: { code?: string; error?: string } })?.data;
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
          toast({ title: "Napaka", description: "Ni bilo mogoče izdati računa.", variant: "destructive" });
        },
      }
    );
  };

  // Payten Android Software — same-device integration via Android Intent URL.
  // Payten APK (package configurable) mora biti namesčen na isti Android napravi.
  // Callback: APK doda resultCode=0 (uspeh) ali resultCode!=0 (napaka) v callbackUrl.
  const handlePaytenAndroidPay = () => {
    if (!selectedNarocilo || !selectedOrder) return;
    const terminalZnesek = steviloBonovDejanski > 0 ? znesekPreostalega : effectiveSkupaj;
    const amountCents = Math.round(terminalZnesek * 100);
    const merchantReference = crypto.randomUUID();
    const packageName = (nastavitve as { paytenAndroidPackageName?: string } | null)?.paytenAndroidPackageName ?? "com.payten.mpos";

    // Shrani narociloId za obnovitev po povratku
    sessionStorage.setItem("paytenAndroid_narociloId", String(selectedNarocilo));

    // Callback URL: vrne se na blagajno s predizbranim naročilom
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const callbackUrl = `${window.location.origin}${base}/blagajna?narocilo=${selectedNarocilo}&paytenAndroid=1`;

    const intentParams = new URLSearchParams({
      amount: String(amountCents),
      currency: "978",
      merchantReference,
      callbackUrl,
    });
    const fallbackUrl = encodeURIComponent("https://www.payten.com/");
    const intentUrl = `intent://payment?${intentParams.toString()}#Intent;scheme=payten;package=${packageName};S.browser_fallback_url=${fallbackUrl};end`;

    window.location.href = intentUrl;
  };

  // Zaznaj povratek iz Payten Android Software APK (ob prvem namestitvi komponente).
  // Payten APK doda v callbackUrl: resultCode=0 (uspeh) ali resultCode!=0 (napaka).
  useEffect(() => {
    const searchParams = new URLSearchParams(window.location.search);
    const storedId = sessionStorage.getItem("paytenAndroid_narociloId");
    sessionStorage.removeItem("paytenAndroid_narociloId");

    const rezultat = parsePaytenAndroidCallback(searchParams, storedId);
    if (rezultat.tip === "ni_callback") return;

    // Počisti callback parametre iz URL (ohrani ?narocilo= za auto-select)
    const newUrl = new URL(window.location.href);
    ["paytenAndroid", "resultCode", "transactionId", "merchantReference"].forEach(k => newUrl.searchParams.delete(k));
    window.history.replaceState(null, "", newUrl.toString());

    // Obnovi plačilni način — plačilo je bilo vedno kartično
    setPlacilniNacin("kartica");

    if (rezultat.tip === "uspeh") {
      // APK je potrdil plačilo — nastavi zastavico za samodejno izdajo računa
      paytenAndroidAutoIssueNarociloRef.current = rezultat.narociloId;
      setTerminalStanje("odobren");
    } else if (rezultat.tip === "napaka") {
      // APK je sporočil napako (nekoda 0)
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: rezultat.napakaSporocilo });
    } else {
      // brez_potrditve — APK ni vrnil resultCode (fail-safe)
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: "Payten Android: plačilo ni bilo potrjeno (ni rezultata). Preverite terminal in poskusite znova." });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ko je narocilo naloženo po povratku iz Payten Android Software, samodejno izda račun
  useEffect(() => {
    const pendingId = paytenAndroidAutoIssueNarociloRef.current;
    if (!pendingId) return;
    if (selectedNarocilo !== pendingId) return;
    if (!selectedOrder) return;
    if (placilniNacin !== "kartica") return;

    paytenAndroidAutoIssueNarociloRef.current = null;
    issueRacun();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNarocilo, selectedOrder, placilniNacin]);

  // Viva Android Terminal — same-device integration via Android Intent URL.
  // Ref: https://developer.vivawallet.com/integration-reference/card-terminals-sdk/android-ecr-sdk/
  // The Viva.com Terminal APK (package: com.vivawallet.android.bankapp) must be installed on the same device.
  // URI scheme: vivapayclient | Amount in cents | Callback URL receives ?statusCode=0 on success.
  const handleVivaAndroidPay = () => {
    if (!selectedNarocilo || !selectedOrder) return;
    const terminalZnesek = steviloBonovDejanski > 0 ? znesekPreostalega : effectiveSkupaj;
    const amountCents = Math.round(terminalZnesek * 100);
    const clientTransactionId = crypto.randomUUID();
    const sourceCode = (nastavitve as { vivaAndroidSourceCode?: string } | null)?.vivaAndroidSourceCode ?? "";

    // Store narociloId so we can restore it on callback return
    sessionStorage.setItem("vivaAndroid_narociloId", String(selectedNarocilo));

    // Callback URL: returns to this checkout page with narocilo pre-selected
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const callbackUrl = `${window.location.origin}${base}/blagajna?narocilo=${selectedNarocilo}&vivaAndroid=1`;

    const intentParams = new URLSearchParams({
      amount: String(amountCents),
      clientTransactionId,
      callbackUrl,
      ...(sourceCode ? { sourceCode } : {}),
    });
    const fallbackUrl = encodeURIComponent("https://www.vivawallet.com/");
    const intentUrl = `intent://pay?${intentParams.toString()}#Intent;scheme=vivapayclient;package=com.vivawallet.android.bankapp;S.browser_fallback_url=${fallbackUrl};end`;

    window.location.href = intentUrl;
  };

  // Viva Tap to Pay on Android — SoftPOS prek Android Intent URL.
  // Ref: https://developer.vivawallet.com/integration-reference/card-terminals-sdk/android-ecr-sdk/
  // Viva Terminal APK mora biti namesčen na isti napravi in podpirati SoftPOS (taptopay) način.
  const handleVivaTapToPayPay = () => {
    if (!selectedNarocilo || !selectedOrder) return;
    const terminalZnesek = steviloBonovDejanski > 0 ? znesekPreostalega : effectiveSkupaj;
    const amountCents = Math.round(terminalZnesek * 100);
    const clientTransactionId = crypto.randomUUID();
    const sourceCode = (nastavitve as { vivaTapToPaySourceCode?: string } | null)?.vivaTapToPaySourceCode ?? "";

    // Shrani narociloId za obnovitev po povratku
    sessionStorage.setItem("vivaTapToPay_narociloId", String(selectedNarocilo));

    // Callback URL: vrne se na blagajno s predizbranim naročilom
    const base = import.meta.env.BASE_URL.replace(/\/$/, "");
    const callbackUrl = `${window.location.origin}${base}/blagajna?narocilo=${selectedNarocilo}&vivaTapToPay=1`;

    const intentParams = new URLSearchParams({
      amount: String(amountCents),
      clientTransactionId,
      callbackUrl,
      ...(sourceCode ? { sourceCode } : {}),
    });
    const fallbackUrl = encodeURIComponent("https://www.vivawallet.com/");
    const intentUrl = `intent://taptopay?${intentParams.toString()}#Intent;scheme=vivapayclient;package=com.vivawallet.android.bankapp;S.browser_fallback_url=${fallbackUrl};end`;

    window.location.href = intentUrl;
  };

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
    sessionStorage.removeItem("vivaAndroid_narociloId");
    if (!storedId) return;
    const narId = parseInt(storedId);
    if (isNaN(narId)) return;

    // Obnovi plačilni način — plačilo je bilo vedno kartično
    setPlacilniNacin("kartica");

    const vivaResult = params.get("vivaResult");
    if (vivaResult === "ok") {
      // APK je potrdil plačilo — nastavi zastavico za samodejno izdajo računa
      vivaAndroidAutoIssueNarociloRef.current = narId;
      setTerminalStanje("odobren");
    } else if (vivaResult === "fail") {
      // APK je sporočil napako
      const errorCode = params.get("errorCode") ?? "?";
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: `Viva Android Terminal: plačilo neuspešno (koda ${errorCode})` });
    } else {
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
    if (placilniNacin !== "kartica") return;

    vivaAndroidAutoIssueNarociloRef.current = null;
    issueRacun();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNarocilo, selectedOrder, placilniNacin]);

  // Zaznaj povratek iz Viva Tap to Pay (SoftPOS) ob prvem namestitvi komponente.
  // Viva APK doda v callbackUrl: vivaResult=ok|fail, transactionId, clientTransactionId, errorCode.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("vivaTapToPay") !== "1") return;

    // Počisti callback parametre iz URL (ohrani ?narocilo= za auto-select)
    const newUrl = new URL(window.location.href);
    ["vivaTapToPay", "vivaResult", "transactionId", "clientTransactionId", "errorCode"].forEach(k => newUrl.searchParams.delete(k));
    window.history.replaceState(null, "", newUrl.toString());

    const storedId = sessionStorage.getItem("vivaTapToPay_narociloId");
    sessionStorage.removeItem("vivaTapToPay_narociloId");
    if (!storedId) return;
    const narId = parseInt(storedId);
    if (isNaN(narId)) return;

    // Obnovi plačilni način — plačilo je bilo vedno kartično
    setPlacilniNacin("kartica");

    const vivaResult = params.get("vivaResult");
    if (vivaResult === "ok") {
      // APK je potrdil plačilo — nastavi zastavico za samodejno izdajo računa
      vivaTapToPayAutoIssueNarociloRef.current = narId;
      setTerminalStanje("odobren");
    } else if (vivaResult === "fail") {
      // APK je sporočil napako
      const errorCode = params.get("errorCode") ?? "?";
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: `Viva Tap to Pay: plačilo neuspešno (koda ${errorCode})` });
    } else {
      // APK ni vrnil vivaResult — fail-safe: ne izdajamo računa brez potrditve
      setTerminalStanje("napaka");
      setTerminalRezultat({ napaka: "Viva Tap to Pay: plačilo ni bilo potrjeno (ni rezultata). Preverite terminal in poskusite znova." });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ko je narocilo naloženo po povratku iz Viva Tap to Pay, samodejno izda račun
  useEffect(() => {
    const pendingId = vivaTapToPayAutoIssueNarociloRef.current;
    if (!pendingId) return;
    if (selectedNarocilo !== pendingId) return;
    if (!selectedOrder) return;
    if (placilniNacin !== "kartica") return;

    vivaTapToPayAutoIssueNarociloRef.current = null;
    vivaTapToPayIssueRef.current = true;
    issueRacun();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNarocilo, selectedOrder, placilniNacin]);

  const handleIzdajRacun = async () => {
    if (!selectedNarocilo || !selectedOrder) return;

    if (showTerminalFlow) {
      const terminalZnesek = steviloBonovDejanski > 0 ? znesekPreostalega : effectiveSkupaj;
      const odobren = await sendToTerminal(selectedNarocilo, terminalZnesek);
      if (!odobren) return;
    } else if (showPaytenAndroidFlow) {
      // Payten Android Intent — navigira stran; račun se izda po povratku prek callback URL
      handlePaytenAndroidPay();
      return;
    } else if (showSumupFlow) {
      const terminalZnesek = steviloBonovDejanski > 0 ? znesekPreostalega : effectiveSkupaj;
      const odobren = await sendToSumup(selectedNarocilo, terminalZnesek);
      if (!odobren) return;
    } else if (showVivaTerminalFlow) {
      const terminalZnesek = steviloBonovDejanski > 0 ? znesekPreostalega : effectiveSkupaj;
      const odobren = await sendToVivaTerminal(selectedNarocilo, terminalZnesek);
      if (!odobren) return;
    } else if (showVivaAndroidTerminalFlow) {
      // Android Intent — navigira stran; račun se izda po povratku prek callback URL
      handleVivaAndroidPay();
      return;
    } else if (showVivaTapToPayFlow) {
      // Tap to Pay Android Intent — navigira stran; račun se izda po povratku prek callback URL
      handleVivaTapToPayPay();
      return;
    } else if (showVivaFlow) {
      const terminalZnesek = steviloBonovDejanski > 0 ? znesekPreostalega : effectiveSkupaj;
      const odobren = await sendToViva(selectedNarocilo, terminalZnesek);
      if (!odobren) return;
    }

    issueRacun();
  };

  const handleRetryTerminal = async () => {
    if (!selectedNarocilo || !selectedOrder) return;
    const terminalZnesek = steviloBonovDejanski > 0 ? znesekPreostalega : effectiveSkupaj;
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
  };

  const handleNewRacun = () => {
    setIssuedRacun(null);
    setTerminalStanje("idle");
    setTerminalRezultat(null);
    setVivaCheckoutUrl(null);
    setSumupQrCheckoutId(null);
    setSumupQrZnesek(null);
    setLastSumupCheckoutId(null);
    setLastVivaTerminalSessionId(null);
    setFursNapaka(null);
    setSplitMode(false);
    setSplitPostavkeIds(new Set());
    const preostalaOdprta = odprta.filter(n => n.id !== selectedNarocilo);
    setSelectedNarocilo(null);
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
    setLastVivaTerminalSessionId(null);
    setFursNapaka(null);
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
    const order = allNarocila?.find(n => n.id === narociloId);
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
    if (!selectedNarocilo || združiIzbrana.size === 0) return;
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
    if (!selectedNarocilo) return;
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

  if (isLoading) return (
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
              {issuedRacun.zoi && (
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
            <PrintReceiptButton
              racunId={issuedRacun.id}
              stevilkaRacuna={issuedRacun.stevilkaRacuna}
              variant="default"
              size="lg"
              className="w-full"
              onAfterPrint={issuedRacun.jeDelni ? handleIzdajPreostanek : handleNewRacun}
            />
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
                {(steviloBonovDejanski > 0 ? znesekPreostalega : displaySkupaj).toFixed(2)} €
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
    return (
      <div className="p-8 flex items-center justify-center flex-1">
        <Card className="w-full max-w-sm text-center">
          <CardContent className="pt-10 pb-8 space-y-4">
            <Loader2 className="h-14 w-14 mx-auto animate-spin text-primary" />
            <p className="text-xl font-semibold">Čakam na terminal...</p>
            <p className="text-muted-foreground text-sm">
              Stranka naj vstavi ali prisloni kartico na terminal.
            </p>
            <p className="font-bold text-2xl text-primary">{selectedOrder?.skupaj.toFixed(2)} €</p>
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
            <Button className="w-full" onClick={handleRetryTerminal} data-testid="button-retry-terminal">
              Poskusi znova
            </Button>
            <Button variant="outline" className="w-full" onClick={() => {
              setTerminalStanje("idle");
              setTerminalRezultat(null);
              setPlacilniNacin("gotovina");
            }} data-testid="button-change-payment">
              Zamenjaj način plačila
            </Button>
          </CardFooter>
        </Card>
      </div>
    );
  }

  // ── Main checkout form ─────────────────────────────────────
  return (
    <div className="flex-1 overflow-auto bg-muted/10">
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
              disabled={createRacun.isPending}
              className="bg-amber-600 hover:bg-amber-700"
              data-testid="button-potrdi-izredni-pin"
            >
              {createRacun.isPending ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldAlert className="h-4 w-4 mr-2" />}
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
                      Naročilo #{n.id} — {Number(n.skupaj).toFixed(2)} €
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

      {/* ── Dialog: Izpis prometa ──────────────────────────── */}
      <Dialog open={izpisPrometaOpen} onOpenChange={(o) => { setIzpisPrometaOpen(o); if (!o) { setIzpisData(null); setIzpisNapaka(null); } }}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5 text-blue-600" />
              Izpis prometa
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Od</Label>
                <Input type="date" value={izpisOd} onChange={e => { setIzpisOd(e.target.value); setIzpisData(null); }} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs text-muted-foreground">Do</Label>
                <Input type="date" value={izpisDo} onChange={e => { setIzpisDo(e.target.value); setIzpisData(null); }} />
              </div>
            </div>
            <Button className="w-full" onClick={handleIzpisPromet} disabled={izpisLoading}>
              {izpisLoading ? <><Loader2 className="h-4 w-4 mr-2 animate-spin" />Nalagam...</> : "Prikaži promet"}
            </Button>
            {izpisNapaka && <p className="text-sm text-destructive">{izpisNapaka}</p>}
            {izpisData && (
              <div className="space-y-4">
                {/* Podatki podjetja */}
                {izpisData.podjetje.naziv && (
                  <div className="text-center text-sm">
                    <p className="font-semibold">{izpisData.podjetje.naziv}</p>
                    {izpisData.podjetje.naslov && <p className="text-muted-foreground text-xs">{izpisData.podjetje.naslov}</p>}
                    {izpisData.podjetje.davcnaStevilka && <p className="text-muted-foreground text-xs">ID za DDV: {izpisData.podjetje.davcnaStevilka}</p>}
                  </div>
                )}

                {/* Način plačila */}
                <div>
                  <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1">Način plačila</p>
                  <div className="rounded-md border divide-y text-sm">
                    <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Gotovina</span><span className="font-medium">{izpisData.prometPoNacinuPlacila.gotovina.toFixed(2)} €</span></div>
                    <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Kartica</span><span className="font-medium">{izpisData.prometPoNacinuPlacila.kartica.toFixed(2)} €</span></div>
                    {izpisData.prometPoNacinuPlacila.sumup > 0 && <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">SumUp</span><span className="font-medium">{izpisData.prometPoNacinuPlacila.sumup.toFixed(2)} €</span></div>}
                    <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Bon</span><span className="font-medium">{izpisData.prometPoNacinuPlacila.bon.toFixed(2)} €</span></div>
                    {izpisData.prometPoNacinuPlacila.bonPica > 0 && <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Bon za pico ({izpisData.prometPoNacinuPlacila.steviloBonov}×)</span><span className="font-medium">{izpisData.prometPoNacinuPlacila.bonPica.toFixed(2)} €</span></div>}
                    {izpisData.prometPoNacinuPlacila.negotovinsko > 0 && <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">TRR</span><span className="font-medium">{izpisData.prometPoNacinuPlacila.negotovinsko.toFixed(2)} €</span></div>}
                    {izpisData.prometPoNacinuPlacila.reprezentanca > 0 && <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Reprezentanca</span><span className="font-medium">{izpisData.prometPoNacinuPlacila.reprezentanca.toFixed(2)} €</span></div>}
                    {izpisData.prometPoNacinuPlacila.lastna_poraba > 0 && <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Lastna poraba</span><span className="font-medium">{izpisData.prometPoNacinuPlacila.lastna_poraba.toFixed(2)} €</span></div>}
                    <div className="flex justify-between px-3 py-1.5 bg-muted/40 font-semibold"><span>Skupaj</span><span>{izpisData.skupajPromet.toFixed(2)} €</span></div>
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
                      <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Storitve</span><span className="font-medium">{izpisData.prihodkiPoVrsti.storitve.toFixed(2)} €</span></div>
                      <div className="flex justify-between px-3 py-1.5"><span className="text-muted-foreground">Blago (to go)</span><span className="font-medium">{izpisData.prihodkiPoVrsti.blago.toFixed(2)} €</span></div>
                      <div className="flex justify-between px-3 py-1.5 bg-muted/40 font-semibold"><span>Skupaj neto</span><span>{(izpisData.prihodkiPoVrsti.storitve + izpisData.prihodkiPoVrsti.blago).toFixed(2)} €</span></div>
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

      <div className="grid grid-cols-1 md:grid-cols-2">
        {/* Left: open orders */}
        <div className="flex flex-col md:border-r">
          {nastavitve?.nazivRestavracije && (
            <div className="flex items-center justify-center px-4 py-1.5 bg-background/80 backdrop-blur-sm border-b border-border/40">
              <Link href="/nastavitve" className="text-xs font-medium text-muted-foreground/70 tracking-wide truncate hover:text-foreground hover:underline transition-colors">
                {nastavitve.nazivRestavracije}
              </Link>
            </div>
          )}
          <div className="p-8 space-y-4">
          <h1 className="text-3xl font-bold tracking-tight">Blagajna</h1>
          <h2 className="text-xl font-semibold">Odprta naročila</h2>
          {odprta.length === 0 ? (
            <Card>
              <CardContent className="p-8 text-center text-muted-foreground">
                Ni odprtih naročil za izdajo računa.
              </CardContent>
            </Card>
          ) : (
            odprta.map(narocilo => (
              <Card
                key={narocilo.id}
                className={`cursor-pointer transition-all hover:border-primary ${
                  selectedNarocilo === narocilo.id ? "border-primary ring-2 ring-primary border-2" : ""
                }`}
                onClick={() => { setSelectedNarocilo(narocilo.id); setDdvNapaka(null); }}
                data-testid={`card-narocilo-${narocilo.id}`}
              >
                <CardHeader className="pb-2">
                  <div className="flex justify-between">
                    <CardTitle>{narocilo.mizaIme ?? (narocilo.mizaStevilka != null ? `Miza ${narocilo.mizaStevilka}` : "Direktna prodaja")}</CardTitle>
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
                    onClick={e => { e.stopPropagation(); setLocation(narocilo.id === selectedNarocilo && aktivniGost !== null ? `/narocilo/${narocilo.id}?gost=${aktivniGost}` : `/narocilo/${narocilo.id}`); }}
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
        <div className="p-8 space-y-2">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold">Zaključek računa</h2>
            <Button variant="outline" size="sm" onClick={() => setIzpisPrometaOpen(true)}>
              <FileText className="h-4 w-4 mr-2" />
              Izpis prometa
            </Button>
          </div>
          <Card className="sticky top-0">
            <CardContent className="pt-4 space-y-3">
              {selectedOrder ? (
                <>
                  {/* Banner: druga odprta naročila na isti mizi */}
                  {drugaNarocilaIsteMize.length > 0 && (
                    <Alert className="border-amber-400 bg-amber-50 text-amber-900" data-testid="alert-druga-narocila-mize">
                      <GitMerge className="h-4 w-4 text-amber-600" />
                      <AlertTitle className="text-amber-900 font-semibold">
                        {selectedOrder.mizaIme ?? selectedOrder.mizaStevilka != null
                          ? <>Na mizi <strong>{selectedOrder.mizaIme ?? `Miza ${selectedOrder.mizaStevilka}`}</strong> je še {steviloNarocilaLabel(drugaNarocilaIsteMize.length)}</>
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
                                    {n.mizaIme ?? (n.mizaStevilka != null ? `Miza ${n.mizaStevilka}` : "Direktna prodaja")} — naročilo #{n.id}
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
                                  disabled={spojiMutation.isPending}
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
                                  onClick={() => { setSelectedNarocilo(n.id); setDdvNapaka(null); }}
                                  data-testid={`button-odpri-narocilo-${n.id}`}
                                >
                                  Odpri naročilo #{n.id}
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
                            disabled={spojiMutation.isPending}
                            data-testid="button-združi-vsa-narocila"
                          >
                            <GitMerge className="h-3.5 w-3.5 mr-1.5" />
                            Združi naročila te mize
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="border-amber-500 text-amber-900 hover:bg-amber-100"
                            onClick={() => setLocation(aktivniGost !== null ? `/narocilo/${selectedNarocilo}?gost=${aktivniGost}` : `/narocilo/${selectedNarocilo}`)}
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
                    {aktivniOperaterji.length === 0 ? (
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
                      </>
                    )}
                  </div>

                  <Separator />

                  <div className="rounded-lg bg-muted/50 p-2 space-y-0.5">
                    <div className="flex justify-between text-sm font-medium">
                      <span>{selectedOrder.mizaIme ?? (selectedOrder.mizaStevilka != null ? `Miza ${selectedOrder.mizaStevilka}` : "Direktna prodaja")}</span>
                      <span className="text-primary font-bold">
                        {splitMode
                          ? <>{displaySkupaj.toFixed(2)} € <span className="text-xs font-normal text-muted-foreground">/ {displayNezaracunaneSkupaj.toFixed(2)} €</span></>
                          : <>{displayNezaracunaneSkupaj.toFixed(2)} €</>
                        }
                      </span>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {splitMode
                        ? `${splitPostavkeIds.size} / ${uncoveredPostavke.filter(p => p.parentPostavkaId == null).length} izbranih`
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
                            const otroci = uncoveredPostavke.filter(c => c.parentPostavkaId === p.id);
                            return (
                            <label key={p.id} className="flex items-center gap-3 cursor-pointer rounded-md p-1.5 hover:bg-muted/50">
                              <Checkbox
                                id={`split-p-${p.id}`}
                                checked={splitPostavkeIds.has(p.id)}
                                onCheckedChange={(checked) => {
                                  setSplitPostavkeIds(prev => {
                                    const next = new Set(prev);
                                    if (checked) { next.add(p.id); otroci.forEach(c => next.add(c.id)); }
                                    else { next.delete(p.id); otroci.forEach(c => next.delete(c.id)); }
                                    return next;
                                  });
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
                                const customCena = (cenikMap && (p as typeof p & { artikelId?: number | null }).artikelId != null)
                                  ? cenikMap.get((p as typeof p & { artikelId?: number | null }).artikelId!)
                                  : undefined;
                                const displayCena = jeBrezplacno ? 0 : (customCena !== undefined ? round2(customCena * Number(p.kolicina)) : Number(p.skupaj));
                                const originalCena = customCena !== undefined ? round2(customCena * Number(p.kolicina)) : Number(p.skupaj);
                                return (
                                  <span className="text-sm font-mono text-muted-foreground shrink-0">
                                    {displayCena.toFixed(2)} €
                                    {jeBrezplacno && (
                                      <span className="ml-1 line-through text-xs opacity-50">{originalCena.toFixed(2)}</span>
                                    )}
                                    {!jeBrezplacno && customCena !== undefined && Number(p.skupaj) !== displayCena && (
                                      <span className="ml-1 line-through text-xs opacity-50">{Number(p.skupaj).toFixed(2)}</span>
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
                          setTerminalStanje("idle");
                          if (v !== "bon") setZnesekDarilnegaBona(0);
                        }}
                        className={`grid gap-3 ${kupecNaziv || kupecDavcna ? "grid-cols-3" : "grid-cols-3"} sm:${kupecNaziv || kupecDavcna ? "grid-cols-6" : "grid-cols-5"}`}
                      >
                        {[
                          { value: "gotovina",     label: "Gotovina",       Icon: Banknote },
                          { value: "kartica",      label: "Kartica",        Icon: CreditCard },
                          { value: "bon",          label: "Bon",            Icon: Gift },
                          ...(kupecNaziv || kupecDavcna ? [{ value: "negotovinsko", label: "TRR", Icon: Landmark }] : []),
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
                          <div className="flex items-center gap-3">
                            <span className="text-sm text-muted-foreground flex-1">Znesek darilnega bona</span>
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
                          </div>

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
                                      { value: "kartica" as const,  label: "Kartica",  Icon: CreditCard },
                                    ].map(({ value, label, Icon }) => (
                                      <button
                                        key={value}
                                        type="button"
                                        onClick={() => setSekundarniNacin(value)}
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

                  {/* Terminal info banner when kartica is selected */}
                  {!vsePlacanoZBoni && placilniNacin === "kartica" && (
                    <div className={`rounded-lg border p-3 text-sm flex items-start gap-3 ${
                      terminalAktiven || paytenAndroidAktiven || sumupAktiven || vivaTerminalAktiven || vivaAndroidTerminalAktiven || vivaTapToPayAktiven || vivaAktiven
                        ? "bg-blue-50 border-blue-200 text-blue-800"
                        : "bg-muted border-muted-foreground/20 text-muted-foreground"
                    }`}>
                      {terminalAktiven ? (
                        <>
                          <Monitor className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>
                            Plačilo bo posredovano na <strong>Payten terminal</strong>.
                            Stranka naj pripravi kartico.
                          </span>
                        </>
                      ) : paytenAndroidAktiven ? (
                        <>
                          <CreditCard className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>
                            Plačilo bo opravljeno prek <strong>Payten Android Software</strong> na tej napravi.
                            Odpre se aplikacija Payten POS; po plačilu se vrnete sem.
                          </span>
                        </>
                      ) : sumupAktiven ? (
                        <>
                          <CreditCard className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>
                            Plačilo bo poslano prek <strong>SumUp</strong>.
                            Stranka naj pripravi kartico ali mobilni telefon.
                          </span>
                        </>
                      ) : vivaTerminalAktiven ? (
                        <>
                          <CreditCard className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>
                            Plačilo bo poslano na <strong>Viva Cloud Terminal</strong>.
                            Stranka naj pripravi kartico.
                          </span>
                        </>
                      ) : vivaAndroidTerminalAktiven ? (
                        <>
                          <CreditCard className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>
                            Plačilo bo opravljeno prek <strong>Viva Terminal APK</strong> na tej napravi.
                            Odpre se aplikacija Viva terminal; po plačilu se vrnete sem.
                          </span>
                        </>
                      ) : vivaTapToPayAktiven ? (
                        <>
                          <CreditCard className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>
                            Plačilo bo opravljeno prek <strong>Viva Tap to Pay</strong> (SoftPOS) na tej napravi.
                            Prinesite kartico stranke k telefonu/tablici; po plačilu se vrnete sem.
                          </span>
                        </>
                      ) : vivaAktiven ? (
                        <>
                          <CreditCard className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>
                            Plačilo bo opravljeno prek <strong>Viva Wallet</strong>.
                            Stranka skenira QR kodo s telefonom.
                          </span>
                        </>
                      ) : (
                        <>
                          <Monitor className="h-4 w-4 mt-0.5 shrink-0" />
                          <span>
                            POS terminal ni aktiviran. Omogočite Payten, SumUp ali Viva Wallet v <strong>Nastavitvah</strong>.
                          </span>
                        </>
                      )}
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
                <div className="py-8 text-center text-muted-foreground">
                  Izberite naročilo za izdajo računa
                </div>
              )}
            </CardContent>
            <CardFooter>
              <Button
                className="w-full h-14 text-lg"
                size="lg"
                disabled={!selectedNarocilo || createRacun.isPending || aktivniOperaterji.length === 0 || (aktivniOperaterji.length > 0 && selectedNatakarId === "none") || imaNeskladjePostavk || (splitMode && splitPostavkeIds.size === 0)}
                onClick={handleIzdajRacun}
                data-testid="button-izdaj-racun"
              >
                {showTerminalFlow ? (
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
