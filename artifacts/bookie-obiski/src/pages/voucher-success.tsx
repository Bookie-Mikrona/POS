import React, { useEffect, useState } from 'react';
import { useParams, Link } from 'wouter';
import { useGetJavniBonCheckout, useGetJavnaRestavracija, getGetJavniBonCheckoutQueryKey } from '@workspace/api-client-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { CheckCircle2, Clock, XCircle, ChevronLeft } from 'lucide-react';

export default function VoucherSuccess() {
  const { slug } = useParams<{ slug: string }>();
  
  // Extract session_id from URL query params
  const [sessionId, setSessionId] = useState<string | null>(null);
  
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const sid = params.get('session_id');
    if (sid) setSessionId(sid);
  }, []);

  const { data: restaurant, isLoading: isLoadingRest } = useGetJavnaRestavracija(slug);
  
  const { 
    data: checkout, 
    isLoading: isLoadingCheckout, 
    error 
  } = useGetJavniBonCheckout(slug, sessionId || '', {
    query: {
      queryKey: getGetJavniBonCheckoutQueryKey(slug, sessionId || ''),
      enabled: !!sessionId,
      refetchInterval: (query) => query.state.data?.deliveryStatus === 'sent' ? false : 5_000
    }
  });

  if (!sessionId) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
        <h1 className="text-2xl font-serif text-foreground mb-4">Neveljavna povezava</h1>
        <Link href={`/${slug}`} className="text-primary hover:underline flex items-center gap-2">
          <ChevronLeft className="w-4 h-4" /> Nazaj na restavracijo
        </Link>
      </div>
    );
  }

  if (isLoadingRest || isLoadingCheckout) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <Skeleton className="w-20 h-20 rounded-full mb-8" />
        <Skeleton className="h-10 w-64 mb-4" />
        <Skeleton className="h-6 w-96 mb-8" />
        <Skeleton className="h-48 w-full max-w-md rounded-xl" />
      </div>
    );
  }

  if (error || !checkout || !restaurant) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
        <XCircle className="w-16 h-16 text-destructive mb-4" />
        <h1 className="text-2xl font-serif text-foreground mb-4">Plačilo ni bilo najdeno</h1>
        <p className="text-muted-foreground mb-8">Ne najdemo podatkov o tem plačilu.</p>
        <Link href={`/${slug}`} className="inline-flex h-10 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground hover:bg-primary/90">
          Nazaj na restavracijo
        </Link>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background py-16 px-4">
      <div className="max-w-md mx-auto">
        <Card className="border-card-border shadow-md overflow-hidden text-center">
          {checkout.status === 'complete' && (
            <>
              <div className="bg-primary/5 py-12 px-6 border-b border-border">
                <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <CheckCircle2 className="w-10 h-10 text-primary" />
                </div>
                <h1 className="text-3xl font-serif mb-4 text-foreground">Hvala za nakup!</h1>
                <p className="text-muted-foreground">
                  {checkout.deliveryStatus === 'sent'
                    ? 'Plačilo je bilo uspešno izvedeno. Darilni bon je bil poslan na vaš e-poštni naslov.'
                    : checkout.deliveryStatus === 'failed'
                      ? 'Plačilo je bilo uspešno izvedeno. Pri pošiljanju je prišlo do začasne napake, zato bomo dostavo samodejno ponovili.'
                      : 'Plačilo je bilo uspešno izvedeno. Darilni bon pripravljamo za pošiljanje na vaš e-poštni naslov.'}
                </p>
              </div>
            </>
          )}

          {checkout.status === 'open' && (
            <>
              <div className="bg-muted py-12 px-6 border-b border-border">
                <div className="w-20 h-20 bg-muted-foreground/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <Clock className="w-10 h-10 text-muted-foreground" />
                </div>
                <h1 className="text-3xl font-serif mb-4 text-foreground">Čakamo na plačilo</h1>
                <p className="text-muted-foreground mb-6">
                  Plačilo še ni bilo do konca izvedeno ali procesirano.
                </p>
                <Button asChild variant="outline">
                  <a href={checkout.checkoutUrl || '#'}>Nadaljuj s plačilom</a>
                </Button>
              </div>
            </>
          )}

          {checkout.status === 'expired' && (
            <>
              <div className="bg-destructive/5 py-12 px-6 border-b border-border">
                <div className="w-20 h-20 bg-destructive/10 rounded-full flex items-center justify-center mx-auto mb-6">
                  <XCircle className="w-10 h-10 text-destructive" />
                </div>
                <h1 className="text-3xl font-serif mb-4 text-foreground">Plačilo je poteklo</h1>
                <p className="text-muted-foreground">
                  Čas za plačilo je potekel. Prosimo, poskusite znova opraviti nakup.
                </p>
              </div>
            </>
          )}

          <CardContent className="p-8">
            <h3 className="font-medium text-sm text-muted-foreground uppercase tracking-wider mb-6">Podrobnosti</h3>
            <div className="flex justify-between items-center py-3 border-b border-border">
              <span className="text-muted-foreground">Restavracija</span>
              <span className="font-medium">{restaurant.ime}</span>
            </div>
            <div className="flex justify-between items-center py-3 border-b border-border">
              <span className="text-muted-foreground">Status</span>
              <span className="font-medium capitalize">{checkout.status}</span>
            </div>
            <div className="flex justify-between items-center py-3">
              <span className="text-muted-foreground">ID plačila</span>
              <span className="font-medium text-xs font-mono bg-muted px-2 py-1 rounded">{sessionId.slice(0, 12)}...</span>
            </div>
          </CardContent>

          <div className="p-8 pt-0">
            <Link href={`/${slug}`} className="inline-flex h-12 w-full items-center justify-center rounded-md bg-secondary text-secondary-foreground hover:bg-secondary/80 font-medium text-base transition-colors">
              Nazaj na prvo stran
            </Link>
          </div>
        </Card>
      </div>
    </div>
  );
}
