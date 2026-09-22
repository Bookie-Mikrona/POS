import { useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, Link2, Loader2, ShieldCheck, Unplug } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  checkLocalFiscalCapability,
  FISCAL_SERVICE_BASE_URL,
  isLocalFiscalServiceEnabled,
  isFiscalServicePaired,
  pairFiscalService,
  setLocalFiscalServiceEnabled,
  unpairFiscalService,
  type FiscalCapability,
} from "@/lib/offlineFiscal";

export function FiscalServicePairing({ unitEnabled }: { unitEnabled: boolean }) {
  const isWindows = typeof navigator !== "undefined" && /Windows/i.test(navigator.userAgent);
  const [code, setCode] = useState("");
  const [enabled, setEnabled] = useState(isLocalFiscalServiceEnabled);
  const [clientName, setClientName] = useState(() => localStorage.getItem("bookie.fiscal.v1.clientName") ?? "POS blagajna");
  const [baseUrl, setBaseUrl] = useState(FISCAL_SERVICE_BASE_URL);
  const [paired, setPaired] = useState(isFiscalServicePaired);
  const [capability, setCapability] = useState<FiscalCapability>();
  const [problem, setProblem] = useState<string>();
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!unitEnabled && enabled) {
      setLocalFiscalServiceEnabled(false);
      setEnabled(false);
    }
  }, [enabled, unitEnabled]);

  const refresh = async () => {
    const result = await checkLocalFiscalCapability();
    setCapability(result.capability);
    setProblem(result.reason);
  };
  useEffect(() => {
    if (enabled) void refresh();
    else {
      setCapability(undefined);
      setProblem(undefined);
    }
  }, [enabled]);

  if (!isWindows) return null;

  const pair = async () => {
    setBusy(true);
    try {
      await pairFiscalService(code, clientName, baseUrl);
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
          To nastavitev enkrat uredi skrbnik. Običajni uporabniki ne potrebujejo
          skrbniških pravic in ne izvajajo sistemskih ukazov.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!unitEnabled ? (
          <div className="flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
            <p>Offline delovanje za aktivno poslovno enoto ni omogočeno. Najprej ga omogočite v nastavitvah FURS in shranite spremembe.</p>
          </div>
        ) : null}
        <div className="flex items-center justify-between gap-3 rounded-lg border p-3">
          <div>
            <p className="font-medium">Lokalna gotovinska izdaja</p>
            <p className="text-xs text-muted-foreground">
              Privzeto je izključena. Vključite jo samo na blagajni, ki uporablja lokalno storitev.
            </p>
          </div>
          <Button
            type="button"
            variant={enabled ? "default" : "outline"}
            disabled={!unitEnabled}
            onClick={() => {
              const next = !enabled;
              setLocalFiscalServiceEnabled(next);
              setEnabled(next);
            }}
          >
            {enabled ? "Vključeno" : "Izključeno"}
          </Button>
        </div>
        {enabled ? (
          <div className={`flex items-start gap-2 rounded-lg border p-3 text-sm ${capability?.ready && paired ? "border-green-200 bg-green-50 text-green-800" : "border-amber-200 bg-amber-50 text-amber-900"}`}>
            {capability?.ready && paired ? <CheckCircle2 className="h-4 w-4 mt-0.5" /> : <AlertTriangle className="h-4 w-4 mt-0.5" />}
            <div>
              <p className="font-semibold">{paired ? "Brskalnik je povezan" : "Brskalnik ni povezan"}</p>
              <p>{problem ?? (capability?.ready ? "Storitev je pripravljena za lokalno gotovinsko izdajo." : "Lokalna izdaja ostaja blokirana.")}</p>
              {capability && !capability.ready && capability.readinessProblems?.length ? (
                <p className="mt-1 font-mono text-xs">{capability.readinessProblems.join(", ")}</p>
              ) : null}
            </div>
          </div>
        ) : null}
        {enabled && !paired ? (
          <>
            <div className="flex items-start gap-2 rounded-lg border bg-muted/40 p-3 text-sm">
              <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
              <p>
                Na Windows terminalu odprite <strong>Start → Bookie Fiscal → Bookie Offline POS</strong>
                in izberite <strong>Koda za povezavo POS-a</strong>. Prikazano šestmestno kodo nato vnesite spodaj.
                Koda velja 10 minut.
              </p>
            </div>
            <div className="grid max-w-2xl gap-3 sm:grid-cols-[1fr_1fr]">
              <div className="space-y-1 sm:col-span-2">
                <Label htmlFor="fiscal-base-url">Naslov lokalne storitve</Label>
                <Input id="fiscal-base-url" value={baseUrl} onChange={event => setBaseUrl(event.target.value)}
                  placeholder={FISCAL_SERVICE_BASE_URL} autoComplete="off" />
                <p className="text-xs text-muted-foreground">
                  HTTP je dovoljen samo za ta računalnik; za LAN uporabite zaupanja vreden HTTPS naslov.
                </p>
              </div>
              <div className="space-y-1">
                <Label htmlFor="fiscal-client-name">Ime blagajne</Label>
                <Input id="fiscal-client-name" value={clientName} onChange={event => setClientName(event.target.value)} maxLength={100} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="fiscal-pair-code">Enkratna koda</Label>
                <Input id="fiscal-pair-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" />
              </div>
              <Button type="button" onClick={() => void pair()} disabled={busy || code.length !== 6 || !clientName.trim() || !baseUrl.trim()}>
                {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Link2 className="mr-2 h-4 w-4" />}Poveži
              </Button>
            </div>
          </>
        ) : enabled ? (
          <Button type="button" variant="outline" onClick={() => { unpairFiscalService(); setPaired(false); }}>
            <Unplug className="mr-2 h-4 w-4" />Odstrani povezavo
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}