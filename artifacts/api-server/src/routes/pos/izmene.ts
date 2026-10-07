import { Router, type IRouter, type Request, type Response } from "express";
import { and, count, desc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, or, sql, sum } from "drizzle-orm";
import { createHmac } from "node:crypto";
import {
  db, blagajneTable, costCentersTable, enoteTable, izmeneTable, natakariTable, racuniTable,
  odmoriTable, odsotnostiTable, izmenaPopravkiTable, kadrovskiAuditTable, tipAllocationsTable,
} from "@workspace/db";
import { z } from "zod";
import type { PosRequest } from "../../middlewares/pos";
import { getSimDatumOrNow } from "../../lib/sim-datum";
import { getCurrentPosBusinessDate } from "../../lib/pos-business-day";
import { checkPreviousBusinessDayClosed, isPosBusinessDayClosed, lockPosBusinessDay } from "../../lib/pos-z-helpers";
import { getPosActorSessionSecret } from "../../lib/posActorSessionSecret";
import { writePosActorAudit } from "../../lib/posActorAudit";
import { broadcastToUnit } from "../../lib/pos-sse";
import {
  POS_PIN_LOCK_MS,
  POS_PIN_MAX_FAILURES,
  verifyPosPin,
} from "../../lib/posPin";
import { slovenskiDatumZaSporocilo } from "../../lib/slovenian-date-message";

const router: IRouter = Router();
const MISSING_COST_CENTER_WARNING = "Poslovna enota nima nastavljenega stroškovnega mesta.";
const ACTOR_SESSION_MS = 16 * 60 * 60_000;

function toResponse(row: typeof izmeneTable.$inferSelect & { natakarIme: string; enotaIme?: string | null; blagajnaIme?: string | null }) {
  return {
    id: row.id,
    natakariId: row.natakariId,
    natakarIme: row.natakarIme,
    zacetek: row.zacetek.toISOString(),
    konec: row.konec ? row.konec.toISOString() : null,
    skupajZnesek: Number(row.skupajZnesek),
    steviloRacunov: row.steviloRacunov,
    enotaId: row.enotaId,
    enotaIme: row.enotaIme ?? null,
    blagajnaId: row.blagajnaId ?? null,
    blagajnaIme: row.blagajnaIme ?? null,
    costCenterId: row.costCenterId ?? null,
    status: row.status,
    potrjenoBy: row.potrjenoBy ?? null,
    potrjenoAt: row.potrjenoAt ? row.potrjenoAt.toISOString() : null,
    zavrnitevRazlog: row.zavrnitevRazlog ?? null,
  };
}

// Skupni select za vse poizvedbe
const izmenaSelect = {
  id: izmeneTable.id,
  natakariId: izmeneTable.natakariId,
  enotaId: izmeneTable.enotaId,
  blagajnaId: izmeneTable.blagajnaId,
  costCenterId: izmeneTable.costCenterId,
  natakarIme: natakariTable.ime,
  natakarPriimek: natakariTable.priimek,
  enotaIme: enoteTable.ime,
  blagajnaIme: blagajneTable.ime,
  zacetek: izmeneTable.zacetek,
  konec: izmeneTable.konec,
  skupajZnesek: izmeneTable.skupajZnesek,
  steviloRacunov: izmeneTable.steviloRacunov,
  status: izmeneTable.status,
  potrjenoBy: izmeneTable.potrjenoBy,
  potrjenoAt: izmeneTable.potrjenoAt,
  zavrnitevRazlog: izmeneTable.zavrnitevRazlog,
} as const;

