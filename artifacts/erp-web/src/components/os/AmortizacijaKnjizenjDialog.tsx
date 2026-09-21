/**
 * AmortizacijaKnjizenjDialog.tsx — Dialog za pripravo osnutka temeljnice amortizacije (Faza 3c/2)
 *
 * Tok:
 *  1. "nastavitve"  — preveri / nastavi konta (strošek + popravek)
 *  2. "mesec"       — izberi vrsto obračuna (letni/mesečni); BEZ klica na accounting_periods
 *  3. "predogled"   — dryRun=true → prikaži agregirane vrstice
 *                     → gumbi: Izpis PDF / Izpis CSV (vedno) + Ustvari osnutek (samo GLK)
 *  4. "potrjeno"    — samo GLK podjetja: entryId + link na temeljnico
 *
 * NIKOLI ne ustvari potrjene temeljnice. Vedno status = "draft".
 * OS-only podjetja (hasGlkModule=false): tok se konča s PDF/CSV izpisom.
 * GLK podjetja (hasGlkModule=true): GLK obdobje se izpelje samodejno iz leta obračuna.
 */

import React, { useState, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AlertCircle,
  CheckCircle2,
  Download,
  ExternalLink,
  Loader2,
  Settings,
  FileText,
  ChevronRight,
  TriangleAlert,
} from "lucide-react";
import {
  useGetOsAmortizacijaNastavitve,
  useUpdateOsAmortizacijaNastavitve,
  usePostOsAmortizacijaKnjizenje,
  useOsAmortizacijaIzpis,
  type KnjizenjePredogled,
  type KnjizenjePotrditev,
} from "@workspace/api-client-react";
import { useLocation } from "wouter";

// ─── Tipi ─────────────────────────────────────────────────────────────────────

type Step = "nastavitve" | "mesec" | "predogled" | "potrjeno";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  companyId: string;
  leto: number;
  skupajRacunovodska: string;
}

// ─── Pomožna: format EUR ──────────────────────────────────────────────────────

