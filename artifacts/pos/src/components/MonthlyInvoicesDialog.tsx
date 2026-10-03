import { useEffect, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListPosMonthlyInvoicePartners,
  usePreviewPosMonthlyInvoice,
  useListPosMonthlyInvoices,
  useIssuePosMonthlyInvoice,
  downloadPosMonthlyInvoicePdf,
  getListPosMonthlyInvoicePartnersQueryKey,
  getListPosMonthlyInvoicesQueryKey,
  getPreviewPosMonthlyInvoiceQueryKey,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { useToast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertCircle, FileDown, ExternalLink, RefreshCw, TriangleAlert, CheckCircle2 } from "lucide-react";

const MESECI = ["januar", "februar", "marec", "april", "maj", "junij", "julij", "avgust", "september", "oktober", "november", "december"];

function ljubljanaYm(d = new Date()): { y: number; m: number } {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Ljubljana", year: "numeric", month: "2-digit" }).formatToParts(d);
  return { y: Number(parts.find(p => p.type === "year")!.value), m: Number(parts.find(p => p.type === "month")!.value) };
}
function ymStr(y: number, m: number) { return `${y}-${String(m).padStart(2, "0")}`; }
function completedMonths(count = 24): string[] {
  const { y, m } = ljubljanaYm();
  const out: string[] = [];
  let cy = y, cm = m;
  for (let i = 0; i < count; i++) {
    cm -= 1;
    if (cm === 0) { cm = 12; cy -= 1; }
    out.push(ymStr(cy, cm));
  }
  return out;
}
function monthLabel(ym: string) {
  const [y, m] = ym.split("-").map(Number);
  return `${MESECI[(m ?? 1) - 1]} ${y}`;
}
function localIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}
function addDays(iso: string, days: number) {
  const [y, m, d] = iso.split("-").map(Number);
  return localIso(new Date(y!, m! - 1, d! + days));
}
function fmtDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-");
  return `${Number(d)}. ${Number(m)}. ${y}`;
}
function eur(v: string | number) {
  return `${Number(v).toLocaleString("sl-SI", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}
function newKey() {
  return typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}-${Math.random().toString(16).slice(2)}`;
}
function errInfo(e: unknown): { status: number | null; message: string } {
  const err = e as { status?: number; message?: string; data?: { error?: string; message?: string } | null };
  return {
    status: typeof err?.status === "number" ? err.status : null,
    message: err?.data?.error ?? err?.data?.message ?? err?.message ?? "Neznana napaka",
  };
}

