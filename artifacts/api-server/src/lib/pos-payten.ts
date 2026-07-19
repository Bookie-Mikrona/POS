import net from "net";
import { logger } from "./logger";

/**
 * Payten POS Terminal — ECR (Electronic Cash Register) interface v2.62
 *
 * Protocol framing (ECR→Terminal):  STX STX <msgData> ETX LRC
 * Protocol framing (Terminal→ECR):  STX <msgData> ETX LRC
 *
 * LRC = XOR of all bytes from (and including) the first msgData byte through ETX.
 * ACK (0x06) must be sent by the receiver after every complete message.
 * During card processing the terminal sends HOLD messages (type 20 or 25).
 * The ECR must ACK each HOLD and keep waiting for the final response (type 10).
 *
 * Reference: Payten ECR Specification v2.62
 */

// ─── Protocol constants ────────────────────────────────────────────────────────

const STX = 0x02;
const ETX = 0x03;
const ACK_BYTE = 0x06;
const FS  = 0x1c; // Field Separator (chr 28)
const FS_CH = String.fromCharCode(FS);

// ─── Sequential counter (per-process, wraps 0000–9999) ────────────────────────

let seqCounter = 0;
function nextSeqNum(): string {
  const n = seqCounter;
  seqCounter = (seqCounter + 1) % 10000;
  return n.toString().padStart(4, "0");
}

// ─── Public types ─────────────────────────────────────────────────────────────

export type PlacilniNacin = "gotovina" | "kartica" | "bon";

export interface PaytenConfig {
  ip: string;
  port: number;
  timeoutMs: number;
}

export interface PaytenZahteva {
  znesek: number;        // in cents (e.g. 12.50 EUR → 1250)
  valuta?: string;       // ISO 4217 numeric, default "978" (EUR)
  referencnaStev?: string;
}

export type TerminalStatus = "odobren" | "zavrnjen" | "napaka" | "preklic";

export interface PaytenOdgovor {
  status: TerminalStatus;
  avtorizacijskaKoda?: string;
  referenca?: string;
  kartica?: string;     // card brand e.g. "VISA"
  maskiranPan?: string; // e.g. "**** **** **** 1234"
  znesek?: number;
  surovOdgovor: string;
  napaka?: string;
}

// ─── LRC & framing ────────────────────────────────────────────────────────────

/**
 * Compute LRC: XOR of every byte from msgData[0] through ETX (inclusive).
 * ETX must be the last byte of the provided buffer.
 */
function computeLrc(msgDataWithEtx: Buffer): number {
  let lrc = 0;
  for (const b of msgDataWithEtx) lrc ^= b;
  return lrc;
}

/**
 * Wrap message data in an ECR→Terminal frame:
 *   STX STX <msgData> ETX LRC
 */
function buildEcrFrame(msgData: Buffer): Buffer {
  const etx = Buffer.from([ETX]);
  const payload = Buffer.concat([msgData, etx]);
  const lrc = computeLrc(payload);
  return Buffer.concat([Buffer.from([STX, STX]), payload, Buffer.from([lrc])]);
}

/**
 * Try to extract one complete Terminal→ECR frame from the accumulation buffer.
 * Returns { data, remaining } on success, or null if the frame is incomplete.
 *
 * Terminal frame format: STX <msgData> ETX LRC
 * (single STX, unlike the two-STX ECR→Terminal frame)
 */
function extractTerminalFrame(
  buf: Buffer,
): { data: Buffer; remaining: Buffer } | null {
  const stxIdx = buf.indexOf(STX);
  if (stxIdx < 0) return null;

  const etxIdx = buf.indexOf(ETX, stxIdx + 1);
  if (etxIdx < 0) return null;

  // Need one more byte after ETX for LRC
  if (buf.length <= etxIdx + 1) return null;

  const data = buf.slice(stxIdx + 1, etxIdx); // message data without STX/ETX
  const remaining = buf.slice(etxIdx + 2);    // skip ETX + LRC byte
  return { data, remaining };
}

// ─── Message 00: Sale request ──────────────────────────────────────────────────

