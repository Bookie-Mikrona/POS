import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, Loader2, RefreshCw } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { posFetch } from "@/lib/pos-auth-headers";

type Review = {
  id: string; deviceId: string; deviceLabel?: string | null; gatewaySeq: number;
  reason: string; createdAt: string; existingPayloadHash?: string | null;
  incomingPayloadHash?: string | null;
};

const fmt = (value: string) => new Intl.DateTimeFormat("sl-SI", {
  day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit",
}).format(new Date(value));

export function GatewaySyncReviewPanel() {
  const { user } = useAuth();
  const { toast } = useToast();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState("");
  const manager = ["admin_enote", "admin", "superadmin"].includes(user?.vloga ?? "");
  const load = useCallback(async () => {
    if (!manager) return;
    const response = await posFetch("/api/offline-fiscal/gateway-reviews");
    if (!response.ok) throw new Error("Pregledov uskladitve ni mogoče naložiti.");
    setReviews((await response.json()).reviews ?? []);
  }, [manager]);
  useEffect(() => { void load().catch(e => setError(e instanceof Error ? e.message : "Napaka")); }, [load]);
  useEffect(() => {
    if (!reviews.length) return;
    const timer = window.setInterval(() => void load(), 15_000);
    return () => window.clearInterval(timer);
  }, [load, reviews.length]);
  const resolve = async (review: Review) => {
    setBusy(review.id); setError("");
    try {
      const response = await posFetch(`/api/offline-fiscal/gateway-reviews/${review.id}/resolve`, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ note: notes[review.id] || undefined, resolution: "KEEP_CLOUD_SKIP_LOCAL" }),
      });
      if (!response.ok) throw new Error("Sporne uskladitve ni mogoče razrešiti.");
      toast({ title: "Uskladitev razrešena", description: "Cloud zapis ostane; lokalni dogodek je preskočen." });
      setConfirming(null); setReviews(current => current.filter(item => item.id !== review.id));
      await load();
    } catch (e) { setError(e instanceof Error ? e.message : "Napaka"); }
    finally { setBusy(null); }
  };
  if (!manager) return <Alert id="offline-sync-review"><AlertTriangle className="h-4 w-4" /><AlertDescription>Pregledi gateway uskladitve so vidni le vodji ali skrbniku.</AlertDescription></Alert>;
  return <Card id="offline-sync-review"><CardHeader className="flex-row items-center justify-between"><CardTitle>Pregled gateway uskladitve</CardTitle><Button variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="mr-2 h-4 w-4" />Osveži</Button></CardHeader><CardContent className="space-y-4">
    {error && <Alert variant="destructive"><AlertDescription>{error}</AlertDescription></Alert>}
    {!reviews.length && <p className="text-sm text-muted-foreground">Ni odprtih sporov uskladitve.</p>}
    {reviews.map(review => <div key={review.id} className="space-y-3 rounded border p-4">
      <div className="flex justify-between gap-3"><div><strong>Dogodek #{review.gatewaySeq}</strong><p className="text-sm">{review.deviceLabel ?? review.deviceId} · {review.reason}</p></div><span className="text-xs text-muted-foreground">{fmt(review.createdAt)}</span></div>
      <p className="text-sm font-medium text-destructive">Cloud zapis ostane. Sporni lokalni dogodek bo trajno preskočen; kasnejši dogodki lahko nadaljujejo. FURS račun se ne izda ponovno.</p>
      <Input placeholder="Opomba (neobvezno)" value={notes[review.id] ?? ""} onChange={e => setNotes(current => ({ ...current, [review.id]: e.target.value }))} />
      {confirming === review.id ? <div className="flex gap-2"><Button variant="destructive" disabled={busy === review.id} onClick={() => void resolve(review)}>{busy === review.id && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}KEEP_CLOUD_SKIP_LOCAL — potrdi</Button><Button variant="outline" onClick={() => setConfirming(null)}>Prekliči</Button></div> : <Button variant="outline" onClick={() => setConfirming(review.id)}>Ohrani cloud zapis in preskoči sporni lokalni dogodek</Button>}
    </div>)}
  </CardContent></Card>;
}