function baseQuery() {
  return db
    .select(izmenaSelect)
    .from(izmeneTable)
    .leftJoin(natakariTable, eq(izmeneTable.natakariId, natakariTable.id))
    .leftJoin(enoteTable, eq(izmeneTable.enotaId, enoteTable.id))
    .leftJoin(blagajneTable, eq(izmeneTable.blagajnaId, blagajneTable.id));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToObj(r: any) {
  return {
    id: r.id as number,
    natakariId: r.natakariId as number,
    natakarIme: `${(r.natakarIme as string | null) ?? ""} ${(r.natakarPriimek as string | null) ?? ""}`.trim(),
    zacetek: (r.zacetek as Date).toISOString(),
    konec: r.konec ? (r.konec as Date).toISOString() : null,
    skupajZnesek: Number(r.skupajZnesek),
    steviloRacunov: r.steviloRacunov as number,
    enotaId: r.enotaId as number,
    enotaIme: (r.enotaIme as string | null) ?? null,
    blagajnaId: (r.blagajnaId as number | null) ?? null,
    blagajnaIme: (r.blagajnaIme as string | null) ?? null,
    costCenterId: (r.costCenterId as string | null) ?? null,
    status: r.status as string,
    potrjenoBy: (r.potrjenoBy as string | null) ?? null,
    potrjenoAt: r.potrjenoAt ? (r.potrjenoAt as Date).toISOString() : null,
    zavrnitevRazlog: (r.zavrnitevRazlog as string | null) ?? null,
  };
}

type ObracunUrVrstica = {
  izmenaId: number;
  natakariId: number;
  natakar: string;
  enotaId: number;
  enota: string;
  costCenterId: string | null;
  smKoda: string | null;
  smNaziv: string;
  datum: string;
  zacetek: string;
  konec: string;
  ureTrajanja: number;
};

type ObracunUrSkupina = Omit<ObracunUrVrstica, "izmenaId" | "datum" | "zacetek" | "konec" | "ureTrajanja"> & {
  steviloIzmen: number;
  skupajUr: number;
};

const obracunUrQuerySchema = z.object({
  od: z.string(),
  do: z.string(),
  enotaId: z.coerce.number().int().positive().optional(),
  natakariId: z.coerce.number().int().positive().optional(),
});

const obracunUrResponseSchema = z.object({
  skupine: z.array(z.object({
    natakariId: z.number(),
    natakar: z.string(),
    enotaId: z.number(),
    enota: z.string(),
    costCenterId: z.string().nullable(),
    smKoda: z.string().nullable(),
    smNaziv: z.string(),
    steviloIzmen: z.number(),
    skupajUr: z.number(),
  })),
  vrstice: z.array(z.object({
    izmenaId: z.number(),
    natakariId: z.number(),
    natakar: z.string(),
    enotaId: z.number(),
    enota: z.string(),
    costCenterId: z.string().nullable(),
    smKoda: z.string().nullable(),
    smNaziv: z.string(),
    datum: z.string(),
    zacetek: z.string(),
    konec: z.string(),
    ureTrajanja: z.number(),
  })),
  skupajUr: z.number(),
  poSM: z.array(z.object({
    costCenterId: z.string().nullable(),
    sm: z.string(),
    smKoda: z.string().nullable(),
    smNaziv: z.string(),
    ur: z.number(),
    steviloIzmen: z.number(),
  })),
});

function roundHours(value: number): number {
  return Number(value.toFixed(2));
}

const LJUBLJANA_TIME_ZONE = "Europe/Ljubljana";
const MAX_OBRACUN_DAYS = 366;
const ljubljanaDateTimeFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: LJUBLJANA_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

function nextCalendarDate(value: string): string {
  const date = new Date(`${value}T12:00:00.000Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function ljubljanaCalendarDate(value: Date): string {
  const parts = ljubljanaDateTimeFormatter.formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/**
 * Lokalna polnoč v Sloveniji kot dejanski UTC trenutek. Polnoč v tem časovnem
 * pasu ni dvoumna niti izpuščena ob prehodu poletnega/zimskega časa.
 */
export function ljubljanaMidnight(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  const guess = Date.UTC(year!, month! - 1, day!);
  const parts = ljubljanaDateTimeFormatter.formatToParts(new Date(guess));
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const representedLocalAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
    get("second"),
  );
  return new Date(guess - (representedLocalAsUtc - guess));
}

type ShiftSegment = {
  datum: string;
  zacetek: Date;
  konec: Date;
  ureTrajanja: number;
};

/**
 * Plačno pravilo: izmeno razdeli po lokalnih koledarskih dnevih. Vsak segment
 * meri dejanski pretečeni čas, zato dan ob premiku ure pravilno traja 23 ali 25 ur.
 */
export function splitShiftByLjubljanaCalendarDays(
  zacetek: Date,
  konec: Date,
  od: string,
  doVkljucno: string,
): ShiftSegment[] {
  const segments: ShiftSegment[] = [];
  const periodStart = ljubljanaMidnight(od);
  const periodEnd = ljubljanaMidnight(nextCalendarDate(doVkljucno));
  const clippedStart = new Date(Math.max(zacetek.getTime(), periodStart.getTime()));
  const clippedEnd = new Date(Math.min(konec.getTime(), periodEnd.getTime()));
  if (clippedStart >= clippedEnd) return segments;

  const firstDate = ljubljanaCalendarDate(clippedStart);
  const lastDate = ljubljanaCalendarDate(new Date(clippedEnd.getTime() - 1));
  for (let datum = firstDate; datum <= lastDate; datum = nextCalendarDate(datum)) {
    const dayStart = ljubljanaMidnight(datum);
    const dayEnd = ljubljanaMidnight(nextCalendarDate(datum));
    const segmentStart = new Date(Math.max(zacetek.getTime(), dayStart.getTime()));
    const segmentEnd = new Date(Math.min(konec.getTime(), dayEnd.getTime()));
    if (segmentStart < segmentEnd) {
      segments.push({
        datum,
        zacetek: segmentStart,
        konec: segmentEnd,
        ureTrajanja: roundHours((segmentEnd.getTime() - segmentStart.getTime()) / 3_600_000),
      });
    }
  }
  return segments;
}

function costCenterSnapshotKey(
  item: Pick<ObracunUrVrstica, "costCenterId" | "smKoda" | "smNaziv">,
): string {
  return JSON.stringify([item.costCenterId, item.smKoda, item.smNaziv]);
}

function datumObdobja(value: string, isEnd: boolean): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T${isEnd ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== value ? null : date;
}

async function getWithNatakar(id: number, enotaId: number) {
  const [row] = await baseQuery()
    .where(and(eq(izmeneTable.id, id), eq(izmeneTable.enotaId, enotaId)));
  return row;
}

router.get("/izmene/aktivne", async (req, res): Promise<void> => {
  const enotaId = (req as PosRequest).enotaId;
  const rows = await baseQuery()
    .where(and(isNull(izmeneTable.konec), eq(izmeneTable.enotaId, enotaId)))
    .orderBy(izmeneTable.zacetek);

  const openBreakRows = rows.length > 0
    ? await db.select({ izmenaId: odmoriTable.izmenaId }).from(odmoriTable)
      .where(and(inArray(odmoriTable.izmenaId, rows.map(row => row.id)), isNull(odmoriTable.konec)))
    : [];
  const shiftsOnBreak = new Set(openBreakRows.map(row => row.izmenaId));

  const result = await Promise.all(rows.map(async (r) => {
    const [agg] = await db
      .select({ skupaj: sum(racuniTable.skupaj), stevilo: count(racuniTable.id) })
      .from(racuniTable)
      .where(eq(racuniTable.izmenaId, r.id));
    return {
      ...rowToObj(r),
      skupajZnesek: Number(agg?.skupaj ?? 0),
      steviloRacunov: Number(agg?.stevilo ?? 0),
      naOdmoru: shiftsOnBreak.has(r.id),
    };
  }));

  res.json(result);
});

router.get("/izmene", async (req, res): Promise<void> => {
  const enotaId = (req as PosRequest).enotaId;
  const aktivneOnly = req.query.aktivne === "true";
  const baseCondition = eq(izmeneTable.enotaId, enotaId);

  const rows = aktivneOnly
    ? await baseQuery().where(and(isNull(izmeneTable.konec), baseCondition)).orderBy(izmeneTable.zacetek)
    : await baseQuery().where(baseCondition).orderBy(izmeneTable.zacetek);

  res.json(rows.map(rowToObj));
});

/**
 * Osnovni obračun ur je strogo bralni pregled. Ključ SM je vedno snapshot
 * izmene, ne trenutna nastavitev poslovne enote.
 */
export async function getObracunUrHandler(req: Request, res: Response): Promise<void> {
  const context = req as PosRequest;
  if (!["admin", "admin_enote", "superadmin", "erp_owner", "erp_accountant"].includes(context.vloga)) {
    res.status(403).json({ error: "Obračun ur zahteva vlogo POS administratorja ali ERP računovodje/lastnika." });
    return;
  }

  const parsed = obracunUrQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: parsed.error.message });
    return;
  }

  const odDatum = parsed.data.od;
  const doDatum = parsed.data.do;
  const od = datumObdobja(odDatum, false);
  const doo = datumObdobja(doDatum, true);
  if (!od || !doo || od > doo) {
    res.status(400).json({ error: "Obdobje mora biti v formatu YYYY-MM-DD, datum od pa ne sme biti za datumom do." });
    return;
  }
  const spanDays = Math.round(
    (Date.parse(`${doDatum}T00:00:00.000Z`) - Date.parse(`${odDatum}T00:00:00.000Z`))
      / 86_400_000,
  ) + 1;
  if (spanDays > MAX_OBRACUN_DAYS) {
    res.status(400).json({ error: `Obdobje obračuna je lahko dolgo največ ${MAX_OBRACUN_DAYS} dni.` });
    return;
  }

  const requestedEnotaId = parsed.data.enotaId;
  if (context.vloga === "admin_enote" && requestedEnotaId != null && requestedEnotaId !== context.enotaId) {
    res.status(403).json({ error: "Admin enote lahko pregleduje samo svojo poslovno enoto." });
    return;
  }

  const effectiveEnotaId = context.vloga === "admin_enote"
    ? context.enotaId
    : requestedEnotaId;
  const conditions = [
    isNotNull(izmeneTable.konec),
    lt(izmeneTable.zacetek, ljubljanaMidnight(nextCalendarDate(doDatum))),
    gt(izmeneTable.konec, ljubljanaMidnight(odDatum)),
    eq(enoteTable.companyId, context.companyId),
    eq(natakariTable.companyId, context.companyId),
  ];
  if (effectiveEnotaId != null) conditions.push(eq(izmeneTable.enotaId, effectiveEnotaId));
  if (parsed.data.natakariId != null) conditions.push(eq(izmeneTable.natakariId, parsed.data.natakariId));

  const rows = await db
    .select({
      id: izmeneTable.id,
      natakariId: izmeneTable.natakariId,
      natakarIme: natakariTable.ime,
      natakarPriimek: natakariTable.priimek,
      enotaId: izmeneTable.enotaId,
      enotaIme: enoteTable.ime,
      costCenterId: izmeneTable.costCenterId,
      snapshotSmKoda: izmeneTable.costCenterCode,
      snapshotSmNaziv: izmeneTable.costCenterName,
      trenutnaSmKoda: costCentersTable.code,
      trenutnoSmNaziv: costCentersTable.name,
      zacetek: izmeneTable.zacetek,
      konec: izmeneTable.konec,
    })
    .from(izmeneTable)
    .innerJoin(enoteTable, eq(izmeneTable.enotaId, enoteTable.id))
    .innerJoin(natakariTable, eq(izmeneTable.natakariId, natakariTable.id))
    .leftJoin(
      costCentersTable,
      and(
        eq(izmeneTable.costCenterId, costCentersTable.id),
        eq(costCentersTable.companyId, context.companyId),
      ),
    )
    .where(and(...conditions))
    .orderBy(izmeneTable.zacetek);

  const vrstice: ObracunUrVrstica[] = rows.flatMap((row) => {
    const costCenterId = row.costCenterId ?? null;
    // Stare izmene nimajo še besedilnega snapshot-a; zanje obdržimo varen
    // fallback na obstoječi šifrant. Nove izmene so neodvisne od njega.
    const smKoda = row.snapshotSmKoda ?? row.trenutnaSmKoda ?? null;
    const snapshotSmNaziv = row.snapshotSmNaziv ?? row.trenutnoSmNaziv ?? null;
    const smNaziv = costCenterId === null
      ? "Brez SM"
      : (snapshotSmNaziv ?? "Neznano SM");
    return splitShiftByLjubljanaCalendarDays(
      row.zacetek,
      row.konec!,
      odDatum,
      doDatum,
    ).map((segment) => ({
      izmenaId: row.id,
      natakariId: row.natakariId,
      natakar: `${row.natakarIme} ${row.natakarPriimek}`.trim(),
      enotaId: row.enotaId,
      enota: row.enotaIme,
      costCenterId,
      smKoda: costCenterId === null ? null : smKoda,
      smNaziv,
      datum: segment.datum,
      zacetek: segment.zacetek.toISOString(),
      konec: segment.konec.toISOString(),
      ureTrajanja: segment.ureTrajanja,
    }));
  });

  const skupineMap = new Map<string, ObracunUrSkupina>();
  const poSmMap = new Map<string, {
    costCenterId: string | null;
    sm: string;
    smKoda: string | null;
    smNaziv: string;
    ur: number;
    steviloIzmen: number;
    izmenaIds: Set<number>;
  }>();
  const skupinaIzmene = new Map<string, Set<number>>();

  for (const vrstica of vrstice) {
    const groupKey = `${vrstica.natakariId}|${vrstica.enotaId}|${costCenterSnapshotKey(vrstica)}`;
    const existing = skupineMap.get(groupKey);
    if (existing) {
      existing.skupajUr = roundHours(existing.skupajUr + vrstica.ureTrajanja);
      const ids = skupinaIzmene.get(groupKey)!;
      ids.add(vrstica.izmenaId);
      existing.steviloIzmen = ids.size;
    } else {
      skupinaIzmene.set(groupKey, new Set([vrstica.izmenaId]));
      skupineMap.set(groupKey, {
        natakariId: vrstica.natakariId,
        natakar: vrstica.natakar,
        enotaId: vrstica.enotaId,
        enota: vrstica.enota,
        costCenterId: vrstica.costCenterId,
        smKoda: vrstica.smKoda,
        smNaziv: vrstica.smNaziv,
        steviloIzmen: 1,
        skupajUr: vrstica.ureTrajanja,
      });
    }

    const smKey = costCenterSnapshotKey(vrstica);
    const sm = vrstica.smKoda ? `${vrstica.smKoda} — ${vrstica.smNaziv}` : vrstica.smNaziv;
    const existingSm = poSmMap.get(smKey);
    if (existingSm) {
      existingSm.ur = roundHours(existingSm.ur + vrstica.ureTrajanja);
      existingSm.izmenaIds.add(vrstica.izmenaId);
      existingSm.steviloIzmen = existingSm.izmenaIds.size;
    } else {
      poSmMap.set(smKey, {
        costCenterId: vrstica.costCenterId,
        sm,
        smKoda: vrstica.smKoda,
        smNaziv: vrstica.smNaziv,
        ur: vrstica.ureTrajanja,
        steviloIzmen: 1,
        izmenaIds: new Set([vrstica.izmenaId]),
      });
    }
  }

  const response = {
    skupine: [...skupineMap.values()],
    vrstice,
    skupajUr: roundHours(vrstice.reduce((sumHours, vrstica) => sumHours + vrstica.ureTrajanja, 0)),
    poSM: [...poSmMap.values()].map(({ izmenaIds: _izmenaIds, ...item }) => item),
  };
  res.json(obracunUrResponseSchema.parse(response));
}

router.get("/izmene/obracun-ur", getObracunUrHandler);

const KADROVSKI_ADMIN_VLOGE = new Set(["admin", "admin_enote", "superadmin", "erp_owner", "erp_accountant"]);
const ISO_DATE_TIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,3})?)?(?:Z|[+-]\d{2}:\d{2})$/;
const ISO_DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

function isKadrovskiAdmin(req: Request): boolean {
  return KADROVSKI_ADMIN_VLOGE.has((req as PosRequest).vloga);
}

function parseDateTime(value: unknown): Date | null {
  if (typeof value !== "string" || !ISO_DATE_TIME.test(value)) return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function parseDateOnly(value: unknown): string | null {
  if (typeof value !== "string" || !ISO_DATE_ONLY.test(value)) return null;
  const parsed = new Date(`${value}T12:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value ? null : value;
}

function overlapHours(start: Date, end: Date, otherStart: Date, otherEnd: Date): number {
  const from = Math.max(start.getTime(), otherStart.getTime());
  const to = Math.min(end.getTime(), otherEnd.getTime());
  return from < to ? (to - from) / 3_600_000 : 0;
}

function round2(value: number): number {
  return Number(value.toFixed(2));
}

type KadrovskiBreak = {
  id: number;
  vrsta: "placan" | "neplacan";
  zacetek: Date;
  konec: Date | null;
};

export function calculateKadrovskeUre(
  zacetek: Date,
  konec: Date,
  odmori: KadrovskiBreak[],
): { brutoUr: number; neplacaniOdmoriUr: number; placaniOdmoriUr: number; efektivneUr: number; nadure: number } {
  let brutoUr = 0;
  let neplacaniOdmoriUr = 0;
  let placaniOdmoriUr = 0;
  let nadure = 0;

  for (const segment of splitShiftByLjubljanaCalendarDays(zacetek, konec, "2000-01-01", "2100-01-01")) {
    const segmentBruto = (segment.konec.getTime() - segment.zacetek.getTime()) / 3_600_000;
    const segmentBreaks = odmori.filter((odmor) => odmor.konec && odmor.zacetek < segment.konec && odmor.konec > segment.zacetek);
    const segmentNeplacani = segmentBreaks
      .filter((odmor) => odmor.vrsta === "neplacan")
      .reduce((total, odmor) => total + overlapHours(segment.zacetek, segment.konec, odmor.zacetek, odmor.konec!), 0);
    const segmentPlacani = segmentBreaks
      .filter((odmor) => odmor.vrsta === "placan")
      .reduce((total, odmor) => total + overlapHours(segment.zacetek, segment.konec, odmor.zacetek, odmor.konec!), 0);
    const effective = Math.max(0, segmentBruto - segmentNeplacani);
    brutoUr += segmentBruto;
    neplacaniOdmoriUr += segmentNeplacani;
    placaniOdmoriUr += segmentPlacani;
    nadure += Math.max(0, effective - 8);
  }

  return {
    brutoUr: round2(brutoUr),
    neplacaniOdmoriUr: round2(neplacaniOdmoriUr),
    placaniOdmoriUr: round2(placaniOdmoriUr),
    efektivneUr: round2(Math.max(0, brutoUr - neplacaniOdmoriUr)),
    nadure: round2(nadure),
  };
}

// Namerno append-only: poprave se nikoli ne izgubijo, tudi če se izmena
// kasneje popravi še enkrat.
async function writeKadrovskiAudit(
  tx: any,
  context: PosRequest,
  data: {
    enotaId: number;
    entiteta: string;
    entitetaId: string | number;
    dejanje: string;
    razlog?: string | null;
    pred?: unknown;
    po?: unknown;
  },
): Promise<void> {
  await tx.insert(kadrovskiAuditTable).values({
    companyId: context.companyId,
    enotaId: data.enotaId,
    entiteta: data.entiteta,
    entitetaId: String(data.entitetaId),
    dejanje: data.dejanje,
    razlog: data.razlog ?? null,
    actorId: context.clerkUserId || "system",
    pred: data.pred ?? null,
    po: data.po ?? null,
  });
}

async function getBreaksForShifts(shiftIds: number[]): Promise<Map<number, KadrovskiBreak[]>> {
  const result = new Map<number, KadrovskiBreak[]>();
  if (shiftIds.length === 0) return result;
  const rows = await db.select({
    id: odmoriTable.id,
    izmenaId: odmoriTable.izmenaId,
    vrsta: odmoriTable.vrsta,
    zacetek: odmoriTable.zacetek,
    konec: odmoriTable.konec,
  }).from(odmoriTable).where(inArray(odmoriTable.izmenaId, shiftIds)).orderBy(odmoriTable.zacetek);
  for (const row of rows) {
    const breaks = result.get(row.izmenaId) ?? [];
    breaks.push(row);
    result.set(row.izmenaId, breaks);
  }
  return result;
}

async function getOdsotnostResponse(id: string, context: PosRequest) {
  const [row] = await db.select({
    id: odsotnostiTable.id,
    natakariId: odsotnostiTable.natakariId,
    natakarIme: natakariTable.ime,
    natakarPriimek: natakariTable.priimek,
    od: odsotnostiTable.od,
    do: odsotnostiTable.do,
    tip: odsotnostiTable.tip,
    opomba: odsotnostiTable.opomba,
    status: odsotnostiTable.status,
    createdBy: odsotnostiTable.createdBy,
    potrjenoBy: odsotnostiTable.potrjenoBy,
    potrjenoAt: odsotnostiTable.potrjenoAt,
    createdAt: odsotnostiTable.createdAt,
  }).from(odsotnostiTable)
    .innerJoin(natakariTable, eq(odsotnostiTable.natakariId, natakariTable.id))
    .where(and(
      eq(odsotnostiTable.id, id),
      eq(odsotnostiTable.companyId, context.companyId),
      eq(odsotnostiTable.enotaId, context.enotaId),
    ))
    .limit(1);
  return row ? {
    id: row.id,
    natakariId: row.natakariId,
    natakar: `${row.natakarIme} ${row.natakarPriimek}`.trim(),
    od: row.od,
    do: row.do,
    tip: row.tip,
    opomba: row.opomba,
    status: row.status,
    createdBy: row.createdBy,
    potrjenoBy: row.potrjenoBy,
    potrjenoAt: row.potrjenoAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  } : null;
}

const kadrovskiPregledQuerySchema = z.object({
  od: z.string(),
  do: z.string(),
  enotaId: z.coerce.number().int().positive().optional(),
  natakariId: z.coerce.number().int().positive().optional(),
});

/**
 * Kadrovski pregled je namerno ločen od starega obračuna ur: poleg bruto ur
 * prikaže še odmore, efektivne ure, nadure, status potrditve in napitnine,
 * vezane na račune iz iste izmene.
 */
router.get("/izmene/kadrovski-pregled", async (req, res): Promise<void> => {
  const context = req as PosRequest;
  if (!isKadrovskiAdmin(req)) {
    res.status(403).json({ error: "Kadrovski pregled je dostopen samo administratorjem." });
    return;
  }
  const parsed = kadrovskiPregledQuerySchema.safeParse(req.query);
  const od = parsed.success ? parseDateOnly(parsed.data.od) : null;
  const doDatum = parsed.success ? parseDateOnly(parsed.data.do) : null;
  if (!parsed.success || !od || !doDatum || od > doDatum) {
    res.status(400).json({ error: "Obdobje mora biti v formatu YYYY-MM-DD." });
    return;
  }
  const targetEnotaId = context.vloga === "admin_enote"
    ? context.enotaId
    : parsed.data.enotaId;

  const rows = await db
    .select({
      id: izmeneTable.id,
      natakariId: izmeneTable.natakariId,
      natakarIme: natakariTable.ime,
      natakarPriimek: natakariTable.priimek,
      enotaId: izmeneTable.enotaId,
      enotaIme: enoteTable.ime,
      zacetek: izmeneTable.zacetek,
      konec: izmeneTable.konec,
      status: izmeneTable.status,
      potrjenoBy: izmeneTable.potrjenoBy,
      potrjenoAt: izmeneTable.potrjenoAt,
      zavrnitevRazlog: izmeneTable.zavrnitevRazlog,
    })
    .from(izmeneTable)
    .innerJoin(enoteTable, eq(izmeneTable.enotaId, enoteTable.id))
    .innerJoin(natakariTable, eq(izmeneTable.natakariId, natakariTable.id))
    .where(and(
      eq(enoteTable.companyId, context.companyId),
      lt(izmeneTable.zacetek, ljubljanaMidnight(nextCalendarDate(doDatum))),
      or(isNull(izmeneTable.konec), gt(izmeneTable.konec, ljubljanaMidnight(od))),
      ...(targetEnotaId ? [eq(izmeneTable.enotaId, targetEnotaId)] : []),
      ...(parsed.data.natakariId ? [eq(izmeneTable.natakariId, parsed.data.natakariId)] : []),
    ))
    .orderBy(desc(izmeneTable.zacetek));

  const shiftIds = rows.map((row) => row.id);
  const breaksByShift = await getBreaksForShifts(shiftIds);
  const tipsByShift = new Map<number, { bruto: number; neto: number }>();
  if (shiftIds.length > 0) {
    const tipRows = await db.select({
      izmenaId: racuniTable.izmenaId,
      bruto: sum(tipAllocationsTable.grossAmount),
      neto: sum(tipAllocationsTable.netAmount),
    }).from(racuniTable)
      .innerJoin(tipAllocationsTable, eq(tipAllocationsTable.racunId, racuniTable.id))
      .where(inArray(racuniTable.izmenaId, shiftIds))
      .groupBy(racuniTable.izmenaId);
    for (const row of tipRows) {
      if (row.izmenaId != null) tipsByShift.set(row.izmenaId, {
        bruto: Number(row.bruto ?? 0),
        neto: Number(row.neto ?? 0),
      });
    }
  }

  res.json(rows.map((row) => {
    const breaks = breaksByShift.get(row.id) ?? [];
    const ure = row.konec ? calculateKadrovskeUre(row.zacetek, row.konec, breaks) : {
      brutoUr: 0, neplacaniOdmoriUr: 0, placaniOdmoriUr: 0, efektivneUr: 0, nadure: 0,
    };
    const tips = tipsByShift.get(row.id) ?? { bruto: 0, neto: 0 };
    return {
      izmenaId: row.id,
      natakariId: row.natakariId,
      natakar: `${row.natakarIme} ${row.natakarPriimek}`.trim(),
      enotaId: row.enotaId,
      enota: row.enotaIme,
      zacetek: row.zacetek.toISOString(),
      konec: row.konec?.toISOString() ?? null,
      ...ure,
      steviloOdmorov: breaks.length,
      napitnineBruto: round2(tips.bruto),
      napitnineNeto: round2(tips.neto),
      napitninaNaEfektivnoUro: ure.efektivneUr > 0 ? round2(tips.neto / ure.efektivneUr) : 0,
      status: row.status,
      potrjenoBy: row.potrjenoBy,
      potrjenoAt: row.potrjenoAt?.toISOString() ?? null,
      zavrnitevRazlog: row.zavrnitevRazlog,
    };
  }));
});

router.get("/izmene/:id/odmori", async (req, res): Promise<void> => {
  const context = req as unknown as PosRequest;
  const id = Number(req.params.id);
  if (!Number.isInteger(id)) { res.status(400).json({ error: "Neveljaven ID izmene." }); return; }
  const shift = await getWithNatakar(id, context.enotaId);
  if (!shift) { res.status(404).json({ error: "Izmena ni najdena." }); return; }
  const rows = await db.select().from(odmoriTable)
    .where(eq(odmoriTable.izmenaId, id)).orderBy(desc(odmoriTable.zacetek));
  res.json(rows.map((row) => ({
    id: row.id,
    izmenaId: row.izmenaId,
    vrsta: row.vrsta,
    zacetek: row.zacetek.toISOString(),
    konec: row.konec?.toISOString() ?? null,
    trajanjeUr: row.konec ? round2((row.konec.getTime() - row.zacetek.getTime()) / 3_600_000) : null,
    opomba: row.opomba,
    createdBy: row.createdBy,
    createdAt: row.createdAt.toISOString(),
  })));
});

router.post("/izmene/:id/odmori", async (req, res): Promise<void> => {
  const context = req as unknown as PosRequest;
  const id = Number(req.params.id);
  const shift = Number.isInteger(id) ? await getWithNatakar(id, context.enotaId) : null;
  if (!shift) { res.status(404).json({ error: "Izmena ni najdena." }); return; }
  const isOwner = context.posActorNatakarId === shift.natakariId || (await db
    .select({ id: natakariTable.id }).from(natakariTable)
    .where(and(eq(natakariTable.id, shift.natakariId), eq(natakariTable.clerkUserId, context.clerkUserId))).limit(1)).length > 0;
  if (!isKadrovskiAdmin(req) && !isOwner) { res.status(403).json({ error: "Odmor lahko vnese samo zaposleni ali administrator." }); return; }

  const body = req.body as { vrsta?: string; zacetek?: string; konec?: string | null; opomba?: string | null };
  const vrsta = body.vrsta === "placan" ? "placan" : body.vrsta === "neplacan" || body.vrsta == null ? "neplacan" : null;
  const zacetek = body.zacetek ? parseDateTime(body.zacetek) : await getSimDatumOrNow(context.enotaId);
  const konec = body.konec ? parseDateTime(body.konec) : null;
  if (!vrsta || !zacetek || (body.konec && !konec)) { res.status(400).json({ error: "Vrsta in veljaven začetek odmora sta obvezna." }); return; }
  const shiftKonec = shift.konec;
  if (zacetek < shift.zacetek || (shiftKonec && zacetek > shiftKonec) || (konec && (konec <= zacetek || (shiftKonec && konec > shiftKonec)))) {
    res.status(400).json({ error: "Odmor mora biti znotraj izmene." }); return;
  }
  const openBreak = await db.select({ id: odmoriTable.id }).from(odmoriTable)
    .where(and(eq(odmoriTable.izmenaId, id), isNull(odmoriTable.konec))).limit(1);
  if (openBreak.length > 0 && !konec) { res.status(409).json({ error: "Izmena ima že odprt odmor." }); return; }

  const [created] = await db.transaction(async (tx) => {
    const [row] = await tx.insert(odmoriTable).values({
      izmenaId: id,
      vrsta,
      zacetek,
      konec,
      opomba: typeof body.opomba === "string" ? body.opomba.trim() || null : null,
      createdBy: context.clerkUserId,
    }).returning();
    await writeKadrovskiAudit(tx, context, {
      enotaId: context.enotaId, entiteta: "izmena", entitetaId: id, dejanje: konec ? "odmor_vnesen" : "odmor_odprt",
      po: { odmorId: row!.id, vrsta, zacetek: zacetek.toISOString(), konec: konec?.toISOString() ?? null },
    });
    return [row];
  });
  res.status(201).json({
    id: created!.id, izmenaId: created!.izmenaId, vrsta: created!.vrsta,
    zacetek: created!.zacetek.toISOString(), konec: created!.konec?.toISOString() ?? null,
    trajanjeUr: created!.konec ? round2((created!.konec.getTime() - created!.zacetek.getTime()) / 3_600_000) : null,
    opomba: created!.opomba, createdBy: created!.createdBy, createdAt: created!.createdAt.toISOString(),
  });
  broadcastToUnit(context.enotaId, "update", { type: "izmene", enotaId: context.enotaId });
});

router.post("/izmene/:id/odmori/:odmorId/zapri", async (req, res): Promise<void> => {
  const context = req as unknown as PosRequest;
  const id = Number(req.params.id);
  const odmorId = Number(req.params.odmorId);
  const shift = Number.isInteger(id) ? await getWithNatakar(id, context.enotaId) : null;
  if (!shift || !Number.isInteger(odmorId)) { res.status(404).json({ error: "Odmor ni najden." }); return; }
  const isOwner = context.posActorNatakarId === shift.natakariId || (await db
    .select({ id: natakariTable.id }).from(natakariTable)
    .where(and(eq(natakariTable.id, shift.natakariId), eq(natakariTable.clerkUserId, context.clerkUserId))).limit(1)).length > 0;
  if (!isKadrovskiAdmin(req) && !isOwner) { res.status(403).json({ error: "Odmor lahko zapre samo zaposleni ali administrator." }); return; }
  const [odmor] = await db.select().from(odmoriTable)
    .where(and(eq(odmoriTable.id, odmorId), eq(odmoriTable.izmenaId, id))).limit(1);
  if (!odmor) { res.status(404).json({ error: "Odmor ni najden." }); return; }
  if (odmor.konec) { res.status(400).json({ error: "Odmor je že zaprt." }); return; }
  const konec = await getSimDatumOrNow(context.enotaId);
  if (konec <= odmor.zacetek || (shift.konec && konec > shift.konec)) { res.status(400).json({ error: "Konec odmora ni veljaven." }); return; }
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx.update(odmoriTable).set({ konec, updatedAt: new Date() })
      .where(and(eq(odmoriTable.id, odmorId), isNull(odmoriTable.konec))).returning();
    await writeKadrovskiAudit(tx, context, {
      enotaId: context.enotaId, entiteta: "izmena", entitetaId: id, dejanje: "odmor_zaprt",
      pred: { odmorId, konec: null }, po: { odmorId, konec: konec.toISOString() },
    });
    return [row];
  });
  res.json({ id: updated!.id, izmenaId: updated!.izmenaId, vrsta: updated!.vrsta, zacetek: updated!.zacetek.toISOString(), konec: updated!.konec!.toISOString(), trajanjeUr: round2((updated!.konec!.getTime() - updated!.zacetek.getTime()) / 3_600_000), opomba: updated!.opomba, createdBy: updated!.createdBy, createdAt: updated!.createdAt.toISOString() });
  broadcastToUnit(context.enotaId, "update", { type: "izmene", enotaId: context.enotaId });
});

