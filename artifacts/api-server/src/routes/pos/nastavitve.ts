import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, ne } from "drizzle-orm";
import { artikliTable, db, enoteTable, nastavitveTable, companiesTable, bizboxNastavitveTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import { fursSOAPEcho, pridobiCompanyCert } from "../../lib/pos-furs";
import { randomUUID } from "node:crypto";
import { posljiTestnoEmail } from "../../lib/pos-email";
import { loadUnitEmailSender } from "../../lib/company-email-sender";
import {
  isHappyHourActiveForArticle,
  normalizeHappyHourRules,
  parseHappyHourRules,
  type HappyHourPravilo,
  type HappyHourVelikostPice,
} from "../../lib/happy-hour";

const requireAdmin = requireEnota;
const requireAdminEnote = requireEnota;

const router: IRouter = Router();

const DEFAULTS: Record<string, string> = {
  nazivRestavracije:   "",
  naslovRestavracije:  "",
  nazivPodjetja:       "",
  naslovPodjetja:      "",
  naslovUlica:         "",
  naslovPostna:        "",
  naslovKraj:          "",
  davcnaStevilka:      "",
  idZaDdv:             "",
  poslovniProstor:     "PP001",
  elektronskaNaprava:  "B001",
  ponudnikDavcna:      "",
  racunPozdrav1:       "Hvala za obisk!",
  racunPozdrav2:       "Vracamo se — se vidimo.",
  testniNacin:         "true",
  fursNacin:           "simulacija",
  fursProxyUrl:        "",
  simulirajFursNapako: "false",
  grupiranjeNacin:     "novo",
  smtpHost:            "",
  smtpPort:            "465",
  smtpUser:            "",
  smtpPassword:        "",
  smtpFrom:            "",
  smtpAktiven:         "false",
  izrednaIzdajaPINHash: "",
  ddvSplosnaSt:               "22",
  ddvNizjaSt:                 "9.5",
  ddvZnizanaSt:               "5",
  prodajalecIban:             "",
  prodajalecBic:              "",
  racunMaticna:               "",
  racunSodisce:               "",
  racunKapital:               "",
  racunDdvKlavzula:           "",
  racunZbirnaKlavzula:        "false",
  racunPravnaKlavzula:        "",
  happyHourOd:                "",
  happyHourDo:                "",
  happyHourPravila:           "[]",
  happyHourRocnoAktiven:      "auto",
  dovoliNegativneZaloge:      "true",
  bizBoxOkolje:               "test",
  telefonNarocilaOsnovniCasMin: "5",
  telefonNarocilaCakalnaVrstaMin: "0",
  telefonNarocilaKapaciteta: "3",
  telefonNarocilaNajvecCasMin: "30",
  telefonNarocilaZaokrozevanjeMin: "5",
  telefonNarocilaPijacaOsnovniCasMin: "3",
  telefonNarocilaPijacaCakalnaVrstaMin: "0",
  telefonNarocilaPijacaKapaciteta: "2",
  telefonNarocilaPijacaNajvecCasMin: "20",
  telefonNarocilaPijacaZaokrozevanjeMin: "1",
  dostavaArtikelId: "",
  picaPremerMala: "0",
  picaPremerNormalna: "0",
  picaPremerDruzinska: "0",
  studentskiBonAktiven: "false",
  qrAiAsistentAktiven: "false",
  toastTocilnicaAktiven: "true",
  offlineFiscalEnabled: "false",
};

const BREZ_FALLBACKA_MED_ENOTAMI = new Set(["qrAiAsistentAktiven", "offlineFiscalEnabled"]);

/**
 * Ključi, ki so shranjeni na nivoju podjetja (enota_id=0, podjetje_davcna=X).
 * Certifikat, FURS način in PP/BB kode veljajo za celotno podjetje, ne posamezno enoto.
 */
const FURS_KLJUCI_PO_PODJETJU = new Set([
  "poslovniProstor",
  "elektronskaNaprava",
  "testniNacin",
  "fursNacin",
  "fursProxyUrl",
  "simulirajFursNapako",
  "bizBoxOkolje",
]);

async function readAll(podjetjeDavcna: string, enotaId = 1): Promise<Record<string, string>> {
  const [rows, globalRows, fursRows] = await Promise.all([
    // Per-enota nastavitve (ne-FURS ključi)
    db.select().from(nastavitveTable).where(
      and(eq(nastavitveTable.enotaId, enotaId))
    ),
    // Globalne nastavitve (DDV stopnje): podjetje_davcna="", enota_id=0
    db.select({ kljuc: nastavitveTable.kljuc, vrednost: nastavitveTable.vrednost })
      .from(nastavitveTable)
      .where(and(eq(nastavitveTable.enotaId, 0))),
    // FURS nastavitve na nivoju podjetja: podjetje_davcna=X, enota_id=0
    db.select({ kljuc: nastavitveTable.kljuc, vrednost: nastavitveTable.vrednost })
      .from(nastavitveTable)
      .where(and(eq(nastavitveTable.enotaId, 0))),
  ]);

  const map: Record<string, string> = { ...DEFAULTS };
  // Globalne DDV stopnje imajo prednost pred DEFAULTS
  for (const r of globalRows) map[r.kljuc] = r.vrednost;
  // FURS nastavitve podjetja
  for (const r of fursRows) map[r.kljuc] = r.vrednost;

  // Per-enota vrednosti (samo ne-FURS ključi — FURS ključe beremo samo z nivoja podjetja)
  const enotaKljuci = new Set(rows.map(r => r.kljuc));
  for (const r of rows) {
    if (!FURS_KLJUCI_PO_PODJETJU.has(r.kljuc)) map[r.kljuc] = r.vrednost;
  }

  // Rezervna možnost za enote brez lastnih ne-FURS nastavitev: vzamemo enota_id=1
  if (enotaId !== 1) {
    const manjkajoceNeFursKljuce = Object.keys(DEFAULTS).filter(
      k => !enotaKljuci.has(k)
        && !FURS_KLJUCI_PO_PODJETJU.has(k)
        && !BREZ_FALLBACKA_MED_ENOTAMI.has(k)
    );
    if (manjkajoceNeFursKljuce.length > 0) {
      const fallbackVrstice = await db.select().from(nastavitveTable).where(
        and(eq(nastavitveTable.enotaId, 1))
      );
      for (const r of fallbackVrstice) {
        if (!FURS_KLJUCI_PO_PODJETJU.has(r.kljuc) && !enotaKljuci.has(r.kljuc)) {
          map[r.kljuc] = r.vrednost;
        }
      }
    }
  }

  return map;
}

function toResponse(map: Record<string, string>) {
  return {
    nazivRestavracije:  map["nazivRestavracije"]  ?? DEFAULTS["nazivRestavracije"],
    naslovRestavracije: map["naslovRestavracije"] ?? DEFAULTS["naslovRestavracije"],
    nazivPodjetja:      map["nazivPodjetja"]      || map["nazivRestavracije"] || DEFAULTS["nazivRestavracije"],
    naslovPodjetja:     map["naslovPodjetja"]     || map["naslovRestavracije"] || DEFAULTS["naslovRestavracije"],
    naslovUlica:        map["naslovUlica"]        ?? DEFAULTS["naslovUlica"],
    naslovPostna:       map["naslovPostna"]       ?? DEFAULTS["naslovPostna"],
    naslovKraj:         map["naslovKraj"]         ?? DEFAULTS["naslovKraj"],
    davcnaStevilka:     map["davcnaStevilka"]     ?? DEFAULTS["davcnaStevilka"],
    idZaDdv:            map["idZaDdv"]            ?? DEFAULTS["idZaDdv"],
    poslovniProstor:    map["poslovniProstor"]    ?? DEFAULTS["poslovniProstor"],
    elektronskaNaprava: map["elektronskaNaprava"] ?? DEFAULTS["elektronskaNaprava"],
    ponudnikDavcna:     map["ponudnikDavcna"]     ?? DEFAULTS["ponudnikDavcna"],
    racunPozdrav1:      map["racunPozdrav1"]      ?? DEFAULTS["racunPozdrav1"],
    racunPozdrav2:      map["racunPozdrav2"]      ?? DEFAULTS["racunPozdrav2"],
    fursNacin:          ((map["fursNacin"] as "simulacija" | "testno" | "produkcija" | undefined)
      ?? ((map["testniNacin"] ?? "true") === "false" ? "produkcija" : "simulacija")),
    testniNacin:        (map["fursNacin"]
      ? map["fursNacin"] !== "produkcija"
      : (map["testniNacin"] ?? DEFAULTS["testniNacin"]) === "true"),
    offlineFiscalEnabled: (map["offlineFiscalEnabled"] ?? DEFAULTS["offlineFiscalEnabled"]) === "true",
    fursProxyUrl:       map["fursProxyUrl"]        ?? DEFAULTS["fursProxyUrl"],
    simulirajFursNapako: (map["simulirajFursNapako"] ?? "false") === "true",
    grupiranjeNacin: (map["grupiranjeNacin"] ?? "novo") as "izklopljeno" | "staro" | "novo",
    smtpHost:           map["smtpHost"]            ?? DEFAULTS["smtpHost"],
    smtpPort:           Number(map["smtpPort"]     ?? DEFAULTS["smtpPort"]),
    smtpUser:           map["smtpUser"]            ?? DEFAULTS["smtpUser"],
    smtpGesloNastavljeno: !!(map["smtpPassword"]),
    smtpFrom:           map["smtpFrom"]            ?? DEFAULTS["smtpFrom"],
    smtpAktiven:        (map["smtpAktiven"]        ?? DEFAULTS["smtpAktiven"]) === "true",
    izrednaIzdajaPINNastavljen: !!(map["izrednaIzdajaPINHash"]),
    ddvSplosnaSt:               Number(map["ddvSplosnaSt"]  ?? "22"),
    ddvNizjaSt:                 Number(map["ddvNizjaSt"]    ?? "9.5"),
    ddvZnizanaSt:               Number(map["ddvZnizanaSt"]  ?? "5"),
    prodajalecIban:             map["prodajalecIban"]        ?? "",
    prodajalecBic:              map["prodajalecBic"]         ?? "",
    racunMaticna:               map["racunMaticna"]          ?? "",
    racunSodisce:               map["racunSodisce"]          ?? "",
    racunKapital:               map["racunKapital"]          ?? "",
    racunDdvKlavzula:           map["racunDdvKlavzula"]      ?? "",
    racunZbirnaKlavzula:        (map["racunZbirnaKlavzula"]  ?? "false") === "true",
    racunPravnaKlavzula:        map["racunPravnaKlavzula"]   ?? "",
    happyHourOd:                map["happyHourOd"]           ?? "",
    happyHourDo:                map["happyHourDo"]           ?? "",
     happyHourPravila:           (() => {
       try {
         return normalizeHappyHourRules(JSON.parse(map["happyHourPravila"] ?? "[]"));
       } catch {
         return [];
       }
     })(),
    happyHourRocnoAktiven:      (map["happyHourRocnoAktiven"] ?? "auto") as "auto" | "on" | "off",
    dovoliNegativneZaloge:      (map["dovoliNegativneZaloge"] ?? "true") === "true",
    toGoTopliNapitekStopnja:    (map["toGoTopliNapitekStopnja"] ?? "konservativno") as "konservativno" | "liberalno",
    telefonNarocilaOsnovniCasMin: Number(map["telefonNarocilaOsnovniCasMin"] ?? DEFAULTS["telefonNarocilaOsnovniCasMin"]),
    telefonNarocilaCakalnaVrstaMin: Number(map["telefonNarocilaCakalnaVrstaMin"] ?? DEFAULTS["telefonNarocilaCakalnaVrstaMin"]),
    telefonNarocilaKapaciteta: Number(map["telefonNarocilaKapaciteta"] ?? DEFAULTS["telefonNarocilaKapaciteta"]),
    telefonNarocilaNajvecCasMin: Number(map["telefonNarocilaNajvecCasMin"] ?? DEFAULTS["telefonNarocilaNajvecCasMin"]),
    telefonNarocilaZaokrozevanjeMin: Number(map["telefonNarocilaZaokrozevanjeMin"] ?? DEFAULTS["telefonNarocilaZaokrozevanjeMin"]),
    telefonNarocilaPijacaOsnovniCasMin: Number(map["telefonNarocilaPijacaOsnovniCasMin"] ?? DEFAULTS["telefonNarocilaPijacaOsnovniCasMin"]),
    telefonNarocilaPijacaCakalnaVrstaMin: Number(map["telefonNarocilaPijacaCakalnaVrstaMin"] ?? DEFAULTS["telefonNarocilaPijacaCakalnaVrstaMin"]),
    telefonNarocilaPijacaKapaciteta: Number(map["telefonNarocilaPijacaKapaciteta"] ?? DEFAULTS["telefonNarocilaPijacaKapaciteta"]),
    telefonNarocilaPijacaNajvecCasMin: Number(map["telefonNarocilaPijacaNajvecCasMin"] ?? DEFAULTS["telefonNarocilaPijacaNajvecCasMin"]),
    telefonNarocilaPijacaZaokrozevanjeMin: Number(map["telefonNarocilaPijacaZaokrozevanjeMin"] ?? DEFAULTS["telefonNarocilaPijacaZaokrozevanjeMin"]),
    dostavaArtikelId: map["dostavaArtikelId"] ? Number(map["dostavaArtikelId"]) : null,
    picaPremerMala: Number(map["picaPremerMala"] ?? "0"),
    picaPremerNormalna: Number(map["picaPremerNormalna"] ?? "0"),
    picaPremerDruzinska: Number(map["picaPremerDruzinska"] ?? "0"),
    studentskiBonAktiven: (map["studentskiBonAktiven"] ?? "false") === "true",
    qrAiAsistentAktiven: (map["qrAiAsistentAktiven"] ?? "false") === "true",
    toastTocilnicaAktiven: (map["toastTocilnicaAktiven"] ?? "true") === "true",
    agentTiskalnikToken:        map["agentTiskalnikToken"]   ?? "",
    podjetjeTrr: (() => {
      try { return JSON.parse(map["__podjetjeTrr"] ?? "[]") as Array<{ iban: string; bic: string }>; }
      catch { return [] as Array<{ iban: string; bic: string }>; }
    })(),
    /** bizBox okolje: 'test' = demo.zzi.si (privzeto), 'prod' = ws.zzi.si */
    bizBoxOkolje:               (map["bizBoxOkolje"] ?? "test") as "test" | "prod",
    /** Ali sta poverilnici BIZBOX_USER in BIZBOX_PASS nastavljeni v okoljskih spremenljivkah */
    bizBoxKonfiguriran:         !!(process.env["BIZBOX_USER"] && process.env["BIZBOX_PASS"]),
  };
}

function toJavniOdgovor(map: Record<string, string>) {
  return toResponse(map);
}

router.get("/nastavitve/ddv-stopnje", async (_req, res): Promise<void> => {
  const globalRows = await db
    .select({ kljuc: nastavitveTable.kljuc, vrednost: nastavitveTable.vrednost })
    .from(nastavitveTable)
    .where(and(eq(nastavitveTable.enotaId, 0)));
  const m: Record<string, string> = {};
  for (const r of globalRows) m[r.kljuc] = r.vrednost;
  res.json({
    splosnaSt: Number(m["ddvSplosnaSt"]  ?? "22"),
    nizjaSt:   Number(m["ddvNizjaSt"]    ?? "9.5"),
    znizanaSt: Number(m["ddvZnizanaSt"]  ?? "5")});
});

router.get("/nastavitve", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const map = await readAll("", tenotaId);

  if (!map["agentTiskalnikToken"]) {
    const token = randomUUID();
    await db.insert(nastavitveTable).values({
 enotaId: tenotaId, kljuc: "agentTiskalnikToken", vrednost: token}).onConflictDoNothing();
    map["agentTiskalnikToken"] = token;
  }

  const [enota] = await db.select({ zacetekDnevaUra: enoteTable.zacetekDnevaUra, companyId: enoteTable.companyId })
    .from(enoteTable)
    .where(and(eq(enoteTable.id, tenotaId)));

  // Samodejno izpolni prazna polja iz podatkov podjetja (pri prvi prijavi admina)
  if (enota?.companyId) {
    const [company] = await db.select({
      naziv: companiesTable.naziv,
      podjetjeDavcna: companiesTable.podjetjeDavcna,
      idZaDdv: companiesTable.idZaDdv,
      naslov: companiesTable.naslov,
      ulica: companiesTable.ulica,
      postnaStevika: companiesTable.postnaStevika,
      kraj: companiesTable.kraj,
      maticnaStevilka: companiesTable.maticnaStevilka,
      trr: companiesTable.trr,
    }).from(companiesTable).where(eq(companiesTable.id, enota.companyId));

    if (company) {
      // Davčna številka — brez predpone SI
      if (!map["davcnaStevilka"]) map["davcnaStevilka"] = company.podjetjeDavcna.replace(/^SI/i, "");
      // ID za DDV
      if (!map["idZaDdv"] && company.idZaDdv) map["idZaDdv"] = company.idZaDdv;
      // Naziv podjetja
      if (!map["nazivRestavracije"]) map["nazivRestavracije"] = company.naziv;
      if (!map["nazivPodjetja"]) map["nazivPodjetja"] = company.naziv;
      // Naslov — ločena polja (ulica ima prednost pred starim kombiniranim naslov)
      const ulicaVrednost = company.ulica || company.naslov;
      if (!map["naslovUlica"] && ulicaVrednost) map["naslovUlica"] = ulicaVrednost;
      if (!map["naslovPostna"] && company.postnaStevika) map["naslovPostna"] = company.postnaStevika;
      if (!map["naslovKraj"] && company.kraj) map["naslovKraj"] = company.kraj;
      // Sestavljeni naslov za nazaj-kompatibilnost
      if (!map["naslovRestavracije"]) {
        const deli = [ulicaVrednost, company.postnaStevika && company.kraj ? `${company.postnaStevika} ${company.kraj}` : (company.kraj ?? "")].filter(Boolean);
        if (deli.length) map["naslovRestavracije"] = deli.join(", ");
      }
      // Negotovinsko plačilo — iz prvega TRR in matične številke podjetja (samo če je prazno)
      const prvTrr = company.trr?.[0];
      if (!map["prodajalecIban"] && prvTrr?.iban) map["prodajalecIban"] = prvTrr.iban;
      if (!map["prodajalecBic"] && prvTrr?.bic)  map["prodajalecBic"]  = prvTrr.bic;
      if (!map["racunMaticna"] && company.maticnaStevilka) map["racunMaticna"] = company.maticnaStevilka;
      // Shrani vse TRR-je podjetja za prikaz v selektorju
      if (company.trr?.length) map["__podjetjeTrr"] = JSON.stringify(company.trr);
      // Davčna ponudnika — fallback iz davčne podjetja (brez SI predpone)
      if (!map["ponudnikDavcna"]) map["ponudnikDavcna"] = company.podjetjeDavcna.replace(/^SI/i, "");
    }
  }

  // Samodejno izpolni davčno ERP ponudnika iz env var (ima prednost pred company fallback)
  if (process.env.ERP_PONUDNIK_DAVCNA) {
    map["ponudnikDavcna"] = process.env.ERP_PONUDNIK_DAVCNA;
  }

  // Per-podjetje bizBox konfiguracija — preverimo DB (ločeno od env fallback)
  let bizBoxDbKonfiguriran = false;
  if (enota?.companyId) {
    const [bbRow] = await db
      .select({ companyId: bizboxNastavitveTable.companyId })
      .from(bizboxNastavitveTable)
      .where(eq(bizboxNastavitveTable.companyId, enota.companyId));
    bizBoxDbKonfiguriran = !!bbRow;
  }

  res.setHeader("Cache-Control", "no-store, max-age=0");
  res.json({
    ...(toJavniOdgovor(map)),
    zacetekDnevaUra: enota?.zacetekDnevaUra ?? "04:00",
    // Per-podjetje DB ima prednost; env spremenljivki sta fallback za nazaj-kompatibilnost
    bizBoxKonfiguriran: bizBoxDbKonfiguriran || !!(process.env["BIZBOX_USER"] && process.env["BIZBOX_PASS"]),
    bizBoxDbKonfiguriran,
  });
});

