import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { artikliTable, db, kategorijeTable, partnerCenikiTable, shranjeniKupciTable } from "@workspace/db";
import { poisciVUjp } from "../ujp";
import { poisciVAjpes } from "../ajpes";
import { preveriVies, drzavaIzKode } from "../../lib/vies.js";

/**
 * Pretvori 15-mestno slovensko TRR številko (UJP format) v IBAN.
 * Če je vrednost že v IBAN formatu (začne s "SI"), jo vrne nespremenjen.
 * Napačen format vrne izvorno vrednost.
 */
function ujpTrrVIban(trrSt: string): string {
  const cleaned = trrSt.trim();
  if (/^SI\d{17}$/i.test(cleaned)) return cleaned.toUpperCase(); // že IBAN
  if (!/^\d{15}$/.test(cleaned)) return cleaned;                 // ne prepoznan format
  const rearranged = cleaned + "281800";
  const mod = BigInt(rearranged) % 97n;
  const check = String(98n - mod).padStart(2, "0");
  return `SI${check}${cleaned}`;
}

/**
 * Normalizira matično številko za primerjavo z UJP bazo.
 * Inetis vrne matično s trailing ničlami (npr. "5067889000"), UJP hrani 7-mestno ("5067889").
 */
function normalizeMaticnaZaUjp(m?: string | null): string | undefined {
  if (!m) return undefined;
  const t = m.trim().replace(/0+$/, "");
  return t.length >= 4 ? t : m.trim();
}

const router: IRouter = Router();

type TrrPostavka = { iban: string; bic: string };

const BANCNI_BIC: Record<string, string> = {
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
  "Primorska hranilnica": "PHBPSI22"};

function trrSuroviVIban(trrSurovi: string): string {
  // SI IBAN: "SI" + 2 check digits + 15-digit BBAN
  // Check digits = 98 - MOD97(BBAN + "281800")  [S=28, I=18, 00]
  const rearranged = trrSurovi + "281800";
  const mod = BigInt(rearranged) % 97n;
  const check = String(98n - mod).padStart(2, "0");
  return `SI${check}${trrSurovi}`;
}

function razclenitNaslov(naslov: string): { ulica: string | null; postnaStevilka: string | null; kraj: string | null } {
  // Format: "ULICA HS, POSTA KRAJ"
  const idx = naslov.lastIndexOf(", ");
  if (idx === -1) return { ulica: naslov.trim() || null, postnaStevilka: null, kraj: null };
  const ulica = naslov.slice(0, idx).trim();
  const rest = naslov.slice(idx + 2).trim();
  const spaceIdx = rest.indexOf(" ");
  if (spaceIdx === -1) return { ulica: ulica || null, postnaStevilka: rest || null, kraj: null };
  return {
    ulica: ulica || null,
    postnaStevilka: rest.slice(0, spaceIdx),
    kraj: rest.slice(spaceIdx + 1).trim() || null};
}

