import { describe, expect, it, vi } from "vitest";
import { buildPosAuthHeaders, posFetch } from "./pos-auth-headers";

describe("buildPosAuthHeaders", () => {
  it("za neposredne POS zahteve doda Clerk, enoto in actor sejo", () => {
    expect(buildPosAuthHeaders({
      token: "clerk-token",
      enotaId: "42",
      actorSession: "actor-token",
      contentType: "application/json",
    })).toEqual({
      "Content-Type": "application/json",
      Authorization: "Bearer clerk-token",
      "X-Enota-Id": "42",
      "X-Pos-Actor-Session": "actor-token",
    });
  });

  it("ne pošilja praznih identifikacijskih headerjev", () => {
    expect(buildPosAuthHeaders({
      token: null,
      enotaId: null,
      actorSession: null,
    })).toEqual({});
  });
});

describe("posFetch", () => {
  it("GET vedno pridobi svežo prijavo, enoto in actor sejo", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    const getAuthToken = vi.fn()
      .mockResolvedValueOnce("clerk-token-1")
      .mockResolvedValueOnce("clerk-token-2");
    let actorSession = "actor-token-1";
    const dependencies = {
      getAuthToken,
      getEnotaId: () => "42",
      getActorSession: () => actorSession,
      fetch: fetchMock,
    };

    await posFetch("/api/x-porocilo", {}, dependencies);
    actorSession = "actor-token-2";
    await posFetch("/api/x-porocilo", {}, dependencies);

    expect(getAuthToken).toHaveBeenCalledTimes(2);
    const firstHeaders = new Headers(fetchMock.mock.calls[0]![1]?.headers);
    const secondHeaders = new Headers(fetchMock.mock.calls[1]![1]?.headers);
    expect(firstHeaders.get("Authorization")).toBe("Bearer clerk-token-1");
    expect(firstHeaders.get("X-Enota-Id")).toBe("42");
    expect(firstHeaders.get("X-Pos-Actor-Session")).toBe("actor-token-1");
    expect(secondHeaders.get("Authorization")).toBe("Bearer clerk-token-2");
    expect(secondHeaders.get("X-Pos-Actor-Session")).toBe("actor-token-2");
    expect(fetchMock.mock.calls[0]![1]?.credentials).toBe("include");
  });

  it("POST ohrani dodatne headere, obveznih prijavnih pa caller ne more prepisati", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
    const dependencies = {
      getAuthToken: vi.fn().mockResolvedValue("fresh-clerk-token"),
      getEnotaId: () => "7",
      getActorSession: () => "fresh-actor-token",
      fetch: fetchMock,
    };

    await posFetch("/api/terminal/pay", {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "payment-123",
        Authorization: "Bearer stale-token",
        "X-Enota-Id": "999",
        "X-Pos-Actor-Session": "stale-actor-token",
      },
      body: JSON.stringify({ znesek: 12.3 }),
    }, dependencies);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    const headers = new Headers(init?.headers);
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(init?.body).toBe(JSON.stringify({ znesek: 12.3 }));
    expect(headers.get("Content-Type")).toBe("application/json");
    expect(headers.get("Idempotency-Key")).toBe("payment-123");
    expect(headers.get("Authorization")).toBe("Bearer fresh-clerk-token");
    expect(headers.get("X-Enota-Id")).toBe("7");
    expect(headers.get("X-Pos-Actor-Session")).toBe("fresh-actor-token");
  });

  it("po prvem 401 prisilno osveži Clerk žeton in zahtevo enkrat ponovi", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ napaka: "Prijava je obvezna" }), { status: 401 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "actor-token" }), { status: 200 }));
    const getAuthToken = vi.fn()
      .mockResolvedValueOnce("cached-clerk-token")
      .mockResolvedValueOnce("refreshed-clerk-token");
    const dependencies = {
      getAuthToken,
      getEnotaId: () => "7",
      getActorSession: () => null,
      fetch: fetchMock,
    };

    const response = await posFetch("/api/quick-switch/switch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ natakarId: 829, pin: "0406" }),
    }, dependencies);

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(getAuthToken).toHaveBeenNthCalledWith(2, { skipCache: true });
    const retriedHeaders = new Headers(fetchMock.mock.calls[1]![1]?.headers);
    expect(retriedHeaders.get("Authorization")).toBe("Bearer refreshed-clerk-token");
  });

  it("po 401 ponovno prebere enoto in actor sejo ter ne uporabi starih glav", async () => {
    let enotaId = "7";
    let actorSession: string | null = "actor-session-1";
    const fetchMock = vi.fn().mockImplementation(async () => {
      if (fetchMock.mock.calls.length === 1) {
        enotaId = "9";
        actorSession = "actor-session-2";
        return new Response(null, { status: 401 });
      }
      return new Response(null, { status: 204 });
    });
    const getAuthToken = vi.fn()
      .mockResolvedValueOnce("cached-clerk-token")
      .mockResolvedValueOnce("refreshed-clerk-token");
    const dependencies = {
      getAuthToken,
      getEnotaId: () => enotaId,
      getActorSession: () => actorSession,
      fetch: fetchMock,
    };

    const response = await posFetch("/api/racuni", {
      method: "POST",
      credentials: "omit",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "receipt-123",
        "X-Enota-Id": "caller-stale-unit",
        "X-Pos-Actor-Session": "caller-stale-actor",
      },
      body: JSON.stringify({ narociloId: 42 }),
    }, dependencies);

    expect(response.status).toBe(204);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const firstInit = fetchMock.mock.calls[0]![1];
    const secondInit = fetchMock.mock.calls[1]![1];
    const firstHeaders = new Headers(firstInit?.headers);
    const secondHeaders = new Headers(secondInit?.headers);
    expect(firstHeaders.get("Authorization")).toBe("Bearer cached-clerk-token");
    expect(firstHeaders.get("X-Enota-Id")).toBe("7");
    expect(firstHeaders.get("X-Pos-Actor-Session")).toBe("actor-session-1");
    expect(secondHeaders.get("Authorization")).toBe("Bearer refreshed-clerk-token");
    expect(secondHeaders.get("X-Enota-Id")).toBe("9");
    expect(secondHeaders.get("X-Pos-Actor-Session")).toBe("actor-session-2");
    expect(secondInit?.method).toBe("POST");
    expect(secondInit?.credentials).toBe("include");
    expect(secondInit?.body).toBe(JSON.stringify({ narociloId: 42 }));
    expect(secondHeaders.get("Content-Type")).toBe("application/json");
    expect(secondHeaders.get("Idempotency-Key")).toBe("receipt-123");
  });
});