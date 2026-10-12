import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, count, desc, eq, gte, inArray, isNotNull, lt, lte, ne, sql, sum } from "drizzle-orm";
import { artikliTable, blagajneTable, companiesTable, darilniBonGibiTable, db, dailyLunchSaleSnapshotsTable, enoteTable, kategorijeTable, mizeTable, narocilaTable, nastavitveTable, posCashReconciliationsTable, posUporabnikiTable, postavkeTable, prostoriTable, racuniTable, zPorocilaTable } from "@workspace/db";
import type { PosRequest } from "../../middlewares/pos";
import { getBusinessDayBounds, getCurrentPosBusinessDate } from "../../lib/pos-business-day";
import { getPosReceiptPrefixPattern } from "../../lib/pos-register-receipt-prefix";
import { getTipBreakdown } from "../../lib/tip-reporting";
import { getZCloseBlockers } from "../../lib/pos-z-helpers";
import qrFeedbackReportRouter from "./qr-feedback-report";

const router: IRouter = Router();

router.use(qrFeedbackReportRouter);

router.get("/statistike/dnevna-kosila-obdobje", async (req, res): Promise<void> => {
  const posReq = req as PosRequest;
  const od = typeof req.query.od === "string" ? req.query.od : "";
  const doParam = typeof req.query.do === "string" ? req.query.do : "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(od) || !/^\d{4}-\d{2}-\d{2}$/.test(doParam) || od > doParam) {
    res.status(400).json({ error: "Neveljavno obdobje" }); return;
  }
  const allowedUnit = posReq.vloga === "admin_enote" ? posReq.enotaId : undefined;
  const rows = await db.select({ snapshot: dailyLunchSaleSnapshotsTable, enotaId: narocilaTable.enotaId })
    .from(dailyLunchSaleSnapshotsTable)
    .innerJoin(narocilaTable, eq(narocilaTable.id, dailyLunchSaleSnapshotsTable.narociloId))
    .where(and(
      gte(dailyLunchSaleSnapshotsTable.businessDate, od),
      lte(dailyLunchSaleSnapshotsTable.businessDate, doParam),
      ...(allowedUnit ? [eq(narocilaTable.enotaId, allowedUnit)] : []),
    ));
  const orders = rows.map((row) => row.snapshot);
  const articles = await db.select({ id: artikliTable.id, ime: artikliTable.ime }).from(artikliTable);
  const names = new Map(articles.map((article) => [article.id, article.ime]));
  const byMode = new Map<string, { stevilo: number; promet: number }>();
  const byDay = new Map<string, { stevilo: number; promet: number }>();
  const mains = new Map<number, { ime: string; stevilo: number; promet: number }>();
  for (const row of orders) {
    const total = Number(row.total);
    const mode = row.mode;
    const modeValue = byMode.get(mode) ?? { stevilo: 0, promet: 0 };
    modeValue.stevilo += 1; modeValue.promet += total; byMode.set(mode, modeValue);
    const dayValue = byDay.get(row.businessDate) ?? { stevilo: 0, promet: 0 };
    dayValue.stevilo += 1; dayValue.promet += total; byDay.set(row.businessDate, dayValue);
    const mainId = Number((row.selectedDishes as { main?: number }).main);
    const main = mains.get(mainId) ?? { ime: names.get(mainId) ?? `Artikel ${mainId}`, stevilo: 0, promet: 0 };
    main.stevilo += 1; main.promet += total; mains.set(mainId, main);
  }
  const summarize = (mode: string, value: { stevilo: number; promet: number }) => ({
    mode, stevilo: value.stevilo, promet: Number(value.promet.toFixed(2)),
    povprecnaVrednost: value.stevilo ? Number((value.promet / value.stevilo).toFixed(2)) : 0,
  });
  res.json({
    od, do: doParam, enote: [], dnevi: [...byDay.entries()].map(([datum, value]) => ({ datum, enotaId: posReq.enotaId, enota: "", ...summarize("all", value) })),
    poNacinu: [...byMode.entries()].map(([mode, value]) => summarize(mode, value)),
    glavneJedi: [...mains.entries()].map(([artikelId, value]) => ({ artikelId, ime: value.ime, ...summarize("all", value) })),
  });
});

