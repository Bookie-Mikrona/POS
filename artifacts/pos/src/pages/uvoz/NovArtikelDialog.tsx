// artifacts/pos/src/pages/uvoz/NovArtikelDialog.tsx
//
// Ustvarjanje novega artikla iz postavke prevzema.
// Vsebuje iste vnose kot Menu → Nov artikel, brez da katerikoli manjka.

import { useEffect, useMemo, useRef, useState } from 'react';
import { predlagajArtikel } from './naziv';

// =====================================================================
// Konstante
// =====================================================================

const COLOR_PALETTE: (string | null)[] = [
  null,
  '#ef4444', '#f97316', '#eab308', '#22c55e',
  '#14b8a6', '#3b82f6', '#8b5cf6', '#ec4899',
  '#64748b', '#84cc16', '#06b6d4', '#f59e0b',
];

const DDV_KATEGORIJE = [
  { value: 'food',          label: 'Hrana',                                      opis: '9,5 %' },
  { value: 'hot_beverage',  label: 'Topla pijača',                               opis: '22 %'  },
  { value: 'cold_beverage', label: 'Hladna pijača',                              opis: '22 %'  },
  { value: 'food_drink',    label: 'Pijača-jed (gosta čokolada, smoothie …)',    opis: '9,5 %' },
  { value: 'alcoholic',     label: 'Alkohol',                                    opis: '22 %'  },
  { value: 'other',         label: 'Ostalo',                                     opis: '22 %'  },
] as const;

// =====================================================================
// Tipi
// =====================================================================

export type TaxCategory =
  | 'food' | 'hot_beverage' | 'cold_beverage'
  | 'alcoholic' | 'food_drink' | 'other';

export type TipArtikla = 'NABAVNI' | 'NABAVNO_PRODAJNI';
export type VrstaArtikla = 'blago' | 'material' | 'storitev';

export interface NovArtikelVhod {
  naziv:        string;
  imeZaNabavo:  string | null;
  tip:          TipArtikla;
  osnovnaEnota: string;
  gtin:         string | null;
  enotVPaketu:  string | null;
  taxCategory:  TaxCategory;
  addedSugar:   boolean;
  vrstaArtikla: VrstaArtikla;
  skupina:      string | null;
  // Izpeljane DDV stopnje (izračunane v dialogu iz nastavitev)
  prodajnaDdvStopnja:  number;
  nabavnaDdvStopnja:   number;
  // NABAVNO_PRODAJNI
  cena:         string;
  posCategoryId: number | null;
  aktiven:      boolean;
  barva:        string | null;
  jePica:       boolean;
  toGo:         boolean;
  toGoArtikli:  number[];
  happyHourCena: string;
  normativItems: { vhodniArtikelId: number; kolicina: string }[];
}

interface Postavka {
  izv_naziv:    string;
  izv_sifra:    string | null;
  izv_gtin:     string | null;
  izv_enota:    string | null;
  izv_cena:     string;
  enot_v_paketu: string;
}

interface PosKategorija { id: number; ime: string }
interface ArtikelMin   { id: number; ime: string; aktiven: boolean;
                         nabavniArtikel: boolean; prodajniArtikel: boolean;
                         enotaMere: string | null }

interface Lastnosti {
  postavka:        Postavka;
  dobaviteljNaziv: string;
  enote:           string[];
  apiBase:         string;
  getEnotaHeader:  () => Record<string, string>;
  onShrani:        (v: NovArtikelVhod) => Promise<{ artikelId: number }>;
  onPreklici:      () => void;
}

// =====================================================================
// DDV izpeljava (enako kot Menu.tsx)
// =====================================================================

function pricakovanaNabavnaDdv(
  cat: TaxCategory, addedSugar: boolean,
  stopnje = { splosnaSt: 22, nizjaSt: 9.5 },
): number {
  switch (cat) {
    case 'food':          return stopnje.nizjaSt;
    case 'food_drink':    return stopnje.nizjaSt;
    case 'hot_beverage':  return addedSugar ? stopnje.splosnaSt : stopnje.nizjaSt;
    case 'cold_beverage': return addedSugar ? stopnje.splosnaSt : stopnje.nizjaSt;
    case 'alcoholic':     return stopnje.splosnaSt;
    case 'other':         return stopnje.splosnaSt;
    default:              return stopnje.nizjaSt;
  }
}

