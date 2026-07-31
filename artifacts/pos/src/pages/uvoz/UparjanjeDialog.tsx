// artifacts/web/src/pos/uvoz/UparjanjeDialog.tsx
//
// Zaslon za uparjanje uvoženih postavk.
//
// Sestra obstoječega "Uredi prejemnico", ne njegova zamenjava. Ko so
// vse postavke uparjene, se odpre obstoječi zaslon, napolnjen s podatki.
//
// Razredi CSS so pisani v slogu Tailwinda; prilagodi jih svojemu
// oblikovnemu sistemu. Barva poudarka sledi oranžni z obstoječega zaslona.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
}

export interface Opozorilo {
  koda: string;
  resnost: 'B' | 'O' | 'I';
  sporocilo: string;
  podatki?: Record<string, unknown>;
}

export interface NeuparjenaPostavka {
  id: number;
  zap_st: number;
  izv_gtin: string | null;
  izv_sifra: string | null;
  izv_naziv: string;
  izv_enota: string | null;
  izv_kolicina: string;
  izv_cena: string;
  enot_v_paketu: string;
  uparjanje_zaupanje: number | null;
  uparjanje_kandidati: Kandidat[] | null;
  opozorila: Opozorilo[] | null;
}

interface Lastnosti {
  prejemnicaId: number;
  dobaviteljNaziv: string;
  stDokumenta: string | null;
  datum: string | null;
  ceneBruto: boolean;
  steviloUparjenih: number;
  postavke: NeuparjenaPostavka[];
  onUpari: (postavkaId: number, artikelId: number, enotVPaketu: string,
            zapomni: boolean) => Promise<void>;
  onNovArtikel: (postavka: NeuparjenaPostavka) => void;
  onIsci: (niz: string) => Promise<Kandidat[]>;
  onZakljuci: () => void;
  onPreklici: () => void;
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
  const iskalnoPolje = useRef<HTMLInputElement>(null);

  const postavka = l.postavke[kazalo];
  const skupaj = l.postavke.length;

  // Predlogi iz zaledja, dopolnjeni z rezultati ročnega iskanja.
  const kandidati = useMemo<Kandidat[]>(() => {
    const osnovni = postavka?.uparjanje_kandidati ?? [];
    if (!najdeni.length) return osnovni;
    const videni = new Set(osnovni.map((k) => k.artikelId));
    return [...osnovni, ...najdeni.filter((k) => !videni.has(k.artikelId))];
  }, [postavka, najdeni]);

  // Ob prehodu na novo postavko počisti stanje in predizberi najboljšega.
  useEffect(() => {
    setIzbran(postavka?.uparjanje_kandidati?.[0]?.artikelId ?? null);
    setIskanje('');
    setNajdeni([]);
    setNapaka(null);
  }, [postavka?.id]);

  const potrdi = useCallback(async () => {
    if (!postavka || izbran === null || dela) return;
    setDela(true);
    setNapaka(null);
    try {
      const k = kandidati.find((x) => x.artikelId === izbran);
      // Če ima artikel zapomnjeno pakiranje, ga uporabi; sicer tisto z dokumenta.
      const pak = k?.enotVPaketu ?? postavka.enot_v_paketu;
      await l.onUpari(postavka.id, izbran, pak, zapomni);
      if (kazalo + 1 < skupaj) setKazalo(kazalo + 1);
      else l.onZakljuci();
    } catch (e) {
      setNapaka((e as Error).message);
    } finally {
      setDela(false);
    }
  }, [postavka, izbran, dela, kandidati, zapomni, kazalo, skupaj, l]);

