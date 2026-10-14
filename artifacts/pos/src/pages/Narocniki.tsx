import { formatEur } from "@/lib/formatEur";
import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { KlavijaturaInput } from "@/components/KlavijaturaInput";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Pencil,
  Trash2,
  Search,
  Mail,
  Phone,
  ListChecks,
  User,
  Clock,
  ShoppingCart
} from "lucide-react";
import { getEnotaId } from "@workspace/api-client-react";

// -- TIPI --

interface Naslov {
  id: number;
  ulica: string;
  hisnaStevilka: string;
  naseljeNaziv?: string;
}

interface Narocnik {
  id: number;
  ime: string;
  telefon: string;
  email: string | null;
  opombe: string | null;
  steviloNarocil: number;
  zadnjeNarocilo: string | null;
  naslovi: Naslov[];
}

interface ZgodovinaNarocilo {
  id: number;
  stevilkaNarocila: number | null;
  status: string;
  skupaj: number;
  nacin: string;
  nacinIzpolnitve: string;
  strankaIme: string | null;
  strankaTelefon: string | null;
  predvidenPrevzem: string | null;
  predvidenaDostava: string | null;
  ustvarjeno: string;
}

interface NarocnikForm {
  ime: string;
  telefon: string;
  email: string;
  opombe: string;
}

const defaultForm: NarocnikForm = { ime: "", telefon: "", email: "", opombe: "" };

// -- FETCH FUNKCIJE --

function getBaseUrl() {
  return import.meta.env.BASE_URL.replace(/\/$/, "");
}

function getAuthHeaders(json = false) {
  const enotaId = getEnotaId();
  const headers: Record<string, string> = {};
  if (json) headers["Content-Type"] = "application/json";
  if (enotaId) headers["X-Enota-Id"] = String(enotaId);
  return headers;
}

async function fetchNarocniki(): Promise<Narocnik[]> {
  const res = await fetch(`${getBaseUrl()}/api/narocniki`, {
    credentials: "include",
    headers: getAuthHeaders(false),
  });
  if (!res.ok) throw new Error("Napaka pri pridobivanju naročnikov");
  return res.json();
}

async function fetchZgodovina(id: number): Promise<ZgodovinaNarocilo[]> {
  const res = await fetch(`${getBaseUrl()}/api/narocniki/${id}/narocila`, {
    credentials: "include",
    headers: getAuthHeaders(false),
  });
  if (!res.ok) throw new Error("Napaka pri pridobivanju zgodovine naročil");
  return res.json();
}

type NarocnikUpdate = {
  ime: string;
  telefon: string;
  email: string | null;
  opombe: string | null;
};

async function updateNarocnik({ id, data }: { id: number; data: NarocnikUpdate }) {
  const res = await fetch(`${getBaseUrl()}/api/narocniki/${id}`, {
    method: "PUT",
    credentials: "include",
    headers: getAuthHeaders(true),
    body: JSON.stringify(data),
  });
  if (!res.ok) throw new Error("Napaka pri posodabljanju naročnika");
  return res.json();
}

async function deleteNarocnik(id: number) {
  const res = await fetch(`${getBaseUrl()}/api/narocniki/${id}`, {
    method: "DELETE",
    credentials: "include",
    headers: getAuthHeaders(false),
  });
  if (!res.ok) throw new Error("Napaka pri brisanju naročnika");
  return true;
}

function formatDate(isoString?: string | null) {
  if (!isoString) return "—";
  try {
    const d = new Date(isoString);
    return new Intl.DateTimeFormat("sl-SI", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit",
      timeZone: "Europe/Ljubljana",
    }).format(d);
  } catch {
    return "—";
  }
}

// -- GLAVNA KOMPONENTA --

