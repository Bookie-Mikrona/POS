import { pool } from "@workspace/db";
import { logger } from "./logger";
import { ObjectStorageService } from "./objectStorage";

const STAGING_PREFIX = "uploads/public-profile-staging";
const UUID_PATTERN =
  "[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}";
const STAGING_PATH_PATTERN = new RegExp(
  `^/objects/${STAGING_PREFIX}/${UUID_PATTERN}/[1-9][0-9]*/${UUID_PATTERN}$`,
  "i",
);

export const PUBLIC_PROFILE_STAGING_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
export const PUBLIC_PROFILE_IMAGE_CLEANUP_INTERVAL_MS = 60 * 60 * 1000;
export const PUBLIC_PROFILE_IMAGE_CLEANUP_PAGE_SIZE = 100;
export const PUBLIC_PROFILE_IMAGE_CLEANUP_MAX_PAGES = 3;
export const PUBLIC_PROFILE_IMAGE_CLEANUP_CYCLE_WARNING_MS =
  24 * 60 * 60 * 1000;
export const PUBLIC_PROFILE_IMAGE_CLEANUP_WARNING_COOLDOWN_MS =
  24 * 60 * 60 * 1000;

type StorageRetentionApi = Pick<
  ObjectStorageService,
  "listObjectEntityPage" | "deleteObjectEntity"
>;

type CleanupDependencies = {
  storage: StorageRetentionApi;
  loadReferencedPaths: () => Promise<Set<string>>;
  onDeleteError?: (objectPath: string, error: unknown) => void;
};

export type CleanupCursorState = {
  pageToken: string;
  cycleStartedAtMs?: number;
  lastWarningAtMs?: number;
};

type CleanupCursorStore = {
  load: () => Promise<CleanupCursorState | undefined>;
  save: (state: CleanupCursorState | null) => Promise<void>;
};

const CLEANUP_CURSOR_KEY =
  `maintenance:${STAGING_PREFIX}:continuation-token`;
const CLEANUP_CURSOR_VERSION = 2;
const CLEANUP_ADVISORY_LOCK_KEY =
  `maintenance:${STAGING_PREFIX}:scheduled-cleanup`;