router.post("/izmene/:id/predlozi", async (req, res): Promise<void> => {
  const context = req as unknown as PosRequest;
  const id = Number(req.params.id);
  const shift = Number.isInteger(id) ? await getWithNatakar(id, context.enotaId) : null;
  if (!shift) { res.status(404).json({ error: "Izmena ni najdena." }); return; }
  if (!shift.konec) { res.status(400).json({ error: "Odprte izmene ni mogoče predložiti v potrditev." }); return; }
  const isOwner = context.posActorNatakarId === shift.natakariId || (await db
    .select({ id: natakariTable.id }).from(natakariTable)
    .where(and(eq(natakariTable.id, shift.natakariId), eq(natakariTable.clerkUserId, context.clerkUserId))).limit(1)).length > 0;
  if (!isKadrovskiAdmin(req) && !isOwner) { res.status(403).json({ error: "Predložitev lahko izvede zaposleni." }); return; }
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx.update(izmeneTable).set({ status: "v_potrditvi", zavrnitevRazlog: null })
      .where(and(eq(izmeneTable.id, id), eq(izmeneTable.enotaId, context.enotaId))).returning();
    await writeKadrovskiAudit(tx, context, { enotaId: context.enotaId, entiteta: "izmena", entitetaId: id, dejanje: "predlozitev_v_potrditev", po: { status: "v_potrditvi" } });
    return [row];
  });
  res.json(rowToObj((await baseQuery().where(eq(izmeneTable.id, updated!.id)))[0]!));
});

