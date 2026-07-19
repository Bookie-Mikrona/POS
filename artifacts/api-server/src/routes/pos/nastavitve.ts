import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, ne } from "drizzle-orm";
import { db, enoteTable, nastavitveTable } from "@workspace/db";
import { requireEnota } from "../../middlewares/pos";
import { fursSOAPEcho } from "../../lib/pos-furs";
import { randomUUID } from "node:crypto";
import { posljiTestnoEmail } from "../../lib/pos-email";

const requireAdmin = requireEnota;
const requireAdminEnote = requireEnota;

const router: IRouter = Router();

const DEFAULTS: Record<string, string> = {
  nazivRestavracije:   "Restavracija",
  naslovRestavracije:  "",
  nazivPodjetja:       "",
  naslovPodjetja:      "",
  davcnaStevilka:      "12345678",
  poslovniProstor:     "PP001",
  elektronskaNaprava:  "B001",
  ponudnikDavcna:      "",
  certifikatPot:       "",
  certifikatGeslo:     "",
  certifikatPem:       "",
  certifikatKljuc:     "",
  racunPozdrav1:       "Hvala za obisk!",
  racunPozdrav2:       "Vracamo se — se vidimo.",
  testniNacin:         "true",
  fursNacin:           "simulacija",
  fursProxyUrl:        "",
  simulirajFursNapako: "false",
  grupiranjeNacin:     "novo",
  smtpHost:            "",
  smtpPort:            "587",
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
  racunPravnaKlavzula:        ""};

/**
 * Ključi, ki so shranjeni na nivoju podjetja (enota_id=0, podjetje_davcna=X).
 * Certifikat, FURS način in PP/BB kode veljajo za celotno podjetje, ne posamezno enoto.
 */
const FURS_KLJUCI_PO_PODJETJU = new Set([
  "certifikatPem",
  "certifikatKljuc",
  "certifikatPot",
  "certifikatGeslo",
  "poslovniProstor",
  "elektronskaNaprava",
  "testniNacin",
  "fursNacin",
  "fursProxyUrl",
  "simulirajFursNapako",
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
      k => !enotaKljuci.has(k) && !FURS_KLJUCI_PO_PODJETJU.has(k)
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
    davcnaStevilka:     map["davcnaStevilka"]     ?? DEFAULTS["davcnaStevilka"],
    poslovniProstor:    map["poslovniProstor"]    ?? DEFAULTS["poslovniProstor"],
    elektronskaNaprava: map["elektronskaNaprava"] ?? DEFAULTS["elektronskaNaprava"],
    ponudnikDavcna:     map["ponudnikDavcna"]     ?? DEFAULTS["ponudnikDavcna"],
    certifikatPot:      map["certifikatPot"]      ?? DEFAULTS["certifikatPot"],
    certifikatGeslo:    map["certifikatGeslo"]    ?? DEFAULTS["certifikatGeslo"],
    certifikatNaložen:  !!(map["certifikatPem"] && map["certifikatKljuc"]),
    racunPozdrav1:      map["racunPozdrav1"]      ?? DEFAULTS["racunPozdrav1"],
    racunPozdrav2:      map["racunPozdrav2"]      ?? DEFAULTS["racunPozdrav2"],
    fursNacin:          ((map["fursNacin"] as "simulacija" | "testno" | "produkcija" | undefined)
      ?? ((map["testniNacin"] ?? "true") === "false" ? "produkcija" : "simulacija")),
    testniNacin:        (map["fursNacin"]
      ? map["fursNacin"] !== "produkcija"
      : (map["testniNacin"] ?? DEFAULTS["testniNacin"]) === "true"),
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
    agentTiskalnikToken:        map["agentTiskalnikToken"]   ?? ""};
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

  const [enota] = await db.select({ zacetekDnevaUra: enoteTable.zacetekDnevaUra })
    .from(enoteTable)
    .where(and(eq(enoteTable.id, tenotaId)));
  res.json({ ...(toResponse(map)), zacetekDnevaUra: enota?.zacetekDnevaUra ?? "04:00" });
});

router.put("/nastavitve", requireAdmin, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const fursNacinNew = (parsed.data as { fursNacin?: string }).fursNacin as "simulacija" | "testno" | "produkcija" | undefined;
  const fursNacinVal: "simulacija" | "testno" | "produkcija" = fursNacinNew
    ?? (parsed.data.testniNacin === false ? "produkcija" : "simulacija");

  const updates: Record<string, string> = {
    nazivRestavracije:  parsed.data.nazivRestavracije,
    naslovRestavracije: parsed.data.naslovRestavracije,
    davcnaStevilka:     parsed.data.davcnaStevilka,
    poslovniProstor:    parsed.data.poslovniProstor,
    elektronskaNaprava: parsed.data.elektronskaNaprava,
    ponudnikDavcna:     parsed.data.ponudnikDavcna ?? "",
    certifikatPot:      parsed.data.certifikatPot ?? "",
    certifikatGeslo:    parsed.data.certifikatGeslo ?? "",
    racunPozdrav1:      parsed.data.racunPozdrav1 ?? DEFAULTS["racunPozdrav1"]!,
    racunPozdrav2:      parsed.data.racunPozdrav2 ?? DEFAULTS["racunPozdrav2"]!,
    fursNacin:          fursNacinVal,
    testniNacin:        String(fursNacinVal !== "produkcija"),
    fursProxyUrl:       parsed.data.fursProxyUrl ?? "",
    simulirajFursNapako: String((parsed.data as { simulirajFursNapako?: boolean }).simulirajFursNapako ?? false),
    grupiranjeNacin: (parsed.data as { grupiranjeNacin?: string }).grupiranjeNacin ?? "novo",
    smtpHost:           (parsed.data as { smtpHost?: string }).smtpHost ?? "",
    smtpPort:           String((parsed.data as { smtpPort?: number }).smtpPort ?? 587),
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
    racunPravnaKlavzula: (parsed.data as { racunPravnaKlavzula?: string }).racunPravnaKlavzula ?? ""};

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
  res.json((toResponse(map)));
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
  const rezultat = await posljiTestnoEmail(smtp, prejemnik, nastavitve.nazivRestavracije);
  res.json(rezultat);
});

router.post("/nastavitve/furs-echo", requireAdmin, async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const map = await readAll("", tenotaId);
  const nastavitve = toResponse(map);
  const certPot = nastavitve.certifikatPot || "";
  const certPem = map["certifikatPem"] || undefined;
  const certKljuc = map["certifikatKljuc"] || undefined;
  if (nastavitve.fursNacin !== "simulacija" && !certPot && !(certPem && certKljuc)) {
    res.status(400).json({ uspeh: false, napaka: "Certifikat ni nastavljen (naložite .p12 prek vmesnika)" });
    return;
  }
  const odgovor = await fursSOAPEcho(
    certPot,
    nastavitve.fursNacin,
    nastavitve.certifikatGeslo || undefined,
    nastavitve.fursProxyUrl || undefined,
    certPem,
    certKljuc
  );
  res.json(odgovor);
});

export default router;
export { readAll, toResponse };
