import React, { useEffect, useState } from "react";
import { useForm, useFieldArray, Control } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod/v3";
import { format, parseISO } from "date-fns";
import { sl } from "date-fns/locale";
import { Loader2, Save, CalendarIcon, Plus, Trash2, Link as LinkIcon, Store, Palette, CalendarClock, Gift, Clock, Trash, AlertTriangle, CheckCircle2, Upload, ImageIcon, X, Eye, Monitor, Smartphone } from "lucide-react";
import { PublicVenueView, type PreviewVoucherProduct } from "@workspace/public-venue-ui";

import { useToast } from "@/hooks/use-toast";
import { usePublicProfileStagingImages } from "@/hooks/usePublicProfileStagingImages";
import { useAuth } from "@/contexts/AuthContext";
import { StripeConnectOnboardingCard } from "@/components/StripeConnectOnboardingCard";
import { useQueryClient } from "@tanstack/react-query";
import {
  useGetJavniProfilNastavitve,
  getGetJavniProfilNastavitveQueryKey,
  useUpdateJavniProfilNastavitve,
  useListStripePreglediBonov,
  getListStripePreglediBonovQueryKey,
  useResiStripePregledBona,
  requestJavniProfilImageUpload,
  deleteJavniProfilImage,
  type JavnaRestavracija,
  type JavniProfilNastavitveInput,
} from "@workspace/api-client-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Form, FormControl, FormDescription, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Calendar } from "@/components/ui/calendar";
import { Separator } from "@/components/ui/separator";

const intervalSchema = z.object({
  od: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Obvezen format HH:MM"),
  do: z.string().regex(/^([01][0-9]|2[0-3]):[0-5][0-9]$/, "Obvezen format HH:MM"),
});

const danSchema = z.object({
  dan: z.number().min(1).max(7),
  odprto: z.boolean(),
  intervals: z.array(intervalSchema),
});

const izjemaSchema = z.object({
  datum: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Format YYYY-MM-DD"),
  zaprto: z.boolean(),
  intervals: z.array(intervalSchema),
});

const variantSchema = z.object({
  id: z.string().optional(),
  naziv: z.string().min(1, "Vnesite naziv variant").max(120),
  amountEur: z.coerce.number().min(0.01, "Vrednost mora biti večja od 0"),
  active: z.boolean(),
});

const imageValueSchema = z.union([
  z.string().url("Neveljavna povezava slike"),
  z.string().regex(/^\/objects\/uploads\/public-profile(?:-staging)?\/.+/, "Neveljavna pot slike"),
  z.literal(""),
  z.null(),
]).optional();

const bonSchema = z.object({
  id: z.string().optional(),
  naziv: z.string().min(1, "Vnesite naziv bona").max(160),
  opis: z.string().nullable().optional(),
  imageUrl: imageValueSchema,
  active: z.boolean(),
  variants: z.array(variantSchema),
});

const formSchema = z.object({
  slug: z.string().min(3).max(80).regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Samo male črke, številke in vezaji"),
  active: z.boolean(),
  description: z.string().nullable().optional(),
  address: z.string().nullable().optional(),
  phone: z.string().nullable().optional(),
  email: z.union([z.string().email("Neveljaven e-mail"), z.literal(""), z.null()]).optional(),
  website: z.union([z.string().url("Neveljaven URL (vključite http/https)"), z.literal(""), z.null()]).optional(),
  primaryColor: z.string().regex(/^#[0-9A-Fa-f]{6}$/, "Format #RRGGBB"),
  logoUrl: imageValueSchema,
  coverImageUrl: imageValueSchema,
  maxPartySize: z.coerce.number().min(1, "Najmanj 1").max(100),
  slotMinutes: z.coerce.number().min(15).max(240),
  slotCapacity: z.coerce.number().min(1).max(10000),
  openingHours: z.array(danSchema),
  dateExceptions: z.array(izjemaSchema),
  products: z.array(bonSchema),
});

type FormValues = z.infer<typeof formSchema>;

const DNEVI = ["Ponedeljek", "Torek", "Sreda", "Četrtek", "Petek", "Sobota", "Nedelja"];
const IMAGE_MAX_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);

