import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, count, desc, eq, gte, isNotNull, lte, ne, sql, sum } from "drizzle-orm";
import { artikliTable, companiesTable, db, enoteTable, narocilaTable, nastavitveTable, postavkeTable, racuniTable } from "@workspace/db";

const router: IRouter = Router();

function izracunajZacetekDneva(zacetekDnevaUra: string): Date {
  const [hStr, mStr] = zacetekDnevaUra.split(":");
  const startH = parseInt(hStr ?? "4", 10);
  const startM = parseInt(mStr ?? "0", 10);
  const now = new Date();
  const start = new Date();
  start.setHours(startH, startM, 0, 0);
  if (now < start) {
    start.setDate(start.getDate() - 1);
  }
  return start;
}

router.get("/statistike/promet-obdobja", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;

  const { od, do: doParam } = req.query as { od?: string; do?: string };
  if (!od || !doParam) {
    res.status(400).json({ error: "Manjkata parametra od in do (YYYY-MM-DD)" }); return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(od) || !/^\d{4}-\d{2}-\d{2}$/.test(doParam)) {
    res.status(400).json({ error: "Neveljaven format datuma" }); return;
  }

  // Pridobi začetek poslovnega dne iz enote
  const [enotaInfo] = await db.select({ zacetekDnevaUra: enoteTable.zacetekDnevaUra })
    .from(enoteTable)
    .where(and(eq(enoteTable.id, tenotaId)));
  const zacetekUra = enotaInfo?.zacetekDnevaUra ?? "04:00";

  // Pretvori datumske meje v UTC glede na slovensko časovno cono in začetek poslovnega dne
  // Npr.: od=2026-06-25, zacetekUra=06:00 → 2026-06-25T06:00:00+02:00 = 2026-06-25T04:00:00Z
  const mejeBoundary = await db.execute(sql`
    SELECT
      (${od}::date       + ${zacetekUra}::time) AT TIME ZONE 'Europe/Ljubljana' AS od_utc,
      (${doParam}::date  + INTERVAL '1 day' + ${zacetekUra}::time) AT TIME ZONE 'Europe/Ljubljana' AS do_utc
  `);
  type MejeRow = { od_utc: Date; do_utc: Date };
  const mejRow = mejeBoundary.rows[0] as MejeRow;
  const odDate  = new Date(mejRow.od_utc);
  const doDate  = new Date(mejRow.do_utc);

  const podmeje = and(
    gte(racuniTable.ustvarjeno, odDate),
    lte(racuniTable.ustvarjeno, doDate),
    sql`true`,
    eq(racuniTable.enotaId, tenotaId),
  );

  const [skupni] = await db.select({ skupaj: sum(racuniTable.skupaj), stevilo: count(racuniTable.id), ddv: sum(racuniTable.ddv) })
    .from(racuniTable).where(podmeje);

  const netSql = sql<string>`SUM(skupaj::numeric - COALESCE(znesek_bon_pica::numeric, 0))`;
  const [gtv] = await db.select({ skupaj: netSql }).from(racuniTable).where(and(podmeje, eq(racuniTable.placilnaNacin, "gotovina")));
  const [bon] = await db.select({ skupaj: netSql }).from(racuniTable).where(and(podmeje, eq(racuniTable.placilnaNacin, "bon")));
  const [krtSumup] = await db.select({ skupaj: netSql }).from(racuniTable).where(and(podmeje, eq(racuniTable.placilnaNacin, "kartica"), isNotNull(racuniTable.sumupCheckoutId)));
  const [krtBrez] = await db.select({ skupaj: netSql }).from(racuniTable).where(and(podmeje, eq(racuniTable.placilnaNacin, "kartica"), sql`${racuniTable.sumupCheckoutId} IS NULL`));
  const [negot] = await db.select({ skupaj: netSql }).from(racuniTable).where(and(podmeje, eq(racuniTable.placilnaNacin, "negotovinsko")));
  const [repr] = await db.select({ skupaj: netSql }).from(racuniTable).where(and(podmeje, eq(racuniTable.placilnaNacin, "reprezentanca")));
  const [lastna] = await db.select({ skupaj: netSql }).from(racuniTable).where(and(podmeje, eq(racuniTable.placilnaNacin, "lastna_poraba")));
  const [bonPicaRes] = await db.select({ skupaj: sum(racuniTable.znesekBonPica), steviloBonov: sum(racuniTable.steviloBonov) }).from(racuniTable).where(podmeje);

  const [kuponRes] = await db.select({
    prejetiKuponi: sql<number>`COALESCE(SUM(${racuniTable.steviloBonov}) * 10, 0)::int`,
    izdaniKuponi: sql<number>`COALESCE(SUM(${racuniTable.izdaniKuponi}), 0)::int`}).from(racuniTable).where(podmeje);

  // ── po blagajni (PP-BB koda iz stevilke racuna) ──────────
  const poBlagajnahRaw = await db.execute(sql`
    SELECT
      SPLIT_PART(stevilka_racuna, '-', 1) || '-' || SPLIT_PART(stevilka_racuna, '-', 2) AS blagajna_koda,
      SUM(skupaj::numeric)                    AS skupaj,
      COUNT(*)::int                           AS stevilo_racunov,
      MIN(SPLIT_PART(stevilka_racuna, '-', 3)) AS od_zap,
      MAX(SPLIT_PART(stevilka_racuna, '-', 3)) AS do_zap
    FROM racuni
    WHERE ustvarjeno >= ${odDate.toISOString()}::timestamptz
      AND ustvarjeno <= ${doDate.toISOString()}::timestamptz
      AND enota_id = ${tenotaId}
    GROUP BY SPLIT_PART(stevilka_racuna, '-', 1) || '-' || SPLIT_PART(stevilka_racuna, '-', 2)
    ORDER BY SPLIT_PART(stevilka_racuna, '-', 1) || '-' || SPLIT_PART(stevilka_racuna, '-', 2)
  `);
  type BlagajnaRow = { blagajna_koda: string; skupaj: string; stevilo_racunov: number; od_zap: string; do_zap: string };
  const prometPoBlagajnah = (poBlagajnahRaw.rows as BlagajnaRow[]).map(r => ({
    blagajnaKoda: r.blagajna_koda,
    skupaj: Number(r.skupaj),
    steviloRacunov: Number(r.stevilo_racunov),
    odZap: r.od_zap ?? null,
    doZap: r.do_zap ?? null}));

  // ── po natakarju z razčlenitvijo po načinu plačila ───────
  const poNatakarjihRaw = await db.execute(sql`
    SELECT
      COALESCE(natakar_ime, '—') AS natakar_ime,
      SUM(skupaj::numeric) AS skupaj,
      SUM(CASE WHEN placilna_nacin = 'gotovina' THEN skupaj::numeric - COALESCE(znesek_bon_pica::numeric, 0) ELSE 0 END) AS gotovina,
      SUM(CASE WHEN placilna_nacin = 'kartica' AND sumup_checkout_id IS NULL THEN skupaj::numeric - COALESCE(znesek_bon_pica::numeric, 0) ELSE 0 END) AS kartica,
      SUM(CASE WHEN placilna_nacin = 'kartica' AND sumup_checkout_id IS NOT NULL THEN skupaj::numeric - COALESCE(znesek_bon_pica::numeric, 0) ELSE 0 END) AS sumup,
      SUM(CASE WHEN placilna_nacin = 'bon' THEN skupaj::numeric - COALESCE(znesek_bon_pica::numeric, 0) ELSE 0 END) AS bon,
      COALESCE(SUM(znesek_bon_pica::numeric), 0) AS bon_pica,
      COALESCE(SUM(stevilo_bonov), 0)::int AS stevilo_bonov_pica,
      COUNT(*)::int AS stevilo_racunov
    FROM racuni
    WHERE ustvarjeno >= ${odDate.toISOString()}::timestamptz
      AND ustvarjeno <= ${doDate.toISOString()}::timestamptz
      AND enota_id = ${tenotaId}
    GROUP BY natakar_ime
    ORDER BY skupaj DESC
  `);
  type NatakarRow = { natakar_ime: string; skupaj: string; gotovina: string; kartica: string; sumup: string; bon: string; bon_pica: string; stevilo_bonov_pica: number; stevilo_racunov: number };
  const prometPoNatakarjih = (poNatakarjihRaw.rows as NatakarRow[]).map(r => ({
    natakarIme: r.natakar_ime,
    skupaj: Number(r.skupaj),
    gotovina: Number(r.gotovina),
    kartica: Number(r.kartica),
    sumup: Number(r.sumup),
    bon: Number(r.bon),
    bonPica: Number(r.bon_pica),
    steviloBonov: Number(r.stevilo_bonov_pica),
    steviloRacunov: Number(r.stevilo_racunov)}));

  // ── prihodki po vrsti (storitve vs blago) ────────────────
  // blago  = postavke kjer to_go=true ALI kjer je starš (parent_postavka_id) to_go=true
  //          (npr. škatla za pico se avtomatsko doda k to-go pici — davek starša se ohrani)
  // storitve = vse ostale postavke
  const prihodkiVrstaRaw = await db.execute(sql`
    SELECT
      SUM(CASE WHEN p.to_go = true OR parent.to_go = true
               THEN p.skupaj::numeric * 100.0 / (100 + p.davek::numeric)
               ELSE 0 END) AS blago,
      SUM(CASE WHEN p.to_go = false AND (parent.id IS NULL OR parent.to_go = false)
               THEN p.skupaj::numeric * 100.0 / (100 + p.davek::numeric)
               ELSE 0 END) AS storitve
    FROM postavke p
    LEFT JOIN postavke parent ON parent.id = p.parent_postavka_id
    JOIN racuni r ON r.id = p.racun_id
    WHERE r.ustvarjeno >= ${odDate.toISOString()}::timestamptz
      AND r.ustvarjeno <= ${doDate.toISOString()}::timestamptz
      AND r.enota_id = ${tenotaId}
  `);
  type PrihodkiVrstaRow = { storitve: string | null; blago: string | null };
  const pvRow = prihodkiVrstaRaw.rows[0] as PrihodkiVrstaRow | undefined;
  const prihodkiPoVrsti = {
    storitve: Number(pvRow?.storitve ?? 0),
    blago: Number(pvRow?.blago ?? 0)};

  // ── DDV po stopnjah (iz postavk) ─────────────────────────
  const ddvPoStopnjahRaw = await db.execute(sql`
    SELECT
      p.davek::numeric AS stopnja,
      SUM(p.skupaj::numeric * p.davek::numeric / (100 + p.davek::numeric)) AS ddv_znesek,
      SUM(p.skupaj::numeric / (1 + p.davek::numeric / 100))                AS osnova
    FROM postavke p
    JOIN racuni r ON r.id = p.racun_id
    WHERE r.ustvarjeno >= ${odDate.toISOString()}::timestamptz
      AND r.ustvarjeno <= ${doDate.toISOString()}::timestamptz
      AND r.enota_id = ${tenotaId}
    GROUP BY p.davek
    ORDER BY p.davek
  `);
  type DdvRow = { stopnja: string; ddv_znesek: string; osnova: string };
  const ddvPoStopnjah = (ddvPoStopnjahRaw.rows as DdvRow[]).map(r => ({
    stopnja: Number(r.stopnja),
    ddvZnesek: Number(r.ddv_znesek),
    osnova: Number(r.osnova)}));

  // ── od/do zaporedne številke ──────────────────────────────
  const zapSeqResult = await db.execute(sql`
    SELECT
      MIN(SPLIT_PART(stevilka_racuna, '-', 3)) AS od_zap,
      MAX(SPLIT_PART(stevilka_racuna, '-', 3)) AS do_zap
    FROM racuni
    WHERE ustvarjeno >= ${odDate.toISOString()}::timestamptz
      AND ustvarjeno <= ${doDate.toISOString()}::timestamptz
      AND enota_id = ${tenotaId}
  `);
  type ZapRow = { od_zap?: string | null; do_zap?: string | null };
  const zapRow = zapSeqResult.rows[0] as ZapRow | undefined;
  const odZap = zapRow?.od_zap ?? null;
  const doZap = zapRow?.do_zap ?? null;

  // ── podatki podjetja iz companies prek enote ────────────
  const [podjetje] = await db
    .select({ naziv: companiesTable.naziv, naslov: companiesTable.naslov,
              ulica: companiesTable.ulica, postnaStevika: companiesTable.postnaStevika,
              kraj: companiesTable.kraj, idZaDdv: companiesTable.idZaDdv })
    .from(enoteTable)
    .innerJoin(companiesTable, eq(enoteTable.companyId, companiesTable.id))
    .where(eq(enoteTable.id, tenotaId));
  const podjetjeNaslov = podjetje?.naslov
    ?? [podjetje?.ulica, podjetje?.postnaStevika, podjetje?.kraj].filter(Boolean).join(", ")
    ?? "";

  res.json({
    skupajPromet: Number(skupni?.skupaj ?? 0),
    steviloRacunov: Number(skupni?.stevilo ?? 0),
    skupajDDV: Number(skupni?.ddv ?? 0),
    prometPoNacinuPlacila: {
      gotovina: Number(gtv?.skupaj ?? 0),
      kartica: Number(krtBrez?.skupaj ?? 0),
      bon: Number(bon?.skupaj ?? 0),
      sumup: Number(krtSumup?.skupaj ?? 0),
      bonPica: Number(bonPicaRes?.skupaj ?? 0),
      steviloBonov: Number(bonPicaRes?.steviloBonov ?? 0),
      negotovinsko: Number(negot?.skupaj ?? 0),
      reprezentanca: Number(repr?.skupaj ?? 0),
      lastna_poraba: Number(lastna?.skupaj ?? 0)},
    prometPoBlagajnah,
    prometPoNatakarjih,
    ddvPoStopnjah,
    prihodkiPoVrsti,
    izdaniKuponi: Number(kuponRes?.izdaniKuponi ?? 0),
    prejetiKuponi: Number(kuponRes?.prejetiKuponi ?? 0),
    odZap,
    doZap,
    podjetje: {
      naziv: podjetje?.naziv ?? "",
      naslov: podjetjeNaslov,
      davcnaStevilka: podjetje?.idZaDdv ?? ""}});
});

