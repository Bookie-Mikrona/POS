/**
 * Simulacija AJPES (Agencija RS za javnopravne evidence in storitve) poizvedbe.
 *
 * V produkciji bi ta modul klical pravi AJPES spletni servis (SOAP/REST).
 * Trenutno vrača realistične testne podatke za znana slovenska podjetja.
 *
 * Dokumentacija pravega API-ja: https://www.ajpes.si/doc/Register/PRS/Spletni_servis
 */

export interface AjpesResult {
  found: boolean;
  taxId: string;
  registrationNumber: string | null;
  name: string;
  address: string | null;
  postCode: string | null;
  city: string | null;
  country: string;
  vatPayer: boolean;
  iban: string | null;
  source: "ajpes_sim";
}

/** Normalizira davčno številko: odstrani "SI" prefix in presledke */
function normalizeTaxId(raw: string): string {
  return raw.trim().toUpperCase().replace(/^SI/, "").replace(/\s/g, "");
}

/** Simulirana baza AJPES registra — realistični primeri */
const AJPES_DATABASE: Record<string, Omit<AjpesResult, "found" | "source">> = {
  "72996cao": {
    taxId: "SI72996CAO",
    registrationNumber: "5860523",
    name: "Mercator, d.d.",
    address: "Dunajska cesta 107",
    postCode: "1000",
    city: "Ljubljana",
    country: "SI",
    vatPayer: true,
    iban: "SI56 0400 0025 2617 209",
  },
  "18588as1": {
    taxId: "SI18588AS1",
    registrationNumber: "5037468",
    name: "Petrol, d.d., Ljubljana",
    address: "Dunajska cesta 50",
    postCode: "1527",
    city: "Ljubljana",
    country: "SI",
    vatPayer: true,
    iban: "SI56 0201 0025 7978 718",
  },
  "82155025": {
    taxId: "SI82155025",
    registrationNumber: "5227992",
    name: "Telekom Slovenije, d.d.",
    address: "Cigaletova ulica 15",
    postCode: "1000",
    city: "Ljubljana",
    country: "SI",
    vatPayer: true,
    iban: "SI56 0290 0025 0026 471",
  },
  "20652720": {
    taxId: "SI20652720",
    registrationNumber: "2448931",
    name: "NLB, d.d.",
    address: "Trg republike 2",
    postCode: "1520",
    city: "Ljubljana",
    country: "SI",
    vatPayer: false,
    iban: null,
  },
  "94149073": {
    taxId: "SI94149073",
    registrationNumber: "1663037",
    name: "Pošta Slovenije d.o.o.",
    address: "Slomškov trg 10",
    postCode: "2500",
    city: "Maribor",
    country: "SI",
    vatPayer: true,
    iban: "SI56 0110 0600 0010 016",
  },
  "68297530": {
    taxId: "SI68297530",
    registrationNumber: "5446823",
    name: "Spar Slovenija d.o.o.",
    address: "Letališka cesta 31a",
    postCode: "1000",
    city: "Ljubljana",
    country: "SI",
    vatPayer: true,
    iban: null,
  },
};

/** Generira navidezne podatke za neznano davčno številko (za testiranje) */
function generateFallback(taxId: string): Omit<AjpesResult, "found" | "source"> {
  const num = taxId.replace(/\D/g, "").slice(0, 8).padEnd(8, "0");
  return {
    taxId: `SI${num}`,
    registrationNumber: num.slice(0, 7),
    name: `Testno podjetje ${num} d.o.o.`,
    address: "Testna ulica 1",
    postCode: "1000",
    city: "Ljubljana",
    country: "SI",
    vatPayer: parseInt(num) % 2 === 0,
    iban: null,
  };
}

/**
 * Izvede simulirano AJPES poizvedbo po davčni številki.
 * Vrne `found: false` le za povsem prazne vnose.
 * Za neznane davčne številke vrne generiran testni vpis (realna AJPES bi vrnila 404).
 */
export async function ajpesLookup(rawTaxId: string): Promise<AjpesResult> {
  const normalized = normalizeTaxId(rawTaxId);

  if (!normalized) {
    return {
      found: false,
      taxId: rawTaxId,
      registrationNumber: null,
      name: "",
      address: null,
      postCode: null,
      city: null,
      country: "SI",
      vatPayer: false,
      iban: null,
      source: "ajpes_sim",
    };
  }

  // Poišči v simulirani bazi (case-insensitive)
  const key = normalized.toLowerCase();
  const known = AJPES_DATABASE[key];

  if (known) {
    return { found: true, ...known, source: "ajpes_sim" };
  }

  // Za neznane davčne številke simuliraj uspešen odgovor z generiranimi podatki
  // (pravi AJPES bi vrnil napako za neveljavno številko)
  await new Promise((r) => setTimeout(r, 150)); // simuliraj omrežno zakasnitev
  return { found: true, ...generateFallback(normalized), source: "ajpes_sim" };
}
