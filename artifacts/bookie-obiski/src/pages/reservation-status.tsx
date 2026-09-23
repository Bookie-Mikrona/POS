import React, { useState } from 'react';
import { useParams, Link } from 'wouter';
import { useGetJavnaRezervacija, useCancelJavnaRezervacija, useGetJavnaRestavracija } from '@workspace/api-client-react';
import { Card, CardContent, CardFooter } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Calendar as CalendarIcon, Users, MapPin, XCircle, ChevronLeft } from 'lucide-react';
import { formatTime, formatDate } from '@/lib/utils';
import { toast } from 'sonner';

export default function ReservationStatus() {
  const { slug, managementToken } = useParams<{ slug: string; managementToken: string }>();
  
  const { data: restaurant, isLoading: isLoadingRest } = useGetJavnaRestavracija(slug);
  const { 
    data: reservation, 
    isLoading: isLoadingRes, 
    error,
    refetch
  } = useGetJavnaRezervacija(slug, managementToken);

  const [isCancelling, setIsCancelling] = useState(false);

  const cancelReservation = useCancelJavnaRezervacija({
    mutation: {
      onSuccess: () => {
        toast.success('Rezervacija je bila uspešno preklicana.');
        setIsCancelling(false);
        refetch();
      },
      onError: () => {
        toast.error('Napaka pri preklicu rezervacije.');
        setIsCancelling(false);
      }
    }
  });

  const handleCancel = () => {
    if (confirm('Ste prepričani, da želite preklicati rezervacijo?')) {
      cancelReservation.mutate({ slug, managementToken });
    }
  };

  if (isLoadingRest || isLoadingRes) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4">
        <Skeleton className="h-10 w-48 mb-8" />
        <Skeleton className="h-96 w-full max-w-md rounded-xl" />
      </div>
    );
  }

  if (error || !reservation || !restaurant) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center p-4 text-center">
        <XCircle className="w-16 h-16 text-destructive mb-4" />
        <h1 className="text-2xl font-serif text-foreground mb-4">Rezervacija ni najdena</h1>
        <p className="text-muted-foreground mb-8">Povezava je morda potekla ali pa je neveljavna.</p>
        <Link href={`/${slug}`} className="text-primary hover:underline flex items-center gap-2">
          <ChevronLeft className="w-4 h-4" /> Nazaj na restavracijo
        </Link>
      </div>
    );
  }

  const isCancelled = reservation.status === 'cancelled';
  const isPast = new Date(`${reservation.datum}T${reservation.cas}`) < new Date();

  return (
    <div className="min-h-screen bg-background py-12 px-4">
      <div className="max-w-md mx-auto">
        <Link href={`/${slug}`} className="inline-flex items-center gap-2 text-muted-foreground hover:text-primary mb-8 transition-colors">
          <ChevronLeft className="w-4 h-4" /> 
          Nazaj na {restaurant.ime}
        </Link>

        <Card className="border-card-border shadow-md overflow-hidden">
          <div className="bg-muted h-32 relative flex items-center justify-center">
            <div className="absolute inset-0 bg-primary/10" />
            <div className="relative z-10 bg-background/90 backdrop-blur-sm px-6 py-2 rounded-full border border-border shadow-sm">
              <h2 className="font-serif font-medium text-lg">{restaurant.ime}</h2>
            </div>
          </div>
          
          <CardContent className="p-8">
            <div className="text-center mb-8">
              <h1 className="text-3xl font-serif mb-2">Vaša rezervacija</h1>
              
              {isCancelled ? (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-destructive/10 text-destructive rounded-full text-sm font-medium mt-2">
                  <XCircle className="w-4 h-4" /> Preklicano
                </div>
              ) : (
                <div className="inline-flex items-center gap-1.5 px-3 py-1 bg-primary/10 text-primary rounded-full text-sm font-medium mt-2">
                  Potrjeno
                </div>
              )}
            </div>

            <div className="space-y-6">
              <div className="flex items-center gap-4 p-4 rounded-lg bg-card border border-border">
                <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <CalendarIcon className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-0.5">Datum in ura</p>
                  <p className="font-medium">{formatDate(reservation.datum)} ob {formatTime(reservation.cas)}</p>
                </div>
              </div>

              <div className="flex items-center gap-4 p-4 rounded-lg bg-card border border-border">
                <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <Users className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-0.5">Število oseb</p>
                  <p className="font-medium">{reservation.steviloOseb}</p>
                </div>
              </div>

              <div className="flex items-center gap-4 p-4 rounded-lg bg-card border border-border">
                <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center shrink-0">
                  <MapPin className="w-6 h-6" />
                </div>
                <div>
                  <p className="text-sm text-muted-foreground mb-0.5">Lokacija</p>
                  <p className="font-medium">{restaurant.ime}</p>
                  {restaurant.kontakt.telefon && <p className="text-sm text-muted-foreground mt-0.5">{restaurant.kontakt.telefon}</p>}
                </div>
              </div>
            </div>

            <div className="mt-8 pt-8 border-t border-border">
              <h3 className="font-medium mb-4 text-sm text-muted-foreground uppercase tracking-wider">Podatki nosilca</h3>
              <p className="font-medium">{reservation.ime}</p>
              <p className="text-muted-foreground">{reservation.email}</p>
              {reservation.telefon && <p className="text-muted-foreground">{reservation.telefon}</p>}
            </div>
          </CardContent>

          {!isCancelled && !isPast && (
            <CardFooter className="p-8 pt-0 bg-card border-t border-border flex-col gap-4">
              <p className="text-sm text-muted-foreground text-center mb-2">
                Če ne morete priti, vas prosimo, da rezervacijo pravočasno prekličete.
              </p>
              <Button 
                variant="destructive" 
                className="w-full h-12 text-base"
                onClick={handleCancel}
                disabled={cancelReservation.isPending}
              >
                {cancelReservation.isPending ? 'Preklicujem...' : 'Prekliči rezervacijo'}
              </Button>
            </CardFooter>
          )}
        </Card>
      </div>
    </div>
  );
}
