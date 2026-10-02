import { createHash } from "node:crypto";
import { AJPES_GD_AOP_CATALOG_2025 } from "./aopCatalog2025";
import jolpDefinition from "./jolp-definition.json";

export interface AjpesAnnualCompany {
  name: string;
  street: string;
  postalCode: string;
  city: string;
  registrationNumber: string;
  taxNumber: string;
}

export interface AjpesAccountRow {
  accountId: string;
  code: string;
  name: string;
  currentBalance: string;
  previousBalance: string;
  /**
   * Net debit-minus-credit turnover after SQL has removed the exact known
   * opening-entry ID and the explicitly selected closing-entry IDs. This
   * aggregate model deliberately does not guess journal types from dates or
   * descriptions.
   */
  currentTurnover: string;
  previousTurnover: string;
}

export interface AjpesJournalChoice {
  id: string;
  number: string;
  date: string;
  reference: string;
  description: string;
}

export interface AjpesAnnualSettings {
  /**
   * A bare accountId is the normal, human-reviewed account classification:
   * BS AOPs consume only balances, while IPI AOPs consume only turnover.
   * Explicit balance:<accountId> and turnover:<accountId> keys may classify
   * both measures for a genuinely dual-purpose account. "ignore" is only
   * valid for a completely zero clearing account and needs a reason.
   */
  mappings: Record<string, string>;
  mappingReasons: Record<string, string>;
  /** Explicit values for individual, editable AOP leaves, in EUR. */
  currentValues: Record<string, string>;
  previousValues: Record<string, string>;
  excludedEntryIds: string[];
  metadata: Record<string, string>;
}

export interface AjpesSource {
  year: number;
  company: AjpesAnnualCompany;
  accounts: AjpesAccountRow[];
  journals: AjpesJournalChoice[];
  settings: AjpesAnnualSettings;
  revision: number;
  reviewedFingerprint?: string | null;
  sourceWarnings?: string[];
  hasCurrent: boolean;
  hasPrevious: boolean;
  sourceVersion: string;
}

/** Backwards-compatible descriptive alias for callers that prefer it. */
export type AjpesAnnualSource = AjpesSource;

export interface AjpesJolpRow {
  code: string;
  label: string;
  bold: boolean;
  current: string;
  previous: string;
}

export interface AjpesAopRow {
  code: string;
  label: string;
  section: string;
  editable: boolean;
  ledgerMappable: boolean;
  formula?: string;
  current: string;
  previous: string;
}

export interface AjpesReportIssue {
  code: string;
  message: string;
  blocking: boolean;
}

export interface AjpesAnnualReport {
  year: number;
  company: AjpesAnnualCompany;
  settings: AjpesAnnualSettings;
  revision: number;
  sourceFingerprint: string;
  reviewed: boolean;
  canExport: boolean;
  canExportXml: boolean;
  supportedXmlYears: number[];
  balanceSheet: AjpesJolpRow[];
  incomeStatement: AjpesJolpRow[];
  aopRows: AjpesAopRow[];
  accounts: AjpesAccountRow[];
  journals: AjpesJournalChoice[];
  issues: AjpesReportIssue[];
}

interface JolpDefinitionRow {
  code: string;
  label: string;
  bold: boolean;
  expression: string;
}

