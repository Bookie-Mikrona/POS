import { useState, useMemo, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetKdsNastavitve,
  useUpdateKdsNastavitve,
  useListKdsPostaje,
  useCreateKdsPostaja,
  useUpdateKdsPostaja,
  useDeleteKdsPostaja,
  useListKdsPrikazovalniki,
  useCreateKdsPrikazovalnik,
  useUpdateKdsPrikazovalnik,
  useDeleteKdsPrikazovalnik,
  useSetKdsPrikazovalnikNarocnine,
  useListKdsMapiranja,
  useCreateKdsMapiranje,
  useDeleteKdsMapiranje,
  useListKdsNerazporejenePostavke,
  useListArtikli,
  useListKategorije,
  getGetKdsNastavitveQueryKey,
  getListKdsPostajeQueryKey,
  getListKdsPrikazovalnikiQueryKey,
  getListKdsMapiranjaQueryKey,
  getListKdsNerazporejenePostavkeQueryKey,
  KdsNastavitveProfil,
  KdsPostajaTip,
  type KdsNastavitveInputProfil,
  type KdsNastavitve,
  type KdsPostaja,
  type KdsPrikazovalnik,
  type KdsMapiranje,
} from "@workspace/api-client-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Button } from "@/components/ui/button";
import { useToast } from "@/hooks/use-toast";
import {
  Loader2,
  Plus,
  Trash2,
  Edit2,
  AlertTriangle,
  ScreenShare,
  Route,
  Network,
  MonitorPlay,
  AlertCircle,
  Layers,
} from "lucide-react";
import { Input } from "@/components/ui/input";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";

import { useAuth } from "@/contexts/AuthContext";

