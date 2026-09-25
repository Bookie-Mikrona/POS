import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import { usePreveriJavniBon, type JavniBonStanje } from '@workspace/api-client-react';
import { AlertCircle, ArrowRight, Camera, CameraOff, Check, Gift, ScanLine } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { formatCurrency } from '@/lib/utils';

type Detector = { detect: (source: HTMLVideoElement) => Promise<{ rawValue: string }[]> };
type DetectorConstructor = new (options?: { formats?: string[] }) => Detector;

const statusText: Record<JavniBonStanje['status'], string> = {
  active: 'Aktiven',
  spent: 'Porabljen',
  expired: 'Potekel',
  inactive: 'Neaktiven',
};

function lookupError(error: unknown): string {
  const status = (error as { status?: number } | null)?.status;
  switch (status) {
    case 400: return 'Koda ni v veljavni obliki. Preverite vnos in poskusite znova.';
    case 404: return 'Bona s to kodo nismo našli. Preverite kodo na prejetem bonu.';
    case 429: return 'Preveč poskusov preverjanja. Počakajte nekaj minut in poskusite znova.';
    default: return 'Stanja trenutno ni mogoče preveriti. Preverite povezavo in poskusite znova.';
  }
}

export function VoucherBalance({ slug }: { slug: string }) {
  const [code, setCode] = useState('');
  const [result, setResult] = useState<JavniBonStanje | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [scannerOpen, setScannerOpen] = useState(false);
  const [cameraActive, setCameraActive] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const frameRef = useRef<number | null>(null);
  const scanSession = useRef(0);
  const currentCode = useRef('');
  const requestInFlight = useRef(false);
  const mutation = usePreveriJavniBon();

  const stopCamera = useCallback(() => {
    scanSession.current += 1;
    if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
    frameRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
    setScannerOpen(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);
  useEffect(() => {
    stopCamera();
    currentCode.current = '';
    setCode('');
    setResult(null);
    setError(null);
  }, [slug, stopCamera]);

  const changeCode = (next: string) => {
    currentCode.current = next;
    setCode(next);
    setResult(null);
    setError(null);
  };

  const check = async (raw: string) => {
    const submitted = raw.trim();
    if (requestInFlight.current) return;
    if (!submitted) {
      setError('Vnesite kodo darilnega bona.');
      return;
    }
    requestInFlight.current = true;
    setPending(true);
    setResult(null);
    setError(null);
    try {
      const response = await mutation.mutateAsync({ slug, data: { code: submitted } });
      if (currentCode.current.trim() === submitted) setResult(response);
    } catch (cause) {
      if (currentCode.current.trim() === submitted) setError(lookupError(cause));
    } finally {
      requestInFlight.current = false;
      setPending(false);
    }
  };

  const startCamera = async () => {
    setCameraError(null);
    const BarcodeDetector = (window as Window & { BarcodeDetector?: DetectorConstructor }).BarcodeDetector;
    if (!BarcodeDetector) {
      setCameraError('Ta brskalnik ne podpira skeniranja QR-kod. Kodo z bona vnesite ročno.');
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError('Kamera v tem brskalniku ni na voljo. Kodo z bona vnesite ročno.');
      return;
    }
    const session = ++scanSession.current;
    setScannerOpen(true);
    try {
      const detector = new BarcodeDetector({ formats: ['qr_code'] });
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' }, audio: false });
      if (session !== scanSession.current) {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      streamRef.current = stream;
      const video = videoRef.current;
      if (!video) {
        stopCamera();
        setCameraError('Kamere ni mogoče prikazati. Kodo z bona vnesite ročno.');
        return;
      }
      video.srcObject = stream;
      await video.play();
      if (session !== scanSession.current) return;
      setCameraActive(true);
      const scan = async () => {
        if (session !== scanSession.current || !videoRef.current) return;
        try {
          const found = await detector.detect(videoRef.current);
          if (session !== scanSession.current) return;
          const scanned = found[0]?.rawValue?.trim();
          if (scanned) {
            stopCamera();
            changeCode(scanned);
            void check(scanned);
            return;
          }
        } catch {
          if (session !== scanSession.current) return;
          stopCamera();
          setCameraError('QR-kode ni bilo mogoče prebrati. Poskusite znova ali vnesite kodo ročno.');
          return;
        }
        frameRef.current = requestAnimationFrame(() => void scan());
      };
      frameRef.current = requestAnimationFrame(() => void scan());
    } catch (cause) {
      if (session !== scanSession.current) return;
      stopCamera();
      setCameraError(cause instanceof Error && (cause.name === 'NotAllowedError' || cause.name === 'PermissionDeniedError')
        ? 'Dostop do kamere je zavrnjen. Dovolite dostop v brskalniku ali kodo vnesite ročno.'
        : 'Kamere ni mogoče zagnati. Kodo z bona vnesite ročno.');
    }
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    void check(code);
  };

  return (
    <section className="voucher-balance-section mt-12 md:mt-16 fade-in" aria-labelledby="voucher-balance-heading" data-testid="section-voucher-balance">
      <div className="grid gap-8 p-5 sm:p-8 md:grid-cols-[minmax(0,1fr)_minmax(0,1.06fr)] md:gap-10 md:p-10">
        <div className="flex flex-col justify-center">
          <div className="mb-6 flex items-center gap-3 text-primary/70">
            <span className="flex h-10 w-10 items-center justify-center rounded-full border border-primary/20"><Gift className="h-5 w-5" aria-hidden="true" /></span>
            <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">Vaš darilni bon</span>
          </div>
          <h2 id="voucher-balance-heading" className="max-w-sm text-3xl leading-tight text-foreground sm:text-4xl">Preverite vaš darilni bon</h2>
          <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">
            Vnesite kodo, ki ste jo prejeli z darilnim bonom, ali skenirajte QR-kodo na njem. Takoj vam pokažemo preostalo dobroimetje.
          </p>
          <p className="mt-4 max-w-md text-sm leading-7 text-muted-foreground">
            Bona ni treba porabiti naenkrat. Po vsakem obisku lahko tukaj znova preverite, koliko vam je še na voljo.
          </p>
        </div>
        <div className="voucher-balance-panel rounded-xl p-5 sm:p-7">
          <div className="mb-6 border-b border-border pb-5">
            <span className="mb-2 block text-[11px] font-semibold uppercase tracking-[0.18em] text-accent">Preverjanje stanja</span>
            <h3 className="text-2xl leading-tight">Preverite stanje darilnega bona</h3>
          </div>
          <form onSubmit={submit} className="space-y-3">
            <Label htmlFor="public-voucher-code" className="text-sm font-medium">Koda darilnega bona</Label>
            <Input id="public-voucher-code" value={code} onChange={event => changeCode(event.target.value)} placeholder="Vnesite kodo bona" autoComplete="off" spellCheck={false} maxLength={128} aria-describedby="voucher-code-hint" aria-invalid={Boolean(error)} className="h-12 bg-background/70" data-testid="input-voucher-code" />
            <p id="voucher-code-hint" className="text-xs leading-5 text-muted-foreground">Kodo najdete na digitalnem bonu v e-pošti.</p>
            <div className="grid gap-2 pt-2 sm:grid-cols-2">
              <Button type="submit" disabled={pending || !code.trim()} className="h-11 gap-2" data-testid="button-check-voucher-balance">
                {pending ? 'Preverjamo …' : <>Preveri stanje <ArrowRight className="h-4 w-4" aria-hidden="true" /></>}
              </Button>
              <Button type="button" variant="outline" onClick={scannerOpen ? stopCamera : () => void startCamera()} className="h-11 gap-2" data-testid="button-scan-voucher-qr">
                {scannerOpen ? <><CameraOff className="h-4 w-4" aria-hidden="true" /> Zapri kamero</> : <><Camera className="h-4 w-4" aria-hidden="true" /> Skeniraj QR-kodo</>}
              </Button>
            </div>
          </form>
          {scannerOpen && (
            <div className="mt-5" data-testid="panel-voucher-camera">
              <p className="mb-2 text-xs text-muted-foreground">{cameraActive ? 'Usmerite kamero v QR-kodo na bonu.' : 'Pripravljamo kamero …'}</p>
              <div className="voucher-scan-frame relative overflow-hidden rounded-xl bg-primary">
                <video ref={videoRef} muted playsInline aria-label="Predogled kamere za skeniranje QR-kode" className="max-h-64 min-h-44 w-full object-cover" />
                <ScanLine className="pointer-events-none absolute bottom-4 right-4 h-5 w-5 text-primary-foreground" aria-hidden="true" />
              </div>
            </div>
          )}
          {cameraError && <p role="status" className="mt-4 rounded-lg bg-secondary px-4 py-3 text-sm text-secondary-foreground" data-testid="status-voucher-camera">{cameraError}</p>}
          {error && <p role="alert" className="mt-5 flex items-start gap-2 rounded-lg border border-destructive/20 bg-destructive/5 px-4 py-3 text-sm text-destructive" data-testid="error-voucher-balance"><AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />{error}</p>}
          {result && (
            <div role="status" aria-live="polite" className="mt-6 rounded-xl border border-primary/15 bg-secondary/60 p-5" data-testid="result-voucher-balance">
              <div className="flex items-center justify-between gap-3">
                <span className="text-xs font-semibold uppercase tracking-[0.14em] text-muted-foreground">Preostalo dobroimetje</span>
                <span className="inline-flex items-center gap-1.5 rounded-full bg-card px-3 py-1 text-xs font-semibold text-primary" data-testid="status-voucher-balance"><Check className="h-3.5 w-3.5" aria-hidden="true" />{statusText[result.status]}</span>
              </div>
              <p className="mt-3 font-serif text-4xl text-primary sm:text-5xl" data-testid="text-voucher-balance">{formatCurrency(result.balanceCents, result.currency)}</p>
              {result.expiresAt && !Number.isNaN(new Date(result.expiresAt).getTime()) && <p className="mt-3 text-xs text-muted-foreground" data-testid="text-voucher-expiry">Velja do {new Intl.DateTimeFormat('sl-SI', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(result.expiresAt))}.</p>}
              {result.status !== 'active' && <p className="mt-3 text-sm text-muted-foreground">Ta bon trenutno ni na voljo za uporabo.</p>}
            </div>
          )}
        </div>
      </div>
    </section>
  );
}