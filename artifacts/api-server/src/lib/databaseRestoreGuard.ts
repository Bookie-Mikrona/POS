import { pool } from "@workspace/db";

const RESTORE_LOCK_KEY = "bookie-database-restore-v1";
const BACKUP_LOCK_KEY = "bookie-database-backup-v1";

type ReleaseLock = () => Promise<void>;

async function tryAcquireLock(lockKey: string, shared = false): Promise<ReleaseLock | null> {
  const client = await pool.connect();
  try {
    const result = await client.query<{ acquired: boolean }>(
      shared
        ? "SELECT pg_try_advisory_lock_shared(hashtext($1)) AS acquired"
        : "SELECT pg_try_advisory_lock(hashtext($1)) AS acquired",
      [lockKey],
    );
    if (!result.rows[0]?.acquired) {
      client.release();
      return null;
    }
  } catch (error) {
    client.release();
    throw error;
  }

  let released = false;
  return async () => {
    if (released) return;
    released = true;
    try {
      await client.query(shared
        ? "SELECT pg_advisory_unlock_shared(hashtext($1))"
        : "SELECT pg_advisory_unlock(hashtext($1))", [lockKey]);
    } finally {
      client.release();
    }
  };
}

export async function acquireRestoreLock(): Promise<ReleaseLock | null> {
  return tryAcquireLock(RESTORE_LOCK_KEY);
}

export async function acquireBackupLock(): Promise<ReleaseLock | null> {
  return tryAcquireLock(BACKUP_LOCK_KEY);
}

export async function isDatabaseRestoreInProgress(): Promise<boolean> {
  // Probes may overlap: only the exclusive restore lock must block them.
  // Exclusive probes incorrectly report another ordinary request as a restore.
  const release = await tryAcquireLock(RESTORE_LOCK_KEY, true);
  if (!release) return true;
  await release();
  return false;
}

export async function drainApplicationDatabaseWriters(): Promise<void> {
  await pool.query(`
    SELECT pg_terminate_backend(pid)
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND usename = current_user
      AND pid <> pg_backend_pid()
      AND state IS DISTINCT FROM 'idle'
  `);

  const remaining = await pool.query<{ count: number }>(`
    SELECT count(*)::integer AS count
    FROM pg_stat_activity
    WHERE datname = current_database()
      AND usename = current_user
      AND pid <> pg_backend_pid()
      AND state IS DISTINCT FROM 'idle'
  `);
  if ((remaining.rows[0]?.count ?? 0) > 0) {
    throw new Error(
      "Aktivnih zapisovalnih povezav ni bilo mogoče varno ustaviti. Obnova se ni začela.",
    );
  }
}