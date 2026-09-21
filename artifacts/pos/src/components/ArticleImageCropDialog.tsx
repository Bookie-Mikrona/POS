import { type PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";

export const ARTICLE_IMAGE_ASPECT_RATIO = 2.5;
const OUTPUT_WIDTH = 1500;
const OUTPUT_HEIGHT = 600;

type CropPosition = { x: number; y: number };

export type CropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

type ImageSize = { width: number; height: number };

export function calculateCropRect(image: ImageSize, zoom: number, position: CropPosition): CropRect {
  const baseWidth = image.width / image.height > ARTICLE_IMAGE_ASPECT_RATIO
    ? image.height * ARTICLE_IMAGE_ASPECT_RATIO
    : image.width;
  const baseHeight = baseWidth / ARTICLE_IMAGE_ASPECT_RATIO;
  const safeZoom = Math.max(1, Math.min(3, zoom));
  const width = baseWidth / safeZoom;
  const height = baseHeight / safeZoom;
  const maxX = Math.max(0, (image.width - width) / 2);
  const maxY = Math.max(0, (image.height - height) / 2);
  const safeX = Math.max(-1, Math.min(1, position.x));
  const safeY = Math.max(-1, Math.min(1, position.y));

  return {
    width,
    height,
    x: (image.width - width) / 2 + safeX * maxX,
    y: (image.height - height) / 2 + safeY * maxY,
  };
}

type ArticleImageCropDialogProps = {
  file: File | null;
  open: boolean;
  isUploading: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (file: File) => void;
};

export function ArticleImageCropDialog({
  file,
  open,
  isUploading,
  onOpenChange,
  onConfirm,
}: ArticleImageCropDialogProps) {
  const [image, setImage] = useState<HTMLImageElement | null>(null);
  const [zoom, setZoom] = useState(1);
  const [position, setPosition] = useState<CropPosition>({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    position: CropPosition;
    crop: CropRect;
  } | null>(null);

  useEffect(() => {
    if (!file || !open) return;
    const url = URL.createObjectURL(file);
    const loadedImage = new Image();
    loadedImage.onload = () => {
      setImage(loadedImage);
      setZoom(1);
      setPosition({ x: 0, y: 0 });
      setError(null);
    };
    loadedImage.onerror = () => {
      setImage(null);
      setError("Izbrane slike ni mogoče prebrati.");
    };
    loadedImage.src = url;
    return () => URL.revokeObjectURL(url);
  }, [file, open]);

  const crop = useMemo(
    () => image ? calculateCropRect(image, zoom, position) : null,
    [image, zoom, position],
  );

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (!crop || !image) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    dragRef.current = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      position,
      crop,
    };
  };

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId || !image) return;
    const rect = event.currentTarget.getBoundingClientRect();
    const maxX = Math.max(0, (image.width - drag.crop.width) / 2);
    const maxY = Math.max(0, (image.height - drag.crop.height) / 2);
    setPosition({
      x: maxX === 0 ? 0 : Math.max(-1, Math.min(1, drag.position.x - ((event.clientX - drag.startX) / rect.width * drag.crop.width) / maxX)),
      y: maxY === 0 ? 0 : Math.max(-1, Math.min(1, drag.position.y - ((event.clientY - drag.startY) / rect.height * drag.crop.height) / maxY)),
    });
  };

  const finishDrag = (event: PointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
  };

  const handleConfirm = () => {
    if (!file || !image || !crop) return;
    const canvas = document.createElement("canvas");
    canvas.width = OUTPUT_WIDTH;
    canvas.height = OUTPUT_HEIGHT;
    const context = canvas.getContext("2d");
    if (!context) {
      setError("Brskalnik ne podpira priprave slike.");
      return;
    }
    context.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, OUTPUT_WIDTH, OUTPUT_HEIGHT);
    canvas.toBlob((blob) => {
      if (!blob) {
        setError("Izreza slike ni bilo mogoče pripraviti.");
        return;
      }
      const baseName = file.name.replace(/\.[^.]+$/, "") || "artikel";
       onConfirm(new File([blob], `${baseName}-2_5x1.webp`, { type: "image/webp" }));
    }, "image/webp", 0.92);
  };

  return (
    <Dialog open={open} onOpenChange={(nextOpen) => { if (!isUploading) onOpenChange(nextOpen); }}>
      <DialogContent
        className="w-[calc(100vw-2rem)] max-w-2xl"
        onEscapeKeyDown={(event) => { if (isUploading) event.preventDefault(); }}
        onPointerDownOutside={(event) => { if (isUploading) event.preventDefault(); }}
        onInteractOutside={(event) => { if (isUploading) event.preventDefault(); }}
      >
        <DialogHeader>
          <DialogTitle>Izreži sliko za QR meni</DialogTitle>
          <DialogDescription>Premaknite motiv in nastavite povečavo. Gostje bodo videli točno izbrani široki izsek 2,5 : 1.</DialogDescription>
        </DialogHeader>

        {error ? (
          <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive" role="alert">{error}</p>
        ) : crop && image ? (
          <div
             className="relative aspect-[2.5/1] w-full touch-none select-none overflow-hidden rounded-lg bg-muted shadow-inner"
            onPointerDown={handlePointerDown}
            onPointerMove={handlePointerMove}
            onPointerUp={finishDrag}
            onPointerCancel={finishDrag}
            role="application"
            aria-label="Izsek slike; povlecite za premik motiva"
          >
            <img
              src={image.src}
              alt=""
              draggable={false}
              className="pointer-events-none absolute max-w-none"
              style={{
                width: `${image.width / crop.width * 100}%`,
                height: `${image.height / crop.height * 100}%`,
                left: `${-crop.x / crop.width * 100}%`,
                top: `${-crop.y / crop.height * 100}%`,
              }}
            />
            <div className="pointer-events-none absolute inset-0 border-2 border-white/90 shadow-[inset_0_0_0_1px_rgba(0,0,0,0.25)]" />
          </div>
        ) : (
           <div className="flex aspect-[2.5/1] items-center justify-center rounded-lg bg-muted text-sm text-muted-foreground">Nalagam sliko …</div>
        )}

        <label className="space-y-2">
          <span className="text-sm font-medium">Povečava: {zoom.toFixed(2)}×</span>
          <input
            type="range"
            min="1"
            max="3"
            step="0.01"
            value={zoom}
            disabled={!image || isUploading}
            onChange={(event) => setZoom(Number(event.target.value))}
            className="w-full accent-primary"
            aria-label="Povečava slike"
          />
        </label>

        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isUploading}>Prekliči</Button>
          <Button type="button" onClick={handleConfirm} disabled={!crop || isUploading}>{isUploading ? "Nalaganje …" : "Uporabi izsek"}</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}