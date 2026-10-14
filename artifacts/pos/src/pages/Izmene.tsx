import { formatEur } from "@/lib/formatEur";
import { useState } from "react";
import {
  useListIzmene,
  useListAktivneIzmene,
  useListOdmori,
  useCreateOdmor,
  useZapriOdmor,
  usePredloziIzmeno,
  getListOdmoriQueryKey,
  useOpenIzmena,
  useZapriIzmeno,
  useListNatakari,
  useListEnote,
  useListCostCenters,
  getListIzmeneQueryKey,
  getListAktivneIzmeneQueryKey,
} from "@workspace/api-client-react";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import type { Izmena } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { notifyPosActorSessionChanged } from "@/lib/pos-actor-session";
import { SecretInput } from "@/components/SecretInput";
import {
  Clock, Play, Square, User, Euro, Receipt,
  CheckCircle2, TimerOff, Coffee, TimerReset, AlertCircle, Building2, MapPin,
} from "lucide-react";

function elapsed(zacetek: string): string {
  const ms = Date.now() - new Date(zacetek).getTime();
  const h = Math.floor(ms / 3600000);
  const m = Math.floor((ms % 3600000) / 60000);
  if (h > 0) return `${h}h ${m}min`;
  return `${m}min`;
}

function formatTime(iso: string) {
  return new Date(iso).toLocaleTimeString("sl-SI", { hour: "2-digit", minute: "2-digit" });
}
function formatDate(iso: string) {
  return new Date(iso).toLocaleDateString("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric" });
}

function statusLabel(status: Izmena["status"]): string {
  if (status === "v_potrditvi") return "V potrditvi";
  if (status === "potrjeno") return "Potrjeno";
  if (status === "zavrnjeno") return "Zavrnjeno";
  return "Osnutek";
}

interface CloseSummaryDialogProps {
  izmena: Izmena | null;
  open: boolean;
  onClose: () => void;
}