export default function Narocniki() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const enotaId = getEnotaId();

  const [iskanje, setIskanje] = useState("");
  
  // Urejanje
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<NarocnikForm>(defaultForm);

  // Brisanje
  const [deleteId, setDeleteId] = useState<number | null>(null);
  const [deleteNaziv, setDeleteNaziv] = useState("");

  // Zgodovina
  const [zgodovinaOpen, setZgodovinaOpen] = useState(false);
  const [zgodovinaId, setZgodovinaId] = useState<number | null>(null);
  const [zgodovinaIme, setZgodovinaIme] = useState("");

  // Queries
  const { data: narocniki, isLoading, isError, refetch: refetchNarocniki } = useQuery({
    queryKey: ["narocniki", enotaId],
    queryFn: fetchNarocniki,
  });

  const { data: zgodovinaData, isLoading: zgodovinaLoading, isError: zgodovinaError } = useQuery({
    queryKey: ["narocnik-zgodovina", enotaId, zgodovinaId],
    queryFn: () => fetchZgodovina(zgodovinaId!),
    enabled: !!zgodovinaId && zgodovinaOpen,
  });

  // Filtriranje
  const filtrirani = useMemo(() => {
    if (!narocniki) return [];
    if (!iskanje) return narocniki;
    const q = iskanje.toLowerCase();
    return narocniki.filter(n =>
      n.ime.toLowerCase().includes(q) ||
      n.telefon.includes(q) ||
      (n.email && n.email.toLowerCase().includes(q))
    );
  }, [narocniki, iskanje]);

  const fireRefreshEvent = () => {
    window.dispatchEvent(new CustomEvent("pos:narocniki-spremenjeni"));
  };

  // Mutations
  const updateMutation = useMutation({
    mutationFn: updateNarocnik,
    onSuccess: () => {
      toast({ title: "Shranjeno", description: "Podatki o naročniku so bili posodobljeni." });
      void queryClient.invalidateQueries({ queryKey: ["narocniki", enotaId] });
      setEditOpen(false);
      fireRefreshEvent();
    },
    onError: () => {
      toast({ title: "Napaka", description: "Prišlo je do napake pri shranjevanju.", variant: "destructive" });
    }
  });

  const deleteMutation = useMutation({
    mutationFn: deleteNarocnik,
    onSuccess: () => {
      toast({ title: "Izbrisano", description: "Naročnik je bil uspešno izbrisan." });
      void queryClient.invalidateQueries({ queryKey: ["narocniki", enotaId] });
      setDeleteId(null);
      fireRefreshEvent();
    },
    onError: () => {
      toast({ title: "Napaka", description: "Naročnika ni bilo mogoče izbrisati.", variant: "destructive" });
    }
  });

  // Handlers
  const odpriUredi = (k: Narocnik) => {
    setEditId(k.id);
    setForm({
      ime: k.ime || "",
      telefon: k.telefon || "",
      email: k.email || "",
      opombe: k.opombe || "",
    });
    setEditOpen(true);
  };

  const odpriDelete = (k: Narocnik) => {
    setDeleteId(k.id);
    setDeleteNaziv(k.ime);
  };

  const odpriZgodovino = (k: Narocnik) => {
    setZgodovinaId(k.id);
    setZgodovinaIme(k.ime);
    setZgodovinaOpen(true);
  };

  const handleShrani = () => {
    if (!form.ime.trim()) {
      toast({ title: "Obvezno polje", description: "Ime je obvezno.", variant: "destructive" });
      return;
    }
    if (!form.telefon.trim()) {
      toast({ title: "Obvezno polje", description: "Telefon je obvezen.", variant: "destructive" });
      return;
    }

    if (editId !== null) {
      updateMutation.mutate({
        id: editId,
        data: {
          ime: form.ime.trim(),
          telefon: form.telefon.trim(),
          email: form.email.trim() || null,
          opombe: form.opombe.trim() || null,
        }
      });
    }
  };

  const handleDelete = () => {
    if (deleteId !== null) {
      deleteMutation.mutate(deleteId);
    }
  };

  return (
    <div className="p-4 sm:p-8 space-y-6 flex-1 overflow-auto">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <h1 className="text-3xl font-bold tracking-tight">Telefonski naročniki</h1>
      </div>

      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
        <KlavijaturaInput
          placeholder="Išči po imenu ali telefonu…"
          value={iskanje}
          onChange={setIskanje}
          naslov="Iskanje naročnika"
          className="pl-9"
        />
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : isError ? (
        <div className="text-center py-16 space-y-3">
          <p className="text-muted-foreground">Imenika trenutno ni mogoče naložiti.</p>
          <Button variant="outline" onClick={() => { void refetchNarocniki(); }}>Poskusi znova</Button>
        </div>
      ) : filtrirani.length === 0 ? (
        <div className="text-center py-16 text-muted-foreground">
          {(narocniki?.length ?? 0) === 0
            ? "Imenik je prazen. Naročniki se samodejno dodajo ob prvem naročilu."
            : "Ni naročnikov, ki bi ustrezali iskanju."}
        </div>
      ) : (
        <div className="rounded-lg border overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-muted/50 border-b">
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Naročnik</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Kontakt</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground hidden sm:table-cell">Aktivnost</th>
                <th className="w-32 px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {filtrirani.map((k, idx) => (
                <tr key={k.id} className={`border-b last:border-0 hover:bg-muted/30 transition-colors ${idx % 2 === 0 ? "" : "bg-muted/10"}`}>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <div className="bg-primary/10 text-primary h-8 w-8 rounded-full flex items-center justify-center shrink-0">
                        <User className="h-4 w-4" />
                      </div>
                      <div>
                        <p className="font-medium leading-snug">{k.ime}</p>
                        {k.opombe && (
                          <p className="text-xs text-muted-foreground truncate max-w-[200px] mt-0.5">{k.opombe}</p>
                        )}
                      </div>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="space-y-1">
                      {k.telefon && (
                        <p className="flex items-center gap-1.5 text-sm">
                          <Phone className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                          {k.telefon}
                        </p>
                      )}
                      {k.email && (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Mail className="h-3 w-3 shrink-0" />
                          <span className="truncate max-w-[160px]">{k.email}</span>
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 hidden sm:table-cell">
                    <div className="space-y-1">
                      <p className="flex items-center gap-1.5 text-xs">
                        <ShoppingCart className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <span className="font-medium">{k.steviloNarocil}</span> naročil
                      </p>
                      {k.zadnjeNarocilo && (
                        <p className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <Clock className="h-3.5 w-3.5 shrink-0" />
                          {formatDate(k.zadnjeNarocilo)}
                        </p>
                      )}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-0.5">
                      <Button variant="ghost" size="icon" onClick={() => odpriZgodovino(k)} title="Zgodovina naročil" className="h-8 w-8">
                        <ListChecks className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => odpriUredi(k)} title="Uredi naročnika" className="h-8 w-8">
                        <Pencil className="h-4 w-4 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" onClick={() => odpriDelete(k)} title="Izbriši naročnika" className="h-8 w-8 text-destructive hover:text-destructive hover:bg-destructive/10">
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Urejanje Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Uredi naročnika</DialogTitle>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="narocnik-ime">Ime in priimek <span className="text-destructive">*</span></Label>
              <Input
                id="narocnik-ime"
                value={form.ime}
                onChange={(e) => setForm(f => ({ ...f, ime: e.target.value }))}
                placeholder="Vnesite ime"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="narocnik-telefon">Telefon <span className="text-destructive">*</span></Label>
              <Input
                id="narocnik-telefon"
                value={form.telefon}
                onChange={(e) => setForm(f => ({ ...f, telefon: e.target.value }))}
                placeholder="Vnesite telefonsko številko"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="narocnik-email">E-pošta</Label>
              <Input
                id="narocnik-email"
                type="email"
                value={form.email}
                onChange={(e) => setForm(f => ({ ...f, email: e.target.value }))}
                placeholder="Naslov e-pošte"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="narocnik-opombe">Opombe</Label>
              <Input
                id="narocnik-opombe"
                value={form.opombe}
                onChange={(e) => setForm(f => ({ ...f, opombe: e.target.value }))}
                placeholder="Opombe k stranki..."
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setEditOpen(false)}>Prekliči</Button>
            <Button onClick={handleShrani} disabled={updateMutation.isPending}>
              {updateMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Shrani
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Brisanje AlertDialog */}
      <AlertDialog open={deleteId !== null} onOpenChange={(open) => !open && setDeleteId(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Potrdi izbris naročnika</AlertDialogTitle>
            <AlertDialogDescription>
              Ste prepričani, da želite izbrisati naročnika "{deleteNaziv}"? Tega dejanja ni mogoče razveljaviti in bo odstranilo tudi shranjene naslove.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Prekliči</AlertDialogCancel>
            <AlertDialogAction 
              onClick={handleDelete} 
              disabled={deleteMutation.isPending}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            >
              {deleteMutation.isPending && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Izbriši
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* Zgodovina Dialog */}
      <Dialog open={zgodovinaOpen} onOpenChange={setZgodovinaOpen}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Zgodovina naročil: {zgodovinaIme}</DialogTitle>
          </DialogHeader>
          {zgodovinaLoading ? (
            <div className="flex justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : zgodovinaError ? (
            <div className="text-center py-12 text-muted-foreground">
              Zgodovine naročil trenutno ni mogoče naložiti.
            </div>
          ) : zgodovinaData && zgodovinaData.length > 0 ? (
            <div className="space-y-3 mt-4">
              {zgodovinaData.map(n => (
                <div key={n.id} className="border rounded-md p-4 flex flex-col sm:flex-row sm:justify-between sm:items-center bg-card gap-3">
                  <div>
                    <p className="font-medium">Naročilo {n.stevilkaNarocila || `#${n.id}`}</p>
                    <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground mt-1">
                      <span className="flex items-center gap-1">
                        <Clock className="h-3 w-3" /> 
                        {formatDate(n.ustvarjeno)}
                      </span>
                      <span>•</span>
                      <span className="capitalize">
                        {n.nacin === "miza"
                          ? "Pri mizi"
                          : n.nacinIzpolnitve === "dostava"
                            ? "Dostava"
                            : "Osebni prevzem"}
                      </span>
                      <span>•</span>
                      <span className="font-medium uppercase tracking-wider">{n.status}</span>
                    </div>
                  </div>
                  <div className="font-semibold tabular-nums text-lg text-right">
                    {formatEur(n.skupaj)}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="text-center py-12 text-muted-foreground">
              Ta naročnik nima preteklih naročil.
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}
