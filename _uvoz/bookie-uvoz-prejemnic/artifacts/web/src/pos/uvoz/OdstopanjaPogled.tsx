// artifacts/web/src/pos/uvoz/OdstopanjaPogled.tsx
//
// Poročilo o odstopanjih cen — samostojna stran, ne podstran prejemnice.
//
// To je edini del modula z neposredno merljivim donosom. Vse ostalo
// obstaja zato, da so številke tu verodostojne.

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

  const preklopiSkupino = (vrstice: Odstopanje[]) =>
    setIzbrane((prej) => {
      const nov = new Set(prej);
      const vseIzbrane = vrstice.every((v) => nov.has(v.prejemnica_id));
      for (const v of vrstice) {
        if (vseIzbrane) nov.delete(v.prejemnica_id);
        else nov.add(v.prejemnica_id);
      }
      return nov;
    });

  return (
    <div className="mx-auto max-w-6xl p-6">

      <header className="mb-5">
        <h1 className="text-xl font-semibold">Odstopanja nabavnih cen</h1>
        <p className="mt-1 text-sm text-neutral-600">
          Primerjava cene na prejemnici z zadnjo znano nabavno ceno pri
          istem dobavitelju. Primerjava je vedno <strong>na enoto</strong>,
          nikoli na paket.
        </p>
      </header>

      {/* filtri */}
      <div className="mb-4 flex flex-wrap items-end gap-3 rounded-lg border bg-neutral-50 p-3">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-neutral-600">Od</span>
          <input type="date" value={l.obdobjeOd}
                 onChange={(e) => l.onObdobje(e.target.value, l.obdobjeDo)}
                 className="rounded border px-2 py-1 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-neutral-600">Do</span>
          <input type="date" value={l.obdobjeDo}
                 onChange={(e) => l.onObdobje(l.obdobjeOd, e.target.value)}
                 className="rounded border px-2 py-1 text-sm" />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-neutral-600">Najmanjše odstopanje</span>
          <select value={prag}
                  onChange={(e) => { setPrag(Number(e.target.value));
                                     l.onPragSpremenjen(Number(e.target.value)); }}
                  className="rounded border px-2 py-1 text-sm">
            {[1, 5, 10, 20, 50].map((p) => <option key={p} value={p}>{p} %</option>)}
          </select>
        </label>

        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={samoPakiranje}
                 onChange={(e) => setSamoPakiranje(e.target.checked)}
                 className="accent-orange-600" />
          Samo skrite podražitve prek pakiranja
          {skritih > 0 && (
            <span className="rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">
              {skritih}
            </span>
          )}
        </label>
      </div>

      {/* povzetek */}
      <div className="mb-5 grid grid-cols-3 gap-3">
        <Kartica oznaka="Skupni učinek"
                 vrednost={`${st(l.skupniUcinek)} €`}
                 poudarek={Number(l.skupniUcinek) > 0} />
        <Kartica oznaka="Št. postavk" vrednost={String(vidna.length)} />
        <Kartica oznaka="Št. dobaviteljev" vrednost={String(poDobaviteljih.length)} />
      </div>

      {l.nalaganje && <p className="text-sm text-neutral-500">Nalagam…</p>}

      {!l.nalaganje && vidna.length === 0 && (
        <p className="rounded-lg border bg-emerald-50 px-4 py-6 text-center text-sm text-emerald-800">
          V izbranem obdobju ni odstopanj nad {prag} %.
        </p>
      )}

      {/* po dobaviteljih */}
      {poDobaviteljih.map((d) => (
        <section key={d.id} className="mb-6 overflow-hidden rounded-lg border">
          <header className="flex items-center justify-between bg-neutral-50 px-4 py-2">
            <div className="flex items-center gap-3">
              <input type="checkbox" className="accent-orange-600"
                     checked={d.vrstice.every((v) => izbrane.has(v.prejemnica_id))}
                     onChange={() => preklopiSkupino(d.vrstice)} />
              <h2 className="font-medium">{d.naziv}</h2>
              <span className="text-sm text-neutral-500">
                št. postavk: {d.vrstice.length}
              </span>
            </div>
            <div className="flex items-center gap-3">
              <span className={`text-sm font-medium ${d.ucinek > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                {st(String(d.ucinek))} €
              </span>
              <button
                onClick={() => l.onReklamacija(d.id, d.vrstice.map((v) => v.prejemnica_id))}
                className="rounded bg-orange-600 px-3 py-1 text-sm text-white hover:bg-orange-700">
                Pripravi reklamacijo
              </button>
            </div>
          </header>

          <table className="min-w-full text-sm">
            <thead className="bg-white text-xs text-neutral-500">
              <tr>
                <th className="w-8 border-b px-2 py-1.5"></th>
                <th className="border-b px-2 py-1.5 text-left">Artikel</th>
                <th className="border-b px-2 py-1.5 text-left">Prevzem</th>
                <th className="border-b px-2 py-1.5 text-right">Prej €/enoto</th>
                <th className="border-b px-2 py-1.5 text-right">Zdaj €/enoto</th>
                <th className="border-b px-2 py-1.5 text-right">Razlika</th>
                <th className="border-b px-2 py-1.5 text-right">Učinek</th>
              </tr>
            </thead>
            <tbody>
              {d.vrstice.map((o, i) => {
                const skrito = skritoVPakiranju(o);
                const rast = Number(o.odstopanje_odst ?? 0) > 0;
                return (
                  <tr key={`${o.prejemnica_id}-${i}`}
                      className={skrito ? 'bg-amber-50/60' : undefined}>
                    <td className="border-b px-2 py-1.5">
                      <input type="checkbox" className="accent-orange-600"
                             checked={izbrane.has(o.prejemnica_id)}
                             onChange={() => preklopi(o.prejemnica_id)} />
                    </td>
                    <td className="border-b px-2 py-1.5">
                      <div>{o.artikel}</div>
                      {skrito && (
                        // Ta primer je treba razložiti: cena paketa je
                        // nespremenjena, zato podražitve na računu ni videti.
                        <div className="mt-0.5 text-xs text-amber-800">
                          Pakiranje {st(o.prejsnje_pakiranje, 0)} → {st(o.novo_pakiranje, 0)},
                          cena paketa nespremenjena
                          {o.cena_paket && <> ({st(o.cena_paket)} €)</>}.
                          Na računu te podražitve ni videti.
                        </div>
                      )}
                      {o.pakiranje_spremenjeno && !skrito && (
                        <div className="mt-0.5 text-xs text-neutral-500">
                          Pakiranje {st(o.prejsnje_pakiranje, 0)} → {st(o.novo_pakiranje, 0)}
                          {' '}in hkrati spremenjena cena paketa.
                        </div>
                      )}
                      {o.sifra_dobavitelja && (
                        <div className="text-xs text-neutral-400">
                          šifra {o.sifra_dobavitelja}
                        </div>
                      )}
                    </td>
                    <td className="border-b px-2 py-1.5">
                      <button onClick={() => l.onOdpriPrejemnico(o.prejemnica_id)}
                              className="text-orange-700 hover:underline">
                        {o.stevilka}
                      </button>
                      <div className="text-xs text-neutral-500">
                        {datum(o.datum)}
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
                                    ${Number(o.financni_ucinek) > 0 ? 'text-red-700' : 'text-emerald-700'}`}>
                      {st(o.financni_ucinek)} €
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </section>
      ))}

      {skritih > 0 && !samoPakiranje && (
        <aside className="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Št. skritih podražitev prek pakiranja: {skritih}.</strong>{' '}
          Pri teh postavkah je cena paketa nespremenjena, zmanjšalo pa se je
          število enot v njem. Na računu ni videti ničesar — razliko pokaže
          šele preračun na enoto.
        </aside>
      )}
    </div>
  );
}

function Kartica(p: { oznaka: string; vrednost: string; poudarek?: boolean }) {
  return (
    <div className="rounded-lg border bg-white p-4">
      <p className="text-xs text-neutral-500">{p.oznaka}</p>
      <p className={`mt-1 text-2xl font-semibold tabular-nums
                     ${p.poudarek ? 'text-red-700' : ''}`}>
        {p.vrednost}
      </p>
    </div>
  );
}
