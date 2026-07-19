import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Plus,
  Search,
  Loader2,
  AlertCircle,
  Building2,
  Mail,
  MapPin,
  Pencil,
  ExternalLink,
  CheckCircle2,
  ShieldCheck,
} from "lucide-react";

import { useCompany } from "@/contexts/CompanyContext";
import {
  useListCounterparties,
  useCreateCounterparty,
  useUpdateCounterparty,
  getListCounterpartiesQueryKey,
  type CounterpartyRecord,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle, SheetFooter } from "@/components/ui/sheet";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Switch } from "@/components/ui/switch";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useAuth } from "@clerk/react";

export default function Partnerji() {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();

  const [activeTab, setActiveTab] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");

  React.useEffect(() => {
    const handler = setTimeout(() => setDebouncedSearch(search), 300);
    return () => clearTimeout(handler);
  }, [search]);

  const { data, isLoading, error } = useListCounterparties(
    activeCompany?.id ?? "",
    {
      type: activeTab !== "all" ? (activeTab as any) : undefined,
      search: debouncedSearch || undefined,
      includeInactive: true,
    },
    { query: { enabled: !!activeCompany?.id } as any }
  );

  const counterparties = data?.counterparties ?? [];

  const [sheetOpen, setSheetOpen] = useState(false);
  const [editingPartner, setEditingPartner] = useState<CounterpartyRecord | null>(null);

  const handleEdit = (partner: CounterpartyRecord) => {
    setEditingPartner(partner);
    setSheetOpen(true);
  };

  const handleNew = () => {
    setEditingPartner(null);
    setSheetOpen(true);
  };

  const closeSheet = () => {
    setSheetOpen(false);
    setEditingPartner(null);
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Napaka</AlertTitle>
        <AlertDescription>Prišlo je do napake pri nalaganju partnerjev.</AlertDescription>
      </Alert>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Poslovni partnerji</h1>
          <p className="text-muted-foreground mt-1">Upravljanje kupcev in dobaviteljev.</p>
        </div>
        {activeCompany?.role !== "viewer" && (
          <Button onClick={handleNew}>
            <Plus className="mr-2 h-4 w-4" />
            Nov partner
          </Button>
        )}
      </div>

      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between bg-card p-4 rounded-lg border shadow-sm">
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full sm:w-auto">
          <TabsList>
            <TabsTrigger value="all">Vsi</TabsTrigger>
            <TabsTrigger value="customer">Kupci</TabsTrigger>
            <TabsTrigger value="supplier">Dobavitelji</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="relative w-full sm:w-72">
          <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
          <Input
            placeholder="Iskanje po nazivu ali davčni št."
            className="pl-9"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
        </div>
      </div>

      {isLoading ? (
        <div className="space-y-4">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-[400px] w-full" />
        </div>
      ) : counterparties.length === 0 ? (
        <div className="border border-dashed rounded-lg p-10 flex flex-col items-center justify-center text-center bg-card">
          <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <Building2 className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Ni najdenih partnerjev</h2>
          <p className="text-muted-foreground max-w-md mb-6">
            Za izbrane filtre ni bilo mogoče najti nobenega partnerja.
          </p>
          {activeCompany?.role !== "viewer" && (
            <Button onClick={handleNew}>
              <Plus className="mr-2 h-4 w-4" />
              Dodaj prvega partnerja
            </Button>
          )}
        </div>
      ) : (
        <div className="border rounded-lg bg-card overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Naziv</TableHead>
                <TableHead>Davčna / Matična</TableHead>
                <TableHead>Mesto</TableHead>
                <TableHead>E-mail</TableHead>
                <TableHead className="w-[100px]">Plačilni rok</TableHead>
                <TableHead className="w-[80px]">DDV</TableHead>
                <TableHead className="w-[120px]">Tip</TableHead>
                <TableHead className="w-[100px]">Status</TableHead>
                <TableHead className="w-[80px] text-right">Dejanja</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {counterparties.map((partner) => (
                <TableRow key={partner.id} className={!partner.isActive ? "opacity-60" : ""}>
                  <TableCell className="font-medium">
                    <span className={!partner.isActive ? "line-through" : ""}>{partner.name}</span>
                  </TableCell>
                  <TableCell className="text-muted-foreground text-sm">
                    <div className="flex flex-col gap-0.5">
                      {partner.taxId && <span>{partner.taxId}</span>}
                      {partner.registrationNumber && (
                        <span className="text-xs text-muted-foreground/70">MŠ: {partner.registrationNumber}</span>
                      )}
                      {!partner.taxId && !partner.registrationNumber && "-"}
                    </div>
                  </TableCell>
                  <TableCell className="text-muted-foreground">{partner.city || "-"}</TableCell>
                  <TableCell className="text-muted-foreground">
                    {partner.email ? (
                      <div className="flex items-center gap-1.5">
                        <Mail className="h-3 w-3" />
                        {partner.email}
                      </div>
                    ) : "-"}
                  </TableCell>
                  <TableCell className="text-muted-foreground">
                    {partner.paymentTermsDays ? `${partner.paymentTermsDays} dni` : "-"}
                  </TableCell>
                  <TableCell>
                    {partner.vatPayer ? (
                      <Badge variant="outline" className="text-emerald-600 border-emerald-200 bg-emerald-50/50 gap-1">
                        <ShieldCheck className="h-3 w-3" />
                        Da
                      </Badge>
                    ) : (
                      <span className="text-muted-foreground text-sm">Ne</span>
                    )}
                  </TableCell>
                  <TableCell>
                    {partner.type === "customer" && <Badge variant="outline" className="text-blue-600 border-blue-200 bg-blue-50/50">Kupec</Badge>}
                    {partner.type === "supplier" && <Badge variant="outline" className="text-orange-600 border-orange-200 bg-orange-50/50">Dobavitelj</Badge>}
                    {partner.type === "both" && <Badge variant="outline" className="text-purple-600 border-purple-200 bg-purple-50/50">Kupec in dobavitelj</Badge>}
                  </TableCell>
                  <TableCell>
                    {partner.isActive ? (
                      <Badge variant="secondary" className="bg-green-100 text-green-700">Aktiven</Badge>
                    ) : (
                      <Badge variant="secondary" className="bg-slate-100 text-slate-700">Neaktiven</Badge>
                    )}
                  </TableCell>
                  <TableCell className="text-right">
                    {activeCompany?.role !== "viewer" && (
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(partner)}>
                        <Pencil className="h-4 w-4" />
                      </Button>
                    )}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      )}

      {sheetOpen && (
        <PartnerSheet
          open={sheetOpen}
          onOpenChange={closeSheet}
          partner={editingPartner}
        />
      )}
    </div>
  );
}

// ─── AJPES rezultat tip ───────────────────────────────────────────────────────
interface AjpesResult {
  found: boolean;
  taxId: string;
  registrationNumber: string | null;
  name: string;
  address: string | null;
  postCode: string | null;
  city: string | null;
  country: string;
  vatPayer: boolean;
  iban: string | null;
  source: "ajpes_sim";
}

// ─── PartnerSheet ─────────────────────────────────────────────────────────────
function PartnerSheet({
  open,
  onOpenChange,
  partner,
}: {
  open: boolean;
  onOpenChange: () => void;
  partner: CounterpartyRecord | null;
}) {
  const { activeCompany } = useCompany();
  const { getToken } = useAuth();
  const queryClient = useQueryClient();

  const [formData, setFormData] = useState({
    type: partner?.type || "customer",
    name: partner?.name || "",
    taxId: partner?.taxId || "",
    registrationNumber: partner?.registrationNumber || "",
    vatPayer: partner?.vatPayer ?? false,
    address: partner?.address || "",
    postCode: partner?.postCode || "",
    city: partner?.city || "",
    country: partner?.country || "SI",
    email: partner?.email || "",
    phone: partner?.phone || "",
    iban: partner?.iban || "",
    paymentTermsDays: partner?.paymentTermsDays?.toString() || "",
    notes: partner?.notes || "",
    isActive: partner ? partner.isActive : true,
  });

  // AJPES lookup stanje
  const [ajpesLoading, setAjpesLoading] = useState(false);
  const [ajpesResult, setAjpesResult] = useState<AjpesResult | null>(null);
  const [ajpesError, setAjpesError] = useState<string | null>(null);

  const createMut = useCreateCounterparty();
  const updateMut = useUpdateCounterparty();
  const isPending = createMut.isPending || updateMut.isPending;

  const handleChange = (field: string, value: any) => {
    setFormData((prev) => ({ ...prev, [field]: value }));
  };

  // ── AJPES poizvedba ──────────────────────────────────────────────────────
  const handleAjpesLookup = async () => {
    if (!formData.taxId.trim() || !activeCompany) return;
    setAjpesLoading(true);
    setAjpesError(null);
    setAjpesResult(null);
    try {
      const token = await getToken();
      const base = import.meta.env.BASE_URL.replace(/\/$/, "");
      const resp = await fetch(
        `${base}/api/companies/${activeCompany.id}/counterparties/ajpes-lookup`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${token}`,
            "X-Company-Id": activeCompany.id,
          },
          body: JSON.stringify({ taxId: formData.taxId }),
        }
      );
      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        throw new Error((err as any).error || "Napaka pri poizvedbi");
      }
      const result: AjpesResult = await resp.json();
      setAjpesResult(result);
    } catch (e: any) {
      setAjpesError(e.message || "Neznana napaka");
    } finally {
      setAjpesLoading(false);
    }
  };

  const applyAjpes = () => {
    if (!ajpesResult) return;
    setFormData((prev) => ({
      ...prev,
      name: ajpesResult.name || prev.name,
      taxId: ajpesResult.taxId || prev.taxId,
      registrationNumber: ajpesResult.registrationNumber || prev.registrationNumber,
      vatPayer: ajpesResult.vatPayer,
      address: ajpesResult.address || prev.address,
      postCode: ajpesResult.postCode || prev.postCode,
      city: ajpesResult.city || prev.city,
      country: ajpesResult.country || prev.country,
      iban: ajpesResult.iban || prev.iban,
    }));
    setAjpesResult(null);
  };

  // ── Shrani ───────────────────────────────────────────────────────────────
  const handleSave = () => {
    if (!activeCompany || !formData.name) return;
    const payload = {
      ...formData,
      taxId: formData.taxId || null,
      registrationNumber: formData.registrationNumber || null,
      address: formData.address || null,
      postCode: formData.postCode || null,
      city: formData.city || null,
      country: formData.country || null,
      email: formData.email || null,
      phone: formData.phone || null,
      iban: formData.iban || null,
      paymentTermsDays: formData.paymentTermsDays ? parseInt(formData.paymentTermsDays, 10) : null,
      notes: formData.notes || null,
    };

    const onSuccess = () => {
      queryClient.invalidateQueries({ queryKey: getListCounterpartiesQueryKey(activeCompany.id) });
      onOpenChange();
    };

    if (partner) {
      updateMut.mutate({ companyId: activeCompany.id, id: partner.id, data: payload as any }, { onSuccess });
    } else {
      createMut.mutate({ companyId: activeCompany.id, data: payload as any }, { onSuccess });
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto" side="right">
        <SheetHeader className="mb-6">
          <SheetTitle>{partner ? "Uredi partnerja" : "Nov partner"}</SheetTitle>
          <SheetDescription>
            {partner
              ? "Uredite podatke o poslovnem partnerju."
              : "Vnesite podatke ali poiščite podjetje po davčni številki (AJPES)."}
          </SheetDescription>
        </SheetHeader>

        <div className="grid gap-6">
          {/* Tip */}
          <div className="space-y-2">
            <Label>Tip partnerja <span className="text-destructive">*</span></Label>
            <Select value={formData.type} onValueChange={(val) => handleChange("type", val)}>
              <SelectTrigger><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="customer">Kupec</SelectItem>
                <SelectItem value="supplier">Dobavitelj</SelectItem>
                <SelectItem value="both">Oba (Kupec in dobavitelj)</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Davčna številka + AJPES */}
          <div className="space-y-2">
            <Label>Davčna številka</Label>
            <div className="flex gap-2">
              <Input
                value={formData.taxId}
                onChange={(e) => handleChange("taxId", e.target.value)}
                placeholder="SI12345678"
                className="flex-1"
              />
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={handleAjpesLookup}
                disabled={!formData.taxId.trim() || ajpesLoading}
                className="shrink-0 gap-1.5"
              >
                {ajpesLoading ? (
                  <Loader2 className="h-3.5 w-3.5 animate-spin" />
                ) : (
                  <ExternalLink className="h-3.5 w-3.5" />
                )}
                AJPES
              </Button>
            </div>

            {/* AJPES napaka */}
            {ajpesError && (
              <p className="text-xs text-destructive flex items-center gap-1">
                <AlertCircle className="h-3 w-3" /> {ajpesError}
              </p>
            )}

            {/* AJPES rezultat */}
            {ajpesResult && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50/60 p-3 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-1.5 text-sm font-semibold text-emerald-800">
                    <CheckCircle2 className="h-4 w-4" />
                    Najdeno v AJPES registru
                    <span className="text-xs font-normal text-emerald-600">(simulacija)</span>
                  </div>
                </div>
                <div className="text-sm space-y-0.5 text-emerald-900">
                  <div className="font-medium">{ajpesResult.name}</div>
                  {ajpesResult.registrationNumber && (
                    <div className="text-xs text-emerald-700">MŠ: {ajpesResult.registrationNumber}</div>
                  )}
                  {ajpesResult.address && (
                    <div className="text-xs text-emerald-700">
                      {ajpesResult.address}, {ajpesResult.postCode} {ajpesResult.city}
                    </div>
                  )}
                  <div className="text-xs text-emerald-700">
                    Zavezanec za DDV: <strong>{ajpesResult.vatPayer ? "Da" : "Ne"}</strong>
                  </div>
                </div>
                <Button size="sm" className="w-full mt-1 bg-emerald-600 hover:bg-emerald-700" onClick={applyAjpes}>
                  Uporabi te podatke
                </Button>
              </div>
            )}
          </div>

          {/* Naziv */}
          <div className="space-y-2">
            <Label>Naziv <span className="text-destructive">*</span></Label>
            <Input
              value={formData.name}
              onChange={(e) => handleChange("name", e.target.value)}
              placeholder="Polni naziv podjetja ali osebe"
            />
          </div>

          {/* Matična številka + plačilni rok */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-2">
              <Label>Matična številka</Label>
              <Input
                value={formData.registrationNumber}
                onChange={(e) => handleChange("registrationNumber", e.target.value)}
                placeholder="1234567"
              />
            </div>
            <div className="space-y-2">
              <Label>Plačilni rok (dni)</Label>
              <Input
                type="number"
                min="0"
                value={formData.paymentTermsDays}
                onChange={(e) => handleChange("paymentTermsDays", e.target.value)}
                placeholder="30"
              />
            </div>
          </div>

          {/* DDV zavezanec */}
          <div className="flex items-center justify-between rounded-lg border px-4 py-3 bg-muted/20">
            <div>
              <Label htmlFor="vatPayer" className="cursor-pointer font-medium">Zavezanec za DDV</Label>
              <p className="text-xs text-muted-foreground mt-0.5">Partner je identificiran za namene DDV (ima SI davčno številko)</p>
            </div>
            <Switch
              id="vatPayer"
              checked={formData.vatPayer}
              onCheckedChange={(v) => handleChange("vatPayer", v)}
            />
          </div>

          {/* Naslov */}
          <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <MapPin className="h-4 w-4 text-muted-foreground" />
              Naslov in lokacija
            </h4>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label className="text-xs">Ulica in hišna številka</Label>
                <Input
                  value={formData.address}
                  onChange={(e) => handleChange("address", e.target.value)}
                  placeholder="Slovenska cesta 1"
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label className="text-xs">Poštna št.</Label>
                  <Input
                    value={formData.postCode}
                    onChange={(e) => handleChange("postCode", e.target.value)}
                    placeholder="1000"
                  />
                </div>
                <div className="space-y-2">
                  <Label className="text-xs">Kraj</Label>
                  <Input
                    value={formData.city}
                    onChange={(e) => handleChange("city", e.target.value)}
                    placeholder="Ljubljana"
                  />
                </div>
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Država</Label>
                <Input
                  value={formData.country}
                  onChange={(e) => handleChange("country", e.target.value)}
                  placeholder="SI"
                />
              </div>
            </div>
          </div>

          {/* Kontaktni podatki */}
          <div className="space-y-4 rounded-lg border p-4 bg-muted/20">
            <h4 className="text-sm font-semibold flex items-center gap-2">
              <Mail className="h-4 w-4 text-muted-foreground" />
              Kontaktni podatki in banka
            </h4>
            <div className="space-y-3">
              <div className="space-y-2">
                <Label className="text-xs">E-mail adresa</Label>
                <Input
                  type="email"
                  value={formData.email}
                  onChange={(e) => handleChange("email", e.target.value)}
                  placeholder="info@podjetje.si"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">Telefonska številka</Label>
                <Input
                  value={formData.phone}
                  onChange={(e) => handleChange("phone", e.target.value)}
                  placeholder="+386 1 234 56 78"
                />
              </div>
              <div className="space-y-2">
                <Label className="text-xs">IBAN / TRR</Label>
                <Input
                  value={formData.iban}
                  onChange={(e) => handleChange("iban", e.target.value)}
                  placeholder="SI56 0000 0000 0000 000"
                />
              </div>
            </div>
          </div>

          {/* Opombe */}
          <div className="space-y-2">
            <Label>Opombe</Label>
            <Textarea
              value={formData.notes}
              onChange={(e) => handleChange("notes", e.target.value)}
              placeholder="Dodatne informacije o partnerju..."
              className="resize-none"
              rows={3}
            />
          </div>

          {/* Aktiven (samo pri urejanju) */}
          {partner && (
            <div className="flex items-center space-x-2 border p-3 rounded-md bg-muted/20">
              <Checkbox
                id="isActive"
                checked={formData.isActive}
                onCheckedChange={(c) => handleChange("isActive", !!c)}
              />
              <Label htmlFor="isActive" className="font-medium cursor-pointer">
                Aktiven partner
              </Label>
            </div>
          )}
        </div>

        <SheetFooter className="mt-8 pt-4 border-t sticky bottom-0 bg-background pb-4">
          <Button variant="outline" onClick={onOpenChange}>Prekliči</Button>
          <Button onClick={handleSave} disabled={!formData.name || isPending}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Shrani partnerja
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