interface InetisRezultat {
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

function mapKupec(k: typeof shranjeniKupciTable.$inferSelect) {
  return {
    id: k.id,
    naziv: k.naziv,
    kratkiNaziv: k.kratkiNaziv ?? null,
    naslov: k.naslov ?? null,
    ulica: k.ulica ?? null,
    postnaStevilka: k.postnaStevilka ?? null,
    kraj: k.kraj ?? null,
    drzava: k.drzava ?? null,
    kodaDrzave: k.kodaDrzave ?? null,
    zavezanecDdv: k.zavezanecDdv ?? null,
    davcnaStevilka: k.davcnaStevilka ?? null,
    idZaDdv: k.idZaDdv ?? null,
    maticnaStevilka: k.maticnaStevilka ?? null,
    trr: (k.trr as TrrPostavka[] | null) ?? null,
    vrstaPartnerja: k.vrstaPartnerja ?? null,
    kmgMid: k.kmgMid ?? null,
    eRacunPrejemnik: k.eRacunPrejemnik ?? null,
    eRacunOmrezje: k.eRacunOmrezje ?? null,
    eRacunEmail: k.eRacunEmail ?? null,
    eRacunNaslov: k.eRacunNaslov ?? null,
    eRacunSifraPu: k.eRacunSifraPu ?? null,
    eRacunBic: k.eRacunBic ?? null,
    email: k.email ?? null,
    telefon: k.telefon ?? null,
    steviloUpor: k.steviloUpor,
    zadnjaUporaba: k.zadnjaUporaba,
    ustvarjeno: k.ustvarjeno};
}

function zaznajVrsto(naziv: string, zavezanecDdv: boolean | null, maticnaStevilka?: string | null): "obcan" | "sp" | "podjetje" | "kmet" | "javni_sektor" | null {
  // Gospodarske družbe (d.o.o., d.d., k.d., z.o.o., d.n.o., e.s.p., k.d.d., s.k.e.)
  if (/\bd\.\s*o\.\s*o\.|\bd\.\s*d\.|\bk\.\s*d\.|\bz\.\s*o\.\s*o\.|\bd\.\s*n\.\s*o\.|\be\.\s*s\.\s*p\.|\bk\.\s*d\.\s*d\.|\bs\.\s*k\.\s*e\./i.test(naziv)) {
    return "podjetje";
  }
  // Samostojni podjetnik
  if (/\bs\.\s*p\.(\s|$|,)/i.test(naziv)) {
    return "sp";
  }
  // Kmetijsko gospodarstvo
  if (/\bkmetij|\bkmet\b|\bkgz\b/i.test(naziv)) {
    return "kmet";
  }
  // Javni sektor: šole, vrtci, zavodi, občine, ministrstva, sodišča, bolnice, univerze …
  if (/\bšola\b|\bvrtec\b|\bgimnazija\b|\blicej\b|\buniverzit|\bfakultet|\binštitut\b|\bzavod\b|\bobčina\b|\bministrstvo\b|\bagencija\b|\buprava\b|\bsodišče\b|\bbolnica\b|\bdom\s+zdravja\b|\bzdravstveni\s+dom\b|\bdom\s+starejših\b|\bdom\s+upokojencev\b|\bdom\s+za\b|\bjavni\s+sklad\b|\bsvet\s+zavoda\b|\bkrajevna\s+skupnost\b|\bmestna\s+občina\b/i.test(naziv)) {
    return "javni_sektor";
  }
  // Vsaka entiteta z matično številko je registrirana organizacija — ne fizična oseba
  if (maticnaStevilka?.trim()) {
    return "podjetje";
  }
  // Fizična oseba = brez pravnoorganizacijske oblike in brez DDV
  if (!zavezanecDdv) {
    return "obcan";
  }
  return null;
}

async function poisciNaBizBox(davcna: string, naziv?: string): Promise<{ registriran: boolean; omrezje: string | null; naslov: string | null } | null> {
  // bizBox eImenik — javni register prejemnikov e-računov (bizbox.zzi.si/bizBoxIskalnik)
  // Filter deluje po imenu podjetja; taxid v odgovoru je v formatu SI<8mestna>.
  // Zahteva Referer od bizbox.eu. Iščemo po nazivu, potrdimo z davčno.
  const cleaned = davcna.replace(/^SI/i, "");
  const siDavcna = `SI${cleaned}`.toUpperCase();

  // Iskalni niz: prvih 3 besede naziva ali SI<davčna> kot fallback
  const iskalniNiz = naziv
    ? naziv.split(/[\s,]+/).filter(Boolean).slice(0, 3).join(" ")
    : siDavcna;

  try {
    const r = await fetch(
      `https://bizbox.zzi.si/bizBoxIskalnik?filter=${encodeURIComponent(iskalniNiz)}`,
      {
        signal: AbortSignal.timeout(8000),
        headers: {
          "Accept": "application/json, */*",
          "User-Agent": "Mozilla/5.0 (compatible; POS/1.0)",
          "Referer": "https://www.bizbox.eu/e-imenik/",
          "Origin": "https://www.bizbox.eu"}}
    );
    if (!r.ok) return null;
    const data = await r.json() as {
      result: {
        companies: Array<{
          name?: string;
          taxid?: string;
          provider?: string;
          isedirecipient?: number;
          defaultlocation?: string;
        }>;
      };
    };
    const companies = data?.result?.companies ?? [];
    // Poiščemo točno ujemanje po SI<davčna> — edini zanesljiv identifikator
    const match = companies.find(c => c.taxid?.toUpperCase() === siDavcna);
    if (!match) {
      // Točnega ujemanja ni → podjetje ni v bizBox registru
      return { registriran: false, omrezje: null, naslov: null };
    }
    const registriran = (match.isedirecipient ?? 1) === 1;
    const omrezje = match.provider ?? null;
    const naslov = match.defaultlocation ?? null;
    return { registriran, omrezje, naslov };
  } catch {
    // Timeout ali napaka omrežja — vrnemo null (ne posodabljamo obstoječe)
    return null;
  }
}

async function poisciNaInetis(davcna: string): Promise<InetisRezultat | null> {
  try {
    const cleaned = davcna.replace(/^SI/i, "");
    const r = await fetch(
      `https://ddv.inetis.com/Ajax.aspx?a=isci&niz=${encodeURIComponent(cleaned)}`,
      { signal: AbortSignal.timeout(8000) }
    );
    if (!r.ok) return null;
    const data = await r.json() as {
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
    if (data.status !== "ok" || !data.list?.length) return null;
    const p = data.list[0]!;

    const rawNaslov = p.Naslov ?? null;
    const adresni = rawNaslov ? razclenitNaslov(rawNaslov) : { ulica: null, postnaStevilka: null, kraj: null };

    const trrji: TrrPostavka[] = (p.TransakcijskiRacuni ?? [])
      .filter(t => !t.Zaprt && t.TRRSurovi && /^\d{15}$/.test(t.TRRSurovi))
      .map(t => ({
        iban: trrSuroviVIban(t.TRRSurovi!),
        bic: (t.Banka && BANCNI_BIC[t.Banka]) ? BANCNI_BIC[t.Banka]! : ""}));

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
      trr: trrji.length > 0 ? trrji : null};
  } catch {
    return null;
  }
}

router.get("/kupec/pogosti", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const kupci = await db
    .select()
    .from(shranjeniKupciTable)
    .where(and(eq(shranjeniKupciTable.enotaId, tenotaId)))
    .orderBy(desc(shranjeniKupciTable.steviloUpor), desc(shranjeniKupciTable.zadnjaUporaba))
    .limit(8);
  res.json(kupci.map(mapKupec));
});