router.get("/operativna-porocila/promet", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const posReq = req as PosRequest;
  const { od, do: doParam } = req.query as { od?: string; do?: string };

  if (!["admin", "admin_enote", "superadmin"].includes(posReq.vloga)) {
    res.status(403).json({ error: "Operativna poročila zahtevajo administrativni dostop" });
    return;
  }
  if (!od || !doParam) {
    res.status(400).json({ error: "Manjkata parametra od in do (YYYY-MM-DD)" });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(od) || !/^\d{4}-\d{2}-\d{2}$/.test(doParam)) {
    res.status(400).json({ error: "Neveljaven format datuma" });
    return;
  }
  if (od > doParam) {
    res.status(400).json({ error: "Začetni datum ne sme biti po končnem datumu" });
    return;
  }

  const enoteWhere = [
    eq(enoteTable.companyId, posReq.companyId),
    eq(enoteTable.aktiven, true),
    ...(posReq.vloga === "admin_enote" ? [eq(enoteTable.id, posReq.enotaId)] : []),
  ];
  const enote = await db
    .select({ id: enoteTable.id, ime: enoteTable.ime, zacetekUra: enoteTable.zacetekDnevaUra })
    .from(enoteTable)
    .where(and(...enoteWhere))
    .orderBy(asc(enoteTable.id));

  type OperativnaEnota = {
    enotaId: number;
    enota: string;
    skupaj: number;
    ddv: number;
    steviloRacunov: number;
  };
  type OperativnaKategorija = {
    kategorijaId: number | null;
    kategorija: string;
    skupaj: number;
    osnova: number;
    ddv: number;
    kolicina: number;
    steviloRacunov: number;
  };
  type OperativnaMiza = {
    mizaId: number | null;
    mizaStevilka: number | null;
    miza: string;
    prostorId: number | null;
    prostor: string | null;
    enotaId: number;
    enota: string;
    skupaj: number;
    steviloRacunov: number;
  };
  type OperativnaProstor = {
    prostorId: number | null;
    prostor: string;
    enotaId: number;
    enota: string;
    skupaj: number;
    steviloRacunov: number;
  };
  type OperativnaArtikel = {
    artikelId: number | null;
    artikel: string;
    enotaId: number;
    enota: string;
    skupaj: number;
    kolicina: number;
    steviloRacunov: number;
  };
  type OperativniNatakar = {
    natakarId: number | null;
    natakar: string;
    enotaId: number;
    enota: string;
    skupaj: number;
    napitnina: number;
    steviloRacunov: number;
  };
  type OperativnoPlacilo = {
    nacin: string;
    skupaj: number;
    steviloRacunov: number;
  };

  const poEnotah = new Map<number, OperativnaEnota>();
  const poKategorijah = new Map<string, OperativnaKategorija>();
  const poMizah = new Map<string, OperativnaMiza>();
  const poProstorih = new Map<string, OperativnaProstor>();
  const poArtiklih = new Map<string, OperativnaArtikel>();
  const poNatakarjih = new Map<string, OperativniNatakar>();
  const poNacinihPlacila = new Map<string, OperativnoPlacilo>();
  let skupajPromet = 0;
  let skupajDdv = 0;
  let steviloRacunov = 0;

  for (const enota of enote) {
    const mejeBoundary = await db.execute(sql`
      SELECT
        (${od}::date + ${enota.zacetekUra}::time) AT TIME ZONE 'Europe/Ljubljana' AS od_utc,
        (${doParam}::date + INTERVAL '1 day' + ${enota.zacetekUra}::time) AT TIME ZONE 'Europe/Ljubljana' AS do_utc
    `);
    type MejeRow = { od_utc: Date | string; do_utc: Date | string };
    const mejRow = mejeBoundary.rows[0] as MejeRow | undefined;
    const odDate = new Date(mejRow?.od_utc ?? `${od}T00:00:00.000Z`);
    const doDate = new Date(mejRow?.do_utc ?? `${doParam}T23:59:59.999Z`);
    const receiptFilter = sql`
      r.ustvarjeno >= ${odDate.toISOString()}::timestamptz
      AND r.ustvarjeno < ${doDate.toISOString()}::timestamptz
      AND r.enota_id = ${enota.id}
      AND r.status != 'storniran'
      AND r.je_storno IS NOT TRUE
    `;

    const summaryRaw = await db.execute(sql`
      SELECT
        COALESCE(SUM(r.skupaj::numeric), 0) AS skupaj,
        COALESCE(SUM(r.ddv::numeric), 0) AS ddv,
        COUNT(*)::int AS stevilo_racunov
      FROM racuni r
      WHERE ${receiptFilter}
    `);
    const summary = summaryRaw.rows[0] as { skupaj: string; ddv: string; stevilo_racunov: number } | undefined;
    const enotaSummary: OperativnaEnota = {
      enotaId: enota.id,
      enota: enota.ime,
      skupaj: Number(summary?.skupaj ?? 0),
      ddv: Number(summary?.ddv ?? 0),
      steviloRacunov: Number(summary?.stevilo_racunov ?? 0),
    };
    poEnotah.set(enota.id, enotaSummary);
    skupajPromet += enotaSummary.skupaj;
    skupajDdv += enotaSummary.ddv;
    steviloRacunov += enotaSummary.steviloRacunov;

    type KategorijaRow = {
      kategorija_id: number | null;
      kategorija: string;
      skupaj: string;
      osnova: string;
      ddv: string;
      kolicina: string;
      stevilo_racunov: number;
    };
    const kategorijeRaw = await db.execute(sql`
      SELECT
        p.kategorija_id,
        COALESCE(
          k.ime,
          CASE
            WHEN p.kategorija_id IS NULL THEN 'Brez kategorije'
            ELSE 'Kategorija #' || p.kategorija_id::text
          END
        ) AS kategorija,
        COALESCE(SUM(p.skupaj::numeric), 0) AS skupaj,
        COALESCE(SUM(p.skupaj::numeric / (1 + p.davek::numeric / 100)), 0) AS osnova,
        COALESCE(SUM(p.skupaj::numeric * p.davek::numeric / (100 + p.davek::numeric)), 0) AS ddv,
        COALESCE(SUM(p.kolicina), 0) AS kolicina,
        COUNT(DISTINCT r.id)::int AS stevilo_racunov
      FROM postavke p
      JOIN racuni r ON r.id = p.racun_id
      LEFT JOIN kategorije k ON k.id = p.kategorija_id
      WHERE ${receiptFilter}
        AND r.placilna_nacin NOT IN ('reprezentanca', 'lastna_poraba')
      GROUP BY p.kategorija_id, k.ime
      ORDER BY skupaj DESC, kategorija ASC
    `);
    for (const row of kategorijeRaw.rows as KategorijaRow[]) {
      const key = `${row.kategorija_id ?? "null"}:${row.kategorija}`;
      const existing = poKategorijah.get(key);
      if (existing) {
        existing.skupaj += Number(row.skupaj);
        existing.osnova += Number(row.osnova);
        existing.ddv += Number(row.ddv);
        existing.kolicina += Number(row.kolicina);
        existing.steviloRacunov += Number(row.stevilo_racunov);
      } else {
        poKategorijah.set(key, {
          kategorijaId: row.kategorija_id == null ? null : Number(row.kategorija_id),
          kategorija: row.kategorija,
          skupaj: Number(row.skupaj),
          osnova: Number(row.osnova),
          ddv: Number(row.ddv),
          kolicina: Number(row.kolicina),
          steviloRacunov: Number(row.stevilo_racunov),
        });
      }
    }

    const artikliRaw = await db.execute(sql`
      SELECT
        p.artikel_id,
        p.ime AS artikel,
        SUM(p.kolicina)::numeric AS kolicina,
        SUM(p.skupaj::numeric) AS skupaj,
        COUNT(DISTINCT r.id)::int AS stevilo_racunov
      FROM postavke p
      JOIN racuni r ON r.id = p.racun_id
      WHERE ${receiptFilter}
        AND r.placilna_nacin NOT IN ('reprezentanca', 'lastna_poraba')
      GROUP BY p.artikel_id, p.ime
      ORDER BY skupaj DESC, artikel ASC
    `);
    for (const row of artikliRaw.rows as Array<Record<string, unknown>>) {
      const artikelId = row.artikel_id == null ? null : Number(row.artikel_id);
      const artikel = String(row.artikel ?? "Neimenovan artikel");
      const key = `${enota.id}:${artikelId ?? "snapshot"}:${artikel}`;
      const existing = poArtiklih.get(key);
      if (existing) {
        existing.kolicina += Number(row.kolicina ?? 0);
        existing.skupaj += Number(row.skupaj ?? 0);
        existing.steviloRacunov += Number(row.stevilo_racunov ?? 0);
      } else {
        poArtiklih.set(key, {
          artikelId,
          artikel,
          enotaId: enota.id,
          enota: enota.ime,
          skupaj: Number(row.skupaj ?? 0),
          kolicina: Number(row.kolicina ?? 0),
          steviloRacunov: Number(row.stevilo_racunov ?? 0),
        });
      }
    }

    const natakarjiRaw = await db.execute(sql`
      SELECT
        i.natakari_id AS natakar_id,
        COALESCE(
          MAX(NULLIF(BTRIM(CONCAT_WS(' ', n.ime, n.priimek)), '')),
          MAX(NULLIF(BTRIM(r.natakar_ime), '')),
          'Brez natakarja'
        ) AS natakar,
        SUM(r.skupaj::numeric) AS skupaj,
        COALESCE(SUM(r.znesek_napitnina::numeric), 0) AS napitnina,
        COUNT(DISTINCT r.id)::int AS stevilo_racunov
      FROM racuni r
      LEFT JOIN izmene i ON i.id = r.izmena_id
      LEFT JOIN natakari n ON n.id = i.natakari_id
      WHERE ${receiptFilter}
      GROUP BY i.natakari_id, COALESCE('natakar:' || i.natakari_id::text, 'ime:' || COALESCE(r.natakar_ime, 'Brez natakarja'))
      ORDER BY skupaj DESC, natakar ASC
    `);
    for (const row of natakarjiRaw.rows as Array<Record<string, unknown>>) {
      const natakarId = row.natakar_id == null ? null : Number(row.natakar_id);
      const natakar = String(row.natakar ?? "Brez natakarja");
      const key = `${enota.id}:${natakarId ?? `ime:${natakar}`}`;
      const existing = poNatakarjih.get(key);
      if (existing) {
        existing.skupaj += Number(row.skupaj ?? 0);
        existing.napitnina += Number(row.napitnina ?? 0);
        existing.steviloRacunov += Number(row.stevilo_racunov ?? 0);
      } else {
        poNatakarjih.set(key, {
          natakarId,
          natakar,
          enotaId: enota.id,
          enota: enota.ime,
          skupaj: Number(row.skupaj ?? 0),
          napitnina: Number(row.napitnina ?? 0),
          steviloRacunov: Number(row.stevilo_racunov ?? 0),
        });
      }
    }

    const placilaRaw = await db.execute(sql`
      SELECT
        placilo.nacin,
        SUM(placilo.znesek) AS skupaj,
        COUNT(DISTINCT r.id)::int AS stevilo_racunov
      FROM racuni r
      CROSS JOIN LATERAL (
        VALUES
          ('gotovina', CASE WHEN r.znesek_gotovina IS NOT NULL OR r.znesek_kartica IS NOT NULL
            OR r.znesek_bon IS NOT NULL OR r.znesek_bon_pica IS NOT NULL OR r.znesek_negotovinsko IS NOT NULL
            THEN GREATEST(
              COALESCE(r.znesek_gotovina::numeric, 0)
              - CASE WHEN r.tip_payment_method = 'cash' THEN COALESCE(r.znesek_napitnina::numeric, 0) ELSE 0 END,
              0
            )
            WHEN r.placilna_nacin = 'gotovina' THEN r.skupaj::numeric ELSE 0 END),
          ('kartica', CASE WHEN r.znesek_gotovina IS NOT NULL OR r.znesek_kartica IS NOT NULL
            OR r.znesek_bon IS NOT NULL OR r.znesek_bon_pica IS NOT NULL OR r.znesek_negotovinsko IS NOT NULL
            THEN GREATEST(
              COALESCE(r.znesek_kartica::numeric, 0)
              - CASE
                WHEN r.tip_payment_method = 'card'
                  OR (r.tip_payment_method IS NULL AND COALESCE(r.znesek_napitnina::numeric, 0) > 0)
                THEN COALESCE(r.znesek_napitnina::numeric, 0)
                ELSE 0
              END,
              0
            )
            WHEN r.placilna_nacin = 'kartica' THEN r.skupaj::numeric ELSE 0 END),
          ('bon', CASE WHEN r.znesek_gotovina IS NOT NULL OR r.znesek_kartica IS NOT NULL
            OR r.znesek_bon IS NOT NULL OR r.znesek_bon_pica IS NOT NULL OR r.znesek_negotovinsko IS NOT NULL
            THEN COALESCE(r.znesek_bon::numeric, 0)
            WHEN r.placilna_nacin = 'bon' THEN r.skupaj::numeric ELSE 0 END),
          ('bon_pica', CASE WHEN r.znesek_gotovina IS NOT NULL OR r.znesek_kartica IS NOT NULL
            OR r.znesek_bon IS NOT NULL OR r.znesek_bon_pica IS NOT NULL OR r.znesek_negotovinsko IS NOT NULL
            THEN COALESCE(r.znesek_bon_pica::numeric, 0)
            WHEN r.placilna_nacin = 'bon_pica' THEN r.skupaj::numeric ELSE 0 END),
          ('negotovinsko', CASE WHEN r.znesek_gotovina IS NOT NULL OR r.znesek_kartica IS NOT NULL
            OR r.znesek_bon IS NOT NULL OR r.znesek_bon_pica IS NOT NULL OR r.znesek_negotovinsko IS NOT NULL
            THEN COALESCE(r.znesek_negotovinsko::numeric, 0)
            WHEN r.placilna_nacin = 'negotovinsko' THEN r.skupaj::numeric ELSE 0 END),
          ('reprezentanca', CASE WHEN r.placilna_nacin = 'reprezentanca' THEN r.skupaj::numeric ELSE 0 END),
          ('lastna_poraba', CASE WHEN r.placilna_nacin = 'lastna_poraba' THEN r.skupaj::numeric ELSE 0 END)
      ) AS placilo(nacin, znesek)
      WHERE ${receiptFilter}
        AND placilo.znesek > 0
      GROUP BY placilo.nacin
      ORDER BY skupaj DESC, placilo.nacin ASC
    `);
    for (const row of placilaRaw.rows as Array<Record<string, unknown>>) {
      const nacin = String(row.nacin);
      const existing = poNacinihPlacila.get(nacin);
      if (existing) {
        existing.skupaj += Number(row.skupaj ?? 0);
        existing.steviloRacunov += Number(row.stevilo_racunov ?? 0);
      } else {
        poNacinihPlacila.set(nacin, {
          nacin,
          skupaj: Number(row.skupaj ?? 0),
          steviloRacunov: Number(row.stevilo_racunov ?? 0),
        });
      }
    }

    type MizaRow = {
      miza_id: number | null;
      miza_stevilka: number | null;
      miza: string;
      prostor_id: number | null;
      prostor: string | null;
      skupaj: string;
      stevilo_racunov: number;
    };
    const mizeRaw = await db.execute(sql`
      SELECT
        n.miza_id,
        m.stevilka AS miza_stevilka,
        COALESCE(
          m.ime,
          CASE
            WHEN n.miza_id IS NULL THEN 'Brez mize'
            ELSE 'Miza ' || m.stevilka::text
          END
        ) AS miza,
        p.id AS prostor_id,
        p.ime AS prostor,
        COALESCE(SUM(r.skupaj::numeric), 0) AS skupaj,
        COUNT(*)::int AS stevilo_racunov
      FROM racuni r
      JOIN narocila n ON n.id = r.narocilo_id
      LEFT JOIN mize m ON m.id = n.miza_id
      LEFT JOIN prostori p ON p.id = m.prostor_id
      WHERE ${receiptFilter}
      GROUP BY n.miza_id, m.stevilka, m.ime, p.id, p.ime
      ORDER BY skupaj DESC, miza ASC
    `);
    for (const row of mizeRaw.rows as MizaRow[]) {
      const key = `${enota.id}:${row.miza_id ?? "null"}`;
      const existing = poMizah.get(key);
      if (existing) {
        existing.skupaj += Number(row.skupaj);
        existing.steviloRacunov += Number(row.stevilo_racunov);
      } else {
        poMizah.set(key, {
          mizaId: row.miza_id == null ? null : Number(row.miza_id),
          mizaStevilka: row.miza_stevilka == null ? null : Number(row.miza_stevilka),
          miza: row.miza,
          prostorId: row.prostor_id == null ? null : Number(row.prostor_id),
          prostor: row.prostor ?? null,
          enotaId: enota.id,
          enota: enota.ime,
          skupaj: Number(row.skupaj),
          steviloRacunov: Number(row.stevilo_racunov),
        });
      }

      const prostorKey = `${enota.id}:${row.prostor_id ?? "null"}`;
      const existingProstor = poProstorih.get(prostorKey);
      if (existingProstor) {
        existingProstor.skupaj += Number(row.skupaj);
        existingProstor.steviloRacunov += Number(row.stevilo_racunov);
      } else {
        poProstorih.set(prostorKey, {
          prostorId: row.prostor_id == null ? null : Number(row.prostor_id),
          prostor: row.prostor ?? "Brez prostora",
          enotaId: enota.id,
          enota: enota.ime,
          skupaj: Number(row.skupaj),
          steviloRacunov: Number(row.stevilo_racunov),
        });
      }
    }
  }

  res.json({
    od,
    do: doParam,
    skupajPromet,
    skupajDdv,
    steviloRacunov,
    prometPoEnotah: [...poEnotah.values()].sort((a, b) => b.skupaj - a.skupaj),
    prometPoKategorijah: [...poKategorijah.values()].sort((a, b) => b.skupaj - a.skupaj),
    prometPoProstorih: [...poProstorih.values()].sort((a, b) => b.skupaj - a.skupaj),
    prometPoMizah: [...poMizah.values()].sort((a, b) => b.skupaj - a.skupaj),
    prometPoArtiklih: [...poArtiklih.values()].sort((a, b) => b.skupaj - a.skupaj || a.artikel.localeCompare(b.artikel, "sl")),
    prometPoNatakarjih: [...poNatakarjih.values()].sort((a, b) => b.skupaj - a.skupaj || a.natakar.localeCompare(b.natakar, "sl")),
    napitninePoZaposlenih: [...poNatakarjih.values()]
      .filter((row) => row.napitnina > 0)
      .sort((a, b) => b.napitnina - a.napitnina || a.natakar.localeCompare(b.natakar, "sl")),
    prometPoNacinihPlacila: [...poNacinihPlacila.values()].sort((a, b) => b.skupaj - a.skupaj),
  });
});

