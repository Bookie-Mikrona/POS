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
  "ScannerBridge.exe": {
    mime: "application/octet-stream",
    disposition: 'attachment; filename="ScannerBridge.exe"',
  },
  "ZcsPrinterBridge.apk": {
    mime: "application/vnd.android.package-archive",
    disposition: 'attachment; filename="ZcsPrinterBridge.apk"',
  },
  "NoryoxNB80Bridge.apk": {
    mime: "application/vnd.android.package-archive",
    disposition: 'attachment; filename="NoryoxNB80Bridge.apk"',
  },
  "BtTiskalniMost.apk": {
    mime: "application/vnd.android.package-archive",
    disposition: 'attachment; filename="BtTiskalniMost.apk"',
  },
  "BookieVivaBridge-armeabi-v7a.apk": {
    mime: "application/vnd.android.package-archive",
    disposition: 'attachment; filename="BookieVivaBridge-armeabi-v7a.apk"',
  },
  "BookieVivaBridge-arm64.apk": {
    mime: "application/vnd.android.package-archive",
    disposition: 'attachment; filename="BookieVivaBridge-arm64.apk"',
  },
  "BookieVivaBridge.apk": {
    mime: "application/vnd.android.package-archive",
    disposition: 'attachment; filename="BookieVivaBridge.apk"',
  },
  "BookieERP.apk": {
    mime: "application/vnd.android.package-archive",
    disposition: 'attachment; filename="BookieERP.apk"',
  },
  "BookiePOS.apk": {
    mime: "application/vnd.android.package-archive",
    disposition: 'attachment; filename="BookiePOS.apk"',
  },
  "ZcsPrinterBridge-1.2.1.apk": {
    mime: "application/vnd.android.package-archive",
    disposition: 'attachment; filename="ZcsPrinterBridge-1.2.1.apk"',
  },
};

router.get("/downloads/:filename", (req, res) => {
  const { filename } = req.params;

  const file = Object.entries(ALLOWED_FILES).find(
    ([canonicalFilename]) => canonicalFilename.toLowerCase() === filename.toLowerCase(),
  );
  if (!file) {
    res.status(404).json({ error: "Datoteka ni na voljo." });
    return;
  }

  const [canonicalFilename, allowed] = file;
  const filePath = path.join(DOWNLOADS_DIR, canonicalFilename);

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