router.get("/kupec/shranjeni", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const kupci = await db
    .select()
    .from(shranjeniKupciTable)
    .where(and(eq(shranjeniKupciTable.enotaId, tenotaId)))
    .orderBy(shranjeniKupciTable.naziv);
  res.json(kupci.map(mapKupec));
});

router.post("/kupec/shranjeni", async (req, res): Promise<void> => {
  const parsed = { success: true, data: req.body };
  if (!parsed.success) {
    const msg = (parsed as any).error.issues[0]?.message ?? "Napačen vnos";
    res.status(400).json({ napaka: msg });
    return;
  }
  const tenotaId = (req as any).enotaId ?? 1;
  const d = parsed.data;
  const [kupec] = await db
    .insert(shranjeniKupciTable)
    .values({
      enotaId: tenotaId,
      naziv: d.naziv,
      kratkiNaziv: d.kratkiNaziv ?? null,
      naslov: d.naslov ?? null,
      ulica: d.ulica ?? null,
      postnaStevilka: d.postnaStevilka ?? null,
      kraj: d.kraj ?? null,
      drzava: d.drzava ?? null,
      kodaDrzave: d.kodaDrzave ?? null,
      zavezanecDdv: d.zavezanecDdv ?? null,
      davcnaStevilka: d.davcnaStevilka ?? null,
      idZaDdv: d.idZaDdv ?? null,
      maticnaStevilka: d.maticnaStevilka ?? null,
      trr: d.trr ?? null,
      vrstaPartnerja: d.vrstaPartnerja ?? null,
      kmgMid: d.kmgMid ?? null,
      eRacunPrejemnik: d.eRacunPrejemnik ?? null,
      eRacunOmrezje: d.eRacunOmrezje ?? null,
      eRacunNaslov: d.eRacunNaslov ?? null,
      eRacunEmail: d.eRacunEmail ?? null,
      eRacunSifraPu: d.eRacunSifraPu ?? null,
      eRacunBic: d.eRacunBic ?? null,
      email: d.email ?? null,
      telefon: d.telefon ?? null,
      steviloUpor: 1,
      zadnjaUporaba: new Date()})
    .returning();
  res.status(201).json(mapKupec(kupec!));
});

router.put("/kupec/shranjeni/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "");
  if (isNaN(id)) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }
  const parsed = { success: true, data: req.body };
  if (!parsed.success) {
    const msg = (parsed as any).error.issues[0]?.message ?? "Napačen vnos";
    res.status(400).json({ napaka: msg });
    return;
  }
  const tenotaId = (req as any).enotaId ?? 1;
  const d = parsed.data;
  const [updated] = await db
    .update(shranjeniKupciTable)
    .set({
      naziv: d.naziv,
      kratkiNaziv: d.kratkiNaziv ?? null,
      naslov: d.naslov ?? null,
      ulica: d.ulica ?? null,
      postnaStevilka: d.postnaStevilka ?? null,
      kraj: d.kraj ?? null,
      drzava: d.drzava ?? null,
      kodaDrzave: d.kodaDrzave ?? null,
      zavezanecDdv: d.zavezanecDdv ?? null,
      davcnaStevilka: d.davcnaStevilka ?? null,
      idZaDdv: d.idZaDdv ?? null,
      maticnaStevilka: d.maticnaStevilka ?? null,
      trr: d.trr ?? null,
      vrstaPartnerja: d.vrstaPartnerja ?? null,
      kmgMid: d.kmgMid ?? null,
      eRacunPrejemnik: d.eRacunPrejemnik ?? null,
      eRacunOmrezje: d.eRacunOmrezje ?? null,
      eRacunNaslov: d.eRacunNaslov ?? null,
      eRacunEmail: d.eRacunEmail ?? null,
      eRacunSifraPu: d.eRacunSifraPu ?? null,
      eRacunBic: d.eRacunBic ?? null,
      email: d.email ?? null,
      telefon: d.telefon ?? null})
    .where(and(
      eq(shranjeniKupciTable.id, id),
      sql`true`,
      eq(shranjeniKupciTable.enotaId, tenotaId),
    ))
    .returning();
  if (!updated) { res.status(404).json({ napaka: "Kupec ni najden" }); return; }
  res.json(mapKupec(updated));
});

