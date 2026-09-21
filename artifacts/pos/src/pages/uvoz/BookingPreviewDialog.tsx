import { useState, useEffect, useCallback } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Alert, AlertTitle, AlertDescription } from '@/components/ui/alert';
import { Loader2, AlertTriangle, CheckCircle, Info, RefreshCw, AlertCircle } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { posFetch } from '@/lib/pos-auth-headers';

interface BookingPreviewHeader {
  receiptId: number;
  receiptNumber: string;
  entryDate: string;
  documentDate: string;
  taxDate: string;
  receiptDate: string;
  description: string;
  reference: string;
  sourceType: string;
  createdBy: string;
}

interface BookingPreviewLine {
  accountId: string;
  accountCode: string;
  accountName: string;
  side: 'debit' | 'credit';
  amount: string | number;
  description?: string;
  partnerId?: string | null;
  costCenterId?: string | null;
  vatCodeId?: string | null;
  vatAmount?: string | number | null;
}

interface BookingPreviewIssue {
  code: string;
  message: string;
  context?: Record<string, unknown>;
}

interface BookingPreviewData {
  header: BookingPreviewHeader;
  lines: BookingPreviewLine[];
  debitTotal: string | number;
  creditTotal: string | number;
  netAmount: string | number;
  warnings: BookingPreviewIssue[];
  blockingErrors: BookingPreviewIssue[];
  previewHash: string;
  existing: {
    state: 'none' | 'draft' | 'posted';
    journalEntryId?: string | null;
  };
}

interface BookingPreviewDialogProps {
  receiptId: number | null;
  onClose: () => void;
  onConfirmed: () => void;
}