router.post("/izmene/:id/potrdi", async (req, res): Promise<void> => {
  const context = req as unknown as PosRequest;
  if (!isKadrovskiAdmin(req)) { res.status(403).json({ error: "Potrjevanje ur je dovoljeno samo administratorju." }); return; }
  const id = Number(req.params.id);
  const shift = Number.isInteger(id) ? await getWithNatakar(id, context.enotaId) : null;
  if (!shift) { res.status(404).json({ error: "Izmena ni najdena." }); return; }
  const body = req.body as { status?: string; razlog?: string };
  if (body.status !== "potrjeno" && body.status !== "zavrnjeno") { res.status(400).json({ error: "Status mora biti potrjeno ali zavrnjeno." }); return; }
  const razlog = typeof body.razlog === "string" ? body.razlog.trim() : "";
  if (body.status === "zavrnjeno" && razlog.length < 3) { res.status(400).json({ error: "Pri zavrnitvi je razlog obvezen." }); return; }
  const potrjenoAt = new Date();
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx.update(izmeneTable).set({
      status: body.status as "potrjeno" | "zavrnjeno",
      potrjenoBy: context.clerkUserId,
      potrjenoAt,
      zavrnitevRazlog: body.status === "zavrnjeno" ? razlog : null,
    }).where(eq(izmeneTable.id, id)).returning();
    await writeKadrovskiAudit(tx, context, {
      enotaId: context.enotaId, entiteta: "izmena", entitetaId: id,
      dejanje: body.status === "potrjeno" ? "ure_potrjene" : "ure_zavrnjene", razlog: razlog || null,
      pred: { status: shift.status }, po: { status: body.status },
    });
    return [row];
  });
  res.json(rowToObj((await baseQuery().where(eq(izmeneTable.id, updated!.id)))[0]!));
});

