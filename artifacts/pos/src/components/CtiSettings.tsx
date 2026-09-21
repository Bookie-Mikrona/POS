import { useCallback, useEffect, useState } from "react";
import { Copy, Eye, EyeOff, KeyRound, RefreshCw } from "lucide-react";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { useToast } from "@/hooks/use-toast";

const CTI_PATH = "/api/cti/dohodni-klic";
const PRODUCTION_CTI_URL = "https://Bookie-ERP.replit.app/api/cti/dohodni-klic";

function apiUrl(path: string) {
  return `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`;
}

type CtiTokenResponse = { ctiToken?: string; napaka?: string };

interface CtiSettingsProps {
  enotaId: number | null | undefined;
}

export function CtiSettings({ enotaId }: CtiSettingsProps) {
  const { toast } = useToast();
  const [token, setToken] = useState("");
  const [loading, setLoading] = useState(true);
  const [generating, setGenerating] = useState(false);
  const [showToken, setShowToken] = useState(false);
  const [confirmRegeneration, setConfirmRegeneration] = useState(false);
  const hasActiveEnota = typeof enotaId === "number" && enotaId > 0;

  const requestHeaders = useCallback(() => ({
    "X-Enota-Id": String(enotaId),
  }), [enotaId]);

  const naloziToken = useCallback(async () => {
    if (!hasActiveEnota) {
      setToken("");
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const response = await fetch(apiUrl("/api/cti/token"), {
        credentials: "include",
        headers: requestHeaders(),
      });
      const data = await response.json() as CtiTokenResponse;
      if (!response.ok) throw new Error(data.napaka ?? "Žetona ni bilo mogoče naložiti.");
      setToken(data.ctiToken ?? "");
    } catch (error) {
      setToken("");
      toast({
        title: "CTI žetona ni bilo mogoče naložiti",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setLoading(false);
    }
  }, [hasActiveEnota, requestHeaders, toast]);

  useEffect(() => {
    void naloziToken();
  }, [naloziToken]);

  const generirajToken = async () => {
    if (!hasActiveEnota) return;
    setGenerating(true);
    try {
      const response = await fetch(apiUrl("/api/cti/token/generiraj"), {
        method: "POST",
        credentials: "include",
        headers: requestHeaders(),
      });
      const data = await response.json() as CtiTokenResponse;
      if (!response.ok || !data.ctiToken) throw new Error(data.napaka ?? "Žetona ni bilo mogoče ustvariti.");
      setToken(data.ctiToken);
      setShowToken(true);
      toast({ title: "Nov CTI žeton je ustvarjen", description: "Stari žeton ne velja več." });
    } catch (error) {
      toast({
        title: "Napaka pri ustvarjanju CTI žetona",
        description: error instanceof Error ? error.message : undefined,
        variant: "destructive",
      });
    } finally {
      setGenerating(false);
      setConfirmRegeneration(false);
    }
  };

  const kopiraj = async (value: string, label: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast({ title: `${label} je kopiran v odložišče` });
    } catch {
      toast({ title: "Kopiranje ni uspelo", variant: "destructive" });
    }
  };

  const developmentUrl = typeof window === "undefined"
    ? apiUrl(CTI_PATH)
    : `${window.location.origin}${apiUrl(CTI_PATH)}`;

  return (
    <>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <KeyRound className="h-5 w-5" />
            Samodejni zajem klicev (CTI)
          </CardTitle>
          <CardDescription>
            MacroDroid pošlje dohodni klic neposredno v trenutno aktivno poslovno enoto. Žeton je poverilnica enote — ne delite ga z drugimi.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          {!hasActiveEnota ? (
            <p className="text-sm text-destructive">Najprej izberite aktivno poslovno enoto.</p>
          ) : (
            <>
              <div className="space-y-2">
                <p className="text-sm font-medium">CTI žeton za aktivno enoto</p>
                {loading ? (
                  <p className="text-sm text-muted-foreground">Nalaganje žetona …</p>
                ) : token ? (
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <div className="relative flex-1">
                      <Input
                        value={token}
                        readOnly
                        autoComplete="off"
                        data-1p-ignore="true"
                        data-lpignore="true"
                        type={showToken ? "text" : "password"}
                        aria-label="CTI žeton"
                        className="pr-10 font-mono text-xs"
                      />
                      <button
                        type="button"
                        onClick={() => setShowToken(current => !current)}
                        aria-label={showToken ? "Skrij CTI žeton" : "Prikaži CTI žeton"}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showToken ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    <Button type="button" variant="outline" onClick={() => void kopiraj(token, "CTI žeton")}>
                      <Copy className="mr-2 h-4 w-4" />Kopiraj
                    </Button>
                  </div>
                ) : (
                  <p className="text-sm text-muted-foreground">Žeton še ni ustvarjen.</p>
                )}
              </div>

              <div className="flex flex-wrap gap-2">
                {!token ? (
                  <Button type="button" onClick={() => void generirajToken()} disabled={generating || loading}>
                    <KeyRound className="mr-2 h-4 w-4" />{generating ? "Ustvarjam …" : "Ustvari CTI žeton"}
                  </Button>
                ) : (
                  <Button type="button" variant="outline" onClick={() => setConfirmRegeneration(true)} disabled={generating}>
                    <RefreshCw className="mr-2 h-4 w-4" />Regeneriraj žeton
                  </Button>
                )}
              </div>

              <div className="space-y-3 rounded-lg border bg-muted/30 p-4 text-sm">
                <p className="font-medium">MacroDroid nastavitev</p>
                <div className="space-y-1">
                  <p className="text-muted-foreground">Produkcijski endpoint</p>
                  <div className="flex flex-col gap-2 sm:flex-row">
                    <code className="min-w-0 flex-1 break-all rounded bg-background px-2 py-1.5 text-xs">{PRODUCTION_CTI_URL}</code>
                    <Button type="button" size="sm" variant="outline" onClick={() => void kopiraj(PRODUCTION_CTI_URL, "Produkcijski endpoint")}>
                      <Copy className="mr-1.5 h-3.5 w-3.5" />Kopiraj
                    </Button>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">Za razvoj uporabite URL trenutnega Replit predogleda: <code className="break-all">{developmentUrl}</code></p>
                <ol className="list-decimal space-y-1 pl-5 text-muted-foreground">
                  <li>Ustvarite HTTP POST akcijo z endpointom zgoraj.</li>
                  <li>Nastavite glavi <code>Content-Type: application/json</code> in <code>X-CTI-Token: vaš žeton</code>.</li>
                  <li>V telo pošljite samo <code>{'{"telefon":"telefonska številka klicatelja"}'}</code>. Enote ne pošiljajte.</li>
                </ol>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <AlertDialog open={confirmRegeneration} onOpenChange={setConfirmRegeneration}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Regeneriram CTI žeton?</AlertDialogTitle>
            <AlertDialogDescription>
              Regeneracija takoj prekliče trenutni žeton. Pred naslednjim dohodnim klicem morate novi žeton posodobiti tudi v MacroDroidu.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={generating}>Prekliči</AlertDialogCancel>
            <AlertDialogAction onClick={() => void generirajToken()} disabled={generating}>
              {generating ? "Regeneriram …" : "Regeneriraj žeton"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}