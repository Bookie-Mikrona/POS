/**
 * Adaptive BLE chunk writer for ESC/POS thermal printers.
 *
 * ## Write mode selection (resolveWriteMode)
 *
 *   ALWAYS check characteristic.properties BEFORE calling any write method:
 *   - properties.write=true  → "WR"  (writeValue; with-response/ACK)
 *   - properties.writeWithoutResponse=true → "WNR" (writeValueWithoutResponse)
 *   - neither → null (cannot write; return error to caller)
 *
 *   Calling writeValue on a WNR-only characteristic throws a GATT error
 *   mid-stream. For bitmap this is fatal: the printer received partial raster
 *   data and interprets everything that follows (including a retry's ESC @)
 *   as continuation bytes → guaranteed scrambled/hung output.
 *
 * ## Bitmap path (btSendBitmap)
 *
 *   - Resolves write mode from properties FIRST.
 *   - WR:  ACK provides natural backpressure → delay = 0.
 *   - WNR: explicit pacing (BT_BITMAP_WNR_DELAY_MS) between chunks.
 *   - SINGLE attempt — NO automatic retry on error.
 *     Rationale: printer is mid-GS v 0 block; retrying injects ESC @ into
 *     an open raster context → desync. User must power-cycle, then click again
 *     (fresh print starts with ESC @ → clean printer reset).
 *   - Detailed console logging for field diagnostics.
 *
 * ## Text path (btSendAll)
 *
 *   - Prefers WNR for speed; falls back to writeValue for WR-only chars.
 *   - On GATT error: shrink chunk, retry from byte 0 (safe — ESC @ resets).
 */

/** Ordered fastest → safest. Used by both bitmap and text paths. */
export const BT_CHUNK_LADDER = [180, 100, 64, 20] as const;
export type BtChunkSize = typeof BT_CHUNK_LADDER[number];

/** Inter-chunk delay (ms) for WNR text sends. Steps up alongside chunk downgrade. */
export const BT_DELAY_LADDER = [10, 30, 50] as const;
export type BtDelayMs = typeof BT_DELAY_LADDER[number];

/**
 * Fixed pacing (ms) between WNR chunks in BITMAP mode.
 * Prevents peripheral buffer overflow without full ACK round-trip.
 * 0 for WR mode (ACK is the backpressure).
 */
export const BT_BITMAP_WNR_DELAY_MS = 15;

export interface BtSendParams {
  chunkSize: BtChunkSize;
  delayMs: BtDelayMs;
}

export const BT_DEFAULT_PARAMS: BtSendParams = {
  chunkSize: BT_CHUNK_LADDER[0],
  delayMs: BT_DELAY_LADDER[0],
};

/**
 * Minimal GATT characteristic interface (subset of Web Bluetooth API).
 *
 * IMPORTANT: check properties.write / properties.writeWithoutResponse before
 * calling writeValue / writeValueWithoutResponse respectively. Calling a method
 * that the characteristic's properties do not advertise throws a GATT error.
 */
export interface BtWriteCharacteristic {
  writeValueWithoutResponse?(data: BufferSource): Promise<void>;
  writeValue(data: BufferSource): Promise<void>;
  properties: {
    /** GATT "Write" — with response/ACK; reliable delivery. */
    write: boolean;
    /** GATT "Write Without Response" — no ACK; fast but needs pacing. */
    writeWithoutResponse: boolean;
  };
}

export interface BtSendResult {
  ok: boolean;
  /** User-friendly Slovenian error. Only present when ok=false. */
  error?: string;
  /** Effective params used for this send. Present when ok=true. */
  usedParams?: BtSendParams;
  /** Total send attempts (bitmap always 1; text path may retry). */
  attempts: number;
  /** Elapsed milliseconds. */
  ms: number;
  /** Resolved write mode used ("WR" or "WNR"). Present when ok=true. */
  writeMode?: BtWriteMode;
}

// ── Write mode resolution ──────────────────────────────────────────────────

/** Transport used for a BLE write. */
export type BtWriteMode = "WR" | "WNR";

/**
 * Determine which write method to use based on advertised properties.
 *
 * - Returns "WR"  when properties.write is true (writeValue supported).
 * - Returns "WNR" when properties.writeWithoutResponse is true and the
 *   writeValueWithoutResponse method is present.
 * - Returns null  when neither is available (cannot write at all).
 *
 * WR is preferred over WNR: ACK provides backpressure without explicit delays.
 * WNR is acceptable with proper pacing (BT_BITMAP_WNR_DELAY_MS for bitmap).
 */
