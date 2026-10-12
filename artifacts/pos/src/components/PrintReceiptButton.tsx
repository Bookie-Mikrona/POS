import { useState, useEffect, useRef } from "react";
import { useNaprava } from "@/contexts/NapravaContext";
import { Printer, Usb, Monitor, Bluetooth, BluetoothOff, Wifi, WifiOff, X, ChevronDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  getPrinterState,
  tryAutoConnectSerial,
  tryAutoConnectBluetooth,
  connectSerialPrinter,
  disconnectSerialPrinter,
  connectBluetoothPrinter,
  disconnectBluetoothPrinter,
  fetchReceiptBytes,
  printRaw,
  printRawViaBluetooth,
  printReceiptViaBrowser,
  printReceiptViaNetwork,
  setNetworkPrinterUrl,
  clearNetworkPrinterUrl,
  BT_CONNECTION_EVENT,
} from "@/lib/printer";
import { isSunmiPrinterAvailable, printViaSunmi } from "@/lib/sunmiPrinter";
import { isZcsBridgeAvailable, waitForZcsBridge, printZcsReceipt, getZcsBridgeStatus, getZcsDiagnostics, getZcsBridgeCached, getZcsBridgeType, isBtBridge } from "@/lib/zcsAndroidPrinter";
import { isNb80BridgeAvailable, waitForNb80Bridge, printNb80Receipt, getNb80BridgeCached, getNb80Diagnostics } from "@/lib/nb80AndroidPrinter";

interface PrintReceiptButtonProps {
  racunId: number;
  stevilkaRacuna?: string;
  variant?: "default" | "outline" | "ghost";
  size?: "default" | "sm" | "lg" | "icon";
  className?: string;
  disabled?: boolean;
  /** Če true, se v HTML/ESC-POS računu doda ?zbirni=1 — za tiskanje iz arhiva računov */
  zbirni?: boolean;
  /** Called (and awaited) before any print action — use for pre-print mutations */
  onBeforePrint?: () => Promise<void>;
  onAfterPrint?: () => void;
  /** Automatically print once after mount, without requiring a second click. */
  autoPrint?: boolean;
}

