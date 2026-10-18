import type { PaymentRecord } from "@workspace/api-client-react";
import { Link } from "wouter";
import { Badge } from "@/components/ui/badge";

const labels = { draft: "Osnutek", posted: "Knjiženo", void: "Razveljavljeno" };

export function PaymentStatus({ payment }: { payment: Pick<PaymentRecord, "status" | "voidedAt"> }) {
  const date = payment.voidedAt ? new Date(payment.voidedAt) : null;
  const validDate = date && !Number.isNaN(date.getTime());
  const voidDate = validDate
    ? new Intl.DateTimeFormat("sl-SI", {
      timeZone: "Europe/Ljubljana", day: "2-digit", month: "2-digit", year: "numeric",
    }).format(date).replace(/\s/g, "")
    : null;

  return (
    <div className="space-y-1">
      <Badge
        variant={payment.status === "void" ? "destructive" : payment.status === "draft" ? "outline" : "default"}
        className={payment.status === "posted" ? "bg-green-600 hover:bg-green-700 text-white" : ""}
      >
        {labels[payment.status]}
      </Badge>
      {payment.status === "void" && (
        <div className="text-xs text-muted-foreground">
          {voidDate
            ? <time dateTime={date!.toISOString()}>Razveljavljeno {voidDate}</time>
            : "Datum razveljavitve ni zabeležen"}
        </div>
      )}
    </div>
  );
}

export function PaymentReversalLink({ payment }: { payment: Pick<PaymentRecord, "status" | "reversalEntryId"> }) {
  if (payment.status !== "void" || !payment.reversalEntryId) return null;
  return (
    <div>
      <div className="text-muted-foreground mb-1">Storno temeljnica</div>
      <Link href={`/temeljnice?id=${encodeURIComponent(payment.reversalEntryId)}`} className="font-medium text-primary hover:underline">
        Odpri storno temeljnico
      </Link>
    </div>
  );
}

export function PaymentVoidDetails({ payment }: {
  payment: Pick<PaymentRecord, "status" | "voidReason" | "voidedBy" | "voidedByName">;
}) {
  if (payment.status !== "void") return null;
  return (
    <>
      <div className="col-span-2 min-w-0">
        <div className="text-muted-foreground mb-1">Razlog razveljavitve</div>
        <div className="font-medium whitespace-pre-wrap break-words">
          {payment.voidReason?.trim() ? payment.voidReason : "Razlog razveljavitve ni zabeležen"}
        </div>
      </div>
      <div className="col-span-2 min-w-0">
        <div className="text-muted-foreground mb-1">Razveljavil/-a</div>
        <div className="font-medium break-words">
          {payment.voidedByName || (payment.voidedBy ? "Ime izvajalca ni na voljo" : "Izvajalec razveljavitve ni zabeležen")}
        </div>
      </div>
    </>
  );
}
