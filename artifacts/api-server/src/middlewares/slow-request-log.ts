import type { RequestHandler } from "express";
import { logger } from "../lib/logger";

const DEFAULT_THRESHOLD_MS = 1000;

function thresholdMs(): number {
  const parsed = Number(process.env["POS_SLOW_REQUEST_MS"]);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_THRESHOLD_MS;
}

/**
 * Zabeleži opozorilo za počasne POS zahteve. Beleži le metodo, vzorec poti,
 * pot brez poizvedbenega niza, status in trajanje; nikoli glav ali telesa.
 * Prag: POS_SLOW_REQUEST_MS (privzeto 1000 ms).
 */
export const slowRequestLog: RequestHandler = (req, res, next) => {
  const startedAt = process.hrtime.bigint();
  res.once("finish", () => {
    const durationMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
    if (durationMs < thresholdMs()) return;
    const routePattern = typeof req.route?.path === "string" ? req.route.path : null;
    logger.warn(
      {
        method: req.method,
        path: req.originalUrl.split("?")[0],
        routePattern,
        statusCode: res.statusCode,
        durationMs: Math.round(durationMs),
      },
      "POS počasen zahtevek",
    );
  });
  next();
};