function prodajnaDefaultDdv(
  cat: TaxCategory,
  stopnje = { splosnaSt: 22, nizjaSt: 9.5 },
): number {
  switch (cat) {
    case 'food':          return stopnje.nizjaSt;
    case 'food_drink':    return stopnje.nizjaSt;
    case 'hot_beverage':  return stopnje.splosnaSt;
    case 'cold_beverage': return stopnje.splosnaSt;
    case 'alcoholic':     return stopnje.splosnaSt;
    case 'other':         return stopnje.splosnaSt;
    default:              return stopnje.nizjaSt;
  }
}

// =====================================================================
// Sestavni del
// =====================================================================

export function NovArtikelDialog(l: Lastnosti) {
  const p = l.postavka;

  // Predlog iz OCR naziva
  const predlog = useMemo(
    () => predlagajArtikel(p.izv_naziv, p.izv_enota, p.enot_v_paketu ? Number(p.enot_v_paketu) : null),
    [p.izv_naziv, p.izv_enota, p.enot_v_paketu],
  );

  // ── Skupni vnosi ────────────────────────────────────────────────
  const [naziv,        setNaziv]        = useState(predlog.naziv);
  const [imeZaNabavo,  setImeZaNabavo]  = useState('');
  const [tip,          setTip]          = useState<TipArtikla>('NABAVNI');
  const [enota,        setEnota]        = useState(predlog.osnovnaEnota ?? '');
  const [enotVPaketu,  setEnotVPaketu]  = useState(String(predlog.enotVPaketu ?? p.enot_v_paketu ?? '1'));
  const [taxCategory,  setTaxCategory]  = useState<TaxCategory>('food');
  const [addedSugar,   setAddedSugar]   = useState(false);
  const [vrstaArtikla, setVrstaArtikla] = useState<VrstaArtikla>('material');
  const [skupina,      setSkupina]      = useState('');

  // ── Prodajni vnosi (NABAVNO_PRODAJNI) ──────────────────────────
  const [cena,         setCena]         = useState('');
  const [posCatId,     setPosCatId]     = useState<number | null>(null);
  const [aktiven,      setAktiven]      = useState(true);
  const [barva,        setBarva]        = useState<string | null>(null);
  const [jePica,       setJePica]       = useState(false);
  const [toGo,         setToGo]         = useState(false);
  const [toGoArtikli,  setToGoArtikli]  = useState<number[]>([]);
  const [happyHourCena, setHappyHourCena] = useState('');
  const [normativItems, setNormativItems] = useState<{ vhodniArtikelId: number; kolicina: string }[]>([]);

  // ── Naloženi podatki ────────────────────────────────────────────
  const [ddvStopnje,   setDdvStopnje]   = useState({ splosnaSt: 22, nizjaSt: 9.5 });
  const [posKat,       setPosKat]       = useState<PosKategorija[]>([]);
  const [artikliList,  setArtikliList]  = useState<ArtikelMin[]>([]);

  // ── Akcija ──────────────────────────────────────────────────────
  const [dela,  setDela]  = useState(false);
  const [napaka, setNapaka] = useState<string | null>(null);

  const base   = l.apiBase;
  const hdr    = l.getEnotaHeader;

  // Naloži DDV stopnje, POS kategorije in artikle
  useEffect(() => {
    const h = { credentials: 'include' as const, headers: hdr() };
    fetch(`${base}/api/nastavitve/ddv-stopnje`, h)
      .then(r => r.json())
      .then((d: unknown) => {
        const data = d as { splosnaSt?: number; nizjaSt?: number };
        if (data?.splosnaSt) setDdvStopnje({ splosnaSt: data.splosnaSt, nizjaSt: data.nizjaSt ?? 9.5 });
      }).catch(() => {});
    fetch(`${base}/api/kategorije`, h)
      .then(r => r.json())
      .then((d: unknown) => { if (Array.isArray(d)) setPosKat(d as PosKategorija[]); })
      .catch(() => {});
    fetch(`${base}/api/artikli`, h)
      .then(r => r.json())
      .then((d: unknown) => { if (Array.isArray(d)) setArtikliList(d as ArtikelMin[]); })
      .catch(() => {});
  }, [base]); // eslint-disable-line react-hooks/exhaustive-deps

  // Ob zamenjavi predloga iz OCR
  useEffect(() => {
    setNaziv(predlog.naziv);
    setEnota(predlog.osnovnaEnota ?? '');
    setEnotVPaketu(String(predlog.enotVPaketu ?? p.enot_v_paketu ?? '1'));
  }, [predlog, p.enot_v_paketu]);

  // Avtomatski normativ 1:1 ob preklopi na NABAVNO_PRODAJNI (enako kot Menu.tsx)
  useEffect(() => {
    if (tip === 'NABAVNO_PRODAJNI') {
      setNormativItems(prev =>
        prev.some(n => n.vhodniArtikelId === -1)
          ? prev
          : [{ vhodniArtikelId: -1, kolicina: '1' }, ...prev.filter(n => n.vhodniArtikelId !== -1)],
      );
    } else {
      setNormativItems(prev => prev.filter(n => n.vhodniArtikelId !== -1));
    }
  }, [tip]);

  // Avtomatski preklop na "blago" ko je normativ 1:1
  const normativRef = useRef(normativItems);
  normativRef.current = normativItems;
  useEffect(() => {
    const is1to1 =
      normativItems.length === 1 &&
      normativItems[0]!.vhodniArtikelId === -1 &&
      parseFloat(normativItems[0]!.kolicina) === 1;
    if (is1to1) setVrstaArtikla('blago');
  }, [normativItems]);

  // Izpeljane DDV stopnje
  const prodDdv  = prodajnaDefaultDdv(taxCategory, ddvStopnje);
  const nabavDdv = pricakovanaNabavnaDdv(taxCategory, addedSugar, ddvStopnje);

  const isNabavnoSamo = tip === 'NABAVNI';
  const cenaEnota     = Number(enotVPaketu) > 0 ? Number(p.izv_cena) / Number(enotVPaketu) : null;

  // Validacija
  const manjka: string[] = [];
  if (!naziv.trim()) manjka.push('naziv');
  if (!enota)        manjka.push('osnovna enota');
  if (!isNabavnoSamo && !cena) manjka.push('prodajna cena');

  // ── Shranjevanje ────────────────────────────────────────────────
  const shrani = async () => {
    if (manjka.length || dela) return;
    setDela(true);
    setNapaka(null);
    try {
      await l.onShrani({
        naziv:         naziv.trim(),
        imeZaNabavo:   imeZaNabavo.trim() || null,
        tip,
        osnovnaEnota:  enota,
        gtin:          p.izv_gtin,
        enotVPaketu,
        taxCategory,
        addedSugar,
        vrstaArtikla,
        skupina:       skupina.trim() || null,
        prodajnaDdvStopnja:  prodDdv,
        nabavnaDdvStopnja:   nabavDdv,
        cena,
        posCategoryId: isNabavnoSamo ? null : posCatId,
        aktiven:       isNabavnoSamo ? false : aktiven,
        barva:         isNabavnoSamo ? null  : barva,
        jePica:        isNabavnoSamo ? false : jePica,
        toGo:          isNabavnoSamo ? false : toGo,
        toGoArtikli:   isNabavnoSamo ? []    : toGoArtikli,
        happyHourCena: isNabavnoSamo ? ''    : happyHourCena,
        normativItems,
      });
    } catch (e) {
      setNapaka((e as Error).message);
    } finally {
      setDela(false);
    }
  };

  const nabavniArtikli  = artikliList.filter(a => a.nabavniArtikel);
  const prodajniArtikli = artikliList.filter(a => a.prodajniArtikel && a.aktiven);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">

        {/* Glava */}
        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Nov nabavni artikel</h2>
            <p className="text-sm text-neutral-500">iz dobavnice {l.dobaviteljNaziv}</p>
          </div>
          <button onClick={l.onPreklici} aria-label="Zapri"
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100">✕</button>
        </div>

        {/* Izvorni zapis */}
        <div className="rounded-md border bg-neutral-50 p-3 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">Na dobavnici</p>
          <p className="mt-1 font-medium">{p.izv_naziv}</p>
          <p className="text-neutral-600">
            {p.izv_sifra && <>šifra {p.izv_sifra}</>}
            {p.izv_gtin  && <> · EAN {p.izv_gtin.replace(/^0+/, '')}</>}
            {p.izv_enota && <> · {p.izv_enota}</>}
            {' · '}{p.izv_cena} € / paket
          </p>
        </div>

        {predlog.odstranjeno.length > 0 && (
          <p className="mt-2 text-xs text-neutral-500">
            Iz naziva odstranjeno: <strong>{predlog.odstranjeno.join(', ')}</strong>. Pakiranje je v šifrantu ločeno polje.
          </p>
        )}

        {/* ── Obrazec ── */}
        <div className="mt-4 space-y-5">

          {/* Naziv */}
          <div className="grid grid-cols-2 gap-4">
            <div className="col-span-2">
              <Oznaka obvezno>Naziv v šifrantu</Oznaka>
              <input value={naziv} onChange={e => setNaziv(e.target.value)}
                     className="w-full rounded border px-2 py-1.5 text-sm" />
              {predlog.vsebina && (
                <p className="mt-1 text-xs text-neutral-500">
                  Prostornina ({predlog.vsebina}) je namenoma ohranjena — brez nje sta 0,5 l in 0,33 l neločljiva.
                </p>
              )}
            </div>

            {/* Ime za nabavo */}
            <div className="col-span-2">
              <Oznaka>Ime za nabavo <span className="font-normal text-neutral-400">(opcijsko, drugačno od prodajnega)</span></Oznaka>
              <input value={imeZaNabavo} onChange={e => setImeZaNabavo(e.target.value)}
                     placeholder={naziv || p.izv_naziv}
                     className="w-full rounded border px-2 py-1.5 text-sm" />
            </div>

            {/* Tip artikla */}
            <div>
              <Oznaka obvezno>Tip artikla</Oznaka>
              <select value={tip} onChange={e => setTip(e.target.value as TipArtikla)}
                      className="w-full rounded border px-2 py-1.5 text-sm">
                <option value="NABAVNI">Nabavni — surovina, ni v meniju</option>
                <option value="NABAVNO_PRODAJNI">Nabavno-prodajni — se tudi prodaja</option>
              </select>
              {tip === 'NABAVNO_PRODAJNI' && (
                <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                  Ta artikel se bo pojavil v meniju blagajne.
                </p>
              )}
            </div>

            {/* Osnovna enota */}
            <div>
              <Oznaka obvezno>Osnovna enota</Oznaka>
              <select value={enota} onChange={e => setEnota(e.target.value)}
                      className="w-full rounded border px-2 py-1.5 text-sm">
                <option value="">— izberite —</option>
                {l.enote.map(e => <option key={e} value={e}>{e}</option>)}
              </select>
            </div>

            {/* Enot v paketu */}
            <div>
              <Oznaka>Enot v paketu</Oznaka>
              <input value={enotVPaketu} inputMode="decimal"
                     onChange={e => setEnotVPaketu(e.target.value)}
                     className="w-full rounded border px-2 py-1.5 text-sm" />
              {cenaEnota !== null && Number.isFinite(cenaEnota) && (
                <p className="mt-1 text-xs text-neutral-500">= {cenaEnota.toFixed(4)} € na enoto</p>
              )}
            </div>

            {/* Skupina */}
            <div>
              <Oznaka>Skupina artiklov</Oznaka>
              <input value={skupina} onChange={e => setSkupina(e.target.value)}
                     placeholder="npr. Pijača"
                     className="w-full rounded border px-2 py-1.5 text-sm" />
            </div>
          </div>

          {/* ── DDV kategorija ── */}
          <div className="rounded-lg border p-3">
            <Oznaka obvezno>DDV kategorija</Oznaka>
            <select value={taxCategory} onChange={e => setTaxCategory(e.target.value as TaxCategory)}
                    className="w-full rounded border px-2 py-1.5 text-sm">
              {DDV_KATEGORIJE.map(k => (
                <option key={k.value} value={k.value}>{k.label} — {k.opis}</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-neutral-500">
              {isNabavnoSamo
                ? 'Narava blaga — za izpeljavo nabavne stopnje na prejemu'
                : 'Narava blaga in način prodaje — razreševalnik pri mizi / za s seboj'}
            </p>

            <div className="mt-3 grid grid-cols-2 gap-3">
              {/* Pričakovana nabavna stopnja */}
              <div>
                <p className="mb-1 text-xs font-medium text-neutral-600">Pričakovana nabavna stopnja</p>
                <div className="flex h-8 items-center rounded border bg-neutral-50 px-2 text-sm font-semibold">
                  {nabavDdv} %
                </div>
                <p className="mt-1 text-xs text-neutral-500">Dobaviteljeva stopnja na prejemu</p>
              </div>
              {/* Prodajna stopnja — samo za prodajne */}
              {!isNabavnoSamo && (
                <div>
                  <p className="mb-1 text-xs font-medium text-neutral-600">Prodajna DDV stopnja</p>
                  <div className="flex h-8 items-center rounded border bg-neutral-50 px-2 text-sm font-semibold">
                    {prodDdv} %
                  </div>
                  <p className="mt-1 text-xs text-neutral-500">Pri mizi — razreševalnik prilagodi za s seboj</p>
                </div>
              )}
            </div>

            {/* Dodan sladkor — za pijače */}
            {(taxCategory === 'hot_beverage' || taxCategory === 'cold_beverage') && (
              <label className="mt-3 flex items-start gap-2 text-sm">
                <input type="checkbox" checked={addedSugar}
                       onChange={e => setAddedSugar(e.target.checked)}
                       className="mt-0.5 accent-orange-600" />
                <span>
                  Vsebuje dodan sladkor
                  <span className="block text-xs text-neutral-500">
                    {taxCategory === 'cold_beverage'
                      ? '22 % pri mizi in za s seboj (brez kljukice: 22 % / 9,5 %)'
                      : isNabavnoSamo
                        ? 'Nabavna stopnja: 22 % (z dodanim sladkorjem), 9,5 % (brez)'
                        : 'Za s seboj ostane 22 % (brez kljukice: odvisno od nastavitve)'}
                  </span>
                </span>
              </label>
            )}

            {/* Opomba o razliki nabavna/prodajna */}
            {!isNabavnoSamo && nabavDdv !== prodDdv && (
              <p className="mt-2 rounded bg-neutral-50 px-2 py-1.5 text-xs text-neutral-600">
                Nabavna stopnja ({nabavDdv} %) se razlikuje od prodajne pri mizi ({prodDdv} %).
                To je običajno: blago se kupi po nižji stopnji, strežba pri mizi pa je storitev po višji.
              </p>
            )}
          </div>

          {/* ── Vrsta artikla ── */}
          <div className="rounded-lg border p-3">
            <p className="mb-2 text-xs font-semibold text-neutral-700">Vrsta artikla</p>
            <div className="flex gap-2">
              {(['blago', 'material', 'storitev'] as VrstaArtikla[]).map(v => (
                <button key={v} type="button" onClick={() => setVrstaArtikla(v)}
                        className={`flex-1 rounded-md border py-1.5 text-sm font-medium transition-colors ${
                          vrstaArtikla === v
                            ? 'border-orange-600 bg-orange-600 text-white'
                            : 'border-neutral-200 bg-white text-neutral-600 hover:bg-neutral-50'}`}>
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                </button>
              ))}
            </div>
          </div>

          {/* ── Prodajni vnosi (samo NABAVNO_PRODAJNI) ── */}
          {!isNabavnoSamo && (<>

            {/* Prodajna cena + POS kategorija */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <Oznaka obvezno>Prodajna cena (€)</Oznaka>
                <input value={cena} onChange={e => setCena(e.target.value)}
                       inputMode="decimal" placeholder="0.00"
                       className="w-full rounded border px-2 py-1.5 text-sm" />
              </div>
              <div>
                <Oznaka>Kategorija v meniju</Oznaka>
                <select value={posCatId ?? ''} onChange={e => setPosCatId(Number(e.target.value) || null)}
                        className="w-full rounded border px-2 py-1.5 text-sm">
                  <option value="">— brez —</option>
                  {posKat.map(k => <option key={k.id} value={k.id}>{k.ime}</option>)}
                </select>
              </div>
            </div>

            {/* Barva kartice */}
            <div>
              <Oznaka>Barva kartice</Oznaka>
              <div className="flex flex-wrap gap-2 mt-1">
                {COLOR_PALETTE.map((c, i) => (
                  <button key={i} type="button" onClick={() => setBarva(c)}
                          title={c ?? 'Brez barve'}
                          className={`h-7 w-7 rounded-full border-2 transition-all ${
                            barva === c ? 'border-orange-600 ring-2 ring-orange-400 ring-offset-1 scale-110' : 'border-transparent hover:scale-110'}`}
                          style={{ backgroundColor: c ?? '#e5e7eb' }}>
                    {!c && <span className="flex h-full items-center justify-center text-[10px] text-neutral-400">✕</span>}
                  </button>
                ))}
              </div>
            </div>

            {/* Aktiven */}
            <label className="flex items-center gap-2 rounded-lg border p-3 text-sm">
              <input type="checkbox" checked={aktiven} onChange={e => setAktiven(e.target.checked)}
                     className="accent-orange-600" />
              Artikel je aktiven (viden v meniju)
            </label>

            {/* Je pica */}
            <label className="flex items-center gap-2 rounded-lg border border-orange-200 bg-orange-50 p-3 text-sm">
              <input type="checkbox" checked={jePica} onChange={e => setJePica(e.target.checked)}
                     className="accent-orange-600" />
              🍕 Je pica <span className="text-xs text-neutral-500">(omogoča plačilo z bonom za pico)</span>
            </label>

            {/* Normativ */}
            <div className="rounded-lg border p-3">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-xs font-semibold text-neutral-700">Normativ za prodajo</p>
                <button type="button"
                        onClick={() => setNormativItems(prev => [...prev, { vhodniArtikelId: 0, kolicina: '1' }])}
                        className="text-xs text-orange-700 hover:underline">+ Dodaj vhodni artikel</button>
              </div>

              {normativItems.length === 0 ? (
                <p className="text-xs text-neutral-500">Ni določenih vhodnih artiklov.</p>
              ) : (
                <div className="space-y-2">
                  <div className="grid grid-cols-[1fr_3.5rem_2rem] gap-1.5 px-1 text-xs text-neutral-500">
                    <span>Vhodni artikel</span><span>Kol.</span><span/>
                  </div>
                  {normativItems.map((item, idx) => {
                    const isSelf   = item.vhodniArtikelId === -1;
                    const vhodni   = isSelf ? null : nabavniArtikli.find(a => a.id === item.vhodniArtikelId);
                    return (
                      <div key={idx} className="grid grid-cols-[1fr_3.5rem_2rem] gap-1.5 items-center">
                        {isSelf ? (
                          <div className="flex h-8 items-center rounded border border-blue-200 bg-blue-50 px-2 text-xs font-medium text-blue-800">
                            Ta artikel
                          </div>
                        ) : (
                          <select value={item.vhodniArtikelId || ''}
                                  onChange={e => {
                                    const id = Number(e.target.value);
                                    setNormativItems(prev => prev.map((it, i) => i === idx ? { ...it, vhodniArtikelId: id } : it));
                                  }}
                                  className="h-8 w-full rounded border px-1 text-xs">
                            <option value="">— artikel —</option>
                            {nabavniArtikli.map(a => (
                              <option key={a.id} value={a.id}>{a.ime}{a.enotaMere ? ` (${a.enotaMere})` : ''}</option>
                            ))}
                          </select>
                        )}
                        <input value={item.kolicina} inputMode="decimal"
                               onChange={e => setNormativItems(prev => prev.map((it, i) => i === idx ? { ...it, kolicina: e.target.value } : it))}
                               className="h-8 rounded border px-1 text-right text-xs" />
                        {!isSelf && (
                          <button type="button"
                                  onClick={() => setNormativItems(prev => prev.filter((_, i) => i !== idx))}
                                  className="h-8 w-8 flex items-center justify-center rounded text-neutral-400 hover:text-red-600">
                            ✕
                          </button>
                        )}
                        {isSelf && (
                          <div className="h-8 w-8 flex items-center justify-center rounded text-blue-200 cursor-not-allowed">
                            ✕
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {normativItems.some(n => n.vhodniArtikelId === -1 && parseFloat(n.kolicina) === 1) && (
                <p className="mt-2 text-xs text-neutral-500">
                  Normativ 1:1 → vrsta artikla bo samodejno nastavljena na <strong>blago</strong>.
                </p>
              )}
            </div>

            {/* To Go */}
            <div className="rounded-lg border p-3">
              <div className="mb-2 flex items-center gap-2">
                <span className="text-sm">🛍</span>
                <p className="text-xs font-semibold text-neutral-700">To Go</p>
              </div>
              <button type="button" onClick={() => setToGo(v => !v)}
                      className={`w-full flex items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors ${
                        toGo ? 'bg-orange-50 text-orange-900' : 'text-neutral-500 hover:bg-neutral-50'}`}>
                <div className={`h-3.5 w-3.5 shrink-0 rounded border flex items-center justify-center ${
                  toGo ? 'bg-orange-500 border-orange-500' : 'border-neutral-400'}`}>
                  {toGo && <span className="text-[9px] font-bold text-white leading-none">✓</span>}
                </div>
                <span className="font-medium">To Go artikel</span>
                <span className="ml-auto text-xs text-neutral-400">
                  {toGo ? 'Prikazuje To Go gumb v naročilu' : 'Brez To Go gumba'}
                </span>
              </button>

              {toGo && (
                <div className="mt-2 space-y-1">
                  <p className="text-xs text-neutral-500">Embalaža: artikli, ki se samodejno dodajo k naročilu ob kliku To Go.</p>
                  {toGoArtikli.map(id => {
                    const art = prodajniArtikli.find(a => a.id === id);
                    return (
                      <div key={id} className="flex items-center gap-2 rounded-md border border-orange-100 bg-orange-50 px-2 py-1.5">
                        <span className="flex-1 truncate text-xs">{art?.ime ?? `Artikel #${id}`}</span>
                        <button type="button" onClick={() => setToGoArtikli(prev => prev.filter(i => i !== id))}
                                className="text-xs text-orange-400 hover:text-red-600">✕</button>
                      </div>
                    );
                  })}
                  <select value="" onChange={e => {
                    const id = Number(e.target.value);
                    if (id && !toGoArtikli.includes(id)) setToGoArtikli(prev => [...prev, id]);
                  }} className="w-full rounded border px-2 py-1 text-xs">
                    <option value="">Dodaj artikel za To Go…</option>
                    {prodajniArtikli.filter(a => !toGoArtikli.includes(a.id)).map(a => (
                      <option key={a.id} value={a.id}>{a.ime}</option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Happy Hour */}
            <div className="rounded-lg border border-amber-200 bg-amber-50/40 p-3">
              <div className="mb-1 flex items-center gap-2">
                <span>⭐</span>
                <p className="text-xs font-semibold text-amber-900">Happy Hour cena</p>
              </div>
              <p className="mb-2 text-xs text-neutral-500">Pusti prazno, če artikel ni del Happy Hour.</p>
              <div className="flex items-center gap-2">
                <input type="number" min="0" step="0.01"
                       value={happyHourCena}
                       onChange={e => setHappyHourCena(e.target.value)}
                       placeholder="npr. 2.50"
                       className="w-full rounded border px-2 py-1.5 text-sm" />
                <span className="shrink-0 text-sm text-neutral-500">€</span>
                {happyHourCena && (
                  <button type="button" onClick={() => setHappyHourCena('')}
                          className="shrink-0 text-xs text-neutral-400 hover:text-red-600">✕</button>
                )}
              </div>
            </div>

          </>)}

          {/* GTIN obvestilo */}
          {p.izv_gtin && (
            <p className="rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
              Črtna koda {p.izv_gtin.replace(/^0+/, '')} se shrani na artikel.
              Isti izdelek bo odslej prepoznan tudi pri drugih dobaviteljih.
            </p>
          )}

          {/* Validacija */}
          {manjka.length > 0 && (
            <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
              Manjka: {manjka.join(', ')}.
            </p>
          )}
          {napaka && (
            <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">{napaka}</p>
          )}

        </div>{/* /space-y-5 */}

        {/* Noga */}
        <div className="mt-5 flex justify-end gap-2 border-t pt-4">
          <button onClick={l.onPreklici}
                  className="rounded border px-4 py-2 text-sm hover:bg-neutral-50">
            Prekliči
          </button>
          <button onClick={() => void shrani()} disabled={manjka.length > 0 || dela}
                  className="rounded bg-orange-600 px-4 py-2 text-sm font-medium text-white
                             hover:bg-orange-700 disabled:opacity-40">
            {dela ? 'Shranjujem…' : 'Ustvari in upari'}
          </button>
        </div>

      </div>
    </div>
  );
}

function Oznaka(p: { obvezno?: boolean; children: React.ReactNode }) {
  return (
    <span className="mb-1 block text-xs font-medium text-neutral-600">
      {p.children}
      {p.obvezno && <span className="ml-0.5 text-orange-600">*</span>}
    </span>
  );
}
