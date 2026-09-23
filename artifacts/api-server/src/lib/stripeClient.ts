import Stripe from "stripe";
import { StripeSync } from "stripe-replit-sync";
import { z } from "zod";

const stripeWebhookSyncErrors = new WeakSet<object>();
const stripeConnectionResponseSchema = z.object({
  items: z.array(z.object({
    settings: z.object({
      secret_key: z.string().optional(),
      webhook_secret: z.string().optional(),
    }).passthrough(),
  }).passthrough()),
}).passthrough();

export type StripeConnectionErrorCode =
  | "stripe_connection_unavailable"
  | "stripe_connection_invalid_response"
  | "stripe_connection_misconfigured";

export class StripeConnectionError extends Error {
  constructor(
    public readonly code: StripeConnectionErrorCode,
    message: string,
    public readonly retryable: boolean,
    cause?: unknown,
  ) {
    super(message, { cause });
    this.name = "StripeConnectionError";
  }
}

export function isStripeConnectionError(
  error: unknown,
): error is StripeConnectionError {
  return error instanceof StripeConnectionError;
}

export function isStripeWebhookSyncError(error: unknown): boolean {
  return (
    (typeof error === "object" && error !== null) ||
    typeof error === "function"
  ) && stripeWebhookSyncErrors.has(error);
}

async function getStripeCredentials(): Promise<{ secretKey: string; webhookSecret?: string }> {
  const hostname=process.env.REPLIT_CONNECTORS_HOSTNAME;
  const token=process.env.REPL_IDENTITY ? `repl ${process.env.REPL_IDENTITY}` : process.env.WEB_REPL_RENEWAL ? `depl ${process.env.WEB_REPL_RENEWAL}` : null;
  if(!hostname||!token) {
    throw new StripeConnectionError(
      "stripe_connection_misconfigured",
      "Stripe integracija ni povezana.",
      false,
    );
  }
  let response: Response;
  try {
    response=await fetch(`https://${hostname}/api/v2/connection?include_secrets=true&connector_names=stripe`,{headers:{Accept:"application/json",X_REPLIT_TOKEN:token},signal:AbortSignal.timeout(10_000)});
  } catch (error) {
    throw new StripeConnectionError(
      "stripe_connection_unavailable",
      "Stripe povezava trenutno ni dosegljiva.",
      true,
      error,
    );
  }
  if(!response.ok) {
    const retryable=response.status===408||response.status===425||response.status===429||response.status>=500;
    throw new StripeConnectionError(
      retryable
        ? "stripe_connection_unavailable"
        : "stripe_connection_misconfigured",
      retryable
        ? "Stripe povezava trenutno ni dosegljiva."
        : "Stripe povezava ni pravilno nastavljena.",
      retryable,
    );
  }
  let data: unknown;
  try {
    data=await response.json();
  } catch (error) {
    throw new StripeConnectionError(
      "stripe_connection_invalid_response",
      "Stripe povezava je vrnila neveljaven odgovor.",
      true,
      error,
    );
  }
  const parsed=stripeConnectionResponseSchema.safeParse(data);
  if(!parsed.success) {
    throw new StripeConnectionError(
      "stripe_connection_invalid_response",
      "Stripe povezava je vrnila nepričakovano strukturo.",
      true,
    );
  }
  const settings=parsed.data.items[0]?.settings;
  if(!settings?.secret_key?.trim()) {
    throw new StripeConnectionError(
      "stripe_connection_misconfigured",
      "Stripe integracija nima skrivnega ključa.",
      false,
    );
  }
  return {
    secretKey:settings.secret_key,
    webhookSecret:settings.webhook_secret?.trim() || undefined,
  };
}
export async function getUncachableStripeClient(){const {secretKey}=await getStripeCredentials();return new Stripe(secretKey);}
export async function getStripeSync(){
  if(!process.env.DATABASE_URL) {
    throw new StripeConnectionError(
      "stripe_connection_misconfigured",
      "DATABASE_URL ni nastavljen.",
      false,
    );
  }
  const {secretKey,webhookSecret}=await getStripeCredentials();
  if(!webhookSecret) {
    throw new StripeConnectionError(
      "stripe_connection_misconfigured",
      "Stripe integracija nima webhook skrivnosti.",
      false,
    );
  }
  const stripe=new Stripe(secretKey);
  const sync=new StripeSync({poolConfig:{connectionString:process.env.DATABASE_URL},stripeSecretKey:secretKey,stripeWebhookSecret:webhookSecret});
  return {
    async processWebhook(payload:Buffer|string,signature:string):Promise<Stripe.Event>{
      const event=stripe.webhooks.constructEvent(payload,signature,webhookSecret);
      try {
        await sync.processEvent(event);
      } catch (error) {
        if (
          (typeof error === "object" && error !== null) ||
          typeof error === "function"
        ) {
          stripeWebhookSyncErrors.add(error);
        }
        throw error;
      }
      return event;
    },
  };
}