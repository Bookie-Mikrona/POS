// artifacts/pos/src/pages/uvoz/UvozPrejemniceDialog.tsx
//
// Adapter med REST /api/uvoz/* in UparjanjeDialog/NovArtikelDialog komponentama.
// Podpira tri načine uvoza:
//   • Datoteka — CSV, XLSX, XML (e-SLOG), PDF
//   • Kamera / Skener — Claude Vision OCR (mobilni fotoaparat)
//   • Skeniraj — direkten zajem iz Windows HP scannerja prek lokalnega bridge-a

import { useState, useRef, useCallback, useEffect } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Upload, Camera, AlertTriangle, X, ScanLine, Scan, Wifi, WifiOff, ChevronDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { UparjanjeDialog, type NeuparjenaPostavka, type Kandidat } from './UparjanjeDialog';
import { NovArtikelDialog, type NovArtikelVhod } from './NovArtikelDialog';

// ─── Statični podatki ──────────────────────────────────────────────────────

const DDV_OPC = [
  { id: 1, koda: 'standard',  naziv: '22 % – splošna',  stopnjaPriMizi: '22'  },
  { id: 2, koda: 'znizana',   naziv: '9,5 % – znižana', stopnjaPriMizi: '9.5' },
  { id: 3, koda: 'nizka',     naziv: '5 % – znižana',   stopnjaPriMizi: '5'   },
  { id: 4, koda: 'oprosceno', naziv: '0 % – oproščeno', stopnjaPriMizi: '0'   },
];

const ENOTE_MERE = ['kom','kg','g','l','dl','ml','m','m²','m³','par','pak','šk','pal','set'];

// Scanner bridge nastavitve
const BRIDGE_URL    = 'http://localhost:8765';
const BRIDGE_TIMEOUT = 4000; // ms za health check

// ─── Tipi ──────────────────────────────────────────────────────────────────

export interface NabavniArtikel {
  id: number;
  ime: string;
  enotaMere?: string | null;
  davek: number;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onUvozDone: () => void;
  onOdpriPrejemnico?: (id: number) => void;
  nabavniArtikli: NabavniArtikel[];
  dobaviteljiMap: Map<number, string>;
}

type Korak = 'upload' | 'uparjanje' | 'nov_artikel';
type Nacin = 'datoteka' | 'kamera' | 'skener';

interface UvozIzid {
  prejemnicaId: number;
  dobaviteljId: number | null;
  dobaviteljNaziv: string;
  stDokumenta: string | null;
  datumDokumenta: string | null;
  ceneBruto: boolean;
  uparjenih: number;
}

interface BridgeScanner {
  id: string;
  name: string;
}

interface BridgeStatus {
  aktiven: boolean;
  scanners: BridgeScanner[];
}

// ─── Pomožne funkcije ──────────────────────────────────────────────────────

function enotaHeader(): Record<string, string> {
  const id = localStorage.getItem('enotaId');
  return id ? { 'X-Enota-Id': id } : {};
}

async function zmanjsajSliko(file: File): Promise<{ base64: string; preview: string; mimeTip: string }> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        const maxW = 1600, maxH = 2000;
        let w = img.width, h = img.height;
        if (w > maxW || h > maxH) {
          const ratio = Math.min(maxW / w, maxH / h);
          w = Math.round(w * ratio);
          h = Math.round(h * ratio);
        }
        const canvas = document.createElement('canvas');
        canvas.width = w; canvas.height = h;
        const ctx = canvas.getContext('2d')!;
        ctx.drawImage(img, 0, 0, w, h);
        const preview = canvas.toDataURL('image/jpeg', 0.7);
        const base64  = canvas.toDataURL('image/jpeg', 0.85).split(',')[1]!;
        resolve({ base64, preview, mimeTip: 'image/jpeg' });
      };
      img.onerror = reject;
      img.src = e.target!.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

// ─── Komponenta ────────────────────────────────────────────────────────────