router.get("/operativna-porocila/napake", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const posReq = req as PosRequest;
  const { od, do: doParam } = req.query as { od?: string; do?: string };

  if (!["admin", "admin_enote", "superadmin"].includes(posReq.vloga)) {
    res.status(403).json({ error: "Operativna poročila zahtevajo administrativni dostop" });
    return;
  }
  if (!od || !doParam) {
    res.status(400).json({ error: "Manjkata parametra od in do (YYYY-MM-DD)" });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(od) || !/^\d{4}-\d{2}-\d{2}$/.test(doParam)) {
    res.status(400).json({ error: "Neveljaven format datuma" });
    return;
  }
  if (od > doParam) {
    res.status(400).json({ error: "Začetni datum ne sme biti po končnem datumu" });
    return;
  }

  const enoteWhere = [
    eq(enoteTable.companyId, posReq.companyId),
    eq(enoteTable.aktiven, true),
    ...(posReq.vloga === "admin_enote" ? [eq(enoteTable.id, posReq.enotaId)] : []),
  ];
  const enote = await db
    .select({ id: enoteTable.id, ime: enoteTable.ime, zacetekUra: enoteTable.zacetekDnevaUra })
    .from(enoteTable)
    .where(and(...enoteWhere))
    .orderBy(asc(enoteTable.id));

  type KarticnaNapaka = {
    id: string;
    enotaId: number;
    enota: string;
    provider: string;
    purpose: string;
    status: "failed" | "unknown";
    znesek: number;
    napaka: string | null;
    cas: string;
  };
  type FursNapaka = {
    id: string;
    racunId: number;
    stevilkaRacuna: string;
    enotaId: number;
    enota: string;
    outcome: "failed" | "unknown";
    napaka: string | null;
    cas: string;
  };

  const karticneNapake: KarticnaNapaka[] = [];
  const fursNapake: FursNapaka[] = [];

  for (const enota of enote) {
    const mejeBoundary = await db.execute(sql`
      SELECT
        (${od}::date + ${enota.zacetekUra}::time) AT TIME ZONE 'Europe/Ljubljana' AS od_utc,
        (${doParam}::date + INTERVAL '1 day' + ${enota.zacetekUra}::time) AT TIME ZONE 'Europe/Ljubljana' AS do_utc
    `);
    type MejeRow = { od_utc: Date | string; do_utc: Date | string };
    const mejRow = mejeBoundary.rows[0] as MejeRow | undefined;
    const odDate = new Date(mejRow?.od_utc ?? `${od}T00:00:00.000Z`);
    const doDate = new Date(mejRow?.do_utc ?? `${doParam}T23:59:59.999Z`);

    type KarticnaRow = {
      id: string;
      provider: string;
      purpose: string;
      status: "failed" | "unknown";
      znesek: string;
      napaka: string | null;
      ustvarjeno: Date | string;
      posodobljeno: Date | string;
    };
    const karticneRows = await db.execute(sql`
      SELECT
        a.id::text AS id,
        a.provider,
        a.purpose,
        a.status,
        a.znesek::numeric AS znesek,
        a.napaka,
        a.ustvarjeno,
        a.posodobljeno
      FROM pos_karticna_placila_attempt a
      WHERE a.company_id = ${posReq.companyId}
        AND a.enota_id = ${enota.id}
        AND a.ustvarjeno >= ${odDate.toISOString()}::timestamptz
        AND a.ustvarjeno < ${doDate.toISOString()}::timestamptz
        AND a.status IN ('failed', 'unknown')
      ORDER BY a.posodobljeno DESC
    `);
    for (const row of karticneRows.rows as KarticnaRow[]) {
      karticneNapake.push({
        id: row.id,
        enotaId: enota.id,
        enota: enota.ime,
        provider: row.provider,
        purpose: row.purpose,
        status: row.status,
        znesek: Number(row.znesek),
        napaka: row.napaka,
        cas: new Date(row.posodobljeno ?? row.ustvarjeno).toISOString(),
      });
    }

    type FursRow = {
      id: string;
      racun_id: number;
      stevilka_racuna: string;
      outcome: "failed" | "unknown" | null;
      racun_furs_state: "failed" | "unknown" | "pending" | "sending" | "confirmed";
      napaka: string | null;
      cas: Date | string;
    };
    const fursRows = await db.execute(sql`
      SELECT
        fa.id::text AS id,
        fa.racun_id,
        r.stevilka_racuna,
        fa.outcome,
        r.furs_state AS racun_furs_state,
        COALESCE(fa.raw_error, r.furs_last_error) AS napaka,
        COALESCE(fa.started_at, r.ustvarjeno) AS cas
      FROM furs_attempts fa
      JOIN racuni r ON r.id = fa.racun_id
      WHERE r.enota_id = ${enota.id}
        AND COALESCE(fa.started_at, r.ustvarjeno) >= ${odDate.toISOString()}::timestamptz
        AND COALESCE(fa.started_at, r.ustvarjeno) < ${doDate.toISOString()}::timestamptz
        AND (
          fa.outcome IN ('failed', 'unknown')
          OR (fa.outcome IS NULL AND r.furs_state IN ('failed', 'unknown'))
        )
      ORDER BY cas DESC
    `);
    for (const row of fursRows.rows as FursRow[]) {
      const outcome = row.outcome ?? row.racun_furs_state;
      if (outcome !== "failed" && outcome !== "unknown") continue;
      fursNapake.push({
        id: row.id,
        racunId: Number(row.racun_id),
        stevilkaRacuna: row.stevilka_racuna,
        enotaId: enota.id,
        enota: enota.ime,
        outcome,
        napaka: row.napaka,
        cas: new Date(row.cas).toISOString(),
      });
    }
  }

  res.json({
    od,
    do: doParam,
    karticna: {
      skupaj: karticneNapake.length,
      neuspesne: karticneNapake.filter((row) => row.status === "failed").length,
      nejasne: karticneNapake.filter((row) => row.status === "unknown").length,
      zapisi: karticneNapake,
    },
    furs: {
      skupaj: fursNapake.length,
      neuspesne: fursNapake.filter((row) => row.outcome === "failed").length,
      nejasne: fursNapake.filter((row) => row.outcome === "unknown").length,
      zapisi: fursNapake,
    },
  });
});

router.get("/operativna-porocila/zakljucki", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const posReq = req as PosRequest;
  const { od, do: doParam } = req.query as { od?: string; do?: string };

  if (!["admin", "admin_enote", "superadmin"].includes(posReq.vloga)) {
    res.status(403).json({ error: "Operativna poročila zahtevajo administrativni dostop" });
    return;
  }
  if (!od || !doParam) {
    res.status(400).json({ error: "Manjkata parametra od in do (YYYY-MM-DD)" });
    return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(od) || !/^\d{4}-\d{2}-\d{2}$/.test(doParam)) {
    res.status(400).json({ error: "Neveljaven format datuma" });
    return;
  }
  if (od > doParam) {
    res.status(400).json({ error: "Začetni datum ne sme biti po končnem datumu" });
    return;
  }

  const firstDate = new Date(`${od}T00:00:00.000Z`);
  const lastDate = new Date(`${doParam}T00:00:00.000Z`);
  const dayCount = Math.floor((lastDate.getTime() - firstDate.getTime()) / 86_400_000) + 1;
  if (!Number.isFinite(dayCount) || dayCount > 93) {
    res.status(400).json({ error: "Obdobje za pregled zaključkov je lahko dolgo največ 93 dni" });
    return;
  }

  const enoteWhere = [
    eq(enoteTable.companyId, posReq.companyId),
    eq(enoteTable.aktiven, true),
    ...(posReq.vloga === "admin_enote" ? [eq(enoteTable.id, posReq.enotaId)] : []),
  ];
  const enote = await db
    .select({ id: enoteTable.id, ime: enoteTable.ime })
    .from(enoteTable)
    .where(and(...enoteWhere))
    .orderBy(asc(enoteTable.id));

  type ClosureStatus = "zaklenjeno" | "blokirano" | "odklenjeno" | "ni_zakljuceno";
  type CashStatus = "usklajeno" | "odstopanje" | "manjka_uskladitev";
  type ClosureRow = {
    enotaId: number;
    enota: string;
    blagajnaId: number;
    blagajna: string;
    poslovniDatum: string;
    status: ClosureStatus;
    zPorociloId: number | null;
    zStevilka: number | null;
    zakljucenOb: string | null;
    odklenjenOb: string | null;
    prometDneva: number | null;
    grandTotalPrej: number | null;
    grandTotalNov: number | null;
    cashStatus: CashStatus;
    pricakovanaGotovina: number | null;
    prestetaGotovina: number | null;
    razlikaGotovine: number | null;
    razlogOdstopanja: string | null;
    blokade: Array<{
      type: string;
      count: number;
      message: string;
      items: Array<{ id: number; label: string }>;
    }>;
  };

  const zakljucki: ClosureRow[] = [];
  for (const enota of enote) {
    const blagajne = await db
      .select({ id: blagajneTable.id, ime: blagajneTable.ime })
      .from(blagajneTable)
      .where(and(eq(blagajneTable.enotaId, enota.id), eq(blagajneTable.aktivna, true)))
      .orderBy(asc(blagajneTable.id));

    for (let dayOffset = dayCount - 1; dayOffset >= 0; dayOffset -= 1) {
      const date = new Date(firstDate.getTime() + dayOffset * 86_400_000).toISOString().slice(0, 10);
      for (const blagajna of blagajne) {
        const [z] = await db.select({
          id: zPorocilaTable.id,
          zStevilka: zPorocilaTable.zStevilka,
          zakljucenOb: zPorocilaTable.zakljucenOb,
          odklenjenOb: zPorocilaTable.odklenjenOb,
          prometDneva: zPorocilaTable.prometDneva,
          grandTotalPrej: zPorocilaTable.grandTotalPrej,
          grandTotalNov: zPorocilaTable.grandTotalNov,
        }).from(zPorocilaTable).where(and(
          eq(zPorocilaTable.enotaId, enota.id),
          eq(zPorocilaTable.blagajnaId, blagajna.id),
          eq(zPorocilaTable.poslovniDatum, date),
        )).limit(1);
        const [reconciliation] = await db.select({
          pricakovanaGotovina: posCashReconciliationsTable.pricakovanaGotovina,
          prestetaGotovina: posCashReconciliationsTable.prestetaGotovina,
          razlika: posCashReconciliationsTable.razlika,
          confirmed: posCashReconciliationsTable.confirmed,
          overrideRazlog: posCashReconciliationsTable.overrideRazlog,
        }).from(posCashReconciliationsTable).where(and(
          eq(posCashReconciliationsTable.enotaId, enota.id),
          eq(posCashReconciliationsTable.blagajnaId, blagajna.id),
          eq(posCashReconciliationsTable.poslovniDatum, date),
        )).limit(1);

        const cashDifference = reconciliation ? Number(reconciliation.razlika) : null;
        const cashStatus: CashStatus = !reconciliation
          ? "manjka_uskladitev"
          : cashDifference === 0
            ? "usklajeno"
            : "odstopanje";
        const zaklenjeno = !!z && z.odklenjenOb === null;
        const blockers = zaklenjeno ? [] : await getZCloseBlockers(db, enota.id, date, blagajna.id);
        const status: ClosureStatus = zaklenjeno
          ? "zaklenjeno"
          : blockers.length > 0 || !reconciliation
            ? "blokirano"
            : z
              ? "odklenjeno"
              : "ni_zakljuceno";

        zakljucki.push({
          enotaId: enota.id,
          enota: enota.ime,
          blagajnaId: blagajna.id,
          blagajna: blagajna.ime,
          poslovniDatum: date,
          status,
          zPorociloId: z?.id ?? null,
          zStevilka: z?.zStevilka ?? null,
          zakljucenOb: z?.zakljucenOb?.toISOString?.() ?? (z?.zakljucenOb ? String(z.zakljucenOb) : null),
          odklenjenOb: z?.odklenjenOb?.toISOString?.() ?? (z?.odklenjenOb ? String(z.odklenjenOb) : null),
          prometDneva: z ? Number(z.prometDneva) : null,
          grandTotalPrej: z ? Number(z.grandTotalPrej) : null,
          grandTotalNov: z ? Number(z.grandTotalNov) : null,
          cashStatus,
          pricakovanaGotovina: reconciliation ? Number(reconciliation.pricakovanaGotovina) : null,
          prestetaGotovina: reconciliation ? Number(reconciliation.prestetaGotovina) : null,
          razlikaGotovine: cashDifference,
          razlogOdstopanja: reconciliation?.overrideRazlog ?? null,
          blokade: blockers,
        });
      }
    }
  }

  res.json({
    od,
    do: doParam,
    skupaj: zakljucki.length,
    zaklenjene: zakljucki.filter((row) => row.status === "zaklenjeno").length,
    blokirane: zakljucki.filter((row) => row.status === "blokirano").length,
    odklenjene: zakljucki.filter((row) => row.status === "odklenjeno").length,
    nezakljucene: zakljucki.filter((row) => row.status === "ni_zakljuceno").length,
    odstopanjaGotovine: zakljucki.filter((row) => row.cashStatus === "odstopanje").length,
    manjkajoceUskladitve: zakljucki.filter((row) => row.cashStatus === "manjka_uskladitev").length,
    zakljucki,
  });
});

