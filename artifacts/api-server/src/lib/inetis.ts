/**
 * Skupna knjižnica za Inetis (slovensko podjetniško registrsko iskanje).
 * Uvažata jo kupec.ts (router) in uvoz-service.ts (logika uvoza).
 */

export type TrrPostavka = { iban: string; bic: string };

export interface InetisRezultat {
  naziv: string;
  kratkiNaziv: string | null;
  naslov: string | null;
  ulica: string | null;
  postnaStevilka: string | null;
  kraj: string | null;
  zavezanecDdv: boolean | null;
  davcnaStevilka: string;
  idZaDdv: string | null;
  maticnaStevilka: string | null;
  trr: TrrPostavka[] | null;
}

type InetisSuroviZadetek = {
  Naziv?: string;
  NazivKratek?: string;
  Naslov?: string;
  DavcnaStevilka?: string;
  DavcnaStevilkaKratka?: string;
  MaticnaStevilka?: string;
  ZavezanecZaDDV?: boolean;
  TransakcijskiRacuni?: Array<{ TRRSurovi?: string; Banka?: string; Zaprt?: boolean }>;
};

export function izberiNatancenInetisZadetek(
  list: InetisSuroviZadetek[],
  iskanaDavcna: string,
): InetisSuroviZadetek | null {
  const iskana = iskanaDavcna.replace(/\D/g, "");
  return list.find((zadetek) => {
    const kratka = (zadetek.DavcnaStevilkaKratka ?? "").replace(/\D/g, "");
    const polna = (zadetek.DavcnaStevilka ?? "").replace(/\D/g, "");
    return kratka === iskana || polna === iskana;
  }) ?? null;
}

export const BANCNI_BIC: Record<string, string> = {
  "NLB": "LJBASI2X",
  "Nova KBM": "KBMASI2X",
  "SKB": "SKBASI2X",
  "Addiko": "HAABSI22",
  "OTP banka": "OTPVSI2X",
  "UniCredit Banka": "BACXSI22",
  "Banka Intesa Sanpaolo": "BISISI22",
  "BKS banka": "BFKKSI22",
  "Gorenjska banka": "GBKPSI2X",
  "Delavska hranilnica": "DELAVSI2X",
  "Primorska hranilnica": "PHBPSI22",
};

export function trrSuroviVIban(trrSurovi: string): string {
  // SI IBAN: "SI" + 2 check digits + 15-digit BBAN
  const rearranged = trrSurovi + "281800";
  const mod = BigInt(rearranged) % 97n;
  const check = String(98n - mod).padStart(2, "0");
  return `SI${check}${trrSurovi}`;
}

export function razclenitNaslov(naslov: string): {
  ulica: string | null;
  postnaStevilka: string | null;
  kraj: string | null;
} {
  const idx = naslov.lastIndexOf(", ");
  if (idx === -1) return { ulica: naslov.trim() || null, postnaStevilka: null, kraj: null };
  const ulica = naslov.slice(0, idx).trim();
  const rest = naslov.slice(idx + 2).trim();
  const spaceIdx = rest.indexOf(" ");
  if (spaceIdx === -1) return { ulica: ulica || null, postnaStevilka: rest || null, kraj: null };
  return {
    ulica: ulica || null,
    postnaStevilka: rest.slice(0, spaceIdx),
    kraj: rest.slice(spaceIdx + 1).trim() || null,
  };
}

export function zaznajVrsto(
  naziv: string,
  zavezanecDdv: boolean | null,
  maticnaStevilka?: string | null,
): "obcan" | "sp" | "podjetje" | "kmet" | "javni_sektor" | null {
  if (
    /\bd\.\s*o\.\s*o\.|\bd\.\s*d\.|\bk\.\s*d\.|\bz\.\s*o\.\s*o\.|\bd\.\s*n\.\s*o\.|\be\.\s*s\.\s*p\.|\bk\.\s*d\.\s*d\.|\bs\.\s*k\.\s*e\./i.test(
      naziv,
    )
  ) return "podjetje";
  if (/\bs\.\s*p\.(\s|$|,)/i.test(naziv)) return "sp";
  if (/\bkmetij|\bkmet\b|\bkgz\b/i.test(naziv)) return "kmet";
  if (
    /\bšola\b|\bvrtec\b|\bgimnazija\b|\blicej\b|\buniverzit|\bfakultet|\binštitut\b|\bzavod\b|\bobčina\b|\bministrstvo\b|\bagencija\b|\buprava\b|\bsodišče\b|\bbolnica\b|\bdom\s+zdravja\b|\bzdravstveni\s+dom\b|\bdom\s+starejših\b|\bdom\s+upokojencev\b|\bdom\s+za\b|\bjavni\s+sklad\b|\bsvet\s+zavoda\b|\bkrajevna\s+skupnost\b|\bmestna\s+občina\b/i.test(
      naziv,
    )
  ) return "javni_sektor";
  if (maticnaStevilka?.trim()) return "podjetje";
  if (!zavezanecDdv) return "obcan";
  return null;
}

