import React, { useState, useMemo } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Search, Plus, Download, AlertCircle, Edit2, Play, Square, Loader2 } from "lucide-react";

import { useCompany } from "@/contexts/CompanyContext";
import {
  useListAccounts,
  useCreateAccount,
  useUpdateAccount,
  useSeedAccounts,
  getListAccountsQueryKey,
  type AccountRecord,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";

// Helpers
function buildTree(accounts: AccountRecord[]): (AccountRecord & { _depth: number })[] {
  const sorted = [...accounts].sort((a, b) => a.code.localeCompare(b.code));
  const result: (AccountRecord & { _depth: number })[] = [];
  const addWithChildren = (parentId: string | null, depth: number) => {
    sorted.filter(a => a.parentId === parentId).forEach(account => {
      (account as any)._depth = depth;
      result.push(account as any);
      addWithChildren(account.id, depth + 1);
    });
  };
  addWithChildren(null, 0);
  return result;
}

const TYPE_COLORS: Record<string, string> = {
  asset: "bg-blue-100 text-blue-800 hover:bg-blue-100",
  liability: "bg-red-100 text-red-800 hover:bg-red-100",
  equity: "bg-purple-100 text-purple-800 hover:bg-purple-100",
  revenue: "bg-green-100 text-green-800 hover:bg-green-100",
  expense: "bg-orange-100 text-orange-800 hover:bg-orange-100",
};

const TYPE_LABELS: Record<string, string> = {
  asset: "Sredstvo",
  liability: "Obveznost",
  equity: "Kapital",
  revenue: "Prihodek",
  expense: "Odhodek",
};

export default function KontniPlan() {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();

  const [search, setSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);
  
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<AccountRecord | null>(null);

  // Form state
  const [formData, setFormData] = useState({
    code: "",
    name: "",
    type: "asset",
    description: "",
    parentId: "none",
  });

  const { data, isLoading, error } = useListAccounts(
    activeCompany?.id ?? "",
    { includeInactive: true },
    { query: { enabled: !!activeCompany?.id } as any }
  );

  const createMut = useCreateAccount();
  const updateMut = useUpdateAccount();
  const seedMut = useSeedAccounts();

  const accounts = data?.accounts ?? [];

  const tree = useMemo(() => buildTree(accounts), [accounts]);
  
  const filteredTree = useMemo(() => {
    return tree.filter(acc => {
      if (!showInactive && !acc.isActive) return false;
      if (search) {
        const q = search.toLowerCase();
        return acc.code.toLowerCase().includes(q) || acc.name.toLowerCase().includes(q);
      }
      return true;
    });
  }, [tree, showInactive, search]);

  const handleSeed = () => {
    if (!activeCompany) return;
    seedMut.mutate({ companyId: activeCompany.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey(activeCompany.id) });
      }
    });
  };

  const handleOpenDialog = (acc?: AccountRecord) => {
    if (acc) {
      setEditingAccount(acc);
      setFormData({
        code: acc.code,
        name: acc.name,
        type: acc.type,
        description: acc.description || "",
        parentId: acc.parentId || "none",
      });
    } else {
      setEditingAccount(null);
      setFormData({
        code: "",
        name: "",
        type: "asset",
        description: "",
        parentId: "none",
      });
    }
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!activeCompany) return;
    const parentId = formData.parentId === "none" ? null : formData.parentId;
    
    if (editingAccount) {
      updateMut.mutate({
        companyId: activeCompany.id,
        id: editingAccount.id,
        data: {
          name: formData.name,
          description: formData.description || null,
          parentId,
        }
      }, {
        onSuccess: () => {
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey(activeCompany.id) });
        }
      });
    } else {
      createMut.mutate({
        companyId: activeCompany.id,
        data: {
          code: formData.code,
          name: formData.name,
          type: formData.type as any,
          description: formData.description || null,
          parentId,
        }
      }, {
        onSuccess: () => {
          setDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey(activeCompany.id) });
        }
      });
    }
  };

  const handleToggleStatus = (acc: AccountRecord) => {
    if (!activeCompany) return;
    if (acc.isActive && !window.confirm(`Ali res želite deaktivirati konto ${acc.code}?`)) return;

    updateMut.mutate({
      companyId: activeCompany.id,
      id: acc.id,
      data: { isActive: !acc.isActive }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: getListAccountsQueryKey(activeCompany.id) });
      }
    });
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Napaka</AlertTitle>
        <AlertDescription>Prišlo je do napake pri nalaganju kontnega plana.</AlertDescription>
      </Alert>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-4">
        <div className="flex justify-between items-center">
          <Skeleton className="h-10 w-48" />
          <Skeleton className="h-10 w-32" />
        </div>
        <Skeleton className="h-12 w-full" />
        <Skeleton className="h-[400px] w-full" />
      </div>
    );
  }

  const isEmpty = accounts.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Kontni plan</h1>
          <p className="text-muted-foreground mt-1">Upravljanje s sintetičnimi in analitičnimi konti</p>
        </div>
        <div className="flex items-center gap-2">
          {isEmpty && (
            <Button variant="outline" onClick={handleSeed} disabled={seedMut.isPending}>
              {seedMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              Uvozi standardni plan
            </Button>
          )}
          <Button onClick={() => handleOpenDialog()}>
            <Plus className="mr-2 h-4 w-4" />
            Dodaj konto
          </Button>
        </div>
      </div>

      {isEmpty ? (
        <div className="border border-dashed rounded-lg p-10 flex flex-col items-center justify-center text-center bg-card">
          <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <Download className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Vaš kontni plan je prazen</h2>
          <p className="text-muted-foreground max-w-md mb-6">
            Začnete lahko z ročnim dodajanjem kontov ali pa z enim klikom uvozite priporočen slovenski kontni plan (SRS).
          </p>
          <Button size="lg" onClick={handleSeed} disabled={seedMut.isPending}>
            {seedMut.isPending ? <Loader2 className="mr-2 h-5 w-5 animate-spin" /> : <Download className="mr-2 h-5 w-5" />}
            Uvozi standardni slovenski kontni plan
          </Button>
        </div>
      ) : (
        <>
          <div className="flex flex-col sm:flex-row justify-between items-center gap-4 bg-card p-4 rounded-lg border shadow-sm">
            <div className="relative w-full sm:w-96">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Išči po kodi ali imenu..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-9"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Switch
                id="show-inactive"
                checked={showInactive}
                onCheckedChange={setShowInactive}
              />
              <Label htmlFor="show-inactive">Prikaži neaktivne konte</Label>
            </div>
          </div>

          <div className="border rounded-lg bg-card overflow-hidden">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-[120px]">Koda</TableHead>
                  <TableHead>Ime konta</TableHead>
                  <TableHead className="w-[150px]">Tip</TableHead>
                  <TableHead className="w-[100px]">Status</TableHead>
                  <TableHead className="w-[100px] text-right">Dejanja</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredTree.length > 0 ? (
                  filteredTree.map(acc => {
                    const isRootClass = !acc.parentId && acc.code.length <= 2;
                    return (
                      <TableRow key={acc.id} className={!acc.isActive ? "opacity-60 bg-muted/20" : ""}>
                        <TableCell>
                          <span 
                            style={{ paddingLeft: `${acc._depth * 20}px` }}
                            className={isRootClass ? "font-bold text-foreground" : "font-medium"}
                          >
                            {acc.code}
                          </span>
                        </TableCell>
                        <TableCell className={isRootClass ? "font-semibold" : ""}>
                          {acc.name}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className={TYPE_COLORS[acc.type]}>
                            {TYPE_LABELS[acc.type]}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          {!acc.isActive && <Badge variant="outline" className="text-muted-foreground">Neaktivno</Badge>}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button variant="ghost" size="icon" className="h-8 w-8" onClick={() => handleOpenDialog(acc)}>
                              <Edit2 className="h-4 w-4" />
                            </Button>
                            <Button 
                              variant="ghost" 
                              size="icon" 
                              className="h-8 w-8" 
                              onClick={() => handleToggleStatus(acc)}
                              title={acc.isActive ? "Deaktiviraj" : "Aktiviraj"}
                            >
                              {acc.isActive ? <Square className="h-4 w-4 text-muted-foreground" /> : <Play className="h-4 w-4 text-primary" />}
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    );
                  })
                ) : (
                  <TableRow>
                    <TableCell colSpan={5} className="h-24 text-center text-muted-foreground">
                      Ni najdenih kontov.
                    </TableCell>
                  </TableRow>
                )}
              </TableBody>
            </Table>
          </div>
        </>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[500px]">
          <DialogHeader>
            <DialogTitle>{editingAccount ? "Uredi konto" : "Nov konto"}</DialogTitle>
            <DialogDescription>
              Vnesite podatke o kontu. Koda mora biti unikatna.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="code">Koda</Label>
              <Input 
                id="code" 
                value={formData.code} 
                onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                disabled={!!editingAccount}
                placeholder="Npr. 020"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="name">Ime konta</Label>
              <Input 
                id="name" 
                value={formData.name} 
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                placeholder="Npr. Zgradbe"
              />
            </div>
            <div className="grid gap-2">
              <Label htmlFor="type">Tip</Label>
              <Select value={formData.type} onValueChange={(val) => setFormData({ ...formData, type: val })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {Object.entries(TYPE_LABELS).map(([val, label]) => (
                    <SelectItem key={val} value={val}>{label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="parentId">Nadrejeni konto</Label>
              <Select value={formData.parentId} onValueChange={(val) => setFormData({ ...formData, parentId: val })}>
                <SelectTrigger>
                  <SelectValue placeholder="Brez nadrejenega konta" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">Brez nadrejenega (Razred)</SelectItem>
                  {tree.filter(a => a.id !== editingAccount?.id).map((acc) => (
                    <SelectItem key={acc.id} value={acc.id}>
                      {acc.code} - {acc.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="grid gap-2">
              <Label htmlFor="description">Opis (neobvezno)</Label>
              <Textarea 
                id="description" 
                value={formData.description} 
                onChange={(e) => setFormData({ ...formData, description: e.target.value })}
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Prekliči</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || updateMut.isPending || !formData.code || !formData.name}>
              {createMut.isPending || updateMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Shrani
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
