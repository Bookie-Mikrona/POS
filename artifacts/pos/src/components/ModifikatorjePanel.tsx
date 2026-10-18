import { formatEur } from "@/lib/formatEur";
import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, ChevronDown, ChevronRight, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DecimalInput, parseDecimal } from "@/components/ui/decimal-input";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { useToast } from "@/hooks/use-toast";
import {
  useListModSkupine,
  useGetModSkupina,
  useCreateModSkupina,
  useUpdateModSkupina,
  useDeleteModSkupina,
  useAddModifikator,
  useUpdateModifikator,
  useDeleteModifikator,
  useGetModifikatorNormativi,
  useSetModifikatorNormativi,
  useListArtikli,
  getListArtikliQueryKey,
  getListModSkupineQueryKey,
  getGetModSkupinaQueryKey,
  getGetModifikatorNormativiQueryKey,
} from "@workspace/api-client-react";
import type { ModSkupina, Modifikator } from "@workspace/api-client-react";
import { canUseAsModifierNormativInput } from "@/lib/normativ-eligibility";
import { normalizePreparedFoodUnit } from "@/lib/prepared-food-unit";
import { displayEslogUnit } from "@/components/EslogUnitPicker";

interface Props {
  jeUporabnik: boolean;
}

interface NormativVrstica {
  vhodniArtikelId: number;
  kolicina: string;
}

function napakaSporocilo(err: unknown): string | undefined {
  const data = (err as { data?: { error?: unknown } } | null)?.data;
  return typeof data?.error === "string" ? data.error : undefined;
}

const EMPTY_GROUP_FORM = { ime: "", obvezna: false, minIzbir: 0, maxIzbir: 0 };
const EMPTY_MOD_FORM = { ime: "", cenaDodatek: "0", aktiven: true, privzet: false };

