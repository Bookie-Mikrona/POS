import { Router, type IRouter, type Request, type Response } from "express";
import { and, desc, eq, inArray, isNull, ne, or, sql, sum } from "drizzle-orm";
import { blagajneTable, db, izmeneTable, mizeTable, modNormativiTable, narocilaTable, natakariTable, normativiTable, partnerCenikiTable, postavkeTable, racuniTable, vivaVracilaTable, zalogaGibiTable } from "@workspace/db";
import { broadcast } from "../../lib/pos-sse";
import { recomputeZaloge } from "../../lib/pos-zaloge-utils";
import { izracunajDDVZaokrozen, izracunajZOILokalno, posljiNaFURS, preveriSkupajKonsistentnost, round2 } from "../../lib/pos-furs";
import { logger } from "../../lib/logger";
import { readAll, toResponse } from "./nastavitve";
import { upsertPogostKupec } from "./kupec";
// bcrypt: use (await import('bcryptjs')).default for hashing
import { posljiEmailRacun } from "../../lib/pos-email";

const router: IRouter = Router();

function prevediFursNapako(napaka: string): string {
  if (/certifikat/i.test(napaka) || /certPem|certKljuc|produkcijsk/i.test(napaka)) {
    return "Fiskalizacija ni uspela: manjka FURS digitalni certifikat. Nastavite ga v razdelku Nastavitve (certifikatPem/certifikatKljuc).";
  }
  if (/^S003\b/.test(napaka)) {
    return "FURS je zavrnil račun (S003 — napaka pri podpisu ali DDV neskladju). Preverite davčne stopnje artiklov in nastavitve certifikata.";
  }
  if (/^S001\b/.test(napaka)) {
    return "FURS je zavrnil račun (S001 — napaka v formatu zahtevka). Obvestite skrbnika sistema.";
  }
  if (/^S002\b/.test(napaka)) {
    return "FURS je zavrnil račun (S002 — davčna napaka). Obvestite skrbnika sistema.";
  }
  const sKodaMatch = napaka.match(/^(S\d+)\b[:\s]*(.*)/);
  if (sKodaMatch) {
    const koda = sKodaMatch[1];
    const opis = sKodaMatch[2]?.trim();
    return `FURS je vrnil napako ${koda}${opis ? `: ${opis}` : ""}. Obvestite skrbnika sistema.`;
  }
  if (/timeout/i.test(napaka)) {
    return "Strežnik FURS se ni odzval (timeout). Preverite omrežno povezavo in poskusite znova.";
  }
  if (/ECONNREFUSED|ENOTFOUND|network|omrežn/i.test(napaka)) {
    return "Ni mogoče vzpostaviti povezave s FURS strežnikom. Preverite omrežno povezavo.";
  }
  return `Fiskalizacija ni uspela: ${napaka}`;
}

async function nextStevilkaRacun(poslovniProstor: string, blagajnaId: string, _davcna: string, tenotaId: number): Promise<string> {
  const prefix = `${poslovniProstor}-${blagajnaId}-`;
  const result = await db.execute(
    sql`SELECT COALESCE(MAX(CAST(SUBSTRING(stevilka_racuna, ${sql.raw(String(prefix.length + 1))}) AS INTEGER)), 0) + 1 AS next FROM racuni WHERE LEFT(stevilka_racuna, ${sql.raw(String(prefix.length))}) = ${prefix} AND podjetje_davcna = ${""} AND enota_id = ${tenotaId}`
  );
  const nextSeq = Number((result.rows[0] as { next: string })?.next ?? 1);
  return `${prefix}${String(nextSeq).padStart(6, "0")}`;
}

const baseSelect = {
  id: racuniTable.id,
  narociloId: racuniTable.narociloId,
  stevilkaRacuna: racuniTable.stevilkaRacuna,
  skupaj: racuniTable.skupaj,
  ddv: racuniTable.ddv,
  osnova: racuniTable.osnova,
  placilnaNacin: racuniTable.placilnaNacin,
  status: racuniTable.status,
  zoi: racuniTable.zoi,
  eor: racuniTable.eor,
  fursOdgovor: racuniTable.fursOdgovor,
  natakarIme: racuniTable.natakarIme,
  natakarDavcna: racuniTable.natakarDavcna,
  ustvarjeno: racuniTable.ustvarjeno,
  datumCas: racuniTable.datumCas,
  mizaStevilka: mizeTable.stevilka,
  steviloPrintov: racuniTable.steviloPrintov,
  opomba: racuniTable.opomba,
  jeDelni: racuniTable.jeDelni,
  znesekGotovina: racuniTable.znesekGotovina,
  znesekKartica: racuniTable.znesekKartica,
  znesekBon: racuniTable.znesekBon,
  steviloBonov: racuniTable.steviloBonov,
  znesekBonPica: racuniTable.znesekBonPica,
  znesekNegotovinsko: racuniTable.znesekNegotovinsko,
  dniOdloga: racuniTable.dniOdloga,
  jeStorno: racuniTable.jeStorno,
  izvorniRacunId: racuniTable.izvorniRacunId,
  kupecDavcnaStevilka: racuniTable.kupecDavcnaStevilka,
  kupecNaziv: racuniTable.kupecNaziv,
  kupecNaslov: racuniTable.kupecNaslov,
  sumupCheckoutId: racuniTable.sumupCheckoutId,
  vivaTerminalSessionId: racuniTable.vivaTerminalSessionId};

router.get("/racuni", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const query = { success: true as const, data: req.query };
  if (!query.success) { res.status(400).json({ error: (query as any).error.message }); return; }

  let rows;
  if (query.data.datum) {
    rows = await db
      .select(baseSelect)
      .from(racuniTable)
      .leftJoin(narocilaTable, eq(racuniTable.narociloId, narocilaTable.id))
      .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
      .where(and(
        sql`DATE(${racuniTable.ustvarjeno} AT TIME ZONE 'Europe/Ljubljana') = ${query.data.datum}::date`,
        sql`true`,
        eq(racuniTable.enotaId, tenotaId)
      ))
      .orderBy(desc(racuniTable.ustvarjeno));
  } else {
    rows = await db
      .select(baseSelect)
      .from(racuniTable)
      .leftJoin(narocilaTable, eq(racuniTable.narociloId, narocilaTable.id))
      .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
      .where(and(eq(racuniTable.enotaId, tenotaId)))
      .orderBy(desc(racuniTable.ustvarjeno));
  }

  const mapped = rows.map((r) => ({
    ...r,
    skupaj: Number(r.skupaj),
    ddv: Number(r.ddv),
    osnova: r.osnova != null ? Number(r.osnova) : null,
    zoi: r.zoi ?? null,
    eor: r.eor ?? null,
    fursOdgovor: r.fursOdgovor ?? null,
    natakarIme: r.natakarIme ?? null,
    natakarDavcna: r.natakarDavcna ?? null,
    mizaStevilka: r.mizaStevilka ?? null,
    jeDelni: r.jeDelni ?? false,
    jeStorno: r.jeStorno ?? false,
    izvorniRacunId: r.izvorniRacunId ?? null,
    znesekGotovina: r.znesekGotovina != null ? Number(r.znesekGotovina) : null,
    znesekKartica: r.znesekKartica != null ? Number(r.znesekKartica) : null,
    znesekBon: r.znesekBon != null ? Number(r.znesekBon) : null,
    steviloBonov: r.steviloBonov ?? null,
    znesekBonPica: r.znesekBonPica != null ? Number(r.znesekBonPica) : null,
    znesekNegotovinsko: (r as { znesekNegotovinsko?: string | null }).znesekNegotovinsko != null ? Number((r as { znesekNegotovinsko?: string | null }).znesekNegotovinsko) : null,
    dniOdloga: r.dniOdloga ?? null,
    kupecDavcnaStevilka: r.kupecDavcnaStevilka ?? null,
    kupecNaziv: r.kupecNaziv ?? null,
    kupecNaslov: r.kupecNaslov ?? null,
    sumupCheckoutId: r.sumupCheckoutId ?? null,
    vivaTerminalSessionId: r.vivaTerminalSessionId ?? null}));

  res.json((mapped));
});

