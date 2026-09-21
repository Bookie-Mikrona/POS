/**
 * GET /downloads/:filename
 *
 * Servira datoteke za prenos (ScannerBridge.exe ipd.).
 * Datoteke so shranjene v dist/assets/downloads/ (med buildom se skopirajo
 * iz src/assets/downloads/).
 *
 * Ni zahtevana avtentikacija — brskalnik jih prenese po kliku.
 */

import { Router } from "express";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const router = Router();

// V produkciji je __dirname dist/, v razvoju pa src/
// dist/assets/downloads je vedno relativno na dist/index.mjs
const _dirname =
  typeof __dirname !== "undefined"
    ? __dirname
    : path.dirname(fileURLToPath(import.meta.url));

// V razvoju je _dirname = src/routes/, v produkciji dist/routes/ ali dist/
// → gremo en nivo gor do src/ oz. dist/, nato v assets/downloads/
const DOWNLOADS_DIR = _dirname.endsWith("routes")
  ? path.resolve(_dirname, "..", "assets", "downloads")
  : path.resolve(_dirname, "assets", "downloads");

// Dovoljena imena (whitelist — brez path traversal tveganja)
const ALLOWED_FILES: Record<string, { mime: string; disposition: string }> = {
  "scannerbridge.exe": {
    mime: "application/octet-stream",
    disposition: 'attachment; filename="ScannerBridge.exe"',
  },
  "zcsprinterbridge.apk": {
    mime: "application/vnd.android.package-archive",
    disposition: 'attachment; filename="ZcsPrinterBridge.apk"',
  },
  "noryoxnb80bridge.apk": {
    mime: "application/vnd.android.package-archive",
    disposition: 'attachment; filename="NoryoxNB80Bridge.apk"',
  },
  "bttiskalnimost.apk": {
    mime: "application/vnd.android.package-archive",
    disposition: 'attachment; filename="BtTiskalniMost.apk"',
  },
  "bookievivabridge-armeabi-v7a.apk": {
    mime: "application/vnd.android.package-archive",
    disposition: 'attachment; filename="BookieVivaBridge-armeabi-v7a.apk"',
  },
  "bookievivabridge-arm64.apk": {
    mime: "application/vnd.android.package-archive",
    disposition: 'attachment; filename="BookieVivaBridge-arm64.apk"',
  },
  "bookievivabridge.apk": {
    mime: "application/vnd.android.package-archive",
    disposition: 'attachment; filename="BookieVivaBridge.apk"',
  },
};

router.get("/downloads/:filename", (req, res) => {
  const { filename } = req.params;

  const allowed = ALLOWED_FILES[filename.toLowerCase()];
  if (!allowed) {
    res.status(404).json({ error: "Datoteka ni na voljo." });
    return;
  }

  const filePath = path.join(DOWNLOADS_DIR, filename);

  if (!fs.existsSync(filePath)) {
    res.status(503).json({
      error: "Datoteka še ni naložena na strežnik.",
      hint: `Zgradite ScannerBridge.exe (scanner-bridge/build.bat) in jo naložite v assets/downloads/.`,
    });
    return;
  }

  res.setHeader("Content-Type", allowed.mime);
  res.setHeader("Content-Disposition", allowed.disposition);
  res.setHeader("Cache-Control", "no-store");
  res.sendFile(filePath);
});

export default router;
