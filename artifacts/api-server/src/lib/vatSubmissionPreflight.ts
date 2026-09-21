export function vatSubmissionPeriodBounds(
  year: number,
  period: string,
  periodMode: "mesecno" | "trimesecno",
): { from: string; to: string } | null {
  const mm = Number.parseInt(period.slice(2), 10);
  if (!Number.isInteger(mm) || mm < 1 || mm > 12) return null;
  if (periodMode === "trimesecno" && ![3, 6, 9, 12].includes(mm)) return null;

  const startMonth = periodMode === "trimesecno" ? mm - 2 : mm;
  const lastDay = new Date(year, mm, 0).getDate();
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    from: `${year}-${pad(startMonth)}-01`,
    to: `${year}-${pad(mm)}-${pad(lastDay)}`,
  };
}