router.post("/racuni", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const [narocilo] = await db.select().from(narocilaTable)
    .where(and(eq(narocilaTable.id, parsed.data.narociloId), sql`true`, eq(narocilaTable.enotaId, tenotaId)));
  if (!narocilo) { res.status(404).json({ error: "Naročilo ni najdeno" }); return; }
  if (narocilo.status === "zakljuceno") { res.status(400).json({ error: "Naročilo je že zaključeno" }); return; }

  const allPostavke = await db.select().from(postavkeTable).where(eq(postavkeTable.narociloId, narocilo.id));
  if (allPostavke.length === 0) { res.status(400).json({ error: "Naročilo nima postavk" }); return; }

  // Determine which postavke this receipt covers (partial or full billing)
  const postavkeIdsReq = (parsed.data as { postavkeIds?: number[] }).postavkeIds;
  let selectedPostavke = allPostavke;
  let jeDelni = false;

  if (postavkeIdsReq !== undefined && postavkeIdsReq.length === 0) {
    res.status(400).json({ error: "Seznam postavk za delni račun ne sme biti prazen" }); return;
  }

  if (postavkeIdsReq && postavkeIdsReq.length > 0) {
    const allIdsSet = new Set(allPostavke.map((p: any) => p.id));
    const invalidIds = postavkeIdsReq.filter((id: any) => !allIdsSet.has(id));
    if (invalidIds.length > 0) {
      res.status(400).json({ error: "Nekatere izbrane postavke ne pripadajo temu naročilu" }); return;
    }
    selectedPostavke = allPostavke.filter(p => postavkeIdsReq.includes(p.id));
    const alreadyCovered = selectedPostavke.filter(p => p.racunId !== null);
    if (alreadyCovered.length > 0) {
      res.status(409).json({ error: "Nekatere izbrane postavke so že pokrite z računom" }); return;
    }
    jeDelni = selectedPostavke.length < allPostavke.length;
  } else {
    selectedPostavke = allPostavke.filter(p => p.racunId === null);
    if (selectedPostavke.length === 0) {
      res.status(400).json({ error: "Vse postavke naročila so že pokrite z računi" }); return;
    }
    jeDelni = selectedPostavke.length < allPostavke.length;
  }

  // Partnerski cenik — če je podan kupecId, prekalkuliramo cene iz cenika
  const kupecId = (parsed.data as { kupecId?: number | null }).kupecId ?? null;
  let partnerCenikMap: Map<number, number> | null = null;
  if (kupecId) {
    const cenikVrstice = await db
      .select({ artikelId: partnerCenikiTable.artikelId, cena: partnerCenikiTable.cena })
      .from(partnerCenikiTable)
      .where(eq(partnerCenikiTable.kupecId, kupecId));
    if (cenikVrstice.length > 0) {
      partnerCenikMap = new Map(cenikVrstice.map(v => [v.artikelId, Number(v.cena)]));
    }
  }

  // Preračunamo skupaj/ddv — za postavke s partnerskim cenikom zamenjamo ceno
  const skupajIzPostavk = round2(selectedPostavke.reduce((acc, p) => {
    const customCena = (partnerCenikMap && p.artikelId) ? partnerCenikMap.get(p.artikelId) : undefined;
    const vsota = customCena !== undefined ? round2(customCena * Number(p.kolicina)) : Number(p.skupaj);
    return acc + vsota;
  }, 0));
  // Za reprezentanco in lastno porabo: skupaj = 0 (100% popust, brezplačno),
  // ddv in osnova pa ostaneta iz originalnih cen — za prikaz na računu in FURS TaxesPerSeller.
  const jeReprezentancaAliLastna = ["reprezentanca", "lastna_poraba"].includes(parsed.data.placilnaNacin);
  const ddv = round2(selectedPostavke.reduce((acc, p) => {
    const customCena = (partnerCenikMap && p.artikelId) ? partnerCenikMap.get(p.artikelId) : undefined;
    const vsota = customCena !== undefined ? round2(customCena * Number(p.kolicina)) : Number(p.skupaj);
    return acc + izracunajDDVZaokrozen(vsota, Number(p.davek));
  }, 0));
  const osnova = round2(skupajIzPostavk - ddv);
  // skupaj = 0 za reprezentanco/lastno porabo (100% interni popust) — DDV osnova/znesek ostaneta iz originalnih cen
  const skupaj = jeReprezentancaAliLastna ? 0 : skupajIzPostavk;

  let izrednaOpomba: string | null = null;

  // DDV consistency check — preskoči kadar je aktiven partnerski cenik ali reprezentanca/lastna_poraba
  const jeNadaljevanje = allPostavke.some(p => p.racunId !== null);
  if (!jeDelni && !jeNadaljevanje && !partnerCenikMap && !jeReprezentancaAliLastna) {
    const narociloSkupaj = Number(narocilo.skupaj);
    try {
      preveriSkupajKonsistentnost(osnova, ddv, narociloSkupaj);
    } catch (err) {
      const razlika = round2(Math.abs(skupajIzPostavk - narociloSkupaj));
      const preskoci = (parsed.data as { preskociDDVPreverjanje?: boolean }).preskociDDVPreverjanje ?? false;
      const skrbnisPIN = (parsed.data as { skrbnisPIN?: string }).skrbnisPIN ?? "";

      if (preskoci && razlika < 0.05 && skrbnisPIN) {
        const nastavitveMapZ = await readAll("", tenotaId);
        const shranjeniHash = nastavitveMapZ["izrednaIzdajaPINHash"] ?? "";
        if (!shranjeniHash) {
          res.status(403).json({ code: "IZREDNI_PIN_NI_NASTAVLJEN", error: "Skrbniški PIN za izredno izdajo ni nastavljen. Nastavite ga v razdelku Nastavitve." });
          return;
        }
        const pinOk = await (await import("bcryptjs")).default.compare(skrbnisPIN, shranjeniHash);
        if (!pinOk) {
          res.status(403).json({ code: "NAPACEN_IZREDNI_PIN", error: "Napačen skrbniški PIN." });
          return;
        }
        izrednaOpomba = `Izredna izdaja — DDV neskladje preskočeno s PIN kodo (razlika ${razlika.toFixed(2)} €)`;
        logger.warn({
          msg: "Izredna izdaja z PIN kodo — DDV neskladje preskočeno",
          narociloId: narocilo.id,
          skupajNarocilo: narociloSkupaj,
          skupajIzPostavk,
          ddv,
          razlika});
      } else {
        logger.warn({
          msg: "DDV neskladje pri izdaji računa",
          narociloId: narocilo.id,
          skupajNarocilo: narociloSkupaj,
          skupajIzPostavk,
          ddv,
          razlika});
        const postavkeRazclenjene = selectedPostavke.map((p: any) => {
          const total = Number(p.skupaj);
          const stopnja = Number(p.davek);
          return {
            ime: p.ime,
            kolicina: p.kolicina,
            skupaj: total,
            davek: stopnja,
            ddv: izracunajDDVZaokrozen(total, stopnja)};
        });
        res.status(422).json({
          code: "DDV_NESKLADJE",
          error: err instanceof Error ? err.message : String(err),
          razlika,
          skupajNarocilo: narociloSkupaj,
          skupajIzPostavk,
          postavke: postavkeRazclenjene});
        return;
      }
    }
  }

  const fursNacinReq = (parsed.data as { fursNacin?: string }).fursNacin as "simulacija" | "testno" | "produkcija" | undefined;
  const nastavitveMap = await readAll("", tenotaId);
  const nastavitve = toResponse(nastavitveMap);
  const fursNacin: "simulacija" | "testno" | "produkcija" = fursNacinReq ?? nastavitve.fursNacin;

  const privzetaPP = !nastavitve.poslovniProstor;
  const privzetiBId = !nastavitve.elektronskaNaprava;
  let activePP = nastavitve.poslovniProstor ?? "PP001";
  let activeBId = nastavitve.elektronskaNaprava ?? "B001";
  if (parsed.data.blagajnaId) {
    const [blagajna] = await db
      .select()
      .from(blagajneTable)
      .where(and(eq(blagajneTable.id, parsed.data.blagajnaId)));
    if (blagajna) {
      activePP = blagajna.ppId;
      activeBId = blagajna.bId;
    }
  }

  const opozoriloNastavljeno = !parsed.data.blagajnaId && (privzetaPP || privzetiBId)
    ? "Prodajni prostor ali blagajna ni nastavljena — račun izdan s privzetimi vrednostmi. Preverite nastavitve blagajne."
    : null;

  const effectiveFursNacin: "simulacija" | "testno" | "produkcija" = opozoriloNastavljeno ? "simulacija" : fursNacin;

  const stevilkaRacuna = await nextStevilkaRacun(activePP, activeBId, "", tenotaId);

  let natakarIme: string | null = null;
  let natakarDavcna: string | null = null;
  if (parsed.data.natakariId) {
    const [natakar] = await db
      .select()
      .from(natakariTable)
      .where(and(eq(natakariTable.id, parsed.data.natakariId), sql`true`, eq(natakariTable.enotaId, tenotaId)));
    if (natakar) {
      natakarIme = `${natakar.ime} ${natakar.priimek}`;
      natakarDavcna = natakar.davcnaStevilka ?? null;
    }
  }

  let izmenaId: number | null = null;
  if (parsed.data.natakariId) {
    const [openShift] = await db
      .select({ id: izmeneTable.id })
      .from(izmeneTable)
      .where(and(
        eq(izmeneTable.natakariId, parsed.data.natakariId),
        isNull(izmeneTable.konec),
        sql`true`,
        eq(izmeneTable.enotaId, tenotaId)
      ));
    if (openShift) izmenaId = openShift.id;
  }

  const datumCas = new Date();

  // ZOI izračunamo lokalno PRED klicem FURS — zagotovi ZOI na izpisu tudi ko FURS ni dosegljiv
  const zoiLokalno = izracunajZOILokalno(
    stevilkaRacuna,
    datumCas,
    skupaj,
    nastavitve.davcnaStevilka ?? "12345678",
    activePP,
    activeBId,
    effectiveFursNacin,
    nastavitveMap["certifikatKljuc"] || undefined,
    nastavitve.certifikatPot || undefined,
    nastavitve.certifikatGeslo || undefined,
  );

  let fursOdgovor: Awaited<ReturnType<typeof posljiNaFURS>>;
  if ((nastavitveMap["simulirajFursNapako"] ?? "false") === "true") {
    req.log.warn({ stevilkaRacuna }, "simulirajFursNapako=true — FURS klic preskočen, račun shranjen z napako");
    fursOdgovor = { uspeh: false, zoi: zoiLokalno, eor: null, napaka: "Simulirana napaka sistema FURS: Storitev trenutno ni na voljo (S100)", surovOdgovor: "simulacija" } as unknown as Awaited<ReturnType<typeof posljiNaFURS>>;
  } else
  try {
    fursOdgovor = await posljiNaFURS(
      {
        stevilkaRacuna,
        datumCas,
        skupaj,
        ddv,
        placilnaNacin: (["negotovinsko", "reprezentanca", "lastna_poraba"].includes(parsed.data.placilnaNacin) ? "other" : parsed.data.placilnaNacin) as "gotovina" | "kartica" | "bon" | "other",
        postavke: selectedPostavke.map((p) => {
          const customCena = (partnerCenikMap && p.artikelId) ? partnerCenikMap.get(p.artikelId) : undefined;
          return {
            ime: p.ime,
            kolicina: p.kolicina,
            cenaKos: customCena !== undefined ? customCena : Number(p.cenaKos),
            davek: Number(p.davek)};
        }),
        davcnaStevilka: nastavitve.davcnaStevilka,
        poslovnaProstor: activePP,
        blagajnaId: activeBId,
        operatorDavcna: natakarDavcna ?? undefined,
        kupecDavcnaStevilka: (parsed.data as { kupecDavcnaStevilka?: string | null }).kupecDavcnaStevilka ?? undefined,
        certifikatPot: nastavitve.certifikatPot || undefined,
        certifikatGeslo: nastavitve.certifikatGeslo || undefined,
        certPem: nastavitveMap["certifikatPem"] || undefined,
        certKljuc: nastavitveMap["certifikatKljuc"] || undefined,
        proxyUrl: nastavitve.fursProxyUrl || undefined},
      effectiveFursNacin,
      izrednaOpomba !== null || jeReprezentancaAliLastna,
      Number(nastavitveMap["ddvSplosnaSt"] ?? "22")
    );
  } catch (err) {
    const sporocilo = err instanceof Error ? err.message : String(err);
    if (sporocilo.startsWith("DDV neskladje") || sporocilo.startsWith("Neskladje med skupaj")) {
      req.log.warn(
        { stevilkaRacuna, ddv, steviloPostavk: selectedPostavke.length, napaka: sporocilo },
        "DDV neskladje pred oddajo na FURS — račun zavrnjen"
      );
      res.status(422).json({ code: "DDV_NESKLADJE", error: sporocilo });
      return;
    }
    // FURS nedosegljiv (omrežna napaka, timeout) — račun shranimo z napako za kasnejšo registracijo
    req.log.warn(
      { stevilkaRacuna, ddv, steviloPostavk: selectedPostavke.length, napaka: sporocilo },
      "FURS nedosegljiv — račun shranjen z napako za kasnejšo registracijo"
    );
    fursOdgovor = { uspeh: false, zoi: zoiLokalno, eor: null, napaka: sporocilo, surovOdgovor: "omrežna napaka" } as unknown as Awaited<ReturnType<typeof posljiNaFURS>>;
  }

  const status = fursOdgovor.uspeh ? (effectiveFursNacin !== "produkcija" ? "testni" : "poslan") : "napaka";

  let fursNapakaSporocilo: string | null = null;
  if (!fursOdgovor.uspeh && fursOdgovor.napaka) {
    fursNapakaSporocilo = prevediFursNapako(fursOdgovor.napaka);
    req.log.warn(
      { stevilkaRacuna, napaka: fursOdgovor.napaka, prevod: fursNapakaSporocilo },
      "Fiskalizacija ni uspela — račun shranjen z napako"
    );
  }

  const [racun] = await db.insert(racuniTable).values({
    enotaId: tenotaId,
    narociloId: narocilo.id,
    stevilkaRacuna,
    datumCas,
    skupaj: String(skupaj.toFixed(2)),
    ddv: String(ddv.toFixed(2)),
    osnova: String(osnova.toFixed(2)),
    placilnaNacin: parsed.data.placilnaNacin as "gotovina" | "kartica" | "bon" | "bon_pica" | "negotovinsko" | "reprezentanca" | "lastna_poraba",
    status,
    zoi: fursOdgovor.zoi || zoiLokalno || null,
    eor: fursOdgovor.eor || null,
    fursOdgovor: fursOdgovor.surovOdgovor,
    natakarIme,
    natakarDavcna,
    izmenaId,
    opomba: izrednaOpomba,
    jeDelni,
    znesekGotovina: parsed.data.znesekGotovina != null ? String((parsed.data.znesekGotovina as number).toFixed(2)) : null,
    znesekKartica: parsed.data.znesekKartica != null ? String((parsed.data.znesekKartica as number).toFixed(2)) : null,
    znesekBon: parsed.data.znesekBon != null ? String((parsed.data.znesekBon as number).toFixed(2)) : null,
    steviloBonov: parsed.data.steviloBonov ?? null,
    znesekBonPica: parsed.data.znesekBonPica != null ? String((parsed.data.znesekBonPica as number).toFixed(2)) : null,
    znesekNegotovinsko: (parsed.data as { znesekNegotovinsko?: number | null }).znesekNegotovinsko != null ? String(((parsed.data as { znesekNegotovinsko?: number | null }).znesekNegotovinsko as number).toFixed(2)) : null,
    dniOdloga: (parsed.data as { dniOdloga?: number | null }).dniOdloga ?? null,
    izdaniKuponi: (parsed.data as { izdaniKuponi?: number | null }).izdaniKuponi ?? null,
    kupecDavcnaStevilka: (parsed.data as { kupecDavcnaStevilka?: string | null }).kupecDavcnaStevilka ?? null,
    kupecNaziv: (parsed.data as { kupecNaziv?: string | null }).kupecNaziv ?? null,
    kupecNaslov: (parsed.data as { kupecNaslov?: string | null }).kupecNaslov ?? null,
    kupecZavezanecDdv: (parsed.data as { kupecZavezanecDdv?: boolean | null }).kupecZavezanecDdv ?? null,
    kupecId: kupecId ?? null,
    sumupCheckoutId: (parsed.data as { sumupCheckoutId?: string | null }).sumupCheckoutId ?? null,
    vivaTerminalSessionId: (parsed.data as { vivaTerminalSessionId?: string | null }).vivaTerminalSessionId ?? null}).returning();

  // Auto-upsert frequent customer when kupecNaziv is set
  const _kupecNaziv = (parsed.data as { kupecNaziv?: string | null }).kupecNaziv ?? null;
  if (_kupecNaziv) {
    upsertPogostKupec({
      enotaId: tenotaId,
      naziv: _kupecNaziv,
      naslov: (parsed.data as { kupecNaslov?: string | null }).kupecNaslov ?? null,
      davcnaStevilka: (parsed.data as { kupecDavcnaStevilka?: string | null }).kupecDavcnaStevilka ?? null}).catch(err => logger.warn({ err }, "upsertPogostKupec failed"));
  }

  // Mark covered postavke with this receipt's ID.
  // Cenik-adjusted prices are NOT written back to postavke (that would break the
  // order-level consistency check). Instead, kupecId is stored on the racun so
  // the print route can apply cenik dynamically when generating the receipt.
  await db.update(postavkeTable)
    .set({ racunId: racun.id })
    .where(inArray(postavkeTable.id, selectedPostavke.map((p: any) => p.id)));

  await db.transaction(async (tx) => {
    const prizadetiArtikelIds: number[] = [];
    for (const postavka of selectedPostavke) {
      if (postavka.artikelId == null) continue;
      const normativi = await tx.select().from(normativiTable).where(eq(normativiTable.artikelId, postavka.artikelId));
      for (const normativ of normativi) {
        const porabljeno = Number(normativ.kolicina) * postavka.kolicina;
        await tx.insert(zalogaGibiTable).values({
          artikelId: normativ.vhodniArtikelId,
          tip: "poraba",
          kolicina: String(-porabljeno),
          opomba: `Račun ${stevilkaRacuna}`,
          referencaId: racun.id});
        if (!prizadetiArtikelIds.includes(normativ.vhodniArtikelId)) {
          prizadetiArtikelIds.push(normativ.vhodniArtikelId);
        }
      }
    }
    // Razknjiženje sestavin modifikatorjev
    for (const postavka of selectedPostavke) {
      if (postavka.modifikatorId == null) continue;
      const modNormativi = await tx.select().from(modNormativiTable)
        .where(eq(modNormativiTable.modifikatorId, postavka.modifikatorId));
      for (const mn of modNormativi) {
        const porabljeno = Number(mn.kolicina) * postavka.kolicina;
        await tx.insert(zalogaGibiTable).values({
          artikelId: mn.vhodniArtikelId,
          tip: "poraba",
          kolicina: String(-porabljeno),
          opomba: `Račun ${stevilkaRacuna}`,
          referencaId: racun.id});
        if (!prizadetiArtikelIds.includes(mn.vhodniArtikelId)) {
          prizadetiArtikelIds.push(mn.vhodniArtikelId);
        }
      }
    }
    await recomputeZaloge(prizadetiArtikelIds, tx);
  });

  // Close order only when all postavke are now covered by receipts
  const coveredBeforeThis = allPostavke.filter(p => p.racunId !== null).length;
  const allCovered = coveredBeforeThis + selectedPostavke.length >= allPostavke.length;

  if (allCovered) {
    await db.update(narocilaTable).set({ status: "zakljuceno" }).where(eq(narocilaTable.id, narocilo.id));

    if (narocilo.mizaId != null) {
      const activeNarocila = await db
        .select()
        .from(narocilaTable)
        .where(and(eq(narocilaTable.mizaId, narocilo.mizaId), sql`true`, eq(narocilaTable.enotaId, tenotaId)));
      const hasOpenOrders = activeNarocila.some((n) => n.status === "odprto");
      if (!hasOpenOrders) {
        await db.update(mizeTable).set({ status: "prosta" }).where(eq(mizeTable.id, narocilo.mizaId));
      }
    }
  }

  const [withMiza] = await db
    .select({
      id: racuniTable.id,
      narociloId: racuniTable.narociloId,
      stevilkaRacuna: racuniTable.stevilkaRacuna,
      skupaj: racuniTable.skupaj,
      ddv: racuniTable.ddv,
      osnova: racuniTable.osnova,
      placilnaNacin: racuniTable.placilnaNacin,
      status: racuniTable.status,
      zoi: racuniTable.zoi,
      eor: racuniTable.eor,
      fursOdgovor: racuniTable.fursOdgovor,
      ustvarjeno: racuniTable.ustvarjeno,
      datumCas: racuniTable.datumCas,
      mizaStevilka: mizeTable.stevilka,
      opomba: racuniTable.opomba,
      znesekGotovina: racuniTable.znesekGotovina,
      znesekKartica: racuniTable.znesekKartica,
      znesekBon: racuniTable.znesekBon,
      steviloBonov: racuniTable.steviloBonov,
      znesekBonPica: racuniTable.znesekBonPica,
      jeDelni: racuniTable.jeDelni,
      kupecDavcnaStevilka: racuniTable.kupecDavcnaStevilka,
      kupecNaziv: racuniTable.kupecNaziv,
      kupecNaslov: racuniTable.kupecNaslov,
      sumupCheckoutId: racuniTable.sumupCheckoutId,
      vivaTerminalSessionId: racuniTable.vivaTerminalSessionId})
    .from(racuniTable)
    .leftJoin(narocilaTable, eq(racuniTable.narociloId, narocilaTable.id))
    .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .where(eq(racuniTable.id, racun.id));

  broadcast("update", { type: "racun" });
  res.status(201).json(({
    ...withMiza,
    skupaj: Number(withMiza!.skupaj),
    ddv: Number(withMiza!.ddv),
    osnova: withMiza!.osnova != null ? Number(withMiza!.osnova) : null,
    zoi: withMiza!.zoi ?? null,
    eor: withMiza!.eor ?? null,
    fursOdgovor: withMiza!.fursOdgovor ?? null,
    mizaStevilka: withMiza!.mizaStevilka ?? null,
    fursNapaka: fursNapakaSporocilo ?? null,
    opomba: withMiza!.opomba ?? null,
    opozorilo: opozoriloNastavljeno ?? null,
    jeDelni: withMiza!.jeDelni ?? false,
    znesekGotovina: withMiza!.znesekGotovina != null ? Number(withMiza!.znesekGotovina) : null,
    znesekKartica: withMiza!.znesekKartica != null ? Number(withMiza!.znesekKartica) : null,
    znesekBon: withMiza!.znesekBon != null ? Number(withMiza!.znesekBon) : null,
    steviloBonov: withMiza!.steviloBonov ?? null,
    znesekBonPica: withMiza!.znesekBonPica != null ? Number(withMiza!.znesekBonPica) : null,
    kupecDavcnaStevilka: withMiza!.kupecDavcnaStevilka ?? null,
    kupecNaziv: withMiza!.kupecNaziv ?? null,
    kupecNaslov: withMiza!.kupecNaslov ?? null,
    sumupCheckoutId: withMiza!.sumupCheckoutId ?? null,
    vivaTerminalSessionId: withMiza!.vivaTerminalSessionId ?? null}));
});

