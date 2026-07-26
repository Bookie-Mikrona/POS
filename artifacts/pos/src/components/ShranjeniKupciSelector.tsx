import { useState } from "react";
import { useF2Save } from "@/hooks/useF2Save";
import {
  useGetKupciPogosti,
  useListShranjeniKupci,
  useCreateShranjenKupec,
  useDeleteShranjenKupec,
  useUpdateShranjenKupec,
  getListShranjeniKupciQueryKey,
  getGetKupciPogostiQueryKey,
  type ShranjenKupec,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Loader2, Star, Trash2, X, Search, BookUser, Clock, Pencil, Plus, Minus } from "lucide-react";
import { useToast } from "@/hooks/use-toast";

interface KupecData {
  naziv: string | null;
  naslov: string | null;
  davcnaStevilka: string;
}

interface ShranjeniKupciSelectorProps {
  naziv: string | null;
  naslov: string | null;
  davcnaStevilka: string;
  onSelect: (kupec: KupecData) => void;
}

interface TrrVrstica { iban: string; bic: string }

interface KupecForm {
  naziv: string;
  kratkiNaziv: string;
  ulica: string;
  postnaStevilka: string;
  kraj: string;
  drzava: string;
  kodaDrzave: string;
  zavezanecDdv: boolean;
  davcnaStevilka: string;
  idZaDdv: string;
  maticnaStevilka: string;
  trr: TrrVrstica[];
  email: string;
  telefon: string;
}

function prazenForm(): KupecForm {
  return {
    naziv: "", kratkiNaziv: "", ulica: "", postnaStevilka: "", kraj: "",
    drzava: "", kodaDrzave: "", zavezanecDdv: false, davcnaStevilka: "",
    idZaDdv: "", maticnaStevilka: "", trr: [], email: "", telefon: "",
  };
}

function kupecVForm(k: ShranjenKupec): KupecForm {
  return {
    naziv: k.naziv ?? "",
    kratkiNaziv: k.kratkiNaziv ?? "",
    ulica: k.ulica ?? "",
    postnaStevilka: k.postnaStevilka ?? "",
    kraj: k.kraj ?? "",
    drzava: k.drzava ?? "",
    kodaDrzave: k.kodaDrzave ?? "",
    zavezanecDdv: k.zavezanecDdv ?? false,
    davcnaStevilka: k.davcnaStevilka ?? "",
    idZaDdv: k.idZaDdv ?? "",
    maticnaStevilka: k.maticnaStevilka ?? "",
    trr: k.trr ?? [],
    email: k.email ?? "",
    telefon: k.telefon ?? "",
  };
}

function sestaviNaslov(k: { ulica?: string | null; postnaStevilka?: string | null; kraj?: string | null }): string | null {
  const row1 = k.ulica?.trim() || null;
  const row2 = [k.postnaStevilka?.trim(), k.kraj?.trim()].filter(Boolean).join(" ") || null;
  return [row1, row2].filter(Boolean).join(", ") || null;
}

