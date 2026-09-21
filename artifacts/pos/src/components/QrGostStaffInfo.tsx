import { Clock3, QrCode } from "lucide-react";
import { formatPosCas } from "@/lib/posCas";

type QrGostStaffInfoProps = {
  vir?: string | null;
  predvidenPrevzem?: string | null;
  pripravljeno?: boolean;
  showPreparationTime?: boolean;
  compact?: boolean;
  className?: string;
};

/**
 * Skupni staff prikaz za QR naročila. Oznaka temelji izključno na viru
 * naročila, nikoli na artiklu ali njegovi alkoholni oznaki.
 */
export function QrGostStaffInfo({
  vir,
  predvidenPrevzem,
  pripravljeno = false,
  showPreparationTime = true,
  compact = false,
  className = "",
}: QrGostStaffInfoProps) {
  if (vir !== "qr_gost") return null;

  const cas = formatPosCas(predvidenPrevzem);

  return (
    <div
      className={`rounded-lg border border-violet-200 bg-violet-50 text-violet-950 ${compact ? "p-2" : "p-3"} ${className}`}
      data-testid="qr-gost-staff-info"
    >
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="inline-flex items-center gap-1.5 font-bold text-violet-800">
          <QrCode className="h-4 w-4" aria-hidden="true" />
          QR gost
        </span>
        {pripravljeno ? (
          <span className="font-semibold text-emerald-700">Pripravljeno za postrežbo</span>
        ) : showPreparationTime && cas ? (
          <span
            className="inline-flex items-center gap-1 font-medium text-violet-800"
            title={`Dostava ob ${cas}`}
            aria-label={`Dostava ob ${cas}`}
          >
            <Clock3 className="h-3.5 w-3.5" aria-hidden="true" />
            {cas}
          </span>
        ) : showPreparationTime ? (
          <span className="font-medium text-violet-800">Čas priprave še ni določen</span>
        ) : null}
      </div>
    </div>
  );
}