router.get("/operativna-porocila/dostave", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const posReq = req as PosRequest;
  const { od, do: doParam } = req.query as { od?: string; do?: string };
  const adminRoles = ["admin", "admin_enote", "superadmin"];

  if (!adminRoles.includes(posReq.vloga)) {
    res.status(403).json({ error: "Operativna poročila zahtevajo administrativni dostop" });
    return;
  }
  if (!od || !doParam || !/^\d{4}-\d{2}-\d{2}$/.test(od) || !/^\d{4}-\d{2}-\d{2}$/.test(doParam)) {
    res.status(400).json({ error: "Podajte veljavno obdobje od in do (YYYY-MM-DD)" });
    return;
  }
  if (od > doParam) {
    res.status(400).json({ error: "Začetni datum ne sme biti po končnem datumu" });
    return;
  }

  const enoteWhere = [
    eq(enoteTable.companyId, posReq.companyId),
    eq(enoteTable.aktiven, true),
    ...(posReq.vloga === "admin_enote" ? [eq(enoteTable.id, posReq.enotaId)] : []),
  ];
  const enote = await db.select({
    id: enoteTable.id,
    ime: enoteTable.ime,
  }).from(enoteTable).where(and(...enoteWhere)).orderBy(asc(enoteTable.id));

  type DeliveryStatus = "prejeto" | "potrjeno" | "v_pripravi" | "pripravljeno" | "prevzel_kurir" | "dostavljeno" | "preklicano";
  type DeliveryRow = {
    id: number;
    enotaId: number;
    enota: string;
    stevilkaNarocila: number | null;
    strankaIme: string | null;
    strankaTelefon: string | null;
    naslov: string | null;
    ustvarjeno: string;
    predvidenaDostava: string | null;
    dostavaStatus: DeliveryStatus;
    dostavljenoOb: string | null;
    preklicanoOb: string | null;
    zamujeno: boolean;
    brezRoka: boolean;
  };

  const dostave: DeliveryRow[] = [];
  const zdaj = Date.now();
  for (const enota of enote) {
    const { start } = await getBusinessDayBounds(enota.id, od);
    const endOfPeriod = await getBusinessDayBounds(enota.id, doParam);
    const rangeStart = start;
    const rangeEnd = endOfPeriod.end;
    const result = await db.execute(sql`
      SELECT
        n.id,
        n.enota_id,
        e.ime AS enota,
        n.stevilka_narocila,
        n.stranka_ime,
        n.stranka_telefon,
        NULLIF(TRIM(CONCAT_WS(' ', n.dostava_ulica, n.dostava_hisna_stevilka, n.dostava_naselje_naziv)), '') AS naslov,
        n.ustvarjeno,
        n.predvidena_dostava,
        n.dostava_status,
        MAX(h.ustvarjeno) FILTER (WHERE h.status = 'dostavljeno') AS dostavljeno_ob,
        MAX(h.ustvarjeno) FILTER (WHERE h.status = 'preklicano') AS preklicano_ob
      FROM narocila n
      JOIN enote e ON e.id = n.enota_id
      LEFT JOIN dostava_status_zgodovina h ON h.narocilo_id = n.id AND h.enota_id = n.enota_id
      WHERE n.enota_id = ${enota.id}
        AND n.nacin_izpolnitve = 'dostava'
        AND n.dostava_status IS NOT NULL
        AND n.ustvarjeno >= ${rangeStart.toISOString()}::timestamptz
        AND n.ustvarjeno < ${rangeEnd.toISOString()}::timestamptz
      GROUP BY n.id, n.enota_id, e.ime, n.stevilka_narocila, n.stranka_ime,
        n.stranka_telefon, n.dostava_ulica, n.dostava_hisna_stevilka,
        n.dostava_naselje_naziv, n.ustvarjeno, n.predvidena_dostava, n.dostava_status
      ORDER BY n.ustvarjeno DESC, n.id DESC
    `);

    for (const row of result.rows as Array<Record<string, unknown>>) {
      const status = row.dostava_status as DeliveryStatus;
      const terminalna = status === "dostavljeno" || status === "preklicano";
      const predvidena = row.predvidena_dostava ? new Date(String(row.predvidena_dostava)) : null;
      const zamujeno = !terminalna && !!predvidena && predvidena.getTime() <= zdaj;
      dostave.push({
        id: Number(row.id),
        enotaId: Number(row.enota_id),
        enota: String(row.enota),
        stevilkaNarocila: row.stevilka_narocila == null ? null : Number(row.stevilka_narocila),
        strankaIme: row.stranka_ime == null ? null : String(row.stranka_ime),
        strankaTelefon: row.stranka_telefon == null ? null : String(row.stranka_telefon),
        naslov: row.naslov == null ? null : String(row.naslov),
        ustvarjeno: new Date(String(row.ustvarjeno)).toISOString(),
        predvidenaDostava: predvidena?.toISOString() ?? null,
        dostavaStatus: status,
        dostavljenoOb: row.dostavljeno_ob ? new Date(String(row.dostavljeno_ob)).toISOString() : null,
        preklicanoOb: row.preklicano_ob ? new Date(String(row.preklicano_ob)).toISOString() : null,
        zamujeno,
        brezRoka: !terminalna && !predvidena,
      });
    }
  }

  const statusi: Record<DeliveryStatus, number> = {
    prejeto: 0, potrjeno: 0, v_pripravi: 0, pripravljeno: 0,
    prevzel_kurir: 0, dostavljeno: 0, preklicano: 0,
  };
  for (const dostava of dostave) statusi[dostava.dostavaStatus] += 1;
  const aktivne = dostave.filter((dostava) => !["dostavljeno", "preklicano"].includes(dostava.dostavaStatus));

  res.json({
    od,
    do: doParam,
    skupaj: dostave.length,
    aktivne: aktivne.length,
    zamujene: dostave.filter((dostava) => dostava.zamujeno).length,
    dostavljene: statusi.dostavljeno,
    preklicane: statusi.preklicano,
    brezRoka: dostave.filter((dostava) => dostava.brezRoka).length,
    poStatusih: statusi,
    dostave,
  });
});

router.get("/operativna-porocila/normativi", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const posReq = req as PosRequest;
  const { od, do: doParam } = req.query as { od?: string; do?: string };
  const adminRoles = ["admin", "admin_enote", "superadmin"];

  if (!adminRoles.includes(posReq.vloga)) {
    res.status(403).json({ error: "Operativna poročila zahtevajo administrativni dostop" });
    return;
  }
  if (!od || !doParam || !/^\d{4}-\d{2}-\d{2}$/.test(od) || !/^\d{4}-\d{2}-\d{2}$/.test(doParam)) {
    res.status(400).json({ error: "Podajte veljavno obdobje od in do (YYYY-MM-DD)" });
    return;
  }
  if (od > doParam) {
    res.status(400).json({ error: "Začetni datum ne sme biti po končnem datumu" });
    return;
  }

  const enoteWhere = [
    eq(enoteTable.companyId, posReq.companyId),
    eq(enoteTable.aktiven, true),
    ...(posReq.vloga === "admin_enote" ? [eq(enoteTable.id, posReq.enotaId)] : []),
  ];
  const enote = await db.select({
    id: enoteTable.id,
    ime: enoteTable.ime,
  }).from(enoteTable).where(and(...enoteWhere)).orderBy(asc(enoteTable.id));

  type NormativnaPoraba = {
    artikelId: number;
    artikel: string;
    enotaMere: string | null;
    enotaId: number;
    enota: string;
    kolicina: number;
    vrednost: number;
    steviloGibov: number;
  };
  type PorabaPoEnoti = {
    enotaId: number;
    enota: string;
    vrednost: number;
    steviloGibov: number;
  };

  const poArtiklih = new Map<string, NormativnaPoraba>();
  const poEnotah = new Map<number, PorabaPoEnoti>();
  for (const enota of enote) {
    const { start } = await getBusinessDayBounds(enota.id, od);
    const koncniDatum = await getBusinessDayBounds(enota.id, doParam);
    const result = await db.execute(sql`
      SELECT
        a.id AS artikel_id,
        a.ime AS artikel,
        a.enota_mere,
        a.enota_id,
        e.ime AS enota,
        COALESCE(SUM(ABS(g.kolicina::numeric)), 0) AS kolicina,
        COALESCE(SUM(COALESCE(ABS(g.vrednost::numeric), ABS(g.kolicina::numeric) * COALESCE(g.cena_kos::numeric, 0))), 0) AS vrednost,
        COUNT(*)::int AS stevilo_gibov
      FROM zaloga_gibi g
      JOIN artikli a ON a.id = g.artikel_id
      JOIN enote e ON e.id = a.enota_id
      WHERE g.tip = 'poraba'
        AND a.enota_id = ${enota.id}
        AND g.ustvarjeno >= ${start.toISOString()}::timestamptz
        AND g.ustvarjeno < ${koncniDatum.end.toISOString()}::timestamptz
      GROUP BY a.id, a.ime, a.enota_mere, a.enota_id, e.ime
      ORDER BY vrednost DESC, artikel ASC
    `);

    let unitValue = 0;
    let unitMovements = 0;
    for (const row of result.rows as Array<Record<string, unknown>>) {
      const articleId = Number(row.artikel_id);
      const quantity = Number(row.kolicina ?? 0);
      const value = Number(row.vrednost ?? 0);
      const movements = Number(row.stevilo_gibov ?? 0);
      const key = `${enota.id}:${articleId}`;
      const existing = poArtiklih.get(key);
      if (existing) {
        existing.kolicina += quantity;
        existing.vrednost += value;
        existing.steviloGibov += movements;
      } else {
        poArtiklih.set(key, {
          artikelId: articleId,
          artikel: String(row.artikel),
          enotaMere: row.enota_mere == null ? null : String(row.enota_mere),
          enotaId: enota.id,
          enota: enota.ime,
          kolicina: quantity,
          vrednost: value,
          steviloGibov: movements,
        });
      }
      unitValue += value;
      unitMovements += movements;
    }
    poEnotah.set(enota.id, {
      enotaId: enota.id,
      enota: enota.ime,
      vrednost: unitValue,
      steviloGibov: unitMovements,
    });
  }

  const artikli = [...poArtiklih.values()].sort((a, b) => b.vrednost - a.vrednost || a.artikel.localeCompare(b.artikel, "sl"));
  const poEnotahResult = [...poEnotah.values()].sort((a, b) => b.vrednost - a.vrednost);
  res.json({
    od,
    do: doParam,
    skupajVrednost: artikli.reduce((sum, row) => sum + row.vrednost, 0),
    skupajGibov: artikli.reduce((sum, row) => sum + row.steviloGibov, 0),
    poEnotah: poEnotahResult,
    artikli,
  });
});

