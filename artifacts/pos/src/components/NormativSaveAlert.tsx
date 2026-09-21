import { AlertCircle, RotateCcw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { NormativStaleError } from "@workspace/api-client-react";

export type NormativSaveApiError = {
  status?: number;
  data?: NormativStaleError | null;
};

export function getNormativStaleMessage(error: NormativSaveApiError): string | null {
  if (error.status !== 409 || !error.data || error.data.code !== "NORMATIVE_STALE") return null;
  return error.data.error
    ?? "Normativ se je medtem spremenil. Osvežite podatke in spremembe vnesite ponovno.";
}

export function NormativSaveAlert({
  message,
  stale,
  refreshing,
  onRefresh,
}: {
  message: string;
  stale: boolean;
  refreshing: boolean;
  onRefresh: () => void;
}) {
  return (
    <div className="flex items-start gap-2 rounded-md border border-destructive/50 bg-destructive/10 px-3 py-2 text-sm text-destructive">
      <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
      <div className="flex-1 space-y-2">
        <p>{message}</p>
        {stale && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={refreshing}
            onClick={onRefresh}
          >
            <RotateCcw className="mr-2 h-4 w-4" />
            {refreshing ? "Osvežujem..." : "Osveži normativ"}
          </Button>
        )}
      </div>
    </div>
  );
}