export type DateTimeInput = string | Date | null | undefined;

export function parseStrictDateTime(value: DateTimeInput): Date | null {
  if (value == null || value === "") return null;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value : null;
  if (typeof value !== "string") return null;

  const calendar = /^(\d{4})-(\d{2})-(\d{2})(?:T.*)?$/.exec(value);
  if (!calendar) return null;
  const year = Number(calendar[1]);
  const month = Number(calendar[2]);
  const day = Number(calendar[3]);
  const calendarCheck = new Date(Date.UTC(year, month - 1, day));
  if (
    calendarCheck.getUTCFullYear() !== year
    || calendarCheck.getUTCMonth() !== month - 1
    || calendarCheck.getUTCDate() !== day
  ) return null;

  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed : null;
}

export function validateTemporaryPeriod(
  activeFrom: DateTimeInput,
  activeTo: DateTimeInput,
  required: boolean,
): { activeFrom: Date | null; activeTo: Date | null; error: string | null } {
  const start = parseStrictDateTime(activeFrom);
  const end = parseStrictDateTime(activeTo);
  const hasStart = activeFrom != null && activeFrom !== "";
  const hasEnd = activeTo != null && activeTo !== "";

  if ((hasStart && !start) || (hasEnd && !end)) {
    return { activeFrom: null, activeTo: null, error: "Začetek ali konec obdobja ni veljaven datum." };
  }
  if (required || hasStart || hasEnd) {
    if (!start || !end) {
      return { activeFrom: start, activeTo: end, error: "Začetek in konec obdobja sta obvezna." };
    }
    if (end <= start) {
      return { activeFrom: start, activeTo: end, error: "Konec obdobja mora biti po začetku." };
    }
  }
  return { activeFrom: start, activeTo: end, error: null };
}