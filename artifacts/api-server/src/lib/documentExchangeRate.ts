export const ECB_USD_EUR_SOURCE_URL =
  "https://data-api.ecb.europa.eu/service/data/EXR/D.USD.EUR.SP00.A";
const ECB_USD_EUR_SERIES_KEY = "EXR.D.USD.EUR.SP00.A";

const ECB_CACHE_TTL_MS = 5 * 60 * 1000;
const ECB_MAX_RESPONSE_BYTES = 64 * 1024;
const ECB_TIMEOUT_MS = 4_000;
const ECB_LOOKBACK_DAYS = 10;
const ecbQuoteCache = new Map<string, { quote: EcbUsdEurQuote; expiresAt: number }>();

export type ExchangeRateMode = "ecb" | "manual";

export type EcbUsdEurQuote = {
  rateDate: string;
  unitsPerEur: number;
  source: "ECB";
  sourceUrl: string;
};

export type ExchangeRateLine = {
  quantity: number;
  unitPrice: number;
  vatRate: number;
  vatBase: number;
  vatAmount: number;
};

export type DocumentTotals = { net: number; vat: number; gross: number };

export type ConvertedDocumentAmounts = {
  sourceTotals: DocumentTotals;
  eurTotals: DocumentTotals;
  convertedLines: ExchangeRateLine[];
  roundingDifference: number;
};

export class DocumentExchangeRateError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly status = 400,
  ) {
    super(message);
    this.name = "DocumentExchangeRateError";
  }
}

export function isCanonicalIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export function utcDateString(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function sloveniaDateString(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Ljubljana",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const part = (type: "year" | "month" | "day") => parts.find((item) => item.type === type)?.value ?? "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function assertRequestedInvoiceDate(value: unknown, today = sloveniaDateString()): asserts value is string {
  if (!isCanonicalIsoDate(value)) {
    throw new DocumentExchangeRateError("INVALID_REQUESTED_DATE", "Datum računa mora biti veljaven datum ISO oblike YYYY-MM-DD.");
  }
  if (value > today) {
    throw new DocumentExchangeRateError("FUTURE_REQUESTED_DATE", "Datum računa ne sme biti v prihodnosti.");
  }
}

export function assertValidRateDate(value: unknown, requestedDate: string, today = sloveniaDateString()): asserts value is string {
  if (!isCanonicalIsoDate(value)) {
    throw new DocumentExchangeRateError("INVALID_RATE_DATE", "Datum tečaja mora biti veljaven datum ISO oblike YYYY-MM-DD.");
  }
  if (value > requestedDate || value > today) {
    throw new DocumentExchangeRateError("FUTURE_RATE_DATE", "Datum tečaja ne sme biti po datumu računa ali v prihodnosti.");
  }
}

export function assertPositiveUnitsPerEur(value: unknown): asserts value is number {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new DocumentExchangeRateError("INVALID_EXCHANGE_RATE", "Tečaj mora biti končno pozitivno število enot izvorne valute za 1 EUR.");
  }
}

function addUtcDays(date: string, days: number): string {
  const value = new Date(`${date}T00:00:00.000Z`);
  value.setUTCDate(value.getUTCDate() + days);
  return utcDateString(value);
}

function parseCsvRecords(csv: string): string[][] {
  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  const input = csv.replace(/^\uFEFF/, "");
  for (let index = 0; index < input.length; index++) {
    const char = input[index];
    if (quoted) {
      if (char === '"' && input[index + 1] === '"') {
        cell += '"';
        index++;
      } else if (char === '"') {
        quoted = false;
      } else {
        cell += char;
      }
    } else if (char === '"' && cell.length === 0) {
      quoted = true;
    } else if (char === ",") {
      row.push(cell.trim());
      cell = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && input[index + 1] === "\n") index++;
      row.push(cell.trim());
      if (row.some((value) => value.length > 0)) records.push(row);
      row = [];
      cell = "";
    } else {
      cell += char;
    }
  }
  if (quoted) {
    throw new DocumentExchangeRateError("ECB_INVALID_RESPONSE", "ECB je vrnil nepravilno zaključeno CSV-vrednost.", 502);
  }
  row.push(cell.trim());
  if (row.some((value) => value.length > 0)) records.push(row);
  return records;
}