router.patch("/izmene/:id/popravek", async (req, res): Promise<void> => {
  const context = req as unknown as PosRequest;
  if (!isKadrovskiAdmin(req)) { res.status(403).json({ error: "Poprave ur so dovoljene samo administratorju." }); return; }
  const id = Number(req.params.id);
  const shift = Number.isInteger(id) ? await getWithNatakar(id, context.enotaId) : null;
  if (!shift) { res.status(404).json({ error: "Izmena ni najdena." }); return; }
  if (!shift.konec) { res.status(400).json({ error: "Popravljati je mogoče samo zaprto izmeno." }); return; }
  const body = req.body as { zacetek?: string; konec?: string; razlog?: string };
  const zacetek = parseDateTime(body.zacetek);
  const konec = parseDateTime(body.konec);
  const razlog = typeof body.razlog === "string" ? body.razlog.trim() : "";
  if (!zacetek || !konec || konec <= zacetek || razlog.length < 3) {
    res.status(400).json({ error: "Za popravek sta potrebna veljavna začetka/konec in razlog." }); return;
  }
  const existingBreaks = await db.select({ zacetek: odmoriTable.zacetek, konec: odmoriTable.konec })
    .from(odmoriTable).where(eq(odmoriTable.izmenaId, id));
  if (existingBreaks.some((odmor) => odmor.zacetek < zacetek || !odmor.konec || odmor.konec > konec)) {
    res.status(400).json({ error: "Popravljeni čas mora še vedno vsebovati vse zaključene odmore izmene." });
    return;
  }
  const [updated] = await db.transaction(async (tx) => {
    const [correction] = await tx.insert(izmenaPopravkiTable).values({
      izmenaId: id, starZacetek: shift.zacetek, starKonec: shift.konec,
      novZacetek: zacetek, novKonec: konec, razlog, createdBy: context.clerkUserId,
    }).returning();
    const [row] = await tx.update(izmeneTable).set({
      zacetek, konec, status: "osnutek", potrjenoBy: null, potrjenoAt: null, zavrnitevRazlog: null,
    }).where(eq(izmeneTable.id, id)).returning();
    await writeKadrovskiAudit(tx, context, {
      enotaId: context.enotaId, entiteta: "izmena", entitetaId: id, dejanje: "ura_popravljena", razlog,
      pred: { zacetek: shift.zacetek.toISOString(), konec: shift.konec!.toISOString() },
      po: { zacetek: zacetek.toISOString(), konec: konec.toISOString(), popravekId: correction!.id },
    });
    return [row];
  });
  res.json(rowToObj((await baseQuery().where(eq(izmeneTable.id, updated!.id)))[0]!));
});

