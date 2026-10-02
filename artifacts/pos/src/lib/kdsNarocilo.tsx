import { useEffect, useState } from "react";
import { Clock3, MapPin, Phone, Truck, UtensilsCrossed } from "lucide-react";
import { formatPosCas } from "@/lib/posCas";
import { QrGostStaffInfo } from "@/components/QrGostStaffInfo";

export type KdsNarocilo = {
  id: number;
  ustvarjeno?: string | null;
  nacin?: string | null;
  vir?: string | null;
  nacinIzpolnitve?: string | null;
  mizaStevilka?: number | null;
  mizaIme?: string | null;
  prostorIme?: string | null;
  strankaIme?: string | null;
  strankaTelefon?: string | null;
  predvidenPrevzem?: string | null;
  predvidenaDostava?: string | null;
  dostavaUlica?: string | null;
  dostavaHisnaStevilka?: string | null;
  dostavaVhod?: string | null;
  dostavaNadstropje?: string | null;
  dostavaNaseljeNaziv?: string | null;
};

export type KdsTarget = {
  iso: string;
  label: "Dostava ob";
} | null;

export type KdsUrgency = "normal" | "soon" | "late";

/** KDS prikaže modifikatorje in njihove enonivojske podizbire pod isto prodajno postavko. */
export function getKdsModifierRows<T extends { id: number; ime: string }>(
  postavkaId: number,
  childrenByParent: Map<number, T[]>,
): Array<{ id: number; ime: string; depth: 0 | 1 }> {
  return (childrenByParent.get(postavkaId) ?? []).flatMap(parent => [
    { id: parent.id, ime: parent.ime, depth: 0 as const },
    ...(childrenByParent.get(parent.id) ?? []).map(nested => ({
      id: nested.id,
      ime: nested.ime,
      depth: 1 as const,
    })),
  ]);
}

export function isTelefonskoNarocilo(narocilo: KdsNarocilo): boolean {
  return narocilo.nacin === "telefon";
}

export function isQrGostNarocilo(narocilo: KdsNarocilo): boolean {
  return narocilo.vir === "qr_gost";
}

export function getKdsType(narocilo: KdsNarocilo): "miza" | "prevzem" | "dostava" {
  if (narocilo.nacin !== "telefon") return "miza";
  return narocilo.nacinIzpolnitve === "dostava" ? "dostava" : "prevzem";
}

export function getKdsTypeLabel(narocilo: KdsNarocilo): string {
  if (getKdsType(narocilo) === "prevzem") return "Prevzem";
  if (getKdsType(narocilo) === "dostava") return "Dostava";
  const naziv = narocilo.mizaIme || (narocilo.mizaStevilka != null ? String(narocilo.mizaStevilka) : "brez številke");
  return `Miza ${naziv}`;
}

export function getKdsTarget(narocilo: KdsNarocilo): KdsTarget {
  if (
    narocilo.nacin !== "telefon"
    && narocilo.nacin !== "miza"
    && !isQrGostNarocilo(narocilo)
  ) return null;
  if (narocilo.predvidenPrevzem) {
    return { iso: narocilo.predvidenPrevzem, label: "Dostava ob" };
  }
  return null;
}

export function getActiveKdsTarget(narocilo: KdsNarocilo, pripravljeno: boolean): KdsTarget {
  return pripravljeno ? null : getKdsTarget(narocilo);
}

export function formatKdsTime(iso: string): string {
  return formatPosCas(iso) ?? "—";
}

export function getKdsCountdown(iso: string, now = Date.now()): { text: string; urgency: KdsUrgency; minutes: number } {
  const difference = new Date(iso).getTime() - now;
  if (Number.isNaN(difference)) return { text: "čas ni znan", urgency: "normal", minutes: 0 };
  if (difference < 0) {
    const minutes = Math.ceil(Math.abs(difference) / 60000);
    return { text: `zamuja ${minutes} min`, urgency: "late", minutes };
  }
  const minutes = Math.max(1, Math.round(difference / 60000));
  return { text: `čez ${minutes} min`, urgency: difference <= 5 * 60000 ? "soon" : "normal", minutes };
}

export function sortKdsNarocila<T extends KdsNarocilo>(narocila: T[]): T[] {
  const phones: T[] = [];
  const tables: T[] = [];
  for (const narocilo of narocila) {
    if (isTelefonskoNarocilo(narocilo) && getKdsTarget(narocilo)) phones.push(narocilo);
    else tables.push(narocilo);
  }
  phones.sort((a, b) => new Date(getKdsTarget(a)!.iso).getTime() - new Date(getKdsTarget(b)!.iso).getTime() || a.id - b.id);
  // Readiness and the oldest remaining item change on every bump. Neither
  // belongs in the card's sort key while the operator is tapping its items.
  tables.sort((a, b) => {
    const aTime = a.ustvarjeno ? Date.parse(a.ustvarjeno) : NaN;
    const bTime = b.ustvarjeno ? Date.parse(b.ustvarjeno) : NaN;
    return (Number.isFinite(aTime) ? aTime : 0) - (Number.isFinite(bTime) ? bTime : 0) || a.id - b.id;
  });
  return [...phones, ...tables];
}

export function kdsUrgencyClass(urgency: KdsUrgency): string {
  if (urgency === "late") return "border-red-500 bg-red-100 text-red-900";
  if (urgency === "soon") return "border-amber-400 bg-amber-50 text-amber-900";
  return "border-slate-200 bg-white text-slate-900";
}

