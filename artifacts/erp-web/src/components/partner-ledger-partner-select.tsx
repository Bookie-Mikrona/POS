import { useState } from "react";
import { Check, ChevronsUpDown } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command";

type Partner = {
  id: string;
  name: string;
  taxId?: string | null;
  registrationNumber?: string | null;
};

function normalize(value: string): string {
  return value.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLocaleLowerCase("sl").trim();
}

export function matchesLedgerPartner(partner: Partner, search: string): boolean {
  const query = normalize(search);
  if (!query) return true;
  if (normalize(partner.name).includes(query)) return true;
  const numberQuery = query.replace(/\s/g, "");
  const tax = normalize(partner.taxId ?? "").replace(/\s/g, "");
  return [tax, tax ? `si${tax.replace(/^si/, "")}` : "", partner.registrationNumber ?? ""]
    .some(value => normalize(value).replace(/\s/g, "").includes(numberQuery));
}

export function PartnerLedgerPartnerSelect({
  partners, value, onChange,
}: { partners: Partner[]; value: string; onChange: (id: string) => void }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const selected = partners.find(partner => partner.id === value);
  const matches = partners.filter(partner => matchesLedgerPartner(partner, search));

  return <Popover open={open} onOpenChange={next => { setOpen(next); if (next) setSearch(""); }}>
    <PopoverTrigger asChild>
      <Button id="partner-filter" type="button" variant="outline" role="combobox"
        aria-expanded={open} aria-haspopup="listbox" className="w-full justify-between font-normal">
        <span className="truncate">{selected?.name ?? "Izberite partnerja"}</span>
        <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
      </Button>
    </PopoverTrigger>
    <PopoverContent align="start" className="w-[var(--radix-popover-trigger-width)] min-w-[320px] max-w-[calc(100vw-2rem)] p-0">
      <Command label="Iskanje partnerja" shouldFilter={false}>
        <CommandInput aria-label="Iskanje partnerja" placeholder="Naziv, davčna ali matična številka…"
          value={search} onValueChange={setSearch} />
        <CommandList aria-label="Poslovni partnerji">
          {matches.map(partner => <CommandItem key={partner.id} value={partner.id}
            onSelect={() => { onChange(partner.id); setOpen(false); }}>
            <Check className={`mr-2 h-4 w-4 shrink-0 ${value === partner.id ? "opacity-100" : "opacity-0"}`} />
            <span>
              <span className="block">{partner.name}</span>
              {(partner.taxId || partner.registrationNumber) && <span className="block text-xs text-muted-foreground">
                {[partner.taxId && `Davčna: ${partner.taxId}`, partner.registrationNumber && `Matična: ${partner.registrationNumber}`].filter(Boolean).join(" · ")}
              </span>}
            </span>
          </CommandItem>)}
          {matches.length === 0 && <p role="status" className="p-3 text-sm text-muted-foreground">Ni ustreznih partnerjev.</p>}
          {!search.trim() && <CommandItem value="all" onSelect={() => { onChange("all"); setOpen(false); }}>Počisti izbiro partnerja</CommandItem>}
        </CommandList>
      </Command>
    </PopoverContent>
  </Popover>;
}