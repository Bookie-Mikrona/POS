import { useState, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, Pencil, ChevronDown, ChevronRight, Settings2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  getListModSkupineQueryKey,
  getGetModSkupinaQueryKey,
  getGetModifikatorNormativiQueryKey,
} from "@workspace/api-client-react";
import type { ModSkupina, Modifikator } from "@workspace/api-client-react";

interface Props {
  jeUporabnik: boolean;
}

interface NormativVrstica {
  vhodniArtikelId: number;
  kolicina: string;
}

const EMPTY_GROUP_FORM = { ime: "", obvezna: false, minIzbir: 0, maxIzbir: 0 };
const EMPTY_MOD_FORM = { ime: "", cenaDodatek: "0", aktiven: true };

export default function ModifikatorjePanel({ jeUporabnik }: Props) {
  const qc = useQueryClient();
  const { toast } = useToast();

  const { data: skupineList, isLoading } = useListModSkupine();
  const { data: vsiArtikli } = useListArtikli();
  const nabavniArtikli = (vsiArtikli ?? []).filter(a => a.nabavniArtikel);

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
    const validVrstice = modNormativi.filter(n => n.vhodniArtikelId > 0 && n.kolicina !== "" && !isNaN(parseFloat(n.kolicina)));
    setNormativi.mutate(
      { id: modId, data: { normativi: validVrstice.map(n => ({ vhodniArtikelId: n.vhodniArtikelId, kolicina: parseFloat(n.kolicina) })) } },
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
        onError: () => toast({ title: "Napaka", variant: "destructive" }),
      });
    } else {
      createSkupina.mutate({ data }, {
        onSuccess: () => { invalidateSkupine(); setGroupDialogOpen(false); toast({ title: "Skupina dodana" }); },
        onError: () => toast({ title: "Napaka", variant: "destructive" }),
      });
    }
  };

  const handleDeleteGroup = (id: number) => {
    deleteSkupina.mutate({ id }, {
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
    setModForm({ ime: m.ime, cenaDodatek: String(m.cenaDodatek), aktiven: m.aktiven });
    setModNormativi([]);
    setModDialogOpen(true);
  };

  const handleSaveMod = () => {
    if (!modForm.ime) return;
    const data = {
      ime: modForm.ime,
      cenaDodatek: parseFloat(modForm.cenaDodatek) || 0,
      aktiven: modForm.aktiven,
    };
    if (modMode === "uredi" && editingMod) {
      updateMod.mutate({ id: editingMod.id, data }, {
        onSuccess: () => {
          if (modSkupinaId) qc.invalidateQueries({ queryKey: getGetModSkupinaQueryKey(modSkupinaId) });
          saveNormativiForMod(editingMod.id, () => {
            setModDialogOpen(false);
            toast({ title: "Modifikator posodobljen" });
          });
        },
        onError: () => toast({ title: "Napaka", variant: "destructive" }),
      });
    } else if (modSkupinaId) {
      addMod.mutate({ id: modSkupinaId, data }, {
        onSuccess: (newMod) => {
          qc.invalidateQueries({ queryKey: getGetModSkupinaQueryKey(modSkupinaId) });
          saveNormativiForMod(newMod.id, () => {
            setModDialogOpen(false);
            toast({ title: "Modifikator dodan" });
          });
        },
        onError: () => toast({ title: "Napaka", variant: "destructive" }),
      });
    }
  };

  const handleDeleteMod = (m: Modifikator) => {
    deleteMod.mutate({ id: m.id }, {
      onSuccess: () => {
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
    <div className="space-y-4">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Settings2 className="w-5 h-5" />
          Modifikatorske skupine
        </h2>
        {!jeUporabnik && (
          <Button size="sm" onClick={openNewGroup}>
            <Plus className="w-4 h-4 mr-2" />Nova skupina
          </Button>
        )}
      </div>
      <p className="text-sm text-muted-foreground">
        Modifikatorske skupine omogočajo opcijske ali obvezne izbire pri naročilu (npr. "Stopnja pečenosti", "Zasita").
        Skupino dodelite artiklu v uredniku artiklov.
      </p>

      {isLoading ? (
        <Card className="p-4 text-center text-muted-foreground text-sm">Nalaganje...</Card>
      ) : !skupineList?.length ? (
        <Card className="p-6 text-center text-muted-foreground text-sm">
          Ni modifikatorskih skupin.
          {!jeUporabnik && " Dodajte prvo skupino z gumbom zgoraj."}
        </Card>
      ) : (
        <Card className="divide-y overflow-hidden">
          {skupineList.map(s => {
            const isExpanded = expandedId === s.id;
            return (
              <div key={s.id}>
                <div
                  className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors cursor-pointer select-none"
                  onClick={() => setExpandedId(isExpanded ? null : s.id)}
                >
                  <span className="text-muted-foreground shrink-0">
                    {isExpanded
                      ? <ChevronDown className="w-4 h-4" />
                      : <ChevronRight className="w-4 h-4" />}
                  </span>
                  <div className="flex-1 min-w-0 flex items-center gap-2 flex-wrap">
                    <span className="font-medium">{s.ime}</span>
                    {s.obvezna ? (
                      <Badge className="bg-red-100 text-red-800 border-red-200 text-[10px] px-1.5 py-0 h-4">Obvezna</Badge>
                    ) : (
                      <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4">Izbirna</Badge>
                    )}
                    <span className="text-xs text-muted-foreground">
                      {s.minIzbir === 0 && s.maxIzbir === 0
                        ? "neomejeno"
                        : s.maxIzbir === 0
                          ? `vsaj ${s.minIzbir}`
                          : `${s.minIzbir}–${s.maxIzbir}`}
                    </span>
                  </div>
                  {!jeUporabnik && (
                    <div className="flex gap-0.5 shrink-0" onClick={e => e.stopPropagation()}>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => openEditGroup(s)}>
                        <Pencil className="w-4 h-4 text-muted-foreground" />
                      </Button>
                      <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleDeleteGroup(s.id)}>
                        <Trash2 className="w-4 h-4 text-destructive" />
                      </Button>
                    </div>
                  )}
                </div>

                {isExpanded && (
                  <div className="border-t bg-muted/20 px-4 py-3 space-y-2">
                    {loadingExpanded ? (
                      <p className="text-sm text-muted-foreground">Nalaganje modifikatorjev...</p>
                    ) : (
                      <>
                        {!expandedSkupina?.modifikatorji?.length ? (
                          <p className="text-sm text-muted-foreground">Ni modifikatorjev.</p>
                        ) : (
                          <div className="space-y-1">
                            {expandedSkupina.modifikatorji.map(m => (
                              <div
                                key={m.id}
                                className={`flex items-center gap-3 rounded-md px-3 py-2 bg-background border ${!m.aktiven ? "opacity-50" : ""}`}
                              >
                                <div className="flex-1 min-w-0">
                                  <span className="text-sm font-medium">{m.ime}</span>
                                  {m.cenaDodatek !== 0 && (
                                    <span className="ml-2 text-xs text-muted-foreground font-mono">
                                      {m.cenaDodatek > 0 ? "+" : ""}{m.cenaDodatek.toFixed(2)} €
                                    </span>
                                  )}
                                  {!m.aktiven && (
                                    <Badge variant="secondary" className="ml-2 text-[10px] px-1 py-0 h-4">Neaktiven</Badge>
                                  )}
                                </div>
                                {!jeUporabnik && (
                                  <div className="flex gap-0.5 shrink-0">
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => openEditMod(m)}>
                                      <Pencil className="w-3.5 h-3.5 text-muted-foreground" />
                                    </Button>
                                    <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => handleDeleteMod(m)}>
                                      <Trash2 className="w-3.5 h-3.5 text-destructive" />
                                    </Button>
                                  </div>
                                )}
                              </div>
                            ))}
                          </div>
                        )}
                        {!jeUporabnik && (
                          <Button size="sm" variant="outline" className="mt-1" onClick={() => openNewMod(s.id)}>
                            <Plus className="w-3.5 h-3.5 mr-1.5" />Dodaj modifikator
                          </Button>
                        )}
                      </>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </Card>
      )}

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
              <Input
                type="number"
                step="0.01"
                value={modForm.cenaDodatek}
                onChange={e => setModForm(f => ({ ...f, cenaDodatek: e.target.value }))}
                placeholder="0.00"
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

            {/* ── Normativ ── */}
            {nabavniArtikli.length > 0 && (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <Label>Normativ (sestavnice)</Label>
                  <Button type="button" variant="outline" size="sm" className="h-7 text-xs" onClick={addNormativVrstica}>
                    <Plus className="w-3 h-3 mr-1" />Dodaj vrstico
                  </Button>
                </div>
                {modNormativi.length === 0 ? (
                  <p className="text-xs text-muted-foreground py-1">Ni sestavin — ob izbiri tega modifikatorja se zaloga ne razknjižuje.</p>
                ) : (
                  <div className="space-y-1.5">
                    {modNormativi.map((vrstica, idx) => (
                      <div key={idx} className="flex items-center gap-2">
                        <select
                          className="flex-1 h-9 rounded-md border border-input bg-background px-3 py-1 text-sm shadow-sm"
                          value={vrstica.vhodniArtikelId || ""}
                          onChange={e => updateNormativVrstica(idx, "vhodniArtikelId", parseInt(e.target.value) || 0)}
                        >
                          <option value="">— izberite artikel —</option>
                          {nabavniArtikli.map(a => (
                            <option key={a.id} value={a.id}>{a.ime}</option>
                          ))}
                        </select>
                        <Input
                          type="number"
                          step="0.0001"
                          className="w-24"
                          placeholder="Kol."
                          value={vrstica.kolicina}
                          onChange={e => updateNormativVrstica(idx, "kolicina", e.target.value)}
                        />
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
                    ))}
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
    </div>
  );
}