router.delete("/kupec/shranjeni/:id", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "");
  if (isNaN(id)) {
    res.status(400).json({ napaka: "Neveljaven ID" });
    return;
  }
  const tenotaId = (req as any).enotaId ?? 1;
  const [deleted] = await db
    .delete(shranjeniKupciTable)
    .where(and(
      eq(shranjeniKupciTable.id, id),
      sql`true`,
      eq(shranjeniKupciTable.enotaId, tenotaId),
    ))
    .returning();
  if (!deleted) {
    res.status(404).json({ napaka: "Kupec ni najden" });
    return;
  }
  res.status(204).end();
});

router.post("/kupec/shranjeni/:id/osvezi", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "");
  if (isNaN(id)) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }
  const tenotaId = (req as any).enotaId ?? 1;

  const [obstojecKupec] = await db
    .select()
    .from(shranjeniKupciTable)
    .where(and(
      eq(shranjeniKupciTable.id, id),
      sql`true`,
      eq(shranjeniKupciTable.enotaId, tenotaId),
    ))
    .limit(1);

  if (!obstojecKupec) { res.status(404).json({ napaka: "Kupec ni najden" }); return; }

  const davcna = obstojecKupec.davcnaStevilka?.trim();
  const idZaDdv = obstojecKupec.idZaDdv?.trim();
  const jeTuji = !davcna || !/^\d{8}$/.test(davcna);

  // ── Tuji partner (EU VAT ID, ne SI davčna) → osveži prek VIES ─────────────
  if (jeTuji) {
    if (!idZaDdv || !/^[A-Z]{2}.+$/i.test(idZaDdv)) {
      res.status(400).json({ napaka: "Partner nima EU VAT ID — osveževanje ni mogoče." });
      return;
    }
    const vies = await preveriVies(idZaDdv);
    if (!vies) {
      res.status(503).json({ napaka: "VIES ni dosegljiv. Poskusite pozneje." });
      return;
    }
    const kodaDrzave = obstojecKupec.kodaDrzave ?? vies.kodaDrzave;
    const [posodobljen] = await db
      .update(shranjeniKupciTable)
      .set({
        ...(vies.naziv ? { naziv: vies.naziv } : {}),
        ...(vies.ulica ? { ulica: vies.ulica } : {}),
        ...(vies.postnaStevilka ? { postnaStevilka: vies.postnaStevilka } : {}),
        ...(vies.kraj ? { kraj: vies.kraj } : {}),
        drzava: obstojecKupec.drzava || vies.drzavaNaziv || drzavaIzKode(kodaDrzave),
        kodaDrzave: kodaDrzave,
        zavezanecDdv: vies.veljaven ? true : (obstojecKupec.zavezanecDdv ?? null),
      })
      .where(and(
        eq(shranjeniKupciTable.id, id),
        eq(shranjeniKupciTable.enotaId, tenotaId),
      ))
      .returning();
    res.json(mapKupec(posodobljen!));
    return;
  }

  // ── Domači partner (SI davčna) → AJPES / INETIS / BizBox / UJP ───────────
  // INETIS najprej (dobi naziv), nato vzporedno BizBox + UJP + AJPES
  const svezi = await poisciNaInetis(davcna);

  if (!svezi) {
    res.status(404).json({ napaka: `Podatkov za davčno ${davcna} v registru AJPES/INETIS ni bilo mogoče najti.` });
    return;
  }

  const maticnaZaUjp = normalizeMaticnaZaUjp(svezi.maticnaStevilka ?? obstojecKupec.maticnaStevilka);
  const [eReg, ujpVnosi, ajpesSub] = await Promise.all([
    poisciNaBizBox(davcna, svezi.naziv),
    poisciVUjp(davcna, maticnaZaUjp),
    poisciVAjpes(svezi.maticnaStevilka ?? obstojecKupec.maticnaStevilka),
  ]);

  // UJP ima prednost pred BizBox za javni sektor
  const jeVUjp = ujpVnosi.length > 0;
  const eRacunPrejemnik = jeVUjp ? true : (eReg?.registriran ?? null);
  const eRacunOmrezje = jeVUjp ? "UJP" : (eReg?.omrezje ?? obstojecKupec.eRacunOmrezje ?? null);
  // trrSt iz UJP je 15-mestna surova TRR — pretvorimo v SI IBAN za shranjevanje
  const eRacunNaslov = jeVUjp
    ? ujpTrrVIban(ujpVnosi[0]!.trrSt)
    : (eReg?.naslov ?? obstojecKupec.eRacunNaslov ?? null);
  const eRacunSifraPu = jeVUjp ? (ujpVnosi[0]!.sifraPu || null) : obstojecKupec.eRacunSifraPu ?? null;
  // BIC BSLJSI2X velja za UJP podračune, ki se začnejo z SI5601 (Banka Slovenije, šifra banke 01)
  const ujpIban = jeVUjp ? ujpTrrVIban(ujpVnosi[0]!.trrSt) : null;
  const eRacunBic = (jeVUjp && ujpIban?.replace(/\s/g, "").toUpperCase().startsWith("SI5601"))
    ? "BSLJSI2X"
    : (obstojecKupec.eRacunBic ?? null);

  const surowiTrr = (svezi.trr && svezi.trr.length > 0) ? svezi.trr : obstojecKupec.trr;
  // SI5601 podračuni gredo vedno skozi Banko Slovenije → BIC je vedno BSLJSI2X
  const trrji = surowiTrr
    ? (surowiTrr as Array<{ iban: string; bic: string }>).map(t =>
        t.iban.replace(/\s/g, "").toUpperCase().startsWith("SI5601")
          ? { ...t, bic: "BSLJSI2X" }
          : t)
    : surowiTrr;
  const novaVrsta = zaznajVrsto(svezi.naziv, svezi.zavezanecDdv, svezi.maticnaStevilka);

  // Sestavi posodobitev za e-račun polja:
  // - Če UJP najden: vedno prepiši (UJP je avtoritativen vir)
  // - Če BizBox odgovori: posodobi
  // - Sicer: ohrani obstoječe
  const eRacunPosodobitev =
    jeVUjp ? { eRacunPrejemnik: true, eRacunOmrezje: "UJP", eRacunNaslov, eRacunSifraPu, eRacunBic }
    : eReg !== null ? {
        eRacunPrejemnik: eReg.registriran,
        eRacunOmrezje: eReg.omrezje ?? obstojecKupec.eRacunOmrezje,
        ...(eReg.naslov ? { eRacunNaslov: eReg.naslov } : {})}
    : {};

  // AJPES: zapolni email in spletno stran, če ni že vnešeno
  const ajpesEmail = (ajpesSub?.email && !obstojecKupec.email) ? ajpesSub.email : undefined;
  const ajpesWww = (ajpesSub?.www && !obstojecKupec.email) ? ajpesSub.www : undefined;

  const [posodobljen] = await db
    .update(shranjeniKupciTable)
    .set({
      naziv: svezi.naziv || obstojecKupec.naziv,
      kratkiNaziv: svezi.kratkiNaziv ?? obstojecKupec.kratkiNaziv,
      naslov: svezi.naslov ?? obstojecKupec.naslov,
      ulica: svezi.ulica ?? obstojecKupec.ulica,
      postnaStevilka: svezi.postnaStevilka ?? obstojecKupec.postnaStevilka,
      kraj: svezi.kraj ?? obstojecKupec.kraj,
      drzava: obstojecKupec.drzava || "Slovenija",
      kodaDrzave: obstojecKupec.kodaDrzave || "SI",
      zavezanecDdv: svezi.zavezanecDdv ?? obstojecKupec.zavezanecDdv,
      idZaDdv: svezi.idZaDdv ?? obstojecKupec.idZaDdv,
      maticnaStevilka: svezi.maticnaStevilka ?? obstojecKupec.maticnaStevilka,
      trr: trrji,
      ...(novaVrsta !== null ? { vrstaPartnerja: novaVrsta } : {}),
      ...(ajpesEmail ? { email: ajpesEmail } : {}),
      ...(ajpesWww ? { telefon: ajpesWww } : {}),
      ...eRacunPosodobitev,
    })
    .where(and(
      eq(shranjeniKupciTable.id, id),
      sql`true`,
      eq(shranjeniKupciTable.enotaId, tenotaId),
    ))
    .returning();

  res.json(mapKupec(posodobljen!));
});

