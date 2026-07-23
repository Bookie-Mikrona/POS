import React, { useState, useRef } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Printer, Search, FileText, List, AlignJustify } from "lucide-react";

import { useToast } from "@/hooks/use-toast";
import { getEnotaId } from "@workspace/api-client-react";

interface DdvStopnja {
  stopnja: number;
  osnova: number;
  ddv: number;
  vrsta?: "blago" | "storitev";
}

interface RealizacijaRacun {
  id: number;
  stevilkaRacuna: string;
  ustvarjeno: string;
  natakarIme: string | null;
  placilnaNacin: string;
  osnova: number;
  ddv: number;
  skupaj: number;
  gotovina: number;
  kartica: number;
  bon: number;
  bonPica: number;
  reprezentanca: number;
  lastna_poraba: number;
  steviloBonov: number | null;
  izdaniKuponi: number;
  prejetiKuponi: number;
  jeStorno: boolean;
  status: string;
  ddvPoStopnjah: DdvStopnja[];
}

interface ArtikelZbir {
  ime: string;
  enota: string;
  kolicina: number;
  ddvStopnja: number;
  vrsta?: "blago" | "storitev";
  skupaj: number;
  osnova: number;
  ddv: number;
}

interface RealizacijaData {
  racuni: RealizacijaRacun[];
  zacetekUra: string;
  skupaj: {
    osnova: number; ddv: number; skupaj: number;
    gotovina: number; kartica: number; bon: number; bonPica: number;
    reprezentanca: number; lastna_poraba: number;
    izdaniKuponi: number; prejetiKuponi: number;
  };
  ddvPoStopnjah: DdvStopnja[];
  artikli?: ArtikelZbir[];
  podjetje: { naziv: string; naslov: string; davcnaStevilka: string };
}

const LJ = "Europe/Ljubljana";

function datumSlo(iso: string) {
  return new Date(iso).toLocaleDateString("sl-SI", { timeZone: LJ, day: "2-digit", month: "2-digit", year: "numeric" });
}
function casSlO(iso: string) {
  return new Date(iso).toLocaleTimeString("sl-SI", { timeZone: LJ, hour: "2-digit", minute: "2-digit" });
}
function eur(n: number) {
  return n !== 0 ? n.toFixed(2) : "";
}
function eurSkupaj(n: number) {
  return n.toFixed(2);
}
function fmtStopnja(s: number) {
  return s % 1 === 0 ? `${s} %` : `${s.toFixed(1).replace(".", ",")} %`;
}

function poslovniDatum(iso: string, zacetekUra = "04:00"): string {
  const [hStr, mStr] = zacetekUra.split(":");
  const h = parseInt(hStr ?? "4", 10);
  const m = parseInt(mStr ?? "0", 10);
  const d = new Date(iso);
  const dateLJ = d.toLocaleDateString("sv-SE", { timeZone: LJ });
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: LJ, hour: "2-digit", minute: "2-digit", hour12: false }).formatToParts(d);
  const hLJ = parseInt(parts.find(p => p.type === "hour")?.value ?? "0", 10);
  const mLJ = parseInt(parts.find(p => p.type === "minute")?.value ?? "0", 10);
  const afterCutoff = hLJ > h || (hLJ === h && mLJ >= m);
  const targetDate = afterCutoff ? new Date(dateLJ + "T12:00:00Z") : (() => { const pd = new Date(dateLJ + "T12:00:00Z"); pd.setUTCDate(pd.getUTCDate() - 1); return pd; })();
  return targetDate.toLocaleDateString("sl-SI", { timeZone: LJ, day: "2-digit", month: "2-digit", year: "numeric" });
}

function groupByDate(racuni: RealizacijaRacun[], zacetekUra: string) {
  const map = new Map<string, RealizacijaRacun[]>();
  for (const r of racuni) {
    const d = poslovniDatum(r.ustvarjeno, zacetekUra);
    if (!map.has(d)) map.set(d, []);
    map.get(d)!.push(r);
  }
  return [...map.entries()].map(([datum, rows]) => ({ datum, rows }));
}

function dayTotal(rows: RealizacijaRacun[]) {
  return rows.reduce((a, r) => ({
    skupaj: a.skupaj + r.skupaj,
    gotovina: a.gotovina + r.gotovina, kartica: a.kartica + r.kartica,
    bon: a.bon + r.bon, bonPica: a.bonPica + r.bonPica,
    reprezentanca: a.reprezentanca + r.reprezentanca,
    lastna_poraba: a.lastna_poraba + r.lastna_poraba,
    izdaniKuponi: a.izdaniKuponi + r.izdaniKuponi,
    prejetiKuponi: a.prejetiKuponi + r.prejetiKuponi,
  }), { skupaj: 0, gotovina: 0, kartica: 0, bon: 0, bonPica: 0, reprezentanca: 0, lastna_poraba: 0, izdaniKuponi: 0, prejetiKuponi: 0 });
}


const MESECI_SLO = ["januar","februar","marec","april","maj","junij","julij","avgust","september","oktober","november","december"];

function mesecIzDatuma(datum: string): { kljuc: string; label: string } {
  // datum format: "01. 06. 2026"
  const parts = datum.split(". ");
  const mm = parts[1] ?? "01";
  const yyyy = parts[2] ?? "";
  const m = parseInt(mm, 10);
  return { kljuc: `${mm}.${yyyy}`, label: `${MESECI_SLO[m - 1] ?? mm} ${yyyy}` };
}