router.put("/nastavitve", requireAdmin, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }
  if ((parsed.data as { offlineFiscalEnabled?: unknown }).offlineFiscalEnabled !== undefined
      && typeof (parsed.data as { offlineFiscalEnabled?: unknown }).offlineFiscalEnabled !== "boolean") {
    res.status(400).json({ error: "Nastavitev offline delovanja mora biti logična vrednost." });
    return;
  }

  const fursNacinNew = (parsed.data as { fursNacin?: string }).fursNacin as "simulacija" | "testno" | "produkcija" | undefined;
  const fursNacinVal: "simulacija" | "testno" | "produkcija" = fursNacinNew
    ?? (parsed.data.testniNacin === false ? "produkcija" : "simulacija");

  const updates: Record<string, string> = {
    nazivRestavracije:  parsed.data.nazivRestavracije,
    naslovRestavracije: parsed.data.naslovRestavracije,
    naslovUlica:        (parsed.data as { naslovUlica?: string }).naslovUlica ?? "",
    naslovPostna:       (parsed.data as { naslovPostna?: string }).naslovPostna ?? "",
    naslovKraj:         (parsed.data as { naslovKraj?: string }).naslovKraj ?? "",
    davcnaStevilka:     parsed.data.davcnaStevilka,
    idZaDdv:            (parsed.data as { idZaDdv?: string }).idZaDdv ?? "",
    poslovniProstor:    parsed.data.poslovniProstor,
    elektronskaNaprava: parsed.data.elektronskaNaprava,
    ponudnikDavcna:     parsed.data.ponudnikDavcna ?? "",
    racunPozdrav1:      parsed.data.racunPozdrav1 ?? DEFAULTS["racunPozdrav1"]!,
    racunPozdrav2:      parsed.data.racunPozdrav2 ?? DEFAULTS["racunPozdrav2"]!,
    fursNacin:          fursNacinVal,
    testniNacin:        String(fursNacinVal !== "produkcija"),
    fursProxyUrl:       parsed.data.fursProxyUrl ?? "",
    simulirajFursNapako: String((parsed.data as { simulirajFursNapako?: boolean }).simulirajFursNapako ?? false),
    grupiranjeNacin: (parsed.data as { grupiranjeNacin?: string }).grupiranjeNacin ?? "novo",
    smtpHost:           (parsed.data as { smtpHost?: string }).smtpHost ?? "",
    smtpPort:           String((parsed.data as { smtpPort?: number }).smtpPort ?? 465),
    smtpUser:           (parsed.data as { smtpUser?: string }).smtpUser ?? "",
    ...(((parsed.data as { smtpPassword?: string }).smtpPassword ?? "") !== ""
      ? { smtpPassword: (parsed.data as { smtpPassword?: string }).smtpPassword! }
      : {}),
    smtpFrom:           (parsed.data as { smtpFrom?: string }).smtpFrom ?? "",
    smtpAktiven:        String((parsed.data as { smtpAktiven?: boolean }).smtpAktiven ?? false),
    prodajalecIban:     (parsed.data as { prodajalecIban?: string }).prodajalecIban ?? "",
    prodajalecBic:      (parsed.data as { prodajalecBic?: string }).prodajalecBic ?? "",
    racunMaticna:       (parsed.data as { racunMaticna?: string }).racunMaticna ?? "",
    racunSodisce:       (parsed.data as { racunSodisce?: string }).racunSodisce ?? "",
    racunKapital:       (parsed.data as { racunKapital?: string }).racunKapital ?? "",
    racunDdvKlavzula:   (parsed.data as { racunDdvKlavzula?: string }).racunDdvKlavzula ?? "",
    racunZbirnaKlavzula: String((parsed.data as { racunZbirnaKlavzula?: boolean }).racunZbirnaKlavzula ?? false),
    racunPravnaKlavzula: (parsed.data as { racunPravnaKlavzula?: string }).racunPravnaKlavzula ?? "",
    dovoliNegativneZaloge: String((parsed.data as { dovoliNegativneZaloge?: boolean }).dovoliNegativneZaloge ?? true),
    bizBoxOkolje: (parsed.data as { bizBoxOkolje?: string }).bizBoxOkolje === "prod" ? "prod" : "test",
    ...((parsed.data as { studentskiBonAktiven?: boolean }).studentskiBonAktiven !== undefined
      ? { studentskiBonAktiven: String((parsed.data as { studentskiBonAktiven: boolean }).studentskiBonAktiven) }
      : {}),
    qrAiAsistentAktiven: String((parsed.data as { qrAiAsistentAktiven?: boolean }).qrAiAsistentAktiven ?? false),
    toastTocilnicaAktiven: String((parsed.data as { toastTocilnicaAktiven?: boolean }).toastTocilnicaAktiven ?? true),
    ...((parsed.data as { offlineFiscalEnabled?: boolean }).offlineFiscalEnabled !== undefined
      ? { offlineFiscalEnabled: String((parsed.data as { offlineFiscalEnabled: boolean }).offlineFiscalEnabled) }
      : {}),
  };

  const pizzaPremeri = [
    ["picaPremerMala", (parsed.data as { picaPremerMala?: number }).picaPremerMala],
    ["picaPremerNormalna", (parsed.data as { picaPremerNormalna?: number }).picaPremerNormalna],
    ["picaPremerDruzinska", (parsed.data as { picaPremerDruzinska?: number }).picaPremerDruzinska],
  ] as const;
  for (const [kljuc, premer] of pizzaPremeri) {
    if (premer === undefined) continue;
    if (!Number.isFinite(premer) || premer < 0 || premer > 100) {
      res.status(400).json({ error: "Premer pice mora biti število med 0 in 100 cm." });
      return;
    }
    updates[kljuc] = String(premer);
  }

  const telefonNastavitve = [
    ["telefonNarocilaOsnovniCasMin", (parsed.data as { telefonNarocilaOsnovniCasMin?: number }).telefonNarocilaOsnovniCasMin, 1, 120],
    ["telefonNarocilaCakalnaVrstaMin", (parsed.data as { telefonNarocilaCakalnaVrstaMin?: number }).telefonNarocilaCakalnaVrstaMin, 0, 60],
    ["telefonNarocilaKapaciteta", (parsed.data as { telefonNarocilaKapaciteta?: number }).telefonNarocilaKapaciteta, 1, 50],
    ["telefonNarocilaNajvecCasMin", (parsed.data as { telefonNarocilaNajvecCasMin?: number }).telefonNarocilaNajvecCasMin, 5, 240],
    ["telefonNarocilaZaokrozevanjeMin", (parsed.data as { telefonNarocilaZaokrozevanjeMin?: number }).telefonNarocilaZaokrozevanjeMin, 0, 60],
    ["telefonNarocilaPijacaOsnovniCasMin", (parsed.data as { telefonNarocilaPijacaOsnovniCasMin?: number }).telefonNarocilaPijacaOsnovniCasMin, 1, 120],
    ["telefonNarocilaPijacaCakalnaVrstaMin", (parsed.data as { telefonNarocilaPijacaCakalnaVrstaMin?: number }).telefonNarocilaPijacaCakalnaVrstaMin, 0, 60],
    ["telefonNarocilaPijacaKapaciteta", (parsed.data as { telefonNarocilaPijacaKapaciteta?: number }).telefonNarocilaPijacaKapaciteta, 1, 50],
    ["telefonNarocilaPijacaNajvecCasMin", (parsed.data as { telefonNarocilaPijacaNajvecCasMin?: number }).telefonNarocilaPijacaNajvecCasMin, 5, 240],
    ["telefonNarocilaPijacaZaokrozevanjeMin", (parsed.data as { telefonNarocilaPijacaZaokrozevanjeMin?: number }).telefonNarocilaPijacaZaokrozevanjeMin, 0, 60],
  ] as const;
  for (const [kljuc, value, min, max] of telefonNastavitve) {
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < min || value > max) {
      res.status(400).json({ error: "Nastavitve telefonskih naročil morajo biti cela števila v dovoljenem območju." });
      return;
    }
    updates[kljuc] = String(value);
  }

  const dostavaArtikelId = (parsed.data as { dostavaArtikelId?: number | null }).dostavaArtikelId;
  if (dostavaArtikelId !== undefined) {
    if (dostavaArtikelId == null) {
      updates["dostavaArtikelId"] = "";
    } else if (!Number.isInteger(dostavaArtikelId) || dostavaArtikelId <= 0) {
      res.status(400).json({ error: "Dostavni artikel mora biti veljaven artikel storitve." });
      return;
    } else {
      const [artikel] = await db.select({ id: artikliTable.id })
        .from(artikliTable)
        .where(and(
          eq(artikliTable.id, dostavaArtikelId),
          eq(artikliTable.enotaId, tenotaId),
          eq(artikliTable.aktiven, true),
          eq(artikliTable.vrstaArtikla, "storitev"),
        ));
      if (!artikel) {
        res.status(400).json({ error: "Dostavni artikel mora biti aktiven artikel vrste storitev iz izbrane enote." });
        return;
      }
      updates["dostavaArtikelId"] = String(dostavaArtikelId);
    }
  }

  const novPin = (parsed.data as { izrednaIzdajaPIN?: string }).izrednaIzdajaPIN;
  if (novPin && novPin.length >= 4) {
    updates["izrednaIzdajaPINHash"] = await (await import("bcryptjs")).default.hash(novPin, 10);
  }

  for (const [kljuc, vrednost] of Object.entries(updates)) {
    // FURS ključi se shranjujejo na nivoju podjetja (enota_id=0), ostali per-enota
    const targetEnotaId = FURS_KLJUCI_PO_PODJETJU.has(kljuc) ? 0 : tenotaId;
    const existing = await db
      .select()
      .from(nastavitveTable)
      .where(and(eq(nastavitveTable.enotaId, targetEnotaId),
        eq(nastavitveTable.kljuc, kljuc)
      ));

    if (existing.length > 0) {
      await db
        .update(nastavitveTable)
        .set({ vrednost })
        .where(and(eq(nastavitveTable.enotaId, targetEnotaId),
          eq(nastavitveTable.kljuc, kljuc)
        ));
    } else {
      await db.insert(nastavitveTable).values({
 enotaId: targetEnotaId, kljuc, vrednost });
    }
  }

  const map = await readAll("", tenotaId);
  res.json(toJavniOdgovor(map));
});