export function resolveWriteMode(char: BtWriteCharacteristic): BtWriteMode | null {
  if (char.properties.write) return "WR";
  if (char.properties.writeWithoutResponse && char.writeValueWithoutResponse) return "WNR";
  return null;
}

// ── localStorage helpers ───────────────────────────────────────────────────

const BT_PARAMS_KEY_PREFIX = "bt_params_v1_";

/** localStorage key for a given device (by name). */
export function btParamsKey(deviceName: string | undefined): string {
  const name = (deviceName ?? "unknown")
    .replace(/[^a-zA-Z0-9_-]/g, "_")
    .slice(0, 40);
  return `${BT_PARAMS_KEY_PREFIX}${name}`;
}

/** Load saved BtSendParams for a device, or return defaults. */
export function loadBtParams(deviceName: string | undefined): BtSendParams {
  try {
    const raw = localStorage.getItem(btParamsKey(deviceName));
    if (raw) {
      const p = JSON.parse(raw) as Partial<BtSendParams>;
      const chunk = p.chunkSize;
      const del = p.delayMs;
      if (
        typeof chunk === "number" &&
        typeof del === "number" &&
        (BT_CHUNK_LADDER as readonly number[]).includes(chunk) &&
        (BT_DELAY_LADDER as readonly number[]).includes(del)
      ) {
        return { chunkSize: chunk as BtChunkSize, delayMs: del as BtDelayMs };
      }
    }
  } catch { /* ignore – storage not available */ }
  return { ...BT_DEFAULT_PARAMS };
}

/** Persist working BtSendParams for a device. */
export function saveBtParams(
  deviceName: string | undefined,
  params: BtSendParams,
): void {
  try {
    localStorage.setItem(btParamsKey(deviceName), JSON.stringify(params));
  } catch { /* ignore */ }
}

// ── Ladder logic ────────────────────────────────────────────────────────────

/**
 * Return the next (slower, safer) params step on the ladder.
 * Returns null when the ladder is exhausted.
 */
export function nextBtParams(current: BtSendParams): BtSendParams | null {
  const chunkIdx = (BT_CHUNK_LADDER as readonly number[]).indexOf(current.chunkSize);
  const nextChunkIdx = chunkIdx < 0 ? 1 : chunkIdx + 1;
  if (nextChunkIdx >= BT_CHUNK_LADDER.length) return null;

  const delayIdx = (BT_DELAY_LADDER as readonly number[]).indexOf(current.delayMs);
  const nextDelayIdx = Math.min(
    delayIdx < 0 ? 1 : delayIdx + 1,
    BT_DELAY_LADDER.length - 1,
  );

  return {
    chunkSize: BT_CHUNK_LADDER[nextChunkIdx],
    delayMs: BT_DELAY_LADDER[nextDelayIdx],
  };
}

// ── Core send primitives ────────────────────────────────────────────────────

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Low-level: send `data` in fixed-size chunks using a pre-resolved write mode.
 * Throws on the first GATT error (no retry — caller decides).
 * Logs each failed chunk with byte range and error message.
 *
 * @param char     GATT write characteristic
 * @param data     Bytes to send
 * @param chunkSize Bytes per BLE packet
 * @param mode     "WR" = writeValue; "WNR" = writeValueWithoutResponse
 * @param delayMs  Inter-chunk pacing (0 for WR; BT_BITMAP_WNR_DELAY_MS for WNR bitmap)
 * @param label    Log prefix for console messages (e.g. "bitmap", "text")
 */
export async function btSendStream(
  char: BtWriteCharacteristic,
  data: Uint8Array,
  chunkSize: number,
  mode: BtWriteMode,
  delayMs: number,
  label: string,
): Promise<void> {
  let chunksSent = 0;
  const totalChunks = Math.ceil(data.length / chunkSize);
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, Math.min(i + chunkSize, data.length));
    const chunkNum = chunksSent + 1;
    try {
      if (mode === "WNR" && char.writeValueWithoutResponse) {
        await char.writeValueWithoutResponse(chunk);
        if (delayMs > 0) await sleep(delayMs);
      } else {
        await char.writeValue(chunk);
      }
      chunksSent++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const byteEnd = Math.min(i + chunkSize, data.length) - 1;
      console.error(
        `[BT ${label}] ✗ Kos ${chunkNum}/${totalChunks}` +
        ` (bajti ${i}–${byteEnd} / ${data.length})` +
        ` [${mode}, ${chunkSize}B/kos]` +
        ` — NAPAKA: ${msg}`,
      );
      throw err;
    }
  }
  console.debug(
    `[BT ${label}] ✓ ${chunksSent}/${totalChunks} kosov` +
    ` (${data.length} B) [${mode}, ${chunkSize}B/kos, pacing=${delayMs}ms]`,
  );
}

