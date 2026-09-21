// artifacts/pos/src/pages/uvoz/OdstopanjaPogled.tsx
//
// Poročilo o odstopanjih cen — samostojna stran, ne podstran prejemnice.

import { useMemo, useState } from 'react';

// =====================================================================
// Tipi (ustrezajo odgovoru GET /api/pos/uvoz/odstopanja)
// =====================================================================

export interface Odstopanje {
  prejemnica_id: number;
  stevilka: string;
  datum: string;
  st_dokumenta: string | null;
  dobavitelj: string;
  dobavitelj_id: number;
  artikel: string;
  sifra_dobavitelja: string | null;
  nova_cena: string;
  prejsnja_cena: string | null;
  odstopanje_odst: string | null;
  financni_ucinek: string;
  prejsnje_pakiranje: string | null;
  novo_pakiranje: string | null;
  cena_paket: string | null;
  pakiranje_spremenjeno: boolean;
  kolicina_enot: string;
}

interface Lastnosti {
  odstopanja: Odstopanje[];
  skupniUcinek: string;
  obdobjeOd: string;
  obdobjeDo: string;
  nalaganje?: boolean;
  onObdobje: (od: string, do_: string) => void;
  onPragSpremenjen: (odstotek: number) => void;
  onReklamacija: (dobaviteljId: number, prejemnicePostavke: number[]) => void;
  onOdpriPrejemnico: (id: number) => void;
}

// =====================================================================
// Oblikovanje
// =====================================================================

const st = (v: string | null, d = 2): string =>
  v === null || v === ''
    ? '—'
    : new Intl.NumberFormat('sl-SI', {
        minimumFractionDigits: d, maximumFractionDigits: d,
      }).format(Number(v));

const datum = (iso: string): string => {
  const [l, m, d] = iso.split('-');
  return d ? `${Number(d)}. ${Number(m)}. ${l}` : iso;
};

/**
 * Ali je podražitev v celoti posledica manjšega pakiranja?
 * Če je, cena paketa na računu ni spremenjena in odstopanja ni videti.
 */
function skritoVPakiranju(o: Odstopanje): boolean {
  if (!o.pakiranje_spremenjeno) return false;
  const pp = Number(o.prejsnje_pakiranje);
  const np = Number(o.novo_pakiranje);
  const pc = Number(o.prejsnja_cena);
  const nc = Number(o.nova_cena);
  if (!(pp > 0 && np > 0 && pc > 0)) return false;
  return Math.abs(nc / pc - pp / np) <= 0.005;
}

// =====================================================================
// Pogled
// =====================================================================