// ── Happy Hour ──────────────────────────────────────────────────────────────
function parseJsonOrEmptyArray(value: string | undefined): unknown[] {
  try {
    const parsed = JSON.parse(value ?? "[]");
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

interface HappyHourArtikelZaStatus {
  id: number;
  jePica: boolean;
  happyHourCena: string | number | null;
  happyHourCenaMala: string | number | null;
  happyHourCenaDruzinska: string | number | null;
}

function izracunajHappyHourStatus(
  artikli: HappyHourArtikelZaStatus[],
  rules: HappyHourPravilo[],
  rocno: string,
): {
  aktivniArtikelIds: number[];
  aktivneVelikostiPice: Record<string, HappyHourVelikostPice[]>;
} {
  const aktivniArtikelIds: number[] = [];
  const aktivneVelikostiPice: Record<string, HappyHourVelikostPice[]> = {};

  for (const artikel of artikli) {
    if (!artikel.jePica) {
      if (artikel.happyHourCena != null && isHappyHourActiveForArticle(rules, artikel.id, rocno)) {
        aktivniArtikelIds.push(artikel.id);
      }
      continue;
    }

    const razpolozljiveVelikosti: HappyHourVelikostPice[] = [
      ...(artikel.happyHourCenaMala != null ? ["mala" as const] : []),
      ...(artikel.happyHourCena != null ? ["normalna" as const] : []),
      ...(artikel.happyHourCenaDruzinska != null ? ["druzinska" as const] : []),
    ];
    const aktivneVelikosti = razpolozljiveVelikosti.filter((velikost) =>
      isHappyHourActiveForArticle(rules, artikel.id, rocno, new Date(), velikost)
    );
    if (aktivneVelikosti.length > 0) {
      aktivniArtikelIds.push(artikel.id);
      aktivneVelikostiPice[String(artikel.id)] = aktivneVelikosti;
    }
  }

  return { aktivniArtikelIds, aktivneVelikostiPice };
}

router.get("/happy-hour", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const map = await readAll("", tenotaId);
  const rocno = map["happyHourRocnoAktiven"] ?? "auto";
  const artikli = await db.select({
    id: artikliTable.id,
    jePica: artikliTable.jePica,
    happyHourCena: artikliTable.happyHourCena,
    happyHourCenaMala: artikliTable.happyHourCenaMala,
    happyHourCenaDruzinska: artikliTable.happyHourCenaDruzinska,
  })
    .from(artikliTable)
    .where(and(eq(artikliTable.enotaId, tenotaId), eq(artikliTable.aktiven, true)));
  const rules = parseHappyHourRules(
    parseJsonOrEmptyArray(map["happyHourPravila"]),
    map["happyHourOd"] ?? "",
    map["happyHourDo"] ?? "",
    artikli.map((artikel) => artikel.id),
  );
  const activeRules = rules.filter((rule) =>
    isHappyHourActiveForArticle([rule], rule.artikelIds[0] ?? 0, "auto")
  );
  const statusRule = activeRules[0] ?? rules[0];
  const hhStatus = izracunajHappyHourStatus(artikli, rules, rocno);
  res.setHeader("Cache-Control", "no-store");
  res.json({
    aktiven: hhStatus.aktivniArtikelIds.length > 0,
    od: statusRule?.od ?? "",
    do: statusRule?.do ?? "",
    rocno,
    pravila: rules,
    aktivnaPravila: activeRules.map((rule) => rule.id),
    aktivniArtikelIds: hhStatus.aktivniArtikelIds,
    aktivneVelikostiPice: hhStatus.aktivneVelikostiPice,
  });
});

router.patch("/nastavitve/happy-hour-urnik", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const { happyHourOd, happyHourDo, pravila } = req.body as {
    happyHourOd?: string;
    happyHourDo?: string;
    pravila?: unknown;
  };
  if (pravila !== undefined) {
    if (!Array.isArray(pravila)) {
      res.status(400).json({ error: "Happy Hour pravila morajo biti seznam." });
      return;
    }
    const rules = normalizeHappyHourRules(pravila);
    if (rules.length !== pravila.length) {
      res.status(400).json({ error: "Eno ali več Happy Hour pravil ima neveljavne podatke." });
      return;
    }
    const vrednost = JSON.stringify(rules);
    const [existing] = await db.select({ id: nastavitveTable.id })
      .from(nastavitveTable)
      .where(and(eq(nastavitveTable.enotaId, tenotaId), eq(nastavitveTable.kljuc, "happyHourPravila")));
    if (existing) {
      await db.update(nastavitveTable).set({ vrednost }).where(eq(nastavitveTable.id, existing.id));
    } else {
      await db.insert(nastavitveTable).values({ enotaId: tenotaId, kljuc: "happyHourPravila", vrednost });
    }
    // Stari ključi ostanejo prazni, da jih stare stranke ne uporabijo vzporedno.
    for (const kljuc of ["happyHourOd", "happyHourDo"]) {
      await db.update(nastavitveTable).set({ vrednost: "" })
        .where(and(eq(nastavitveTable.enotaId, tenotaId), eq(nastavitveTable.kljuc, kljuc)));
    }
    res.json({ ok: true, pravila: rules });
    return;
  }

  for (const [kljuc, vrednost] of Object.entries({ happyHourOd: happyHourOd ?? "", happyHourDo: happyHourDo ?? "" })) {
    const existing = await db.select().from(nastavitveTable).where(and(eq(nastavitveTable.enotaId, tenotaId), eq(nastavitveTable.kljuc, kljuc)));
    if (existing.length > 0) {
      await db.update(nastavitveTable).set({ vrednost }).where(and(eq(nastavitveTable.enotaId, tenotaId), eq(nastavitveTable.kljuc, kljuc)));
    } else {
      await db.insert(nastavitveTable).values({ enotaId: tenotaId, kljuc, vrednost });
    }
  }
  res.json({ ok: true });
});