router.get("/izmene/:id/audit", async (req, res): Promise<void> => {
  const context = req as unknown as PosRequest;
  const id = Number(req.params.id);
  const shift = Number.isInteger(id) ? await getWithNatakar(id, context.enotaId) : null;
  if (!shift) { res.status(404).json({ error: "Izmena ni najdena." }); return; }
  const rows = await db.select().from(kadrovskiAuditTable).where(and(
    eq(kadrovskiAuditTable.companyId, context.companyId),
    eq(kadrovskiAuditTable.enotaId, context.enotaId),
    eq(kadrovskiAuditTable.entiteta, "izmena"),
    eq(kadrovskiAuditTable.entitetaId, String(id)),
  )).orderBy(desc(kadrovskiAuditTable.createdAt));
  res.json(rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })));
});

router.get("/odsotnosti", async (req, res): Promise<void> => {
  const context = req as PosRequest;
  const od = parseDateOnly(req.query.od);
  const doDatum = parseDateOnly(req.query.do);
  if (!od || !doDatum || od > doDatum) { res.status(400).json({ error: "Obdobje odsotnosti ni veljavno." }); return; }
  const rows = await db.select({
    id: odsotnostiTable.id, natakariId: odsotnostiTable.natakariId,
    natakarIme: natakariTable.ime, natakarPriimek: natakariTable.priimek,
    od: odsotnostiTable.od, do: odsotnostiTable.do, tip: odsotnostiTable.tip,
    opomba: odsotnostiTable.opomba, status: odsotnostiTable.status,
    createdBy: odsotnostiTable.createdBy, potrjenoBy: odsotnostiTable.potrjenoBy,
    potrjenoAt: odsotnostiTable.potrjenoAt, createdAt: odsotnostiTable.createdAt,
  }).from(odsotnostiTable).innerJoin(natakariTable, eq(odsotnostiTable.natakariId, natakariTable.id))
    .where(and(
      eq(odsotnostiTable.companyId, context.companyId),
      ...(context.vloga === "admin_enote" ? [eq(odsotnostiTable.enotaId, context.enotaId)] : []),
      lte(odsotnostiTable.od, doDatum),
      gte(odsotnostiTable.do, od),
    ))
    .orderBy(desc(odsotnostiTable.od));
  res.json(rows.map((row) => ({ ...row, natakar: `${row.natakarIme} ${row.natakarPriimek}`.trim(), potrjenoAt: row.potrjenoAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() })));
});