export function OdstopanjaPogled(l: Lastnosti) {
  const [izbrane, setIzbrane] = useState<Set<number>>(new Set());
  const [prag, setPrag] = useState(10);
  const [samoPakiranje, setSamoPakiranje] = useState(false);

  const vidna = useMemo(
    () => (samoPakiranje ? l.odstopanja.filter(skritoVPakiranju) : l.odstopanja),
    [l.odstopanja, samoPakiranje],
  );

  // Razvrsti po dobavitelju, znotraj po učinku navzdol.
  const poDobaviteljih = useMemo(() => {
    const m = new Map<number, { naziv: string; vrstice: Odstopanje[]; ucinek: number }>();
    for (const o of vidna) {
      const t = m.get(o.dobavitelj_id) ??
        { naziv: o.dobavitelj, vrstice: [], ucinek: 0 };
      t.vrstice.push(o);
      t.ucinek += Number(o.financni_ucinek);
      m.set(o.dobavitelj_id, t);
    }
    for (const t of m.values()) {
      t.vrstice.sort(
        (a, b) => Math.abs(Number(b.financni_ucinek)) - Math.abs(Number(a.financni_ucinek)),
      );
    }
    return [...m.entries()]
      .map(([id, t]) => ({ id, ...t }))
      .sort((a, b) => Math.abs(b.ucinek) - Math.abs(a.ucinek));
  }, [vidna]);

  const skritih = useMemo(() => l.odstopanja.filter(skritoVPakiranju).length, [l.odstopanja]);

  const preklopi = (id: number) =>
    setIzbrane((prej) => {
      const nov = new Set(prej);
      if (nov.has(id)) nov.delete(id);
      else nov.add(id);
      return nov;
    });

  const skupajIzbranih = useMemo(
    () => [...izbrane].reduce((s, id) => {
      const o = l.odstopanja.find(x => x.prejemnica_id === id);
      return s + (o ? Number(o.financni_ucinek) : 0);
    }, 0),
    [izbrane, l.odstopanja],
  );

  return (
    <div className="space-y-6">
      {/* Glava z obdobjem in pragom */}
      <div className="flex flex-wrap items-end gap-4">
        <div className="flex items-end gap-2">
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Od</label>
            <input
              type="date"
              value={l.obdobjeOd}
              onChange={e => l.onObdobje(e.target.value, l.obdobjeDo)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-muted-foreground mb-1">Do</label>
            <input
              type="date"
              value={l.obdobjeDo}
              onChange={e => l.onObdobje(l.obdobjeOd, e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm"
            />
          </div>
        </div>
        <div>
          <label className="block text-xs font-medium text-muted-foreground mb-1">
            Min. odstopanje (%)
          </label>
          <input
            type="number"
            min={0}
            max={100}
            value={prag}
            onChange={e => {
              const v = Number(e.target.value);
              setPrag(v);
              l.onPragSpremenjen(v);
            }}
            className="h-9 w-24 rounded-md border border-input bg-background px-3 text-sm"
          />
        </div>
        <label className="flex items-center gap-2 text-sm cursor-pointer select-none">
          <input
            type="checkbox"
            checked={samoPakiranje}
            onChange={e => setSamoPakiranje(e.target.checked)}
            className="h-4 w-4 rounded border-input"
          />
          Samo skrita pakiran. odstopanja
        </label>
      </div>

      {/* Kartice KPI */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Kartica
          oznaka="Skupni finančni učinek"
          vrednost={`${st(l.skupniUcinek)} €`}
          poudarek={Number(l.skupniUcinek) > 0}
        />
        <Kartica oznaka="Odstopanj" vrednost={String(l.odstopanja.length)} />
        <Kartica oznaka="Dobaviteljev" vrednost={String(poDobaviteljih.length)} />
        {izbrane.size > 0 && (
          <Kartica
            oznaka={`Izbranih (${izbrane.size})`}
            vrednost={`${st(String(skupajIzbranih))} €`}
            poudarek={skupajIzbranih > 0}
          />
        )}
      </div>

      {/* Gumb za reklamacijo izbranih */}
      {izbrane.size > 0 && (
        <div className="flex flex-wrap gap-2">
          {[...new Set(l.odstopanja.filter(o => izbrane.has(o.prejemnica_id)).map(o => o.dobavitelj_id))].map(did => {
            const postavke = l.odstopanja
              .filter(o => izbrane.has(o.prejemnica_id) && o.dobavitelj_id === did)
              .map(o => o.prejemnica_id);
            const naziv = l.odstopanja.find(o => o.dobavitelj_id === did)?.dobavitelj ?? '';
            return (
              <button
                key={did}
                onClick={() => l.onReklamacija(did, postavke)}
                className="rounded-lg bg-orange-600 px-4 py-2 text-sm font-medium text-white hover:bg-orange-700"
              >
                Reklamacija — {naziv}
              </button>
            );
          })}
        </div>
      )}

      {l.nalaganje ? (
        <p className="py-8 text-center text-sm text-muted-foreground">Nalaganje …</p>
      ) : l.odstopanja.length === 0 ? (
        <p className="rounded-xl border border-dashed p-8 text-center text-sm text-muted-foreground">
          Ni odstopanj za izbrano obdobje in prag.
        </p>
      ) : (
        poDobaviteljih.map(({ id, naziv, vrstice, ucinek }) => (
          <section key={id} className="rounded-xl border bg-card overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b bg-muted/30">
              <h3 className="font-semibold text-sm">{naziv}</h3>
              <span className={`text-sm font-medium tabular-nums ${ucinek > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                {ucinek > 0 ? '+' : ''}{st(String(ucinek))} €
              </span>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-left text-xs text-muted-foreground">
                    <th className="pl-3 pr-2 py-2 w-5"></th>
                    <th className="px-2 py-2">Artikel</th>
                    <th className="px-2 py-2 text-right">Prej. cena</th>
                    <th className="px-2 py-2 text-right">Nova cena</th>
                    <th className="px-2 py-2 text-right">Δ %</th>
                    <th className="px-2 py-2 text-right">Fin. učinek</th>
                  </tr>
                </thead>
                <tbody>
                  {vrstice.map((o) => {
                    const rast = Number(o.financni_ucinek) > 0;
                    return (
                      <tr
                        key={o.prejemnica_id}
                        className={`hover:bg-muted/30 cursor-pointer ${izbrane.has(o.prejemnica_id) ? 'bg-orange-50' : ''}`}
                        onClick={() => preklopi(o.prejemnica_id)}
                      >
                        <td className="border-b pl-3 pr-2 py-1.5">
                          <input
                            type="checkbox"
                            readOnly
                            checked={izbrane.has(o.prejemnica_id)}
                            className="h-3.5 w-3.5 rounded border-input pointer-events-none"
                          />
                        </td>
                        <td className="border-b px-2 py-1.5">
                          <button
                            onClick={(e) => { e.stopPropagation(); l.onOdpriPrejemnico(o.prejemnica_id); }}
                            className="text-left hover:underline"
                          >
                            <span className="font-medium">{o.artikel}</span>
                            {o.sifra_dobavitelja && (
                              <span className="ml-1 text-xs text-muted-foreground">({o.sifra_dobavitelja})</span>
                            )}
                          </button>
                          <div className="text-xs text-muted-foreground">
                            {datum(o.datum)} · {o.stevilka}
                            {o.st_dokumenta && <> · dok. {o.st_dokumenta}</>}
                          </div>
                        </td>
                        <td className="border-b px-2 py-1.5 text-right tabular-nums">
                          {st(o.prejsnja_cena, 4)}
                        </td>
                        <td className="border-b px-2 py-1.5 text-right font-medium tabular-nums">
                          {st(o.nova_cena, 4)}
                        </td>
                        <td className={`border-b px-2 py-1.5 text-right tabular-nums
                                        ${rast ? 'text-red-700' : 'text-emerald-700'}`}>
                          {o.odstopanje_odst !== null && (
                            <>{rast ? '+' : ''}{st(o.odstopanje_odst, 1)} %</>
                          )}
                        </td>
                        <td className={`border-b px-2 py-1.5 text-right font-medium tabular-nums
                                        ${rast ? 'text-red-700' : 'text-emerald-700'}`}>
                          {st(o.financni_ucinek)} €
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </section>
        ))
      )}

      {skritih > 0 && !samoPakiranje && (
        <aside className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Skritih podražitev prek pakiranja: {skritih}.</strong>{' '}
          Cena paketa je nespremenjena, zmanjšalo se je število enot. Na računu ni videti ničesar
          — razliko pokaže šele preračun na enoto.
        </aside>
      )}
    </div>
  );
}

function Kartica(p: { oznaka: string; vrednost: string; poudarek?: boolean }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs text-neutral-500">{p.oznaka}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums
                     ${p.poudarek ? 'text-red-700' : ''}`}>
        {p.vrednost}
      </p>
    </div>
  );
}
