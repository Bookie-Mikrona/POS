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
app.use(express.json({
  limit: "20mb",
  verify: (req, _res, buffer) => { (req as typeof req & { rawBody?: Buffer }).rawBody = Buffer.from(buffer); },
}));
app.use(express.urlencoded({ extended: true, limit: '20mb' }));

// Javni QR meni je namerno registriran pred Clerk middleware in pred
// requireEnota: dostop določa samo nepredvidljiv token mize.
app.use("/api", javniMeniRouter);

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