/**
 * Build ECR Message 00 (transaction request) for a Sale.
 *
 * Fixed header (no FS between these 8 fields):
 *   Identifier(2) TerminalID(2) SourceID(2) SeqNum(4) TxType(2)
 *   PrinterFlag(1) CashierID(2) TxNum(0 or 6)
 *
 * Then FS-separated fields 9–61 (empty optionals are represented as empty
 * strings between the mandatory FS separators):
 *   FS Amount FS FS Exponent FS Currency FS [optional fields…] FS
 */
function buildMessage00(zahteva: PaytenZahteva): Buffer {
  const seq = nextSeqNum();

  // Fixed header (fields 1–8, concatenated without separators)
  const header = [
    "00",  // Identifier: always "00" for transaction request
    "01",  // Terminal ID: station 01 (ECR side)
    "00",  // Source ID: always "00"
    seq,   // Sequential number (4 digits, 0000–9999)
    "01",  // Transaction type: Sale
    "1",   // Printer flag: "1" = terminal prints the slip
    "01",  // Cashier ID
    "",    // Transaction number: empty = new transaction
  ].join("");

  // Amount in minor currency units (cents), no decimal point.
  const amount   = zahteva.znesek.toString();
  // Amount exponent "+0": amount is already in minor currency units
  // (the terminal knows EUR = 2 decimal places from the currency code).
  const exponent = "+0";
  const currency = zahteva.valuta ?? "978"; // EUR

  // Tail fields (spec fields 9–61).
  //
  // The spec has a mandatory double FS after Amount (fields 11+12), which we
  // represent as an empty string between two join separators.
  //
  // Fields are listed as values only; the join() inserts the mandatory FS
  // between each entry (including one at the start and one at the end via
  // the FS_CH prefix/suffix).
  //
  // Field mapping:
  //  [0]  field 10 – Amount
  //  [1]  ""       – empty (between mandatory FS 11 and FS 12 = double FS)
  //  [2]  field 13 – Amount exponent
  //  [3]  field 15 – Currency
  //  [4]  field 17 – Authorization code (empty)
  //  [5]  field 19 – TID (empty, terminal provides its own)
  //  [6]  field 21 – MID (empty)
  //  [7]  field 23 – Display message request (empty)
  //  [8]  field 25 – Input min length (empty)
  //  [9]  field 27 – Input max length (empty)
  //  [10] field 29 – Transaction amount 2 / Tip (empty)
  //  [11] field 31 – Input data (empty)
  //  [12] field 32 – Mask input data (empty)
  //  [13] field 34 – Language ID (empty = default terminal language)
  //  [14] field 36 – Print data (empty)
  //  [15] field 38 – Cashier ID 2 (empty)
  //  [16] field 40 – Transaction amount 2 (empty)
  //  [17] field 42 – Payservices data (empty)
  //  [18] field 44 – Transaction Activation Code (empty)
  //  [19] field 46 – Instant Payment Reference (empty)
  //  [20] field 48 – QR code data (empty)
  //  [21] field 50 – Specific processing flag (empty)
  //  [22] field 52 – Radcom data (empty)
  //  [23] field 54 – Transaction ID (empty)
  //  [24] field 56 – RRN (empty)
  //  [25] field 58 – Credit type (empty)
  //  [26] field 60 – Installments Delay (empty)
  const tailValues: string[] = [
    amount, "", exponent, currency,
    "", "", "", "", "", "", "", "", "", "", "", "", "",
    "", "", "", "", "", "", "", "", "", "",
  ];

  // Prefix FS (field 9) + join with FS + suffix FS (field 61)
  const tail = FS_CH + tailValues.join(FS_CH) + FS_CH;

  return Buffer.from(header + tail, "ascii");
}

// ─── Response parsing (Message 10) ────────────────────────────────────────────

