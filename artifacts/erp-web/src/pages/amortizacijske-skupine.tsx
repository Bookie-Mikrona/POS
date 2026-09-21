/**
 * amortizacijske-skupine.tsx — Šifrant amortizacijskih skupin (Faza 3a)
 *
 * CRUD za os_amortizacijske_skupine: koda, naziv, računovodska/davčna stopnja.
 * Davčna stopnja je ločena od računovodske — ob vnosu se privzeto nastavi na enako vrednost.
 * TODO: Prihodnja izboljšava — leto-verzioniranje stopenj (ista koda, različna stopnja po letih).
 */
import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, AlertCircle, Edit2, Layers } from "lucide-react";

import { useCompany } from "@/contexts/CompanyContext";
import {
  useListOsAmortizacijskeSkupine,
  useCreateOsSkupina,
  useUpdateOsSkupina,
  osAmortizacijskeSkupineQueryKey,
  type OsAmortizacijskaSkupina,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Switch } from "@/components/ui/switch";

interface FormState {
  koda: string;
  naziv: string;
  racunovodskaStonja: string;
  davcnaStonja: string;
  davcnaRocno: boolean; // true = davčna je bila ročno spremenjena
  aktivno: boolean;
  opomba: string;
}

const emptyForm: FormState = {
  koda: "",
  naziv: "",
  racunovodskaStonja: "",
  davcnaStonja: "",
  davcnaRocno: false,
  aktivno: true,
  opomba: "",
};