function CloseSummaryDialog({ izmena, open, onClose }: CloseSummaryDialogProps) {
  if (!izmena) return null;
  const trajanje = izmena.konec
    ? (() => {
        const ms = new Date(izmena.konec).getTime() - new Date(izmena.zacetek).getTime();
        const h = Math.floor(ms / 3600000);
        const m = Math.floor((ms % 3600000) / 60000);
        return h > 0 ? `${h}h ${m}min` : `${m}min`;
      })()
    : "—";

  return (
    <Dialog open={open} onOpenChange={onClose}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-500" />
            Izmena zaprta
          </DialogTitle>
        </DialogHeader>
        <div className="space-y-4 pt-2">
          <div className="rounded-xl bg-muted/60 p-4 space-y-3">
            <div className="flex items-center gap-2 font-semibold text-lg">
              <User className="h-5 w-5 text-muted-foreground" />
              {izmena.natakarIme}
            </div>
            <Separator />
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Začetek</p>
                <p className="font-medium text-sm">{formatTime(izmena.zacetek)}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Konec</p>
                <p className="font-medium text-sm">{izmena.konec ? formatTime(izmena.konec) : "—"}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Trajanje</p>
                <p className="font-medium text-sm">{trajanje}</p>
              </div>
              <div className="space-y-1">
                <p className="text-xs text-muted-foreground uppercase tracking-wide">Računi</p>
                <p className="font-medium text-sm">{izmena.steviloRacunov}</p>
              </div>
            </div>
            <Separator />
            <div className="flex justify-between items-center">
              <span className="text-sm text-muted-foreground">Skupni promet</span>
              <span className="text-2xl font-bold text-primary">{formatEur(izmena.skupajZnesek)}</span>
            </div>
          </div>
          <Button className="w-full" onClick={onClose}>Zapri</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Kontekst enote in stroškovnega mesta ─────────────────────────────────────

type EnotaContext = {
  enotaId: number | null;
  enotaIme: string | null;
  costCenterId: string | null;
  costCenter: { code: string; name: string } | null;
  canOpen: boolean;
  isLoading: boolean;
};

function useIzmenaEnotaContext(): EnotaContext {
  const { user } = useAuth();
  const { data: enote, isLoading: enoteLoading } = useListEnote();
  const { data: costCentersData, isLoading: costCentersLoading } = useListCostCenters(
    user?.companyId ?? "",
    {},
    { query: { enabled: Boolean(user?.companyId) } as any },
  );

  const enotaId = user?.enotaId ?? null;
  const apiEnota = enote?.find(e => e.id === enotaId);
  const authEnota = user?.enote?.find(e => e.id === enotaId);
  const enotaIme = apiEnota?.ime ?? authEnota?.ime ?? user?.enotaIme ?? null;
  const costCenterId = apiEnota?.costCenterId ?? null;
  const costCenter = costCentersData?.costCenters.find(cc => cc.id === costCenterId) ?? null;

  return {
    enotaId,
    enotaIme,
    costCenterId,
    costCenter: costCenter ? { code: costCenter.code, name: costCenter.name } : null,
    canOpen: enotaId !== null && Boolean(enotaIme?.trim()),
    isLoading: enoteLoading || (Boolean(costCenterId) && costCentersLoading),
  };
}

function formatCostCenter(
  costCenter: { code: string; name: string } | null,
  costCenterId?: string | null,
): string | null {
  if (costCenter) {
    return costCenter.code && costCenter.name
      ? `${costCenter.code} — ${costCenter.name}`
      : costCenter.code || costCenter.name || null;
  }
  return costCenterId ? "nastavljeno (podrobnosti niso na voljo)" : null;
}

function EnotaContextPanel({ context }: { context: EnotaContext }) {
  const costCenterLabel = formatCostCenter(context.costCenter, context.costCenterId);

  return (
    <div
      data-testid="izmena-enota-context"
      className="rounded-lg border bg-muted/30 p-3 space-y-2"
    >
      <div className="flex items-start gap-2">
        <Building2 className="h-4 w-4 mt-0.5 shrink-0 text-blue-600" />
        <div className="min-w-0">
          <p className="text-xs text-muted-foreground">Izmena se odpira za enoto:</p>
          {context.canOpen ? (
            <p className="font-semibold truncate" data-testid="izmena-enota-ime">
              {context.enotaIme}
            </p>
          ) : (
            <p className="text-sm font-medium text-destructive" data-testid="izmena-enota-manjka">
              Enota ni določena — obrni se na administratorja
            </p>
          )}
        </div>
      </div>

      <div className="flex items-start gap-2 text-sm">
        <MapPin className="h-4 w-4 mt-0.5 shrink-0 text-muted-foreground" />
        <div className="min-w-0">
          <span className="text-muted-foreground">Stroškovno mesto: </span>
          {costCenterLabel ? (
            <span data-testid="izmena-stroskovno-mesto">{costCenterLabel}</span>
          ) : (
            <span className="text-amber-700" data-testid="izmena-stroskovno-mesto-manjka">
              ni nastavljeno
            </span>
          )}
        </div>
      </div>

      {!context.canOpen && (
        <p className="text-xs text-destructive">
          Odpiranje izmene je onemogočeno, dokler administrator ne določi enote.
        </p>
      )}
    </div>
  );
}

function IzmenaLokacija({
  izmena,
  context,
}: {
  izmena: Izmena;
  context: EnotaContext;
}) {
  const enotaIme = izmena.enotaIme ?? context.enotaIme;
  const costCenterId = izmena.costCenterId ?? null;
  const costCenter = costCenterId === context.costCenterId ? context.costCenter : null;
  const costCenterLabel = formatCostCenter(costCenter, costCenterId);

  return (
    <div className="flex flex-col gap-0.5 text-xs" data-testid={`izmena-lokacija-${izmena.id}`}>
      <span className="flex items-center gap-1 font-medium">
        <Building2 className="h-3 w-3 text-blue-600" />
        {enotaIme ?? "Enota ni določena — obrni se na administratorja"}
      </span>
      <span className={costCenterLabel ? "text-muted-foreground" : "text-amber-700"}>
        SM: {costCenterLabel ?? "ni nastavljeno"}
      </span>
    </div>
  );
}


function AktivnaIzmenaCard({
  izmena,
  context,
  jeMoja,
  canManage,
  onClose,
  izmenaZapriPending
}: {
  izmena: Izmena;
  context: EnotaContext;
  jeMoja: boolean;
  canManage: boolean;
  onClose: (id: number) => void;
  izmenaZapriPending: boolean;
}) {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: odmori } = useListOdmori(izmena.id, {
    query: { enabled: canManage, queryKey: getListOdmoriQueryKey(izmena.id) },
  });
  const createOdmor = useCreateOdmor();
  const zapriOdmor = useZapriOdmor();

  const aktivniOdmor = odmori?.find(o => o.konec === null);

  const handleStartBreak = (vrsta: "placan" | "neplacan") => {
    createOdmor.mutate(
      { id: izmena.id, data: { vrsta } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListOdmoriQueryKey(izmena.id) });
          toast({ title: "Odmor začet" });
        },
        onError: () => toast({ title: "Napaka pri začetku odmora", variant: "destructive" })
      }
    );
  };

  const handleEndBreak = () => {
    if (!aktivniOdmor) return;
    zapriOdmor.mutate(
      { id: izmena.id, odmorId: aktivniOdmor.id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListOdmoriQueryKey(izmena.id) });
          toast({ title: "Odmor zaključen" });
        },
        onError: () => toast({ title: "Napaka pri zaključku odmora", variant: "destructive" })
      }
    );
  };

  return (
    <Card className={jeMoja ? "border-orange-200 bg-orange-50/40" : "border-muted"}>
      <CardHeader className="pb-2">
        <div className="flex items-start justify-between gap-2">
          <CardTitle className="text-base flex items-center gap-2">
            <User className="h-4 w-4 text-muted-foreground" />
            {izmena.natakarIme}
            {jeMoja && <span className="text-xs font-normal text-muted-foreground">(jaz)</span>}
          </CardTitle>
          <div className="flex flex-col items-end gap-1">
            {aktivniOdmor ? (
              <Badge className="bg-blue-100 text-blue-800 border-blue-200 shrink-0 text-xs">
                <Coffee className="h-3 w-3 mr-1" />
                Na odmoru
              </Badge>
            ) : (
              <Badge className={jeMoja ? "bg-orange-100 text-orange-800 border-orange-200 shrink-0 text-xs" : "bg-muted text-muted-foreground shrink-0 text-xs"}>
                <Clock className="h-3 w-3 mr-1" />
                Aktivna
              </Badge>
            )}
            {izmena.blagajnaIme && (
              <span className="text-xs text-muted-foreground">{izmena.blagajnaIme}</span>
            )}
          </div>
        </div>
      </CardHeader>
      <CardContent className="space-y-3">
        <IzmenaLokacija izmena={izmena} context={context} />
        <div className="grid grid-cols-2 gap-2 text-sm">
          <div>
            <p className="text-muted-foreground text-xs">Začetek</p>
            <p className="font-medium">{formatTime(izmena.zacetek)}</p>
          </div>
          <div>
            <p className="text-muted-foreground text-xs">Trajanje</p>
            <p className="font-medium">{elapsed(izmena.zacetek)}</p>
          </div>
        </div>
        <Separator />
        <div className="flex justify-between items-center text-sm">
          <span className="flex items-center gap-1 text-muted-foreground">
            <Receipt className="h-3.5 w-3.5" />
            {izmena.steviloRacunov} računov
          </span>
          <span className="flex items-center gap-1 font-semibold text-primary">
            <Euro className="h-3.5 w-3.5" />
            {formatEur(izmena.skupajZnesek)}
          </span>
        </div>
      </CardContent>
      {canManage && <CardFooter className="flex-col gap-2">
        {aktivniOdmor ? (
          <Button
            variant="outline"
            size="sm"
            className="w-full gap-2 border-blue-200 bg-blue-50 text-blue-800 hover:bg-blue-100 hover:text-blue-900"
            onClick={handleEndBreak}
            disabled={zapriOdmor.isPending}
          >
            <Coffee className="h-4 w-4" />
            Zaključi odmor
          </Button>
        ) : (
          <div className="flex gap-2 w-full">
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2"
              onClick={() => handleStartBreak("placan")}
              disabled={createOdmor.isPending || izmenaZapriPending}
            >
              <Coffee className="h-4 w-4" />
              Plačan odmor
            </Button>
            <Button
              variant="outline"
              size="sm"
              className="w-full gap-2"
              onClick={() => handleStartBreak("neplacan")}
              disabled={createOdmor.isPending || izmenaZapriPending}
            >
              <Coffee className="h-4 w-4" />
              Neplačan
            </Button>
          </div>
        )}
        <Button
          variant={jeMoja ? "destructive" : "outline"}
          size="sm"
          className="w-full gap-2"
          onClick={() => onClose(izmena.id)}
          disabled={izmenaZapriPending || Boolean(aktivniOdmor)}
        >
          <Square className="h-4 w-4" />
          Zaključi izmeno
        </Button>
      </CardFooter>}
    </Card>
  );
}

