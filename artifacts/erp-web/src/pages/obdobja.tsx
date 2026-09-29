import React, { useState } from "react";
import { useF2Save } from "@/hooks/useF2Save";
import { useQueryClient } from "@tanstack/react-query";
import { Plus, AlertCircle, Calendar as CalendarIcon, Lock, Unlock, Loader2, BookOpen } from "lucide-react";

import { useCompany } from "@/contexts/CompanyContext";
import {
  useListPeriods,
  useCreatePeriod,
  useUpdatePeriod,
  getListPeriodsQueryKey,
  getListJournalEntriesQueryKey,
  getPreviewAnnualOpeningQueryKey,
  usePreviewAnnualOpening,
  usePrepareAnnualOpening,
  type PeriodRecord
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Card, CardContent } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export default function Obdobja() {
  const { activeCompany } = useCompany();
  const queryClient = useQueryClient();

  const [dialogOpen, setDialogOpen] = useState(false);
  const [lockingPeriod, setLockingPeriod] = useState<PeriodRecord | null>(null);
  const [openingPeriod, setOpeningPeriod] = useState<PeriodRecord | null>(null);

  const currentYear = new Date().getFullYear();
  const [formData, setFormData] = useState({
    name: `Poslovno leto ${currentYear}`,
    startDate: `${currentYear}-01-01`,
    endDate: `${currentYear}-12-31`,
  });

  const { data, isLoading, error } = useListPeriods(
    activeCompany?.id ?? "",
    { query: { enabled: !!activeCompany?.id } as any }
  );

  const createMut = useCreatePeriod();
  const updateMut = useUpdatePeriod();
  const prepareOpeningMut = usePrepareAnnualOpening();
  const { data: opening, isLoading: openingLoading, error: openingError } = usePreviewAnnualOpening(
    activeCompany?.id ?? "",
    openingPeriod?.id ?? "",
    { query: { enabled: !!activeCompany?.id && !!openingPeriod?.id, staleTime: 0 } as any },
  );

  const periods = data?.periods ?? [];
  const isOwner = activeCompany?.role === "owner";

  const handleOpenDialog = () => {
    setFormData({
      name: `Poslovno leto ${currentYear}`,
      startDate: `${currentYear}-01-01`,
      endDate: `${currentYear}-12-31`,
    });
    setDialogOpen(true);
  };

  const handleSave = () => {
    if (!activeCompany) return;
    createMut.mutate({
      companyId: activeCompany.id,
      data: {
        name: formData.name,
        startDate: formData.startDate,
        endDate: formData.endDate,
      }
    }, {
      onSuccess: () => {
        setDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: getListPeriodsQueryKey(activeCompany.id) });
      }
    });
  };
  useF2Save(handleSave, !createMut.isPending && !!formData.name && !!formData.startDate && !!formData.endDate);

  const handleToggleLock = (period: PeriodRecord) => {
    if (!activeCompany) return;
    const newStatus = period.status === "open" ? "locked" : "open";
    updateMut.mutate({
      companyId: activeCompany.id,
      id: period.id,
      data: { status: newStatus }
    }, {
      onSuccess: () => {
        setLockingPeriod(null);
        queryClient.invalidateQueries({ queryKey: getListPeriodsQueryKey(activeCompany.id) });
      }
    });
  };

  const handlePrepareOpening = () => {
    if (!activeCompany || !openingPeriod) return;
    prepareOpeningMut.mutate({ companyId: activeCompany.id, id: openingPeriod.id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({
          queryKey: getPreviewAnnualOpeningQueryKey(activeCompany.id, openingPeriod.id),
        });
        queryClient.invalidateQueries({ queryKey: getListJournalEntriesQueryKey(activeCompany.id) });
      },
    });
  };

  const formatDate = (dateStr: string) => {
    try {
      const d = new Date(dateStr);
      return new Intl.DateTimeFormat('sl-SI').format(d);
    } catch {
      return dateStr;
    }
  };

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Napaka</AlertTitle>
        <AlertDescription>Prišlo je do napake pri nalaganju obdobij.</AlertDescription>
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
        <Skeleton className="h-[300px] w-full" />
      </div>
    );
  }

  const isEmpty = periods.length === 0;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold tracking-tight">Računovodska obdobja</h1>
          <p className="text-muted-foreground mt-1">Upravljanje poslovnih let in zaklepanje knjiženja</p>
        </div>
        <Button onClick={handleOpenDialog}>
          <Plus className="mr-2 h-4 w-4" />
          Novo obdobje
        </Button>
      </div>

      {isEmpty ? (
        <div className="border border-dashed rounded-lg p-10 flex flex-col items-center justify-center text-center bg-card">
          <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-4">
            <CalendarIcon className="h-8 w-8 text-muted-foreground" />
          </div>
          <h2 className="text-xl font-semibold mb-2">Ni računovodskih obdobij</h2>
          <p className="text-muted-foreground max-w-md mb-6">
            Za začetek knjiženja morate ustvariti vsaj eno računovodsko obdobje (npr. poslovno leto).
          </p>
          <Button size="lg" onClick={handleOpenDialog}>
            <Plus className="mr-2 h-5 w-5" />
            Ustvari prvo obdobje
          </Button>
        </div>
      ) : (
        <Card>
          <ScrollArea className="h-[500px]">
            <CardContent className="p-0">
              <div className="divide-y">
                {periods.map(period => (
                  <div key={period.id} className="p-4 sm:px-6 py-5 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 hover:bg-muted/30 transition-colors">
                    <div className="flex items-start gap-4">
                      <div className={`mt-1 h-10 w-10 rounded-full flex items-center justify-center shrink-0 ${period.status === 'locked' ? 'bg-muted text-muted-foreground' : 'bg-primary/10 text-primary'}`}>
                        {period.status === 'locked' ? <Lock className="h-5 w-5" /> : <CalendarIcon className="h-5 w-5" />}
                      </div>
                      <div>
                        <h3 className="font-semibold text-lg">{period.name}</h3>
                        <p className="text-sm text-muted-foreground mt-1">
                          {formatDate(period.startDate)} – {formatDate(period.endDate)}
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end">
                      {period.status === 'open' ? (
                        <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-green-200">Odprto</Badge>
                      ) : (
                        <Badge variant="secondary" className="text-muted-foreground">Zaklenjeno</Badge>
                      )}
                      
                      {isOwner && (
                        <Button 
                          variant={period.status === 'open' ? 'outline' : 'secondary'} 
                          size="sm"
                          className={period.status === 'open' ? 'text-destructive border-destructive/30 hover:bg-destructive/10 hover:text-destructive' : ''}
                          onClick={() => setLockingPeriod(period)}
                        >
                          {period.status === 'open' ? (
                            <><Lock className="h-3.5 w-3.5 mr-1.5" /> Zakleni</>
                          ) : (
                            <><Unlock className="h-3.5 w-3.5 mr-1.5" /> Odkleni</>
                          )}
                         </Button>
                       )}
                       {period.status === "open" && activeCompany?.role !== "viewer" && periods.some((previous) => {
                         const previousYear = Number(period.startDate.slice(0, 4)) - 1;
                         return previous.status === "locked"
                           && previous.startDate === `${previousYear}-01-01`
                           && previous.endDate === `${previousYear}-12-31`;
                       }) && (
                         <Button variant="outline" size="sm" onClick={() => {
                           prepareOpeningMut.reset();
                           setOpeningPeriod(period);
                         }}>
                           <BookOpen className="h-3.5 w-3.5 mr-1.5" /> Otvoritev
                         </Button>
                       )}
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </ScrollArea>
        </Card>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-[425px]">
          <DialogHeader>
            <DialogTitle>Novo računovodsko obdobje</DialogTitle>
            <DialogDescription>
              Ustvarite novo obdobje za knjiženje. Obdobja se ne smejo prekrivati.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid gap-2">
              <Label htmlFor="name">Naziv obdobja</Label>
              <Input 
                id="name" 
                value={formData.name} 
                onChange={(e) => setFormData({ ...formData, name: e.target.value })}
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="grid gap-2">
                <Label htmlFor="startDate">Datum začetka</Label>
                <Input 
                  id="startDate" 
                  type="date"
                  value={formData.startDate} 
                  onChange={(e) => setFormData({ ...formData, startDate: e.target.value })}
                />
              </div>
              <div className="grid gap-2">
                <Label htmlFor="endDate">Datum konca</Label>
                <Input 
                  id="endDate" 
                  type="date"
                  value={formData.endDate} 
                  onChange={(e) => setFormData({ ...formData, endDate: e.target.value })}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)}>Prekliči</Button>
            <Button onClick={handleSave} disabled={createMut.isPending || !formData.name || !formData.startDate || !formData.endDate}>
              {createMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              Shrani <kbd className="ml-1 text-[10px] font-mono opacity-60 border border-current/40 rounded px-0.5 leading-none">F2</kbd>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!openingPeriod} onOpenChange={(open) => !open && setOpeningPeriod(null)}>
        <DialogContent className="sm:max-w-[680px] max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Letna otvoritev {openingPeriod?.startDate.slice(0, 4)}</DialogTitle>
            <DialogDescription>
              Prenos bilančnih saldov iz zaklenjenega prejšnjega leta. Računi in plačila se ne kopirajo.
              Priprava ustvari samo osnutek; knjiženje je ločen korak.
            </DialogDescription>
          </DialogHeader>
          {openingLoading && <p className="text-sm text-muted-foreground">Preverjam zaključne salde …</p>}
          {openingError && <Alert variant="destructive"><AlertDescription>
            {openingError.message || "Predogleda otvoritve ni mogoče naložiti."}
          </AlertDescription></Alert>}
          {opening && (
            <div className="space-y-4 text-sm">
              <p><strong>{opening.reference}</strong> · {opening.lines.length} vrstic · breme {opening.debit} € · dobro {opening.credit} €</p>
              {opening.conflict && <Alert variant="destructive"><AlertDescription>
                V tem letu obstaja druga otvoritev. Ustvarjanje nove je blokirano.
              </AlertDescription></Alert>}
              {opening.entryId && !opening.conflict && <Alert><AlertDescription>
                Otvoritev že obstaja ({opening.entryStatus === "draft" ? "osnutek" : "knjižena"}).
                Ponovno ustvarjanje ni potrebno.
              </AlertDescription></Alert>}
              {opening.reconciliation.length > 0 && (
                <div>
                  <h4 className="font-semibold mb-2">Kontrola saldakontov 120/220 na dan 31. 12.</h4>
                  <div className="rounded-md border divide-y">
                    {opening.reconciliation.map((item) => (
                      <div key={item.code} className="px-3 py-2 flex flex-wrap justify-between gap-x-4">
                        <span className="font-medium">{item.code}</span>
                        <span>GK: {item.generalLedger} € · odprte postavke: {item.openItems} €</span>
                        <span className={item.matched ? "text-green-700" : "text-destructive"}>
                          {item.matched ? "Usklajeno" : `Razlika: ${item.difference} €${item.evidenceComplete ? "" : " (manjkajo dokazila)"}`}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
              {!opening.reconciled && <Alert variant="destructive"><AlertDescription>
                Osnutek lahko pripravite, knjiženje pa bo zadržano, dokler odprte postavke niso usklajene z GK.
                Partnerjev ne dodajajte na pamet.
              </AlertDescription></Alert>}
              <details>
                <summary className="cursor-pointer font-medium">Vseh {opening.lines.length} vrstic otvoritve</summary>
                <div className="mt-2 max-h-48 overflow-y-auto divide-y rounded border">
                  {opening.lines.map((line) => (
                    <div key={line.accountId} className="p-2 flex justify-between gap-4">
                      <span>{line.code} · {line.name}</span>
                      <span className="whitespace-nowrap">{line.side === "debit" ? "Breme" : "Dobro"} {line.amount} €</span>
                    </div>
                  ))}
                </div>
              </details>
            </div>
          )}
          {prepareOpeningMut.isError && <Alert variant="destructive"><AlertDescription>
            {prepareOpeningMut.error.message || "Osnutka ni bilo mogoče pripraviti."}
          </AlertDescription></Alert>}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpeningPeriod(null)}>Zapri</Button>
            <Button onClick={handlePrepareOpening}
              disabled={!opening || opening.conflict || !!opening.entryId || prepareOpeningMut.isPending}>
              {prepareOpeningMut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
              Pripravi osnutek
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <AlertDialog open={!!lockingPeriod} onOpenChange={(open) => !open && setLockingPeriod(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {lockingPeriod?.status === "open" ? "Zaklepanje obdobja" : "Odklepanje obdobja"}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {lockingPeriod?.status === "open" 
                ? "Ali ste prepričani, da želite zakleniti to obdobje? Knjiženje novih temeljnic in urejanje obstoječih v tem obdobju ne bo več mogoče." 
                : "Ali ste prepričani, da želite odkleniti to obdobje? Ponovno bo omogočeno knjiženje in urejanje temeljnic."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Prekliči</AlertDialogCancel>
            <AlertDialogAction 
              onClick={() => lockingPeriod && handleToggleLock(lockingPeriod)}
              className={lockingPeriod?.status === "open" ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            >
              {updateMut.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
              {lockingPeriod?.status === "open" ? "Da, zakleni" : "Da, odkleni"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