function groupByMesec(grps: { datum: string; rows: RealizacijaRacun[] }[]) {
  const map = new Map<string, { label: string; dayGroups: { datum: string; rows: RealizacijaRacun[] }[] }>();
  for (const g of grps) {
    const { kljuc, label } = mesecIzDatuma(g.datum);
    if (!map.has(kljuc)) map.set(kljuc, { label, dayGroups: [] });
    map.get(kljuc)!.dayGroups.push(g);
  }
  return [...map.values()];
}

const COL_CLASS = "px-1 py-0.5 text-right tabular-nums";
const COL_LEFT = "px-1 py-0.5 text-left";

const COLS = 30;

function sep(znak = "=") { return znak.repeat(COLS); }
function lr(levo: string, desno: string) {
  const skupaj = levo.length + desno.length;
  if (skupaj >= COLS) return levo.slice(0, COLS - desno.length - 1) + " " + desno;
  return levo + " ".repeat(COLS - skupaj) + desno;
}
function center(s: string) {
  const pad = Math.max(0, Math.floor((COLS - s.length) / 2));
  return " ".repeat(pad) + s;
}
function eur2(n: number) { return n.toFixed(2); }
function fmtSt(s: number) { return s % 1 === 0 ? `${s}%` : `${s.toFixed(1).replace(".", ",")}%`; }

function generirajPrometLinije(
  data: RealizacijaData,
  zbirPoDnevih: boolean,
  od: string,
  doParam: string,
): string[] {
  const groups = groupByDate(data.racuni, data.zacetekUra);
  const monthGroups = groupByMesec(groups);
  const showMonthly = monthGroups.length > 1;
  const hasBonPica = data.skupaj.bonPica > 0;
  const hasKuponi = data.skupaj.izdaniKuponi > 0 || data.skupaj.prejetiKuponi > 0;

  const vrstice: string[] = [];

  vrstice.push(sep("="));
  vrstice.push(center("REALIZACIJA" + (zbirPoDnevih ? " - ZBIR" : "")));
  vrstice.push(center(`${datumSlo(new Date(od).toISOString())} - ${datumSlo(new Date(doParam).toISOString())}`));
  if (data.podjetje.naziv) vrstice.push(center(data.podjetje.naziv.slice(0, COLS)));
  vrstice.push(sep("="));

  if (data.racuni.length === 0) {
    vrstice.push("Ni računov v izbranem obdobju.");
    vrstice.push(sep("="));
    return vrstice;
  }

  if (zbirPoDnevih) {
    // ── ZBIR PO DNEVIH ────────────────────────────
    vrstice.push(lr("Datum", "Rač    Skupaj"));
    vrstice.push(sep("-"));
    for (const { label, dayGroups } of monthGroups) {
      for (const { datum, rows } of dayGroups) {
        const dt = dayTotal(rows);
        const kratekDatum = datum.replace(/\. /g, ".").slice(0, 10);
        const desno = `${String(rows.length).padStart(3)}  ${eur2(dt.skupaj).padStart(7)}`;
        vrstice.push(lr(kratekDatum, desno));
      }
      if (showMonthly) {
        const allMRows = dayGroups.flatMap(g => g.rows);
        const mt = dayTotal(allMRows);
        vrstice.push(sep("-"));
        vrstice.push(lr(`Skupaj ${label}`, `${String(allMRows.length).padStart(3)}  ${eur2(mt.skupaj).padStart(7)}`));
        vrstice.push(sep("-"));
      }
    }
  } else {
    // ── PO RAČUNIH ────────────────────────────────
    for (const { label, dayGroups } of monthGroups) {
      for (const { datum, rows } of dayGroups) {
        vrstice.push("");
        vrstice.push(datum);
        vrstice.push(sep("-"));
        for (const r of rows) {
          const seq = r.stevilkaRacuna.split("-").pop() ?? r.stevilkaRacuna;
          const cas = casSlO(r.ustvarjeno);
          const zn = (r.jeStorno ? "-" : "") + eur2(r.skupaj);
          vrstice.push(lr(`${seq} ${cas}`, zn));
        }
        const dt = dayTotal(rows);
        vrstice.push(sep("-"));
        vrstice.push(lr(`Skupaj ${rows.length} rač.:`, eur2(dt.skupaj)));
        if (dt.gotovina) vrstice.push(lr("  Gotovina:", eur2(dt.gotovina)));
        if (dt.kartica) vrstice.push(lr("  Kartica:", eur2(dt.kartica)));
        if (dt.bon) vrstice.push(lr("  Bon:", eur2(dt.bon)));
        if (hasBonPica && dt.bonPica) vrstice.push(lr("  Bon pica:", eur2(dt.bonPica)));
        if (dt.reprezentanca) vrstice.push(lr("  Reprezentanca:", eur2(dt.reprezentanca)));
        if (dt.lastna_poraba) vrstice.push(lr("  Lastna poraba:", eur2(dt.lastna_poraba)));
      }
      if (showMonthly) {
        const allMRows = dayGroups.flatMap(g => g.rows);
        const mt = dayTotal(allMRows);
        vrstice.push(sep("="));
        vrstice.push(lr(`SKUPAJ ${label}:`, eur2(mt.skupaj)));
        vrstice.push(`  (${allMRows.length} računov)`);
      }
    }
  }

  // ── SKUPAJ ────────────────────────────────────
  vrstice.push(sep("="));
  vrstice.push(lr(`SKUPAJ ${data.racuni.length} računov:`, eur2(data.skupaj.skupaj)));
  vrstice.push(sep("-"));
  if (data.skupaj.gotovina) vrstice.push(lr("Gotovina:", eur2(data.skupaj.gotovina)));
  if (data.skupaj.kartica) vrstice.push(lr("Kartica:", eur2(data.skupaj.kartica)));
  if (data.skupaj.bon) vrstice.push(lr("Bon:", eur2(data.skupaj.bon)));
  if (hasBonPica && data.skupaj.bonPica) vrstice.push(lr("Bon pica:", eur2(data.skupaj.bonPica)));
  if (data.skupaj.reprezentanca) vrstice.push(lr("Reprezentanca:", eur2(data.skupaj.reprezentanca)));
  if (data.skupaj.lastna_poraba) vrstice.push(lr("Lastna poraba:", eur2(data.skupaj.lastna_poraba)));
  if (hasKuponi && data.skupaj.izdaniKuponi) vrstice.push(lr("Izd. kuponi:", String(data.skupaj.izdaniKuponi)));
  if (hasKuponi && data.skupaj.prejetiKuponi) vrstice.push(lr("Prej. kuponi:", String(data.skupaj.prejetiKuponi)));

  // DDV razčlenitev po stopnjah
  const stopnje = [22, 9.5, 5];
  const ddvVrstice = stopnje.map(s => {
    const skupaj = data.ddvPoStopnjah.filter(d => d.stopnja === s).reduce((a, d) => ({ osnova: a.osnova + d.osnova, ddv: a.ddv + d.ddv }), { osnova: 0, ddv: 0 });
    return { s, ...skupaj };
  }).filter(x => x.osnova > 0 || x.ddv > 0);
  if (ddvVrstice.length > 0) {
    vrstice.push(sep("-"));
    for (const { s, osnova, ddv } of ddvVrstice) {
      vrstice.push(lr(`  Osnova ${fmtSt(s)}:`, eur2(osnova)));
      vrstice.push(lr(`  DDV ${fmtSt(s)}:`, eur2(ddv)));
    }
  }

  vrstice.push(sep("="));
  return vrstice;
}