// ── GET /kupec/poisci-vies — išči tujega partnerja po EU VAT ID ──────────────
router.get("/kupec/poisci-vies", async (req, res): Promise<void> => {
  const vatId = typeof req.query.vatId === "string"
    ? req.query.vatId.trim().toUpperCase().replace(/\s/g, "")
    : "";
  if (!/^[A-Z]{2}\S{2,}$/.test(vatId)) {
    res.status(400).json({ napaka: "Neveljaven EU VAT ID (npr. DE195033395)" });
    return;
  }
  const tenotaId = (req as any).enotaId ?? 1;
  const kodaDrzave = vatId.slice(0, 2);

  // 1. Že v šifrantu?
  const [obstojecKupec] = await db
    .select()
    .from(shranjeniKupciTable)
    .where(and(
      eq(shranjeniKupciTable.enotaId, tenotaId),
      eq(shranjeniKupciTable.idZaDdv, vatId),
    ))
    .limit(1);
  if (obstojecKupec) { res.json(mapKupec(obstojecKupec)); return; }

  // 2. VIES lookup
  const vies = await preveriVies(vatId);
  if (!vies) { res.status(503).json({ napaka: "VIES ni dosegljiv. Poskusite pozneje." }); return; }

  const drzavaNaziv = vies.drzavaNaziv ?? drzavaIzKode(kodaDrzave);
  const naziv = vies.naziv && vies.naziv !== "---" ? vies.naziv : null;
  const ulica = vies.ulica && vies.ulica !== "---" ? vies.ulica : null;
  const postnaStevilka = vies.postnaStevilka && vies.postnaStevilka !== "---" ? vies.postnaStevilka : null;
  const kraj = vies.kraj && vies.kraj !== "---" ? vies.kraj : null;

  // 3. VIES vrnil naziv → samodejno shrani
  if (vies.veljaven && naziv) {
    try {
      const [nov] = await db.insert(shranjeniKupciTable).values({
        enotaId: tenotaId,
        naziv,
        idZaDdv: vatId,
        kodaDrzave,
        drzava: drzavaNaziv,
        ulica,
        postnaStevilka,
        kraj,
        zavezanecDdv: true,
        vrstaPartnerja: "podjetje" as any,
      }).returning({ id: shranjeniKupciTable.id });
      const [saved] = await db.select().from(shranjeniKupciTable)
        .where(eq(shranjeniKupciTable.id, nov!.id)).limit(1);
      res.json(mapKupec(saved!));
      return;
    } catch { /* spodleti → vrni brez id */ }
  }

  // 4. Brez VIES podatkov (npr. DE) → vrni metapodatke za ročen vnos
  res.json({ naziv, idZaDdv: vatId, kodaDrzave, drzava: drzavaNaziv, zavezanecDdv: vies.veljaven ?? null, ulica, postnaStevilka, kraj });
});