// ── Batch FURS retry ob prijavi ───────────────────────────────────────────
router.post("/racuni/retry-furs-batch", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;

  const napakaRacuni = await db
    .select()
    .from(racuniTable)
    .where(and(eq(racuniTable.enotaId, tenotaId),
      eq(racuniTable.status, "napaka"),
    ))
    .orderBy(racuniTable.ustvarjeno);

  if (napakaRacuni.length === 0) {
    res.json({ skupaj: 0, uspesno: 0, neuspesno: 0, racuni: [] });
    return;
  }

  const nastavitveMap = await readAll("", tenotaId);
  const nastavitve = toResponse(nastavitveMap);

  if ((nastavitveMap["simulirajFursNapako"] ?? "false") === "true") {
    req.log.warn("simulirajFursNapako=true — retry-furs-batch preskočen");
    res.json({ skupaj: napakaRacuni.length, uspesno: 0, neuspesno: napakaRacuni.length, racuni: [] });
    return;
  }

  const racuniRezultati: { id: number; stevilkaRacuna: string; uspeh: boolean; eor?: string | null; napaka?: string | null }[] = [];
  let uspesno = 0;
  let neuspesno = 0;

  for (const racun of napakaRacuni) {
    const postavke = await db.select().from(postavkeTable).where(eq(postavkeTable.narociloId, racun.narociloId));
    let fursOdgovor: Awaited<ReturnType<typeof posljiNaFURS>>;
    try {
      fursOdgovor = await posljiNaFURS(
        {
          stevilkaRacuna: racun.stevilkaRacuna,
          datumCas: new Date(racun.datumCas ?? racun.ustvarjeno),
          skupaj: Number(racun.skupaj),
          ddv: Number(racun.ddv),
          placilnaNacin: (["negotovinsko", "reprezentanca", "lastna_poraba"].includes(racun.placilnaNacin) ? "other" : racun.placilnaNacin) as "gotovina" | "kartica" | "bon" | "other",
          postavke: postavke.map((p) => ({
            ime: p.ime,
            kolicina: p.kolicina,
            cenaKos: Number(p.cenaKos),
            davek: Number(p.davek)})),
          davcnaStevilka: nastavitve.davcnaStevilka,
          poslovnaProstor: nastavitve.poslovniProstor,
          blagajnaId: nastavitve.elektronskaNaprava,
          operatorDavcna: racun.natakarDavcna ?? undefined,
          kupecDavcnaStevilka: racun.kupecDavcnaStevilka ?? undefined,
          certifikatPot: nastavitve.certifikatPot || undefined,
          certifikatGeslo: nastavitve.certifikatGeslo || undefined,
          certPem: nastavitveMap["certifikatPem"] || undefined,
          certKljuc: nastavitveMap["certifikatKljuc"] || undefined,
          proxyUrl: nastavitve.fursProxyUrl || undefined},
        nastavitve.fursNacin,
        false,
        Number(nastavitveMap["ddvSplosnaSt"] ?? "22")
      );
    } catch (err) {
      const sporocilo = err instanceof Error ? err.message : String(err);
      req.log.warn({ racunId: racun.id, stevilkaRacuna: racun.stevilkaRacuna, napaka: sporocilo }, "retry-furs-batch: omrežna napaka");
      fursOdgovor = { uspeh: false, zoi: racun.zoi ?? null, eor: null, napaka: sporocilo, surovOdgovor: "omrežna napaka" } as unknown as Awaited<ReturnType<typeof posljiNaFURS>>;
    }

    if (fursOdgovor.uspeh) {
      const noviStatus = nastavitve.fursNacin !== "produkcija" ? "testni" : "poslan";
      await db.update(racuniTable).set({
        status: noviStatus,
        zoi: fursOdgovor.zoi || null,
        eor: fursOdgovor.eor || null,
        fursOdgovor: fursOdgovor.surovOdgovor}).where(eq(racuniTable.id, racun.id));
      req.log.info({ racunId: racun.id, stevilkaRacuna: racun.stevilkaRacuna, eor: fursOdgovor.eor }, "retry-furs-batch: uspešno registriran");
      uspesno++;
      racuniRezultati.push({ id: racun.id, stevilkaRacuna: racun.stevilkaRacuna, uspeh: true, eor: fursOdgovor.eor ?? null });
    } else {
      req.log.warn({ racunId: racun.id, stevilkaRacuna: racun.stevilkaRacuna, napaka: fursOdgovor.napaka }, "retry-furs-batch: še vedno napaka");
      neuspesno++;
      racuniRezultati.push({ id: racun.id, stevilkaRacuna: racun.stevilkaRacuna, uspeh: false, napaka: fursOdgovor.napaka ?? null });
    }
  }

  if (uspesno > 0) broadcast("update", { type: "racun" });
  res.json({ skupaj: napakaRacuni.length, uspesno, neuspesno, racuni: racuniRezultati });
});