function generirajArtikliLinije(data: RealizacijaData): string[] {
  const artikli = data.artikli ?? [];
  const vrstice: string[] = [];
  vrstice.push(sep("="));
  vrstice.push(center("PRODANO PO ARTIKLIH"));
  if (data.podjetje.naziv) vrstice.push(center(data.podjetje.naziv.slice(0, COLS)));
  vrstice.push(sep("="));
  vrstice.push(lr("Artikel", "Kol    Skupaj"));
  vrstice.push(sep("-"));
  let skupajVsota = 0;
  let skupajOsnova = 0;
  let skupajDdvZnesek = 0;
  for (const a of artikli) {
    const desno = `${String(Math.round(a.kolicina)).padStart(3)}  ${eur2(a.skupaj).padStart(7)}`;
    const ddvLabel = a.ddvStopnja != null ? ` (${fmtSt(a.ddvStopnja)})` : "";
    const imeZDdv = a.ime + ddvLabel;
    const ime = imeZDdv.length > COLS - desno.length - 1 ? imeZDdv.slice(0, COLS - desno.length - 2) + "…" : imeZDdv;
    vrstice.push(lr(ime, desno));
    skupajVsota += a.skupaj;
    skupajOsnova += a.osnova ?? 0;
    skupajDdvZnesek += a.ddv ?? 0;
  }
  vrstice.push(sep("-"));
  vrstice.push(lr("SKUPAJ:", eur2(skupajVsota)));
  vrstice.push(lr("  Osnova:", eur2(skupajOsnova)));
  vrstice.push(lr("  DDV:", eur2(skupajDdvZnesek)));
  vrstice.push(sep("="));
  return vrstice;
}

