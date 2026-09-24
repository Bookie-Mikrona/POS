// artifacts/pos/src/pages/uvoz/UvozPrejemniceDialog.tsx
//
// Adapter med REST /api/uvoz/* in UparjanjeDialog/NovArtikelDialog komponentama.
// Podpira tri načine uvoza:
//   • Datoteka — CSV, XLSX, XML (e-SLOG), PDF
//   • Kamera / Skener — Claude Vision OCR (mobilni fotoaparat)
//   • Skeniraj — direkten zajem iz Windows HP scannerja prek lokalnega bridge-a

import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { KlavijaturaInput } from '@/components/KlavijaturaInput';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import { Loader2, Upload, Camera, AlertTriangle, X, ScanLine, Scan, Wifi, WifiOff, ChevronDown, UserPlus, Plus, Minus } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { posFetch } from '@/lib/pos-auth-headers';
import { useQueryClient } from '@tanstack/react-query';
import {
  useListPartnerji,
  useCreatePartner,
  getListPartnerjiQueryKey,
  getListArtikliQueryKey,
  type Partner,
} from '@workspace/api-client-react';
import { UparjanjeDialog, type NeuparjenaPostavka, type Kandidat } from './UparjanjeDialog';
import { artikelJeKandidatZaOcrVrstico } from './ocrKandidati';
import {
  dolociAktivnostNovegaArtikla,
  NovArtikelDialog,
  parseProdajnaCena,
  type NovArtikelVhod,
} from './NovArtikelDialog';
import { BookingPreviewDialog } from './BookingPreviewDialog';
import { saveCreatedArticleNormativ } from './save-created-article-normativ';

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
  imeZaNabavo?: string | null;
  enotaMere?: string | null;
  davek: number;
  povratnaEmbalaza?: boolean;
  jeSkupinskiNabavniArtikel?: boolean;
}

interface Props {
  open: boolean;
  onClose: () => void;
  onUvozDone: () => void;
  onOdpriPrejemnico?: (id: number) => void;
  nabavniArtikli: NabavniArtikel[];
  dobaviteljiMap: Map<string, string>;
}

type Korak = 'upload' | 'uparjanje' | 'nov_artikel';
type Nacin = 'datoteka' | 'kamera' | 'skener';

