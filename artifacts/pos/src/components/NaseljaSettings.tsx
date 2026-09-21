import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { DecimalInput, parseDecimal } from "@/components/ui/decimal-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";

type Naselje = {
  id: number;
  naziv: string;
  oddaljenostKm: number | null;
  cenaDostave: number;
  casDostaveMin: number;
  aktivno: boolean;
};

const NASELJA_QUERY_KEY = ["/api/naselja", { vse: true }] as const;

function apiUrl(path: string) {
  return `${import.meta.env.BASE_URL.replace(/\/$/, "")}${path}`;
}

async function requestNaselja(path: string, options?: RequestInit) {
  const response = await fetch(apiUrl(path), {
    credentials: "include",
    ...options,
    headers: { "Content-Type": "application/json", ...options?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: string } | null;
    throw new Error(body?.error ?? "Naselja ni bilo mogoče shraniti.");
  }
  return response.status === 204 ? null : response.json();
}

const praznoNaselje = () => ({
  naziv: "",
  oddaljenostKm: "",
  cenaDostave: "0",
  casDostaveMin: "0",
  aktivno: true,
});

export function NaseljaSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { data: naselja = [], isLoading } = useQuery<Naselje[]>({
    queryKey: NASELJA_QUERY_KEY,
    queryFn: () => requestNaselja("/api/naselja?vse=true"),
  });
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Naselje | null>(null);
  const [form, setForm] = useState(praznoNaselje);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!dialogOpen) return;
    setForm(editing
      ? {
          naziv: editing.naziv,
          oddaljenostKm: editing.oddaljenostKm == null ? "" : String(editing.oddaljenostKm),
           cenaDostave: String(editing.cenaDostave),
          casDostaveMin: String(editing.casDostaveMin),
          aktivno: editing.aktivno,
        }
      : praznoNaselje());
  }, [dialogOpen, editing]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: NASELJA_QUERY_KEY });

  const openNew = () => {
    setEditing(null);
    setDialogOpen(true);
  };

  const openEdit = (naselje: Naselje) => {
    setEditing(naselje);
    setDialogOpen(true);
  };

  const handleSave = async () => {
    const naziv = form.naziv.trim();
    const oddaljenostKm = form.oddaljenostKm.trim() === "" ? null : parseDecimal(form.oddaljenostKm);
    const cenaDostave = parseDecimal(form.cenaDostave);
    const casDostaveMin = Number(form.casDostaveMin);

    if (!naziv) {
      toast({ title: "Vnesite naziv naselja", variant: "destructive" });
      return;
    }
    if ((oddaljenostKm != null && (!Number.isFinite(oddaljenostKm) || oddaljenostKm < 0))
      || (form.aktivno && oddaljenostKm == null)
      || !Number.isFinite(cenaDostave) || cenaDostave < 0
      || !Number.isInteger(casDostaveMin) || casDostaveMin < 0) {
      toast({ title: "Za aktivno naselje vnesite veljavno razdaljo, ceno in čas dostave", variant: "destructive" });
      return;
    }

    setSaving(true);
    try {
      await requestNaselja(editing ? `/api/naselja/${editing.id}` : "/api/naselja", {
        method: editing ? "PUT" : "POST",
        body: JSON.stringify({ naziv, oddaljenostKm, cenaDostave, casDostaveMin, aktivno: form.aktivno }),
      });
      await refresh();
      setDialogOpen(false);
      toast({ title: editing ? "Naselje posodobljeno" : "Naselje dodano" });
    } catch (error) {
      toast({ title: "Napaka", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (naselje: Naselje) => {
    try {
      await requestNaselja(`/api/naselja/${naselje.id}`, { method: "DELETE" });
      await refresh();
      toast({ title: "Naselje deaktivirano", description: `${naselje.naziv} ne bo več na voljo za nove dostave.` });
    } catch (error) {
      toast({ title: "Napaka", description: error instanceof Error ? error.message : undefined, variant: "destructive" });
    }
  };

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between gap-4">
          <div>
            <CardTitle>Naselja za dostavo</CardTitle>
            <CardDescription>Fiksna cena naselja ima prednost; pri ceni 0 se strošek izračuna iz km × cene storitve.</CardDescription>
          </div>
          <Button size="sm" onClick={openNew}>
            <Plus className="mr-1.5 h-4 w-4" /> Dodaj naselje
          </Button>
        </CardHeader>
        <CardContent>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Naselje</TableHead>
                <TableHead className="hidden sm:table-cell text-right">Oddaljenost</TableHead>
                 <TableHead className="hidden md:table-cell text-right">Cena prevoza</TableHead>
                <TableHead className="hidden sm:table-cell text-right">Čas</TableHead>
                <TableHead className="text-center">Aktivno</TableHead>
                <TableHead className="w-24" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {isLoading ? (
                <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Nalaganje …</TableCell></TableRow>
              ) : naselja.length === 0 ? (
                <TableRow><TableCell colSpan={6} className="py-6 text-center text-muted-foreground">Naselij še ni.</TableCell></TableRow>
              ) : naselja.map(naselje => (
                <TableRow key={naselje.id} className={!naselje.aktivno ? "opacity-50" : ""}>
                  <TableCell>
                    <span className="font-medium">{naselje.naziv}</span>
                    {!naselje.aktivno && <span className="ml-2 text-xs text-muted-foreground">neaktivno</span>}
                  </TableCell>
                  <TableCell className="hidden sm:table-cell text-right">{naselje.oddaljenostKm == null ? "—" : `${naselje.oddaljenostKm} km`}</TableCell>
                   <TableCell className="hidden md:table-cell text-right">{naselje.cenaDostave > 0 ? `${naselje.cenaDostave.toFixed(2)} €` : "po km"}</TableCell>
                  <TableCell className="hidden sm:table-cell text-right">{naselje.casDostaveMin} min</TableCell>
                  <TableCell className="text-center">
                    <span className={`text-xs font-medium ${naselje.aktivno ? "text-green-700" : "text-muted-foreground"}`}>{naselje.aktivno ? "Da" : "Ne"}</span>
                  </TableCell>
                  <TableCell className="text-right">
                    <Button variant="ghost" size="icon" aria-label={`Uredi naselje ${naselje.naziv}`} onClick={() => openEdit(naselje)}>
                      <Pencil className="h-4 w-4" />
                    </Button>
                    {naselje.aktivno && (
                      <Button variant="ghost" size="icon" aria-label={`Deaktiviraj naselje ${naselje.naziv}`} onClick={() => handleDelete(naselje)}>
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader><DialogTitle>{editing ? "Uredi naselje" : "Novo naselje"}</DialogTitle></DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label htmlFor="naselje-naziv">Naziv</Label>
              <Input id="naselje-naziv" value={form.naziv} onChange={event => setForm(current => ({ ...current, naziv: event.target.value }))} placeholder="Npr. Ljubljana" />
            </div>
            <div className="space-y-2">
              <Label htmlFor="naselje-oddaljenost">Oddaljenost (km)</Label>
              <DecimalInput id="naselje-oddaljenost" value={form.oddaljenostKm} onChange={event => setForm(current => ({ ...current, oddaljenostKm: event.target.value }))} placeholder={form.aktivno ? "Obvezno" : "Opcijsko"} />
              <p className="text-xs text-muted-foreground">Končni strošek določi dostavna storitev glede na to razdaljo.</p>
            </div>
             <div className="space-y-2">
               <Label htmlFor="naselje-cena-dostave">Cena prevoza (€)</Label>
               <DecimalInput id="naselje-cena-dostave" value={form.cenaDostave} onChange={event => setForm(current => ({ ...current, cenaDostave: event.target.value }))} />
               <p className="text-xs text-muted-foreground">Vnesite 0 za obračun po kilometrih; druga vrednost je fiksna cena za to naselje.</p>
             </div>
            <div className="space-y-2">
              <Label htmlFor="naselje-cas">Čas dostave (min)</Label>
              <Input id="naselje-cas" type="number" min="0" step="1" value={form.casDostaveMin} onChange={event => setForm(current => ({ ...current, casDostaveMin: event.target.value }))} />
            </div>
            <div className="flex items-center justify-between rounded-lg border p-3">
              <Label htmlFor="naselje-aktivno">Aktivno za nova naročila</Label>
              <Switch id="naselje-aktivno" checked={form.aktivno} onCheckedChange={aktivno => setForm(current => ({ ...current, aktivno }))} />
            </div>
            <Button className="w-full" disabled={saving} onClick={handleSave}>{saving ? "Shranjujem …" : "Shrani naselje"}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}