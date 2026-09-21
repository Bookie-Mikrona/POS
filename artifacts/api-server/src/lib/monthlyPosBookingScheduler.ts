import { eq, like } from "drizzle-orm";
import {
  db,
  pool,
  posBookingSettingsTable,
  systemSettingsTable,
  type PoolClient,
} from "@workspace/db";
import {
  getEffectiveBookingFrequency,
  syncPosBookingForMonth,
} from "./posSyncBooking";
import { logger } from "./logger";

const SCHEDULER_LOCK_KEY = "pos-monthly-booking";
const COMPLETED_COMPANY_PREFIX = "pos_monthly_booking_completed";
const SCHEDULER_START_MONTH_KEY = "pos_monthly_booking_scheduler_start_month";
const SCHEDULER_HOUR = 6;

export interface MonthlyPosBookingRun {
  ran: boolean;
  month: string | null;
  companies: number;
  succeeded: number;
  failed: number;
  skippedReason?: "not-due" | "already-running" | "already-completed";
}

export interface MonthlyPosBookingSchedulerDependencies {
  listEligibleCompanies: (month: string) => Promise<string[]>;
  syncCompany: (companyId: string, month: string) => Promise<{
    created: string[];
    skipped: Array<{ ref: string; reason: string }>;
  }>;
  acquireLock: () => Promise<boolean>;
  releaseLock: () => Promise<void>;
  listCompletedCompanies: (month: string) => Promise<Set<string>>;
  markCompanyCompleted: (companyId: string, month: string) => Promise<void>;
  getOrCreateStartMonth: (initialMonth: string) => Promise<string>;
}

function ljubljanaParts(now: Date): {
  year: number;
  month: number;
  day: number;
  date: string;
  hour: number;
  minute: number;
} {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Europe/Ljubljana",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
  const parts = formatter.formatToParts(now);
  const value = (type: Intl.DateTimeFormatPartTypes) =>
    Number(parts.find((part) => part.type === type)?.value ?? 0);
  const year = value("year");
  const month = value("month");
  const day = value("day");

  return {
    year,
    month,
    day,
    date: `${year.toString().padStart(4, "0")}-${month.toString().padStart(2, "0")}-${day.toString().padStart(2, "0")}`,
    hour: value("hour"),
    minute: value("minute"),
  };
}

function firstWorkingDayOfMonth(year: number, month: number): number {
  for (let day = 1; day <= 7; day += 1) {
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    if (weekday !== 0 && weekday !== 6) return day;
  }
  throw new Error(`Ni mogoče najti prvega delovnega dne za ${year}-${month}`);
}

export function isMonthlyBookingWindowOpen(now: Date): boolean {
  const parts = ljubljanaParts(now);
  const firstWorkingDay = firstWorkingDayOfMonth(parts.year, parts.month);
  return parts.day > firstWorkingDay
    || (parts.day === firstWorkingDay && parts.hour >= SCHEDULER_HOUR);
}

export function previousMonthFor(now: Date): string {
  const parts = ljubljanaParts(now);
  const previous = new Date(Date.UTC(parts.year, parts.month - 2, 1));
  return `${previous.getUTCFullYear()}-${(previous.getUTCMonth() + 1).toString().padStart(2, "0")}`;
}