function parseEcbCsv(csv: string, startDate: string, requestedDate: string): EcbUsdEurQuote | null {
  const records = parseCsvRecords(csv);
  if (records.length < 2) return null;
  const headers = records[0].map((cell) => cell.trim().toUpperCase());
  const keyIndex = headers.indexOf("KEY");
  const currencyIndex = headers.indexOf("CURRENCY");
  const denominatorIndex = headers.indexOf("CURRENCY_DENOM");
  const frequencyIndex = headers.indexOf("FREQ");
  const dateIndex = headers.indexOf("TIME_PERIOD");
  const valueIndex = headers.indexOf("OBS_VALUE");
  if ([keyIndex, frequencyIndex, currencyIndex, denominatorIndex, dateIndex, valueIndex].some((index) => index < 0)) {
    throw new DocumentExchangeRateError("ECB_INVALID_RESPONSE", "ECB je vrnil CSV brez obveznega ključa, frekvence, valutnega para ali vrednosti tečaja.", 502);
  }

  let selected: EcbUsdEurQuote | null = null;
  for (const cells of records.slice(1)) {
    const rawKey = cells[keyIndex] ?? "";
    const currency = cells[currencyIndex] ?? "";
    const denominator = cells[denominatorIndex] ?? "";
    const rawDate = cells[dateIndex] ?? "";
    const rawValue = cells[valueIndex] ?? "";
    if (!rawKey && !currency && !denominator && !rawDate && !rawValue) continue;
    if (
      rawKey !== ECB_USD_EUR_SERIES_KEY
      || cells[frequencyIndex] !== "D"
      || currency !== "USD"
      || denominator !== "EUR"
    ) {
      throw new DocumentExchangeRateError("ECB_WRONG_SERIES", "ECB je vrnil drug valutni par ali časovno vrsto namesto USD/EUR dnevnega tečaja.", 502);
    }
    if (!isCanonicalIsoDate(rawDate) || rawDate < startDate || rawDate > requestedDate) {
      throw new DocumentExchangeRateError("ECB_INVALID_RESPONSE", "ECB je vrnil neveljaven ali izven dovoljenega obdobja datiran tečaj.", 502);
    }
    // ECB CSV uses decimal observations, never JS hexadecimal/binary notation.
    const unitsPerEur = /^\d+(?:\.\d+)?$/.test(rawValue) ? Number(rawValue) : NaN;
    if (!Number.isFinite(unitsPerEur) || unitsPerEur <= 0) {
      throw new DocumentExchangeRateError("ECB_INVALID_RESPONSE", "ECB je vrnil neveljaven tečaj. Poskusite znova ali uporabite ročni tečaj.", 502);
    }
    if (!selected || rawDate > selected.rateDate) {
      selected = {
        rateDate: rawDate,
        unitsPerEur,
        source: "ECB",
        sourceUrl: "",
      };
    }
  }
  return selected;
}

async function readBoundedBody(response: Response, signal?: AbortSignal): Promise<string> {
  const length = response.headers.get("content-length");
  if (length && Number(length) > ECB_MAX_RESPONSE_BYTES) {
    throw new DocumentExchangeRateError("ECB_RESPONSE_TOO_LARGE", "Odgovor ECB je presegel dovoljeno velikost.", 502);
  }
  if (!response.body) {
    const text = await response.text();
    if (Buffer.byteLength(text, "utf8") > ECB_MAX_RESPONSE_BYTES) {
      throw new DocumentExchangeRateError("ECB_RESPONSE_TOO_LARGE", "Odgovor ECB je presegel dovoljeno velikost.", 502);
    }
    return text;
  }
  const reader = response.body.getReader();
  const abortReader = () => { void reader.cancel(); };
  signal?.addEventListener("abort", abortReader, { once: true });
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > ECB_MAX_RESPONSE_BYTES) {
        await reader.cancel();
        throw new DocumentExchangeRateError("ECB_RESPONSE_TOO_LARGE", "Odgovor ECB je presegel dovoljeno velikost.", 502);
      }
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", abortReader);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export async function getEcbUsdEurQuote(
  requestedDate: string,
  options: { fetcher?: typeof fetch; now?: Date } = {},
): Promise<EcbUsdEurQuote> {
  const today = sloveniaDateString(options.now ?? new Date());
  assertRequestedInvoiceDate(requestedDate, today);
  const fetcher = options.fetcher ?? fetch;
  const cacheable = fetcher === fetch;
  const cached = cacheable ? ecbQuoteCache.get(requestedDate) : undefined;
  if (cached && cached.expiresAt > Date.now()) return cached.quote;

  const startDate = addUtcDays(requestedDate, -ECB_LOOKBACK_DAYS);
  const url = new URL(ECB_USD_EUR_SOURCE_URL);
  url.searchParams.set("startPeriod", startDate);
  url.searchParams.set("endPeriod", requestedDate);
  url.searchParams.set("format", "csvdata");
  const controller = new AbortController();
  const timeoutError = () => new DocumentExchangeRateError(
    "ECB_TIMEOUT",
    "ECB ni odgovoril pravočasno. Poskusite znova ali izberite ročni tečaj.",
    503,
  );
  const timer = setTimeout(() => controller.abort(), ECB_TIMEOUT_MS);
  let response: Response;
  let body: string;
  try {
    response = await fetcher(url.toString(), {
      method: "GET",
      headers: { Accept: "text/csv" },
      signal: controller.signal,
    });
    if (controller.signal.aborted) throw timeoutError();
    if (!response.ok) {
      throw new DocumentExchangeRateError(
        "ECB_HTTP_ERROR",
        `ECB trenutno ni vrnil tečaja (HTTP ${response.status}). Poskusite znova ali izberite ročni tečaj.`,
        503,
      );
    }
    body = await readBoundedBody(response, controller.signal);
    if (controller.signal.aborted) throw timeoutError();
  } catch (error) {
    if (controller.signal.aborted) throw timeoutError();
    if (error instanceof DocumentExchangeRateError) throw error;
    throw new DocumentExchangeRateError("ECB_UNAVAILABLE", "Tečaja ECB trenutno ni mogoče pridobiti. Poskusite znova ali izberite ročni tečaj.", 503);
  } finally {
    clearTimeout(timer);
  }

  const quote = parseEcbCsv(body, startDate, requestedDate);
  if (!quote) {
    throw new DocumentExchangeRateError(
      "ECB_RATE_NOT_AVAILABLE",
      "ECB za datum računa in dovoljeno 10-dnevno obdobje pred njim nima objavljenega tečaja. Uporabite ročni tečaj.",
      503,
    );
  }
  assertValidRateDate(quote.rateDate, requestedDate, today);
  assertPositiveUnitsPerEur(quote.unitsPerEur);
  quote.sourceUrl = url.toString();
  if (cacheable) {
    const now = Date.now();
    for (const [date, entry] of ecbQuoteCache) {
      if (entry.expiresAt <= now) ecbQuoteCache.delete(date);
    }
    if (ecbQuoteCache.size >= 100 && !ecbQuoteCache.has(requestedDate)) {
      const oldestKey = ecbQuoteCache.keys().next().value;
      if (oldestKey) ecbQuoteCache.delete(oldestKey);
    }
    ecbQuoteCache.set(requestedDate, { quote, expiresAt: now + ECB_CACHE_TTL_MS });
  }
  return quote;
}