const formatMoney = (val: string | number | null | undefined) => {
  if (val == null || val === '') return '0,00';
  return Number(val).toLocaleString('sl-SI', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
};

export function BookingPreviewDialog({ receiptId, onClose, onConfirmed }: BookingPreviewDialogProps) {
  const [data, setData] = useState<BookingPreviewData | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const { toast } = useToast();
  
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');

  const fetchPreview = useCallback(async () => {
    if (!receiptId) return;
    setLoading(true);
    setError(null);
    try {
      const res = await posFetch(`${base}/api/prejemnice/${receiptId}/booking-preview`);
      if (!res.ok) {
        throw new Error(`Napaka pri nalaganju predogleda (status ${res.status})`);
      }
      const json = await res.json();
      setData(json);
    } catch (err) {
      setError((err as Error).message || 'Neznana napaka pri nalaganju predogleda.');
    } finally {
      setLoading(false);
    }
  }, [receiptId, base]);

  useEffect(() => {
    if (receiptId) {
      void fetchPreview();
    } else {
      setData(null);
      setError(null);
    }
  }, [receiptId, fetchPreview]);

  const handleConfirm = async () => {
    if (!receiptId || !data) return;
    setConfirming(true);
    try {
      const res = await posFetch(`${base}/api/prejemnice/${receiptId}/booking-draft`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ previewHash: data.previewHash }),
      });
      
      if (res.status === 409) {
        const conflict = await res.json().catch(() => null) as { code?: string } | null;
        toast({
          title: conflict?.code === 'POSTED_SOURCE' ? 'Temeljnica je že potrjena' : 'Predogled je zastarel',
          description: conflict?.code === 'POSTED_SOURCE'
            ? 'Podatki so bili osveženi. Potrjene temeljnice ni mogoče spreminjati.'
            : 'Podatki so bili osveženi, preverite in poskusite znova.',
          variant: 'destructive',
        });
        await fetchPreview();
        return;
      }
      
      const json = await res.json();
      
      if (res.status === 422) {
        // Blockers returned
        toast({
          title: 'Napaka pri knjiženju',
          description: 'Odkrite so bile napake.',
          variant: 'destructive',
        });
        setData(json);
        return;
      }
      
      if (!res.ok) {
        throw new Error(`Napaka pri ustvarjanju osnutka (status ${res.status})`);
      }
      
      toast({
        title: 'Osnutek ustvarjen',
        description: 'Knjižbe so bile uspešno pripravljene.',
      });
      onConfirmed();
    } catch (err) {
      toast({
        title: 'Napaka',
        description: (err as Error).message || 'Neznana napaka pri potrjevanju.',
        variant: 'destructive',
      });
    } finally {
      setConfirming(false);
    }
  };

  const open = receiptId !== null;

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-4xl max-h-[90vh] flex flex-col p-0">
        <DialogHeader className="px-6 pt-6 pb-2 border-b shrink-0">
          <DialogTitle>Predogled knjiženja</DialogTitle>
        </DialogHeader>
        
        <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
          {loading && !data && (
            <div className="flex justify-center items-center py-12">
              <Loader2 className="w-8 h-8 animate-spin text-muted-foreground" />
            </div>
          )}
          
          {error && (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Napaka pri nalaganju</AlertTitle>
              <AlertDescription className="space-y-3">
                <p>{error}</p>
                <Button variant="outline" size="sm" onClick={() => void fetchPreview()}>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Poskusi znova
                </Button>
              </AlertDescription>
            </Alert>
          )}
          
          {data && (
            <>
              {data.existing.state === 'posted' && (
                <Alert className="bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800">
                  <CheckCircle className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                  <AlertTitle>Že knjiženo</AlertTitle>
                  <AlertDescription>Ta prejemnica je že knjižena in potrjena v računovodstvu.</AlertDescription>
                </Alert>
              )}
              {data.existing.state === 'draft' && (
                <Alert>
                  <Info className="h-4 w-4" />
                  <AlertTitle>Osnutek že obstaja</AlertTitle>
                  <AlertDescription>Potrditev bo obstoječi osnutek varno posodobila z aktualnimi podatki.</AlertDescription>
                </Alert>
              )}
              
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 text-sm bg-muted/30 p-4 rounded-lg border">
                <div>
                  <div className="text-muted-foreground mb-1">Prejemnica</div>
                  <div className="font-medium">{data.header.receiptNumber || `ID: ${data.header.receiptId}`}</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Številka dokumenta</div>
                  <div className="font-medium">{data.header.reference || '—'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Datum dokumenta</div>
                  <div className="font-medium">{data.header.documentDate ? new Date(data.header.documentDate).toLocaleDateString('sl-SI') : '—'}</div>
                </div>
                <div>
                  <div className="text-muted-foreground mb-1">Znesek temeljnice</div>
                  <div className="font-medium">{formatMoney(data.debitTotal)} €</div>
                </div>
              </div>
              
              {data.blockingErrors.length > 0 && (
                <div className="space-y-2">
                  {data.blockingErrors.map((err, i) => (
                    <Alert key={i} variant="destructive">
                      <AlertCircle className="h-4 w-4" />
                      <AlertTitle>Kritična napaka</AlertTitle>
                      <AlertDescription>{err.message}</AlertDescription>
                    </Alert>
                  ))}
                </div>
              )}
              
              {data.warnings.length > 0 && (
                <div className="space-y-2">
                  {data.warnings.map((warn, i) => (
                    <Alert key={i} className="bg-amber-50 text-amber-900 border-amber-200 dark:bg-amber-950/30 dark:text-amber-400 dark:border-amber-800">
                      <AlertTriangle className="h-4 w-4 text-amber-600 dark:text-amber-500" />
                      <AlertTitle>Opozorilo</AlertTitle>
                      <AlertDescription>{warn.message}</AlertDescription>
                    </Alert>
                  ))}
                </div>
              )}

              <div>
                <h3 className="font-medium mb-3 text-sm flex items-center justify-between">
                  <span>Predlagane knjižbe</span>
                </h3>
                <div className="border rounded-md overflow-hidden">
                  <table className="w-full text-sm">
                    <thead className="bg-muted/50 text-muted-foreground">
                      <tr>
                        <th className="text-left px-3 py-2 font-medium">Konto</th>
                        <th className="text-left px-3 py-2 font-medium">Naziv</th>
                        <th className="text-right px-3 py-2 font-medium">Breme</th>
                        <th className="text-right px-3 py-2 font-medium">Dobro</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y">
                      {data.lines.length === 0 ? (
                        <tr>
                          <td colSpan={4} className="px-3 py-6 text-center text-muted-foreground">
                            Ni predlaganih vrstic.
                          </td>
                        </tr>
                      ) : (
                        data.lines.map((line, idx) => (
                          <tr key={idx} className="hover:bg-muted/30">
                            <td className="px-3 py-2 whitespace-nowrap font-medium">{line.accountCode}</td>
                            <td className="px-3 py-2">
                              <div className="text-foreground">{line.accountName}</div>
                              {line.description && (
                                <div className="text-xs text-muted-foreground">{line.description}</div>
                              )}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {line.side === 'debit' ? formatMoney(line.amount) : ''}
                            </td>
                            <td className="px-3 py-2 text-right">
                              {line.side === 'credit' ? formatMoney(line.amount) : ''}
                            </td>
                          </tr>
                        ))
                      )}
                    </tbody>
                    <tfoot className="bg-muted/20 font-medium">
                      <tr>
                        <td colSpan={2} className="px-3 py-2 text-right">Skupaj:</td>
                        <td className={`px-3 py-2 text-right ${data.debitTotal !== data.creditTotal ? 'text-destructive' : ''}`}>
                          {formatMoney(data.debitTotal)}
                        </td>
                        <td className={`px-3 py-2 text-right ${data.debitTotal !== data.creditTotal ? 'text-destructive' : ''}`}>
                          {formatMoney(data.creditTotal)}
                        </td>
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>
            </>
          )}
        </div>
        
        <DialogFooter className="px-6 py-4 border-t bg-muted/10 shrink-0">
          <Button variant="outline" onClick={onClose} disabled={confirming}>
            Zapri
          </Button>
          
          <Button 
            onClick={handleConfirm}
            disabled={
              confirming || 
              loading || 
              !data || 
              data.blockingErrors.length > 0 || 
              data.existing.state === 'posted'
            }
          >
            {confirming && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            {data?.existing.state === 'draft' ? 'Posodobi osnutek' : 'Ustvari osnutek'}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