function validTimestamp(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

const cleanupCursorStore: CleanupCursorStore = {
  async load() {
    const result = await pool.query<{ value: string }>(
      "SELECT value FROM system_settings WHERE key = $1",
      [CLEANUP_CURSOR_KEY],
    );
    const rawValue = result.rows[0]?.value;
    if (!rawValue) return undefined;

    try {
      const parsed = JSON.parse(rawValue) as {
        version?: unknown;
        prefix?: unknown;
        pageToken?: unknown;
        cycleStartedAtMs?: unknown;
        lastWarningAtMs?: unknown;
      };
      if (
        (parsed.version === 1 || parsed.version === CLEANUP_CURSOR_VERSION) &&
        parsed.prefix === STAGING_PREFIX &&
        typeof parsed.pageToken === "string" &&
        parsed.pageToken.length > 0 &&
        parsed.pageToken.length <= 4096
      ) {
        return {
          pageToken: parsed.pageToken,
          cycleStartedAtMs: validTimestamp(parsed.cycleStartedAtMs)
            ? parsed.cycleStartedAtMs
            : undefined,
          lastWarningAtMs: validTimestamp(parsed.lastWarningAtMs)
            ? parsed.lastWarningAtMs
            : undefined,
        };
      }
    } catch {
      // Neveljaven zapis spodaj odstranimo in varno začnemo nov cikel.
    }

    await this.save(null);
    logger.warn(
      { stateKey: CLEANUP_CURSOR_KEY, prefix: STAGING_PREFIX },
      "Javne slike: neveljaven položaj čiščenja je bil ponastavljen",
    );
    return undefined;
  },
  async save(state) {
    if (!state) {
      await pool.query("DELETE FROM system_settings WHERE key = $1", [
        CLEANUP_CURSOR_KEY,
      ]);
      return;
    }
    await pool.query(
      `INSERT INTO system_settings(key, value, updated_at)
       VALUES ($1, $2, now())
       ON CONFLICT (key) DO UPDATE
       SET value = EXCLUDED.value, updated_at = now()`,
      [
        CLEANUP_CURSOR_KEY,
        JSON.stringify({
          version: CLEANUP_CURSOR_VERSION,
          prefix: STAGING_PREFIX,
          ...state,
        }),
      ],
    );
  },
};

async function loadReferencedPublicImagePaths(): Promise<Set<string>> {
  const result = await pool.query<{ image_path: string }>(`
    SELECT image_path
    FROM (
      SELECT logo_url AS image_path FROM public_venue_profiles
      UNION
      SELECT cover_image_url AS image_path FROM public_venue_profiles
      UNION
      SELECT image_url AS image_path FROM public_voucher_products
    ) referenced_images
    WHERE image_path IS NOT NULL
  `);
  return new Set(result.rows.map((row) => row.image_path));
}

function defaultDependencies(): CleanupDependencies {
  return {
    storage: new ObjectStorageService(),
    loadReferencedPaths: loadReferencedPublicImagePaths,
    onDeleteError: (objectPath, error) => {
      logger.warn(
        { err: error, objectPath },
        "Javne slike: začasne slike ni bilo mogoče odstraniti",
      );
    },
  };
}

export async function cleanupAbandonedPublicProfileImages(
  now = new Date(),
  dependencies = defaultDependencies(),
  options: { pageToken?: string } = {},
): Promise<{
  scanned: number;
  deleted: number;
  failed: number;
  nextPageToken: string | null;
}> {
  const referencedPaths = await dependencies.loadReferencedPaths();
  const cutoff = now.getTime() - PUBLIC_PROFILE_STAGING_RETENTION_MS;
  let scanned = 0;
  let deleted = 0;
  let failed = 0;
  let pageToken = options.pageToken;

  for (let page = 0; page < PUBLIC_PROFILE_IMAGE_CLEANUP_MAX_PAGES; page++) {
    const result = await dependencies.storage.listObjectEntityPage(STAGING_PREFIX, {
      pageSize: PUBLIC_PROFILE_IMAGE_CLEANUP_PAGE_SIZE,
      pageToken,
    });
    scanned += result.objects.length;

    for (const object of result.objects) {
      if (
        !STAGING_PATH_PATTERN.test(object.objectPath) ||
        !object.timeCreated ||
        object.timeCreated.getTime() > cutoff ||
        referencedPaths.has(object.objectPath)
      ) {
        continue;
      }

      try {
        await dependencies.storage.deleteObjectEntity(object.objectPath);
        deleted++;
      } catch (error) {
        failed++;
        dependencies.onDeleteError?.(object.objectPath, error);
      }
    }

    pageToken = result.nextPageToken ?? undefined;
    if (!pageToken) break;
  }

  return { scanned, deleted, failed, nextPageToken: pageToken ?? null };
}

function isInvalidPageTokenError(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  const candidate = error as {
    code?: unknown;
    statusCode?: unknown;
    message?: unknown;
    errors?: unknown;
  };
  const code = candidate.code ?? candidate.statusCode;
  const invalidCode =
    code === 400 ||
    code === 410 ||
    code === "400" ||
    code === "410" ||
    code === "INVALID_ARGUMENT";
  const mentionsPageToken = (value: unknown) =>
    typeof value === "string" &&
    /page[\s_-]*token|continuation[\s_-]*token/i.test(value);
  const nestedErrorMentionsPageToken =
    Array.isArray(candidate.errors) &&
    candidate.errors.some((nestedError) => {
      if (typeof nestedError !== "object" || nestedError === null) return false;
      const detail = nestedError as { location?: unknown; message?: unknown };
      return (
        mentionsPageToken(detail.location) ||
        mentionsPageToken(detail.message)
      );
    });
  return (
    invalidCode &&
    (mentionsPageToken(candidate.message) || nestedErrorMentionsPageToken)
  );
}

export async function runPublicProfileImageCleanup(
  now = new Date(),
  dependencies = defaultDependencies(),
  cursorStore: CleanupCursorStore = cleanupCursorStore,
  operationalDependencies: {
    onCycleOverdue: (details: {
      cycleAgeMs: number;
      warningCooldownMs: number;
      scanned: number;
      deleted: number;
      failed: number;
    }) => void;
  } = {
    onCycleOverdue: (details) => {
      logger.warn(
        {
          reason: "public_profile_image_cleanup_cycle_overdue",
          prefix: STAGING_PREFIX,
          ...details,
        },
        "Javne slike: cikel čiščenja predolgo ni dosegel konca seznama",
      );
    },
  },
): ReturnType<typeof cleanupAbandonedPublicProfileImages> {
  const persistedState = await cursorStore.load();
  const persistedPageToken = persistedState?.pageToken;
  let result: Awaited<ReturnType<typeof cleanupAbandonedPublicProfileImages>>;
  let staleCursorWasCleared = false;

  try {
    result = await cleanupAbandonedPublicProfileImages(
      now,
      dependencies,
      { pageToken: persistedPageToken },
    );
  } catch (error) {
    if (!persistedPageToken || !isInvalidPageTokenError(error)) throw error;

    await cursorStore.save(null);
    staleCursorWasCleared = true;
    logger.warn(
      { stateKey: CLEANUP_CURSOR_KEY, prefix: STAGING_PREFIX },
      "Javne slike: zastarel položaj čiščenja je bil ponastavljen",
    );
    result = await cleanupAbandonedPublicProfileImages(now, dependencies);
  }

  if (!result.nextPageToken) {
    if (!staleCursorWasCleared) await cursorStore.save(null);
    return result;
  }

  const nowMs = now.getTime();
  const cycleStartedAtMs = staleCursorWasCleared
    ? nowMs
    : persistedState?.cycleStartedAtMs ?? nowMs;
  const cycleAgeMs = Math.max(0, nowMs - cycleStartedAtMs);
  const lastWarningAtMs = staleCursorWasCleared
    ? undefined
    : persistedState?.lastWarningAtMs;
  const warningCooldownElapsed =
    lastWarningAtMs === undefined ||
    nowMs - lastWarningAtMs >=
      PUBLIC_PROFILE_IMAGE_CLEANUP_WARNING_COOLDOWN_MS;
  const overdue =
    cycleAgeMs >= PUBLIC_PROFILE_IMAGE_CLEANUP_CYCLE_WARNING_MS;

  if (overdue && warningCooldownElapsed) {
    operationalDependencies.onCycleOverdue({
      cycleAgeMs,
      warningCooldownMs:
        PUBLIC_PROFILE_IMAGE_CLEANUP_WARNING_COOLDOWN_MS,
      scanned: result.scanned,
      deleted: result.deleted,
      failed: result.failed,
    });
  }

  await cursorStore.save({
    pageToken: result.nextPageToken,
    cycleStartedAtMs,
    lastWarningAtMs: overdue && warningCooldownElapsed
      ? nowMs
      : lastWarningAtMs,
  });
  return result;
}

type ScheduledCleanupDependencies = {
  execute: typeof runPublicProfileImageCleanup;
  acquireLock: () => Promise<(() => Promise<void>) | null>;
  onCompleted: (
    result: Awaited<ReturnType<typeof runPublicProfileImageCleanup>>,
  ) => void;
  onError: (error: unknown) => void;
  onSkipped: (reason: "process_already_running" | "distributed_lock_held") => void;
};

export async function tryAcquirePublicProfileImageCleanupLock(): Promise<
  (() => Promise<void>) | null
> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ acquired: boolean }>(
      "SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS acquired",
      [CLEANUP_ADVISORY_LOCK_KEY],
    );
    if (!result.rows[0]?.acquired) {
      client.release();
      return null;
    }
  } catch (error) {
    client.release(error instanceof Error ? error : true);
    throw error;
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      const result = await client.query<{ released: boolean }>(
        "SELECT pg_advisory_unlock(hashtextextended($1, 0)) AS released",
        [CLEANUP_ADVISORY_LOCK_KEY],
      );
      if (!result.rows[0]?.released) {
        logger.warn(
          {
            reason: "cleanup_advisory_lock_not_held",
            prefix: STAGING_PREFIX,
          },
          "Javne slike: PostgreSQL zaklep čiščenja ni bil več aktiven",
        );
      }
      client.release();
    } catch (error) {
      client.release(error instanceof Error ? error : true);
      logger.warn(
        {
          err: error,
          reason: "cleanup_advisory_lock_release_failed",
          prefix: STAGING_PREFIX,
        },
        "Javne slike: povezava za zaklep čiščenja je bila prekinjena",
      );
    }
  };
}