export function PrintReceiptButton({
  racunId,
  stevilkaRacuna,
  variant = "outline",
  size = "default",
  className,
  disabled: externalDisabled,
  zbirni,
  onBeforePrint,
  onAfterPrint,
  autoPrint = false,
}: PrintReceiptButtonProps) {
  const { toast } = useToast();
  const { naprava } = useNaprava();
  const jeWindows = navigator.userAgent.includes("Windows");
  const agentTiskalnikIme = naprava?.terminalConfig?.agentTiskalnikIme ?? "";
  // 32 stolpcev je nedvoumna konfiguracija BT tiskalnika širine 58 mm
  // (npr. PT210). Takšna naprava ne sme biti preusmerjena na NB80 most,
  // tudi če je njegov HTTP endpoint še vedno dosegljiv ali ima star cache.
  const jeKonfiguriranBt58 =
    naprava?.terminalConfig?.tiskalnikSirina === 32 ||
    naprava?.terminalConfig?.tiskalnikSirina === 58;
  const [printing, setPrinting] = useState(false);
  const [connectSerialDialogOpen, setConnectSerialDialogOpen] = useState(false);
  const [connectBtDialogOpen, setConnectBtDialogOpen] = useState(false);
  const [networkDialogOpen, setNetworkDialogOpen] = useState(false);
  const [networkInput, setNetworkInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [, forceUpdate] = useState(0);
  const autoPrintStartedRef = useRef(false);

  // ZCS Android most — inicializiraj iz module-level cache takoj (brez čakanja)
  const [zcsBridgeAvailable, setZcsBridgeAvailable] = useState(() => getZcsBridgeCached() === true);
  const [zcsChecking, setZcsChecking] = useState(false);

  // NB80 Android most — inicializiraj iz module-level cache takoj (brez čakanja)
  const [nb80BridgeAvailable, setNb80BridgeAvailable] = useState(() => getNb80BridgeCached() === true);
  const [nb80Checking, setNb80Checking] = useState(false);

  useEffect(() => {
    let cancelled = false;

    // USB Serial — tiha vzpostavitev
    tryAutoConnectSerial().then(connected => {
      if (connected && !cancelled) forceUpdate(n => n + 1);
    });

    // BT — tihi reconnect po osvežitvi strani (brez chooserja).
    // Pogoj: Chrome ≥85 + navigator.bluetooth.getDevices + shranjeni device.id.
    // Ob uspehu: BT_CONNECTION_EVENT → forceUpdate → UI pokaže "tiskalnik povezan".
    tryAutoConnectBluetooth().then(ok => {
      if (ok && !cancelled) forceUpdate(n => n + 1);
    });

    // BT status listener — zagotovi da UI odraža dejansko stanje ob vsakem
    // spremembi (samodejni reconnect v ozadju, nenamerna prekinitev).
    const onBtChange = () => {
      if (!cancelled) forceUpdate(n => n + 1);
    };
    window.addEventListener(BT_CONNECTION_EVENT, onBtChange);

    // ZCS — preveri takoj če cache ni svež
    const cachedZcs = getZcsBridgeCached();
    if (cachedZcs === null) {
      isZcsBridgeAvailable().then(ok => {
        if (!cancelled) setZcsBridgeAvailable(ok);
      });
    }

    // NB80 — pri konfiguriranem BT 58 mm ga ne preverjamo.
    // Dosegljiv, vendar neuporaben NB80 endpoint sicer lahko prevzame
    // prednost pred dejanskim BT tiskalnikom.
    if (jeKonfiguriranBt58) {
      setNb80BridgeAvailable(false);
    } else {
      const cachedNb80 = getNb80BridgeCached();
      if (cachedNb80 === null) {
        isNb80BridgeAvailable().then(ok => {
          if (!cancelled) setNb80BridgeAvailable(ok);
        });
      }
    }

    // Periodično preverjanje vsakih 6s — zazna APK ki se zažene po nalaganju
    const interval = setInterval(() => {
      if (cancelled) return;
      isZcsBridgeAvailable().then(ok => { if (!cancelled) setZcsBridgeAvailable(ok); });
      if (jeKonfiguriranBt58) {
        setNb80BridgeAvailable(false);
      } else {
        isNb80BridgeAvailable().then(ok => { if (!cancelled) setNb80BridgeAvailable(ok); });
      }
    }, 6000);

    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener(BT_CONNECTION_EVENT, onBtChange);
    };
  }, [jeKonfiguriranBt58]);

  async function handleZcsConnect() {
    setZcsChecking(true);
    try {
      // isZcsBridgeAvailable preverja samo HTTP dosegljivost (ne stanje tiskalnika)
      const dosegljiv = await isZcsBridgeAvailable();
      setZcsBridgeAvailable(dosegljiv);
      if (dosegljiv) {
        // Most je dosegljiv — poskusimo natisniti; tiskanje bo samo sporočilo
        // napako če tiskalnik še ni inicializiran
        await handleZcsPrint();
      } else {
        toast({
          title: "ZCS most ni dosegljiv",
          description: "APK ZcsPrinterBridge ne teče ali ne posluša na localhost:8090. Preverite, da je APK zagnan in prikazan v obvestilni vrstici.",
          variant: "destructive",
        });
      }
    } finally {
      setZcsChecking(false);
    }
  }

  async function handleZcsDiagnostika() {
    setZcsChecking(true);
    try {
      const d = await getZcsDiagnostics();
      if (!d) {
        toast({
          title: "ZCS most ni dosegljiv",
          description: "APK ne teče ali ni dosegljiv na localhost:8090.",
          variant: "destructive",
        });
        return;
      }
      const devInfo = d.writableDevFiles.length > 0
        ? `✓ Device datoteka: ${d.writableDevFiles[0]}`
        : d.devFiles.length > 0
          ? `⚠ /dev datoteke obstajajo, a niso pisljive: ${d.devFiles.join(", ")}`
          : "✗ Nobena /dev tiskalniška datoteka ni najdena";
      const pkgInfo = d.zcsPackages.length > 0
        ? `ZCS paketi: ${d.zcsPackages.join(", ")}`
        : "Ni ZCS paketov";
      const libInfo = d.sysLibs.length > 0
        ? `Sistemske ZCS lib: ${d.sysLibs.join(", ")}`
        : "Ni ZCS lib v /system/lib64";
      toast({
        title: d.bridgeReady ? "ZCS diagnostika — tiskalnik OK" : "ZCS diagnostika — tiskalnik ni inicializiran",
        description: [devInfo, pkgInfo, libInfo].join("\n"),
        variant: d.bridgeReady ? "default" : "destructive",
      });
    } finally {
      setZcsChecking(false);
    }
  }

  const printerState = getPrinterState();

  // ── NB80 diagnostika ─────────────────────────────────────────────────────
  async function handleNb80Diagnostika() {
    setNb80Checking(true);
    try {
      const d = await getNb80Diagnostics();
      if (!d) {
        toast({
          title: "NB80 most ni dosegljiv",
          description: "APK ne teče ali ni dosegljiv na localhost:8091.",
          variant: "destructive",
        });
        return;
      }
      const statusOpis = d.printerStatus === 0
        ? "✓ Tiskalnik je pripravljen"
        : d.printerStatus === -1
          ? "⚠ Stanje tiskalnika ni znano (Binder ni bil vzpostavljen)"
          : `✗ Napaka tiskalnika (koda ${d.printerStatus})`;
      const versionInfo = d.serviceVersion ? `Verzija SDK: ${d.serviceVersion}` : "Verzija SDK: ni znana";
      const modelInfo   = d.printerModel   ? `Model: ${d.printerModel}`         : "Model: ni znan";
      toast({
        title: d.binderReady
          ? (d.printerStatus === 0 ? "NB80 diagnostika — tiskalnik OK" : "NB80 diagnostika — opozorilo")
          : "NB80 diagnostika — PrinterService ni dosegljiv",
        description: [statusOpis, versionInfo, modelInfo].join("\n"),
        variant: d.binderReady && d.printerStatus === 0 ? "default" : "destructive",
      });
    } finally {
      setNb80Checking(false);
    }
  }

  // ── NB80 Android most ────────────────────────────────────────────────────
  async function handleNb80Print() {
    setPrinting(true);
    try {
      await onBeforePrint?.();
      const sirina = naprava?.terminalConfig?.tiskalnikSirina;
      const cols = sirina === 30 ? 30 : undefined; // NB80 na 58mm papirju
      const result = await printNb80Receipt(racunId, zbirni, cols);
      if (!result.ok) throw new Error(result.error);
      toast({ title: "Natisnjeno", description: `Račun ${stevilkaRacuna ?? racunId} poslan na NB80 tiskalnik.` });
      onAfterPrint?.();
    } catch (err) {
      toast({
        title: "Napaka pri NB80 tiskanju",
        description: err instanceof Error ? err.message : "Neznana napaka",
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  }

  async function handleNb80PrintZRetryjem() {
    if (nb80BridgeAvailable) return handleNb80Print();
    setPrinting(true);
    const mostDosegljiv = await waitForNb80Bridge(4, 1000).catch(() => false);
    setNb80BridgeAvailable(mostDosegljiv);
    setPrinting(false);
    if (!mostDosegljiv) {
      toast({
        title: "NB80 tiskalnik ni pripravljen",
        description: "Odprite originalni NB80 Tiskalni Most 1.5 in v diagnostiki preverite PrinterService.",
        variant: "destructive",
      });
      return;
    }
    return handleNb80Print();
  }

  // ── ZCS Android most ─────────────────────────────────────────────────────

  /**
   * Vrne true, če je naprava konfigurirana za tiskanje prek ZCS/NB80/BT mosta.
   * Te naprave ob nedosegljivem mostu NIKOLI ne smejo tiho pasti na BLE ESC/POS pot
   * (ki povzroči scrambled izpis). Namesto tega pokažemo retry in napako.
   */
  function jeZcsMostNaprava(sirina: number | null | undefined): boolean {
    // 58=ZCS Z92, 32=BT most 58mm, 80=NB80 ali BT most 80mm, 30=NB80 58mm
    return sirina === 58 || sirina === 32 || sirina === 80 || sirina === 30;
  }

  /**
   * Tisk z retry logiko za BT/ZCS most — prepreči tiho BLE pot.
   * Ko je most nedosegljiv (Android ga je uspavel), poskusi /status do 3x z 1s zamikom.
   * Ob uspehu: tisk prek mosta. Ob neuspehu: napaka (ne BLE fallback).
   */
  async function handleZcsPrintZRetryjem() {
    if (zcsBridgeAvailable) {
      // Most je že dosegljiv v cache-u — direktno tiskaj brez retry
      return handleZcsPrint();
    }
    // Most ni dosegljiv — poskusi ga prebuditi (Android APK je bil uspavan)
    setPrinting(true);
    let mostDosegljiv = false;
    try {
      mostDosegljiv = await waitForZcsBridge(3, 1000);
      setZcsBridgeAvailable(mostDosegljiv);
    } catch {
      // ignore — mostDosegljiv ostane false
    }
    if (!mostDosegljiv) {
      setPrinting(false);
      toast({
        title: "Tiskalni most ni dosegljiv",
        description: "Odprite aplikacijo za tiskalni most (BtTiskalniMost ali ZcsPrinterBridge) na napravi in poskusite znova.",
        variant: "destructive",
      });
      return;
    }
    // Most se je prebudil → sproži tisk (handleZcsPrint upravlja setPrinting sam)
    setPrinting(false);
    return handleZcsPrint();
  }

  async function handleZcsPrint() {
    setPrinting(true);
    try {
      await onBeforePrint?.();
      // tiskalnikSirina + bridge tip → model override in cols
      // BT most (bridge="bt" v2.2+ ali "q10" ≤v2.1): vedno zcs endpoint; cols glede na širino papirja (80mm→40, 58mm→32)
      // ZCS most (bridge="zcs"/null): strojna omejitev 30 kolon; NYX (80/30mm) gre prek /nb80
      const sirina = naprava?.terminalConfig?.tiskalnikSirina;
      const bridgeType = getZcsBridgeType(); // "bt" | "q10" | "zcs" | null
      let modelOverride: "nyx" | "zcs" | undefined;
      let colsOverride: number | undefined;
      if (isBtBridge(bridgeType)) {
        // BT most (bt ali q10): vedno /zcs endpoint, cols glede na papir
        modelOverride = "zcs";
        colsOverride = sirina === 80 ? 40 : 32;
      } else {
        // ZCS most ali ni zaznano: stara logika (sirina določa model)
        modelOverride =
          sirina === 80 || sirina === 30 ? "nyx"
          : sirina === 58 || sirina === 32 ? "zcs"
          : undefined;
        colsOverride = sirina === 30 ? 30 : sirina === 32 ? 32 : undefined;
      }
      const result = await printZcsReceipt(racunId, zbirni, modelOverride, colsOverride, sirina ?? undefined);
      if (!result.ok) throw new Error(result.error);
      const jeBt = isBtBridge(getZcsBridgeType()) || sirina === 32;
      toast({
        title: "Natisnjeno",
        description: `Račun ${stevilkaRacuna ?? racunId} poslan na ${jeBt ? "BT tiskalnik" : "ZCS tiskalnik"}.`,
      });
      onAfterPrint?.();
    } catch (err) {
      toast({
        title: "Napaka pri ZCS tiskanju",
        description: err instanceof Error ? err.message : "Neznana napaka",
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  }

  // ── Sunmi vgrajen tiskalnik ───────────────────────────────────────────────
  async function handleSunmiPrint() {
    setPrinting(true);
    try {
      await onBeforePrint?.();
      const bytes = await fetchReceiptBytes(racunId, zbirni, naprava?.id);
      const result = await printViaSunmi(bytes);
      if (!result.ok) throw new Error(result.error);
      toast({ title: "Natisnjeno", description: `Račun ${stevilkaRacuna ?? racunId} je bil poslan na Sunmi tiskalnik.` });
      onAfterPrint?.();
    } catch (err) {
      toast({
        title: "Napaka pri Sunmi tiskanju",
        description: err instanceof Error ? err.message : "Neznana napaka",
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  }

  // ── Brskalniški tisk — direkten (eksplicitna izbira v dropdownu) ──────────
  // Odpre popup sinhrono pred await, da Chrome/Edge popup blocker ne more blokirati.
  async function handleDirectBrowserPrint() {
    const popupWin = window.open("about:blank", "_blank", "width=340,height=800,left=100,top=50");
    if (!popupWin) {
      toast({ title: "Tiskalnik blokiran", description: "Dovolite pojavna okna v brskalniku.", variant: "destructive" });
      return;
    }
    setPrinting(true);
    try {
      await onBeforePrint?.();
      // Popup gre direktno na /api/... (brez /pos prefiksa) — Vite proxy bi spremenil
      // host na localhost:8080, Clerk handshake bi potem preusmeril na localhost:8080.
      // window.open() ne more pošiljati custom headerjev, zato enota_id dodamo kot query param.
      const enotaId = localStorage.getItem("pos_enota_id");
      const params = new URLSearchParams();
      if (zbirni) params.set("zbirni", "1");
      if (enotaId) params.set("enota_id", enotaId);
      const qs = params.size ? `?${params.toString()}` : "";
      popupWin.location.href = `/api/print/racun/${racunId}/html${qs}`;
      onAfterPrint?.();
    } catch (err) {
      popupWin.close();
      toast({
        title: "Napaka pri tiskanju",
        description: err instanceof Error ? err.message : "Neznana napaka",
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  }

  // ── Brskalniški tisk — avto (rezerva ko ni konfiguriranega tiskalnika) ─────
  // Prednostni vrstni red: neposredni BT → Android mostovi → Sunmi → ESC/POS → HTML.
  async function handleBrowserPrint() {
    const state = getPrinterState();
    // Neposredno povezan PT210 mora imeti prednost pred dosegljivim NB80 mostom.
    if (state.btConnected) return handleBluetoothPrint();

    const sirina = naprava?.terminalConfig?.tiskalnikSirina;
    if ((sirina === 80 || sirina === 30) && nb80BridgeAvailable) return handleNb80Print();
    if ((sirina === 58 || sirina === 32) && zcsBridgeAvailable) return handleZcsPrint();
    if (zcsBridgeAvailable) return handleZcsPrint();
    if (isSunmiPrinterAvailable()) return handleSunmiPrint();
    if (state.connected) return handleSerialPrint();
    if (state.networkUrl) return handleNetworkPrint();
    return handleDirectBrowserPrint();
  }

  async function handleAutomaticPrint() {
    // Po izdaji računa se ta veja lahko izvede pred zaključkom tihega BT
    // reconnecta iz prvega useEffect-a. Počakamo nanj, da PT210 ne pade v
    // napačno NB80 vejo samo zato, ker je bil trenutek preverjanja prezgoden.
    const reconnectedBt = await tryAutoConnectBluetooth().catch(() => false);
    if (reconnectedBt || getPrinterState().btConnected) {
      return handleBluetoothPrint();
    }

    // Če se uporablja Android BT most, najprej preberemo njegov status. Šele
    // ko vemo, da ni BT mosta, lahko širina 80/30 izbere namenski NB80 most.
    const zcsDosegljiv = await isZcsBridgeAvailable().catch(() => false);
    if (zcsDosegljiv && isBtBridge(getZcsBridgeType())) {
      return handleZcsPrint();
    }

    const sirina = naprava?.terminalConfig?.tiskalnikSirina;
    const jeNb80 = sirina === 80 || sirina === 30;
    if (jeNb80 && !nb80BridgeAvailable) {
      return handleNb80PrintZRetryjem();
    }
    // Svež preizkus je zanesljivejši od React stanja, ki ob samodejnem tisku
    // takoj po izdaji lahko še ni posodobljeno (sicer tisk pade na brskalnik).
    if (zcsDosegljiv && !jeNb80) {
      return handleZcsPrint();
    }
    if (jeZcsMostNaprava(sirina) && !jeNb80) {
      return handleZcsPrintZRetryjem();
    }
    return handleBrowserPrint();
  }

  useEffect(() => {
    if (!autoPrint || autoPrintStartedRef.current) return;
    autoPrintStartedRef.current = true;
    void handleAutomaticPrint();
  }, [autoPrint, naprava?.terminalConfig?.tiskalnikSirina, zcsBridgeAvailable, nb80BridgeAvailable]);

  // ── USB Serial tisk ──────────────────────────────────────────────────────
  async function handleSerialPrint() {
    const state = getPrinterState();
    if (!state.connected) {
      setConnectSerialDialogOpen(true);
      return;
    }
    setPrinting(true);
    try {
      await onBeforePrint?.();
      const bytes = await fetchReceiptBytes(racunId, zbirni, naprava?.id);
      const result = await printRaw(bytes);
      if (!result.ok) throw new Error(result.error);
      toast({ title: "Natisnjeno", description: `Račun ${stevilkaRacuna ?? racunId} je bil poslan na tiskalnik.` });
      onAfterPrint?.();
    } catch (err) {
      toast({
        title: "Napaka pri tiskanju",
        description: err instanceof Error ? err.message : "Neznana napaka",
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  }

  // ── Bluetooth tisk ───────────────────────────────────────────────────────
  async function handleBluetoothPrint() {
    let state = getPrinterState();

    if (!state.btConnected) {
      // Najprej poskusi tihi reconnect (po osvežitvi strani gatt.connected=false
      // a dovoljenje ostane — getDevices() vrne napravo brez chooserja).
      const reconnected = await tryAutoConnectBluetooth();
      if (reconnected) {
        forceUpdate(n => n + 1); // ažuriraj status v UI
      } else {
        // Tihi reconnect ni mogoč → prikaži chooser (samo ob resnični potrebi)
        setConnectBtDialogOpen(true);
        return;
      }
    }

    setPrinting(true);
    try {
      await onBeforePrint?.();
      const bytes = await fetchReceiptBytes(racunId, zbirni, naprava?.id);
      const result = await printRawViaBluetooth(bytes);
      if (!result.ok) throw new Error(result.error);
      toast({
        title: "Natisnjeno",
        description: result.btInfo
          ? `Račun ${stevilkaRacuna ?? racunId} — ${result.btInfo}`
          : `Račun ${stevilkaRacuna ?? racunId} je bil poslan na BT tiskalnik.`,
      });
      onAfterPrint?.();
    } catch (err) {
      toast({
        title: "Napaka pri BT tiskanju",
        description: err instanceof Error ? err.message : "Neznana napaka",
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  }

  // ── Wi-Fi / omrežni tisk ─────────────────────────────────────────────────
  async function handleNetworkPrint() {
    const state = getPrinterState();
    if (!state.networkUrl) {
      setNetworkInput("");
      setNetworkDialogOpen(true);
      return;
    }
    setPrinting(true);
    try {
      await onBeforePrint?.();
      const result = await printReceiptViaNetwork(racunId, zbirni);
      if (!result.ok) throw new Error(result.error);
      toast({ title: "Natisnjeno", description: `Račun ${stevilkaRacuna ?? racunId} poslan na ${state.networkUrl}.` });
      onAfterPrint?.();
    } catch (err) {
      toast({
        title: "Napaka pri Wi-Fi tiskanju",
        description: err instanceof Error ? err.message : "Neznana napaka",
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  }

  function handleSaveNetworkPrinter() {
    const trimmed = networkInput.trim();
    if (!trimmed) return;
    setNetworkPrinterUrl(trimmed);
    setNetworkDialogOpen(false);
    toast({ title: "Wi-Fi tiskalnik shranjen", description: trimmed });
    void handleNetworkPrint();
  }

  // ── Windows tiskalni agent (polling) ─────────────────────────────────────
  async function handleAgentPrint() {
    setPrinting(true);
    try {
      await onBeforePrint?.();
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const r = await fetch(`${base}/api/print/racun/${racunId}/agent`, {
        method: "POST",
        credentials: "include",
      });
      if (r.status === 401) throw new Error("Seja je potekla — osvežite stran in se prijavite.");
      if (!r.ok) {
        const err = await r.json().catch(() => ({})) as { error?: string };
        throw new Error(err.error ?? `Napaka strežnika (${r.status})`);
      }
      toast({
        title: "Naloga v čakalni vrsti",
        description: "Windows agent bo natisnil račun v naslednjih sekundah.",
      });
      onAfterPrint?.();
    } catch (err) {
      toast({
        title: "Napaka pri agent tiskanju",
        description: err instanceof Error ? err.message : "Neznana napaka",
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  }

  // ── Serijski povezovalni handlers ─────────────────────────────────────────
  async function handleConnectSerial() {
    setConnecting(true);
    const result = await connectSerialPrinter();
    setConnecting(false);
    if (result.ok) {
      setConnectSerialDialogOpen(false);
      toast({ title: "Tiskalnik povezan", description: "USB termalni tiskalnik je uspešno povezan." });
      handleSerialPrint();
    } else {
      toast({ title: "Napaka pri povezavi", description: result.error, variant: "destructive" });
    }
  }

  async function handleConnectBluetooth() {
    setConnecting(true);
    const result = await connectBluetoothPrinter();
    setConnecting(false);
    if (result.ok) {
      setConnectBtDialogOpen(false);
      const name = getPrinterState().btDeviceName ?? "BT tiskalnik";
      toast({ title: "BT tiskalnik povezan", description: name });
      handleBluetoothPrint();
    } else {
      toast({ title: "Napaka pri BT povezavi", description: result.error, variant: "destructive" });
    }
  }

  async function handleDisconnectSerial() {
    await disconnectSerialPrinter();
    toast({ title: "USB tiskalnik odklopljen" });
  }

  async function handleDisconnectBluetooth() {
    await disconnectBluetoothPrinter();
    toast({ title: "BT tiskalnik odklopljen" });
  }

  function handleDisconnectNetwork() {
    clearNetworkPrinterUrl();
    toast({ title: "Wi-Fi tiskalnik odstranjen" });
  }

  // Windows tiskalni agent — direkten tisk brez dropdowna
  if (agentTiskalnikIme) {
    return (
      <>
        <Button
          variant={variant}
          size={size}
          className={cn("bg-orange-500 hover:bg-orange-600 text-white border-orange-500", className)}
          disabled={printing || externalDisabled}
          data-testid={`button-print-${racunId}`}
          onClick={handleAgentPrint}
        >
          <Printer className="h-4 w-4 mr-2" />
          {printing ? "Tiskanje..." : "Natisni"}
        </Button>
      </>
    );
  }

  // Neposredno povezan BT tiskalnik (npr. PT210) ima absolutno prednost pred
  // Android mostovi. Tako klik ne more končati v NB80 veji.
  if (printerState.btConnected) {
    return (
      <>
        <Button
          variant={variant}
          size={size}
          className={cn("bg-orange-500 hover:bg-orange-600 text-white border-orange-500", className)}
          disabled={printing || externalDisabled}
          data-testid={`button-print-${racunId}`}
          onClick={handleBluetoothPrint}
        >
          <Printer className="h-4 w-4 mr-2" />
          {printing ? "Tiskanje..." : "Natisni"}
        </Button>
      </>
    );
  }

  // NB80: ko je most zaznan → direkten tisk brez dropdowna.
  // BT PT210 (konfiguracija 32 stolpcev ali zaznan BT most) ima prednost.
  if (nb80BridgeAvailable && !jeKonfiguriranBt58 && !isBtBridge(getZcsBridgeType())) {
    return (
      <>
        <Button
          variant={variant}
          size={size}
          className={cn("bg-orange-500 hover:bg-orange-600 text-white border-orange-500", className)}
          disabled={printing || externalDisabled}
          data-testid={`button-print-${racunId}`}
          onClick={handleNb80Print}
        >
          <Printer className="h-4 w-4 mr-2" />
          {printing ? "Tiskanje..." : "Natisni"}
        </Button>
      </>
    );
  }

  // ZCS Z92: ko je most zaznan → direkten tisk brez dropdowna
  if (zcsBridgeAvailable) {
    return (
      <>
        <Button
          variant={variant}
          size={size}
          className={cn("bg-orange-500 hover:bg-orange-600 text-white border-orange-500", className)}
          disabled={printing || externalDisabled}
          data-testid={`button-print-${racunId}`}
          onClick={handleZcsPrint}
        >
          <Printer className="h-4 w-4 mr-2" />
          {printing ? "Tiskanje..." : "Natisni"}
        </Button>
      </>
    );
  }

  // Naprava je konfigurirana za most (ZCS/BT/NB80), a most trenutno ni dosegljiv.
  // → prikaži isti gumb, ki najprej poskusi most prebuditi (retry), ne tiho pade na BLE.
  // KLJUČNO: BLE ESC/POS pot je za te tiskalnike nezanesljiva (scrambled) — nikoli ne sme
  // biti tihi fallback. Napaka je bolje kot scrambled tisk.
  if (jeZcsMostNaprava(naprava?.terminalConfig?.tiskalnikSirina) && !agentTiskalnikIme) {
    return (
      <>
        <Button
          variant={variant}
          size={size}
          className={cn("bg-orange-500 hover:bg-orange-600 text-white border-orange-500", className)}
          disabled={printing || externalDisabled}
          data-testid={`button-print-${racunId}`}
          onClick={handleZcsPrintZRetryjem}
        >
          <Printer className="h-4 w-4 mr-2" />
          {printing ? "Vzpostavljam most..." : "Natisni"}
        </Button>
      </>
    );
  }

  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <Button
            variant={variant}
            size={size}
            className={cn("bg-orange-500 hover:bg-orange-600 text-white border-orange-500", className)}
            disabled={printing || externalDisabled}
            data-testid={`button-print-${racunId}`}
          >
            <Printer className="h-4 w-4 mr-2" />
            {printing ? "Tiskanje..." : "Natisni"}
          </Button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" className="w-64">
          {/* Windows tiskalni agent — prikaži kadar je ime nastavljeno */}
          {agentTiskalnikIme && (
            <>
              <DropdownMenuItem onClick={handleAgentPrint} data-testid="print-agent">
                <Printer className="h-4 w-4 mr-2" />
                <span className="flex-1 truncate">Windows agent ({agentTiskalnikIme})</span>
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {/* NB80 Android most */}
          {nb80BridgeAvailable && (
            <>
              <DropdownMenuItem onClick={handleNb80Print} data-testid="print-nb80">
                <Printer className="h-4 w-4 mr-2" />
                Vgrajen tiskalnik (NB80)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleNb80Diagnostika} disabled={nb80Checking} data-testid="diag-nb80">
                <Printer className="h-4 w-4 mr-2 opacity-50" />
                {nb80Checking ? "Preverjam NB80..." : "NB80 diagnostika"}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {/* ZCS Android most */}
          {zcsBridgeAvailable ? (
            <>
              <DropdownMenuItem onClick={handleZcsPrint} data-testid="print-zcs">
                <Printer className="h-4 w-4 mr-2" />
                Vgrajen tiskalnik (ZCS)
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleZcsDiagnostika} disabled={zcsChecking} data-testid="diag-zcs">
                <Printer className="h-4 w-4 mr-2 opacity-50" />
                ZCS diagnostika
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          ) : (
            <>
              <DropdownMenuItem onClick={handleZcsConnect} disabled={zcsChecking} data-testid="connect-zcs">
                <Printer className="h-4 w-4 mr-2" />
                {zcsChecking ? "Preverjam ZCS..." : "Poveži ZCS tiskalnik"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleZcsDiagnostika} disabled={zcsChecking} data-testid="diag-zcs">
                <Printer className="h-4 w-4 mr-2 opacity-50" />
                ZCS diagnostika
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          {/* Sunmi vgrajen tiskalnik — prikaži samo ko je JS most na voljo */}
          {isSunmiPrinterAvailable() && (
            <>
              <DropdownMenuItem onClick={handleSunmiPrint} data-testid="print-sunmi">
                <Printer className="h-4 w-4 mr-2" />
                Vgrajen tiskalnik (Sunmi)
              </DropdownMenuItem>
              <DropdownMenuSeparator />
            </>
          )}

          <DropdownMenuItem onClick={handleDirectBrowserPrint} data-testid="print-browser">
            <Monitor className="h-4 w-4 mr-2" />
            Natisni v brskalniku
          </DropdownMenuItem>

          <DropdownMenuSeparator />

          {/* Wi-Fi / Network tiskalnik */}
          {printerState.networkUrl ? (
            <>
              <DropdownMenuItem onClick={handleNetworkPrint} data-testid="print-network">
                <Wifi className="h-4 w-4 mr-2" />
                <span className="flex-1 truncate">{printerState.networkUrl}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={() => { setNetworkInput(printerState.networkUrl ?? ""); setNetworkDialogOpen(true); }}
                data-testid="edit-network"
              >
                <Wifi className="h-4 w-4 mr-2 opacity-50" />
                Spremeni Wi-Fi tiskalnik
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDisconnectNetwork} className="text-destructive" data-testid="disconnect-network">
                <WifiOff className="h-4 w-4 mr-2" />
                Odstrani Wi-Fi tiskalnik
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onClick={() => { setNetworkInput(""); setNetworkDialogOpen(true); }} data-testid="connect-network">
              <Wifi className="h-4 w-4 mr-2" />
              Poveži Wi-Fi tiskalnik
            </DropdownMenuItem>
          )}

          {/* Bluetooth tiskalnik — vedno prikazano (btSupported se preveri šele ob kliku) */}
          <DropdownMenuSeparator />
          {printerState.btConnected ? (
            <>
              <DropdownMenuItem onClick={handleBluetoothPrint} data-testid="print-bt">
                <Bluetooth className="h-4 w-4 mr-2" />
                {printerState.btDeviceName ?? "BT tiskalnik"}
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDisconnectBluetooth} className="text-destructive" data-testid="disconnect-bt">
                <BluetoothOff className="h-4 w-4 mr-2" />
                Odklopi BT tiskalnik
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onClick={() => setConnectBtDialogOpen(true)} data-testid="connect-bt">
              <Bluetooth className="h-4 w-4 mr-2" />
              Poveži BT tiskalnik
            </DropdownMenuItem>
          )}

          {/* USB Serial tiskalnik (COM port) */}
          {printerState.supported && (
            <>
              <DropdownMenuSeparator />
              {printerState.connected ? (
                <>
                  <DropdownMenuItem onClick={handleSerialPrint} data-testid="print-serial">
                    <Usb className="h-4 w-4 mr-2" />
                    Pošlji na USB (COM port)
                  </DropdownMenuItem>
                  <DropdownMenuItem onClick={handleDisconnectSerial} className="text-destructive" data-testid="disconnect-printer">
                    Odklopi USB tiskalnik
                  </DropdownMenuItem>
                </>
              ) : (
                <DropdownMenuItem onClick={() => setConnectSerialDialogOpen(true)} data-testid="connect-printer">
                  <Usb className="h-4 w-4 mr-2" />
                  Poveži USB (COM port)
                </DropdownMenuItem>
              )}
            </>
          )}
        </DropdownMenuContent>
      </DropdownMenu>

      {/* Wi-Fi tiskalnik dialog */}
      <Dialog open={networkDialogOpen} onOpenChange={setNetworkDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Lokalni ali omrežni tiskalnik</DialogTitle>
            <DialogDescription>
              Vnesite Windows USB/LPT vrata <strong>ali</strong> IP naslov Wi-Fi tiskalnika.
              <br /><br />
              <strong>Windows USB vrata</strong> (npr. OS58 na USB003):<br />
              <code>USB003</code> &nbsp;·&nbsp; <code>USB001</code> &nbsp;·&nbsp; <code>LPT1</code>
              <br /><br />
              <strong>Wi-Fi / omrežni tiskalnik</strong> (TCP/9100):<br />
              <code>192.168.1.100</code> &nbsp;·&nbsp; <code>192.168.1.100:9100</code>
              <br /><br />
              <em>Katera vrata ima vaš tiskalnik preverite v: Nadzorna plošča → Naprave in tiskalniki → desni klik na tiskalnik → Lastnosti tiskalnika → zavihek Vrata.</em>
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-2 py-2">
            <Label htmlFor="network-printer-input">Vrata tiskalnika</Label>
            <div className="flex gap-2">
              <Input
                id="network-printer-input"
                placeholder="USB003 ali 192.168.1.100"
                value={networkInput}
                onChange={e => setNetworkInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter") handleSaveNetworkPrinter(); }}
                autoFocus
              />
              {networkInput && (
                <Button variant="ghost" size="icon" onClick={() => setNetworkInput("")}>
                  <X className="h-4 w-4" />
                </Button>
              )}
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setNetworkDialogOpen(false)}>
              Prekliči
            </Button>
            <Button onClick={handleSaveNetworkPrinter} disabled={!networkInput.trim()}>
              <Wifi className="h-4 w-4 mr-2" />
              Shrani in natisni
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* BT dialog */}
      <Dialog open={connectBtDialogOpen} onOpenChange={setConnectBtDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Poveži Bluetooth tiskalnik</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>Prepričajte se, da je vaš BT tiskalnik vklopljen in v dosegu. Brskalnik vas bo prosil, da izberete napravo.</p>
                <p><strong>Podprti modeli:</strong> 58mm ESC/POS BLE tiskalniki (GPrinter, Goojprt, Rongta, MUNBYN in podobni).</p>
                <p className="rounded bg-amber-50 border border-amber-200 p-2 text-amber-900 text-xs">
                  <strong>Sunmi Z92 / vgrajen tiskalnik:</strong> Vgrajen tiskalnik ni viden kot BT naprava.
                  Namesto tega uporabite možnost <em>Vgrajen tiskalnik (Sunmi)</em> — ta se prikaže
                  le v Sunmi brskalniku ali WebView aplikaciji, ne v Chrome.
                </p>
                <p className="text-xs text-muted-foreground">Potreben je Chrome ali Edge brskalnik.</p>
              </div>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectBtDialogOpen(false)}>
              Prekliči
            </Button>
            <Button onClick={handleConnectBluetooth} disabled={connecting}>
              <Bluetooth className="h-4 w-4 mr-2" />
              {connecting ? "Povezovanje..." : "Izberi tiskalnik"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* USB Serial dialog */}
      <Dialog open={connectSerialDialogOpen} onOpenChange={setConnectSerialDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Poveži USB termalni tiskalnik (COM port)</DialogTitle>
            <DialogDescription>
              Prepričajte se, da je vaš USB termalni tiskalnik priključen. Brskalnik vas bo prosil, da izberete vrata (COM port).
              <br /><br />
              <strong>Podprti tiskalniki:</strong> Epson TM, Star Micronics, Bixolon, Sewoo in drugi ESC/POS tiskalniki, ki se prikažejo kot COM port.
              <br /><br />
              <em>Opomba: Web Serial API je podprt v Chrome in Edge (ne Firefox/Safari).</em>
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setConnectSerialDialogOpen(false)}>
              Prekliči
            </Button>
            <Button onClick={handleConnectSerial} disabled={connecting}>
              <Usb className="h-4 w-4 mr-2" />
              {connecting ? "Povezovanje..." : "Izberi tiskalnik"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