export function MonthlyInvoicesDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const enotaId = user?.enotaId != null ? String(user.enotaId) : "";
  const companyId = user?.companyId ?? "";
  const ready = !!enotaId && !!companyId;
  const scope = useMemo(() => ["pos-monthly", enotaId, companyId] as const, [enotaId, companyId]);
  const request = useMemo(
    () => ({ headers: { "X-Enota-Id": enotaId, "X-Company-Id": companyId } }),
    [enotaId, companyId],
  );

  const months = useMemo(() => completedMonths(), []);
  const [month, setMonth] = useState(months[0]!);
  const [partnerId, setPartnerId] = useState("");
  const [invoiceDate, setInvoiceDate] = useState(localIso());
  const [dueDate, setDueDate] = useState("");
  const [requested, setRequested] = useState<{ month: string; counterpartyId: string } | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [issueError, setIssueError] = useState<{ status: number | null; message: string } | null>(null);
  const [lastIssued, setLastIssued] = useState<{ id: string; invoiceNumber: string } | null>(null);
  const [pdfBusy, setPdfBusy] = useState<string | null>(null);
  const keyRef = useRef<{ sig: string; key: string } | null>(null);
  const urlsRef = useRef<string[]>([]);

  useEffect(() => {
    setPartnerId("");
    setRequested(null);
    setConfirming(false);
    setIssueError(null);
    setLastIssued(null);
    keyRef.current = null;
  }, [enotaId, companyId]);

  useEffect(() => () => { urlsRef.current.forEach(u => URL.revokeObjectURL(u)); urlsRef.current = []; }, []);

  const partners = useListPosMonthlyInvoicePartners({
    query: { enabled: open && ready, queryKey: [...getListPosMonthlyInvoicePartnersQueryKey(), ...scope] },
    request,
  });
  const archive = useListPosMonthlyInvoices({
    query: { enabled: open && ready, queryKey: [...getListPosMonthlyInvoicesQueryKey(), ...scope] },
    request,
  });
  const previewKey = requested ? [...getPreviewPosMonthlyInvoiceQueryKey(requested), ...scope] : [...getPreviewPosMonthlyInvoiceQueryKey(), ...scope, "idle"];
  const preview = usePreviewPosMonthlyInvoice(
    requested ?? { month, counterpartyId: partnerId },
    { query: { enabled: ready && requested !== null, queryKey: previewKey, retry: false, staleTime: 0, gcTime: 0 }, request },
  );
  const issue = useIssuePosMonthlyInvoice({ request });

  const partnerList = partners.data ?? [];
  const partner = partnerList.find(p => p.id === partnerId);
  const pv = requested ? preview.data : undefined;

  // Sprememba meseca ali partnerja razveljavi predogled.
  function invalidatePreview() {
    setRequested(null);
    setConfirming(false);
    setIssueError(null);
    setLastIssued(null);
  }

  // Rok plačila sledi pogojem partnerja, ko prispe predogled.
  const pvId = pv ? `${pv.month}|${pv.counterpartyId}` : "";
  const terms = pv?.paymentTermsDays;
  useEffect(() => {
    if (pvId && terms != null) setDueDate(addDays(invoiceDate, terms));
    // samo ob novem predogledu
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvId, terms]);

  const dueInvalid = !dueDate || !invoiceDate || dueDate < invoiceDate;
  const invoiceInvalid = !invoiceDate;
  const receiptIds = pv?.receipts.map(r => r.id) ?? [];
  const canIssue = !!pv && pv.receiptCount > 0 && receiptIds.length > 0 && !dueInvalid && !invoiceInvalid && !issue.isPending;

  function startPreview() {
    if (!partnerId) return;
    setConfirming(false);
    setIssueError(null);
    setLastIssued(null);
    if (requested && requested.month === month && requested.counterpartyId === partnerId) {
      void preview.refetch();
    } else {
      setRequested({ month, counterpartyId: partnerId });
    }
  }

  function doIssue() {
    if (!pv || !canIssue) return;
    const payload = { month: pv.month, counterpartyId: pv.counterpartyId, invoiceDate, dueDate, expectedReceiptIds: receiptIds };
    const sig = JSON.stringify(payload);
    if (!keyRef.current || keyRef.current.sig !== sig) keyRef.current = { sig, key: newKey() };
    setIssueError(null);
    issue.mutate(
      { data: { ...payload, idempotencyKey: keyRef.current.key } },
      {
        onSuccess: async doc => {
          keyRef.current = null;
          setConfirming(false);
          setLastIssued({ id: doc.id, invoiceNumber: doc.invoiceNumber });
          setRequested(null);
          queryClient.removeQueries({ queryKey: [...getPreviewPosMonthlyInvoiceQueryKey(), ...scope] });
          await queryClient.invalidateQueries({ queryKey: [...getListPosMonthlyInvoicesQueryKey(), ...scope] });
          toast({ title: "Račun izdan", description: doc.invoiceNumber });
        },
        onError: e => { setConfirming(false); setIssueError(errInfo(e)); },
      },
    );
  }

  async function fetchPdf(id: string, mode: "download" | "open", name: string) {
    setPdfBusy(id + mode);
    try {
      const blob = await downloadPosMonthlyInvoicePdf(id, request);
      const url = URL.createObjectURL(new Blob([blob], { type: "application/pdf" }));
      urlsRef.current.push(url);
      const drop = (ms: number) => setTimeout(() => {
        URL.revokeObjectURL(url);
        urlsRef.current = urlsRef.current.filter(u => u !== url);
      }, ms);
      if (mode === "download") {
        const a = document.createElement("a");
        a.href = url;
        a.download = `racun-${name.replace(/[^\w.-]+/g, "_")}.pdf`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        drop(2000);
      } else {
        window.open(url, "_blank", "noopener");
        drop(120000);
      }
    } catch (e) {
      toast({ title: "PDF ni na voljo", description: errInfo(e).message, variant: "destructive" });
    } finally {
      setPdfBusy(null);
    }
  }

  const pvErr = requested && preview.isError ? errInfo(preview.error) : null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-3xl max-h-[90dvh] overflow-y-auto" data-testid="dialog-monthly-invoices">
        <DialogHeader>
          <DialogTitle>Mesečni računi</DialogTitle>
          <DialogDescription>
            En račun za vsa kosila podjetja v zaključenem mesecu. Izdan račun je trajen, ga ni mogoče urejati ali brisati. E-pošte ne pošiljamo; PDF prenesite in ga posredujte sami.
          </DialogDescription>
        </DialogHeader>

        {!ready && (
          <p className="text-sm text-muted-foreground">Izberite poslovno enoto, da lahko izdate mesečni račun.</p>
        )}

        <section className="space-y-3 rounded-lg border p-3 sm:p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1">
              <Label htmlFor="mi-month">Mesec</Label>
              <select
                id="mi-month"
                value={month}
                onChange={e => { setMonth(e.target.value); invalidatePreview(); }}
                className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                data-testid="select-monthly-month"
              >
                {months.map(m => <option key={m} value={m}>{monthLabel(m)}</option>)}
              </select>
            </div>
            <div className="space-y-1">
              <Label htmlFor="mi-partner">Podjetje</Label>
              {partners.isLoading ? <Skeleton className="h-10 w-full" /> : (
                <select
                  id="mi-partner"
                  value={partnerId}
                  onChange={e => { setPartnerId(e.target.value); invalidatePreview(); }}
                  className="h-10 w-full rounded-md border bg-background px-3 text-sm"
                  data-testid="select-monthly-partner"
                  aria-invalid={!partnerId}
                >
                  <option value="">Izberite podjetje</option>
                  {partnerList.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
                </select>
              )}
              {partners.isError && (
                <p className="flex items-center gap-2 text-xs text-red-700">
                  Seznama podjetij ni bilo mogoče naložiti.
                  <button type="button" className="underline" onClick={() => partners.refetch()}>Poskusi znova</button>
                </p>
              )}
              {!partners.isLoading && !partners.isError && partnerList.length === 0 && (
                <p className="text-xs text-muted-foreground">Ni podjetij s pogodbenimi kosili.</p>
              )}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="button" onClick={startPreview} disabled={!ready || !partnerId || (!!requested && preview.isFetching)} data-testid="button-monthly-preview">
              {requested && preview.isFetching ? <RefreshCw className="mr-2 h-4 w-4 animate-spin" /> : null}
              Pripravi predogled
            </Button>
            {partner && <span className="text-xs text-muted-foreground">Plačilni rok: {partner.paymentTermsDays} dni</span>}
          </div>
        </section>

        {requested && preview.isLoading && (
          <div className="space-y-2" data-testid="monthly-preview-loading">
            <Skeleton className="h-16 w-full" /><Skeleton className="h-32 w-full" />
          </div>
        )}

        {pvErr && (
          <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
            <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
            <div className="flex-1">
              <p>{pvErr.status === 409 ? "Podatki so se spremenili. Pripravite predogled znova." : `Predogleda ni bilo mogoče pripraviti: ${pvErr.message}`}</p>
            </div>
            <Button type="button" size="sm" variant="outline" onClick={() => preview.refetch()}>Poskusi znova</Button>
          </div>
        )}

        {pv && (
          <section className="space-y-3" data-testid="monthly-preview">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-semibold">{pv.recipientName} · {monthLabel(pv.month)}</h3>
              <span className="text-sm text-muted-foreground">{pv.receiptCount} računov</span>
            </div>

            {pv.isTest && (
              <div className="flex items-start gap-2 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900" data-testid="monthly-test-warning">
                <TriangleAlert className="mt-0.5 h-4 w-4 shrink-0" />
                Računi v tem mesecu so testni. Izdan dokument bo označen kot testni in ni namenjen pravemu obračunu.
              </div>
            )}

            {pv.receiptCount === 0 ? (
              <div className="rounded-md border border-dashed p-6 text-center text-sm text-muted-foreground" data-testid="monthly-zero">
                V mesecu {monthLabel(pv.month)} za to podjetje ni računov za obračun. Računa ni mogoče izdati.
              </div>
            ) : (
              <>
                <div className="overflow-x-auto rounded-md border">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-left text-xs text-muted-foreground">
                      <tr><th className="px-3 py-2">Postavka</th><th className="px-3 py-2 text-right">Kol.</th><th className="px-3 py-2 text-right">DDV</th><th className="px-3 py-2 text-right">Skupaj</th></tr>
                    </thead>
                    <tbody>
                      {pv.lines.map((l, i) => (
                        <tr key={i} className="border-t">
                          <td className="px-3 py-1.5">{l.label}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{Number(l.quantity).toLocaleString("sl-SI")}</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{Number(l.rate).toLocaleString("sl-SI")} %</td>
                          <td className="px-3 py-1.5 text-right tabular-nums">{eur(l.gross)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border p-3 text-sm">
                    {pv.vatBuckets.map(b => (
                      <div key={b.rate} className="flex justify-between gap-2 py-0.5 text-xs text-muted-foreground">
                        <span>DDV {Number(b.rate).toLocaleString("sl-SI")} %: osnova {eur(b.net)}</span><span>{eur(b.vat)}</span>
                      </div>
                    ))}
                    <div className="mt-2 flex justify-between border-t pt-2"><span>Skupaj brez DDV</span><span className="tabular-nums">{eur(pv.totalNet)}</span></div>
                    <div className="flex justify-between"><span>DDV</span><span className="tabular-nums">{eur(pv.totalVat)}</span></div>
                    <div className="flex justify-between text-base font-semibold"><span>Za plačilo</span><span className="tabular-nums" data-testid="monthly-total-gross">{eur(pv.totalGross)}</span></div>
                  </div>
                  <details className="rounded-md border p-3 text-sm">
                    <summary className="cursor-pointer font-medium">Zajeti računi ({pv.receipts.length})</summary>
                    <ul className="mt-2 max-h-40 space-y-0.5 overflow-auto text-xs">
                      {pv.receipts.map(r => (
                        <li key={r.id} className="flex justify-between gap-2">
                          <span className="font-mono">{r.number}</span><span className="text-muted-foreground">{fmtDate(r.date)}</span><span className="tabular-nums">{eur(r.gross)}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="space-y-1">
                    <Label htmlFor="mi-idate">Datum računa</Label>
                    <Input id="mi-idate" type="date" value={invoiceDate} aria-invalid={invoiceInvalid}
                      onChange={e => { setInvoiceDate(e.target.value); setConfirming(false); if (e.target.value && terms != null) setDueDate(addDays(e.target.value, terms)); }} />
                    {invoiceInvalid && <p className="text-xs text-red-700">Datum računa je obvezen.</p>}
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="mi-due">Rok plačila</Label>
                    <Input id="mi-due" type="date" value={dueDate} min={invoiceDate} aria-invalid={dueInvalid}
                      onChange={e => { setDueDate(e.target.value); setConfirming(false); }} />
                    {dueInvalid && <p className="text-xs text-red-700" data-testid="monthly-due-error">Rok plačila ne sme biti pred datumom računa.</p>}
                  </div>
                </div>

                {issueError && (
                  <div className="flex items-start gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert" data-testid="monthly-issue-error">
                    <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                    <div className="flex-1">
                      {issueError.status === 409
                        ? "Računi v tem mesecu so se medtem spremenili ali je račun že izdan. Osvežite predogled in preverite arhiv."
                        : `Računa ni bilo mogoče izdati: ${issueError.message}`}
                    </div>
                    {issueError.status === 409
                      ? <Button type="button" size="sm" variant="outline" onClick={startPreview}>Osveži predogled</Button>
                      : <Button type="button" size="sm" variant="outline" onClick={doIssue} disabled={!canIssue}>Poskusi znova</Button>}
                  </div>
                )}

                {!confirming ? (
                  <Button type="button" onClick={() => setConfirming(true)} disabled={!canIssue || issueError?.status === 409} data-testid="button-monthly-issue">
                    Izdaj račun
                  </Button>
                ) : (
                  <div className="space-y-2 rounded-md border border-orange-200 bg-orange-50 px-3 py-3 text-sm text-orange-900" data-testid="monthly-confirm">
                    <p>
                      Izdate račun za <strong>{pv.recipientName}</strong>, {monthLabel(pv.month)}, {pv.receiptCount} računov, skupaj <strong>{eur(pv.totalGross)}</strong>.
                      Datum {fmtDate(invoiceDate)}, rok plačila {fmtDate(dueDate)}. Dokumenta po izdaji ni več mogoče spremeniti ali izbrisati.
                    </p>
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" size="sm" onClick={() => setConfirming(false)} disabled={issue.isPending}>Prekliči</Button>
                      <Button type="button" size="sm" onClick={doIssue} disabled={issue.isPending} data-testid="button-monthly-confirm">
                        {issue.isPending ? <RefreshCw className="mr-2 h-3.5 w-3.5 animate-spin" /> : null}
                        {issue.isPending ? "Izdajanje…" : "Potrdi izdajo"}
                      </Button>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        )}

        {lastIssued && (
          <div className="flex flex-wrap items-center gap-2 rounded-md border border-green-300 bg-green-50 px-3 py-2 text-sm text-green-800" data-testid="monthly-issued">
            <CheckCircle2 className="h-4 w-4" />
            <span className="flex-1">Račun {lastIssued.invoiceNumber} je izdan.</span>
            <Button type="button" size="sm" variant="outline" onClick={() => fetchPdf(lastIssued.id, "download", lastIssued.invoiceNumber)} disabled={pdfBusy !== null}>
              <FileDown className="mr-1 h-3.5 w-3.5" />Prenesi PDF
            </Button>
            <Button type="button" size="sm" variant="outline" onClick={() => fetchPdf(lastIssued.id, "open", lastIssued.invoiceNumber)} disabled={pdfBusy !== null}>
              <ExternalLink className="mr-1 h-3.5 w-3.5" />Odpri PDF
            </Button>
          </div>
        )}

        <section className="space-y-2" data-testid="monthly-archive">
          <h3 className="font-semibold">Izdani mesečni računi</h3>
          {archive.isLoading && <Skeleton className="h-20 w-full" />}
          {archive.isError && (
            <div className="flex items-center gap-2 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700" role="alert">
              <AlertCircle className="h-4 w-4" />
              <span className="flex-1">Arhiva ni bilo mogoče naložiti.</span>
              <Button type="button" size="sm" variant="outline" onClick={() => archive.refetch()}>Poskusi znova</Button>
            </div>
          )}
          {archive.data && archive.data.length === 0 && (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">Mesečni računi še niso bili izdani.</p>
          )}
          {archive.data && archive.data.length > 0 && (
            <ul className="divide-y rounded-md border">
              {archive.data.map(d => (
                <li key={d.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2 text-sm">
                  <div className="min-w-0 flex-1">
                    <p className="font-medium">
                      <span className="font-mono">{d.invoiceNumber}</span>{" "}
                      {d.isTest && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-medium text-amber-800">TESTNI</span>}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {d.counterpartyName} · {monthLabel(d.month)} · {d.receiptCount} računov · izdan {fmtDate(d.invoiceDate)}, rok {fmtDate(d.dueDate)}
                    </p>
                  </div>
                  <span className="tabular-nums font-medium">{eur(d.totalGross)}</span>
                  <div className="flex gap-1">
                    <Button type="button" size="sm" variant="outline" onClick={() => fetchPdf(d.id, "download", d.invoiceNumber)} disabled={pdfBusy !== null} aria-label={`Prenesi PDF ${d.invoiceNumber}`}>
                      <FileDown className="h-3.5 w-3.5" />
                    </Button>
                    <Button type="button" size="sm" variant="outline" onClick={() => fetchPdf(d.id, "open", d.invoiceNumber)} disabled={pdfBusy !== null} aria-label={`Odpri PDF ${d.invoiceNumber}`}>
                      <ExternalLink className="h-3.5 w-3.5" />
                    </Button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </section>
      </DialogContent>
    </Dialog>
  );
}
