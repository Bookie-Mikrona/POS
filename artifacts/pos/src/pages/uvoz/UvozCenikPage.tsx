// artifacts/pos/src/pages/uvoz/UvozCenikPage.tsx
//
// Stran za uvoz cenika dobavitelja.
//
// KLJUČNO: uvoz cenika posodablja SAMO preslikave in zadnjo nabavno ceno
// v tabeli artikel_dobavitelj. Ne ustvarja prejemnic, ne popravlja zalog.
//
// Potek:
//   1. upload    — nalaganje CSV/XLSX in izbira dobavitelja
//   2. profil    — izbira ali kreiranje cenik-profila
//   3. predogled — pregled seznanjanja s primerjavo starih in novih cen
//   4. rezultat  — povzetek shranjenega

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocation } from 'wouter';
import { useListPartnerji, type Partner } from '@workspace/api-client-react';
import { CenikProfilUrejevalnik } from './CenikProfilUrejevalnik';
import { ChevronLeft, Tag, Upload, Check, AlertTriangle, ArrowRight } from 'lucide-react';

const base = import.meta.env.BASE_URL.replace(/\/$/, '');
function enotaHeader(): Record<string, string> {
  const id = localStorage.getItem('enotaId');
  return id ? { 'X-Enota-Id': id } : {};
}

// ── Tipi ──────────────────────────────────────────────────────────────────────

type Korak = 'upload' | 'profil' | 'predogled' | 'rezultat';

interface Profil {
  id: number;
  naziv: string;
  format: string;
  konfiguracija: unknown;
}

interface PredogledVrstica {
  zap: number;
  naziv: string;
  sifra: string | null;
  gtin: string | null;
  artikelId: number | null;
  artikelNaziv: string | null;
  metoda: string | null;
  zaupanje: number;
  samodejno: boolean;
  zeObstaja: boolean;
  cenaPaket: string | null;   // nova (iz cenika)
  cenaEnota: string | null;   // nova
  ddvStopnja: string | null;
  enotVPaketu: string;
}

interface PredogledDto {
  vrstic: number;
  samodejno: number;
  zaPotrditev: number;
  brezZadetka: number;
  posodobitev: number;
  vrstice: PredogledVrstica[];
  napake: string[];
}

interface Rezultat {
  ustvarjenih: number;
  posodobljenih: number;
  preskocenih: number;
}

// ── Komponenta ────────────────────────────────────────────────────────────────