/**
 * Send all bytes in fixed-size chunks. Throws on any GATT error.
 * Exported for unit testing; use btSendAll() in production for text.
 *
 * @param useWNR - if true, use writeValueWithoutResponse + inter-chunk delay;
 *                 if false, use writeValue (ACK provides natural flow control).
 */
export async function btSendAttempt(
  char: BtWriteCharacteristic,
  data: Uint8Array,
  params: BtSendParams,
  useWNR: boolean,
): Promise<void> {
  const { chunkSize, delayMs } = params;
  for (let i = 0; i < data.length; i += chunkSize) {
    const chunk = data.slice(i, i + chunkSize);
    if (useWNR && char.writeValueWithoutResponse) {
      await char.writeValueWithoutResponse(chunk);
      if (delayMs > 0) await sleep(delayMs);
    } else {
      await char.writeValue(chunk);
    }
  }
}

/**
 * Send bytes using the best available write mode (WR preferred; WNR fallback).
 * Checks properties before calling any write method.
 * Exported for unit testing; use btSendBitmap() in production for raster data.
 */
export async function btSendAttemptWithResponse(
  char: BtWriteCharacteristic,
  data: Uint8Array,
  params: BtSendParams,
): Promise<void> {
  const mode = resolveWriteMode(char);
  if (!mode) {
    throw new Error("Karakteristika ne podpira niti WR niti WNR pisanja.");
  }
  // Use btSendStream for consistent logging; delay=0 for both modes here
  // (btSendStream is the primitive; callers that need pacing pass it explicitly).
  return btSendStream(char, data, params.chunkSize, mode, 0, "attempt");
}

export const BT_TIMEOUT_MS = 30_000;
const BT_TIMEOUT_SENTINEL = "BT_TIMEOUT";

// ── Bitmap path ────────────────────────────────────────────────────────────

/**
 * Reliable BLE send for RASTER / BITMAP ESC/POS streams.
 *
 * ## Write mode
 *   Resolved from characteristic.properties BEFORE any write:
 *   - WR  → writeValue (ACK = natural backpressure, delay = 0).
 *   - WNR → writeValueWithoutResponse + BT_BITMAP_WNR_DELAY_MS pacing.
 *   - null → immediate error (no write method available).
 *
 * ## Error handling — SINGLE ATTEMPT, NO RETRY
 *   Any GATT error aborts the send immediately and returns ok=false.
 *   The caller should show the user an error and let THEM click retry.
 *
 *   WHY no auto-retry: the printer has received partial raster data and is
 *   waiting for more bytes inside a GS v 0 block. Sending anything more —
 *   including a fresh ESC @ reset — is interpreted as raster continuation
 *   bytes → guaranteed scrambled / hung output. A clean retry is only possible
 *   after the printer is power-cycled (or times out internally).
 *
 * ## Logging
 *   Console logs: mode selected, chunk size, per-chunk progress (on error),
 *   total KB/s on success. Use browser DevTools to capture for diagnostics.
 */
