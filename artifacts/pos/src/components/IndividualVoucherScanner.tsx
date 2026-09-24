import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, Camera, CameraOff, Loader2, ScanLine } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { posFetch } from "@/lib/pos-auth-headers";

export interface IndividualVoucherPreview {
  id: string;
  codeSuffix: string;
  balanceCents: number;
  currency: string;
  status: string;
  expiresAt: string | null;
}

interface IndividualVoucherScannerProps {
  value: string;
  onChange: (value: string) => void;
  onVerified: (preview: IndividualVoucherPreview | null) => void;
  payableCents: number;
}

type DetectedBarcode = { rawValue: string };
type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<DetectedBarcode[]>;
};
type BarcodeDetectorConstructor = new (options?: { formats?: string[] }) => BarcodeDetectorLike;

const statusIsAvailable = (status: string) =>
  ["active", "available", "aktiven", "veljaven"].includes(status.toLowerCase());

export function IndividualVoucherScanner({
  value,
  onChange,
  onVerified,
  payableCents,
}: IndividualVoucherScannerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<IndividualVoucherPreview | null>(null);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [cameraActive, setCameraActive] = useState(false);
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const currentValueRef = useRef(value);
  const detectorFrameRef = useRef<number | null>(null);
  currentValueRef.current = value;

  const stopCamera = useCallback(() => {
    if (detectorFrameRef.current !== null) cancelAnimationFrame(detectorFrameRef.current);
    detectorFrameRef.current = null;
    streamRef.current?.getTracks().forEach(track => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setCameraActive(false);
  }, []);

  useEffect(() => stopCamera, [stopCamera]);
  useEffect(() => {
    if (!value) {
      setPreview(null);
      setError(null);
    }
  }, [value]);

  const verifyCode = useCallback(async (submittedCode: string) => {
    const code = submittedCode.trim();
    if (!code) {
      setError("Vnesite ali skenirajte kodo individualnega bona.");
      return;
    }
    setLoading(true);
    setError(null);
    setPreview(null);
    onVerified(null);
    try {
      const base = import.meta.env.BASE_URL?.replace(/\/$/, "") ?? "";
      const response = await posFetch(`${base}/api/darilni-boni/individualni/preveri`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code }),
      });
      const result = await response.json() as IndividualVoucherPreview & { error?: string; napaka?: string };
      if (!response.ok) throw new Error(result.error ?? result.napaka ?? "Individualnega bona ni mogoče preveriti.");
      if (currentValueRef.current.trim() !== code) return;
      if (!statusIsAvailable(result.status)) {
        throw new Error(`Bon ni na voljo za unovčitev (status: ${result.status}).`);
      }
      if (result.expiresAt && new Date(result.expiresAt).getTime() <= Date.now()) {
        throw new Error("Veljavnost bona je potekla.");
      }
      if (!Number.isFinite(result.balanceCents) || result.balanceCents <= 0) {
        throw new Error("Bon nima razpoložljivega dobroimetja.");
      }
      setPreview(result);
      onVerified(result);
    } catch (cause) {
      if (currentValueRef.current.trim() === code) {
        setError(cause instanceof Error ? cause.message : "Preverjanje bona ni uspelo.");
        onVerified(null);
      }
    } finally {
      setLoading(false);
    }
  }, [onVerified]);

  const startCamera = async () => {
    setCameraError(null);
    const Detector = (window as Window & { BarcodeDetector?: BarcodeDetectorConstructor }).BarcodeDetector;
    if (!Detector) {
      setCameraError("Ta brskalnik ne podpira branja QR-kod s kamero. Uporabite 2D čitalnik ali ročni vnos.");
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError("Dostop do kamere ni podprt. Uporabite 2D čitalnik ali ročni vnos.");
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "environment" }, audio: false });
      streamRef.current = stream;
      if (!videoRef.current) {
        stream.getTracks().forEach(track => track.stop());
        streamRef.current = null;
        return;
      }
      const video = videoRef.current;
      video.srcObject = stream;
      await video.play();
      setCameraActive(true);
      const detector = new Detector({ formats: ["qr_code", "data_matrix", "aztec", "pdf417"] });
      const scan = async () => {
        if (!streamRef.current || !videoRef.current) return;
        try {
          const found = await detector.detect(videoRef.current);
          const code = found[0]?.rawValue?.trim();
          if (code) {
            stopCamera();
            onValueChange(code);
            void verifyCode(code);
            return;
          }
        } catch {
          setCameraError("Kodo s kamero ni bilo mogoče prebrati.");
          stopCamera();
          return;
        }
        detectorFrameRef.current = requestAnimationFrame(() => void scan());
      };
      detectorFrameRef.current = requestAnimationFrame(() => void scan());
    } catch (cause) {
      stopCamera();
      setCameraError(cause instanceof Error && cause.name === "NotAllowedError"
        ? "Dostop do kamere je zavrnjen. Dovolite kamero ali uporabite 2D čitalnik/ročni vnos."
        : "Kamere ni mogoče zagnati. Uporabite 2D čitalnik ali ročni vnos.");
    }
  };

  const onValueChange = (nextValue: string) => {
    // The scanned value must become the current value synchronously: React's
    // controlled-prop render happens after this handler returns, while
    // verification starts immediately.
    currentValueRef.current = nextValue;
    onChange(nextValue);
    setPreview(null);
    setError(null);
    onVerified(null);
  };
  const payableCentsActual = Math.max(0, Math.min(preview?.balanceCents ?? 0, payableCents));

  return (
    <section className="space-y-3 rounded-lg border border-violet-200 bg-violet-50/60 p-3" data-testid="individual-voucher-scanner">
      <div>
        <h3 className="flex items-center gap-2 text-sm font-semibold text-violet-950">
          <ScanLine className="h-4 w-4" /> Individualni spletni darilni bon
        </h3>
        <p className="mt-1 text-xs text-violet-900">
          Skenirajte QR-kodo, uporabite 2D čitalnik (koda + Enter) ali jo vnesite ročno. Ta bon ima svoje preverjeno dobroimetje.
        </p>
      </div>
      <div className="flex flex-wrap gap-2">
        {!cameraActive ? (
          <Button type="button" variant="outline" size="sm" onClick={() => void startCamera()} data-testid="button-individual-voucher-camera">
            <Camera className="mr-2 h-4 w-4" /> Zaženi kamero
          </Button>
        ) : (
          <Button type="button" variant="outline" size="sm" onClick={stopCamera} data-testid="button-individual-voucher-camera-stop">
            <CameraOff className="mr-2 h-4 w-4" /> Ustavi kamero
          </Button>
        )}
      </div>
      <video
        ref={videoRef}
        className="max-h-56 w-full rounded-md bg-black object-contain"
        style={{ display: cameraActive ? undefined : "none" }}
        muted
        playsInline
        aria-label="Predogled kamere za skeniranje bona"
      />
      {cameraError && <p className="text-xs text-amber-800" role="status" data-testid="status-individual-voucher-camera">{cameraError}</p>}
      <div className="flex gap-2">
        <Input
          aria-label="Koda individualnega bona"
          autoComplete="off"
          autoFocus
          value={value}
          onChange={event => onValueChange(event.target.value)}
          onKeyDown={event => {
            if (event.key === "Enter") {
              event.preventDefault();
              void verifyCode(value);
            }
          }}
          placeholder="Skenirajte ali vnesite kodo"
          data-testid="input-individual-voucher-code"
        />
        <Button type="button" variant="outline" onClick={() => void verifyCode(value)} disabled={loading || !value.trim()} data-testid="button-individual-voucher-verify">
          {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : "Preveri"}
        </Button>
      </div>
      {loading && <p className="text-xs text-muted-foreground" role="status">Preverjanje bona …</p>}
      {error && <p className="flex items-center gap-1 text-xs text-destructive" role="alert" data-testid="error-individual-voucher"><AlertCircle className="h-3.5 w-3.5" />{error}</p>}
      {preview && (
        <div className="space-y-1 rounded-md border border-violet-200 bg-white p-3 text-sm" data-testid="preview-individual-voucher">
          <p className="font-medium">Preverjen bon · koda …{preview.codeSuffix}</p>
          <p className="text-muted-foreground">Razpoložljivo dobroimetje: <strong className="text-foreground">{(preview.balanceCents / 100).toFixed(2)} {preview.currency}</strong></p>
          <p className="font-semibold text-violet-900">Uporabi na tem računu največ: {(payableCentsActual / 100).toFixed(2)} {preview.currency}</p>
          {preview.expiresAt && <p className="text-xs text-muted-foreground">Velja do: {new Date(preview.expiresAt).toLocaleDateString("sl-SI")}</p>}
        </div>
      )}
    </section>
  );
}