function managedImageObjectId(value: string | null | undefined) {
  if (!value || !/^\/objects\/uploads\/public-profile(?:-staging)?\//.test(value)) return null;
  const objectId = value.split("/").at(-1) ?? "";
  return /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(objectId) ? objectId : null;
}

function managedImageSrc(value: string | null | undefined) {
  if (!value?.startsWith("/objects/uploads/public-profile/")) return value ?? "";
  const objectId = managedImageObjectId(value);
  return objectId ? `/api/javno/slike/${objectId}` : value ?? "";
}

function ImageUploadField({
  value,
  onChange,
  onLocalPreviewChange,
  onStagingImageUploaded,
  onManagedImageDeleted,
  label,
  description,
  previewClassName,
  testId,
}: {
  value: string | null | undefined;
  onChange: (value: string) => void;
  onLocalPreviewChange?: (url: string | null) => void;
  onStagingImageUploaded: (objectPath: string) => void;
  onManagedImageDeleted: (objectPath: string | null | undefined) => void;
  label: string;
  description: string;
  previewClassName: string;
  testId: string;
}) {
  const { toast } = useToast();
  const [isUploading, setIsUploading] = useState(false);
  const [localPreview, setLocalPreview] = useState<string | null>(null);

  useEffect(() => () => {
    if (localPreview && !onLocalPreviewChange) URL.revokeObjectURL(localPreview);
  }, [localPreview, onLocalPreviewChange]);

  const removeCurrent = async () => {
    const objectId = managedImageObjectId(value);
    try {
      if (objectId) await deleteJavniProfilImage(objectId);
      onManagedImageDeleted(value);
      setLocalPreview(null);
      onLocalPreviewChange?.(null);
      onChange("");
    } catch (error) {
      toast({
        title: "Slike ni bilo mogoče odstraniti",
        description: error instanceof Error ? error.message : "Poskusite znova.",
        variant: "destructive",
      });
    }
  };

  const upload = async (file: File) => {
    if (!IMAGE_TYPES.has(file.type)) {
      toast({ title: "Izberite sliko JPG, PNG ali WEBP.", variant: "destructive" });
      return;
    }
    if (file.size < 1 || file.size > IMAGE_MAX_BYTES) {
      toast({ title: "Slika je lahko velika največ 5 MB.", variant: "destructive" });
      return;
    }
    setIsUploading(true);
    let uploadedObjectId: string | null = null;
    try {
      const target = await requestJavniProfilImageUpload({
        name: file.name,
        size: file.size,
        contentType: file.type as "image/jpeg" | "image/png" | "image/webp",
      });
      uploadedObjectId = managedImageObjectId(target.objectPath);
      const response = await fetch(target.uploadURL, {
        method: "PUT",
        headers: { "Content-Type": file.type },
        body: file,
      });
      if (!response.ok) throw new Error(`Prenos slike ni uspel (${response.status}).`);
      const previousObjectId = managedImageObjectId(value);
      if (previousObjectId && previousObjectId !== uploadedObjectId) {
        await deleteJavniProfilImage(previousObjectId);
        onManagedImageDeleted(value);
      }
      const newUrl = URL.createObjectURL(file);
      setLocalPreview(current => {
        if (current && !onLocalPreviewChange) URL.revokeObjectURL(current);
        return newUrl;
      });
      onLocalPreviewChange?.(newUrl);
      onStagingImageUploaded(target.objectPath);
      onChange(target.objectPath);
    } catch (error) {
      if (uploadedObjectId) deleteJavniProfilImage(uploadedObjectId).catch(() => {});
      toast({
        title: "Slike ni bilo mogoče naložiti",
        description: error instanceof Error ? error.message : "Poskusite znova.",
        variant: "destructive",
      });
    } finally {
      setIsUploading(false);
    }
  };

  const src = localPreview || managedImageSrc(value);
  return (
    <div className="space-y-3">
      <div>
        <Label>{label}</Label>
        <p className="mt-1 text-sm text-muted-foreground">{description}</p>
      </div>
      {src ? (
        <div className="relative overflow-hidden rounded-md border bg-muted/30">
          <img src={src} alt={`${label} – predogled`} className={previewClassName} />
          <Button type="button" variant="secondary" size="icon" className="absolute right-2 top-2 h-8 w-8" onClick={removeCurrent} disabled={isUploading} data-testid={`${testId}-remove`}>
            <X className="h-4 w-4" />
            <span className="sr-only">Odstrani sliko</span>
          </Button>
        </div>
      ) : (
        <div className="flex min-h-28 items-center justify-center rounded-md border border-dashed bg-muted/20 text-muted-foreground">
          <ImageIcon className="h-8 w-8 opacity-40" />
        </div>
      )}
      <Button type="button" variant="outline" size="sm" disabled={isUploading} asChild>
        <label className="cursor-pointer">
          {isUploading ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Upload className="mr-2 h-4 w-4" />}
          {value ? "Zamenjaj sliko" : "Naloži sliko"}
          <input
            type="file"
            className="sr-only"
            accept="image/jpeg,image/png,image/webp"
            disabled={isUploading}
            onChange={event => {
              const file = event.target.files?.[0];
              event.target.value = "";
              if (file) upload(file);
            }}
            data-testid={testId}
          />
        </label>
      </Button>
      <p className="text-xs text-muted-foreground">JPG, PNG ali WEBP, največ 5 MB.</p>
    </div>
  );
}

function UrnikDanEditor({ control, dayIndex }: { control: Control<FormValues>; dayIndex: number }) {
  const { fields, append, remove } = useFieldArray({ name: `openingHours.${dayIndex}.intervals`, control });
  return (
    <div className="flex flex-col gap-3">
      {fields.map((field, idx) => (
        <div key={field.id} className="flex items-center gap-3">
          <FormField
            control={control}
            name={`openingHours.${dayIndex}.intervals.${idx}.od`}
            render={({ field }) => (
              <FormItem className="flex-1 space-y-0">
                <FormControl>
                  <Input {...field} type="time" data-testid={`input-urnik-dan-${dayIndex}-od-${idx}`} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <span className="text-muted-foreground text-sm font-medium">–</span>
          <FormField
            control={control}
            name={`openingHours.${dayIndex}.intervals.${idx}.do`}
            render={({ field }) => (
              <FormItem className="flex-1 space-y-0">
                <FormControl>
                  <Input {...field} type="time" data-testid={`input-urnik-dan-${dayIndex}-do-${idx}`} />
                </FormControl>
                <FormMessage />
              </FormItem>
            )}
          />
          <Button type="button" variant="ghost" size="icon" onClick={() => remove(idx)} className="h-9 w-9 text-muted-foreground hover:text-destructive shrink-0">
            <Trash2 className="h-4 w-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="outline" size="sm" className="w-fit" onClick={() => append({ od: "08:00", do: "22:00" })}>
        <Plus className="mr-2 h-4 w-4" /> Dodaj interval
      </Button>
    </div>
  );
}

function UrnikIzjemaEditor({ control, index, remove }: { control: Control<FormValues>; index: number; remove: () => void }) {
  const { fields, append, remove: removeInterval } = useFieldArray({ name: `dateExceptions.${index}.intervals`, control });
  
  return (
    <Card className="shadow-sm">
      <CardHeader className="p-4 pb-0 flex flex-row items-start justify-between">
        <FormField
          control={control}
          name={`dateExceptions.${index}.datum`}
          render={({ field }) => {
            const dateObj = field.value ? parseISO(field.value) : undefined;
            return (
              <FormItem className="flex flex-col">
                <FormLabel>Datum izjeme</FormLabel>
                <Popover>
                  <PopoverTrigger asChild>
                    <FormControl>
                      <Button variant="outline" className={`w-[200px] pl-3 text-left font-normal ${!field.value && "text-muted-foreground"}`} data-testid={`button-izjema-datum-${index}`}>
                        {field.value ? format(dateObj!, "dd.MM.yyyy") : "Izberi datum"}
                        <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                      </Button>
                    </FormControl>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar mode="single" selected={dateObj} onSelect={(d) => field.onChange(d ? format(d, "yyyy-MM-dd") : "")} initialFocus />
                  </PopoverContent>
                </Popover>
                <FormMessage />
              </FormItem>
            );
          }}
        />
        <Button type="button" variant="ghost" size="icon" onClick={remove} className="text-muted-foreground hover:text-destructive">
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="p-4 space-y-4">
        <FormField
          control={control}
          name={`dateExceptions.${index}.zaprto`}
          render={({ field }) => (
            <FormItem className="flex items-center gap-3 space-y-0 rounded-md border p-3">
              <FormControl>
                <Switch checked={field.value} onCheckedChange={field.onChange} data-testid={`switch-izjema-zaprto-${index}`} />
              </FormControl>
              <div className="space-y-1 leading-none">
                <FormLabel>Zaprto cel dan</FormLabel>
                <FormDescription>Na ta dan ne sprejemamo rezervacij.</FormDescription>
              </div>
            </FormItem>
          )}
        />
        <FormField
          control={control}
          name={`dateExceptions.${index}.zaprto`}
          render={({ field }) => !field.value ? (
            <div className="space-y-3">
              <Label>Prilagojen delovni čas</Label>
              {fields.map((f, i) => (
                <div key={f.id} className="flex items-center gap-3">
                  <FormField
                    control={control}
                    name={`dateExceptions.${index}.intervals.${i}.od`}
                    render={({ field: fOd }) => (
                      <FormItem className="flex-1 space-y-0">
                        <FormControl>
                          <Input {...fOd} type="time" data-testid={`input-izjema-${index}-od-${i}`} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <span className="text-muted-foreground text-sm font-medium">–</span>
                  <FormField
                    control={control}
                    name={`dateExceptions.${index}.intervals.${i}.do`}
                    render={({ field: fDo }) => (
                      <FormItem className="flex-1 space-y-0">
                        <FormControl>
                          <Input {...fDo} type="time" data-testid={`input-izjema-${index}-do-${i}`} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <Button type="button" variant="ghost" size="icon" onClick={() => removeInterval(i)} className="h-9 w-9 text-muted-foreground hover:text-destructive shrink-0">
                    <Trash2 className="h-4 w-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={() => append({ od: "08:00", do: "22:00" })}>
                <Plus className="mr-2 h-4 w-4" /> Dodaj interval
              </Button>
            </div>
          ) : <></>}
        />
      </CardContent>
    </Card>
  );
}

function BonEditor({
  control,
  index,
  remove,
  onLocalPreviewChange,
  onStagingImageUploaded,
  onManagedImageDeleted,
}: {
  control: Control<FormValues>;
  index: number;
  remove: () => void;
  onLocalPreviewChange: (url: string | null) => void;
  onStagingImageUploaded: (objectPath: string) => void;
  onManagedImageDeleted: (objectPath: string | null | undefined) => void;
}) {
  const { fields: variants, append: addVariant, remove: removeVariant } = useFieldArray({ name: `products.${index}.variants`, control });
  
  return (
    <Card className="shadow-sm">
      <CardHeader className="p-4 flex flex-row items-start justify-between bg-muted/20 border-b">
        <div className="space-y-1">
          <CardTitle className="text-base">Darilni bon</CardTitle>
          <CardDescription>Uredite podrobnosti bona in njegove različice (vrednosti).</CardDescription>
        </div>
        <Button type="button" variant="ghost" size="icon" onClick={remove} className="text-muted-foreground hover:text-destructive" data-testid={`button-remove-bon-${index}`}>
          <Trash2 className="h-4 w-4" />
        </Button>
      </CardHeader>
      <CardContent className="p-4 space-y-6">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <FormField control={control} name={`products.${index}.naziv`} render={({ field }) => (
            <FormItem className="md:col-span-2">
              <FormLabel>Naziv bona</FormLabel>
              <FormControl><Input {...field} data-testid={`input-bon-naziv-${index}`} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={control} name={`products.${index}.opis`} render={({ field }) => (
            <FormItem className="md:col-span-2">
              <FormLabel>Kratek opis</FormLabel>
              <FormControl><Textarea {...field} value={field.value || ""} className="resize-none" data-testid={`input-bon-opis-${index}`} /></FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={control} name={`products.${index}.imageUrl`} render={({ field }) => (
            <FormItem className="md:col-span-2">
              <FormControl>
                <ImageUploadField
                  value={field.value}
                  onChange={field.onChange}
                  onLocalPreviewChange={onLocalPreviewChange}
                  onStagingImageUploaded={onStagingImageUploaded}
                  onManagedImageDeleted={onManagedImageDeleted}
                  label="Slika bona"
                  description="Slika se prikaže ob ponudbi tega bona."
                  previewClassName="h-48 w-full object-cover"
                  testId={`input-bon-image-${index}`}
                />
              </FormControl>
              <FormMessage />
            </FormItem>
          )} />
          <FormField control={control} name={`products.${index}.active`} render={({ field }) => (
            <FormItem className="flex items-center gap-3 space-y-0 rounded-md border p-3">
              <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} data-testid={`switch-bon-active-${index}`} /></FormControl>
              <div className="space-y-1 leading-none"><FormLabel>Javno prikazan</FormLabel></div>
            </FormItem>
          )} />
        </div>
        
        <div className="space-y-4 pt-4 border-t">
          <div className="flex items-center justify-between">
            <h4 className="text-sm font-semibold">Različice (vrednosti)</h4>
            <Button type="button" variant="outline" size="sm" onClick={() => addVariant({ naziv: "Vrednost", amountEur: 50, active: true })} data-testid={`button-add-variant-${index}`}>
              <Plus className="mr-2 h-4 w-4" /> Dodaj različico
            </Button>
          </div>
          
          <div className="space-y-3">
            {variants.map((v, vIndex) => (
              <div key={v.id} className="flex flex-col sm:flex-row items-start sm:items-center gap-3 p-3 border rounded-md bg-muted/10">
                <FormField control={control} name={`products.${index}.variants.${vIndex}.naziv`} render={({ field }) => (
                  <FormItem className="flex-1 w-full space-y-1">
                    <FormLabel className="text-xs">Naziv različice</FormLabel>
                    <FormControl><Input {...field} className="h-8 text-sm" data-testid={`input-variant-naziv-${index}-${vIndex}`} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={control} name={`products.${index}.variants.${vIndex}.amountEur`} render={({ field }) => (
                  <FormItem className="w-full sm:w-32 space-y-1">
                    <FormLabel className="text-xs">Cena (EUR)</FormLabel>
                    <FormControl><Input {...field} type="number" step="0.01" className="h-8 text-sm" data-testid={`input-variant-cena-${index}-${vIndex}`} /></FormControl>
                    <FormMessage />
                  </FormItem>
                )} />
                <FormField control={control} name={`products.${index}.variants.${vIndex}.active`} render={({ field }) => (
                  <FormItem className="flex items-center gap-2 space-y-0 sm:pt-6">
                    <FormControl><Switch checked={field.value} onCheckedChange={field.onChange} data-testid={`switch-variant-active-${index}-${vIndex}`} /></FormControl>
                    <FormLabel className="text-xs font-normal">Aktivno</FormLabel>
                  </FormItem>
                )} />
                <Button type="button" variant="ghost" size="icon" onClick={() => removeVariant(vIndex)} className="sm:mt-6 h-8 w-8 text-muted-foreground hover:text-destructive shrink-0">
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            ))}
            {variants.length === 0 && (
              <div className="text-center p-4 border border-dashed rounded-md text-sm text-muted-foreground">
                Bon nima različic. Dodajte vsaj eno, da bo na voljo za prodajo.
              </div>
            )}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

function StripePaymentReviews({ enotaId }: { enotaId?: number }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const baseKey = getListStripePreglediBonovQueryKey();
  const queryKey = enotaId ? [...baseKey, enotaId] : baseKey;
  const { data: reviews = [] } = useListStripePreglediBonov({
    query: { queryKey, enabled: !!enotaId, refetchInterval: 60_000, retry: false },
  });
  const resolveReview = useResiStripePregledBona({
    mutation: {
      onSuccess: (result) => {
        toast({ title: "Primer je rešen", description: result.message });
        setSelectedId(null);
        setNote("");
        queryClient.invalidateQueries({ queryKey });
      },
      onError: (error) => {
        toast({
          title: "Primera ni bilo mogoče rešiti",
          description: error instanceof Error ? error.message : "Poskusite znova.",
          variant: "destructive",
        });
      },
    },
  });
  if (!reviews.length) return null;
  const money = (cents: number | null | undefined, currency: string | null | undefined) => {
    if (cents == null) return "ni podatka";
    const code = /^[A-Z]{3}$/.test(currency ?? "") ? currency! : "EUR";
    return (cents / 100).toLocaleString("sl-SI", { style: "currency", currency: code });
  };

  return (
    <Card className="border-amber-300 bg-amber-50/50 shadow-sm" data-testid="card-stripe-payment-reviews">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-amber-950">
          <AlertTriangle className="h-5 w-5 text-amber-700" />
          Stripe plačila za ročno uskladitev
        </CardTitle>
        <CardDescription>
          Plačilo je podpisano, vendar se ne ujema z nakupom. Bon ni bil izdan in njegov saldo ni bil spremenjen.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {reviews.map(review => (
          <div key={review.id} className="space-y-3 rounded-md border border-amber-200 bg-background p-4" data-testid={`stripe-review-${review.id}`}>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="space-y-1">
                <p className="font-semibold text-foreground">{review.reason}</p>
                <p className="text-xs text-muted-foreground">
                  {new Intl.DateTimeFormat("sl-SI", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(review.createdAt))}
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={() => {
                setSelectedId(current => current === review.id ? null : review.id);
                setNote("");
              }}>
                <CheckCircle2 className="mr-2 h-4 w-4" />
                Ročno razreši
              </Button>
            </div>
            <dl className="grid grid-cols-1 gap-2 text-sm md:grid-cols-2">
              <div><dt className="text-muted-foreground">Stripe event ID</dt><dd className="break-all font-mono text-xs">{review.eventId}</dd></div>
              <div><dt className="text-muted-foreground">Stripe session ID</dt><dd className="break-all font-mono text-xs">{review.sessionId}</dd></div>
              <div><dt className="text-muted-foreground">Pričakovani znesek</dt><dd className="font-medium">{money(review.expectedAmountCents, review.expectedCurrency)}</dd></div>
              <div><dt className="text-muted-foreground">Prejeti znesek</dt><dd className="font-medium">{money(review.receivedAmountCents, review.receivedCurrency)}</dd></div>
              <div><dt className="text-muted-foreground">Tenant</dt><dd className="break-all font-mono text-xs">{review.companyId} / enota {review.unitId ?? review.metadataUnitId ?? "ni podatka"}</dd></div>
              <div><dt className="text-muted-foreground">Tenant v dogodku</dt><dd className="break-all font-mono text-xs">{review.metadataCompanyId ?? "ni podatka"} / {review.metadataUnitId ?? "ni podatka"}</dd></div>
            </dl>
            {selectedId === review.id && (
              <div className="space-y-2 border-t pt-3">
                <Label htmlFor={`stripe-review-note-${review.id}`}>Pojasnilo ročne rešitve</Label>
                <Textarea
                  id={`stripe-review-note-${review.id}`}
                  value={note}
                  onChange={event => setNote(event.target.value)}
                  maxLength={1000}
                  placeholder="Npr. plačilo preverjeno v Stripe in vrnjeno kupcu."
                  data-testid="input-stripe-review-note"
                />
                <Button
                  type="button"
                  disabled={note.trim().length < 3 || resolveReview.isPending}
                  onClick={() => resolveReview.mutate({ reviewId: review.id, data: { note: note.trim() } })}
                  data-testid="button-resolve-stripe-review"
                >
                  {resolveReview.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                  Potrdi ročno rešitev
                </Button>
              </div>
            )}
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

export function PreviewOverlay({
  isOpen,
  onClose,
  formValues,
  enotaIme,
  localPreviews,
  productPreviewKeys,
}: {
  isOpen: boolean;
  onClose: () => void;
  formValues: FormValues;
  enotaIme: string;
  localPreviews: Record<string, string | null>;
  productPreviewKeys: string[];
}) {
  const [device, setDevice] = useState<"desktop" | "mobile">("desktop");

  useEffect(() => {
    if (!isOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", handleEscape);
    };
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const restaurant: JavnaRestavracija = {
    slug: formValues.slug,
    ime: enotaIme || "Ime enote",
    aktivna: formValues.active,
    opis: formValues.description ?? null,
    naslov: formValues.address ?? null,
    kontakt: {
      telefon: formValues.phone ?? null,
      email: formValues.email ?? null,
      spletnaStran: formValues.website ?? null,
    },
    openingHours: formValues.openingHours,
    maxPartySize: formValues.maxPartySize,
    branding: {
      primaryColor: formValues.primaryColor,
      logoUrl: localPreviews.logo || managedImageSrc(formValues.logoUrl),
      coverImageUrl: localPreviews.cover || managedImageSrc(formValues.coverImageUrl),
    },
  };

  const previewProducts: PreviewVoucherProduct[] = formValues.products.map((p, i) => ({
    id: p.id,
    naziv: p.naziv,
    opis: p.opis,
    imageUrl: localPreviews[`product_${productPreviewKeys[i]}`] || managedImageSrc(p.imageUrl),
    active: p.active,
    variants: p.variants.map(v => ({
      id: v.id,
      naziv: v.naziv,
      amountCents: Math.round(v.amountEur * 100),
      active: v.active,
    })),
  }));

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-background/80 backdrop-blur-sm" role="dialog" aria-modal="true" aria-labelledby="draft-preview-title">
      <div className="flex items-center justify-between gap-2 bg-background border-b px-3 py-3 shadow-sm sm:px-4">
        <div className="flex items-center gap-4">
           <Button variant="ghost" size="icon" onClick={onClose} aria-label="Zapri predogled" className="rounded-full" data-testid="button-close-preview-icon">
            <X className="h-5 w-5" />
          </Button>
          <div>
            <h2 id="draft-preview-title" className="font-semibold text-foreground leading-tight">Predogled osnutka</h2>
            <p className="text-xs text-muted-foreground">Osnutek javnega profila, spremembe niso shranjene</p>
          </div>
        </div>

        <div className="flex items-center gap-1 bg-muted/50 rounded-lg p-1 border">
          <Button
            variant={device === "desktop" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setDevice("desktop")}
            className="h-8 px-3 text-xs"
            data-testid="button-preview-desktop"
          >
            <Monitor className="mr-2 h-4 w-4" />
            Namizje
          </Button>
          <Button
            variant={device === "mobile" ? "secondary" : "ghost"}
            size="sm"
            onClick={() => setDevice("mobile")}
            className="h-8 px-3 text-xs"
            data-testid="button-preview-mobile"
          >
            <Smartphone className="mr-2 h-4 w-4" />
            Mobilno
          </Button>
        </div>

        <div className="hidden w-[150px] text-right md:block">
           <Button variant="default" size="sm" onClick={onClose} data-testid="button-close-preview">
             Zapri predogled
           </Button>
        </div>
      </div>

      <div className="flex-1 overflow-hidden p-4 md:p-6 flex justify-center bg-muted/30">
        <div
          className={`bg-background overflow-hidden shadow-2xl ring-1 ring-border rounded-xl transition-all duration-500 ease-in-out w-full flex flex-col ${device === "mobile" ? "max-w-[390px]" : "max-w-[1200px]"}`}
          data-testid="preview-device-frame"
        >
          <div className="h-8 bg-muted/50 border-b flex items-center justify-center gap-1.5 shrink-0">
            <div className="w-2 h-2 rounded-full bg-border/80"></div>
            <div className="w-2 h-2 rounded-full bg-border/80"></div>
            <div className="w-2 h-2 rounded-full bg-border/80"></div>
          </div>
          <div className="flex-1 overflow-auto bg-background">
            <PublicVenueView
              restaurant={restaurant}
              preview={true}
              previewProducts={previewProducts}
            />
          </div>
        </div>
      </div>
    </div>
  );
}

export default function JavnaStran() {
  const { user } = useAuth();
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const enotaId = user?.enotaId;
  const [localPreviews, setLocalPreviews] = useState<Record<string, string | null>>({});
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const stagedImages = usePublicProfileStagingImages();
  const localPreviewsRef = React.useRef(localPreviews);
  localPreviewsRef.current = localPreviews;

  const handleLocalPreviewChange = (key: string, url: string | null) => {
    setLocalPreviews(prev => {
      const previousUrl = prev[key];
      if (previousUrl?.startsWith("blob:") && previousUrl !== url) URL.revokeObjectURL(previousUrl);
      return { ...prev, [key]: url };
    });
  };

  useEffect(() => () => {
    Object.values(localPreviewsRef.current).forEach(url => {
      if (url?.startsWith("blob:")) URL.revokeObjectURL(url);
    });
  }, []);

  const jeAdmin = ["admin", "admin_enote", "superadmin"].includes(user?.vloga ?? "");
  // A Stripe account is shared by the whole company, so a unit administrator
  // must not be offered a company-wide account binding.
  const jeStripeConnectAdmin = ["admin", "superadmin"].includes(user?.vloga ?? "");

  const baseKey = getGetJavniProfilNastavitveQueryKey();
  const queryKey = enotaId ? [...baseKey, enotaId] : baseKey;

  const { data, isLoading } = useGetJavniProfilNastavitve({
    query: {
      queryKey,
      enabled: !!enotaId && jeAdmin,
      retry: false,
    },
  });

  const updateMutation = useUpdateJavniProfilNastavitve({
    mutation: {
      onSuccess: (_result, variables) => {
        stagedImages.markSaved([
          variables.data.logoUrl,
          variables.data.coverImageUrl,
          ...variables.data.products.map(product => product.imageUrl),
        ]);
        toast({ title: "Spremembe javnega profila so shranjene." });
        queryClient.invalidateQueries({ queryKey });
      },
      onError: (err: any) => {
        toast({
          title: "Napaka pri shranjevanju",
          description: err?.response?.data?.message || err.message,
          variant: "destructive",
        });
      },
    },
  });

  const defaultOpeningHours = Array.from({ length: 7 }, (_, i) => ({
    dan: i + 1,
    odprto: i < 5,
    intervals: i < 5 ? [{ od: "08:00", do: "22:00" }] : [],
  }));

  const form = useForm<FormValues>({
    resolver: zodResolver(formSchema),
    defaultValues: {
      slug: "",
      active: false,
      description: "",
      address: "",
      phone: "",
      email: "",
      website: "",
      primaryColor: "#000000",
      logoUrl: "",
      coverImageUrl: "",
      maxPartySize: 10,
      slotMinutes: 60,
      slotCapacity: 50,
      openingHours: defaultOpeningHours,
      dateExceptions: [],
      products: [],
    },
  });

  useEffect(() => {
    if (data) {
      form.reset({
        slug: data.slug,
        active: data.active,
        description: data.description ?? "",
        address: data.address ?? "",
        phone: data.phone ?? "",
        email: data.email ?? "",
        website: data.website ?? "",
        primaryColor: data.primaryColor ?? "#000000",
        logoUrl: data.logoUrl ?? "",
        coverImageUrl: data.coverImageUrl ?? "",
        maxPartySize: data.maxPartySize,
        slotMinutes: data.slotMinutes,
        slotCapacity: data.slotCapacity,
        openingHours: data.openingHours?.length === 7 ? data.openingHours : defaultOpeningHours,
        dateExceptions: data.dateExceptions ?? [],
        products: (data.products ?? []).map(p => ({
          id: p.id,
          naziv: p.naziv,
          opis: p.opis ?? "",
          imageUrl: p.imageUrl ?? "",
          active: p.active,
          variants: (p.variants ?? []).map(v => ({
            id: v.id,
            naziv: v.naziv,
            amountEur: v.amountCents / 100,
            active: v.active,
          })),
        })),
      });
    }
  }, [data, form]);

  const { fields: exceptions, append: addException, remove: removeException } = useFieldArray({ name: "dateExceptions", control: form.control });
  const { fields: products, append: addProduct, remove: removeProduct } = useFieldArray({ name: "products", control: form.control });

  if (!jeAdmin) {
    return (
      <div className="flex h-[80vh] items-center justify-center p-6 text-center">
        <div className="max-w-md space-y-4">
          <Store className="mx-auto h-12 w-12 text-muted-foreground opacity-20" />
          <h2 className="text-xl font-semibold">Omejen dostop</h2>
          <p className="text-muted-foreground" data-testid="status-no-access">
            Za urejanje javnega profila potrebujete administratorsko vlogo.
          </p>
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="flex h-[80vh] items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" />
      </div>
    );
  }

  const onSubmit = (values: FormValues) => {
    const payload: JavniProfilNastavitveInput = {
      slug: values.slug,
      active: values.active,
      description: values.description || null,
      address: values.address || null,
      phone: values.phone || null,
      email: values.email || null,
      website: values.website || null,
      primaryColor: values.primaryColor,
      logoUrl: values.logoUrl || null,
      coverImageUrl: values.coverImageUrl || null,
      maxPartySize: values.maxPartySize,
      slotMinutes: values.slotMinutes,
      slotCapacity: values.slotCapacity,
      openingHours: values.openingHours,
      dateExceptions: values.dateExceptions,
      products: values.products.map(p => ({
        id: p.id,
        naziv: p.naziv,
        opis: p.opis || null,
        imageUrl: p.imageUrl || null,
        active: p.active,
        variants: p.variants.map(v => ({
          id: v.id,
          naziv: v.naziv,
          amountCents: Math.round(v.amountEur * 100),
          active: v.active,
        })),
      })),
    };
    updateMutation.mutate({ data: payload });
  };

  return (
    <main className="mx-auto w-full max-w-5xl p-4 md:p-6 pb-32 pos-page-content" data-testid="page-javni-profil">
      <PreviewOverlay
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        formValues={form.getValues()}
        enotaIme={user?.enotaIme ?? ""}
        localPreviews={localPreviews}
        productPreviewKeys={products.map(product => product.id)}
      />
      <div className="mb-6 space-y-1 border-b pb-5">
        <h1 className="text-2xl font-bold tracking-tight">Javna stran in boni</h1>
        <p className="text-sm text-muted-foreground max-w-2xl">
          Upravljajte javno predstavitev vaše enote. Nastavite kontaktne podatke, vizualno podobo, odpiralni čas in ponudbo darilnih bonov, ki bodo na voljo vašim gostom.
        </p>
      </div>

      {jeStripeConnectAdmin && enotaId != null && <StripeConnectOnboardingCard enotaId={enotaId} />}

      <Form {...form}>
        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
          <Tabs defaultValue="splosno" className="w-full">
            <TabsList className="mb-6 h-auto flex-wrap p-1 gap-1 w-full justify-start border bg-muted/20">
              <TabsTrigger value="splosno" className="py-2.5 px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm" data-testid="tab-splosno">
                <Store className="h-4 w-4 mr-2" /> Splošno in kontakt
              </TabsTrigger>
              <TabsTrigger value="izgled" className="py-2.5 px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm" data-testid="tab-izgled">
                <Palette className="h-4 w-4 mr-2" /> Izgled
              </TabsTrigger>
              <TabsTrigger value="rezervacije" className="py-2.5 px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm" data-testid="tab-rezervacije">
                <CalendarClock className="h-4 w-4 mr-2" /> Rezervacije
              </TabsTrigger>
              <TabsTrigger value="urnik" className="py-2.5 px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm" data-testid="tab-urnik">
                <Clock className="h-4 w-4 mr-2" /> Delovni čas
              </TabsTrigger>
              <TabsTrigger value="boni" className="py-2.5 px-4 data-[state=active]:bg-background data-[state=active]:shadow-sm" data-testid="tab-boni">
                <Gift className="h-4 w-4 mr-2" /> Darilni boni
              </TabsTrigger>
            </TabsList>

            <TabsContent value="splosno" className="space-y-6 m-0 focus-visible:outline-none">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle>Osnovne informacije</CardTitle>
                  <CardDescription>Javni identifikator in opis vaše enote.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField control={form.control} name="slug" render={({ field }) => (
                      <FormItem>
                        <FormLabel>Povezava profila (slug)</FormLabel>
                        <FormControl>
                          <div className="flex items-center">
                            <span className="flex items-center justify-center h-10 px-3 border border-r-0 rounded-l-md bg-muted text-muted-foreground text-sm font-mono">
                              /bookie-obiski/
                            </span>
                            <Input {...field} className="rounded-l-none font-mono" data-testid="input-slug" />
                          </div>
                        </FormControl>
                        <FormDescription>Unikaten identifikator v URL naslovu.</FormDescription>
                        {data?.publicUrl && (
                          <a
                            href={data.publicUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"
                            data-testid="link-public-profile"
                          >
                            <LinkIcon className="h-3.5 w-3.5" />
                            Odpri objavljeno javno stran
                          </a>
                        )}
                        <FormMessage />
                      </FormItem>
                    )} />
                    
                    <FormField control={form.control} name="active" render={({ field }) => (
                      <FormItem className="flex items-start gap-3 space-y-0 rounded-md border p-4 bg-muted/5">
                        <FormControl>
                          <Switch checked={field.value} onCheckedChange={field.onChange} data-testid="switch-active" />
                        </FormControl>
                        <div className="space-y-1 leading-none">
                          <FormLabel>Javno prikazan profil</FormLabel>
                          <FormDescription>
                            Če je izklopljeno, javna stran ne bo dostopna in rezervacije/nakupi bonov ne bodo mogoči.
                          </FormDescription>
                        </div>
                      </FormItem>
                    )} />
                  </div>
                  
                  <FormField control={form.control} name="description" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kratek opis enote</FormLabel>
                      <FormControl>
                        <Textarea {...field} value={field.value || ""} className="min-h-[100px] resize-none" data-testid="input-description" />
                      </FormControl>
                      <FormDescription>Prikaže se na začetni javni strani.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                </CardContent>
              </Card>

              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle>Kontakt in lokacija</CardTitle>
                  <CardDescription>Podatki, s katerimi vas lahko gostje kontaktirajo.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-2 gap-6">
                  <FormField control={form.control} name="address" render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Fizični naslov</FormLabel>
                      <FormControl><Input {...field} value={field.value || ""} data-testid="input-address" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="phone" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Telefonska številka</FormLabel>
                      <FormControl><Input {...field} value={field.value || ""} data-testid="input-phone" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="email" render={({ field }) => (
                    <FormItem>
                      <FormLabel>E-poštni naslov</FormLabel>
                      <FormControl><Input {...field} value={field.value || ""} type="email" data-testid="input-email" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="website" render={({ field }) => (
                    <FormItem className="md:col-span-2">
                      <FormLabel>Uradna spletna stran</FormLabel>
                      <FormControl><Input {...field} value={field.value || ""} type="url" placeholder="https://" data-testid="input-website" /></FormControl>
                      <FormMessage />
                    </FormItem>
                  )} />
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="izgled" className="space-y-6 m-0 focus-visible:outline-none">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle>Vizualna podoba</CardTitle>
                  <CardDescription>Prilagodite izgled vaše javne strani.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-6">
                  <FormField control={form.control} name="primaryColor" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Glavna barva znamke</FormLabel>
                      <FormControl>
                        <div className="flex items-center gap-3">
                          <Input type="color" {...field} className="w-16 h-10 p-1 cursor-pointer" data-testid="input-color-picker" />
                          <Input {...field} className="font-mono uppercase w-32" data-testid="input-color-hex" />
                        </div>
                      </FormControl>
                      <FormDescription>Hex koda (npr. #FF5500). Ta barva bo uporabljena za gumbe in poudarke.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                  
                  <Separator />
                  
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    <FormField control={form.control} name="logoUrl" render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <ImageUploadField
                            value={field.value}
                            onChange={field.onChange}
                            onLocalPreviewChange={(url) => handleLocalPreviewChange("logo", url)}
                            onStagingImageUploaded={stagedImages.track}
                            onManagedImageDeleted={stagedImages.forget}
                            label="Logotip"
                            description="Najbolje deluje kvadratna ali okrogla slika."
                            previewClassName="mx-auto h-32 w-32 object-contain p-3"
                            testId="input-logo"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                    <FormField control={form.control} name="coverImageUrl" render={({ field }) => (
                      <FormItem>
                        <FormControl>
                          <ImageUploadField
                            value={field.value}
                            onChange={field.onChange}
                            onLocalPreviewChange={(url) => handleLocalPreviewChange("cover", url)}
                            onStagingImageUploaded={stagedImages.track}
                            onManagedImageDeleted={stagedImages.forget}
                            label="Naslovna slika"
                            description="Široka slika, prikazana na vrhu javne strani."
                            previewClassName="aspect-[21/9] w-full object-cover"
                            testId="input-cover"
                          />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )} />
                  </div>
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="rezervacije" className="space-y-6 m-0 focus-visible:outline-none">
              <Card className="shadow-sm">
                <CardHeader>
                  <CardTitle>Omejitve rezervacij</CardTitle>
                  <CardDescription>Pravila za sprejemanje spletnih rezervacij miz.</CardDescription>
                </CardHeader>
                <CardContent className="grid grid-cols-1 md:grid-cols-3 gap-6">
                  <FormField control={form.control} name="maxPartySize" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Maks. število oseb</FormLabel>
                      <FormControl><Input {...field} type="number" min={1} data-testid="input-max-party" /></FormControl>
                      <FormDescription>Največja dovoljena velikost posamezne rezervacije.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="slotMinutes" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Dolžina termina (min)</FormLabel>
                      <FormControl><Input {...field} type="number" step={15} min={15} data-testid="input-slot-minutes" /></FormControl>
                      <FormDescription>Predvideno trajanje rezervacije.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                  <FormField control={form.control} name="slotCapacity" render={({ field }) => (
                    <FormItem>
                      <FormLabel>Kapaciteta termina</FormLabel>
                      <FormControl><Input {...field} type="number" min={1} data-testid="input-slot-capacity" /></FormControl>
                      <FormDescription>Skupno število oseb, ki jih lahko sprejmete na en termin.</FormDescription>
                      <FormMessage />
                    </FormItem>
                  )} />
                </CardContent>
              </Card>
            </TabsContent>
            
            <TabsContent value="urnik" className="space-y-6 m-0 focus-visible:outline-none">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                <Card className="shadow-sm">
                  <CardHeader>
                    <CardTitle>Redni odpiralni čas</CardTitle>
                    <CardDescription>Določite standardne dneve in ure, ko obratujete.</CardDescription>
                  </CardHeader>
                  <CardContent className="space-y-6">
                    {DNEVI.map((danIme, i) => (
                      <div key={i} className="space-y-3 pb-4 border-b last:border-0 last:pb-0">
                        <FormField
                          control={form.control}
                          name={`openingHours.${i}.odprto`}
                          render={({ field }) => (
                            <FormItem className="flex items-center gap-3 space-y-0">
                              <FormControl>
                                <Switch checked={field.value} onCheckedChange={field.onChange} data-testid={`switch-urnik-dan-${i}`} />
                              </FormControl>
                              <FormLabel className="font-semibold text-base leading-none cursor-pointer">{danIme}</FormLabel>
                            </FormItem>
                          )}
                        />
                        {form.watch(`openingHours.${i}.odprto`) && (
                          <div className="pl-12">
                            <UrnikDanEditor control={form.control} dayIndex={i} />
                          </div>
                        )}
                      </div>
                    ))}
                  </CardContent>
                </Card>

                <div className="space-y-6">
                  <Card className="shadow-sm border-dashed">
                    <CardHeader className="bg-muted/10">
                      <CardTitle className="text-base flex items-center gap-2">
                        <CalendarClock className="h-4 w-4" /> Izjeme in prazniki
                      </CardTitle>
                      <CardDescription>
                        Definirajte specifične datume, ko je enota zaprta ali obratuje po prilagojenem urniku.
                      </CardDescription>
                    </CardHeader>
                    <CardContent className="p-4 pt-6 space-y-4 bg-muted/5">
                      {exceptions.map((field, index) => (
                        <UrnikIzjemaEditor key={field.id} control={form.control} index={index} remove={() => removeException(index)} />
                      ))}
                      {exceptions.length === 0 && (
                        <div className="text-center p-6 border rounded-md text-muted-foreground text-sm bg-background">
                          Ni vpisanih izjem.
                        </div>
                      )}
                    </CardContent>
                    <CardFooter className="p-4 pt-0 mt-4 bg-muted/5">
                      <Button type="button" variant="outline" className="w-full bg-background" onClick={() => addException({ datum: format(new Date(), "yyyy-MM-dd"), zaprto: true, intervals: [] })} data-testid="button-add-izjema">
                        <Plus className="mr-2 h-4 w-4" /> Dodaj novo izjemo
                      </Button>
                    </CardFooter>
                  </Card>
                </div>
              </div>
            </TabsContent>
            
            <TabsContent value="boni" className="space-y-6 m-0 focus-visible:outline-none">
              <StripePaymentReviews enotaId={enotaId} />
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-lg font-medium">Ponudba darilnih bonov</h3>
                  <p className="text-sm text-muted-foreground">Kateri boni in v katerih vrednostih se prodajajo na javni strani.</p>
                </div>
                <Button type="button" onClick={() => addProduct({ naziv: "Novi darilni bon", active: true, variants: [{ naziv: "Vrednost bona", amountEur: 50, active: true }] })} data-testid="button-add-bon">
                  <Plus className="mr-2 h-4 w-4" /> Dodaj bon
                </Button>
              </div>

              <div className="grid grid-cols-1 gap-6">
                {products.map((field, index) => (
                  <BonEditor
                    key={field.id}
                    control={form.control}
                    index={index}
                    remove={() => {
                      stagedImages.discard(form.getValues(`products.${index}.imageUrl`));
                      handleLocalPreviewChange(`product_${field.id}`, null);
                      removeProduct(index);
                    }}
                    onLocalPreviewChange={(url) => handleLocalPreviewChange(`product_${field.id}`, url)}
                    onStagingImageUploaded={stagedImages.track}
                    onManagedImageDeleted={stagedImages.forget}
                  />
                ))}
                {products.length === 0 && (
                  <Card className="border-dashed bg-muted/10">
                    <CardContent className="flex flex-col items-center justify-center p-12 text-center text-muted-foreground">
                      <Gift className="h-12 w-12 mb-3 opacity-20" />
                      <p className="font-medium text-foreground">Trenutno nimate darilnih bonov</p>
                      <p className="text-sm max-w-sm mt-1">Ustvarite prvi darilni bon, da omogočite spletno prodajo vašim gostom.</p>
                      <Button type="button" variant="outline" className="mt-6 bg-background" onClick={() => addProduct({ naziv: "Novi darilni bon", active: true, variants: [{ naziv: "Vrednost bona", amountEur: 50, active: true }] })}>
                        Dodaj prvi bon
                      </Button>
                    </CardContent>
                  </Card>
                )}
              </div>
            </TabsContent>
          </Tabs>

          <div className="fixed bottom-0 left-0 right-0 z-50 border-t bg-background/95 p-3 shadow-[0_-4px_15px_-10px_rgba(0,0,0,0.1)] backdrop-blur-md md:left-[var(--sidebar-width,240px)] transition-all">
            <div className="mx-auto flex w-full max-w-5xl items-center justify-between px-4">
              <div className="flex items-center gap-2 text-sm font-medium">
                {form.formState.isDirty ? (
                  <span className="text-amber-600 dark:text-amber-500 animate-pulse">Imate neshranjene spremembe</span>
                ) : (
                  <span className="text-muted-foreground">Vse spremembe so shranjene</span>
                )}
              </div>
              <div className="flex items-center gap-3">
                <Button variant="secondary" type="button" size="lg" onClick={() => setIsPreviewOpen(true)} data-testid="button-open-preview">
                  <Eye className="mr-2 h-4 w-4" />
                  Predogled
                </Button>
                <Button type="submit" size="lg" disabled={!form.formState.isDirty || updateMutation.isPending} data-testid="button-save">
                  {updateMutation.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Save className="mr-2 h-4 w-4" />}
                  Shrani nastavitve
                </Button>
              </div>
            </div>
          </div>
        </form>
      </Form>
    </main>
  );
}
