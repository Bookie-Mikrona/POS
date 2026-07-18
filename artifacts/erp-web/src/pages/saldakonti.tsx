import React, { useState } from "react";
import {
  BarChart3,
  AlertCircle,
  FileText,
  Search,
  Filter
} from "lucide-react";

import { useCompany } from "@/contexts/CompanyContext";
import {
  useGetOpenItems,
  useGetAgedAnalysis,
  useListCounterparties
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Skeleton } from "@/components/ui/skeleton";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

function getOverdueColor(days: number) {
  if (days <= 0) return "bg-green-100 text-green-800 border-green-200";
  if (days <= 30) return "bg-yellow-100 text-yellow-800 border-yellow-200";
  if (days <= 90) return "bg-orange-100 text-orange-800 border-orange-200";
  return "bg-red-100 text-red-800 border-red-200";
}

function getOverdueLabel(days: number) {
  if (days <= 0) return "V roku";
  if (days <= 30) return "1-30 dni";
  if (days <= 90) return "31-90 dni";
  return "90+ dni";
}

export default function Saldakonti() {
  const { activeCompany } = useCompany();

  const [activeTab, setActiveTab] = useState<string>("open");
  
  // Filters for Open Items
  const [openTypeFilter, setOpenTypeFilter] = useState<string>("issued");
  const [openCpFilter, setOpenCpFilter] = useState<string>("all");
  const [openAsOfDate, setOpenAsOfDate] = useState<string>(new Date().toISOString().split("T")[0]);

  // Filters for Aged Analysis
  const [agedTypeFilter, setAgedTypeFilter] = useState<string>("issued");
  const [agedAsOfDate, setAgedAsOfDate] = useState<string>(new Date().toISOString().split("T")[0]);

  const { data: counterpartiesData } = useListCounterparties(activeCompany?.id ?? "", {}, { query: { enabled: !!activeCompany?.id } as any });
  const counterparties = counterpartiesData?.counterparties ?? [];

  const { data: openItemsData, isLoading: openLoading, error: openError } = useGetOpenItems(
    activeCompany?.id ?? "",
    {
      type: openTypeFilter as any,
      counterpartyId: openCpFilter !== "all" ? openCpFilter : undefined,
      asOfDate: openAsOfDate || undefined
    },
    { query: { enabled: !!activeCompany?.id && activeTab === "open" } as any }
  );

  const { data: agedData, isLoading: agedLoading, error: agedError } = useGetAgedAnalysis(
    activeCompany?.id ?? "",
    {
      type: agedTypeFilter as any,
      asOfDate: agedAsOfDate || undefined
    },
    { query: { enabled: !!activeCompany?.id && activeTab === "aged" } as any }
  );

  const openItems = openItemsData?.items ?? [];
  const totalRemaining = openItemsData?.totalRemaining ?? "0";

  const agedRows = agedData?.rows ?? [];
  const agedTotals = agedData?.totals;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold tracking-tight">Saldakonti</h1>
        <p className="text-muted-foreground mt-1">Odprte postavke in starostna analiza terjatev ter obveznosti.</p>
      </div>

      <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
        <TabsList className="mb-4">
          <TabsTrigger value="open">Odprte postavke</TabsTrigger>
          <TabsTrigger value="aged">Starostna analiza</TabsTrigger>
        </TabsList>

        <TabsContent value="open" className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 items-end sm:items-center bg-card p-4 rounded-lg border shadow-sm">
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 w-full">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Tip postavk</Label>
                <Select value={openTypeFilter} onValueChange={setOpenTypeFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="issued">Terjatve (Izdani računi)</SelectItem>
                    <SelectItem value="received">Obveznosti (Prejeti računi)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Partner</Label>
                <Select value={openCpFilter} onValueChange={setOpenCpFilter}>
                  <SelectTrigger>
                    <SelectValue placeholder="Vsi partnerji" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">Vsi partnerji</SelectItem>
                    {counterparties.map(c => (
                      <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Na dan</Label>
                <Input type="date" value={openAsOfDate} onChange={e => setOpenAsOfDate(e.target.value)} />
              </div>
            </div>
          </div>

          {openError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Napaka</AlertTitle>
              <AlertDescription>Prišlo je do napake pri nalaganju odprtih postavk.</AlertDescription>
            </Alert>
          ) : openLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-[400px] w-full" />
            </div>
          ) : openItems.length === 0 ? (
            <div className="border border-dashed rounded-lg p-10 flex flex-col items-center justify-center text-center bg-card">
              <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <FileText className="h-8 w-8 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-semibold mb-2">Ni odprtih postavk</h2>
              <p className="text-muted-foreground max-w-md">
                Za izbrane filtre ni odprtih postavk na izbrani dan.
              </p>
            </div>
          ) : (
            <div className="border rounded-lg bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead>Račun</TableHead>
                    <TableHead>Datum računa</TableHead>
                    <TableHead>Rok plačila</TableHead>
                    <TableHead className="text-right">Skupaj</TableHead>
                    <TableHead className="text-right">Poravnano</TableHead>
                    <TableHead className="text-right text-primary font-semibold">Preostalo</TableHead>
                    <TableHead className="w-[120px]">Zamuda</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {openItems.map((item, idx) => (
                    <TableRow key={`${item.invoiceId}-${idx}`}>
                      <TableCell className="font-medium">{item.counterpartyName}</TableCell>
                      <TableCell>{item.invoiceNumber}</TableCell>
                      <TableCell>{new Date(item.invoiceDate).toLocaleDateString("sl-SI")}</TableCell>
                      <TableCell>{item.dueDate ? new Date(item.dueDate).toLocaleDateString("sl-SI") : "-"}</TableCell>
                      <TableCell className="text-right">{parseFloat(item.totalGross).toFixed(2)}</TableCell>
                      <TableCell className="text-right text-muted-foreground">{parseFloat(item.allocatedAmount).toFixed(2)}</TableCell>
                      <TableCell className="text-right font-medium">{parseFloat(item.remainingAmount).toFixed(2)}</TableCell>
                      <TableCell>
                        <Badge variant="outline" className={getOverdueColor(item.daysOverdue)}>
                          {getOverdueLabel(item.daysOverdue)}
                        </Badge>
                      </TableCell>
                    </TableRow>
                  ))}
                  <TableRow className="bg-muted/50 font-bold hover:bg-muted/50">
                    <TableCell colSpan={6} className="text-right">Skupaj preostalo:</TableCell>
                    <TableCell className="text-right text-primary">{parseFloat(totalRemaining).toFixed(2)}</TableCell>
                    <TableCell></TableCell>
                  </TableRow>
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>

        <TabsContent value="aged" className="space-y-4">
          <div className="flex flex-col sm:flex-row gap-4 items-end sm:items-center bg-card p-4 rounded-lg border shadow-sm">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 w-full sm:w-[500px]">
              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Tip analize</Label>
                <Select value={agedTypeFilter} onValueChange={setAgedTypeFilter}>
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="issued">Terjatve do kupcev</SelectItem>
                    <SelectItem value="received">Obveznosti do dobaviteljev</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label className="text-xs font-medium text-muted-foreground">Na dan</Label>
                <Input type="date" value={agedAsOfDate} onChange={e => setAgedAsOfDate(e.target.value)} />
              </div>
            </div>
          </div>

          {agedError ? (
            <Alert variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertTitle>Napaka</AlertTitle>
              <AlertDescription>Prišlo je do napake pri nalaganju starostne analize.</AlertDescription>
            </Alert>
          ) : agedLoading ? (
            <div className="space-y-4">
              <Skeleton className="h-[400px] w-full" />
            </div>
          ) : agedRows.length === 0 ? (
            <div className="border border-dashed rounded-lg p-10 flex flex-col items-center justify-center text-center bg-card">
              <div className="h-16 w-16 bg-muted rounded-full flex items-center justify-center mb-4">
                <BarChart3 className="h-8 w-8 text-muted-foreground" />
              </div>
              <h2 className="text-xl font-semibold mb-2">Ni podatkov za analizo</h2>
              <p className="text-muted-foreground max-w-md">
                Za izbrane filtre ni odprtih postavk za izračun starostne analize.
              </p>
            </div>
          ) : (
            <div className="border rounded-lg bg-card overflow-hidden">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Partner</TableHead>
                    <TableHead className="text-right">V roku</TableHead>
                    <TableHead className="text-right">1-30 dni</TableHead>
                    <TableHead className="text-right">31-60 dni</TableHead>
                    <TableHead className="text-right">61-90 dni</TableHead>
                    <TableHead className="text-right text-red-600">90+ dni</TableHead>
                    <TableHead className="text-right font-bold">Skupaj</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {agedRows.map((row, idx) => (
                    <TableRow key={`${row.counterpartyId}-${idx}`}>
                      <TableCell className="font-medium">{row.counterpartyName}</TableCell>
                      <TableCell className="text-right">{parseFloat(row.current).toFixed(2)}</TableCell>
                      <TableCell className="text-right">{parseFloat(row.bucket1to30).toFixed(2)}</TableCell>
                      <TableCell className="text-right">{parseFloat(row.bucket31to60).toFixed(2)}</TableCell>
                      <TableCell className="text-right">{parseFloat(row.bucket61to90).toFixed(2)}</TableCell>
                      <TableCell className="text-right text-red-600 font-medium">{parseFloat(row.bucketOver90).toFixed(2)}</TableCell>
                      <TableCell className="text-right font-bold">{parseFloat(row.total).toFixed(2)}</TableCell>
                    </TableRow>
                  ))}
                  {agedTotals && (
                    <TableRow className="bg-muted/50 font-bold hover:bg-muted/50">
                      <TableCell>SKUPAJ</TableCell>
                      <TableCell className="text-right">{parseFloat(agedTotals.current).toFixed(2)}</TableCell>
                      <TableCell className="text-right">{parseFloat(agedTotals.bucket1to30).toFixed(2)}</TableCell>
                      <TableCell className="text-right">{parseFloat(agedTotals.bucket31to60).toFixed(2)}</TableCell>
                      <TableCell className="text-right">{parseFloat(agedTotals.bucket61to90).toFixed(2)}</TableCell>
                      <TableCell className="text-right text-red-600">{parseFloat(agedTotals.bucketOver90).toFixed(2)}</TableCell>
                      <TableCell className="text-right text-primary">{parseFloat(agedTotals.total).toFixed(2)}</TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
