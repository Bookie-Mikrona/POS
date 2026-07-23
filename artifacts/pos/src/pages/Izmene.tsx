import { useState } from "react";
import {
  useListIzmene,
  useListAktivneIzmene,
  useOpenIzmena,
  useZapriIzmeno,
  useListNatakari,
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
import {
  Clock, Play, Square, User, Euro, Receipt,
  CheckCircle2, TimerOff, TimerReset, AlertCircle, Building2,
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
              <span className="text-2xl font-bold text-primary">{izmena.skupajZnesek.toFixed(2)} €</span>
            </div>
          </div>
          <Button className="w-full" onClick={onClose}>Zapri</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

// ─── Pomožna komponenta: značka enote ────────────────────────────────────────

function EnotaBadge({ enotaIme }: { enotaIme?: string | null }) {
  if (!enotaIme) return null;
  return (
    <Badge variant="outline" className="text-xs font-normal gap-1 border-blue-200 text-blue-700 bg-blue-50">
      <Building2 className="h-3 w-3" />
      {enotaIme}
    </Badge>
  );
}

// ─── Osebni pogled za vloga==="uporabnik" ────────────────────────────────────

function UporabnikIzmenePage() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const { data: aktivne, isLoading: aktivneLoading } = useListAktivneIzmene();
  const { data: vse, isLoading: vseLoading } = useListIzmene({ aktivne: false });
  const { data: natakari } = useListNatakari();
  const openIzmena = useOpenIzmena();
  const zapriIzmeno = useZapriIzmeno();

  const [closedIzmena, setClosedIzmena] = useState<Izmena | null>(null);
  const [showSummary, setShowSummary] = useState(false);
  // Fallback: če ni natakariId, pustimo da ročno izbere
  const [selectedNatakarId, setSelectedNatakarId] = useState<string>("");

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
    openIzmena.mutate(
      { data: { natakariId: nId, blagajnaId: user?.blagajnaId ?? null } },
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
                    Odprite svojo delovno izmeno{user?.enotaIme ? ` za enoto "${user.enotaIme}"` : ""}. Vsi računi, izdani med izmeno, bodo pripisani vam.
                  </CardDescription>
                </div>
                {user?.enotaIme && <EnotaBadge enotaIme={user.enotaIme} />}
              </div>
            </CardHeader>
            <CardContent>
              <Button
                className="gap-2"
                onClick={() => handleOpen(natakariId)}
                disabled={openIzmena.isPending}
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
          {(aktivniNatakari.length > 0) && (
            <CardContent>
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
                  disabled={!selectedNatakarId || openIzmena.isPending}
                  onClick={() => handleOpen(parseInt(selectedNatakarId))}
                  className="gap-2"
                >
                  <Play className="h-4 w-4" />
                  Odpri izmeno
                </Button>
              </div>
            </CardContent>
          )}
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
            {aktivne?.map(izmena => {
              const jeMoja = izmena.natakariId === natakariId;
              return (
                <Card key={izmena.id} className={jeMoja ? "border-orange-200 bg-orange-50/40" : "border-muted"}>
                  <CardHeader className="pb-2">
                    <div className="flex items-start justify-between gap-2">
                      <CardTitle className="text-base flex items-center gap-2">
                        <User className="h-4 w-4 text-muted-foreground" />
                        {izmena.natakarIme}
                        {jeMoja && <span className="text-xs font-normal text-muted-foreground">(jaz)</span>}
                      </CardTitle>
                      <div className="flex flex-col items-end gap-1">
                        <Badge className={jeMoja ? "bg-orange-100 text-orange-800 border-orange-200 shrink-0 text-xs" : "bg-muted text-muted-foreground shrink-0 text-xs"}>
                          <Clock className="h-3 w-3 mr-1" />
                          Aktivna
                        </Badge>
                        {izmena.blagajnaIme && (
                          <span className="text-xs text-muted-foreground">{izmena.blagajnaIme}</span>
                        )}
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-2">
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
                        {izmena.skupajZnesek.toFixed(2)} €
                      </span>
                    </div>
                  </CardContent>
                  <CardFooter>
                    <Button
                      variant={jeMoja ? "destructive" : "outline"}
                      size="sm"
                      className="w-full gap-2"
                      onClick={() => handleClose(izmena.id)}
                      disabled={zapriIzmeno.isPending}
                    >
                      <Square className="h-4 w-4" />
                      Zaključi izmeno
                    </Button>
                  </CardFooter>
                </Card>
              );
            })}
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
                        <div className="flex flex-col gap-0.5">
                          {izmena.enotaIme && <span className="text-xs font-medium">{izmena.enotaIme}</span>}
                          {izmena.blagajnaIme && <span className="text-xs text-muted-foreground">{izmena.blagajnaIme}</span>}
                          {!izmena.enotaIme && !izmena.blagajnaIme && <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3 text-right">{izmena.steviloRacunov}</td>
                      <td className="px-4 py-3 text-right font-semibold text-primary">
                        {izmena.skupajZnesek.toFixed(2)} €
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
    if (!selectedNatakarId) return;
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
                Izberi natakarja in odpri izmeno za{user?.enotaIme ? ` enoto "${user.enotaIme}"` : " trenutno enoto"}. Vsi računi, izdani med izmeno, bodo samodejno pripisani tej izmeni.
              </CardDescription>
            </div>
            {user?.enotaIme && <EnotaBadge enotaIme={user.enotaIme} />}
          </div>
        </CardHeader>
        <CardContent>
          {razpolozljivi.length === 0 && aktivniNatakari.length > 0 ? (
            <p className="text-sm text-muted-foreground">Vsi aktivni natakarji imajo odprto izmeno na tej enoti.</p>
          ) : aktivniNatakari.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ni aktivnih natakarjev. Dodajte jih v <strong>Nastavitvah</strong>.
            </p>
          ) : (
            <div className="flex gap-3 items-center">
              <Select value={selectedNatakarId} onValueChange={setSelectedNatakarId}>
                <SelectTrigger className="max-w-xs">
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
                disabled={!selectedNatakarId || openIzmena.isPending}
                onClick={handleOpen}
                className="gap-2"
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
              <Card key={izmena.id} className="border-orange-200 bg-orange-50/40">
                <CardHeader className="pb-2">
                  <div className="flex items-start justify-between gap-2">
                    <CardTitle className="text-lg flex items-center gap-2">
                      <User className="h-5 w-5 text-muted-foreground" />
                      {izmena.natakarIme}
                    </CardTitle>
                    <div className="flex flex-col items-end gap-1">
                      <Badge className="bg-orange-100 text-orange-800 border-orange-200 shrink-0">
                        <Clock className="h-3 w-3 mr-1" />
                        Aktivna
                      </Badge>
                      <EnotaBadge enotaIme={izmena.enotaIme} />
                    </div>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
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
                      {izmena.skupajZnesek.toFixed(2)} €
                    </span>
                  </div>
                </CardContent>
                <CardFooter>
                  <Button
                    variant="destructive"
                    size="sm"
                    className="w-full gap-2"
                    onClick={() => handleClose(izmena.id)}
                    disabled={zapriIzmeno.isPending}
                  >
                    <Square className="h-4 w-4" />
                    Zaključi izmeno
                  </Button>
                </CardFooter>
              </Card>
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
            <table className="w-full text-sm">
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
                        <div className="flex flex-col gap-0.5">
                          {izmena.enotaIme && <span className="text-xs font-medium">{izmena.enotaIme}</span>}
                          {izmena.blagajnaIme && <span className="text-xs text-muted-foreground">{izmena.blagajnaIme}</span>}
                          {!izmena.enotaIme && !izmena.blagajnaIme && <span className="text-xs text-muted-foreground">—</span>}
                        </div>
                      </td>
                      <td className="px-4 py-3">{formatTime(izmena.zacetek)}</td>
                      <td className="px-4 py-3">
                        {izmena.konec ? formatTime(izmena.konec) : "—"}
                        {izmena.konec && <span className="ml-1.5 text-xs text-muted-foreground">({trajanje})</span>}
                      </td>
                      <td className="px-4 py-3 text-right">{izmena.steviloRacunov}</td>
                      <td className="px-4 py-3 text-right font-semibold text-primary">
                        {izmena.skupajZnesek.toFixed(2)} €
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
