import { describe, expect, it } from "vitest";
import { gatewayJob, isLiveGatewayKdsJob, mapGatewayKdsState } from "./use-kds";

describe("gateway KDS state machine", () => {
  it("hides excluded and terminal jobs even from an older gateway response", () => {
    for (const state of ["QUEUED", "CLAIMED", "STARTED", "READY"]) {
      expect(isLiveGatewayKdsJob({ state, payload: { line: { kdsIzkljucen: true } } })).toBe(false);
      expect(isLiveGatewayKdsJob({ state, payload: { line: { kdsIzkljucen: false } } })).toBe(true);
    }
    for (const state of ["COMPLETED", "CANCELLED"]) {
      expect(isLiveGatewayKdsJob({ state, payload: { line: {} } })).toBe(false);
    }
  });
  it.each([
    ["QUEUED", "zadrzano"], ["CLAIMED", "aktivno"], ["STARTED", "aktivno"],
    ["READY", "bumped"], ["COMPLETED", "ack"], ["CANCELLED", "preklicano"],
  ])("maps %s explicitly", (state, expected) => {
    expect(mapGatewayKdsState(state)).toBe(expected);
  });

  it("rejects unknown gateway states instead of treating them as active", () => {
    expect(() => mapGatewayKdsState("BROKEN")).toThrow("Neznano stanje");
  });

  it("preserves opaque identifiers and course metadata", () => {
    const result = gatewayJob({
      jobId: "job-uuid-1", state: "QUEUED", enotaId: 4, createdAt: "2026-01-01T00:00:00Z",
      payload: {
        orderId: "order-uuid", line: {
          lineId: "line-uuid", postajaId: 7, courseNumber: 2, courseSequence: 1,
          pairingGroupId: "pair-uuid", activatedAt: "2026-01-01T00:01:00Z",
        },
      },
    });
    expect(result.id).toBe("job-uuid-1");
    expect(result.narociloId).toBe("order-uuid");
    expect(result.postavkaId).toBe("line-uuid");
    expect(result.stanje).toBe("zadrzano");
    expect(result.courseNumber).toBe(2);
    expect(result.courseSequence).toBe(1);
    expect(result.pairingGroupId).toBe("pair-uuid");
    expect(result.aktiviranoAt).toBe("2026-01-01T00:01:00Z");
  });
});