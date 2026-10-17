// artifacts/web/src/pos/uvoz/UparjanjeDialog.tsx
//
// Zaslon za seznanjanje uvoženih postavk z nabavnimi artikli.
//
// Dopolnilo obstoječemu zaslonu "Uredi prejemnico". Ko so vse postavke
// seznanjene, se odpre obstoječi zaslon, napolnjen s podatki.
//
// Razredi CSS so pisani v slogu Tailwinda; prilagodi jih svojemu
// oblikovnemu sistemu. Barva poudarka sledi oranžni z obstoječega zaslona.

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { jeMismatchVelikosti } from './uparjanjeNaziv';
import { isEditableKeyboardTarget } from '@/lib/keyboard-events';
import { KlavijaturaInput } from '@/components/KlavijaturaInput';
import { areEslogUnitsCompatible } from '@/lib/skupinski-nabavni-artikel';
import {
  MassYieldFields,
  EMPTY_MASS_YIELD,
  normalizeMassYield,
  normalizeMassYieldOverrides,
  type MassYieldValues,
} from '@/components/MassYieldFields';

// =====================================================================
// Tipi (ustrezajo odgovoru /api/pos/uvoz/prejemnice/:id/neuparjeno)
// =====================================================================

export interface Kandidat {
  artikelId: number;
  sifra: string | null;
  naziv: string;
  osnovnaEnota: string | null;
  zadnjaCenaEnota: string | null;
  enotVPaketu: string | null;
  ocena: number;
  znanDobavitelj: boolean;
  /** false = artikel je deaktiviran; prikazan z opozorilom */
  aktiven?: boolean;
  aiPredlog?: boolean;
  aiRazlog?: string;
  jeSkupinskiNabavniArtikel?: boolean;
  brutoTezaG?: number | string | null;
  netoTezaG?: number | string | null;
  netoDelezOdst?: number | string | null;
}

export interface Opozorilo {
  koda: string;
  resnost: 'B' | 'O' | 'I';
  sporocilo: string;
  podatki?: Record<string, unknown>;
}

export interface NeuparjenaPostavka {
  id: number;
  artikel_id?: number | null;
  vrstica_tip?: 'zaloga' | 'poraba_surovin' | 'prevoz';
  zap_st: number;
  izv_gtin: string | null;
  izv_sifra: string | null;
  izv_naziv: string;
  izv_enota: string | null;
  izv_kolicina: string;
  izv_cena: string;
  enot_v_paketu: string;
  izbrano_enot_v_paketu?: string;
  uparjanje_zaupanje: number | null;
  uparjanje_kandidati: Kandidat[] | null;
  opozorila: Opozorilo[] | string | null;
  brutoTezaG?: number | string | null;
  netoTezaG?: number | string | null;
  netoDelezOdst?: number | string | null;
  izvKolicina?: number | string | null;
  ddvStopnja?: number | string | null;
}

export function pripraviPostavkoZaNovArtikel(
  postavka: NeuparjenaPostavka,
  pakiranje: string,
): NeuparjenaPostavka {
  const izbranoPakiranje = pakiranje.trim() || postavka.enot_v_paketu || '1';
  return {
    ...postavka,
    enot_v_paketu: izbranoPakiranje,
    izbrano_enot_v_paketu: izbranoPakiranje,
  };
}

export function jeEnotaSkupinskegaKandidataSkladna(
  postavka: Pick<NeuparjenaPostavka, 'izv_enota'> | null | undefined,
  kandidat: Pick<Kandidat, 'jeSkupinskiNabavniArtikel' | 'osnovnaEnota'>,
): boolean {
  return !kandidat.jeSkupinskiNabavniArtikel
    || areEslogUnitsCompatible(postavka?.izv_enota, kandidat.osnovnaEnota);
}

interface Lastnosti {
  prejemnicaId: number;
  dobaviteljNaziv: string;
  dobaviteljPolniNaziv?: string;
  stDokumenta: string | null;
  datum: string | null;
  ceneBruto: boolean;
  jeDdvZavezanec: boolean;
  steviloUparjenih: number;
  postavke: NeuparjenaPostavka[];
  /** Vrne število preostalih (neuparjenih) postavk po uspešnem upari. */
  onUpari: (postavkaId: number, artikelId: number | null, enotVPaketu: string,
             zapomni: boolean, vrsticaTip: string, massYield: Partial<ReturnType<typeof normalizeMassYield>>) => Promise<number>;
  onNovArtikel: (postavka: NeuparjenaPostavka) => void;
  onIsci: (niz: string, postavka: NeuparjenaPostavka) => Promise<Kandidat[]>;
  onZakljuci: () => void;
  onPreklici: () => void;
  /** Opcijsko: prenese e-SLOG ZIP paket za to prejemnico. */
  onPrenesiEslog?: () => Promise<void>;
}