router.get("/statistike", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;

  const [enota] = await db.select({ zacetekDnevaUra: enoteTable.zacetekDnevaUra })
    .from(enoteTable)
    .where(and(eq(enoteTable.id, tenotaId)));
  const startOfDay = izracunajZacetekDneva(enota?.zacetekDnevaUra ?? "04:00");

  const [dnevniStats] = await db
    .select({
      skupaj: sum(racuniTable.skupaj),
      steviloRacunov: count(racuniTable.id),
      skupajDDV: sum(racuniTable.ddv)})
    .from(racuniTable)
    .where(and(gte(racuniTable.ustvarjeno, startOfDay), sql`true`, eq(racuniTable.enotaId, tenotaId)));

  const [aktivnaCount] = await db
    .select({ stev: count(narocilaTable.id) })
    .from(narocilaTable)
    .where(and(eq(narocilaTable.status, "odprto"), sql`true`, eq(narocilaTable.enotaId, tenotaId)));

  const priljubljeni = await db
    .select({
      artikelId: postavkeTable.artikelId,
      ime: postavkeTable.ime,
      steviloNarocil: count(postavkeTable.id),
      skupajZnesek: sum(postavkeTable.skupaj)})
    .from(postavkeTable)
    .innerJoin(artikliTable, eq(postavkeTable.artikelId, artikliTable.id))
    .where(and(eq(artikliTable.enotaId, tenotaId)))
    .groupBy(postavkeTable.artikelId, postavkeTable.ime)
    .orderBy(desc(count(postavkeTable.id)))
    .limit(5);

  const netSqlDnevni = sql<string>`SUM(skupaj::numeric - COALESCE(znesek_bon_pica::numeric, 0))`;
  const dnevniPogoj = and(gte(racuniTable.ustvarjeno, startOfDay), sql`true`, eq(racuniTable.enotaId, tenotaId));

  const [gotovina] = await db
    .select({ skupaj: netSqlDnevni })
    .from(racuniTable)
    .where(and(dnevniPogoj, eq(racuniTable.placilnaNacin, "gotovina")));

  const [bon] = await db
    .select({ skupaj: netSqlDnevni })
    .from(racuniTable)
    .where(and(dnevniPogoj, eq(racuniTable.placilnaNacin, "bon")));

  const [kartSumup] = await db
    .select({ skupaj: netSqlDnevni })
    .from(racuniTable)
    .where(and(dnevniPogoj, eq(racuniTable.placilnaNacin, "kartica"), isNotNull(racuniTable.sumupCheckoutId)));

  const [kartBrezSumup] = await db
    .select({ skupaj: netSqlDnevni })
    .from(racuniTable)
    .where(and(dnevniPogoj, eq(racuniTable.placilnaNacin, "kartica"), sql`${racuniTable.sumupCheckoutId} IS NULL`));

  const [bonPicaDnevni] = await db
    .select({ skupaj: sum(racuniTable.znesekBonPica), steviloBonov: sum(racuniTable.steviloBonov) })
    .from(racuniTable)
    .where(dnevniPogoj);

  const [negotDnevni] = await db
    .select({ skupaj: netSqlDnevni })
    .from(racuniTable)
    .where(and(dnevniPogoj, eq(racuniTable.placilnaNacin, "negotovinsko")));

  const [reprDnevni] = await db
    .select({ skupaj: netSqlDnevni })
    .from(racuniTable)
    .where(and(dnevniPogoj, eq(racuniTable.placilnaNacin, "reprezentanca")));

  const [lastnaDnevni] = await db
    .select({ skupaj: netSqlDnevni })
    .from(racuniTable)
    .where(and(dnevniPogoj, eq(racuniTable.placilnaNacin, "lastna_poraba")));

  const prometPoNacinuPlacila = {
    gotovina: Number(gotovina?.skupaj ?? 0),
    kartica: Number(kartBrezSumup?.skupaj ?? 0),
    bon: Number(bon?.skupaj ?? 0),
    sumup: Number(kartSumup?.skupaj ?? 0),
    bonPica: Number(bonPicaDnevni?.skupaj ?? 0),
    steviloBonov: Number(bonPicaDnevni?.steviloBonov ?? 0),
    negotovinsko: Number(negotDnevni?.skupaj ?? 0),
    reprezentanca: Number(reprDnevni?.skupaj ?? 0),
    lastna_poraba: Number(lastnaDnevni?.skupaj ?? 0)};

  const prometPoUrahRaw = await db.execute(
    sql`SELECT EXTRACT(HOUR FROM ustvarjeno)::int AS ura, SUM(skupaj::numeric) AS znesek
        FROM racuni
        WHERE ustvarjeno >= ${startOfDay}
          AND enota_id = ${tenotaId}
        GROUP BY EXTRACT(HOUR FROM ustvarjeno)
        ORDER BY ura`
  );

  const prometPoUrah = (prometPoUrahRaw.rows as { ura: number; znesek: string }[]).map((r) => ({
    ura: r.ura,
    znesek: Number(r.znesek)}));

  const startOfDayIso = startOfDay.toISOString();
  const izmeneStatRaw = await db.execute(
    sql`SELECT
          i.id            AS izmena_id,
          n.ime || ' ' || n.priimek AS natakar_ime,
          i.zacetek,
          i.konec,
          COALESCE(SUM(r.skupaj::numeric), 0) AS skupaj_znesek,
          COUNT(r.id)::int                    AS stevilo_racunov
        FROM izmene i
        JOIN natakari n ON n.id = i.natakari_id
        LEFT JOIN racuni r ON r.izmena_id = i.id
        WHERE i.enota_id = ${tenotaId}
          AND (
            i.zacetek >= ${startOfDayIso}::timestamptz
            OR i.konec >= ${startOfDayIso}::timestamptz
            OR i.konec IS NULL
          )
        GROUP BY i.id, n.ime, n.priimek, i.zacetek, i.konec
        ORDER BY i.zacetek`
  );

  type IzmenaStatRow = { izmena_id: number; natakar_ime: string; zacetek: Date; konec: Date | null; skupaj_znesek: string; stevilo_racunov: number };
  const prometPoIzmenah = (izmeneStatRaw.rows as IzmenaStatRow[]).map((r) => ({
    izmenaId: Number(r.izmena_id),
    natakarIme: r.natakar_ime,
    zacetek: r.zacetek instanceof Date ? r.zacetek.toISOString() : String(r.zacetek),
    konec: r.konec ? (r.konec instanceof Date ? r.konec.toISOString() : String(r.konec)) : null,
    skupajZnesek: Number(r.skupaj_znesek),
    steviloRacunov: Number(r.stevilo_racunov),
    aktivna: r.konec === null}));

  res.json(({
    dnevniPromet: Number(dnevniStats?.skupaj ?? 0),
    steviloRacunov: Number(dnevniStats?.steviloRacunov ?? 0),
    steviloAktivnihNarocil: Number(aktivnaCount?.stev ?? 0),
    skupajDDV: Number(dnevniStats?.skupajDDV ?? 0),
    prometPoNacinuPlacila,
    priljubljeniArtikli: priljubljeni.map((p) => ({
      artikelId: p.artikelId,
      ime: p.ime,
      steviloNarocil: Number(p.steviloNarocil),
      skupajZnesek: Number(p.skupajZnesek ?? 0)})),
    prometPoUrah,
    prometPoIzmenah}));
});

