/**
 * Z-poročilo — tipi in print formatter.
 * Razširja X-poročilo z GT, FURS statistiko, darilnimi boni, SŠP.
 */

import { formatXPorociloPrintLines, type XPorociloPromet, type XPorociloStanje, type XPorociloPremik } from "./xPorocilo";

export interface ZPorociloSnapshot {
  id: number;
  blagajnaId: number;
  poslovniDatum: string;
  zStevilka: number;
  zakljucenOb: string;
  zakljucilUporabnik: string;
  grandTotalPrej: number;
  grandTotalNov: number;
  prometDneva: number;
  skupajPromet: number;
  skupajDdv: number;
  steviloRacunov: number;
  odZap: string | null;
  doZap: string | null;
  gotovina: number;
  kartica: number;
  znesekNapitnina: number;
  sumup: number;
  bon: number;
  bonPica: number;
  steviloBonov: number;
  negotovinsko: number;
  reprezentanca: number;
  lastnaPoraba: number;
  ddvPoStopnjah: { stopnja: number; ddvZnesek: number; osnova: number }[];
  menjalniDenar: number;
  gotovinskaProdaja: number;
  pologiGotovine: number;
  izplacilaJobaviteljem: number;
  pologiTrr: number;
  stanjeBlagajne: number;
  darilniBoniIzdaja: number;
  darilniBoniUnovcitev: number;
  sspSubvencija: number;
  fursPotrjeni: number;
  fursNepotrjeni: number;
  odklenjenOb: string | null;
}

export function formatZPorociloPrintLines(input: {
  width: number;
  datum: string;
  printedAt: string;
  z: ZPorociloSnapshot;
  promet: XPorociloPromet;
  stanje: XPorociloStanje;
  premiki: XPorociloPremik[];
  podjetje?: { naziv: string; naslov: string; davcnaStevilka: string };
}): string[] {
  const { width, datum, printedAt, z, promet, stanje, premiki, podjetje } = input;
  const eur = (value: number) => `${value < 0 ? "-" : " "}${Math.abs(value).toFixed(2)} EUR`;
  const row = (label: string, value: string) =>
    `${label}${" ".repeat(Math.max(1, width - label.length - value.length))}${value}`;
  const separator = "-".repeat(width);
  const ddvRows = z.ddvPoStopnjah.flatMap((item) => {
    const label = `DDV ${item.stopnja.toFixed(1).replace(".", ",")}%`;
    return [row(`${label} osnova:`, eur(item.osnova)), row(`${label} DDV:`, eur(item.ddvZnesek))];
  });

  // X-poročilo sekcije (kloniramo formatXPorociloPrintLines rezultat brez glave)
  const xLinije = formatXPorociloPrintLines({ width, datum, printedAt, promet, stanje, premiki });
  // Zamenjamo "X-POROČILO" z "Z-POROČILO" in dodamo Z specifične sekcije
  const brezGlave = xLinije.findIndex(l => l === "X-POROCILO" || l === "X-POROČILO");
  const xTelo = brezGlave >= 0 ? xLinije.slice(brezGlave + 1) : xLinije;

  return [
    ...(podjetje?.naziv ? [podjetje.naziv] : []),
    ...(podjetje?.naslov ? [podjetje.naslov] : []),
    ...(podjetje?.davcnaStevilka ? [`ID DDV:${podjetje.davcnaStevilka}`] : []),
    separator,
    "Z-POROCILO (DNEVNI ZAKLJUCEK)",
    row("Poslovni dan:", datum),
    row("Natisnjeno:", printedAt),
    separator,
    // ── Grand Total ──────────────────────────────────────────
    row("Z-stevilka:", String(z.zStevilka)),
    row("Grand Total prej:", eur(z.grandTotalPrej)),
    row("Promet dneva:", eur(z.prometDneva)),
    row("Grand Total nov:", eur(z.grandTotalNov)),
    separator,
    // ── Skupni promet in placila ─────────────────────────────
    ...xTelo,
    // ── Darilni boni ─────────────────────────────────────────
    ...((z.darilniBoniIzdaja > 0 || z.darilniBoniUnovcitev > 0)
      ? [
        separator,
        "DARILNI BONI",
        row("Izdaja bonov:", eur(z.darilniBoniIzdaja)),
        row("Unovcitev bonov:", eur(z.darilniBoniUnovcitev)),
      ]
      : []),
    // ── SSP subvencija ────────────────────────────────────────
    ...(z.sspSubvencija > 0
      ? [
        separator,
        "STUDENTSKA SUBVENCIJA",
        row("SSP (ZRSZ):", eur(z.sspSubvencija)),
      ]
      : []),
    // ── FURS statistika ───────────────────────────────────────
    separator,
    "FURS POTRDITVE",
    row("Potrjeni racuni:", String(z.fursPotrjeni)),
    ...(z.fursNepotrjeni > 0 ? [row("! Nepotrjeni:", String(z.fursNepotrjeni))] : []),
    // ── DDV po stopnjah ───────────────────────────────────────
    ...(ddvRows.length > 0 ? [separator, "DDV PO STOPNJAH", ...ddvRows] : []),
    separator,
    "ZAKLENJENI ZAKLJUCEK",
    row("Cas:", new Date(z.zakljucenOb).toLocaleString("sl-SI", { timeZone: "Europe/Ljubljana", hour12: false })),
    row("Blagajna ID:", String(z.blagajnaId)),
    separator,
  ];
}
