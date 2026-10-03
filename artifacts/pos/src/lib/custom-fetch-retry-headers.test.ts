import { afterEach, describe, expect, it, vi } from "vitest";
import {
  customFetch,
  setAuthTokenGetter,
  setBaseUrl,
  setEnotaIdGetter,
  setOn401Handler,
  setPosActorSessionGetter,
} from "@workspace/api-client-react";

describe("customFetch 401 retry headers", () => {
  it("vrne SSE response brez branja telesa ter pošlje prijavo in izrecno podjetje", async () => {
    setAuthTokenGetter(() => "stream-test-token");
    setEnotaIdGetter(() => "309");
    const response = new Response("event: ping\ndata: {}\n\n", {
      status: 200, headers: { "Content-Type": "text/event-stream" },
    });
    const fetchMock = vi.fn().mockResolvedValue(response);
    vi.stubGlobal("fetch", fetchMock);
    expect(await customFetch<Response>("/pos/api/events", {
      responseType: "stream", headers: { "X-Company-Id": "selected-company" },
    })).toBe(response);
    expect(response.bodyUsed).toBe(false);
    const headers = new Headers(fetchMock.mock.calls[0][1].headers);
    expect(headers.get("authorization")).toBe("Bearer stream-test-token");
    expect(headers.get("x-company-id")).toBe("selected-company");
    expect(headers.get("x-enota-id")).toBe("309");
  });

  afterEach(() => {
    setAuthTokenGetter(null);
    setEnotaIdGetter(null);
    setPosActorSessionGetter(null);
    setOn401Handler(null);
    setBaseUrl(null);
    vi.unstubAllGlobals();
  });

  it("po 401 osveži actor sejo in enoto, ne da bi spremenil zahtevek", async () => {
    let actorSession: string | null = "actor-session-1";
    let enotaId: string | null = "1";
    setAuthTokenGetter(options => options?.skipCache ? "fresh-token" : "cached-token");
    setPosActorSessionGetter(() => actorSession);
    setEnotaIdGetter(() => enotaId);

    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        actorSession = "actor-session-2";
        enotaId = "2";
        return new Response(null, { status: 401 });
      }
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(customFetch("/racuni", {
      method: "POST",
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
        "Idempotency-Key": "racun-554",
      },
      body: JSON.stringify({ narociloId: 554 }),
      responseType: "json",
    })).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const [firstInput, firstInit] = fetchMock.mock.calls[0]!;
    const [retryInput, retryInit] = fetchMock.mock.calls[1]!;
    expect(retryInput).toBe(firstInput);
    expect(firstInit?.method).toBe("POST");
    expect(retryInit?.method).toBe("POST");
    expect(firstInit?.body).toBe(JSON.stringify({ narociloId: 554 }));
    expect(retryInit?.body).toBe(JSON.stringify({ narociloId: 554 }));
    expect(firstInit?.credentials).toBe("include");
    expect(retryInit?.credentials).toBe("include");

    const firstHeaders = new Headers(firstInit?.headers);
    const retryHeaders = new Headers(retryInit?.headers);
    expect(firstHeaders.get("authorization")).toBe("Bearer cached-token");
    expect(firstHeaders.get("x-pos-actor-session")).toBe("actor-session-1");
    expect(firstHeaders.get("x-enota-id")).toBe("1");
    expect(retryHeaders.get("authorization")).toBe("Bearer fresh-token");
    expect(retryHeaders.get("x-pos-actor-session")).toBe("actor-session-2");
    expect(retryHeaders.get("x-enota-id")).toBe("2");
    expect(retryHeaders.get("content-type")).toBe("application/json");
    expect(retryHeaders.get("idempotency-key")).toBe("racun-554");
  });

  it("po 401 odstrani actor header, kadar trenutni getter vrne null", async () => {
    let actorSession: string | null = "actor-session-1";
    setAuthTokenGetter(options => options?.skipCache ? "fresh-token" : "cached-token");
    setPosActorSessionGetter(() => actorSession);
    const fetchMock = vi.fn(async () => {
      if (fetchMock.mock.calls.length === 1) {
        actorSession = null;
        return new Response(null, { status: 401 });
      }
      return new Response(null, { status: 204 });
    });
    vi.stubGlobal("fetch", fetchMock);

    await expect(customFetch("/racuni", { method: "POST" })).resolves.toBeNull();
    expect(new Headers(fetchMock.mock.calls[0]![1]?.headers).get("x-pos-actor-session"))
      .toBe("actor-session-1");
    expect(new Headers(fetchMock.mock.calls[1]![1]?.headers).has("x-pos-actor-session"))
      .toBe(false);
  });
});