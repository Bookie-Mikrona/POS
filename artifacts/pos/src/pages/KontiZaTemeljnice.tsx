import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  AlertCircle,
  BookOpenCheck,
  Check,
  ChevronsUpDown,
  Loader2,
  RefreshCw,
  Save,
} from "lucide-react";
import {
  customFetch,
  getListAccountsQueryKey,
  useListAccounts,
  useListCounterparties,
  type AccountRecord,
} from "@workspace/api-client-react";
import { useAuth } from "@/contexts/AuthContext";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";
import { poslovniDatumZaCas } from "@/lib/posCas";

type BookingField = keyof PosBookingSettingsData;

interface PosBookingSettingsData {
  [key: string]: string | boolean | null | undefined;
  cashAccountId?: string | null;
  cardAccountId?: string | null;
  voucherAccountId?: string | null;
  advancePaymentsAccountId?: string | null;
  subsidyReceivableAccountId?: string | null;
  subsidyCounterpartyId?: string | null;
  warnGiftVoucherNegative?: boolean;
  otherPaymentAccountId?: string | null;
  contractReceivableTransitAccountId?: string | null;
  revenueMaterial95AccountId?: string | null;
  revenueMaterial22AccountId?: string | null;
  revenueMaterial5AccountId?: string | null;
  revenueGoods22AccountId?: string | null;
  revenueGoods95AccountId?: string | null;
  revenueGoods5AccountId?: string | null;
  revenueService22AccountId?: string | null;
  revenueService95AccountId?: string | null;
  revenueService5AccountId?: string | null;
  revenueServiceAccountId?: string | null;
  vat95AccountId?: string | null;
  vat5AccountId?: string | null;
  vat22AccountId?: string | null;
  inventoryMaterialAccountId?: string | null;
  inventoryGoodsAccountId?: string | null;
  payablesAccountId?: string | null;
  nabavaObracunAccountId?: string | null;
  inputVatAccountId?: string | null;
  inputVat22AccountId?: string | null;
  inputVat95AccountId?: string | null;
  inputVat5AccountId?: string | null;
  otherCostsAccountId?: string | null;
  cogsMaterialAccountId?: string | null;
  cogsGoodsAccountId?: string | null;
  kirArAccountId?: string | null;
  lastnaPorabaAccountId?: string | null;
  reprezentancaAccountId?: string | null;
  openingBalanceAccountId?: string | null;
  revenueAccountId?: string | null;
  vatLiabilityAccountId?: string | null;
  inventoryAccountId?: string | null;
  cogsAccountId?: string | null;
  vat5VatCodeId?: string | null;
  vat95VatCodeId?: string | null;
  vat22VatCodeId?: string | null;
  salesBookingFrequency?: "daily" | "monthly" | null;
  consumptionBookingFrequency?: "daily" | "monthly" | null;
  frequencyEffectiveFrom?: string | null;
}

interface VatCodeOption {
  id: string;
  code: string;
  description: string;
  rate: string;
}

interface FieldDefinition {
  field: BookingField;
  label: string;
  hint: string;
  prefixes?: string[];
  requiredRate?: number;
}