// ─── Osebni pogled za vloga==="uporabnik" ────────────────────────────────────


function UporabnikIzmenePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const enotaContext = useIzmenaEnotaContext();

  const { data: aktivne, isLoading: aktivneLoading } = useListAktivneIzmene();
  const { data: vse, isLoading: vseLoading } = useListIzmene({ aktivne: false });
  const { data: natakari } = useListNatakari();
  const openIzmena = useOpenIzmena();
  const zapriIzmeno = useZapriIzmeno();
  const predloziIzmeno = usePredloziIzmeno();

  const [closedIzmena, setClosedIzmena] = useState<Izmena | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  // Fallback: če ni natakariId, pustimo da ročno izbere
  const [selectedNatakarId, setSelectedNatakarId] = useState<string>("");
  const [pin, setPin] = useState("");

  const natakariId = user?.natakariId ?? null;

  // Mojaaktivna izmena
  const mojaAktivna = natakariId
    ? aktivne?.find(i => i.natakariId === natakariId) ?? null
    : null;

  // Moja zgodovina (samo zaprti)
  const mojaHistorija = natakariId
    ? (vse?.filter(i => i.natakariId === natakariId && i.konec != null) ?? [])
    : (vse?.filter(i => i.konec != null) ?? []);

  const aktivniNatakari = natakari?.filter(n => n.aktiven) ?? [];
  const aktivneIds = new Set(aktivne?.map(i => i.natakariId) ?? []);
  const razpolozljivi = aktivniNatakari.filter(n => !aktivneIds.has(n.id));

  const handleOpen = (nId: number) => {
    if (!enotaContext.canOpen) {
      toast({
        title: "Enota ni določena",
        description: "Obrnite se na administratorja, da določi enoto.",
        variant: "destructive",
      });
      return;
    }

    openIzmena.mutate(
      {
        data: {
          natakariId: nId,
          blagajnaId: user?.blagajnaId ?? null,
          aktivirajNatakarja: true,
          pin,
        },
      },
      {
        onSuccess: (data) => {
          const actorSession = (data as Izmena & {
            actorSession?: { token: string; natakarId: number } | null;
          }).actorSession;
          if (actorSession) {
            sessionStorage.setItem("pos_actor_session", actorSession.token);
            localStorage.setItem("pos_last_natakar_id", String(actorSession.natakarId));
            localStorage.setItem("pos_last_operator_id", String(actorSession.natakarId));
            notifyPosActorSessionChanged();
          }
          queryClient.invalidateQueries({ queryKey: getListAktivneIzmeneQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListIzmeneQueryKey() });
          setSelectedNatakarId("");
          setPin("");
          toast({ title: "Izmena odprta" });
        },
        onError: (err: Error) => toast({
          title: "Napaka",
          description: err.message ?? "Izmene ni bilo mogoče odpreti.",
          variant: "destructive",
        }),
      }
    );
  };

  const handleClose = (id: number) => {
    zapriIzmeno.mutate(
      { id },
      {
        onSuccess: (data) => {
          sessionStorage.removeItem("pos_actor_session");
          notifyPosActorSessionChanged();
          queryClient.invalidateQueries({ queryKey: getListAktivneIzmeneQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListIzmeneQueryKey() });
          setClosedIzmena(data);
          setShowSummary(true);
        },
        onError: () => toast({
          title: "Napaka",
          description: "Izmene ni bilo mogoče zapreti.",
          variant: "destructive",
        }),
      }
    );
  };

  const handleSubmitForApproval = (id: number) => {
    predloziIzmeno.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListIzmeneQueryKey() });
          toast({ title: "Ure so poslane v potrditev" });
        },
        onError: (err: Error) => toast({
          title: "Pošiljanje ni uspelo",
          description: err.message,
          variant: "destructive",
        }),
      },
    );
  };

  return (
    <div className="p-8 space-y-6 flex-1 overflow-auto">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Izmene</h1>
        <p className="text-muted-foreground mt-1">Odprite in zaprite svojo delovno izmeno</p>
      </div>

      {/* Gumb za odpiranje izmene */}
      {aktivneLoading ? (
        <Skeleton className="h-40 rounded-xl" />
      ) : natakariId ? (
        !mojaAktivna && (
          <Card>
            <CardHeader>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <CardTitle className="flex items-center gap-2">
                    <Play className="h-5 w-5 text-green-600" />
                    Začni izmeno
                  </CardTitle>
                  <CardDescription className="mt-1">
                    Odprite svojo delovno izmeno. Vsi računi, izdani med izmeno, bodo pripisani vam.
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="space-y-4">
              <EnotaContextPanel context={enotaContext} />
              <SecretInput
                id="open-shift-pin"
                ariaLabel="PIN za odprtje izmene"
                value={pin}
                onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 12))}
                inputMode="numeric"
                placeholder="Osebni PIN"
                className="max-w-xs"
              />
              <Button
                className="gap-2"
                onClick={() => handleOpen(natakariId)}
                disabled={!enotaContext.canOpen || pin.length < 4 || openIzmena.isPending}
              >
                <Play className="h-4 w-4" />
                Odpri izmeno
              </Button>
            </CardContent>
          </Card>
        )
      ) : (
        /* Ni natakariId — ročna izbira (fallback) */
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <AlertCircle className="h-5 w-5 text-amber-500" />
              Natakarjev profil ni vezan na vaš račun
            </CardTitle>
            <CardDescription>
              Administrator mora v nastavitvah natakarjev povezati vaš Clerk račun z natakarskim profilom.
              Do takrat lahko izmeno odprete ročno.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <EnotaContextPanel context={enotaContext} />
            <SecretInput
              id="open-shift-fallback-pin"
              ariaLabel="PIN za odprtje izmene"
              value={pin}
              onChange={event => setPin(event.target.value.replace(/\D/g, "").slice(0, 12))}
              inputMode="numeric"
              placeholder="Osebni PIN"
              className="max-w-xs"
            />
            {aktivniNatakari.length > 0 && (
              <div className="flex gap-3 items-center">
                <Select value={selectedNatakarId} onValueChange={setSelectedNatakarId}>
                  <SelectTrigger className="max-w-xs">
                    <SelectValue placeholder="Izberi natakarjev profil..." />
                  </SelectTrigger>
                  <SelectContent>
                    {razpolozljivi.map(n => (
                      <SelectItem key={n.id} value={String(n.id)}>
                        {n.ime} {n.priimek}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Button
                  disabled={!enotaContext.canOpen || !selectedNatakarId || pin.length < 4 || openIzmena.isPending}
                  onClick={() => handleOpen(parseInt(selectedNatakarId))}
                  className="gap-2"
                >
                  <Play className="h-4 w-4" />
                  Odpri izmeno
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* VSE aktivne izmene na tej enoti */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Clock className="h-5 w-5 text-orange-500" />
          Aktivne izmene
        </h2>
        {aktivneLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-28 rounded-xl" />
          </div>
        ) : aktivne?.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground text-sm">
              <TimerOff className="h-8 w-8 mx-auto mb-2 opacity-40" />
              Ni odprtih izmen na tej enoti.
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {aktivne?.map(izmena => (
              <AktivnaIzmenaCard
                key={izmena.id}
                izmena={izmena}
                context={enotaContext}
                jeMoja={izmena.natakariId === natakariId}
                canManage={izmena.natakariId === natakariId}
                onClose={handleClose}
                izmenaZapriPending={zapriIzmeno.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* Moja zgodovina izmen */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <TimerReset className="h-5 w-5 text-muted-foreground" />
          Moje pretekle izmene
        </h2>

        {vseLoading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : mojaHistorija.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground text-sm">
              <TimerOff className="h-8 w-8 mx-auto mb-2 opacity-40" />
              Ni zgodovine izmen.
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-xl border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Datum</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Začetek</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Konec</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground hidden sm:table-cell">Enota / Blagajna</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Računi</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Promet</th>
                   <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Potrditev</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[...mojaHistorija].reverse().map(izmena => {
                  const ms = izmena.konec
                    ? new Date(izmena.konec).getTime() - new Date(izmena.zacetek).getTime()
                    : 0;
                  const h = Math.floor(ms / 3600000);
                  const m = Math.floor((ms % 3600000) / 60000);
                  const trajanje = h > 0 ? `${h}h ${m}m` : `${m}m`;
                  return (
                    <tr key={izmena.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(izmena.zacetek)}</td>
                      <td className="px-4 py-3">{formatTime(izmena.zacetek)}</td>
                      <td className="px-4 py-3">
                        {izmena.konec ? formatTime(izmena.konec) : "—"}
                        {izmena.konec && <span className="ml-1.5 text-xs text-muted-foreground">({trajanje})</span>}
                      </td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="flex flex-col gap-1">
                          <IzmenaLokacija izmena={izmena} context={enotaContext} />
                          {izmena.blagajnaIme && (
                            <span className="text-xs text-muted-foreground">{izmena.blagajnaIme}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">{izmena.steviloRacunov}</td>
                      <td className="px-4 py-3 text-right font-semibold text-primary">
                        {formatEur(izmena.skupajZnesek)}
                      </td>
                       <td className="px-4 py-3 text-right">
                         {natakariId === izmena.natakariId && (izmena.status === "osnutek" || izmena.status === "zavrnjeno") ? (
                           <Button
                             size="sm"
                             variant="outline"
                             onClick={() => handleSubmitForApproval(izmena.id)}
                             disabled={predloziIzmeno.isPending}
                           >
                             Pošlji v potrditev
                           </Button>
                         ) : (
                           <Badge variant="outline">{statusLabel(izmena.status)}</Badge>
                         )}
                       </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CloseSummaryDialog
        izmena={closedIzmena}
        open={showSummary}
        onClose={() => setShowSummary(false)}
      />
    </div>
  );
}

// ─── Admin/admin_enote pogled ────────────────────────────────────────────────

export default function IzmenePage() {
  const { user } = useAuth();

  // Uporabnik dobi osebni pogled
  if (user?.vloga === "uporabnik") {
    return <UporabnikIzmenePage />;
  }

  return <AdminIzmenePage />;
}

function AdminIzmenePage() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const enotaContext = useIzmenaEnotaContext();

  const { data: aktivne, isLoading: aktivneLoading } = useListAktivneIzmene();
  const { data: vse, isLoading: vseLoading } = useListIzmene({ aktivne: false });
  const { data: natakari } = useListNatakari();
  const openIzmena = useOpenIzmena();
  const zapriIzmeno = useZapriIzmeno();

  const [selectedNatakarId, setSelectedNatakarId] = useState<string>("");
  const [closedIzmena, setClosedIzmena] = useState<Izmena | null>(null);
  const [showSummary, setShowSummary] = useState(false);

  const aktivniNatakari = natakari?.filter(n => n.aktiven) ?? [];
  const aktivneIds = new Set(aktivne?.map(i => i.natakariId) ?? []);
  const razpolozljivi = aktivniNatakari.filter(n => !aktivneIds.has(n.id));

  const pretekle = vse?.filter(i => i.konec != null) ?? [];

  const handleOpen = () => {
    if (!selectedNatakarId || !enotaContext.canOpen) {
      if (!enotaContext.canOpen) {
        toast({
          title: "Enota ni določena",
          description: "Obrnite se na administratorja, da določi enoto.",
          variant: "destructive",
        });
      }
      return;
    }

    openIzmena.mutate(
      { data: { natakariId: parseInt(selectedNatakarId), blagajnaId: user?.blagajnaId ?? null } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: getListAktivneIzmeneQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListIzmeneQueryKey() });
          setSelectedNatakarId("");
          toast({ title: "Izmena odprta" });
        },
        onError: (err: Error) => toast({
          title: "Napaka",
          description: err.message ?? "Izmene ni bilo mogoče odpreti.",
          variant: "destructive",
        }),
      }
    );
  };

  const handleClose = (id: number) => {
    zapriIzmeno.mutate(
      { id },
      {
        onSuccess: (data) => {
          queryClient.invalidateQueries({ queryKey: getListAktivneIzmeneQueryKey() });
          queryClient.invalidateQueries({ queryKey: getListIzmeneQueryKey() });
          setClosedIzmena(data);
          setShowSummary(true);
        },
        onError: () => toast({
          title: "Napaka",
          description: "Izmene ni bilo mogoče zapreti.",
          variant: "destructive",
        }),
      }
    );
  };

  return (
    <div className="p-8 space-y-6 flex-1 overflow-auto">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Izmene</h1>
          <p className="text-muted-foreground mt-1">Upravljanje delovnih izmen natakarjev</p>
        </div>
      </div>

      {/* Open new shift */}
      <Card>
        <CardHeader>
          <div className="flex items-start justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2">
                <Play className="h-5 w-5 text-green-600" />
                Odpri novo izmeno
              </CardTitle>
              <CardDescription className="mt-1">
                Izberi natakarja in odpri izmeno. Vsi računi, izdani med izmeno, bodo samodejno pripisani tej izmeni.
              </CardDescription>
            </div>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <EnotaContextPanel context={enotaContext} />
          {razpolozljivi.length === 0 && aktivniNatakari.length > 0 ? (
            <p className="text-sm text-muted-foreground">Vsi aktivni natakarji imajo odprto izmeno na tej enoti.</p>
          ) : aktivniNatakari.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ni aktivnih natakarjev. Dodajte jih v <strong>Nastavitvah</strong>.
            </p>
          ) : (
            <div className="flex flex-col sm:flex-row gap-3 sm:items-center">
              <Select value={selectedNatakarId} onValueChange={setSelectedNatakarId}>
                <SelectTrigger className="w-full sm:max-w-xs">
                  <SelectValue placeholder="Izberi natakarja..." />
                </SelectTrigger>
                <SelectContent>
                  {razpolozljivi.map(n => (
                    <SelectItem key={n.id} value={String(n.id)}>
                      {n.ime} {n.priimek}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                disabled={!enotaContext.canOpen || !selectedNatakarId || openIzmena.isPending}
                onClick={handleOpen}
                className="gap-2 w-full sm:w-auto"
              >
                <Play className="h-4 w-4" />
                Začni izmeno
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Active shifts */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Clock className="h-5 w-5 text-orange-500" />
          Aktivne izmene
        </h2>

        {aktivneLoading ? (
          <div className="space-y-3">
            <Skeleton className="h-28 rounded-xl" />
            <Skeleton className="h-28 rounded-xl" />
          </div>
        ) : aktivne?.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              <TimerOff className="h-10 w-10 mx-auto mb-3 opacity-40" />
              <p>Ni odprtih izmen.</p>
            </CardContent>
          </Card>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
            {aktivne?.map(izmena => (
              <AktivnaIzmenaCard
                key={izmena.id}
                izmena={izmena}
                context={enotaContext}
                jeMoja={izmena.natakariId === user?.natakariId}
                canManage
                onClose={handleClose}
                izmenaZapriPending={zapriIzmeno.isPending}
              />
            ))}
          </div>
        )}
      </div>

      {/* History */}
      <div className="space-y-3">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <TimerReset className="h-5 w-5 text-muted-foreground" />
          Zaprte izmene
        </h2>

        {vseLoading ? (
          <Skeleton className="h-40 rounded-xl" />
        ) : pretekle.length === 0 ? (
          <Card>
            <CardContent className="p-6 text-center text-muted-foreground text-sm">
              Ni zgodovine izmen.
            </CardContent>
          </Card>
        ) : (
          <div className="rounded-xl border overflow-hidden">
            <div className="divide-y sm:hidden" data-testid="zaprte-izmene-mobile">
              {[...pretekle].reverse().map(izmena => {
                const ms = izmena.konec
                  ? new Date(izmena.konec).getTime() - new Date(izmena.zacetek).getTime()
                  : 0;
                const h = Math.floor(ms / 3600000);
                const m = Math.floor((ms % 3600000) / 60000);
                const trajanje = h > 0 ? `${h}h ${m}m` : `${m}m`;
                return (
                  <div key={izmena.id} className="space-y-2 p-3">
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{izmena.natakarIme}</p>
                        <p className="text-xs text-muted-foreground">{formatDate(izmena.zacetek)}</p>
                      </div>
                      <p className="shrink-0 font-semibold text-primary">
                        {formatEur(izmena.skupajZnesek)}
                      </p>
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-muted-foreground">Začetek</p>
                        <p className="font-medium">{formatTime(izmena.zacetek)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Konec</p>
                        <p className="font-medium">{izmena.konec ? formatTime(izmena.konec) : "—"}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground">Trajanje</p>
                        <p className="font-medium">{izmena.konec ? trajanje : "—"}</p>
                      </div>
                    </div>
                    <div className="flex items-center justify-between gap-3 border-t pt-2 text-xs">
                      <div className="min-w-0">
                        <IzmenaLokacija izmena={izmena} context={enotaContext} />
                        {izmena.blagajnaIme && (
                          <p className="truncate text-muted-foreground">{izmena.blagajnaIme}</p>
                        )}
                      </div>
                      <p className="shrink-0">
                        <span className="text-muted-foreground">Računi: </span>
                        <span className="font-semibold">{izmena.steviloRacunov}</span>
                      </p>
                    </div>
                  </div>
                );
              })}
            </div>
            <table className="hidden w-full text-sm sm:table">
              <thead className="bg-muted/50">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Datum</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Natakar</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground hidden sm:table-cell">Enota / Blagajna</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Začetek</th>
                  <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Konec</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Računi</th>
                  <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Promet</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {[...pretekle].reverse().map(izmena => {
                  const ms = izmena.konec
                    ? new Date(izmena.konec).getTime() - new Date(izmena.zacetek).getTime()
                    : 0;
                  const h = Math.floor(ms / 3600000);
                  const m = Math.floor((ms % 3600000) / 60000);
                  const trajanje = h > 0 ? `${h}h ${m}m` : `${m}m`;

                  return (
                    <tr key={izmena.id} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 text-muted-foreground">{formatDate(izmena.zacetek)}</td>
                      <td className="px-4 py-3 font-medium">{izmena.natakarIme}</td>
                      <td className="px-4 py-3 hidden sm:table-cell">
                        <div className="flex flex-col gap-1">
                          <IzmenaLokacija izmena={izmena} context={enotaContext} />
                          {izmena.blagajnaIme && (
                            <span className="text-xs text-muted-foreground">{izmena.blagajnaIme}</span>
                          )}
                        </div>
                      </td>
                      <td className="px-4 py-3">{formatTime(izmena.zacetek)}</td>
                      <td className="px-4 py-3">
                        {izmena.konec ? formatTime(izmena.konec) : "—"}
                        {izmena.konec && <span className="ml-1.5 text-xs text-muted-foreground">({trajanje})</span>}
                      </td>
                      <td className="px-4 py-3 text-right">{izmena.steviloRacunov}</td>
                      <td className="px-4 py-3 text-right font-semibold text-primary">
                        {formatEur(izmena.skupajZnesek)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <CloseSummaryDialog
        izmena={closedIzmena}
        open={showSummary}
        onClose={() => setShowSummary(false)}
      />
    </div>
  );
}
