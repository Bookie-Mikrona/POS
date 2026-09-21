import { useEffect, useMemo, useState } from "react";
import { Download, ExternalLink, FileDown, FileUp, Loader2, QrCode, RefreshCw, ShieldAlert, CheckCircle2, XCircle, Printer, Upload, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Badge } from "@/components/ui/badge";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Skeleton } from "@/components/ui/skeleton";

type Miza = { id: number; stevilka: number; ime: string | null; qrAktiven: boolean; javniUrl: string | null };
type Prostor = { id: number; ime: string; mize: Miza[] };
type Pregled = { publicMenuOrigin: string | null; prostori: Prostor[]; mizeBrezProstora: Miza[] };
type Backup = { version: 1; exportedAt: string; tables: Array<{ stevilka: number; ime: string | null; prostor: string | null }> };

const base = import.meta.env.BASE_URL.replace(/\/$/, "");
const imeMize = (miza: Miza) => miza.ime?.trim() || `Miza ${miza.stevilka}`;
const QR_NAPRAVA_STORAGE_KEY = "bookie.qr-naprava-id.v1";
const QR_NAPRAVA_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveQrPreviewUrl(javniUrl: string, development: boolean): string {
  if (!development) return javniUrl;
  try {
    const parsed = new URL(javniUrl);
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return javniUrl;
  }
}