router.get("/operativna-porocila/zaloge", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const posReq = req as PosRequest;
  const { od, do: doParam } = req.query as { od?: string; do?: string };
  const adminRoles = ["admin", "admin_enote", "superadmin"];

  if (!adminRoles.includes(posReq.vloga)) {
    res.status(403).json({ error: "Operativna poročila zahtevajo administrativni dostop" });
    return;
  }
  if (!od || !doParam || !/^\d{4}-\d{2}-\d{2}$/.test(od) || !/^\d{4}-\d{2}-\d{2}$/.test(doParam)) {
    res.status(400).json({ error: "Podajte veljavno obdobje od in do (YYYY-MM-DD)" });
    return;
  }
  if (od > doParam) {
    res.status(400).json({ error: "Začetni datum ne sme biti po končnem datumu" });
    return;
  }

  const enoteWhere = [
    eq(enoteTable.companyId, posReq.companyId),
    eq(enoteTable.aktiven, true),
    ...(posReq.vloga === "admin_enote" ? [eq(enoteTable.id, posReq.enotaId)] : []),
  ];
  const enote = await db.select({
    id: enoteTable.id,
    ime: enoteTable.ime,
  }).from(enoteTable).where(and(...enoteWhere)).orderBy(asc(enoteTable.id));

  type ZalogaArtikel = {
    artikelId: number;
    artikel: string;
    enotaMere: string | null;
    enotaId: number;
    enota: string;
    kolicina: number;
    povprecnaCena: number | null;
    vrednost: number;
    status: "kriticna" | "prazna" | "v_redu";
  };
  type InventurnoOdstopanje = {
    id: number;
    inventuraId: number;
    inventuraStevilka: string | null;
    datum: string;
    artikelId: number;
    artikel: string;
    enotaMere: string | null;
    enotaId: number;
    enota: string;
    razlika: number;
    cenaKos: number;
    vrednost: number;
  };
  type Odpis = {
    id: number;
    zapisnikId: number;
    stevilkaZapisnika: number;
    datum: string;
    artikelId: number;
    artikel: string;
    enotaMere: string;
    enotaId: number;
    enota: string;
    kolicina: number;
    vrednost: number;
    razlog: string;
  };

  const zaloge: ZalogaArtikel[] = [];
  const inventurnaOdstopanja: InventurnoOdstopanje[] = [];
  const odpisi: Odpis[] = [];
  const poEnotah = new Map<number, {
    enotaId: number;
    enota: string;
    vrednost: number;
    kriticne: number;
    prazne: number;
    inventurnaOdstopanja: number;
  }>();

  for (const enota of enote) {
    const zalogeResult = await db.execute(sql`
      SELECT
        a.id AS artikel_id,
        a.ime AS artikel,
        a.enota_mere,
        a.enota_id,
        e.ime AS enota,
        COALESCE(z.kolicina::numeric, 0) AS kolicina,
        z.povprecna_cena::numeric AS povprecna_cena,
        COALESCE(z.skupna_vrednost::numeric, 0) AS vrednost
      FROM artikli a
      JOIN enote e ON e.id = a.enota_id
      LEFT JOIN zaloge z ON z.artikel_id = a.id
      WHERE a.enota_id = ${enota.id}
        AND a.nabavni_artikel IS TRUE
      ORDER BY a.ime ASC, a.id ASC
    `);

    const start = await getBusinessDayBounds(enota.id, od);
    const end = await getBusinessDayBounds(enota.id, doParam);
    const inventureResult = await db.execute(sql`
      SELECT
        ip.id,
        i.id AS inventura_id,
        i.stevilka AS inventura_stevilka,
        i.datum,
        ip.artikel_id,
        a.ime AS artikel,
        a.enota_mere,
        a.enota_id,
        e.ime AS enota,
        ip.razlika::numeric AS razlika,
        ip.cena_kos::numeric AS cena_kos
      FROM inventure_postavke ip
      JOIN inventure i ON i.id = ip.inventura_id
      JOIN artikli a ON a.id = ip.artikel_id
      JOIN enote e ON e.id = a.enota_id
      WHERE i.enota_id = ${enota.id}
        AND i.datum >= ${start.start.toISOString()}::timestamptz
        AND i.datum < ${end.end.toISOString()}::timestamptz
        AND ABS(ip.razlika::numeric) > 0.000001
      ORDER BY ABS(ip.razlika::numeric * ip.cena_kos::numeric) DESC, i.datum DESC, ip.id DESC
    `);
    const odpisiResult = await db.execute(sql`
      SELECT
        line.id,
        record.id AS zapisnik_id,
        record.record_number AS stevilka_zapisnika,
        line.business_date AS datum,
        line.artikel_id,
        line.article_name AS artikel,
        line.unit_of_measure AS enota_mere,
        line.quantity::numeric AS kolicina,
        line.total_value::numeric AS vrednost,
        record.disposal_reason AS razlog
      FROM prepared_food_waste_record_lines line
      INNER JOIN prepared_food_waste_records record ON record.id = line.record_id
      WHERE record.enota_id = ${enota.id}
        AND record.status = 'potrjen'
        AND line.business_date >= ${od}::date
        AND line.business_date <= ${doParam}::date
      ORDER BY line.business_date DESC, record.record_number DESC, line.id ASC
    `);

    let unitValue = 0;
    let unitCritical = 0;
    let unitEmpty = 0;
    for (const row of zalogeResult.rows as Array<Record<string, unknown>>) {
      const quantity = Number(row.kolicina ?? 0);
      const status = quantity < -0.000001 ? "kriticna" : quantity <= 0.000001 ? "prazna" : "v_redu";
      if (status === "kriticna") unitCritical += 1;
      if (status === "prazna") unitEmpty += 1;
      const value = Number(row.vrednost ?? 0);
      unitValue += value;
      zaloge.push({
        artikelId: Number(row.artikel_id),
        artikel: String(row.artikel),
        enotaMere: row.enota_mere == null ? null : String(row.enota_mere),
        enotaId: enota.id,
        enota: enota.ime,
        kolicina: quantity,
        povprecnaCena: row.povprecna_cena == null ? null : Number(row.povprecna_cena),
        vrednost: value,
        status,
      });
    }

    for (const row of inventureResult.rows as Array<Record<string, unknown>>) {
      const difference = Number(row.razlika ?? 0);
      const unitCost = Number(row.cena_kos ?? 0);
      inventurnaOdstopanja.push({
        id: Number(row.id),
        inventuraId: Number(row.inventura_id),
        inventuraStevilka: row.inventura_stevilka == null ? null : String(row.inventura_stevilka),
        datum: new Date(String(row.datum)).toISOString(),
        artikelId: Number(row.artikel_id),
        artikel: String(row.artikel),
        enotaMere: row.enota_mere == null ? null : String(row.enota_mere),
        enotaId: enota.id,
        enota: enota.ime,
        razlika: difference,
        cenaKos: unitCost,
        vrednost: Math.abs(difference * unitCost),
      });
    }
    for (const row of odpisiResult.rows as Array<Record<string, unknown>>) {
      odpisi.push({
        id: Number(row.id),
        zapisnikId: Number(row.zapisnik_id),
        stevilkaZapisnika: Number(row.stevilka_zapisnika),
        datum: String(row.datum),
        artikelId: Number(row.artikel_id),
        artikel: String(row.artikel),
        enotaMere: String(row.enota_mere),
        enotaId: enota.id,
        enota: enota.ime,
        kolicina: Number(row.kolicina ?? 0),
        vrednost: Number(row.vrednost ?? 0),
        razlog: String(row.razlog),
      });
    }
    poEnotah.set(enota.id, {
      enotaId: enota.id,
      enota: enota.ime,
      vrednost: unitValue,
      kriticne: unitCritical,
      prazne: unitEmpty,
      inventurnaOdstopanja: inventureResult.rows.length,
    });
  }

  const inventurnaVrednost = inventurnaOdstopanja.reduce((total, row) => total + row.vrednost, 0);
  res.json({
    od,
    do: doParam,
    skupajVrednost: zaloge.reduce((total, row) => total + row.vrednost, 0),
    kriticne: zaloge.filter((row) => row.status === "kriticna").length,
    prazne: zaloge.filter((row) => row.status === "prazna").length,
    inventurnaOdstopanja: inventurnaOdstopanja.length,
    inventurnaVrednost,
    steviloOdpisov: odpisi.length,
    vrednostOdpisov: odpisi.reduce((total, row) => total + row.vrednost, 0),
    poEnotah: [...poEnotah.values()],
    zaloge,
    odstopanja: inventurnaOdstopanja,
    odpisi,
  });
});

router.get("/operativna-porocila/priprava", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const posReq = req as PosRequest;
  const { od, do: doParam } = req.query as { od?: string; do?: string };
  const adminRoles = ["admin", "admin_enote", "superadmin"];

  if (!adminRoles.includes(posReq.vloga)) {
    res.status(403).json({ error: "Operativna poročila zahtevajo administrativni dostop" });
    return;
  }
  if (!od || !doParam || !/^\d{4}-\d{2}-\d{2}$/.test(od) || !/^\d{4}-\d{2}-\d{2}$/.test(doParam)) {
    res.status(400).json({ error: "Podajte veljavno obdobje od in do (YYYY-MM-DD)" });
    return;
  }
  if (od > doParam) {
    res.status(400).json({ error: "Začetni datum ne sme biti po končnem datumu" });
    return;
  }

  const enoteWhere = [
    eq(enoteTable.companyId, posReq.companyId),
    eq(enoteTable.aktiven, true),
    ...(posReq.vloga === "admin_enote" ? [eq(enoteTable.id, posReq.enotaId)] : []),
  ];
  const enote = await db.select({
    id: enoteTable.id,
    ime: enoteTable.ime,
  }).from(enoteTable).where(and(...enoteWhere)).orderBy(asc(enoteTable.id));

  type Postaja = {
    postajaId: number;
    postaja: string;
    enotaId: number;
    enota: string;
    skupajNalogov: number;
    zakljucenihNalogov: number;
    aktivnihNalogov: number;
    povprecjeMinut: number | null;
    najkrajsiCasMinut: number | null;
    najdaljsiCasMinut: number | null;
  };
  const postaje: Postaja[] = [];

  for (const enota of enote) {
    const start = await getBusinessDayBounds(enota.id, od);
    const end = await getBusinessDayBounds(enota.id, doParam);
    const result = await db.execute(sql`
      SELECT
        kp.id AS postaja_id,
        kp.ime AS postaja,
        COUNT(kn.id)::int AS skupaj_nalogov,
        COUNT(kn.id) FILTER (WHERE kn.bumped_at IS NOT NULL OR kn.ack_at IS NOT NULL)::int AS zakljucenih_nalogov,
        COUNT(kn.id) FILTER (WHERE kn.bumped_at IS NULL AND kn.ack_at IS NULL)::int AS aktivnih_nalogov,
        AVG(EXTRACT(EPOCH FROM (COALESCE(kn.bumped_at, kn.ack_at) - kn.ustvarjeno)) / 60.0)
          FILTER (WHERE COALESCE(kn.bumped_at, kn.ack_at) IS NOT NULL) AS povprecje_minut,
        MIN(EXTRACT(EPOCH FROM (COALESCE(kn.bumped_at, kn.ack_at) - kn.ustvarjeno)) / 60.0)
          FILTER (WHERE COALESCE(kn.bumped_at, kn.ack_at) IS NOT NULL) AS najkrajsi_cas_minut,
        MAX(EXTRACT(EPOCH FROM (COALESCE(kn.bumped_at, kn.ack_at) - kn.ustvarjeno)) / 60.0)
          FILTER (WHERE COALESCE(kn.bumped_at, kn.ack_at) IS NOT NULL) AS najdaljsi_cas_minut
      FROM kds_postaje kp
      LEFT JOIN kds_nalogi kn
        ON kn.postaja_id = kp.id
        AND kn.ustvarjeno >= ${start.start.toISOString()}::timestamptz
        AND kn.ustvarjeno < ${end.end.toISOString()}::timestamptz
      WHERE kp.enota_id = ${enota.id}
        AND kp.aktivna IS TRUE
      GROUP BY kp.id, kp.ime
      ORDER BY kp.vrstni_red ASC, kp.ime ASC
    `);
    for (const row of result.rows as Array<Record<string, unknown>>) {
      postaje.push({
        postajaId: Number(row.postaja_id),
        postaja: String(row.postaja),
        enotaId: enota.id,
        enota: enota.ime,
        skupajNalogov: Number(row.skupaj_nalogov ?? 0),
        zakljucenihNalogov: Number(row.zakljucenih_nalogov ?? 0),
        aktivnihNalogov: Number(row.aktivnih_nalogov ?? 0),
        povprecjeMinut: row.povprecje_minut == null ? null : Number(row.povprecje_minut),
        najkrajsiCasMinut: row.najkrajsi_cas_minut == null ? null : Number(row.najkrajsi_cas_minut),
        najdaljsiCasMinut: row.najdaljsi_cas_minut == null ? null : Number(row.najdaljsi_cas_minut),
      });
    }
  }

  const zakljucenih = postaje.reduce((sum, row) => sum + row.zakljucenihNalogov, 0);
  const skupaj = postaje.reduce((sum, row) => sum + row.skupajNalogov, 0);
  const povprecje = postaje
    .filter((row) => row.povprecjeMinut != null && row.zakljucenihNalogov > 0)
    .reduce((sum, row) => sum + (row.povprecjeMinut ?? 0) * row.zakljucenihNalogov, 0);
  res.json({
    od,
    do: doParam,
    skupajNalogov: skupaj,
    zakljucenihNalogov: zakljucenih,
    aktivnihNalogov: skupaj - zakljucenih,
    povprecjeMinut: zakljucenih > 0 ? povprecje / zakljucenih : null,
    poPostajah: postaje,
  });
});

