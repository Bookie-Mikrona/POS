import Decimal from "decimal.js";

export type LedgerMovement = {
  id: string;
  date: string;
  debit: string | number;
  credit: string | number;
  sourceOrder: number;
  balanceGroup?: string;
};

export type SettlementMovement = {
  /** Stable source identity: allocation UUID, manual close UUID, or source evidence key. */
  id: string;
  sourceLineId: string;
  targetLineId?: string | null;
  amount: string | number;
  effectiveDate: string;
  eventType: "close" | "reopen";
  closeEventId?: string | null;
  externalClosingId?: string | null;
};

function decimal(value: string | number): Decimal {
  const parsed = new Decimal(value);
  if (!parsed.isFinite()) throw new Error("Znesek zapiranja ali knjižbe ni veljaven.");
  return parsed;
}

/**
 * Deduplicate source evidence, apply only close/reopen events effective on the
 * requested date, and return each still-active closing's exact amount.
 */
export function activeSettlementAmounts(
  settlements: readonly SettlementMovement[],
  asOfDate: string,
): Map<string, Decimal> {
  const closes = new Map<string, SettlementMovement>();
  const reopens = new Map<string, Decimal>();
  for (const event of settlements) {
    if (event.effectiveDate > asOfDate) continue;
    if (event.eventType === "close") {
      const prior = closes.get(event.id);
      if (prior) {
        if (decimal(prior.amount).cmp(decimal(event.amount)) !== 0
          || prior.sourceLineId !== event.sourceLineId
          || (prior.targetLineId ?? null) !== (event.targetLineId ?? null)) {
          throw new Error(`Podvojena identiteta zapiranja ${event.id} ima različne podatke.`);
        }
      } else {
        closes.set(event.id, event);
      }
    } else {
      const parent = event.closeEventId ?? event.externalClosingId;
      if (!parent) continue;
      reopens.set(parent, (reopens.get(parent) ?? new Decimal(0)).plus(decimal(event.amount)));
    }
  }
  const active = new Map<string, Decimal>();
  for (const [id, close] of closes) {
    const amount = decimal(close.amount);
    const reopened = Decimal.min(amount, reopens.get(id) ?? new Decimal(0));
    active.set(id, amount.minus(reopened));
  }
  return active;
}

/**
 * Decimal-safe chronological card. Printed debit/credit preserve the signed
 * source value. A negative debit has credit-side open effect (and vice versa),
 * rather than being discarded or rewritten in the source presentation.
 */
export function calculatePartnerLedger<T extends LedgerMovement>(
  movements: readonly T[],
  settlements: readonly SettlementMovement[],
  asOfDate: string,
): Array<T & { openDebit: string; openCredit: string; runningBalance: string }> {
  const ordered = [...movements]
    .filter((row) => row.date <= asOfDate)
    .sort((a, b) => a.date.localeCompare(b.date) || a.sourceOrder - b.sourceOrder || a.id.localeCompare(b.id));
  const closingAmounts = activeSettlementAmounts(settlements, asOfDate);
  const closedByLine = new Map<string, Decimal>();
  const closingById = new Map(settlements.filter((row) => row.eventType === "close").map((row) => [row.id, row]));
  for (const [id, activeAmount] of closingAmounts) {
    const closing = closingById.get(id);
    if (!closing || activeAmount.lte(0)) continue;
    closedByLine.set(closing.sourceLineId, (closedByLine.get(closing.sourceLineId) ?? new Decimal(0)).plus(activeAmount));
    if (closing.targetLineId && closing.targetLineId !== closing.sourceLineId) {
      closedByLine.set(closing.targetLineId, (closedByLine.get(closing.targetLineId) ?? new Decimal(0)).plus(activeAmount));
    }
  }
  const runningByGroup = new Map<string, Decimal>();
  return ordered.map((line) => {
    const debit = decimal(line.debit);
    const credit = decimal(line.credit);
    const effect = debit.minus(credit);
    const group = line.balanceGroup ?? "__all__";
    const runningBalance = (runningByGroup.get(group) ?? new Decimal(0)).plus(effect);
    runningByGroup.set(group, runningBalance);
    const absoluteEffect = effect.abs();
    const closed = Decimal.min(absoluteEffect, closedByLine.get(line.id) ?? new Decimal(0));
    const remainder = absoluteEffect.minus(closed);
    return {
      ...line,
      openDebit: (effect.gt(0) ? remainder : new Decimal(0)).toFixed(2),
      openCredit: (effect.lt(0) ? remainder : new Decimal(0)).toFixed(2),
      runningBalance: runningBalance.toFixed(2),
    };
  });
}

/** Shared invoice/open-item remainder calculation using the same evidence rules. */
export function calculateOpenRemainder(
  gross: string | number,
  settlements: readonly SettlementMovement[],
  asOfDate: string,
  lineId?: string,
): string {
  const active = activeSettlementAmounts(settlements, asOfDate);
  const closes = new Map(settlements.filter((event) => event.eventType === "close").map((event) => [event.id, event]));
  let closed = new Decimal(0);
  for (const [id, amount] of active) {
    const close = closes.get(id);
    if (!close || (lineId && close.sourceLineId !== lineId && close.targetLineId !== lineId)) continue;
    closed = closed.plus(amount);
  }
  return Decimal.max(new Decimal(0), decimal(gross).minus(closed)).toFixed(2);
}

/** Strictly parse historical evidence's documented month/day/year date token. */
export function parseLegacyRecordedDate(value: string): string | null {
  const match = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(value);
  if (!match) return null;
  const month = Number(match[1]);
  const day = Number(match[2]);
  const year = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  if (candidate.getUTCFullYear() !== year || candidate.getUTCMonth() !== month - 1 || candidate.getUTCDate() !== day) return null;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}