const CATALOG = AJPES_GD_AOP_CATALOG_2025.aops;
const AOP_BY_ID = new Map<string, (typeof CATALOG)[number]>(
  CATALOG.map((row) => [row.id, row] as const),
);
const AOP_CODES = new Set<string>(AOP_BY_ID.keys());
const JOLP = jolpDefinition as {
  balanceSheet: JolpDefinitionRow[];
  incomeStatement: JolpDefinitionRow[];
};
const CENTS_PER_EURO = 100n;
const ZERO = 0n;
const MANUAL_ONLY_IDS = new Set([
  "188",
  "189",
  "200",
  "201",
  "202",
  "203",
  "204",
  "206",
  "207",
  "208",
  "209",
  "211",
  "212",
  "213",
  "214",
]);
const MANUAL_OR_ACCOUNT_IDS = new Set(["302"]);
const CONTRA_EQUITY_IDS = new Set(["059", "064", "069", "071"]);
const PREVIOUS_DATA_MODES = new Set(["ledger", "manual", "no-activity"]);
const NONNEGATIVE_RESULT_FORMULAS = new Set([
  "151",
  "152",
  "182",
  "183",
  "186",
  "187",
  "215",
  "216",
]);

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const object = value as Record<string, unknown>;
    return `{${Object.keys(object)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stableJson(object[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function fingerprint(source: AjpesSource, aopRows: AjpesAopRow[]): string {
  const input = {
    catalogVersion: createHash("sha256")
      .update(stableJson(AJPES_GD_AOP_CATALOG_2025))
      .digest("hex"),
    year: source.year,
    company: source.company,
    accounts: source.accounts,
    settings: source.settings,
    sourceVersion: source.sourceVersion,
    hasCurrent: source.hasCurrent,
    hasPrevious: source.hasPrevious,
    // Approval covers the calculated figures too, not only their inputs.
    // A change in calculation logic must not reuse an old financial review.
    amounts: aopRows.map(({ code, current, previous }) => ({ code, current, previous })),
  };
  return createHash("sha256").update(stableJson(input)).digest("hex");
}

/**
 * Parse a strict decimal string and round once to cents, half away from zero.
 * BigInt arithmetic keeps aggregation exact regardless of the number of rows.
 */
function parseCents(value: string): bigint | undefined {
  if (
    value.length > 64 ||
    !/^-?(?:0|[1-9]\d*)(?:\.\d+)?$/.test(value)
  ) {
    return undefined;
  }
  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [whole, fraction = ""] = unsigned.split(".");
  let cents =
    BigInt(whole) * CENTS_PER_EURO +
    BigInt((fraction.slice(0, 2).padEnd(2, "0") || "0"));
  if (fraction.length > 2 && Number(fraction[2]) >= 5) cents += 1n;
  return negative ? -cents : cents;
}

function formatCents(cents: bigint): string {
  const negative = cents < ZERO;
  const absolute = negative ? -cents : cents;
  const euros = absolute / CENTS_PER_EURO;
  const centsPart = (absolute % CENTS_PER_EURO).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${euros}.${centsPart}`;
}

function isNonZero(cents: bigint): boolean {
  return cents !== ZERO;
}

function setIssue(
  issues: AjpesReportIssue[],
  code: string,
  message: string,
  blocking: boolean,
): void {
  if (!issues.some((issue) => issue.code === code && issue.message === message)) {
    issues.push({ code, message, blocking });
  }
}

function getMapValue(
  record: Record<string, string>,
  key: string,
): string | undefined {
  return Object.hasOwn(record, key) ? record[key] : undefined;
}

function isBalanceAop(id: string): boolean {
  const row = AOP_BY_ID.get(id);
  return row?.form === "BS" || row?.form === "Dod.BS" || id === "302";
}

function isTurnoverAop(id: string): boolean {
  const row = AOP_BY_ID.get(id);
  return (
    (row?.form === "IPI" && !MANUAL_ONLY_IDS.has(id)) ||
    row?.form === "Dod.IPI"
  );
}

function balanceOrientation(id: string): "debit" | "credit" | undefined {
  const row = AOP_BY_ID.get(id);
  if (!row) return undefined;
  if (row.form === "Dod.BS") return Number(id) <= 252 ? "debit" : "credit";
  if (id === "302") return "debit";
  if (row.form !== "BS") return undefined;
  if (Number(id) <= 54) return "debit";
  if (CONTRA_EQUITY_IDS.has(id)) return "debit";
  return "credit";
}

function turnoverOrientation(id: string): "debit" | "credit" | undefined {
  const row = AOP_BY_ID.get(id);
  if (!row) return undefined;
  if (row.form === "Dod.IPI") return Number(id) <= 280 ? "credit" : "debit";
  if (row.form !== "IPI") return undefined;
  const number = Number(id);
  if (number >= 110 && number <= 121) return "credit";
  if (number === 122) return "debit";
  if (number >= 123 && number <= 126) return "credit";
  if (number >= 127 && number <= 150) return "debit";
  if (number >= 153 && number <= 165) return "credit";
  if (number >= 166 && number <= 177) return "debit";
  if (number >= 178 && number <= 180) return "credit";
  if (number >= 181 && number <= 185) return "debit";
  return undefined;
}

function evalExpression(
  expression: string,
  lookup: (id: string) => bigint | undefined,
): bigint | undefined {
  const tokens = expression.match(/\d{3}|do|[+-]/g);
  if (!tokens || tokens.join("") !== expression.replace(/\s+/g, "")) {
    return undefined;
  }

  let index = 0;
  let sign = 1n;
  let total = ZERO;
  while (index < tokens.length) {
    const startToken = tokens[index++];
    if (!/^\d{3}$/.test(startToken)) return undefined;
    let value: bigint;
    const range = tokens[index] === "do";
    if (range) {
      index++;
      const endToken = tokens[index++];
      if (!endToken || !/^\d{3}$/.test(endToken)) return undefined;
      const start = Number(startToken);
      const end = Number(endToken);
      if (end < start || end - start > 300) return undefined;
      value = ZERO;
      for (let number = start; number <= end; number++) {
        const part = lookup(String(number).padStart(3, "0"));
        if (part === undefined) return undefined;
        value += part;
      }
    } else {
      const part = lookup(startToken);
      if (part === undefined) return undefined;
      value = part;
    }
    total += sign * value;
    if (index < tokens.length) {
      const operator = tokens[index++];
      if (operator !== "+" && operator !== "-") return undefined;
      sign = operator === "+" ? 1n : -1n;
    }
  }
  return total;
}

