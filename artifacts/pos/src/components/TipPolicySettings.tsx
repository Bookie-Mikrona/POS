import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertCircle, CheckCircle2, Download, Loader2, Plus } from "lucide-react";
import type { Natakari, TipPolicy } from "@workspace/api-client-react";
import { useListNatakari } from "@workspace/api-client-react";
import { customFetch, getAuthToken } from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

function localIsoDate(date = new Date()): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function formatDatum(value: string | null | undefined): string {
  if (!value) return "—";
  const [year, month, day] = value.slice(0, 10).split("-");
  return year && month && day ? `${day}.${month}.${year}` : "—";
}

const modeLabels: Record<string, string> = {
  direct_employee: "Neposredno zaposlenemu",
  independent_pool: "Neodvisni sklad zaposlenih",
  employer_controlled: "Obvezni dodatek za storitev — prihodek podjetja z DDV",
};

export function TipPolicySettings() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const today = localIsoDate();
  const companyId = user?.companyId ?? null;
  const [selectedEnotaId, setSelectedEnotaId] = useState<number | null>(
    user?.enotaId ?? user?.enote?.[0]?.id ?? null,
  );
  const selectedEnota = user?.enote?.find(enota => enota.id === selectedEnotaId) ?? null;
  const [form, setForm] = useState({
    effectiveFrom: today,
    mode: "direct_employee",
    evidenceType: "internal_rule",
    evidenceReference: "",
    agreementConfirmed: true,
    cardFeeKind: "none",
    cardFeeTreatment: "employer_expense",
    cardFeePercent: "",
    cardFeeFlatAmount: "",
    notes: "",
  });
  const [formMessage, setFormMessage] = useState<{ type: "error" | "success"; text: string } | null>(null);
  const [payrollRange, setPayrollRange] = useState({ from: `${today.slice(0, 7)}-01`, to: today });
  const [payrollExporting, setPayrollExporting] = useState(false);
  const { data: natakari = [] } = useListNatakari();
  const [profileForm, setProfileForm] = useState({
    name: "",
    effectiveFrom: today,
    entries: [{ groupName: "Vsi zaposleni", recipientNatakarId: "", sharePercent: "" }],
  });
  const profilesQuery = useQuery<Array<{
    id: string; enotaId: number; name: string; effectiveFrom: string; effectiveTo?: string | null;
    entries: Array<{ id: string; groupName: string; recipientNatakarId: number; recipientSnapshot: string; sharePercent: number }>;
  }>>({
    queryKey: ["pos-tip-distribution-profiles", companyId],
    queryFn: () => customFetch(`/api/companies/${companyId}/tip-distribution-profiles`),
    enabled: !!companyId,
    staleTime: 15_000,
  });
  const tipSettingsQuery = useQuery<{ employerControlledTipsEnabled: boolean }>({
    queryKey: ["pos-tip-settings", companyId],
    queryFn: () => customFetch<{ employerControlledTipsEnabled: boolean }>(`/api/companies/${companyId}/tip-settings`),
    enabled: !!companyId,
    staleTime: 15_000,
  });
  const updateTipSettings = useMutation({
    mutationFn: (enabled: boolean) => customFetch<{ employerControlledTipsEnabled: boolean }>(`/api/companies/${companyId}/tip-settings`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ employerControlledTipsEnabled: enabled }),
    }),
    onSuccess: result => {
      queryClient.setQueryData(["pos-tip-settings", companyId], result);
      setFormMessage({ type: "success", text: result.employerControlledTipsEnabled
        ? "Obvezni dodatek za storitev je omogočen za podjetje."
        : "Obvezni dodatek za storitev je onemogočen za nove politike." });
    },
    onError: error => setFormMessage({
      type: "error",
      text: error instanceof Error ? error.message : "Nastavitve ni bilo mogoče shraniti.",
    }),
  });
  const createProfile = useMutation({
    mutationFn: () => customFetch(`/api/companies/${companyId}/tip-distribution-profiles`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enotaId: selectedEnotaId,
        name: profileForm.name.trim(),
        effectiveFrom: profileForm.effectiveFrom,
        entries: profileForm.entries.map(entry => ({
          groupName: entry.groupName.trim(),
          recipientNatakarId: Number(entry.recipientNatakarId),
          sharePercent: Number(entry.sharePercent),
        })),
      }),
    }),
    onSuccess: async () => {
      setProfileForm(current => ({ ...current, name: "", entries: [{ groupName: "Vsi zaposleni", recipientNatakarId: "", sharePercent: "" }] }));
      await queryClient.invalidateQueries({ queryKey: ["pos-tip-distribution-profiles", companyId] });
      setFormMessage({ type: "success", text: "Profil delitve je shranjen." });
    },
    onError: error => setFormMessage({
      type: "error", text: error instanceof Error ? error.message : "Profila delitve ni bilo mogoče shraniti.",
    }),
  });

  const policiesQuery = useQuery<TipPolicy[]>({
    queryKey: ["pos-tip-policies", companyId],
    queryFn: () => customFetch<TipPolicy[]>(`/api/companies/${companyId}/tip-policies`),
    enabled: !!companyId,
    staleTime: 15_000,
  });
  const policies = (policiesQuery.data ?? []).filter(policy => policy.enotaId === selectedEnotaId);
  const activePolicy = policies.find(policy =>
    policy.effectiveFrom <= today && (policy.effectiveTo == null || policy.effectiveTo >= today)
  ) ?? null;

  const createPolicy = useMutation({
    mutationFn: () => customFetch<TipPolicy>(`/api/companies/${companyId}/tip-policies`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        enotaId: selectedEnotaId,
        effectiveFrom: form.effectiveFrom,
        mode: form.mode,
        evidenceType: form.evidenceType,
        evidenceReference: form.evidenceReference.trim(),
        agreementConfirmed: form.agreementConfirmed,
        cardFeeKind: form.cardFeeKind,
        cardFeeTreatment: form.mode === "employer_controlled" || form.cardFeeKind === "flat"
          ? "employer_expense"
          : form.cardFeeTreatment,
        cardFeePercent: form.cardFeeKind === "percentage" ? Number(form.cardFeePercent) : null,
        cardFeeFlatAmount: form.cardFeeKind === "flat" ? Number(form.cardFeeFlatAmount) : null,
        notes: form.notes.trim() || null,
      }),
    }),
    onSuccess: async () => {
      setForm(current => ({ ...current, evidenceReference: "", notes: "" }));
      setFormMessage({ type: "success", text: "Nova politika napitnin je uspešno uveljavljena." });
      await queryClient.invalidateQueries({ queryKey: ["pos-tip-policies", companyId] });
    },
    onError: error => {
      setFormMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Politike ni bilo mogoče shraniti.",
      });
    },
  });

  const handleApplyPolicy = () => {
    setFormMessage(null);
    if (selectedEnotaId == null) {
      setFormMessage({ type: "error", text: "Izberite poslovno enoto." });
      return;
    }
    if (!form.effectiveFrom) {
      setFormMessage({ type: "error", text: "Vnesite datum začetka veljavnosti." });
      return;
    }
    if (!form.evidenceReference.trim()) {
      setFormMessage({ type: "error", text: "Vnesite sklic na podlago, na primer naziv pravilnika in člen." });
      return;
    }
    if ((form.mode === "direct_employee" || form.mode === "independent_pool") && !form.agreementConfirmed) {
      setFormMessage({ type: "error", text: "Potrdite, da je dogovor z zaposlenimi dokumentiran." });
      return;
    }
    if (form.cardFeeKind === "percentage" && !(Number(form.cardFeePercent) > 0)) {
      setFormMessage({ type: "error", text: "Vnesite odstotek kartične provizije, večji od 0." });
      return;
    }
    if (form.cardFeeKind === "flat" && !(Number(form.cardFeeFlatAmount) > 0)) {
      setFormMessage({ type: "error", text: "Vnesite pavšalni znesek kartične provizije, večji od 0." });
      return;
    }
    createPolicy.mutate();
  };

  const handlePayrollExport = async () => {
    setFormMessage(null);
    if (!payrollRange.from || !payrollRange.to || payrollRange.from > payrollRange.to) {
      setFormMessage({ type: "error", text: "Izberite veljavno obdobje izvoza za plače." });
      return;
    }
    setPayrollExporting(true);
    try {
      const token = await getAuthToken();
      const response = await fetch(
        `/api/companies/${companyId}/tips-payroll/export?from=${payrollRange.from}&to=${payrollRange.to}`,
        { credentials: "include", headers: token ? { Authorization: `Bearer ${token}` } : undefined },
      );
      if (!response.ok) {
        const body = await response.json().catch(() => ({})) as { error?: string };
        throw new Error(body.error ?? `Izvoz ni uspel (HTTP ${response.status}).`);
      }
      const url = URL.createObjectURL(await response.blob());
      const link = document.createElement("a");
      link.href = url;
      link.download = `napitnine-place-${payrollRange.from}-${payrollRange.to}.csv`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      setFormMessage({ type: "success", text: "CSV za obračun plač je pripravljen." });
    } catch (error) {
      setFormMessage({
        type: "error",
        text: error instanceof Error ? error.message : "Izvoza za plače ni bilo mogoče pripraviti.",
      });
    } finally {
      setPayrollExporting(false);
    }
  };

  if (!companyId) {
    return <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>Podjetje ni izbrano.</AlertDescription></Alert>;
  }

  return (
    <div className="space-y-5 pb-6">
      <Card>
        <CardHeader>
          <CardTitle>Politika napitnin</CardTitle>
          <CardDescription>
            Izberite poslovno enoto in zanjo določite samostojno politiko napitnin.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-5">
          <div className="max-w-md space-y-1.5">
            <Label>Poslovna enota</Label>
            <Select
              value={selectedEnotaId != null ? String(selectedEnotaId) : undefined}
              onValueChange={value => setSelectedEnotaId(Number(value))}
            >
              <SelectTrigger><SelectValue placeholder="Izberite poslovno enoto" /></SelectTrigger>
              <SelectContent>
                {(user?.enote ?? []).map(enota => (
                  <SelectItem key={enota.id} value={String(enota.id)}>{enota.ime}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="rounded-lg border bg-muted/20 p-4">
            <label className="flex items-start gap-3 text-sm">
              <Checkbox
                checked={tipSettingsQuery.data?.employerControlledTipsEnabled === true}
                disabled={tipSettingsQuery.isLoading || updateTipSettings.isPending}
                onCheckedChange={checked => updateTipSettings.mutate(checked === true)}
              />
              <span>
                <strong>Omogoči obvezni dodatek za storitev</strong>
                <span className="mt-1 block text-muted-foreground">
                  Prihodki podjetja z DDV. Stare politike ostanejo berljive; brez tega soglasja novih politik ni mogoče ustvariti.
                </span>
              </span>
            </label>
          </div>
          <Card className="border-dashed">
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Profil delitve po zaposlenih</CardTitle>
              <CardDescription>
                Profil velja za izbrano enoto. Deleži morajo skupaj znašati 100%; ob izdaji računa se shrani nespremenljiv snapshot.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
                <Input placeholder="Naziv profila" value={profileForm.name} onChange={event => setProfileForm(v => ({ ...v, name: event.target.value }))} />
                <Input type="date" value={profileForm.effectiveFrom} onChange={event => setProfileForm(v => ({ ...v, effectiveFrom: event.target.value }))} />
                <div className="text-sm text-muted-foreground self-center">
                  Vsota: {profileForm.entries.reduce((sum, entry) => sum + (Number(entry.sharePercent) || 0), 0).toFixed(2)}%
                </div>
              </div>
              {profileForm.entries.map((entry, index) => (
                <div key={index} className="grid grid-cols-1 gap-2 md:grid-cols-[1fr_1.3fr_120px_auto]">
                  <Input placeholder="Skupina" value={entry.groupName} onChange={event => setProfileForm(v => ({
                    ...v, entries: v.entries.map((item, i) => i === index ? { ...item, groupName: event.target.value } : item),
                  }))} />
                  <Select value={entry.recipientNatakarId} onValueChange={value => setProfileForm(v => ({
                    ...v, entries: v.entries.map((item, i) => i === index ? { ...item, recipientNatakarId: value } : item),
                  }))}>
                    <SelectTrigger><SelectValue placeholder="Zaposleni" /></SelectTrigger>
                    <SelectContent>
                      {(natakari as Natakari[]).filter(n => n.aktiven).map(n => (
                        <SelectItem key={n.id} value={String(n.id)}>{n.ime} {n.priimek}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <Input type="number" min="0.0001" max="100" step="0.0001" placeholder="Delež %" value={entry.sharePercent} onChange={event => setProfileForm(v => ({
                    ...v, entries: v.entries.map((item, i) => i === index ? { ...item, sharePercent: event.target.value } : item),
                  }))} />
                  <Button variant="ghost" size="icon" disabled={profileForm.entries.length <= 1} onClick={() => setProfileForm(v => ({
                    ...v, entries: v.entries.filter((_, i) => i !== index),
                  }))}>×</Button>
                </div>
              ))}
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" size="sm" onClick={() => setProfileForm(v => ({
                  ...v, entries: [...v.entries, { groupName: "Vsi zaposleni", recipientNatakarId: "", sharePercent: "" }],
                }))}>Dodaj zaposlenega</Button>
                <Button
                  size="sm"
                  disabled={createProfile.isPending || selectedEnotaId == null || !profileForm.name.trim()
                    || Math.abs(profileForm.entries.reduce((sum, entry) => sum + (Number(entry.sharePercent) || 0), 0) - 100) > 0.0001
                    || profileForm.entries.some(entry => !entry.recipientNatakarId)}
                  onClick={() => createProfile.mutate()}
                >Shrani profil</Button>
              </div>
              {profilesQuery.data?.filter(profile => profile.enotaId === selectedEnotaId).map(profile => (
                <div key={profile.id} className="rounded border px-3 py-2 text-sm">
                  <strong>{profile.name}</strong> · {formatDatum(profile.effectiveFrom)} · {profile.entries.map(entry => `${entry.recipientSnapshot} ${entry.sharePercent}%`).join(", ")}
                </div>
              ))}
            </CardContent>
          </Card>

          {selectedEnotaId == null ? (
            <Alert variant="destructive"><AlertCircle className="h-4 w-4" /><AlertDescription>Izberite poslovno enoto.</AlertDescription></Alert>
          ) : (
          <>
          {activePolicy ? (
            <Alert>
              <CheckCircle2 className="h-4 w-4" />
              <AlertDescription>
                Trenutno velja: <strong>{modeLabels[activePolicy.mode]}</strong>, od {formatDatum(activePolicy.effectiveFrom)}.
              </AlertDescription>
            </Alert>
          ) : (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Za to POS enoto trenutno ni veljavne politike napitnin. Pozitivne QR napitnine zato niso dovoljene.</AlertDescription>
            </Alert>
          )}

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="space-y-1.5">
              <Label>Velja od *</Label>
              <Input type="date" value={form.effectiveFrom} onChange={event => setForm(v => ({ ...v, effectiveFrom: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Režim napitnin</Label>
              <Select value={form.mode} onValueChange={mode => setForm(v => ({ ...v, mode }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="direct_employee">Neposredno zaposlenemu</SelectItem>
                  <SelectItem value="independent_pool">Neodvisni sklad zaposlenih</SelectItem>
                   <SelectItem value="employer_controlled" disabled={tipSettingsQuery.data?.employerControlledTipsEnabled !== true}>
                     Obvezni dodatek za storitev — prihodek podjetja z DDV
                   </SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Podlaga</Label>
              <Select value={form.evidenceType} onValueChange={evidenceType => setForm(v => ({ ...v, evidenceType }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="employment_contract">Pogodba o zaposlitvi</SelectItem>
                  <SelectItem value="collective_agreement">Kolektivna pogodba</SelectItem>
                  <SelectItem value="internal_rule">Interni pravilnik</SelectItem>
                  <SelectItem value="other">Drugo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5 lg:col-span-2">
              <Label>Sklic na podlago *</Label>
              <Input value={form.evidenceReference} onChange={event => setForm(v => ({ ...v, evidenceReference: event.target.value }))} placeholder="npr. Pravilnik o napitninah, člen 4" />
            </div>
            <div className="space-y-1.5">
              <Label>Vrsta kartične provizije</Label>
              <Select value={form.cardFeeKind} onValueChange={cardFeeKind => setForm(v => ({ ...v, cardFeeKind }))}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Brez pripisane provizije</SelectItem>
                  <SelectItem value="percentage">Odstotek od napitnine</SelectItem>
                  <SelectItem value="flat">Pavšal na transakcijo</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {form.cardFeeKind !== "none" && (
              <div className="space-y-1.5">
                <Label>{form.cardFeeKind === "percentage" ? "Provizija (%)" : "Pavšal (€)"}</Label>
                <Input
                  type="number"
                  min="0"
                  step={form.cardFeeKind === "percentage" ? "0.0001" : "0.01"}
                  value={form.cardFeeKind === "percentage" ? form.cardFeePercent : form.cardFeeFlatAmount}
                  onChange={event => setForm(v => form.cardFeeKind === "percentage"
                    ? ({ ...v, cardFeePercent: event.target.value })
                    : ({ ...v, cardFeeFlatAmount: event.target.value }))}
                />
              </div>
            )}
            {form.cardFeeKind === "percentage" && form.mode !== "employer_controlled" && (
              <div className="space-y-1.5">
                <Label>Kdo nosi provizijo</Label>
                <Select value={form.cardFeeTreatment} onValueChange={cardFeeTreatment => setForm(v => ({ ...v, cardFeeTreatment }))}>
                  <SelectTrigger><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="employer_expense">Delodajalec</SelectItem>
                    <SelectItem value="deduct_from_tip">Zaposleni — odbitek od napitnine</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
            <div className="space-y-1.5 lg:col-span-3">
              <Label>Opomba</Label>
              <Textarea value={form.notes} onChange={event => setForm(v => ({ ...v, notes: event.target.value }))} rows={2} />
            </div>
            <label className="flex items-start gap-2 text-sm lg:col-span-3">
              <Checkbox checked={form.agreementConfirmed} onCheckedChange={checked => setForm(v => ({ ...v, agreementConfirmed: checked === true }))} />
              <span>Potrjujem, da je dogovor z zaposlenimi dokumentiran in se ujema z izbrano podlago.</span>
            </label>
          </div>

          {formMessage && (
            <Alert variant={formMessage.type === "error" ? "destructive" : "default"}>
              {formMessage.type === "error" ? <AlertCircle className="h-4 w-4" /> : <CheckCircle2 className="h-4 w-4" />}
              <AlertDescription>{formMessage.text}</AlertDescription>
            </Alert>
          )}
          <Button
            onClick={handleApplyPolicy}
            disabled={createPolicy.isPending}
          >
            {createPolicy.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Plus className="mr-2 h-4 w-4" />}
            Uveljavi novo politiko
          </Button>
          </>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>Zgodovina politik: {selectedEnota?.ime ?? "izberite enoto"}</CardTitle></CardHeader>
        <CardContent>
          {policiesQuery.isLoading ? <Loader2 className="h-5 w-5 animate-spin" /> : policies.length === 0 ? (
            <p className="text-sm text-muted-foreground">Za to enoto še ni vnesene politike.</p>
          ) : (
            <div className="space-y-2">
              {policies.map(policy => (
                <div key={policy.id} className="rounded-lg border p-3 text-sm">
                  <strong>{modeLabels[policy.mode]}</strong>
                  <p className="text-muted-foreground">
                    {formatDatum(policy.effectiveFrom)}–{policy.effectiveTo ? formatDatum(policy.effectiveTo) : "naprej"} · {policy.evidenceReference}
                  </p>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Izvoz napitnin za obračun plač</CardTitle>
          <CardDescription>
            CSV vsebuje dodelitve zaposlenim po poslovnem datumu računa. POS ne izračunava davkov in prispevkov.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid max-w-xl grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Od</Label>
              <Input type="date" value={payrollRange.from} onChange={event => setPayrollRange(value => ({ ...value, from: event.target.value }))} />
            </div>
            <div className="space-y-1.5">
              <Label>Do</Label>
              <Input type="date" value={payrollRange.to} onChange={event => setPayrollRange(value => ({ ...value, to: event.target.value }))} />
            </div>
          </div>
          <p className="text-sm text-muted-foreground">Obdobje: {formatDatum(payrollRange.from)}–{formatDatum(payrollRange.to)}</p>
          <Button variant="outline" onClick={handlePayrollExport} disabled={payrollExporting}>
            {payrollExporting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
            Prenesi CSV za plače
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}