router.patch("/happy-hour", requireEnota, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const { rocno } = req.body as { rocno?: "auto" | "on" | "off" };
  if (!["auto", "on", "off"].includes(rocno ?? "")) { res.status(400).json({ error: "Neveljavna vrednost" }); return; }
  const kljuc = "happyHourRocnoAktiven"; const vrednost = rocno!;
  const existing = await db.select().from(nastavitveTable).where(and(eq(nastavitveTable.enotaId, tenotaId), eq(nastavitveTable.kljuc, kljuc)));
  if (existing.length > 0) {
    await db.update(nastavitveTable).set({ vrednost }).where(and(eq(nastavitveTable.enotaId, tenotaId), eq(nastavitveTable.kljuc, kljuc)));
  } else {
    await db.insert(nastavitveTable).values({ enotaId: tenotaId, kljuc, vrednost });
  }
  const map = await readAll("", tenotaId);
  const artikli = await db.select({
    id: artikliTable.id,
    jePica: artikliTable.jePica,
    happyHourCena: artikliTable.happyHourCena,
    happyHourCenaMala: artikliTable.happyHourCenaMala,
    happyHourCenaDruzinska: artikliTable.happyHourCenaDruzinska,
  })
    .from(artikliTable)
    .where(and(eq(artikliTable.enotaId, tenotaId), eq(artikliTable.aktiven, true)));
  const rules = parseHappyHourRules(
    parseJsonOrEmptyArray(map["happyHourPravila"]),
    map["happyHourOd"] ?? "",
    map["happyHourDo"] ?? "",
    artikli.map((artikel) => artikel.id),
  );
  const activeRules = rules.filter((rule) =>
    isHappyHourActiveForArticle([rule], rule.artikelIds[0] ?? 0, "auto")
  );
  const activeRule = activeRules[0] ?? rules[0];
  const hhStatus = izracunajHappyHourStatus(artikli, rules, vrednost);
  res.json({
    aktiven: hhStatus.aktivniArtikelIds.length > 0,
    od: activeRule?.od ?? "",
    do: activeRule?.do ?? "",
    rocno: vrednost,
    pravila: rules,
    aktivnaPravila: activeRules.map((rule) => rule.id),
    aktivniArtikelIds: hhStatus.aktivniArtikelIds,
    aktivneVelikostiPice: hhStatus.aktivneVelikostiPice,
  });
});

