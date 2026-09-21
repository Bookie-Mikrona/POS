import { useEffect, useState } from "react";
import { Wifi, WifiOff } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { checkLocalGateway, getLocalGatewayConfig, isLocalGatewayEnabled } from "@/lib/gatewayClient";
import { useGatewayOfflineContext } from "@/lib/gatewayOfflineStore";
import { useLocation } from "wouter";

export function LocalGatewayStatusBanner() {
  const gatewayState = useGatewayOfflineContext();
  const [, navigate] = useLocation();
  const [online, setOnline] = useState<boolean | null>(null);
  const [fingerprint, setFingerprint] = useState<string | null>(null);
  useEffect(() => {
    if (!isLocalGatewayEnabled()) return;
    let cancelled = false;
    const check = async () => {
      const result = await checkLocalGateway();
      if (!cancelled) {
        setOnline(result.online);
        setFingerprint(result.health?.tls?.fingerprintSha256 ?? null);
      }
    };
    void check();
    const timer = window.setInterval(() => void check(), 30_000);
    return () => { cancelled = true; window.clearInterval(timer); };
  }, []);
  if (!isLocalGatewayEnabled() && !gatewayState.cloudBlocked) return null;
  const id = getLocalGatewayConfig()?.clientId;
  return (
    <div className="flex items-center gap-2 border-b bg-muted/40 px-3 py-1 text-xs">
      {online ? <Wifi className="h-3.5 w-3.5 text-emerald-600" /> : <WifiOff className="h-3.5 w-3.5 text-amber-600" />}
      <span>LAN gateway {online ? "dosegljiv" : online === false ? "ni dosegljiv" : "preverjam…"}</span>
      {gatewayState.cloudBlocked && <span className="font-medium text-destructive">Cloud zapisovanje ostaja blokirano</span>}
      {id && <Badge variant="outline" className="font-mono">{id.slice(0, 8)}</Badge>}
      {fingerprint && <span className="text-muted-foreground">TLS diagnostika {fingerprint.slice(0, 12)}…</span>}
      {gatewayState.healthy && (
        <span className="text-muted-foreground">
          sinhronizacija: {gatewayState.pendingEventCount} čakajočih · vodni žig {gatewayState.watermark}
        </span>
      )}
      {(gatewayState.error?.includes("NEEDS_REVIEW") || gatewayState.blockedReview) && (
        <button
          type="button"
          className="rounded border border-destructive/50 px-2 py-0.5 text-destructive hover:bg-destructive/10"
          onClick={() => navigate("/nastavitve?tab=nastavitve#offline-sync-review")}
        >
          OPEN pregled sinhronizacije — brez samodejnega združevanja
        </button>
      )}
      {gatewayState.blockedReview && <span className="text-amber-700">Čaka pregled uskladitve (lokalni sporni dogodek bo zavržen).</span>}
    </div>
  );
}