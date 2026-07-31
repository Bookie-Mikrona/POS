// artifacts/pos/src/pages/uvoz/UvozPrejemniceDialog.tsx
//
// Adapter med REST /api/uvoz/* in UparjanjeDialog/NovArtikelDialog komponentama.
// Odpira se z gumba "Uvozi dobavnico" na zaslonu Prejemnic v Zaloge.tsx.

import { useState, useRef, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Loader2, Upload, AlertTriangle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { UparjanjeDialog, type NeuparjenaPostavka, type Kandidat } from './UparjanjeDialog';
import { NovArtikelDialog, type NovArtikelVhod } from './NovArtikelDialog';

// ─── Statični podatki ──────────────────────────────────────────────────────

const DDV_OPC = [
  { id: 1, koda: 'standard',   naziv: '22 % – splošna',   stopnjaPriMizi: '22'  },
  { id: 2, koda: 'znizana',    naziv: '9,5 % – znižana',  stopnjaPriMizi: '9.5' },
  { id: 3, koda: 'nizka',      naziv: '5 % – znižana',    stopnjaPriMizi: '5'   },
  { id: 4, koda: 'oprosceno',  naziv: '0 % – oproščeno',  stopnjaPriMizi: '0'   },
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
  /** Pokliče se, ko je uvoz zaključen → osvežitev seznama prejemnic. */
  onUvozDone: () => void;
  nabavniArtikli: NabavniArtikel[];
  /** id dobavitelja → naziv, za prikaz v glavi dialoga. */
  dobaviteljiMap: Map<number, string>;
}

type Korak = 'upload' | 'uparjanje' | 'nov_artikel';

interface UvozIzid {
  prejemnicaId: number;
  dobaviteljId: number | null;
  dobaviteljNaziv: string;
  stDokumenta: string | null;
  datumDokumenta: string | null;
  ceneBruto: boolean;
  uparjenih: number;
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
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [korak, setKorak] = useState<Korak>('upload');
  const [nalaga, setNalaga] = useState(false);
  const [napaka, setNapaka] = useState<string | null>(null);
  const [izid, setIzid] = useState<UvozIzid | null>(null);
  const [neuparjene, setNeuparjene] = useState<NeuparjenaPostavka[]>([]);
  const [stUparjenih, setStUparjenih] = useState(0);
  const [novArtikelPostavka, setNovArtikelPostavka] = useState<NeuparjenaPostavka | null>(null);

  // ─── Pomočniki ───────────────────────────────────────────────────────────

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
  };

  const zapri = () => { resetState(); onClose(); };

  // ─── Upload ──────────────────────────────────────────────────────────────

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
        setNapaka('Ta dobavnica je bila že uvožena (podvojena datoteka).');
        return;
      }
      if (!r.ok || data.status !== 'OSNUTEK_USTVARJEN') {
        setNapaka(data.sporocilo ?? `Uvoza ni bilo mogoče dokončati (${data.status ?? r.status}).`);
        return;
      }

      // Pridobi neuparjene postavke
      const nr = await fetch(
        `${base}/api/uvoz/prejemnice/${data.prejemnicaId}/neuparjeno`,
        { credentials: 'include', headers: enotaHeader() },
      );
      const nd = await nr.json();

      const dobaviteljId: number | null = data.dobaviteljId ?? null;
      setIzid({
        prejemnicaId: data.prejemnicaId,
        dobaviteljId,
        dobaviteljNaziv: dobaviteljId
          ? (dobaviteljiMap.get(dobaviteljId) ?? 'Neznan dobavitelj')
          : 'Neznan dobavitelj',
        stDokumenta:     data.stDokumenta     ?? null,
        datumDokumenta:  data.datumDokumenta  ?? null,
        ceneBruto:       data.ceneBruto       ?? false,
        uparjenih:       data.uparjenih       ?? 0,
      });
      setNeuparjene(nd.vsebina ?? []);
      setStUparjenih(data.uparjenih ?? 0);
      setKorak('uparjanje');
    } catch (e) {
      setNapaka((e as Error).message ?? 'Napaka pri nalaganju datoteke.');
    } finally {
      setNalaga(false);
    }
  }, [base, dobaviteljiMap]);

  // ─── Uparjanje callbacki ─────────────────────────────────────────────────

  const onUpari = useCallback(async (
    postavkaId: number,
    artikelId: number,
    enotVPaketu: string,
    zapomni: boolean,
  ): Promise<void> => {
    const r = await fetch(`${base}/api/uvoz/postavke/${postavkaId}/upari`, {
      method: 'POST',
      credentials: 'include',
      headers: { ...enotaHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({ artikelId, enotVPaketu, zapomni }),
    });
    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.sporocilo ?? 'Uparjanje ni uspelo.');
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
        artikelId:        a.id,
        sifra:            null,
        naziv:            a.ime,
        osnovnaEnota:     a.enotaMere ?? null,
        zadnjaCenaEnota:  null,
        enotVPaketu:      null,
        ocena:            0.5,
        znanDobavitelj:   false,
      }));
  }, [nabavniArtikli]);

  const onNovArtikel = useCallback((p: NeuparjenaPostavka) => {
    setNovArtikelPostavka(p);
    setKorak('nov_artikel');
  }, []);

  const onNovArtikelShrani = useCallback(async (
    v: NovArtikelVhod,
  ): Promise<{ artikelId: number }> => {
    const r = await fetch(`${base}/api/artikli`, {
      method: 'POST',
      credentials: 'include',
      headers: { ...enotaHeader(), 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ime:              v.naziv,
        nabavniArtikel:   true,
        prodajniArtikel:  v.tip === 'NABAVNO_PRODAJNI',
        enotaMere:        v.osnovnaEnota,
        davek:            Number(v.nabavnaDdvStopnja),
        gtin:             v.gtin ?? undefined,
      }),
    });
    const data = await r.json();
    if (!r.ok) throw new Error(data.sporocilo ?? 'Ustvarjanje artikla ni uspelo.');
    setKorak('uparjanje');
    return { artikelId: data.id };
  }, [base]);

  const onZakljuci = useCallback(() => {
    toast({
      title: `Uvoz dokončan`,
      description: `${stUparjenih} artikel${stUparjenih === 1 ? '' : 'ov'} uparjenih`,
    });
    onUvozDone();
    zapri();
  }, [stUparjenih, onUvozDone, toast]);

  // ─── Prikaz ──────────────────────────────────────────────────────────────

  // Nov artikel dialog (ni modal nad modalem — nadomesti upload dialog)
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

  // Uparjanje dialog
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

  // Upload zaslon
  return (
    <Dialog open={open} onOpenChange={v => { if (!v) zapri(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Uvozi dobavnico</DialogTitle>
        </DialogHeader>

        <div className="py-2 space-y-4">
          {napaka && (
            <div className="flex items-start gap-2 rounded-md bg-destructive/10 text-destructive p-3 text-sm">
              <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
              <span>{napaka}</span>
            </div>
          )}

          {/* Povleci ali klikni */}
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
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={zapri} disabled={nalaga}>
            Prekliči
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
