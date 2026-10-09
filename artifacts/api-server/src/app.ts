import express, { type Express } from "express";
import cors from "cors";
import pinoHttp from "pino-http";
import { clerkMiddleware } from "@clerk/express";
import { publishableKeyFromHost } from "@clerk/shared/keys";
import {
  CLERK_PROXY_PATH,
  clerkProxyMiddleware,
  getClerkProxyHost,
} from "./middlewares/clerkProxyMiddleware";
import { isDatabaseRestoreInProgress } from "./lib/databaseRestoreGuard";
import router from "./routes";
import javniMeniRouter from "./routes/javnoMeni";
import { processPublicStripeEvent, publicVisitsRouter } from "./routes/publicVisits";
import {
  logPublicStripeWebhookFailure,
} from "./lib/logger";
import {
  getStripeSync,
  constructConnectedStripeEvent,
  isStripeConnectionError,
  isStripeWebhookSyncError,
} from "./lib/stripeClient";
import { stripeSyncFailureMonitor } from "./lib/stripeSyncFailureMonitor";
import {
  nextStripeConnectionObservation,
  recordStripeConnectionMisconfigured,
  resolveStripeConnectionMisconfigured,
} from "./lib/stripeConnectionAlert";
import { logger } from "./lib/logger";

const app: Express = express();

// Replitova artifact pot lahko vsebuje več notranjih proxyjev. Zaupamo samo
// loopback/zasebnim proxy naslovom in se ustavimo pri prvem javnem naslovu,
// zato uporabniško podtaknjene vrednosti levo od njega niso zaupanja vredne.
app.set("trust proxy", ["loopback", "linklocal", "uniquelocal"]);

app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);

// Clerk proxy — must be before body parsers
app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());

app.use(cors({ credentials: true, origin: true }));
app.post(
  "/api/javno/stripe/webhook",
  express.raw({ type: "application/json" }),
  async (req, res): Promise<void> => {
    const signature = req.headers["stripe-signature"];
    if (!signature || Array.isArray(signature) || !Buffer.isBuffer(req.body)) {
      res.status(400).json({ error: "Manjka veljaven Stripe podpis." });
      return;
    }
    try {
      let hasConnectAccount = false;
      try {
        const untrusted = JSON.parse(req.body.toString("utf8"));
        hasConnectAccount = Object.prototype.hasOwnProperty.call(untrusted ?? {}, "account");
      } catch {
        // The platform verifier below will return the canonical invalid-payload response.
      }
      if (hasConnectAccount) {
        const event = await constructConnectedStripeEvent(req.body, signature);
        await processPublicStripeEvent(event, req, res, event.account ?? null);
        return;
      }
      const sync = await getStripeSync();
      const event = await sync.processWebhook(req.body, signature);
      try {
        await resolveStripeConnectionMisconfigured(
          undefined,
          nextStripeConnectionObservation(),
        );
      } catch (alertError) {
        req.log.error(
          { err: alertError, operation: "resolve" },
          "Stripe connection alert state could not be resolved",
        );
      }
      const recovery = stripeSyncFailureMonitor.recordSuccess();
      if (recovery) {
        req.log.info(
          {
            reason: "stripe_sync_recovered",
            failureCount: recovery.failureCount,
            outageDurationMs: recovery.outageDurationMs,
          },
          "Stripe webhook synchronization recovered",
        );
      }
      await processPublicStripeEvent(event, req, res);
    } catch (error) {
      if (isStripeWebhookSyncError(error)) {
        const operationalAlert = stripeSyncFailureMonitor.recordFailure();
        logPublicStripeWebhookFailure({
          error,
          reason: "stripe_sync_failed",
          retryable: true,
          requestId: req.id,
          message: "Stripe webhook synchronization failed",
        });
        if (operationalAlert) {
          req.log.warn(
            {
              reason: "stripe_sync_repeated_failures",
              failureCount: operationalAlert.failureCount,
              windowMs: operationalAlert.windowMs,
            },
            "Repeated Stripe webhook synchronization failures",
          );
        }
        res.status(503).json({
          error: "Stripe sinhronizacija trenutno ni na voljo.",
          code: "stripe_sync_unavailable",
          retryable: true,
        });
        return;
      }
      if (isStripeConnectionError(error)) {
        if (error.code === "stripe_connection_misconfigured") {
          try {
            await recordStripeConnectionMisconfigured(
              undefined,
              nextStripeConnectionObservation(),
            );
          } catch (alertError) {
            req.log.error(
              { err: alertError, operation: "open" },
              "Stripe connection alert state could not be recorded",
            );
          }
        }
        logPublicStripeWebhookFailure({
          error,
          reason: error.code,
          retryable: error.retryable,
          requestId: req.id,
          message: "Stripe connection failed before webhook verification",
        });
        res.status(error.retryable ? 503 : 500).json({
          error: error.retryable
            ? "Stripe povezava trenutno ni na voljo."
            : "Stripe povezava ni pravilno nastavljena.",
          code: error.code,
          retryable: error.retryable,
        });
        return;
      }
      logPublicStripeWebhookFailure({
        error,
        reason: "stripe_signature_or_payload_invalid",
        retryable: false,
        requestId: req.id,
        message: "Stripe webhook rejected",
      });
      res.status(400).json({ error: "Stripe dogodka ni mogoče potrditi." });
    }
  },
);
app.use(express.json({
  limit: "20mb",
  verify: (req, _res, buffer) => { (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); },
}));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Javni QR meni je registriran pred Clerk middleware in requireEnota, brez prijave.
// Meni in klic natakarja zahtevata veljaven token mize aktivne enote, paket Extended,
// zmožnost qr_menu na enoti ter veljavno aktivacijsko sejo za isto mizo in QR napravo.
// Neveljaven token, neustrezen paket ali manjkajoči qr_menu vrnejo 404;
// manjkajoča oziroma neveljavna aktivacijska seja vrne 401.
app.use("/api", javniMeniRouter);
app.use("/api", publicVisitsRouter);

// Clerk middleware — resolves publishable key from host
app.use(
  clerkMiddleware((req) => ({
    publishableKey: publishableKeyFromHost(
      getClerkProxyHost(req) ?? "",
      process.env.CLERK_PUBLISHABLE_KEY,
    ),
  })),
);

app.use("/api", async (req, res, next) => {
  if (
    ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
    req.path === "/backup/obnovi"
  ) {
    next();
    return;
  }

  try {
    if (await isDatabaseRestoreInProgress()) {
      res.setHeader("Retry-After", "60");
      res.status(503).json({
        error: "Obnova celotne baze je v teku. Poskusite znova po zaključku postopka.",
      });
      return;
    }
    next();
  } catch (error) {
    req.log.error({ err: error }, "Database restore guard check failed");
    res.status(503).json({
      error: "Spremembe so začasno onemogočene, ker stanja obnove baze ni mogoče preveriti.",
    });
  }
});

app.use("/api", router);

export default app;