router.post("/odsotnosti", async (req, res): Promise<void> => {
  const context = req as PosRequest;
  if (!isKadrovskiAdmin(req)) { res.status(403).json({ error: "Odsotnosti lahko vnese samo administrator." }); return; }
  const body = req.body as { natakariId?: number; od?: string; do?: string; tip?: string; opomba?: string };
  const od = parseDateOnly(body.od);
  const doDatum = parseDateOnly(body.do);
  if (!Number.isInteger(body.natakariId) || !od || !doDatum || od > doDatum || !["dopust", "bolniska", "druga_odsotnost"].includes(body.tip ?? "")) {
    res.status(400).json({ error: "Natakar, obdobje in tip odsotnosti so obvezni." }); return;
  }
  const [natakar] = await db.select({ id: natakariTable.id }).from(natakariTable)
    .where(and(eq(natakariTable.id, body.natakariId!), eq(natakariTable.companyId, context.companyId))).limit(1);
  if (!natakar) { res.status(404).json({ error: "Natakar ni najden." }); return; }
  const [created] = await db.transaction(async (tx) => {
    const [row] = await tx.insert(odsotnostiTable).values({
      companyId: context.companyId, enotaId: context.enotaId, natakariId: body.natakariId!,
      od, do: doDatum, tip: body.tip as "dopust" | "bolniska" | "druga_odsotnost",
      opomba: body.opomba?.trim() || null, createdBy: context.clerkUserId,
    }).returning();
    await writeKadrovskiAudit(tx, context, { enotaId: context.enotaId, entiteta: "odsotnost", entitetaId: row!.id, dejanje: "vnos", po: { od, do: doDatum, tip: body.tip } });
    return [row];
  });
  const response = await getOdsotnostResponse(created!.id, context);
  res.status(201).json(response);
});

router.post("/odsotnosti/:id/potrdi", async (req, res): Promise<void> => {
  const context = req as unknown as PosRequest;
  if (!isKadrovskiAdmin(req)) { res.status(403).json({ error: "Potrjevanje odsotnosti je dovoljeno samo administratorju." }); return; }
  const id = String(req.params.id);
  const status = (req.body as { status?: string }).status;
  if (status !== "potrjeno" && status !== "zavrnjeno") { res.status(400).json({ error: "Status mora biti potrjeno ali zavrnjeno." }); return; }
  const [existing] = await db.select().from(odsotnostiTable).where(and(eq(odsotnostiTable.id, id), eq(odsotnostiTable.enotaId, context.enotaId))).limit(1);
  if (!existing) { res.status(404).json({ error: "Odsotnost ni najdena." }); return; }
  const [updated] = await db.transaction(async (tx) => {
    const [row] = await tx.update(odsotnostiTable).set({ status: status as "potrjeno" | "zavrnjeno", potrjenoBy: context.clerkUserId, potrjenoAt: new Date() }).where(eq(odsotnostiTable.id, id)).returning();
    await writeKadrovskiAudit(tx, context, { enotaId: context.enotaId, entiteta: "odsotnost", entitetaId: id, dejanje: status === "potrjeno" ? "odsotnost_potrjena" : "odsotnost_zavrnjena", pred: { status: existing.status }, po: { status } });
    return [row];
  });
  const response = await getOdsotnostResponse(updated!.id, context);
  res.json(response);
});