router.get("/operativna-porocila/naprave", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const posReq = req as PosRequest;
  const { od, do: doParam } = req.query as { od?: string; do?: string };

  if (!["admin", "admin_enote", "superadmin"].includes(posReq.vloga)) {
    res.status(403).json({ error: "Operativna poročila zahtevajo administrativni dostop" });
    return;
  }
  if (!od || !doParam || !/^\d{4}-\d{2}-\d{2}$/.test(od) || !/^\d{4}-\d{2}-\d{2}$/.test(doParam)) {
    res.status(400).json({ error: "Podajte veljavno obdobje od in do (YYYY-MM-DD)" });
    return;
  }
  if (od > doParam) {
    res.status(400).json({ error: "Začetni datum ne sme biti po končnem datumu" });
    return;
  }

  const enoteWhere = [
    eq(enoteTable.companyId, posReq.companyId),
    eq(enoteTable.aktiven, true),
    ...(posReq.vloga === "admin_enote" ? [eq(enoteTable.id, posReq.enotaId)] : []),
  ];
  const enote = await db.select({
    id: enoteTable.id,
    ime: enoteTable.ime,
  }).from(enoteTable).where(and(...enoteWhere)).orderBy(asc(enoteTable.id));

  type DeviceStatus = "v_redu" | "opozorilo" | "napaka";
  type PrinterStatus = "dosegljiv" | "ni_dosegljiv" | "ni_potrditve" | "ni_nastavljen";
  const devices: Array<{
    id: number;
    enotaId: number;
    enota: string;
    ime: string;
    posodobljeno: string;
    status: DeviceStatus;
    konfiguracija: {
      terminal: "aktiven" | "neaktiven" | "nepopoln";
      tiskalnik: "nastavljen" | "nepopoln" | "ni_nastavljen";
    };
    tiskalnik: {
      status: PrinterStatus;
      ime: string | null;
      zadnjiSignal: string | null;
      neuspesneNaloge: number;
      cakajoceNaloge: number;
    };
    opozorila: string[];
  }> = [];

  for (const enota of enote) {
    const napraveResult = await db.execute(sql`
      SELECT id, ime, enota_id, posodobljeno, nastavitve_json
      FROM naprave
      WHERE enota_id = ${enota.id}
      ORDER BY ime ASC, id ASC
    `);
    const heartbeatResult = await db.execute(sql`
      SELECT printer_key, last_seen_at
      FROM pos_printer_heartbeats
      WHERE enota_id = ${enota.id}
    `);
    const jobsStart = await getBusinessDayBounds(enota.id, od);
    const jobsEnd = await getBusinessDayBounds(enota.id, doParam);
    const jobsResult = await db.execute(sql`
      SELECT printer_key, status, COUNT(*)::int AS count
      FROM tiskalne_naloge
      WHERE enota_id = ${enota.id}
        AND ustvarjeno >= ${jobsStart.start.toISOString()}::timestamptz
        AND ustvarjeno < ${jobsEnd.end.toISOString()}::timestamptz
      GROUP BY printer_key, status
    `);

    const heartbeatByPrinter = new Map<string, string>();
    for (const row of heartbeatResult.rows as Array<Record<string, unknown>>) {
      if (row.printer_key != null && row.last_seen_at != null) {
        heartbeatByPrinter.set(String(row.printer_key), new Date(String(row.last_seen_at)).toISOString());
      }
    }
    const jobsByPrinter = new Map<string, { failed: number; queued: number }>();
    for (const row of jobsResult.rows as Array<Record<string, unknown>>) {
      const key = row.printer_key == null ? "" : String(row.printer_key);
      const current = jobsByPrinter.get(key) ?? { failed: 0, queued: 0 };
      const count = Number(row.count ?? 0);
      if (row.status === "failed" || row.status === "needs_review") current.failed += count;
      if (row.status === "queued" || row.status === "running") current.queued += count;
      jobsByPrinter.set(key, current);
    }

    for (const row of napraveResult.rows as Array<Record<string, unknown>>) {
      let config: Record<string, unknown> = {};
      if (typeof row.nastavitve_json === "string") {
        try { config = JSON.parse(row.nastavitve_json) as Record<string, unknown>; } catch { /* neveljaven JSON obravnavamo kot manjkajočo konfiguracijo */ }
      }

      const terminalAktiven = Boolean(
        config.terminalAktiven ||
        config.paytenAndroidAktiven ||
        config.sumupAktiven ||
        config.vivaAktiven ||
        config.vivaTerminalAktiven ||
        config.vivaAndroidTerminalAktiven ||
        config.vivaTapToPayAktiven,
      );
      const terminalIssues: string[] = [];
      if (config.terminalAktiven && (!String(config.terminalIp ?? "").trim() || !Number(config.terminalPort))) {
        terminalIssues.push("plačilni terminal nima popolnega omrežnega naslova");
      }
      if (config.sumupAktiven && (!String(config.sumupTerminalSerial ?? "").trim() || !config.sumupApiKey)) {
        terminalIssues.push("SumUp nima serijske številke ali ključa");
      }
      if (config.vivaAktiven && (!String(config.vivaClientId ?? "").trim() || !config.vivaClientSecret || !String(config.vivaSourceCode ?? "").trim())) {
        terminalIssues.push("Viva nima popolne konfiguracije");
      }
      if (config.vivaTerminalAktiven && !String(config.vivaTerminalId ?? "").trim()) {
        terminalIssues.push("Viva Terminal nima ID-ja terminala");
      }
      if (config.vivaAndroidTerminalAktiven && !String(config.vivaAndroidSourceCode ?? "").trim()) {
        terminalIssues.push("Viva Android nima izvorne kode");
      }
      if (config.vivaTapToPayAktiven && !String(config.vivaTapToPaySourceCode ?? "").trim()) {
        terminalIssues.push("Viva Tap to Pay nima izvorne kode");
      }
      const terminalStatus = terminalIssues.length > 0 ? "nepopoln" : terminalAktiven ? "aktiven" : "neaktiven";

      const printerName = String(config.agentTiskalnikIme ?? "").trim();
      const printerConfigured = Boolean(printerName || config.tiskalnikTip || config.tiskalnikSirina != null);
      const printerConfigIssues: string[] = [];
      const printerIssues: string[] = [];
      let printerStatus: PrinterStatus = "ni_nastavljen";
      let lastSeenAt: string | null = null;
      if (printerConfigured) {
        if (!printerName) {
          printerStatus = "ni_potrditve";
          if (config.tiskalnikTip === "windows") {
            printerConfigIssues.push("Windows tiskalnik je nastavljen brez imena agenta");
          }
          printerIssues.push("vgrajeni tiskalnik nima avtomatskega preverjanja dosegljivosti");
        } else {
          lastSeenAt = heartbeatByPrinter.get(printerName) ?? null;
          if (!lastSeenAt) {
            printerStatus = "ni_potrditve";
            printerIssues.push("agent tiskalnika se še ni javil");
          } else if (Date.now() - new Date(lastSeenAt).getTime() > 10 * 60 * 1000) {
            printerStatus = "ni_dosegljiv";
            printerIssues.push("agent tiskalnika se ni javil zadnjih 10 minut");
          } else {
            printerStatus = "dosegljiv";
          }
        }
      }

      const jobs = printerName ? (jobsByPrinter.get(printerName) ?? { failed: 0, queued: 0 }) : { failed: 0, queued: 0 };
      const jobIssues = jobs.failed > 0
        ? [`${jobs.failed} tiskalnih nalog zahteva preverjanje`]
        : [];
      const opozorila = [...terminalIssues, ...printerConfigIssues, ...printerIssues, ...jobIssues];
      const status: DeviceStatus = terminalIssues.length > 0 || printerConfigIssues.length > 0 || jobs.failed > 0
        ? "napaka"
        : printerStatus === "ni_dosegljiv" || printerStatus === "ni_potrditve"
          ? "opozorilo"
          : "v_redu";

      devices.push({
        id: Number(row.id),
        enotaId: enota.id,
        enota: enota.ime,
        ime: String(row.ime ?? "Naprava"),
        posodobljeno: new Date(String(row.posodobljeno)).toISOString(),
        status,
        konfiguracija: {
          terminal: terminalStatus,
          tiskalnik: printerConfigIssues.length > 0 ? "nepopoln" : printerConfigured ? "nastavljen" : "ni_nastavljen",
        },
        tiskalnik: {
          status: printerStatus,
          ime: printerName || null,
          zadnjiSignal: lastSeenAt,
          neuspesneNaloge: jobs.failed,
          cakajoceNaloge: jobs.queued,
        },
        opozorila,
      });
    }
  }

  res.json({
    od,
    do: doParam,
    skupaj: devices.length,
    vRedu: devices.filter((device) => device.status === "v_redu").length,
    opozorila: devices.filter((device) => device.status === "opozorilo").length,
    napake: devices.filter((device) => device.status === "napaka").length,
    naprave: devices,
  });
});