function evaluateCatalog(
  leafValues: Map<string, bigint>,
  side: "current" | "previous",
  issues: AjpesReportIssue[],
): Map<string, bigint> {
  const result = new Map<string, bigint>();
  const visiting = new Set<string>();
  const evaluate = (id: string): bigint | undefined => {
    if (result.has(id)) return result.get(id);
    const row = AOP_BY_ID.get(id);
    if (!row) return undefined;
    if (visiting.has(id)) {
      setIssue(issues, "catalog_formula_cycle", `Uradni AOP ${id} vsebuje krožno formulo.`, true);
      return undefined;
    }
    visiting.add(id);
    let amount = leafValues.get(id) ?? ZERO;
    if (row.formula) {
      let calculated = evalExpression(row.formula, evaluate);
      if (calculated === undefined) {
        setIssue(
          issues,
          "catalog_formula_invalid",
          `Uradne formule AOP ${id} ni mogoče varno izračunati.`,
          true,
        );
        visiting.delete(id);
        return undefined;
      }
      // The official form has distinct positive profit and loss AOPs. A
      // negative difference belongs in the paired row, not as a negative or
      // absolute value in the current row.
      if (NONNEGATIVE_RESULT_FORMULAS.has(id) && calculated < ZERO) {
        calculated = ZERO;
      }
      amount = calculated;
    }
    visiting.delete(id);
    result.set(id, amount);
    return amount;
  };

  for (const row of CATALOG) {
    if (evaluate(row.id) === undefined) {
      setIssue(
        issues,
        "catalog_value_missing",
        `Ni mogoče določiti vrednosti za AOP ${row.id} (${side}).`,
        true,
      );
      result.set(row.id, ZERO);
    }
  }
  return result;
}

function calcDefinition(
  rows: JolpDefinitionRow[],
  values: Map<string, bigint>,
  issues: AjpesReportIssue[],
): AjpesJolpRow[] {
  return rows.map((row) => {
    const amount = evalExpression(row.expression, (id) => values.get(id));
    if (amount === undefined) {
      setIssue(
        issues,
        "jolp_definition_invalid",
        `JOLP vrstica ${row.code} ne uporablja veljavne uradne AOP formule.`,
        true,
      );
    }
    return {
      code: row.code,
      label: row.label,
      bold: row.bold,
      current: formatCents(amount ?? ZERO),
      previous: "0.00",
    };
  });
}

function sanitizeSettings(settings: AjpesAnnualSettings): AjpesAnnualSettings {
  const copyRecord = (source: Record<string, string>): Record<string, string> => {
    const result: Record<string, string> = Object.create(null) as Record<string, string>;
    for (const [key, value] of Object.entries(source ?? {})) {
      result[key] = value;
    }
    return result;
  };
  return {
    mappings: copyRecord(settings?.mappings),
    mappingReasons: copyRecord(settings?.mappingReasons),
    currentValues: copyRecord(settings?.currentValues),
    previousValues: copyRecord(settings?.previousValues),
    excludedEntryIds: Array.isArray(settings?.excludedEntryIds)
      ? [...settings.excludedEntryIds]
      : [],
    metadata: copyRecord(settings?.metadata),
  };
}

function assertDefinitionIntegrity(issues: AjpesReportIssue[]): void {
  if (JOLP.balanceSheet.length !== 46 || JOLP.incomeStatement.length !== 43) {
    setIssue(
      issues,
      "jolp_definition_row_count",
      "Definicija JOLP mora vsebovati natanko 46 vrstic bilance in 43 vrstic izkaza poslovnega izida.",
      true,
    );
  }
  for (const row of [...JOLP.balanceSheet, ...JOLP.incomeStatement]) {
    const valid = evalExpression(row.expression, (id) =>
      AOP_CODES.has(id) ? ZERO : undefined,
    );
    if (!row.label.trim() || typeof row.bold !== "boolean" || valid === undefined) {
      setIssue(
        issues,
        "jolp_definition_invalid",
        `Definicija JOLP za vrstico ${row.code} ni veljavna.`,
        true,
      );
    }
  }
}

