export type DailyLunchMode = "three_course" | "four_course";
export type DailyLunchRole = "starter" | "soup" | "main" | "dessert";

export function requiredDailyLunchRoles(mode: DailyLunchMode): DailyLunchRole[] {
  return mode === "four_course" ? ["starter", "soup", "main", "dessert"] : ["soup", "main", "dessert"];
}
export function isAvailableQuantity(value: unknown): boolean {
  if (value === null) return true;
  const n = Number(value);
  return Number.isFinite(n) && n > 0;
}
export function dailyLunchPrice(value?: string | number | null): string {
  if (value == null || value === "") return "—";
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? `${n.toFixed(2).replace(".", ",")} €` : "—";
}