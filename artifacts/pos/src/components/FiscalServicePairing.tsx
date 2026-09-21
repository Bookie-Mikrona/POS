import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Link2, Loader2, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  checkLocalFiscalCapability,
  FISCAL_SERVICE_BASE_URL,
  isFiscalServicePaired,
  pairFiscalService,
  unpairFiscalService,
  type FiscalCapability,
} from "@/lib/offlineFiscal";

export function FiscalServicePairing() {
  const [code, setCode] = useState("");
  const [clientName, setClientName] = useState(() => localStorage.getItem("bookie.fiscal.v1.clientName") ?? "POS blagajna");
  const [paired, setPaired] = useState(isFiscalServicePaired);
  const [capability, setCapability] = useState<FiscalCapability>();
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

  const refresh = async () => {
    const result = await checkLocalFiscalCapability();
    setCapability(result.capability);
    setProblem(result.reason);
  };
  useEffect(() => { void refresh(); }, []);

  const pair = async () => {
    setBusy(true);
    try {
      await pairFiscalService(code, clientName);
      localStorage.setItem("bookie.fiscal.v1.clientName", clientName);
      setPaired(true);
      setCode("");
      await refresh();
    } catch (error) {
      setProblem(error instanceof Error ? error.message : "Seznanitev ni uspela.");
    } finally { setBusy(false); }
  };

  return (
    <Card id="ns-fiscal-service">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Link2 className="h-5 w-5" />Lokalna Bookie Fiscal Service</CardTitle>
        <CardDescription>
          Edini podprti lokalni naslov je <code>{FISCAL_SERVICE_BASE_URL}</code>. Enkratno kodo pridobite v lokalnem skrbniškem postopku Windows storitve.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${capability?.ready && paired ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
          {capability?.ready && paired ? <CheckCircle2 className="h-4 w-4 mt-0.5" /> : <AlertTriangle className="h-4 w-4 mt-0.5" />}
          <div>
            <p className="font-semibold">{paired ? "Brskalnik je seznanjen" : "Brskalnik ni seznanjen"}</p>
            <p>{problem ?? (capability?.ready ? "Storitev je pripravljena za lokalno gotovinsko izdajo." : "Lokalna izdaja ostaja blokirana.")}</p>
            {capability && !capability.ready && capability.readinessProblems?.length ? (
              <p className="mt-1 font-mono text-xs">{capability.readinessProblems.join(", ")}</p>
            ) : null}
          </div>
        </div>
        {!paired ? (
          <div className="grid max-w-lg gap-3 sm:grid-cols-[1fr_10rem_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="fiscal-client-name">Ime blagajne</Label>
              <Input id="fiscal-client-name" value={clientName} onChange={event => setClientName(event.target.value)} maxLength={100} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="fiscal-pair-code">Enkratna koda</Label>
              <Input id="fiscal-pair-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" />
            </div>
            <Button type="button" onClick={() => void pair()} disabled={busy || code.length !== 6 || !clientName.trim()}>
              {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}Seznani
            </Button>
          </div>
        ) : (
          <Button type="button" variant="outline" onClick={() => { unpairFiscalService(); setPaired(false); }}>
            <Unplug className="mr-2 h-4 w-4" />Odstrani seznanitev
          </Button>
        )}
      </CardContent>
    </Card>
  );
}