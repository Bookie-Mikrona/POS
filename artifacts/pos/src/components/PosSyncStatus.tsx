import { CloudOff, CloudUpload, TriangleAlert } from "lucide-react";
import { useOrderOutbox } from "@/hooks/useOrderOutbox";

export function PosSyncStatus() {
  const { operations, online } = useOrderOutbox();
  const outstanding = operations.filter(x => x.status === "pending" || x.status === "syncing").length;
  const review = operations.filter(x => x.status === "needs_review" || x.status === "rejected").length;
  if (online && !outstanding && !review) return null;
  return <div className={`fixed bottom-3 right-3 z-50 rounded-md px-3 py-2 text-xs shadow-lg ${review ? "bg-destructive text-destructive-foreground" : "bg-amber-500 text-white"}`}>
    {!online ? <CloudOff className="mr-1 inline h-4 w-4" /> : review ? <TriangleAlert className="mr-1 inline h-4 w-4" /> : <CloudUpload className="mr-1 inline h-4 w-4" />}
    {!online ? "Brez povezave: plačilo in izdaja računa nista dovoljena." : review ? `${review} sprememb zahteva pregled.` : `${outstanding} sprememb čaka na sinhronizacijo.`}
  </div>;
}