export function KdsSettings() {
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const enotaId = user?.enotaId;

  const keyNastavitve = enotaId ? [...getGetKdsNastavitveQueryKey(), enotaId] : getGetKdsNastavitveQueryKey();
  const keyPostaje = enotaId ? [...getListKdsPostajeQueryKey(), enotaId] : getListKdsPostajeQueryKey();
  const keyPrikazovalniki = enotaId ? [...getListKdsPrikazovalnikiQueryKey(), enotaId] : getListKdsPrikazovalnikiQueryKey();
  const keyNerazporejene = enotaId ? [...getListKdsNerazporejenePostavkeQueryKey(), enotaId] : getListKdsNerazporejenePostavkeQueryKey();

  const { data: settings, isLoading: settingsLoading } = useGetKdsNastavitve({ query: { queryKey: keyNastavitve, enabled: !!enotaId } });
  const updateSettings = useUpdateKdsNastavitve();

  const { data: postaje } = useListKdsPostaje({ query: { queryKey: keyPostaje, enabled: !!enotaId } });
  const { data: prikazovalniki } = useListKdsPrikazovalniki({ query: { queryKey: keyPrikazovalniki, enabled: !!enotaId } });
  const { data: nerazporejene } = useListKdsNerazporejenePostavke({ query: { queryKey: keyNerazporejene, enabled: !!enotaId } });

  const [savingSettings, setSavingSettings] = useState(false);
  const [profileConfirmOpen, setProfileConfirmOpen] = useState(false);
  const [pendingProfile, setPendingProfile] = useState<string | null>(null);

  const handleProfileChange = (val: string) => {
    if (!settings) return;
    if (val !== "custom") {
      setPendingProfile(val);
      setProfileConfirmOpen(true);
    } else {
      executeProfileChange(val);
    }
  };

  const executeProfileChange = (val: string) => {
    if (!settings) return;
    setSavingSettings(true);
    setProfileConfirmOpen(false);
    updateSettings.mutate(
      {
        data: {
          profil: val as KdsNastavitveInputProfil,
          fallbackPostajaId: settings.fallbackPostajaId,
          dispatchOmogocen: settings.dispatchOmogocen,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Profil posodobljen" });
          queryClient.invalidateQueries({ queryKey: keyNastavitve });
          queryClient.invalidateQueries({ queryKey: keyPostaje });
          queryClient.invalidateQueries({ queryKey: keyPrikazovalniki });
          queryClient.invalidateQueries({ queryKey: keyNerazporejene });
        },
        onError: (err) => {
          toast({ title: "Napaka", description: err.message, variant: "destructive" });
        },
        onSettled: () => setSavingSettings(false),
      },
    );
  };

  const handleFallbackChange = (val: string) => {
    if (!settings) return;
    setSavingSettings(true);
    const fallbackId = Number(val) || null;
    updateSettings.mutate(
      {
        data: {
          profil: settings.profil,
          fallbackPostajaId: fallbackId,
          dispatchOmogocen: settings.dispatchOmogocen,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Privzeta postaja posodobljena" });
          queryClient.invalidateQueries({ queryKey: keyNastavitve });
          queryClient.invalidateQueries({ queryKey: keyPostaje });
          queryClient.invalidateQueries({ queryKey: keyPrikazovalniki });
          queryClient.invalidateQueries({ queryKey: keyNerazporejene });
        },
        onError: (err) => {
          toast({ title: "Napaka", description: err.message, variant: "destructive" });
        },
        onSettled: () => setSavingSettings(false),
      },
    );
  };

  const handleDispatchToggle = (checked: boolean) => {
    if (!settings) return;
    setSavingSettings(true);
    updateSettings.mutate(
      {
        data: {
          profil: settings.profil,
          fallbackPostajaId: settings.fallbackPostajaId,
          dispatchOmogocen: checked,
        },
      },
      {
        onSuccess: () => {
          toast({ title: "Nastavitve izdaje posodobljene" });
          queryClient.invalidateQueries({ queryKey: keyNastavitve });
          queryClient.invalidateQueries({ queryKey: keyPostaje });
          queryClient.invalidateQueries({ queryKey: keyPrikazovalniki });
          queryClient.invalidateQueries({ queryKey: keyNerazporejene });
        },
        onError: (err) => {
          toast({ title: "Napaka", description: err.message, variant: "destructive" });
        },
        onSettled: () => setSavingSettings(false),
      },
    );
  };

  if (settingsLoading) {
    return (
      <div className="p-16 flex flex-col items-center justify-center gap-3">
        <Route className="w-8 h-8 text-muted-foreground/30 animate-pulse" />
        <p className="text-sm text-muted-foreground">
          Nalagam KDS nastavitve...
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Route className="w-5 h-5 text-primary" />
            Konfiguracija KDS
          </CardTitle>
          <CardDescription>
            Upravljanje kuhinjskih in točilniških zaslonov ter usmerjanje
            naročil
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-6 md:grid-cols-3">
          <div className="space-y-2">
            <Label>KDS Profil</Label>
            <Select
              value={settings?.profil || "custom"}
              onValueChange={handleProfileChange}
              disabled={savingSettings}
            >
              <SelectTrigger>
                <SelectValue placeholder="Izberi profil" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="bar_combined_kitchen">
                  Točilnica + Skupna Kuhinja
                </SelectItem>
                <SelectItem value="bar_separate_kitchen_pizza">
                  Točilnica + Kuhinja + Pica
                </SelectItem>
                <SelectItem value="custom">Po meri</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Standardni profili samodejno ustvarijo postaje in zaslone.
            </p>
          </div>

          <Dialog open={profileConfirmOpen} onOpenChange={setProfileConfirmOpen}>
            <DialogContent className="max-w-sm">
              <DialogHeader>
                <DialogTitle>Zamenjava profila</DialogTitle>
                <DialogDescription>
                  Zamenjava na standardni profil bo znova ustvarila ali spremenila obstoječe postaje in naročnine zaslonov, s čimer bodo vaše prilagoditve prepisane. Ali res želite nadaljevati?
                </DialogDescription>
              </DialogHeader>
              <DialogFooter>
                <Button variant="outline" onClick={() => setProfileConfirmOpen(false)}>Prekliči</Button>
                <Button variant="destructive" onClick={() => pendingProfile && executeProfileChange(pendingProfile)}>Zamenjaj profil</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>

          <div className="space-y-2">
            <Label>Privzeta postaja (Fallback)</Label>
            <Select
              value={settings?.fallbackPostajaId?.toString() || ""}
              onValueChange={handleFallbackChange}
              disabled={savingSettings || settingsLoading}
            >
              <SelectTrigger>
                <SelectValue placeholder={settingsLoading ? "Nalagam..." : "Izberite privzeto postajo..."} />
              </SelectTrigger>
              <SelectContent>
                {!settings?.fallbackPostajaId && !settingsLoading && (
                  <SelectItem value="" disabled>Izberite privzeto postajo...</SelectItem>
                )}
                {postaje?.filter(p => p.aktivna).map((p) => (
                  <SelectItem key={p.id} value={p.id.toString()}>
                    {p.ime}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-[10px] text-muted-foreground">
              Kam gredo artikli brez specifičnega pravila.
            </p>
          </div>

          <div className="space-y-3 pt-1">
            <Label className="block">Izdajni zaslon (Dispatch)</Label>
            <div className="flex items-center gap-2">
              <Switch
                checked={settings?.dispatchOmogocen || false}
                onCheckedChange={handleDispatchToggle}
                disabled={savingSettings}
              />
              <span className="text-sm font-medium">
                Omogoči ločen zaslon za izdajo (Ekspedit)
              </span>
            </div>
            <p className="text-[10px] text-muted-foreground">
              Naročila bodo čakala na potrditev prevzema stranke/natakarja, preden izginejo iz sistema (namesto da izginejo ob prevzemu iz kuhinje).
            </p>
          </div>
        </CardContent>
      </Card>

      {nerazporejene && nerazporejene.length > 0 && (
        <Card className="border-orange-300 bg-orange-50/50 dark:bg-orange-950/20">
          <CardHeader className="pb-2">
            <CardTitle className="text-orange-800 dark:text-orange-400 text-sm font-semibold flex items-center gap-2">
              <AlertTriangle className="w-4 h-4" />
              Nerazporejeni artikli ({nerazporejene.length})
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-orange-700 dark:text-orange-300 mb-3">
              Naslednji artikli nimajo nastavljenega pravila usmerjanja.{" "}
              {settings?.fallbackPostajaId
                ? "Trenutno bodo poslani na privzeto postajo."
                : "Ker privzeta postaja ni izbrana, NE BODO PRIKAZANI na nobenem zaslonu!"}
            </p>
            <div className="flex flex-wrap gap-1.5 max-h-32 overflow-y-auto pr-2">
              {nerazporejene.map((item) => (
                <Badge
                  key={item.artikelId}
                  variant="outline"
                  className="bg-white dark:bg-black text-orange-900 border-orange-200"
                >
                  {item.ime}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      )}

      <div className="grid lg:grid-cols-2 gap-6">
        <PostajeManager postaje={postaje || []} />
        <PrikazovalnikiManager
          prikazovalniki={prikazovalniki || []}
          postaje={postaje || []}
        />
      </div>
    </div>
  );
}

function PostajeManager({ postaje }: { postaje: KdsPostaja[] }) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ ime: "", tip: "custom" });
  const [manageMappingId, setManageMappingId] = useState<number | null>(null);

  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const enotaId = user?.enotaId;
  const keyPostaje = enotaId ? [...getListKdsPostajeQueryKey(), enotaId] : getListKdsPostajeQueryKey();

  const createMut = useCreateKdsPostaja();
  const updateMut = useUpdateKdsPostaja();
  const deleteMut = useDeleteKdsPostaja();

  const handleSave = () => {
    if (!formData.ime.trim()) return;
    if (editingId) {
      updateMut.mutate(
        {
          id: editingId,
          data: { ime: formData.ime, tip: formData.tip as KdsPostajaTip },
        },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keyPostaje });
            setEditingId(null);
          },
        },
      );
    } else {
      createMut.mutate(
        { data: { ime: formData.ime, tip: formData.tip as KdsPostajaTip } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keyPostaje });
            setIsAdding(false);
          },
        },
      );
    }
  };

  const handleDelete = (id: number) => {
    if (!confirm("Izbrišem postajo?")) return;
    deleteMut.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: keyPostaje });
        },
      },
    );
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <Network className="w-4 h-4 text-blue-500" />
            Logične Postaje (Priprava)
          </CardTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setIsAdding(true);
              setFormData({ ime: "", tip: "custom" });
            }}
          >
            <Plus className="w-4 h-4 mr-1" /> Dodaj
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1 overflow-auto max-h-[500px]">
        {isAdding && (
          <div className="p-3 border-b bg-muted/30 flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Ime postaje</Label>
              <Input
                value={formData.ime}
                onChange={(e) =>
                  setFormData({ ...formData, ime: e.target.value })
                }
                autoFocus
              />
            </div>
            <div className="w-32 space-y-1">
              <Label className="text-xs">Tip</Label>
              <Select
                value={formData.tip}
                onValueChange={(v) => setFormData({ ...formData, tip: v })}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="bar">Točilnica</SelectItem>
                  <SelectItem value="kitchen">Kuhinja</SelectItem>
                  <SelectItem value="pizza">Pica</SelectItem>
                  <SelectItem value="dispatch">Izdaja</SelectItem>
                  <SelectItem value="custom">Po meri</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={createMut.isPending}
            >
              Shrani
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsAdding(false)}
            >
              X
            </Button>
          </div>
        )}

        <div className="divide-y">
          {postaje.map((p) => (
            <div
              key={p.id}
              className="p-3 flex items-center justify-between hover:bg-muted/10 transition-colors"
            >
              {editingId === p.id ? (
                <div className="flex flex-1 items-end gap-2 mr-2">
                  <div className="flex-1 space-y-1">
                    <Input
                      value={formData.ime}
                      onChange={(e) =>
                        setFormData({ ...formData, ime: e.target.value })
                      }
                      autoFocus
                    />
                  </div>
                  <div className="w-32 space-y-1">
                    <Select
                      value={formData.tip}
                      onValueChange={(v) =>
                        setFormData({ ...formData, tip: v })
                      }
                    >
                      <SelectTrigger>
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="bar">Točilnica</SelectItem>
                        <SelectItem value="kitchen">Kuhinja</SelectItem>
                        <SelectItem value="pizza">Pica</SelectItem>
                        <SelectItem value="dispatch">Izdaja</SelectItem>
                        <SelectItem value="custom">Po meri</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={updateMut.isPending}
                  >
                    Shrani
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingId(null)}
                  >
                    X
                  </Button>
                </div>
              ) : (
                <>
                  <div>
                    <div className="font-medium text-sm flex items-center gap-2">
                      {p.ime}
                      {!p.aktivna && (
                        <Badge variant="secondary" className="text-[9px] px-1">
                          Neaktivna
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-muted-foreground capitalize">
                      {p.tip}
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-blue-600"
                      onClick={() => setManageMappingId(p.id)}
                      title="Pravila usmerjanja"
                    >
                      <Route className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => {
                        setEditingId(p.id);
                        setFormData({ ime: p.ime, tip: p.tip });
                      }}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive"
                      onClick={() => handleDelete(p.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}
          {postaje.length === 0 && !isAdding && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Ni postaj.
            </div>
          )}
        </div>
      </CardContent>
      {manageMappingId && (
        <MappingsDialog
          postajaId={manageMappingId}
          postajaName={postaje.find((x) => x.id === manageMappingId)?.ime || ""}
          onClose={() => setManageMappingId(null)}
        />
      )}
    </Card>
  );
}

function MappingsDialog({
  postajaId,
  postajaName,
  onClose,
}: {
  postajaId: number;
  postajaName: string;
  onClose: () => void;
}) {
  const { user } = useAuth();
  const enotaId = user?.enotaId;
  const keyMapiranja = enotaId ? [...getListKdsMapiranjaQueryKey(postajaId), enotaId] : getListKdsMapiranjaQueryKey(postajaId);
  const keyNerazporejene = enotaId ? [...getListKdsNerazporejenePostavkeQueryKey(), enotaId] : getListKdsNerazporejenePostavkeQueryKey();

  const { data: mappings, isLoading } = useListKdsMapiranja(postajaId, { query: { queryKey: keyMapiranja, enabled: !!enotaId } });
  const { data: artikli } = useListArtikli();
  const { data: kategorije } = useListKategorije();
  const queryClient = useQueryClient();
  const createMut = useCreateKdsMapiranje();
  const deleteMut = useDeleteKdsMapiranje();
  const [newItemId, setNewItemId] = useState("");
  const [newCatId, setNewCatId] = useState("");

  const handleAddArtikel = () => {
    if (!newItemId) return;
    createMut.mutate(
      { id: postajaId, data: { artikelId: Number(newItemId) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: keyMapiranja });
          queryClient.invalidateQueries({ queryKey: keyNerazporejene });
          setNewItemId("");
        },
      },
    );
  };

  const handleAddKategorija = () => {
    if (!newCatId) return;
    createMut.mutate(
      { id: postajaId, data: { kategorijaId: Number(newCatId) } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: keyMapiranja });
          queryClient.invalidateQueries({ queryKey: keyNerazporejene });
          setNewCatId("");
        },
      },
    );
  };

  const handleDelete = (mapiranjeId: number) => {
    deleteMut.mutate(
      { id: postajaId, mappingId: mapiranjeId },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: keyMapiranja });
          queryClient.invalidateQueries({ queryKey: keyNerazporejene });
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Pravila za: {postajaName}</DialogTitle>
          <DialogDescription>
            Določite, katere kategorije in artikli se usmerjajo na to postajo.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 pt-2">
          <div className="space-y-2 border p-3 rounded-lg bg-muted/10">
            <Label className="text-xs font-semibold">
              Dodaj pravilo za Kategorijo
            </Label>
            <div className="flex gap-2">
              <Select value={newCatId} onValueChange={setNewCatId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Izberi kategorijo..." />
                </SelectTrigger>
                <SelectContent>
                  {kategorije?.map((k) => (
                    <SelectItem key={k.id} value={k.id.toString()}>
                      {k.ime}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleAddKategorija}
                disabled={!newCatId || createMut.isPending}
              >
                Dodaj
              </Button>
            </div>
          </div>

          <div className="space-y-2 border p-3 rounded-lg bg-muted/10">
            <Label className="text-xs font-semibold">
              Dodaj pravilo za specifičen Artikel
            </Label>
            <div className="flex gap-2">
              <Select value={newItemId} onValueChange={setNewItemId}>
                <SelectTrigger className="flex-1">
                  <SelectValue placeholder="Izberi artikel..." />
                </SelectTrigger>
                <SelectContent>
                  {artikli?.map((a) => (
                    <SelectItem key={a.id} value={a.id.toString()}>
                      {a.ime}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Button
                size="sm"
                onClick={handleAddArtikel}
                disabled={!newItemId || createMut.isPending}
              >
                Dodaj
              </Button>
            </div>
          </div>

          <div className="space-y-2">
            <Label className="text-xs font-semibold">Aktivna pravila</Label>
            {isLoading ? (
              <div className="p-8 flex flex-col items-center justify-center text-muted-foreground">
                <Loader2 className="w-5 h-5 animate-spin mb-2" />
                <span className="text-xs">Nalagam pravila...</span>
              </div>
            ) : (
              <div className="border rounded-md divide-y max-h-48 overflow-auto">
                {mappings?.length === 0 ? (
                  <div className="p-3 text-xs text-muted-foreground text-center">
                    Ni pravil.
                  </div>
                ) : (
                  mappings?.map((m) => {
                    const label = m.artikelId
                      ? `Artikel: ${artikli?.find((x) => x.id === m.artikelId)?.ime || m.artikelId}`
                      : `Kategorija: ${kategorije?.find((x) => x.id === m.kategorijaId)?.ime || m.kategorijaId}`;
                    return (
                      <div
                        key={m.id}
                        className="flex items-center justify-between p-2 px-3 text-sm"
                      >
                        <span>{label}</span>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-6 w-6 text-destructive"
                          onClick={() => handleDelete(m.id)}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </Button>
                      </div>
                    );
                  })
                )}
              </div>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function PrikazovalnikiManager({
  prikazovalniki,
  postaje,
}: {
  prikazovalniki: KdsPrikazovalnik[];
  postaje: KdsPostaja[];
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [formData, setFormData] = useState({ ime: "" });
  const [subsDialogId, setSubsDialogId] = useState<number | null>(null);

  const queryClient = useQueryClient();
  const { user } = useAuth();
  const enotaId = user?.enotaId;
  const keyPrikazovalniki = enotaId ? [...getListKdsPrikazovalnikiQueryKey(), enotaId] : getListKdsPrikazovalnikiQueryKey();

  const createMut = useCreateKdsPrikazovalnik();
  const updateMut = useUpdateKdsPrikazovalnik();
  const deleteMut = useDeleteKdsPrikazovalnik();

  const handleSave = () => {
    if (!formData.ime.trim()) return;
    if (editingId) {
      updateMut.mutate(
        { id: editingId, data: { ime: formData.ime } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keyPrikazovalniki });
            setEditingId(null);
          },
        },
      );
    } else {
      createMut.mutate(
        { data: { ime: formData.ime } },
        {
          onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: keyPrikazovalniki });
            setIsAdding(false);
          },
        },
      );
    }
  };

  const handleDelete = (id: number) => {
    if (!confirm("Izbrišem prikazovalnik?")) return;
    deleteMut.mutate(
      { id },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: keyPrikazovalniki });
        },
      },
    );
  };

  return (
    <Card className="flex flex-col">
      <CardHeader className="pb-3 border-b">
        <div className="flex items-center justify-between">
          <CardTitle className="text-base flex items-center gap-2">
            <MonitorPlay className="w-4 h-4 text-purple-500" />
            Fizični Zasloni (Naprave)
          </CardTitle>
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              setIsAdding(true);
              setFormData({ ime: "" });
            }}
          >
            <Plus className="w-4 h-4 mr-1" /> Dodaj
          </Button>
        </div>
      </CardHeader>
      <CardContent className="p-0 flex-1 overflow-auto max-h-[500px]">
        {isAdding && (
          <div className="p-3 border-b bg-muted/30 flex items-end gap-2">
            <div className="flex-1 space-y-1">
              <Label className="text-xs">Ime zaslona</Label>
              <Input
                value={formData.ime}
                onChange={(e) => setFormData({ ime: e.target.value })}
                autoFocus
              />
            </div>
            <Button
              size="sm"
              onClick={handleSave}
              disabled={createMut.isPending}
            >
              Shrani
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => setIsAdding(false)}
            >
              X
            </Button>
          </div>
        )}

        <div className="divide-y">
          {prikazovalniki.map((p) => (
            <div
              key={p.id}
              className="p-3 flex items-center justify-between hover:bg-muted/10 transition-colors"
            >
              {editingId === p.id ? (
                <div className="flex flex-1 items-end gap-2 mr-2">
                  <div className="flex-1 space-y-1">
                    <Input
                      value={formData.ime}
                      onChange={(e) => setFormData({ ime: e.target.value })}
                      autoFocus
                    />
                  </div>
                  <Button
                    size="sm"
                    onClick={handleSave}
                    disabled={updateMut.isPending}
                  >
                    Shrani
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setEditingId(null)}
                  >
                    X
                  </Button>
                </div>
              ) : (
                <>
                  <div className="flex-1 min-w-0">
                    <div className="font-medium text-sm truncate">{p.ime}</div>
                    <div className="text-[10px] text-muted-foreground mt-0.5 truncate flex gap-1 items-center">
                      <Layers className="w-3 h-3" />
                      {p.postajaIds?.length
                        ? p.postajaIds
                            .map(
                              (sid) =>
                                postaje.find((x) => x.id === sid)?.ime || sid,
                            )
                            .join(", ")
                        : "Ni naročnin"}
                    </div>
                  </div>
                  <div className="flex items-center gap-1 shrink-0 ml-2">
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-purple-600"
                      onClick={() => setSubsDialogId(p.id)}
                      title="Naročnine"
                    >
                      <ScreenShare className="w-4 h-4" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8"
                      onClick={() => {
                        setEditingId(p.id);
                        setFormData({ ime: p.ime });
                      }}
                    >
                      <Edit2 className="w-3.5 h-3.5" />
                    </Button>
                    <Button
                      size="icon"
                      variant="ghost"
                      className="h-8 w-8 text-destructive"
                      onClick={() => handleDelete(p.id)}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </Button>
                  </div>
                </>
              )}
            </div>
          ))}
          {prikazovalniki.length === 0 && !isAdding && (
            <div className="p-8 text-center text-sm text-muted-foreground">
              Ni zaslonov.
            </div>
          )}
        </div>
      </CardContent>

      {subsDialogId && (
        <SubscriptionsDialog
          prikazovalnik={prikazovalniki.find((x) => x.id === subsDialogId)!}
          postaje={postaje}
          onClose={() => setSubsDialogId(null)}
        />
      )}
    </Card>
  );
}

