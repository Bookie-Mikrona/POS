import { describe, expect, it } from "vitest";
import { captureCurrentScopeToken, configureScope, isCurrent, normalizeLatestProjection, selectEffectiveAuthority } from "./gatewayOfflineStore";
import { localOrderRoute, parseLocalOrderRoute } from "./gatewayClient";

describe("gateway authority state machine", () => {
  it("invalidates async work when the exact scope changes", () => {
    configureScope({ companyId: "company-a", enotaId: 1 });
    const token = captureCurrentScopeToken();
    expect(isCurrent(token)).toBe(true);
    configureScope({ companyId: "company-b", enotaId: 1 });
    expect(isCurrent(token)).toBe(false);
    expect(captureCurrentScopeToken().companyId).toBe("company-b");
  });
  it("stays CLOUD whenever the cloud probe is healthy", () => {
    expect(selectEffectiveAuthority({ enabled: true, cloudHealthy: true, gatewayHealthy: true })).toBe("CLOUD");
  });

  it("requires explicit enablement, cloud failure, and gateway health", () => {
    expect(selectEffectiveAuthority({ enabled: false, cloudHealthy: false, gatewayHealthy: true })).toBe("CLOUD");
    expect(selectEffectiveAuthority({ enabled: true, cloudHealthy: false, gatewayHealthy: false })).toBe("CLOUD");
    expect(selectEffectiveAuthority({ enabled: true, cloudHealthy: false, gatewayHealthy: true })).toBe("GATEWAY");
  });

  it("keeps a pinned order on gateway while cloud recovers", () => {
    expect(selectEffectiveAuthority({
      enabled: true, cloudHealthy: true, gatewayHealthy: true,
      pinnedOrderIds: new Set(["local:abc"]),
    })).toBe("GATEWAY");
  });

  it("uses server authority state even without a local route pin", () => {
    expect(selectEffectiveAuthority({
      enabled: true, cloudHealthy: true, gatewayHealthy: true,
      hasOpenLocalOrders: true, pendingLocalEvents: 0,
    })).toBe("GATEWAY");
    expect(selectEffectiveAuthority({
      enabled: true, cloudHealthy: true, gatewayHealthy: true,
      hasOpenLocalOrders: false, pendingLocalEvents: 2,
    })).toBe("GATEWAY");
  });

  it("unwraps a polled wrapper into one canonical projection/version entry", () => {
    const normalized = normalizeLatestProjection({
      orderId: "local-order", version: 4,
      projection: { orderId: "local-order", status: "open", lines: [] },
    });
    const first = { ...normalized.projection, lines: [{ lineId: "a" }] };
    const second = { ...first, lines: [...first.lines!, { lineId: "b" }] };
    expect(normalized.version).toBe(4);
    expect(second.lines?.map(line => line.lineId)).toEqual(["a", "b"]);
    expect((normalized.projection as any).projection).toBeUndefined();
  });

  it("keeps primed numeric cloud IDs string-local and routes them explicitly", () => {
    const normalized = normalizeLatestProjection({
      orderId: "42", version: 2,
      projection: { orderId: 42, cloudOrderId: 42, status: "open", lines: [] },
    });
    expect(normalized.projection.orderId).toBe("42");
    expect(normalized.projection.cloudOrderId).toBe(42);
    expect(localOrderRoute("42")).toBe("local:42");
    expect(parseLocalOrderRoute("local:42")).toBe("42");
  });
});