router.post("/racuni/:id/ponovi-furs", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }

  const body = { success: true, data: req.body };
  if (!body.success) { res.status(400).json({ error: (body as any).error.message }); return; }

  const [racun] = await db
    .select()
    .from(racuniTable)
    .where(and(eq(racuniTable.id, params.data.id), sql`true`, eq(racuniTable.enotaId, tenotaId)));

  if (!racun) { res.status(404).json({ error: "Račun ni najden" }); return; }

  if (racun.eor) {
    res.status(409).json({ error: "Račun je že davčno potrjen (EOR obstaja). Ponovitev ni možna." });
    return;
  }

  const postavke = await db.select().from(postavkeTable).where(eq(postavkeTable.narociloId, racun.narociloId));
  const nastavitveMap = await readAll("", tenotaId);
  const nastavitve = toResponse(nastavitveMap);
  const fursNacinReq2 = (body.data as { fursNacin?: string }).fursNacin as "simulacija" | "testno" | "produkcija" | undefined;
  const fursNacin: "simulacija" | "testno" | "produkcija" = fursNacinReq2 ?? nastavitve.fursNacin;

  if ((nastavitveMap["simulirajFursNapako"] ?? "false") === "true") {
    req.log.warn({ racunId: racun.id }, "simulirajFursNapako=true — ponovi-furs preskočen, vrnjena simulirana napaka");
    res.status(503).json({ code: "FURS_NAPAKA_SISTEMA", error: "Simulirana napaka sistema FURS: Storitev trenutno ni na voljo (S100)" });
    return;
  }

  let fursOdgovor: Awaited<ReturnType<typeof posljiNaFURS>>;
  try {
    fursOdgovor = await posljiNaFURS(
      {
        stevilkaRacuna: racun.stevilkaRacuna,
        datumCas: new Date(racun.datumCas ?? racun.ustvarjeno),
        skupaj: Number(racun.skupaj),
        ddv: Number(racun.ddv),
        placilnaNacin: (["negotovinsko", "reprezentanca", "lastna_poraba"].includes(racun.placilnaNacin) ? "other" : racun.placilnaNacin) as "gotovina" | "kartica" | "bon" | "other",
        postavke: postavke.map((p) => ({
          ime: p.ime,
          kolicina: p.kolicina,
          cenaKos: Number(p.cenaKos),
          davek: Number(p.davek)})),
        davcnaStevilka: nastavitve.davcnaStevilka,
        poslovnaProstor: nastavitve.poslovniProstor,
        blagajnaId: nastavitve.elektronskaNaprava,
        operatorDavcna: racun.natakarDavcna ?? undefined,
        kupecDavcnaStevilka: racun.kupecDavcnaStevilka ?? undefined,
        certifikatPot: nastavitve.certifikatPot || undefined,
        certifikatGeslo: nastavitve.certifikatGeslo || undefined,
        certPem: nastavitveMap["certifikatPem"] || undefined,
        certKljuc: nastavitveMap["certifikatKljuc"] || undefined,
        proxyUrl: nastavitve.fursProxyUrl || undefined},
      fursNacin,
      false,
      Number(nastavitveMap["ddvSplosnaSt"] ?? "22")
    );
  } catch (err) {
    req.log.error(
      { racunId: racun.id, stevilkaRacuna: racun.stevilkaRacuna, napaka: err instanceof Error ? err.message : String(err) },
      "Napaka pri ponovnem pošiljanju na FURS"
    );
    throw err;
  }

  const noviStatus = fursOdgovor.uspeh ? (fursNacin !== "produkcija" ? "testni" : "poslan") : "napaka";

  let fursNapakaSporocilo: string | null = null;
  if (!fursOdgovor.uspeh && fursOdgovor.napaka) {
    fursNapakaSporocilo = prevediFursNapako(fursOdgovor.napaka);
    req.log.warn(
      { racunId: racun.id, stevilkaRacuna: racun.stevilkaRacuna, napaka: fursOdgovor.napaka },
      "Ponovni FURS poskus ni uspel"
    );
  } else if (fursOdgovor.uspeh) {
    req.log.info(
      { racunId: racun.id, stevilkaRacuna: racun.stevilkaRacuna, zoi: fursOdgovor.zoi, eor: fursOdgovor.eor },
      "Ponovni FURS poskus uspel"
    );
  }

  await db.update(racuniTable).set({
    status: noviStatus,
    zoi: fursOdgovor.zoi || racun.zoi || null,
    eor: fursOdgovor.eor || null,
    fursOdgovor: fursOdgovor.surovOdgovor}).where(eq(racuniTable.id, racun.id));

  const [withMiza] = await db
    .select({
      id: racuniTable.id,
      narociloId: racuniTable.narociloId,
      stevilkaRacuna: racuniTable.stevilkaRacuna,
      skupaj: racuniTable.skupaj,
      ddv: racuniTable.ddv,
      osnova: racuniTable.osnova,
      placilnaNacin: racuniTable.placilnaNacin,
      status: racuniTable.status,
      zoi: racuniTable.zoi,
      eor: racuniTable.eor,
      fursOdgovor: racuniTable.fursOdgovor,
      natakarIme: racuniTable.natakarIme,
      natakarDavcna: racuniTable.natakarDavcna,
      ustvarjeno: racuniTable.ustvarjeno,
      datumCas: racuniTable.datumCas,
      steviloPrintov: racuniTable.steviloPrintov,
      mizaStevilka: mizeTable.stevilka})
    .from(racuniTable)
    .leftJoin(narocilaTable, eq(racuniTable.narociloId, narocilaTable.id))
    .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .where(eq(racuniTable.id, racun.id));

  broadcast("update", { type: "racun" });
  res.json(({
    ...withMiza,
    skupaj: Number(withMiza!.skupaj),
    ddv: Number(withMiza!.ddv),
    osnova: withMiza!.osnova != null ? Number(withMiza!.osnova) : null,
    zoi: withMiza!.zoi ?? null,
    eor: withMiza!.eor ?? null,
    fursOdgovor: withMiza!.fursOdgovor ?? null,
    natakarIme: withMiza!.natakarIme ?? null,
    natakarDavcna: withMiza!.natakarDavcna ?? null,
    mizaStevilka: withMiza!.mizaStevilka ?? null,
    fursNapaka: fursNapakaSporocilo ?? null}));
});