function defaultScheduledCleanupDependencies(): ScheduledCleanupDependencies {
  return {
    execute: runPublicProfileImageCleanup,
    acquireLock: tryAcquirePublicProfileImageCleanupLock,
    onCompleted: (result) => {
      logger.info(result, "Javne slike: čiščenje začasnih slik zaključeno");
    },
    onError: (error) => {
      logger.error(
        { err: error },
        "Javne slike: čiščenje začasnih slik ni uspelo",
      );
    },
    onSkipped: (reason) => {
      logger.info(
        {
          reason,
          prefix: STAGING_PREFIX,
        },
        "Javne slike: interval čiščenja je bil izpuščen",
      );
    },
  };
}

let scheduledCleanupInProgress = false;

export async function runScheduledPublicProfileImageCleanup(
  dependencies = defaultScheduledCleanupDependencies(),
): Promise<"completed" | "failed" | "skipped"> {
  if (scheduledCleanupInProgress) {
    dependencies.onSkipped("process_already_running");
    return "skipped";
  }

  scheduledCleanupInProgress = true;
  let releaseLock: (() => Promise<void>) | null = null;
  try {
    releaseLock = await dependencies.acquireLock();
    if (!releaseLock) {
      dependencies.onSkipped("distributed_lock_held");
      return "skipped";
    }
    const result = await dependencies.execute();
    dependencies.onCompleted(result);
    return "completed";
  } catch (error) {
    dependencies.onError(error);
    return "failed";
  } finally {
    await releaseLock?.();
    scheduledCleanupInProgress = false;
  }
}

export function startPublicProfileImageRetentionScheduler(): void {
  logger.info(
    { retentionDays: PUBLIC_PROFILE_STAGING_RETENTION_MS / (24 * 60 * 60 * 1000) },
    "Javne slike: urnik čiščenja začasnih slik nastavljen",
  );
  void runScheduledPublicProfileImageCleanup();
  const timer = setInterval(
    () => { void runScheduledPublicProfileImageCleanup(); },
    PUBLIC_PROFILE_IMAGE_CLEANUP_INTERVAL_MS,
  );
  timer.unref();
}