interface UvozIzid {
  prejemnicaId: number;
  dobaviteljId: string | null;
  dobaviteljNaziv: string;
  stDokumenta: string | null;
  datumDokumenta: string | null;
  datumZapadlosti: string | null;
  vrstaDokumenta: 'RACUN' | 'DOBAVNICA' | 'DOBROPIS' | 'BREMEPIS';
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

// ─── Tipi za dodajanje dobavitelja ────────────────────────────────────────

interface KupecForm {
  naziv: string;
  kratkiNaziv: string;
  ulica: string;
  postnaStevilka: string;
  kraj: string;
  drzava: string;
  kodaDrzave: string;
  zavezanecDdv: boolean;
  davcnaStevilka: string;
  idZaDdv: string;
  maticnaStevilka: string;
  trr: { iban: string; bic: string }[];
  email: string;
  telefon: string;
}

interface OcrDobaviteljPodatki {
  // Surovi OCR podatki (pogosto nepopolni/null)
  naziv: string | null;
  davcna: string | null;
  idDdv: string | null;
  maticna: string | null;
  iban: string | null;
  ulica: string | null;
  postnaStevilka: string | null;
  kraj: string | null;
  drzava: string | null;
  email: string | null;
  telefon: string | null;
  // AI-najdeni podatki iz predlogAI (zanesljivejši od surovih OCR)
  predlogDavcna: string | null;   // iz predlogAI.davcna — AI web iskanje med OCR procesiranjem
  predlogNaziv:  string | null;   // iz predlogAI.naziv
}

function prazenKupecForm(): KupecForm {
  return {
    naziv: '', kratkiNaziv: '', ulica: '', postnaStevilka: '', kraj: '',
    drzava: '', kodaDrzave: '', zavezanecDdv: false, davcnaStevilka: '',
    idZaDdv: '', maticnaStevilka: '', trr: [], email: '', telefon: '',
  };
}

/** Fallback: napolni obrazec iz surovih OCR polj (brez Inetis klica). */
function ocrVForm(ocr: OcrDobaviteljPodatki): KupecForm {
  return {
    naziv:          ocr.naziv ?? '',
    kratkiNaziv:    '',
    ulica:          ocr.ulica ?? '',
    postnaStevilka: ocr.postnaStevilka ?? '',
    kraj:           ocr.kraj ?? '',
    drzava:         ocr.drzava ?? '',
    kodaDrzave:     (ocr.drzava?.length === 2 ? ocr.drzava : '') ?? '',
    zavezanecDdv:   !!(ocr.idDdv),
    davcnaStevilka: ocr.davcna ?? '',
    idZaDdv:        ocr.idDdv ?? '',
    maticnaStevilka: ocr.maticna ?? '',
    trr:            ocr.iban ? [{ iban: ocr.iban, bic: '' }] : [],
    email:          ocr.email ?? '',
    telefon:        ocr.telefon ?? '',
  };
}

/** En Inetis zadetek za izbirnik pri več zadetkih. */
interface InetisZadetek {
  naziv: string;
  davcnaStevilka: string;
  kraj: string | null;
  _polni: Parameters<typeof inetisRezVForm>[0];
}

/** Napolni obrazec iz Inetis odgovora (InetisRezultat ali /kupec/poisci JSON). */
function inetisRezVForm(d: {
  naziv?: string | null; kratkiNaziv?: string | null;
  ulica?: string | null; postnaStevilka?: string | null; kraj?: string | null;
  drzava?: string | null; kodaDrzave?: string | null;
  zavezanecDdv?: boolean | null;
  davcnaStevilka?: string | null; idZaDdv?: string | null; maticnaStevilka?: string | null;
  trr?: Array<{ iban: string; bic: string }> | null;
  email?: string | null; telefon?: string | null;
}): KupecForm {
  return {
    naziv:           d.naziv ?? '',
    kratkiNaziv:     d.kratkiNaziv ?? '',
    ulica:           d.ulica ?? '',
    postnaStevilka:  d.postnaStevilka ?? '',
    kraj:            d.kraj ?? '',
    drzava:          d.drzava ?? 'Slovenija',
    kodaDrzave:      d.kodaDrzave ?? 'SI',
    zavezanecDdv:    d.zavezanecDdv ?? false,
    davcnaStevilka:  d.davcnaStevilka ?? '',
    idZaDdv:         d.idZaDdv ?? '',
    maticnaStevilka: d.maticnaStevilka ?? '',
    trr:             (d.trr ?? []).filter(t => t.iban),
    email:           d.email ?? '',
    telefon:         d.telefon ?? '',
  };
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
  const [novoUstvarjeniArtikli, setNovoUstvarjeniArtikli] = useState<NabavniArtikel[]>([]);
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

  // MANJKA_DOBAVITELJ stanje — prosto iskanje + dodajanje dobavitelja
  const [manjkaSejaId,       setManjkaSejaId]       = useState<string | null>(null);
  const [manjkaDobIme,       setManjkaDobIme]       = useState<string>('');
  const [manjkaIzbraniId,    setManjkaIzbraniId]    = useState<string | null>(null);
  const [manjkaIzbraniNaziv, setManjkaIzbraniNaziv] = useState<string>('');
  const [manjkaFilter,       setManjkaFilter]       = useState<string>('');
  const [manjkaOcrData,      setManjkaOcrData]      = useState<OcrDobaviteljPodatki | null>(null);

  // Nov dobavitelj — dialog za dodajanje iz OCR podatkov ali ročni vnos
  const [novDobOpen,          setNovDobOpen]          = useState(false);
  const [novDobForm,          setNovDobForm]          = useState<KupecForm>(prazenKupecForm());
  const [novDobSaving,        setNovDobSaving]        = useState(false);
  const [novDobInetisLoading, setNovDobInetisLoading] = useState(false);
  const [novDobInetisNapaka,  setNovDobInetisNapaka]  = useState<string | null>(null);
  const [novDobZadetki,       setNovDobZadetki]       = useState<InetisZadetek[]>([]);
  const createKupecMutation = useCreatePartner();
  const queryClient = useQueryClient();

  // CSV/XLSX — izbira dobavitelja pred uploadom (profil je vezan na dobavitelja)
  const [csvDatoteka,        setCsvDatoteka]        = useState<File | null>(null);
  const [csvFormat,          setCsvFormat]          = useState<string | null>(null);
  const [csvDobaviteljId,    setCsvDobaviteljId]    = useState<string | null>(null);
  const [csvDobaviteljFilter, setCsvDobaviteljFilter] = useState<string>('');

  const [bookingPreviewId, setBookingPreviewId] = useState<number | null>(null);

  const { data: shranjeniKupci } = useListPartnerji();

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
    setNovoUstvarjeniArtikli([]);
    setStUparjenih(0);
    setPodvojenoPrejId(null);
    setNovArtikelPostavka(null);
    setSlikaBase64(null);
    setSlikaPreview(null);
    setSlikaMime('image/jpeg');
    setSkeniraNalaga(false);
    setManjkaSejaId(null);
    setManjkaDobIme('');
    setManjkaIzbraniId(null);
    setManjkaIzbraniNaziv('');
    setManjkaFilter('');
    setManjkaOcrData(null);
    setNovDobOpen(false);
    setNovDobForm(prazenKupecForm());
    setNovDobSaving(false);
    setNovDobInetisLoading(false);
    setNovDobInetisNapaka(null);
    setNovDobZadetki([]);
    setCsvDatoteka(null);
    setCsvFormat(null);
    setCsvDobaviteljId(null);
    setCsvDobaviteljFilter('');
    setBookingPreviewId(null);
  }, []);

  // Filtrirani dobavitelji za MANJKA_DOBAVITELJ iskanje (prag ≥ 2 znaka)
  // Išče po: dolgi naziv, kratki naziv, davčna številka
  const filtriranKupci = useMemo<Partner[]>(() => {
    const seznam = shranjeniKupci ?? [];
    const q = manjkaFilter.toLowerCase().trim();
    if (q.length < 2) return [];
    return seznam.filter(k =>
      (k.naziv ?? '').toLowerCase().includes(q) ||
      (k.kratkiNaziv ?? '').toLowerCase().includes(q) ||
      (k.davcnaStevilka ?? '').includes(q)
    );
  }, [shranjeniKupci, manjkaFilter]);

  // Filtrirani dobavitelji za CSV/XLSX picker (pred uploadom)
  const filtriranCsvKupci = useMemo<Partner[]>(() => {
    const seznam = shranjeniKupci ?? [];
    const q = csvDobaviteljFilter.toLowerCase().trim();
    if (!q) return seznam;
    return seznam.filter(k =>
      (k.naziv ?? '').toLowerCase().includes(q) ||
      (k.kratkiNaziv ?? '').toLowerCase().includes(q)
    );
  }, [shranjeniKupci, csvDobaviteljFilter]);

  const zapri = () => { resetState(); onClose(); };

  // ─── Skupna logika po uvozu ────────────────────────────────────────────

  const handleUvozIzid = useCallback(async (data: Record<string, unknown>) => {
    if (!data.prejemnicaId) throw new Error(data.sporocilo as string ?? 'Uvoz ni uspel.');

    const nr = await posFetch(
      `${base}/api/uvoz/prejemnice/${data.prejemnicaId}/neuparjeno`,
    );
    if (!nr.ok) {
      throw new Error(`Seznama nepovezanih vrstic ni bilo mogoče naložiti (${nr.status}).`);
    }
    const nd = await nr.json();

    const jeSkupinskiPoId = new Map(
      nabavniArtikli.map(a => [
        a.id,
        Boolean((a as typeof a & { jeSkupinskiNabavniArtikel?: boolean }).jeSkupinskiNabavniArtikel),
      ]),
    );
    const neuparjeneList: NeuparjenaPostavka[] = (nd.vsebina ?? []).map((p: NeuparjenaPostavka) => ({
      ...p,
      uparjanje_kandidati: (p.uparjanje_kandidati ?? []).map(k => ({
        ...k,
        jeSkupinskiNabavniArtikel: k.jeSkupinskiNabavniArtikel ?? jeSkupinskiPoId.get(k.artikelId) ?? false,
      })),
    }));
    const stUpar = (data.uparjenih as number) ?? 0;

    // Če so vse postavke samodejno uparjene, ni treba prikazati zaslona za uparjanje.
    if (neuparjeneList.length === 0) {
      if (data.vrstaDokumenta === 'RACUN') {
        toast({
          title: 'Faktura-dobavnica uvožena',
          description: 'Plačilni podatki so shranjeni. Dokument se nadalje obravnava kot prejeti račun.',
        });
        onUvozDone();
        resetState();
        onClose();
        return;
      }
      toast({
        title: 'Uvoz uspešen',
        description: `${stUpar} artikel${stUpar === 1 ? '' : 'ov'} samodejno prepoznanih. Sledi knjiženje.`,
      });
      setBookingPreviewId(data.prejemnicaId as number);
      return;
    }

    const dobaviteljId: string | null = (data.dobaviteljId as string) ?? null;
    setIzid({
      prejemnicaId:   data.prejemnicaId as number,
      dobaviteljId,
      dobaviteljNaziv: dobaviteljId
        ? (dobaviteljiMap.get(dobaviteljId) ?? (data.dobaviteljNazivOcr as string) ?? 'Neznan dobavitelj')
        : ((data.dobaviteljNazivOcr as string) ?? 'Neznan dobavitelj'),
      stDokumenta:    (data.stDokumenta    as string)  ?? null,
      datumDokumenta: (data.datumDokumenta as string)  ?? null,
      datumZapadlosti: (data.datumZapadlosti as string) ?? null,
      vrstaDokumenta: (data.vrstaDokumenta as UvozIzid['vrstaDokumenta']) ?? 'RACUN',
      ceneBruto:      !!(data.ceneBruto),
      uparjenih:      stUpar,
    });
    setNeuparjene(neuparjeneList);
    setStUparjenih(stUpar);
    setKorak('uparjanje');
    toast({
      title: 'Potrebna je potrditev povezav',
      description: `${stUpar} ${stUpar === 1 ? 'artikel je samodejno povezan' : 'artiklov je samodejno povezanih'}, ${neuparjeneList.length} ${neuparjeneList.length === 1 ? 'vrstica pa potrebuje' : 'vrstice pa potrebujejo'} ročno potrditev.`,
    });
  }, [base, dobaviteljiMap, toast, onUvozDone, resetState, onClose, nabavniArtikli]);

  // Uvozi sejo z ročno izbranim dobaviteljem (ko OCR ne prepozna dobavitelja)
  // Sprejme neobvezni dobaviteljIdOverride — za samodejni klic takoj po izbiri/ustvaritvi,
  // ko React stanje (manjkaIzbraniId) še ni posodobljeno.
  const uvoziBrezDobavitelja = useCallback(async (dobaviteljIdOverride?: string) => {
    const aktivniId = dobaviteljIdOverride ?? manjkaIzbraniId;
    if (!manjkaSejaId || !aktivniId) return;
    if (nalaga) return;                   // prepreči dvojni klic
    setNalaga(true);
    setNapaka(null);
    try {
      const r = await posFetch(`${base}/api/uvoz/seja/${encodeURIComponent(manjkaSejaId)}/s-dobaviteljem`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dobaviteljId: aktivniId }),
      });
      const data = await r.json();
      if (!r.ok || data.status !== 'OSNUTEK_USTVARJEN') {
        setNapaka(data.sporocilo ?? `Uvoz ni uspel (${r.status}).`); return;
      }
      setManjkaSejaId(null);
      await handleUvozIzid({ ...data, dobaviteljId: aktivniId });
    } catch (e) {
      setNapaka((e as Error).message ?? 'Napaka pri uvozu.');
    } finally {
      setNalaga(false);
    }
  }, [base, manjkaSejaId, manjkaIzbraniId, nalaga, handleUvozIzid]);

  // ─── Zaznava formata iz priponke (samo po imenu datoteke) ─────────────

  function zaznanFormatIzPriponke(ime: string): 'CSV' | 'XLSX' | 'DRUGO' {
    const ext = ime.split('.').pop()?.toLowerCase() ?? '';
    if (ext === 'csv' || ext === 'txt') return 'CSV';
    if (ext === 'xlsx' || ext === 'xls') return 'XLSX';
    return 'DRUGO';
  }

  // ─── Upload datoteke ───────────────────────────────────────────────────

  const naloziDatoteko = useCallback(async (datoteka: File, dobaviteljId?: string | null) => {
    setNalaga(true);
    setNapaka(null);
    try {
      const fd = new FormData();
      fd.append('datoteka', datoteka);
      // CSV/XLSX: dobaviteljId je potreben za avto-lookup uvoznega profila
      if (dobaviteljId) {
        fd.append('dobaviteljId', String(dobaviteljId));
      }
      const r = await posFetch(`${base}/api/uvoz/datoteka`, {
        method: 'POST',
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
          const prvaNapaka = (data.napake as { koda?: string; sporocilo?: string }[] | undefined)?.[0];
          if (prvaNapaka?.koda === 'ZAJ012') {
            // Profil ne obstaja — jasno sporoči in usmeri v nastavitve
            const dob = dobaviteljId
              ? ` za izbranega dobavitelja`
              : '';
            setNapaka(
              `Ni uvoznega profila${dob} za ta format. ` +
              `Nastavite ga v Nastavitve → Uvozni profili, nato ponovite uvoz.`
            );
          } else {
            setNapaka(prvaNapaka?.sporocilo ?? 'Datoteka vsebuje napake in je ni mogoče uvoziti.');
          }
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

  // CSV/XLSX: sprejmi datoteko brez uploadа — pokaži picker za dobavitelja
  const sprejmiDatoteko = useCallback((datoteka: File) => {
    const fmt = zaznanFormatIzPriponke(datoteka.name);
    if (fmt === 'CSV' || fmt === 'XLSX') {
      setCsvDatoteka(datoteka);
      setCsvFormat(fmt);
      setCsvDobaviteljId(null);
      setCsvDobaviteljFilter('');
      setNapaka(null);
      setPodvojenoPrejId(null);
    } else {
      // e-SLOG, PDF, XML — direktni upload brez dobavitelja
      setCsvDatoteka(null);
      setCsvFormat(null);
      void naloziDatoteko(datoteka, null);
    }
  }, [naloziDatoteko]);

  // CSV/XLSX: dejansko pošlji po izbiri dobavitelja
  const naloziCsv = useCallback(async () => {
    if (!csvDatoteka || !csvDobaviteljId) return;
    await naloziDatoteko(csvDatoteka, csvDobaviteljId);
  }, [csvDatoteka, csvDobaviteljId, naloziDatoteko]);

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
      const r = await posFetch(`${base}/api/uvoz/ocr`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ slika: slikaBase64, mimeTip: slikaMime }),
      });
      const data = await r.json();

      if (r.status === 409) {
        const id = (data as { prejemnicaId?: number }).prejemnicaId;
        if (id) { setPodvojenoPrejId(id); } else { setNapaka('Ta slika je bila že uvožena.'); }
        return;
      }
      if (r.status === 422 && data.status === 'MANJKA_DOBAVITELJ') {
        const ime = (data.dobaviteljNazivOcr ?? data.predlogDobavitelja?.naziv ?? '') as string;
        setManjkaSejaId(data.sejaId as string);
        setManjkaDobIme(ime);
        setManjkaFilter(ime);
        setManjkaIzbraniId(null);
        setManjkaIzbraniNaziv('');
        // Shrani OCR + AI-najdene podatke dobavitelja za predizpolnitev/Inetis priklic
        // predlogDobavitelja.davcna je zanesljiva (AI web iskanje), dobaviteljDavcnaOcr surova (OCR)
        setManjkaOcrData({
          naziv:          (data.dobaviteljNazivOcr as string | null) ?? null,
          davcna:         (data.dobaviteljDavcnaOcr as string | null) ?? null,
          idDdv:          (data.dobaviteljIdDdvOcr as string | null) ?? null,
          maticna:        (data.dobaviteljMaticnaOcr as string | null) ?? null,
          iban:           (data.dobaviteljIbanOcr as string | null) ?? null,
          ulica:          (data.dobaviteljUlicaOcr as string | null) ?? null,
          postnaStevilka: (data.dobaviteljPosteStevilkaOcr as string | null) ?? null,
          kraj:           (data.dobaviteljKrajOcr as string | null) ?? null,
          drzava:         (data.dobaviteljDrzavaOcr as string | null) ?? null,
          email:          (data.dobaviteljEmailOcr as string | null) ?? null,
          telefon:        (data.dobaviteljTelefonOcr as string | null) ?? null,
          // KLJUČNO: AI-najdena davčna iz spletnega iskanja — zanesljivejša od OCR
          // predlogAI je rezultat poisciDobaviteljaAI iz OCR procesiranja — zanesljivejši od OCR
          predlogDavcna:  (data.predlogAI as { davcna?: string } | null)?.davcna ?? null,
          predlogNaziv:   (data.predlogAI as { naziv?: string } | null)?.naziv ?? null,
        });
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
          dpi:      300,
          color:    false,
          format:   'png',
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

  // ─── Dodajanje dobavitelja v šifrant (med OCR uvozom) ─────────────────

  const novDobSetField = useCallback(
    (key: keyof KupecForm, value: string | boolean) =>
      setNovDobForm(f => ({ ...f, [key]: value })),
    [],
  );
  const novDobAddTrr = useCallback(() =>
    setNovDobForm(f => ({ ...f, trr: [...f.trr, { iban: '', bic: '' }] })), []);
  const novDobRemoveTrr = useCallback((i: number) =>
    setNovDobForm(f => ({ ...f, trr: f.trr.filter((_, idx) => idx !== i) })), []);
  const novDobSetTrr = useCallback((i: number, key: 'iban' | 'bic', val: string) =>
    setNovDobForm(f => { const trr = [...f.trr]; trr[i] = { ...trr[i]!, [key]: val }; return { ...f, trr }; }), []);

  const handleDodajDobavitelja = useCallback(async () => {
    if (!novDobForm.naziv.trim()) {
      toast({ title: 'Obvezno polje', description: 'Dolgi naziv je obvezen.', variant: 'destructive' });
      return;
    }
    setNovDobSaving(true);
    try {
      // Prepreči dvojnika: če partner s to davčno že obstaja, ga izberi namesto ustvarjanja
      const davcnaNorm = novDobForm.davcnaStevilka.trim().replace(/\D/g, '');
      if (davcnaNorm) {
        const dvojnik = (shranjeniKupci ?? []).find(
          k => (k.davcnaStevilka ?? '').replace(/\D/g, '') === davcnaNorm,
        );
        if (dvojnik) {
          setManjkaIzbraniId(dvojnik.id);
          setManjkaIzbraniNaziv(dvojnik.kratkiNaziv || dvojnik.naziv);
          setNovDobOpen(false);
          toast({
            title: 'Partner že obstaja',
            description: `"${dvojnik.kratkiNaziv || dvojnik.naziv}" je bil samodejno izbran (enaka davčna).`,
          });
          return;
        }
      }
      const payload = {
        naziv:           novDobForm.naziv.trim(),
        kratkiNaziv:     novDobForm.kratkiNaziv.trim() || null,
        ulica:           novDobForm.ulica.trim() || null,
        postnaStevilka:  novDobForm.postnaStevilka.trim() || null,
        kraj:            novDobForm.kraj.trim() || null,
        drzava:          novDobForm.drzava.trim() || null,
        kodaDrzave:      novDobForm.kodaDrzave.trim() || null,
        zavezanecDdv:    novDobForm.zavezanecDdv || null,
        davcnaStevilka:  novDobForm.davcnaStevilka.trim() || null,
        idZaDdv:         novDobForm.idZaDdv.trim() || null,
        maticnaStevilka: novDobForm.maticnaStevilka.trim() || null,
        trr:             novDobForm.trr.filter(t => t.iban.trim()).map(t => ({ iban: t.iban.trim(), bic: t.bic.trim() })),
        email:           novDobForm.email.trim() || null,
        telefon:         novDobForm.telefon.trim() || null,
      };
      const nov = await createKupecMutation.mutateAsync({ data: payload });
      void queryClient.invalidateQueries({ queryKey: getListPartnerjiQueryKey() });
      setManjkaIzbraniId(nov.id);
      setManjkaIzbraniNaziv(nov.kratkiNaziv || nov.naziv);
      setNovDobOpen(false);
      toast({ title: 'Dobavitelj dodan', description: `"${nov.kratkiNaziv || nov.naziv}" je bil dodan v šifrant.` });
      void uvoziBrezDobavitelja(nov.id);  // samodejno nadaljuj uvoz — ne čakaj na klik gumba
    } catch {
      toast({ title: 'Napaka', description: 'Dobavitelja ni bilo mogoče shraniti.', variant: 'destructive' });
    } finally {
      setNovDobSaving(false);
    }
  }, [novDobForm, shranjeniKupci, createKupecMutation, queryClient, toast, uvoziBrezDobavitelja]);

  // ─── Samodejni Inetis priklic ob odprtju obrazca "Dodaj iz OCR podatkov" ──
  //
  // Kaskada (najzanesljivejši prvi):
  //   1. davčna (predlogAI.davcna ali OCR davčna) → GET /kupec/poisci?davcna=
  //   2. naziv (predlogAI.naziv ali OCR naziv)    → GET /kupec/poisci-naziv?niz= (Ajax.aspx)
  //      • 1 zadetek → napolni obrazec
  //      • več zadetkov → prikaži izbirnik (novDobZadetki)
  //   3. fallback → surovi OCR podatki + opozorilo
  //
  // IBAN veja izpuščena: Inetis Ajax.aspx ne podpira iskanja po IBAN (status: fail).
  const fetchInetisVObrazec = useCallback(async (ocrData: OcrDobaviteljPodatki) => {
    setNovDobInetisLoading(true);
    setNovDobInetisNapaka(null);
    setNovDobZadetki([]);
    try {
      // ── Korak 1: davčna → /kupec/poisci (enriched + auto-save) ─────────
      const davcnaZaInetis =
        (ocrData.predlogDavcna?.match(/^\d{8}$/) ? ocrData.predlogDavcna : null) ??
        (ocrData.davcna?.match(/^\d{8}$/)        ? ocrData.davcna        : null);

      if (davcnaZaInetis) {
        const r = await posFetch(`${base}/api/kupec/poisci?davcna=${davcnaZaInetis}`);
        if (r.ok) {
          const d = await r.json() as Parameters<typeof inetisRezVForm>[0];
          setNovDobForm(inetisRezVForm(d));
          return;
        }
      }

      // ── Korak 2: naziv → /kupec/poisci-naziv?niz= (neposredni Ajax.aspx) ─
      const nizZaInetis = (ocrData.predlogNaziv || ocrData.naziv || '').trim();
      if (nizZaInetis.length >= 3) {
        const r = await posFetch(
          `${base}/api/kupec/poisci-naziv?niz=${encodeURIComponent(nizZaInetis)}`,
        );
        if (r.ok) {
          type OdgovorNiz =
            | Parameters<typeof inetisRezVForm>[0]
            | { vecZadetkov: true; zadetki: Parameters<typeof inetisRezVForm>[0][] };
          const d = await r.json() as OdgovorNiz;
          if ('vecZadetkov' in d && d.vecZadetkov) {
            // Več zadetkov → prikaži izbirnik, obrazec ostane prazen
            setNovDobForm(prazenKupecForm());
            setNovDobZadetki(
              d.zadetki.map(z => ({
                naziv:          (z as { naziv?: string }).naziv ?? '',
                davcnaStevilka: (z as { davcnaStevilka?: string }).davcnaStevilka ?? '',
                kraj:           (z as { kraj?: string | null }).kraj ?? null,
                _polni:         z,
              })),
            );
            return;
          }
          setNovDobForm(inetisRezVForm(d as Parameters<typeof inetisRezVForm>[0]));
          return;
        }
      }

      // ── Korak 3 (fallback): surovi OCR podatki + opozorilo ─────────────
      setNovDobForm(ocrVForm(ocrData));
      setNovDobInetisNapaka('Samodejni priklic podatkov ni uspel — dopolnite ročno.');
    } catch {
      setNovDobForm(ocrVForm(ocrData));
      setNovDobInetisNapaka('Samodejni priklic podatkov ni uspel — dopolnite ročno.');
    } finally {
      setNovDobInetisLoading(false);
    }
  }, [base]);

  // ─── Uparjanje callbacki ───────────────────────────────────────────────

  const onUpari = useCallback(async (
    postavkaId: number, artikelId: number | null, enotVPaketu: string, zapomni: boolean, vrsticaTip: string = 'zaloga',
  ): Promise<number> => {
    const r = await posFetch(`${base}/api/uvoz/postavke/${postavkaId}/upari`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artikelId, enotVPaketu, zapomni, vrsticaTip }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error((err as { sporocilo?: string }).sporocilo ?? 'Povezovanje artikla ni uspelo.');
    }
    // Vrnemo število preostalih postavk, da klic potrdi() ve, ali je to zadnja.
    // Funkcionalni setState nam da zanesljivo trenutno stanje (brez stale closure).
    let ostalo = 0;
    setNeuparjene(prev => {
      const filtered = prev.filter(p => p.id !== postavkaId);
      ostalo = filtered.length;
      return filtered;
    });
    setStUparjenih(prev => prev + 1);
    return ostalo;
  }, [base]);

  const vsiNabavniArtikli = useMemo(() => {
    const poId = new Map(nabavniArtikli.map(artikel => [artikel.id, artikel]));
    for (const artikel of novoUstvarjeniArtikli) poId.set(artikel.id, artikel);
    return [...poId.values()];
  }, [nabavniArtikli, novoUstvarjeniArtikli]);

  const onIsci = useCallback(async (
    niz: string,
    postavka: NeuparjenaPostavka,
  ): Promise<Kandidat[]> => {
    const q = niz.toLowerCase().trim();
    if (!q) return [];
    return vsiNabavniArtikli
      .filter(a => artikelJeKandidatZaOcrVrstico(a, postavka.opozorila, q))
      .slice(0, 25)
      .map(a => ({
        artikelId:       a.id,
        sifra:           null,
        naziv:           a.imeZaNabavo ?? a.ime,
        osnovnaEnota:    a.enotaMere ?? null,
        jeSkupinskiNabavniArtikel: Boolean((a as typeof a & { jeSkupinskiNabavniArtikel?: boolean }).jeSkupinskiNabavniArtikel),
        zadnjaCenaEnota: null,
        enotVPaketu:     null,
        ocena:           0.5,
        znanDobavitelj:  false,
      }));
  }, [vsiNabavniArtikli]);

  const onNovArtikel = useCallback((p: NeuparjenaPostavka) => {
    setNovArtikelPostavka(p);
    setKorak('nov_artikel');
  }, []);

  const onNovArtikelShrani = useCallback(async (v: NovArtikelVhod): Promise<{ artikelId: number }> => {
    if (!novArtikelPostavka) throw new Error('Ni označene postavke.');
    const isProdajni = v.tip === 'NABAVNO_PRODAJNI';
    const jeEmbalaza = v.povratnaEmbalaza;
    const prodajnaCena = isProdajni ? parseProdajnaCena(v.cena) : 0;
    if (isProdajni && prodajnaCena === null) {
      throw new Error('Prodajna cena ni veljavna.');
    }

    // 1. Ustvari artikel
    const r = await posFetch(`${base}/api/artikli`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ime:             v.naziv,
        // Ime za nabavo je vedno vsaj naziv — nabavni artikel brez tega polja
        // ostane v šifrantu brez prepoznavnega nabavnega naziva.
        imeZaNabavo:     v.imeZaNabavo || v.naziv,
        nabavniArtikel:  true,
        prodajniArtikel: jeEmbalaza ? false : isProdajni,
        enotaMere:       v.osnovnaEnota || undefined,
        davek:           jeEmbalaza ? 0 : (isProdajni ? v.prodajnaDdvStopnja : v.nabavnaDdvStopnja),
        cena:            jeEmbalaza ? 0 : prodajnaCena,
        kategorijaId:    !jeEmbalaza && isProdajni ? (v.posCategoryId ?? undefined) : undefined,
        aktiven:         dolociAktivnostNovegaArtikla(v.tip, v.aktiven),
        barva:           !jeEmbalaza && isProdajni ? (v.barva ?? undefined) : undefined,
        jePica:          !jeEmbalaza && isProdajni ? v.jePica : false,
        toGo:            !jeEmbalaza && isProdajni ? v.toGo : false,
        toGoArtikli:     !jeEmbalaza && isProdajni ? v.toGoArtikli : [],
        happyHourCena:   !jeEmbalaza && isProdajni && v.happyHourCena ? Number(v.happyHourCena) : undefined,
        vrstaArtikla:    jeEmbalaza ? 'material' : v.vrstaArtikla,
        taxCategory:     v.taxCategory,
        addedSugar:      v.addedSugar,
        skupina:         v.skupina ?? undefined,
        gtin:            v.gtin ?? undefined,
        povratnaEmbalaza: jeEmbalaza,
        vrstaEmbalaze: jeEmbalaza ? v.vrstaEmbalaze : undefined,
        depozitnaVrednost: jeEmbalaza
          ? Number((v.depozitnaVrednost ?? '0').replace(',', '.'))
          : undefined,
        ...(import.meta.env.DEV ? {
          alergeni: [],
          alergeniSledi: [],
          alergeniStatus: 'potrjeno_brez',
          alergeniVir: 'rocno',
          alergeniOpombaVira: 'Testno delovanje',
        } : {}),
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error((data as { sporocilo?: string; error?: string }).sporocilo ?? (data as { error?: string }).error ?? 'Ustvarjanje artikla ni uspelo.');
    const createdArticle = data as { id: number; normativRevision?: number };
    const novId = createdArticle.id;
    setNovoUstvarjeniArtikli(prev => [
      ...prev.filter(artikel => artikel.id !== novId),
      {
        id: novId,
        ime: v.naziv,
        imeZaNabavo: v.imeZaNabavo || v.naziv,
        enotaMere: v.osnovnaEnota || null,
        davek: jeEmbalaza ? 0 : (isProdajni ? v.prodajnaDdvStopnja : v.nabavnaDdvStopnja),
        povratnaEmbalaza: jeEmbalaza,
      },
    ]);
    void queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });

    // 2. Normativ (samo za prodajne)
    if (isProdajni && v.normativItems.length > 0) {
      const normRows = v.normativItems
        .map(n => ({
          vhodniArtikelId: n.vhodniArtikelId === -1 ? novId : n.vhodniArtikelId,
          kolicina: parseFloat(n.kolicina) || 0,
        }))
        .filter(n => n.vhodniArtikelId > 0 && n.kolicina > 0);
      if (normRows.length > 0) {
        await saveCreatedArticleNormativ({
          url: `${base}/api/artikli/${novId}/normativi`,
          headers: enotaHeader(),
          expectedRevision: Number(createdArticle.normativRevision),
          items: normRows,
        });
      }
    }

    // 3. Samodejno poveži nov artikel s postavko — brez tega bi se dialog vrnil
    //    na zaslon s kandidati in prikazal "ni podobnih artiklov".
    // Uporabimo enotVPaketu, ki ga je vnos uporabnik v NovArtikelDialog,
    // ne tisto iz OCR dokumenta (ki je pogosto 1).
    const pakiranje = v.enotVPaketu || novArtikelPostavka.enot_v_paketu || '1';
    const pr = await posFetch(`${base}/api/uvoz/postavke/${novArtikelPostavka.id}/upari`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ artikelId: novId, enotVPaketu: pakiranje, zapomni: false }),
    });
    if (!pr.ok) {
      const err = await pr.json().catch(() => ({}));
      throw new Error((err as { sporocilo?: string }).sporocilo ?? 'Samodejno povezovanje ni uspelo.');
    }

    // 4. Posodobi stanje
    let ostalo = neuparjene.filter(p => p.id !== novArtikelPostavka.id);
    let noviSt = stUparjenih + 1;

    // Novi artikel mora biti takoj na voljo tudi kot kandidat za naslednje
    // vrstice iste dobavnice (npr. prejem in vračilo iste steklenice).
    if (ostalo.length > 0 && izid?.prejemnicaId) {
      try {
        const ponovno = await posFetch(
          `${base}/api/uvoz/prejemnice/${izid.prejemnicaId}/uparjanje`,
          {
            method: 'POST',
          },
        );
        if (!ponovno.ok) throw new Error('Ponovni izračun kandidatov ni uspel.');

        const nr = await posFetch(
          `${base}/api/uvoz/prejemnice/${izid.prejemnicaId}/neuparjeno`,
        );
        if (!nr.ok) throw new Error('Osveževanje preostalih vrstic ni uspelo.');
        const nd = await nr.json() as { vsebina?: NeuparjenaPostavka[] };
        const osvezene = nd.vsebina ?? [];
        noviSt += Math.max(0, ostalo.length - osvezene.length);
        ostalo = osvezene;
      } catch (error) {
        toast({
          title: 'Artikel je ustvarjen',
          description: `${(error as Error).message} Pri ročnem iskanju je novi artikel že na voljo.`,
          variant: 'destructive',
        });
      }
    }

    setNeuparjene(ostalo);
    setStUparjenih(noviSt);

    if (ostalo.length === 0) {
      // Vse postavke so bile obdelane — zaključi uvoz
      if (izid?.vrstaDokumenta === 'RACUN') {
        toast({
          title: 'Faktura-dobavnica uvožena',
          description: 'Plačilni podatki so shranjeni. Dokument se nadalje obravnava kot prejeti račun.',
        });
        onUvozDone();
        zapri();
        return { artikelId: novId };
      }
      toast({
        title: 'Uvoz uspešen',
        description: `${noviSt} artikel${noviSt === 1 ? ' usklajen' : 'ov usklajenih'}. Sledi knjiženje.`,
      });
      setBookingPreviewId(izid?.prejemnicaId ?? null);
    } else {
      setKorak('uparjanje');
    }

    return { artikelId: novId };
  }, [base, novArtikelPostavka, neuparjene, stUparjenih, onUvozDone, zapri, toast, izid, queryClient]);

  /** Prenese e-SLOG ZIP paket za trenutno uvoženo prejemnico. */
  const prenesiEslog = useCallback(async () => {
    if (!izid?.prejemnicaId) return;
    try {
      const r = await posFetch(
        `${base}/api/uvoz/prejemnice/${izid.prejemnicaId}/eracun-paket.zip`,
      );
      if (!r.ok) { alert(`Prenos e-SLOG paketa ni uspel (${r.status}).`); return; }
      const blob = await r.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `eracun-paket-${izid.stDokumenta ?? izid.prejemnicaId}.zip`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch {
      alert('Prenos e-SLOG paketa ni uspel.');
    }
  }, [izid, base]);

  const onZakljuci = useCallback(() => {
    if (izid?.vrstaDokumenta === 'RACUN') {
      toast({
        title: 'Faktura-dobavnica uvožena',
        description: 'Plačilni podatki so shranjeni. Dokument se nadalje obravnava kot prejeti račun.',
      });
      onUvozDone();
      zapri();
      return;
    }
    toast({
      title: 'Uvoz uspešen',
      description: `${stUparjenih} artikel${stUparjenih === 1 ? ' usklajen' : 'ov usklajenih'}. Sledi knjiženje.`,
    });
    setBookingPreviewId(izid?.prejemnicaId ?? null);
  }, [stUparjenih, toast, izid, onUvozDone, zapri]);

  // ─── Prikaz: knjiženje (booking preview) ───────────────────────────────

  if (bookingPreviewId !== null) {
    return (
      <BookingPreviewDialog
        receiptId={bookingPreviewId}
        onClose={zapri}
        onConfirmed={() => {
          onUvozDone();
          zapri();
        }}
      />
    );
  }

  // ─── Prikaz: nov artikel ───────────────────────────────────────────────

  if (korak === 'nov_artikel' && novArtikelPostavka && izid) {
    return (
      <NovArtikelDialog
        postavka={novArtikelPostavka}
        dobaviteljNaziv={izid.dobaviteljNaziv}
        enote={ENOTE_MERE}
        apiBase={base}
        getEnotaHeader={enotaHeader}
        onShrani={onNovArtikelShrani}
        onPreklici={() => setKorak('uparjanje')}
      />
    );
  }

  // ─── Prikaz: uparjanje ─────────────────────────────────────────────────

  if (korak === 'uparjanje' && izid) {
    const dobaviteljPrikazniNaziv = shranjeniKupci
      ?.find(k => k.id === izid.dobaviteljId)
      ?.kratkiNaziv
      ?.trim() || izid.dobaviteljNaziv;
    return (
      <UparjanjeDialog
        prejemnicaId={izid.prejemnicaId}
        dobaviteljNaziv={dobaviteljPrikazniNaziv}
        dobaviteljPolniNaziv={izid.dobaviteljNaziv}
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
        onPrenesiEslog={prenesiEslog}
      />
    );
  }

  // ─── Prikaz: upload ────────────────────────────────────────────────────

  // Ali imamo sliko (kamera ali skener) pripravljeno za OCR
  const imaSliko = !!(slikaBase64 && (nacin === 'kamera' || nacin === 'skener'));

  return (
    <Dialog open={open} onOpenChange={v => { if (!v) zapri(); }}>
      <DialogContent className="max-w-md max-h-[90vh] flex flex-col overscroll-contain">
        <DialogHeader className="shrink-0">
          <DialogTitle>Uvozi dobavnico</DialogTitle>
        </DialogHeader>

        {/* Drsno področje — footer ostane fiksen na dnu */}
        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain">

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

          {/* MANJKA_DOBAVITELJ — prosto iskanje + dodajanje dobavitelja */}
          {manjkaSejaId && (
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3 space-y-2">
              <div className="flex items-center gap-2 text-sm text-amber-900">
                <AlertTriangle className="w-4 h-4 shrink-0" />
                <span className="font-medium">
                  {manjkaDobIme
                    ? `Dobavitelja „${manjkaDobIme}" ni bilo mogoče samodejno prepoznati.`
                    : 'Dobavitelja ni bilo mogoče samodejno prepoznati.'}
                </span>
              </div>

              {/* Izbrani dobavitelj — prikaži in omogoči razveljavitev */}
              {manjkaIzbraniId ? (
                <div className="flex items-center gap-2 rounded bg-green-50 border border-green-200 px-2.5 py-1.5 text-sm text-green-800">
                  <span className="flex-1 font-medium truncate">✓ {manjkaIzbraniNaziv}</span>
                  <button
                    type="button"
                    className="shrink-0 text-green-600 hover:text-green-800"
                    onClick={() => { setManjkaIzbraniId(null); setManjkaIzbraniNaziv(''); }}
                    title="Razveljavi izbiro"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <p className="text-xs text-amber-800">
                    Poiščite dobavitelja v šifrantu ali ga dodajte:
                  </p>
                  <KlavijaturaInput
                    type="text"
                    naslov="Iskanje dobavitelja"
                    placeholder="Iskanje po nazivu ali davčni številki…"
                    className="w-full rounded border px-2 py-1.5 text-sm bg-white"
                    value={manjkaFilter}
                    onChange={setManjkaFilter}
                    autoFocus
                  />

                  {/* Namig: premalo znakov */}
                  {manjkaFilter.trim().length < 2 && (
                    <p className="text-xs text-amber-700 italic">
                      Vnesite vsaj 2 znaka za iskanje.
                    </p>
                  )}

                  {/* Rezultati iskanja */}
                  {manjkaFilter.trim().length >= 2 && (
                    filtriranKupci.length > 0 ? (
                      <div className="max-h-40 overflow-y-auto rounded border bg-white divide-y">
                        {filtriranKupci.map(k => (
                          <button
                            key={k.id}
                            type="button"
                            className="w-full text-left px-2.5 py-2 text-sm hover:bg-muted/60 transition-colors"
                            onClick={() => {
                              setManjkaIzbraniId(k.id);
                              setManjkaIzbraniNaziv(k.kratkiNaziv || k.naziv);
                              void uvoziBrezDobavitelja(k.id);  // samodejno nadaljuj uvoz
                            }}
                          >
                            <p className="font-medium truncate">{k.kratkiNaziv || k.naziv}</p>
                            {(k.kratkiNaziv || k.davcnaStevilka) && (
                              <p className="text-xs text-muted-foreground truncate">
                                {[k.kratkiNaziv ? k.naziv : null, k.davcnaStevilka].filter(Boolean).join(' · ')}
                              </p>
                            )}
                          </button>
                        ))}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="text-xs text-amber-700 italic">
                          Ni zadetkov za „{manjkaFilter}".
                        </p>
                        <div className="flex gap-2">
                          {manjkaOcrData && (
                            <button
                              type="button"
                              className="flex-1 flex items-center justify-center gap-1.5 rounded border border-amber-400 bg-amber-100 hover:bg-amber-200 px-2 py-1.5 text-xs font-medium text-amber-900 transition-colors"
                              onClick={() => {
                                setNovDobForm(prazenKupecForm());
                                setNovDobInetisNapaka(null);
                                setNovDobOpen(true);
                                void fetchInetisVObrazec(manjkaOcrData);
                              }}
                            >
                              <UserPlus className="w-3.5 h-3.5" />
                              Dodaj iz OCR podatkov
                            </button>
                          )}
                          <button
                            type="button"
                            className="flex-1 flex items-center justify-center gap-1.5 rounded border border-amber-400 bg-white hover:bg-amber-50 px-2 py-1.5 text-xs font-medium text-amber-900 transition-colors"
                            onClick={() => { setNovDobForm(prazenKupecForm()); setNovDobOpen(true); }}
                          >
                            <Plus className="w-3.5 h-3.5" />
                            Ročni vnos
                          </button>
                        </div>
                      </div>
                    )
                  )}
                </>
              )}
            </div>
          )}

          {/* ── Datoteka tab ── */}
          {nacin === 'datoteka' && (
            <>
              {/* Ko je CSV/XLSX izbran, pokažemo kartico z datoteko + picker za dobavitelja */}
              {csvDatoteka ? (
                <div className="rounded-md border bg-muted/30 p-3 space-y-3">
                  {/* Ime datoteke + zamenjaj */}
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium truncate max-w-[70%]">📄 {csvDatoteka.name}</span>
                    <button
                      className="text-xs text-muted-foreground hover:text-foreground underline shrink-0"
                      onClick={() => {
                        setCsvDatoteka(null);
                        setCsvFormat(null);
                        setCsvDobaviteljId(null);
                        setCsvDobaviteljFilter('');
                        setNapaka(null);
                        fileInputRef.current?.click();
                      }}
                    >
                      Zamenjaj
                    </button>
                  </div>

                  {/* Napotek zakaj je picker potreben */}
                  <div className="flex items-start gap-2 rounded bg-amber-50 border border-amber-200 px-2.5 py-1.5 text-xs text-amber-800">
                    <AlertTriangle className="w-3.5 h-3.5 mt-0.5 shrink-0 text-amber-600" />
                    <span>
                      Za {csvFormat ?? 'CSV/XLSX'} izberite dobavitelja, da se naloži pravi uvozni profil.
                    </span>
                  </div>

                  {/* Iskalno polje */}
                  <KlavijaturaInput
                    type="text"
                    naslov="Iskanje dobavitelja"
                    placeholder="Iskanje dobavitelja…"
                    className="w-full rounded border px-2 py-1.5 text-sm bg-white"
                    value={csvDobaviteljFilter}
                    onChange={vrednost => { setCsvDobaviteljFilter(vrednost); setCsvDobaviteljId(null); }}
                    autoFocus
                  />

                  {/* Dropdown z dobavitelji */}
                  <div className="relative">
                    <select
                      className="w-full rounded border bg-white px-2 py-1.5 text-sm appearance-none pr-7"
                      value={csvDobaviteljId ?? ''}
                      onChange={e => setCsvDobaviteljId(e.target.value || null)}
                      size={Math.min(filtriranCsvKupci.length + 1, 6)}
                    >
                      <option value="">— izberite dobavitelja —</option>
                      {filtriranCsvKupci.map(k => (
                        <option key={k.id} value={k.id}>
                          {k.kratkiNaziv ?? k.naziv}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                /* Navadna drop zona — dokler datoteka še ni izbrana */
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
                    if (f && !nalaga) sprejmiDatoteko(f);
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
              )}

              <input
                ref={fileInputRef}
                type="file"
                accept=".xml,.csv,.txt,.xlsx,.xls,.pdf,.json"
                className="hidden"
                onChange={e => {
                  const f = e.target.files?.[0];
                  if (f) { sprejmiDatoteko(f); e.target.value = ''; }
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
                          {' · 300 dpi · sivinska'}
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

        {/* ── Dialog za dodajanje dobavitelja v šifrant ── */}
        <Dialog open={novDobOpen} onOpenChange={setNovDobOpen}>
          <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-0 gap-0">
            <DialogHeader className="p-4 pb-0 shrink-0">
              <DialogTitle>Dodaj dobavitelja v šifrant</DialogTitle>
            </DialogHeader>
            <div className="flex-1 min-h-0 overflow-y-auto p-4 pt-3 space-y-4">

              {/* Stanje Inetis priklica */}
              {novDobInetisLoading && (
                <div className="flex items-center gap-2 rounded bg-muted/50 px-3 py-2.5 text-sm text-muted-foreground">
                  <Loader2 className="h-4 w-4 animate-spin shrink-0" />
                  Pridobivam podatke iz Inetisa…
                </div>
              )}
              {!novDobInetisLoading && novDobInetisNapaka && (
                <div className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 px-2.5 py-2 text-xs text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  {novDobInetisNapaka}
                </div>
              )}

              {/* Izbirnik pri več zadetkih Inetis iskanja */}
              {!novDobInetisLoading && novDobZadetki.length > 0 && (
                <div className="space-y-1.5">
                  <p className="text-xs text-muted-foreground">
                    Najdenih {novDobZadetki.length} podjetij — izberite ustrezno:
                  </p>
                  <div className="space-y-1">
                    {novDobZadetki.map((z, i) => (
                      <button
                        key={i}
                        type="button"
                        className="w-full text-left rounded border px-3 py-2.5 hover:bg-muted/50 transition-colors focus:outline-none focus:ring-2 focus:ring-ring"
                        onClick={() => {
                          setNovDobForm(inetisRezVForm(z._polni));
                          setNovDobZadetki([]);
                        }}
                      >
                        <div className="font-medium text-sm leading-tight">{z.naziv}</div>
                        <div className="text-xs text-muted-foreground mt-0.5">
                          DDV: {z.davcnaStevilka || '—'}{z.kraj ? ` · ${z.kraj}` : ''}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identifikacija</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Dolgi naziv *</Label>
                    <KlavijaturaInput value={novDobForm.naziv} onChange={v => novDobSetField('naziv', v)} naslov="Naziv" placeholder="Polno ime / firma" autoFocus />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Kratki naziv</Label>
                    <KlavijaturaInput value={novDobForm.kratkiNaziv} onChange={v => novDobSetField('kratkiNaziv', v)} naslov="Kratki naziv" placeholder="Skrajšano ime" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Davčna številka</Label>
                    <KlavijaturaInput value={novDobForm.davcnaStevilka} onChange={v => novDobSetField('davcnaStevilka', v)} naslov="Davčna številka" placeholder="12345678" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">ID za DDV</Label>
                    <KlavijaturaInput value={novDobForm.idZaDdv} onChange={v => novDobSetField('idZaDdv', v)} naslov="ID za DDV" placeholder="SI12345678" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Matična številka</Label>
                    <KlavijaturaInput value={novDobForm.maticnaStevilka} onChange={v => novDobSetField('maticnaStevilka', v)} naslov="Matična številka" placeholder="1234567000" />
                  </div>
                  <div className="flex items-center gap-2 pt-5">
                    <Checkbox id="novDobZavezanec" checked={novDobForm.zavezanecDdv} onCheckedChange={v => novDobSetField('zavezanecDdv', !!v)} />
                    <Label htmlFor="novDobZavezanec" className="text-xs cursor-pointer">Zavezanec za DDV</Label>
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Naslov</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Ulica in hišna številka</Label>
                    <KlavijaturaInput value={novDobForm.ulica} onChange={v => novDobSetField('ulica', v)} naslov="Ulica" placeholder="Ulica 12" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Poštna številka</Label>
                    <KlavijaturaInput value={novDobForm.postnaStevilka} onChange={v => novDobSetField('postnaStevilka', v)} naslov="Poštna številka" placeholder="1000" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Kraj</Label>
                    <KlavijaturaInput value={novDobForm.kraj} onChange={v => novDobSetField('kraj', v)} naslov="Kraj" placeholder="Ljubljana" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Država</Label>
                    <KlavijaturaInput value={novDobForm.drzava} onChange={v => novDobSetField('drzava', v)} naslov="Država" placeholder="Slovenija" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Koda države</Label>
                    <KlavijaturaInput value={novDobForm.kodaDrzave} onChange={v => novDobSetField('kodaDrzave', v)} naslov="Koda države" placeholder="SI" maxLength={3} />
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kontakt</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">E-pošta</Label>
                    <KlavijaturaInput type="email" value={novDobForm.email} onChange={v => novDobSetField('email', v)} naslov="E-pošta" placeholder="info@podjetje.si" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Telefon</Label>
                    <KlavijaturaInput value={novDobForm.telefon} onChange={v => novDobSetField('telefon', v)} naslov="Telefon" placeholder="+386 1 234 5678" />
                  </div>
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">TRR računi</p>
                  <button type="button" onClick={novDobAddTrr} className="flex items-center gap-1 text-xs text-primary hover:underline">
                    <Plus className="h-3 w-3" /> Dodaj TRR
                  </button>
                </div>
                {novDobForm.trr.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Ni vpisanih TRR računov.</p>
                ) : (
                  <div className="space-y-2">
                    {novDobForm.trr.map((t, i) => (
                      <div key={i} className="flex gap-2 items-end">
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs">IBAN</Label>
                          <KlavijaturaInput value={t.iban} onChange={v => novDobSetTrr(i, 'iban', v)} naslov="IBAN" placeholder="SI56 1234 5678 9012 3456" />
                        </div>
                        <div className="w-28 space-y-1">
                          <Label className="text-xs">BIC</Label>
                          <KlavijaturaInput value={t.bic} onChange={v => novDobSetTrr(i, 'bic', v)} naslov="BIC" placeholder="LJBASI2X" />
                        </div>
                        <button type="button" onClick={() => novDobRemoveTrr(i)} className="shrink-0 mb-1 text-muted-foreground hover:text-destructive">
                          <Minus className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>

            </div>
            <div className="shrink-0 p-4 pt-3 border-t flex gap-2 justify-end">
              <Button variant="outline" onClick={() => setNovDobOpen(false)} disabled={novDobSaving || novDobInetisLoading}>Prekliči</Button>
              <Button
                onClick={() => { void handleDodajDobavitelja(); }}
                disabled={novDobSaving || novDobInetisLoading || !novDobForm.naziv.trim()}
                title={novDobInetisLoading ? 'Počakajte, pridobivam podatke iz Inetisa…' : undefined}
              >
                {(novDobSaving || novDobInetisLoading) ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
                Shrani in izberi
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        </div>{/* /drsno področje */}

        <DialogFooter className="gap-2 shrink-0">
          <Button variant="outline" onClick={zapri} disabled={nalaga || skeniraNalaga}>
            Prekliči
          </Button>

          {/* OCR gumb — vidno ko je slika pripravljena (kamera ali skener) */}
          {imaSliko && !manjkaSejaId && (
            <Button onClick={posljiOcr} disabled={nalaga}>
              {nalaga ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Prepoznavam…</>
              ) : (
                <><ScanLine className="w-4 h-4 mr-2" />Uvozi z OCR</>
              )}
            </Button>
          )}

          {/* Gumb za uvoz z ročno izbranim dobaviteljem (MANJKA_DOBAVITELJ) */}
          {manjkaSejaId && (
            <Button
              onClick={() => void uvoziBrezDobavitelja()}
              disabled={!manjkaIzbraniId || nalaga}
              title={!manjkaIzbraniId ? 'Najprej izberite ali dodajte dobavitelja' : undefined}
            >
              {nalaga ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uvažam…</>
              ) : (
                <><ScanLine className="w-4 h-4 mr-2" />Uvozi z izbranim dobaviteljem</>
              )}
            </Button>
          )}

          {/* Gumb za CSV/XLSX — aktiven šele ko je dobavitelj izbran */}
          {csvDatoteka && nacin === 'datoteka' && !manjkaSejaId && (
            <Button
              onClick={() => void naloziCsv()}
              disabled={!csvDobaviteljId || nalaga}
              title={!csvDobaviteljId ? 'Izberite dobavitelja, da se naloži pravi uvozni profil' : undefined}
            >
              {nalaga ? (
                <><Loader2 className="w-4 h-4 mr-2 animate-spin" />Uvažam…</>
              ) : (
                <><Upload className="w-4 h-4 mr-2" />Naloži {csvFormat ?? 'CSV'}</>
              )}
            </Button>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