router.post("/racuni/:id/poslji-email", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const { prejemnik } = req.body as { prejemnik?: string };
  if (!prejemnik || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(prejemnik.trim())) {
    res.status(400).json({ error: "Neveljaven e-poštni naslov" });
    return;
  }

  const [racun] = await db
    .select({
      id: racuniTable.id,
      stevilkaRacuna: racuniTable.stevilkaRacuna,
      skupaj: racuniTable.skupaj,
      ddv: racuniTable.ddv,
      placilnaNacin: racuniTable.placilnaNacin,
      zoi: racuniTable.zoi,
      eor: racuniTable.eor,
      ustvarjeno: racuniTable.ustvarjeno})
    .from(racuniTable)
    .where(and(eq(racuniTable.id, id), sql`true`, eq(racuniTable.enotaId, tenotaId)));

  if (!racun) { res.status(404).json({ error: "Račun ni najden" }); return; }

  const nastavitveMap = await readAll("", tenotaId);
  const nastavitve = toResponse(nastavitveMap);

  const rezultat = await posljiEmailRacun(
    { ...nastavitve, smtpPassword: nastavitveMap["smtpPassword"] ?? "" },
    prejemnik.trim(),
    {
      stevilkaRacuna: racun.stevilkaRacuna,
      skupaj: Number(racun.skupaj),
      ddv: Number(racun.ddv),
      placilnaNacin: racun.placilnaNacin,
      zoi: racun.zoi ?? null,
      eor: racun.eor ?? null,
      ustvarjeno: racun.ustvarjeno},
    nastavitve.nazivRestavracije ?? nastavitve.davcnaStevilka ?? "",
  );

  res.json({ uspeh: rezultat.uspeh, napaka: rezultat.napaka ?? null });
});

