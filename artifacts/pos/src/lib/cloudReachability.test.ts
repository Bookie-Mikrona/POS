import { describe, expect, it, vi } from "vitest";
import { probeCloudApiReachability } from "./cloudReachability";

describe("authenticated cloud health probe", () => {
  it.each([
    ["HTTP health ok", new Response(JSON.stringify({ status: "ok" }), { status: 200 }), true],
    ["SPA HTML", new Response("<!doctype html>", { status: 200, headers: { "content-type": "text/html" } }), false],
    ["HTTP error", new Response("not found", { status: 404 }), false],
    ["wrong JSON status", new Response(JSON.stringify({ status: "degraded" }), { status: 200 }), false],
  ])("%s", async (_name, response, expected) => {
    const fetcher = vi.fn().mockResolvedValue(response);
    await expect(probeCloudApiReachability(fetcher)).resolves.toBe(expected);
    expect(fetcher).toHaveBeenCalledWith("/api/healthz", expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("treats timeout/network errors as unreachable", async () => {
    await expect(probeCloudApiReachability(vi.fn().mockRejectedValue(new Error("timeout")))).resolves.toBe(false);
  });
});