export default function Realizacija() {
  const today = new Date().toISOString().slice(0, 10);
  const [od, setOd] = useState(today);
  const [doParam, setDoParam] = useState(today);
  const [data, setData] = useState<RealizacijaData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [zbirPoDnevih, setZbirPoDnevih] = useState(false);
  const [tiskanje, setTiskanje] = useState(false);
  const printRef = useRef<HTMLDivElement>(null);
  const artikliRef = useRef<HTMLDivElement>(null);
  const { toast } = useToast();

  async function naloziPodatke() {
    setLoading(true); setError(null);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const enotaId = getEnotaId();
      const headers: Record<string, string> = {};
      if (enotaId) headers["X-Enota-Id"] = enotaId;
      const r = await fetch(`${base}/api/statistike/realizacija?od=${od}&do=${doParam}`, { credentials: "include", headers });
      if (!r.ok) { const e = await r.json().catch(() => ({})); throw new Error((e as { error?: string }).error ?? r.statusText); }
      setData(await r.json());
    } catch (e) {
      setError(e instanceof Error ? e.message : "Napaka pri nalaganju");
    } finally {
      setLoading(false);
    }
  }

  function tiskajElement(el: HTMLDivElement | null, naslov: string) {
    if (!el) return;

    const stilId = "__pos_print_style__";
    document.getElementById(stilId)?.remove();
    const stil = document.createElement("style");
    stil.id = stilId;
    stil.textContent = `
      @page { size: A4 landscape; margin: 1cm; }
      @media print {
        body > * { display: none !important; }
        #__pos_print_root__ { display: block !important; }
      }
      #__pos_print_root__ {
        display: none;
        font-family: Arial, Helvetica, sans-serif;
        font-size: 9px;
        color: #000;
      }
      #__pos_print_root__ table { border-collapse: collapse; width: 100%; }
      #__pos_print_root__ th, #__pos_print_root__ td { padding: 2px 5px; border: 1px solid #ccc; white-space: nowrap; }
      #__pos_print_root__ th { background: #eee; font-weight: bold; }
      #__pos_print_root__ .text-right { text-align: right; }
      #__pos_print_root__ .text-left { text-align: left; }
      #__pos_print_root__ .font-bold, #__pos_print_root__ .font-semibold, #__pos_print_root__ .font-medium { font-weight: bold; }
      #__pos_print_root__ .storno { color: #c00; }
      #__pos_print_root__ .day-subtotal { background: #f5f5f5 !important; font-weight: bold; }
      #__pos_print_root__ .grand-total { background: #e0e0e0 !important; font-weight: bold; }
      #__pos_print_root__ .month-total { background: #cce4ff !important; font-weight: bold; }
      #__pos_print_root__ .tabular-nums { font-variant-numeric: tabular-nums; }
      #__pos_print_root__ .no-print { display: none !important; }
    `;
    document.head.appendChild(stil);

    let wrapper = document.getElementById("__pos_print_root__") as HTMLElement | null;
    if (!wrapper) {
      wrapper = document.createElement("div");
      wrapper.id = "__pos_print_root__";
      document.body.appendChild(wrapper);
    }
    wrapper.innerHTML = `<h2 style="font-size:10px;margin:0 0 6px 0;">${naslov}</h2>` + el.innerHTML;

    // Izmeri dejansko širino vsebine (začasno prikaži izven zaslona)
    wrapper.style.cssText = "display:block;visibility:hidden;position:fixed;top:-9999px;left:-9999px;";
    const A4_LANDSCAPE_PX = 277 * 3.7795; // 277mm pri 96 dpi ≈ 1047px
    const dejanskaSirina = wrapper.scrollWidth;
    wrapper.style.cssText = "";

    // Prilagodi zoom da vsebina ustreza A4 ležeče
    const zoom = dejanskaSirina > A4_LANDSCAPE_PX ? A4_LANDSCAPE_PX / dejanskaSirina : 1;
    (wrapper as HTMLElement & { style: CSSStyleDeclaration }).style.zoom = zoom.toFixed(4);

    window.print();

    setTimeout(() => {
      stil.remove();
      if (wrapper) {
        wrapper.innerHTML = "";
        (wrapper as HTMLElement & { style: CSSStyleDeclaration }).style.zoom = "";
      }
    }, 1000);
  }

  function natisni() {
    if (!data) return;
    tiskajElement(printRef.current, "Realizacija");
  }

  function natisniArtikle() {
    if (!data) return;
    tiskajElement(artikliRef.current, "Realizacija po artiklih");
  }

  const groups = data ? groupByDate(data.racuni, data.zacetekUra) : [];
  const monthGroups = groupByMesec(groups);
  const showMonthlyTotals = monthGroups.length > 1;
  const hasBonPica = data ? data.skupaj.bonPica > 0 : false;
  const hasReprezentanca = data ? data.racuni.some(r => r.placilnaNacin === "reprezentanca") : false;
  const hasLastnaPoraba = data ? data.racuni.some(r => r.placilnaNacin === "lastna_poraba") : false;
  const TH = `${COL_CLASS} font-semibold whitespace-nowrap`;
  const skupajTh = <th className={TH}>Skupaj</th>;
  const hasKuponi = data ? (data.skupaj.izdaniKuponi > 0 || data.skupaj.prejetiKuponi > 0) : false;
  const has22 = data ? data.ddvPoStopnjah.some(d => d.stopnja === 22) : false;
  const has95 = data ? data.ddvPoStopnjah.some(d => d.stopnja === 9.5) : false;
  const has5  = data ? data.ddvPoStopnjah.some(d => d.stopnja === 5) : false;
  const ddvTh = (
    <>
      {has22 && <><th className={TH}>Osn. 22%</th><th className={TH}>DDV 22%</th></>}
      {has95 && <><th className={TH}>Osn. 9,5%</th><th className={TH}>DDV 9,5%</th></>}
      {has5  && <><th className={TH}>Osn. 5%</th><th className={TH}>DDV 5%</th></>}
    </>
  );
  const blagoStoritevTh = (
    <>
      <th className={TH}>Blago</th>
      <th className={TH}>Storitev</th>
    </>
  );
  const placilniTh = (
    <>
      <th className={TH}>Gotovina</th>
      <th className={TH}>Kartica</th>
      {hasLastnaPoraba && <th className={TH}>L. raba</th>}
      {hasReprezentanca && <th className={TH}>Repr.</th>}
      <th className={TH}>D. bon</th>
      {hasBonPica && <th className={TH}>Bon 🍕</th>}
      {hasKuponi && <th className={TH}>Kup.↑</th>}
      {hasKuponi && <th className={TH}>Kup.↓</th>}
    </>
  );

  function skupajTd(n: number, bold = false) {
    return <td className={`${COL_CLASS}${bold ? " font-bold" : " font-medium"}`}>{eurSkupaj(n)}</td>;
  }

  function sumDdv(entries: DdvStopnja[], stopnja: number) {
    return entries.filter(e => e.stopnja === stopnja).reduce((a, e) => ({ osnova: a.osnova + e.osnova, ddv: a.ddv + e.ddv }), { osnova: 0, ddv: 0 });
  }

  function ddvTd(entries: DdvStopnja[]) {
    const v22 = sumDdv(entries, 22);
    const v95 = sumDdv(entries, 9.5);
    const v5  = sumDdv(entries, 5);
    return (
      <>
        {has22 && <><td className={COL_CLASS}>{eurSkupaj(v22.osnova)}</td><td className={COL_CLASS}>{eurSkupaj(v22.ddv)}</td></>}
        {has95 && <><td className={COL_CLASS}>{eurSkupaj(v95.osnova)}</td><td className={COL_CLASS}>{eurSkupaj(v95.ddv)}</td></>}
        {has5  && <><td className={COL_CLASS}>{eurSkupaj(v5.osnova)}</td><td className={COL_CLASS}>{eurSkupaj(v5.ddv)}</td></>}
      </>
    );
  }

  function blagoStoritevRacun(r: RealizacijaRacun) {
    if (r.placilnaNacin === "lastna_poraba" || r.placilnaNacin === "reprezentanca")
      return { blago: 0, storitev: 0 };
    const blago = r.ddvPoStopnjah.filter(d => d.vrsta === "blago").reduce((a, d) => a + d.osnova + d.ddv, 0);
    const storitev = r.ddvPoStopnjah.filter(d => d.vrsta === "storitev").reduce((a, d) => a + d.osnova + d.ddv, 0);
    return { blago, storitev };
  }

  function sumBS(rows: RealizacijaRacun[]) {
    return rows.reduce((a, r) => {
      const bs = blagoStoritevRacun(r);
      return { blago: a.blago + bs.blago, storitev: a.storitev + bs.storitev };
    }, { blago: 0, storitev: 0 });
  }

  function blagoStoritevTd(bs: { blago: number; storitev: number }) {
    return (
      <>
        <td className={COL_CLASS}>{eurSkupaj(bs.blago)}</td>
        <td className={COL_CLASS}>{eurSkupaj(bs.storitev)}</td>
      </>
    );
  }

  function placilniTd(dt: { gotovina: number; kartica: number; bon: number; bonPica: number; reprezentanca: number; lastna_poraba: number; izdaniKuponi: number; prejetiKuponi: number }) {
    return (
      <>
        <td className={COL_CLASS}>{eurSkupaj(dt.gotovina)}</td>
        <td className={COL_CLASS}>{eurSkupaj(dt.kartica)}</td>
        {hasLastnaPoraba && <td className={COL_CLASS}>{eurSkupaj(dt.lastna_poraba)}</td>}
        {hasReprezentanca && <td className={COL_CLASS}>{eurSkupaj(dt.reprezentanca)}</td>}
        <td className={COL_CLASS}>{eurSkupaj(dt.bon)}</td>
        {hasBonPica && <td className={COL_CLASS}>{eurSkupaj(dt.bonPica)}</td>}
        {hasKuponi && <td className={COL_CLASS}>{dt.izdaniKuponi > 0 ? dt.izdaniKuponi : ""}</td>}
        {hasKuponi && <td className={COL_CLASS}>{dt.prejetiKuponi > 0 ? dt.prejetiKuponi : ""}</td>}
      </>
    );
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Toolbar */}
      <div className="flex items-end gap-4 px-6 py-4 border-b bg-background shrink-0 flex-wrap">
        <div className="flex items-center gap-2">
          <FileText className="h-5 w-5 text-primary" />
          <h1 className="text-xl font-bold">Realizacija</h1>
        </div>
        <div className="flex items-end gap-3 ml-2 flex-wrap">
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Od</Label>
            <Input type="date" value={od} onChange={e => setOd(e.target.value)} className="w-36 h-8 text-sm" />
          </div>
          <div className="flex flex-col gap-1">
            <Label className="text-xs text-muted-foreground">Do</Label>
            <Input type="date" value={doParam} onChange={e => setDoParam(e.target.value)} className="w-36 h-8 text-sm" />
          </div>
          <Button onClick={naloziPodatke} disabled={loading} size="sm" className="h-8">
            <Search className="h-4 w-4 mr-1" />
            Prikaži
          </Button>
          {data && (
            <>
              <Button
                onClick={() => setZbirPoDnevih(v => !v)}
                variant={zbirPoDnevih ? "default" : "outline"}
                size="sm"
                className="h-8"
              >
                {zbirPoDnevih ? <List className="h-4 w-4 mr-1" /> : <AlignJustify className="h-4 w-4 mr-1" />}
                {zbirPoDnevih ? "Po računih" : "Zbir po dnevih"}
              </Button>
              <Button onClick={natisni} variant="outline" size="sm" className="h-8" disabled={tiskanje}>
                <Printer className="h-4 w-4 mr-1" />
                {tiskanje ? "Tiskanje…" : "Natisni realizacijo"}
              </Button>
              <Button onClick={natisniArtikle} variant="outline" size="sm" className="h-8" disabled={tiskanje}>
                <Printer className="h-4 w-4 mr-1" />
                {tiskanje ? "Tiskanje…" : "Natisni po artiklih"}
              </Button>
            </>
          )}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-auto px-6 py-4">
        {loading && <Skeleton className="h-[400px] w-full" />}
        {error && <div className="text-destructive p-4">{error}</div>}
        {!loading && !error && !data && (
          <div className="text-muted-foreground text-center py-16">Izberite obdobje in kliknite Prikaži.</div>
        )}
        {data && (
          <div ref={printRef}>
            {/* Print header */}
            <div className="header mb-4 print:block">
              <div className="text-sm font-bold">{data.podjetje.naziv}</div>
              {data.podjetje.naslov && <div className="text-xs text-muted-foreground">{data.podjetje.naslov}</div>}
              {data.podjetje.davcnaStevilka && <div className="text-xs text-muted-foreground">DIŠ: {data.podjetje.davcnaStevilka}</div>}
              <div className="text-xs mt-1">
                <span className="font-semibold">REALIZACIJA{zbirPoDnevih ? " — ZBIR PO DNEVIH" : ""}</span>
                {" — Obdobje: "}{datumSlo(new Date(od).toISOString())}{" – "}{datumSlo(new Date(doParam).toISOString())}
              </div>
            </div>

            {data.racuni.length === 0 ? (
              <div className="text-muted-foreground text-center py-8">Ni računov v izbranem obdobju.</div>
            ) : (
              <div className="overflow-x-auto">
                {zbirPoDnevih ? (
                  /* ── ZBIR PO DNEVIH ─────────────────────────────── */
                  <table className="w-full text-[10px] border-collapse">
                    <thead>
                      <tr className="bg-muted/60 border-b-2 border-border">
                        <th className={`${COL_LEFT} font-semibold whitespace-nowrap`}>Datum</th>
                        <th className={`${COL_CLASS} font-semibold`}>Rač.</th>
                        <th className={`${COL_LEFT} font-semibold whitespace-nowrap`}>Od – Do</th>
                        {skupajTh}
                        {blagoStoritevTh}
                        {ddvTh}
                        {placilniTh}
                      </tr>
                    </thead>
                    <tbody>
                      {monthGroups.map(({ label, dayGroups }) => {
                        const allMRows = dayGroups.flatMap(g => g.rows);
                        const mt = dayTotal(allMRows);
                        return (
                          <React.Fragment key={label}>
                            {dayGroups.map(({ datum, rows }) => {
                              const dt = dayTotal(rows);
                              const rowsDdv = rows.flatMap(r => r.ddvPoStopnjah);
                              const seqSt = (s: string) => s.split("-").pop() ?? s;
                              const prvaSt = seqSt(rows[0]?.stevilkaRacuna ?? "");
                              const zadnjaSt = seqSt(rows[rows.length - 1]?.stevilkaRacuna ?? "");
                              const obseg = prvaSt === zadnjaSt ? prvaSt : `${prvaSt}–${zadnjaSt}`;
                              return (
                                <tr key={datum} className="border-b border-border/40 hover:bg-muted/30">
                                  <td className={COL_LEFT}>{datum}</td>
                                  <td className={COL_CLASS}>{rows.length}</td>
                                  <td className={`${COL_LEFT} font-mono text-[10px]`}>{obseg}</td>
                                  {skupajTd(dt.skupaj)}
                                  {blagoStoritevTd(sumBS(rows))}
                                  {ddvTd(rowsDdv)}
                                  {placilniTd(dt)}
                                </tr>
                              );
                            })}
                            {showMonthlyTotals && (
                              <tr className="month-total bg-blue-100/60 border-t-2 border-blue-300/60 font-semibold">
                                <td className={COL_LEFT} colSpan={2}>
                                  <span className="uppercase tracking-wide text-blue-800">Skupaj {label}</span>
                                  <span className="ml-1 font-normal text-blue-600">({allMRows.length})</span>
                                </td>
                                <td className={COL_LEFT} />
                                {skupajTd(mt.skupaj)}
                                {blagoStoritevTd(sumBS(allMRows))}
                                {ddvTd(allMRows.flatMap(r => r.ddvPoStopnjah))}
                                {placilniTd(mt)}
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {/* Grand total */}
                      <tr className="grand-total bg-muted border-t-2 border-primary/40 font-bold">
                        <td className={COL_LEFT} colSpan={2}>
                          <span className="uppercase tracking-wide">SKUPAJ</span>
                          <span className="ml-1 font-normal text-muted-foreground">({data.racuni.length})</span>
                        </td>
                        <td className={COL_LEFT} />
                        {skupajTd(data.skupaj.skupaj, true)}
                        {blagoStoritevTd(sumBS(data.racuni))}
                        {ddvTd(data.ddvPoStopnjah)}
                        {placilniTd(data.skupaj)}
                      </tr>
                    </tbody>
                  </table>
                ) : (
                  /* ── PO RAČUNIH ─────────────────────────────────── */
                  <table className="w-full text-[10px] border-collapse">
                    <thead>
                      <tr className="bg-muted/60 border-b-2 border-border">
                        <th className={`${COL_LEFT} font-semibold whitespace-nowrap`}>Datum</th>
                        <th className={`${COL_LEFT} font-semibold`}>Ura</th>
                        <th className={`${COL_LEFT} font-semibold`}>Račun</th>
                        <th className={`${COL_LEFT} font-semibold`}>Natakar</th>
                        {skupajTh}
                        {blagoStoritevTh}
                        {ddvTh}
                        {placilniTh}
                      </tr>
                    </thead>
                    <tbody>
                      {monthGroups.map(({ label, dayGroups }) => {
                        const allMRows = dayGroups.flatMap(g => g.rows);
                        const mt = dayTotal(allMRows);
                        return (
                          <React.Fragment key={label}>
                            {dayGroups.map(({ datum, rows }) => {
                              const dt = dayTotal(rows);
                              return (
                                <React.Fragment key={datum}>
                                  {rows.map((r, i) => (
                                    <tr
                                      key={r.id}
                                      className={`border-b border-border/40 hover:bg-muted/30 ${r.jeStorno ? "line-through text-muted-foreground storno" : ""}`}
                                    >
                                      <td className={`${COL_LEFT} text-muted-foreground`}>{i === 0 ? datum : ""}</td>
                                      <td className={`${COL_LEFT} text-muted-foreground`}>{casSlO(r.ustvarjeno)}</td>
                                      <td className={COL_LEFT}>
                                        <span className="font-mono">{r.stevilkaRacuna}</span>
                                        {r.jeStorno && <span className="ml-1 text-destructive text-[10px] font-semibold">STORNO</span>}
                                      </td>
                                      <td className={`${COL_LEFT} text-muted-foreground`}>{r.natakarIme ?? "—"}</td>
                                      <td className={`${COL_CLASS} font-medium`}>{eur(r.skupaj)}</td>
                                      {blagoStoritevTd(blagoStoritevRacun(r))}
                                      {ddvTd(r.ddvPoStopnjah)}
                                      <td className={COL_CLASS}>{eur(r.gotovina)}</td>
                                      <td className={COL_CLASS}>{eur(r.kartica)}</td>
                                      {hasLastnaPoraba && <td className={COL_CLASS}>{eur(r.lastna_poraba)}</td>}
                                      {hasReprezentanca && <td className={COL_CLASS}>{eur(r.reprezentanca)}</td>}
                                      <td className={COL_CLASS}>{eur(r.bon)}</td>
                                      {hasBonPica && <td className={COL_CLASS}>{eur(r.bonPica)}</td>}
                                      {hasKuponi && <td className={COL_CLASS}>{r.izdaniKuponi > 0 ? r.izdaniKuponi : ""}</td>}
                                      {hasKuponi && <td className={COL_CLASS}>{r.prejetiKuponi > 0 ? r.prejetiKuponi : ""}</td>}
                                    </tr>
                                  ))}
                                  {/* Day subtotal */}
                                  <tr className="day-subtotal bg-muted/50 border-b-2 border-border font-semibold">
                                    <td className={COL_LEFT} colSpan={4}>
                                      <span className="text-[10px] font-bold uppercase tracking-wide text-muted-foreground">Skupaj {datum}</span>
                                      <span className="ml-2 text-muted-foreground font-normal">({rows.length})</span>
                                    </td>
                                    {skupajTd(dt.skupaj)}
                                    {blagoStoritevTd(sumBS(rows))}
                                    {ddvTd(rows.flatMap(r => r.ddvPoStopnjah))}
                                    {placilniTd(dt)}
                                  </tr>
                                </React.Fragment>
                              );
                            })}
                            {showMonthlyTotals && (
                              <tr className="month-total bg-blue-100/60 border-t-2 border-blue-300/60 font-semibold">
                                <td className={COL_LEFT} colSpan={4}>
                                  <span className="uppercase tracking-wide text-blue-800">Skupaj {label}</span>
                                  <span className="ml-1 font-normal text-blue-600">({allMRows.length})</span>
                                </td>
                                {skupajTd(mt.skupaj)}
                                {blagoStoritevTd(sumBS(allMRows))}
                                {ddvTd(allMRows.flatMap(r => r.ddvPoStopnjah))}
                                {placilniTd(mt)}
                              </tr>
                            )}
                          </React.Fragment>
                        );
                      })}
                      {/* Grand total */}
                      <tr className="grand-total bg-muted border-t-2 border-primary/40 font-bold">
                        <td className={COL_LEFT} colSpan={4}>
                          <span className="uppercase tracking-wide">SKUPAJ</span>
                          <span className="ml-1 font-normal text-muted-foreground">({data.racuni.length})</span>
                        </td>
                        {skupajTd(data.skupaj.skupaj, true)}
                        {blagoStoritevTd(sumBS(data.racuni))}
                        {ddvTd(data.ddvPoStopnjah)}
                        {placilniTd(data.skupaj)}
                      </tr>
                    </tbody>
                  </table>
                )}

                {/* Summary cards */}
                <div className="no-print mt-6 grid grid-cols-2 sm:grid-cols-4 gap-3 text-sm">
                  {[
                    { label: "Skupaj z DDV", value: data.skupaj.skupaj, bold: true },
                    { label: "Gotovina", value: data.skupaj.gotovina },
                    { label: "Kartica", value: data.skupaj.kartica },
                    { label: "Darilni bon", value: data.skupaj.bon },
                    ...(hasBonPica ? [{ label: "Bon za pico", value: data.skupaj.bonPica }] : []),
                  ].map(({ label, value, bold }) => (
                    <div key={label} className="rounded-lg border bg-card p-3">
                      <div className="text-xs text-muted-foreground">{label}</div>
                      <div className={`text-lg ${bold ? "font-bold text-primary" : "font-semibold"}`}>{value.toFixed(2)} €</div>
                    </div>
                  ))}
                </div>

                {/* Per-artikel tabela */}
                {(data.artikli ?? []).length > 0 && (() => {
                  const artList = data.artikli!;
                  // Grupiraj po (ime, ddvStopnja) — združi blago in storitev v eno vrstico
                  interface ArtGrupa {
                    ime: string; enota: string; kolicina: number;
                    blagoSkupaj: number; storitevSkupaj: number; skupaj: number;
                    ddvPoStopnjah: Map<number, { osnova: number; ddv: number }>;
                  }
                  const artMap = new Map<string, ArtGrupa>();
                  for (const a of artList) {
                    if (!artMap.has(a.ime)) artMap.set(a.ime, { ime: a.ime, enota: a.enota, kolicina: 0, blagoSkupaj: 0, storitevSkupaj: 0, skupaj: 0, ddvPoStopnjah: new Map() });
                    const g = artMap.get(a.ime)!;
                    g.kolicina += a.kolicina;
                    if (a.vrsta === "blago") g.blagoSkupaj += a.skupaj; else g.storitevSkupaj += a.skupaj;
                    g.skupaj += a.skupaj;
                    const ds = g.ddvPoStopnjah.get(a.ddvStopnja) ?? { osnova: 0, ddv: 0 };
                    ds.osnova += a.osnova; ds.ddv += a.ddv;
                    g.ddvPoStopnjah.set(a.ddvStopnja, ds);
                  }
                  const artGrupe = [...artMap.values()].sort((a, b) => a.ime.localeCompare(b.ime, "sl"));
                  const artStopnje = [...new Set(artGrupe.flatMap(a => [...a.ddvPoStopnjah.keys()]))].sort((a, b) => a - b);
                  const artSkupaj = artGrupe.reduce((acc, a) => ({ skupaj: acc.skupaj + a.skupaj, blago: acc.blago + a.blagoSkupaj, storitev: acc.storitev + a.storitevSkupaj }), { skupaj: 0, blago: 0, storitev: 0 });
                  const artDdvSkupaj = new Map<number, { osnova: number; ddv: number }>();
                  for (const g of artGrupe) for (const [s, v] of g.ddvPoStopnjah) {
                    const cur = artDdvSkupaj.get(s) ?? { osnova: 0, ddv: 0 };
                    cur.osnova += v.osnova; cur.ddv += v.ddv;
                    artDdvSkupaj.set(s, cur);
                  }
                  return (
                    <div ref={artikliRef} className="no-print mt-8 overflow-x-auto">
                      {/* Glava za izpis */}
                      <div className="header mb-3">
                        <div className="text-sm font-bold">{data.podjetje.naziv}</div>
                        {data.podjetje.naslov && <div className="text-xs text-muted-foreground">{data.podjetje.naslov}</div>}
                        {data.podjetje.davcnaStevilka && <div className="text-xs text-muted-foreground">DIŠ: {data.podjetje.davcnaStevilka}</div>}
                        <div className="text-xs mt-1">
                          <span className="font-semibold">PRODANO PO ARTIKLIH</span>
                          {" — Obdobje: "}{datumSlo(new Date(od).toISOString())}{" – "}{datumSlo(new Date(doParam).toISOString())}
                        </div>
                      </div>
                      <table className="w-full text-xs border-collapse min-w-[400px]">
                        <thead>
                          <tr className="bg-muted/60 border-b-2 border-border">
                            <th className={`${COL_LEFT} font-semibold`}>Artikel</th>
                            <th className={`${COL_CLASS} font-semibold`}>Količina</th>
                            <th className={`${COL_CLASS} font-semibold`}>Enota</th>
                            <th className={`${COL_CLASS} font-semibold`}>Skupaj</th>
                            <th className={`${COL_CLASS} font-semibold text-green-700`}>Blago</th>
                            <th className={`${COL_CLASS} font-semibold text-blue-700`}>Storitev</th>
                            {artStopnje.map(s => (
                              <React.Fragment key={s}>
                                <th className={`${COL_CLASS} font-semibold`}>Osnova {fmtStopnja(s)}</th>
                                <th className={`${COL_CLASS} font-semibold`}>DDV {fmtStopnja(s)}</th>
                              </React.Fragment>
                            ))}
                          </tr>
                        </thead>
                        <tbody>
                          {artGrupe.map((a, i) => (
                            <tr key={i} className="border-b border-border/40 hover:bg-muted/30">
                              <td className={COL_LEFT}>{a.ime}</td>
                              <td className={COL_CLASS}>{a.kolicina}</td>
                              <td className={COL_CLASS}>{a.enota}</td>
                              <td className={`${COL_CLASS} font-medium`}>{eurSkupaj(a.skupaj)}</td>
                              <td className={`${COL_CLASS} text-green-700`}>{a.blagoSkupaj > 0 ? eurSkupaj(a.blagoSkupaj) : ""}</td>
                              <td className={`${COL_CLASS} text-blue-600`}>{a.storitevSkupaj > 0 ? eurSkupaj(a.storitevSkupaj) : ""}</td>
                              {artStopnje.map(s => {
                                const v = a.ddvPoStopnjah.get(s);
                                return (
                                  <React.Fragment key={s}>
                                    <td className={COL_CLASS}>{v ? eurSkupaj(v.osnova) : ""}</td>
                                    <td className={COL_CLASS}>{v ? eurSkupaj(v.ddv) : ""}</td>
                                  </React.Fragment>
                                );
                              })}
                            </tr>
                          ))}
                          <tr className="grand-total bg-muted border-t-2 border-primary/40 font-bold">
                            <td className={COL_LEFT}>SKUPAJ</td>
                            <td className={COL_CLASS} />
                            <td className={COL_CLASS} />
                            <td className={`${COL_CLASS} font-bold`}>{eurSkupaj(artSkupaj.skupaj)}</td>
                            <td className={`${COL_CLASS} text-green-700`}>{eurSkupaj(artSkupaj.blago)}</td>
                            <td className={`${COL_CLASS} text-blue-600`}>{eurSkupaj(artSkupaj.storitev)}</td>
                            {artStopnje.map(s => {
                              const v = artDdvSkupaj.get(s) ?? { osnova: 0, ddv: 0 };
                              return (
                                <React.Fragment key={s}>
                                  <td className={COL_CLASS}>{eurSkupaj(v.osnova)}</td>
                                  <td className={COL_CLASS}>{eurSkupaj(v.ddv)}</td>
                                </React.Fragment>
                              );
                            })}
                          </tr>
                        </tbody>
                      </table>
                    </div>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