export default function ModifikatorjePanel({ jeUporabnik }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: skupineList, isLoading } = useListModSkupine();
  const { data: vsiArtikli } = useListArtikli();
  const kandidati = (vsiArtikli ?? []).filter(a => !a.drobniInventar);
  const nabavniArtikli = kandidati.filter(a => a.nabavniArtikel);
  const polizdelki = kandidati.filter(a => !a.nabavniArtikel && !a.prodajniArtikel && canUseAsModifierNormativInput(a));
  const prodajniArtikli = kandidati.filter(a => !a.nabavniArtikel && a.prodajniArtikel && canUseAsModifierNormativInput(a));

  const [expandedId, setExpandedId] = useState<number | null>(null);
  const { data: expandedSkupina, isLoading: loadingExpanded } = useGetModSkupina(expandedId ?? 0);

  const [groupDialogOpen, setGroupDialogOpen] = useState(false);
  const [groupMode, setGroupMode] = useState<"nova" | "uredi">("nova");
  const [editingGroup, setEditingGroup] = useState<ModSkupina | null>(null);
  const [groupForm, setGroupForm] = useState(EMPTY_GROUP_FORM);

  const [modDialogOpen, setModDialogOpen] = useState(false);
  const [modMode, setModMode] = useState<"nov" | "uredi">("nov");
  const [modSkupinaId, setModSkupinaId] = useState<number | null>(null);
  const [editingMod, setEditingMod] = useState<Modifikator | null>(null);
  const [modForm, setModForm] = useState(EMPTY_MOD_FORM);
  const [modNormativi, setModNormativi] = useState<NormativVrstica[]>([]);

  const { data: loadedNormativi } = useGetModifikatorNormativi(editingMod?.id ?? 0, {
    query: {
      enabled: modMode === "uredi" && modDialogOpen && editingMod != null,
      queryKey: getGetModifikatorNormativiQueryKey(editingMod?.id ?? 0),
    },
  });

  useEffect(() => {
    if (modMode === "uredi" && modDialogOpen && loadedNormativi != null) {
      setModNormativi(loadedNormativi.map(n => ({
        vhodniArtikelId: n.vhodniArtikelId,
        kolicina: String(n.kolicina),
      })));
    }
  }, [loadedNormativi, modMode, modDialogOpen]);

  const createSkupina = useCreateModSkupina();
  const updateSkupina = useUpdateModSkupina();
  const deleteSkupina = useDeleteModSkupina();
  const addMod = useAddModifikator();
  const updateMod = useUpdateModifikator();
  const deleteMod = useDeleteModifikator();
  const setNormativi = useSetModifikatorNormativi();

  const invalidateSkupine = (skupinaId?: number) => {
    qc.invalidateQueries({ queryKey: getListArtikliQueryKey() });
    qc.invalidateQueries({ queryKey: getListModSkupineQueryKey() });
    qc.refetchQueries({ queryKey: getListModSkupineQueryKey() });
    if (skupinaId != null) {
      qc.invalidateQueries({ queryKey: getGetModSkupinaQueryKey(skupinaId) });
      qc.refetchQueries({ queryKey: getGetModSkupinaQueryKey(skupinaId) });
    } else if (expandedId != null) {
      qc.invalidateQueries({ queryKey: getGetModSkupinaQueryKey(expandedId) });
      qc.refetchQueries({ queryKey: getGetModSkupinaQueryKey(expandedId) });
    }
  };

  const saveNormativiForMod = (modId: number, onDone?: () => void) => {
    setNormativi.mutate(
      { id: modId, data: { normativi: modNormativi.map(n => ({ vhodniArtikelId: n.vhodniArtikelId, kolicina: parseDecimal(n.kolicina) })) } },
      {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getGetModifikatorNormativiQueryKey(modId) });
          onDone?.();
        },
        onError: () => toast({ title: "Napaka pri shranjevanju normativa", variant: "destructive" }),
      }
    );
  };

  const openNewGroup = () => {
    setGroupMode("nova");
    setEditingGroup(null);
    setGroupForm(EMPTY_GROUP_FORM);
    setGroupDialogOpen(true);
  };

  const openEditGroup = (s: ModSkupina) => {
    setGroupMode("uredi");
    setEditingGroup(s);
    setGroupForm({ ime: s.ime, obvezna: s.obvezna, minIzbir: s.minIzbir, maxIzbir: s.maxIzbir });
    setGroupDialogOpen(true);
  };

  const handleSaveGroup = () => {
    if (!groupForm.ime) return;
    const data = {
      ime: groupForm.ime,
      obvezna: groupForm.obvezna,
      minIzbir: groupForm.minIzbir,
      maxIzbir: groupForm.maxIzbir,
    };
    if (groupMode === "uredi" && editingGroup) {
      updateSkupina.mutate({ id: editingGroup.id, data }, {
        onSuccess: () => { invalidateSkupine(editingGroup.id); setGroupDialogOpen(false); toast({ title: "Skupina posodobljena" }); },
        onError: (err) => toast({ title: "Napaka", description: napakaSporocilo(err), variant: "destructive" }),
      });
    } else {
      createSkupina.mutate({ data }, {
        onSuccess: () => { invalidateSkupine(); setGroupDialogOpen(false); toast({ title: "Skupina dodana" }); },
        onError: (err) => toast({ title: "Napaka", description: napakaSporocilo(err), variant: "destructive" }),
      });
    }
  };

  const handleDeleteGroup = (id: number) => {
    deleteSkupina.mutate({ id: String(id) as any }, {
      onSuccess: () => {
        if (expandedId === id) setExpandedId(null);
        invalidateSkupine();
        toast({ title: "Skupina izbrisana" });
      },
      onError: () => toast({ title: "Napaka pri brisanju", variant: "destructive" }),
    });
  };

  const openNewMod = (skupId: number) => {
    setModMode("nov");
    setModSkupinaId(skupId);
    setEditingMod(null);
    setModForm(EMPTY_MOD_FORM);
    setModNormativi([]);
    setModDialogOpen(true);
  };

  const openEditMod = (m: Modifikator) => {
    setModMode("uredi");
    setEditingMod(m);
    setModSkupinaId(m.skupinaId);
    setModForm({ ime: m.ime, cenaDodatek: String(m.cenaDodatek), aktiven: m.aktiven, privzet: m.privzet === true });
    setModNormativi([]);
    setModDialogOpen(true);
  };

  const handleSaveMod = () => {
    if (!modForm.ime) return;
    if (modNormativi.some(n =>
      n.vhodniArtikelId <= 0
      || n.kolicina.trim() === ""
      || !Number.isFinite(parseDecimal(n.kolicina))
      || parseDecimal(n.kolicina) === 0
    )) {
      toast({
        title: "Nepopoln normativ modifikatorja",
        description: "Izberite artikel in vnesite neničelno količino za vsako vrstico ali prazno vrstico odstranite.",
        variant: "destructive",
      });
      return;
    }
    const data = {
      ime: modForm.ime,
      cenaDodatek: parseDecimal(modForm.cenaDodatek) || 0,
      aktiven: modForm.aktiven,
      privzet: modForm.privzet,
    };
    if (modMode === "uredi" && editingMod) {
      updateMod.mutate({ id: editingMod.id, data }, {
        onSuccess: () => {
          qc.invalidateQueries({ queryKey: getListArtikliQueryKey() });
          if (modSkupinaId) qc.invalidateQueries({ queryKey: getGetModSkupinaQueryKey(modSkupinaId) });
          saveNormativiForMod(editingMod.id, () => {
            setModDialogOpen(false);
            toast({ title: "Modifikator posodobljen" });
          });
        },
        onError: (err) => toast({ title: "Napaka", description: napakaSporocilo(err), variant: "destructive" }),
      });
    } else if (modSkupinaId) {
      addMod.mutate({ id: modSkupinaId, data }, {
        onSuccess: (newMod) => {
          qc.invalidateQueries({ queryKey: getListArtikliQueryKey() });
          qc.invalidateQueries({ queryKey: getGetModSkupinaQueryKey(modSkupinaId) });
          saveNormativiForMod(newMod.id, () => {
            setModDialogOpen(false);
            toast({ title: "Modifikator dodan" });
          });
        },
        onError: (err) => toast({ title: "Napaka", description: napakaSporocilo(err), variant: "destructive" }),
      });
    }
  };

  const handleDeleteMod = (m: Modifikator) => {
    deleteMod.mutate({ id: m.id }, {
      onSuccess: () => {
        qc.invalidateQueries({ queryKey: getListArtikliQueryKey() });
        qc.invalidateQueries({ queryKey: getGetModSkupinaQueryKey(m.skupinaId) });
        toast({ title: "Modifikator izbrisan" });
      },
      onError: () => toast({ title: "Napaka pri brisanju", variant: "destructive" }),
    });
  };

  const addNormativVrstica = () => {
    setModNormativi(prev => [...prev, { vhodniArtikelId: 0, kolicina: "" }]);
  };

  const removeNormativVrstica = (idx: number) => {
    setModNormativi(prev => prev.filter((_, i) => i !== idx));
  };

  const updateNormativVrstica = (idx: number, field: keyof NormativVrstica, value: string | number) => {
    setModNormativi(prev => prev.map((v, i) => i === idx ? { ...v, [field]: value } : v));
  };

  const isPendingGroup = createSkupina.isPending || updateSkupina.isPending;
  const isPendingMod = addMod.isPending || updateMod.isPending || setNormativi.isPending;

  return (
    <Card className="flex flex-col h-full border-border/50 shadow-sm overflow-hidden bg-card">
      <div className="px-3 py-2 border-b border-border/50 bg-muted/30 flex items-center justify-between">
        <div className="flex flex-col">
          <h2 className="font-medium text-sm tracking-tight text-foreground flex items-center gap-1.5">
            <Settings2 className="w-4 h-4 text-muted-foreground" />
            Modifikatorji
          </h2>
        </div>
        {!jeUporabnik && (
          <Button variant="ghost" size="sm" className="h-7 px-2 text-xs" onClick={openNewGroup}>
            <Plus className="w-3.5 h-3.5 mr-1" /> Dodaj
          </Button>
        )}
      </div>

      <div className="flex-1 overflow-y-auto max-h-[50vh] p-1 scrollbar-hidden">
      {isLoading ? (
        <div className="p-4 text-center text-xs text-muted-foreground">Nalaganje...</div>
      ) : !skupineList?.length ? (
        <div className="p-4 text-center text-xs text-muted-foreground">
          Ni modifikatorskih skupin.
          {!jeUporabnik && " Dodajte jo zgoraj."}
        </div>
      ) : (
        <div className="space-y-0.5">
          {skupineList.map(s => {
            const isExpanded = expandedId === s.id;
            return (
              <div key={s.id} className="rounded-md overflow-hidden">
                <div
                  className="flex items-center gap-2 px-3 py-2 hover:bg-muted/50 transition-colors cursor-pointer select-none group"
                  onClick={() => setExpandedId(isExpanded ? null : s.id)}
                >
                  <span className="text-muted-foreground shrink-0">
                    {isExpanded
                      ? <ChevronDown className="w-3.5 h-3.5" />
                      : <ChevronRight className="w-3.5 h-3.5" />}
                  </span>
                  <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap pr-2">
                    <span className="text-sm font-medium truncate">{s.ime}</span>
                    {s.obvezna ? (
                      <Badge className="bg-red-100 text-red-800 border-red-200 text-[9px] px-1 py-0 h-3.5 leading-none">Obvezna</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[9px] px-1 py-0 h-3.5 leading-none">Izbirna</Badge>
                    )}
                    <span className="text-[10px] text-muted-foreground">
                      {s.minIzbir === 0 && s.maxIzbir === 0
                        ? "neomejeno"
                        : s.maxIzbir === 0
                          ? `vsaj ${s.minIzbir}`
                          : `${s.minIzbir}–${s.maxIzbir}`}
                    </span>
                  </div>
                  {!jeUporabnik && (
                    <div className="flex items-center gap-0.5 shrink-0 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-muted-foreground hover:text-foreground" onClick={() => openEditGroup(s)}>
                        <Pencil className="w-3 h-3" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-6 w-6 text-destructive/70 hover:text-destructive" onClick={() => handleDeleteGroup(s.id)}>
                        <Trash2 className="w-3 h-3" />
                      </Button>
                    </div>
                  )}
                </div>

                {isExpanded && (
                  <div className="bg-muted/10 px-3 py-2 pb-3 ml-6 border-l-2 border-border/50 space-y-1.5 mt-0.5">
                    {loadingExpanded ? (
                      <p className="text-xs text-muted-foreground">Nalaganje...</p>
                    ) : (
                      <>
                        {!expandedSkupina?.modifikatorji?.length ? (
                          <p className="text-xs text-muted-foreground">Ni modifikatorjev.</p>
                        ) : (
                          <div className="space-y-1">
                            {s.obvezna && (() => {
                              const potrebno = Math.max(1, s.minIzbir);
                              const privzetih = expandedSkupina.modifikatorji.filter(x => x.aktiven && x.privzet).length;
                              return privzetih === potrebno ? null : (
                                <p className="text-[11px] text-amber-700">
                                  Obvezna skupina zahteva {potrebno} privzeto izbiro (določeno: {privzetih}). Uredite modifikator in obkljukajte »Privzeto obkljukan ob odprtju izbire«.
                                </p>
                              );
                            })()}
                            {expandedSkupina.modifikatorji.map(m => (
                              <div
                                key={m.id}
                                className={`flex items-center gap-2 px-2 py-1.5 rounded bg-background border border-border/50 shadow-sm group ${!m.aktiven ? "opacity-60" : ""}`}
                              >
                                <div className="flex-1 min-w-0 flex items-center gap-2">
                                  <span className="text-xs font-medium text-foreground">{m.ime}</span>
                                  {m.cenaDodatek !== 0 && (
                                    <span className="text-[10px] text-muted-foreground font-mono bg-muted px-1 rounded">
                                      {m.cenaDodatek > 0 ? "+" : ""}{formatEur(m.cenaDodatek)}
                                    </span>
                                  )}
                                  {m.privzet && (
                                    <Badge className="bg-green-100 text-green-800 border-green-200 text-[9px] px-1 py-0 h-3.5 leading-none">Privzeto</Badge>
                                  )}
                                  {!m.aktiven && (
                                    <Badge variant="secondary" className="text-[9px] px-1 py-0 h-3.5 leading-none">Neaktiven</Badge>
                                  )}
                                </div>
                                {!jeUporabnik && (
                                  <div className="flex gap-0.5 shrink-0 opacity-100 lg:opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Button variant="ghost" size="icon" className="h-5 w-5 text-muted-foreground hover:text-foreground" onClick={() => openEditMod(m)}>
                                      <Pencil className="w-3 h-3" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-5 w-5 text-destructive/70 hover:text-destructive" onClick={() => handleDeleteMod(m)}>
                                      <Trash2 className="w-3 h-3" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {!jeUporabnik && (
                          <Button size="sm" variant="ghost" className="h-6 px-2 text-[10px] text-muted-foreground hover:text-foreground mt-1" onClick={() => openNewMod(s.id)}>
                            <Plus className="w-3 h-3 mr-1" /> Dodaj modifikator
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
      </div>

      {/* ── Group dialog ─────────────────────────────────────── */}
      <Dialog open={groupDialogOpen} onOpenChange={setGroupDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{groupMode === "uredi" ? "Uredi skupino" : "Nova modifikatorska skupina"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Ime skupine</Label>
              <Input
                value={groupForm.ime}
                onChange={e => setGroupForm(f => ({ ...f, ime: e.target.value }))}
                placeholder="Npr. Stopnja pečenosti"
                autoFocus
                onKeyDown={e => { if (e.key === "Enter" && groupForm.ime) handleSaveGroup(); }}
              />
            </div>
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <input
                type="checkbox"
                id="skupinaObvezna"
                checked={groupForm.obvezna}
                onChange={e => setGroupForm(f => ({ ...f, obvezna: e.target.checked }))}
                className="w-4 h-4 accent-primary"
              />
              <Label htmlFor="skupinaObvezna" className="cursor-pointer">
                Obvezna izbira{" "}
                <span className="text-xs font-normal text-muted-foreground">(gost mora izbrati vsaj en modifikator)</span>
              </Label>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Min. izbir</Label>
                <Input
                  type="number" min="0" max="20"
                  value={groupForm.minIzbir}
                  onChange={e => setGroupForm(f => ({ ...f, minIzbir: parseInt(e.target.value) || 0 }))}
                />
                <p className="text-xs text-muted-foreground">0 = brez omejitve</p>
              </div>
              <div className="space-y-2">
                <Label>Maks. izbir</Label>
                <Input
                  type="number" min="0" max="20"
                  value={groupForm.maxIzbir}
                  onChange={e => setGroupForm(f => ({ ...f, maxIzbir: parseInt(e.target.value) || 0 }))}
                />
                <p className="text-xs text-muted-foreground">0 = brez omejitve</p>
              </div>
            </div>
            <Button className="w-full" onClick={handleSaveGroup} disabled={isPendingGroup || !groupForm.ime}>
              {isPendingGroup ? "Shranjujem..." : groupMode === "uredi" ? "Posodobi skupino" : "Dodaj skupino"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      {/* ── Modifier dialog ──────────────────────────────────── */}
      <Dialog open={modDialogOpen} onOpenChange={setModDialogOpen}>
        <DialogContent className="sm:max-w-md max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>{modMode === "uredi" ? "Uredi modifikator" : "Nov modifikator"}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="space-y-2">
              <Label>Ime</Label>
              <Input
                value={modForm.ime}
                onChange={e => setModForm(f => ({ ...f, ime: e.target.value }))}
                placeholder="Npr. Brez čebule"
                autoFocus
              />
            </div>
            <div className="space-y-2">
              <Label>Doplačilo (€)</Label>
              <DecimalInput
                allowNegative
                value={modForm.cenaDodatek}
                onChange={e => setModForm(f => ({ ...f, cenaDodatek: e.target.value }))}
                placeholder="0,00"
              />
              <p className="text-xs text-muted-foreground">0 = brezplačno · pozitivno = doplačilo · negativno = popust</p>
            </div>
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <input
                type="checkbox"
                id="modAktiven"
                checked={modForm.aktiven}
                onChange={e => setModForm(f => ({ ...f, aktiven: e.target.checked }))}
                className="w-4 h-4 accent-primary"
              />
              <Label htmlFor="modAktiven" className="cursor-pointer">Modifikator je aktiven</Label>
            </div>
            <div className="flex items-center gap-3 rounded-lg border p-3">
              <input
                type="checkbox"
                id="modPrivzet"
                checked={modForm.privzet}
                onChange={e => setModForm(f => ({ ...f, privzet: e.target.checked }))}
                className="w-4 h-4 accent-primary"
              />
              <Label htmlFor="modPrivzet" className="cursor-pointer">Privzeto obkljukan ob odprtju izbire</Label>
            </div>

            {/* ── Normativ ── */}
            {(nabavniArtikli.length > 0 || polizdelki.length > 0 || prodajniArtikli.length > 0) && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Normativ (sestavnice)</Label>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={addNormativVrstica}>
                    <Plus className="w-3 h-3 mr-1" />Dodaj vrstico
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  Če izberete prodajni artikel z lastnimi modifikatorji, se ob izbiri tega modifikatorja v naročilu odprejo tudi možnosti izbranega artikla.
                </p>
                {modNormativi.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-1">Ni sestavin — ob izbiri tega modifikatorja se zaloga ne razknjižuje.</p>
                ) : (
                  <div className="space-y-1.5">
                    {modNormativi.map((vrstica, idx) => {
                      const selected = kandidati.find(article => article.id === vrstica.vhodniArtikelId);
                      const unit = selected?.mealType === "prepared"
                        ? normalizePreparedFoodUnit(selected.enotaMere)
                        : displayEslogUnit(selected?.enotaMere) || "—";
                      return (
                      <div key={idx} className="grid grid-cols-[minmax(0,1fr)_7rem_2.25rem] items-center gap-2">
                        <select
                          className="h-9 w-full min-w-0 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                          value={vrstica.vhodniArtikelId || ""}
                          onChange={e => updateNormativVrstica(idx, "vhodniArtikelId", parseInt(e.target.value) || 0)}
                        >
                          <option value="">— izberite artikel —</option>
                          {nabavniArtikli.length > 0 && (
                            <optgroup label="Nabavni artikli">
                              {nabavniArtikli.map(a => (
                                <option key={a.id} value={a.id}>{a.ime}</option>
                              ))}
                            </optgroup>
                          )}
                          {polizdelki.length > 0 && (
                            <optgroup label="Polizdelki">
                              {polizdelki.map(a => (
                                <option key={a.id} value={a.id}>{a.ime}</option>
                              ))}
                            </optgroup>
                          )}
                          {prodajniArtikli.length > 0 && (
                            <optgroup label="Prodajni artikli">
                              {prodajniArtikli.map(a => (
                                <option key={a.id} value={a.id}>{a.ime}</option>
                              ))}
                            </optgroup>
                          )}
                        </select>
                        <div className="flex min-w-0 items-center gap-1">
                          <DecimalInput
                            allowNegative
                            className="w-full min-w-0"
                            aria-label={`Količina sestavnice ${idx + 1}`}
                            placeholder="Kol."
                            value={vrstica.kolicina}
                            onChange={e => updateNormativVrstica(idx, "kolicina", e.target.value)}
                          />
                          <span className="text-xs text-muted-foreground">{unit}</span>
                        </div>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-9 w-9 shrink-0"
                          onClick={() => removeNormativVrstica(idx)}
                        >
                          <X className="w-4 h-4 text-destructive" />
                        </Button>
                      </div>
                      );
                    })}
                    <p className="text-xs text-muted-foreground">Negativna količina = ob izbiri modifikatorja se zaloga poveča (npr. sneti sestavino).</p>
                  </div>
                )}
              </div>
            )}

            <Button className="w-full" onClick={handleSaveMod} disabled={isPendingMod || !modForm.ime}>
              {isPendingMod ? "Shranjujem..." : modMode === "uredi" ? "Posodobi modifikator" : "Dodaj modifikator"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
