import { Router } from "express";
import supertest from "supertest";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  processWebhook: vi.fn(),
  processPublicStripeEvent: vi.fn(),
}));

vi.mock("./routes", () => ({ default: Router() }));
vi.mock("./routes/publicVisits", () => ({
  publicVisitsRouter: Router(),
  processPublicStripeEvent: mocks.processPublicStripeEvent,
}));
vi.mock("./lib/stripeClient", () => ({
  getStripeSync: async () => ({ processWebhook: mocks.processWebhook }),
  isStripeConnectionError: () => false,
  isStripeWebhookSyncError: () => false,
}));
vi.mock("./lib/stripeConnectionAlert", () => ({
  nextStripeConnectionObservation: () => new Date("2026-01-01T00:00:00.000Z"),
  recordStripeConnectionMisconfigured: vi.fn(),
  resolveStripeConnectionMisconfigured: vi.fn(),
}));

import app from "./app";

beforeEach(() => {
  mocks.processWebhook.mockReset();
  mocks.processPublicStripeEvent.mockImplementation(async (_event, _req, res) => {
    res.status(200).json({ received: true });
  });
});

describe("public Stripe webhook integration", () => {
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
});