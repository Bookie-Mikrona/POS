// artifacts/web/src/pos/uvoz/NovArtikelDialog.tsx
//
// Ustvarjanje novega artikla iz postavke prevzema.
//
// Klic pride iz UparjanjeDialog prek onNovArtikel, kadar postavke ni
// mogoče upariti na obstoječi artikel.

import { useEffect, useMemo, useState } from 'react';
import { predlagajArtikel } from './naziv';

// =====================================================================
// Tipi
// =====================================================================

export type TipArtikla = 'NABAVNI' | 'NABAVNO_PRODAJNI';

export interface DavcnaKategorija {
  id: number;
  koda: string;   // food, hot_beverage, cold_beverage, alkohol, food_drink, ostalo
  naziv: string;
  stopnjaPriMizi: string;
}

export interface Skupina {
  id: number;
  naziv: string;
}

export interface NovArtikelVhod {
  naziv: string;
  tip: TipArtikla;
  osnovnaEnota: string;
  nabavnaDdvStopnja: string;
  davcnaKategorijaId: number | null;
  skupinaId: number | null;
  gtin: string | null;
  enotVPaketu: string | null;
}

interface Postavka {
  izv_naziv: string;
  izv_sifra: string | null;
  izv_gtin: string | null;
  izv_enota: string | null;
  izv_cena: string;
  enot_v_paketu: string;
  ddv_stopnja?: string | null;
}

interface Lastnosti {
  postavka: Postavka;
  dobaviteljNaziv: string;
  enote: string[];
  davcneKategorije: DavcnaKategorija[];
  skupine: Skupina[];
  onShrani: (v: NovArtikelVhod) => Promise<{ artikelId: number }>;
  onPreklici: () => void;
}

const STOPNJE = ['22', '9.5', '5', '0'];

// =====================================================================
// Sestavni del
// =====================================================================

