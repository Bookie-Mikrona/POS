import pino from "pino";

const isProduction = process.env.NODE_ENV === "production";

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  redact: [
    "req.headers.authorization",
    "req.headers.cookie",
    "res.headers['set-cookie']",
  ],
  ...(isProduction
    ? {}
    : {
        transport: {
          target: "pino-pretty",
          options: { colorize: true },
        },
      }),
});

export function logPublicStripeWebhookFailure(input: {
  error?: unknown;
  errorType?: string;
  reason: string;
  retryable: boolean;
  requestId: unknown;
  message: string;
}): void {
  const errorType = input.errorType ?? (
    input.error && typeof input.error === "object" && "name" in input.error &&
    typeof input.error.name === "string"
      ? input.error.name
      : "UnknownError"
  );
  logger.error(
    {
      errorType,
      reason: input.reason,
      retryable: input.retryable,
      requestId:
        typeof input.requestId === "string" || typeof input.requestId === "number"
          ? input.requestId
          : "unknown",
    },
    input.message,
  );
}
