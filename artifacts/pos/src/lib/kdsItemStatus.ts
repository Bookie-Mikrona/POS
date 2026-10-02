import type { KdsNalog } from "@/hooks/use-kds";

export function getKdsTimerStart(nalog: Pick<KdsNalog, "aktiviranoAt" | "ustvarjeno">): string {
  return nalog.aktiviranoAt ?? nalog.ustvarjeno;
}

export function kdsItemBg(minutes: number): string {
  if (minutes >= 20) return "bg-red-100 border-l-2 border-l-red-400";
  if (minutes >= 10) return "bg-orange-50 border-l-2 border-l-orange-400";
  return "bg-green-50 border-l-2 border-l-green-400";
}

export function kdsItemBadge(minutes: number): string {
  if (minutes >= 20) return "bg-red-500 text-white";
  if (minutes >= 10) return "bg-orange-400 text-white";
  return "bg-green-500 text-white";
}

function kdsItemOutline(minutes: number): string {
  if (minutes >= 20) return "border border-red-400";
  if (minutes >= 10) return "border border-orange-400";
  return "border border-green-400";
}

export function getKdsItemAppearance(nalog: KdsNalog, barOnly = false, now = Date.now()) {
  if (nalog.stanje === "preklicano") return null;
  if (nalog.stanje === "zadrzano") return {
    className: "border border-slate-300 bg-slate-100 opacity-55",
    outlineClassName: "border border-slate-300",
    badgeClassName: "bg-slate-200 text-slate-700",
    label: "Na čakanju", minutes: null, priority: 1,
  };
  if (nalog.stanje === "bumped" || nalog.stanje === "ack") return {
    className: nalog.stanje === "bumped"
      ? "bg-blue-100 border-l-2 border-l-blue-500 opacity-80"
      : "bg-emerald-100 border-l-2 border-l-emerald-500 opacity-80",
    badgeClassName: nalog.stanje === "bumped" ? "bg-blue-600 text-white" : "bg-emerald-600 text-white",
    outlineClassName: nalog.stanje === "bumped" ? "border border-blue-500" : "border border-emerald-500",
    label: nalog.stanje === "ack" ? "Predano" : "Pripravljeno",
    minutes: null, priority: 0,
  };
  const elapsed = Math.floor((now - new Date(getKdsTimerStart(nalog)).getTime()) / 60_000);
  const minutes = Number.isFinite(elapsed) ? elapsed : 0;
  return {
    className: barOnly
      ? "border-2 border-fuchsia-500 bg-fuchsia-50 shadow-md animate-pulse"
      : kdsItemBg(minutes),
    badgeClassName: barOnly ? "bg-fuchsia-700 text-white" : kdsItemBadge(minutes),
    outlineClassName: barOnly ? "border border-fuchsia-500" : kdsItemOutline(minutes),
    label: barOnly ? "Pripravi pijačo" : "V pripravi",
    minutes, priority: barOnly ? 4 : minutes >= 20 ? 5 : minutes >= 10 ? 3 : 2,
  };
}

/** A multi-station line stays pending until every required station is ready. */
export function getOrderItemKdsStatuses(
  postavkaId: number | string,
  nalogi: readonly KdsNalog[],
  stations: readonly { id: number; ime: string; tip: string }[],
  now: number,
  pripravljeno?: string | null,
) {
  const statuses = nalogi
    .filter(nalog => String(nalog.postavkaId) === String(postavkaId))
    .flatMap(nalog => {
      const station = stations.find(item => item.id === nalog.postajaId);
      const appearance = getKdsItemAppearance(nalog, station?.tip === "bar", now);
      return appearance ? [{ ...appearance, id: nalog.id, stationName: station?.ime ?? "KDS" }] : [];
    });
  if (!statuses.length && pripravljeno) {
    statuses.push({
      className: "bg-blue-100 border-l-2 border-l-blue-500 opacity-80",
      outlineClassName: "border border-blue-500",
      badgeClassName: "bg-blue-600 text-white",
      label: "Pripravljeno", minutes: null, priority: 0, id: 0, stationName: "",
    });
  }
  return {
    statuses,
    className: statuses.reduce((selected, status) =>
      !selected || status.priority > selected.priority ? status : selected,
    undefined as typeof statuses[number] | undefined)?.outlineClassName ?? "",
  };
}