router.get("/kupec/poisci", async (req, res): Promise<void> => {
  const davcna = typeof req.query.davcna === "string" ? req.query.davcna.trim() : "";
  if (!/^\d{8}$/.test(davcna)) {
    res.status(400).json({ napaka: "Davčna številka mora imeti točno 8 številk." });
    return;
  }

  const r = await poisciNaInetis(davcna);
  if (!r || !r.naziv) {
    res.status(404).json({ napaka: "Kupec s to davčno številko ni bil najden v registru." });
    return;
  }

  // Vzporedno preverimo bizBox eImenik + UJP + AJPES
  const [eReg, ujpVnosi, ajpesSub] = await Promise.all([
    poisciNaBizBox(davcna, r.naziv),
    poisciVUjp(davcna, normalizeMaticnaZaUjp(r.maticnaStevilka)),
    poisciVAjpes(r.maticnaStevilka),
  ]);

  // UJP ima prednost pred BizBox za javni sektor — trrSt pretvorimo v SI IBAN
  const jeVUjp = ujpVnosi.length > 0;
  const eRacunPrejemnik = jeVUjp ? true : (eReg?.registriran ?? null);
  const eRacunOmrezje = jeVUjp ? "UJP" : (eReg?.omrezje ?? null);
  const eRacunNaslov = jeVUjp
    ? ujpTrrVIban(ujpVnosi[0]!.trrSt)
    : (eReg?.naslov ?? null);

  // Avtomatsko shrani / posodobi v shranjeni_kupci z vsemi INETIS podatki
  const tenotaId = (req as any).enotaId ?? 1;
  let shranjeniId: number | null = null;
  if (r) {
    try {
      const [existing] = await db
        .select({ id: shranjeniKupciTable.id })
        .from(shranjeniKupciTable)
        .where(and(eq(shranjeniKupciTable.enotaId, tenotaId),
          eq(shranjeniKupciTable.davcnaStevilka, r.davcnaStevilka),
        ))
        .limit(1);

      const vrstaIzPoisci = zaznajVrsto(r.naziv, r.zavezanecDdv, r.maticnaStevilka);

      // SI5601 podračuni gredo vedno skozi Banko Slovenije → BIC vedno BSLJSI2X
      const trr_popravljeni = r.trr
        ? (r.trr as Array<{ iban: string; bic: string }>).map(t =>
            t.iban.replace(/\s/g, "").toUpperCase().startsWith("SI5601")
              ? { ...t, bic: "BSLJSI2X" } : t)
        : r.trr;

      // AJPES: zapolni email, če je na voljo in kupec ga še nima
      const ajpesEmailPoisci = ajpesSub?.email || null;

      if (existing) {
        shranjeniId = existing.id;
        await db.update(shranjeniKupciTable).set({
          naziv: r.naziv,
          kratkiNaziv: r.kratkiNaziv,
          naslov: r.naslov,
          ulica: r.ulica,
          postnaStevilka: r.postnaStevilka,
          kraj: r.kraj,
          drzava: "Slovenija",
          kodaDrzave: "SI",
          zavezanecDdv: r.zavezanecDdv,
          idZaDdv: r.idZaDdv,
          maticnaStevilka: r.maticnaStevilka,
          trr: trr_popravljeni,
          zadnjaUporaba: new Date(),
          ...(ajpesEmailPoisci ? { email: ajpesEmailPoisci } : {}),
          ...(vrstaIzPoisci !== null ? { vrstaPartnerja: vrstaIzPoisci } : {}),
          ...(eRacunPrejemnik !== null ? {
            eRacunPrejemnik,
            eRacunOmrezje,
            ...(eRacunNaslov ? { eRacunNaslov } : {}),
            ...(jeVUjp && ujpVnosi[0]!.sifraPu ? { eRacunSifraPu: ujpVnosi[0]!.sifraPu } : {}),
            ...(jeVUjp ? { eRacunBic: "BSLJSI2X" } : {})} : {})}).where(eq(shranjeniKupciTable.id, existing.id));
      } else {
        const [inserted] = await db.insert(shranjeniKupciTable).values({
          enotaId: tenotaId,
          naziv: r.naziv,
          kratkiNaziv: r.kratkiNaziv,
          naslov: r.naslov,
          ulica: r.ulica,
          postnaStevilka: r.postnaStevilka,
          kraj: r.kraj,
          drzava: "Slovenija",
          kodaDrzave: "SI",
          zavezanecDdv: r.zavezanecDdv,
          davcnaStevilka: r.davcnaStevilka,
          idZaDdv: r.idZaDdv,
          maticnaStevilka: r.maticnaStevilka,
          trr: trr_popravljeni,
          email: ajpesEmailPoisci,
          steviloUpor: 0,
          zadnjaUporaba: new Date(),
          ...(vrstaIzPoisci !== null ? { vrstaPartnerja: vrstaIzPoisci } : {}),
          ...(eRacunPrejemnik !== null ? {
            eRacunPrejemnik,
            eRacunOmrezje,
            ...(eRacunNaslov ? { eRacunNaslov } : {}),
            ...(jeVUjp && ujpVnosi[0]!.sifraPu ? { eRacunSifraPu: ujpVnosi[0]!.sifraPu } : {}),
            ...(jeVUjp ? { eRacunBic: "BSLJSI2X" } : {})} : {})}).returning({ id: shranjeniKupciTable.id });
        shranjeniId = inserted?.id ?? null;
      }
    } catch {
      // Ne blokiraj odgovora pri napaki shranjevanja
    }
  }

  const eRacunSifraPuIzPoisci = jeVUjp ? (ujpVnosi[0]!.sifraPu || null) : null;
  res.json({
    ...r,
    id: shranjeniId,
    email: (r as any).email ?? ajpesSub?.email ?? null,
    eRacunPrejemnik,
    eRacunOmrezje,
    eRacunNaslov,
    eRacunSifraPu: eRacunSifraPuIzPoisci,
    eRacunBic: jeVUjp ? "BSLJSI2X" : null,
    ujpVnosi: jeVUjp ? ujpVnosi : undefined,
  });
});