export function ShranjeniKupciSelector({ naziv, naslov, davcnaStevilka, onSelect }: ShranjeniKupciSelectorProps) {
  const [open, setOpen] = useState(false);
  const [iskalniNiz, setIskalniNiz] = useState("");
  const [editOpen, setEditOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  const [form, setForm] = useState<KupecForm>(prazenForm());
  const [savingEdit, setSavingEdit] = useState(false);

  const { data: pogosti, isLoading: pogostiLoading } = useGetKupciPogosti();
  const { data: shranjeni, isLoading } = useListShranjeniKupci();
  const createMutation = useCreateShranjenKupec();
  const deleteMutation = useDeleteShranjenKupec();
  const updateMutation = useUpdateShranjenKupec();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const imaKupca = !!(naziv || davcnaStevilka);

  const filtrirani = (shranjeni ?? []).filter(k => {
    if (!iskalniNiz) return true;
    const q = iskalniNiz.toLowerCase();
    return (
      k.naziv.toLowerCase().includes(q) ||
      (k.kratkiNaziv ?? "").toLowerCase().includes(q) ||
      (k.davcnaStevilka ?? "").includes(q) ||
      (k.email ?? "").toLowerCase().includes(q)
    );
  });

  const handleShrani = () => {
    if (!naziv) return;
    createMutation.mutate(
      { data: { naziv, naslov: naslov ?? null, davcnaStevilka: davcnaStevilka || null } },
      {
        onSuccess: () => {
          toast({ title: "Kupec shranjen", description: `"${naziv}" dodan v shranjene kupce.` });
          void queryClient.invalidateQueries({ queryKey: getListShranjeniKupciQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetKupciPogostiQueryKey() });
          setOpen(true);
        },
        onError: () => {
          toast({ title: "Napaka", description: "Kupca ni bilo mogoče shraniti.", variant: "destructive" });
        },
      }
    );
  };

  const handleDelete = (id: number, ime: string) => {
    deleteMutation.mutate(
      { id },
      {
        onSuccess: () => {
          toast({ title: "Kupec izbrisan", description: `"${ime}" odstranjen.` });
          void queryClient.invalidateQueries({ queryKey: getListShranjeniKupciQueryKey() });
          void queryClient.invalidateQueries({ queryKey: getGetKupciPogostiQueryKey() });
        },
        onError: () => {
          toast({ title: "Napaka", description: "Kupca ni bilo mogoče izbrisati.", variant: "destructive" });
        },
      }
    );
  };

  const handleUredi = (k: ShranjenKupec) => {
    setEditId(k.id);
    setForm(kupecVForm(k));
    setEditOpen(true);
  };

  const handleNoviKupec = () => {
    setEditId(null);
    setForm(prazenForm());
    setEditOpen(true);
  };

  const handleShraniUredi = async () => {
    if (!form.naziv.trim()) {
      toast({ title: "Obvezno polje", description: "Dolgi naziv je obvezen.", variant: "destructive" });
      return;
    }
    setSavingEdit(true);
    const payload = {
      naziv: form.naziv.trim(),
      kratkiNaziv: form.kratkiNaziv.trim() || null,
      ulica: form.ulica.trim() || null,
      postnaStevilka: form.postnaStevilka.trim() || null,
      kraj: form.kraj.trim() || null,
      drzava: form.drzava.trim() || null,
      kodaDrzave: form.kodaDrzave.trim() || null,
      zavezanecDdv: form.zavezanecDdv || null,
      davcnaStevilka: form.davcnaStevilka.trim() || null,
      idZaDdv: form.idZaDdv.trim() || null,
      maticnaStevilka: form.maticnaStevilka.trim() || null,
      trr: form.trr.filter(t => t.iban.trim()).map(t => ({ iban: t.iban.trim(), bic: t.bic.trim() })),
      email: form.email.trim() || null,
      telefon: form.telefon.trim() || null,
    };
    try {
      if (editId != null) {
        await updateMutation.mutateAsync({ id: editId, data: payload });
        toast({ title: "Kupec posodobljen" });
      } else {
        await createMutation.mutateAsync({ data: payload });
        toast({ title: "Kupec shranjen" });
      }
      void queryClient.invalidateQueries({ queryKey: getListShranjeniKupciQueryKey() });
      void queryClient.invalidateQueries({ queryKey: getGetKupciPogostiQueryKey() });
      // Po shranitvi samodejno izberi kupca za račun
      const sestavljenNaslov = sestaviNaslov(form) ?? null;
      onSelect({
        naziv: form.kratkiNaziv.trim() || form.naziv.trim() || null,
        naslov: sestavljenNaslov,
        davcnaStevilka: form.davcnaStevilka.trim(),
      });
      setOpen(false);
      setEditOpen(false);
    } catch {
      toast({ title: "Napaka", description: "Podatkov ni bilo mogoče shraniti.", variant: "destructive" });
    } finally {
      setSavingEdit(false);
    }
  };
  useF2Save(handleShraniUredi, editOpen && !savingEdit && !!form.naziv.trim());

  const handleSelect = (k: ShranjenKupec) => {
    const sestavljenNaslov = sestaviNaslov(k) ?? k.naslov ?? null;
    onSelect({
      naziv: k.kratkiNaziv || k.naziv,
      naslov: sestavljenNaslov,
      davcnaStevilka: k.davcnaStevilka ?? "",
    });
    setOpen(false);
  };

  const setField = (key: keyof KupecForm, value: string | boolean) =>
    setForm(f => ({ ...f, [key]: value }));

  const addTrr = () => setForm(f => ({ ...f, trr: [...f.trr, { iban: "", bic: "" }] }));
  const removeTrr = (i: number) => setForm(f => ({ ...f, trr: f.trr.filter((_, idx) => idx !== i) }));
  const setTrr = (i: number, key: "iban" | "bic", val: string) =>
    setForm(f => { const trr = [...f.trr]; trr[i] = { ...trr[i]!, [key]: val }; return { ...f, trr }; });

  return (
    <div className="space-y-2">
      {/* Pogosti kupci */}
      {!imaKupca && (
        <div className="space-y-1.5">
          {pogostiLoading ? (
            <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
              <Loader2 className="h-3 w-3 animate-spin" />
              <span>Nalagam pogoste kupce…</span>
            </div>
          ) : pogosti && pogosti.length > 0 ? (
            <>
              <p className="flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                <Clock className="h-3 w-3" />
                Pogosti kupci
              </p>
              <div className="flex flex-wrap gap-1.5">
                {pogosti.map(k => (
                  <button
                    key={k.id}
                    type="button"
                    onClick={() => handleSelect(k)}
                    className="inline-flex items-center gap-1 rounded-full border border-input bg-background px-2.5 py-0.5 text-xs font-medium hover:bg-muted/60 hover:border-primary/50 transition-colors max-w-[180px] truncate"
                    title={[k.kratkiNaziv || k.naziv, k.davcnaStevilka].filter(Boolean).join(" · ")}
                  >
                    <span className="truncate">{k.kratkiNaziv || k.naziv}</span>
                    {k.steviloUpor > 1 && (
                      <span className="shrink-0 text-[10px] text-muted-foreground">×{k.steviloUpor}</span>
                    )}
                  </button>
                ))}
              </div>
            </>
          ) : null}
        </div>
      )}

      {/* Gumbi */}
      <div className="flex gap-2 flex-wrap">
        <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1.5"
          onClick={() => { setOpen(v => !v); setIskalniNiz(""); }}>
          <BookUser className="h-3.5 w-3.5" />
          Shranjeni kupci
          {shranjeni && shranjeni.length > 0 && (
            <span className="rounded-full bg-primary/10 text-primary px-1.5 py-0 text-[10px] font-semibold leading-4">{shranjeni.length}</span>
          )}
        </Button>
        {imaKupca && naziv && (
          <Button type="button" variant="outline" size="sm" className="h-7 text-xs gap-1.5"
            disabled={createMutation.isPending} onClick={handleShrani}>
            {createMutation.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Star className="h-3.5 w-3.5" />}
            Shrani kupca
          </Button>
        )}
      </div>

      {/* Seznam shranjenih */}
      {open && (
        <div className="rounded-lg border bg-background shadow-sm p-3 space-y-2">
          <div className="flex items-center justify-between">
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">Shranjeni kupci</p>
            <div className="flex items-center gap-2">
              <button type="button" onClick={handleNoviKupec}
                className="text-xs text-primary hover:underline flex items-center gap-1">
                <Plus className="h-3 w-3" /> Nov kupec
              </button>
              <button type="button" onClick={() => setOpen(false)} className="text-muted-foreground hover:text-foreground">
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="relative">
            <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <Input placeholder="Išči po imenu, davčni ali e-pošti..."
              value={iskalniNiz} onChange={e => setIskalniNiz(e.target.value)}
              className="h-8 text-sm pl-7" autoFocus />
          </div>
          {isLoading ? (
            <div className="flex justify-center py-3"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
          ) : filtrirani.length === 0 ? (
            <p className="text-xs text-muted-foreground text-center py-3 italic">
              {shranjeni?.length === 0 ? "Ni shranjenih kupcev." : "Ni zadetkov."}
            </p>
          ) : (
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {filtrirani.map(k => (
                <div key={k.id} className="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted/60 group">
                  <button type="button" className="flex-1 text-left min-w-0" onClick={() => handleSelect(k)}>
                    <p className="text-sm font-medium truncate">{k.kratkiNaziv || k.naziv}</p>
                    <p className="text-xs text-muted-foreground truncate">
                      {k.kratkiNaziv ? k.naziv + " · " : ""}
                      {[k.davcnaStevilka, sestaviNaslov(k) ?? k.naslov].filter(Boolean).join(" · ") || <span className="italic">brez dodatnih podatkov</span>}
                    </p>
                  </button>
                  <button type="button"
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-primary transition-opacity"
                    onClick={() => handleUredi(k)} title="Uredi podatke kupca">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button type="button"
                    className="shrink-0 opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-destructive transition-opacity"
                    onClick={() => handleDelete(k.id, k.naziv)} disabled={deleteMutation.isPending}
                    title="Izbriši shranjenega kupca">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Dialog za urejanje / dodajanje kupca */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="max-w-xl max-h-[90vh] flex flex-col p-0 gap-0">
          <DialogHeader className="p-4 pb-0 shrink-0">
            <DialogTitle>{editId != null ? "Uredi kupca" : "Nov kupec"}</DialogTitle>
          </DialogHeader>
          <div className="flex-1 min-h-0 overflow-y-auto p-4 pt-3">
            <div className="space-y-4">

              {/* Identifikacija */}
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Identifikacija</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Dolgi naziv *</Label>
                    <Input value={form.naziv} onChange={e => setField("naziv", e.target.value)} placeholder="Polno ime / firma" />
                  </div>
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Kratki naziv</Label>
                    <Input value={form.kratkiNaziv} onChange={e => setField("kratkiNaziv", e.target.value)} placeholder="Skrajšano ime" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Davčna številka</Label>
                    <Input value={form.davcnaStevilka} onChange={e => setField("davcnaStevilka", e.target.value)} placeholder="12345678" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">ID za DDV</Label>
                    <Input value={form.idZaDdv} onChange={e => setField("idZaDdv", e.target.value)} placeholder="SI12345678" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Matična številka</Label>
                    <Input value={form.maticnaStevilka} onChange={e => setField("maticnaStevilka", e.target.value)} placeholder="1234567000" />
                  </div>
                  <div className="flex items-center gap-2 pt-5">
                    <Checkbox id="zavezanec" checked={form.zavezanecDdv}
                      onCheckedChange={v => setField("zavezanecDdv", !!v)} />
                    <Label htmlFor="zavezanec" className="text-xs cursor-pointer">Zavezanec za DDV</Label>
                  </div>
                </div>
              </section>

              {/* Naslov */}
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Naslov</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="col-span-2 space-y-1">
                    <Label className="text-xs">Ulica in hišna številka</Label>
                    <Input value={form.ulica} onChange={e => setField("ulica", e.target.value)} placeholder="Ulica 12" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Poštna številka</Label>
                    <Input value={form.postnaStevilka} onChange={e => setField("postnaStevilka", e.target.value)} placeholder="1000" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Kraj</Label>
                    <Input value={form.kraj} onChange={e => setField("kraj", e.target.value)} placeholder="Ljubljana" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Država</Label>
                    <Input value={form.drzava} onChange={e => setField("drzava", e.target.value)} placeholder="Slovenija" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Koda države</Label>
                    <Input value={form.kodaDrzave} onChange={e => setField("kodaDrzave", e.target.value)} placeholder="SI" maxLength={3} />
                  </div>
                </div>
              </section>

              {/* Kontakt */}
              <section className="space-y-2">
                <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Kontakt</p>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label className="text-xs">E-pošta</Label>
                    <Input type="email" value={form.email} onChange={e => setField("email", e.target.value)} placeholder="info@podjetje.si" />
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Telefon</Label>
                    <Input value={form.telefon} onChange={e => setField("telefon", e.target.value)} placeholder="+386 1 234 5678" />
                  </div>
                </div>
              </section>

              {/* TRR */}
              <section className="space-y-2">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">TRR računi</p>
                  <button type="button" onClick={addTrr}
                    className="flex items-center gap-1 text-xs text-primary hover:underline">
                    <Plus className="h-3 w-3" /> Dodaj TRR
                  </button>
                </div>
                {form.trr.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">Ni vpisanih TRR računov.</p>
                ) : (
                  <div className="space-y-2">
                    {form.trr.map((t, i) => (
                      <div key={i} className="flex gap-2 items-end">
                        <div className="flex-1 space-y-1">
                          <Label className="text-xs">IBAN</Label>
                          <Input value={t.iban} onChange={e => setTrr(i, "iban", e.target.value)} placeholder="SI56 1234 5678 9012 3456" />
                        </div>
                        <div className="w-28 space-y-1">
                          <Label className="text-xs">BIC</Label>
                          <Input value={t.bic} onChange={e => setTrr(i, "bic", e.target.value)} placeholder="LJBASI2X" />
                        </div>
                        <button type="button" onClick={() => removeTrr(i)}
                          className="shrink-0 mb-1 text-muted-foreground hover:text-destructive">
                          <Minus className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </section>
            </div>
          </div>

          <div className="shrink-0 p-4 pt-3 border-t flex gap-2 justify-end">
            <Button variant="outline" onClick={() => setEditOpen(false)}>Prekliči</Button>
            <Button onClick={() => { void handleShraniUredi(); }} disabled={savingEdit}>
              {savingEdit ? <Loader2 className="h-4 w-4 animate-spin mr-1.5" /> : null}
              Shrani <kbd className="ml-1 text-[10px] font-mono opacity-60 border border-current/40 rounded px-0.5 leading-none">F2</kbd>
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
