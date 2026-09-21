// artifacts/pos/src/pages/uvoz/CenikProfilUrejevalnik.tsx
//
// Urejevalnik profila za uvoz cenika dobavitelja.
//
// Razlika od ProfilUrejevalnik (za prejemnice):
//   - obvezni stolpci: naziv + cena (brez kolicina)
//   - polje enotVPaketu namesto kolicina
//   - polje ddv (neobvezno)
//   - brez rabatOdst
//   - live predogled gre na /cenik/predogled (ne /profili/preizkus)
//   - profil se shrani s tip:'CENIK'

import { useCallback, useEffect, useMemo, useState } from 'react';

// =====================================================================
// Tipi
// =====================================================================

type CenikPolje = 'sifra' | 'gtin' | 'naziv' | 'enota' | 'enotVPaketu' | 'cena' | 'ddv';

const OZNAKE: Record<CenikPolje, string> = {
  sifra: 'Šifra dobavitelja',
  gtin: 'Črtna koda (EAN)',
  naziv: 'Naziv artikla',
  enota: 'Enota mere',
  enotVPaketu: 'Enot v paketu',
  cena: 'Cena paketa',
  ddv: 'DDV %',
};

const OBVEZNA: CenikPolje[] = ['naziv', 'cena'];

interface Vzorec {
  zaznanFormat: 'CSV' | 'XLSX' | string;
  potrebenProfil: boolean;
  kodiranje?: string;
  locilo?: string;
  glavaIdx: number;
  predlogStolpcev: Partial<Record<CenikPolje, number>>;
  vrstice: string[][];
  sporocilo?: string;
}

interface PredogledVrstica {
  zap: number;
  naziv: string;
  sifra: string | null;
  artikelId: number | null;
  artikelNaziv: string | null;
  samodejno: boolean;
  zeObstaja: boolean;
  cenaNova: string | null;
}

interface PredogledDto {
  vrstic: number;
  samodejno: number;
  zaPotrditev: number;
  brezZadetka: number;
  posodobitev: number;
  vrstice: PredogledVrstica[];
}

export interface Lastnosti {
  dobaviteljId: string;
  dobaviteljNaziv: string;
  datoteka: File;
  obstojeciProfil?: { id: number; naziv: string; konfiguracija: unknown };
  apiBase: string;
  enotaHeader: () => Record<string, string>;
  onShrani: (profilId: number | null, konfiguracija: unknown) => Promise<void>;
  onPreklici: () => void;
}

// =====================================================================
// Sestavni del
// =====================================================================

