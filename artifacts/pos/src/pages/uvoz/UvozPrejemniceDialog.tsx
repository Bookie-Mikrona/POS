// artifacts/pos/src/pages/uvoz/UvozPrejemniceDialog.tsx
//
// Adapter med REST /api/uvoz/* in UparjanjeDialog/NovArtikelDialog komponentama.
// Podpira dva načina uvoza:
//   • Datoteka — CSV, XLSX, XML (e-SLOG), PDF
//   • Kamera / Skener — Claude Vision OCR

import { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Upload, Camera, AlertTriangle, X, ScanLine } from 'lucide-react';
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
  nabavniArtikli: NabavniArtikel[];
  dobaviteljiMap: Map<number, string>;
}

type Korak = 'upload' | 'uparjanje' | 'nov_artikel';
type Nacin = 'datoteka' | 'kamera';

interface UvozIzid {
  prejemnicaId: number;
  dobaviteljId: number | null;
  dobaviteljNaziv: string;
  stDokumenta: string | null;
  datumDokumenta: string | null;
  ceneBruto: boolean;
  uparjenih: number;
}

// ─── Pomočnik: zmanjšaj sliko ──────────────────────────────────────────────

async function zmanjsajSliko(
  file: File,
  maxDim = 1600,
  kvaliteta = 0.85,
): Promise<{ base64: string; preview: string; mimeTip: 'image/jpeg' }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const url = URL.createObjectURL(file);
    img.onload = () => {
      URL.revokeObjectURL(url);
      const razmerje = Math.min(1, maxDim / Math.max(img.width, img.height));
      const w = Math.round(img.width  * razmerje);
      const h = Math.round(img.height * razmerje);
      const canvas = document.createElement('canvas');
      canvas.width = w; canvas.height = h;
      canvas.getContext('2d')!.drawImage(img, 0, 0, w, h);
      const dataUrl = canvas.toDataURL('image/jpeg', kvaliteta);
      resolve({ base64: dataUrl.split(',')[1], preview: dataUrl, mimeTip: 'image/jpeg' });
    };
    img.onerror = reject;
    img.src = url;
  });
}

// ─── Komponenta ────────────────────────────────────────────────────────────

export function UvozPrejemniceDialog({
  open,
  onClose,
  onUvozDone,
  nabavniArtikli,
  dobaviteljiMap,
}: Props) {
  const { toast } = useToast();
  const fileInputRef   = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);

  const [korak,   setKorak]   = useState<Korak>('upload');
  const [nacin,   setNacin]   = useState<Nacin>('datoteka');
  const [nalaga,  setNalaga]  = useState(false);
  const [napaka,  setNapaka]  = useState<string | null>(null);
  const [izid,    setIzid]    = useState<UvozIzid | null>(null);
  const [neuparjene,       setNeuparjene]       = useState<NeuparjenaPostavka[]>([]);
  const [stUparjenih,      setStUparjenih]      = useState(0);
  const [novArtikelPostavka, setNovArtikelPostavka] = useState<NeuparjenaPostavka | null>(null);

  // kamera — predogled pred pošiljanjem
  const [slikaPreview, setSlikaPreview] = useState<string | null>(null);
  const [slikaBase64,  setSlikaBase64]  = useState<string | null>(null);
  const [slikaMime,    setSlikaMime]    = useState<'image/jpeg'>('image/jpeg');

  // ─── Pomočniki ─────────────────────────────────────────────────────────────

  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const enotaHeader = (): Record<string, string> => ({
    'x-enota-id': localStorage.getItem('pos_enota_id') ?? '',
  });

  const resetState = () => {
    setKorak('upload');
    setNalaga(false);
    setNapaka(null);
    setIzid(null);
    setNeuparjene([]);
    setStUparjenih(0);
    setNovArtikelPostavka(null);
    setSlikaPreview(null);
    setSlikaBase64(null);
  };

  const zapri = () => { resetState(); onClose(); };

  // ─── Skupna logika po uvozu ────────────────────────────────────────────────

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

  // ─── Upload datoteke ──────────────────────────────────────────────────────

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
      if (r.status === 409) { setNapaka('Ta dobavnica je bila že uvožena.'); return; }
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

  // ─── Zajem slike s kamere ─────────────────────────────────────────────────

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

      if (r.status === 409) { setNapaka('Ta slika je bila že uvožena.'); return; }
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

  // ─── Uparjanje callbacki ──────────────────────────────────────────────────

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

  // ─── Prikaz: nov artikel ───────────────────────────────────────────────────

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

  // ─── Prikaz: uparjanje ────────────────────────────────────────────────────

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

  // ─── Prikaz: upload ───────────────────────────────────────────────────────

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) zapri(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Uvozi dobavnico</DialogTitle>
        </DialogHeader>

        {/* Tab: Datoteka / Kamera */}
        <div className="flex rounded-lg border overflow-hidden text-sm font-medium">
          <button
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 transition-colors ${
              nacin === 'datoteka'
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted text-muted-foreground'
            }`}
            onClick={() => { setNacin('datoteka'); setNapaka(null); setSlikaPreview(null); setSlikaBase64(null); }}
          >
            <Upload className="w-4 h-4" />Datoteka
          </button>
          <button
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2 transition-colors border-l ${
              nacin === 'kamera'
                ? 'bg-primary text-primary-foreground'
                : 'hover:bg-muted text-muted-foreground'
            }`}
            onClick={() => { setNacin('kamera'); setNapaka(null); }}
          >
            <ScanLine className="w-4 h-4" />Kamera / Skener
          </button>
        </div>

        <div className="space-y-3">
          {/* Napaka */}
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
              {/* Predogled posnete slike */}
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
                    title="Odstrani sliko"
                  >
                    <X className="w-4 h-4" />
                  </button>
                </div>
              ) : (
                /* Zajem slike */
                <div className="space-y-3">
                  {/* Gumb za mobilni fotoaparat */}
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

              {/* Skrita vnosna polja za sliko */}
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
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={zapri} disabled={nalaga}>
            Prekliči
          </Button>

          {/* Pošlji OCR gumb — vidno samo ko je slika pripravljena */}
          {nacin === 'kamera' && slikaBase64 && (
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
