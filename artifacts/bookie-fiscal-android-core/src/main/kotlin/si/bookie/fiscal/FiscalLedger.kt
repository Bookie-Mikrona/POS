package si.bookie.fiscal

import android.content.Context
import android.database.sqlite.SQLiteDatabase
import android.database.sqlite.SQLiteOpenHelper
import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyProperties
import java.nio.charset.StandardCharsets
import java.security.KeyStore
import java.security.MessageDigest
import java.time.DayOfWeek
import java.time.Instant
import java.time.ZoneId
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

/**
 * Durable, transactionally allocated fiscal work ledger.
 *
 * A caller must create the exact canonical FURS envelope before [reserve].  The
 * envelope is retained byte-for-byte; it is deliberately not reconstructed from
 * display/print data.  A duplicate idempotency key therefore always returns the
 * original PP-B number and original envelope, while a key reused with different
 * data is rejected.
 */
class FiscalLedger(context: Context) {
    private val helper = Db(context.applicationContext)

    data class Reservation(
        val idempotencyKey: String,
        val ppbSequence: Long,
        val canonicalEnvelope: ByteArray,
        val envelopeHash: String,
        val journalHash: String,
        val replay: Boolean,
    )

    data class Operation(
        val idempotencyKey: String,
        val ppbSequence: Long,
        val requestHash: String,
        val canonicalEnvelope: ByteArray?,
        val printStatus: String,
        val syncStatus: String,
        val deadlineAt: Long,
        val replay: Boolean,
    )

    class IdempotencyMismatch : IllegalStateException("Idempotency key was already used for a different fiscal envelope")

    /**
     * Persists the canonical request and allocates the legal sequence in one
     * transaction, before any private-key operation is attempted.
     */
    fun reserveOperation(idempotencyKey: String, canonicalRequest: ByteArray, nowMillis: Long): Operation {
        require(idempotencyKey.length in 16..200)
        val requestHash = sha256(canonicalRequest)
        val db = helper.writableDatabase
        db.beginTransaction()
        try {
            db.rawQuery(
                "SELECT ppb_sequence,request_hash,envelope,print_status,sync_status,deadline_at FROM fiscal_jobs WHERE idempotency_key=?",
                arrayOf(idempotencyKey)
            ).use { c ->
                if (c.moveToFirst()) {
                    if (c.getString(1) != requestHash) throw IdempotencyMismatch()
                    val envelope = if (c.isNull(2)) null else Crypto.decrypt(c.getBlob(2))
                    db.setTransactionSuccessful()
                    return Operation(idempotencyKey, c.getLong(0), requestHash, envelope,
                        c.getString(3), c.getString(4), c.getLong(5), true)
                }
            }
            val sequence = db.rawQuery("SELECT COALESCE(MAX(ppb_sequence),0)+1 FROM fiscal_jobs", null)
                .use { it.moveToFirst(); it.getLong(0) }
            db.execSQL(
                """INSERT INTO fiscal_jobs
                   (idempotency_key,ppb_sequence,request_hash,request_body,envelope,envelope_hash,
                    previous_hash,journal_hash,issue_status,print_status,sync_status,created_at,deadline_at)
                   VALUES(?,?,?,?,NULL,NULL,'','','RESERVED','PENDING','PENDING',?,?)""",
                arrayOf(idempotencyKey, sequence, requestHash, Crypto.encrypt(canonicalRequest),
                    nowMillis, twoBusinessDayDeadline(nowMillis))
            )
            db.setTransactionSuccessful()
            return Operation(idempotencyKey, sequence, requestHash, null, "PENDING", "PENDING",
                twoBusinessDayDeadline(nowMillis), false)
        } finally {
            db.endTransaction()
        }
    }

