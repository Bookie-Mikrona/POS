import { useEffect, useState } from "react";
import type { GetPlatformEmail200 } from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const endpoint = () => `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/superadmin/email`;

export function PlatformEmail() {
  const [status, setStatus] = useState<GetPlatformEmail200 | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  const [recipient, setRecipient] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [confirmed, setConfirmed] = useState(false);
  const [sending, setSending] = useState(false);
  const [result, setResult] = useState("");
  const [retryAt, setRetryAt] = useState(0);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setStatus(null);
    setError("");
    fetch(endpoint(), { credentials: "include", signal: controller.signal })
      .then(async response => {
        if (!response.ok) throw new Error("Stanja globalnega pošiljanja ni mogoče prebrati.");
        return response.json() as Promise<GetPlatformEmail200>;
      })
      .then(setStatus)
      .catch(() => {
        if (!controller.signal.aborted) setError("Stanja globalnega pošiljanja ni mogoče prebrati.");
      })
      .finally(() => { if (!controller.signal.aborted) setLoading(false); });
    return () => controller.abort();
  }, [reload]);

  useEffect(() => {
    if (!retryAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [retryAt]);
  const waitSeconds = Math.max(0, Math.ceil((retryAt - now) / 1000));

  async function sendTest(event: React.FormEvent) {
    event.preventDefault();
    setSending(true);
    setResult("");
    setError("");
    // Keep the confirmed recipient stable throughout this request.
    const target = recipient.trim();
    try {
      const response = await fetch(`${endpoint()}/test`, {
        method: "POST", credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ recipient: target, confirmRecipient: confirmation.trim(), confirmed }),
      });
      if (response.status === 429 || response.ok || response.status === 502) {
        setRetryAt(Date.now() + Number(response.headers.get("Retry-After") || 60) * 1000);
        setNow(Date.now());
      }
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Preizkus ni uspel.");
      setResult(`SMTP strežnik je sprejel preizkus za ${target}. To še ne potrjuje dostave v nabiralnik; preverite tudi neželeno pošto.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Preizkus ni uspel.");
    } finally {
      setSending(false);
      setConfirmed(false);
    }
  }

  return <Card>
    <CardHeader>
      <CardTitle>Globalno pošiljanje platforme</CardTitle>
      <CardDescription>Okoljske SMTP nastavitve za platformna obvestila. Ločeno od SMTP nastavitev ERP podjetij in POS enot.</CardDescription>
    </CardHeader>
    <CardContent className="space-y-4">
      {loading && <p role="status">Preverjam konfiguracijo …</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {status && <>
        <p role="status" className="text-sm font-medium">
          {status.configured ? "Konfiguracija je pripravljena za preizkus." : "Globalno pošiljanje ni konfigurirano."}
          {" "}Dosegljivost in dostava še nista preverjeni.
        </p>
        <ul className="text-sm text-muted-foreground space-y-1">
          <li>Strežnik: {status.present.host ? "nastavljen" : "manjka"}</li>
          <li>Pošiljatelj: {status.present.from ? "nastavljen" : "manjka"}</li>
          <li>Uporabnik: {status.present.user ? "nastavljen" : "ni nastavljen"}</li>
          <li>Geslo: {status.present.password ? "nastavljeno" : "ni nastavljeno"}</li>
          <li>Vrata: {status.portValid ? "veljavna" : "neveljavna"}</li>
        </ul>
        {status.missing.length > 0 && <p className="text-sm">Preverite: {status.missing.join(", ")}.</p>}
        <form onSubmit={sendTest} className="space-y-3">
          <p className="text-sm">Pošlje se eno fiksno testno sporočilo, največ enkrat na minuto na strežnik. Samodejnega pošiljanja ni.</p>
          <div>
            <Label htmlFor="platform-email-recipient">Prejemnik preizkusa</Label>
            <Input id="platform-email-recipient" type="email" required maxLength={254}
              value={recipient} disabled={sending} onChange={e => { setRecipient(e.target.value); setConfirmed(false); setResult(""); }} />
          </div>
          <div>
            <Label htmlFor="platform-email-confirmation">Ponovite naslov prejemnika</Label>
            <Input id="platform-email-confirmation" type="email" required maxLength={254}
              value={confirmation} disabled={sending} onChange={e => { setConfirmation(e.target.value); setConfirmed(false); }} />
          </div>
          <label className="flex gap-2 text-sm">
            <input type="checkbox" checked={confirmed} disabled={sending}
              onChange={e => setConfirmed(e.target.checked)} />
            Potrjujem pošiljanje testnega sporočila na zgoraj navedeni naslov.
          </label>
          <Button type="submit" disabled={!status.configured || sending || waitSeconds > 0 || !confirmed || !recipient.trim() || recipient.trim() !== confirmation.trim()}>
            {sending ? "Pošiljam …" : waitSeconds > 0 ? `Ponovitev čez ${waitSeconds} s` : "Pošlji globalni preizkus"}
          </Button>
        </form>
      </>}
      {result && <p role="status" className="text-sm">{result}</p>}
      <Button variant="outline" disabled={loading || sending} onClick={() => setReload(value => value + 1)}>Osveži stanje</Button>
      <p className="text-sm text-muted-foreground">
        Vrednosti poverilnic niso prikazane. Spremembe globalnih SMTP nastavitev uredite izključno prek zaščitenih skrivnosti projekta v Replit (Secrets), nikoli v nastavitvah POS enote ali po klepetu.
      </p>
    </CardContent>
  </Card>;
}
