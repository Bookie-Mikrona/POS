import { useEffect, useState } from "react";
import { useAuth } from "@/contexts/AuthContext";
import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Wifi, WifiOff } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  checkLocalGateway,
  gatewayFetch,
  getLocalGatewayConfig,
  pairLocalGateway,
  probeLocalGateway,
  clearLocalGateway,
  getGatewayAuthorityStatus,
  releaseGatewayAuthority,
  setLocalGatewayAuthorityEnabled,
  type GatewayHealth,
} from "@/lib/gatewayClient";
import { clearGatewayAuthorityLatch, latchGatewayAuthority } from "@/lib/gatewayOfflineStore";

const ENABLED_KEY = "bookie.local-gateway.enabled";
type GatewayCapabilities = {
  service: string;
  protocolVersion: string;
  singleWriter: boolean;
  supportedOffline: string[];
  experimentalServerSide?: string[];
  unsupportedOffline?: string[];
};

export function LocalGatewaySettings() {
  let user: { companyId?: string; enotaId?: number } | null = null;
  try {
    const authUser = useAuth().user as { companyId?: string; enotaId?: number } | null;
    user = authUser;
  } catch { /* standalone settings tests/renderers have no auth provider */ }
  const saved = getLocalGatewayConfig();
  const [enabled, setEnabled] = useState(() => localStorage.getItem(ENABLED_KEY) === "1");
  const [url, setUrl] = useState(saved?.baseUrl ?? "");
  const [code, setCode] = useState("");
  const [clientName, setClientName] = useState("");
  const [health, setHealth] = useState<GatewayHealth>();
  const [capabilities, setCapabilities] = useState<GatewayCapabilities>();
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [clientId, setClientId] = useState(saved?.clientId ?? "");
  const [managerConfirmed, setManagerConfirmed] = useState(false);
  const scope = user?.companyId && user.enotaId != null
    ? { companyId: user.companyId, enotaId: user.enotaId } : null;

  useEffect(() => {
    if (saved?.baseUrl) setUrl(saved.baseUrl);
    if (saved?.clientId) setClientId(saved.clientId);
  }, [saved?.baseUrl, saved?.clientId]);

  const preveri = async () => {
    setBusy(true); setMessage("");
    try {
      const status = saved?.baseUrl === url.replace(/\/$/, "")
        ? await checkLocalGateway()
        : { online: true, health: await probeLocalGateway(url) };
      if (!status.online || !status.health) throw new Error(status.reason ?? "Gateway ni dosegljiv.");
      setHealth(status.health);
      setCapabilities(await gatewayFetch<GatewayCapabilities>("/gateway/capabilities"));
      setMessage("Gateway je dosegljiv.");
    } catch (error) {
      setHealth(undefined); setCapabilities(undefined);
      setMessage(error instanceof Error ? error.message : "Gateway ni dosegljiv.");
    } finally { setBusy(false); }
  };

  const pair = async () => {
    if (!managerConfirmed) {
      setMessage("Pred seznanitvijo mora odgovorna oseba potrditi izbiro LAN avtoritete.");
      return;
    }
    if (!/^\d{6}$/.test(code.trim()) || !clientName.trim() || !url.trim()) {
      setMessage("Vnesite URL, ime naprave in šestmestno pairing kodo.");
      return;
    }
    setBusy(true); setMessage("");
    try {
      const result = await pairLocalGateway(url, code, clientName);
      setClientId(result.clientId); setCode("");
      setEnabled(true); localStorage.setItem(ENABLED_KEY, "1"); setLocalGatewayAuthorityEnabled(managerConfirmed);
      setMessage("Naprava je seznanjena. Skrivnost je shranjena samo v zaščitenem IndexedDB.");
      await preveri();
    } catch (error) {
      setMessage(error instanceof Error ? error.message : "Seznanitev ni uspela.");
    } finally { setBusy(false); }
  };

  const toggle = async (value: boolean) => {
    if (value) {
      setEnabled(true); localStorage.setItem(ENABLED_KEY, "1"); setLocalGatewayAuthorityEnabled(managerConfirmed);
    }
    else {
      await safeRelease("izklop");
    }
  };

  const safeRelease = async (action: string) => {
    if (!scope) {
      if (action === "izklop") {
        setLocalGatewayAuthorityEnabled(false);
        setEnabled(false);
      } else {
        // Credentials may be removed as recovery hygiene, but without an
        // authenticated scope the durable authority latch is deliberately
        // untouched and cloud writes remain blocked.
        await clearLocalGateway();
        localStorage.removeItem(ENABLED_KEY);
        setEnabled(false); setClientId("");
      }
      setMessage("Manjka aktivna poslovna enota; gateway ostaja zaklenjen.");
      return;
    }
    setBusy(true); setMessage("");
    try {
      const released = await releaseGatewayAuthority(scope);
      const zero = (status: typeof released) =>
        status.companyId === scope.companyId && String(status.enotaId) === String(scope.enotaId) &&
        status.authorityMode === "CLOUD" && status.openLocalOrders === 0 &&
        status.pendingEvents === 0 && status.unresolvedReviews === 0 &&
        status.leasedJobs === 0 && status.inFlightFiscalJobs === 0;
      if (!zero(released)) throw new Error("Gateway ni mogoče varno sprostiti: lokalno delo ali nerešeni dogodki obstajajo.");
      const verified = await getGatewayAuthorityStatus(scope);
      if (!zero(verified) || verified.releaseGeneration !== released.releaseGeneration) {
        throw new Error("Gateway status sprostitve se ne ujema s potrjeno generacijo.");
      }
      await clearLocalGateway();
      clearGatewayAuthorityLatch(scope);
      localStorage.removeItem(ENABLED_KEY); setLocalGatewayAuthorityEnabled(false);
      setEnabled(false); setClientId(""); setHealth(undefined); setCapabilities(undefined);
      setMessage(`${action} je uspešno zaključen.`);
    } catch (error) {
      latchGatewayAuthority(scope);
      setMessage(error instanceof Error ? error.message : "Gateway sprostitve ni mogoče preveriti.");
    } finally { setBusy(false); }
  };

  const forget = async () => {
    await safeRelease("Pozabljanje pairing-a");
  };

  return (
    <Card id="ns-local-gateway">
      <CardHeader>
        <CardTitle className="flex items-center gap-2"><Wifi className="h-5 w-5" />Bookie Local Gateway</CardTitle>
        <CardDescription>
          Ročno povežite ta POS z eno stalno Windows LAN napravo. Gateway je centralni
          single-writer; ta nastavitev ne prestreza drugih zahtevkov in ne izbira fiskalne
          avtoritete samodejno.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        <Alert>
          <AlertTriangle className="h-4 w-4" />
          <AlertDescription>
            Offline LAN podpira samo gotovino. Preklop fiskalne avtoritete med gatewayem
             in samostojnim načinom zahteva izrecno potrditev vodje; samodejnega failoverja ni.
             Pred seznanitvijo mora biti certifikat gatewaya nameščen kot zaupanja vreden
             certifikat v OS/brskalniku in se mora ujemati s hostname/IP SAN; prstni odtis
             v diagnostiki ni varnostna zamenjava za TLS zaupanje.
          </AlertDescription>
        </Alert>
        <div className="flex items-center justify-between rounded-lg border p-3">
          <div>
            <Label htmlFor="local-gateway-enabled">Uporabi LAN gateway</Label>
            <p className="text-xs text-muted-foreground">Vključite šele po preverjanju statičnega IP-ja in Private profila.</p>
          </div>
          <Button id="local-gateway-enabled" variant={enabled ? "default" : "outline"}
            disabled={!enabled && !managerConfirmed} onClick={() => void toggle(!enabled)}>
            {enabled ? "Vključeno" : "Izključeno"}
          </Button>
        </div>
        {!enabled && (
          <label className="flex items-start gap-2 text-sm">
            <Checkbox checked={managerConfirmed} onCheckedChange={value => setManagerConfirmed(value === true)} />
            <span>Potrjujem kot odgovorna oseba: gateway je namerno izbran kot single-writer in
              ob nedosegljivosti ne dovolim samodejnega preklopa na drugo fiskalno avtoriteto.</span>
          </label>
        )}
        <div className="grid gap-3 sm:grid-cols-[1fr_auto]">
          <div className="space-y-2">
            <Label htmlFor="local-gateway-url">Ročni LAN URL</Label>
            <Input id="local-gateway-url" value={url} onChange={event => setUrl(event.target.value)}
              placeholder="http://192.168.1.20:17831/v1" autoComplete="off" />
          </div>
          <Button variant="outline" className="self-end" disabled={busy || !url.trim()} onClick={() => void preveri()}>
            {busy ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <RefreshCw className="mr-2 h-4 w-4" />}Preveri
          </Button>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-2">
            <Label htmlFor="local-gateway-client-name">Ime tega POS odjemalca</Label>
            <Input id="local-gateway-client-name" value={clientName} onChange={event => setClientName(event.target.value)}
              placeholder="Blagajna 1" autoComplete="off" />
          </div>
          <div className="space-y-2">
            <Label htmlFor="local-gateway-code">Enkratna 6-mestna pairing koda</Label>
            <Input id="local-gateway-code" value={code} onChange={event => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              inputMode="numeric" maxLength={6} placeholder="123456" autoComplete="one-time-code" />
          </div>
        </div>
        <Button onClick={() => void pair()} disabled={busy || !url || !clientName || code.length !== 6}>
          Seznani ta POS
        </Button>
        {clientId && <Button variant="destructive" onClick={() => void forget()}>Pozabi pairing (izbriši poverilnice)</Button>}
        {clientId && <p className="text-xs text-muted-foreground">Seznanjen client ID: <span className="font-mono">{clientId}</span></p>}
        {message && <p role="status" className="text-sm">{message}</p>}
        {health ? (
          <div className="rounded-lg border p-3 space-y-2">
            <div className="flex items-center gap-2"><CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="font-medium">Dosegljiv</span><Badge variant="outline">{health.diagnosticTime}</Badge></div>
            <p className="text-sm text-muted-foreground">Dogodki za sinhronizacijo: {health.pendingEventCount}</p>
            {health.tls?.fingerprintSha256 && <p className="text-xs font-mono break-all">TLS certifikat (diagnostika, ne pin): {health.tls.fingerprintSha256}</p>}
            {capabilities && <p className="text-sm">POS podpora: {capabilities.supportedOffline.join(", ")}. Strežniški poskusi (še niso povezani s POS zasloni): {capabilities.experimentalServerSide?.join(", ") ?? "—"}. Enotni pisec: {capabilities.singleWriter ? "da" : "ne"}.</p>}
          </div>
        ) : enabled ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground"><WifiOff className="h-4 w-4" />Gateway še ni preverjen.</div>
        ) : null}
      </CardContent>
    </Card>
  );
}