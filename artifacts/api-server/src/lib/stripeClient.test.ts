import Stripe from "stripe";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processEvent: vi.fn(),
  options: [] as unknown[],
}));

vi.mock("stripe-replit-sync", () => ({
  StripeSync: class {
    constructor(options: unknown) {
      mocks.options.push(options);
    }
    processEvent(event: Stripe.Event) {
      return mocks.processEvent(event);
    }
  },
}));

import { getStripeSync, isStripeConnectionError, isStripeWebhookSyncError } from "./stripeClient";

const payload = JSON.stringify({
  id: "evt_restore_test",
  object: "event",
  type: "checkout.session.completed",
  data: { object: { id: "cs_restore_test", object: "checkout.session" } },
});

beforeEach(() => {
  vi.stubEnv("DATABASE_URL", "postgresql://restore-test");
  vi.stubEnv("REPLIT_CONNECTORS_HOSTNAME", "connectors.test");
  vi.stubEnv("REPL_IDENTITY", "restore-test");
  mocks.options.length = 0;
  mocks.processEvent.mockReset();
});

afterEach(() => vi.unstubAllEnvs());

describe("Stripe client safeguards", () => {
  it("classifies a missing connector as a non-retryable configuration error", async () => {
    vi.stubEnv("REPLIT_CONNECTORS_HOSTNAME", "");
    const error = await getStripeSync().catch((value) => value);
    expect(isStripeConnectionError(error)).toBe(true);
    expect(error).toMatchObject({ code: "stripe_connection_misconfigured", retryable: false });
  });

  it("verifies the raw webhook signature before syncing", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{ settings: { secret_key: "sk_test_restore", webhook_secret: "whsec_restore" } }],
    }))));
    const adapter = await getStripeSync();
    const stripe = new Stripe("sk_test_restore");
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_wrong" });
    const error = await adapter.processWebhook(Buffer.from(payload), signature).catch((value) => value);
    expect(error).toBeInstanceOf(Error);
    expect(isStripeWebhookSyncError(error)).toBe(false);
    expect(mocks.processEvent).not.toHaveBeenCalled();
  });

  it("marks synchronization failures without replacing the original error", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(JSON.stringify({
      items: [{ settings: { secret_key: "sk_test_restore", webhook_secret: "whsec_restore" } }],
    }))));
    const syncError = new Error("sync failed");
    mocks.processEvent.mockRejectedValue(syncError);
    const adapter = await getStripeSync();
    const stripe = new Stripe("sk_test_restore");
    const signature = stripe.webhooks.generateTestHeaderString({ payload, secret: "whsec_restore" });
    await expect(adapter.processWebhook(Buffer.from(payload), signature)).rejects.toBe(syncError);
    expect(isStripeWebhookSyncError(syncError)).toBe(true);
  });
});