router.get("/statistike/promet-obdobja", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const posReq = req as PosRequest;
  const tenotaId = posReq.enotaId ?? 1;

  const { od, do: doParam, blagajnaId: rawBlagajnaId } = req.query as { od?: string; do?: string; blagajnaId?: string };
  if (!od || !doParam) {
    res.status(400).json({ error: "Manjkata parametra od in do (YYYY-MM-DD)" }); return;
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(od) || !/^\d{4}-\d{2}-\d{2}$/.test(doParam)) {
    res.status(400).json({ error: "Neveljaven format datuma" }); return;
  }

  // Pridobi začetek poslovnega dne iz enote
  const [enotaInfo] = await db.select({ ime: enoteTable.ime, zacetekDnevaUra: enoteTable.zacetekDnevaUra })
    .from(enoteTable)
    .where(and(eq(enoteTable.id, tenotaId)));
  const zacetekUra = enotaInfo?.zacetekDnevaUra ?? "04:00";
  let blagajnaPrefix: string | null = null;
  if (rawBlagajnaId !== undefined) {
    const blagajnaId = Number(rawBlagajnaId);
    if (!Number.isInteger(blagajnaId) || blagajnaId < 1) {
      res.status(400).json({ error: "Neveljavna blagajna." }); return;
    }
    const [blagajna] = await db.select({ ppId: blagajneTable.ppId, bId: blagajneTable.bId })
      .from(blagajneTable)
      .where(and(eq(blagajneTable.id, blagajnaId), eq(blagajneTable.enotaId, tenotaId)))
      .limit(1);
    if (!blagajna) {
      res.status(404).json({ error: "Izbrana blagajna ne pripada poslovni enoti." }); return;
    }
    if (posReq.vloga === "uporabnik") {
      const [user] = await db.select({ blagajnaId: posUporabnikiTable.blagajnaId })
        .from(posUporabnikiTable)
        .where(and(
          eq(posUporabnikiTable.clerkUserId, posReq.clerkUserId),
          eq(posUporabnikiTable.companyId, posReq.companyId),
          eq(posUporabnikiTable.aktiven, true),
        ))
        .limit(1);
      if (user?.blagajnaId !== blagajnaId) {
        res.status(403).json({ error: "Blagajnik lahko uporablja samo svojo dodeljeno blagajno." }); return;
      }
    }
    blagajnaPrefix = getPosReceiptPrefixPattern(blagajna.ppId, blagajna.bId);
  }

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
    lt(racuniTable.ustvarjeno, doDate),
    sql`true`,
    eq(racuniTable.enotaId, tenotaId),
    ne(racuniTable.status, "storniran"),
    ne(racuniTable.jeStorno, true),
    blagajnaPrefix ? sql`${racuniTable.stevilkaRacuna} LIKE ${blagajnaPrefix} ESCAPE '!'` : sql`true`,
  );
  const blagajnaRawFilter = blagajnaPrefix
    ? sql`AND stevilka_racuna LIKE ${blagajnaPrefix} ESCAPE '!'`
    : sql``;

  const [skupni] = await db.select({ skupaj: sum(racuniTable.skupaj), napitnina: sum(racuniTable.znesekNapitnina), stevilo: count(racuniTable.id), ddv: sum(racuniTable.ddv) })
    .from(racuniTable).where(podmeje);

  // Mešana plačila vedno uporabljajo posamezne znesek_* stolpce. Stari računi
  // teh stolpcev nimajo, zato se samo zanje uporabi placilna_nacin kot fallback.
  const hasSplitPayment = sql`(
    ${racuniTable.znesekGotovina} IS NOT NULL OR ${racuniTable.znesekKartica} IS NOT NULL
    OR ${racuniTable.znesekBon} IS NOT NULL OR ${racuniTable.znesekBonPica} IS NOT NULL
    OR ${racuniTable.znesekNegotovinsko} IS NOT NULL
  )`;
  const [placila] = await db.select({
    gotovina: sql<string>`SUM(CASE WHEN ${hasSplitPayment} THEN COALESCE(${racuniTable.znesekGotovina}::numeric, 0) WHEN ${racuniTable.placilnaNacin} = 'gotovina' THEN ${racuniTable.skupaj}::numeric ELSE 0 END)`,
    kartica: sql<string>`SUM(CASE WHEN ${hasSplitPayment} THEN CASE WHEN ${racuniTable.sumupCheckoutId} IS NULL THEN COALESCE(${racuniTable.znesekKartica}::numeric, 0) ELSE 0 END WHEN ${racuniTable.placilnaNacin} = 'kartica' AND ${racuniTable.sumupCheckoutId} IS NULL THEN ${racuniTable.skupaj}::numeric ELSE 0 END)`,
    sumup: sql<string>`SUM(CASE WHEN ${hasSplitPayment} THEN CASE WHEN ${racuniTable.sumupCheckoutId} IS NOT NULL THEN COALESCE(${racuniTable.znesekKartica}::numeric, 0) ELSE 0 END WHEN ${racuniTable.placilnaNacin} = 'kartica' AND ${racuniTable.sumupCheckoutId} IS NOT NULL THEN ${racuniTable.skupaj}::numeric ELSE 0 END)`,
    bon: sql<string>`SUM(CASE WHEN ${hasSplitPayment} THEN COALESCE(${racuniTable.znesekBon}::numeric, 0) WHEN ${racuniTable.placilnaNacin} = 'bon' THEN ${racuniTable.skupaj}::numeric ELSE 0 END)`,
    bonPica: sql<string>`SUM(CASE WHEN ${hasSplitPayment} THEN COALESCE(${racuniTable.znesekBonPica}::numeric, 0) WHEN ${racuniTable.placilnaNacin} = 'bon_pica' THEN ${racuniTable.skupaj}::numeric ELSE 0 END)`,
    napitnina: sql<string>`COALESCE(SUM(${racuniTable.znesekNapitnina}::numeric), 0)`,
    negotovinsko: sql<string>`SUM(CASE WHEN ${hasSplitPayment} THEN COALESCE(${racuniTable.znesekNegotovinsko}::numeric, 0) WHEN ${racuniTable.placilnaNacin} = 'negotovinsko' THEN ${racuniTable.skupaj}::numeric ELSE 0 END)`,
    steviloBonov: sum(racuniTable.steviloBonov),
  }).from(racuniTable).where(podmeje);
  const tipBreakdown = await getTipBreakdown(db, tenotaId, odDate, doDate, blagajnaPrefix ?? undefined);

  // Reprezentanca in lastna_poraba imata skupaj=0 (brezplačni računi) —
  // pravi znesek je face value iz postavk
  const faceValueSql = async (nacin: string): Promise<number> => {
    const ids = await db.select({ id: racuniTable.id })
      .from(racuniTable)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .where(and(podmeje, eq(racuniTable.placilnaNacin, nacin as any)));
    if (ids.length === 0) return 0;
    const idList = ids.map(r => r.id);
    const fvResult = await db.execute(sql`
      SELECT COALESCE(SUM(skupaj::numeric), 0) AS face
      FROM postavke
      WHERE ${inArray(postavkeTable.racunId, idList)}
    `);
    const fv = fvResult.rows[0] as { face: string } | undefined;
    return Number(fv?.face ?? 0);
  };
  const [reprZnesek, lastnaZnesek] = await Promise.all([
    faceValueSql("reprezentanca"),
    faceValueSql("lastna_poraba"),
  ]);
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
      AND ustvarjeno < ${doDate.toISOString()}::timestamptz
      AND enota_id = ${tenotaId}
      AND status != 'storniran'
      AND je_storno IS NOT TRUE
      ${blagajnaRawFilter}
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
  // Račun hrani ime kot zgodovinski posnetek, vendar to ni identiteta osebe:
  // po spremembi priimka bi isti natakar sicer nastopil v dveh vrsticah.
  // Kjer obstaja izmena, zato združujemo po trajnem natakari_id in prikažemo
  // trenutno ime profila. Samo stare račune brez izmene združujemo po posnetku.
  const poNatakarjihRaw = await db.execute(sql`
    SELECT
      COALESCE(
        MAX(NULLIF(BTRIM(CONCAT_WS(' ', n.ime, n.priimek)), '')),
        MAX(COALESCE(r.natakar_ime, '—'))
      ) AS natakar_ime,
      SUM(r.skupaj::numeric) AS skupaj,
       SUM(CASE WHEN r.znesek_gotovina IS NOT NULL OR r.znesek_kartica IS NOT NULL OR r.znesek_bon IS NOT NULL OR r.znesek_bon_pica IS NOT NULL OR r.znesek_negotovinsko IS NOT NULL THEN COALESCE(r.znesek_gotovina::numeric, 0) WHEN r.placilna_nacin = 'gotovina' THEN r.skupaj::numeric ELSE 0 END) AS gotovina,
       SUM(CASE WHEN r.znesek_gotovina IS NOT NULL OR r.znesek_kartica IS NOT NULL OR r.znesek_bon IS NOT NULL OR r.znesek_bon_pica IS NOT NULL OR r.znesek_negotovinsko IS NOT NULL THEN CASE WHEN r.sumup_checkout_id IS NULL THEN COALESCE(r.znesek_kartica::numeric, 0) ELSE 0 END WHEN r.placilna_nacin = 'kartica' AND r.sumup_checkout_id IS NULL THEN r.skupaj::numeric ELSE 0 END) AS kartica,
       SUM(CASE WHEN r.znesek_gotovina IS NOT NULL OR r.znesek_kartica IS NOT NULL OR r.znesek_bon IS NOT NULL OR r.znesek_bon_pica IS NOT NULL OR r.znesek_negotovinsko IS NOT NULL THEN CASE WHEN r.sumup_checkout_id IS NOT NULL THEN COALESCE(r.znesek_kartica::numeric, 0) ELSE 0 END WHEN r.placilna_nacin = 'kartica' AND r.sumup_checkout_id IS NOT NULL THEN r.skupaj::numeric ELSE 0 END) AS sumup,
       SUM(CASE WHEN r.znesek_gotovina IS NOT NULL OR r.znesek_kartica IS NOT NULL OR r.znesek_bon IS NOT NULL OR r.znesek_bon_pica IS NOT NULL OR r.znesek_negotovinsko IS NOT NULL THEN COALESCE(r.znesek_bon::numeric, 0) WHEN r.placilna_nacin = 'bon' THEN r.skupaj::numeric ELSE 0 END) AS bon,
       SUM(CASE WHEN r.znesek_gotovina IS NOT NULL OR r.znesek_kartica IS NOT NULL OR r.znesek_bon IS NOT NULL OR r.znesek_bon_pica IS NOT NULL OR r.znesek_negotovinsko IS NOT NULL THEN COALESCE(r.znesek_bon_pica::numeric, 0) WHEN r.placilna_nacin = 'bon_pica' THEN r.skupaj::numeric ELSE 0 END) AS bon_pica,
      COALESCE(SUM(r.stevilo_bonov), 0)::int AS stevilo_bonov_pica,
      COUNT(*)::int AS stevilo_racunov
    FROM racuni r
    LEFT JOIN izmene i ON i.id = r.izmena_id
    LEFT JOIN natakari n ON n.id = i.natakari_id
    WHERE r.ustvarjeno >= ${odDate.toISOString()}::timestamptz
      AND r.ustvarjeno < ${doDate.toISOString()}::timestamptz
      AND r.enota_id = ${tenotaId}
      AND r.status != 'storniran'
      AND r.je_storno IS NOT TRUE
      ${blagajnaPrefix ? sql`AND r.stevilka_racuna LIKE ${blagajnaPrefix} ESCAPE '!'` : sql``}
    GROUP BY COALESCE(
      'natakar:' || i.natakari_id::text,
      'ime:' || COALESCE(r.natakar_ime, '—')
    )
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

  // ── prihodki po vrsti (storitve / blago / material) ─────
  // Vrsta je shranjena direktno v postavkah (vrsta_artikla) ob vpisu naročila.
  // Parent-child logika je upoštevana že pri shranjevanju postavke.
  const prihodkiVrstaRaw = await db.execute(sql`
    SELECT
      SUM(CASE WHEN COALESCE(p.vrsta_artikla, 'storitev') = 'blago'
          THEN p.skupaj::numeric * 100.0 / (100 + p.davek::numeric) ELSE 0 END) AS blago,
      SUM(CASE WHEN COALESCE(p.vrsta_artikla, 'storitev') = 'material'
          THEN p.skupaj::numeric * 100.0 / (100 + p.davek::numeric) ELSE 0 END) AS material,
      SUM(CASE WHEN COALESCE(p.vrsta_artikla, 'storitev') = 'storitev'
          THEN p.skupaj::numeric * 100.0 / (100 + p.davek::numeric) ELSE 0 END) AS storitve
    FROM postavke p
    JOIN racuni r ON r.id = p.racun_id
    WHERE r.ustvarjeno >= ${odDate.toISOString()}::timestamptz
      AND r.ustvarjeno < ${doDate.toISOString()}::timestamptz
      AND r.enota_id = ${tenotaId}
      AND r.status != 'storniran'
      AND r.je_storno IS NOT TRUE
      ${blagajnaPrefix ? sql`AND r.stevilka_racuna LIKE ${blagajnaPrefix} ESCAPE '!'` : sql``}
      AND r.placilna_nacin NOT IN ('reprezentanca', 'lastna_poraba')
  `);
  type PrihodkiVrstaRow = { storitve: string | null; blago: string | null; material: string | null };
  const pvRow = prihodkiVrstaRaw.rows[0] as PrihodkiVrstaRow | undefined;
  const prihodkiPoVrsti = {
    storitve: Number(pvRow?.storitve ?? 0),
    blago: Number(pvRow?.blago ?? 0),
    material: Number(pvRow?.material ?? 0)};

  // ── DDV po stopnjah (iz postavk) ─────────────────────────
  const ddvPoStopnjahRaw = await db.execute(sql`
    SELECT
      p.davek::numeric AS stopnja,
      SUM(p.skupaj::numeric * p.davek::numeric / (100 + p.davek::numeric)) AS ddv_znesek,
      SUM(p.skupaj::numeric / (1 + p.davek::numeric / 100))                AS osnova
    FROM postavke p
    JOIN racuni r ON r.id = p.racun_id
    WHERE r.ustvarjeno >= ${odDate.toISOString()}::timestamptz
      AND r.ustvarjeno < ${doDate.toISOString()}::timestamptz
      AND r.enota_id = ${tenotaId}
      AND r.status != 'storniran'
      AND r.je_storno IS NOT TRUE
      ${blagajnaPrefix ? sql`AND r.stevilka_racuna LIKE ${blagajnaPrefix} ESCAPE '!'` : sql``}
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
      AND ustvarjeno < ${doDate.toISOString()}::timestamptz
      AND enota_id = ${tenotaId}
      AND status != 'storniran'
      AND je_storno IS NOT TRUE
      ${blagajnaRawFilter}
  `);
  type ZapRow = { od_zap?: string | null; do_zap?: string | null };
  const zapRow = zapSeqResult.rows[0] as ZapRow | undefined;
  const odZap = zapRow?.od_zap ?? null;
  const doZap = zapRow?.do_zap ?? null;

  // ── darilni boni (izdaje / unovčitve v tem obdobju) ──────
  const darilniBoniRes = await db.execute(sql`
    SELECT
      COALESCE(SUM(CASE WHEN dbg.tip = 'izdaja'    THEN dbg.znesek::numeric ELSE 0 END), 0) AS izdaja,
      COALESCE(SUM(CASE WHEN dbg.tip = 'unovcitev' THEN dbg.znesek::numeric ELSE 0 END), 0) AS unovcitev
    FROM darilni_bon_gibi dbg
    JOIN racuni r ON r.id = dbg.racun_id
    WHERE r.ustvarjeno >= ${odDate.toISOString()}::timestamptz
      AND r.ustvarjeno < ${doDate.toISOString()}::timestamptz
      AND r.enota_id = ${tenotaId}
      AND r.status != 'storniran'
      AND r.je_storno IS NOT TRUE
      ${blagajnaPrefix ? sql`AND r.stevilka_racuna LIKE ${blagajnaPrefix} ESCAPE '!'` : sql``}
  `);
  type DarilniBoniRow = { izdaja: string; unovcitev: string };
  const dbonRow = darilniBoniRes.rows[0] as DarilniBoniRow | undefined;

  // ── SŠP subvencija (terjatev do ZRSZ) ────────────────────
  const sspRes = await db.execute(sql`
    SELECT COALESCE(SUM(znesek_subvencija::numeric), 0) AS skupaj
    FROM racuni
    WHERE ustvarjeno >= ${odDate.toISOString()}::timestamptz
      AND ustvarjeno < ${doDate.toISOString()}::timestamptz
      AND enota_id = ${tenotaId}
      AND status != 'storniran'
      AND je_storno IS NOT TRUE
      ${blagajnaRawFilter}
  `);
  type SspRow = { skupaj: string };
  const sspRow = sspRes.rows[0] as SspRow | undefined;

  // ── FURS statistika (potrjeni / nepotrjeni) ───────────────
  const fursStatRes = await db.execute(sql`
    SELECT
      COUNT(*) FILTER (WHERE eor IS NOT NULL AND status = 'poslan') AS potrjeni,
      COUNT(*) FILTER (WHERE eor IS NULL OR status = 'napaka')      AS nepotrjeni
    FROM racuni
    WHERE ustvarjeno >= ${odDate.toISOString()}::timestamptz
      AND ustvarjeno < ${doDate.toISOString()}::timestamptz
      AND enota_id = ${tenotaId}
      AND status != 'storniran'
      AND je_storno IS NOT TRUE
      ${blagajnaRawFilter}
  `);
  type FursStatRow = { potrjeni: string; nepotrjeni: string };
  const fursStatRow = fursStatRes.rows[0] as FursStatRow | undefined;

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
       gotovina: Number(placila?.gotovina ?? 0),
       kartica: Number(placila?.kartica ?? 0),
       bon: Number(placila?.bon ?? 0),
       sumup: Number(placila?.sumup ?? 0),
       bonPica: Number(placila?.bonPica ?? 0),
       napitnina: Number(placila?.napitnina ?? 0),
       steviloBonov: Number(placila?.steviloBonov ?? 0),
       negotovinsko: Number(placila?.negotovinsko ?? 0),
      reprezentanca: reprZnesek,
       lastna_poraba: lastnaZnesek},
     tipBreakdown,
    prometPoBlagajnah,
    prometPoNatakarjih,
    ddvPoStopnjah,
    prihodkiPoVrsti,
    izdaniKuponi: Number(kuponRes?.izdaniKuponi ?? 0),
    prejetiKuponi: Number(kuponRes?.prejetiKuponi ?? 0),
    odZap,
    doZap,
    darilniBoniIzdaja: Number(dbonRow?.izdaja ?? 0),
    darilniBoniUnovcitev: Number(dbonRow?.unovcitev ?? 0),
    sspSubvencija: Number(sspRow?.skupaj ?? 0),
    fursPotrjeni: Number(fursStatRow?.potrjeni ?? 0),
    fursNepotrjeni: Number(fursStatRow?.nepotrjeni ?? 0),
    podjetje: {
      naziv: podjetje?.naziv ?? "",
      naslov: podjetjeNaslov,
      davcnaStevilka: podjetje?.idZaDdv ?? ""},
    enota: {
      id: tenotaId,
      ime: enotaInfo?.ime ?? `Enota #${tenotaId}`,
    }});
});

