import { useEffect, useRef, useState } from "react";
import { trackEvent } from "@/lib/analytics";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import * as z from "zod/v3";
import { getEnotaId, useCreateRezervacijaMize, useUpdateRezervacijaMize, getListMizeQueryKey, getListRazpolozljiveMizeQueryKey } from "@workspace/api-client-react";
import type { Miza, RezervacijaMize } from "@workspace/api-client-react";
import { useToast } from "@/hooks/use-toast";
import { useQueryClient } from "@tanstack/react-query";

export function parseLjubljanaDatetimeToISO(localDateTime: string): string {
  if (!localDateTime) return "";
  const [datePart, timePart] = localDateTime.split("T");
  if (!datePart || !timePart) return "";
  const [yyyy, MM, dd] = datePart.split("-").map(Number);
  const [HH, mm] = timePart.split(":").map(Number);

  if (isNaN(yyyy) || isNaN(MM) || isNaN(dd) || isNaN(HH) || isNaN(mm)) return "";

  const targetLocal = Date.UTC(yyyy, MM - 1, dd, HH, mm);

  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Ljubljana",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });

  function getLocalFromUTC(utcMs: number) {
    const parts = f.formatToParts(new Date(utcMs));
    const p: Record<string, string> = {};
    for (const part of parts) p[part.type] = part.value;
    return Date.UTC(
      Number(p.year),
      Number(p.month) - 1,
      Number(p.day),
      Number(p.hour),
      Number(p.minute),
      Number(p.second),
    );
  }

  let currentUtc = targetLocal;
  let currentLocal = getLocalFromUTC(currentUtc);
  let diff = targetLocal - currentLocal;
  currentUtc += diff;

  currentLocal = getLocalFromUTC(currentUtc);
  diff = targetLocal - currentLocal;
  if (diff !== 0) {
    currentUtc += diff;
  }

  return new Date(currentUtc).toISOString();
}

export function formatIsoToLjubljanaDatetimeLocal(isoString?: string | null): string {
  if (!isoString) return "";
  const d = new Date(isoString);
  if (isNaN(d.getTime())) return "";

  const f = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/Ljubljana",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  const parts = f.formatToParts(d);
  const p: Record<string, string> = {};
  for (const part of parts) {
    p[part.type] = part.value;
  }

  const YYYY = p.year;
  const MM = p.month.padStart(2, "0");
  const DD = p.day.padStart(2, "0");
  let HH = p.hour.padStart(2, "0");
  if (HH === "24") HH = "00";
  const mm = p.minute.padStart(2, "0");

  return `${YYYY}-${MM}-${DD}T${HH}:${mm}`;
}

const schema = z.object({
  telefon: z.string().trim().min(1, "Telefon je obvezen").max(50),
  strankaIme: z.string().trim().min(1, "Ime stranke je obvezno").max(200),
  email: z.string().trim().email("E-poštni naslov ni veljaven").or(z.literal("")),
  strankaOpombe: z.string().max(2000).optional().nullable(),
  zacetek: z.string().min(1, "Izberite čas"),
  opomba: z.string().max(2000).optional().nullable(),
}).refine(data => {
  const iso = parseLjubljanaDatetimeToISO(data.zacetek);
  const d = new Date(iso);
  return (
    !Number.isNaN(d.getTime())
    && formatIsoToLjubljanaDatetimeLocal(iso) === data.zacetek
    && d.getTime() > Date.now()
  );
}, {
  message: "Čas rezervacije mora biti v prihodnosti",
  path: ["zacetek"],
});

type FormValues = z.infer<typeof schema>;

