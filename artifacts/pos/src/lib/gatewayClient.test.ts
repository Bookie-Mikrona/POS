import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearLocalGateway,
  configureLocalGateway,
  gatewaySignatureInput,
  gatewayEndpointUrl,
  normalizeGatewayBaseUrl,
  localOrderRoute,
  parseLocalOrderRoute,
  probeCloudApiReachability,
  offlineLanModeMessage,
  pollLocalGatewayEvents,
  probeLocalGateway,
  gatewayPosService,
} from "./gatewayClient";

describe("Bookie Local Gateway client", () => {
  afterEach(() => {
    localStorage.clear();
    vi.restoreAllMocks();
  });

  it("builds the exact method/path/timestamp/nonce/body hash signature input", () => {
    expect(gatewaySignatureInput("post", "/v1/gateway/events?after=2", "123", "nonce", "ABC")).toBe(
      "POST\n/v1/gateway/events?after=2\n123\nnonce\nabc",
    );
  });

  it("normalizes host, port and /v1 without double prefixes", () => {
    expect(normalizeGatewayBaseUrl("gateway.example:17831")).toBe("https://gateway.example:17831/v1");
    expect(normalizeGatewayBaseUrl("https://gateway.example:17831/v1/")).toBe("https://gateway.example:17831/v1");
    expect(normalizeGatewayBaseUrl("http://127.0.0.1:17831", { allowLoopbackHttp: true })).toBe("http://127.0.0.1:17831/v1");
    expect(() => normalizeGatewayBaseUrl("http://192.168.1.10:17831")).toThrow(/HTTPS/);
    expect(gatewayEndpointUrl("https://gateway.example:17831/v1", "/gateway/health"))
      .toBe("https://gateway.example:17831/v1/gateway/health");
  });

  it("keeps one service/callback identity across snapshot polls", () => {
    const first = gatewayPosService({ companyId: "company", enotaId: 7 });
    const second = gatewayPosService({ companyId: "company", enotaId: 7 });
    expect(second).toBe(first);
    expect(second.acquireLease).toBe(first.acquireLease);
    expect(second.renewLease).toBe(first.renewLease);
    expect(second.releaseLease).toBe(first.releaseLease);
  });

  it("keeps gateway UUIDs opaque and route-safe", () => {
    const id = "5bdc2b5a-8cb9-4a4e-a7b0-8a20d0e2f11a";
    expect(localOrderRoute(id)).toBe(`local:${id}`);
    expect(parseLocalOrderRoute(localOrderRoute(id))).toBe(id);
    expect(parseLocalOrderRoute("42")).toBeUndefined();
  });

  it("probes cloud health explicitly rather than using browser online state", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("ok", { status: 200 })));
    await expect(probeCloudApiReachability()).resolves.toBe(true);
    expect(fetch).toHaveBeenCalledWith("/api/healthz", expect.objectContaining({ credentials: "include" }));
  });

  it("pairs against exactly one /v1 endpoint", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      pairingSecret: "x".repeat(43), clientId: "client-1", contract: "v1",
    }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    await expect(import("./gatewayClient").then(({ pairLocalGateway }) =>
      pairLocalGateway("https://gateway.example:17831/v1", "123456", "POS 1"))).rejects.toThrow();
    expect(fetchMock.mock.calls[0][0]).toBe("https://gateway.example:17831/v1/pair");
  });

  it("rejects malformed config and never puts the pairing secret in localStorage", async () => {
    await expect(configureLocalGateway({
      baseUrl: "https://user:password@example.test", clientId: "client-1", pairingSecret: "x".repeat(32),
    })).rejects.toThrow();
    await expect(configureLocalGateway({
      baseUrl: "https://192.168.1.20:17831/v1", clientId: "client-1", pairingSecret: "x".repeat(32),
    })).rejects.toThrow(/IndexedDB/);
    expect(localStorage.getItem("bookie.local-gateway.config")).toBeNull();
  });

  it("probes health without credentials and reports HTTP errors", async () => {
    vi.stubGlobal("fetch", vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({
        service: "Bookie Local Gateway", status: "ok", lan: true, bind: "0.0.0.0",
        port: 17831, pendingEventCount: 0, checkedAt: "2026-01-01T00:00:00Z", diagnosticTime: "01.01.2026 01:00",
      }), { status: 200 }))
      .mockResolvedValueOnce(new Response("offline", { status: 503 })));
    await expect(probeLocalGateway("https://192.168.1.20:17831/v1")).resolves.toMatchObject({ lan: true });
    await expect(probeLocalGateway("https://192.168.1.20:17831/v1")).rejects.toThrow("503");
  });

  it("does not poll or expose events without an explicitly paired gateway", async () => {
    await expect(pollLocalGatewayEvents(4)).rejects.toThrow(/ni konfiguriran/);
    expect(offlineLanModeMessage(false, true)).toContain("Offline LAN");
    expect(offlineLanModeMessage(true, true)).toBeUndefined();
  });

  it("clears local gateway metadata without logging or rendering the secret", async () => {
    localStorage.setItem("bookie.local-gateway.config", JSON.stringify({ baseUrl: "http://x", clientId: "c" }));
    await clearLocalGateway();
    expect(localStorage.getItem("bookie.local-gateway.config")).toBeNull();
  });
});