export function typeBadgeClass(type: ReturnType<typeof getKdsType>): string {
  if (type === "dostava") return "border-blue-300 bg-blue-100 text-blue-800";
  if (type === "prevzem") return "border-amber-300 bg-amber-100 text-amber-800";
  return "border-slate-300 bg-slate-100 text-slate-800";
}

function useKdsNow(): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 30000);
    return () => window.clearInterval(interval);
  }, []);
  return now;
}

export function KdsCountdown({ target }: { target: KdsTarget }) {
  const now = useKdsNow();
  if (!target) return null;
  const countdown = getKdsCountdown(target.iso, now);
  const urgencyClass = countdown.urgency === "late"
    ? "border-red-400 bg-red-100 text-red-800"
    : countdown.urgency === "soon"
      ? "border-amber-400 bg-amber-100 text-amber-800"
      : "border-slate-300 bg-slate-100 text-slate-700";
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-bold tabular-nums ${urgencyClass}`}
      data-testid="kds-countdown"
      data-urgency={countdown.urgency}
    >
      <Clock3 className="h-3.5 w-3.5" />
      {countdown.text}
    </span>
  );
}

export function KdsTypeBadge({ narocilo }: { narocilo: KdsNarocilo }) {
  const type = getKdsType(narocilo);
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md border px-2 py-0.5 text-xs font-bold ${typeBadgeClass(type)}`}
      data-testid="kds-type-label"
      data-type={type}
    >
      {type === "dostava" ? <Truck className="h-3.5 w-3.5" /> : type === "prevzem" ? <Phone className="h-3.5 w-3.5" /> : <UtensilsCrossed className="h-3.5 w-3.5" />}
      {getKdsTypeLabel(narocilo)}
    </span>
  );
}

export function KdsNarociloGlava({
  narocilo,
  itemCount,
  pripravljeno = false,
}: {
  narocilo: KdsNarocilo;
  itemCount?: number;
  pripravljeno?: boolean;
}) {
  const target = getActiveKdsTarget(narocilo, pripravljeno);
  const telefonAliQrGost = isTelefonskoNarocilo(narocilo) || isQrGostNarocilo(narocilo);
  const jeDostava = narocilo.nacin === "telefon" && narocilo.nacinIzpolnitve === "dostava";
  const jeMiza = getKdsType(narocilo) === "miza";
  return (
    <div className="space-y-1.5" data-testid="kds-narocilo-glava">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <KdsTypeBadge narocilo={narocilo} />
          {jeMiza && narocilo.prostorIme && (
            <span
              className="inline-flex items-center gap-1 rounded-md border border-slate-300 bg-slate-50 px-2 py-0.5 text-xs font-semibold text-slate-700"
              data-testid="kds-prostor"
            >
              <MapPin className="h-3.5 w-3.5 text-slate-500" />
              Prostor: {narocilo.prostorIme}
            </span>
          )}
        </div>
        {itemCount != null && <span className="text-xs text-slate-500 tabular-nums">{itemCount} artik.</span>}
      </div>
       {(telefonAliQrGost || target) && (
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
            {isQrGostNarocilo(narocilo) && (
              <span className="rounded-md bg-violet-100 px-1.5 py-0.5 font-bold text-violet-800" data-testid="kds-qr-gost">
                QR gost
              </span>
            )}
          {narocilo.strankaIme && <span className="font-semibold text-slate-900">{narocilo.strankaIme}</span>}
          {narocilo.strankaTelefon && <span className="text-slate-500">{narocilo.strankaTelefon}</span>}
          {target && (
            <span
              className="inline-flex items-center gap-1 rounded-md bg-slate-900 px-1.5 py-0.5 text-sm font-bold text-white shadow-sm"
              data-testid="kds-target-time"
              title={`${target.label} ${formatKdsTime(target.iso)}`}
              aria-label={`${target.label} ${formatKdsTime(target.iso)}`}
            >
              <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
              {formatKdsTime(target.iso)}
            </span>
          )}
           <KdsCountdown target={target} />
           {jeDostava && narocilo.predvidenaDostava && (
             <span
               className="inline-flex items-center gap-1 rounded-md bg-blue-50 px-1.5 py-0.5 text-blue-700"
               data-testid="kds-delivery-info"
               title={`Dostava ob ${formatKdsTime(narocilo.predvidenaDostava)} (informativno)`}
               aria-label={`Dostava ob ${formatKdsTime(narocilo.predvidenaDostava)} (informativno)`}
             >
               <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
               {formatKdsTime(narocilo.predvidenaDostava)} (informativno)
             </span>
           )}
        </div>
      )}
      <QrGostStaffInfo
        vir={narocilo.vir}
        predvidenPrevzem={narocilo.predvidenPrevzem}
        pripravljeno={pripravljeno}
        compact
        className="mt-2"
      />
      {narocilo.nacin === "telefon" && narocilo.nacinIzpolnitve === "dostava" && narocilo.dostavaUlica && (
        <div className="flex items-start gap-1 text-xs font-medium text-slate-700" data-testid="kds-delivery-address">
          <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0 text-blue-600" />
          <span>
            {narocilo.dostavaUlica} {narocilo.dostavaHisnaStevilka}
            {narocilo.dostavaVhod ? `, vhod ${narocilo.dostavaVhod}` : ""}
            {narocilo.dostavaNadstropje ? `, ${narocilo.dostavaNadstropje}. nadst.` : ""}
            {narocilo.dostavaNaseljeNaziv ? ` · ${narocilo.dostavaNaseljeNaziv}` : ""}
          </span>
        </div>
      )}
    </div>
  );
}