export function NovArtikelDialog(l: Lastnosti) {
  const p = l.postavka;

  const predlog = useMemo(
    () =>
      predlagajArtikel(
        p.izv_naziv,
        p.izv_enota,
        p.enot_v_paketu ? Number(p.enot_v_paketu) : null,
      ),
    [p.izv_naziv, p.izv_enota, p.enot_v_paketu],
  );

  const [naziv, setNaziv] = useState(predlog.naziv);
  // Privzeti tip je NABAVNI, ne NABAVNO_PRODAJNI. Napačno nastavljen
  // nabavno-prodajni artikel se pojavi v POS meniju, kjer nima kaj
  // iskati, in ga lahko natakar po nesreči proda.
  const [tip, setTip] = useState<TipArtikla>('NABAVNI');
  const [enota, setEnota] = useState(predlog.osnovnaEnota ?? '');
  const [nabavniDdv, setNabavniDdv] = useState(p.ddv_stopnja ?? '');
  const [kategorijaId, setKategorijaId] = useState<number | null>(null);
  const [skupinaId, setSkupinaId] = useState<number | null>(null);
  const [enotVPaketu, setEnotVPaketu] = useState(
    String(predlog.enotVPaketu ?? p.enot_v_paketu ?? '1'),
  );
  const [dela, setDela] = useState(false);
  const [napaka, setNapaka] = useState<string | null>(null);

  useEffect(() => {
    setNaziv(predlog.naziv);
    setEnota(predlog.osnovnaEnota ?? '');
    setEnotVPaketu(String(predlog.enotVPaketu ?? p.enot_v_paketu ?? '1'));
  }, [predlog, p.enot_v_paketu]);

  const cenaEnota =
    Number(enotVPaketu) > 0 ? Number(p.izv_cena) / Number(enotVPaketu) : null;

  const manjka: string[] = [];
  if (!naziv.trim()) manjka.push('naziv');
  if (!enota) manjka.push('osnovna enota');
  if (!nabavniDdv) manjka.push('nabavna stopnja DDV');
  if (tip === 'NABAVNO_PRODAJNI' && kategorijaId === null)
    manjka.push('davčna kategorija za prodajo');

  const shrani = async () => {
    if (manjka.length || dela) return;
    setDela(true);
    setNapaka(null);
    try {
      await l.onShrani({
        naziv: naziv.trim(),
        tip,
        osnovnaEnota: enota,
        nabavnaDdvStopnja: nabavniDdv,
        davcnaKategorijaId: tip === 'NABAVNO_PRODAJNI' ? kategorijaId : null,
        skupinaId,
        gtin: p.izv_gtin,
        enotVPaketu,
      });
    } catch (e) {
      setNapaka((e as Error).message);
    } finally {
      setDela(false);
    }
  };

  const izbranaKategorija = l.davcneKategorije.find((k) => k.id === kategorijaId);

  return (
    <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className="my-8 w-full max-w-2xl rounded-lg bg-white p-6 shadow-xl">

        <div className="mb-4 flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Nov nabavni artikel</h2>
            <p className="text-sm text-neutral-500">
              iz dobavnice {l.dobaviteljNaziv}
            </p>
          </div>
          <button onClick={l.onPreklici} aria-label="Zapri"
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100">✕</button>
        </div>

        {/* izvorni zapis */}
        <div className="rounded-md border bg-neutral-50 p-3 text-sm">
          <p className="text-xs font-medium uppercase tracking-wide text-neutral-500">
            Na dobavnici
          </p>
          <p className="mt-1 font-medium">{p.izv_naziv}</p>
          <p className="text-neutral-600">
            {p.izv_sifra && <>šifra {p.izv_sifra}</>}
            {p.izv_gtin && <> · EAN {p.izv_gtin.replace(/^0+/, '')}</>}
            {p.izv_enota && <> · {p.izv_enota}</>}
            {' · '}{p.izv_cena} € / paket
          </p>
        </div>

        {predlog.odstranjeno.length > 0 && (
          <p className="mt-2 text-xs text-neutral-500">
            Iz naziva odstranjeno: <strong>{predlog.odstranjeno.join(', ')}</strong>.
            Pakiranje je v šifrantu ločeno polje.
          </p>
        )}

        {/* obrazec */}
        <div className="mt-4 grid grid-cols-2 gap-4">

          <div className="col-span-2">
            <Oznaka obvezno>Naziv v šifrantu</Oznaka>
            <input value={naziv} onChange={(e) => setNaziv(e.target.value)}
                   className="w-full rounded border px-2 py-1.5 text-sm" />
            {predlog.vsebina && (
              <p className="mt-1 text-xs text-neutral-500">
                Prostornina oziroma masa ({predlog.vsebina}) je namenoma
                ohranjena — brez nje sta 0,5 l in 0,33 l neločljiva.
              </p>
            )}
          </div>

          <div>
            <Oznaka obvezno>Tip artikla</Oznaka>
            <select value={tip} onChange={(e) => setTip(e.target.value as TipArtikla)}
                    className="w-full rounded border px-2 py-1.5 text-sm">
              <option value="NABAVNI">Nabavni — surovina, ni v meniju</option>
              <option value="NABAVNO_PRODAJNI">
                Nabavno-prodajni — se tudi prodaja
              </option>
            </select>
            {tip === 'NABAVNO_PRODAJNI' && (
              <p className="mt-1 rounded bg-amber-50 px-2 py-1 text-xs text-amber-800">
                Ta artikel se bo pojavil v meniju blagajne.
              </p>
            )}
          </div>

          <div>
            <Oznaka obvezno>Osnovna enota</Oznaka>
            <select value={enota} onChange={(e) => setEnota(e.target.value)}
                    className="w-full rounded border px-2 py-1.5 text-sm">
              <option value="">— izberite —</option>
              {l.enote.map((e) => <option key={e} value={e}>{e}</option>)}
            </select>
            {predlog.vsebina && predlog.osnovnaEnota !== p.izv_enota && (
              <p className="mt-1 text-xs text-neutral-500">
                Dobavnica navaja {p.izv_enota}, a izdelek ima {predlog.vsebina};
                zato je predlagana enota {predlog.osnovnaEnota}, da bo
                razknjižba po normativu delovala.
              </p>
            )}
          </div>

          <div>
            <Oznaka obvezno>Nabavna stopnja DDV</Oznaka>
            <select value={nabavniDdv} onChange={(e) => setNabavniDdv(e.target.value)}
                    className="w-full rounded border px-2 py-1.5 text-sm">
              <option value="">— izberite —</option>
              {STOPNJE.map((s) => (
                <option key={s} value={s}>{s.replace('.', ',')} %</option>
              ))}
            </select>
            <p className="mt-1 text-xs text-neutral-500">
              Stopnja, po kateri artikel <strong>kupujete</strong>.
            </p>
          </div>

          <div>
            <Oznaka>Enot v paketu</Oznaka>
            <input value={enotVPaketu} inputMode="decimal"
                   onChange={(e) => setEnotVPaketu(e.target.value)}
                   className="w-full rounded border px-2 py-1.5 text-sm" />
            {cenaEnota !== null && Number.isFinite(cenaEnota) && (
              <p className="mt-1 text-xs text-neutral-500">
                = {cenaEnota.toFixed(4)} € na enoto
              </p>
            )}
          </div>

          {tip === 'NABAVNO_PRODAJNI' && (
            <div className="col-span-2">
              <Oznaka obvezno>Davčna kategorija za prodajo</Oznaka>
              <select value={kategorijaId ?? ''}
                      onChange={(e) => setKategorijaId(Number(e.target.value) || null)}
                      className="w-full rounded border px-2 py-1.5 text-sm">
                <option value="">— izberite —</option>
                {l.davcneKategorije.map((k) => (
                  <option key={k.id} value={k.id}>
                    {k.naziv} — pri mizi {k.stopnjaPriMizi} %
                  </option>
                ))}
              </select>

              {/* Vstopna in izstopna stopnja se lahko razlikujeta in to ni napaka. */}
              {izbranaKategorija && nabavniDdv &&
               izbranaKategorija.stopnjaPriMizi !== nabavniDdv && (
                <p className="mt-1 rounded bg-neutral-50 px-2 py-1.5 text-xs text-neutral-600">
                  Nabavna stopnja ({nabavniDdv.replace('.', ',')} %) se razlikuje od
                  prodajne pri mizi ({izbranaKategorija.stopnjaPriMizi} %).
                  To je običajno: blago se kupi po nižji stopnji, strežba
                  pri mizi pa je storitev po višji.
                </p>
              )}
            </div>
          )}

          <div className="col-span-2">
            <Oznaka>Skupina artiklov</Oznaka>
            <select value={skupinaId ?? ''}
                    onChange={(e) => setSkupinaId(Number(e.target.value) || null)}
                    className="w-full rounded border px-2 py-1.5 text-sm">
              <option value="">— brez —</option>
              {l.skupine.map((s) => <option key={s.id} value={s.id}>{s.naziv}</option>)}
            </select>
          </div>
        </div>

        {p.izv_gtin && (
          <p className="mt-3 rounded bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
            Črtna koda {p.izv_gtin.replace(/^0+/, '')} se shrani na artikel.
            Isti izdelek bo odslej prepoznan tudi pri drugih dobaviteljih.
          </p>
        )}

        {manjka.length > 0 && (
          <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Manjka: {manjka.join(', ')}.
          </p>
        )}
        {napaka && (
          <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-800">{napaka}</p>
        )}

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
