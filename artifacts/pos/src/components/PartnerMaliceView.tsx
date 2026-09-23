import { useState, useMemo } from "react";
import { 
  useListMalicaContracts, 
  useCreateMalicaContract, 
  useListMalicaBeneficiaries, 
  useCreateMalicaBeneficiary,
  useUpdateMalicaBeneficiary,
  useReplaceMalicaBeneficiaryIdentifier,
  useRemoveMalicaBeneficiaryIdentifier,
  useCloseMalicaContract,
  getListMalicaContractsQueryKey,
  getListMalicaBeneficiariesQueryKey,
  type MalicaContract, 
  type MalicaBeneficiary 
} from "@workspace/api-client-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { Loader2, Plus, Calendar, ShieldAlert, Key, Edit, Trash2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog";

import { formatContractPayloadModeValues } from "@/lib/malicaQuoteHelpers";

export function formatUserDate(isoDate: string): string {
  try {
    return format(new Date(isoDate), "dd.MM.yyyy");
  } catch {
    return isoDate;
  }
}

export function PartnerMaliceView({ partnerId }: { partnerId: string }) {
  // Let's implement the full PartnerMaliceView here with edit/remove flows...
  const { data: contracts, isLoading: loadingContracts } = useListMalicaContracts(partnerId);
  const { data: allBeneficiaries, isLoading: loadingBeneficiaries } = useListMalicaBeneficiaries();
  
  const createContract = useCreateMalicaContract();
  const closeContract = useCloseMalicaContract();
  const createBeneficiary = useCreateMalicaBeneficiary();
  const updateBeneficiary = useUpdateMalicaBeneficiary();
  const replaceIdentifier = useReplaceMalicaBeneficiaryIdentifier();
  const removeIdentifier = useRemoveMalicaBeneficiaryIdentifier();
  
  const queryClient = useQueryClient();
  const { toast } = useToast();

  const activeContract = useMemo(() => contracts?.find(c => {
    const now = new Date().toISOString().split("T")[0]; // Use date-only for comparison if API returns ISO date-time, though generated API takes string, comparison depends on actual data. Let's just assume validFrom is ISO string.
    return c.validFrom <= new Date().toISOString() && (!c.validTo || c.validTo > new Date().toISOString());
  }), [contracts]);

  const [showContractForm, setShowContractForm] = useState(false);
  const [contractMode, setContractMode] = useState<any>("partner_all");
  const [splitKind, setSplitKind] = useState<any>("fixed");
  const [splitValue, setSplitValue] = useState("");
  const [surcharge, setSurcharge] = useState("0");
  const [monthlyLimit, setMonthlyLimit] = useState("");
  const [validFrom, setValidFrom] = useState(new Date().toISOString().split("T")[0]);
  const [validTo, setValidTo] = useState("");
  const [reqBeneficiary, setReqBeneficiary] = useState(false);
  const [closeContractConfirm, setCloseContractConfirm] = useState<number | null>(null);

  const handleCreateContract = async () => {
    if (!validFrom) return;
    try {
      const modePayload = formatContractPayloadModeValues(contractMode, splitKind, splitValue);
      await createContract.mutateAsync({
        partnerId,
        data: {
          mode: contractMode,
          ...modePayload,
          higherGroupSurchargeCents: Math.round(Number(surcharge.replace(",", ".")) * 100),
          monthlyCoverageLimitCents: monthlyLimit ? Math.round(Number(monthlyLimit.replace(",", ".")) * 100) : null,
          validFrom: validFrom, // Send exact date-only string if it was input as such, or validFrom + "T00:00:00Z" ? The instruction says "Send date-only ISO values" so just `validFrom`.
          validTo: validTo ? validTo : null,
          requiresBeneficiary: reqBeneficiary
        }
      });
      queryClient.invalidateQueries({ queryKey: getListMalicaContractsQueryKey(partnerId) });
      setShowContractForm(false);
      toast({ title: "Pogodba ustvarjena" });
    } catch (e: any) {
      toast({ title: "Napaka", description: e.message || "Napaka", variant: "destructive" });
    }
  };

  const handleCloseContract = async () => {
    if (closeContractConfirm == null) return;
    try {
      await closeContract.mutateAsync({
        partnerId,
        contractId: closeContractConfirm,
        data: { validTo: new Date().toISOString().split("T")[0] }
      });
      queryClient.invalidateQueries({ queryKey: getListMalicaContractsQueryKey(partnerId) });
      setCloseContractConfirm(null);
      toast({ title: "Pogodba zaključena" });
    } catch (e: any) {
      toast({ title: "Napaka", description: e.message || "Napaka", variant: "destructive" });
    }
  };

  const [showBenForm, setShowBenForm] = useState(false);
  const [editBen, setEditBen] = useState<MalicaBeneficiary | null>(null);
  const [benIdentType, setBenIdentType] = useState<any>("pin");
  const [benIdent, setBenIdent] = useState("");
  const [benDaily, setBenDaily] = useState("");
  const [benMonthly, setBenMonthly] = useState("");
  const [benActive, setBenActive] = useState(true);

  const openEditBen = (b: MalicaBeneficiary) => {
    setEditBen(b);
    setBenDaily(b.dailyLimit != null ? String(b.dailyLimit) : "");
    setBenMonthly(b.monthlyCoverageOverrideCents != null ? String(b.monthlyCoverageOverrideCents / 100) : "");
    setBenActive(b.active ?? true);
    setBenIdentType("pin");
    setBenIdent(""); // Reset secret
  };

  const handleSaveBeneficiary = async () => {
    try {
      if (editBen) {
        // Update limits/active
        await updateBeneficiary.mutateAsync({
          beneficiaryId: editBen.id,
          data: {
            dailyLimit: benDaily ? Number(benDaily) : null,
            monthlyCoverageOverrideCents: benMonthly ? Math.round(Number(benMonthly.replace(",", ".")) * 100) : null,
            active: benActive
          }
        });
        
        // If they provided a new identifier, replace it
        if (benIdent) {
           await replaceIdentifier.mutateAsync({
             beneficiaryId: editBen.id,
             data: {
               partnerId,
               identifierType: benIdentType,
               identifier: benIdent
             }
           });
        }
        setEditBen(null);
        toast({ title: "Upravičenec posodobljen" });
      } else {
        if (!benIdentType || !benIdent) return;
        await createBeneficiary.mutateAsync({
          data: {
            partnerId,
            identifierType: benIdentType,
            identifier: benIdent,
            dailyLimit: benDaily ? Number(benDaily) : null,
            monthlyCoverageOverrideCents: benMonthly ? Math.round(Number(benMonthly.replace(",", ".")) * 100) : null,
          }
        });
        setShowBenForm(false);
        toast({ title: "Upravičenec dodan" });
      }
      queryClient.invalidateQueries({ queryKey: getListMalicaBeneficiariesQueryKey() });
      setBenIdent("");
    } catch (e: any) {
      toast({ title: "Napaka", description: e.message || "Napaka", variant: "destructive" });
    }
  };

  const handleRemoveIdentifier = async (b: MalicaBeneficiary) => {
    try {
      await removeIdentifier.mutateAsync({ beneficiaryId: b.id });
      queryClient.invalidateQueries({ queryKey: getListMalicaBeneficiariesQueryKey() });
      toast({ title: "Identifikator odstranjen" });
    } catch (e: any) {
      toast({ title: "Napaka", description: e.message || "Napaka", variant: "destructive" });
    }
  };

  const partnerBeneficiaries = allBeneficiaries?.filter(b => b.partnerId === partnerId) || [];

  if (loadingContracts || loadingBeneficiaries) return <div className="p-4 text-center text-muted-foreground"><Loader2 className="w-5 h-5 animate-spin mx-auto" /></div>;

  return (
    <div className="space-y-6 pt-4 border-t">
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Aktivna pogodba za malice</h3>
          {!showContractForm && (
             <Button variant="outline" size="sm" onClick={() => setShowContractForm(true)}>Nova pogodba</Button>
          )}
        </div>
        
        {showContractForm ? (
          <div className="bg-slate-50 p-4 rounded-xl border space-y-4">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Velja od (začetek)</Label>
                <Input type="date" value={validFrom} onChange={e => setValidFrom(e.target.value)} />
              </div>
              <div>
                <Label>Velja do (konec - opcijsko)</Label>
                <Input type="date" value={validTo} onChange={e => setValidTo(e.target.value)} />
              </div>
            </div>
            
            <div>
              <Label>Način kritja</Label>
              <Select value={contractMode} onValueChange={setContractMode}>
                <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="partner_all">Partner plača vse</SelectItem>
                  <SelectItem value="guest_reduced_price">Znižana cena za gosta</SelectItem>
                  <SelectItem value="partner_fixed_guest_remainder">Partner fiksno, gost preostanek</SelectItem>
                  <SelectItem value="split">Delitev (fiksno/odstotek)</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {(contractMode === "split" || contractMode === "partner_fixed_guest_remainder") && (
              <div className="grid grid-cols-2 gap-3">
                {contractMode === "split" && (
                  <div>
                    <Label>Tip delitve</Label>
                    <Select value={splitKind} onValueChange={setSplitKind}>
                      <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="fixed">Fiksen znesek (€)</SelectItem>
                        <SelectItem value="percent">Odstotek (%)</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                )}
                <div className={contractMode === "partner_fixed_guest_remainder" ? "col-span-2" : ""}>
                  <Label>{contractMode === "partner_fixed_guest_remainder" ? "Znesek kritja partnerja (€)" : "Vrednost"}</Label>
                  <Input type="number" step="0.01" value={splitValue} onChange={e => setSplitValue(e.target.value)} placeholder={contractMode === "split" && splitKind === "percent" ? "Npr. 50" : "Npr. 5.00"} required />
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label>Doplačilo višje skupine (€)</Label>
                <Input type="number" step="0.01" value={surcharge} onChange={e => setSurcharge(e.target.value)} />
              </div>
              <div>
                <Label>Mesečna kapica (€)</Label>
                <Input type="number" step="0.01" value={monthlyLimit} onChange={e => setMonthlyLimit(e.target.value)} placeholder="Brez omejitve" />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Switch checked={reqBeneficiary} onCheckedChange={setReqBeneficiary} />
              <Label>Obvezna identifikacija upravičenca (PIN/Kartica)</Label>
            </div>

            <div className="flex justify-end gap-2 pt-2">
              <Button variant="ghost" onClick={() => setShowContractForm(false)}>Prekliči</Button>
              <Button onClick={handleCreateContract} disabled={createContract.isPending}>Shrani</Button>
            </div>
          </div>
        ) : activeContract ? (
          <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 text-emerald-900 text-sm space-y-2">
            <div className="flex justify-between items-start mb-2 border-b border-emerald-200/50 pb-2">
              <span className="font-semibold text-emerald-700">Aktivna pogodba</span>
              <div className="flex gap-2 items-center">
                <span className="text-xs bg-emerald-200 px-2 py-0.5 rounded-full font-bold">
                  Od: {formatUserDate(activeContract.validFrom)} {activeContract.validTo ? ` do ${formatUserDate(activeContract.validTo)}` : ""}
                </span>
                <Button variant="ghost" size="icon" className="h-6 w-6 text-red-600 hover:bg-red-100" onClick={() => setCloseContractConfirm(activeContract.id)}><Trash2 className="h-3 w-3" /></Button>
              </div>
            </div>
            <div className="flex justify-between">
              <span>Način kritja:</span>
              <span className="font-medium">{activeContract.mode}</span>
            </div>
            {activeContract.mode === "split" && (
              <div className="flex justify-between">
                <span>Vrednost delitve:</span>
                <span className="font-medium">{activeContract.splitValue} {activeContract.splitKind}</span>
              </div>
            )}
            <div className="flex justify-between">
              <span>Doplačilo višje skupine:</span>
              <span className="font-medium">{(activeContract.higherGroupSurchargeCents! / 100).toFixed(2)} €</span>
            </div>
            <div className="flex justify-between">
              <span>Mesečna kapica:</span>
              <span className="font-medium">{activeContract.monthlyCoverageLimitCents ? (activeContract.monthlyCoverageLimitCents / 100).toFixed(2) + " €" : "Brez"}</span>
            </div>
            <div className="flex justify-between">
              <span>Identifikacija:</span>
              <span className="font-medium">{activeContract.requiresBeneficiary ? "Obvezna" : "Ni obvezna"}</span>
            </div>
          </div>
        ) : (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-800 text-sm">
            Ni aktivne pogodbe. Sistem bo uporabil stare (legacy) cene skupin, če obstajajo.
          </div>
        )}
      </div>

      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-bold uppercase tracking-wider text-slate-500">Upravičenci ({partnerBeneficiaries.length})</h3>
          {!showBenForm && (
             <Button variant="outline" size="sm" onClick={() => { setEditBen(null); setBenDaily(""); setBenMonthly(""); setBenIdentType("pin"); setBenIdent(""); setShowBenForm(true); }}>Dodaj upravičenca</Button>
          )}
        </div>

        <Dialog open={showBenForm || !!editBen} onOpenChange={(o) => { if (!o) { setShowBenForm(false); setEditBen(null); } }}>
          <DialogContent className="max-w-md">
            <DialogHeader>
              <DialogTitle>{editBen ? "Uredi upravičenca" : "Nov upravičenec"}</DialogTitle>
            </DialogHeader>
            <div className="space-y-4 pt-4">
              {editBen && (
                 <div className="flex items-center gap-2 mb-2 p-2 bg-muted/50 rounded-lg">
                   <Switch checked={benActive} onCheckedChange={setBenActive} />
                   <Label>Upravičenec je aktiven</Label>
                 </div>
              )}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>{editBen ? "Zamenjaj identifikator" : "Tip identifikatorja"}</Label>
                  <Select value={benIdentType} onValueChange={setBenIdentType}>
                    <SelectTrigger className="bg-white"><SelectValue /></SelectTrigger>
                    <SelectContent>
                      <SelectItem value="pin">PIN Koda</SelectItem>
                      <SelectItem value="barcode">Barkoda</SelectItem>
                      <SelectItem value="qr">QR Koda</SelectItem>
                      <SelectItem value="nfc">NFC/Kartica</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label>Vrednost {editBen ? "(pusti prazno, če ne menjaš)" : ""}</Label>
                  <Input type={benIdentType === "pin" ? "password" : "text"} value={benIdent} onChange={e => setBenIdent(e.target.value)} placeholder="Skrivna vrednost" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <Label>Dnevna omejitev malic</Label>
                  <Input type="number" value={benDaily} onChange={e => setBenDaily(e.target.value)} placeholder="Brez" />
                </div>
                <div>
                  <Label>Mesečno kritje override (€)</Label>
                  <Input type="number" step="0.01" value={benMonthly} onChange={e => setBenMonthly(e.target.value)} placeholder="Brez (po pogodbi)" />
                </div>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <Button variant="ghost" onClick={() => { setShowBenForm(false); setEditBen(null); }}>Prekliči</Button>
                <Button onClick={handleSaveBeneficiary} disabled={createBeneficiary.isPending || updateBeneficiary.isPending || replaceIdentifier.isPending}>Shrani</Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {partnerBeneficiaries.length > 0 ? (
          <div className="space-y-2 max-h-60 overflow-y-auto pr-2">
            {partnerBeneficiaries.map(b => (
              <div key={b.id} className={`flex items-center justify-between p-3 border rounded-lg text-sm ${!b.active ? 'bg-muted/50 opacity-60' : 'bg-card'}`}>
                <div>
                  <div className="font-semibold uppercase text-xs text-muted-foreground flex gap-2 items-center">
                    {b.identifierType}
                    {!b.active && <span className="text-red-500">NEAKTIVEN</span>}
                  </div>
                  <div className="font-mono text-base">{b.maskedSuffix || "(Brez identifikatorja)"}</div>
                </div>
                <div className="flex items-center gap-4">
                  <div className="text-right text-xs text-muted-foreground space-y-0.5">
                    <div>Dnevno: <span className="font-medium text-foreground">{b.dailyLimit ?? "Brez omejitve"}</span></div>
                    <div>Mesečno: <span className="font-medium text-foreground">{b.monthlyCoverageOverrideCents ? (b.monthlyCoverageOverrideCents / 100).toFixed(2) + " €" : "Po pogodbi"}</span></div>
                  </div>
                  <div className="flex flex-col gap-1">
                    <Button variant="ghost" size="icon" className="h-6 w-6" onClick={() => openEditBen(b)}><Edit className="h-3 w-3" /></Button>
                    <Button variant="ghost" size="icon" className="h-6 w-6 text-red-600 hover:bg-red-50" onClick={() => handleRemoveIdentifier(b)} title="Odstrani identifikator"><Trash2 className="h-3 w-3" /></Button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-sm text-muted-foreground italic text-center py-4 border rounded-lg bg-slate-50/50">
            Ni vnesenih upravičencev.
          </div>
        )}
      </div>

      <AlertDialog open={closeContractConfirm != null} onOpenChange={open => { if (!open) setCloseContractConfirm(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Zaključi pogodbo</AlertDialogTitle>
            <AlertDialogDescription>
              Ali res želite zaključiti to pogodbo z današnjim dnem? Tega dejanja ni mogoče razveljaviti, potrebno bo odpreti novo pogodbo.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Prekliči</AlertDialogCancel>
            <AlertDialogAction onClick={handleCloseContract} className="bg-red-600 hover:bg-red-700">Zaključi pogodbo</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
