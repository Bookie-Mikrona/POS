import type { NormativeChangeHistoryItem } from "@workspace/api-client-react";
import { ExternalLink, History } from "lucide-react";

function formatChangedAt(value: string): string {
  return new Date(value).toLocaleString("sl-SI", {
    timeZone: "Europe/Ljubljana",
    dateStyle: "short",
    timeStyle: "short",
  });
}

function formatQuantity(value: number): string {
  return new Intl.NumberFormat("sl-SI", { maximumFractionDigits: 4 }).format(value);
}

export function NormativeChangeHistoryPanel({
  items,
  isLoading,
  isError,
}: {
  items: NormativeChangeHistoryItem[];
  isLoading: boolean;
  isError: boolean;
}) {
  return (
    <section className="space-y-3 rounded-lg border bg-muted/10 p-4" aria-label="Zgodovina spletnih sprememb normativa">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold">
          <History className="h-4 w-4 text-blue-600" />
          Zgodovina spletnih sprememb
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          Ročno potrjene spremembe iz javnih spletnih virov. Revizijska sled je samo za branje.
        </p>
      </div>

      {isLoading && <p className="text-sm text-muted-foreground">Nalagam zgodovino…</p>}
      {isError && (
        <p className="rounded border border-destructive/30 bg-destructive/5 p-2 text-sm text-destructive">
          Zgodovine trenutno ni mogoče naložiti.
        </p>
      )}
      {!isLoading && !isError && items.length === 0 && (
        <p className="text-sm text-muted-foreground">Ročno potrjenih spletnih sprememb še ni.</p>
      )}
      {!isLoading && !isError && items.length > 0 && (
        <div className="max-h-72 space-y-2 overflow-y-auto pr-1">
          {items.map(item => (
            <article key={item.id} className="rounded-md border bg-background p-3 text-sm">
              <div className="flex flex-col gap-1 sm:flex-row sm:items-start sm:justify-between">
                <div>
                  <p className="font-medium">{item.ingredientName}</p>
                  <p className="text-xs text-muted-foreground">
                    {item.actorName ?? item.actorClerkUserId}
                  </p>
                </div>
                <time className="text-xs text-muted-foreground" dateTime={item.changedAt}>
                  {formatChangedAt(item.changedAt)}
                </time>
              </div>
              <p className="mt-2 font-mono text-sm">
                {formatQuantity(item.oldQuantity)} {item.unit}
                <span className="px-2 text-muted-foreground" aria-hidden="true">→</span>
                <span className="font-semibold">{formatQuantity(item.newQuantity)} {item.unit}</span>
              </p>
              <a
                className="mt-2 inline-flex items-center gap-1 text-xs text-blue-700 underline-offset-2 hover:underline"
                href={item.sourceUrl}
                target="_blank"
                rel="noopener noreferrer"
              >
                {item.sourceTitle}
                <ExternalLink className="h-3 w-3" aria-hidden="true" />
              </a>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}