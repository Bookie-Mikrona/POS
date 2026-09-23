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

  // Wait, I need to check how to pass query params to `useGetJavnaRazpolozljivost`.
  // The API likely expects `datum` and `steviloOseb` as query parameters.
  // I will check `getJavnaRazpolozljivostUrl` parameters.
  
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
          <div className="p-6 md:p-8 fade-in flex flex-col md:flex-row gap-8">
            <div className="flex-1">
              <div className="flex items-center gap-2 mb-4">
                <Button variant="ghost" size="icon" onClick={() => handleNext('party')} className="-ml-2">
                  <ArrowLeft className="w-4 h-4" />
                </Button>
                <h2 className="text-2xl font-serif">Izberite datum in uro</h2>
              </div>
              <p className="text-muted-foreground mb-6 flex items-center gap-2">
                <Users className="w-4 h-4" />
                Miza za {partySize} {partySize === 1 ? 'osebo' : partySize === 2 ? 'osebi' : partySize <= 4 ? 'osebe' : 'oseb'}
              </p>
              
              <div className="bg-card border rounded-lg p-2 inline-block mb-6">
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
                  className="rounded-md"
                />
              </div>
            </div>

            <div className="flex-1 border-t md:border-t-0 md:border-l border-border pt-6 md:pt-0 md:pl-8">
              <h3 className="font-serif text-lg mb-4 flex items-center gap-2">
                <Clock className="w-5 h-5 text-primary" />
                {date ? format(date, 'EEEE, d. MMMM', { locale: sl }) : 'Izberite datum'}
              </h3>
              
              {isLoadingAvailability ? (
                <div className="grid grid-cols-2 gap-3">
                  {[1,2,3,4].map(i => <div key={i} className="h-12 bg-muted animate-pulse rounded-md" />)}
                </div>
              ) : !availability || availability.slots.length === 0 ? (
                <div className="text-center py-8 bg-muted/50 rounded-lg border border-dashed">
                  <p className="text-muted-foreground">Na izbran datum ni prostih terminov.</p>
                </div>
              ) : (
                <div className="grid grid-cols-2 gap-3">
                  {availability.slots.map((slot) => {
                    const isAvailable = slot.naVoljo;
                    const isSelected = time === slot.cas;
                    
                    return (
                      <button
                        key={slot.cas}
                        disabled={!isAvailable}
                        onClick={() => setTime(slot.cas)}
                        className={cn(
                          "h-12 rounded-md font-medium transition-all border flex items-center justify-center gap-2",
                          !isAvailable && "opacity-50 cursor-not-allowed bg-muted text-muted-foreground",
                          isAvailable && !isSelected && "bg-card hover:bg-accent border-border hover:text-accent-foreground",
                          isSelected && "bg-primary text-primary-foreground border-primary shadow-md"
                        )}
                      >
                        {formatTime(slot.cas)}
                        {slot.preostalo !== undefined && slot.preostalo !== null && slot.preostalo <= 2 && isAvailable && (
                          <span className="text-[10px] bg-destructive/10 text-destructive px-1.5 py-0.5 rounded">
                            Samo še {slot.preostalo}
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
              
              <div className="mt-8">
                <Button 
                  className="w-full h-12 text-lg" 
                  disabled={!time}
                  onClick={() => handleNext('details')}
                >
                  Nadaljuj na vnos podatkov
                </Button>
              </div>
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