export async function poisciNaInetis(davcna: string): Promise<InetisRezultat | null> {
  try {
    const cleaned = davcna.replace(/^SI/i, "");
    const r = await fetch(
      `https://ddv.inetis.com/Ajax.aspx?a=isci&niz=${encodeURIComponent(cleaned)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) return null;
    const data = (await r.json()) as {
      status: string;
      list: InetisSuroviZadetek[] | null;
    };
    if (data.status !== "ok" || !data.list?.length) return null;
    const p = izberiNatancenInetisZadetek(data.list, cleaned);
    if (!p) return null;

    const rawNaslov = p.Naslov ?? null;
    const adresni = rawNaslov
      ? razclenitNaslov(rawNaslov)
      : { ulica: null, postnaStevilka: null, kraj: null };

    const trrji: TrrPostavka[] = (p.TransakcijskiRacuni ?? [])
      .filter((t) => !t.Zaprt && t.TRRSurovi && /^\d{15}$/.test(t.TRRSurovi))
      .map((t) => ({
        iban: trrSuroviVIban(t.TRRSurovi!),
        bic: t.Banka && BANCNI_BIC[t.Banka] ? BANCNI_BIC[t.Banka]! : "",
      }));

    return {
      naziv: p.Naziv ?? p.NazivKratek ?? "",
      kratkiNaziv: p.NazivKratek ?? null,
      naslov: rawNaslov,
      ulica: adresni.ulica,
      postnaStevilka: adresni.postnaStevilka,
      kraj: adresni.kraj,
      zavezanecDdv: p.ZavezanecZaDDV ?? null,
      davcnaStevilka: p.DavcnaStevilkaKratka ?? davcna,
      idZaDdv: p.DavcnaStevilka ?? null,
      maticnaStevilka: p.MaticnaStevilka ?? null,
      trr: trrji.length > 0 ? trrji : null,
    };
  } catch {
    return null;
  }
}

/**
 * Splošno Inetis iskanje po kateremkoli nizu (davčna, naziv, …).
 * Kliče isti Ajax.aspx endpoint kot poisciNaInetis — vrne VSE zadetke.
 * Brez SI-stripa (niz je lahko ime, ne nujno davčna).
 * Brez avtoshranjevanja.
 */
export async function poisciVInetisNiz(niz: string): Promise<InetisRezultat[]> {
  try {
    const cleaned = niz.trim();
    if (cleaned.length < 3) return [];
    const r = await fetch(
      `https://ddv.inetis.com/Ajax.aspx?a=isci&niz=${encodeURIComponent(cleaned)}`,
      { signal: AbortSignal.timeout(8000) },
    );
    if (!r.ok) return [];
    const data = (await r.json()) as {
      status: string;
      list: Array<{
        Naziv?: string;
        NazivKratek?: string;
        Naslov?: string;
        DavcnaStevilka?: string;
        DavcnaStevilkaKratka?: string;
        MaticnaStevilka?: string;
        ZavezanecZaDDV?: boolean;
        TransakcijskiRacuni?: Array<{ TRRSurovi?: string; Banka?: string; Zaprt?: boolean }>;
      }> | null;
    };
    if (data.status !== "ok" || !data.list?.length) return [];
    return data.list.map((p) => {
      const rawNaslov = p.Naslov ?? null;
      const adresni = rawNaslov
        ? razclenitNaslov(rawNaslov)
        : { ulica: null, postnaStevilka: null, kraj: null };
      const trrji: TrrPostavka[] = (p.TransakcijskiRacuni ?? [])
        .filter((t) => !t.Zaprt && t.TRRSurovi && /^\d{15}$/.test(t.TRRSurovi))
        .map((t) => ({
          iban: trrSuroviVIban(t.TRRSurovi!),
          bic: t.Banka && BANCNI_BIC[t.Banka] ? BANCNI_BIC[t.Banka]! : "",
        }));
      return {
        naziv:          p.Naziv ?? p.NazivKratek ?? "",
        kratkiNaziv:    p.NazivKratek ?? null,
        naslov:         rawNaslov,
        ulica:          adresni.ulica,
        postnaStevilka: adresni.postnaStevilka,
        kraj:           adresni.kraj,
        zavezanecDdv:   p.ZavezanecZaDDV ?? null,
        davcnaStevilka: p.DavcnaStevilkaKratka ?? "",
        idZaDdv:        p.DavcnaStevilka ?? null,
        maticnaStevilka:p.MaticnaStevilka ?? null,
        trr:            trrji.length > 0 ? trrji : null,
      } satisfies InetisRezultat;
    });
  } catch {
    return [];
  }
}