    /** Commits the exact sealed bytes and hash-chain before printing. */
    fun sealOperation(idempotencyKey: String, canonicalEnvelope: ByteArray): Reservation {
        val db = helper.writableDatabase
        db.beginTransaction()
        try {
            db.rawQuery("SELECT ppb_sequence,envelope,request_hash FROM fiscal_jobs WHERE idempotency_key=?",
                arrayOf(idempotencyKey)).use { c ->
                require(c.moveToFirst()) { "Unknown fiscal operation" }
                val sequence = c.getLong(0)
                if (!c.isNull(1)) {
                    val old = Crypto.decrypt(c.getBlob(1))
                    if (!MessageDigest.isEqual(old, canonicalEnvelope)) throw IdempotencyMismatch()
                    val hash = sha256(old)
                    val journal = db.rawQuery("SELECT journal_hash FROM fiscal_jobs WHERE idempotency_key=?",
                        arrayOf(idempotencyKey)).use { it.moveToFirst(); it.getString(0) }
                    db.setTransactionSuccessful()
                    return Reservation(idempotencyKey, sequence, old, hash, journal, true)
                }
                val hash = sha256(canonicalEnvelope)
                val previous = db.rawQuery(
                    "SELECT journal_hash FROM fiscal_jobs WHERE ppb_sequence<? AND journal_hash<>'' ORDER BY ppb_sequence DESC LIMIT 1",
                    arrayOf(sequence.toString())
                ).use { if (it.moveToFirst()) it.getString(0) else GENESIS_HASH }
                val journal = sha256((previous + "\n" + sequence + "\n" + idempotencyKey + "\n" + hash)
                    .toByteArray(StandardCharsets.UTF_8))
                db.execSQL("""UPDATE fiscal_jobs SET envelope=?,envelope_hash=?,previous_hash=?,journal_hash=?,
                    issue_status='SEALED' WHERE idempotency_key=?""",
                    arrayOf(Crypto.encrypt(canonicalEnvelope), hash, previous, journal, idempotencyKey))
                db.setTransactionSuccessful()
                return Reservation(idempotencyKey, sequence, canonicalEnvelope.copyOf(), hash, journal, false)
            }
        } finally { db.endTransaction() }
    }

    fun find(idempotencyKey: String): Operation? =
        helper.readableDatabase.rawQuery(
            "SELECT ppb_sequence,request_hash,envelope,print_status,sync_status,deadline_at FROM fiscal_jobs WHERE idempotency_key=?",
            arrayOf(idempotencyKey)
        ).use { c ->
            if (!c.moveToFirst()) null else Operation(idempotencyKey, c.getLong(0), c.getString(1),
                if (c.isNull(2)) null else Crypto.decrypt(c.getBlob(2)), c.getString(3), c.getString(4),
                c.getLong(5), true)
        }

    fun sealedQueue(): List<Operation> {
        val rows = mutableListOf<Operation>()
        helper.readableDatabase.rawQuery(
            "SELECT idempotency_key,ppb_sequence,request_hash,envelope,print_status,sync_status,deadline_at FROM fiscal_jobs WHERE envelope IS NOT NULL ORDER BY ppb_sequence",
            null
        ).use { c -> while (c.moveToNext()) rows += Operation(c.getString(0), c.getLong(1), c.getString(2),
            Crypto.decrypt(c.getBlob(3)), c.getString(4), c.getString(5), c.getLong(6), true) }
        return rows
    }

    fun overdueUnconfirmed(nowMillis: Long = System.currentTimeMillis()): Int =
        helper.readableDatabase.rawQuery(
            "SELECT COUNT(*) FROM fiscal_jobs WHERE envelope IS NOT NULL AND sync_status<>'CONFIRMED' AND deadline_at<=?",
            arrayOf(nowMillis.toString())
        ).use { it.moveToFirst(); it.getInt(0) }