/**
 * Parse a terminal→ECR message from raw bytes.
 *
 * Message 10 (Answer to a transaction request) layout:
 *   Fixed header (36 bytes total):
 *     msgId(2) termId(2) srcId(2) seqNum(4) txType(2)
 *     txFlag(2) txNum(6) batchNum(4) txDate(6) txTime(6)
 *   Tail: FS-separated fields 11–127
 *
 * txFlag values:
 *   00 = error in request format
 *   01 = approved without authorization code
 *   02 = approved with authorization code
 *   04 = refused
 *   05 = terminal ID error
 *   06 = communication error
 *   07 = sleep mode
 */
interface ParsedMessage {
  msgId: string;
  txFlag?: string;
  txNum?: string;
  tailFields: string[];
  raw: string;
}

function parseTerminalMessage(data: Buffer): ParsedMessage {
  const raw = data.toString("ascii");
  const msgId = raw.slice(0, 2);

  if (msgId === "10") {
    // Fixed header is 36 chars:
    // 2+2+2+4+2+2+6+4+6+6 = 36
    const txFlag  = raw.slice(12, 14);
    const txNum   = raw.slice(14, 20);
    const tailRaw = raw.slice(36);
    const tailFields = tailRaw.split(FS_CH);
    return { msgId, txFlag, txNum, tailFields, raw };
  }

  // HOLD (20/25), Error (22/26), Cancel response (24), etc. —
  // header is 8 chars (msgId(2)+00(2)+00(2)+00(2)), then FS-separated tail.
  const tailFields = raw.slice(8).split(FS_CH);
  return { msgId, tailFields, raw };
}

/**
 * Convert a parsed Message 10 into a PaytenOdgovor.
 *
 * Tail field indices (after 36-char fixed header, split by FS):
 *   [0]  Amount (field 12)
 *   [1]  "" (double FS 13+14)
 *   [2]  Exponent (field 15)
 *   [3]  Currency (field 17)
 *   [4]  Card data source (field 19)
 *   [5]  Card number masked (field 21)
 *   [6]  Expiry date (field 23)
 *   [7]  "" (triple FS 24+25+26 → 2 empties)
 *   [8]  ""
 *   [9]  Authorization code (field 27)
 *   [10] TID (field 29)
 *   [11] MID (field 31)
 *   [12] Card brand / company name (field 33)
 */
function interpretResponse(parsed: ParsedMessage): PaytenOdgovor {
  const { msgId, txFlag, txNum, tailFields, raw } = parsed;

  if (msgId === "22" || msgId === "26") {
    const displayMsg = tailFields[0] ?? "";
    return {
      status: "napaka",
      surovOdgovor: raw,
      napaka: displayMsg || "Terminal napaka",
    };
  }

  if (msgId !== "10") {
    return {
      status: "napaka",
      surovOdgovor: raw,
      napaka: `Nepričakovan tip sporočila od terminala: ${msgId}`,
    };
  }

  let status: TerminalStatus;
  if (txFlag === "01" || txFlag === "02") {
    status = "odobren";
  } else if (txFlag === "04") {
    status = "zavrnjen";
  } else if (txFlag === "09") {
    status = "preklic";
  } else {
    status = "napaka";
  }

  const amount    = tailFields[0];
  const authCode  = tailFields[9];
  const cardNum   = tailFields[5];
  const cardBrand = tailFields[12];

  return {
    status,
    avtorizacijskaKoda: authCode   || undefined,
    referenca:          txNum      || undefined,
    kartica:            cardBrand  || undefined,
    maskiranPan:        cardNum    || undefined,
    znesek:             amount ? Number(amount) : undefined,
    surovOdgovor:       raw,
    napaka:
      status === "napaka"    ? `Napaka terminala (flag: ${txFlag})` :
      status === "zavrnjen"  ? `Transakcija zavrnjena (flag: ${txFlag})` :
      status === "preklic"   ? "Transakcija preklicana" :
      undefined,
  };
}

// ─── Main TCP communication ───────────────────────────────────────────────────

/**
 * Send a Sale payment request to a Payten POS terminal via ECR v2.62 protocol.
 *
 * Flow:
 *   1. Connect via TCP
 *   2. Send framed Message 00 (STX STX <data> ETX LRC)
 *   3. Receive and ACK any HOLD messages (20/25) from terminal
 *   4. Receive final response (Message 10) or error (22/26)
 *   5. Send ACK and return parsed result
 */