export async function upsertPogostKupec(opts: {
  enotaId: number;
  naziv: string;
  naslov: string | null;
  davcnaStevilka: string | null;
}): Promise<void> {
  const { enotaId, naziv, naslov, davcnaStevilka } = opts;

  const whereClause = davcnaStevilka
    ? and(eq(shranjeniKupciTable.enotaId, enotaId),
        eq(shranjeniKupciTable.davcnaStevilka, davcnaStevilka),
      )
    : and(eq(shranjeniKupciTable.enotaId, enotaId),
        sql`lower(${shranjeniKupciTable.naziv}) = lower(${naziv})`,
      );

  const [existing] = await db
    .select({ id: shranjeniKupciTable.id })
    .from(shranjeniKupciTable)
    .where(whereClause)
    .limit(1);

  if (existing) {
    await db
      .update(shranjeniKupciTable)
      .set({
        steviloUpor: sql`${shranjeniKupciTable.steviloUpor} + 1`,
        zadnjaUporaba: new Date(),
        naziv,
        ...(naslov !== undefined && { naslov })})
      .where(eq(shranjeniKupciTable.id, existing.id));
  } else {
    await db.insert(shranjeniKupciTable).values({
      enotaId,
      naziv,
      naslov,
      davcnaStevilka,
      steviloUpor: 1,
      zadnjaUporaba: new Date()});
  }
}