    fun reserve(idempotencyKey: String, canonicalEnvelope: ByteArray, nowMillis: Long): Reservation {
        require(idempotencyKey.length in 16..200) { "Invalid idempotency key" }
        require(canonicalEnvelope.isNotEmpty() && canonicalEnvelope.size <= MAX_ENVELOPE_BYTES) {
            "Invalid canonical fiscal envelope size"
        }
        val hash = sha256(canonicalEnvelope)
        val db = helper.writableDatabase
        db.beginTransaction()
        try {
            db.rawQuery(
                "SELECT ppb_sequence,envelope,journal_hash FROM fiscal_jobs WHERE idempotency_key=?",
                arrayOf(idempotencyKey)
            ).use { cursor ->
                if (cursor.moveToFirst()) {
                    val priorEnvelope = Crypto.decrypt(cursor.getBlob(1))
                    if (!MessageDigest.isEqual(sha256(priorEnvelope).toByteArray(StandardCharsets.US_ASCII),
                            hash.toByteArray(StandardCharsets.US_ASCII))) throw IdempotencyMismatch()
                    val result = Reservation(
                        idempotencyKey, cursor.getLong(0), priorEnvelope, hash, cursor.getString(2), true
                    )
                    db.setTransactionSuccessful()
                    return result
                }
            }

            val sequence = db.rawQuery("SELECT COALESCE(MAX(ppb_sequence),0)+1 FROM fiscal_jobs", null)
                .use { it.moveToFirst(); it.getLong(0) }
            val previous = db.rawQuery(
                "SELECT journal_hash FROM fiscal_jobs ORDER BY ppb_sequence DESC LIMIT 1", null
            ).use { if (it.moveToFirst()) it.getString(0) else GENESIS_HASH }
            val journalHash = sha256(
                (previous + "\n" + sequence + "\n" + idempotencyKey + "\n" + hash)
                    .toByteArray(StandardCharsets.UTF_8)
            )
            db.execSQL(
                """INSERT INTO fiscal_jobs
                   (idempotency_key,ppb_sequence,request_hash,request_body,envelope,envelope_hash,previous_hash,journal_hash,
                    issue_status,print_status,sync_status,created_at,deadline_at)
                   VALUES(?,?,?,?,?,?,?,?, 'RESERVED','PENDING','PENDING',?,?)""",
                arrayOf(
                    idempotencyKey, sequence, hash, Crypto.encrypt(canonicalEnvelope),
                    Crypto.encrypt(canonicalEnvelope), hash, previous, journalHash,
                    nowMillis, twoBusinessDayDeadline(nowMillis)
                )
            )
            db.setTransactionSuccessful()
            return Reservation(idempotencyKey, sequence, canonicalEnvelope.copyOf(), hash, journalHash, false)
        } finally {
            db.endTransaction()
        }
    }

    /** Print state is intentionally independent from the fiscal issue/sync state. */
    fun markPrint(idempotencyKey: String, printed: Boolean, detail: String? = null) =
        updateStatus("print_status", if (printed) "PRINTED" else "FAILED", idempotencyKey, detail)

    /** UNKNOWN is durable and must never be silently converted to FAILED. */
    fun markSync(idempotencyKey: String, state: SyncState, detail: String? = null) =
        updateStatus("sync_status", state.name, idempotencyKey, detail)

    enum class SyncState { PENDING, RECEIVED, FINALIZING, CONFIRMED, FAILED, UNKNOWN, NEEDS_REVIEW }

    private fun updateStatus(column: String, status: String, key: String, detail: String?) {
        require(column == "print_status" || column == "sync_status")
        helper.writableDatabase.execSQL(
            "UPDATE fiscal_jobs SET $column=?, status_detail=? WHERE idempotency_key=?",
            arrayOf(status, detail, key)
        )
    }

    /** Detects tampering/corruption before an export or sync is attempted. */
    fun verifyJournal(): Boolean {
        data class Link(val sequence: Long, val key: String, val envelopeHash: String, val previous: String, val journal: String)
        val links = mutableListOf<Link>()
        helper.readableDatabase.rawQuery(
            "SELECT ppb_sequence,idempotency_key,envelope_hash,previous_hash,journal_hash FROM fiscal_jobs WHERE envelope IS NOT NULL ORDER BY ppb_sequence", null
        ).use { c ->
            while (c.moveToNext()) {
                links += Link(c.getLong(0), c.getString(1), c.getString(2), c.getString(3), c.getString(4))
            }
        }
        val hashes = links.map { it.journal }.toSet()
        if (hashes.size != links.size) return false
        for (link in links) {
            if (link.previous != GENESIS_HASH && link.previous !in hashes) return false
            val expected = sha256((link.previous + "\n" + link.sequence + "\n" + link.key + "\n" + link.envelopeHash)
                .toByteArray(StandardCharsets.UTF_8))
            if (!MessageDigest.isEqual(expected.toByteArray(StandardCharsets.US_ASCII),
                    link.journal.toByteArray(StandardCharsets.US_ASCII))) return false
        }
        // Every link must terminate at genesis; this also rejects cycles.
        val byHash = links.associateBy { it.journal }
        for (start in links) {
            var cursor = start
            val seen = mutableSetOf<String>()
            while (cursor.previous != GENESIS_HASH) {
                if (!seen.add(cursor.journal)) return false
                cursor = byHash[cursor.previous] ?: return false
            }
        }
        return true
    }