type DecimalFraction = { numerator: bigint; denominator: bigint };

function decimalFraction(value: number): DecimalFraction {
  if (!Number.isFinite(value)) {
    throw new DocumentExchangeRateError("INVALID_SOURCE_AMOUNT", "Znesek izvornega dokumenta ni veljavno število.");
  }
  const match = /^([+-]?)(\d+)(?:\.(\d*))?(?:[eE]([+-]?\d+))?$/.exec(String(value));
  if (!match) {
    throw new DocumentExchangeRateError("INVALID_SOURCE_AMOUNT", "Znesek izvornega dokumenta ni veljavno decimalno število.");
  }
  const sign = match[1] === "-" ? -1n : 1n;
  const fraction = match[3] ?? "";
  const exponent = Number(match[4] ?? "0");
  const digits = BigInt(`${match[2]}${fraction}`);
  const scale = fraction.length - exponent;
  if (scale < 0) {
    return { numerator: sign * digits * (10n ** BigInt(-scale)), denominator: 1n };
  }
  return { numerator: sign * digits, denominator: 10n ** BigInt(scale) };
}

function decimalFractionSum(values: number[]): DecimalFraction {
  const fractions = values.map(decimalFraction);
  const scale = fractions.reduce((max, fraction) =>
    Math.max(max, fraction.denominator === 1n ? 0 : fraction.denominator.toString().length - 1), 0);
  const denominator = 10n ** BigInt(scale);
  const numerator = fractions.reduce((sum, fraction) => {
    const fractionScale = fraction.denominator === 1n ? 0 : fraction.denominator.toString().length - 1;
    return sum + fraction.numerator * (10n ** BigInt(scale - fractionScale));
  }, 0n);
  return { numerator, denominator };
}

function roundedFraction(numerator: bigint, denominator: bigint, decimals: number): number {
  if (denominator === 0n) {
    throw new DocumentExchangeRateError("INVALID_EXCHANGE_RATE", "Tečaj ne sme biti nič.");
  }
  const negative = (numerator < 0n) !== (denominator < 0n);
  const scaledNumerator = (numerator < 0n ? -numerator : numerator) * (10n ** BigInt(decimals));
  const positiveDenominator = denominator < 0n ? -denominator : denominator;
  let scaled = scaledNumerator / positiveDenominator;
  const remainder = scaledNumerator % positiveDenominator;
  if (remainder * 2n >= positiveDenominator) scaled++;
  const digits = scaled.toString().padStart(decimals + 1, "0");
  const unsigned = decimals === 0
    ? digits
    : `${digits.slice(0, -decimals)}.${digits.slice(-decimals)}`;
  const rounded = Number(`${negative && scaled !== 0n ? "-" : ""}${unsigned}`);
  if (!Number.isFinite(rounded)) {
    throw new DocumentExchangeRateError("CONVERTED_AMOUNT_OVERFLOW", "Pretvorjeni znesek presega dovoljeno numerično območje.");
  }
  return rounded;
}