router.patch("/nastavitve/grupiranje", requireAdminEnote, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const { grupiranjeNacin } = req.body as { grupiranjeNacin?: string };
  if (!["izklopljeno", "staro", "novo"].includes(grupiranjeNacin ?? "")) {
    res.status(400).json({ error: "Neveljavna vrednost grupiranjeNacin" });
    return;
  }
  const kljuc = "grupiranjeNacin";
  const vrednost = grupiranjeNacin!;
  const existing = await db.select().from(nastavitveTable).where(
    and(eq(nastavitveTable.enotaId, tenotaId), eq(nastavitveTable.kljuc, kljuc))
  );
  if (existing.length > 0) {
    await db.update(nastavitveTable).set({ vrednost }).where(
      and(eq(nastavitveTable.enotaId, tenotaId), eq(nastavitveTable.kljuc, kljuc))
    );
  } else {
    await db.insert(nastavitveTable).values({
 enotaId: tenotaId, kljuc, vrednost });
  }
  res.json({ ok: true });
});

router.patch("/nastavitve/telefon-narocila", requireAdminEnote, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const body = req.body as Partial<{
    osnovniCasMin: number;
    cakalnaVrstaMin: number;
    kapaciteta: number;
    najvecCasMin: number;
    zaokrozevanjeMin?: number;
    pijacaOsnovniCasMin: number;
    pijacaCakalnaVrstaMin: number;
    pijacaKapaciteta: number;
    pijacaNajvecCasMin: number;
    pijacaZaokrozevanjeMin?: number;
  }>;
  const values = [
    ["telefonNarocilaOsnovniCasMin", body.osnovniCasMin, 1, 120],
    ["telefonNarocilaCakalnaVrstaMin", body.cakalnaVrstaMin, 0, 60],
    ["telefonNarocilaKapaciteta", body.kapaciteta, 1, 50],
    ["telefonNarocilaNajvecCasMin", body.najvecCasMin, 5, 240],
    ...(body.zaokrozevanjeMin !== undefined ? [["telefonNarocilaZaokrozevanjeMin", body.zaokrozevanjeMin, 0, 60] as const] : []),
    ["telefonNarocilaPijacaOsnovniCasMin", body.pijacaOsnovniCasMin, 1, 120],
    ["telefonNarocilaPijacaCakalnaVrstaMin", body.pijacaCakalnaVrstaMin, 0, 60],
    ["telefonNarocilaPijacaKapaciteta", body.pijacaKapaciteta, 1, 50],
    ["telefonNarocilaPijacaNajvecCasMin", body.pijacaNajvecCasMin, 5, 240],
    ...(body.pijacaZaokrozevanjeMin !== undefined ? [["telefonNarocilaPijacaZaokrozevanjeMin", body.pijacaZaokrozevanjeMin, 0, 60] as const] : []),
  ] as const;

  for (const [, value, min, max] of values) {
    if (!Number.isInteger(value) || value! < min || value! > max) {
      res.status(400).json({ error: `Nastavitve telefonskih naročil morajo biti cela števila v dovoljenem območju.` });
      return;
    }
  }

  for (const [kljuc, value] of values) {
    const [existing] = await db.select({ kljuc: nastavitveTable.kljuc })
      .from(nastavitveTable)
      .where(and(eq(nastavitveTable.enotaId, tenotaId), eq(nastavitveTable.kljuc, kljuc)));
    if (existing) {
      await db.update(nastavitveTable).set({ vrednost: String(value) })
        .where(and(eq(nastavitveTable.enotaId, tenotaId), eq(nastavitveTable.kljuc, kljuc)));
    } else {
      await db.insert(nastavitveTable).values({ enotaId: tenotaId, kljuc, vrednost: String(value) });
    }
  }

  const map = await readAll("", tenotaId);
  res.json({
    osnovniCasMin: Number(map["telefonNarocilaOsnovniCasMin"]),
    cakalnaVrstaMin: Number(map["telefonNarocilaCakalnaVrstaMin"]),
    kapaciteta: Number(map["telefonNarocilaKapaciteta"]),
    najvecCasMin: Number(map["telefonNarocilaNajvecCasMin"]),
    zaokrozevanjeMin: Number(map["telefonNarocilaZaokrozevanjeMin"]),
    pijacaOsnovniCasMin: Number(map["telefonNarocilaPijacaOsnovniCasMin"]),
    pijacaCakalnaVrstaMin: Number(map["telefonNarocilaPijacaCakalnaVrstaMin"]),
    pijacaKapaciteta: Number(map["telefonNarocilaPijacaKapaciteta"]),
    pijacaNajvecCasMin: Number(map["telefonNarocilaPijacaNajvecCasMin"]),
    pijacaZaokrozevanjeMin: Number(map["telefonNarocilaPijacaZaokrozevanjeMin"]),
  });
});