router.get("/statistike/realizacija", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;

  const { od, do: doParam } = req.query as { od?: string; do?: string };
  if (!od || !doParam) { res.status(400).json({ error: "Manjkata parametra od in do" }); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(od) || !/^\d{4}-\d{2}-\d{2}$/.test(doParam)) {
    res.status(400).json({ error: "Neveljaven format datuma" }); return;
  }

  const [enotaInfo] = await db.select({ zacetekDnevaUra: enoteTable.zacetekDnevaUra })
    .from(enoteTable).where(and(eq(enoteTable.id, tenotaId)));
  const zacetekUra = enotaInfo?.zacetekDnevaUra ?? "04:00";

  const mejeBoundary = await db.execute(sql`
    SELECT
      (${od}::date + ${zacetekUra}::time) AT TIME ZONE 'Europe/Ljubljana' AS od_utc,
      (${doParam}::date + INTERVAL '1 day' + ${zacetekUra}::time) AT TIME ZONE 'Europe/Ljubljana' AS do_utc
  `);
  type MejeRow = { od_utc: Date; do_utc: Date };
  const mejRow = mejeBoundary.rows[0] as MejeRow;
  const odDate = new Date(mejRow.od_utc);
  const doDate = new Date(mejRow.do_utc);

  const podmeje = and(
    gte(racuniTable.ustvarjeno, odDate),
    lte(racuniTable.ustvarjeno, doDate),
    sql`true`,
    eq(racuniTable.enotaId, tenotaId),
  );

  const rows = await db.select({
    id: racuniTable.id,
    stevilkaRacuna: racuniTable.stevilkaRacuna,
    ustvarjeno: racuniTable.ustvarjeno,
    natakarIme: racuniTable.natakarIme,
    placilnaNacin: racuniTable.placilnaNacin,
    osnova: racuniTable.osnova,
    ddv: racuniTable.ddv,
    skupaj: racuniTable.skupaj,
    znesekGotovina: racuniTable.znesekGotovina,
    znesekKartica: racuniTable.znesekKartica,
    znesekBon: racuniTable.znesekBon,
    znesekBonPica: racuniTable.znesekBonPica,
    znesekNegotovinsko: racuniTable.znesekNegotovinsko,
    steviloBonov: racuniTable.steviloBonov,
    izdaniKuponiDB: racuniTable.izdaniKuponi,
    jeStorno: racuniTable.jeStorno,
    status: racuniTable.status}).from(racuniTable).where(podmeje).orderBy(asc(racuniTable.ustvarjeno));

  const [podjetje] = await db
    .select({ naziv: companiesTable.naziv, naslov: companiesTable.naslov,
              ulica: companiesTable.ulica, postnaStevika: companiesTable.postnaStevika,
              kraj: companiesTable.kraj, idZaDdv: companiesTable.idZaDdv })
    .from(enoteTable)
    .innerJoin(companiesTable, eq(enoteTable.companyId, companiesTable.id))
    .where(eq(enoteTable.id, tenotaId));
  const podjetjeNaslov = podjetje?.naslov
    ?? [podjetje?.ulica, podjetje?.postnaStevika, podjetje?.kraj].filter(Boolean).join(", ")
    ?? "";

  // Face value (znesek postavk pred popustom) za lastna_poraba/reprezentanca račune
  const specialIds = rows
    .filter(r => r.placilnaNacin === "lastna_poraba" || r.placilnaNacin === "reprezentanca")
    .map(r => r.id);
  const faceValueMap = new Map<number, number>();
  if (specialIds.length > 0) {
    const fvRows = await db.execute(sql`
      SELECT racun_id, SUM(skupaj::numeric) AS face_value
      FROM postavke
      WHERE racun_id = ANY(${sql.raw(`ARRAY[${specialIds.join(",")}]::int[]`)})
      GROUP BY racun_id
    `);
    for (const row of fvRows.rows as { racun_id: number; face_value: string }[]) {
      faceValueMap.set(Number(row.racun_id), Number(row.face_value));
    }
  }

  const mapped = rows.map(r => {
    const skupajN = Number(r.skupaj);
    const ddvN = Number(r.ddv);
    const osnova = r.osnova != null ? Number(r.osnova) : skupajN - ddvN;
    // resolve per-nacin amounts (fallback to skupaj if not split)
    let gotovina = r.znesekGotovina != null ? Number(r.znesekGotovina) : 0;
    let kartica  = r.znesekKartica  != null ? Number(r.znesekKartica)  : 0;
    let bon      = r.znesekBon      != null ? Number(r.znesekBon)      : 0;
    let bonPica  = r.znesekBonPica  != null ? Number(r.znesekBonPica)  : 0;
    let reprezentanca = 0;
    let lastna_poraba = 0;
    if (gotovina === 0 && kartica === 0 && bon === 0 && bonPica === 0) {
      if (r.placilnaNacin === "gotovina") gotovina = skupajN;
      else if (r.placilnaNacin === "kartica") kartica = skupajN;
      else if (r.placilnaNacin === "bon") bon = skupajN;
      else if (r.placilnaNacin === "bon_pica") bonPica = skupajN;
      else if (r.placilnaNacin === "reprezentanca") reprezentanca = faceValueMap.get(r.id) ?? skupajN;
      else if (r.placilnaNacin === "lastna_poraba") lastna_poraba = faceValueMap.get(r.id) ?? skupajN;
    }
    const stBonov = r.steviloBonov != null ? Number(r.steviloBonov) : 0;
    return {
      id: r.id,
      stevilkaRacuna: r.stevilkaRacuna,
      ustvarjeno: (r.ustvarjeno as Date).toISOString(),
      natakarIme: r.natakarIme ?? null,
      placilnaNacin: r.placilnaNacin,
      osnova,
      ddv: ddvN,
      skupaj: skupajN,
      gotovina,
      kartica,
      bon,
      bonPica,
      reprezentanca,
      lastna_poraba,
      steviloBonov: r.steviloBonov ?? null,
      jeStorno: r.jeStorno,
      status: r.status,
      izdaniKuponi: r.izdaniKuponiDB ?? 0,
      prejetiKuponi: stBonov * 10};
  });

  const skupaj = mapped.reduce((acc, r) => ({
    osnova:  acc.osnova  + r.osnova,
    ddv:     acc.ddv     + r.ddv,
    skupaj:  acc.skupaj  + r.skupaj,
    gotovina: acc.gotovina + r.gotovina,
    kartica:  acc.kartica  + r.kartica,
    bon:      acc.bon      + r.bon,
    bonPica:  acc.bonPica  + r.bonPica,
    reprezentanca: acc.reprezentanca + r.reprezentanca,
    lastna_poraba: acc.lastna_poraba + r.lastna_poraba,
    izdaniKuponi:  acc.izdaniKuponi  + r.izdaniKuponi,
    prejetiKuponi: acc.prejetiKuponi + r.prejetiKuponi}), { osnova: 0, ddv: 0, skupaj: 0, gotovina: 0, kartica: 0, bon: 0, bonPica: 0, reprezentanca: 0, lastna_poraba: 0, izdaniKuponi: 0, prejetiKuponi: 0 });

  // DDV razčlenjen po stopnjah za vsak račun posebej
  const racunIds = mapped.map(r => r.id);
  // Aktivni računi: brez storniranih in jeStorno — za artikle in skupni DDV-razrez
  const aktivniRacunIds = mapped.filter(r => r.status !== "storniran" && !r.jeStorno).map(r => r.id);
  type DdvR = { racun_id: string; stopnja: string; vrsta: string; osnova: string; ddv: string };
  const ddvMap = new Map<number, { stopnja: number; vrsta: string; osnova: number; ddv: number }[]>();
  if (racunIds.length > 0) {
    const ddvRaw = await db.execute(sql`
      SELECT
        p.racun_id,
        p.davek::numeric                                                            AS stopnja,
        CASE WHEN p.to_go = true OR pp.to_go = true THEN 'blago' ELSE 'storitev' END AS vrsta,
        SUM(p.skupaj::numeric / (1 + p.davek::numeric / 100.0))                    AS osnova,
        SUM(p.skupaj::numeric * p.davek::numeric / (100.0 + p.davek::numeric))     AS ddv
      FROM postavke p
      LEFT JOIN postavke pp ON pp.id = p.parent_postavka_id
      WHERE p.racun_id = ANY(${sql.raw(`ARRAY[${racunIds.join(",")}]::int[]`)})
      GROUP BY p.racun_id, p.davek,
               CASE WHEN p.to_go = true OR pp.to_go = true THEN 'blago' ELSE 'storitev' END
      ORDER BY p.racun_id, p.davek, vrsta DESC
    `);
    for (const row of ddvRaw.rows as DdvR[]) {
      const id = Number(row.racun_id);
      if (!ddvMap.has(id)) ddvMap.set(id, []);
      ddvMap.get(id)!.push({ stopnja: Number(row.stopnja), vrsta: row.vrsta, osnova: Number(row.osnova), ddv: Number(row.ddv) });
    }
  }

  // Dodamo ddvPoStopnjah vsakemu računu
  const racuniZDdv = mapped.map(r => ({
    ...r,
    ddvPoStopnjah: ddvMap.get(r.id) ?? []}));

  // Skupni DDV po stopnjah in vrsti (blago/storitev) — samo aktivni računi
  // blago = p.to_go=true ALI pp.to_go=true (starš je To Go — modif./embalaža sledijo starševski klasifikaciji)
  // storitev = vse ostalo (vključno z modifikatorji na ne-To-Go artiklih)
  type DdvSkupajR = { stopnja: string; vrsta: string; osnova: string; ddv: string };
  const ddvPoStopnjahSkupaj = await (async () => {
    if (aktivniRacunIds.length === 0) return [];
    const raw = await db.execute(sql`
      SELECT
        p.davek::numeric AS stopnja,
        CASE WHEN p.to_go = true OR pp.to_go = true THEN 'blago' ELSE 'storitev' END AS vrsta,
        SUM(p.skupaj::numeric / (1 + p.davek::numeric / 100.0))                   AS osnova,
        SUM(p.skupaj::numeric * p.davek::numeric / (100.0 + p.davek::numeric))    AS ddv
      FROM postavke p
      LEFT JOIN postavke pp ON pp.id = p.parent_postavka_id
      WHERE p.racun_id = ANY(${sql.raw(`ARRAY[${aktivniRacunIds.join(",")}]::int[]`)})
      GROUP BY p.davek,
               CASE WHEN p.to_go = true OR pp.to_go = true THEN 'blago' ELSE 'storitev' END
      ORDER BY p.davek, vrsta DESC
    `);
    return (raw.rows as DdvSkupajR[]).map(r => ({
      stopnja: Number(r.stopnja),
      vrsta: r.vrsta as "blago" | "storitev",
      osnova: Number(r.osnova),
      ddv: Number(r.ddv)}));
  })();

  // Per-artikel zbir — samo aktivni računi (storniran+jeStorno pari se izničijo z izključitvijo obeh)
  type ArtikelR = { ime: string; enota: string; kolicina: string; ddv_stopnja: string; vrsta: string; skupaj: string; osnova: string; ddv: string };
  const artikliRaw = aktivniRacunIds.length > 0
    ? await db.execute(sql`
        SELECT
          p.ime,
          COALESCE(a.enota_mere, 'KOS') AS enota,
          SUM(p.kolicina)::int AS kolicina,
          p.davek::numeric AS ddv_stopnja,
          CASE WHEN p.to_go = true OR pp.to_go = true THEN 'blago' ELSE 'storitev' END AS vrsta,
          SUM(CASE WHEN r.placilna_nacin IN ('lastna_poraba','reprezentanca') THEN 0::numeric ELSE p.skupaj::numeric END) AS skupaj,
          SUM(p.skupaj::numeric / (1 + p.davek::numeric / 100)) AS osnova,
          SUM(p.skupaj::numeric * p.davek::numeric / (100.0 + p.davek::numeric)) AS ddv
        FROM postavke p
        LEFT JOIN postavke pp ON pp.id = p.parent_postavka_id
        JOIN artikli a ON a.id = p.artikel_id
        JOIN racuni r ON r.id = p.racun_id
        WHERE p.racun_id = ANY(${sql.raw(`ARRAY[${aktivniRacunIds.join(",")}]::int[]`)})
        GROUP BY p.ime, a.enota_mere, p.davek,
                 CASE WHEN p.to_go = true OR pp.to_go = true THEN 'blago' ELSE 'storitev' END
        ORDER BY p.ime, p.davek, vrsta DESC
      `)
    : { rows: [] as ArtikelR[] };
  const artikli = (artikliRaw.rows as ArtikelR[]).map(r => ({
    ime: r.ime,
    enota: r.enota,
    kolicina: Number(r.kolicina),
    ddvStopnja: Number(r.ddv_stopnja),
    vrsta: r.vrsta as "blago" | "storitev",
    skupaj: Number(r.skupaj),
    osnova: Number(r.osnova),
    ddv: Number(r.ddv)}));

  res.json({ racuni: racuniZDdv, skupaj, ddvPoStopnjah: ddvPoStopnjahSkupaj, artikli, zacetekUra, podjetje: {
    naziv: podjetje?.naziv ?? "",
    naslov: podjetjeNaslov,
    davcnaStevilka: podjetje?.idZaDdv ?? ""}});
});

export default router;