function fmtEur(v: string): string {
  const n = parseFloat(v);
  return isNaN(n) ? v : n.toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

// ─── Pomožna: meseci ──────────────────────────────────────────────────────────

const MESECI = [
  { v: 1,  label: "Januar" },
  { v: 2,  label: "Februar" },
  { v: 3,  label: "Marec" },
  { v: 4,  label: "April" },
  { v: 5,  label: "Maj" },
  { v: 6,  label: "Junij" },
  { v: 7,  label: "Julij" },
  { v: 8,  label: "Avgust" },
  { v: 9,  label: "September" },
  { v: 10, label: "Oktober" },
  { v: 11, label: "November" },
  { v: 12, label: "December" },
];

// ─── Komponenta: Nastavitve konta ────────────────────────────────────────────

function KontaForm({
  companyId,
  onSaved,
}: {
  companyId: string;
  onSaved: () => void;
}) {
  const { data: nastavitve, isLoading, refetch } = useGetOsAmortizacijaNastavitve(companyId);
  const updateMut = useUpdateOsAmortizacijaNastavitve(companyId);

  const thisYear = new Date().getFullYear();
  const letoOptions = Array.from({ length: thisYear - 2010 + 3 }, (_, i) => 2010 + i).reverse();

  const [stroskaKoda, setStroskaKoda] = useState(nastavitve?.kontoStroskaCode ?? "");
  const [popravkaKoda, setPopravkaKoda] = useState(nastavitve?.kontoPopravkaCode ?? "");
  const [osLetoVal, setOsLetoVal] = useState<string>(
    nastavitve?.osLeto ? String(nastavitve.osLeto) : "__/"
  );
  const [praviloVal, setPraviloVal] = useState<"naslednji_dan" | "naslednji_mesec">(
    nastavitve?.praviloZacetkaAmortizacije ?? "naslednji_dan"
  );
  const [errMsg, setErrMsg] = useState<string | null>(null);

  React.useEffect(() => {
    if (nastavitve) {
      setStroskaKoda(nastavitve.kontoStroskaCode ?? "");
      setPopravkaKoda(nastavitve.kontoPopravkaCode ?? "");
      setOsLetoVal(nastavitve.osLeto ? String(nastavitve.osLeto) : "__/");
      setPraviloVal(nastavitve.praviloZacetkaAmortizacije ?? "naslednji_dan");
    }
  }, [nastavitve]);

  const handleSave = useCallback(async () => {
    setErrMsg(null);
    if (!stroskaKoda.trim() || !popravkaKoda.trim()) {
      setErrMsg("Oba konta sta obvezna.");
      return;
    }
    const osLetoNum = osLetoVal === "__/" ? null : parseInt(osLetoVal, 10);
    try {
      await updateMut.mutateAsync({
        kontoStroskaKoda: stroskaKoda.trim(),
        kontoPopravkaKoda: popravkaKoda.trim(),
        osLeto: osLetoNum,
        praviloZacetkaAmortizacije: praviloVal,
      });
      await refetch();
      onSaved();
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : "Napaka pri shranjevanju nastavitev.");
    }
  }, [stroskaKoda, popravkaKoda, osLetoVal, updateMut, refetch, onSaved]);

  if (isLoading) return <div className="flex justify-center py-4"><Loader2 className="h-5 w-5 animate-spin text-muted-foreground" /></div>;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Nastavi privzeta konta in aktivno leto amortizacije. Sredstva z lastnim konto-parom bodo
        upora­bila svojega. Leto OS modula je <strong>neodvisno</strong> od glavne knjige.
      </p>

      {nastavitve?.kontoStroskaId && nastavitve?.kontoPopravkaId ? (
        <Alert className="border-green-200 bg-green-50/60">
          <CheckCircle2 className="h-4 w-4 text-green-600" />
          <AlertDescription className="text-green-800 text-sm">
            Konto stroška: <strong>{nastavitve.kontoStroskaCode}</strong> {nastavitve.kontoStroskaName} ·{" "}
            Konto popravka: <strong>{nastavitve.kontoPopravkaCode}</strong> {nastavitve.kontoPopravkaName}
          </AlertDescription>
        </Alert>
      ) : (
        <Alert className="border-amber-200 bg-amber-50/60">
          <TriangleAlert className="h-4 w-4 text-amber-600" />
          <AlertDescription className="text-amber-800 text-sm">
            Privzeta konta niso nastavljena. Vnesi kodi obeh kontov pred prvim knjiženjem.
          </AlertDescription>
        </Alert>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Konto stroška amortizacije (V BREME)
          </label>
          <Input
            placeholder="npr. 4300"
            value={stroskaKoda}
            onChange={(e) => setStroskaKoda(e.target.value)}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">Skupina 43x — stroški amortizacije</p>
        </div>
        <div className="space-y-1.5">
          <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Konto popravka vrednosti (V DOBRO)
          </label>
          <Input
            placeholder="npr. 0190"
            value={popravkaKoda}
            onChange={(e) => setPopravkaKoda(e.target.value)}
            className="font-mono"
          />
          <p className="text-xs text-muted-foreground">Skupina 01x/02x/03x — popravki vrednosti</p>
        </div>
      </div>

      {/* Aktivno leto OS — lastno, neodvisno od GLK */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Aktivno leto amortizacije (OS modul)
        </label>
        <Select value={osLetoVal} onValueChange={setOsLetoVal}>
          <SelectTrigger className="w-40">
            <SelectValue placeholder="Ni nastavljeno" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__/">Ni nastavljeno</SelectItem>
            {letoOptions.map((y) => (
              <SelectItem key={y} value={String(y)}>{y}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Privzeto leto na obračunski strani. Neodvisno od računovodskih obdobij glavne knjige.
        </p>
      </div>

      {/* Pravilo začetka amortizacije */}
      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Pravilo začetka amortizacije
        </label>
        <Select
          value={praviloVal}
          onValueChange={(v) => setPraviloVal(v as "naslednji_dan" | "naslednji_mesec")}
        >
          <SelectTrigger className="w-72">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="naslednji_dan">Naslednji dan — mesec dneva po aktivaciji</SelectItem>
            <SelectItem value="naslednji_mesec">Naslednji mesec — mesec po mesecu aktivacije</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          <strong>Naslednji dan</strong>: akt. 30.10 → od okt. (3 mes.); akt. 31.10 → od nov. (2 mes.).{" "}
          <strong>Naslednji mesec</strong>: akt. 30.10 <em>ali</em> 31.10 → oba od novembra (2 mes.).
          Razlika nastane le, ko aktivacija NI zadnji dan v mesecu.
        </p>
      </div>

      {errMsg && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{errMsg}</AlertDescription>
        </Alert>
      )}

      <DialogFooter>
        <Button onClick={handleSave} disabled={updateMut.isPending}>
          {updateMut.isPending ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Settings className="h-4 w-4 mr-2" />}
          Shrani nastavitve
        </Button>
        {nastavitve?.kontoStroskaId && nastavitve?.kontoPopravkaId && (
          <Button variant="outline" onClick={onSaved}>
            Naprej
            <ChevronRight className="h-4 w-4 ml-1" />
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

// ─── Komponenta: Izbira meseca (nadomestek za IzbijaOdobraForm) ───────────────
//
// Zamenjuje stari IzbijaOdobraForm, ki je klical useListPeriods (GET accounting-periods).
// Nova komponenta ne kliče GLK endpoints — deluje za OS-only in GLK podjetja.

function MesecForm({
  leto,
  skupajRacunovodska,
  onIzbran,
}: {
  leto: number;
  skupajRacunovodska: string;
  onIzbran: (mesec: number | undefined) => void;
}) {
  const [mesec, setMesec] = useState<string>("__letni__");

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        Skupaj računovodska amortizacija: <strong>{fmtEur(skupajRacunovodska)} €</strong>.
        Izberi vrsto obračuna za leto {leto}.
      </p>

      <div className="space-y-1.5">
        <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
          Vrsta obračuna
        </label>
        <Select value={mesec} onValueChange={setMesec}>
          <SelectTrigger>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="__letni__">Letni obračun — {leto}</SelectItem>
            {MESECI.map(m => (
              <SelectItem key={m.v} value={String(m.v)}>
                Mesečni — {m.label} {leto}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">
          Letni obračun = skupna letna amortizacija. Mesečni = 1/12 letne za aktivna sredstva v izbranem mesecu.
        </p>
      </div>

      <DialogFooter>
        <Button
          onClick={() => {
            const m = mesec === "__letni__" ? undefined : parseInt(mesec, 10);
            onIzbran(m);
          }}
        >
          <FileText className="h-4 w-4 mr-2" />
          Pripravi predogled
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── Pomožna: sprozi prenos blob-a ───────────────────────────────────────────

function downloadBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

// ─── Komponenta: Predogled ────────────────────────────────────────────────────

function PredogledView({
  companyId,
  leto,
  mesec,
  hasGlkModule,
  onPotrdi,
  onNazaj,
}: {
  companyId: string;
  leto: number;
  mesec: number | undefined;
  hasGlkModule: boolean;
  onPotrdi: (potrditev: KnjizenjePotrditev) => void;
  onNazaj: () => void;
}) {
  const dryRunMut = usePostOsAmortizacijaKnjizenje(companyId);
  const confirmMut = usePostOsAmortizacijaKnjizenje(companyId);
  const izpisMut = useOsAmortizacijaIzpis(companyId);
  const [predogled, setPredogled] = useState<KnjizenjePredogled | null>(null);
  const [errMsg, setErrMsg] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);

  // Poženi predogled takoj ob prikazu — BEZ periodId
  React.useEffect(() => {
    dryRunMut.mutate(
      { leto, mesec, dryRun: true },
      {
        onSuccess: (res: KnjizenjePredogled | KnjizenjePotrditev) => setPredogled(res as KnjizenjePredogled),
        onError: (e: Error) => setErrMsg(e.message),
      },
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handlePotrdi = useCallback(async () => {
    setErrMsg(null);
    setConfirming(true);
    try {
      const result = await confirmMut.mutateAsync({ leto, mesec, dryRun: false });
      onPotrdi(result as KnjizenjePotrditev);
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : "Napaka pri ustvarjanju temeljnice.");
      setConfirming(false);
    }
  }, [confirmMut, leto, mesec, onPotrdi]);

  const handleIzpis = useCallback(async (format: "pdf" | "csv") => {
    setErrMsg(null);
    try {
      const blob = await izpisMut.mutateAsync({ leto, format });
      downloadBlob(blob, `amortizacija-${leto}.${format}`);
    } catch (e: unknown) {
      setErrMsg(e instanceof Error ? e.message : "Napaka pri generiranju izpisa.");
    }
  }, [izpisMut, leto]);

  const obdobje = mesec !== undefined
    ? `${MESECI.find(m => m.v === mesec)?.label} ${leto}`
    : `Letni ${leto}`;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <FileText className="h-4 w-4 text-muted-foreground" />
        <span className="text-sm font-medium">Predogled knjižbe — {obdobje}</span>
        {predogled && (
          <Badge variant="secondary" className="bg-orange-100 text-orange-800 border-orange-200 ml-auto">
            OSNUTEK
          </Badge>
        )}
      </div>

      {dryRunMut.isPending && (
        <div className="flex items-center gap-2 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" />
          Izračunavam amortizacijo…
        </div>
      )}

      {errMsg && (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>{errMsg}</AlertDescription>
        </Alert>
      )}

      {predogled && (
        <>
          <div className="grid grid-cols-3 gap-3 text-center">
            <div className="rounded-lg border p-3 space-y-1">
              <div className="text-xs text-muted-foreground">Referenca</div>
              <div className="font-mono text-sm font-semibold">{predogled.referenca}</div>
            </div>
            <div className="rounded-lg border p-3 space-y-1">
              <div className="text-xs text-muted-foreground">Skupaj breme = dobro</div>
              <div className="font-mono text-sm font-semibold text-green-700">
                {fmtEur(predogled.skupajBreme)} €
              </div>
            </div>
            <div className="rounded-lg border p-3 space-y-1">
              <div className="text-xs text-muted-foreground">Sredstev / brez kontov</div>
              <div className="text-sm font-semibold">
                {predogled.steviloSredstev}
                {predogled.brezKontov > 0 && (
                  <span className="text-amber-600 ml-1">({predogled.brezKontov} ∅)</span>
                )}
              </div>
            </div>
          </div>

          {predogled.brezKontov > 0 && (
            <Alert variant="destructive">
              <TriangleAlert className="h-4 w-4" />
              <AlertDescription className="text-sm">
                <strong>{predogled.brezKontov} od {predogled.steviloSredstev} sredstev</strong> z
                amortizacijo nima veljavnih knjižbenih kontov (neaktiven, skupinski konto,
                cross-company ID ali manjkajoča obvezna dimenzija).
                <br />
                <strong>GLK temeljnica ne bo ustvarjena, dokler ne popraviš konte za ta sredstva.</strong>
              </AlertDescription>
            </Alert>
          )}

          {predogled.vrstice.length === 0 ? (
            <Alert className="border-amber-200 bg-amber-50/60">
              <TriangleAlert className="h-4 w-4 text-amber-600" />
              <AlertDescription className="text-amber-800 text-sm">
                Ni sredstev z amortizacijo za to obdobje — knjižba bi bila prazna.
              </AlertDescription>
            </Alert>
          ) : (
            <div className="rounded-md border overflow-auto max-h-52">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="text-xs">Konto stroška (breme)</TableHead>
                    <TableHead className="text-xs">Konto popravka (dobro)</TableHead>
                    <TableHead className="text-xs text-right">Sredstev</TableHead>
                    <TableHead className="text-xs text-right">Znesek (€)</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {predogled.vrstice.map((v) => (
                    <TableRow key={`${v.kontoStroskaId}::${v.kontoPopravkaId}`}>
                      <TableCell className="text-xs font-mono">
                        <span className="font-semibold">{v.kontoStroskaCode}</span>
                        {v.kontoStroskaName && <span className="text-muted-foreground ml-1">{v.kontoStroskaName}</span>}
                      </TableCell>
                      <TableCell className="text-xs font-mono">
                        <span className="font-semibold">{v.kontoPopravkaCode}</span>
                        {v.kontoPopravkaName && <span className="text-muted-foreground ml-1">{v.kontoPopravkaName}</span>}
                      </TableCell>
                      <TableCell className="text-xs text-right">{v.steviloSredstev}</TableCell>
                      <TableCell className="text-xs text-right font-mono font-semibold">
                        {fmtEur(v.znesek)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </>
      )}

      {/* Opis za OS-only podjetja */}
      {!hasGlkModule && !dryRunMut.isPending && predogled && (
        <Alert className="border-blue-200 bg-blue-50/60">
          <FileText className="h-4 w-4 text-blue-600" />
          <AlertDescription className="text-blue-800 text-sm">
            Podjetje nima GLK modula — amortizacijo shranite kot izpis (PDF ali CSV).
          </AlertDescription>
        </Alert>
      )}

      <DialogFooter className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={onNazaj} disabled={confirming || izpisMut.isPending}>
          ← Nazaj
        </Button>

        {/* Izpis gumbi — dostopni vsem OS vlogam */}
        <Button
          variant="outline"
          onClick={() => handleIzpis("pdf")}
          disabled={izpisMut.isPending || dryRunMut.isPending}
        >
          {izpisMut.isPending ? (
            <Loader2 className="h-4 w-4 mr-2 animate-spin" />
          ) : (
            <Download className="h-4 w-4 mr-2" />
          )}
          Izpis PDF
        </Button>
        <Button
          variant="outline"
          onClick={() => handleIzpis("csv")}
          disabled={izpisMut.isPending || dryRunMut.isPending}
        >
          <Download className="h-4 w-4 mr-2" />
          Izpis CSV
        </Button>

        {/* GLK osnutek — samo za GLK podjetja */}
        {hasGlkModule && (
          <Button
            onClick={handlePotrdi}
            disabled={confirming || !predogled || predogled.vrstice.length === 0 || predogled.brezKontov > 0}
            className="bg-orange-600 hover:bg-orange-700 text-white"
          >
            {confirming ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <FileText className="h-4 w-4 mr-2" />}
            Ustvari osnutek temeljnice
          </Button>
        )}
      </DialogFooter>
    </div>
  );
}

// ─── Komponenta: Potrjeno (samo GLK podjetja) ─────────────────────────────────

function PotrjenoView({
  potrditev,
  onZapri,
}: {
  potrditev: KnjizenjePotrditev;
  onZapri: () => void;
}) {
  const [, setLocation] = useLocation();

  return (
    <div className="space-y-4">
      <Alert className="border-green-200 bg-green-50/60">
        <CheckCircle2 className="h-4 w-4 text-green-600" />
        <AlertDescription className="text-green-800">
          <div className="font-semibold mb-1">Osnutek temeljnice uspešno ustvarjen!</div>
          <div className="text-sm space-y-1">
            <div>Referenca: <span className="font-mono font-semibold">{potrditev.referenca}</span></div>
            <div>Skupaj breme = dobro: <span className="font-mono font-semibold">{fmtEur(potrditev.skupajBreme)} €</span></div>
            <div>Število vrstic: <span className="font-semibold">{potrditev.steviloVrstic}</span></div>
          </div>
        </AlertDescription>
      </Alert>

      <Alert className="border-orange-200 bg-orange-50/60">
        <TriangleAlert className="h-4 w-4 text-orange-600" />
        <AlertDescription className="text-orange-800 text-sm">
          <strong>Temeljnica je OSNUTEK.</strong> Za knjiženje v glavno knjigo jo moraš ročno
          pregledati in potrditi v modulu Temeljnice.
        </AlertDescription>
      </Alert>

      <DialogFooter>
        <Button variant="outline" onClick={onZapri}>
          Zapri
        </Button>
        <Button
          onClick={() => {
            setLocation("/temeljnice");
            onZapri();
          }}
        >
          <ExternalLink className="h-4 w-4 mr-2" />
          Odpri Temeljnice
        </Button>
      </DialogFooter>
    </div>
  );
}

// ─── Glavni dialog ────────────────────────────────────────────────────────────

export function AmortizacijaKnjizenjDialog({ open, onOpenChange, companyId, leto, skupajRacunovodska }: Props) {
  const [step, setStep] = useState<Step>("nastavitve");
  const [mesec, setMesec] = useState<number | undefined>(undefined);
  const [potrditev, setPotrditev] = useState<KnjizenjePotrditev | null>(null);

  const { data: nastavitve } = useGetOsAmortizacijaNastavitve(companyId);
  const hasGlk = nastavitve?.hasGlkModule ?? false;

  // Ko se dialog odpre, določi začetni korak
  React.useEffect(() => {
    if (open) {
      if (nastavitve?.kontoStroskaId && nastavitve?.kontoPopravkaId) {
        setStep("mesec");
      } else {
        setStep("nastavitve");
      }
    }
  }, [open, nastavitve?.kontoStroskaId, nastavitve?.kontoPopravkaId]);

  const handleClose = useCallback(() => {
    onOpenChange(false);
    setTimeout(() => {
      setStep("nastavitve");
      setMesec(undefined);
      setPotrditev(null);
    }, 300);
  }, [onOpenChange]);

  const stepTitles: Record<Step, string> = {
    nastavitve: "Nastavitve kontov amortizacije",
    mesec:      "Vrsta obračuna",
    predogled:  "Predogled knjižbe",
    potrjeno:   "Osnutek ustvarjen",
  };

  const mesecLabel = mesec !== undefined
    ? ` — ${MESECI.find(m => m.v === mesec)?.label} ${leto}`
    : ` — Letni ${leto}`;

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-orange-600" />
            {stepTitles[step]}
            {step === "predogled" && <span className="text-sm text-muted-foreground font-normal">{mesecLabel}</span>}
          </DialogTitle>
          <DialogDescription>
            {step === "nastavitve" && "Določi privzeta konta za knjiženje amortizacije v dvojnem knjigovodstvu."}
            {step === "mesec" && `Amortizacija ${leto}: ${fmtEur(skupajRacunovodska)} € skupaj (računovodska).`}
            {step === "predogled" && "Preglej agregirane vrstice. Prenesi izpis ali ustvari GLK osnutek."}
            {step === "potrjeno" && "Temeljnica čaka na ročno potrditev v modulu Temeljnice."}
          </DialogDescription>
        </DialogHeader>

        {/* ── Indikator korakov ───────────────────────────────────────────── */}
        {step !== "potrjeno" && (
          <div className="flex items-center gap-1 text-xs text-muted-foreground mb-1">
            {(["nastavitve", "mesec", "predogled"] as Step[]).map((s, i) => (
              <React.Fragment key={s}>
                {i > 0 && <ChevronRight className="h-3 w-3" />}
                <span className={step === s ? "text-foreground font-medium" : ""}>
                  {i + 1}. {s === "nastavitve" ? "Konta" : s === "mesec" ? "Mesec" : "Predogled"}
                </span>
              </React.Fragment>
            ))}
          </div>
        )}

        {/* ── Vsebina koraka ───────────────────────────────────────────────── */}
        {step === "nastavitve" && (
          <KontaForm
            companyId={companyId}
            onSaved={() => setStep("mesec")}
          />
        )}

        {step === "mesec" && (
          <MesecForm
            leto={leto}
            skupajRacunovodska={skupajRacunovodska}
            onIzbran={(m) => {
              setMesec(m);
              setStep("predogled");
            }}
          />
        )}

        {step === "predogled" && (
          <PredogledView
            companyId={companyId}
            leto={leto}
            mesec={mesec}
            hasGlkModule={hasGlk}
            onPotrdi={(p) => { setPotrditev(p); setStep("potrjeno"); }}
            onNazaj={() => setStep("mesec")}
          />
        )}

        {step === "potrjeno" && potrditev && (
          <PotrjenoView potrditev={potrditev} onZapri={handleClose} />
        )}
      </DialogContent>
    </Dialog>
  );
}