function parseSourceAmount(
  amount: string,
  accountId: string,
  field: string,
  issues: AjpesReportIssue[],
): bigint {
  const cents = typeof amount === "string" ? parseCents(amount) : undefined;
  if (cents === undefined) {
    setIssue(
      issues,
      "invalid_account_amount",
      `Konto ${accountId} ima neveljaven znesek za ${field}; uporabite decimalno vrednost brez ločil tisočic.`,
      true,
    );
    return ZERO;
  }
  return cents;
}

function addToLeaf(
  leafValues: Map<string, bigint>,
  id: string,
  cents: bigint,
): void {
  leafValues.set(id, (leafValues.get(id) ?? ZERO) + cents);
}

function buildLeafValues(
  source: AjpesSource,
  settings: AjpesAnnualSettings,
  side: "current" | "previous",
  issues: AjpesReportIssue[],
  mappedIds: Set<string>,
): Map<string, bigint> {
  const leafValues = new Map<string, bigint>();
  for (const row of CATALOG) {
    if (!row.isAggregate) leafValues.set(row.id, ZERO);
  }

  if (side === "previous" && settings.metadata.previousDataMode === "manual") {
    return leafValues;
  }

  const accountIds = new Set<string>();
  for (const account of source.accounts ?? []) {
    if (!account.accountId || accountIds.has(account.accountId)) {
      setIssue(
        issues,
        "duplicate_or_missing_account_id",
        "Kontni posnetek vsebuje manjkajoč ali podvojen ID konta; zneski niso varno združljivi.",
        true,
      );
      continue;
    }
    accountIds.add(account.accountId);

    const balanceField = side === "current" ? "currentBalance" : "previousBalance";
    const turnoverField = side === "current" ? "currentTurnover" : "previousTurnover";
    const balance = parseSourceAmount(
      account[balanceField],
      account.accountId,
      balanceField,
      issues,
    );
    const turnover = parseSourceAmount(
      account[turnoverField],
      account.accountId,
      turnoverField,
      issues,
    );
    const applyMapping = (
      mapValue: string | undefined,
      measure: "balance" | "turnover",
      amount: bigint,
      field: string,
    ): void => {
      if (mapValue === "ignore") {
        const reason = getMapValue(
          settings.mappingReasons,
          `${measure}:${account.accountId}`,
        ) ?? getMapValue(settings.mappingReasons, account.accountId);
        if (typeof reason !== "string" || !reason.trim()) {
          setIssue(
            issues,
            "ignore_reason_required",
            `Za izrecno prezrt konto ${account.code} (${field}) navedite razlog preslikave.`,
            true,
          );
        }
        if (isNonZero(amount)) {
          setIssue(
            issues,
            "cannot_ignore_nonzero_account",
            `Konto ${account.code} ima neprazen ${field}; knjižb z zneskom ni dovoljeno prezreti.`,
            true,
          );
        }
        return;
      }
      if (!mapValue) {
        if (isNonZero(amount)) {
          setIssue(
            issues,
            "unmapped_nonzero_account",
            `Konto ${account.code} ${account.name} ima neprazen ${field}, vendar nima preslikave na uradni AOP.`,
            true,
          );
        }
        return;
      }
      const row = AOP_BY_ID.get(mapValue);
      if (!row) {
        setIssue(
          issues,
          "unknown_aop_mapping",
          `Preslikava konta ${account.code} kaže na neznani AOP ${mapValue}.`,
          true,
        );
        return;
      }
      if (row.isAggregate) {
        setIssue(
          issues,
          "aggregate_aop_mapping",
          `Konto ${account.code} je preslikan na nadrejeni AOP ${mapValue}; izberite urejen podrejeni AOP.`,
          true,
        );
        return;
      }
      if (MANUAL_ONLY_IDS.has(mapValue)) {
        setIssue(
          issues,
          "manual_aop_mapping",
          `AOP ${mapValue} je potrditveni/statistični podatek in ga ni dovoljeno napolniti z avtomatsko konto analitiko.`,
          true,
        );
        return;
      }
      const rightForm =
        measure === "balance"
          ? isBalanceAop(mapValue)
          : isTurnoverAop(mapValue);
      if (!rightForm) {
        setIssue(
          issues,
          "aop_measure_mismatch",
          `Preslikava konta ${account.code} za ${field} ne pripada ustreznemu obrazcu AOP.`,
          true,
        );
        return;
      }
      const orientation =
        measure === "balance"
          ? balanceOrientation(mapValue)
          : turnoverOrientation(mapValue);
      if (!orientation) {
        setIssue(
          issues,
          "aop_orientation_missing",
          `Za AOP ${mapValue} ni določena varna debitna/kreditna usmeritev.`,
          true,
        );
        return;
      }
      addToLeaf(
        leafValues,
        mapValue,
        orientation === "credit" ? -amount : amount,
      );
      mappedIds.add(mapValue);
    };

    const accountMapping = getMapValue(settings.mappings, account.accountId);
    const balanceMapping = getMapValue(
      settings.mappings,
      `balance:${account.accountId}`,
    );
    const turnoverMapping = getMapValue(
      settings.mappings,
      `turnover:${account.accountId}`,
    );
    if (
      accountMapping !== undefined &&
      (balanceMapping !== undefined || turnoverMapping !== undefined)
    ) {
      setIssue(
        issues,
        "duplicate_account_mapping",
        `Konto ${account.accountId} ima hkrati splošno in ločeno preslikavo; odstranite dvoumno preslikavo.`,
        true,
      );
      continue;
    }

    if (accountMapping !== undefined) {
      if (accountMapping === "ignore") {
        applyMapping(accountMapping, "balance", balance, balanceField);
        applyMapping(accountMapping, "turnover", turnover, turnoverField);
      } else {
        const target = AOP_BY_ID.get(accountMapping);
        const measure =
          target && isBalanceAop(accountMapping)
            ? "balance"
            : target && isTurnoverAop(accountMapping)
              ? "turnover"
              : "balance";
        applyMapping(
          accountMapping,
          measure,
          measure === "balance" ? balance : turnover,
          measure === "balance" ? balanceField : turnoverField,
        );
      }
    } else if (balanceMapping !== undefined || turnoverMapping !== undefined) {
      if (balanceMapping !== undefined) {
        applyMapping(balanceMapping, "balance", balance, balanceField);
      }
      if (turnoverMapping !== undefined) {
        applyMapping(turnoverMapping, "turnover", turnover, turnoverField);
      }
    } else if (isNonZero(balance) || isNonZero(turnover)) {
      setIssue(
        issues,
        "unmapped_nonzero_account",
        `Konto ${account.code} ${account.name} ima zneske brez potrjene razvrstitve; izberite ustrezen listni AOP za saldo ali promet.`,
        true,
      );
    }
  }
  return leafValues;
}

