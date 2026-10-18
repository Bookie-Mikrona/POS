import { Router } from "express";
import supertest from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processWebhook: vi.fn(),
  processPublicStripeEvent: vi.fn(),
  constructConnectedStripeEvent: vi.fn(),
  updateMonitor: vi.fn(),
  primary: vi.fn(),
  fallback: vi.fn(),
}));

vi.mock("./lib/stripeSyncFailureMonitor", async importOriginal => {
  const actual = await importOriginal<typeof import("./lib/stripeSyncFailureMonitor")>();
  const { deliverStripeSyncNotification } = await import("./lib/stripeSyncNotifications");
  return {
    ...actual,
    stripeSyncFailureMonitor: new actual.SharedStripeSyncFailureMonitor(
      { update: mocks.updateMonitor },
      notification => deliverStripeSyncNotification(notification, mocks.primary, mocks.fallback),
    ),
  };
});
vi.mock("./routes", () => ({ default: Router() }));
vi.mock("./routes/publicVisits", () => ({
  publicVisitsRouter: Router(),
  processPublicStripeEvent: mocks.processPublicStripeEvent,
}));
vi.mock("./lib/stripeClient", () => ({
  getStripeSync: async () => ({ processWebhook: mocks.processWebhook }),
  constructConnectedStripeEvent: mocks.constructConnectedStripeEvent,
  isStripeConnectionError: () => false,
  isStripeWebhookSyncError: (error: unknown) => error instanceof Error && error.message === "test sync failure",
}));
vi.mock("./lib/stripeConnectionAlert", () => ({
  nextStripeConnectionObservation: () => new Date("2026-01-01T00:00:00.000Z"),
  recordStripeConnectionMisconfigured: vi.fn(),
  resolveStripeConnectionMisconfigured: vi.fn(),
}));

import app from "./app";

beforeEach(() => {
  mocks.processWebhook.mockReset();
  mocks.constructConnectedStripeEvent.mockReset();
  mocks.updateMonitor.mockReset().mockResolvedValue(null);
  mocks.primary.mockReset().mockResolvedValue(undefined);
  mocks.fallback.mockReset().mockResolvedValue(undefined);
  mocks.processPublicStripeEvent.mockImplementation(async (_event, _req, res) => {
    res.status(200).json({ received: true });
  });
});

describe("public Stripe webhook integration", () => {
  it.each(["primary succeeds", "fallback succeeds", "both fail"])(
    "keeps the retryable 503 unchanged when %s", async mode => {
      mocks.processWebhook.mockRejectedValue(new Error("test sync failure"));
      mocks.updateMonitor.mockResolvedValue({
        type: "alert", firstDetectedAt: "2026-10-18T10:00:00.000Z",
        failureCount: 3, windowMs: 2_000,
      });
      if (mode !== "primary succeeds") mocks.primary.mockRejectedValue(new Error("smtp"));
      if (mode === "both fail") mocks.fallback.mockRejectedValue(new Error("fallback"));
      const response = await supertest(app)
        .post("/api/javno/stripe/webhook")
        .set("content-type", "application/json")
        .set("stripe-signature", "t=1,v1=test")
        .send(JSON.stringify({ id: "evt_failure" }));
      expect(response.status).toBe(503);
      expect(response.body).toEqual({
        error: "Stripe sinhronizacija trenutno ni na voljo.",
        code: "stripe_sync_unavailable", retryable: true,
      });
      await vi.waitFor(() => expect(mocks.primary).toHaveBeenCalledTimes(1));
      if (mode === "primary succeeds") expect(mocks.fallback).not.toHaveBeenCalled();
      else await vi.waitFor(() => expect(mocks.fallback).toHaveBeenCalledTimes(1));
      expect(mocks.processPublicStripeEvent).not.toHaveBeenCalled();
    },
  );

  it("does not wait for an unresponsive delivery channel", async () => {
    mocks.processWebhook.mockRejectedValue(new Error("test sync failure"));
    mocks.updateMonitor.mockResolvedValue({
      type: "alert", firstDetectedAt: "2026-10-18T10:00:00.000Z", failureCount: 3,
    });
    let release!: () => void;
    mocks.primary.mockImplementation(() => new Promise<void>(resolve => { release = resolve; }));
    try {
      const response = await supertest(app)
        .post("/api/javno/stripe/webhook")
        .set("content-type", "application/json")
        .set("stripe-signature", "t=1,v1=test")
        .send("{}")
        .timeout(1_000);
      expect(response.status).toBe(503);
    } finally {
      release?.();
    }
  });

  it("rejects missing signatures before parsing or synchronization", async () => {
    const response = await supertest(app)
      .post("/api/javno/stripe/webhook")
      .set("content-type", "application/json")
      .send(JSON.stringify({ id: "evt_missing_signature" }));
    expect(response.status).toBe(400);
    expect(mocks.processWebhook).not.toHaveBeenCalled();
  });

  it("passes the raw request body and signature to Stripe synchronization", async () => {
    mocks.processWebhook.mockResolvedValue({ id: "evt_valid", type: "checkout.session.completed" });
    const response = await supertest(app)
      .post("/api/javno/stripe/webhook")
      .set("content-type", "application/json")
      .set("stripe-signature", "t=1,v1=test")
      .send(JSON.stringify({ id: "evt_valid" }));
    expect(response.status).toBe(200);
    expect(mocks.processWebhook).toHaveBeenCalledWith(
      expect.any(Buffer),
      "t=1,v1=test",
    );
    expect(mocks.processPublicStripeEvent).toHaveBeenCalled();
  });

  it("verifies Connect events separately and bypasses platform StripeSync", async () => {
    mocks.constructConnectedStripeEvent.mockResolvedValue({
      id: "evt_connect",
      type: "account.updated",
      account: "acct_connected",
      data: { object: { id: "acct_connected" } },
    });
    const response = await supertest(app)
      .post("/api/javno/stripe/webhook")
      .set("content-type", "application/json")
      .set("stripe-signature", "t=1,v1=test")
      .send(JSON.stringify({ id: "evt_connect", account: "acct_connected" }));
    expect(response.status).toBe(200);
    expect(mocks.constructConnectedStripeEvent).toHaveBeenCalledWith(
      expect.any(Buffer),
      "t=1,v1=test",
    );
    expect(mocks.processPublicStripeEvent).toHaveBeenCalledWith(
      expect.objectContaining({ account: "acct_connected" }),
      expect.anything(),
      expect.anything(),
      "acct_connected",
    );
    expect(mocks.processWebhook).not.toHaveBeenCalled();
  });
});