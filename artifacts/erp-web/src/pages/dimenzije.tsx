import React, { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, Loader2, AlertCircle, Edit2, Layers, FolderOpen, Building } from "lucide-react";

import { useCompany } from "@/contexts/CompanyContext";
import {
  useListCostCenters,
  useCreateCostCenter,
  useUpdateCostCenter,
  useListProjects,
  useCreateProject,
  useUpdateProject,
  useListDepartments,
  useCreateDepartment,
  useUpdateDepartment,
  getListCostCentersQueryKey,
  getListProjectsQueryKey,
  getListDepartmentsQueryKey,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Switch } from "@/components/ui/switch";

/** Skupni tip za vse dimenzionalne zapise */
type DimRecord = {
  id: string;
  companyId: string;
  code: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  createdAt: string | Date;
  updatedAt: string | Date;
};

interface DimFormState {
  code: string;
  name: string;
  description: string;
  isActive: boolean;
}

const emptyForm: DimFormState = { code: "", name: "", description: "", isActive: true };

interface DimTableProps<T extends DimRecord> {
  items: T[];
  isLoading: boolean;
  error: Error | null;
  onEdit: (item: T) => void;
  onNew: () => void;
  entityLabel: string;
}

function DimTable<T extends DimRecord>({ items, isLoading, error, onEdit, onNew, entityLabel }: DimTableProps<T>) {
  if (isLoading) return (
    <div className="space-y-2 p-4">
      {[...Array(3)].map((_, i) => <Skeleton key={i} className="h-10 w-full" />)}
    </div>
  );
  if (error) return (
    <Alert variant="destructive" className="m-4">
      <AlertCircle className="h-4 w-4" />
      <AlertTitle>Napaka</AlertTitle>
      <AlertDescription>{error.message}</AlertDescription>
    </Alert>
  );
  return (
    <div className="space-y-4">
      <div className="flex justify-end px-1">
        <Button size="sm" onClick={onNew}>
          <Plus className="mr-1 h-4 w-4" />
          Nov {entityLabel}
        </Button>
      </div>
      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Koda</TableHead>
            <TableHead>Naziv</TableHead>
            <TableHead>Opis</TableHead>
            <TableHead>Status</TableHead>
            <TableHead className="w-16" />
          </TableRow>
        </TableHeader>
        <TableBody>
          {items.length === 0 ? (
            <TableRow>
              <TableCell colSpan={5} className="text-center text-muted-foreground py-8">
                Ni vnosa. Dodajte prvi {entityLabel.toLowerCase()}.
              </TableCell>
            </TableRow>
          ) : (
            items.map((item) => (
              <TableRow key={item.id}>
                <TableCell className="font-mono font-medium">{item.code}</TableCell>
                <TableCell>{item.name}</TableCell>
                <TableCell className="text-muted-foreground text-sm">{item.description ?? "—"}</TableCell>
                <TableCell>
                  <Badge variant={item.isActive ? "default" : "outline"}>
                    {item.isActive ? "Aktivno" : "Neaktivno"}
                  </Badge>
                </TableCell>
                <TableCell>
                  <Button variant="ghost" size="icon" onClick={() => onEdit(item)}>
                    <Edit2 className="h-4 w-4" />
                  </Button>
                </TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

export default function Dimenzije() {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();
  const companyId = activeCompany?.id ?? "";

  // Cost Centers
  const { data: ccData, isLoading: ccLoading, error: ccError } = useListCostCenters(
    companyId, { includeInactive: true }, { query: { enabled: !!companyId } as any }
  );
  const createCC = useCreateCostCenter();
  const updateCC = useUpdateCostCenter();

  // Projects
  const { data: prData, isLoading: prLoading, error: prError } = useListProjects(
    companyId, { includeInactive: true }, { query: { enabled: !!companyId } as any }
  );
  const createPr = useCreateProject();
  const updatePr = useUpdateProject();

  // Departments
  const { data: dpData, isLoading: dpLoading, error: dpError } = useListDepartments(
    companyId, { includeInactive: true }, { query: { enabled: !!companyId } as any }
  );
  const createDp = useCreateDepartment();
  const updateDp = useUpdateDepartment();

  // Dialog state
  const [dialogOpen, setDialogOpen] = useState(false);
  const [dialogKind, setDialogKind] = useState<"costCenter" | "project" | "department">("costCenter");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [form, setForm] = useState<DimFormState>(emptyForm);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  function openNew(kind: "costCenter" | "project" | "department") {
    setDialogKind(kind);
    setEditingId(null);
    setForm(emptyForm);
    setSaveError(null);
    setDialogOpen(true);
  }

  function openEdit(kind: "costCenter" | "project" | "department", item: DimRecord) {
    setDialogKind(kind);
    setEditingId(item.id);
    setForm({
      code: item.code,
      name: item.name,
      description: item.description ?? "",
      isActive: item.isActive,
    });
    setSaveError(null);
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!companyId) return;
    setSaving(true);
    setSaveError(null);
    try {
      const body = {
        code: form.code,
        name: form.name,
        description: form.description || null,
      };
      const updateBody = {
        name: form.name,
        description: form.description || null,
        isActive: form.isActive,
      };

      if (dialogKind === "costCenter") {
        if (editingId) {
          await updateCC.mutateAsync({ companyId, id: editingId, data: updateBody });
          queryClient.invalidateQueries({ queryKey: getListCostCentersQueryKey(companyId) });
        } else {
          await createCC.mutateAsync({ companyId, data: body });
          queryClient.invalidateQueries({ queryKey: getListCostCentersQueryKey(companyId) });
        }
      } else if (dialogKind === "project") {
        if (editingId) {
          await updatePr.mutateAsync({ companyId, id: editingId, data: updateBody });
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey(companyId) });
        } else {
          await createPr.mutateAsync({ companyId, data: body });
          queryClient.invalidateQueries({ queryKey: getListProjectsQueryKey(companyId) });
        }
      } else {
        if (editingId) {
          await updateDp.mutateAsync({ companyId, id: editingId, data: updateBody });
          queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey(companyId) });
        } else {
          await createDp.mutateAsync({ companyId, data: body });
          queryClient.invalidateQueries({ queryKey: getListDepartmentsQueryKey(companyId) });
        }
      }
      setDialogOpen(false);
    } catch (e: any) {
      setSaveError(e?.message ?? "Napaka pri shranjevanju");
    } finally {
      setSaving(false);
    }
  }

  const kindLabel = {
    costCenter: "Stroškovno mesto",
    project: "Projekt",
    department: "Oddelek",
  }[dialogKind];

  return (
    <div className="space-y-6 p-6 max-w-5xl mx-auto">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dimenzije analitičnega računovodstva</h1>
        <p className="text-muted-foreground mt-1">
          Stroškovna mesta, projekti in oddelki za podrobnejše razporejanje knjižb na temeljnicah.
        </p>
      </div>

      {!companyId && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Ni izbranega podjetja</AlertTitle>
          <AlertDescription>Izberite podjetje za nadaljevanje.</AlertDescription>
        </Alert>
      )}

      <Tabs defaultValue="cost-centers">
        <TabsList>
          <TabsTrigger value="cost-centers" className="gap-2">
            <Layers className="h-4 w-4" /> Stroškovna mesta
          </TabsTrigger>
          <TabsTrigger value="projects" className="gap-2">
            <FolderOpen className="h-4 w-4" /> Projekti
          </TabsTrigger>
          <TabsTrigger value="departments" className="gap-2">
            <Building className="h-4 w-4" /> Oddelki
          </TabsTrigger>
        </TabsList>

        <TabsContent value="cost-centers" className="mt-4">
          <DimTable
            items={ccData?.costCenters ?? []}
            isLoading={ccLoading}
            error={ccError}
            onNew={() => openNew("costCenter")}
            onEdit={(item) => openEdit("costCenter", item)}
            entityLabel="Stroškovno mesto"
          />
        </TabsContent>
        <TabsContent value="projects" className="mt-4">
          <DimTable
            items={prData?.projects ?? []}
            isLoading={prLoading}
            error={prError}
            onNew={() => openNew("project")}
            onEdit={(item) => openEdit("project", item)}
            entityLabel="Projekt"
          />
        </TabsContent>
        <TabsContent value="departments" className="mt-4">
          <DimTable
            items={dpData?.departments ?? []}
            isLoading={dpLoading}
            error={dpError}
            onNew={() => openNew("department")}
            onEdit={(item) => openEdit("department", item)}
            entityLabel="Oddelek"
          />
        </TabsContent>
      </Tabs>

      {/* Create / Edit dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{editingId ? `Uredi ${kindLabel}` : `Nov ${kindLabel}`}</DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-2">
            {!editingId && (
              <div className="space-y-2">
                <Label>Koda <span className="text-destructive">*</span></Label>
                <Input
                  value={form.code}
                  onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))}
                  placeholder="npr. SM01, PR-2024-001"
                  maxLength={20}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label>Naziv <span className="text-destructive">*</span></Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="Naziv"
                maxLength={200}
              />
            </div>
            <div className="space-y-2">
              <Label>Opis</Label>
              <Textarea
                value={form.description}
                onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
                placeholder="Neobvezni opis"
                rows={2}
              />
            </div>
            {editingId && (
              <div className="flex items-center gap-3">
                <Switch
                  checked={form.isActive}
                  onCheckedChange={(v) => setForm((f) => ({ ...f, isActive: v }))}
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
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Prekliči</Button>
            <Button onClick={handleSave} disabled={saving || !form.code || !form.name}>
              {saving && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              {editingId ? "Shrani" : "Ustvari"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