export default function AmortizacijskeSkupine() {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? "";

  const {
    data,
    isLoading,
    error,
  } = useListOsAmortizacijskeSkupine(
    companyId,
    { includeInactive: true },
    { query: { enabled: !!companyId } as any },
  );

  const createMut = useCreateOsSkupina(companyId);
  const updateMut = useUpdateOsSkupina(companyId);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<FormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function openNew() {
    setEditingId(null);
    setForm(emptyForm);
    setSaveError(null);
    setDialogOpen(true);
  }

  function openEdit(item: OsAmortizacijskaSkupina) {
    setEditingId(item.id);
    setForm({
      koda: item.koda,
      naziv: item.naziv,
      racunovodskaStonja: item.racunovodskaStonja,
      davcnaStonja: item.davcnaStonja,
      davcnaRocno: item.davcnaStonja !== item.racunovodskaStonja,
      aktivno: item.aktivno,
      opomba: item.opomba ?? "",
    });
    setSaveError(null);
    setDialogOpen(true);
  }

  function onRacunovodskaChange(val: string) {
    setForm((f) => ({
      ...f,
      racunovodskaStonja: val,
      // Če davčna ni bila ročno spremenjena, jo sinhroniziraj z računovodsko
      davcnaStonja: f.davcnaRocno ? f.davcnaStonja : val,
    }));
  }

  async function handleSave() {
    if (!companyId) return;
    setSaving(true);
    setSaveError(null);
    try {
      if (editingId) {
        await updateMut.mutateAsync({
          id: editingId,
          data: {
            naziv: form.naziv,
            racunovodskaStonja: form.racunovodskaStonja,
            davcnaStonja: form.davcnaStonja,
            aktivno: form.aktivno,
            opomba: form.opomba || null,
          },
        });
      } else {
        await createMut.mutateAsync({
          koda: form.koda,
          naziv: form.naziv,
          racunovodskaStonja: form.racunovodskaStonja,
          davcnaStonja: form.davcnaRocno ? form.davcnaStonja : undefined,
          aktivno: form.aktivno,
          opomba: form.opomba || null,
        });
      }
      queryClient.invalidateQueries({
        queryKey: osAmortizacijskeSkupineQueryKey(companyId),
      });
      setDialogOpen(false);
    } catch (e: any) {
      setSaveError(e?.message ?? "Napaka pri shranjevanju");
    } finally {
      setSaving(false);
    }
  }

  const skupiny = data?.amortizacijskeSkupine ?? [];

  const isValid =
    form.naziv.trim() &&
    form.racunovodskaStonja.trim() &&
    form.davcnaStonja.trim() &&
    (editingId || form.koda.trim());

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Layers className="h-6 w-6 text-muted-foreground" />
          Amortizacijske skupine
        </h1>
        <p className="text-muted-foreground mt-1">
          Šifrant amortizacijskih skupin za register osnovnih sredstev. Vsaka
          skupina nosi računovodsko in ločeno davčno letno stopnjo amortizacije.
        </p>
      </div>

      {!companyId && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Ni izbranega podjetja</AlertTitle>
          <AlertDescription>Izberite podjetje za nadaljevanje.</AlertDescription>
        </Alert>
      )}

      {isLoading ? (
        <div className="space-y-2">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-12 w-full" />
          ))}
        </div>
      ) : error ? (
        <Alert variant="destructive">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Napaka pri nalaganju</AlertTitle>
          <AlertDescription>{(error as Error).message}</AlertDescription>
        </Alert>
      ) : (
        <div className="space-y-4">
          <div className="flex justify-end">
            <Button size="sm" onClick={openNew} disabled={!companyId}>
              <Plus className="mr-1 h-4 w-4" />
              Nova skupina
            </Button>
          </div>

          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-32">Koda</TableHead>
                <TableHead>Naziv</TableHead>
                <TableHead className="w-36 text-right">Rač. stopnja %</TableHead>
                <TableHead className="w-36 text-right">Dav. stopnja %</TableHead>
                <TableHead className="w-24">Status</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {skupiny.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={6}
                    className="text-center text-muted-foreground py-10"
                  >
                    Ni amortizacijskih skupin. Dodajte prvo skupino.
                  </TableCell>
                </TableRow>
              ) : (
                skupiny.map((s) => (
                  <TableRow key={s.id}>
                    <TableCell className="font-mono font-semibold text-sm">
                      {s.koda}
                    </TableCell>
                    <TableCell>{s.naziv}</TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {parseFloat(s.racunovodskaStonja).toFixed(3)} %
                    </TableCell>
                    <TableCell className="text-right font-mono text-sm">
                      {parseFloat(s.davcnaStonja).toFixed(3)} %
                      {s.davcnaStonja !== s.racunovodskaStonja && (
                        <span className="ml-1 text-xs text-amber-600 font-normal">
                          (ločena)
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <Badge variant={s.aktivno ? "default" : "outline"}>
                        {s.aktivno ? "Aktivno" : "Neaktivno"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      <Button
                        variant="ghost"
                        size="icon"
                        onClick={() => openEdit(s)}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      )}

      {/* Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg">
          <DialogHeader>
            <DialogTitle>
              {editingId ? "Uredi amortizacijsko skupino" : "Nova amortizacijska skupina"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            {!editingId && (
              <div className="space-y-2">
                <Label>
                  Koda <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={form.koda}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, koda: e.target.value }))
                  }
                  placeholder="npr. 025., 050., 091.21"
                  maxLength={20}
                  className="font-mono"
                />
              </div>
            )}

            <div className="space-y-2">
              <Label>
                Naziv <span className="text-destructive">*</span>
              </Label>
              <Input
                value={form.naziv}
                onChange={(e) =>
                  setForm((f) => ({ ...f, naziv: e.target.value }))
                }
                placeholder="npr. Stavbe, Računalniška oprema, Vozila"
                maxLength={200}
              />
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>
                  Računovodska stopnja (% / leto){" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={form.racunovodskaStonja}
                  onChange={(e) => onRacunovodskaChange(e.target.value)}
                  placeholder="npr. 10.000"
                  className="font-mono"
                />
              </div>
              <div className="space-y-2">
                <Label>
                  Davčna stopnja (% / leto){" "}
                  <span className="text-destructive">*</span>
                </Label>
                <Input
                  value={form.davcnaStonja}
                  onChange={(e) =>
                    setForm((f) => ({
                      ...f,
                      davcnaStonja: e.target.value,
                      davcnaRocno: true,
                    }))
                  }
                  placeholder="npr. 10.000"
                  className="font-mono"
                />
                {!form.davcnaRocno && (
                  <p className="text-xs text-muted-foreground">
                    Privzeto enaka računovodski
                  </p>
                )}
                {form.davcnaRocno &&
                  form.davcnaStonja !== form.racunovodskaStonja && (
                    <p className="text-xs text-amber-600">
                      Davčna stopnja se razlikuje od računovodske
                    </p>
                  )}
              </div>
            </div>

            <div className="space-y-2">
              <Label>Opomba</Label>
              <Textarea
                value={form.opomba}
                onChange={(e) =>
                  setForm((f) => ({ ...f, opomba: e.target.value }))
                }
                placeholder="Neobvezna opomba (zakonska podlaga, vir stopnje ...)"
                rows={2}
              />
            </div>

            {editingId && (
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.aktivno}
                  onCheckedChange={(v) =>
                    setForm((f) => ({ ...f, aktivno: v }))
                  }
                />
                <Label>Aktivno</Label>
              </div>
            )}

            {saveError && (
              <Alert variant="destructive">
                <AlertCircle className="h-4 w-4" />
                <AlertDescription>{saveError}</AlertDescription>
              </Alert>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Prekliči
            </Button>
            <Button onClick={handleSave} disabled={saving || !isValid}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? "Shrani" : "Ustvari"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