  // Uparjanje mora biti izvedljivo brez miške — kdor prevzema blago,
  // ima pogosto eno roko na dobavnici.
  useEffect(() => {
    const naTipko = (e: KeyboardEvent) => {
      if (document.activeElement === iskalnoPolje.current) {
        if (e.key === 'Escape') iskalnoPolje.current?.blur();
        return;
      }
      if (e.key >= '1' && e.key <= '9') {
        const i = Number(e.key) - 1;
        if (kandidati[i]) { setIzbran(kandidati[i].artikelId); e.preventDefault(); }
      } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        const trenutni = kandidati.findIndex((k) => k.artikelId === izbran);
        const nasl = e.key === 'ArrowDown'
          ? Math.min(trenutni + 1, kandidati.length - 1)
          : Math.max(trenutni - 1, 0);
        if (kandidati[nasl]) setIzbran(kandidati[nasl].artikelId);
        e.preventDefault();
      } else if (e.key === 'Enter') {
        void potrdi(); e.preventDefault();
      } else if (e.key.toLowerCase() === 'n') {
        if (postavka) l.onNovArtikel(postavka); e.preventDefault();
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
  }, [kandidati, izbran, kazalo, skupaj, postavka, potrdi, l]);

  // Iskanje z zamikom, da vsak pritisk tipke ne sproži zahtevka.
  useEffect(() => {
    if (iskanje.trim().length < 2) { setNajdeni([]); return; }
    const id = setTimeout(() => { void l.onIsci(iskanje).then(setNajdeni); }, 250);
    return () => clearTimeout(id);
  }, [iskanje, l]);

  if (!postavka) return null;

  const cenaEnota = cenaNaEnoto(postavka.izv_cena, postavka.enot_v_paketu);
  const skupnaVrednost =
    Number(postavka.izv_kolicina) * Number(postavka.izv_cena);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <div className="w-full max-w-3xl rounded-lg bg-white shadow-xl">

        {/* glava */}
        <div className="flex items-start justify-between border-b px-6 py-4">
          <div>
            <h2 className="text-lg font-semibold">Uvoz prejemnice — {l.dobaviteljNaziv}</h2>
            <p className="mt-0.5 text-sm text-neutral-500">
              {l.stDokumenta && <>Dokument {l.stDokumenta} · </>}
              {l.datum} · cene: {l.ceneBruto ? 'BRUTO' : 'NETO'}
            </p>
          </div>
          <button onClick={l.onPreklici} aria-label="Zapri"
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100">✕</button>
        </div>

        {/* povzetek: prikažemo SAMO postavke, ki potrebujejo odločitev */}
        <div className="flex items-center gap-4 border-b bg-neutral-50 px-6 py-2 text-sm">
          <span className="text-emerald-700">
            ✓ {l.steviloUparjenih} postavk uparjenih samodejno
          </span>
          <span className="text-amber-700">
            ⚠ {skupaj} {skupaj === 1 ? 'postavka potrebuje' : 'postavk potrebuje'} vašo odločitev
          </span>
        </div>

        <div className="px-6 py-4">
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
              {denar(postavka.enot_v_paketu, 0)} enot/paket
              {' × '}{denar(postavka.izv_kolicina, 0)} paket
              {' × '}{denar(postavka.izv_cena, 3)} €
              {' = '}<strong>{denar(String(skupnaVrednost))} €</strong>
              {cenaEnota && (
                <span className="ml-2 text-neutral-500">
                  ({denar(cenaEnota, 4)} €/enoto)
                </span>
              )}
            </p>
          </div>

          {/* opozorila razčlenitve */}
          {postavka.opozorila?.map((o) => (
            <div key={o.koda}
                 className={`mt-2 rounded-md px-3 py-2 text-sm ${
                   o.resnost === 'B'
                     ? 'bg-red-50 text-red-800'
                     : 'bg-amber-50 text-amber-800'}`}>
              {o.sporocilo}
            </div>
          ))}

          <p className="my-3 text-center text-sm text-neutral-400">↓ uparim z</p>

          {/* kandidati */}
          <div className="rounded-md border border-neutral-200">
            {kandidati.length === 0 && (
              <p className="px-3 py-4 text-sm text-neutral-500">
                Ni podobnih artiklov. Poiščite ga ročno ali ustvarite novega.
              </p>
            )}

            {kandidati.map((k, i) => {
              const kandidatCena = k.zadnjaCenaEnota;
              const razlika =
                cenaEnota && kandidatCena && Number(kandidatCena) > 0
                  ? ((Number(cenaEnota) - Number(kandidatCena)) /
                      Number(kandidatCena)) * 100
                  : null;

              return (
                <label key={k.artikelId}
                  className={`flex cursor-pointer items-center gap-3 border-b px-3 py-2 last:border-b-0
                              ${izbran === k.artikelId ? 'bg-orange-50' : 'hover:bg-neutral-50'}`}>
                  <input type="radio" name="kandidat" checked={izbran === k.artikelId}
                         onChange={() => setIzbran(k.artikelId)}
                         className="accent-orange-600" />
                  {i < 9 && (
                    <kbd className="rounded border bg-white px-1.5 text-xs text-neutral-500">
                      {i + 1}
                    </kbd>
                  )}
                  <span className="flex-1 truncate min-w-0">
                    <span className="truncate">{k.naziv}</span>
                    {kandidati.filter(c => c.naziv === k.naziv).length > 1 && (
                      <span className="ml-1 text-xs text-neutral-400">#{k.artikelId}</span>
                    )}
                  </span>
                  {k.osnovnaEnota && (
                    <span className="shrink-0 text-sm text-neutral-500">({k.osnovnaEnota})</span>
                  )}

                  {/* Cena je močnejši signal od imena: dobavitelj piše
                      "Caj vrecka - Kamilica 20/1", mi imamo "Čaj vrečka -
                      Kamilica"; ceni 0,2738 in 0,26 ujemanje potrdita. */}
                  <span className="w-28 text-right text-sm">
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
                          className="text-xs text-emerald-600">✓</span>
                  )}
                  <span className={`w-12 text-right text-sm ${barvaOcene(k.ocena)}`}>
                    {Math.round(k.ocena * 100)} %
                  </span>
                </label>
              );
            })}

            <div className="border-t px-3 py-2">
              <input ref={iskalnoPolje} value={iskanje}
                     onChange={(e) => setIskanje(e.target.value)}
                     placeholder="Poišči drug artikel…  (Tab)"
                     className="w-full rounded border px-2 py-1 text-sm outline-none
                                focus:border-orange-500" />
            </div>

            <button onClick={() => l.onNovArtikel(postavka)}
                    className="w-full border-t px-3 py-2 text-left text-sm
                               text-orange-700 hover:bg-orange-50">
              ＋ Ustvari nov nabavni artikel <kbd className="ml-1 text-xs">N</kbd>
            </button>
          </div>

          {/* učenje: brez tega je vsak naslednji uvoz enako ročen */}
          {(() => {
            const imaSidro = !!(postavka.izv_sifra?.trim() || postavka.izv_gtin?.trim());
            return (
              <label className={`mt-3 flex items-center gap-2 text-sm ${
                imaSidro ? '' : 'cursor-not-allowed opacity-50'}`}>
                <input type="checkbox" checked={zapomni && imaSidro}
                       onChange={(e) => imaSidro && setZapomni(e.target.checked)}
                       disabled={!imaSidro}
                       className="accent-orange-600 disabled:cursor-not-allowed" />
                Zapomni si za tega dobavitelja
                {!imaSidro && (
                  <span className="text-xs text-neutral-400">
                    (ni šifre/EAN — uparjanje se ne more zapomniti)
                  </span>
                )}
              </label>
            );
          })()}

          {napaka && (
            <p className="mt-2 rounded bg-red-50 px-3 py-2 text-sm text-red-800">{napaka}</p>
          )}
        </div>

        {/* noga */}
        <div className="flex items-center justify-between border-t px-6 py-3">
          <button onClick={() => kazalo + 1 < skupaj ? setKazalo(kazalo + 1) : l.onZakljuci()}
                  className="rounded px-3 py-2 text-sm text-neutral-600 hover:bg-neutral-100">
            Preskoči <kbd className="ml-1 text-xs">Esc</kbd>
          </button>
          <div className="flex gap-2">
            <button onClick={l.onZakljuci}
                    className="rounded border px-4 py-2 text-sm hover:bg-neutral-50">
              Zaključi <kbd className="ml-1 text-xs">F2</kbd>
            </button>
            <button onClick={() => void potrdi()} disabled={izbran === null || dela}
                    className="rounded bg-orange-600 px-4 py-2 text-sm font-medium text-white
                               hover:bg-orange-700 disabled:opacity-40">
              {dela ? 'Shranjujem…' : (
                <>Potrdi in naprej <kbd className="ml-1 text-xs">↵</kbd></>
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
 * mogoče opaziti. Zato dobi lastno vprašanje in se ne upari tiho.
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