export function CenikProfilUrejevalnik(l: Lastnosti) {
  const [vzorec, setVzorec]         = useState<Vzorec | null>(null);
  const [naziv, setNaziv]           = useState(l.obstojeciProfil?.naziv ?? '');
  const [decimalno, setDecimalno]   = useState<',' | '.'>(',');
  const [stolpci, setStolpci]       = useState<Partial<Record<CenikPolje, number>>>({});
  const [glavaIdx, setGlavaIdx]     = useState(0);
  const [predogled, setPredogled]   = useState<PredogledDto | null>(null);
  const [dela, setDela]             = useState(false);
  const [napaka, setNapaka]         = useState<string | null>(null);

  // Naloži vzorec ob montaži
  useEffect(() => {
    const naloziVzorec = async () => {
      setDela(true);
      try {
        const fd = new FormData();
        fd.append('datoteka', l.datoteka);
        const r = await fetch(`${l.apiBase}/api/pos/uvoz/profili/vzorec`, {
          method: 'POST',
          credentials: 'include',
          headers: l.enotaHeader(),
          body: fd,
        });
        const d = await r.json() as Vzorec;
        setVzorec(d);
        setGlavaIdx(d.glavaIdx);
        // Predlog za cenik stolpce (ugibajStolpce v cenik.ts)
        const predCenikStolpci: Partial<Record<CenikPolje, number>> = {};
        const pred = d.predlogStolpcev as Partial<Record<string, number>>;
        for (const k of Object.keys(OZNAKE) as CenikPolje[]) {
          if (pred[k] !== undefined) predCenikStolpci[k] = pred[k];
        }
        setStolpci(predCenikStolpci);
        if (!naziv) setNaziv(`${l.dobaviteljNaziv} — cenik ${d.zaznanFormat}`);
      } catch (e) {
        setNapaka((e as Error).message);
      } finally {
        setDela(false);
      }
    };
    void naloziVzorec();
  // Namerno brez dependency array — samo ob mount-u
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const konfiguracija = useMemo(() => {
    if (!vzorec) return null;
    const s: Record<string, number> = {};
    for (const [polje, idx] of Object.entries(stolpci)) {
      if (idx !== undefined) s[polje] = idx as number;
    }
    return {
      kodiranje:          vzorec.kodiranje,
      locilo:             vzorec.locilo,
      decimalnoLocilo:    decimalno,
      glavaVsebuje:       (vzorec.vrstice[glavaIdx] ?? [])
                            .filter((c) => String(c).trim().length > 2)
                            .slice(0, 3)
                            .map((c) => String(c).trim().toLowerCase()),
      prvaVrsticaPodatkov: glavaIdx + 2,
      stolpci:             s,
    };
  }, [vzorec, stolpci, decimalno, glavaIdx]);

  const manjkajoca = OBVEZNA.filter((p) => stolpci[p] === undefined);
  const veljavno   = !!konfiguracija && manjkajoca.length === 0;

  // Živi predogled (debounce 400 ms)
  useEffect(() => {
    if (!veljavno || !konfiguracija) { setPredogled(null); return; }
    const id = setTimeout(async () => {
      try {
        const fd = new FormData();
        fd.append('datoteka', l.datoteka);
        fd.append('dobaviteljId', String(l.dobaviteljId));
        fd.append('profil', JSON.stringify(konfiguracija));
        const r = await fetch(`${l.apiBase}/api/pos/uvoz/cenik/predogled`, {
          method: 'POST',
          credentials: 'include',
          headers: l.enotaHeader(),
          body: fd,
        });
        const d = await r.json() as PredogledDto;
        setPredogled(d);
        setNapaka(null);
      } catch (e) {
        setNapaka((e as Error).message);
      }
    }, 400);
    return () => clearTimeout(id);
  }, [konfiguracija, veljavno, l]);

  const shrani = useCallback(async () => {
    if (!veljavno || !konfiguracija) return;
    setDela(true);
    try {
      const telo = {
        dobaviteljId: l.dobaviteljId,
        naziv,
        format: vzorec!.zaznanFormat,
        tip: 'CENIK',
        ceneBruto: false,
        prepoznava: { glavaVsebuje: konfiguracija.glavaVsebuje },
        konfiguracija,
      };
      let profilId: number | null = null;
      if (l.obstojeciProfil?.id) {
        await fetch(`${l.apiBase}/api/pos/uvoz/profili/${l.obstojeciProfil.id}`, {
          method: 'PUT',
          credentials: 'include',
          headers: { ...l.enotaHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify(telo),
        });
        profilId = l.obstojeciProfil.id;
      } else {
        const r = await fetch(`${l.apiBase}/api/pos/uvoz/profili`, {
          method: 'POST',
          credentials: 'include',
          headers: { ...l.enotaHeader(), 'Content-Type': 'application/json' },
          body: JSON.stringify(telo),
        });
        const d = await r.json() as { id: number };
        profilId = d.id;
      }
      await l.onShrani(profilId, konfiguracija);
    } catch (e) {
      setNapaka((e as Error).message);
    } finally {
      setDela(false);
    }
  }, [veljavno, konfiguracija, naziv, vzorec, l]);

  if (dela && !vzorec) {
    return <div className="flex items-center justify-center py-12 text-sm text-neutral-500">Berem datoteko…</div>;
  }

  if (!vzorec) {
    return napaka
      ? <Napaka>{napaka}</Napaka>
      : <div className="py-8 text-center text-sm text-neutral-500">Čakam na datoteko…</div>;
  }

  if (!vzorec.potrebenProfil) {
    return (
      <div className="rounded bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
        Format <strong>{vzorec.zaznanFormat}</strong> je standardiziran — profil ni potreben.
        <button onClick={() => void l.onShrani(null, null)}
                className="ml-3 rounded bg-emerald-700 px-3 py-1 text-white hover:bg-emerald-800">
          Nadaljuj
        </button>
      </div>
    );
  }

  const stStolpcev = Math.max(...vzorec.vrstice.map((v) => v.length), 0);
  const uporabljeni = new Set(Object.values(stolpci).filter((x) => x !== undefined));

  return (
    <div className="space-y-4">
      {/* Osnovne nastavitve */}
      <div className="grid grid-cols-2 gap-3">
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
      </div>
      <p className="text-xs text-neutral-500">
        Kodiranje: <strong>{vzorec.kodiranje ?? '—'}</strong>
        {vzorec.locilo && <>, ločilo: <strong>{vzorec.locilo === '\t' ? 'tabulator' : vzorec.locilo}</strong></>}
      </p>

      {/* Preslikava stolpcev */}
      <p className="text-sm font-medium">Kaj pomeni posamezni stolpec?</p>
      <div className="overflow-x-auto rounded border">
        <table className="min-w-full text-xs">
          <thead>
            <tr className="bg-neutral-50">
              <th className="w-8 border-b px-2 py-1"></th>
              {Array.from({ length: stStolpcev }, (_, i) => {
                const dodeljeno = (Object.entries(stolpci).find(([, v]) => v === i)?.[0] ?? '') as CenikPolje | '';
                return (
                  <th key={i} className="border-b border-l px-1 py-1">
                    <select value={dodeljeno}
                      onChange={(e) => {
                        const p = e.target.value as CenikPolje | '';
                        setStolpci((prej) => {
                          const nov = { ...prej };
                          for (const [k, v] of Object.entries(nov)) {
                            if (v === i) delete nov[k as CenikPolje];
                          }
                          if (p) nov[p] = i;
                          return nov;
                        });
                      }}
                      className={`w-full rounded border px-1 py-0.5 text-xs
                                  ${dodeljeno ? 'border-orange-400 bg-orange-50' : 'text-neutral-400'}`}>
                      <option value="">—</option>
                      {(Object.keys(OZNAKE) as CenikPolje[]).map((p) => (
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
            {vzorec.vrstice.slice(0, 10).map((v, r) => (
              <tr key={r} className={r === glavaIdx ? 'bg-amber-50 font-medium' : undefined}>
                <td className="border-b px-2 py-1 text-right text-neutral-400">
                  <button onClick={() => setGlavaIdx(r)} title="Označi kot glavo"
                          className={r === glavaIdx ? 'text-amber-700' : 'hover:text-orange-600'}>
                    {r + 1}
                  </button>
                </td>
                {Array.from({ length: stStolpcev }, (_, c) => (
                  <td key={c}
                      className={`max-w-[8rem] truncate border-b border-l px-1 py-1
                                  ${uporabljeni.has(c) ? '' : 'text-neutral-400'}`}>
                    {v[c] ?? ''}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-xs text-neutral-500">Rumena vrstica je glava. Kliknite številko za spremembo.</p>

      {manjkajoca.length > 0 && (
        <p className="rounded bg-amber-50 px-3 py-2 text-sm text-amber-800">
          Manjkajo obvezni stolpci: {manjkajoca.map((p) => OZNAKE[p]).join(', ')}.
        </p>
      )}

      {/* Live predogled uparjanja */}
      {predogled && (
        <div className="rounded border bg-neutral-50 p-3 text-xs">
          <p className="mb-2 font-medium text-sm">Predogled uparjanja</p>
          <div className="flex gap-4 text-neutral-600">
            <span>✓ Samodejno: <strong className="text-green-700">{predogled.samodejno}</strong></span>
            <span>? Pregled: <strong className="text-amber-700">{predogled.zaPotrditev}</strong></span>
            <span>✕ Brez ujemanja: <strong className="text-neutral-500">{predogled.brezZadetka}</strong></span>
          </div>
        </div>
      )}

      {napaka && <Napaka>{napaka}</Napaka>}

      <div className="flex justify-end gap-2 border-t pt-4">
        <button onClick={l.onPreklici}
                className="rounded border px-4 py-2 text-sm hover:bg-neutral-50">
          Prekliči
        </button>
        <button onClick={() => void shrani()} disabled={!veljavno || dela}
                className="rounded bg-orange-600 px-4 py-2 text-sm font-medium text-white
                           hover:bg-orange-700 disabled:opacity-40">
          {dela ? 'Shranjujem…' : 'Shrani profil in nadaljuj'}
        </button>
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
    <p className="rounded bg-red-50 px-3 py-2 text-sm text-red-800">{p.children}</p>
  );
}