// =====================================================================
// Pomožno
// =====================================================================

const denar = (v: string | null | undefined, decimalk = 2): string =>
  v === null || v === undefined || v === ''
    ? '—'
    : new Intl.NumberFormat('sl-SI', {
        minimumFractionDigits: decimalk,
        maximumFractionDigits: decimalk,
      }).format(Number(v));

function cenaNaEnoto(cenaPaket: string, enotVPaketu: string): string | null {
  const c = Number(cenaPaket);
  const p = Number(enotVPaketu);
  if (!Number.isFinite(c) || !Number.isFinite(p) || p <= 0) return null;
  return (c / p).toFixed(4);
}

function normalizirajOpozorila(vrednost: NeuparjenaPostavka['opozorila']): Opozorilo[] {
  if (Array.isArray(vrednost)) return vrednost;
  if (!vrednost) return [];
  try {
    const parsed = JSON.parse(vrednost) as unknown;
    return Array.isArray(parsed) ? parsed as Opozorilo[] : [];
  } catch {
    return [];
  }
}

function barvaOcene(ocena: number): string {
  if (ocena >= 0.9) return 'text-emerald-700';
  if (ocena >= 0.75) return 'text-amber-700';
  return 'text-neutral-500';
}

// =====================================================================
// Sestavni del
// =====================================================================