router.get("/statistike", async (req, res): Promise<void> => {
  const tenotaId = (req as any).enotaId ?? 1;

  const businessDate = await getCurrentPosBusinessDate(tenotaId);
  const { start: startOfDay, end: endOfDay } = await getBusinessDayBounds(tenotaId, businessDate);
  const dnevniInterval = and(
    gte(racuniTable.ustvarjeno, startOfDay),
    lt(racuniTable.ustvarjeno, endOfDay),
    eq(racuniTable.enotaId, tenotaId),
  );

  const [dnevniStats] = await db
    .select({
      skupaj: sum(racuniTable.skupaj),
      steviloRacunov: count(racuniTable.id),
      skupajDDV: sum(racuniTable.ddv)})
    .from(racuniTable)
    .where(dnevniInterval);

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

  const netSqlDnevni = sql<string>`SUM(skupaj::numeric)`;
  const dnevniPogoj = dnevniInterval;

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
  const dnevniTipBreakdown = await getTipBreakdown(db, tenotaId, startOfDay, endOfDay);

  const prometPoUrahRaw = await db.execute(
    sql`SELECT EXTRACT(HOUR FROM ustvarjeno AT TIME ZONE 'Europe/Ljubljana')::int AS ura,
               SUM(skupaj::numeric) AS znesek
        FROM racuni
        WHERE ustvarjeno >= ${startOfDay}
          AND ustvarjeno < ${endOfDay}
          AND enota_id = ${tenotaId}
        GROUP BY EXTRACT(HOUR FROM ustvarjeno AT TIME ZONE 'Europe/Ljubljana')
        ORDER BY ura`
  );

  const prometPoUrah = (prometPoUrahRaw.rows as { ura: number; znesek: string }[]).map((r) => ({
    ura: r.ura,
    znesek: Number(r.znesek)}));

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
            i.zacetek < ${endOfDay.toISOString()}::timestamptz
            AND (i.konec >= ${startOfDay.toISOString()}::timestamptz OR i.konec IS NULL)
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
    tipBreakdown: dnevniTipBreakdown,
    priljubljeniArtikli: priljubljeni.map((p) => ({
      artikelId: p.artikelId,
      ime: p.ime,
      steviloNarocil: Number(p.steviloNarocil),
      skupajZnesek: Number(p.skupajZnesek ?? 0)})),
    prometPoUrah,
    prometPoIzmenah}));
});

router.get("/statistike/realizacija", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store");
  const tenotaId = (req as any).enotaId ?? 1;

  const { od, do: doParam } = req.query as { od?: string; do?: string };
  if (!od || !doParam) { res.status(400).json({ error: "Manjkata parametra od in do" }); return; }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(od) || !/^\d{4}-\d{2}-\d{2}$/.test(doParam)) {
    res.status(400).json({ error: "Neveljaven format datuma" }); return;
  }

  const [enotaInfo] = await db.select({ ime: enoteTable.ime, zacetekDnevaUra: enoteTable.zacetekDnevaUra })
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
    lt(racuniTable.ustvarjeno, doDate),
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
    znesekNapitnina: racuniTable.znesekNapitnina,
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
      WHERE ${inArray(postavkeTable.racunId, specialIds)}
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
    let gotovina     = r.znesekGotovina     != null ? Number(r.znesekGotovina)     : 0;
    let kartica      = r.znesekKartica      != null ? Number(r.znesekKartica)      : 0;
    const napitnina   = Number(r.znesekNapitnina ?? 0);
    let bon          = r.znesekBon          != null ? Number(r.znesekBon)          : 0;
    let bonPica      = r.znesekBonPica      != null ? Number(r.znesekBonPica)      : 0;
    let negotovinsko = r.znesekNegotovinsko != null ? Number(r.znesekNegotovinsko) : 0;
    let reprezentanca = 0;
    let lastna_poraba = 0;
    // Kadar ni nobenega eksplicitnega zneska, razberemo iz placilnaNacin
    if (gotovina === 0 && kartica === 0 && bon === 0 && bonPica === 0 && negotovinsko === 0) {
      if (r.placilnaNacin === "gotovina") gotovina = skupajN;
      else if (r.placilnaNacin === "kartica") kartica = skupajN;
      else if (r.placilnaNacin === "bon") bon = skupajN;
      else if (r.placilnaNacin === "bon_pica") bonPica = skupajN;
      else if (r.placilnaNacin === "negotovinsko") negotovinsko = skupajN;
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
      napitnina,
      bon,
      bonPica,
      negotovinsko,
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
    napitnina: acc.napitnina + r.napitnina,
    bon:      acc.bon      + r.bon,
    bonPica:  acc.bonPica  + r.bonPica,
    negotovinsko: acc.negotovinsko + r.negotovinsko,
    reprezentanca: acc.reprezentanca + r.reprezentanca,
    lastna_poraba: acc.lastna_poraba + r.lastna_poraba,
    izdaniKuponi:  acc.izdaniKuponi  + r.izdaniKuponi,
    prejetiKuponi: acc.prejetiKuponi + r.prejetiKuponi}), { osnova: 0, ddv: 0, skupaj: 0, gotovina: 0, kartica: 0, napitnina: 0, bon: 0, bonPica: 0, negotovinsko: 0, reprezentanca: 0, lastna_poraba: 0, izdaniKuponi: 0, prejetiKuponi: 0 });

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
        COALESCE(p.vrsta_artikla, 'storitev')                                      AS vrsta,
        SUM(p.skupaj::numeric / (1 + p.davek::numeric / 100.0))                    AS osnova,
        SUM(p.skupaj::numeric * p.davek::numeric / (100.0 + p.davek::numeric))     AS ddv
      FROM postavke p
      WHERE ${inArray(sql`p.racun_id`, racunIds)}
      GROUP BY p.racun_id, p.davek, COALESCE(p.vrsta_artikla, 'storitev')
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

  // Skupni DDV po stopnjah in vrsti (material/blago/storitev) — samo aktivni računi
  type DdvSkupajR = { stopnja: string; vrsta: string; osnova: string; ddv: string };
  const ddvPoStopnjahSkupaj = await (async () => {
    if (aktivniRacunIds.length === 0) return [];
    const raw = await db.execute(sql`
      SELECT
        p.davek::numeric AS stopnja,
        COALESCE(p.vrsta_artikla, 'storitev')                                      AS vrsta,
        SUM(p.skupaj::numeric / (1 + p.davek::numeric / 100.0))                   AS osnova,
        SUM(p.skupaj::numeric * p.davek::numeric / (100.0 + p.davek::numeric))    AS ddv
      FROM postavke p
      WHERE ${inArray(sql`p.racun_id`, aktivniRacunIds)}
      GROUP BY p.davek, COALESCE(p.vrsta_artikla, 'storitev')
      ORDER BY p.davek, vrsta DESC
    `);
    return (raw.rows as DdvSkupajR[]).map(r => ({
      stopnja: Number(r.stopnja),
      vrsta: r.vrsta as "blago" | "storitev" | "material",
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
          COALESCE(p.vrsta_artikla, 'storitev')                                                                          AS vrsta,
          SUM(CASE WHEN r.placilna_nacin IN ('lastna_poraba','reprezentanca') THEN 0::numeric ELSE p.skupaj::numeric END) AS skupaj,
          SUM(p.skupaj::numeric / (1 + p.davek::numeric / 100))                                                          AS osnova,
          SUM(p.skupaj::numeric * p.davek::numeric / (100.0 + p.davek::numeric))                                         AS ddv
        FROM postavke p
        JOIN artikli a ON a.id = p.artikel_id
        JOIN racuni r ON r.id = p.racun_id
        WHERE ${inArray(sql`p.racun_id`, aktivniRacunIds)}
        GROUP BY p.ime, a.enota_mere, p.davek, COALESCE(p.vrsta_artikla, 'storitev')
        ORDER BY p.ime, p.davek, vrsta DESC
      `)
    : { rows: [] as ArtikelR[] };
  const artikli = (artikliRaw.rows as ArtikelR[]).map(r => ({
    ime: r.ime,
    enota: r.enota,
    kolicina: Number(r.kolicina),
    ddvStopnja: Number(r.ddv_stopnja),
    vrsta: r.vrsta as "blago" | "storitev" | "material",
    skupaj: Number(r.skupaj),
    osnova: Number(r.osnova),
    ddv: Number(r.ddv)}));

  res.json({ racuni: racuniZDdv, skupaj, ddvPoStopnjah: ddvPoStopnjahSkupaj, artikli, zacetekUra,
    poslovnaEnota: { id: tenotaId, naziv: enotaInfo?.ime ?? "" }, podjetje: {
    naziv: podjetje?.naziv ?? "",
    naslov: podjetjeNaslov,
    davcnaStevilka: podjetje?.idZaDdv ?? ""}});
});

export default router;
