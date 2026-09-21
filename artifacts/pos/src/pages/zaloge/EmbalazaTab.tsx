import { useState, useMemo, useRef } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useListEmbalazaBilance,
  useReturnEmbalaza,
  useCreateArtikel,
  getListEmbalazaBilanceQueryKey,
  getListZalogeQueryKey,
  getListArtikliQueryKey,
  type EmbalazaBilanca,
} from "@workspace/api-client-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Plus, ArrowRightLeft, Package, Search } from "lucide-react";
import { DecimalInput } from "@/components/ui/decimal-input";

function getVrstaLabel(vrsta: string | null) {
  if (!vrsta) return "Neznano";
  const m: Record<string, string> = {
    steklenica: "Steklenica",
    zaboj: "Zaboj",
    keg: "Keg/Sod",
    balon: "Balon",
    drugo: "Drugo",
  };
  return m[vrsta] || vrsta;
}

export function EmbalazaTab() {
  const { data: bilance, isLoading, isError, refetch } = useListEmbalazaBilance();
  const [search, setSearch] = useState("");
  const [returnDialogState, setReturnDialogState] = useState<{ open: boolean; bilanca: EmbalazaBilanca | null }>({ open: false, bilanca: null });
  const [newDialogState, setNewDialogState] = useState(false);

  const filtered = useMemo(() => {
    if (!bilance) return [];
    if (!search.trim()) return bilance;
    const lower = search.toLowerCase();
    return bilance.filter(b => 
      b.artikelIme.toLowerCase().includes(lower) || 
      (b.dobaviteljIme || "neznan dobavitelj").toLowerCase().includes(lower)
    );
  }, [bilance, search]);

  const grouped = useMemo(() => {
    const groups: Record<string, { dobaviteljIme: string; items: EmbalazaBilanca[] }> = {};
    for (const b of filtered) {
      const key = b.dobaviteljId || "unknown";
      if (!groups[key]) {
        groups[key] = { dobaviteljIme: b.dobaviteljIme || "Neznan dobavitelj", items: [] };
      }
      groups[key].items.push(b);
    }
    return Object.values(groups).sort((a, b) => a.dobaviteljIme.localeCompare(b.dobaviteljIme));
  }, [filtered]);

  return (
    <div className="space-y-6 mt-4">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="relative min-w-0 flex-1 max-w-sm">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-4 h-4 text-muted-foreground pointer-events-none" />
          <Input 
            value={search} 
            onChange={e => setSearch(e.target.value)} 
            placeholder="Iskanje embalaže ali dobavitelja..." 
            className="pl-8" 
          />
        </div>
        <Button onClick={() => setNewDialogState(true)} className="shrink-0">
          <Plus className="mr-2 h-4 w-4" />
          Nova embalaža
        </Button>
      </div>

      {isLoading ? (
        <div className="flex justify-center p-8">
          <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="text-center p-12 border rounded-xl bg-muted/20">
          <Package className="mx-auto h-12 w-12 text-muted-foreground opacity-50 mb-3" />
          <h3 className="text-lg font-medium">Zaloge embalaže ni bilo mogoče naložiti</h3>
          <p className="text-sm text-muted-foreground mt-1 mb-4">
            Pri branju evidence povratne embalaže je prišlo do napake.
          </p>
          <Button variant="outline" onClick={() => void refetch()}>
            Poskusi znova
          </Button>
        </div>
      ) : bilance?.length === 0 ? (
        <div className="text-center p-12 border rounded-xl bg-muted/20">
          <Package className="mx-auto h-12 w-12 text-muted-foreground opacity-50 mb-3" />
          <h3 className="text-lg font-medium">Ni povratne embalaže</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Trenutno na zalogi ni nobene evidentirane povratne embalaže.
          </p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="text-center p-8 text-muted-foreground">Ni zadetkov za iskanje "{search}".</div>
      ) : (
        <div className="space-y-6">
          {grouped.map(group => (
            <Card key={group.dobaviteljIme} className="overflow-hidden">
              <div className="bg-muted/40 border-b px-4 py-3">
                <h3 className="font-semibold">{group.dobaviteljIme}</h3>
              </div>
              <div className="divide-y">
                {group.items.map((b, i) => (
                  <div key={i} className="p-4 flex flex-col sm:flex-row sm:items-center gap-4">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 mb-1">
                        <span className="font-medium truncate">{b.artikelIme}</span>
                        <Badge variant="outline" className="text-[10px] uppercase">{getVrstaLabel(b.vrstaEmbalaze)}</Badge>
                      </div>
                      <div className="text-sm text-muted-foreground grid grid-cols-2 gap-x-4 gap-y-1 sm:flex sm:gap-6 mt-2">
                        <div>
                          <span className="opacity-70">Zaloga (dobavitelj):</span> <span className="font-medium text-foreground">{b.fizicnaKolicina}</span>
                        </div>
                        <div>
                          <span className="opacity-70">Skupna zaloga:</span> <span className="font-medium text-foreground">{b.overallPhysicalStock}</span>
                        </div>
                        <div>
                          <span className="opacity-70">Depozit/kos:</span> <span className="font-medium text-foreground">{b.depozitnaVrednost != null ? `${b.depozitnaVrednost.toFixed(2)} €` : "—"}</span>
                        </div>
                        <div>
                          <span className="opacity-70">Izpostavljenost:</span> <span className="font-medium text-foreground">{b.izpostavljenostDepozita != null ? `${b.izpostavljenostDepozita.toFixed(2)} €` : "—"}</span>
                        </div>
                      </div>
                    </div>
                    <Button 
                      variant="secondary" 
                      onClick={() => setReturnDialogState({ open: true, bilanca: b })}
                      disabled={b.fizicnaKolicina <= 0}
                      className="shrink-0"
                    >
                      <ArrowRightLeft className="mr-2 h-4 w-4" />
                      Vrni
                    </Button>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>
      )}

      {returnDialogState.open && returnDialogState.bilanca && (
        <VraciloEmbalazeDialog 
          bilanca={returnDialogState.bilanca} 
          open={returnDialogState.open} 
          onOpenChange={(open) => setReturnDialogState(s => ({ ...s, open }))} 
        />
      )}
      <NovaEmbalazaDialog 
        open={newDialogState} 
        onOpenChange={setNewDialogState} 
      />
    </div>
  );
}

function VraciloEmbalazeDialog({ bilanca, open, onOpenChange }: { bilanca: EmbalazaBilanca, open: boolean, onOpenChange: (open: boolean) => void }) {
  const [kolicina, setKolicina] = useState("");
  const [opomba, setOpomba] = useState("");
  const returnMutation = useReturnEmbalaza();
  const operationKey = useRef<string>(crypto.randomUUID());
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const numKolicina = parseFloat(kolicina.replace(",", "."));
  const isValid = !isNaN(numKolicina) && numKolicina > 0 && numKolicina <= bilanca.fizicnaKolicina;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    returnMutation.mutate({
      data: {
        artikelId: bilanca.artikelId,
        dobaviteljId: bilanca.dobaviteljId,
        kolicina: numKolicina,
         operationKey: operationKey.current,
        opomba: opomba.trim() || undefined,
      }
    }, {
      onSuccess: () => {
        toast({ title: "Embalaža uspešno vrnjena" });
        queryClient.invalidateQueries({ queryKey: getListEmbalazaBilanceQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListZalogeQueryKey() });
        onOpenChange(false);
      },
      onError: (err) => {
        const sporocilo = (err as { data?: { error?: string }; message?: string })?.data?.error
          ?? (err as { message?: string })?.message;
        toast({ title: "Napaka pri vračilu", variant: "destructive", description: sporocilo });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Vračilo embalaže</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="p-3 bg-muted rounded-md space-y-1 text-sm">
            <div className="font-medium">{bilanca.artikelIme}</div>
            <div className="text-muted-foreground flex justify-between">
              <span>Dobavitelj: {bilanca.dobaviteljIme || "Neznan"}</span>
              <span>Na voljo: {bilanca.fizicnaKolicina}</span>
            </div>
          </div>
          <div className="space-y-2">
            <Label>Količina za vračilo</Label>
            <DecimalInput 
              value={kolicina} 
              onChange={(e) => setKolicina(e.target.value)} 
              placeholder="0" 
              autoFocus 
            />
            {(!isNaN(numKolicina) && numKolicina > bilanca.fizicnaKolicina) && (
              <p className="text-[13px] text-destructive">Količina ne sme presegati zaloge pri tem dobavitelju ({bilanca.fizicnaKolicina}).</p>
            )}
          </div>
          <div className="space-y-2">
            <Label>Opomba (neobvezno)</Label>
            <Input value={opomba} onChange={e => setOpomba(e.target.value)} placeholder="Številka dobavnice, razlog..." />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
            <Button type="submit" disabled={!isValid || returnMutation.isPending}>
              {returnMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Potrdi vračilo
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function NovaEmbalazaDialog({ open, onOpenChange }: { open: boolean, onOpenChange: (open: boolean) => void }) {
  const [ime, setIme] = useState("");
  const [vrsta, setVrsta] = useState<string>("steklenica");
  const [depozit, setDepozit] = useState("");
  const createMutation = useCreateArtikel();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const numDepozit = parseFloat(depozit.replace(",", "."));
  const isValid = ime.trim().length > 0 && !isNaN(numDepozit) && numDepozit >= 0;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!isValid) return;

    createMutation.mutate({
      data: {
        ime: ime.trim(),
        povratnaEmbalaza: true,
        vrstaEmbalaze: vrsta as any,
        depozitnaVrednost: numDepozit,
        nabavniArtikel: true,
        prodajniArtikel: false,
        enotaMere: "kos",
        cena: 0,
        davek: 0,
        vrstaArtikla: "material",
      }
    }, {
      onSuccess: () => {
        toast({ title: "Embalaža ustvarjena" });
        queryClient.invalidateQueries({ queryKey: getListArtikliQueryKey() });
        queryClient.invalidateQueries({ queryKey: getListZalogeQueryKey() });
        onOpenChange(false);
        setIme("");
        setDepozit("");
        setVrsta("steklenica");
      },
      onError: (err) => {
        const sporocilo = (err as { data?: { error?: string }; message?: string })?.data?.error
          ?? (err as { message?: string })?.message;
        toast({ title: "Napaka pri ustvarjanju", variant: "destructive", description: sporocilo });
      }
    });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Nova povratna embalaža</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-2">
            <Label>Naziv</Label>
            <Input value={ime} onChange={e => setIme(e.target.value)} placeholder="npr. Nosilka Radenska 0.5L" autoFocus />
          </div>
          <div className="space-y-2">
            <Label>Vrsta embalaže</Label>
            <Select value={vrsta} onValueChange={setVrsta}>
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="steklenica">Steklenica</SelectItem>
                <SelectItem value="zaboj">Zaboj</SelectItem>
                <SelectItem value="keg">Keg/Sod</SelectItem>
                <SelectItem value="balon">Balon</SelectItem>
                <SelectItem value="drugo">Drugo</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label>Depozitna vrednost (€)</Label>
            <DecimalInput value={depozit} onChange={(e) => setDepozit(e.target.value)} placeholder="0.00" />
          </div>
          <div className="bg-blue-50/50 text-blue-800 text-sm p-3 rounded-md">
            Artikel bo ustvarjen kot nabavni material z enoto mere "kos". Cena in davek bosta 0.
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Prekliči</Button>
            <Button type="submit" disabled={!isValid || createMutation.isPending}>
              {createMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Shrani
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