    private class Db(context: Context) : SQLiteOpenHelper(context, "bookie_fiscal.db", null, 2) {
        override fun onCreate(db: SQLiteDatabase) {
            db.execSQL(
                """CREATE TABLE fiscal_jobs (
                    idempotency_key TEXT PRIMARY KEY NOT NULL,
                    ppb_sequence INTEGER NOT NULL UNIQUE,
                    request_hash TEXT NOT NULL, request_body BLOB NOT NULL,
                    envelope BLOB, envelope_hash TEXT,
                    previous_hash TEXT NOT NULL, journal_hash TEXT NOT NULL,
                    issue_status TEXT NOT NULL, print_status TEXT NOT NULL, sync_status TEXT NOT NULL,
                    status_detail TEXT, created_at INTEGER NOT NULL, deadline_at INTEGER NOT NULL
                )"""
            )
            db.execSQL("CREATE INDEX fiscal_jobs_sync_deadline ON fiscal_jobs(sync_status, deadline_at)")
        }
        override fun onUpgrade(db: SQLiteDatabase, oldVersion: Int, newVersion: Int) {
            if (oldVersion < 2) {
                db.execSQL("DROP INDEX IF EXISTS fiscal_jobs_sync_deadline")
                db.execSQL("ALTER TABLE fiscal_jobs RENAME TO fiscal_jobs_v1")
                onCreate(db)
                db.execSQL(
                    """INSERT INTO fiscal_jobs
                       (idempotency_key,ppb_sequence,request_hash,request_body,envelope,envelope_hash,
                        previous_hash,journal_hash,issue_status,print_status,sync_status,status_detail,created_at,deadline_at)
                       SELECT idempotency_key,ppb_sequence,envelope_hash,envelope,envelope,envelope_hash,
                        previous_hash,journal_hash,issue_status,print_status,sync_status,status_detail,created_at,deadline_at
                       FROM fiscal_jobs_v1"""
                )
                db.execSQL("DROP TABLE fiscal_jobs_v1")
            }
        }
    }

    private object Crypto {
        private const val ALIAS = "bookie.fiscal.ledger.v1"

        fun encrypt(plain: ByteArray): ByteArray {
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.ENCRYPT_MODE, key())
            return cipher.iv + cipher.doFinal(plain)
        }

        fun decrypt(cipherText: ByteArray): ByteArray {
            require(cipherText.size > 12) { "Invalid encrypted fiscal envelope" }
            val cipher = Cipher.getInstance("AES/GCM/NoPadding")
            cipher.init(Cipher.DECRYPT_MODE, key(), GCMParameterSpec(128, cipherText.copyOfRange(0, 12)))
            return cipher.doFinal(cipherText, 12, cipherText.size - 12)
        }

        private fun key(): SecretKey {
            val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
            (store.getKey(ALIAS, null) as? SecretKey)?.let { return it }
            val generator = KeyGenerator.getInstance(KeyProperties.KEY_ALGORITHM_AES, "AndroidKeyStore")
            generator.init(
                KeyGenParameterSpec.Builder(ALIAS, KeyProperties.PURPOSE_ENCRYPT or KeyProperties.PURPOSE_DECRYPT)
                    .setBlockModes(KeyProperties.BLOCK_MODE_GCM)
                    .setEncryptionPaddings(KeyProperties.ENCRYPTION_PADDING_NONE)
                    .setRandomizedEncryptionRequired(true)
                    .build()
            )
            return generator.generateKey()
        }
    }

    companion object {
        const val MAX_ENVELOPE_BYTES = 256 * 1024
        private const val GENESIS_HASH = "BOOKIE-FISCAL-GENESIS-V1"
        /**
         * Weekends are excluded at the durable reservation boundary.  Slovenian
         * public-holiday calendars are deliberately not guessed on-device: the
         * synchroniser must flag those dates for server policy resolution rather
         * than silently extending a statutory deadline.
         */
        fun twoBusinessDayDeadline(
            nowMillis: Long,
            zone: ZoneId = ZoneId.of("Europe/Ljubljana"),
            holidays: Set<String> = emptySet(),
        ): Long {
            var date = Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalDate()
            var remaining = 2
            while (remaining > 0) {
                date = date.plusDays(1)
                if (date.dayOfWeek != DayOfWeek.SATURDAY &&
                    date.dayOfWeek != DayOfWeek.SUNDAY &&
                    date.toString() !in holidays) remaining--
            }
            return date.atTime(Instant.ofEpochMilli(nowMillis).atZone(zone).toLocalTime()).atZone(zone)
                .toInstant().toEpochMilli()
        }
        fun sha256(value: ByteArray): String =
            MessageDigest.getInstance("SHA-256").digest(value).joinToString("") { "%02x".format(it) }
    }
}