export function RezervacijaDialog({
  miza,
  rezervacija,
  initialZacetek,
  open,
  onOpenChange,
}: {
  miza: Miza | null;
  rezervacija?: RezervacijaMize | null;
  initialZacetek?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const createRezervacija = useCreateRezervacijaMize();
  const updateRezervacija = useUpdateRezervacijaMize();
  const isPending = createRezervacija.isPending || updateRezervacija.isPending;
  const [iskanjeNarocnika, setIskanjeNarocnika] = useState(false);
  const [najdenNarocnik, setNajdenNarocnik] = useState<string | null>(null);
  const [preverjenTelefon, setPreverjenTelefon] = useState<string | null>(null);
  const [napakaIskanja, setNapakaIskanja] = useState(false);
  const [poskusIskanja, setPoskusIskanja] = useState(0);
  const [serverError, setServerError] = useState<string | null>(null);
  const najdenTelefonRef = useRef<string | null>(null);

  const form = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: {
      telefon: "",
      strankaIme: "",
      email: "",
      strankaOpombe: "",
      zacetek: "",
      opomba: "",
    },
  });

  const formRef = useRef<HTMLFormElement>(null);

  useEffect(() => {
    if (open && miza) {
      if (rezervacija) {
        form.reset({
          telefon: rezervacija.telefon || "",
          strankaIme: rezervacija.strankaIme || "",
          email: "",
          strankaOpombe: "",
          zacetek: rezervacija.zacetek ? formatIsoToLjubljanaDatetimeLocal(rezervacija.zacetek) : "",
          opomba: rezervacija.opomba || "",
        });
      } else {
        // Fallback or empty if new
        form.reset({
          telefon: "",
          strankaIme: "",
          email: "",
          strankaOpombe: "",
          zacetek: initialZacetek ? formatIsoToLjubljanaDatetimeLocal(initialZacetek) : "",
          opomba: "",
        });
      }
      setServerError(null);
      setTimeout(() => {
        const inputs = formRef.current?.querySelectorAll("input, textarea");
        if (inputs && inputs[0]) {
          (inputs[0] as HTMLElement).focus();
        }
      }, 50);
    } else if (!open) {
      form.reset();
      setNajdenNarocnik(null);
      setPreverjenTelefon(null);
      setNapakaIskanja(false);
      setServerError(null);
      najdenTelefonRef.current = null;
    }
  }, [open, miza, rezervacija, initialZacetek, form]);

  const telefon = form.watch("telefon");
  useEffect(() => {
    const iskaniTelefon = telefon?.trim() ?? "";
    setPreverjenTelefon(null);
    setNapakaIskanja(false);
    if (najdenTelefonRef.current && najdenTelefonRef.current !== iskaniTelefon) {
      najdenTelefonRef.current = null;
      setNajdenNarocnik(null);
      form.setValue("strankaIme", "");
      form.setValue("email", "");
      form.setValue("strankaOpombe", "");
    }
    if (!open || iskaniTelefon.replace(/\D/g, "").length < 6) {
      setIskanjeNarocnika(false);
      setNajdenNarocnik(null);
      return;
    }
    const controller = new AbortController();
    setIskanjeNarocnika(true);
    const timer = window.setTimeout(() => {
      const enotaId = getEnotaId();
      fetch(
        `${import.meta.env.BASE_URL.replace(/\/$/, "")}/api/narocniki/po-telefonu?telefon=${encodeURIComponent(iskaniTelefon)}`,
        {
          credentials: "include",
          headers: enotaId ? { "X-Enota-Id": enotaId } : {},
          signal: controller.signal,
        },
      )
        .then(async (response) => {
          if (response.status === 404) return null;
          if (!response.ok) throw new Error();
          return response.json() as Promise<{
            ime: string;
            email: string | null;
            opombe: string | null;
          }>;
        })
        .then((narocnik) => {
          if (controller.signal.aborted || form.getValues("telefon").trim() !== iskaniTelefon) return;
          setPreverjenTelefon(iskaniTelefon);
          if (!narocnik) {
            najdenTelefonRef.current = null;
            setNajdenNarocnik(null);
            return;
          }
          najdenTelefonRef.current = iskaniTelefon;
          setNajdenNarocnik(narocnik.ime);
          form.setValue("strankaIme", narocnik.ime);
          form.setValue("email", narocnik.email ?? "");
          form.setValue("strankaOpombe", narocnik.opombe ?? "");
        })
        .catch((error) => {
          if (error instanceof DOMException && error.name === "AbortError") return;
          setNajdenNarocnik(null);
          setNapakaIskanja(true);
        })
        .finally(() => {
          if (!controller.signal.aborted && form.getValues("telefon").trim() === iskaniTelefon) {
            setIskanjeNarocnika(false);
          }
        });
    }, 350);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [telefon, open, form, poskusIskanja]);

  const handleKeyDown = (e: React.KeyboardEvent, index: number) => {
    const target = e.target as HTMLElement;
    const isTextarea = target.tagName.toLowerCase() === "textarea";

    if (e.key === "Enter" && !isTextarea) {
      e.preventDefault();
      focusField(index + 1);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      focusField(index + 1);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusField(index - 1);
    }
  };

  const focusField = (index: number) => {
    if (!formRef.current) return;
    const inputs = Array.from(formRef.current.querySelectorAll("input, textarea")) as HTMLElement[];
    if (index >= 0 && index < inputs.length) {
      inputs[index].focus();
    }
  };

  const onSubmit = (values: FormValues) => {
    if (!miza) return;
    if (preverjenTelefon !== values.telefon.trim()) {
      toast({
        title: "Preverjanje telefona",
        description: "Počakajte, da se preverjanje telefonskega naročnika konča.",
        variant: "destructive",
      });
      return;
    }
    const stevilkaMize = miza.stevilka;
    const payload = {
      telefon: values.telefon.trim(),
      strankaIme: values.strankaIme.trim(),
      email: values.email.trim() || null,
      strankaOpombe: values.strankaOpombe?.trim() || null,
      zacetek: parseLjubljanaDatetimeToISO(values.zacetek),
      opomba: values.opomba?.trim() || null,
    };
    
    setServerError(null);

    const handleSuccess = () => {
      trackEvent("reservation_saved", {
        operation: rezervacija ? "updated" : "created",
      });
      queryClient.invalidateQueries({ queryKey: getListMizeQueryKey() });
      queryClient.invalidateQueries({ queryKey: getListRazpolozljiveMizeQueryKey() });
      toast({
        title: "Rezervacija shranjena",
        description: `Rezervacija za mizo ${stevilkaMize} uspešno shranjena.`,
      });
      onOpenChange(false);
    };

    const handleError = (err: any) => {
      const errMsg = err?.data?.error || "Napaka pri shranjevanju rezervacije.";
      setServerError(errMsg);
      toast({
        title: "Napaka",
        description: errMsg,
        variant: "destructive",
      });
    };

    if (rezervacija) {
      updateRezervacija.mutate(
        { id: miza.id, rezervacijaId: rezervacija.id, data: payload },
        { onSuccess: handleSuccess, onError: handleError }
      );
    } else {
      createRezervacija.mutate(
        { id: miza.id, data: payload },
        { onSuccess: handleSuccess, onError: handleError }
      );
    }
  };

  if (!miza) return null;

  const isUpdate = !!rezervacija;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[calc(100dvh-1rem)]">
        <DialogHeader>
          <DialogTitle>{isUpdate ? "Posodobi rezervacijo" : "Nova rezervacija"} - {miza.ime || `Miza ${miza.stevilka}`}</DialogTitle>
        </DialogHeader>

        {serverError && (
          <div className="bg-red-50 border border-red-200 text-red-700 px-3 py-2 rounded text-sm font-medium">
            {serverError}
          </div>
        )}

        <Form {...form}>
          <form ref={formRef} onSubmit={form.handleSubmit(onSubmit)} className="flex min-h-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 space-y-4 overflow-y-auto pr-1">
            <FormField
              control={form.control}
              name="telefon"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Telefon</FormLabel>
                  <FormControl>
                    <Input type="tel" {...field} value={field.value || ""} onKeyDown={(e) => handleKeyDown(e, 0)} />
                  </FormControl>
                  {iskanjeNarocnika && <p className="text-xs text-muted-foreground">Iščem naročnika…</p>}
                  {najdenNarocnik && <p className="text-xs text-green-700">Najden naročnik: {najdenNarocnik}</p>}
                  {napakaIskanja && (
                    <div className="flex items-center gap-2 text-xs text-destructive">
                      <span>Naročnika ni bilo mogoče preveriti.</span>
                      <Button
                        type="button"
                        variant="link"
                        size="sm"
                        className="h-auto p-0 text-xs"
                        onClick={() => setPoskusIskanja((poskus) => poskus + 1)}
                      >
                        Poskusi znova
                      </Button>
                    </div>
                  )}
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="strankaIme"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Stranka (ime in priimek)</FormLabel>
                  <FormControl>
                    <Input {...field} value={field.value || ""} onKeyDown={(e) => handleKeyDown(e, 1)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>E-pošta</FormLabel>
                  <FormControl>
                    <Input type="email" {...field} value={field.value || ""} onKeyDown={(e) => handleKeyDown(e, 2)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="strankaOpombe"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Opombe k stranki</FormLabel>
                  <FormControl>
                    <Textarea rows={2} {...field} value={field.value || ""} onKeyDown={(e) => handleKeyDown(e, 3)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="zacetek"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Začetek (čas)</FormLabel>
                  <FormControl>
                    <Input type="datetime-local" {...field} value={field.value || ""} onKeyDown={(e) => handleKeyDown(e, 4)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="opomba"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Opomba k rezervaciji</FormLabel>
                  <FormControl>
                    <Textarea rows={3} {...field} value={field.value || ""} onKeyDown={(e) => handleKeyDown(e, 5)} />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            </div>
            <DialogFooter className="shrink-0 border-t pt-4">
              <Button type="button" variant="outline" onClick={() => onOpenChange(false)} disabled={isPending}>
                Prekliči
              </Button>
              <Button
                type="submit"
                disabled={
                  isPending
                  || iskanjeNarocnika
                  || preverjenTelefon !== telefon?.trim()
                }
              >
                {isPending ? "Shranjujem..." : "Shrani"}
              </Button>
            </DialogFooter>
          </form>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
