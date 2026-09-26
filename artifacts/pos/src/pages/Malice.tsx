import { useState, useMemo } from "react";
import { format, addDays, startOfWeek, parseISO, isSameDay } from "date-fns";
import { sl } from "date-fns/locale";
import { 
  useGetMalicaBootstrap,
  useListMalicaDailyOffers,
  useCreateMalicaDailyOffer,
  useUpdateMalicaDailyOffer,
  usePublishMalicaDailyOffer,
  useCloseMalicaDailyOffer,
  useScheduleMalicaGroupPrice,
  useAssignMalicaArticle,
  useListArtikli,
  getListMalicaDailyOffersQueryKey,
  getGetMalicaBootstrapQueryKey,
  type MalicaGroup,
  type MalicaGroupPrice,
  type MalicaArticleAssignment,
  type MalicaDailyOffer,
  type MalicaDailyMainItemInput,
  type MalicaDailyCourseInput,
  type MalicaArticleAssignmentRole
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { DecimalInput, parseDecimal } from "@/components/ui/decimal-input";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Calendar, Utensils, Settings2, Plus, Pencil, Save, CheckCircle2, ChevronLeft, ChevronRight, Tags, ArrowRight } from "lucide-react";
import { Badge } from "@/components/ui/badge";

export default function MalicePage() {
  const { data: bootstrap, isLoading } = useGetMalicaBootstrap();
  return (
    <div className="p-4 sm:p-8 space-y-6 flex-1 overflow-auto bg-muted/10">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="p-2.5 bg-orange-100 text-orange-700 rounded-xl">
            <Utensils className="h-6 w-6" />
          </div>
          <div>
            <h1 className="text-3xl font-bold tracking-tight">Malice</h1>
            <p className="text-muted-foreground text-sm">Dnevne ponudbe, skupine in ceniki za malice.</p>
          </div>
        </div>
      </div>

      {isLoading ? (
        <div className="flex justify-center py-12">
          <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
        </div>
      ) : (
        <Tabs defaultValue="dnevne" className="w-full">
          <TabsList className="mb-6 grid w-full max-w-md grid-cols-3">
            <TabsTrigger value="dnevne"><Calendar className="w-4 h-4 mr-2 hidden sm:block" /> Dnevne</TabsTrigger>
            <TabsTrigger value="artikli"><Utensils className="w-4 h-4 mr-2 hidden sm:block" /> Artikli</TabsTrigger>
            <TabsTrigger value="skupine"><Settings2 className="w-4 h-4 mr-2 hidden sm:block" /> Skupine</TabsTrigger>
          </TabsList>
          
          <TabsContent value="dnevne">
            <DnevnePonudbeTab bootstrap={bootstrap} />
          </TabsContent>
          <TabsContent value="artikli">
            <ArtikliTab bootstrap={bootstrap} />
          </TabsContent>
          <TabsContent value="skupine">
            <SkupineTab bootstrap={bootstrap} />
          </TabsContent>
        </Tabs>
      )}
    </div>
  );
}

function formatMoney(cents: number | null | undefined) {
  if (cents == null) return "—";
  return (cents / 100).toFixed(2) + " €";
}