export default function UvozCenikPage() {
  const [, navigate] = useLocation();

  const [korak,        setKorak]        = useState<Korak>('upload');
  const [datoteka,     setDatoteka]     = useState<File | null>(null);
  const [dobaviteljId, setDobaviteljId] = useState<string | null>(null);
  const [dobavFilter,  setDobavFilter]  = useState('');
  const [profil,       setProfil]       = useState<Profil | null>(null);
  const [cenikKonfig,  setCenikKonfig]  = useState<unknown | null>(null);
  const [profili,      setProfili]      = useState<Profil[]>([]);
  const [predogled,    setPredogled]    = useState<PredogledDto | null>(null);
  const [rezultat,     setRezultat]     = useState<Rezultat | null>(null);
  const [nalaga,       setNalaga]       = useState(false);
  const [napaka,       setNapaka]       = useState<string | null>(null);
  const [pokaziNovProfil, setPokaziNovProfil] = useState(false);

  const { data: kupci } = useListPartnerji();

  const filtriranKupci = useMemo<Partner[]>(() => {
    const seznam = kupci ?? [];
    const q = dobavFilter.toLowerCase().trim();
    if (!q) return seznam;
    return seznam.filter((k) =>
      (k.naziv ?? '').toLowerCase().includes(q) ||
      (k.kratkiNaziv ?? '').toLowerCase().includes(q),
    );
  }, [kupci, dobavFilter]);

  const dobaviteljNaziv = useMemo(
    () => kupci?.find((k) => k.id === dobaviteljId)?.naziv ?? '',
    [kupci, dobaviteljId],
  );

  // Naloži cenik-profile za izbranega dobavitelja
  useEffect(() => {
    if (!dobaviteljId) { setProfili([]); return; }
    void fetch(
      `${base}/api/pos/uvoz/profili?dobaviteljId=${dobaviteljId}&tip=CENIK`,
      { credentials: 'include', headers: enotaHeader() },
    )
      .then((r) => r.json())
      .then((d: { vsebina: Profil[] }) => setProfili(d.vsebina ?? []));
  }, [dobaviteljId]);

  // ── Korak 1 → 2 ───────────────────────────────────────────────────────────

  const nadaljujNaProfil = () => {
    if (!datoteka || !dobaviteljId) return;
    setNapaka(null);
    setKorak('profil');
    // Če ima dobavitelj samo en profil, ga predizberemo
    if (profili.length === 1) setProfil(profili[0]!);
  };

  // ── Korak 2 → 3 ───────────────────────────────────────────────────────────

  const kliciPredogled = useCallback(async (konfig: unknown) => {
    if (!datoteka || !dobaviteljId || !konfig) return;
    setNalaga(true);
    setNapaka(null);
    try {
      const fd = new FormData();
      fd.append('datoteka', datoteka);
      fd.append('dobaviteljId', String(dobaviteljId));
      fd.append('profil', JSON.stringify(konfig));
      const r = await fetch(`${base}/api/pos/uvoz/cenik/predogled`, {
        method: 'POST',
        credentials: 'include',
        headers: enotaHeader(),
        body: fd,
      });
      if (!r.ok) {
        const d = await r.json() as { sporocilo?: string };
        throw new Error(d.sporocilo ?? `Napaka ${r.status}`);
      }
      const d = await r.json() as PredogledDto;
      setPredogled(d);
      setKorak('predogled');
    } catch (e) {
      setNapaka((e as Error).message);
    } finally {
      setNalaga(false);
    }
  }, [datoteka, dobaviteljId]);

  const onProfilShranjen = useCallback(async (profilId: number | null, konfig: unknown) => {
    setCenikKonfig(konfig);
    await kliciPredogled(konfig);
    if (profilId) {
      // Posodobi lokalni seznam profilov
      void fetch(
        `${base}/api/pos/uvoz/profili?dobaviteljId=${dobaviteljId}&tip=CENIK`,
        { credentials: 'include', headers: enotaHeader() },
      )
        .then((r) => r.json())
        .then((d: { vsebina: Profil[] }) => setProfili(d.vsebina ?? []));
    }
    setPokaziNovProfil(false);
  }, [dobaviteljId, kliciPredogled]);

  // ── Korak 3 → 4: potrditev ────────────────────────────────────────────────

  const potrdi = useCallback(async () => {
    if (!predogled || !dobaviteljId) return;
    setNalaga(true);
    setNapaka(null);
    try {
      // Pošljemo samo vrstice, ki imajo artikelId (ujete) — ostale so preskočene
      const vrsticeZaPotrdi = predogled.vrstice
        .filter((v) => v.artikelId !== null)
        .map((v) => ({
          artikelId: v.artikelId!,
          sifra:      v.sifra,
          gtin:       v.gtin,
          naziv:      v.naziv,
          enota:      null,
          enotVPaketu: v.enotVPaketu ?? '1',
          cenaEnota:   v.cenaEnota,
          ddvStopnja:  v.ddvStopnja,
        }));

      if (vrsticeZaPotrdi.length === 0) {
        setNapaka('Ni seznanjenih vrstic — ni česa shraniti.');
        setNalaga(false);
        return;
      }

      const r = await fetch(`${base}/api/pos/uvoz/cenik/potrdi`, {
        method: 'POST',
        credentials: 'include',
        headers: { ...enotaHeader(), 'Content-Type': 'application/json' },
        body: JSON.stringify({ dobaviteljId, vrstice: vrsticeZaPotrdi }),
      });
      if (!r.ok) {
        const d = await r.json() as { sporocilo?: string };
        throw new Error(d.sporocilo ?? `Napaka ${r.status}`);
      }
      const d = await r.json() as Rezultat;
      // Preskočene = vrstice brez seznanjenega nabavnega artikla
      setRezultat({
        ustvarjenih: d.ustvarjenih,
        posodobljenih: d.posodobljenih,
        preskocenih: d.preskocenih + predogled.brezZadetka,
      });
      setKorak('rezultat');
    } catch (e) {
      setNapaka((e as Error).message);
    } finally {
      setNalaga(false);
    }
  }, [predogled, dobaviteljId]);

  // ── Prikaz ────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-neutral-50">
      {/* Glava */}
      <div className="sticky top-0 z-10 flex items-center gap-3 border-b bg-white px-4 py-3 shadow-sm">
        <button onClick={() => navigate('/nastavitve')}
                className="rounded p-1 text-neutral-400 hover:bg-neutral-100 hover:text-neutral-700">
          <ChevronLeft className="h-5 w-5" />
        </button>
        <Tag className="h-5 w-5 text-orange-600" />
        <h1 className="text-lg font-semibold">Uvoz cenika dobavitelja</h1>
        {korak !== 'upload' && (
          <span className="ml-auto text-xs text-neutral-400 font-medium uppercase tracking-wide">
            {korak === 'profil' ? '2 / 4 — Profil'
              : korak === 'predogled' ? '3 / 4 — Predogled'
              : '4 / 4 — Rezultat'}
          </span>
        )}
      </div>

      <div className="mx-auto max-w-4xl px-4 py-6">
        {napaka && (
          <div className="mb-4 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <span>{napaka}</span>
            <button onClick={() => setNapaka(null)} className="ml-auto text-red-500 hover:text-red-700">✕</button>
          </div>
        )}

        {/* ═══ KORAK 1: UPLOAD + DOBAVITELJ ════════════════════════════════ */}
        {korak === 'upload' && (
          <div className="space-y-6">
            <div className="rounded-xl border bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-base font-semibold">1. Naložite datoteko cenika (CSV ali XLSX)</h2>
              <label className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed py-10 transition-colors
                                ${datoteka ? 'border-orange-400 bg-orange-50' : 'border-neutral-300 hover:border-orange-400 hover:bg-orange-50'}`}>
                <Upload className={`mb-2 h-8 w-8 ${datoteka ? 'text-orange-500' : 'text-neutral-400'}`} />
                {datoteka
                  ? <span className="text-sm font-medium text-orange-700">{datoteka.name}</span>
                  : <span className="text-sm text-neutral-500">Kliknite ali povlecite datoteko (CSV, XLSX)</span>
                }
                <input type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden"
                       onChange={(e) => {
                         const f = e.target.files?.[0];
                         if (f) setDatoteka(f);
                       }} />
              </label>
              {datoteka && (
                <button onClick={() => setDatoteka(null)}
                        className="mt-2 text-xs text-neutral-500 hover:text-red-600">
                  ✕ Odstrani datoteko
                </button>
              )}
            </div>

            <div className="rounded-xl border bg-white p-6 shadow-sm">
              <h2 className="mb-4 text-base font-semibold">2. Izberite dobavitelja</h2>
              <p className="mb-3 text-sm text-neutral-500">
                Cenik nima davčne številke dobavitelja — zato je obvezna ročna izbira.
              </p>
              <input
                type="text"
                placeholder="Iskanje dobavitelja…"
                value={dobavFilter}
                onChange={(e) => setDobavFilter(e.target.value)}
                className="mb-2 w-full rounded border px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-orange-400"
              />
              <div className="max-h-48 overflow-y-auto rounded border">
                {filtriranKupci.slice(0, 50).map((k) => (
                  <button key={k.id}
                          onClick={() => { setDobaviteljId(k.id); setDobavFilter(''); }}
                          className={`flex w-full items-center gap-2 px-3 py-2.5 text-left text-sm transition-colors hover:bg-orange-50
                                      ${k.id === dobaviteljId ? 'bg-orange-100 font-medium text-orange-800' : ''}`}>
                    {k.id === dobaviteljId && <Check className="h-3.5 w-3.5 text-orange-600" />}
                    <span className={k.id === dobaviteljId ? '' : 'ml-5'}>{k.naziv ?? k.kratkiNaziv}</span>
                  </button>
                ))}
                {filtriranKupci.length === 0 && (
                  <p className="px-3 py-4 text-center text-sm text-neutral-400">Ni zadetkov</p>
                )}
              </div>
            </div>

            <div className="flex justify-end">
              <button
                onClick={nadaljujNaProfil}
                disabled={!datoteka || !dobaviteljId}
                className="flex items-center gap-2 rounded-lg bg-orange-600 px-6 py-2.5 text-sm font-medium text-white
                           hover:bg-orange-700 disabled:opacity-40">
                Naprej — izbira profila
                <ArrowRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* ═══ KORAK 2: PROFIL ═════════════════════════════════════════════ */}
        {korak === 'profil' && datoteka && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button onClick={() => { setKorak('upload'); setPokaziNovProfil(false); }}
                      className="text-sm text-neutral-500 hover:underline">← Nazaj</button>
              <span className="text-sm text-neutral-500">Dobavitelj: <strong>{dobaviteljNaziv}</strong></span>
            </div>

            {/* Obstoječi profili */}
            {!pokaziNovProfil && profili.length > 0 && (
              <div className="rounded-xl border bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-base font-semibold">Obstoječi cenik-profili</h2>
                <div className="space-y-2">
                  {profili.map((p) => (
                    <button key={p.id}
                            onClick={() => {
                              setProfil(p);
                              void kliciPredogled(p.konfiguracija);
                            }}
                            className={`flex w-full items-center justify-between rounded-lg border px-4 py-3 text-left text-sm transition-colors hover:border-orange-400 hover:bg-orange-50
                                        ${profil?.id === p.id ? 'border-orange-500 bg-orange-50 font-medium' : ''}`}>
                      <span>{p.naziv}</span>
                      <span className="text-xs text-neutral-400">{p.format}</span>
                    </button>
                  ))}
                </div>
                <button onClick={() => setPokaziNovProfil(true)}
                        className="mt-3 text-sm text-orange-600 hover:underline">
                  + Ustvari nov profil
                </button>
              </div>
            )}

            {/* Nov profil ali ni profilov */}
            {(pokaziNovProfil || profili.length === 0) && (
              <div className="rounded-xl border bg-white p-6 shadow-sm">
                <h2 className="mb-4 text-base font-semibold">
                  {profili.length === 0 ? 'Ni cenik-profila — ustvarite ga' : 'Nov cenik-profil'}
                </h2>
                <CenikProfilUrejevalnik
                  dobaviteljId={dobaviteljId!}
                  dobaviteljNaziv={dobaviteljNaziv}
                  datoteka={datoteka}
                  apiBase={base}
                  enotaHeader={enotaHeader}
                  onShrani={onProfilShranjen}
                  onPreklici={() => setPokaziNovProfil(false)}
                />
              </div>
            )}

            {nalaga && (
              <div className="flex items-center gap-2 rounded-lg bg-neutral-100 px-4 py-3 text-sm text-neutral-600">
                <span className="animate-spin">⟳</span> Pripravljam predogled…
              </div>
            )}
          </div>
        )}

        {/* ═══ KORAK 3: PREDOGLED ══════════════════════════════════════════ */}
        {korak === 'predogled' && predogled && (
          <div className="space-y-4">
            <div className="flex items-center gap-3">
              <button onClick={() => setKorak('profil')}
                      className="text-sm text-neutral-500 hover:underline">← Nazaj</button>
              <span className="text-sm text-neutral-500">Dobavitelj: <strong>{dobaviteljNaziv}</strong></span>
            </div>

            {/* Povzetek */}
            <div className="grid grid-cols-4 gap-3">
              <StatKartica oznaka="Skupaj vrstic"     vrednost={predogled.vrstic}     barva="neutral" />
              <StatKartica oznaka="Samodejno seznanjene postavke" vrednost={predogled.samodejno}  barva="green" />
              <StatKartica oznaka="Že shranjeno"       vrednost={predogled.posodobitev} barva="blue" />
              <StatKartica oznaka="Artikel ni najden"  vrednost={predogled.brezZadetka} barva="amber" />
            </div>

            {predogled.napake.length > 0 && (
              <div className="rounded border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                {predogled.napake.map((n, i) => <p key={i}>{n}</p>)}
              </div>
            )}

            <p className="text-sm text-neutral-500">
              Vrstice, za katere ni bil najden nabavni artikel ({predogled.brezZadetka}), bodo preskočene —
              cenik ne ustvarja novih artiklov.
            </p>

            {/* Tabela predogleda */}
            <div className="overflow-hidden rounded-xl border bg-white shadow-sm">
              <div className="border-b px-4 py-3">
                <p className="text-sm font-medium">Pregled preslikav in cen</p>
              </div>
              <div className="overflow-x-auto">
                <table className="min-w-full text-xs">
                  <thead className="bg-neutral-50">
                    <tr>
                      <th className="border-b px-3 py-2 text-left">#</th>
                      <th className="border-b px-3 py-2 text-left">Naziv (dobavnica)</th>
                      <th className="border-b px-3 py-2 text-left">→ Artikel</th>
                      <th className="border-b px-3 py-2 text-left">Metoda</th>
                      <th className="border-b px-3 py-2 text-right">Stara cena/enoto</th>
                      <th className="border-b px-3 py-2 text-right">Nova cena/enoto</th>
                      <th className="border-b px-3 py-2 text-center">Δ</th>
                    </tr>
                  </thead>
                  <tbody>
                    {predogled.vrstice.map((v) => {
                      const novaC  = v.cenaEnota  ? parseFloat(v.cenaEnota)  : null;
                      const staraC = null; // stara cena je v artikel_dobavitelj — predogled jo ne vrne
                      const delta  = novaC !== null && staraC !== null
                        ? ((novaC - staraC) / staraC * 100).toFixed(1)
                        : null;
                      return (
                        <tr key={v.zap}
                            className={v.artikelId ? '' : 'bg-neutral-50 text-neutral-400'}>
                          <td className="border-b px-3 py-1.5">{v.zap}</td>
                          <td className="border-b px-3 py-1.5 font-mono">{v.naziv}</td>
                          <td className="border-b px-3 py-1.5">
                            {v.artikelNaziv
                              ? <span className="text-green-700">{v.artikelNaziv}</span>
                              : <span className="text-neutral-400">— artikel ni najden</span>}
                          </td>
                          <td className="border-b px-3 py-1.5">
                            {v.metoda
                              ? <MetodaZnacka metoda={v.metoda} zaupanje={v.zaupanje} />
                              : '—'}
                          </td>
                          <td className="border-b px-3 py-1.5 text-right text-neutral-400">
                            {v.zeObstaja ? '…' : '—'}
                          </td>
                          <td className="border-b px-3 py-1.5 text-right">
                            {novaC !== null ? novaC.toFixed(4) : '—'}
                          </td>
                          <td className="border-b px-3 py-1.5 text-center">
                            {delta !== null
                              ? <span className={parseFloat(delta) > 0 ? 'text-red-600' : 'text-green-600'}>
                                  {parseFloat(delta) > 0 ? '▲' : '▼'}{Math.abs(parseFloat(delta))} %
                                </span>
                              : '—'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="flex items-center justify-between border-t pt-4">
              <p className="text-sm text-neutral-500">
                Potrditev bo shranila <strong>{predogled.samodejno + predogled.zaPotrditev}</strong> preslikav
                in posodobila nabavne cene.
              </p>
              <button onClick={() => void potrdi()} disabled={nalaga}
                      className="flex items-center gap-2 rounded-lg bg-orange-600 px-6 py-2.5 text-sm font-medium text-white
                                 hover:bg-orange-700 disabled:opacity-40">
                {nalaga ? 'Shranjujem…' : 'Potrdi uvoz cenika'}
                <Check className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* ═══ KORAK 4: REZULTAT ═══════════════════════════════════════════ */}
        {korak === 'rezultat' && rezultat && (
          <div className="flex flex-col items-center py-12 text-center">
            <div className="mb-6 flex h-16 w-16 items-center justify-center rounded-full bg-green-100">
              <Check className="h-8 w-8 text-green-600" />
            </div>
            <h2 className="mb-2 text-xl font-semibold">Cenik uvožen</h2>
            <p className="mb-8 text-neutral-500">
              Dobavitelj: <strong>{dobaviteljNaziv}</strong>
            </p>
            <div className="mb-8 grid grid-cols-3 gap-6">
              <div className="rounded-xl border bg-white p-5 shadow-sm">
                <p className="text-3xl font-bold text-green-600">{rezultat.ustvarjenih}</p>
                <p className="mt-1 text-sm text-neutral-500">Novih preslikav</p>
              </div>
              <div className="rounded-xl border bg-white p-5 shadow-sm">
                <p className="text-3xl font-bold text-blue-600">{rezultat.posodobljenih}</p>
                <p className="mt-1 text-sm text-neutral-500">Posodobljenih cen</p>
              </div>
              <div className="rounded-xl border bg-white p-5 shadow-sm">
                <p className="text-3xl font-bold text-neutral-400">{rezultat.preskocenih}</p>
                <p className="mt-1 text-sm text-neutral-500">Preskočenih (artikel ni najden)</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button onClick={() => {
                setKorak('upload');
                setDatoteka(null);
                setDobaviteljId(null);
                setProfil(null);
                setCenikKonfig(null);
                setPredogled(null);
                setRezultat(null);
                setNapaka(null);
                setPokaziNovProfil(false);
              }}
                      className="rounded-lg border px-5 py-2.5 text-sm hover:bg-neutral-50">
                Nov uvoz
              </button>
              <button onClick={() => navigate('/nastavitve')}
                      className="rounded-lg bg-orange-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-orange-700">
                Zapri
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Pomožne komponente ────────────────────────────────────────────────────────

function StatKartica(p: {
  oznaka: string; vrednost: number;
  barva: 'neutral' | 'green' | 'blue' | 'amber';
}) {
  const barvaMapa = {
    neutral: 'text-neutral-700 bg-white',
    green:   'text-green-700  bg-green-50',
    blue:    'text-blue-700   bg-blue-50',
    amber:   'text-amber-700  bg-amber-50',
  };
  return (
    <div className={`rounded-xl border px-4 py-3 shadow-sm ${barvaMapa[p.barva]}`}>
      <p className="text-2xl font-bold">{p.vrednost}</p>
      <p className="mt-0.5 text-xs text-neutral-500">{p.oznaka}</p>
    </div>
  );
}

function MetodaZnacka(p: { metoda: string; zaupanje: number }) {
  const kratko: Record<string, string> = {
    GTIN:             'GTIN',
    SIFRA_DOBAVITELJA: 'Šifra',
    PODOBNOST_NAZIVA: `~${p.zaupanje}%`,
    ROCNO:            'Ročno',
  };
  return (
    <span className={`rounded px-1.5 py-0.5 text-xs font-medium
                      ${p.metoda === 'GTIN' || p.metoda === 'SIFRA_DOBAVITELJA'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-amber-100 text-amber-800'}`}>
      {kratko[p.metoda] ?? p.metoda}
    </span>
  );
}