function SubscriptionsDialog({
  prikazovalnik,
  postaje,
  onClose,
}: {
  prikazovalnik: KdsPrikazovalnik;
  postaje: KdsPostaja[];
  onClose: () => void;
}) {
  const [selected, setSelected] = useState<number[]>(
    prikazovalnik.postajaIds || [],
  );
  const setSubs = useSetKdsPrikazovalnikNarocnine();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const { user } = useAuth();
  const enotaId = user?.enotaId;
  const keyPrikazovalniki = enotaId ? [...getListKdsPrikazovalnikiQueryKey(), enotaId] : getListKdsPrikazovalnikiQueryKey();

  const handleToggle = (id: number, checked: boolean) => {
    setSelected((prev) =>
      checked ? [...prev, id] : prev.filter((x) => x !== id),
    );
  };

  const handleSave = () => {
    if (selected.length === 0) {
      toast({
        title: "Opozorilo",
        description: "Izbrati morate vsaj eno postajo.",
        variant: "destructive",
      });
      return;
    }
    setSubs.mutate(
      { id: prikazovalnik.id, data: { postajaIds: selected } },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: keyPrikazovalniki });
          onClose();
        },
      },
    );
  };

  return (
    <Dialog open onOpenChange={() => onClose()}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>Naročnine: {prikazovalnik.ime}</DialogTitle>
          <DialogDescription>
            Izberite, katere postaje naj prikazuje ta zaslon.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-4">
          {postaje.map((p) => (
            <div
              key={p.id}
              className="flex items-center space-x-3 p-2 rounded hover:bg-muted/50 transition-colors"
            >
              <Checkbox
                id={`sub-${p.id}`}
                checked={selected.includes(p.id)}
                onCheckedChange={(c) => handleToggle(p.id, c as boolean)}
              />
              <Label
                htmlFor={`sub-${p.id}`}
                className="flex-1 cursor-pointer font-medium leading-none"
              >
                {p.ime}{" "}
                <span className="text-muted-foreground text-xs font-normal ml-1">
                  ({p.tip})
                </span>
              </Label>
            </div>
          ))}
          {postaje.length === 0 && (
            <div className="text-sm text-muted-foreground">
              Ni ustvarjenih postaj.
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={onClose}>
            Prekliči
          </Button>
          <Button onClick={handleSave} disabled={setSubs.isPending}>
            Shrani naročnine
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