function SkupineTab({ bootstrap }: { bootstrap: any }) {
  const groups: MalicaGroup[] = bootstrap?.groups ?? [];
  const prices: MalicaGroupPrice[] = bootstrap?.prices ?? [];
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const scheduleMutation = useScheduleMalicaGroupPrice();
  
  const [openId, setOpenId] = useState<number | null>(null);
  const [priceStr, setPriceStr] = useState("");
  const [validFrom, setValidFrom] = useState(format(new Date(), "yyyy-MM-dd"));
  const [reason, setReason] = useState("");

  const handleOpen = (group: MalicaGroup) => {
    setOpenId(group.id);
    setPriceStr("");
    setValidFrom(format(new Date(), "yyyy-MM-dd"));
    setReason("");
  };

  const handleSave = async () => {
    if (!openId) return;
    const cents = Math.round(parseDecimal(priceStr) * 100);
    if (isNaN(cents) || cents < 0) {
      toast({ title: "Neveljavna cena", variant: "destructive" });
      return;
    }
    if (!validFrom) {
      toast({ title: "Manjka datum veljavnosti", variant: "destructive" });
      return;
    }
    try {
      await scheduleMutation.mutateAsync({
        groupId: openId,
        data: { priceCents: cents, validFrom, reason: reason || null }
      });
      toast({ title: "Cena uspešno načrtovana" });
      queryClient.invalidateQueries({ queryKey: getGetMalicaBootstrapQueryKey() });
      setOpenId(null);
    } catch (err: any) {
      const msg = err.response?.data?.message || err.response?.data?.napaka || "Napaka pri nastavljanju cene";
      toast({ title: "Napaka", description: msg, variant: "destructive" });
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Skupine malic</CardTitle>
        <CardDescription>Upravljajte cene in osnovne skupine malic (Malica 1, Malica 2 itd.).</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Stopnja</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Koda</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Ime skupine</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Trenutna cena</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Načrtovano</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Akcije</th>
              </tr>
            </thead>
            <tbody>
              {[...groups].sort((a, b) => b.sortOrder - a.sortOrder).map(g => {
                const activePrice = prices.find(p => p.groupId === g.id && p.status === "active");
                const scheduledPrices = prices.filter(p => p.groupId === g.id && p.status === "scheduled");
                const sortedScheduled = scheduledPrices.sort((a, b) => a.validFrom.localeCompare(b.validFrom));
                const nextPrice = sortedScheduled[0];

                return (
                  <tr key={g.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3">
                      <Badge variant="outline">{g.sortOrder}</Badge>
                    </td>
                    <td className="px-4 py-3">
                      <Badge variant={g.active ? "default" : "secondary"}>{g.code}</Badge>
                    </td>
                    <td className="px-4 py-3 font-medium">{g.name}</td>
                    <td className="px-4 py-3 font-semibold">
                      {activePrice ? formatMoney(activePrice.priceCents) : "—"}
                    </td>
                    <td className="px-4 py-3 text-sm text-muted-foreground">
                      {nextPrice ? (
                        <span>{formatMoney(nextPrice.priceCents)} od {format(parseISO(nextPrice.validFrom), "d. M. yyyy")}</span>
                      ) : "—"}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="outline" size="sm" onClick={() => handleOpen(g)}>
                        <Tags className="w-4 h-4 mr-2" /> Spremeni ceno
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {groups.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">Ni skupin malic.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>

      <Dialog open={openId !== null} onOpenChange={(o) => !o && setOpenId(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Nova cena za skupino</DialogTitle>
            <DialogDescription>
              Nastavite novo ceno, ki bo veljala od izbranega datuma naprej. Sprememba bo vplivala na vse artikle v tej skupini, ki imajo vklopljeno samodejno usklajevanje cene.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="grid gap-2">
              <Label>Nova cena (€)</Label>
              <DecimalInput value={priceStr} onChange={(e) => setPriceStr(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Velja od</Label>
              <Input type="date" value={validFrom} onChange={(e) => setValidFrom(e.target.value)} />
            </div>
            <div className="grid gap-2">
              <Label>Razlog (opcijsko)</Label>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Npr. podražitev materiala" />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpenId(null)}>Prekliči</Button>
            <Button onClick={handleSave} disabled={scheduleMutation.isPending}>
              {scheduleMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Shrani
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function ArtikliTab({ bootstrap }: { bootstrap: any }) {
  const groups: MalicaGroup[] = bootstrap?.groups ?? [];
  const assignments: MalicaArticleAssignment[] = bootstrap?.assignments ?? [];
  const { data: artikli } = useListArtikli();
  const queryClient = useQueryClient();
  const { toast } = useToast();
  const assignMutation = useAssignMalicaArticle();

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<number | null>(null);
  
  // form state
  const [artikelId, setArtikelId] = useState("");
  const [role, setRole] = useState<MalicaArticleAssignmentRole | "none">("none");
  const [groupId, setGroupId] = useState<string>("none");
  const [autoSyncPrice, setAutoSyncPrice] = useState(true);
  const [manualPrice, setManualPrice] = useState("");

  const handleOpen = (ass?: MalicaArticleAssignment) => {
    if (ass) {
      setEditId(ass.artikelId);
      setArtikelId(String(ass.artikelId));
      setRole(ass.role);
      setGroupId(ass.groupId ? String(ass.groupId) : "none");
      setAutoSyncPrice(ass.autoSyncPrice);
      setManualPrice(ass.malicaPriceCents != null ? (ass.malicaPriceCents / 100).toFixed(2) : "");
    } else {
      setEditId(null);
      setArtikelId("");
      setRole("main");
      setGroupId("none");
      setAutoSyncPrice(true);
      setManualPrice("");
    }
    setOpen(true);
  };

  const handleSave = async () => {
    const aId = parseInt(artikelId, 10);
    if (isNaN(aId)) {
      toast({ title: "Izberite artikel", variant: "destructive" });
      return;
    }
    let mPrice: number | null = null;
    if (!autoSyncPrice) {
      mPrice = Math.round(parseDecimal(manualPrice) * 100);
      if (isNaN(mPrice) || mPrice < 0) {
        toast({ title: "Neveljavna cena", variant: "destructive" });
        return;
      }
    }
    try {
      await assignMutation.mutateAsync({
        articleId: aId,
        data: {
          role: role as MalicaArticleAssignmentRole,
          groupId: groupId !== "none" ? parseInt(groupId, 10) : null,
          autoSyncPrice,
          malicaPriceCents: mPrice
        }
      });
      toast({ title: "Artikel shranjen" });
      setOpen(false);
      queryClient.invalidateQueries({ queryKey: getGetMalicaBootstrapQueryKey() });
    } catch (err: any) {
      const msg = err.response?.data?.message || err.response?.data?.napaka || "Napaka pri shranjevanju";
      toast({ title: "Napaka", description: msg, variant: "destructive" });
    }
  };

  const roleLabels: Record<string, string> = {
    main: "Glavna jed",
    soup: "Juha",
    dessert: "Sladica",
    none: "Brez vloge"
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <div>
          <CardTitle>Artikli in vloge</CardTitle>
          <CardDescription>Povežite artikle iz šifranta z vlogami pri malicah.</CardDescription>
        </div>
        <Button onClick={() => handleOpen()}><Plus className="w-4 h-4 mr-2" /> Dodaj povezavo</Button>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-muted/50">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Artikel</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Vloga</th>
                <th className="text-left px-4 py-3 font-semibold text-muted-foreground">Skupina</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Cena (€)</th>
                <th className="text-right px-4 py-3 font-semibold text-muted-foreground">Akcije</th>
              </tr>
            </thead>
            <tbody>
              {assignments.map(a => {
                const art = artikli?.find(x => x.id === a.artikelId);
                const g = groups.find(x => x.id === a.groupId);
                return (
                  <tr key={a.id} className="border-t hover:bg-muted/30">
                    <td className="px-4 py-3 font-medium">{art?.ime || `Artikel #${a.artikelId}`}</td>
                    <td className="px-4 py-3">
                      <Badge variant="outline">{roleLabels[a.role] || a.role}</Badge>
                    </td>
                    <td className="px-4 py-3 text-muted-foreground">{g?.name || "—"}</td>
                    <td className="px-4 py-3 text-right">
                      {a.autoSyncPrice ? (
                        <span className="text-muted-foreground text-xs italic">Samodejno</span>
                      ) : (
                        <span className="font-semibold">{formatMoney(a.malicaPriceCents)}</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleOpen(a)}>
                        <Pencil className="w-4 h-4" />
                      </Button>
                    </td>
                  </tr>
                );
              })}
              {assignments.length === 0 && (
                <tr><td colSpan={5} className="text-center py-8 text-muted-foreground">Ni dodeljenih artiklov.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </CardContent>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{editId ? "Uredi povezavo" : "Dodaj artikel k malicam"}</DialogTitle>
          </DialogHeader>
          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto py-4">
            <div className="grid gap-2">
              <Label htmlFor="malica-artikel">Artikel</Label>
              <select
                id="malica-artikel"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50"
                value={artikelId}
                onChange={(event) => setArtikelId(event.target.value)}
                disabled={editId !== null}
              >
                <option value="">Izberite artikel...</option>
                {(artikli || []).map(a => (
                  <option key={a.id} value={a.id}>{a.ime}</option>
                ))}
              </select>
            </div>
            <div className="grid gap-2">
              <Label>Vloga</Label>
              <Select value={role} onValueChange={(v: any) => setRole(v)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="main">Glavna jed</SelectItem>
                  <SelectItem value="soup">Juha</SelectItem>
                  <SelectItem value="dessert">Sladica</SelectItem>
                  <SelectItem value="none">Brez vloge (onemogoči)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {role === "main" && (
              <div className="grid gap-2">
                <Label>Skupina malic (Katera skupina je to?)</Label>
                <Select value={groupId} onValueChange={setGroupId}>
                  <SelectTrigger><SelectValue placeholder="Brez skupine" /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Brez skupine</SelectItem>
                    {groups.map(g => (
                      <SelectItem key={g.id} value={String(g.id)}>{g.name} ({g.code})</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="flex items-center gap-2 pt-2">
              <Checkbox id="auto-sync" checked={autoSyncPrice} onCheckedChange={(c) => setAutoSyncPrice(!!c)} />
              <Label htmlFor="auto-sync">Samodejno usklajuj ceno s skupino</Label>
            </div>
            {!autoSyncPrice && (
              <div className="grid gap-2 pl-6">
                <Label>Ročna cena (€)</Label>
                <DecimalInput value={manualPrice} onChange={(e) => setManualPrice(e.target.value)} />
              </div>
            )}
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Prekliči</Button>
            <Button onClick={handleSave} disabled={assignMutation.isPending}>
              {assignMutation.isPending && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
              Shrani
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </Card>
  );
}

function DnevnePonudbeTab({ bootstrap }: { bootstrap: any }) {
  const groups: MalicaGroup[] = bootstrap?.groups ?? [];
  const assignments: MalicaArticleAssignment[] = bootstrap?.assignments ?? [];
  const { data: artikli } = useListArtikli();
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const [selectedDate, setSelectedDate] = useState(format(new Date(), "yyyy-MM-dd"));
  
  // Calculate this week's dates
  const dates = useMemo(() => {
    const today = new Date();
    return Array.from({ length: 14 }).map((_, i) => format(addDays(today, i - 2), "yyyy-MM-dd"));
  }, []);

  const { data: offers, isLoading } = useListMalicaDailyOffers({
    from: dates[0],
    to: dates[dates.length - 1]
  });

  const offer = offers?.find(o => o.businessDate === selectedDate);
  
  const mainDishes = assignments.filter(a => a.role === "main" && a.active);
  const soups = assignments.filter(a => a.role === "soup" && a.active);
  const desserts = assignments.filter(a => a.role === "dessert" && a.active);

  // Form state
  const [formData, setFormData] = useState<{
    mainItems: MalicaDailyMainItemInput[];
    includedCourses: MalicaDailyCourseInput[];
  } | null>(null);

  useMemo(() => {
    if (offer) {
      setFormData({
        mainItems: offer.mainItems || [],
        includedCourses: offer.includedCourses || []
      });
    } else {
      setFormData({ mainItems: [], includedCourses: [] });
    }
  }, [offer, selectedDate]);

  const createMutation = useCreateMalicaDailyOffer();
  const updateMutation = useUpdateMalicaDailyOffer();
  const publishMutation = usePublishMalicaDailyOffer();
  const closeMutation = useCloseMalicaDailyOffer();

  const handleSave = async () => {
    if (!formData) return;
    try {
      if (offer) {
        await updateMutation.mutateAsync({
          offerId: offer.id,
          data: {
            mainItems: formData.mainItems,
            includedCourses: formData.includedCourses
          }
        });
      } else {
        await createMutation.mutateAsync({
          data: {
            businessDate: selectedDate,
            mainItems: formData.mainItems,
            includedCourses: formData.includedCourses
          }
        });
      }
      toast({ title: "Dnevna ponudba shranjena" });
      queryClient.invalidateQueries({ queryKey: getListMalicaDailyOffersQueryKey() });
    } catch (err: any) {
      const msg = err.response?.data?.message || err.response?.data?.napaka || "Napaka pri shranjevanju";
      toast({ title: "Napaka", description: msg, variant: "destructive" });
    }
  };

  const handlePublish = async () => {
    if (!offer) return;
    try {
      await publishMutation.mutateAsync({ offerId: offer.id });
      toast({ title: "Ponudba objavljena" });
      queryClient.invalidateQueries({ queryKey: getListMalicaDailyOffersQueryKey() });
    } catch (err: any) {
      const msg = err.response?.data?.message || err.response?.data?.napaka || "Napaka pri objavi";
      toast({ title: "Napaka", description: msg, variant: "destructive" });
    }
  };

  const handleClose = async () => {
    if (!offer) return;
    try {
      await closeMutation.mutateAsync({ offerId: offer.id });
      toast({ title: "Ponudba zaključena" });
      queryClient.invalidateQueries({ queryKey: getListMalicaDailyOffersQueryKey() });
    } catch (err: any) {
      const msg = err.response?.data?.message || err.response?.data?.napaka || "Napaka pri zaključku ponudbe";
      toast({ title: "Napaka", description: msg, variant: "destructive" });
    }
  };

  const updateMainItem = (groupId: number, artikelId: number | null) => {
    setFormData(prev => {
      if (!prev) return prev;
      const filtered = prev.mainItems.filter(m => m.groupId !== groupId);
      if (artikelId) {
        filtered.push({ groupId, artikelId, enabled: true });
      }
      return { ...prev, mainItems: filtered };
    });
  };

  const toggleCourse = (artikelId: number, role: MalicaArticleAssignmentRole) => {
    setFormData(prev => {
      if (!prev) return prev;
      const exists = prev.includedCourses.some(c => c.artikelId === artikelId);
      let updated;
      if (exists) {
        updated = prev.includedCourses.filter(c => c.artikelId !== artikelId);
      } else {
        updated = [...prev.includedCourses, { courseType: role as any, artikelId, quantity: 1, enabled: true }];
      }
      return { ...prev, includedCourses: updated };
    });
  };

  return (
    <div className="flex flex-col md:flex-row gap-6">
      <Card className="md:w-64 shrink-0 h-fit">
        <CardHeader className="pb-4">
          <CardTitle className="text-base">Izberite datum</CardTitle>
        </CardHeader>
        <CardContent className="p-2 space-y-1">
          {dates.map(date => {
            const o = offers?.find(x => x.businessDate === date);
            const isSelected = selectedDate === date;
            return (
              <button
                key={date}
                className={`w-full flex items-center justify-between px-3 py-2 rounded-md text-sm transition-colors ${
                  isSelected ? "bg-primary text-primary-foreground font-medium" : "hover:bg-muted"
                }`}
                onClick={() => setSelectedDate(date)}
              >
                <span>{format(parseISO(date), "EEEE, d. M.", { locale: sl })}</span>
                {o?.status === "published" && <CheckCircle2 className="w-4 h-4 opacity-70" />}
              </button>
            );
          })}
        </CardContent>
      </Card>

      <Card className="flex-1">
        <CardHeader className="flex flex-row items-center justify-between pb-4">
          <div>
            <CardTitle>{format(parseISO(selectedDate), "EEEE, d. MMMM yyyy", { locale: sl })}</CardTitle>
            <CardDescription>
              {offer?.status === "closed" ? (
                <span className="text-muted-foreground font-medium">Zaključeno (ni več vidno gostom)</span>
              ) : offer?.status === "published" ? (
                <span className="text-emerald-600 font-medium">Objavljeno in vidno gostom</span>
              ) : offer ? (
                <span className="text-amber-600 font-medium">Osnutek (ni objavljeno)</span>
              ) : (
                "Za ta dan še ni vnesene ponudbe."
              )}
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            {(!offer || offer.status === "draft") && (
              <Button variant="default" onClick={handleSave} disabled={!formData || createMutation.isPending || updateMutation.isPending}>
                <Save className="w-4 h-4 mr-2" /> Shrani osnutek
              </Button>
            )}
            {offer && offer.status === "draft" && (
              <Button variant="default" className="bg-emerald-600 hover:bg-emerald-700" onClick={handlePublish} disabled={publishMutation.isPending}>
                <ArrowRight className="w-4 h-4 mr-2" /> Objavi
              </Button>
            )}
            {offer && offer.status === "published" && (
              <Button variant="outline" className="text-destructive hover:text-destructive hover:bg-destructive/10" onClick={handleClose} disabled={closeMutation.isPending}>
                Zaključi ponudbo
              </Button>
            )}
          </div>
        </CardHeader>
        
        {formData && (
          <CardContent className="space-y-8">
            <div className="space-y-4">
              <h3 className="font-semibold text-lg border-b pb-2">Glavne jedi</h3>
              <div className="grid gap-4 sm:grid-cols-2">
                {groups.map(g => {
                  const currentItem = formData.mainItems.find(m => m.groupId === g.id);
                  const allowedArticles = mainDishes.filter(a => a.groupId === g.id || !a.groupId);
                  return (
                    <div key={g.id} className="space-y-1.5 p-3 border rounded-lg bg-muted/20">
                      <Label className="font-medium text-primary">{g.name} ({g.code})</Label>
                      <Select 
                        value={currentItem ? String(currentItem.artikelId) : "none"} 
                        onValueChange={(val) => updateMainItem(g.id, val === "none" ? null : parseInt(val))}
                        disabled={offer?.status === "closed"}
                      >
                        <SelectTrigger className="bg-background">
                          <SelectValue placeholder="Izberite glavno jed..." />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="none">Brez ponudbe</SelectItem>
                          {allowedArticles.map(a => {
                            const art = artikli?.find(x => x.id === a.artikelId);
                            return <SelectItem key={a.artikelId} value={String(a.artikelId)}>{art?.ime || `Art #${a.artikelId}`}</SelectItem>;
                          })}
                        </SelectContent>
                      </Select>
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="grid sm:grid-cols-2 gap-8">
              <div className="space-y-4">
                <h3 className="font-semibold text-lg border-b pb-2">Juhe</h3>
                <div className="space-y-2">
                  {soups.map(s => {
                    const art = artikli?.find(x => x.id === s.artikelId);
                    const isChecked = formData.includedCourses.some(c => c.artikelId === s.artikelId);
                    return (
                      <div key={s.id} className="flex items-center space-x-2">
                        <Checkbox 
                          id={`soup-${s.id}`} 
                          checked={isChecked}
                          onCheckedChange={() => toggleCourse(s.artikelId, "soup")}
                          disabled={offer?.status === "closed"}
                        />
                        <Label htmlFor={`soup-${s.id}`} className="font-normal cursor-pointer leading-tight">
                          {art?.ime || `Art #${s.artikelId}`}
                        </Label>
                      </div>
                    );
                  })}
                  {soups.length === 0 && <p className="text-sm text-muted-foreground">Ni registriranih juh.</p>}
                </div>
              </div>

              <div className="space-y-4">
                <h3 className="font-semibold text-lg border-b pb-2">Sladice</h3>
                <div className="space-y-2">
                  {desserts.map(s => {
                    const art = artikli?.find(x => x.id === s.artikelId);
                    const isChecked = formData.includedCourses.some(c => c.artikelId === s.artikelId);
                    return (
                      <div key={s.id} className="flex items-center space-x-2">
                        <Checkbox 
                          id={`dessert-${s.id}`} 
                          checked={isChecked}
                          onCheckedChange={() => toggleCourse(s.artikelId, "dessert")}
                          disabled={offer?.status === "closed"}
                        />
                        <Label htmlFor={`dessert-${s.id}`} className="font-normal cursor-pointer leading-tight">
                          {art?.ime || `Art #${s.artikelId}`}
                        </Label>
                      </div>
                    );
                  })}
                  {desserts.length === 0 && <p className="text-sm text-muted-foreground">Ni registriranih sladic.</p>}
                </div>
              </div>
            </div>
          </CardContent>
        )}
      </Card>
    </div>
  );
}
