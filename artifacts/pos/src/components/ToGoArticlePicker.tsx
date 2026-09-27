import { useState } from "react";
import { ChevronDown, Search } from "lucide-react";
import { Input } from "@/components/ui/input";

interface ToGoArticle {
  id: number;
  ime: string;
  aktiven: boolean;
  prodajniArtikel?: boolean;
}

function matchesSearch(name: string, query: string): boolean {
  const normalizedName = name.toLocaleLowerCase("sl").normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  return query.toLocaleLowerCase("sl").normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .trim().split(/\s+/).every(word => normalizedName.includes(word));
}

export function ToGoArticlePicker({
  articles,
  selectedIds,
  onSelect,
}: {
  articles: readonly ToGoArticle[];
  selectedIds: readonly number[];
  onSelect: (id: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const available = articles.filter(article =>
    article.aktiven && article.prodajniArtikel && !selectedIds.includes(article.id)
    && matchesSearch(article.ime, query));

  return (
    <div className="space-y-2">
      <button
        type="button"
        aria-expanded={open}
        aria-controls="to-go-article-options"
        onClick={() => { setOpen(current => !current); setQuery(""); }}
        className="flex h-9 w-full items-center justify-between rounded-md border border-input bg-background px-3 text-left text-sm"
      >
        Dodaj artikel za To Go...
        <ChevronDown className="h-4 w-4 shrink-0" aria-hidden="true" />
      </button>
      {open && (
        <div className="rounded-md border bg-background p-2">
          <div className="relative">
            <Search className="absolute left-2 top-2.5 h-4 w-4 text-muted-foreground" aria-hidden="true" />
            <Input
              aria-label="Poišči artikel za To Go"
              placeholder="Poišči artikel, npr. alu folija"
              value={query}
              onChange={event => setQuery(event.target.value)}
              className="pl-8"
            />
          </div>
          <div
            id="to-go-article-options"
            className="mt-2 max-h-56 overflow-y-scroll overscroll-contain rounded border touch-pan-y"
            style={{ WebkitOverflowScrolling: "touch" }}
          >
            {available.length ? available.map(article => (
              <button
                type="button"
                key={article.id}
                onClick={() => { onSelect(article.id); setOpen(false); setQuery(""); }}
                className="block w-full border-b px-3 py-2 text-left text-sm last:border-b-0 hover:bg-accent focus:bg-accent focus:outline-none"
              >
                {article.ime}
              </button>
            )) : (
              <p className="p-3 text-sm text-muted-foreground">
                Ni zadetkov med aktivnimi prodajnimi artikli.
              </p>
            )}
          </div>
          <p className="mt-1 text-xs text-muted-foreground">Na seznamu so samo aktivni prodajni artikli.</p>
        </div>
      )}
    </div>
  );
}