export function UparjanjeDialog(l: Lastnosti) {
  const [kazalo, setKazalo] = useState(0);
  const [izbran, setIzbran] = useState<number | null>(null);
  const [zapomni, setZapomni] = useState(true);
  const [iskanje, setIskanje] = useState('');
  const [najdeni, setNajdeni] = useState<Kandidat[]>([]);
  const [dela, setDela] = useState(false);
  const [napaka, setNapaka] = useState<string | null>(null);
  const [pakiranje, setPakiranje] = useState<string>('1');
  const [vrsticaTip, setVrsticaTip] = useState<'zaloga' | 'poraba_surovin' | 'prevoz'>('zaloga');
  const [massYield, setMassYield] = useState<MassYieldValues>({ ...EMPTY_MASS_YIELD });
  const [massYieldTouched, setMassYieldTouched] = useState<Partial<Record<keyof MassYieldValues, boolean>>>({});
  const iskalnoPolje = useRef<HTMLInputElement>(null);
  const pakiranjePolje = useRef<HTMLInputElement>(null);
  const potrdiGumb = useRef<HTMLButtonElement>(null);
  const vsebina = useRef<HTMLDivElement>(null);
  const jePrviPrikaz = useRef(true);
  const jePrivzetoPakiranjePocisceno = useRef(false);

  const postavka = l.postavke[kazalo];
  const skupaj = l.postavke.length;

  // Predlogi iz zaledja, dopolnjeni z rezultati ročnega iskanja.
  // Dedupliciramo po artikelId — starejši uvozi so morda shranili dvojnike
  // (napaka v GROUP BY pri trigramskem iskanju, popravljena z LATERAL).
  const kandidati = useMemo<Kandidat[]>(() => {
    const osnovni = postavka?.uparjanje_kandidati ?? [];
    const dodatni = najdeni;

    const po = new Map<number, Kandidat>();
    for (const k of [...osnovni, ...dodatni]) {
      const obs = po.get(k.artikelId);
      if (!obs || k.ocena > obs.ocena ||
          (k.ocena === obs.ocena && Number(k.zadnjaCenaEnota ?? 0) > Number(obs.zadnjaCenaEnota ?? 0))) {
        po.set(k.artikelId, k);
      }
    }
    // Ohranjamo vrstni red po oceni (najvišja prva).
    return [...po.values()].sort((a, b) => b.ocena - a.ocena);
  }, [postavka, najdeni]);
  const kandidatiZaIzbiro = useMemo(
    () => kandidati.filter(k => jeEnotaSkupinskegaKandidataSkladna(postavka, k)),
    [kandidati, postavka],
  );
  const izbraniKandidat = kandidati.find(kandidat => kandidat.artikelId === izbran);
  const massYieldValue: MassYieldValues = {
    brutoTezaG: !massYieldTouched.brutoTezaG && !massYield.brutoTezaG
      ? izbraniKandidat?.brutoTezaG == null ? "" : String(izbraniKandidat.brutoTezaG)
      : massYield.brutoTezaG,
    netoTezaG: !massYieldTouched.netoTezaG && !massYield.netoTezaG
      ? izbraniKandidat?.netoTezaG == null ? "" : String(izbraniKandidat.netoTezaG)
      : massYield.netoTezaG,
    netoDelezOdst: !massYieldTouched.netoDelezOdst && !massYield.netoDelezOdst
      ? izbraniKandidat?.netoDelezOdst == null ? "" : String(izbraniKandidat.netoDelezOdst)
      : massYield.netoDelezOdst,
  };

  // Ob prehodu na novo postavko počisti stanje in predizberi najboljšega.
  useEffect(() => {
    const prviKandidat = postavka?.uparjanje_kandidati?.[0];
    const trenutnoIzbrani = postavka?.artikel_id ?? prviKandidat?.artikelId ?? null;
    const kandidat = postavka?.uparjanje_kandidati?.find(k => k.artikelId === trenutnoIzbrani);
    setIzbran(kandidat && !jeEnotaSkupinskegaKandidataSkladna(postavka, kandidat) ? null : trenutnoIzbrani);
    setPakiranje(prviKandidat?.enotVPaketu ?? postavka?.enot_v_paketu ?? '1');
    setVrsticaTip(postavka?.vrstica_tip ?? 'zaloga');
    setMassYield({
      brutoTezaG: postavka?.brutoTezaG == null ? '' : String(postavka.brutoTezaG),
      netoTezaG: postavka?.netoTezaG == null ? '' : String(postavka.netoTezaG),
      netoDelezOdst: postavka?.netoDelezOdst == null ? '' : String(postavka.netoDelezOdst),
    });
    setMassYieldTouched({});
    setIskanje('');
    setNajdeni([]);
    setNapaka(null);
    jePrivzetoPakiranjePocisceno.current = false;
  }, [postavka?.id]);

  // Po potrditvi se na istem mestu pokaže naslednja postavka. Na telefonu
  // ohranjen scroll pusti uporabnika pri dnu prejšnje, zato ga vedno vrnemo
  // na začetek in tam pripravimo prvo vnosno polje.
  useLayoutEffect(() => {
    const jePrvi = jePrviPrikaz.current;
    jePrviPrikaz.current = false;
    vsebina.current?.scrollTo({ top: 0, behavior: 'auto' });
    if (!jePrvi) {
      requestAnimationFrame(() => {
        pakiranjePolje.current?.focus({ preventScroll: true });
        pakiranjePolje.current?.select();
      });
    }
  }, [postavka?.id]);

  // Ko se izbrani kandidat zamenja, posodobi pakiranje iz zapomnjene vrednosti.
  useEffect(() => {
    if (izbran === null) return;
    const k = kandidati.find((x) => x.artikelId === izbran);
    if (k?.enotVPaketu) setPakiranje(k.enotVPaketu);
  }, [izbran, kandidati]);

  const potrdi = useCallback(async () => {
    if (!postavka || dela) return;
    if (vrsticaTip === 'zaloga' && (
      izbran === null
      || !kandidatiZaIzbiro.some(k => k.artikelId === izbran)
    )) return;
    setDela(true);
    setNapaka(null);
    try {
      // onUpari vrne število preostalih postavk po odstranitvi — zanesljivo,
      // brez stale-closure problema (izračunano iz prev v setState updaterju).
      const ostalo = await l.onUpari(
        postavka.id, vrsticaTip === 'zaloga' ? izbran : null, pakiranje || postavka.enot_v_paketu, zapomni, vrsticaTip,
        normalizeMassYieldOverrides(massYieldValue, massYieldTouched),
      );
      if (ostalo === 0) {
        l.onZakljuci();
      }
      // else: starš je odstranil to postavko; naslednja je zdaj na istem kazalu.
    } catch (e) {
      setNapaka((e as Error).message);
    } finally {
      setDela(false);
    }
  }, [postavka, izbran, dela, pakiranje, zapomni, vrsticaTip, l, kandidatiZaIzbiro, massYieldValue, massYieldTouched]);

  const odpriNovArtikel = useCallback(() => {
    if (!postavka) return;
    l.onNovArtikel(pripraviPostavkoZaNovArtikel(postavka, pakiranje));
  }, [l, pakiranje, postavka]);

  // Seznanjanje mora biti izvedljivo brez miške — kdor prevzema blago,
  // ima pogosto eno roko na dobavnici.
  useEffect(() => {
    const naTipko = (e: KeyboardEvent) => {
      if (document.activeElement === iskalnoPolje.current) {
        if (e.key === 'Escape') iskalnoPolje.current?.blur();
        return;
      }
      if (
        isEditableKeyboardTarget(e.target)
        || isEditableKeyboardTarget(document.activeElement)
      ) return;
      if (e.key >= '1' && e.key <= '9') {
        const i = Number(e.key) - 1;
        if (kandidatiZaIzbiro[i]) { setIzbran(kandidatiZaIzbiro[i].artikelId); e.preventDefault(); }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const trenutni = kandidatiZaIzbiro.findIndex((k) => k.artikelId === izbran);
        const nasl = e.key === 'ArrowDown'
          ? Math.min(trenutni + 1, kandidatiZaIzbiro.length - 1)
          : Math.max(trenutni - 1, 0);
        if (kandidatiZaIzbiro[nasl]) setIzbran(kandidatiZaIzbiro[nasl].artikelId);
        e.preventDefault();
      } else if (e.key === 'Enter') {
        void potrdi(); e.preventDefault();
      } else if (e.key.toLowerCase() === 'n') {
        odpriNovArtikel(); e.preventDefault();
      } else if (e.key === 'Escape') {
        if (kazalo + 1 < skupaj) setKazalo(kazalo + 1);
        e.preventDefault();
      } else if (e.key === 'Tab') {
        iskalnoPolje.current?.focus(); e.preventDefault();
      } else if (e.key === 'F2') {
        l.onZakljuci(); e.preventDefault();
      }
    };
    window.addEventListener('keydown', naTipko);
    return () => window.removeEventListener('keydown', naTipko);
  }, [kandidatiZaIzbiro, izbran, kazalo, skupaj, postavka, potrdi, odpriNovArtikel, l]);

  // Kadar starš odstrani postavko (po potrditvi) in je kazalo zdaj izven
  // obsega (npr. po preskoku z Escape), ga vrnemo na zadnjo veljavno postavko.
  useEffect(() => {
    if (l.postavke.length > 0 && kazalo >= l.postavke.length) {
      setKazalo(l.postavke.length - 1);
    }
  }, [l.postavke.length, kazalo]);

  // Iskanje z zamikom, da vsak pritisk tipke ne sproži zahtevka.
  useEffect(() => {
    if (iskanje.trim().length < 2) { setNajdeni([]); return; }
    const id = setTimeout(() => { void l.onIsci(iskanje, postavka).then(setNajdeni); }, 250);
    return () => clearTimeout(id);
  }, [iskanje, l, postavka]);

  if (!postavka) return null;

  const cenaEnota = cenaNaEnoto(postavka.izv_cena, postavka.enot_v_paketu);
  const skupnaVrednost =
    Number(postavka.izv_kolicina) * Number(postavka.izv_cena);
  const predogledKolicina = Number(postavka.izv_kolicina) * (Number(pakiranje.replace(',', '.')) || 1);
  const jePrivzetoPakiranje = Number(pakiranje.replace(',', '.')) === 1;

  const pripraviVnosPakiranja = () => {
    // Mobilni brskalniki pri prvem tapu pogosto ne ohranijo select() izbire.
    // Privzeti OCR zapis 1,0000 zato ob prvem tapu res izpraznimo, da lahko
    // uporabnik takoj vpiše npr. 20 brez več zaporednih brisanj.
    if (jePrivzetoPakiranje && !jePrivzetoPakiranjePocisceno.current) {
      jePrivzetoPakiranjePocisceno.current = true;
      setPakiranje('');
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex touch-pan-y items-center justify-center overscroll-contain bg-black/40 p-4 pb-20 md:pb-4">
      <div className="flex w-full max-w-3xl flex-col rounded-lg bg-white shadow-xl max-h-[calc(100vh-5rem)] md:max-h-[90vh]">

        {/* glava */}
        <div className="flex shrink-0 items-start justify-between border-b px-3 py-2 sm:px-5 sm:py-3">
          <div className="min-w-0 pr-2">
            <h2
              className="truncate text-sm font-semibold sm:text-base"
              title={l.dobaviteljPolniNaziv ?? l.dobaviteljNaziv}
            >
              Uvoz prejemnice · {l.dobaviteljNaziv}
            </h2>
            <p className="truncate text-xs text-neutral-500">
              {l.stDokumenta && <>Dokument {l.stDokumenta} · </>}
              {l.datum} · cene: {l.ceneBruto ? 'BRUTO' : 'NETO'}
            </p>
          </div>
          <button onClick={l.onPreklici} aria-label="Zapri"
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100">✕</button>
        </div>

        {/* povzetek: prikažemo SAMO postavke, ki potrebujejo odločitev */}
        <div className="flex shrink-0 items-center gap-4 border-b bg-neutral-50 px-6 py-2 text-sm">
          <span className="text-emerald-700">
            ✓ Samodejno seznanjene postavke: {l.steviloUparjenih}
          </span>
          <span className="text-amber-700">
            ⚠ {skupaj} {skupaj === 1 ? 'postavka potrebuje' : 'postavk potrebuje'} vašo odločitev
          </span>
        </div>

        <div ref={vsebina} className="overflow-y-auto overscroll-contain px-6 py-4">
          <p className="mb-2 text-sm text-neutral-500">{kazalo + 1} / {skupaj}</p>

          {/* izvorni zapis z dobavnice */}
          <div className="rounded-md border border-neutral-200 bg-neutral-50 p-3">
            <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
              Na dobavnici
            </p>
            <p className="mt-1 font-medium">{postavka.izv_naziv}</p>
            <p className="mt-0.5 text-sm text-neutral-600">
              {postavka.izv_sifra && <>šifra {postavka.izv_sifra}</>}
              {postavka.izv_gtin && <> · EAN {postavka.izv_gtin.replace(/^0+/, '')}</>}
              {postavka.izv_enota && <> · {postavka.izv_enota}</>}
            </p>
            <p className="mt-1 text-sm">
              {denar(postavka.izv_kolicina, 0)} paket
              {' × '}{denar(postavka.izv_cena, 3)} €/paket
              {' = '}<strong>{denar(String(skupnaVrednost))} €</strong>
            </p>
            <div className="mt-2 flex items-center gap-2 text-sm">
              <label className="text-neutral-500 shrink-0">Enot v paketu:</label>
              <KlavijaturaInput
                ref={pakiranjePolje}
                type="text"
                inputMode="decimal"
                value={pakiranje}
                naslov="Enot v paketu"
                klavijaturaPlaceholder="npr. 20"
                onPointerDown={pripraviVnosPakiranja}
                onFocus={e => e.currentTarget.select()}
                onChange={vrednost => setPakiranje(vrednost.replace(',', '.'))}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); potrdiGumb.current?.focus(); } }}
                className="w-20 rounded border border-neutral-300 px-2 py-0.5 text-sm text-center focus:outline-none focus:ring-1 focus:ring-orange-400"
              />
              {Number(pakiranje) > 1 && Number(postavka.izv_cena) > 0 && (
                <span className="text-neutral-500">
                  = {denar(String(Number(postavka.izv_cena) / Number(pakiranje)), 4)} €/enoto
                </span>
              )}
            </div>
            <MassYieldFields
              key={`receipt-mass-${postavka.id}`}
              value={massYieldValue}
              onChange={next => {
                const keys = ["brutoTezaG", "netoTezaG", "netoDelezOdst"] as const;
                const changed = keys.filter(key => next[key] !== massYieldValue[key]);
                if (changed.length === 0) return;
                setMassYield(previous => ({
                  ...previous,
                  ...Object.fromEntries(changed.map(key => [key, next[key]])),
                }));
                setMassYieldTouched(previous => ({
                  ...previous,
                  ...Object.fromEntries(changed.map(key => [key, true])),
                }));
              }}
              sourceUnit={postavka.izv_enota}
              baseUnit={kandidati.find(candidate => candidate.artikelId === izbran)?.osnovnaEnota}
              autoOpen={["kg", "kgm"].includes(
                kandidati.find(candidate => candidate.artikelId === izbran)?.osnovnaEnota?.trim().toLowerCase() ?? "",
              )}
              quantityUnit={postavka.izv_enota}
              purchaseQuantity={String(predogledKolicina)}
              quantity={predogledKolicina}
              lineValue={skupnaVrednost}
              priceMode={l.ceneBruto ? "bruto" : "neto"}
              taxRate={postavka.ddvStopnja == null ? null : Number(postavka.ddvStopnja)}
              buyerVatRegistered={l.jeDdvZavezanec}
            />
          </div>
          <div className="mt-3 rounded-md border border-orange-200 bg-orange-50 p-3">
            <label className="text-sm font-medium">Obravnava vrstice</label>
            <select value={vrsticaTip} onChange={e => setVrsticaTip(e.target.value as typeof vrsticaTip)}
              className="ml-2 rounded border px-2 py-1 text-sm">
              <option value="zaloga">Zaloga (artikel)</option>
              <option value="poraba_surovin">Neposredna poraba surovin</option>
              <option value="prevoz">Prevozne storitve pri nabavi</option>
            </select>
            {vrsticaTip !== 'zaloga' && <p className="mt-1 text-xs text-orange-800">Artikel ni potreben; vrstica gre neposredno v strošek.</p>}
          </div>

          {/* opozorila razčlenitve */}
          {normalizirajOpozorila(postavka.opozorila).map((o) => (
            <div key={o.koda}
                 className={`mt-2 rounded-md px-3 py-2 text-sm ${
                   o.resnost === 'B'
                     ? 'bg-red-50 text-red-800'
                     : 'bg-amber-50 text-amber-800'}`}>
              {o.sporocilo}
            </div>
          ))}

          <p className="my-3 text-center text-sm text-neutral-400">↓ Seznanjanje z nabavnim artiklom</p>

          {kandidati.some(k => k.jeSkupinskiNabavniArtikel) && (
            <div className="mb-2 rounded-md border border-blue-200 bg-blue-50 px-3 py-2 text-sm">
              <p className="text-xs font-semibold uppercase tracking-wide text-blue-800">Dobaviteljeva postavka → skupinski nabavni artikel</p>
              <p className="mt-1 text-blue-950">
                <span className="font-medium">{postavka.izv_naziv}</span>
                <span className="text-blue-700"> ({postavka.izv_enota ?? 'enota ni navedena'})</span>
                {' → '}
                {(() => {
                  const selected = kandidati.find(k => k.artikelId === izbran && k.jeSkupinskiNabavniArtikel);
                  return selected
                    ? <span className="font-semibold">{selected.naziv} ({selected.osnovnaEnota ?? 'brez enote'})</span>
                    : <span className="text-blue-700">izberite združljiv skupinski artikel</span>;
                })()}
              </p>
            </div>
          )}

          {/* kandidati */}
          <div className="rounded-md border border-neutral-200">
            {kandidati.length === 0 && (
              <p className="px-3 py-4 text-sm text-neutral-500">
                Ni podobnih artiklov. Poiščite ga ročno ali ustvarite novega.
              </p>
            )}

            {kandidati.map(k => {
              const enotaNeSklada = !jeEnotaSkupinskegaKandidataSkladna(postavka, k);
              const izbirniIndeks = kandidatiZaIzbiro.findIndex(x => x.artikelId === k.artikelId);
              const kandidatCena = k.zadnjaCenaEnota;
              const razlika =
                cenaEnota && kandidatCena && Number(kandidatCena) > 0
                  ? ((Number(cenaEnota) - Number(kandidatCena)) /
                      Number(kandidatCena)) * 100
                  : null;
              const velikostNeSklada = jeMismatchVelikosti(k.naziv, postavka.izv_naziv);

              return (
                <label key={k.artikelId}
                  className={`flex ${enotaNeSklada ? 'cursor-not-allowed opacity-55' : 'cursor-pointer'} items-start sm:items-center gap-2 sm:gap-3 border-b px-3 py-2 last:border-b-0
                              ${izbran === k.artikelId ? 'bg-orange-50' : 'hover:bg-neutral-50'}`}>
                  <input type="radio" name="kandidat" checked={izbran === k.artikelId}
                         disabled={enotaNeSklada}
                         onChange={() => setIzbran(k.artikelId)}
                         className="accent-orange-600 mt-0.5 sm:mt-0 shrink-0" />
                  {izbirniIndeks >= 0 && izbirniIndeks < 9 && (
                    <kbd className="rounded border bg-white px-1.5 text-xs text-neutral-500 shrink-0 mt-0.5 sm:mt-0">
                      {izbirniIndeks + 1}
                    </kbd>
                  )}
                  {/* Ime artikla:
                      • mobilno (selfie/kamera): text-xs, prelom na 2 vrstici (line-clamp-2)
                      • desktop (sm+): text-sm, ena vrstica z rezanjem (truncate) */}
                  <span className="flex-1 min-w-0 overflow-hidden">
                    <span className="block text-xs leading-snug line-clamp-2 sm:text-sm sm:leading-normal sm:whitespace-nowrap sm:overflow-hidden sm:text-ellipsis sm:[display:block]">
                      {k.naziv}
                    </span>
                    {(kandidati.filter(c => c.naziv === k.naziv).length > 1 ||
                      k.aktiven === false || velikostNeSklada || k.jeSkupinskiNabavniArtikel || enotaNeSklada) && (
                      <span className="flex flex-wrap gap-1 mt-0.5">
                        {kandidati.filter(c => c.naziv === k.naziv).length > 1 && (
                          <span className="text-xs text-neutral-400">#{k.artikelId}</span>
                        )}
                        {k.aktiven === false && (
                          <span className="rounded bg-amber-100 px-1 py-0.5 text-xs font-medium text-amber-700">
                            neaktiven
                          </span>
                        )}
                        {k.aiPredlog && (
                          <span title={k.aiRazlog || 'AI je prepoznal pomensko podobnost'}
                                className="rounded bg-violet-100 px-1 py-0.5 text-xs font-medium text-violet-700">
                            AI predlog
                          </span>
                        )}
                        {k.jeSkupinskiNabavniArtikel && (
                          <span className="rounded bg-blue-100 px-1 py-0.5 text-xs font-medium text-blue-800">
                            skupinski nabavni artikel
                          </span>
                        )}
                        {enotaNeSklada && (
                          <span title={`Enota dobavitelja (${postavka.izv_enota ?? 'ni navedena'}) ne ustreza enoti skupinskega artikla (${k.osnovnaEnota ?? 'ni navedena'})`}
                                className="rounded bg-red-100 px-1 py-0.5 text-xs font-medium text-red-700">
                            neujemanje enote
                          </span>
                        )}
                        {velikostNeSklada && (
                          <span title="Velikost v imenu artikla se razlikuje od dobavnice — preverite enot v paketu"
                                className="rounded bg-amber-100 px-1 py-0.5 text-xs font-medium text-amber-700">
                            ⚠ velikost
                          </span>
                        )}
                      </span>
                    )}
                  </span>

                  {/* Enota in cena — skrita na ozkih zaslonih */}
                  {k.osnovnaEnota && (
                    <span className="hidden sm:inline shrink-0 text-sm text-neutral-500">({k.osnovnaEnota})</span>
                  )}

                  {/* Cena je močnejši signal od imena: dobavitelj piše
                      "Caj vrecka - Kamilica 20/1", mi imamo "Čaj vrečka -
                      Kamilica"; ceni 0,2738 in 0,26 ujemanje potrdita. */}
                  <span className="hidden sm:inline w-28 text-right text-sm shrink-0">
                    {kandidatCena ? `${denar(kandidatCena, 4)} €` : '—'}
                    {razlika !== null && Math.abs(razlika) >= 1 && (
                      <span className={Math.abs(razlika) > 15
                                       ? 'ml-1 text-red-600' : 'ml-1 text-neutral-400'}>
                        {razlika > 0 ? '+' : ''}{razlika.toFixed(0)}%
                      </span>
                    )}
                  </span>

                  {k.znanDobavitelj && (
                    <span title="Ta artikel že kupujete od tega dobavitelja"
                          className="shrink-0 text-xs text-emerald-600">✓</span>
                  )}
                  <span className={`shrink-0 w-10 text-right text-sm ${barvaOcene(k.ocena)}`}>
                    {Math.round(k.ocena * 100)} %
                  </span>
                </label>
              );
            })}

            <div className="border-t px-3 py-2">
              <p className="mb-1 text-xs text-neutral-400">
                Išči po imenu med vsemi artikli <kbd className="rounded border px-1 text-[10px]">Tab</kbd>
              </p>
              <KlavijaturaInput ref={iskalnoPolje} value={iskanje}
                     onChange={setIskanje}
                     naslov="Iskanje artikla"
                     klavijaturaPlaceholder="Vtipkaj 2+ znake…"
                     placeholder="Vtipkaj 2+ znake…"
                     className="w-full rounded border px-2 py-1 text-sm outline-none
                                focus:border-orange-500" />
            </div>

            <button onClick={odpriNovArtikel}
                    className="w-full border-t px-3 py-2 text-left text-sm
                               text-orange-700 hover:bg-orange-50">
              ＋ Ustvari nov nabavni artikel <kbd className="ml-1 text-xs">N</kbd>
            </button>
          </div>

          {/* učenje: brez tega je vsak naslednji uvoz enako ročen */}
          {(() => {
            // Sidro je šifra, GTIN ali (vedno prisoten) naziv dobavitelja
            const imaSidro = !!(
              postavka.izv_sifra?.trim() ||
              postavka.izv_gtin?.trim() ||
              postavka.izv_naziv?.trim()
            );
            const sidroOpis = postavka.izv_sifra?.trim()
              ? `šifra ${postavka.izv_sifra}`
              : postavka.izv_gtin?.trim()
              ? `EAN ${postavka.izv_gtin.replace(/^0+/, '')}`
              : postavka.izv_naziv?.trim()
              ? `naziv "${postavka.izv_naziv}"`
              : null;
            return (
              <label className={`mt-3 flex items-center gap-2 text-sm ${
                imaSidro ? 'cursor-pointer' : 'cursor-not-allowed opacity-50'}`}>
                <input type="checkbox" checked={zapomni && imaSidro}
                       onChange={(e) => imaSidro && setZapomni(e.target.checked)}
                       disabled={!imaSidro}
                       className="accent-orange-600 disabled:cursor-not-allowed" />
                Zapomni si za tega dobavitelja
                {imaSidro && sidroOpis && (
                  <span className="text-xs text-neutral-400">({sidroOpis})</span>
                )}
              </label>
            );
          })()}

          {napaka && (
            <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-800">{napaka}</p>
          )}
        </div>

        {/* noga */}
        <div className="flex shrink-0 items-center justify-between gap-1 border-t px-2 py-1.5 sm:px-4 sm:py-2">
          <div className="flex items-center gap-1">
            <button onClick={() => kazalo + 1 < skupaj ? setKazalo(kazalo + 1) : l.onZakljuci()}
                    className="h-8 rounded px-2 text-xs text-neutral-600 hover:bg-neutral-100 sm:px-3 sm:text-sm">
              Preskoči <kbd className="ml-0.5 text-[10px]">Esc</kbd>
            </button>
            {l.onPrenesiEslog && (
              <button
                onClick={() => void l.onPrenesiEslog!()}
                title="Prenesi e-SLOG ZIP paket prejetega računa"
                className="h-8 rounded border px-2 text-xs text-neutral-600 hover:bg-neutral-50 sm:px-3 sm:text-sm">
                ⬇ e-SLOG
              </button>
            )}
          </div>
          <div className="flex gap-1">
            <button onClick={l.onZakljuci}
                    className="h-8 rounded border px-2 text-xs hover:bg-neutral-50 sm:px-3 sm:text-sm">
              Zaključi <kbd className="ml-0.5 text-[10px]">F2</kbd>
            </button>
          <button ref={potrdiGumb} onClick={() => void potrdi()} disabled={(vrsticaTip === 'zaloga' && (izbran === null || !kandidatiZaIzbiro.some(k => k.artikelId === izbran))) || dela}
                    className="h-8 rounded bg-orange-600 px-2 text-xs font-medium text-white
                               hover:bg-orange-700 disabled:opacity-40 sm:px-3 sm:text-sm">
              {dela ? 'Shranjujem…' : (
                <>Potrdi <kbd className="ml-0.5 text-[10px]">↵</kbd></>
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

// =====================================================================
// Vprašanje ob spremembi pakiranja
// =====================================================================

/**
 * Ko dobavitelj zmanjša karton s 24 na 20 kosov ob nespremenjeni ceni
 * kartona, je to 20-odstotna podražitev, ki je z gledanjem računa ni
 * mogoče opaziti. Zato dobi lastno vprašanje in se ne seznani tiho.
 */
export function PakiranjeSpremenjeno(p: {
  artikelNaziv: string;
  staroPakiranje: string;
  novoPakiranje: string;
  cenaPaket: string;
  onUporabiNovo: () => void;
  onObdrziStaro: () => void;
  onPreklici: () => void;
}) {
  const staraCena = Number(p.cenaPaket) / Number(p.staroPakiranje);
  const novaCena = Number(p.cenaPaket) / Number(p.novoPakiranje);
  const razlika = ((novaCena - staraCena) / staraCena) * 100;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-md rounded-lg bg-white p-5 shadow-xl">
        <h3 className="flex items-center gap-2 font-semibold text-amber-700">
          ⚠ Spremenjeno pakiranje
        </h3>
        <p className="mt-3 font-medium">{p.artikelNaziv}</p>

        <table className="mt-3 w-full text-sm">
          <tbody>
            <tr className="text-neutral-600">
              <td className="py-1">doslej</td>
              <td className="py-1 text-right">{p.staroPakiranje} enot/paket</td>
              <td className="py-1 text-right">{denar(String(staraCena), 4)} €/enoto</td>
            </tr>
            <tr>
              <td className="py-1">na dobavnici</td>
              <td className="py-1 text-right">{p.novoPakiranje} enot/paket</td>
              <td className="py-1 text-right font-medium">
                {denar(String(novaCena), 4)} €/enoto
                <span className={razlika > 0 ? 'ml-1 text-red-600' : 'ml-1 text-emerald-600'}>
                  {razlika > 0 ? '+' : ''}{razlika.toFixed(1)} %
                </span>
              </td>
            </tr>
          </tbody>
        </table>

        <p className="mt-3 rounded bg-neutral-50 px-3 py-2 text-sm text-neutral-700">
          Cena paketa je enaka ({denar(p.cenaPaket)} €), cena enote je
          {razlika > 0 ? ' višja' : ' nižja'}.
        </p>

        <div className="mt-4 flex justify-end gap-2">
          <button onClick={p.onPreklici}
                  className="rounded px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100">
            Prekliči
          </button>
          <button onClick={p.onObdrziStaro}
                  className="rounded border px-3 py-2 text-sm hover:bg-neutral-50">
            Obdrži {p.staroPakiranje}
          </button>
          <button onClick={p.onUporabiNovo}
                  className="rounded bg-orange-600 px-3 py-2 text-sm font-medium text-white
                             hover:bg-orange-700">
            Uporabi {p.novoPakiranje}
          </button>
        </div>
      </div>
    </div>
  );
}