export async function posljiNaTerminal(
  config: PaytenConfig,
  zahteva: PaytenZahteva,
): Promise<PaytenOdgovor> {
  const msgData = buildMessage00(zahteva);
  const frame   = buildEcrFrame(msgData);

  logger.info(
    { ip: config.ip, port: config.port, znesek: zahteva.znesek },
    "Pošiljam zahtevo na Payten terminal (ECR v2.62)",
  );

  return new Promise((resolve) => {
    const socket = new net.Socket();
    let buf: Buffer = Buffer.alloc(0);
    let settled = false;

    function settle(result: PaytenOdgovor) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve(result);
    }

    function sendAck() {
      try { socket.write(Buffer.from([ACK_BYTE])); } catch { /* ignore */ }
    }

    const timer = setTimeout(() => {
      logger.warn({ ip: config.ip, port: config.port }, "Payten terminal timeout");
      settle({
        status: "napaka",
        surovOdgovor: "",
        napaka: `Timeout po ${config.timeoutMs} ms — terminal ni odgovoril`,
      });
    }, config.timeoutMs);

    socket.connect(config.port, config.ip, () => {
      logger.info({ ip: config.ip, port: config.port }, "Povezan na Payten terminal");
      socket.write(frame);
    });

    socket.on("data", (chunk: Buffer) => {
      buf = Buffer.concat([buf, chunk]);

      // Process all complete frames in the accumulation buffer
      while (true) {
        // Discard leading ACK/NAK bytes (terminal ACK to our request)
        if (buf.length > 0 && (buf[0] === ACK_BYTE || buf[0] === 0x15)) {
          buf = buf.slice(1);
          continue;
        }

        const extracted = extractTerminalFrame(buf);
        if (!extracted) break; // incomplete frame — wait for more data

        buf = extracted.remaining;
        const parsed = parseTerminalMessage(extracted.data);

        if (parsed.msgId === "20" || parsed.msgId === "25") {
          // HOLD message: terminal is busy (waiting for card, PIN, host…)
          // Must ACK and continue waiting — do NOT resolve yet.
          sendAck();
          logger.info(
            { hold: parsed.msgId, msg: parsed.tailFields[0] ?? "" },
            "Payten HOLD — čakamo na terminal",
          );
          continue;
        }

        // Final response (type 10) or error (22/26)
        sendAck();
        const result = interpretResponse(parsed);
        logger.info(
          { status: result.status, authCode: result.avtorizacijskaKoda },
          "Payten terminal odgovor",
        );
        settle(result);
        break;
      }
    });

    socket.on("close", () => {
      if (settled) return;
      // Try to parse any remaining buffered data before giving up
      const extracted = extractTerminalFrame(buf);
      if (extracted) {
        const result = interpretResponse(parseTerminalMessage(extracted.data));
        settle(result);
      } else {
        settle({
          status: "napaka",
          surovOdgovor: buf.toString("hex"),
          napaka: "Povezava zaprta brez popolnega odgovora",
        });
      }
    });

    socket.on("error", (err: Error) => {
      logger.error(
        { err: err.message, ip: config.ip, port: config.port },
        "Napaka Payten TCP povezave",
      );
      settle({
        status: "napaka",
        surovOdgovor: "",
        napaka: `TCP napaka: ${err.message}`,
      });
    });
  });
}

/**
 * Test TCP connectivity to the terminal (does NOT send any ECR message).
 * Returns uspeh=true if the TCP handshake succeeds within the timeout.
 */
export async function testTerminalPovezave(
  config: PaytenConfig,
): Promise<{ uspeh: boolean; napaka?: string }> {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    let settled = false;

    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resolve({
        uspeh: false,
        napaka: `Timeout po ${Math.min(config.timeoutMs, 5000)} ms`,
      });
    }, Math.min(config.timeoutMs, 5000));

    socket.connect(config.port, config.ip, () => {
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ uspeh: true });
    });

    socket.on("error", (err: Error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      socket.destroy();
      resolve({ uspeh: false, napaka: err.message });
    });
  });
}
