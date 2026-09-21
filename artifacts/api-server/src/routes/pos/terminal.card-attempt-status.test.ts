import { describe, expect, it, vi } from "vitest";
import { canonicalCardAttemptStatus, mayEnrollPaytenBridge, paytenBridgeReservationDecision, persistUnavailableCardStatusCheck } from "./terminal";

describe("canonicalCardAttemptStatus", () => {
  it("maps provider protocol states without losing the provider-specific value", () => {
    expect(canonicalCardAttemptStatus("payten", "odobren")).toBe("completed");
    expect(canonicalCardAttemptStatus("sumup", "PAID")).toBe("completed");
    expect(canonicalCardAttemptStatus("viva_smart", "PENDING")).toBe("pending");
    expect(canonicalCardAttemptStatus("viva_terminal", "CANCELLED")).toBe("failed");
  });

  it("treats unfamiliar or transport states as unknown, never paid", () => {
    expect(canonicalCardAttemptStatus("viva_terminal", "PAID_FROM_CLIENT")).toBe("unknown");
    expect(canonicalCardAttemptStatus("sumup", undefined)).toBe("unknown");
  });

  it("durably maps a status-check transport failure to unknown evidence", async () => {
    const persist = vi.fn(async () => undefined);
    await persistUnavailableCardStatusCheck(persist);
    expect(persist).toHaveBeenCalledOnce();
    expect(persist).toHaveBeenCalledWith({
      status: "unknown",
      providerRawStatus: "STATUS_CHECK_UNAVAILABLE",
      napaka: expect.stringContaining("izid plačila ni znan"),
    });
  });

  it("never relaunches an existing native Bridge reservation", () => {
    expect(paytenBridgeReservationDecision(true, "reserved")).toBe("launch");
    expect(paytenBridgeReservationDecision(false, "completed")).toBe("completed");
    for (const status of ["reserved", "pending", "unknown", "failed"] as const) {
      expect(paytenBridgeReservationDecision(false, status)).toBe("reconcile");
    }
  });

  it("allows only trusted administrator roles to reach Bridge enrollment", () => {
    expect(mayEnrollPaytenBridge("admin")).toBe(true);
    expect(mayEnrollPaytenBridge("admin_enote")).toBe(true);
    expect(mayEnrollPaytenBridge("uporabnik")).toBe(false);
    expect(mayEnrollPaytenBridge(undefined)).toBe(false);
  });
});