export function monthsInclusive(startMonth: string, endMonth: string): string[] {
  const [startYear, startMonthNumber] = startMonth.split("-").map(Number);
  const [endYear, endMonthNumber] = endMonth.split("-").map(Number);
  const cursor = new Date(Date.UTC(startYear, startMonthNumber - 1, 1));
  const end = new Date(Date.UTC(endYear, endMonthNumber - 1, 1));
  const months: string[] = [];

  while (cursor <= end) {
    months.push(
      `${cursor.getUTCFullYear()}-${(cursor.getUTCMonth() + 1).toString().padStart(2, "0")}`,
    );
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

interface FrequencySettings {
  companyId: string;
  salesBookingFrequency: string | null;
  consumptionBookingFrequency: string | null;
  frequencyEffectiveFrom: string | null;
  salesBookingFrequencyPrevious: string | null;
  consumptionBookingFrequencyPrevious: string | null;
}

export function isEligibleForMonthlyBooking(
  settings: FrequencySettings,
  month: string,
): boolean {
  const date = `${month}-01`;
  return getEffectiveBookingFrequency(settings, "PRODAJA", date) === "monthly"
    || getEffectiveBookingFrequency(settings, "PORABA", date) === "monthly";
}

async function listEligibleCompanies(month: string): Promise<string[]> {
  const rows = await db
    .select({
      companyId: posBookingSettingsTable.companyId,
      salesBookingFrequency: posBookingSettingsTable.salesBookingFrequency,
      consumptionBookingFrequency: posBookingSettingsTable.consumptionBookingFrequency,
      frequencyEffectiveFrom: posBookingSettingsTable.frequencyEffectiveFrom,
      salesBookingFrequencyPrevious: posBookingSettingsTable.salesBookingFrequencyPrevious,
      consumptionBookingFrequencyPrevious: posBookingSettingsTable.consumptionBookingFrequencyPrevious,
    })
    .from(posBookingSettingsTable);

  return rows
    .filter((row) => isEligibleForMonthlyBooking(row, month))
    .map((row) => row.companyId);
}

/**
 * Ustvari zaklep, ki isto PostgreSQL povezavo zadrži od pridobitve do
 * sprostitve. Sejni advisory lock je vezan na povezavo, ne na pool.
 */
export function createPostgresSchedulerLock(
  lockKey = SCHEDULER_LOCK_KEY,
  connect: () => Promise<PoolClient> = () => pool.connect(),
) {
  let lockClient: PoolClient | null = null;

  return {
    async acquireLock(): Promise<boolean> {
      const candidate = await connect();
      try {
        const result = await candidate.query<{ acquired: boolean }>(
          "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
          [lockKey],
        );
        if (result.rows[0]?.acquired) {
          lockClient = candidate;
          return true;
        }
      } catch (err) {
        candidate.release();
        throw err;
      }
      candidate.release();
      return false;
    },

    async releaseLock(): Promise<void> {
      const client = lockClient;
      lockClient = null;
      if (!client) return;
      try {
        const result = await client.query<{ unlocked: boolean }>(
          "SELECT pg_advisory_unlock(hashtext($1)) AS unlocked",
          [lockKey],
        );
        if (!result.rows[0]?.unlocked) {
          throw new Error(`PostgreSQL advisory lock ${lockKey} ni bil sproščen`);
        }
        client.release();
      } catch (err) {
        client.release(err instanceof Error ? err : new Error(String(err)));
        throw err;
      }
    },
  };
}

const productionLock = createPostgresSchedulerLock();

function completedCompanyKey(companyId: string, month: string): string {
  return `${COMPLETED_COMPANY_PREFIX}:${month}:${companyId}`;
}

async function listCompletedCompanies(month: string): Promise<Set<string>> {
  const prefix = `${COMPLETED_COMPANY_PREFIX}:${month}:`;
  const rows = await db
    .select({ value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(like(systemSettingsTable.key, `${prefix}%`));
  return new Set(rows.map((row) => row.value));
}

async function markCompanyCompleted(companyId: string, month: string): Promise<void> {
  await db
    .insert(systemSettingsTable)
    .values({ key: completedCompanyKey(companyId, month), value: companyId })
    .onConflictDoUpdate({
      target: systemSettingsTable.key,
      set: { value: companyId, updatedAt: new Date() },
    });
}

async function getOrCreateStartMonth(initialMonth: string): Promise<string> {
  await db
    .insert(systemSettingsTable)
    .values({ key: SCHEDULER_START_MONTH_KEY, value: initialMonth })
    .onConflictDoNothing({ target: systemSettingsTable.key });

  const [row] = await db
    .select({ value: systemSettingsTable.value })
    .from(systemSettingsTable)
    .where(eq(systemSettingsTable.key, SCHEDULER_START_MONTH_KEY))
    .limit(1);
  if (!row) throw new Error("Začetnega meseca POS schedulerja ni mogoče shraniti");
  return row.value;
}

const productionDependencies: MonthlyPosBookingSchedulerDependencies = {
  listEligibleCompanies,
  syncCompany: syncPosBookingForMonth,
  acquireLock: productionLock.acquireLock,
  releaseLock: productionLock.releaseLock,
  listCompletedCompanies,
  markCompanyCompleted,
  getOrCreateStartMonth,
};

const NON_BLOCKING_SKIP_REASONS = [
  "Prodaja za ta mesec ni nastavljena na mesečno knjiženje",
  "Poraba za ta mesec ni nastavljena na mesečno knjiženje",
  "T4 sledi dnevni frekvenci prodaje",
];

export function hasBlockingMonthlySkip(result: {
  skipped: Array<{ ref?: string; reason: string }>;
}): boolean {
  return result.skipped.some(({ reason }) =>
    !NON_BLOCKING_SKIP_REASONS.includes(reason)
    && !reason.startsWith("Potrjena mesečna "),
  );
}

/**
 * Po prvem delovnem dnevu ob 06:00 izvede manjkajoči mesečni job. Trajni marker
 * omogoča varen catch-up po restartu ali izpadu in preprečuje podvojene zagone.
 * Vsako podjetje je obdelano ločeno, zato napaka enega ne ustavi ostalih.
 */
export async function runMonthlyPosBookingJob(
  now = new Date(),
  dependencies: MonthlyPosBookingSchedulerDependencies = productionDependencies,
): Promise<MonthlyPosBookingRun> {
  if (!isMonthlyBookingWindowOpen(now)) {
    return {
      ran: false,
      month: null,
      companies: 0,
      succeeded: 0,
      failed: 0,
      skippedReason: "not-due",
    };
  }

  if (!(await dependencies.acquireLock())) {
    logger.info("Mesečni POS zbirnik: prejšnji zagon še teče, preskakujem");
    return {
      ran: false,
      month: null,
      companies: 0,
      succeeded: 0,
      failed: 0,
      skippedReason: "already-running",
    };
  }

  const month = previousMonthFor(now);
  let companies = 0;
  let succeeded = 0;
  let failed = 0;

  try {
    const startMonth = await dependencies.getOrCreateStartMonth(month);
    let hadPendingCompany = false;

    for (const pendingMonth of monthsInclusive(startMonth, month)) {
      const completedCompanies = await dependencies.listCompletedCompanies(pendingMonth);
      const eligibleCompanies = [...new Set(
        await dependencies.listEligibleCompanies(pendingMonth),
      )];
      const pendingCompanies = eligibleCompanies.filter(
        (companyId) => !completedCompanies.has(companyId),
      );
      companies += eligibleCompanies.length;
      if (pendingCompanies.length > 0) hadPendingCompany = true;

      for (const companyId of pendingCompanies) {
        try {
          const result = await dependencies.syncCompany(companyId, pendingMonth);
          if (hasBlockingMonthlySkip(result)) {
            failed += 1;
            logger.error(
              { companyId, month: pendingMonth, skipped: result.skipped },
              "Mesečni POS zbirnik: podjetje ni v celoti obdelano",
            );
            continue;
          }
          await dependencies.markCompanyCompleted(companyId, pendingMonth);
          succeeded += 1;
          logger.info(
            { companyId, month: pendingMonth, result },
            "Mesečni POS zbirnik: podjetje obdelano",
          );
        } catch (err) {
          failed += 1;
          logger.error(
            { err, companyId, month: pendingMonth },
            "Mesečni POS zbirnik: napaka pri podjetju",
          );
        }
      }
    }

    if (!hadPendingCompany) {
      return {
        ran: false,
        month,
        companies,
        succeeded: 0,
        failed: 0,
        skippedReason: "already-completed",
      };
    }
  } finally {
    await dependencies.releaseLock();
  }

  return {
    ran: true,
    month,
    companies,
    succeeded,
    failed,
  };
}

async function checkMonthlyPosBookingSchedule(): Promise<void> {
  try {
    await runMonthlyPosBookingJob();
  } catch (err) {
    logger.error({ err }, "Mesečni POS zbirnik: napaka schedulerja");
  }
}

/** Zaženi enkrat ob zagonu API strežnika in nato preverjaj na začetku vsake minute. */
export function startMonthlyPosBookingScheduler(): void {
  logger.info(
    { hour: SCHEDULER_HOUR, timeZone: "Europe/Ljubljana" },
    "Mesečni POS zbirnik: urnik nastavljen",
  );

  void checkMonthlyPosBookingSchedule();

  const now = new Date();
  const msToNextMinute = (60 - now.getSeconds()) * 1000 - now.getMilliseconds() + 500;
  setTimeout(() => {
    void checkMonthlyPosBookingSchedule();
    setInterval(() => {
      void checkMonthlyPosBookingSchedule();
    }, 60_000);
  }, msToNextMinute);
}