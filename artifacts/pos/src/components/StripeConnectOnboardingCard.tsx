import { useCallback, useEffect, useState } from "react";
import { AlertTriangle, CheckCircle2, ExternalLink, Loader2 } from "lucide-react";
import {
  getGetJavniProfilStripeConnectQueryKey,
  useCreateJavniProfilStripeConnectOnboarding,
  useGetJavniProfilStripeConnect,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";

const stripeConnectBaseKey = getGetJavniProfilStripeConnectQueryKey();

function getStripeOnboardingUrl(value: string): URL | null {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.hostname !== "connect.stripe.com") return null;
    return url;
  } catch {
    return null;
  }
}

export function StripeConnectOnboardingCard({ enotaId }: { enotaId: number }) {
  const queryKey = [...stripeConnectBaseKey, enotaId];
  const statusQuery = useGetJavniProfilStripeConnect({
    query: {
      queryKey,
      retry: false,
      refetchOnWindowFocus: true,
    },
  });
  const onboarding = useCreateJavniProfilStripeConnectOnboarding();
  const [onboardingError, setOnboardingError] = useState<string | null>(null);

  const refreshStatus = useCallback(() => {
    void statusQuery.refetch();
  }, [statusQuery.refetch]);

  useEffect(() => {
    window.addEventListener("focus", refreshStatus);
    window.addEventListener("pageshow", refreshStatus);
    const handleVisibility = () => {
      if (document.visibilityState === "visible") refreshStatus();
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      window.removeEventListener("focus", refreshStatus);
      window.removeEventListener("pageshow", refreshStatus);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, [refreshStatus]);

  const startOnboarding = () => {
    setOnboardingError(null);
    onboarding.mutate(undefined, {
      onSuccess: ({ url }) => {
        const safeUrl = getStripeOnboardingUrl(url);
        if (!safeUrl) {
          setOnboardingError("Stripe je vrnil neveljavno povezavo za nastavitev. Poskusite znova ali se obrnite na podporo.");
          return;
        }
        window.location.assign(safeUrl.toString());
      },
      onError: error => {
        setOnboardingError(error instanceof Error ? error.message : "Povezave za nastavitev ni bilo mogoče ustvariti.");
      },
    });
  };

  const status = statusQuery.data;
  const isReady = status?.ready === true;
  const isPending = status?.connected === true && !isReady;

  return (
    <Card className="mb-6 shadow-sm" data-testid="card-stripe-connect-status">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          {isReady
            ? <CheckCircle2 className="h-5 w-5 text-emerald-600" />
            : statusQuery.isError
              ? <AlertTriangle className="h-5 w-5 text-destructive" />
              : <ExternalLink className="h-5 w-5 text-muted-foreground" />}
          Stripe Connect
        </CardTitle>
        <CardDescription>
          Povežite Stripe račun podjetja za spletno prodajo darilnih bonov. Plačila prejme povezani gostinec, ne Mikrona.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {statusQuery.isLoading ? (
          <div className="flex items-center gap-2 text-sm text-muted-foreground" role="status" data-testid="status-stripe-connect-loading">
            <Loader2 className="h-4 w-4 animate-spin" />
            Preverjamo stanje povezave …
          </div>
        ) : statusQuery.isError ? (
          <div className="space-y-3" role="alert" data-testid="status-stripe-connect-error">
            <p className="text-sm text-destructive">
              Stanja Stripe Connect ni bilo mogoče naložiti. Preverite povezavo in poskusite znova.
            </p>
            <Button type="button" variant="outline" size="sm" onClick={refreshStatus} data-testid="button-stripe-connect-retry">
              Poskusi znova
            </Button>
          </div>
        ) : status?.ready ? (
          <div className="space-y-2" data-testid="status-stripe-connect-ready">
            <p className="font-medium text-emerald-700">Stripe račun je povezan in pripravljen za plačila.</p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>{status.detailsSubmitted ? "✓" : "○"} Podatki računa so poslani</li>
              <li>{status.chargesEnabled ? "✓" : "○"} Sprejemanje plačil je omogočeno</li>
              <li>{status.payoutsEnabled ? "✓" : "○"} Izplačila so omogočena</li>
            </ul>
          </div>
        ) : status?.connected ? (
          <div className="space-y-2" data-testid="status-stripe-connect-pending">
            <p className="font-medium">Nastavitev Stripe računa še ni zaključena.</p>
            <p className="text-sm text-muted-foreground">
              {status.detailsSubmitted
                ? "Stripe še preverja podatke ali zahteva dodatne informacije."
                : "Dokončajte vnos podatkov računa v varnem okolju Stripe."}
            </p>
            <ul className="space-y-1 text-sm text-muted-foreground">
              <li>{status.detailsSubmitted ? "✓" : "○"} Podatki računa so poslani</li>
              <li>{status.chargesEnabled ? "✓" : "○"} Sprejemanje plačil je omogočeno</li>
              <li>{status.payoutsEnabled ? "✓" : "○"} Izplačila so omogočena</li>
            </ul>
          </div>
        ) : (
          <div className="space-y-2" data-testid="status-stripe-connect-not-connected">
            <p className="font-medium">Stripe račun še ni povezan.</p>
            <p className="text-sm text-muted-foreground">
              Povežite račun vašega podjetja. Podatke boste vnesli neposredno v Stripe.
            </p>
          </div>
        )}

        {!statusQuery.isLoading && !statusQuery.isError && !isReady && status && (
          <div className="space-y-2">
            <Button type="button" onClick={startOnboarding} disabled={onboarding.isPending} data-testid="button-stripe-connect-onboarding">
              {onboarding.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {onboarding.isPending ? "Odpiranje Stripe …" : isPending ? "Nadaljuj nastavitev" : "Poveži Stripe račun"}
            </Button>
            {onboardingError && <p className="text-sm text-destructive" role="alert" data-testid="status-stripe-connect-onboarding-error">{onboardingError}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}