const ACCOUNT_GROUPS: { title: string; description: string; fields: FieldDefinition[] }[] = [
  {
    title: "Plačilni načini",
    description: "Debetni konti za prejeta plačila na POS.",
    fields: [
      { field: "cashAccountId", label: "Gotovina", hint: "Blagajniški konto", prefixes: ["10"] },
      { field: "cardAccountId", label: "Kartice", hint: "Prejeti kartični promet", prefixes: ["10", "12"] },
      { field: "voucherAccountId", label: "Bon za pico", hint: "Obstoječi tok študentskih bonov", prefixes: ["12"] },
      { field: "advancePaymentsAccountId", label: "Darilni boni (predplačila 230)", hint: "Konto 230: izdaja K, unovčitev D", prefixes: ["23"] },
      { field: "subsidyReceivableAccountId", label: "Študentski boni (terjatev 165)", hint: "D terjatev do MDDSZ/ŠOS", prefixes: ["16"] },
      { field: "otherPaymentAccountId", label: "Ostala plačila", hint: "Druga plačilna sredstva", prefixes: ["12", "16"] },
      { field: "contractReceivableTransitAccountId", label: "Pogodbene malice", hint: "Prehodna terjatev do mesečnega A-računa", prefixes: ["16"] },
    ],
  },
  {
    title: "Prihodki po vrsti × stopnji in izstopni DDV",
    description: "Kreditni konti za polno matriko prihodkov in izstopni DDV po stopnji.",
    fields: [
      { field: "revenueMaterial95AccountId", label: "Material 9,5 %", hint: "Prihodki – material", prefixes: ["76", "77"] },
      { field: "revenueMaterial22AccountId", label: "Material 22 %", hint: "Prihodki – material", prefixes: ["76", "77"] },
      { field: "revenueMaterial5AccountId", label: "Material 5 %", hint: "Prihodki – material", prefixes: ["76", "77"] },
      { field: "revenueGoods22AccountId", label: "Blago 22 %", hint: "Prihodki – blago", prefixes: ["76", "77"] },
      { field: "revenueGoods95AccountId", label: "Blago 9,5 %", hint: "Prihodki – blago", prefixes: ["76", "77"] },
      { field: "revenueGoods5AccountId", label: "Blago 5 %", hint: "Prihodki – blago", prefixes: ["76", "77"] },
      { field: "revenueService22AccountId", label: "Storitve 22 %", hint: "Prihodki od storitev", prefixes: ["760"] },
      { field: "revenueService95AccountId", label: "Storitve 9,5 %", hint: "Prihodki od storitev", prefixes: ["760"] },
      { field: "revenueService5AccountId", label: "Storitve 5 %", hint: "Prihodki od storitev", prefixes: ["760"] },
      { field: "vat5AccountId", label: "Izhodni DDV 5 %", hint: "Obveznost za DDV", prefixes: ["260"] },
      { field: "vat95AccountId", label: "Izhodni DDV 9,5 %", hint: "Obveznost za DDV", prefixes: ["26"] },
      { field: "vat22AccountId", label: "Izhodni DDV 22 %", hint: "Obveznost za DDV", prefixes: ["26"] },
    ],
  },
  {
    title: "Zaloge in prejemnice",
    description: "Konti za nabavo, zalogo in obveznosti do dobaviteljev.",
    fields: [
      { field: "inventoryMaterialAccountId", label: "Zaloga materiala", hint: "Prejem materiala", prefixes: ["31"] },
      { field: "inventoryGoodsAccountId", label: "Zaloga blaga", hint: "Prejem blaga", prefixes: ["66"] },
      { field: "payablesAccountId", label: "Obveznosti do dobaviteljev", hint: "Konto dobaviteljev", prefixes: ["22"] },
      { field: "inventoryAccountId", label: "Zaloga (stari fallback)", hint: "Za stare POS nastavitve", prefixes: ["3", "6"] },
    ],
  },
  {
    title: "Nabava in vstopni DDV",
    description: "Priprava kontov za nabavno temeljnico; v tem koraku se še ne knjiži.",
    fields: [
      { field: "nabavaObracunAccountId", label: "Obračun nabave", hint: "Konto obračuna nabave materiala", prefixes: ["300"] },
      { field: "inputVat22AccountId", label: "Vstopni DDV 22 %", hint: "Konto odbitnega DDV", prefixes: ["16"] },
      { field: "inputVat95AccountId", label: "Vstopni DDV 9,5 %", hint: "Konto odbitnega DDV", prefixes: ["16"] },
      { field: "inputVat5AccountId", label: "Vstopni DDV 5 %", hint: "Konto odbitnega DDV", prefixes: ["16"] },
      { field: "inputVatAccountId", label: "Vstopni DDV (privzeti)", hint: "Uporabi se, če za stopnjo ni ločenega konta", prefixes: ["16"] },
      { field: "otherCostsAccountId", label: "Ostali stroški", hint: "Stroški, ki se ne kapitalizirajo v zalogo", prefixes: ["48", "41"] },
    ],
  },
  {
    title: "Poraba, KIR in otvoritve",
    description: "Konti za stroške prodanega blaga, lastno porabo, reprezentanco in začetno zalogo.",
    fields: [
      { field: "cogsMaterialAccountId", label: "Poraba materiala", hint: "Strošek prodanega materiala", prefixes: ["70", "40"] },
      { field: "cogsGoodsAccountId", label: "Poraba blaga", hint: "Strošek prodanega blaga", prefixes: ["70", "40"] },
      { field: "kirArAccountId", label: "KIR / AR", hint: "Konto za KIR", prefixes: ["12", "16"] },
      { field: "lastnaPorabaAccountId", label: "Lastna poraba", hint: "Strošek lastne porabe", prefixes: ["70", "40"] },
      { field: "reprezentancaAccountId", label: "Reprezentanca", hint: "Strošek reprezentance", prefixes: ["70", "40"] },
      { field: "openingBalanceAccountId", label: "Začetna zaloga", hint: "Otvoritvena temeljnica", prefixes: ["90", "99"] },
      { field: "cogsAccountId", label: "Poraba (stari fallback)", hint: "Za stare POS nastavitve", prefixes: ["70", "40"] },
      { field: "revenueAccountId", label: "Prihodki (stari fallback)", hint: "Za stare POS nastavitve", prefixes: ["76", "77"] },
      { field: "vatLiabilityAccountId", label: "DDV (stari fallback)", hint: "Za stare POS nastavitve", prefixes: ["26"] },
    ],
  },
];