export async function btSendBitmap(
  char: BtWriteCharacteristic,
  data: Uint8Array,
  deviceName: string | undefined,
): Promise<BtSendResult> {
  const mode = resolveWriteMode(char);
  if (!mode) {
    console.error(
      "[BT bitmap] ✗ Karakteristika ne podpira pisanja" +
      " (properties.write=false, properties.writeWithoutResponse=false).",
    );
    return {
      ok: false,
      error:
        "BT tiskalnik ne podpira nobenega načina pisanja. " +
        "Preverite BLE profil tiskalnika.",
      attempts: 1,
      ms: 0,
    };
  }

  const params = loadBtParams(deviceName);
  const delayMs = mode === "WNR" ? BT_BITMAP_WNR_DELAY_MS : 0;
  const kb = (data.length / 1024).toFixed(1);

  console.info(
    `[BT bitmap] Začetek: ${kb} KB, ${params.chunkSize} B/kos,` +
    ` način=${mode} (${mode === "WR" ? "with-response/ACK" : `without-response + ${delayMs}ms pacing`})`,
  );

  const t0 = Date.now();

  try {
    await Promise.race([
      btSendStream(char, data, params.chunkSize, mode, delayMs, "bitmap"),
      new Promise<never>((_, reject) =>
        setTimeout(
          () => reject(new Error(BT_TIMEOUT_SENTINEL)),
          BT_TIMEOUT_MS,
        ),
      ),
    ]);

    // ── Success ──
    saveBtParams(deviceName, params);
    const ms = Date.now() - t0;
    const kbps = ms > 0 ? ((data.length / 1024) / (ms / 1000)).toFixed(1) : "–";
    console.info(
      `[BT bitmap] ✓ ${kb} KB → ${ms} ms (~${kbps} KB/s)` +
      ` [${mode}, ${params.chunkSize}B/kos, pacing=${delayMs}ms]`,
    );
    return {
      ok: true,
      usedParams: { chunkSize: params.chunkSize, delayMs: delayMs as BtDelayMs },
      attempts: 1,
      ms,
      writeMode: mode,
    };

  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    const ms = Date.now() - t0;

    if (msg === BT_TIMEOUT_SENTINEL) {
      return {
        ok: false,
        error:
          "Tiskanje je prekoračilo časovni limit (30 s). " +
          "Preverite, ali je tiskalnik vklopljen in v dosegu.",
        attempts: 1,
        ms,
      };
    }

    // ANY other error: abort immediately — NO automatic retry.
    // Printer is mid-GS v 0 block; injecting anything more (incl. ESC @)
    // = desync → scramble/hang. Power-cycle required before next print.
    console.error(
      `[BT bitmap] ✗ PREKINITEV brez ponovnega poskusa` +
      ` (tiskalnik v nedefiniranem stanju po delnem prenosu): ${msg}`,
    );
    return {
      ok: false,
      error:
        "Izpis ni uspel med prenosom. " +
        "Izklopite in vklopite tiskalnik, nato poskusite znova.",
      attempts: 1,
      ms,
    };
  }
}

// ── Text path ──────────────────────────────────────────────────────────────

/**
 * Adaptive BLE send for TEXT / COMMAND ESC/POS streams (~2 KB).
 *
 * - Prefers WNR for speed when available; falls back to writeValue.
 * - On GATT error: reduces chunk size + increases delay, retries from byte 0.
 *   (Safe for text: ESC @ at stream start resets printer state cleanly.)
 * - On success: persists working params to localStorage for this device.
 * - Timeout: 30 s.
 */
export async function btSendAll(
  char: BtWriteCharacteristic,
  data: Uint8Array,
  deviceName: string | undefined,
): Promise<BtSendResult> {
  const useWNR = !!(
    char.properties.writeWithoutResponse && char.writeValueWithoutResponse
  );
  let params = loadBtParams(deviceName);
  let attempts = 0;
  const t0 = Date.now();

  // eslint-disable-next-line no-constant-condition
  while (true) {
    attempts++;
    try {
      await Promise.race([
        btSendAttempt(char, data, params, useWNR),
        new Promise<never>((_, reject) =>
          setTimeout(
            () => reject(new Error(BT_TIMEOUT_SENTINEL)),
            BT_TIMEOUT_MS,
          ),
        ),
      ]);

      // ── Success ──
      saveBtParams(deviceName, params);
      const ms = Date.now() - t0;
      const kb = (data.length / 1024).toFixed(1);
      console.debug(
        `[BT] ${kb} KB → ${ms} ms ` +
        `(${params.chunkSize} B/chunk, delay=${params.delayMs} ms, ` +
        `WNR=${useWNR}, poskus=${attempts})`,
      );
      return { ok: true, usedParams: params, attempts, ms };

    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);

      // ── Timeout ──
      if (msg === BT_TIMEOUT_SENTINEL) {
        return {
          ok: false,
          error:
            "Tiskanje je prekoračilo časovni limit (30 s). " +
            "Preverite, ali je tiskalnik vklopljen in v dosegu.",
          attempts,
          ms: Date.now() - t0,
        };
      }

      // ── GATT error → try next ladder step ──
      console.warn(
        `[BT] GATT napaka (poskus ${attempts}, ` +
        `${params.chunkSize} B/chunk, delay=${params.delayMs} ms): ${msg}`,
      );

      const next = nextBtParams(params);
      if (!next) {
        return {
          ok: false,
          error:
            "Tiskanje ni uspelo — tiskalnik ne sprejema podatkov (GATT napaka). " +
            "Izklopite in vklopite tiskalnik ter poskusite znova.",
          attempts,
          ms: Date.now() - t0,
        };
      }

      console.info(
        `[BT] Umik: ${params.chunkSize} B → ${next.chunkSize} B, ` +
        `delay ${params.delayMs} ms → ${next.delayMs} ms. Ponavljam od začetka.`,
      );
      params = next;
    }
  }
}
