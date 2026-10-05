import { useRef, useState } from "react";
import { Download, Loader2, RefreshCw, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  checkScannerBridge, scanDocument, scannerImageFile,
  SCANNER_BRIDGE_DOWNLOAD, SCANNER_CONNECTION_HELP,
  type ScannerHealth, type ScannerImage,
} from "@/lib/scanner-bridge";

export function ScannerBridgeSettings() {
  const [health, setHealth] = useState<ScannerHealth | null>(null);
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const check = async () => {
    setChecking(true);
    setHealth(null);
    setError(null);
    try { setHealth(await checkScannerBridge()); }
    catch { setError(`Most ni dosegljiv. ${SCANNER_CONNECTION_HELP}`); }
    finally { setChecking(false); }
  };
  return (
    <Card id="scanner-bridge">
      <CardHeader><CardTitle className="text-base">Scanner Bridge — HP skener za AI uvoz dokumentov</CardTitle></CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p>Isti lokalni most kot v POS Gostinstvo. Če je že nameščen, ga ni treba nameščati ponovno.</p>
        <ol className="list-decimal space-y-1 pl-5">
          <li>Prenesite ScannerBridge.exe na Windows računalnik s priključenim HP skenerjem.</li>
          <li>Zaženite datoteko; most deluje v sistemski vrstici in se samodejno zažene ob prijavi v Windows.</li>
          <li>Namestite HP gonilnik WIA in preverite povezavo spodaj.</li>
          <li>V Dokumenti (AI) izberite »Skeniraj s HP skenerjem«, preverite predogled in naložite sken.</li>
        </ol>
        <div className="flex flex-wrap gap-2">
          <Button asChild variant="outline"><a href={SCANNER_BRIDGE_DOWNLOAD} download="ScannerBridge.exe"><Download className="mr-2 h-4 w-4" />Prenesi ScannerBridge.exe</a></Button>
          <Button variant="outline" disabled={checking} onClick={() => void check()}>
            {checking ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Preveri povezavo
          </Button>
        </div>
        {health && <div role="status">Most je povezan{health.version ? ` (v${health.version})` : ""}.
          {health.scanners.length ? <ul className="list-disc pl-5">{health.scanners.map(device => <li key={device.id}>{device.name}</li>)}</ul> : <p>Ni zaznanih skenerjev. Preverite priklop in HP gonilnik WIA.</p>}
        </div>}
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <p className="text-xs text-muted-foreground">Most deluje samo na tem računalniku (localhost:8765). Nastavitev ni vezana na podjetje. AI predloge vedno pregledajte pred knjiženjem.</p>
      </CardContent>
    </Card>
  );
}

type CaptureProps = {
  disabled: boolean;
  companyName: string;
  onCapture: (file: File) => Promise<boolean>;
  onOpenChange: (open: boolean) => void;
};

export function ScannerCapture({ disabled, companyName, onCapture, onOpenChange }: CaptureProps) {
  const [open, setOpen] = useState(false);
  const [targetName, setTargetName] = useState("");
  const [health, setHealth] = useState<ScannerHealth | null>(null);
  const [deviceId, setDeviceId] = useState("");
  const [busy, setBusy] = useState<"check" | "scan" | "upload" | null>(null);
  const [image, setImage] = useState<ScannerImage | null>(null);
  const [error, setError] = useState<string | null>(null);
  const delivering = useRef(onCapture);
  const pending = useRef(false);

  const setOpened = (value: boolean) => {
    if (pending.current) return;
    setOpen(value);
    onOpenChange(value);
    if (!value) { setImage(null); setError(null); }
  };
  const check = async () => {
    if (pending.current) return;
    pending.current = true;
    setBusy("check"); setError(null); setHealth(null);
    try {
      const result = await checkScannerBridge();
      setHealth(result); setDeviceId(result.scanners[0]?.id ?? "");
    } catch { setError(`Most ni dosegljiv. ${SCANNER_CONNECTION_HELP}`); }
    finally { pending.current = false; setBusy(null); }
  };
  const start = () => {
    if (disabled || pending.current) return;
    // Freeze both the upload callback's company and its visible name before IO.
    delivering.current = onCapture;
    setTargetName(companyName); setImage(null); setOpened(true);
    void check();
  };
  const scan = async () => {
    if (!deviceId || pending.current) return;
    pending.current = true; setBusy("scan"); setError(null);
    try { setImage(await scanDocument(deviceId)); }
    catch (failure) { setError(failure instanceof Error ? failure.message : "Skeniranje ni uspelo."); }
    finally { pending.current = false; setBusy(null); }
  };
  const upload = async () => {
    if (!image || pending.current) return;
    pending.current = true; setBusy("upload"); setError(null);
    let success = false;
    try {
      success = await delivering.current(scannerImageFile(image));
      if (!success) setError("Nalaganje ni bilo potrjeno. Sken je ohranjen; pred ponovnim poskusom preverite seznam in napako nalaganja.");
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Nalaganje ni uspelo."); }
    finally { pending.current = false; setBusy(null); }
    if (success) setOpened(false);
  };
  return (
    <>
      <Button variant="outline" className="mt-2 w-full" disabled={disabled} onClick={start}><ScanLine className="mr-2 h-4 w-4" />Skeniraj s HP skenerjem</Button>
      <Dialog open={open} onOpenChange={setOpened}>
        <DialogContent className="max-w-xl" onEscapeKeyDown={event => { if (pending.current) event.preventDefault(); }} onInteractOutside={event => { if (pending.current) event.preventDefault(); }}>
          <DialogHeader>
            <DialogTitle>Skeniranje dokumenta za AI</DialogTitle>
            <DialogDescription>300 dpi, sivinsko. Sken se naloži šele po vaši potrditvi; AI obdelavo nato zaženete na seznamu dokumentov.</DialogDescription>
          </DialogHeader>
          <p className="text-sm">Za podjetje: <strong>{targetName}</strong></p>
          <label className="text-sm">HP / WIA skener
            <select aria-label="HP / WIA skener" value={deviceId} disabled={!!busy} onChange={event => setDeviceId(event.target.value)} className="mt-1 block w-full rounded-md border bg-background p-2">
              <option value="">Izberite skener</option>
              {health?.scanners.map(device => <option key={device.id} value={device.id}>{device.name}</option>)}
            </select>
          </label>
          {health && !health.scanners.length && <p role="alert">Ni zaznanih skenerjev. Preverite priklop in gonilnik WIA.</p>}
          <div className="flex gap-2">
            <Button variant="outline" disabled={!!busy} onClick={() => void check()}>Preveri povezavo</Button>
            <Button disabled={!!busy || !deviceId} onClick={() => void scan()}>{image ? "Ponovno skeniraj" : "Skeniraj dokument"}</Button>
          </div>
          {busy && <p role="status" className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" />{busy === "scan" ? "Skeniranje poteka. Počakajte na skener…" : busy === "upload" ? "Nalaganje skena…" : "Preverjanje povezave…"}</p>}
          {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
          {image && <img className="max-h-80 w-full rounded border object-contain" src={`data:${image.mimeType};base64,${image.image}`} alt="Predogled skeniranega dokumenta" />}
          <div className="flex justify-end gap-2">
            <Button variant="outline" disabled={!!busy} onClick={() => setOpened(false)}>Prekliči</Button>
            <Button disabled={!image || !!busy} onClick={() => void upload()}>Naloži sken za AI</Button>
          </div>
          {!health && !busy && <a className="text-sm underline" href={SCANNER_BRIDGE_DOWNLOAD} download="ScannerBridge.exe">Prenesi ScannerBridge.exe</a>}
        </DialogContent>
      </Dialog>
    </>
  );
}