function applyManualValues(
  source: AjpesSource,
  settings: AjpesAnnualSettings,
  side: "current" | "previous",
  leafValues: Map<string, bigint>,
  mappedIds: Set<string>,
  issues: AjpesReportIssue[],
): void {
  const input = side === "current" ? settings.currentValues : settings.previousValues;
  for (const [id, value] of Object.entries(input)) {
    const row = AOP_BY_ID.get(id);
    if (!row) {
      setIssue(
        issues,
        "unknown_manual_aop",
        `Ročno vnesena vrednost se nanaša na neznani AOP ${id}; vnos ne bo izvožen.`,
        true,
      );
      continue;
    }
    if (row.isAggregate) {
      setIssue(
        issues,
        "aggregate_manual_aop",
        `AOP ${id} je izračunana nadrejena vrstica; ročno lahko urejate samo uradne listne AOP.`,
        true,
      );
      continue;
    }
    if (typeof value !== "string" || parseCents(value) === undefined) {
      setIssue(
        issues,
        "invalid_manual_amount",
        `Ročna vrednost AOP ${id} mora biti strogo decimalno število.`,
        true,
      );
      continue;
    }
    leafValues.set(id, parseCents(value)!);
    mappedIds.add(id);
  }

  for (const id of MANUAL_ONLY_IDS) {
    if (
      side === "previous" &&
      source.settings?.metadata?.previousDataMode === "no-activity"
    ) {
      continue;
    }
    if (!Object.hasOwn(input, id)) {
      setIssue(
        issues,
        "confirmed_manual_value_required",
        `Za AOP ${id} v obdobju ${side === "current" ? source.year : source.year - 1} vnesite potrjen znesek, tudi če je pravilni znesek 0.00.`,
        true,
      );
    }
  }
  for (const id of MANUAL_OR_ACCOUNT_IDS) {
    if (
      side === "previous" &&
      source.settings?.metadata?.previousDataMode === "no-activity"
    ) {
      continue;
    }
    if (!Object.hasOwn(input, id) && !mappedIds.has(id)) {
      setIssue(
        issues,
        "confirmed_manual_value_required",
        `Za AOP ${id} v obdobju ${side === "current" ? source.year : source.year - 1} vnesite potrjen znesek ali ga izrecno preslikajte iz konta.`,
        true,
      );
    }
  }
}

function createAopRows(
  current: Map<string, bigint>,
  previous: Map<string, bigint>,
): AjpesAopRow[] {
  return CATALOG.map((row) => ({
    code: row.id,
    label: row.label,
    section: row.form,
    editable: !row.isAggregate,
    ledgerMappable: !row.isAggregate && !MANUAL_ONLY_IDS.has(row.id) &&
      (isBalanceAop(row.id) || isTurnoverAop(row.id)),
    ...(row.formula ? { formula: row.formula } : {}),
    current: formatCents(current.get(row.id) ?? ZERO),
    previous: formatCents(previous.get(row.id) ?? ZERO),
  }));
}