export default function QrAdministracija() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [pregled, setPregled] = useState<Pregled | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const [labelSize, setLabelSize] = useState("A4");
  const [exportFormat, setExportFormat] = useState("pdf");
  const [importReport, setImportReport] = useState<string | null>(null);
  const [pendingImport, setPendingImport] = useState<Backup | null>(null);
  const [importing, setImporting] = useState(false);
  const [rotateConfirmOpen, setRotateConfirmOpen] = useState(false);
  const [rotateConfirmProstor, setRotateConfirmProstor] = useState<Prostor | null>(null);
  const [previewingId, setPreviewingId] = useState<number | null>(null);
  
  const jeAdmin = ["admin", "admin_enote", "superadmin"].includes(user?.vloga ?? "");

  const load = async () => {
    setLoading(true);
    try {
      const response = await fetch(`${base}/api/qr-admin`, {
        credentials: "include",
        cache: "no-store",
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Pregleda QR ni bilo mogoče naložiti.");
      setPregled(data);
      setSelected((old) => old.filter((id) => [...data.prostori.flatMap((p: Prostor) => p.mize), ...data.mizeBrezProstora].some((m: Miza) => m.id === id)));
    } catch (error) {
      toast({ title: error instanceof Error ? error.message : "Napaka pri nalaganju", variant: "destructive" });
    } finally { setLoading(false); }
  };
  
  useEffect(() => { if (jeAdmin) void load(); }, [jeAdmin]);

  const toggle = (id: number) => setSelected((old) => old.includes(id) ? old.filter((value) => value !== id) : [...old, id]);
  
  const exportBackup = () => {
    if (!pregled) return;
    const backup: Backup = { version: 1, exportedAt: new Date().toISOString(), tables: [
      ...pregled.prostori.flatMap((prostor) => prostor.mize.map((miza) => ({ stevilka: miza.stevilka, ime: miza.ime, prostor: prostor.ime }))),
      ...pregled.mizeBrezProstora.map((miza) => ({ stevilka: miza.stevilka, ime: miza.ime, prostor: null })),
    ] };
    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob); const link = document.createElement("a");
    link.href = url; link.download = "qr-meni-konfiguracija.json"; link.click(); URL.revokeObjectURL(url);
  };
  
  const runImport = async (backup: Backup, mode: "dry-run" | "apply") => {
    setImporting(true);
    try {
      const response = await fetch(`${base}/api/qr-admin/import`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode, backup }),
      });
      const data = await response.json() as { valid: boolean; errors: string[]; createdRooms?: number; createdTables?: number; updatedTables?: number };
      if (!response.ok || !data.valid) throw new Error(data.errors?.join(" ") || "Uvoz ni veljaven.");
      const counts = `${data.createdRooms ?? 0} novih prostorov, ${data.createdTables ?? 0} novih miz, ${data.updatedTables ?? 0} posodobljenih miz`;
      if (mode === "dry-run") { setPendingImport(backup); setImportReport(`Suhi preizkus uspešen: ${counts}. Podatki še niso spremenjeni.`); }
      else { setPendingImport(null); setImportReport(`Uvoz je izveden: ${counts}. QR žetoni in skrivnosti niso bili uvoženi.`); await load(); }
    } catch (error) { setPendingImport(null); setImportReport(error instanceof Error ? error.message : "Uvoza ni mogoče preveriti."); }
    finally { setImporting(false); }
  };
  
  const dryRunImport = async (file: File | undefined) => {
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text()) as Backup;
      setPendingImport(null); await runImport(parsed, "dry-run");
    } catch (error) { setPendingImport(null); setImportReport(error instanceof Error ? error.message : "Datoteke ni mogoče prebrati."); }
  };
  
  const download = async (prostor: Prostor, rotate: boolean) => {
    const ids = selected.filter((id) => prostor.mize.some((miza) => miza.id === id));
    if (!ids.length) { toast({ title: "Izberite vsaj eno mizo v tem prostoru", variant: "destructive" }); return; }
    
    setWorking(true);
    try {
      const response = await fetch(`${base}/api/prostori/${prostor.id}/qr-kode`, {
        method: "POST", credentials: "include", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tableIds: ids, rotate, labelSize, format: exportFormat }),
      });
      if (!response.ok) { const data = await response.json(); throw new Error(data.error ?? "PDF-ja ni bilo mogoče pripraviti."); }
      const blob = await response.blob(); const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = `qr-kode-${prostor.ime}.${exportFormat}`; link.click(); URL.revokeObjectURL(url);
      toast({ title: rotate ? "QR kode so rotirane in PDF prenesen" : "Obstoječe QR kode so ponovno prenesene" });
      await load();
    } catch (error) { toast({ title: error instanceof Error ? error.message : "Napaka pri pripravi", variant: "destructive" }); }
    finally { setWorking(false); }
  };

  const handleConfirmRotate = () => {
    if (rotateConfirmProstor) {
      void download(rotateConfirmProstor, true);
    }
    setRotateConfirmOpen(false);
  };

  const preview = async (miza: Miza) => {
    const previewWindow = window.open("about:blank", "_blank");
    if (!previewWindow) {
      toast({ title: "Brskalnik je blokiral nov zavihek. Dovolite pojavna okna in poskusite znova.", variant: "destructive" });
      return;
    }
    setPreviewingId(miza.id);
    try {
      let qrNapravaId = window.localStorage.getItem(QR_NAPRAVA_STORAGE_KEY);
      if (!qrNapravaId || !QR_NAPRAVA_ID_RE.test(qrNapravaId)) {
        qrNapravaId = window.crypto.randomUUID();
        window.localStorage.setItem(QR_NAPRAVA_STORAGE_KEY, qrNapravaId);
      }
      const response = await fetch(`${base}/api/qr-admin/mize/${miza.id}/predogled`, {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qrNapravaId }),
      });
      const data = await response.json() as { javniUrl?: string; previewSession?: string; error?: string };
      if (!response.ok || !data.javniUrl || !data.previewSession) throw new Error(data.error ?? "Predogleda QR menija ni bilo mogoče odpreti.");
      const previewUrl = resolveQrPreviewUrl(data.javniUrl, import.meta.env.DEV);
      previewWindow.location.replace(`${previewUrl}#predogled=${encodeURIComponent(data.previewSession)}`);
    } catch (error) {
      previewWindow.close();
      toast({ title: error instanceof Error ? error.message : "Predogleda ni bilo mogoče odpreti.", variant: "destructive" });
    } finally {
      setPreviewingId(null);
    }
  };

  if (!jeAdmin) return (
    <div className="min-h-[100dvh] flex items-center justify-center p-6 bg-muted/30">
      <Card className="max-w-md w-full shadow-md">
        <CardContent className="flex flex-col items-center gap-4 py-8 text-center">
          <div className="rounded-full bg-amber-500/10 p-3 text-amber-600">
            <ShieldAlert className="h-8 w-8" />
          </div>
          <div className="space-y-1">
            <h2 className="text-xl font-semibold">Omejen dostop</h2>
            <p className="text-sm text-muted-foreground" data-testid="status-qr-no-access">Za upravljanje QR menija potrebujete administratorsko vlogo.</p>
          </div>
        </CardContent>
      </Card>
    </div>
  );

  return (
    <main className="mx-auto max-w-6xl space-y-6 p-4 md:p-6 pb-20 pos-page-content" data-testid="page-qr-administracija">
      <div className="flex flex-wrap items-start justify-between gap-4 border-b pb-5">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight">QR meni administracija</h1>
          <p className="text-sm text-muted-foreground max-w-xl">
            Nadzor povezav, ustvarjanje in tiskanje nalepk ter varen prenos celotne konfiguracije miz in prostorov.
          </p>
        </div>
        <Button variant="secondary" onClick={() => void load()} disabled={loading} data-testid="button-refresh-qr">
          <RefreshCw className={`mr-2 h-4 w-4 ${loading ? 'animate-spin' : ''}`} />
          Osveži podatke
        </Button>
      </div>

      {!pregled?.publicMenuOrigin && !loading && (
        <div className="flex gap-3 rounded-lg border border-destructive/50 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertTriangle className="h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">Javni HTTPS naslov menija ni nastavljen</p>
            <p className="mt-1 opacity-90">QR povezav ni mogoče varno ustvariti, dokler konfiguracija ni popolna. Prosimo, preverite globalne nastavitve podjetja.</p>
          </div>
        </div>
      )}

      <Card className="shadow-sm">
        <CardHeader className="bg-muted/20 border-b pb-4">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="space-y-1">
              <CardTitle className="flex items-center gap-2">
                <Printer className="h-5 w-5 text-primary" />
                Priprava za tisk in rotacija kod
              </CardTitle>
              <CardDescription>
                Izberite mize in ponovno prenesite obstoječe kode ali z rotacijo generirajte povsem nove.
              </CardDescription>
            </div>
            
            <div className="flex flex-wrap items-center gap-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Velikost nalepke</Label>
                <Select value={labelSize} onValueChange={setLabelSize}>
                  <SelectTrigger data-testid="select-qr-label-size" className="h-9 w-[140px] bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="A4">A4 (ena miza)</SelectItem>
                    <SelectItem value="100x100">100 × 100 mm</SelectItem>
                    <SelectItem value="58x58">58 × 58 mm</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Datoteka</Label>
                <Select value={exportFormat} onValueChange={setExportFormat}>
                  <SelectTrigger data-testid="select-qr-export-format" className="h-9 w-[130px] bg-background">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="pdf">PDF</SelectItem>
                    <SelectItem value="png">PNG slika</SelectItem>
                    <SelectItem value="zip">ZIP paket</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </div>
        </CardHeader>
        
        <CardContent className="p-0">
          {loading ? (
            <div className="p-6 space-y-4">
              <Skeleton className="h-10 w-full" />
              <Skeleton className="h-40 w-full" />
              <Skeleton className="h-40 w-full" />
            </div>
          ) : pregled?.prostori.length === 0 ? (
            <div className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
              <QrCode className="h-12 w-12 mb-3 opacity-20" />
              <p className="font-medium text-foreground">Ni definiranih prostorov</p>
              <p className="text-sm">Dodajte mize in prostore v nastavitvah, da ustvarite QR kode.</p>
            </div>
          ) : (
            <div className="divide-y">
              {pregled?.prostori.map((prostor) => {
                const mizeIds = prostor.mize.map((m) => m.id);
                const prostorSelected = mizeIds.filter((id) => selected.includes(id));
                const isAllSelected = mizeIds.length > 0 && prostorSelected.length === mizeIds.length;
                const isIndeterminate = prostorSelected.length > 0 && prostorSelected.length < mizeIds.length;

                const toggleProstor = () => {
                  if (isAllSelected) {
                    setSelected((old) => old.filter((id) => !mizeIds.includes(id)));
                  } else {
                    setSelected((old) => Array.from(new Set([...old, ...mizeIds])));
                  }
                };

                return (
                  <div key={prostor.id} className="group" data-testid={`qr-room-${prostor.id}`}>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-4 md:px-6 bg-muted/10 group-hover:bg-muted/30 transition-colors">
                      <div className="flex items-center gap-3">
                        <Checkbox 
                          checked={isAllSelected || (isIndeterminate ? "indeterminate" : false)} 
                          onCheckedChange={toggleProstor}
                          id={`prostor-${prostor.id}`}
                        />
                        <Label htmlFor={`prostor-${prostor.id}`} className="font-semibold text-base cursor-pointer">{prostor.ime}</Label>
                        <Badge variant="secondary" className="font-normal tabular-nums">{prostor.mize.length} miz</Badge>
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <Button size="sm" variant="outline" className="h-8" disabled={working || prostorSelected.length === 0} onClick={() => void download(prostor, false)} data-testid={`button-redownload-${prostor.id}`}>
                          <Download className="mr-2 h-3.5 w-3.5 text-muted-foreground" />
                          PDF brez rotacije
                        </Button>
                        <Button size="sm" className="h-8" disabled={working || prostorSelected.length === 0} onClick={() => { setRotateConfirmProstor(prostor); setRotateConfirmOpen(true); }} data-testid={`button-rotate-${prostor.id}`}>
                          <QrCode className="mr-2 h-3.5 w-3.5" />
                          Rotiraj in PDF
                        </Button>
                      </div>
                    </div>
                    
                    <Table>
                      <TableHeader className="bg-transparent">
                        <TableRow className="hover:bg-transparent">
                          <TableHead className="w-12 pl-6"></TableHead>
                          <TableHead className="font-medium">Miza</TableHead>
                          <TableHead className="font-medium">Status QR povezave</TableHead>
                          <TableHead className="text-right pr-6 font-medium">Akcije</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {prostor.mize.map((miza) => (
                          <TableRow key={miza.id} className={selected.includes(miza.id) ? "bg-primary/5" : ""}>
                            <TableCell className="pl-6">
                              <Checkbox 
                                checked={selected.includes(miza.id)} 
                                onCheckedChange={() => toggle(miza.id)} 
                                data-testid={`checkbox-qr-table-${miza.id}`} 
                              />
                            </TableCell>
                            <TableCell className="font-medium">{imeMize(miza)}</TableCell>
                            <TableCell>
                              {miza.qrAktiven ? (
                                <Badge variant="outline" className="bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-500/20 border-emerald-500/20 gap-1.5 font-medium" data-testid={`status-qr-table-${miza.id}`}>
                                  <CheckCircle2 className="h-3.5 w-3.5" />
                                  Aktiven
                                </Badge>
                              ) : (
                                <Badge variant="outline" className="bg-amber-500/10 text-amber-700 dark:text-amber-400 hover:bg-amber-500/20 border-amber-500/20 gap-1.5 font-medium" data-testid={`status-qr-table-${miza.id}`}>
                                  <XCircle className="h-3.5 w-3.5" />
                                  Ni ustvarjen
                                </Badge>
                              )}
                            </TableCell>
                            <TableCell className="text-right pr-6">
                              {miza.javniUrl && (
                                <Button
                                  size="sm"
                                  variant="ghost"
                                  className="h-8 text-muted-foreground hover:text-foreground"
                                  disabled={previewingId !== null}
                                  onClick={() => void preview(miza)}
                                  data-testid={`link-qr-preview-${miza.id}`}
                                >
                                  {previewingId === miza.id
                                    ? <Loader2 className="mr-2 h-3.5 w-3.5 animate-spin" />
                                    : <ExternalLink className="mr-2 h-3.5 w-3.5" />}
                                  Preskusi
                                </Button>
                              )}
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>
                );
              })}
            </div>
          )}
        </CardContent>
        {selected.length > 0 && (
          <CardFooter className="bg-muted/30 border-t py-3 px-6 flex justify-between items-center text-sm text-muted-foreground">
            <span>Izbranih <strong>{selected.length}</strong> miz za akcijo.</span>
            <Button variant="ghost" size="sm" className="h-8" onClick={() => setSelected([])}>Počisti izbiro</Button>
          </CardFooter>
        )}
      </Card>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileDown className="h-5 w-5 text-muted-foreground" />
              Izvoz konfiguracije
            </CardTitle>
            <CardDescription>Varno shranite strukturo miz in prostorov. Datoteka ne vsebuje QR žetonov ali skrivnosti.</CardDescription>
          </CardHeader>
          <CardContent>
            <Button variant="outline" onClick={exportBackup} disabled={!pregled} className="w-full sm:w-auto" data-testid="button-export-qr-backup">
              <Download className="mr-2 h-4 w-4" />
              Prenesi JSON datoteko
            </Button>
          </CardContent>
        </Card>

        <Card className="shadow-sm">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-lg">
              <FileUp className="h-5 w-5 text-muted-foreground" />
              Uvoz konfiguracije
            </CardTitle>
            <CardDescription>Obnovite izbrisane mize in prostore iz predhodne varnostne kopije. Najprej sledi preizkus uvoza.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex flex-col sm:flex-row gap-3">
              <Label className="flex items-center justify-center gap-2 cursor-pointer rounded-md border border-dashed bg-muted/30 hover:bg-muted transition-colors px-4 py-2.5 text-sm font-medium w-full sm:w-auto h-10 border-input">
                <Upload className="h-4 w-4 text-muted-foreground" />
                Izberi JSON datoteko
                <Input type="file" accept="application/json" className="hidden" onChange={(event) => void dryRunImport(event.target.files?.[0])} data-testid="input-import-qr-backup" />
              </Label>
              {pendingImport && (
                <Button disabled={importing} onClick={() => void runImport(pendingImport, "apply")} className="w-full sm:w-auto" data-testid="button-apply-qr-import">
                  {importing ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <CheckCircle2 className="mr-2 h-4 w-4" />}
                  Potrdi uvoz
                </Button>
              )}
            </div>
            {importReport && (
              <div className={`p-3 text-sm rounded-md border flex gap-3 ${pendingImport ? 'bg-amber-500/10 border-amber-500/20 text-amber-800 dark:text-amber-400' : 'bg-muted/50 border-border text-foreground'}`} data-testid="status-import-dry-run">
                {pendingImport ? <AlertTriangle className="h-5 w-5 shrink-0 mt-0.5" /> : <CheckCircle2 className="h-5 w-5 shrink-0 text-emerald-600 mt-0.5" />}
                <p className="leading-relaxed">{importReport}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <AlertDialog open={rotateConfirmOpen} onOpenChange={setRotateConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Potrditev rotacije QR kod</AlertDialogTitle>
            <AlertDialogDescription className="space-y-3">
              <p>
                Rotacija takoj in nepreklicno prekliče stare QR povezave za izbrane mize v prostoru <strong>{rotateConfirmProstor?.ime}</strong>.
              </p>
              <div className="rounded-md bg-destructive/10 p-3 text-sm text-destructive border border-destructive/20">
                <p className="font-semibold mb-1">Opozorilo:</p>
                Gostje starih kod ne bodo več mogli uporabljati. Natisnjene nalepke morate zamenjati takoj.
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Prekliči</AlertDialogCancel>
            <AlertDialogAction onClick={handleConfirmRotate} className="bg-destructive hover:bg-destructive/90 text-destructive-foreground">
              Rotiraj in prenesi PDF
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </main>
  );
}
