const POS_TIME_ZONE = "Europe/Ljubljana";
const DEFAULT_POSLOVNI_DAN_START = "04:00";

type DateTimeParts = {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
};

function getPosDateTimeParts(date: Date): DateTimeParts | null {
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: POS_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date);
  const value = (type: Intl.DateTimeFormatPartTypes) => Number(parts.find(part => part.type === type)?.value);
  const result = {
    year: value("year"),
    month: value("month"),
    day: value("day"),
    hour: value("hour"),
    minute: value("minute"),
  };
  return Object.values(result).every(Number.isFinite) ? result : null;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}

function previousDate(value: string): string {
  const date = new Date(`${value}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() - 1);
  return date.toISOString().slice(0, 10);
}

/** Gostinski poslovni datum v Europe/Ljubljana. */
export function poslovniDatumZaCas(
  value: Date | string = new Date(),
  zacetekUra = DEFAULT_POSLOVNI_DAN_START,
): string {
  const date = value instanceof Date ? value : new Date(value);
  const parts = getPosDateTimeParts(date);
  if (!parts) throw new Error("Neveljaven časovni žig.");
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(zacetekUra);
  const startHour = Number(match?.[1] ?? "04");
  const startMinute = Number(match?.[2] ?? "00");
  const calendarDate = `${parts.year}-${pad(parts.month)}-${pad(parts.day)}`;
  const afterStart = parts.hour > startHour
    || (parts.hour === startHour && parts.minute >= startMinute);
  return afterStart ? calendarDate : previousDate(calendarDate);
}

export function formatPosCas(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("sl-SI", {
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    timeZone: POS_TIME_ZONE,
  }).format(date);
}

export function formatPosDatum(value?: string | null): string | null {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat("sl-SI", {
    day: "numeric",
    month: "numeric",
    year: "numeric",
    timeZone: POS_TIME_ZONE,
  }).format(date);
}

export function casZaPosDatetimeLocal(value?: string | null): string {
  if (!value) return "";
  const parts = getPosDateTimeParts(new Date(value));
  if (!parts) return "";
  return `${parts.year}-${pad(parts.month)}-${pad(parts.day)}T${pad(parts.hour)}:${pad(parts.minute)}`;
}

/**
 * Pretvori lokalni vnos POS ure (Europe/Ljubljana) v ISO časovni žig.
 * `datetime-local` nima časovnega pasu, zato ne sme biti odvisen od časovnega
 * pasu naprave, na kateri je POS odprt.
 */
export function posDatetimeLocalToIso(value: string): string | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, year, month, day, hour, minute] = match.map(Number);
  const assumedUtc = Date.UTC(year, month - 1, day, hour, minute);
  const assumedParts = getPosDateTimeParts(new Date(assumedUtc));
  if (!assumedParts) return null;
  const offsetMs = Date.UTC(
    assumedParts.year,
    assumedParts.month - 1,
    assumedParts.day,
    assumedParts.hour,
    assumedParts.minute,
  ) - assumedUtc;
  const result = new Date(assumedUtc - offsetMs);
  const roundTrip = getPosDateTimeParts(result);
  if (
    !roundTrip
    || roundTrip.year !== year
    || roundTrip.month !== month
    || roundTrip.day !== day
    || roundTrip.hour !== hour
    || roundTrip.minute !== minute
  ) {
    return null;
  }
  return result.toISOString();
}