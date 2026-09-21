import { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { format, isSameDay, isAfter, isBefore, addDays, startOfDay, endOfDay, parseISO } from "date-fns";
import { sl } from "date-fns/locale";
import { Calendar as CalendarIcon, Clock, MapPin, Phone, Search, SlidersHorizontal, Plus, MoreHorizontal, Check, X, History, Trash2, Edit2, Info, CheckCircle2, RotateCcw } from "lucide-react";

import { useListRezervacije, useListEnote, useReleaseRezervacijaMize, useListRezervacijaMizeZgodovina, getListRezervacijeQueryKey, getListRezervacijaMizeZgodovinaQueryKey, useListMize } from "@workspace/api-client-react";
import type { RezervacijaKoledar, RezervacijaMizeZgodovina, Miza } from "@workspace/api-client-react";

import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { formatPosCas, formatPosDatum } from "@/lib/posCas";

import { RazpolozljivostMizDialog } from "@/components/RazpolozljivostMizDialog";
import { RezervacijaDialog } from "@/components/RezervacijaDialog";

function ZgodovinaDialog({ rezervacijaId, mizaId, open, onOpenChange }: { rezervacijaId: number | null, mizaId: number | null, open: boolean, onOpenChange: (o: boolean) => void }) {
  const { data: zgodovina, isLoading } = useListRezervacijaMizeZgodovina(mizaId!, rezervacijaId!, {
    query: { 
      enabled: open && !!rezervacijaId && !!mizaId,
      queryKey: getListRezervacijaMizeZgodovinaQueryKey(mizaId!, rezervacijaId!)
    }
  });

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <History className="w-5 h-5" />
            Zgodovina rezervacije
          </DialogTitle>
        </DialogHeader>
        {isLoading ? (
          <div className="py-8 text-center text-muted-foreground">Nalaganje zgodovine...</div>
        ) : !zgodovina || zgodovina.length === 0 ? (
          <div className="py-8 text-center text-muted-foreground">Zgodovina ni na voljo.</div>
        ) : (
          <div className="space-y-4 relative before:absolute before:inset-0 before:ml-5 before:-translate-x-px md:before:mx-auto md:before:translate-x-0 before:h-full before:w-0.5 before:bg-gradient-to-b before:from-transparent before:via-muted-foreground/20 before:to-transparent pt-2">
            {zgodovina.map((z, idx) => {
              const date = new Date(z.ustvarjeno);
              const dataStr = typeof z.podatki === "object" ? JSON.stringify(z.podatki, null, 2) : String(z.podatki);
              
              let Icon = Info;
              let bg = "bg-blue-100 text-blue-600";
              let dogodek = z.dogodek as string;
              
              if (dogodek === "ustvarjena") { Icon = Plus; bg = "bg-green-100 text-green-600"; }
              else if (dogodek === "spremenjena") { Icon = Edit2; bg = "bg-amber-100 text-amber-600"; }
              else if (dogodek === "sproscena" || dogodek === "odstranjena") { Icon = X; bg = "bg-red-100 text-red-600"; }
              
              return (
                <div key={z.id} className="relative flex items-center justify-between md:justify-normal md:odd:flex-row-reverse group is-active">
                  <div className="flex items-center justify-center w-10 h-10 rounded-full border-4 border-background shrink-0 md:order-1 md:group-odd:-translate-x-1/2 md:group-even:translate-x-1/2 shadow-sm z-10 bg-background">
                    <div className={`w-full h-full rounded-full flex items-center justify-center ${bg}`}>
                      <Icon className="w-4 h-4" />
                    </div>
                  </div>
                  <div className="w-[calc(100%-4rem)] md:w-[calc(50%-2.5rem)] bg-card p-3 rounded-xl border shadow-sm">
                    <div className="flex items-center justify-between mb-1">
                      <span className="font-semibold text-sm capitalize">{dogodek}</span>
                      <span className="text-[10px] text-muted-foreground">{formatPosDatum(z.ustvarjeno)}, {formatPosCas(z.ustvarjeno)}</span>
                    </div>
                    {z.actorClerkUserId && <div className="text-xs text-muted-foreground mb-2">Uporabnik: {z.actorClerkUserId}</div>}
                    <pre className="text-[10px] bg-muted p-2 rounded overflow-x-auto whitespace-pre-wrap max-h-32 text-muted-foreground font-mono">
                      {dataStr}
                    </pre>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

export default function Rezervacije() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  
  const todayIso = format(new Date(), "yyyy-MM-dd");
  const defaultDo = format(addDays(new Date(), 30), "yyyy-MM-dd");
  
  const [filterOd, setFilterOd] = useState<string>(todayIso);
  const [filterDo, setFilterDo] = useState<string>(defaultDo);
  const [filterEnota, setFilterEnota] = useState<string>(user?.enotaId ? String(user.enotaId) : "all");
  const [filterStatus, setFilterStatus] = useState<string>("aktivne"); // aktivne, vse
  const [search, setSearch] = useState("");
  
  const { data: enote } = useListEnote();
  const { data: mize } = useListMize();
  
  const queryParams = {
    od: filterOd ? new Date(filterOd).toISOString() : undefined,
    do: filterDo ? endOfDay(new Date(filterDo)).toISOString() : undefined,
    enotaId: filterEnota !== "all" ? Number(filterEnota) : undefined,
  };

  const { data: rezervacije, isLoading, isError } = useListRezervacije(queryParams, {
    query: { queryKey: getListRezervacijeQueryKey(queryParams) }
  });
  
  const releaseRezervacija = useReleaseRezervacijaMize();
  
  // Dialogs
  const [razpolozljivostOpen, setRazpolozljivostOpen] = useState(false);
  const [rezervacijaOpen, setRezervacijaOpen] = useState(false);
  
  const [selectedMiza, setSelectedMiza] = useState<Miza | null>(null);
  const [editRezervacijaObj, setEditRezervacijaObj] = useState<any>(null);
  const [initialDate, setInitialDate] = useState<string | null>(null);
  
  const [zgodovinaOpen, setZgodovinaOpen] = useState(false);
  const [zgodovinaTarget, setZgodovinaTarget] = useState<{ id: number, mizaId: number } | null>(null);

  const filtered = useMemo(() => {
    if (!rezervacije) return [];
    let f = rezervacije;
    
    if (filterStatus === "aktivne") {
      f = f.filter(r => r.status === "aktivna");
    }
    
    if (search.trim()) {
      const s = search.toLowerCase();
      f = f.filter(r => 
        r.strankaIme.toLowerCase().includes(s) || 
        r.telefon.includes(s) || 
        (r.mizaIme || "").toLowerCase().includes(s) ||
        (r.opomba || "").toLowerCase().includes(s)
      );
    }
    
    // Sort by date/time ascending
    f.sort((a, b) => new Date(a.zacetek).getTime() - new Date(b.zacetek).getTime());
    
    return f;
  }, [rezervacije, filterStatus, search]);
  
  const handleNovaRezervacija = () => {
    setRazpolozljivostOpen(true);
  };
  
  const handleIzberiMizo = (miza: Miza, zacetekIso: string) => {
    setRazpolozljivostOpen(false);
    setSelectedMiza(miza);
    setEditRezervacijaObj(null);
    setInitialDate(zacetekIso);
    setRezervacijaOpen(true);
  };
  
  const handleEdit = (rez: RezervacijaKoledar) => {
    const miza = mize?.find(m => m.id === rez.mizaId);
    if (!miza) {
      toast({ title: "Napaka", description: "Podatkov o mizi ni mogoče najti.", variant: "destructive" });
      return;
    }
    setSelectedMiza(miza);
    setEditRezervacijaObj({
      id: rez.id,
      mizaId: rez.mizaId,
      strankaIme: rez.strankaIme,
      telefon: rez.telefon,
      zacetek: rez.zacetek,
      opomba: rez.opomba,
    });
    setInitialDate(null);
    setRezervacijaOpen(true);
  };
  
  const handlePreklici = (rez: RezervacijaKoledar) => {
    if (!confirm(`Zanesljivo prekličete rezervacijo za ${rez.strankaIme}?`)) return;
    
    releaseRezervacija.mutate(
      { id: rez.mizaId, rezervacijaId: rez.id },
      {
        onSuccess: () => {
          toast({ title: "Rezervacija preklicana" });
          queryClient.invalidateQueries({ queryKey: getListRezervacijeQueryKey() });
        },
        onError: () => toast({ title: "Napaka pri preklicu", variant: "destructive" })
      }
    );
  };
  
  const openZgodovina = (rez: RezervacijaKoledar) => {
    setZgodovinaTarget({ id: rez.id, mizaId: rez.mizaId });
    setZgodovinaOpen(true);
  };

  const isZasedena = (rez: RezervacijaKoledar) => {
    // Basic heuristics: if it's less than 2 hours since zacetek, it might be happening
    const start = new Date(rez.zacetek).getTime();
    const now = Date.now();
    return rez.status === "aktivna" && now >= start && now <= start + 2 * 60 * 60 * 1000;
  };
  const isPast = (rez: RezervacijaKoledar) => {
    return new Date(rez.zacetek).getTime() + 2 * 60 * 60 * 1000 < Date.now();
  };

  return (
    <div className="flex-1 flex flex-col h-full bg-muted/20 overflow-hidden">
      <div className="border-b bg-background px-4 py-4 md:px-6 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Rezervacije miz</h1>
          <p className="text-sm text-muted-foreground">Pregled in upravljanje prihajajočih dogodkov po mizah.</p>
        </div>
        <Button onClick={handleNovaRezervacija} size="sm" className="w-full sm:w-auto">
          <Plus className="w-4 h-4 mr-2" />
          Nova rezervacija
        </Button>
      </div>
      
      <div className="flex-1 p-4 md:p-6 overflow-hidden flex flex-col">
        <Card className="mb-4 shrink-0 shadow-sm border-muted">
          <CardContent className="p-3 md:p-4">
            <div className="flex flex-col md:flex-row gap-3">
              <div className="relative flex-1">
                <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
                <Input
                  type="search"
                  placeholder="Išči stranko, telefon, mizo..."
                  className="pl-9 bg-background"
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                />
              </div>
              <div className="flex gap-2 overflow-x-auto pb-1 md:pb-0">
                <div className="flex items-center gap-1.5 shrink-0 bg-background border rounded-md px-2 focus-within:ring-1 ring-primary">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold pl-1">Od</span>
                  <Input 
                    type="date" 
                    className="border-0 shadow-none focus-visible:ring-0 px-1 py-1 h-8 w-32" 
                    value={filterOd} 
                    onChange={e => setFilterOd(e.target.value)}
                  />
                </div>
                <div className="flex items-center gap-1.5 shrink-0 bg-background border rounded-md px-2 focus-within:ring-1 ring-primary">
                  <span className="text-xs text-muted-foreground uppercase tracking-wider font-semibold pl-1">Do</span>
                  <Input 
                    type="date" 
                    className="border-0 shadow-none focus-visible:ring-0 px-1 py-1 h-8 w-32" 
                    value={filterDo} 
                    onChange={e => setFilterDo(e.target.value)}
                  />
                </div>
                {enote && enote.length > 1 && (
                  <Select value={filterEnota} onValueChange={setFilterEnota}>
                    <SelectTrigger className="w-[140px] shrink-0 bg-background h-10">
                      <SelectValue placeholder="Vse enote" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">Vse enote</SelectItem>
                      {enote.map(e => <SelectItem key={e.id} value={String(e.id)}>{e.ime}</SelectItem>)}
                    </SelectContent>
                  </Select>
                )}
                <Select value={filterStatus} onValueChange={setFilterStatus}>
                  <SelectTrigger className="w-[130px] shrink-0 bg-background h-10">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="aktivne">Samo aktivne</SelectItem>
                    <SelectItem value="vse">Vse (tudi pretekle/preklicane)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
          </CardContent>
        </Card>
        
        <div className="flex-1 overflow-auto rounded-xl border bg-card shadow-sm">
          {isLoading ? (
            <div className="h-full flex items-center justify-center text-muted-foreground p-8">
              <RotateCcw className="w-6 h-6 mr-3 animate-spin" />
              Nalaganje rezervacij...
            </div>
          ) : isError ? (
            <div className="h-full flex items-center justify-center text-destructive p-8 flex-col gap-2">
              <Info className="w-8 h-8" />
              <p>Napaka pri nalaganju rezervacij.</p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="h-full flex flex-col items-center justify-center text-muted-foreground p-8 text-center max-w-md mx-auto">
              <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center mb-4">
                <CalendarIcon className="w-8 h-8 opacity-50" />
              </div>
              <h3 className="text-lg font-semibold text-foreground mb-2">Ni najdenih rezervacij</h3>
              <p className="text-sm mb-6">Za izbrano obdobje in filtre ni najdena nobena rezervacija. Preverite filtre ali dodajte novo rezervacijo.</p>
              <Button onClick={handleNovaRezervacija}>
                <Plus className="w-4 h-4 mr-2" />
                Nova rezervacija
              </Button>
            </div>
          ) : (
            <div className="divide-y divide-border">
              {filtered.map(rez => {
                const zacetekDate = new Date(rez.zacetek);
                const aktivna = rez.status === "aktivna";
                const zasedena = isZasedena(rez);
                const past = isPast(rez);
                const jeAktivnaEnota = rez.enotaId === user?.enotaId;
                
                return (
                  <div key={rez.id} className={`flex flex-col sm:flex-row sm:items-center justify-between p-4 md:p-5 gap-4 transition-colors hover:bg-muted/30 ${!aktivna ? 'opacity-70 grayscale-[0.5]' : ''}`}>
                    <div className="flex items-start gap-4">
                      <div className="hidden sm:flex flex-col items-center justify-center bg-muted rounded-lg p-2 min-w-16 shrink-0 border shadow-inner text-center">
                        <span className="text-[10px] font-bold uppercase text-muted-foreground tracking-widest">{format(zacetekDate, "MMM", { locale: sl })}</span>
                        <span className="text-xl font-black leading-none my-0.5">{format(zacetekDate, "dd")}</span>
                        <span className="text-[11px] font-semibold">{format(zacetekDate, "HH:mm")}</span>
                      </div>
                      
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 mb-1">
                          <h4 className="font-bold text-base truncate">{rez.strankaIme}</h4>
                          {!aktivna && <Badge variant="secondary" className="text-[10px]">Preklicana</Badge>}
                          {aktivna && zasedena && <Badge className="bg-blue-100 text-blue-700 border-blue-200 hover:bg-blue-100 text-[10px]">Poteka</Badge>}
                          {aktivna && !zasedena && past && <Badge variant="outline" className="text-[10px]">Pretekla</Badge>}
                          {aktivna && !zasedena && !past && <Badge className="bg-amber-100 text-amber-700 border-amber-200 hover:bg-amber-100 text-[10px]">Prihaja</Badge>}
                        </div>
                        
                        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-muted-foreground mt-1.5">
                          <div className="flex items-center gap-1.5 text-foreground font-medium bg-muted px-2 py-0.5 rounded-md text-xs">
                            <MapPin className="w-3.5 h-3.5" />
                            {rez.mizaIme || `Miza ${rez.mizaStevilka}`}
                            {rez.prostorIme && <span className="font-normal text-muted-foreground ml-1">({rez.prostorIme})</span>}
                            {filterEnota === "all" && <span className="font-normal text-muted-foreground ml-1 border-l pl-2 border-border/50">Enota: {rez.enotaIme}</span>}
                          </div>
                          
                          <div className="sm:hidden flex items-center gap-1 text-xs">
                            <Clock className="w-3.5 h-3.5" />
                            {formatPosDatum(rez.zacetek)}, {formatPosCas(rez.zacetek)}
                          </div>
                          
                          {rez.telefon && (
                            <div className="flex items-center gap-1">
                              <Phone className="w-3.5 h-3.5" />
                              <a href={`tel:${rez.telefon}`} className="hover:underline">{rez.telefon}</a>
                            </div>
                          )}
                        </div>
                        
                        {rez.opomba && (
                          <div className="mt-2 text-xs italic text-muted-foreground bg-amber-50/50 border border-amber-100 p-2 rounded-md border-l-4 border-l-amber-300">
                            "{rez.opomba}"
                          </div>
                        )}
                      </div>
                    </div>
                    
                    <div className="flex items-center gap-2 sm:self-center shrink-0 border-t pt-3 sm:border-0 sm:pt-0">
                      {aktivna && !past && jeAktivnaEnota && (
                        <>
                          <Button variant="outline" size="sm" onClick={() => handleEdit(rez)} className="h-8">
                            Uredi
                          </Button>
                          <Button variant="outline" size="sm" onClick={() => handlePreklici(rez)} className="h-8 text-destructive hover:bg-destructive/10 hover:text-destructive border-destructive/30">
                            Prekliči
                          </Button>
                        </>
                      )}
                      {aktivna && !past && !jeAktivnaEnota && (
                        <span className="text-xs text-muted-foreground">
                          Upravljanje je na voljo v izbrani enoti
                        </span>
                      )}
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button variant="ghost" size="icon" className="h-8 w-8">
                            <MoreHorizontal className="w-4 h-4" />
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="end">
                          <DropdownMenuLabel>Možnosti</DropdownMenuLabel>
                          <DropdownMenuItem onClick={() => openZgodovina(rez)}>
                            <History className="w-4 h-4 mr-2" />
                            Zgodovina sprememb
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
      
      <RazpolozljivostMizDialog
        open={razpolozljivostOpen}
        onOpenChange={setRazpolozljivostOpen}
        onIzberiMizo={handleIzberiMizo}
      />
      
      <RezervacijaDialog
        open={rezervacijaOpen}
        onOpenChange={setRezervacijaOpen}
        miza={selectedMiza}
        initialZacetek={initialDate}
        rezervacija={editRezervacijaObj}
      />
      
      <ZgodovinaDialog
        open={zgodovinaOpen}
        onOpenChange={setZgodovinaOpen}
        rezervacijaId={zgodovinaTarget?.id ?? null}
        mizaId={zgodovinaTarget?.mizaId ?? null}
      />
    </div>
  );
}
