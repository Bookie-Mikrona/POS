/**
 * Conservative recognition of Slovenian OCR bank statements. Never infer a
 * transaction from the invoice-shaped lines produced by the model.
 */
export interface ScannedBankTransaction {
  transactionId: string;
  bookingDate: string;
  amount: number;
  description: string;
  reference?: string;
  counterpartyName?: string;
  counterpartyIban?: string;
}

export interface ScannedBankStatement {
  sourceIban?: string;
  ownerTaxId?: string;
  statementNumber?: string;
  statementDate?: string;
  openingBalance?: number;
  closingBalance?: number;
  currency: string;
  transactions: ScannedBankTransaction[];
  errors: string[];
}

export function isScannedBankStatement(rawText: string): boolean {
  // Missing balances must block bank confirmation, not reclassify a damaged
  // statement as an invoice.
  return /(?:datum|št(?:ev)?\.?|številka)\s*izpiska|rekapitulacija\s+izpiska|bančni\s+izpisek|izpisek\s+za\s+obdobje/i.test(rawText)
    && /transakcijski\s+račun|iban/i.test(rawText);
}

function money(value: string | undefined): number | undefined {
  if (!value || !/^-?[\d.]+,\d{2}$/.test(value.trim())) return undefined;
  const parsed = Number(value.trim().replace(/\./g, "").replace(",", "."));
  return Number.isFinite(parsed) && Number.isSafeInteger(Math.round(parsed * 100)) ? parsed : undefined;
}

function date(value: string | undefined): string | undefined {
  if (!value) return undefined;
  const [day, month, year] = value.split(".");
  const iso = `${year}-${month}-${day}`;
  const parsed = new Date(`${iso}T00:00:00Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === iso ? iso : undefined;
}

export function parseScannedBankStatement(rawText: string): ScannedBankStatement | undefined {
  if (!isScannedBankStatement(rawText)) return undefined;
  const errors: string[] = [];
  const numberFor = (pattern: RegExp) => money(rawText.match(pattern)?.[1]);
  const openingBalance = numberFor(/(?:predhodno|začetno)\s+stanje:\s*(-?[\d.]+,\d{2})/i);
  const closingBalance = numberFor(/(?:novo|končno)\s+stanje:\s*(-?[\d.]+,\d{2})/i);
  const statementDate = date(rawText.match(/datum\s+izpiska:\s*(\d{2}\.\d{2}\.\d{4})/i)?.[1]);
  const statementNumber = rawText.match(/(?:štev\.?|št\.?|številka)\s*izpiska:\s*([^\s;]+)/i)?.[1];
  const sourceIban = rawText.match(/transakcijski\s+račun:\s*(SI\s*\d\s*\d(?:\s*\d){15})\b/i)?.[1]?.replace(/\s/g, "").toUpperCase();
  const ownerTaxId = rawText.match(/\bID\s+za\s+DDV:\s*SI(\d{8})\b/i)?.[1];
  const currency = rawText.match(/\bvaluta:\s*([A-Z]{3})\b/i)?.[1]?.toUpperCase() ?? "";
  const transactions: ScannedBankTransaction[] = [];
  const blocks = rawText.matchAll(/(?:Dat\.\s*valute|Datum\s+valute|Datum\s+knjiženja):\s*(\d{2}\.\d{2}\.\d{4})([\s\S]*?)(?=(?:Dat\.\s*valute|Datum\s+valute|Datum\s+knjiženja):|REKAPITULACIJA\s+IZPISKA|$)/gi);
  for (const block of blocks) {
    const body = block[2];
    const transactionId = body.match(/ID\s+transakcije:\s*([^\s;]+)/i)?.[1];
    const bookingDate = date(block[1]);
    const amountMatch = body.match(/znesek\s+(priliva|odliva)\s+v\s+EUR:\s*([\d.]+,\d{2})/i);
    const unsigned = money(amountMatch?.[2]);
    if (!transactionId || !bookingDate || unsigned === undefined || unsigned <= 0) {
      errors.push("Vsaj ena transakcija nima veljavnega ID-ja, datuma ali zneska.");
      continue;
    }
    const party = body.match(/(?:plačnik|prejemnik):\s*([^\r\n]+)/i)?.[1];
    const partyIban = party?.match(/\bSI\s*\d\s*\d(?:\s*\d){15}\b/i)?.[0];
    const partyName = partyIban
      ? party!.slice(party!.indexOf(partyIban) + partyIban.length).replace(/^[\s,;]+/, "")
        .replace(/,\s*[^,]*\d[^,]*,\s*\d{4}\s+.*$/, "").trim()
      : undefined;
    const description = body.match(/opis\s+nakazila:\s*([^\r\n]+)/i)?.[1]?.trim() ?? "Bančna transakcija";
    transactions.push({
      transactionId, bookingDate, amount: /odliva/i.test(amountMatch![1]) ? -unsigned : unsigned,
      description, reference: description.match(/\bSI\d{2}\s*[\d-]+/i)?.[0],
      counterpartyName: partyName,
      counterpartyIban: partyIban?.replace(/\s/g, "").toUpperCase(),
    });
  }
  if (!sourceIban || !statementNumber || !statementDate) errors.push("Manjkajo IBAN, številka ali veljaven datum izpiska.");
  if (currency !== "EUR") errors.push("Samodejni prenos skeniranih izpiskov trenutno podpira samo EUR.");
  if (openingBalance === undefined || closingBalance === undefined) errors.push("Manjka začetno ali končno stanje.");
  if (!transactions.length) errors.push("Transakcij ni bilo mogoče popolno prebrati. Uporabite bančni uvoz CAMT/MT940/CSV.");
  if (new Set(transactions.map(t => t.transactionId)).size !== transactions.length) errors.push("ID-ji transakcij niso enolični.");
  const totalCredit = numberFor(/skupaj\s+dobro:\s*([\d.]+,\d{2})/i);
  const totalDebit = numberFor(/skupaj\s+breme:\s*([\d.]+,\d{2})/i);
  const cents = (value: number) => Math.round(value * 100);
  const credit = transactions.filter(t => t.amount > 0).reduce((sum, t) => sum + cents(t.amount), 0);
  const debit = transactions.filter(t => t.amount < 0).reduce((sum, t) => sum + cents(-t.amount), 0);
  if (totalCredit === undefined || totalDebit === undefined || cents(totalCredit) !== credit || cents(totalDebit) !== debit) {
    errors.push("Prebrane transakcije se ne ujemajo z rekapitulacijo dobro/breme.");
  }
  const declaredCount = rawText.match(/skupaj\s+nalogov:\s*(\d+)/i)?.[1];
  if (declaredCount === undefined || Number(declaredCount) !== transactions.length) errors.push("Število transakcij se ne ujema z rekapitulacijo.");
  if (openingBalance !== undefined && closingBalance !== undefined && cents(openingBalance) + credit - debit !== cents(closingBalance)) {
    errors.push("Začetno stanje in promet ne pojasnita končnega stanja.");
  }
  return { sourceIban, ownerTaxId, statementNumber, statementDate, openingBalance, closingBalance, currency, transactions, errors };
}
