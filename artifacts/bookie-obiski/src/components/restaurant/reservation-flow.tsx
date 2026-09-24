import React, { useState } from 'react';
import { useGetJavnaRazpolozljivost, useCreateJavnaRezervacija, getGetJavnaRazpolozljivostQueryKey } from '@workspace/api-client-react';
import type { JavnaRestavracija, JavniRezervacijaInput } from '@workspace/api-client-react';
import { Card } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Calendar } from '@/components/ui/calendar';
import { format, isBefore, startOfToday } from 'date-fns';
import { sl } from 'date-fns/locale';
import { Users, Calendar as CalendarIcon, Clock, ArrowLeft, CheckCircle2 } from 'lucide-react';
import { formatTime, cn } from '@/lib/utils';
import { toast } from 'sonner';
import { Link } from 'wouter';

interface ReservationFlowProps {
  restaurant: JavnaRestavracija;
}

type Step = 'party' | 'datetime' | 'details' | 'success';

export function ReservationFlow({ restaurant }: ReservationFlowProps) {
  const [step, setStep] = useState<Step>('party');
  const [idempotencyKey] = useState(() => crypto.randomUUID());
  
  const [partySize, setPartySize] = useState<number>(2);
  const [date, setDate] = useState<Date | undefined>(new Date());
  const [time, setTime] = useState<string>('');
  
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');

  const [managementToken, setManagementToken] = useState<string>('');

  const dateStr = date ? format(date, 'yyyy-MM-dd') : '';

  const { data: availability, isLoading: isLoadingAvailability } = useGetJavnaRazpolozljivost(
    restaurant.slug,
    { datum: dateStr, steviloOseb: partySize },
    {
      query: {
        queryKey: getGetJavnaRazpolozljivostQueryKey(restaurant.slug, { datum: dateStr, steviloOseb: partySize }),
        enabled: step === 'datetime' && !!dateStr && !!partySize,
      }
    }
  );

  const createReservation = useCreateJavnaRezervacija({
    mutation: {
      onSuccess: (data) => {
        setManagementToken(data.managementToken);
        setStep('success');
      },
      onError: (err) => {
        toast.error('Napaka pri rezervaciji', { description: 'Prosimo, poskusite znova ali izberite drug termin.' });
      }
    }
  });

  const handleNext = (nextStep: Step) => {
    setStep(nextStep);
    window.scrollTo({ top: 0, behavior: 'smooth' });
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!name || !email || !dateStr || !time) return;

    const payload: JavniRezervacijaInput = {
      idempotencyKey,
      steviloOseb: partySize,
      datum: dateStr,
      cas: time,
      ime: name,
      email,
      telefon: phone,
      privacyAccepted: true
    };

    createReservation.mutate({
      slug: restaurant.slug,
      data: payload
    });
  };

  // Generate party size options
  const maxParty = restaurant.maxPartySize || 12;
  const partyOptions = Array.from({ length: maxParty }, (_, i) => i + 1);
  const availableSlots = availability?.slots.filter(slot => slot.naVoljo) ?? [];
  const selectedTimeAvailable = availableSlots.some(slot => slot.cas === time);

  return (
    <div className="w-full">
      {/* Progress Bar */}
      {step !== 'success' && (
        <div className="flex items-center justify-between mb-8 px-4">
          {[
            { id: 'party', label: 'Osebe', icon: Users },
            { id: 'datetime', label: 'Termin', icon: Clock },
            { id: 'details', label: 'Podatki', icon: CheckCircle2 }
          ].map((s, idx) => {
            const isActive = step === s.id;
            const isPast = ['party', 'datetime', 'details'].indexOf(step) > idx;
            return (
              <div key={s.id} className="flex flex-col items-center gap-2 relative z-10 flex-1">
                <div 
                  className={cn(
                    "w-10 h-10 rounded-full flex items-center justify-center transition-colors border-2",
                    isActive ? "bg-primary text-primary-foreground border-primary" :
                    isPast ? "bg-primary/10 text-primary border-primary" :
                    "bg-card text-muted-foreground border-border"
                  )}
                >
                  <s.icon className="w-4 h-4" />
                </div>
                <span className={cn(
                  "text-xs font-medium",
                  isActive || isPast ? "text-foreground" : "text-muted-foreground"
                )}>
                  {s.label}
                </span>
              </div>
            );
          })}
          <div className="absolute left-8 right-8 top-5 h-[2px] bg-border -z-0" />
        </div>
      )}

      <Card className="border-card-border shadow-sm overflow-hidden">
        {step === 'party' && (
          <div className="p-6 md:p-8 fade-in">
            <h2 className="text-2xl font-serif text-center mb-8">Koliko vas bo?</h2>
            <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-3 mb-8">
              {partyOptions.map(num => (
                <button
                  key={num}
                  onClick={() => {
                    setPartySize(num);
                    setTimeout(() => handleNext('datetime'), 150);
                  }}
                  className={cn(
                    "h-14 rounded-lg text-lg font-medium transition-all border",
                    partySize === num 
                      ? "bg-primary text-primary-foreground border-primary shadow-md transform scale-105" 
                      : "bg-card hover:bg-accent hover:text-accent-foreground border-border"
                  )}
                >
                  {num}
                </button>
              ))}
            </div>
          </div>
        )}

        {step === 'datetime' && (
          <div className="p-5 sm:p-8 fade-in max-w-2xl mx-auto">
            <div className="flex items-center gap-3 mb-2">
                <Button variant="ghost" size="icon" onClick={() => handleNext('party')} className="shrink-0" aria-label="Nazaj na izbiro števila oseb">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <h2 className="text-2xl font-serif">Izberite termin</h2>
            </div>
            <p className="text-sm text-muted-foreground mb-6 ml-12">
              Miza za {partySize} {partySize === 1 ? 'osebo' : partySize === 2 ? 'osebi' : partySize <= 4 ? 'osebe' : 'oseb'}
            </p>

            <div className="mx-auto max-w-[380px]">
              <h3 className="mb-3 text-sm font-semibold">1. Izberite datum</h3>
              <div className="rounded-xl border border-border bg-card p-3 sm:p-4">
                <Calendar
                  mode="single"
                  selected={date}
                  onSelect={(d) => {
                    if (d) {
                      setDate(d);
                      setTime('');
                    }
                  }}
                  disabled={(d) => isBefore(d, startOfToday())}
                />
              </div>
            </div>

            <div className="mt-7 border-t border-border pt-6">
              <h3 className="mb-1 text-sm font-semibold">2. Izberite uro</h3>
              <p className="mb-4 text-sm text-muted-foreground">
                {date ? format(date, 'EEEE, d. MMMM', { locale: sl }) : 'Najprej izberite datum'}
              </p>
              
              {isLoadingAvailability ? (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="status" aria-label="Nalagam proste termine">
                  {[1,2,3,4].map(i => <div key={i} className="h-11 bg-muted animate-pulse rounded-lg" />)}
                </div>
              ) : availableSlots.length === 0 ? (
                <div className="rounded-lg bg-muted/50 px-4 py-5 text-sm text-muted-foreground">
                  Na ta dan ni prostih terminov. Izberite drug datum.
                </div>
              ) : (
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2" role="group" aria-label="Prosti termini">
                  {availableSlots.map((slot) => (
                    <button
                      key={slot.cas}
                      type="button"
                      aria-pressed={time === slot.cas}
                      onClick={() => setTime(slot.cas)}
                      className={cn(
                        "min-h-11 rounded-lg border px-2 py-2 text-sm font-medium transition-colors focus-visible:outline-2 focus-visible:outline-primary",
                        time === slot.cas
                          ? "border-primary bg-primary text-primary-foreground"
                          : "border-border bg-card hover:border-primary hover:bg-accent"
                      )}
                    >
                      {formatTime(slot.cas)}
                      {slot.preostalo !== undefined && slot.preostalo !== null && slot.preostalo <= 2 && (
                        <span className="ml-1 text-xs opacity-80">· še {slot.preostalo}</span>
                      )}
                    </button>
                  ))}
                </div>
              )}
              
              <Button
                className="mt-6 w-full h-12"
                disabled={!selectedTimeAvailable || isLoadingAvailability}
                onClick={() => handleNext('details')}
              >
                Nadaljuj
              </Button>
            </div>
          </div>
        )}

        {step === 'details' && (
          <div className="p-6 md:p-8 fade-in">
            <div className="flex items-center gap-2 mb-6">
              <Button variant="ghost" size="icon" onClick={() => handleNext('datetime')} className="-ml-2">
                <ArrowLeft className="w-4 h-4" />
              </Button>
              <h2 className="text-2xl font-serif">Vaši podatki</h2>
            </div>
            
            <div className="bg-primary/5 border border-primary/20 rounded-lg p-4 mb-8 flex flex-wrap gap-4 text-sm font-medium text-primary">
              <div className="flex items-center gap-2"><Users className="w-4 h-4"/> {partySize} oseb</div>
              <div className="flex items-center gap-2"><CalendarIcon className="w-4 h-4"/> {date ? format(date, 'd.M.yyyy') : ''}</div>
              <div className="flex items-center gap-2"><Clock className="w-4 h-4"/> {formatTime(time)}</div>
            </div>

            <form onSubmit={handleSubmit} className="space-y-5 max-w-md mx-auto">
              <div className="space-y-2">
                <Label htmlFor="name">Ime in priimek <span className="text-destructive">*</span></Label>
                <Input 
                  id="name" 
                  value={name} 
                  onChange={e => setName(e.target.value)} 
                  required 
                  className="h-12"
                  placeholder="Janez Novak"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">E-poštni naslov <span className="text-destructive">*</span></Label>
                <Input 
                  id="email" 
                  type="email" 
                  value={email} 
                  onChange={e => setEmail(e.target.value)} 
                  required 
                  className="h-12"
                  placeholder="janez@primer.si"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="phone">Telefonska številka <span className="text-destructive">*</span></Label>
                <Input 
                  id="phone" 
                  type="tel" 
                  value={phone} 
                  onChange={e => setPhone(e.target.value)} 
                  required
                  className="h-12"
                  placeholder="041 123 456"
                />
              </div>
              
              <Button 
                type="submit" 
                className="w-full h-12 text-lg mt-4"
                disabled={createReservation.isPending || !name || !email || !phone}
              >
                {createReservation.isPending ? 'Potrjujem...' : 'Potrdi rezervacijo'}
              </Button>
            </form>
          </div>
        )}

        {step === 'success' && (
          <div className="p-10 text-center fade-in">
            <div className="w-20 h-20 bg-primary/10 rounded-full flex items-center justify-center mx-auto mb-6">
              <CheckCircle2 className="w-10 h-10 text-primary" />
            </div>
            <h2 className="text-3xl font-serif mb-4 text-foreground">Rezervacija potrjena!</h2>
            <p className="text-muted-foreground text-lg mb-8 max-w-md mx-auto">
              Veselimo se vašega obiska v restavraciji {restaurant.ime} dne {date ? format(date, 'd.M.yyyy') : ''} ob {formatTime(time)}.
            </p>
            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <Link href={`/${restaurant.slug}/rezervacija/${managementToken}`} className="inline-flex h-12 items-center justify-center rounded-md bg-primary px-8 text-sm font-medium text-primary-foreground hover:bg-primary/90">
                Upravljaj rezervacijo
              </Link>
              <Button variant="outline" className="h-12" onClick={() => window.location.reload()}>
                Nova rezervacija
              </Button>
            </div>
          </div>
        )}
      </Card>
    </div>
  );
}
