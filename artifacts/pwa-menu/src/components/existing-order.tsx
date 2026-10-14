import { formatEur } from '@/lib/format';
import { ChevronDown, Loader2, LockKeyhole, ReceiptText } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useUpdatePublicOrderTip, type PublicExistingOrder } from '@/hooks/use-public-api';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { formatQrTipInput, parseQrTipInput } from '@/lib/qr-tip';

type ExistingOrderProps = {
  narocilo: PublicExistingOrder | null;
  token: string;
  qrNapravaId: string;
};

const velikostiPic: Record<NonNullable<PublicExistingOrder['postavke'][number]['velikostPice']>, string> = {
  mala: 'Mala pica',
  normalna: 'Normalna pica',
  druzinska: 'Družinska pica',
};

function sklanjajPostavke(stevilo: number): string {
  if (stevilo === 1) return 'postavka';
  if (stevilo === 2) return 'postavki';
  if (stevilo === 3 || stevilo === 4) return 'postavke';
  return 'postavk';
}

export function ExistingOrder({ narocilo, token, qrNapravaId }: ExistingOrderProps) {
  const [expanded, setExpanded] = useState(false);
  const [tipInput, setTipInput] = useState('0,00');
  const [tipError, setTipError] = useState<string | null>(null);
  const updateTip = useUpdatePublicOrderTip(token, qrNapravaId);
  const { toast } = useToast();

  useEffect(() => {
    if (narocilo) setTipInput(formatQrTipInput(narocilo.znesekNapitnina));
  }, [narocilo?.znesekNapitnina]);

  if (!narocilo || narocilo.postavke.length === 0) return null;
  const parsedTip = parseQrTipInput(tipInput);
  const shownTip = parsedTip ?? narocilo.znesekNapitnina;
  const saveTip = () => {
    if (parsedTip === null) {
      setTipError('Vnesite veljaven znesek z največ dvema decimalnima mestoma.');
      return;
    }
    updateTip.mutate(parsedTip, {
      onSuccess: () => toast({ title: 'Napitnina je shranjena' }),
      onError: (error) => setTipError(error instanceof Error ? error.message : 'Napitnine ni bilo mogoče shraniti.'),
    });
  };

  return (
    <section
      className="rounded-xl sm:rounded-2xl border border-primary/15 bg-primary/[0.035] p-3 sm:p-4 shadow-sm"
      aria-labelledby="existing-order-heading"
      data-testid="existing-order"
    >
      <button
        type="button"
        className="flex w-full items-center gap-2.5 text-left"
        onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded}
        aria-controls="existing-order-lines"
      >
        <div className="mt-0.5 rounded-lg bg-primary/10 p-1.5 sm:rounded-xl sm:p-2 text-primary">
          <ReceiptText className="h-4 w-4 sm:h-5 sm:w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <h2 id="existing-order-heading" className="font-display text-base sm:text-lg font-bold">
            Že naročeno
          </h2>
          <p className="mt-0.5 hidden sm:block text-sm text-muted-foreground">
            Te postavke so že poslane v pripravo in jih ni mogoče spreminjati.
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground sm:hidden">
            {narocilo.postavke.length} {sklanjajPostavke(narocilo.postavke.length)}
          </p>
        </div>
        <span className="flex shrink-0 items-center gap-1.5">
          <LockKeyhole className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-muted-foreground" aria-hidden="true" />
          <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden="true" />
        </span>
      </button>

      <div
        id="existing-order-lines"
        className={`mt-3 sm:mt-4 divide-y divide-border/70 border-y border-border/70 ${expanded ? 'block' : 'hidden sm:block'}`}
      >
        {narocilo.postavke.map((postavka, index) => (
          <div key={`${postavka.ime}-${index}`} className="py-2.5 sm:py-3 first:pt-2.5 sm:first:pt-3 last:pb-2.5 sm:last:pb-3" data-testid={`existing-order-line-${index}`}>
            <div className="flex items-start justify-between gap-3 sm:gap-4">
              <div className="min-w-0">
                <p className="text-sm sm:text-base font-medium leading-tight">
                  <span className="mr-2 text-muted-foreground">{postavka.kolicina}×</span>
                  {postavka.ime}
                  {postavka.toGo && (
                    <span className="ml-1.5 sm:ml-2 inline-flex rounded-full bg-primary/10 px-1.5 py-0.5 text-[10px] sm:text-[11px] font-medium text-primary">
                      To Go
                    </span>
                  )}
                </p>
                {postavka.velikostPice && (
                  <p className="mt-1 text-xs sm:text-sm text-muted-foreground">
                    {velikostiPic[postavka.velikostPice]}
                  </p>
                )}
                {postavka.dodatki.map((dodatek, dodatekIndex) => (
                  <p key={`${dodatek.ime}-${dodatekIndex}`} className="mt-1 text-xs sm:text-sm text-muted-foreground">
                    {dodatek.tip === 'embalaza' ? 'Embalaža: ' : ''}
                    {dodatek.kolicina > 1 ? `${dodatek.kolicina}× ` : ''}
                    {dodatek.ime}
                  </p>
                ))}
                {postavka.opomba && (
                  <p className="mt-2 rounded-md bg-background/70 px-2 py-1 text-xs sm:text-sm italic text-muted-foreground">
                    “{postavka.opomba}”
                  </p>
                )}
              </div>
              <span className="shrink-0 text-sm sm:text-base font-semibold">{formatEur(postavka.skupaj)}</span>
            </div>
          </div>
        ))}
      </div>

      <div className="mt-3 space-y-2 text-xs sm:text-sm">
        <label htmlFor="existing-order-tip" className="font-medium">Napitnina (opcijsko)</label>
        <div className="flex gap-2">
          <div className="relative min-w-0 flex-1">
            <Input
              id="existing-order-tip"
              inputMode="decimal"
              value={tipInput}
              onChange={(event) => {
                setTipInput(event.target.value);
                setTipError(null);
              }}
              onBlur={() => {
                if (parsedTip !== null) setTipInput(formatQrTipInput(parsedTip));
              }}
              className="h-11 pr-9 text-right"
              aria-invalid={tipError ? 'true' : 'false'}
              data-testid="input-existing-order-tip"
            />
            <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">€</span>
          </div>
          <Button
            type="button"
            variant="outline"
            className="h-11"
            onClick={saveTip}
            disabled={updateTip.isPending || parsedTip === null || parsedTip === narocilo.znesekNapitnina}
            data-testid="button-save-existing-order-tip"
          >
            {updateTip.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Shrani
          </Button>
        </div>
        {tipError && (
          <p className="text-sm text-destructive" role="alert">{tipError}</p>
        )}
        <div className="flex items-center justify-between border-t border-border/70 pt-1.5">
          <span className="font-medium">Skupaj</span>
          <span className="font-display text-sm sm:text-base font-bold">
            {formatEur(narocilo.skupaj + shownTip)}
          </span>
        </div>
      </div>
    </section>
  );
}