router.patch("/nastavitve/ddv-razresevalnik", requireAdminEnote, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const { toGoTopliNapitekStopnja } = req.body as { toGoTopliNapitekStopnja?: string };
  if (!["konservativno", "liberalno"].includes(toGoTopliNapitekStopnja ?? "")) {
    res.status(400).json({ error: "Neveljavna vrednost toGoTopliNapitekStopnja" });
    return;
  }
  const kljuc = "toGoTopliNapitekStopnja";
  const vrednost = toGoTopliNapitekStopnja!;
  const existing = await db.select().from(nastavitveTable).where(
    and(eq(nastavitveTable.enotaId, tenotaId), eq(nastavitveTable.kljuc, kljuc))
  );
  if (existing.length > 0) {
    await db.update(nastavitveTable).set({ vrednost }).where(
      and(eq(nastavitveTable.enotaId, tenotaId), eq(nastavitveTable.kljuc, kljuc))
    );
  } else {
    await db.insert(nastavitveTable).values({ enotaId: tenotaId, kljuc, vrednost });
  }
  res.json({ ok: true });
});

router.post("/nastavitve/email-test", requireAdmin, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const { prejemnik } = req.body as { prejemnik?: string };
  if (!prejemnik || typeof prejemnik !== "string" || !prejemnik.includes("@")) {
    res.status(400).json({ uspeh: false, napaka: "Neveljavni e-poštni naslov prejemnika" });
    return;
  }
  const map = await readAll("", tenotaId);
  const nastavitve = toResponse(map);
  const smtp = {
    smtpHost: nastavitve.smtpHost,
    smtpPort: nastavitve.smtpPort,
    smtpUser: nastavitve.smtpUser,
    smtpPassword: map["smtpPassword"] ?? "",
    smtpFrom: nastavitve.smtpFrom,
    smtpAktiven: true};
  const rezultat = await posljiTestnoEmail(
    smtp, prejemnik, nastavitve.nazivRestavracije, await loadUnitEmailSender(tenotaId),
  );
  res.json(rezultat);
});