export function UvozPrejemniceDialog({
  open,
  onClose,
  onUvozDone,
  onOdpriPrejemnico,
  nabavniArtikli,
  dobaviteljiMap,
}: Props) {
  const { toast } = useToast();
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');

  // ─── Dialog stanje ─────────────────────────────────────────────────────
  const [korak,              setKorak]              = useState<Korak>('upload');
  const [nacin,              setNacin]              = useState<Nacin>('datoteka');
  const [nalaga,             setNalaga]             = useState(false);
  const [napaka,             setNapaka]             = useState<string | null>(null);
  const [izid,               setIzid]               = useState<UvozIzid | null>(null);
  const [neuparjene,         setNeuparjene]         = useState<NeuparjenaPostavka[]>([]);
  const [stUparjenih,        setStUparjenih]        = useState(0);
  const [podvojenoPrejId,    setPodvojenoPrejId]    = useState<number | null>(null);
  const [novArtikelPostavka, setNovArtikelPostavka] = useState<NeuparjenaPostavka | null>(null);

  // OCR slika (kamera ali scanner)
  const [slikaBase64,  setSlikaBase64]  = useState<string | null>(null);
  const [slikaPreview, setSlikaPreview] = useState<string | null>(null);
  const [slikaMime,    setSlikaMime]    = useState<string>('image/jpeg');

  // Scanner bridge stanje
  const [bridge,           setBridge]           = useState<BridgeStatus | null>(null);
  const [bridgeNalaga,     setBridgeNalaga]     = useState(false);
  const [izbraniScanner,   setIzbraniScanner]   = useState<string | null>(null);
  const [skeniraNalaga,    setSkeniraNalaga]    = useState(false);

  const fileInputRef   = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  // ─── Bridge health check ───────────────────────────────────────────────
  const preveribridge = useCallback(async () => {
    setBridgeNalaga(true);
    try {
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), BRIDGE_TIMEOUT);
      const r = await fetch(`${BRIDGE_URL}/health`, {
        signal: ctrl.signal,
        cache: 'no-store',
      });
      clearTimeout(timer);
      if (r.ok) {
        const data = await r.json() as { status: string; scanners: BridgeScanner[] };
        setBridge({ aktiven: true, scanners: data.scanners ?? [] });
        if (data.scanners?.length > 0 && !izbraniScanner) {
          setIzbraniScanner(data.scanners[0]!.id);
        }
      } else {
        setBridge({ aktiven: false, scanners: [] });
      }
    } catch {
      setBridge({ aktiven: false, scanners: [] });
    } finally {
      setBridgeNalaga(false);
    }
  }, [izbraniScanner]);

  // Preveri bridge ko se dialog odpre
  useEffect(() => {
    if (open) {
      void preveribridge();
    }
  }, [open, preveribridge]);

  // ─── Reset stanja ──────────────────────────────────────────────────────
  const resetState = useCallback(() => {
    setKorak('upload');
    setNacin('datoteka');
    setNalaga(false);
    setNapaka(null);
    setIzid(null);
    setNeuparjene([]);
    setStUparjenih(0);
    setPodvojenoPrejId(null);
    setNovArtikelPostavka(null);
    setSlikaBase64(null);
    setSlikaPreview(null);
    setSlikaMime('image/jpeg');
    setSkeniraNalaga(false);
  }, []);

  const zapri = () => { resetState(); onClose(); };

  // ─── Skupna logika po uvozu ────────────────────────────────────────────

  const handleUvozIzid = useCallback(async (data: Record<string, unknown>) => {
    if (!data.prejemnicaId) throw new Error(data.sporocilo as string ?? 'Uvoz ni uspel.');

    const nr = await fetch(
      `${base}/api/uvoz/prejemnice/${data.prejemnicaId}/neuparjeno`,
      { credentials: 'include', headers: enotaHeader() },
    );
    const nd = await nr.json();

    const dobaviteljId: number | null = (data.dobaviteljId as number) ?? null;
    setIzid({
      prejemnicaId:   data.prejemnicaId as number,
      dobaviteljId,
      dobaviteljNaziv: dobaviteljId
        ? (dobaviteljiMap.get(dobaviteljId) ?? (data.dobaviteljNazivOcr as string) ?? 'Neznan dobavitelj')
        : ((data.dobaviteljNazivOcr as string) ?? 'Neznan dobavitelj'),
      stDokumenta:    (data.stDokumenta    as string)  ?? null,
      datumDokumenta: (data.datumDokumenta as string)  ?? null,
      ceneBruto:      !!(data.ceneBruto),
      uparjenih:      (data.uparjenih      as number)  ?? 0,
    });
    setNeuparjene(nd.vsebina ?? []);
    setStUparjenih((data.uparjenih as number) ?? 0);
    setKorak('uparjanje');
  }, [base, dobaviteljiMap]);

  // ─── Upload datoteke ───────────────────────────────────────────────────

  const naloziDatoteko = useCallback(async (datoteka: File) => {
    setNalaga(true);
    setNapaka(null);
    try {
      const fd = new FormData();
      fd.append('datoteka', datoteka);
      const r = await fetch(`${base}/api/uvoz/datoteka`, {
        method: 'POST',
        credentials: 'include',
        headers: enotaHeader(),
        body: fd,
      });
      const data = await r.json();
      if (r.status === 409) {
        const id = (data as { prejemnicaId?: number }).prejemnicaId;
        if (id) { setPodvojenoPrejId(id); } else { setNapaka('Ta dobavnica je bila že uvožena.'); }
        return;
      }
      if (r.status === 422) {
        if (data.status === 'NAPAKA') {
          const prvaNapaka = (data.napake as { sporocilo?: string }[] | undefined)?.[0]?.sporocilo;
          setNapaka(prvaNapaka ?? 'Datoteka vsebuje napake in je ni mogoče uvoziti.');
          return;
        }
        if (data.status === 'MANJKA_DOBAVITELJ') {
          const ime = data.predlogDobavitelja?.naziv ?? '';
          setNapaka(
            `Dobavitelja${ime ? ` „${ime}"` : ''} ni v šifrantu. ` +
            `Dodajte ga med stranke in ponovite uvoz.`
          );
          return;
        }
      }
      if (!r.ok || data.status !== 'OSNUTEK_USTVARJEN') {
        setNapaka(data.sporocilo ?? `Uvoz ni uspel (${data.status ?? r.status}).`); return;
      }
      await handleUvozIzid(data);
    } catch (e) {
      setNapaka((e as Error).message ?? 'Napaka pri nalaganju.');
    } finally {
      setNalaga(false);
    }
  }, [base, handleUvozIzid]);

  // ─── Zajem slike s kamere ──────────────────────────────────────────────

  const onSlikaZajeta = useCallback(async (file: File) => {
    setNapaka(null);
    try {
      const { base64, preview, mimeTip } = await zmanjsajSliko(file);
      setSlikaPreview(preview);
      setSlikaBase64(base64);
      setSlikaMime(mimeTip);
    } catch {
      setNapaka('Slike ni bilo mogoče obdelati. Poskusite znova.');
    }
  }, []);

  // ─── OCR pošiljanje (skupno za kamero in skener) ───────────────────────

  const posljiOcr = useCallback(async () => {
    if (!slikaBase64) return;
    setNalaga(true);
    setNapaka(null);
    try {
      const r = await fetch(`${base}/api/uvoz/ocr`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...enotaHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ slika: slikaBase64, mimeTip: slikaMime }),
      });
      const data = await r.json();

      if (r.status === 409) {
        const id = (data as { prejemnicaId?: number }).prejemnicaId;
        if (id) { setPodvojenoPrejId(id); } else { setNapaka('Ta slika je bila že uvožena.'); }
        return;
      }
      if (r.status === 422 && data.status === 'MANJKA_DOBAVITELJ') {
        const ime = data.dobaviteljNazivOcr ?? data.predlogDobavitelja?.naziv ?? '';
        setNapaka(
          `OCR ni mogel določiti dobavitelja${ime ? ` (${ime})` : ''}. ` +
          `Uvozite datoteko ali ročno dodajte prejemnico.`
        );
        return;
      }
      if (!r.ok || data.status !== 'OSNUTEK_USTVARJEN') {
        setNapaka(data.sporocilo ?? `OCR uvoz ni uspel (${data.status ?? r.status}).`); return;
      }

      if (data.napake?.length) {
        toast({ title: 'OCR opozorilo', description: data.napake[0]?.sporocilo, variant: 'default' });
      }
      await handleUvozIzid(data);
    } catch (e) {
      setNapaka((e as Error).message ?? 'Napaka pri OCR uvozu.');
    } finally {
      setNalaga(false);
    }
  }, [base, slikaBase64, slikaMime, handleUvozIzid, toast]);

  // ─── Skeniranje prek bridge-a ──────────────────────────────────────────

  const skenirај = useCallback(async () => {
    setSkeniraNalaga(true);
    setNapaka(null);
    setSlikaPreview(null);
    setSlikaBase64(null);
    try {
      const r = await fetch(`${BRIDGE_URL}/scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          deviceId: izbraniScanner ?? null,
          dpi:      150,
          color:    false,
          format:   'jpeg',
        }),
      });
      const data = await r.json() as { image?: string; mimeType?: string; detail?: string };
      if (!r.ok || !data.image) {
        throw new Error(data.detail ?? 'Skeniranje ni uspelo.');
      }
      setSlikaBase64(data.image);
      setSlikaMime(data.mimeType ?? 'image/png');
      setSlikaPreview(`data:${data.mimeType ?? 'image/png'};base64,${data.image}`);
    } catch (e) {
      setNapaka((e as Error).message ?? 'Napaka pri skeniranju.');
    } finally {
      setSkeniraNalaga(false);
    }
  }, [izbraniScanner]);

  // ─── Uparjanje callbacki ───────────────────────────────────────────────

  const onUpari = useCallback(async (
    postavkaId: number, artikelId: number, enotVPaketu: string, zapomni: boolean,
  ): Promise<void> => {
    const r = await fetch(`${base}/api/uvoz/postavke/${postavkaId}/upari`, {
      method: 'POST',
      credentials: 'include',
      headers: { ...enotaHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ artikelId, enotVPaketu, zapomni }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error((err as { sporocilo?: string }).sporocilo ?? 'Uparjanje ni uspelo.');
    }
    setNeuparjene(prev => prev.filter(p => p.id !== postavkaId));
    setStUparjenih(prev => prev + 1);
  }, [base]);

  const onIsci = useCallback(async (niz: string): Promise<Kandidat[]> => {
    const q = niz.toLowerCase().trim();
    if (!q) return [];
    return nabavniArtikli
      .filter(a => a.ime.toLowerCase().includes(q))
      .slice(0, 25)
      .map(a => ({
        artikelId:       a.id,
        sifra:           null,
        naziv:           a.ime,
        osnovnaEnota:    a.enotaMere ?? null,
        zadnjaCenaEnota: null,
        enotVPaketu:     null,
        ocena:           0.5,
        znanDobavitelj:  false,
      }));
  }, [nabavniArtikli]);

  const onNovArtikel = useCallback((p: NeuparjenaPostavka) => {
    setNovArtikelPostavka(p);
    setKorak('nov_artikel');
  }, []);

  const onNovArtikelShrani = useCallback(async (v: NovArtikelVhod): Promise<{ artikelId: number }> => {
    const r = await fetch(`${base}/api/artikli`, {
      method: 'POST',
      credentials: 'include',
      headers: { ...enotaHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ime:             v.naziv,
        nabavniArtikel:  true,
        prodajniArtikel: v.tip === 'NABAVNO_PRODAJNI',
        enotaMere:       v.osnovnaEnota,
        davek:           Number(v.nabavnaDdvStopnja),
        gtin:            v.gtin ?? undefined,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error((data as { sporocilo?: string }).sporocilo ?? 'Ustvarjanje artikla ni uspelo.');
    setKorak('uparjanje');
    return { artikelId: (data as { id: number }).id };
  }, [base]);

  const onZakljuci = useCallback(() => {
    toast({
      title: 'Uvoz dokončan',
      description: `${stUparjenih} artikel${stUparjenih === 1 ? '' : 'ov'} uparjenih`,
    });
    onUvozDone();
    zapri();
  }, [stUparjenih, onUvozDone, toast]);

  // ─── Prikaz: nov artikel ───────────────────────────────────────────────

  if (korak === 'nov_artikel' && novArtikelPostavka && izid) {
    return (
      <NovArtikelDialog
        postavka={novArtikelPostavka}
        dobaviteljNaziv={izid.dobaviteljNaziv}
        enote={ENOTE_MERE}
        davcneKategorije={DDV_OPC}
        skupine={[]}
        onShrani={onNovArtikelShrani}
        onPreklici={() => setKorak('uparjanje')}
      />
    );
  }

  // ─── Prikaz: uparjanje ─────────────────────────────────────────────────

  if (korak === 'uparjanje' && izid) {
    return (
      <UparjanjeDialog
        prejemnicaId={izid.prejemnicaId}
        dobaviteljNaziv={izid.dobaviteljNaziv}
        stDokumenta={izid.stDokumenta}
        datum={izid.datumDokumenta}
        ceneBruto={izid.ceneBruto}
        steviloUparjenih={stUparjenih}
        postavke={neuparjene}
        onUpari={onUpari}
        onNovArtikel={onNovArtikel}
        onIsci={onIsci}
        onZakljuci={onZakljuci}
        onPreklici={zapri}
      />
    );
  }

  // ─── Prikaz: upload ────────────────────────────────────────────────────

  // Ali imamo sliko (kamera ali skener) pripravljeno za OCR
  const imaSliko = !!(slikaBase64 && (nacin === 'kamera' || nacin === 'skener'));

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) zapri(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Uvozi dobavnico</DialogTitle>
        </DialogHeader>

        {/* ── Tabs: Datoteka / Kamera / Skeniraj ── */}
        <div className="flex rounded-lg border overflow-hidden text-sm font-medium">
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 transition-colors ${
              nacin === 'datoteka'
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted text-muted-foreground'
            }`}
            onClick={() => { setNacin('datoteka'); setNapaka(null); setSlikaPreview(null); setSlikaBase64(null); }}
          >
            <Upload className="w-3.5 h-3.5" />Datoteka
          </button>
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 transition-colors border-l ${
              nacin === 'kamera'
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted text-muted-foreground'
            }`}
            onClick={() => { setNacin('kamera'); setNapaka(null); setSlikaPreview(null); setSlikaBase64(null); }}
          >
            <Camera className="w-3.5 h-3.5" />Kamera
          </button>
          <button
            className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-2 transition-colors border-l ${
              nacin === 'skener'
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted text-muted-foreground'
            }`}
            onClick={() => { setNacin('skener'); setNapaka(null); setSlikaPreview(null); setSlikaBase64(null); void preveribridge(); }}
          >
            <Scan className="w-3.5 h-3.5" />Skeniraj
          </button>
        </div>

        <div className="space-y-3">
          {/* Podvojena dobavnica */}
          {podvojenoPrejId && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
              <div className="flex items-center gap-2 mb-2">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="font-medium">Ta dobavnica je bila že uvožena.</span>
              </div>
              <Button
                size="sm"
                variant="outline"
                className="w-full border-amber-400 text-amber-900 hover:bg-amber-100"
                onClick={() => {
                  if (onOdpriPrejemnico) {
                    onOdpriPrejemnico(podvojenoPrejId);
                    resetState();
                    onClose();
                  }
                }}
              >
                Odpri prejemnico #{podvojenoPrejId}
              </Button>
            </div>
          )}

          {/* Splošna napaka */}
          {napaka && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 text-destructive p-3 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{napaka}</span>
            </div>
          )}

          {/* ── Datoteka tab ── */}
          {nacin === 'datoteka' && (
            <>
              <div
                role="button"
                tabIndex={0}
                className="border-2 border-dashed rounded-lg p-10 text-center cursor-pointer hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                onClick={() => !nalaga && fileInputRef.current?.click()}
                onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click(); }}
                onDragOver={e => e.preventDefault()}
                onDrop={e => {
                  e.preventDefault();
                  const f = e.dataTransfer.files[0];
                  if (f && !nalaga) naloziDatoteko(f);
                }}
              >
                {nalaga ? (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Loader2 className="w-10 h-10 animate-spin" />
                    <span className="font-medium">Uvažam datoteko…</span>
                  </div>
                ) : (
                  <div className="flex flex-col items-center gap-2 text-muted-foreground">
                    <Upload className="w-10 h-10" />
                    <span className="font-medium text-foreground">Povleci datoteko sem ali klikni</span>
                    <span className="text-xs">CSV, XLSX, XML (e-SLOG), PDF — do 20 MB</span>
                  </div>
                )}
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".xml,.csv,.txt,.xlsx,.xls,.pdf,.json"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) { naloziDatoteko(f); e.target.value = ''; }
                }}
              />
            </>
          )}

          {/* ── Kamera tab ── */}
          {nacin === 'kamera' && (
            <>
              {slikaPreview ? (
                <div className="relative">
                  <img
                    src={slikaPreview}
                    alt="Predogled posnete slike"
                    className="w-full rounded-lg border object-contain max-h-64"
                  />
                  <button
                    className="absolute top-2 right-2 rounded-full bg-background/80 backdrop-blur p-1 hover:bg-background"
                    onClick={() => { setSlikaPreview(null); setSlikaBase64(null); setNapaka(null); }}
                    title="Odstrani sliko"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                <div className="space-y-3">
                  <button
                    className="w-full flex flex-col items-center gap-3 border-2 border-dashed rounded-lg p-8 hover:bg-muted/50 transition-colors cursor-pointer"
                    onClick={() => cameraInputRef.current?.click()}
                  >
                    <Camera className="w-10 h-10 text-muted-foreground" />
                    <div>
                      <p className="font-medium">Fotografiraj dobavnico</p>
                      <p className="text-xs text-muted-foreground mt-0.5">
                        Odpre fotoaparat na mobilnem ali izbiro datoteke
                      </p>
                    </div>
                  </button>
                  <p className="text-center text-xs text-muted-foreground">
                    Claude Vision AI bo samodejno prepoznal postavke, dobavitelja in cene.
                  </p>
                </div>
              )}
              <input
                ref={cameraInputRef}
                type="file"
                accept="image/*"
                capture="environment"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) { onSlikaZajeta(f); e.target.value = ''; }
                }}
              />
            </>
          )}

          {/* ── Skeniraj tab ── */}
          {nacin === 'skener' && (
            <div className="space-y-3">
              {/* Bridge status */}
              <div className={`flex items-center justify-between rounded-md px-3 py-2 text-sm ${
                bridge === null
                  ? 'bg-muted text-muted-foreground'
                  : bridge.aktiven
                  ? 'bg-green-50 border border-green-200 text-green-800'
                  : 'bg-amber-50 border border-amber-200 text-amber-800'
              }`}>
                <div className="flex items-center gap-2">
                  {bridgeNalaga ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : bridge?.aktiven ? (
                    <Wifi className="w-4 h-4" />
                  ) : (
                    <WifiOff className="w-4 h-4" />
                  )}
                  <span>
                    {bridgeNalaga
                      ? 'Preverjam most…'
                      : bridge === null
                      ? 'Preverjam...'
                      : bridge.aktiven
                      ? `Most aktiven · ${bridge.scanners.length} scanner${bridge.scanners.length !== 1 ? 'jev' : ''}`
                      : 'Scanner most ni zaznan'}
                  </span>
                </div>
                <button
                  className="text-xs underline opacity-70 hover:opacity-100"
                  onClick={() => void preveribridge()}
                  disabled={bridgeNalaga}
                >
                  Osveži
                </button>
              </div>

              {/* Scanner ni aktiven — navodila */}
              {bridge && !bridge.aktiven && (
                <div className="rounded-md bg-muted p-3 text-xs text-muted-foreground space-y-1">
                  <p className="font-medium text-foreground">Namestite Scanner Bridge:</p>
                  <ol className="list-decimal list-inside space-y-0.5">
                    <li>Prenesite <code>ScannerBridge.exe</code> iz mape <code>scanner-bridge/dist/</code></li>
                    <li>Zaženite <code>ScannerBridge.exe</code> (ikona v system tray-u)</li>
                    <li>Kliknite Osveži zgoraj</li>
                  </ol>
                </div>
              )}

              {/* Izbira scannerja (če jih je več) */}
              {bridge?.aktiven && bridge.scanners.length > 1 && (
                <div className="relative">
                  <select
                    className="w-full rounded-md border bg-background px-3 py-2 text-sm pr-8 appearance-none"
                    value={izbraniScanner ?? ''}
                    onChange={e => setIzbraniScanner(e.target.value)}
                  >
                    {bridge.scanners.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                  <ChevronDown className="absolute right-2 top-2.5 w-4 h-4 text-muted-foreground pointer-events-none" />
                </div>
              )}

              {/* Predogled skeniranega dokumenta */}
              {slikaPreview ? (
                <div className="relative">
                  <img
                    src={slikaPreview}
                    alt="Predogled skeniranega dokumenta"
                    className="w-full rounded-lg border object-contain max-h-64"
                  />
                  <button
                    className="absolute top-2 right-2 rounded-full bg-background/80 backdrop-blur p-1 hover:bg-background"
                    onClick={() => { setSlikaPreview(null); setSlikaBase64(null); setNapaka(null); }}
                    title="Odstrani sken"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                /* Gumb za skeniranje */
                <button
                  disabled={!bridge?.aktiven || skeniraNalaga || nalaga}
                  className="w-full flex flex-col items-center gap-3 border-2 border-dashed rounded-lg p-8 transition-colors disabled:opacity-40 disabled:cursor-not-allowed enabled:hover:bg-muted/50 enabled:cursor-pointer"
                  onClick={() => void skenirај()}
                >
                  {skeniraNalaga ? (
                    <>
                      <Loader2 className="w-10 h-10 text-muted-foreground animate-spin" />
                      <div>
                        <p className="font-medium">Skeniram dokument…</p>
                        <p className="text-xs text-muted-foreground mt-0.5">Položite dokument v scanner</p>
                      </div>
                    </>
                  ) : (
                    <>
                      <Scan className="w-10 h-10 text-muted-foreground" />
                      <div>
                        <p className="font-medium">Skeniraj dokument</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          {bridge?.aktiven && bridge.scanners.length > 0
                            ? bridge.scanners.find(s => s.id === izbraniScanner)?.name ?? bridge.scanners[0]?.name ?? 'HP Scanner'
                            : 'Scanner ni priključen'}
                          {' · 150 dpi · sivinska'}
                        </p>
                      </div>
                    </>
                  )}
                </button>
              )}

              <p className="text-center text-xs text-muted-foreground">
                Claude Vision AI bo samodejno prepoznal postavke, dobavitelja in cene.
              </p>
            </div>
          )}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={zapri} disabled={nalaga || skeniraNalaga}>
            Prekliči
          </Button>

          {/* OCR gumb — vidno ko je slika pripravljena (kamera ali skener) */}
          {imaSliko && (
            <Button onClick={posljiOcr} disabled={nalaga}>
              {nalaga ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Prepoznavam…</>
              ) : (
                <><ScanLine className="w-4 h-4 mr-2" />Uvozi z OCR</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
