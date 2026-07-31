// artifacts/web/src/pos/uvoz/ProfilUrejevalnik.tsx
//
// Urejevalnik uvoznega profila po dobavitelju.
//
// Zakaj obstaja: brez profila razčlenitev CSV in XLSX ne deluje.
// Prvi uvoz od novega dobavitelja je zato polročen — uporabnik preslika
// stolpce enkrat, vsi naslednji so samodejni.
//
// Zasnova: uporabnik NE piše JSON. Vidi prvih 25 vrstic datoteke in nad
// vsakim stolpcem izbere, kaj ta stolpec pomeni. Predlog je vnaprej
// izpolnjen iz glave, a je vedno viden in popravljiv — tiho ugibanje bi
// pomenilo tiho napačne preslikave pri vseh naslednjih dobavnicah.

import { useCallback, useEffect, useMemo, useState } from 'react';

// =====================================================================
// Tipi
// =====================================================================

type Polje =
  | 'sifra' | 'gtin' | 'naziv' | 'enota' | 'enotVPaketu'
  | 'kolicina' | 'cena' | 'rabatOdst' | 'ddv' | 'vrednost';

const OZNAKE: Record<Polje, string> = {
  sifra: 'Šifra dobavitelja',
  gtin: 'Črtna koda (EAN)',
  naziv: 'Naziv artikla',
  enota: 'Enota mere',
  enotVPaketu: 'Enot v paketu',
  kolicina: 'Količina',
  cena: 'Cena',
  rabatOdst: 'Rabat %',
  ddv: 'DDV %',
  vrednost: 'Vrednost postavke',
};

const OBVEZNA: Polje[] = ['naziv', 'kolicina', 'cena'];

interface Vzorec {
  zaznanFormat: 'CSV' | 'XLSX' | string;
  potrebenProfil: boolean;
  kodiranje?: string;
  locilo?: string;
  glavaIdx: number;
  predlogStolpcev: Partial<Record<Polje, number>>;
  vrstice: string[][];
  sporocilo?: string;
}

interface PredogledPostavka {
  zap: number;
  izvNaziv: string;
  izvSifra: string | null;
  izvGtin: string | null;
  izvKolicina: string;
  izvCena: string;
  enotVPaketu: string;
  opozorila: Array<{ koda: string; resnost: 'B' | 'O' | 'I'; sporocilo: string }>;
}

interface PredogledDto {
  stDokumenta: string | null;
  datumDokumenta: string | null;
  ceneBruto: boolean;
  postavke: PredogledPostavka[];
  napake: Array<{ koda: string; resnost: 'B' | 'O' | 'I'; sporocilo: string }>;
}

interface Lastnosti {
  dobaviteljId: number;
  dobaviteljNaziv: string;
  obstojeciProfil?: { id: number; naziv: string; ceneBruto: boolean; konfiguracija: unknown };
  onVzorec: (d: File) => Promise<Vzorec>;
  onPreizkus: (d: File, konfiguracija: unknown) => Promise<{ dto: PredogledDto }>;
  onShrani: (telo: unknown) => Promise<void>;
  onPreklici: () => void;
}

// =====================================================================
// Sestavni del
// =====================================================================

