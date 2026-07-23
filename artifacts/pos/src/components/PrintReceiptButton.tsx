import { useState, useEffect } from "react";
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
} from "@/lib/printer";
import {
  connectQz,
  disconnectQz,
  listQzPrinters,
  printQz,
  setQzPrinterName,
  clearQzPrinterName,
  isQzConnected,
} from "@/lib/qzPrinter";
import { isSunmiPrinterAvailable, printViaSunmi } from "@/lib/sunmiPrinter";
import { isZcsBridgeAvailable, printZcsReceipt, getZcsBridgeStatus, getZcsDiagnostics, getZcsBridgeCached } from "@/lib/zcsAndroidPrinter";

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
}: PrintReceiptButtonProps) {
  const { toast } = useToast();
  const { naprava } = useNaprava();
  const jeWindows = navigator.userAgent.includes("Windows");
  const agentTiskalnikIme = naprava?.terminalConfig?.agentTiskalnikIme ?? "";
  const [printing, setPrinting] = useState(false);
  const [connectSerialDialogOpen, setConnectSerialDialogOpen] = useState(false);
  const [connectBtDialogOpen, setConnectBtDialogOpen] = useState(false);
  const [networkDialogOpen, setNetworkDialogOpen] = useState(false);
  const [networkInput, setNetworkInput] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [, forceUpdate] = useState(0);

  // QZ Tray stanje
  const [qzDialogOpen, setQzDialogOpen] = useState(false);
  const [qzPrinters, setQzPrinters] = useState<string[]>([]);
  const [qzLoading, setQzLoading] = useState(false);
  const [qzSelected, setQzSelected] = useState<string>("");
  const [qzError, setQzError] = useState<string | null>(null);

  // ZCS Android most — inicializiraj iz module-level cache takoj (brez čakanja)
  const [zcsBridgeAvailable, setZcsBridgeAvailable] = useState(() => getZcsBridgeCached() === true);
  const [zcsChecking, setZcsChecking] = useState(false);

  useEffect(() => {
    tryAutoConnectSerial().then(connected => {
      if (connected) forceUpdate(n => n + 1);
    });

    let cancelled = false;

    // Če cache ni veljaven, preverimo takoj; sicer preskočimo (cache je svež)
    const cached = getZcsBridgeCached();
    if (cached === null) {
      isZcsBridgeAvailable().then(ok => {
        if (!cancelled) setZcsBridgeAvailable(ok);
      });
    }

    // Periodično preverjanje vsakih 6s — zaznа APK ki se zažene po nalaganju
    // Ko je most zaznan, interval avtomatsko posodablja cache (TTL 30s)
    const interval = setInterval(() => {
      if (cancelled) return;
      isZcsBridgeAvailable().then(ok => {
        if (!cancelled) setZcsBridgeAvailable(ok);
      });
    }, 6000);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, []);

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

  // ── ZCS Android most ─────────────────────────────────────────────────────
  async function handleZcsPrint() {
    setPrinting(true);
    try {
      await onBeforePrint?.();
      const result = await printZcsReceipt(racunId, zbirni);
      if (!result.ok) throw new Error(result.error);
      toast({ title: "Natisnjeno", description: `Račun ${stevilkaRacuna ?? racunId} poslan na ZCS tiskalnik.` });
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
      const bytes = await fetchReceiptBytes(racunId, zbirni);
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
  // Prednostni vrstni red: ZCS → Sunmi → ESC/POS (serial → BT → QZ → omrežni) → HTML rezerva
  async function handleBrowserPrint() {
    if (zcsBridgeAvailable) return handleZcsPrint();
    if (isSunmiPrinterAvailable()) return handleSunmiPrint();
    const state = getPrinterState();
    if (state.connected) return handleSerialPrint();
    if (state.btConnected) return handleBluetoothPrint();
    if (state.qzPrinterName) return handleQzPrint();
    if (state.networkUrl) return handleNetworkPrint();
    return handleDirectBrowserPrint();
  }

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
      const bytes = await fetchReceiptBytes(racunId, zbirni);
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
    const state = getPrinterState();
    if (!state.btConnected) {
      setConnectBtDialogOpen(true);
      return;
    }
    setPrinting(true);
    try {
      await onBeforePrint?.();
      const bytes = await fetchReceiptBytes(racunId, zbirni);
      const result = await printRawViaBluetooth(bytes);
      if (!result.ok) throw new Error(result.error);
      toast({ title: "Natisnjeno", description: `Račun ${stevilkaRacuna ?? racunId} je bil poslan na BT tiskalnik.` });
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

  // ── QZ Tray tisk ─────────────────────────────────────────────────────────
  async function handleQzPrint() {
    const state = getPrinterState();
    if (!state.qzPrinterName) {
      await openQzDialog();
      return;
    }
    setPrinting(true);
    try {
      await onBeforePrint?.();
      const bytes = await fetchReceiptBytes(racunId, zbirni);
      const result = await printQz(bytes);
      if (!result.ok) throw new Error(result.error);
      toast({ title: "Natisnjeno", description: `Račun ${stevilkaRacuna ?? racunId} poslan na ${state.qzPrinterName}.` });
      onAfterPrint?.();
    } catch (err) {
      toast({
        title: "Napaka pri QZ tiskanju",
        description: err instanceof Error ? err.message : "Neznana napaka",
        variant: "destructive",
      });
    } finally {
      setPrinting(false);
    }
  }

  async function openQzDialog() {
    setQzSelected(printerState.qzPrinterName ?? "");
    setQzPrinters([]);
    setQzError(null);
    setQzDialogOpen(true);
    setQzLoading(true);
    try {
      const connResult = await connectQz();
      if (!connResult.ok) throw new Error(connResult.error);
      const list = await listQzPrinters();
      setQzPrinters(list);
      if (list.length > 0) setQzSelected(s => s || list[0]);
    } catch (err) {
      setQzError(err instanceof Error ? err.message : "Napaka pri povezavi z QZ Tray.");
    } finally {
      setQzLoading(false);
    }
  }

  async function handleSaveQzPrinter() {
    if (!qzSelected) return;
    setQzPrinterName(qzSelected);
    setQzDialogOpen(false);
    forceUpdate(n => n + 1);
    toast({ title: "QZ tiskalnik shranjen", description: qzSelected });
    await handleQzPrint();
  }

  async function handleDisconnectQz() {
    await disconnectQz();
    clearQzPrinterName();
    forceUpdate(n => n + 1);
    toast({ title: "QZ tiskalnik odstranjen" });
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

          {/* QZ Tray — Windows gonilniški tiskalniki */}
          {printerState.qzPrinterName ? (
            <>
              <DropdownMenuItem onClick={handleQzPrint} data-testid="print-qz">
                <Printer className="h-4 w-4 mr-2" />
                <span className="flex-1 truncate">{printerState.qzPrinterName}</span>
              </DropdownMenuItem>
              <DropdownMenuItem
                onClick={openQzDialog}
                data-testid="change-qz"
              >
                <ChevronDown className="h-4 w-4 mr-2 opacity-50" />
                Zamenjaj QZ tiskalnik
              </DropdownMenuItem>
              <DropdownMenuItem onClick={handleDisconnectQz} className="text-destructive" data-testid="disconnect-qz">
                <X className="h-4 w-4 mr-2" />
                Odstrani QZ tiskalnik
              </DropdownMenuItem>
            </>
          ) : (
            <DropdownMenuItem onClick={openQzDialog} data-testid="connect-qz">
              <Printer className="h-4 w-4 mr-2" />
              Poveži Windows tiskalnik (QZ Tray)
            </DropdownMenuItem>
          )}

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

      {/* QZ Tray dialog — izbira Windows tiskalnika */}
      <Dialog open={qzDialogOpen} onOpenChange={setQzDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Windows tiskalnik prek QZ Tray</DialogTitle>
            <DialogDescription asChild>
              <div className="space-y-3 text-sm">
                <p>
                  QZ Tray omogoča tih tisk na katerikoli Windows USB tiskalnik brez tiskalnega dialoga.
                </p>
                {!isQzConnected() && !qzLoading && qzPrinters.length === 0 && (
                  <div className="rounded-md bg-amber-50 border border-amber-200 p-3 text-amber-900 text-xs space-y-2">
                    <p className="font-semibold">Namestitev in nastavitev (enkratno):</p>
                    <ol className="list-decimal list-inside space-y-2">
                      <li>
                        Prenesite z{" "}
                        <a
                          href="https://qz.io/download/"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline text-blue-700"
                        >
                          qz.io/download
                        </a>{" "}
                        — namestite in zaženite QZ Tray
                      </li>
                      <li>
                        <strong>Zaupajte certifikatu</strong> — odprite ta naslov v Chromu, kliknite
                        &ldquo;Napredno&rdquo; → &ldquo;Nadaljuj na localhost&rdquo;:{" "}
                        <a
                          href="https://localhost:8183"
                          target="_blank"
                          rel="noopener noreferrer"
                          className="underline text-blue-700 font-semibold"
                        >
                          https://localhost:8183
                        </a>
                        <br />
                        <span className="text-amber-700">
                          ⚠ Ta korak je obvezen — brez njega Chrome blokira povezavo.
                        </span>
                      </li>
                      <li>
                        Zaprite tisti zavihek, kliknite <strong>Poveži</strong> spodaj.
                        <br />
                        QZ Tray bo pokazal pojavno okno — kliknite <strong>Allow</strong> (Dovoli).
                      </li>
                    </ol>
                    <div className="mt-2 pt-2 border-t border-amber-300">
                      <p className="font-semibold mb-1">Pojavno okno se ne pojavi? Nastavite v datoteki:</p>
                      <p>Odprite <code>qz-tray.properties</code> (v mapi QZ Tray) in dodajte:</p>
                      <code className="block mt-1 bg-amber-100 px-2 py-1 rounded">allow-unsigned=true</code>
                      <p className="mt-1">Nato znova zaženite QZ Tray in kliknite Poveži.</p>
                    </div>
                  </div>
                )}
              </div>
            </DialogDescription>
          </DialogHeader>

          {qzLoading ? (
            <div className="py-4 text-center text-sm text-muted-foreground">
              Povezujem z QZ Tray… (do 5 sekund)
            </div>
          ) : qzError ? (
            <div className="rounded-md bg-destructive/10 border border-destructive/30 p-3 text-destructive text-xs whitespace-pre-line">
              {qzError}
            </div>
          ) : qzPrinters.length > 0 ? (
            <div className="space-y-2 py-2">
              <Label htmlFor="qz-printer-select">Izberite tiskalnik</Label>
              <select
                id="qz-printer-select"
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={qzSelected}
                onChange={e => setQzSelected(e.target.value)}
              >
                {qzPrinters.map(p => (
                  <option key={p} value={p}>{p}</option>
                ))}
              </select>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="outline" onClick={() => setQzDialogOpen(false)}>
              Prekliči
            </Button>
            {qzPrinters.length > 0 ? (
              <Button onClick={handleSaveQzPrinter} disabled={!qzSelected || qzLoading}>
                <Printer className="h-4 w-4 mr-2" />
                Shrani in natisni
              </Button>
            ) : (
              <Button onClick={openQzDialog} disabled={qzLoading}>
                <Printer className="h-4 w-4 mr-2" />
                {qzLoading ? "Povezujem…" : "Poveži"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

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