function validateLeafRanges(
  values: Map<string, bigint>,
  period: string,
  issues: AjpesReportIssue[],
): void {
  for (const row of CATALOG) {
    if (row.isAggregate) continue;
    const amount = values.get(row.id) ?? ZERO;
    if (amount < ZERO) {
      setIssue(
        issues,
        "negative_leaf_aop",
        `AOP ${row.id} (${period}) ima negativno vrednost; preverite stran knjižbe in preslikavo, saj sta dobiček in izguba ločeni v pozitivni uradni vrstici.`,
        true,
      );
    }
  }
}

function withBothSides(
  definitions: JolpDefinitionRow[],
  current: Map<string, bigint>,
  previous: Map<string, bigint>,
  issues: AjpesReportIssue[],
): AjpesJolpRow[] {
  const currentRows = calcDefinition(definitions, current, issues);
  const previousRows = calcDefinition(definitions, previous, issues);
  return currentRows.map((row, index) => ({
    ...row,
    previous: previousRows[index]?.current ?? "0.00",
  }));
}

function checkControls(
  year: number,
  current: Map<string, bigint>,
  previous: Map<string, bigint>,
  issues: AjpesReportIssue[],
): void {
  for (const [period, values] of [
    [`${year}`, current],
    [`${year - 1}`, previous],
  ] as const) {
    const assets = values.get("001");
    const liabilities = values.get("055");
    if (assets !== undefined && liabilities !== undefined && assets - liabilities > 1n) {
      setIssue(
        issues,
        "balance_sheet_unbalanced",
        `Bilanca za ${period} ni uravnotežena: sredstva in obveznosti do virov se razlikujejo za ${formatCents(assets - liabilities)} EUR.`,
        true,
      );
    } else if (
      assets !== undefined &&
      liabilities !== undefined &&
      liabilities - assets > 1n
    ) {
      setIssue(
        issues,
        "balance_sheet_unbalanced",
        `Bilanca za ${period} ni uravnotežena: sredstva in obveznosti do virov se razlikujejo za ${formatCents(liabilities - assets)} EUR.`,
        true,
      );
    }
    const allocatedResult =
      (values.get("070") ?? ZERO) - (values.get("071") ?? ZERO);
    const incomeResult =
      (values.get("186") ?? ZERO) - (values.get("187") ?? ZERO);
    if (allocatedResult !== incomeResult) {
      setIssue(
        issues,
        "result_allocation_differs",
        `Bilanca in izkaz poslovnega izida za ${period} prikazujeta različen poslovni izid; razlika se ne izenači samodejno.`,
        false,
      );
    }
  }
}

