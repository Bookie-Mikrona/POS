import { afterEach, describe, expect, it, vi } from "vitest";
import { customFetch, setAuthTokenGetter } from "@workspace/api-client-react";

describe("customFetch auth refresh", () => {
  afterEach(() => {
    setAuthTokenGetter(null);
    vi.unstubAllGlobals();
  });

  it("po 401 ponovi zahtevek s prisilno osveženim žetonom", async () => {
    const tokenCalls: Array<{ skipCache?: boolean } | undefined> = [];
    setAuthTokenGetter(async (options) => {
      tokenCalls.push(options);
      return options?.skipCache ? "fresh-token" : "cached-token";
    });

    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ error: "Unauthorized" }),
        { status: 401, headers: { "content-type": "application/json" } },
      ))
      .mockResolvedValueOnce(new Response(
        JSON.stringify({ ok: true }),
        { status: 200, headers: { "content-type": "application/json" } },
      ));
    vi.stubGlobal("fetch", fetchMock);

    await expect(customFetch("/api/test", { responseType: "json" })).resolves.toEqual({ ok: true });
    expect(tokenCalls).toEqual([undefined, { skipCache: true }]);
    expect(new Headers(fetchMock.mock.calls[0]![1].headers).get("authorization")).toBe("Bearer cached-token");
    expect(new Headers(fetchMock.mock.calls[1]![1].headers).get("authorization")).toBe("Bearer fresh-token");
  });
});