router.post("/nastavitve/furs-echo", requireAdmin, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const map = await readAll("", tenotaId);
  const nastavitve = toResponse(map);
  const companyCert = await pridobiCompanyCert((req as import("../../middlewares/pos").PosRequest).companyId);
  if (nastavitve.fursNacin !== "simulacija" && !companyCert) {
    res.status(400).json({ uspeh: false, napaka: "FURS certifikat ni naložen za to podjetje — naložite ga v Podjetje/FURS." });
    return;
  }
  const odgovor = await fursSOAPEcho(
    nastavitve.fursNacin,
    nastavitve.fursProxyUrl || undefined,
    companyCert?.certPem,
    companyCert?.certKljuc
  );
  res.json(odgovor);
});

export default router;
/**
 * Naloži nastavitve + samodejno dopolni prazna polja iz podatkov podjetja.
 * Enaka logika kot GET /nastavitve handler — za uporabo v tiskovnih endpointih.
 */
async function readAllWithFallback(enotaId: number): Promise<Record<string, string>> {
  const map = await readAll("", enotaId);

  const [enota] = await db
    .select({ companyId: enoteTable.companyId })
    .from(enoteTable)
    .where(eq(enoteTable.id, enotaId));

  if (enota?.companyId) {
    const [company] = await db.select({
      naziv: companiesTable.naziv,
      podjetjeDavcna: companiesTable.podjetjeDavcna,
      naslov: companiesTable.naslov,
      postnaStevika: companiesTable.postnaStevika,
      kraj: companiesTable.kraj,
      maticnaStevilka: companiesTable.maticnaStevilka,
      trr: companiesTable.trr,
    }).from(companiesTable).where(eq(companiesTable.id, enota.companyId));

    if (company) {
      if (!map["davcnaStevilka"]) map["davcnaStevilka"] = company.podjetjeDavcna.replace(/^SI/i, "");
      if (!map["nazivRestavracije"]) map["nazivRestavracije"] = company.naziv;
      if (!map["nazivPodjetja"]) map["nazivPodjetja"] = company.naziv;
      if (!map["naslovUlica"] && company.naslov) map["naslovUlica"] = company.naslov;
      if (!map["naslovPostna"] && company.postnaStevika) map["naslovPostna"] = company.postnaStevika;
      if (!map["naslovKraj"] && company.kraj) map["naslovKraj"] = company.kraj;
      if (!map["naslovRestavracije"]) {
        const deli = [company.naslov, company.postnaStevika && company.kraj ? `${company.postnaStevika} ${company.kraj}` : (company.kraj ?? "")].filter(Boolean);
        if (deli.length) map["naslovRestavracije"] = deli.join(", ");
      }
      const prvTrr = company.trr?.[0];
      if (!map["prodajalecIban"] && prvTrr?.iban) map["prodajalecIban"] = prvTrr.iban;
      if (!map["prodajalecBic"] && prvTrr?.bic)  map["prodajalecBic"]  = prvTrr.bic;
      if (!map["racunMaticna"] && company.maticnaStevilka) map["racunMaticna"] = company.maticnaStevilka;
    }
  }

  return map;
}

export { readAll, readAllWithFallback, toResponse };