export function ProfilUrejevalnik(l: Lastnosti) {
  const [datoteka, setDatoteka] = useState<File | null>(null);
  const [vzorec, setVzorec] = useState<Vzorec | null>(null);
  const [naziv, setNaziv] = useState(l.obstojeciProfil?.naziv ?? '');
  const [ceneBruto, setCeneBruto] = useState(l.obstojeciProfil?.ceneBruto ?? false);
  const [decimalno, setDecimalno] = useState<',' | '.'>(',');
  const [stolpci, setStolpci] = useState<Partial<Record<Polje, number>>>({});
  const [glavaIdx, setGlavaIdx] = useState(0);
  const [predogled, setPredogled] = useState<PredogledDto | null>(null);
  const [dela, setDela] = useState(false);
  const [napaka, setNapaka] = useState<string | null>(null);

  // ---- nalaganje vzorca ----
  const naloziVzorec = useCallback(async (d: File) => {
    setDela(true);
    setNapaka(null);
    try {
      const v = await l.onVzorec(d);
      setVzorec(v);
      setDatoteka(d);
      setGlavaIdx(v.glavaIdx);
      setStolpci(v.predlogStolpcev);
      if (!naziv) setNaziv(`${l.dobaviteljNaziv} — ${v.zaznanFormat}`);
    } catch (e) {
      setNapaka((e as Error).message);
    } finally {
      setDela(false);
    }
  }, [l, naziv]);

  // ---- konfiguracija, ki gre na zaledje ----
  const konfiguracija = useMemo(() => {
    if (!vzorec) return null;
    const s: Record<string, { indeks: number }> = {};
    for (const [polje, idx] of Object.entries(stolpci)) {
      if (idx !== undefined) s[polje] = { indeks: idx };
    }
    return {
      kodiranje: vzorec.kodiranje,
      locilo: vzorec.locilo,
      decimalnoLocilo: decimalno,
      ceneBruto,
      // Iskanje glave po vsebini je odpornejše od fiksnega odmika —
      // dobavitelji radi dodajo uvodno vrstico brez obvestila.
      glavaVsebuje: (vzorec.vrstice[glavaIdx] ?? [])
        .filter((c) => String(c).trim().length > 2)
        .slice(0, 3)
        .map((c) => String(c).trim().toLowerCase()),
      prvaVrsticaPodatkov: glavaIdx + 2,
      stolpci: s,
    };
  }, [vzorec, stolpci, decimalno, ceneBruto, glavaIdx]);

  const manjkajoca = OBVEZNA.filter((p) => stolpci[p] === undefined);
  const veljavno = !!konfiguracija && manjkajoca.length === 0;

  // ---- živi predogled ----
  useEffect(() => {
    if (!datoteka || !konfiguracija || !veljavno) { setPredogled(null); return; }
    const id = setTimeout(() => {
      void l.onPreizkus(datoteka, konfiguracija)
        .then((r) => { setPredogled(r.dto); setNapaka(null); })
        .catch((e) => setNapaka((e as Error).message));
    }, 300);
    return () => clearTimeout(id);
  }, [datoteka, konfiguracija, veljavno, l]);

  const shrani = async () => {
    if (!veljavno) return;
    setDela(true);
    try {
      await l.onShrani({
        dobaviteljId: l.dobaviteljId,
        naziv,
        format: vzorec!.zaznanFormat,
        ceneBruto,
        prepoznava: { glavaVsebuje: konfiguracija!.glavaVsebuje },
        konfiguracija,
      });
    } catch (e) {
      setNapaka((e as Error).message);
    } finally {
      setDela(false);
    }
  };

  // =====================================================================
  // 1. korak: naloži vzorčno datoteko
  // =====================================================================

  if (!vzorec) {
    return (
      <Okvir naslov={`Uvozni profil — ${l.dobaviteljNaziv}`} onZapri={l.onPreklici}>
        <p className="text-sm text-neutral-600">
          Naložite eno dobavnico tega dobavitelja. Iz nje se naučimo, kje so
          kateri podatki. Datoteka se <strong>ne</strong> uvozi — služi samo
          kot vzorec.
        </p>

        <label className="mt-4 flex cursor-pointer flex-col items-center justify-center
                          rounded-lg border-2 border-dashed border-neutral-300 py-10
                          hover:border-orange-400 hover:bg-orange-50">
          <span className="text-sm text-neutral-600">
            Kliknite ali povlecite datoteko (CSV, XLSX)
          </span>
          <input type="file" accept=".csv,.txt,.xlsx,.xls" className="hidden"
                 onChange={(e) => {
                   const d = e.target.files?.[0];
                   if (d) void naloziVzorec(d);
                 }} />
        </label>

        {dela && <p className="mt-3 text-sm text-neutral-500">Berem datoteko…</p>}
        {napaka && <Napaka>{napaka}</Napaka>}
      </Okvir>
    );
  }

  if (!vzorec.potrebenProfil) {
    return (
      <Okvir naslov={`Uvozni profil — ${l.dobaviteljNaziv}`} onZapri={l.onPreklici}>
        <p className="rounded bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
          Zaznan format je <strong>{vzorec.zaznanFormat}</strong>. Ta je
          standardiziran, zato profil ni potreben — dobavnice tega
          dobavitelja se bodo uvozile brez nastavljanja.
        </p>
        <div className="mt-4 flex justify-end">
          <button onClick={l.onPreklici}
                  className="rounded bg-orange-600 px-4 py-2 text-sm text-white">
            V redu
          </button>
        </div>
      </Okvir>
    );
  }

  // =====================================================================
  // 2. korak: preslikava stolpcev
  // =====================================================================

  const stStolpcev = Math.max(...vzorec.vrstice.map((v) => v.length), 0);
  const uporabljeni = new Set(Object.values(stolpci).filter((x) => x !== undefined));

  return (
    <Okvir naslov={`Uvozni profil — ${l.dobaviteljNaziv}`} onZapri={l.onPreklici} siroko>
      {/* osnovne nastavitve */}
      <div className="grid grid-cols-3 gap-3">
        <Polje2 oznaka="Naziv profila">
          <input value={naziv} onChange={(e) => setNaziv(e.target.value)}
                 className="w-full rounded border px-2 py-1 text-sm" />
        </Polje2>
        <Polje2 oznaka="Decimalno ločilo">
          <select value={decimalno}
                  onChange={(e) => setDecimalno(e.target.value as ',' | '.')}
                  className="w-full rounded border px-2 py-1 text-sm">
            <option value=",">vejica (1.234,56)</option>
            <option value=".">pika (1,234.56)</option>
          </select>
        </Polje2>
        <Polje2 oznaka="Cene na dobavnici">
          <div className="flex overflow-hidden rounded border text-sm">
            <button onClick={() => setCeneBruto(false)}
                    className={`flex-1 px-2 py-1 ${!ceneBruto ? 'bg-orange-600 text-white' : ''}`}>
              Neto
            </button>
            <button onClick={() => setCeneBruto(true)}
                    className={`flex-1 px-2 py-1 ${ceneBruto ? 'bg-orange-600 text-white' : ''}`}>
              Bruto
            </button>
          </div>
        </Polje2>
      </div>

      <p className="mt-2 text-xs text-neutral-500">
        Kodiranje zaznano kot <strong>{vzorec.kodiranje ?? '—'}</strong>
        {vzorec.locilo && <>, ločilo <strong>{vzorec.locilo === '\t' ? 'tabulator' : vzorec.locilo}</strong></>}.
        {ceneBruto && ' Bruto cene se preračunajo v neto po stopnji z dokumenta.'}
      </p>

      {/* preslikava stolpcev nad predogledom datoteke */}
      <p className="mt-4 text-sm font-medium">Kaj pomeni posamezni stolpec?</p>
      <p className="text-xs text-neutral-500">
        Predlog je izpolnjen iz glave. Preverite ga — napačna preslikava se
        uporabi pri vseh naslednjih dobavnicah tega dobavitelja.
      </p>

      <div className="mt-2 overflow-x-auto rounded border">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="bg-neutral-50">
              <th className="w-8 border-b px-2 py-1"></th>
              {Array.from({ length: stStolpcev }, (_, i) => {
                const dodeljeno = (Object.entries(stolpci)
                  .find(([, v]) => v === i)?.[0] ?? '') as Polje | '';
                return (
                  <th key={i} className="border-b border-l px-1 py-1">
                    <select value={dodeljeno}
                      onChange={(e) => {
                        const p = e.target.value as Polje | '';
                        setStolpci((prej) => {
                          const nov = { ...prej };
                          // en stolpec = eno polje; sprosti prejšnjo dodelitev
                          for (const [k, v] of Object.entries(nov)) {
                            if (v === i) delete nov[k as Polje];
                          }
                          if (p) nov[p] = i;
                          return nov;
                        });
                      }}
                      className={`w-full rounded border px-1 py-0.5 text-xs
                                  ${dodeljeno ? 'border-orange-400 bg-orange-50' : 'text-neutral-400'}`}>
                      <option value="">—</option>
                      {(Object.keys(OZNAKE) as Polje[]).map((p) => (
                        <option key={p} value={p}
                          disabled={stolpci[p] !== undefined && stolpci[p] !== i}>
                          {OZNAKE[p]}{OBVEZNA.includes(p) ? ' *' : ''}
                        </option>
                      ))}
                    </select>
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody>
            {vzorec.vrstice.slice(0, 12).map((v, r) => (
              <tr key={r}
                  className={r === glavaIdx ? 'bg-amber-50 font-medium' : undefined}>
                <td className="border-b px-2 py-1 text-right text-neutral-400">
                  <button onClick={() => setGlavaIdx(r)} title="Označi kot vrstico glave"
                          className={r === glavaIdx ? 'text-amber-700' : 'hover:text-orange-600'}>
                    {r + 1}
                  </button>
                </td>
                {Array.from({ length: stStolpcev }, (_, c) => (
                  <td key={c}
                      className={`max-w-[10rem] truncate border-b border-l px-1 py-1
                                  ${uporabljeni.has(c) ? '' : 'text-neutral-400'}`}>
                    {v[c] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <p className="mt-1 text-xs text-neutral-500">
        Rumena vrstica je glava. Če je označena napačna, kliknite številko prave.
      </p>

      {manjkajoca.length > 0 && (
        <p className="mt-3 rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Manjkajo obvezni stolpci: {manjkajoca.map((p) => OZNAKE[p]).join(', ')}.
        </p>
      )}

      {/* živi predogled razčlenitve */}
      {predogled && (
        <div className="mt-4">
          <p className="text-sm font-medium">
            Predogled razčlenitve — {predogled.postavke.length} postavk
            {predogled.stDokumenta && <> · dokument {predogled.stDokumenta}</>}
            {predogled.datumDokumenta && <> · {predogled.datumDokumenta}</>}
          </p>

          {predogled.napake.map((n) => (
            <p key={n.koda}
               className={`mt-1 rounded px-3 py-1.5 text-sm ${
                 n.resnost === 'B' ? 'bg-red-50 text-red-800'
                 : n.resnost === 'O' ? 'bg-amber-50 text-amber-800'
                 : 'bg-neutral-50 text-neutral-600'}`}>
              {n.sporocilo}
            </p>
          ))}

          <div className="mt-2 overflow-x-auto rounded border">
            <table className="min-w-full text-xs">
              <thead className="bg-neutral-50">
                <tr>
                  <th className="border-b px-2 py-1 text-left">#</th>
                  <th className="border-b px-2 py-1 text-left">Naziv</th>
                  <th className="border-b px-2 py-1 text-left">Šifra</th>
                  <th className="border-b px-2 py-1 text-right">Pak.</th>
                  <th className="border-b px-2 py-1 text-right">Kol.</th>
                  <th className="border-b px-2 py-1 text-right">Cena</th>
                  <th className="border-b px-2 py-1"></th>
                </tr>
              </thead>
              <tbody>
                {predogled.postavke.slice(0, 8).map((p) => (
                  <tr key={p.zap}>
                    <td className="border-b px-2 py-1">{p.zap}</td>
                    <td className="border-b px-2 py-1">{p.izvNaziv}</td>
                    <td className="border-b px-2 py-1 text-neutral-500">{p.izvSifra ?? '—'}</td>
                    <td className="border-b px-2 py-1 text-right">{p.enotVPaketu}</td>
                    <td className="border-b px-2 py-1 text-right">{p.izvKolicina}</td>
                    <td className="border-b px-2 py-1 text-right">{p.izvCena}</td>
                    <td className="border-b px-2 py-1">
                      {p.opozorila.some((o) => o.resnost === 'B') && (
                        <span title={p.opozorila.map((o) => o.sporocilo).join('\n')}
                              className="text-red-600">✕</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {predogled.postavke.length > 8 && (
            <p className="mt-1 text-xs text-neutral-500">
              … in še {predogled.postavke.length - 8} postavk.
            </p>
          )}
        </div>
      )}

      {napaka && <Napaka>{napaka}</Napaka>}

      <div className="mt-5 flex items-center justify-between border-t pt-4">
        <button onClick={() => { setVzorec(null); setPredogled(null); }}
                className="text-sm text-neutral-600 hover:underline">
          ← Druga vzorčna datoteka
        </button>
        <div className="flex gap-2">
          <button onClick={l.onPreklici}
                  className="rounded border px-4 py-2 text-sm hover:bg-neutral-50">
            Prekliči
          </button>
          <button onClick={() => void shrani()} disabled={!veljavno || dela}
                  className="rounded bg-orange-600 px-4 py-2 text-sm font-medium text-white
                             hover:bg-orange-700 disabled:opacity-40">
            {dela ? 'Shranjujem…' : 'Shrani profil'}
          </button>
        </div>
      </div>
    </Okvir>
  );
}

// =====================================================================
// Pomožni sestavni deli
// =====================================================================

function Okvir(p: {
  naslov: string; onZapri: () => void; siroko?: boolean; children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/40 p-4">
      <div className={`my-8 w-full rounded-lg bg-white p-6 shadow-xl
                       ${p.siroko ? 'max-w-5xl' : 'max-w-xl'}`}>
        <div className="mb-4 flex items-start justify-between">
          <h2 className="text-lg font-semibold">{p.naslov}</h2>
          <button onClick={p.onZapri} aria-label="Zapri"
                  className="rounded p-1 text-neutral-400 hover:bg-neutral-100">✕</button>
        </div>
        {p.children}
      </div>
    </div>
  );
}

function Polje2(p: { oznaka: string; children: React.ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs font-medium text-neutral-600">{p.oznaka}</span>
      {p.children}
    </label>
  );
}

function Napaka(p: { children: React.ReactNode }) {
  return (
    <p className="mt-3 rounded bg-red-50 px-3 py-2 text-sm text-red-800">{p.children}</p>
  );
}
