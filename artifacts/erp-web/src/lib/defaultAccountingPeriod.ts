interface DatedPeriod {
  id: string;
  startDate: string;
  endDate: string;
}

export function defaultAccountingPeriod(
  periods: readonly DatedPeriod[],
  today = new Intl.DateTimeFormat("sv-SE", { timeZone: "Europe/Ljubljana" }).format(new Date()),
): string {
  const newestFirst = [...periods].sort(
    (a, b) => b.startDate.localeCompare(a.startDate) || b.endDate.localeCompare(a.endDate),
  );
  return (newestFirst.find(
    period => period.startDate.slice(0, 10) <= today && period.endDate.slice(0, 10) >= today,
  ) ?? newestFirst[0])?.id ?? "all";
}