router.post("/racuni/:id/storniraj", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }

  const [racun] = await db
    .select()
    .from(racuniTable)
    .where(and(eq(racuniTable.id, params.data.id), sql`true`, eq(racuniTable.enotaId, tenotaId)));

  if (!racun) { res.status(404).json({ error: "Račun ni najden" }); return; }
  if (racun.status === "storniran") {
    res.status(409).json({ error: "Račun je že storniran" }); return;
  }
  if (racun.jeStorno) {
    res.status(400).json({ error: "Storno računa ni mogoče stornirati" }); return;
  }
  if (racun.status === "napaka") {
    res.status(400).json({ error: "Računa z napako FURS ni mogoče stornirati (FURS ga ni prejel — preprosto opustite ta račun)" }); return;
  }

  // Preveri da že ne obstaja storno tega računa
  const [obstojeciStorno] = await db
    .select({ id: racuniTable.id })
    .from(racuniTable)
    .where(and(eq(racuniTable.izvorniRacunId, racun.id), eq(racuniTable.jeStorno, true)));
  if (obstojeciStorno) {
    res.status(409).json({ error: "Za ta račun je storno že bil izdan" }); return;
  }

  // Naloži postavke izvornega računa za FURS zahtevek
  const izvornePostavke = await db.select().from(postavkeTable).where(eq(postavkeTable.racunId, racun.id));

  // Storno: izda se kot nov račun z negativnimi zneski (FURS zahteva)
  const nastavitveMap = await readAll("", tenotaId);
  const nastavitve = toResponse(nastavitveMap);

  // Prevzami PP/B iz izvornega stevilkaRacuna (npr. "PP001-B001-000001" → PP001, B001)
  const ppBMatch = racun.stevilkaRacuna.match(/^(.+)-(.+)-\d+$/);
  const activePP = ppBMatch?.[1] ?? nastavitve.poslovniProstor ?? "PP001";
  const activeBId = ppBMatch?.[2] ?? nastavitve.elektronskaNaprava ?? "B001";

  if ((nastavitveMap["simulirajFursNapako"] ?? "false") === "true") {
    req.log.warn({ racunId: racun.id }, "simulirajFursNapako=true — storno FURS klic preskočen, vrnjena simulirana napaka");
    res.status(503).json({ code: "FURS_NAPAKA_SISTEMA", error: "Simulirana napaka sistema FURS: Storitev trenutno ni na voljo (S100)" });
    return;
  }

  const stornoStevilka = await nextStevilkaRacun(activePP, activeBId, "", tenotaId);

  // Negativni zneski za FURS
  const stornoSkupaj = round2(-Number(racun.skupaj));
  const stornoDdv = round2(-Number(racun.ddv));

  // Negativne postavke za FURS izračun DDV skupin
  const stornoPostavkeFurs = izvornePostavke.map((p: any) => ({
    ime: p.ime,
    kolicina: -p.kolicina,   // negativna količina → negativna vrstica
    cenaKos: Number(p.cenaKos),
    davek: Number(p.davek),
    // skupaj namerno ni posredovan → preveriVsotoPostavkPoVrsticah preskoči posamezne vrstice
  }));

  const fursNacin: "simulacija" | "testno" | "produkcija" = racun.status === "poslan" ? "produkcija" : nastavitve.fursNacin;
  const datumCas = new Date();

  let fursOdgovor: Awaited<ReturnType<typeof posljiNaFURS>>;
  try {
    fursOdgovor = await posljiNaFURS(
      {
        stevilkaRacuna: stornoStevilka,
        datumCas,
        skupaj: stornoSkupaj,
        ddv: stornoDdv,
        placilnaNacin: (["negotovinsko", "reprezentanca", "lastna_poraba"].includes(racun.placilnaNacin) ? "other" : racun.placilnaNacin) as "gotovina" | "kartica" | "bon" | "other",
        postavke: stornoPostavkeFurs,
        davcnaStevilka: nastavitve.davcnaStevilka,
        poslovnaProstor: activePP,
        blagajnaId: activeBId,
        operatorDavcna: racun.natakarDavcna ?? undefined,
        jeStorno: true,
        izvornaStevRacuna: racun.stevilkaRacuna,
        izvornaStevRacunaDatumCas: new Date(racun.datumCas ?? racun.ustvarjeno),
        certifikatPot: nastavitve.certifikatPot || undefined,
        certifikatGeslo: nastavitve.certifikatGeslo || undefined,
        certPem: nastavitveMap["certifikatPem"] || undefined,
        certKljuc: nastavitveMap["certifikatKljuc"] || undefined,
        proxyUrl: nastavitve.fursProxyUrl || undefined},
      fursNacin,
      true,  // preskociPreverjanje — negativni zneski so izvedeni iz že potrjenega računa
      Number(nastavitveMap["ddvSplosnaSt"] ?? "22")
    );
  } catch (err) {
    const sporocilo = err instanceof Error ? err.message : String(err);
    req.log.error({ racunId: racun.id, stornoStevilka, napaka: sporocilo }, "Napaka pri FURS storno zahtevku");
    throw err;
  }

  const stornoStatus = fursOdgovor.uspeh ? (fursNacin !== "produkcija" ? "testni" : "poslan") : "napaka";

  let stornoRacun: typeof racuniTable.$inferSelect;
  await db.transaction(async (tx) => {
    // Preveri race condition — zaklenemo izvorno vrstico
    const locked = await tx.execute(
      sql`SELECT status FROM racuni WHERE id = ${racun.id} AND podjetje_davcna = ${""} AND enota_id = ${tenotaId} FOR UPDATE`
    );
    const lockedStatus = (locked.rows[0] as { status: string } | undefined)?.status;
    if (lockedStatus === "storniran") {
      throw Object.assign(new Error("already_storniran"), { code: "already_storniran" });
    }

    // Vstavi storno račun z negativnimi zneski
    const [inserted] = await tx.insert(racuniTable).values({
      enotaId: tenotaId,
      narociloId: racun.narociloId,
      stevilkaRacuna: stornoStevilka,
      skupaj: String(stornoSkupaj.toFixed(2)),
      ddv: String(stornoDdv.toFixed(2)),
      osnova: String(round2(-Number(racun.osnova ?? 0)).toFixed(2)),
      placilnaNacin: racun.placilnaNacin,
      status: stornoStatus,
      zoi: fursOdgovor.zoi || null,
      eor: fursOdgovor.eor || null,
      fursOdgovor: fursOdgovor.surovOdgovor,
      natakarIme: racun.natakarIme,
      natakarDavcna: racun.natakarDavcna,
      opomba: `Storno računa ${racun.stevilkaRacuna}`,
      jeStorno: true,
      izvorniRacunId: racun.id}).returning();
    stornoRacun = inserted!;

    // Vstavi negativne postavke za storno račun (za DDV razrez in realizacijo)
    if (izvornePostavke.length > 0) {
      await tx.insert(postavkeTable).values(
        izvornePostavke.map((p) => {
          const negKolicina = -p.kolicina;
          const negSkupaj = round2(negKolicina * Number(p.cenaKos));
          return {
            narociloId: racun.narociloId,
            artikelId: p.artikelId,
            ime: p.ime,
            kolicina: negKolicina,
            cenaKos: p.cenaKos,
            cenaKosOriginalna: p.cenaKosOriginalna,
            skupaj: String(negSkupaj.toFixed(2)),
            davek: p.davek,
            opomba: p.opomba,
            racunId: stornoRacun.id,
            gostStevilka: p.gostStevilka};
        })
      );
    }

    // Označi izvorni račun kot storniran
    await tx.update(racuniTable).set({ status: "storniran" }).where(eq(racuniTable.id, racun.id));

    // Povrni zalogo (storno porabe)
    const porabe = await tx
      .select()
      .from(zalogaGibiTable)
      .where(and(eq(zalogaGibiTable.referencaId, racun.id), eq(zalogaGibiTable.tip, "poraba")));

    const prizadetiArtikelIds: number[] = [];
    for (const poraba of porabe) {
      await tx.insert(zalogaGibiTable).values({
        artikelId: poraba.artikelId,
        tip: "storno",
        kolicina: String(-Number(poraba.kolicina)),
        opomba: `Storno računa ${racun.stevilkaRacuna}`,
        referencaId: stornoRacun.id});
      if (!prizadetiArtikelIds.includes(poraba.artikelId)) {
        prizadetiArtikelIds.push(poraba.artikelId);
      }
    }
    await recomputeZaloge(prizadetiArtikelIds, tx);
  }).catch((err: Error & { code?: string }) => {
    if (err.code === "already_storniran") {
      res.status(409).json({ error: "Račun je že storniran" });
      return;
    }
    throw err;
  });

  // Če je bila napaka pri race condition — res je bil nastavljen, končaj
  if (res.headersSent) return;

  req.log.info(
    { racunId: racun.id, stornoRacunId: stornoRacun!.id, stornoStevilka, fursNacin },
    "Storno računa izdan in poslan na FURS"
  );

  const [withMiza] = await db
    .select({
      ...baseSelect})
    .from(racuniTable)
    .leftJoin(narocilaTable, eq(racuniTable.narociloId, narocilaTable.id))
    .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .where(eq(racuniTable.id, stornoRacun!.id));

  broadcast("update", { type: "racun" });
  res.json(({
    ...withMiza,
    skupaj: Number(withMiza!.skupaj),
    ddv: Number(withMiza!.ddv),
    osnova: withMiza!.osnova != null ? Number(withMiza!.osnova) : null,
    zoi: withMiza!.zoi ?? null,
    eor: withMiza!.eor ?? null,
    fursOdgovor: withMiza!.fursOdgovor ?? null,
    natakarIme: withMiza!.natakarIme ?? null,
    natakarDavcna: withMiza!.natakarDavcna ?? null,
    mizaStevilka: withMiza!.mizaStevilka ?? null,
    fursNapaka: (!fursOdgovor.uspeh && fursOdgovor.napaka) ? prevediFursNapako(fursOdgovor.napaka) : null,
    opomba: withMiza!.opomba ?? null,
    jeDelni: withMiza!.jeDelni ?? false,
    jeStorno: withMiza!.jeStorno ?? false,
    izvorniRacunId: (withMiza as any).izvorniRacunId ?? (withMiza as any).izvorniRacunId ?? null}));
});