// ─── Partner cenik ───────────────────────────────────────────────────────────

router.get("/kupec/shranjeni/:id/cenik", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "");
  if (isNaN(id)) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }

  const [kupec] = await db.select({ id: shranjeniKupciTable.id }).from(shranjeniKupciTable)
    .where(and(eq(shranjeniKupciTable.id, id)))
    .limit(1);
  if (!kupec) { res.status(404).json({ napaka: "Partner ni najden" }); return; }

  const vrstice = await db
    .select({
      artikelId: partnerCenikiTable.artikelId,
      artikelIme: artikliTable.ime,
      kategorijaId: artikliTable.kategorijaId,
      kategorijaIme: kategorijeTable.ime,
      originalCena: artikliTable.cena,
      cena: partnerCenikiTable.cena,
      davek: artikliTable.davek})
    .from(partnerCenikiTable)
    .innerJoin(artikliTable, eq(partnerCenikiTable.artikelId, artikliTable.id))
    .leftJoin(kategorijeTable, eq(artikliTable.kategorijaId, kategorijeTable.id))
    .where(eq(partnerCenikiTable.kupecId, id))
    .orderBy(artikliTable.ime);

  res.json(vrstice.map(v => ({
    artikelId: v.artikelId,
    artikelIme: v.artikelIme,
    kategorijaId: v.kategorijaId ?? null,
    kategorijaIme: v.kategorijaIme ?? null,
    originalCena: Number(v.originalCena),
    cena: Number(v.cena),
    davek: Number(v.davek)})));
});

router.put("/kupec/shranjeni/:id/cenik/:artikelId", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "");
  const artikelId = parseInt(req.params.artikelId ?? "");
  if (isNaN(id) || isNaN(artikelId)) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }
  const tenotaId = (req as any).enotaId ?? 1;
  const cena = Number(req.body?.cena);
  if (!isFinite(cena) || cena < 0) { res.status(400).json({ napaka: "Cena mora biti nenegativen número" }); return; }

  const [kupec] = await db.select({ id: shranjeniKupciTable.id }).from(shranjeniKupciTable)
    .where(and(eq(shranjeniKupciTable.id, id)))
    .limit(1);
  if (!kupec) { res.status(404).json({ napaka: "Partner ni najden" }); return; }

  const [artikel] = await db.select({ id: artikliTable.id, ime: artikliTable.ime, cena: artikliTable.cena, davek: artikliTable.davek, kategorijaId: artikliTable.kategorijaId })
    .from(artikliTable)
    .where(and(eq(artikliTable.id, artikelId)))
    .limit(1);
  if (!artikel) { res.status(404).json({ napaka: "Artikel ni najden" }); return; }

  await db.insert(partnerCenikiTable).values({
    enotaId: tenotaId,
    kupecId: id,
    artikelId,
    cena: String(cena)}).onConflictDoUpdate({
    target: [partnerCenikiTable.kupecId, partnerCenikiTable.artikelId],
    set: { cena: String(cena) }});

  const [kat] = artikel.kategorijaId
    ? await db.select({ ime: kategorijeTable.ime }).from(kategorijeTable).where(eq(kategorijeTable.id, artikel.kategorijaId)).limit(1)
    : [];

  res.json({
    artikelId,
    artikelIme: artikel.ime,
    kategorijaId: artikel.kategorijaId ?? null,
    kategorijaIme: kat?.ime ?? null,
    originalCena: Number(artikel.cena),
    cena,
    davek: Number(artikel.davek)});
});

router.delete("/kupec/shranjeni/:id/cenik/:artikelId", async (req, res): Promise<void> => {
  const id = parseInt(req.params.id ?? "");
  const artikelId = parseInt(req.params.artikelId ?? "");
  if (isNaN(id) || isNaN(artikelId)) { res.status(400).json({ napaka: "Neveljaven ID" }); return; }

  const [kupec] = await db.select({ id: shranjeniKupciTable.id }).from(shranjeniKupciTable)
    .where(and(eq(shranjeniKupciTable.id, id)))
    .limit(1);
  if (!kupec) { res.status(404).json({ napaka: "Partner ni najden" }); return; }

  await db.delete(partnerCenikiTable)
    .where(and(eq(partnerCenikiTable.kupecId, id), eq(partnerCenikiTable.artikelId, artikelId)));

  res.status(204).send();
});

export default router;