function checkSourceAndSettings(
  source: AjpesSource,
  settings: AjpesAnnualSettings,
  issues: AjpesReportIssue[],
): void {
  if (!Number.isInteger(source.year) || source.year < 2000 || source.year > 2100) {
    setIssue(issues, "invalid_year", "Leto poročila ni veljavno.", true);
  }
  if (!source.hasCurrent) {
    setIssue(
      issues,
      "current_fiscal_data_missing",
      `Za leto ${source.year} ni popolnih saldov in prometa.`,
      true,
    );
  }
  if (!source.hasPrevious) {
    const mode = settings.metadata.previousDataMode ?? "ledger";
    if (mode === "ledger") {
      setIssue(
        issues,
        "previous_fiscal_data_missing",
        `Za primerjalno leto ${source.year - 1} ni popolnih saldov in prometa.`,
        true,
      );
    } else if (!PREVIOUS_DATA_MODES.has(mode)) {
      setIssue(
        issues,
        "previous_data_mode_invalid",
        "Način priprave primerjalnega leta ni veljaven.",
        true,
      );
    }
  }
  if (!source.sourceVersion?.trim()) {
    setIssue(issues, "source_version_missing", "Manjka različica vira računovodskih podatkov.", true);
  }
  for (const [field, value] of Object.entries(source.company ?? {})) {
    if (typeof value !== "string") {
      setIssue(issues, "invalid_company_data", `Podatek podjetja ${field} ni veljaven.`, true);
    }
  }
  for (const field of ["name", "street", "postalCode", "city", "registrationNumber"] as const) {
    if (!source.company?.[field]?.trim()) {
      setIssue(
        issues,
        "company_data_missing",
        `Manjka obvezen podatek podjetja: ${field}.`,
        true,
      );
    }
  }
  if (!Number.isInteger(source.revision) || source.revision < 0) {
    setIssue(issues, "invalid_revision", "Različica osnutka ni veljavna.", true);
  }
  if (!Array.isArray(source.accounts)) {
    setIssue(issues, "account_snapshot_missing", "Manjka posnetek kontnih sald.", true);
  }
  const accountIds = new Set((source.accounts ?? []).map((account) => account.accountId));
  for (const [key, value] of Object.entries(settings.mappings)) {
    const separator = key.indexOf(":");
    const measure =
      separator > 0 ? key.slice(0, separator) : undefined;
    const accountId =
      measure === "balance" || measure === "turnover"
        ? key.slice(separator + 1)
        : key;
    if (
      (measure !== undefined &&
        measure !== "balance" &&
        measure !== "turnover") ||
      !accountIds.has(accountId)
    ) {
      setIssue(
        issues,
        "mapping_account_missing",
        `Preslikava ${key} se ne nanaša na konto v posnetku.`,
        true,
      );
    }
    if (typeof value !== "string") {
      setIssue(
        issues,
        "invalid_mapping_value",
        `Vrednost preslikave ${key} mora biti niz.`,
        true,
      );
    }
  }
  for (const [settingName, record] of [
    ["mappingReasons", settings.mappingReasons],
    ["currentValues", settings.currentValues],
    ["previousValues", settings.previousValues],
    ["metadata", settings.metadata],
  ] as const) {
    for (const [key, value] of Object.entries(record)) {
      if (typeof value !== "string") {
        setIssue(
          issues,
          "invalid_setting_value",
          `Nastavitev ${settingName}.${key} mora biti besedilo.`,
          true,
        );
      }
    }
  }
  const validMappingReasonKeys = new Set<string>();
  for (const accountId of accountIds) {
    validMappingReasonKeys.add(accountId);
    validMappingReasonKeys.add(`balance:${accountId}`);
    validMappingReasonKeys.add(`turnover:${accountId}`);
  }
  for (const key of Object.keys(settings.mappingReasons)) {
    if (!validMappingReasonKeys.has(key)) {
      setIssue(
        issues,
        "mapping_reason_account_missing",
        `Razlog preslikave ${key} se ne nanaša na konto v posnetku.`,
        true,
      );
    }
  }

  if (!Array.isArray(source.journals)) {
    setIssue(issues, "journal_choices_missing", "Manjkajo možnosti izbire temeljnic.", true);
  }
  const journalIds = new Set(
    (Array.isArray(source.journals) ? source.journals : []).map((journal) => journal.id),
  );
  const excluded = new Set<string>();
  for (const id of settings.excludedEntryIds) {
    if (excluded.has(id)) {
      setIssue(issues, "duplicate_excluded_entry", `Temeljnica ${id} je izbrana več kot enkrat.`, true);
    }
    excluded.add(id);
    if (!journalIds.has(id)) {
      setIssue(
        issues,
        "excluded_entry_missing",
        `Izbrana zaključna temeljnica ${id} ni več med razpoložljivimi temeljnicami.`,
        true,
      );
    }
  }
  for (const warning of Array.isArray(source.sourceWarnings) ? source.sourceWarnings : []) {
    setIssue(issues, "source_integrity_warning", warning, true);
  }
}

function applyPreviousDataMode(
  source: AjpesSource,
  settings: AjpesAnnualSettings,
  previousLeaves: Map<string, bigint>,
  issues: AjpesReportIssue[],
): void {
  const mode = settings.metadata.previousDataMode ?? "ledger";
  if (!PREVIOUS_DATA_MODES.has(mode)) {
    setIssue(
      issues,
      "previous_data_mode_invalid",
      "Način priprave primerjalnega leta mora biti ledger, manual ali no-activity.",
      true,
    );
    return;
  }
  if (source.hasPrevious && mode === "no-activity") {
    setIssue(
      issues,
      "previous_no_activity_conflict",
      "Primerjalno leto ima podatke; pred izvozom odstranite način brez dejavnosti.",
      true,
    );
    return;
  }
  if (mode === "manual") {
    const supplied = new Set(Object.keys(settings.previousValues));
    for (const row of CATALOG) {
      if (!row.isAggregate && !supplied.has(row.id)) {
        setIssue(
          issues,
          "previous_manual_leaf_missing",
          `Za ročno pripravo primerjalnega leta manjka potrjena vrednost listnega AOP ${row.id}.`,
          true,
        );
      }
    }
    return;
  }

  if (source.hasPrevious || mode === "ledger") return;

  for (const account of source.accounts ?? []) {
    const balance = parseSourceAmount(
      account.previousBalance,
      account.accountId,
      "previousBalance",
      issues,
    );
    const turnover = parseSourceAmount(
      account.previousTurnover,
      account.accountId,
      "previousTurnover",
      issues,
    );
    if (isNonZero(balance) || isNonZero(turnover)) {
      setIssue(
        issues,
        "previous_no_activity_conflict",
        `Primerjalno leto je označeno kot brez dejavnosti, vendar konto ${account.code} vsebuje pretekli znesek.`,
        true,
      );
    }
  }
  for (const [id, value] of Object.entries(settings.previousValues)) {
    const cents = typeof value === "string" ? parseCents(value) : undefined;
    if (cents === undefined || cents !== ZERO) {
      setIssue(
        issues,
        "previous_no_activity_conflict",
        `Način brez dejavnosti zahteva ničelno ročno vrednost za AOP ${id}.`,
        true,
      );
    }
  }
  for (const row of CATALOG) {
    if (!row.isAggregate) previousLeaves.set(row.id, ZERO);
  }
}

