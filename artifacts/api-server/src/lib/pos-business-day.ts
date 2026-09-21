import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { getSimDatumString } from "./sim-datum";

export const POS_TIME_ZONE = "Europe/Ljubljana";
export const DEFAULT_POS_BUSINESS_DAY_START = "04:00";

type Executor = Pick<typeof db, "execute">;

function normalizeStartTime(value?: string | null): string {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(value ?? "");
  return match ? `${match[1]}:${match[2]}` : DEFAULT_POS_BUSINESS_DAY_START;
}

function previousDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

function ljubljanaParts(value: Date): { date: string; hour: number; minute: number } {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: POS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(value);
  const get = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((part) => part.type === type)?.value ?? "";
  return {
    date: `${get("year")}-${get("month")}-${get("day")}`,
    hour: Number(get("hour")),
    minute: Number(get("minute")),
  };
}

export function businessDateFromLocalDateTime(
  calendarDate: string,
  hour: number,
  minute: number,
  startTime = DEFAULT_POS_BUSINESS_DAY_START,
): string {
  const [startHour, startMinute] = normalizeStartTime(startTime).split(":").map(Number);
  const afterStart = hour > startHour || (hour === startHour && minute >= startMinute);
  return afterStart ? calendarDate : previousDate(calendarDate);
}

export function businessDateForInstant(
  value: Date | string,
  startTime = DEFAULT_POS_BUSINESS_DAY_START,
): string {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) throw new Error("Neveljaven časovni žig.");
  const local = ljubljanaParts(instant);
  return businessDateFromLocalDateTime(local.date, local.hour, local.minute, startTime);
}

export async function getEnotaBusinessDayStart(
  enotaId: number,
  executor: Executor = db,
): Promise<string> {
  const result = await executor.execute(sql`
    SELECT zacetek_dneva_ura
    FROM enote
    WHERE id = ${enotaId}
    LIMIT 1
  `);
  const raw = (result.rows[0] as { zacetek_dneva_ura?: string | null } | undefined)
    ?.zacetek_dneva_ura;
  return normalizeStartTime(raw);
}

export async function getCurrentPosBusinessDate(
  enotaId: number,
  now = new Date(),
  executor: Executor = db,
): Promise<string> {
  const [startTime, simulatedDate] = await Promise.all([
    getEnotaBusinessDayStart(enotaId, executor),
    getSimDatumString(enotaId),
  ]);
  const local = ljubljanaParts(now);
  if (simulatedDate && /^\d{4}-\d{2}-\d{2}$/.test(simulatedDate)) {
    return businessDateFromLocalDateTime(simulatedDate, local.hour, local.minute, startTime);
  }
  return businessDateFromLocalDateTime(local.date, local.hour, local.minute, startTime);
}

export async function getBusinessDayBounds(
  enotaId: number,
  businessDate: string,
  executor: Executor = db,
): Promise<{ start: Date; end: Date; startTime: string }> {
  const startTime = await getEnotaBusinessDayStart(enotaId, executor);
  const result = await executor.execute(sql`
    SELECT
      (${businessDate}::date + ${startTime}::time) AT TIME ZONE ${POS_TIME_ZONE} AS start_utc,
      (${businessDate}::date + INTERVAL '1 day' + ${startTime}::time) AT TIME ZONE ${POS_TIME_ZONE} AS end_utc
  `);
  const row = result.rows[0] as { start_utc: Date | string; end_utc: Date | string };
  return {
    start: new Date(row.start_utc),
    end: new Date(row.end_utc),
    startTime,
  };
}