router.patch("/racuni/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const parsed = { success: true, data: req.body };
  if (!parsed.success) { res.status(400).json({ error: (parsed as any).error?.message ?? "Napačni parametri" }); return; }

  const [updated] = await db
    .update(racuniTable)
    .set({
      placilnaNacin: parsed.data.placilnaNacin,
      znesekGotovina: parsed.data.znesekGotovina != null ? String((parsed.data.znesekGotovina as number).toFixed(2)) : null,
      znesekKartica: parsed.data.znesekKartica != null ? String((parsed.data.znesekKartica as number).toFixed(2)) : null,
      znesekBon: parsed.data.znesekBon != null ? String((parsed.data.znesekBon as number).toFixed(2)) : null,
      steviloBonov: parsed.data.steviloBonov ?? null,
      znesekBonPica: parsed.data.znesekBonPica != null ? String((parsed.data.znesekBonPica as number).toFixed(2)) : null,
      izdaniKuponi: (parsed.data as { izdaniKuponi?: number | null }).izdaniKuponi ?? null,
      ...(parsed.data as { kupecDavcnaStevilka?: string | null }).kupecDavcnaStevilka !== undefined && { kupecDavcnaStevilka: (parsed.data as { kupecDavcnaStevilka?: string | null }).kupecDavcnaStevilka },
      ...(parsed.data as { kupecNaziv?: string | null }).kupecNaziv !== undefined && { kupecNaziv: (parsed.data as { kupecNaziv?: string | null }).kupecNaziv },
      ...(parsed.data as { kupecNaslov?: string | null }).kupecNaslov !== undefined && { kupecNaslov: (parsed.data as { kupecNaslov?: string | null }).kupecNaslov },
      ...(parsed.data as { kupecZavezanecDdv?: boolean | null }).kupecZavezanecDdv !== undefined && { kupecZavezanecDdv: (parsed.data as { kupecZavezanecDdv?: boolean | null }).kupecZavezanecDdv }})
    .where(and(eq(racuniTable.id, id), sql`true`, eq(racuniTable.enotaId, tenotaId)))
    .returning({ id: racuniTable.id });

  if (!updated) { res.status(404).json({ error: "Račun ni najden" }); return; }

  res.json({ id: updated.id });
});