export function buildAjpesAnnualReport(
  source: AjpesSource,
): AjpesAnnualReport {
  const settings = sanitizeSettings(source.settings);
  const issues: AjpesReportIssue[] = [];
  assertDefinitionIntegrity(issues);
  checkSourceAndSettings(source, settings, issues);

  const currentMapped = new Set<string>();
  const previousMapped = new Set<string>();
  const currentLeaves = buildLeafValues(
    source,
    settings,
    "current",
    issues,
    currentMapped,
  );
  const previousLeaves = buildLeafValues(
    source,
    settings,
    "previous",
    issues,
    previousMapped,
  );
  applyPreviousDataMode(source, settings, previousLeaves, issues);
  applyManualValues(
    source,
    settings,
    "current",
    currentLeaves,
    currentMapped,
    issues,
  );
  applyManualValues(
    source,
    settings,
    "previous",
    previousLeaves,
    previousMapped,
    issues,
  );
  const current = evaluateCatalog(currentLeaves, "current", issues);
  const previous = evaluateCatalog(previousLeaves, "previous", issues);
  validateLeafRanges(current, String(source.year), issues);
  validateLeafRanges(previous, String(source.year - 1), issues);
  checkControls(source.year, current, previous, issues);

  const balanceSheet = withBothSides(JOLP.balanceSheet, current, previous, issues);
  const incomeStatement = withBothSides(
    JOLP.incomeStatement,
    current,
    previous,
    issues,
  );
  const aopRows = createAopRows(current, previous);
  const sourceFingerprint = fingerprint({ ...source, settings }, aopRows);
  const reviewed = source.reviewedFingerprint === sourceFingerprint;
  const hasBlockingIssues = issues.some((issue) => issue.blocking);
  const canExport = reviewed && !hasBlockingIssues;
  const completeCatalog =
    aopRows.length === AJPES_GD_AOP_CATALOG_2025.metadata.catalogueRows &&
    aopRows.every((row, index) => row.code === CATALOG[index]?.id);

  return {
    year: source.year,
    company: { ...source.company },
    settings,
    revision: source.revision,
    sourceFingerprint,
    reviewed,
    canExport,
    canExportXml: canExport && source.year === 2025 && completeCatalog,
    supportedXmlYears: [2025],
    balanceSheet,
    incomeStatement,
    aopRows,
    accounts: (Array.isArray(source.accounts) ? source.accounts : []).map((account) => ({
      ...account,
    })),
    // Deliberately retain both years' choices; the UI controls year selection.
    journals: (Array.isArray(source.journals) ? source.journals : []).map((journal) => ({
      ...journal,
    })),
    issues,
  };
}

/**
 * Produce both explicit AOP maps required by the LP2025 XML contract. Values
 * come only from the calculated report rows; invalid manual keys are never
 * copied into either output object.
 */
export function annualXmlValues(report: AjpesAnnualReport): {
  current: Record<string, string>;
  previous: Record<string, string>;
} {
  if (
    report.year !== 2025 ||
    report.aopRows.length !== AJPES_GD_AOP_CATALOG_2025.metadata.catalogueRows ||
    report.aopRows.some((row, index) => row.code !== CATALOG[index]?.id)
  ) {
    throw new Error("XML requires the complete official 2025 GD AOP catalogue.");
  }
  const current: Record<string, string> = Object.create(null) as Record<string, string>;
  const previous: Record<string, string> = Object.create(null) as Record<string, string>;
  for (const row of report.aopRows) {
    if (parseCents(row.current) === undefined || parseCents(row.previous) === undefined) {
      throw new Error(`XML AOP ${row.code} does not contain strict EUR amounts.`);
    }
    current[row.code] = formatCents(parseCents(row.current)!);
    previous[row.code] = formatCents(parseCents(row.previous)!);
  }
  return { current, previous };
}