const VAT_FIELDS: FieldDefinition[] = [
  { field: "vat5VatCodeId", label: "DDV koda 5 %", hint: "Koda DDV za POS promet po 5 %", requiredRate: 5 },
  { field: "vat95VatCodeId", label: "DDV koda 9,5 %", hint: "Koda DDV za POS promet po 9,5 %", requiredRate: 9.5 },
  { field: "vat22VatCodeId", label: "DDV koda 22 %", hint: "Koda DDV za POS promet po 22 %", requiredRate: 22 },
];

const MANAGED_BOOKING_FIELDS: BookingField[] = [
  ...ACCOUNT_GROUPS.flatMap((group) => group.fields.map((field) => field.field)),
  ...VAT_FIELDS.map((field) => field.field),
  "subsidyCounterpartyId",
  "warnGiftVoucherNegative",
  "salesBookingFrequency",
  "consumptionBookingFrequency",
];

export function eligiblePostingAccounts(accounts: AccountRecord[]): AccountRecord[] {
  return accounts
    .filter((account) => account.isActive && account.allowsPosting && /^\d{7}$/.test(account.code))
    .sort((a, b) => a.code.localeCompare(b.code));
}

export function suggestedAccounts(accounts: AccountRecord[], prefixes?: string[]): AccountRecord[] {
  if (!prefixes?.length) return accounts;
  return accounts.filter((account) => prefixes.some((prefix) => account.code.startsWith(prefix)));
}

export function eligibleVatCodes(vatCodes: VatCodeOption[], requiredRate?: number): VatCodeOption[] {
  return vatCodes.filter((vatCode) => Number(vatCode.rate) === requiredRate);
}

export function changedBookingSettings(
  current: PosBookingSettingsData,
  saved: PosBookingSettingsData,
): PosBookingSettingsData {
  return Object.fromEntries(
    MANAGED_BOOKING_FIELDS
      .filter((field) => current[field] !== saved[field])
      .map((field) => [field, current[field] ?? null]),
  );
}