router.get("/racuni/:id/postavke", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const racunId = Number(req.params.id);
  if (isNaN(racunId)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const [racun] = await db.select({ id: racuniTable.id })
    .from(racuniTable)
    .where(and(eq(racuniTable.id, racunId), sql`true`, eq(racuniTable.enotaId, tenotaId)));

  if (!racun) { res.status(404).json({ error: "Račun ni najden" }); return; }

  const postavke = await db
    .select({
      artikelId: postavkeTable.artikelId,
      ime: postavkeTable.ime,
      kolicina: postavkeTable.kolicina,
      cenaKos: postavkeTable.cenaKos})
    .from(postavkeTable)
    .where(eq(postavkeTable.racunId, racunId));

  // Aggregate by artikelId (handles partial-receipt duplicates): sum quantities, keep last price/name
  const byArtikel = new Map<number, { artikelId: number; ime: string; kolicina: number; cenaKos: number }>();
  for (const p of postavke) {
    if (p.artikelId == null) continue;
    const existing = byArtikel.get(p.artikelId);
    if (existing) {
      existing.kolicina += p.kolicina;
    } else {
      byArtikel.set(p.artikelId, { artikelId: p.artikelId, ime: p.ime, kolicina: p.kolicina, cenaKos: Number(p.cenaKos) });
    }
  }
  res.json(Array.from(byArtikel.values()));
});

router.get("/racuni/:id", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const params = { success: true as const, data: { id: Number(req.params.id) } };
  if (!params.success) { res.status(400).json({ error: (params as any).error.message }); return; }

  const [row] = await db
    .select({
      id: racuniTable.id,
      narociloId: racuniTable.narociloId,
      stevilkaRacuna: racuniTable.stevilkaRacuna,
      skupaj: racuniTable.skupaj,
      ddv: racuniTable.ddv,
      osnova: racuniTable.osnova,
      placilnaNacin: racuniTable.placilnaNacin,
      status: racuniTable.status,
      zoi: racuniTable.zoi,
      eor: racuniTable.eor,
      fursOdgovor: racuniTable.fursOdgovor,
      natakarIme: racuniTable.natakarIme,
      natakarDavcna: racuniTable.natakarDavcna,
      ustvarjeno: racuniTable.ustvarjeno,
      datumCas: racuniTable.datumCas,
      mizaStevilka: mizeTable.stevilka,
      opomba: racuniTable.opomba,
      jeDelni: racuniTable.jeDelni,
      znesekGotovina: racuniTable.znesekGotovina,
      znesekKartica: racuniTable.znesekKartica,
      znesekBon: racuniTable.znesekBon,
      steviloBonov: racuniTable.steviloBonov,
      znesekBonPica: racuniTable.znesekBonPica,
      kupecDavcnaStevilka: racuniTable.kupecDavcnaStevilka,
      kupecNaziv: racuniTable.kupecNaziv,
      kupecNaslov: racuniTable.kupecNaslov})
    .from(racuniTable)
    .leftJoin(narocilaTable, eq(racuniTable.narociloId, narocilaTable.id))
    .leftJoin(mizeTable, eq(narocilaTable.mizaId, mizeTable.id))
    .where(and(eq(racuniTable.id, params.data.id), sql`true`, eq(racuniTable.enotaId, tenotaId)));

  if (!row) { res.status(404).json({ error: "Račun ni najden" }); return; }

  res.json(({
    ...row,
    skupaj: Number(row.skupaj),
    ddv: Number(row.ddv),
    osnova: row.osnova != null ? Number(row.osnova) : null,
    zoi: row.zoi ?? null,
    eor: row.eor ?? null,
    fursOdgovor: row.fursOdgovor ?? null,
    natakarIme: row.natakarIme ?? null,
    natakarDavcna: row.natakarDavcna ?? null,
    mizaStevilka: row.mizaStevilka ?? null,
    opomba: row.opomba ?? null,
    jeDelni: row.jeDelni ?? false,
    znesekGotovina: row.znesekGotovina != null ? Number(row.znesekGotovina) : null,
    znesekKartica: row.znesekKartica != null ? Number(row.znesekKartica) : null,
    znesekBon: row.znesekBon != null ? Number(row.znesekBon) : null,
    steviloBonov: row.steviloBonov ?? null,
    znesekBonPica: row.znesekBonPica != null ? Number(row.znesekBonPica) : null,
    kupecDavcnaStevilka: row.kupecDavcnaStevilka ?? null,
    kupecNaziv: row.kupecNaziv ?? null,
    kupecNaslov: row.kupecNaslov ?? null}));
});

router.get("/racuni/:id/vracila", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID računa" }); return; }

  const racun = await db.select({ id: racuniTable.id })
    .from(racuniTable)
    .where(and(eq(racuniTable.id, id), sql`true`, eq(racuniTable.enotaId, tenotaId)))
    .limit(1);

  if (racun.length === 0) { res.status(404).json({ error: "Račun ni najden" }); return; }

  const vracila = await db.select({
    id: vivaVracilaTable.id,
    racunId: vivaVracilaTable.racunId,
    refundSessionId: vivaVracilaTable.refundSessionId,
    znesek: vivaVracilaTable.znesek,
    status: vivaVracilaTable.status,
    napaka: vivaVracilaTable.napaka,
    ustvarjeno: vivaVracilaTable.ustvarjeno})
    .from(vivaVracilaTable)
    .where(and(
      eq(vivaVracilaTable.racunId, id),
      sql`true`,
      eq(vivaVracilaTable.enotaId, tenotaId),
    ));

  res.json(vracila.map(v => ({
    ...v,
    znesek: Number(v.znesek),
    ustvarjeno: v.ustvarjeno instanceof Date ? v.ustvarjeno.toISOString() : v.ustvarjeno})));
});

export default router;
