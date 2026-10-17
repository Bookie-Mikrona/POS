import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { customFetch, type SavedAmortizationYear } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

export function SavedAmortizationExports({ companyId }: { companyId: string }) {
  const [format, setFormat] = useState<"pdf" | "xlsx">("pdf");
  const [pending, setPending] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const years = useQuery({
    queryKey: ["saved-amortization-years", companyId],
    enabled: !!companyId,
    staleTime: 0,
    queryFn: ({ signal }) => customFetch<SavedAmortizationYear[]>(
      `/api/os/${encodeURIComponent(companyId)}/amortizacija/obracun/leta`,
      { signal, headers: { "X-Company-Id": companyId } },
    ),
  });
  const download = async (year: number) => {
    setPending(year);
    setError(null);
    try {
      const blob = await customFetch<Blob>(
        `/api/os/${encodeURIComponent(companyId)}/amortizacija/obracun/izvozi?leto=${year}&format=${format}`,
        { responseType: "blob", headers: { "X-Company-Id": companyId } },
      );
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `amortizacijski-obracun-${year}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Izvoz obračuna ni uspel.");
    } finally {
      setPending(null);
    }
  };
  return (
    <section className="rounded-lg border p-4 space-y-3" aria-label="Izvozi shranjenih obračunov">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="font-semibold">Izvozi shranjenih obračunov</h2>
        <Select value={format} onValueChange={(value) => setFormat(value as "pdf" | "xlsx")} disabled={pending !== null}>
          <SelectTrigger className="w-36" aria-label="Format izvoza obračuna"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="pdf">PDF</SelectItem><SelectItem value="xlsx">Excel</SelectItem></SelectContent>
        </Select>
      </div>
      <p className="text-sm text-muted-foreground">Izvoz vsebuje shranjene vrednosti, brez ponovnega izračuna.</p>
      {years.isLoading && <p className="text-sm">Nalagam shranjena leta…</p>}
      {years.isError && <p role="alert" className="text-sm text-destructive">Shranjena leta niso dosegljiva. <Button variant="link" onClick={() => void years.refetch()}>Poskusi znova</Button></p>}
      {years.data?.length === 0 && <p className="text-sm text-muted-foreground">Ni shranjenih obračunov.</p>}
      {years.data?.map((year) => (
        <div key={year.leto} className="flex flex-wrap items-center justify-between gap-2 border-t pt-2 text-sm">
          <span><strong>{year.leto}</strong> · do {year.doMeseca}/{year.leto} · {year.status === "zakljucen" ? "Zaključen" : "Odprt"}</span>
          <Button variant="outline" size="sm" disabled={pending !== null} onClick={() => void download(year.leto)}>
            {pending === year.leto ? "Izvažam…" : "Izvozi obračun"}
          </Button>
        </div>
      ))}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    </section>
  );
}