function round(value: number, decimals: number): number {
  const fraction = decimalFraction(value);
  return roundedFraction(fraction.numerator, fraction.denominator, decimals);
}

function divideAndRound(value: number, divisor: number, decimals: number): number {
  const dividendFraction = decimalFraction(value);
  const divisorFraction = decimalFraction(divisor);
  return roundedFraction(
    dividendFraction.numerator * divisorFraction.denominator,
    dividendFraction.denominator * divisorFraction.numerator,
    decimals,
  );
}

function sumAndRound(values: number[], decimals: number): number {
  const fraction = decimalFractionSum(values);
  return roundedFraction(fraction.numerator, fraction.denominator, decimals);
}

function differenceAndRound(left: number, right: number, decimals: number): number {
  const fraction = decimalFractionSum([left, -right]);
  return roundedFraction(fraction.numerator, fraction.denominator, decimals);
}

function requiredAmount(value: unknown, label: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DocumentExchangeRateError("INVALID_SOURCE_TOTALS", `OCR nima veljavnega zneska »${label}«.`);
  }
  return value;
}

function centsEqual(a: number, b: number): boolean {
  return round(a, 2) === round(b, 2);
}

export function convertDocumentAmounts(
  lines: ExchangeRateLine[],
  totals: DocumentTotals,
  unitsPerEur: number,
): ConvertedDocumentAmounts {
  assertPositiveUnitsPerEur(unitsPerEur);
  if (!Array.isArray(lines) || lines.length === 0) {
    throw new DocumentExchangeRateError("MISSING_SOURCE_LINES", "Izvorni dokument nima vrstic za pretvorbo.");
  }

  const sourceTotals = {
    net: requiredAmount(totals?.net, "neto"),
    vat: requiredAmount(totals?.vat, "DDV"),
    gross: requiredAmount(totals?.gross, "bruto"),
  };
  const sourceNetFromLines = sumAndRound(lines.map((line) => requiredAmount(line.vatBase, "osnova")), 2);
  const sourceVatFromLines = sumAndRound(lines.map((line) => requiredAmount(line.vatAmount, "DDV")), 2);
  const sourceGrossFromLines = sumAndRound([
    ...lines.map((line) => requiredAmount(line.vatBase, "osnova")),
    ...lines.map((line) => requiredAmount(line.vatAmount, "DDV")),
  ], 2);
  if (
    !centsEqual(sourceNetFromLines, sourceTotals.net)
    || !centsEqual(sourceVatFromLines, sourceTotals.vat)
    || !centsEqual(sourceGrossFromLines, sourceTotals.gross)
  ) {
    throw new DocumentExchangeRateError(
      "OCR_TOTALS_MISMATCH",
      "Skupni zneski OCR se ne ujemajo z vsotami vrstic. Pred pretvorbo popravite OCR ali preverite dokument.",
    );
  }

  const convertedLines = lines.map((line) => {
    const quantity = requiredAmount(line.quantity, "količina");
    const unitPrice = requiredAmount(line.unitPrice, "cena na enoto");
    const vatRate = requiredAmount(line.vatRate, "stopnja DDV");
    const vatBase = requiredAmount(line.vatBase, "osnova");
    const vatAmount = requiredAmount(line.vatAmount, "znesek DDV");
    return {
      quantity,
      unitPrice: divideAndRound(unitPrice, unitsPerEur, 4),
      vatRate,
      vatBase: divideAndRound(vatBase, unitsPerEur, 2),
      vatAmount: divideAndRound(vatAmount, unitsPerEur, 2),
    };
  });
  const eurTotals = {
    net: sumAndRound(convertedLines.map((line) => line.vatBase), 2),
    vat: sumAndRound(convertedLines.map((line) => line.vatAmount), 2),
    gross: sumAndRound(convertedLines.flatMap((line) => [line.vatBase, line.vatAmount]), 2),
  };
  const directGross = divideAndRound(sourceTotals.gross, unitsPerEur, 2);
  return {
    sourceTotals: {
      net: round(sourceTotals.net, 2),
      vat: round(sourceTotals.vat, 2),
      gross: round(sourceTotals.gross, 2),
    },
    eurTotals,
    convertedLines,
    roundingDifference: differenceAndRound(eurTotals.gross, directGross, 2),
  };
}

export function clearEcbUsdEurQuoteCacheForTests(): void {
  ecbQuoteCache.clear();
}