function AccountSelect({
  field,
  accounts,
  value,
  onChange,
}: {
  field: FieldDefinition;
  accounts: AccountRecord[];
  value: string | null | undefined;
  onChange: (id: string | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [showAll, setShowAll] = useState(false);
  const selected = accounts.find((account) => account.id === value);
  const suggested = suggestedAccounts(accounts, field.prefixes);
  const visible = useMemo(() => {
    const normalized = query.trim().toLocaleLowerCase("sl-SI");
    const source = normalized || showAll ? accounts : suggested;
    if (!normalized) return source;
    return source.filter((account) =>
      account.code.toLowerCase().includes(normalized) || account.name.toLowerCase().includes(normalized),
    );
  }, [accounts, query, showAll, suggested]);

  const resetBrowse = (nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setQuery("");
      setShowAll(false);
    }
  };

  return (
    <Popover open={open} onOpenChange={resetBrowse}>
      <PopoverTrigger asChild>
        <Button
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          className="w-full min-w-0 justify-between gap-2 font-normal"
          data-testid={`booking-account-select-${field.field}`}
        >
          {selected ? (
            <span
              className="min-w-0 flex-1 truncate text-left"
              title={`${selected.code} — ${selected.name}`}
            >
              <span className="font-mono text-xs">{selected.code}</span>
              <span className="text-muted-foreground"> — {selected.name}</span>
            </span>
          ) : (
            <span className="truncate text-muted-foreground">Izberite konto</span>
          )}
          <ChevronsUpDown className="h-4 w-4 shrink-0 text-muted-foreground" />
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        className="w-[calc(100vw-2rem)] max-w-[30rem] p-0"
        data-testid={`booking-account-popover-${field.field}`}
      >
        <Command shouldFilter={false}>
          <CommandInput
            value={query}
            onValueChange={setQuery}
            placeholder="Išči po 7-mestni kodi ali nazivu …"
          />
          <CommandList>
            <CommandEmpty>Med proknjižljivimi 7-mestnimi konti ni zadetkov.</CommandEmpty>
            {field.prefixes?.length && !query && !showAll && (
              <CommandGroup heading={`Predlog: razred ${field.prefixes.join(" / ")}`}>
                <CommandItem
                  value="__show-all__"
                  onSelect={() => setShowAll(true)}
                  className="text-primary"
                  data-testid={`booking-show-all-${field.field}`}
                >
                  Pokaži vse proknjižljive konte
                </CommandItem>
              </CommandGroup>
            )}
            <CommandGroup heading={query || showAll ? "Vsi ustrezni konti" : "Predlagani konti"}>
              <CommandItem
                value="__clear__"
                onSelect={() => {
                  onChange(null);
                  setOpen(false);
                }}
              >
                <span className="text-muted-foreground">Brez konta</span>
                {!value && <Check className="ml-auto h-4 w-4" />}
              </CommandItem>
              {visible.map((account) => (
                <CommandItem
                  key={account.id}
                  value={`${account.code} ${account.name}`}
                  onSelect={() => {
                    onChange(account.id);
                    setOpen(false);
                  }}
                  className="min-w-0"
                >
                  <span className="w-16 shrink-0 font-mono text-xs">{account.code}</span>
                  <span className="min-w-0 flex-1 truncate" title={account.name}>{account.name}</span>
                  {value === account.id && <Check className="ml-auto h-4 w-4 shrink-0" />}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}

function VatCodeSelect({
  field,
  vatCodes,
  value,
  onChange,
}: {
  field: FieldDefinition;
  vatCodes: VatCodeOption[];
  value: string | null | undefined;
  onChange: (id: string | null) => void;
}) {
  const availableCodes = eligibleVatCodes(vatCodes, field.requiredRate);
  const legacyValue = typeof value === "string" && !availableCodes.some((vatCode) => vatCode.id === value);

  return (
    <Select value={value ?? "none"} onValueChange={(next) => onChange(next === "none" ? null : next)}>
      <SelectTrigger className="w-full min-w-0" data-testid={`booking-vat-select-${field.field}`}>
        <SelectValue placeholder="Izberite DDV kodo" />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value="none">Brez DDV kode</SelectItem>
        {legacyValue && (
          <SelectItem value={value}>
            Trenutno nastavljena neveljavna DDV koda — zamenjajte ali odstranite
          </SelectItem>
        )}
        {availableCodes.map((vatCode) => (
          <SelectItem value={vatCode.id} key={vatCode.id}>
            {vatCode.code} — {vatCode.description} ({vatCode.rate} %)
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export default function KontiZaTemeljnicePage() {
  const { user } = useAuth();
  const companyId = user?.companyId;
  const isAdminPodjetja = user?.vloga === "admin";
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<PosBookingSettingsData>({});
  const [savedForm, setSavedForm] = useState<PosBookingSettingsData>({});
  const [syncDate, setSyncDate] = useState(() => poslovniDatumZaCas());

  const settingsQuery = useQuery({
    queryKey: ["pos-booking-settings", companyId],
    queryFn: () => customFetch<PosBookingSettingsData | null>(`/api/companies/${companyId}/pos-booking-settings`),
    enabled: isAdminPodjetja && !!companyId,
  });
  const vatCodesQuery = useQuery({
    queryKey: ["pos-booking-settings-vat-codes", companyId],
    queryFn: () => customFetch<{ vatCodes: VatCodeOption[] }>(`/api/companies/${companyId}/pos-booking-settings/vat-codes`),
    enabled: isAdminPodjetja && !!companyId,
  });
  const accountsQuery = useListAccounts(
    companyId ?? "",
    undefined,
    {
      query: {
        enabled: isAdminPodjetja && !!companyId,
        queryKey: getListAccountsQueryKey(companyId ?? ""),
      },
    },
  );
  const counterpartiesQuery = useListCounterparties(
    companyId ?? "",
    { includeInactive: false },
    { query: { enabled: isAdminPodjetja && !!companyId } as any },
  );

  useEffect(() => {
    if (settingsQuery.data !== undefined) {
      const normalized = Object.fromEntries(
        MANAGED_BOOKING_FIELDS.map((field) => [field, settingsQuery.data?.[field] ?? null]),
      );
      setForm(normalized);
      setSavedForm(normalized);
    }
  }, [settingsQuery.data]);

  const postingAccounts = useMemo(
    () => eligiblePostingAccounts(accountsQuery.data?.accounts ?? []),
    [accountsQuery.data?.accounts],
  );

  const saveMutation = useMutation({
    mutationFn: (data: PosBookingSettingsData) =>
      customFetch<PosBookingSettingsData>(`/api/companies/${companyId}/pos-booking-settings`, {
        method: "PUT",
        body: JSON.stringify(data),
      }),
    onSuccess: (saved) => {
      const normalized = Object.fromEntries(
        MANAGED_BOOKING_FIELDS.map((field) => [field, saved[field] ?? null]),
      );
      setForm(normalized);
      setSavedForm(normalized);
      queryClient.setQueryData(["pos-booking-settings", companyId], saved);
      toast({ title: "Nastavitve knjiženja so shranjene" });
    },
    onError: (error) => {
      toast({
        title: "Nastavitev ni bilo mogoče shraniti",
        description: error instanceof Error ? error.message : "Poskusite znova.",
        variant: "destructive",
      });
    },
  });

  const syncMutation = useMutation({
    mutationFn: () =>
      customFetch(`/api/companies/${companyId}/pos-booking-settings/sync/${syncDate}`, {
        method: "POST",
      }),
    onSuccess: () => toast({ title: "Sinhronizacija temeljnic je zaključena" }),
    onError: (error) => toast({
      title: "Sinhronizacija ni uspela",
      description: error instanceof Error ? error.message : "Poskusite znova.",
      variant: "destructive",
    }),
  });

  if (!isAdminPodjetja) {
    return (
      <div className="p-8 flex-1 min-h-0 flex flex-col items-center justify-center" data-testid="booking-settings-forbidden">
        <div className="bg-destructive/10 border border-destructive/20 rounded-2xl p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-destructive mx-auto mb-4" />
          <h1 className="text-xl font-bold text-destructive mb-2">Nimate dodeljene pravice</h1>
          <p className="text-sm text-destructive/80">Konti za POS temeljnice so dostopni samo administratorju podjetja.</p>
        </div>
      </div>
    );
  }

  if (!companyId) {
    return (
      <div className="p-8 flex-1 min-h-0 flex flex-col items-center justify-center">
        <div className="bg-amber-500/10 border border-amber-500/20 rounded-2xl p-8 max-w-md text-center">
          <AlertCircle className="w-12 h-12 text-amber-600 mx-auto mb-4" />
          <h1 className="text-xl font-bold mb-2">Podjetje ni določeno</h1>
          <p className="text-sm text-muted-foreground">Nastavitev kontov ni mogoče naložiti brez podjetja.</p>
        </div>
      </div>
    );
  }

  const initialLoading = settingsQuery.isLoading || accountsQuery.isLoading || vatCodesQuery.isLoading || counterpartiesQuery.isLoading;
  const accountProblem = accountsQuery.isError
    ? "Kontnega plana ni bilo mogoče naložiti. Preverite povezavo in poskusite znova."
    : !accountsQuery.isLoading && postingAccounts.length === 0
      ? "V kontnem planu ni aktivnih, 7-mestnih proknjižljivih kontov. Najprej uredite kontni plan."
      : null;
  const settingsProblem = settingsQuery.isError || vatCodesQuery.isError || counterpartiesQuery.isError;

  const updateField = (field: BookingField, value: string | null) => {
    setForm((current) => ({ ...current, [field]: value }));
  };
  const changedSettings = changedBookingSettings(form, savedForm);
  const hasChanges = Object.keys(changedSettings).length > 0;

  return (
    <div className="p-4 sm:p-6 flex-1 min-h-0 flex flex-col max-w-6xl mx-auto w-full min-w-0 gap-6 overflow-auto">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between shrink-0">
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-primary/10 flex items-center justify-center shrink-0">
            <BookOpenCheck className="w-5 h-5 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold tracking-tight">Konti za temeljnice</h1>
            <p className="text-sm text-muted-foreground">Nastavite samodejno knjiženje POS prometa za podjetje.</p>
          </div>
        </div>
        <Button
          onClick={() => saveMutation.mutate(changedSettings)}
          disabled={initialLoading || !!accountProblem || !!settingsProblem || !hasChanges || saveMutation.isPending}
          className="gap-2 w-full sm:w-auto"
          data-testid="booking-save"
        >
          {saveMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          Shrani nastavitve
        </Button>
      </header>

      {initialLoading && (
        <div className="flex items-center justify-center gap-2 py-16 text-muted-foreground" data-testid="booking-settings-loading">
          <Loader2 className="w-5 h-5 animate-spin" /> Nalagam nastavitve knjiženja …
        </div>
      )}

      {!initialLoading && settingsProblem && (
        <div className="rounded-xl border border-destructive/30 bg-destructive/10 p-4 text-sm text-destructive" data-testid="booking-settings-error">
          <p className="font-semibold">Nastavitev knjiženja ni bilo mogoče naložiti.</p>
          <p className="mt-1">Osvežite stran. Če se napaka ponovi, preverite dostop do API-ja.</p>
        </div>
      )}

      {!initialLoading && accountProblem && (
        <div className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-800" data-testid="booking-accounts-unavailable">
          <p className="font-semibold">Konti trenutno niso na voljo.</p>
          <p className="mt-1">{accountProblem}</p>
        </div>
      )}

      {!initialLoading && !settingsProblem && !accountProblem && (
        <>
          {ACCOUNT_GROUPS.map((group) => (
            <Card key={group.title}>
              <CardHeader>
                <CardTitle>{group.title}</CardTitle>
                <CardDescription>{group.description}</CardDescription>
              </CardHeader>
              <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                {group.fields.map((field) => (
                  <div key={field.field} className="min-w-0 space-y-1.5">
                    <Label htmlFor={`booking-${field.field}`}>{field.label}</Label>
                    <AccountSelect
                      field={field}
                      accounts={postingAccounts}
                      value={form[field.field] as string | null | undefined}
                      onChange={(value) => updateField(field.field, value)}
                    />
                    <p className="text-xs text-muted-foreground">{field.hint}</p>
                  </div>
                ))}
              </CardContent>
            </Card>
          ))}

          <Card>
            <CardHeader>
              <CardTitle>Frekvenca zbirnih temeljnic</CardTitle>
              <CardDescription>
                Nastavitvi veljata za celotno podjetje. Sprememba se varno uporabi s prvim dnem naslednjega meseca.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="space-y-1.5">
                <Label htmlFor="booking-sales-frequency">Prodaja</Label>
                <Select
                  value={(form.salesBookingFrequency as string | null | undefined) ?? "daily"}
                  onValueChange={(value) => updateField("salesBookingFrequency", value)}
                >
                  <SelectTrigger id="booking-sales-frequency" data-testid="booking-sales-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Dnevno</SelectItem>
                    <SelectItem value="monthly">Mesečno</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="booking-consumption-frequency">Poraba</Label>
                <Select
                  value={(form.consumptionBookingFrequency as string | null | undefined) ?? "monthly"}
                  onValueChange={(value) => updateField("consumptionBookingFrequency", value)}
                >
                  <SelectTrigger id="booking-consumption-frequency" data-testid="booking-consumption-frequency">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="daily">Dnevno</SelectItem>
                    <SelectItem value="monthly">Mesečno (priporočeno)</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <p className="text-xs text-muted-foreground lg:col-span-2">
                {typeof settingsQuery.data?.frequencyEffectiveFrom === "string"
                  ? `Naslednja sprememba začne veljati ${settingsQuery.data.frequencyEffectiveFrom}.`
                  : "Ob spremembi se datum uveljavitve samodejno nastavi na 1. naslednjega meseca."}
              </p>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Študentski boni</CardTitle>
              <CardDescription>
                Za subvencionirani del se v dnevni temeljnici vodi terjatev do partnerja. Subvencija ni popust in ne znižuje DDV.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div className="min-w-0 space-y-1.5">
                <Label htmlFor="booking-subsidy-counterparty">Partner MDDSZ/ŠOS</Label>
                <Select
                  value={(form.subsidyCounterpartyId as string | null | undefined) ?? "none"}
                  onValueChange={(value) => updateField("subsidyCounterpartyId", value === "none" ? null : value)}
                >
                  <SelectTrigger id="booking-subsidy-counterparty" data-testid="booking-subsidy-counterparty-select">
                    <SelectValue placeholder="Izberite partnerja" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Brez partnerja</SelectItem>
                    {(counterpartiesQuery.data?.counterparties ?? []).map((counterparty) => (
                      <SelectItem value={counterparty.id} key={counterparty.id}>
                        {counterparty.name}{counterparty.taxId ? ` (${counterparty.taxId})` : ""}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-muted-foreground">Običajno izberite MDDSZ ali ŠOS, ki poravna subvencijo.</p>
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Večnamenski darilni boni</CardTitle>
              <CardDescription>
                Evidenca je skupna za podjetje: izdani boni minus unovčeni boni. Ne vodi kod, serijskih številk ali posameznih preostalih vrednosti.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <label className="flex items-start gap-3 cursor-pointer">
                <Checkbox
                  checked={form.warnGiftVoucherNegative !== false}
                  onCheckedChange={(checked) => setForm((current) => ({
                    ...current,
                    warnGiftVoucherNegative: checked === true,
                  }))}
                />
                <span className="space-y-1">
                  <span className="block text-sm font-medium">Opozori ob preseženem saldu</span>
                  <span className="block text-sm text-muted-foreground">
                    Račun se vseeno izda. Opozorilo pomaga zajeti bone, izdane pred uvedbo evidence.
                  </span>
                </span>
              </label>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>DDV kode</CardTitle>
              <CardDescription>Izberite DDV kode, ki se uporabijo pri samodejnem POS knjiženju.</CardDescription>
            </CardHeader>
            <CardContent className="grid grid-cols-1 lg:grid-cols-3 gap-4">
              {VAT_FIELDS.map((field) => {
                const matchingCodes = eligibleVatCodes(
                  vatCodesQuery.data?.vatCodes ?? [],
                  field.requiredRate,
                );
                const currentValue = form[field.field] as string | null | undefined;
                const hasLegacySelection = typeof currentValue === "string" && !matchingCodes.some(
                  (vatCode) => vatCode.id === currentValue,
                );
                return (
                  <div key={field.field} className="min-w-0 space-y-1.5">
                    <Label>{field.label}</Label>
                    <VatCodeSelect
                      field={field}
                      vatCodes={vatCodesQuery.data?.vatCodes ?? []}
                      value={form[field.field] as string | null | undefined}
                      onChange={(value) => updateField(field.field, value)}
                    />
                    <p className="text-xs text-muted-foreground">
                      {hasLegacySelection
                        ? "Trenutna DDV koda ni več veljavna za to stopnjo. Zamenjajte jo ali izberite »Brez DDV kode«."
                        : matchingCodes.length > 0
                          ? field.hint
                          : "Za to stopnjo ni veljavne izhodne DDV kode."}
                    </p>
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Ročna sinhronizacija</CardTitle>
              <CardDescription>Za izbrani dan znova ustvari ali uskladi POS temeljnice.</CardDescription>
            </CardHeader>
            <CardFooter className="flex flex-col sm:flex-row gap-3 items-stretch sm:items-end">
              <div className="w-full sm:w-auto space-y-1.5">
                <Label htmlFor="booking-sync-date">Datum</Label>
                <input
                  id="booking-sync-date"
                  type="date"
                  value={syncDate}
                  onChange={(event) => setSyncDate(event.target.value)}
                  className={cn("flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm")}
                />
              </div>
              <Button
                type="button"
                variant="outline"
                className="gap-2 w-full sm:w-auto"
                disabled={!syncDate || syncMutation.isPending}
                onClick={() => syncMutation.mutate()}
              >
                {syncMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />}
                Sinhroniziraj dan
              </Button>
            </CardFooter>
          </Card>
        </>
      )}
    </div>
  );
}