router.post("/izmene", async (req, res): Promise<void> => {
  const context = req as unknown as PosRequest;
  const enotaId = context.enotaId;
  const companyId = context.companyId;
  const {
    natakariId: requestedNatakariId,
    blagajnaId,
    mojaIzmena,
    aktivirajNatakarja,
    pin,
  } = req.body as {
    natakariId?: number;
    blagajnaId?: number | null;
    mojaIzmena?: boolean;
    aktivirajNatakarja?: boolean;
    pin?: string;
  };
  if (mojaIzmena && !context.posActorNatakarId) {
    res.status(401).json({ error: "Za odprtje lastne izmene je potrebna veljavna POS actor seja." });
    return;
  }
  const natakariId = mojaIzmena ? context.posActorNatakarId : requestedNatakariId;
  if (!natakariId) { res.status(400).json({ error: "natakariId je obvezen" }); return; }

  // Natakarji so na nivoju podjetja — preverimo companyId, ne enotaId
  const [natakar] = await db
    .select()
    .from(natakariTable)
    .where(and(eq(natakariTable.id, natakariId), eq(natakariTable.companyId, companyId)));
  if (!natakar) { res.status(404).json({ error: "Natakar ni najden" }); return; }
  if (!natakar.aktiven) { res.status(400).json({ error: "Natakar ni aktiven" }); return; }
  const shouldActivateActor = aktivirajNatakarja === true;
  if (shouldActivateActor && (typeof pin !== "string" || !/^\d{4,12}$/.test(pin))) {
    res.status(400).json({ error: "Za odprtje izmene vnesite osebni PIN natakarja." });
    return;
  }
  if (shouldActivateActor && natakar.posPinLockedUntil && natakar.posPinLockedUntil.getTime() > Date.now()) {
    res.status(423).json({ error: "PIN je začasno zaklenjen." });
    return;
  }
  if (shouldActivateActor && (!natakar.posPinHash || !verifyPosPin(pin!, natakar.posPinHash))) {
    const failures = natakar.posPinFailedAttempts + 1;
    const lockedUntil = failures >= POS_PIN_MAX_FAILURES
      ? new Date(Date.now() + POS_PIN_LOCK_MS)
      : null;
    await db.transaction(async tx => {
      await tx.update(natakariTable)
        .set({ posPinFailedAttempts: failures, posPinLockedUntil: lockedUntil })
        .where(eq(natakariTable.id, natakariId));
      await writePosActorAudit(query => tx.execute(query), {
        enotaId,
        natakarId: natakariId,
        actorClerkUserId: context.clerkUserId,
        action: "switch_failed",
        metadata: { source: "shift_open", failures },
      });
    });
    res.status(401).json({ error: lockedUntil ? "PIN je začasno zaklenjen." : "PIN ni veljaven." });
    return;
  }
  const actorSecret = shouldActivateActor ? getPosActorSessionSecret() : null;
  if (shouldActivateActor && !actorSecret) {
    res.status(503).json({ error: "POS actor session ni konfiguriran." });
    return;
  }

  // Preveri blagajno — mora biti iz iste enote
  let resolvedBlagajnaId: number | null = blagajnaId ?? null;
  if (resolvedBlagajnaId) {
    const [blagajna] = await db
      .select({ id: blagajneTable.id })
      .from(blagajneTable)
      .where(and(eq(blagajneTable.id, resolvedBlagajnaId), eq(blagajneTable.enotaId, enotaId)));
    if (!blagajna) resolvedBlagajnaId = null; // ne pripada tej enoti — ignoriramo
  }

  // Izmena je vezana na enoto (za dnevne izkaze) — natakar pa je dostopen iz katere koli enote
  const [existing] = await db
    .select()
    .from(izmeneTable)
    .where(and(eq(izmeneTable.natakariId, natakariId), eq(izmeneTable.enotaId, enotaId)));
  const hasOpen = existing && !existing.konec;
  if (hasOpen) { res.status(409).json({ error: "Natakar ima že odprto izmeno v tej enoti" }); return; }

  const output = await db.transaction(async (tx) => {
    await lockPosBusinessDay(tx, enotaId);
    const zacetek = await getSimDatumOrNow(enotaId);
    const businessDate = await getCurrentPosBusinessDate(enotaId, zacetek, tx);
    if (await isPosBusinessDayClosed(tx, enotaId, businessDate)) {
      return { status: "current-day-closed" as const, businessDate };
    }
    const previousDayGate = await checkPreviousBusinessDayClosed(tx, enotaId, businessDate);
    if (!previousDayGate.allowed) {
      return { status: "previous-day-open" as const, ...previousDayGate };
    }
    // Snapshot mora nastati v isti transakciji kot nova izmena, da kasnejša
    // sprememba enote ne spremeni zgodovinskega stroškovnega mesta izmene.
    const [enota] = await tx
      .select({
        costCenterId: enoteTable.costCenterId,
        costCenterCode: costCentersTable.code,
        costCenterName: costCentersTable.name,
      })
      .from(enoteTable)
      .leftJoin(
        costCentersTable,
        and(
          eq(enoteTable.costCenterId, costCentersTable.id),
          eq(costCentersTable.companyId, companyId),
        ),
      )
      .where(eq(enoteTable.id, enotaId))
      .limit(1);
    const costCenterId = enota?.costCenterId ?? null;
    const [inserted] = await tx
      .insert(izmeneTable)
      .values({
        enotaId,
        natakariId,
        blagajnaId: resolvedBlagajnaId,
        costCenterId,
        costCenterCode: costCenterId ? (enota?.costCenterCode ?? null) : null,
        costCenterName: costCenterId ? (enota?.costCenterName ?? null) : null,
        skupajZnesek: "0",
        steviloRacunov: 0,
        zacetek,
      })
      .returning();

    await writeKadrovskiAudit(tx, context, {
      enotaId,
      entiteta: "izmena",
      entitetaId: inserted!.id,
      dejanje: "izmena_odprta",
      po: { natakariId, zacetek: zacetek.toISOString(), blagajnaId: resolvedBlagajnaId },
    });
    if (shouldActivateActor) {
      await tx.update(natakariTable)
        .set({ posPinFailedAttempts: 0, posPinLockedUntil: null })
        .where(eq(natakariTable.id, natakariId));
      await writePosActorAudit(query => tx.execute(query), {
        enotaId,
        natakarId: natakariId,
        actorClerkUserId: context.clerkUserId,
        action: "switch",
        metadata: { source: "own_shift_open" },
      });
    }

    return {
      status: "opened" as const,
      row: inserted!,
      warning: costCenterId ? null : MISSING_COST_CENTER_WARNING,
    };
  });
  if (output.status === "current-day-closed") {
    res.status(409).json({
      error: `Poslovni dan ${slovenskiDatumZaSporocilo(output.businessDate)} je že zaključen z Z-poročilom. Nove izmene ni mogoče odpreti.`,
      code: "TRENUTNI_POSLOVNI_DAN_JE_ZAKLJUCEN",
      businessDate: output.businessDate,
    });
    return;
  }
  if (output.status === "previous-day-open") {
    const names = output.missingRegisters.map((register) => register.name).join(", ");
    res.status(409).json({
      error: `Pred odprtjem izmene zaključite prejšnji poslovni dan (${output.previousBusinessDate ? slovenskiDatumZaSporocilo(output.previousBusinessDate) : "neznan datum"}) z Z-poročilom${names ? ` za blagajno: ${names}` : ""}.`,
      code: "PREJSNJI_POSLOVNI_DAN_NI_ZAKLJUCEN",
      previousBusinessDate: output.previousBusinessDate,
      missingRegisters: output.missingRegisters,
    });
    return;
  }
  const { row, warning } = output;

  // Pridobi enoto/blagajno za odgovor
  const [full] = await baseQuery().where(eq(izmeneTable.id, row.id));
  let actorSession: {
    token: string;
    expiresAt: number;
    natakarId: number;
    izmenaId: number;
  } | null = null;
  if (shouldActivateActor && actorSecret) {
    const expiresAt = Date.now() + ACTOR_SESSION_MS;
    const encoded = Buffer.from(JSON.stringify({
      n: natakariId,
      s: row.id,
      u: enotaId,
      c: companyId,
      e: expiresAt,
    })).toString("base64url");
    actorSession = {
      token: `${encoded}.${createHmac("sha256", actorSecret).update(encoded).digest("base64url")}`,
      expiresAt,
      natakarId: natakariId,
      izmenaId: row.id,
    };
  }
  res.status(201).json({ ...rowToObj(full!), warning, actorSession });
});

router.post("/izmene/:id/zapri", async (req, res): Promise<void> => {
  const context = req as unknown as PosRequest;
  const enotaId = context.enotaId;
  const id = parseInt(req.params.id, 10);
  if (isNaN(id)) { res.status(400).json({ error: "Neveljaven ID" }); return; }

  const row = await getWithNatakar(id, enotaId);
  if (!row) { res.status(404).json({ error: "Izmena ni najdena" }); return; }
  if (row.konec) { res.status(400).json({ error: "Izmena je že zaprta" }); return; }

  const [agg] = await db
    .select({ skupaj: sum(racuniTable.skupaj), stevilo: count(racuniTable.id) })
    .from(racuniTable)
    .where(eq(racuniTable.izmenaId, id));

  const skupajZnesek = Number(agg?.skupaj ?? 0);
  const steviloRacunov = Number(agg?.stevilo ?? 0);
  const konec = await getSimDatumOrNow(enotaId);

  await db.transaction(async (tx) => {
    const openBreaks = await tx.select({ id: odmoriTable.id, zacetek: odmoriTable.zacetek })
      .from(odmoriTable).where(and(eq(odmoriTable.izmenaId, id), isNull(odmoriTable.konec)));
    const closableBreakIds = openBreaks.filter((odmor) => odmor.zacetek < konec).map((odmor) => odmor.id);
    if (closableBreakIds.length > 0) {
      await tx.update(odmoriTable).set({ konec, updatedAt: new Date() })
        .where(inArray(odmoriTable.id, closableBreakIds));
    }
    await tx
      .update(izmeneTable)
      .set({
        konec,
        skupajZnesek: String(skupajZnesek.toFixed(2)),
        steviloRacunov,
        status: "osnutek",
        potrjenoBy: null,
        potrjenoAt: null,
        zavrnitevRazlog: null,
      })
      .where(and(eq(izmeneTable.id, id), eq(izmeneTable.enotaId, enotaId)));
    await writeKadrovskiAudit(tx, context, {
      enotaId,
      entiteta: "izmena",
      entitetaId: id,
      dejanje: "izmena_zaprta",
      po: {
        konec: konec.toISOString(),
        skupajZnesek: skupajZnesek.toFixed(2),
        steviloRacunov,
        samodejnoZaprtiOdmori: closableBreakIds,
      },
    });
  });

  // Vrni polni objekt z enoto/blagajno
  const [updated] = await baseQuery().where(eq(izmeneTable.id, id));
  res.json(rowToObj(updated!));
});

export default router;
